const requireBucket = bucket => {
    if (!bucket) {
        throw new Error('R2 bucket binding is not configured')
    }
}

const putObject = async (bucket, key, body, options = {}) => {
    requireBucket(bucket)
    return bucket.put(key, body, options)
}

const getObject = async (bucket, key, options = {}) => {
    requireBucket(bucket)
    return (await bucket.get(key, options)) || null
}

const headObject = async (bucket, key) => {
    requireBucket(bucket)
    return (await bucket.head(key)) || null
}

const deleteObject = async (bucket, key) => {
    requireBucket(bucket)
    return bucket.delete(key)
}

module.exports = {
    deleteObject,
    getObject,
    headObject,
    putObject,
}
