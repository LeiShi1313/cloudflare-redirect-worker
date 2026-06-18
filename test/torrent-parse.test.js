const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')

const {
    parseTorrentInfoHash,
    TorrentParseError,
} = require('../torrent-parse')

const encoder = new TextEncoder()

const bytes = value => encoder.encode(value)

const infoDictionary =
    'd4:name4:test12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae'
const torrentBody = `d8:announce14:http://tracker4:info${infoDictionary}e`

const sha1Hex = value =>
    createHash('sha1')
        .update(Buffer.from(value))
        .digest('hex')

describe('parseTorrentInfoHash', () => {
    it('returns the SHA-1 hash of the exact bencoded info dictionary', async () => {
        const result = await parseTorrentInfoHash(bytes(torrentBody))

        assert.equal(result.infoHash, sha1Hex(bytes(infoDictionary)))
        assert.equal(result.size, bytes(torrentBody).byteLength)
    })

    it('returns the same hash when non-info metadata changes', async () => {
        const first = await parseTorrentInfoHash(
            bytes(`d8:announce14:http://tracker4:info${infoDictionary}e`)
        )
        const second = await parseTorrentInfoHash(
            bytes(`d8:announce15:https://tracker4:info${infoDictionary}e`)
        )

        assert.equal(first.infoHash, second.infoHash)
    })

    it('rejects bencode without an info dictionary', async () => {
        await assert.rejects(
            () => parseTorrentInfoHash(bytes('d4:name4:teste')),
            TorrentParseError
        )
    })

    it('rejects torrents whose info value is not a dictionary', async () => {
        await assert.rejects(
            () => parseTorrentInfoHash(bytes('d4:info4:teste')),
            TorrentParseError
        )
    })

    it('rejects malformed bencode', async () => {
        await assert.rejects(
            () => parseTorrentInfoHash(bytes('d4:infod4:name4:testeejunk')),
            TorrentParseError
        )
    })
})
