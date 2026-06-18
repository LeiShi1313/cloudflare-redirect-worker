const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const {
    MAX_TORRENT_BYTES,
    handleTorrentDownload,
    handleTorrentUpload,
    torrentObjectKey,
} = require('../torrent')

const encoder = new TextEncoder()

const bytes = value => encoder.encode(value)

const infoDictionary =
    'd4:name4:test12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae'
const torrentBody = `d8:announce14:http://tracker4:info${infoDictionary}e`
const infoHash = createHash('sha1')
    .update(Buffer.from(bytes(infoDictionary)))
    .digest('hex')

const createBucket = () => {
    const objects = new Map()
    const puts = []

    return {
        objects,
        puts,
        async put(key, body, options) {
            puts.push({ key, body, options })
            objects.set(key, { body, options })
            return { key }
        },
        async get(key) {
            return objects.get(key) || null
        },
    }
}

const createRateLimitStore = value => ({
    puts: [],
    async get() {
        return value
    },
    async put(key, storedValue, options) {
        this.puts.push({ key, value: storedValue, options })
    },
})

const uploadRequest = (body, headers = {}) =>
    new Request('https://short.example/torrent', {
        method: 'POST',
        headers,
        body,
    })

describe('torrent handlers', () => {
    it('stores valid torrent bytes in R2 and returns the info-hash URL', async () => {
        const bucket = createBucket()
        const rateLimitStore = createRateLimitStore('0')

        const response = await handleTorrentUpload(uploadRequest(bytes(torrentBody)), {
            bucket,
            rateLimitStore,
        })
        const payload = await response.json()

        assert.equal(response.status, 200)
        assert.equal(payload.id, infoHash)
        assert.equal(payload.url, `https://short.example/torrent/${infoHash}.torrent`)
        assert.equal(bucket.puts.length, 1)
        assert.equal(bucket.puts[0].key, torrentObjectKey(infoHash))
        assert.deepEqual(bucket.puts[0].body, bytes(torrentBody))
    })

    it('returns the same ID for duplicate uploads and refreshes storage', async () => {
        const bucket = createBucket()

        const first = await handleTorrentUpload(uploadRequest(bytes(torrentBody)), {
            bucket,
        })
        const second = await handleTorrentUpload(uploadRequest(bytes(torrentBody)), {
            bucket,
        })

        assert.equal((await first.json()).id, infoHash)
        assert.equal((await second.json()).id, infoHash)
        assert.equal(bucket.puts.length, 2)
    })

    it('rejects malformed torrent uploads', async () => {
        const bucket = createBucket()

        const response = await handleTorrentUpload(uploadRequest(bytes('not torrent')), {
            bucket,
        })
        const payload = await response.json()

        assert.equal(response.status, 400)
        assert.equal(payload.error, 'Invalid torrent file')
        assert.equal(bucket.puts.length, 0)
    })

    it('rejects uploads over the configured size limit', async () => {
        const bucket = createBucket()

        const response = await handleTorrentUpload(
            uploadRequest(bytes(torrentBody), {
                'content-length': String(MAX_TORRENT_BYTES + 1),
            }),
            { bucket }
        )

        assert.equal(response.status, 413)
        assert.equal(bucket.puts.length, 0)
    })

    it('rejects uploads after the loose rate limit is exceeded', async () => {
        const bucket = createBucket()
        const rateLimitStore = createRateLimitStore('20')

        const response = await handleTorrentUpload(
            uploadRequest(bytes(torrentBody), {
                'cf-connecting-ip': '203.0.113.2',
            }),
            { bucket, rateLimitStore }
        )

        assert.equal(response.status, 429)
        assert.equal(bucket.puts.length, 0)
    })

    it('serves stored torrent bytes with download headers', async () => {
        const bucket = createBucket()
        const body = bytes(torrentBody)
        await bucket.put(torrentObjectKey(infoHash), body, {})

        const response = await handleTorrentDownload(infoHash, { bucket })

        assert.equal(response.status, 200)
        assert.equal(response.headers.get('content-type'), 'application/x-bittorrent')
        assert.equal(
            response.headers.get('content-disposition'),
            `attachment; filename="${infoHash}.torrent"`
        )
        assert.equal(response.headers.get('cache-control'), 'private, max-age=0, no-store')
        assert.deepEqual(new Uint8Array(await response.arrayBuffer()), body)
    })

    it('rejects invalid download hashes', async () => {
        const response = await handleTorrentDownload('not-a-hash', {
            bucket: createBucket(),
        })

        assert.equal(response.status, 400)
    })

    it('returns 404 for missing torrent objects', async () => {
        const response = await handleTorrentDownload(infoHash, {
            bucket: createBucket(),
        })

        assert.equal(response.status, 404)
    })
})
