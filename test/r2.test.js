const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const {
    deleteObject,
    getObject,
    headObject,
    putObject,
} = require('../r2')

describe('r2 adapter', () => {
    it('puts objects through the bucket binding', async () => {
        const calls = []
        const bucket = {
            put: async (key, body, options) => {
                calls.push({ key, body, options })
                return { key }
            },
        }

        const result = await putObject(bucket, 'path/file.torrent', 'body', {
            customMetadata: { type: 'torrent' },
        })

        assert.deepEqual(result, { key: 'path/file.torrent' })
        assert.deepEqual(calls, [
            {
                key: 'path/file.torrent',
                body: 'body',
                options: { customMetadata: { type: 'torrent' } },
            },
        ])
    })

    it('normalizes missing get responses to null', async () => {
        const bucket = {
            get: async () => undefined,
        }

        assert.equal(await getObject(bucket, 'missing'), null)
    })

    it('normalizes missing head responses to null', async () => {
        const bucket = {
            head: async () => undefined,
        }

        assert.equal(await headObject(bucket, 'missing'), null)
    })

    it('deletes objects through the bucket binding', async () => {
        const calls = []
        const bucket = {
            delete: async key => {
                calls.push(key)
            },
        }

        await deleteObject(bucket, 'path/file.torrent')

        assert.deepEqual(calls, ['path/file.torrent'])
    })
})
