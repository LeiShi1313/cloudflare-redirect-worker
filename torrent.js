const { getObject, putObject } = require('./r2')
const { parseTorrentInfoHash, TorrentParseError } = require('./torrent-parse')

const MAX_TORRENT_BYTES = 100 * 1024 * 1024
const UPLOAD_RATE_LIMIT = 20
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60

class BodyTooLargeError extends Error {}
class EmptyBodyError extends Error {}
class RateLimitExceededError extends Error {}

const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    })

const textResponse = (body, status) =>
    new Response(body, {
        status,
        headers: {
            'content-type': 'text/plain',
        },
    })

const torrentObjectKey = hash => `torrents/${hash.toLowerCase()}.torrent`

const getContentLength = request => {
    const header = request.headers.get('content-length')
    if (!header) {
        return null
    }

    const length = Number(header)
    return Number.isFinite(length) && length >= 0 ? length : null
}

const concatChunks = (chunks, size) => {
    const result = new Uint8Array(size)
    let offset = 0

    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
    }

    return result
}

const readRequestBytes = async (request, maxBytes = MAX_TORRENT_BYTES) => {
    const contentLength = getContentLength(request)
    if (contentLength !== null && contentLength > maxBytes) {
        throw new BodyTooLargeError()
    }

    if (!request.body) {
        throw new EmptyBodyError()
    }

    const reader = request.body.getReader()
    const chunks = []
    let size = 0

    while (true) {
        const { done, value } = await reader.read()
        if (done) {
            break
        }

        size += value.byteLength
        if (size > maxBytes) {
            throw new BodyTooLargeError()
        }

        chunks.push(value)
    }

    if (size === 0) {
        throw new EmptyBodyError()
    }

    return concatChunks(chunks, size)
}

const getClientIp = request => {
    const cloudflareIp = request.headers.get('cf-connecting-ip')
    if (cloudflareIp) {
        return cloudflareIp.trim()
    }

    const forwardedFor = request.headers.get('x-forwarded-for')
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim()
    }

    return 'unknown'
}

const enforceUploadRateLimit = async (
    request,
    store,
    limit = UPLOAD_RATE_LIMIT
) => {
    if (!store || !limit) {
        return
    }

    const windowId = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS)
    const key = `torrent-upload:${getClientIp(request)}:${windowId}`
    const current = Number(await store.get(key)) || 0

    if (current >= limit) {
        throw new RateLimitExceededError()
    }

    await store.put(key, String(current + 1), {
        expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
    })
}

const handleTorrentUpload = async (
    request,
    {
        bucket,
        rateLimitStore,
        maxBytes = MAX_TORRENT_BYTES,
        uploadRateLimit = UPLOAD_RATE_LIMIT,
    } = {}
) => {
    try {
        await enforceUploadRateLimit(request, rateLimitStore, uploadRateLimit)

        const body = await readRequestBytes(request, maxBytes)
        const { infoHash } = await parseTorrentInfoHash(body)
        const key = torrentObjectKey(infoHash)

        await putObject(bucket, key, body, {
            httpMetadata: {
                contentType: 'application/x-bittorrent',
            },
            customMetadata: {
                infoHash,
            },
        })

        const url = new URL(`/torrent/${infoHash}.torrent`, request.url)

        return jsonResponse({
            id: infoHash,
            url: url.toString(),
        })
    } catch (error) {
        if (error instanceof RateLimitExceededError) {
            return jsonResponse({ error: 'Upload rate limit exceeded' }, 429)
        }

        if (error instanceof BodyTooLargeError) {
            return jsonResponse({ error: 'Torrent file is too large' }, 413)
        }

        if (
            error instanceof EmptyBodyError ||
            error instanceof TorrentParseError
        ) {
            return jsonResponse({ error: 'Invalid torrent file' }, 400)
        }

        return jsonResponse({ error: 'Torrent storage failed' }, 500)
    }
}

const isValidInfoHash = hash => /^[0-9a-fA-F]{40}$/.test(hash)

const handleTorrentDownload = async (hash, { bucket } = {}) => {
    if (!isValidInfoHash(hash)) {
        return textResponse('invalid torrent id', 400)
    }

    const normalizedHash = hash.toLowerCase()
    const object = await getObject(bucket, torrentObjectKey(normalizedHash))

    if (!object) {
        return textResponse('torrent not found', 404)
    }

    return new Response(object.body, {
        status: 200,
        headers: {
            'content-type': 'application/x-bittorrent',
            'content-disposition': `attachment; filename="${normalizedHash}.torrent"`,
            'cache-control': 'private, max-age=0, no-store',
        },
    })
}

module.exports = {
    MAX_TORRENT_BYTES,
    handleTorrentDownload,
    handleTorrentUpload,
    torrentObjectKey,
}
