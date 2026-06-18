class TorrentParseError extends Error {
    constructor(message) {
        super(message)
        this.name = 'TorrentParseError'
    }
}

const BYTE_0 = '0'.charCodeAt(0)
const BYTE_9 = '9'.charCodeAt(0)
const BYTE_COLON = ':'.charCodeAt(0)
const BYTE_D = 'd'.charCodeAt(0)
const BYTE_E = 'e'.charCodeAt(0)
const BYTE_I = 'i'.charCodeAt(0)
const BYTE_L = 'l'.charCodeAt(0)
const BYTE_MINUS = '-'.charCodeAt(0)
const MAX_DEPTH = 100

const INFO_KEY = [105, 110, 102, 111]

const isDigit = byte => byte >= BYTE_0 && byte <= BYTE_9

const toBytes = value => {
    if (value instanceof Uint8Array) {
        return value
    }

    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value)
    }

    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    }

    throw new TorrentParseError('torrent body must be bytes')
}

const keyEquals = (bytes, start, end, key) => {
    if (end - start !== key.length) {
        return false
    }

    for (let i = 0; i < key.length; i++) {
        if (bytes[start + i] !== key[i]) {
            return false
        }
    }

    return true
}

const parseInteger = (bytes, offset) => {
    let end = offset + 1
    while (end < bytes.length && bytes[end] !== BYTE_E) {
        end++
    }

    if (end >= bytes.length) {
        throw new TorrentParseError('unterminated integer')
    }

    const start = offset + 1
    const length = end - start
    if (length === 0) {
        throw new TorrentParseError('empty integer')
    }

    const negative = bytes[start] === BYTE_MINUS
    const digitStart = negative ? start + 1 : start
    if (digitStart >= end) {
        throw new TorrentParseError('invalid integer')
    }

    if (
        (bytes[digitStart] === BYTE_0 && end - digitStart > 1) ||
        (negative && bytes[digitStart] === BYTE_0)
    ) {
        throw new TorrentParseError('integer has invalid leading zero')
    }

    for (let i = digitStart; i < end; i++) {
        if (!isDigit(bytes[i])) {
            throw new TorrentParseError('integer contains non-digit bytes')
        }
    }

    return end + 1
}

const parseByteString = (bytes, offset) => {
    if (!isDigit(bytes[offset])) {
        throw new TorrentParseError('expected byte string')
    }

    let cursor = offset
    let length = 0
    while (cursor < bytes.length && isDigit(bytes[cursor])) {
        if (cursor > offset && bytes[offset] === BYTE_0) {
            throw new TorrentParseError('byte string length has leading zero')
        }

        length = length * 10 + (bytes[cursor] - BYTE_0)
        if (!Number.isSafeInteger(length)) {
            throw new TorrentParseError('byte string length is too large')
        }
        cursor++
    }

    if (cursor === offset || bytes[cursor] !== BYTE_COLON) {
        throw new TorrentParseError('invalid byte string length')
    }

    const start = cursor + 1
    const end = start + length
    if (end > bytes.length) {
        throw new TorrentParseError('byte string exceeds body length')
    }

    return { start, end, next: end }
}

const parseList = (bytes, offset, depth) => {
    if (depth > MAX_DEPTH) {
        throw new TorrentParseError('bencode nesting is too deep')
    }

    let cursor = offset + 1
    while (cursor < bytes.length && bytes[cursor] !== BYTE_E) {
        cursor = parseValue(bytes, cursor, depth + 1)
    }

    if (cursor >= bytes.length) {
        throw new TorrentParseError('unterminated list')
    }

    return cursor + 1
}

const parseDictionary = (bytes, offset, depth) => {
    if (depth > MAX_DEPTH) {
        throw new TorrentParseError('bencode nesting is too deep')
    }

    let cursor = offset + 1
    while (cursor < bytes.length && bytes[cursor] !== BYTE_E) {
        const key = parseByteString(bytes, cursor)
        cursor = parseValue(bytes, key.next, depth + 1)
    }

    if (cursor >= bytes.length) {
        throw new TorrentParseError('unterminated dictionary')
    }

    return cursor + 1
}

function parseValue(bytes, offset, depth) {
    if (offset >= bytes.length) {
        throw new TorrentParseError('unexpected end of bencode')
    }

    if (bytes[offset] === BYTE_I) {
        return parseInteger(bytes, offset)
    }

    if (bytes[offset] === BYTE_L) {
        return parseList(bytes, offset, depth)
    }

    if (bytes[offset] === BYTE_D) {
        return parseDictionary(bytes, offset, depth)
    }

    if (isDigit(bytes[offset])) {
        return parseByteString(bytes, offset).next
    }

    throw new TorrentParseError('invalid bencode value')
}

const findInfoRange = bytes => {
    if (!bytes.length || bytes[0] !== BYTE_D) {
        throw new TorrentParseError('torrent must be a top-level dictionary')
    }

    let infoRange = null
    let cursor = 1
    while (cursor < bytes.length && bytes[cursor] !== BYTE_E) {
        const key = parseByteString(bytes, cursor)
        const valueStart = key.next
        const valueEnd = parseValue(bytes, valueStart, 1)

        if (keyEquals(bytes, key.start, key.end, INFO_KEY)) {
            if (infoRange) {
                throw new TorrentParseError('duplicate info dictionary')
            }

            if (bytes[valueStart] !== BYTE_D) {
                throw new TorrentParseError('info must be a dictionary')
            }

            infoRange = { start: valueStart, end: valueEnd }
        }

        cursor = valueEnd
    }

    if (cursor >= bytes.length) {
        throw new TorrentParseError('unterminated top-level dictionary')
    }

    if (cursor + 1 !== bytes.length) {
        throw new TorrentParseError('trailing bytes after torrent')
    }

    if (!infoRange) {
        throw new TorrentParseError('missing info dictionary')
    }

    return infoRange
}

const toHex = buffer =>
    Array.from(new Uint8Array(buffer))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')

const parseTorrentInfoHash = async body => {
    const bytes = toBytes(body)
    const infoRange = findInfoRange(bytes)
    const infoBytes = bytes.subarray(infoRange.start, infoRange.end)
    const digest = await crypto.subtle.digest('SHA-1', infoBytes)

    return {
        infoHash: toHex(digest),
        size: bytes.byteLength,
    }
}

module.exports = {
    TorrentParseError,
    parseTorrentInfoHash,
}
