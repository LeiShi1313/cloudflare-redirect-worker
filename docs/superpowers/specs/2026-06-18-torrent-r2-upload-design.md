# Torrent R2 Upload Route Design

## Status

Approved design pending user review of this written spec.

## Goal

Add a public temporary torrent hosting feature to the existing Cloudflare Worker. Users can upload raw `.torrent` bytes, receive a stable info-hash-based URL, and let browser extensions fetch that URL to fill tracker upload forms. Uploaded torrents expire after roughly one month. No delete or edit route is supported.

## Non-Goals

- No user accounts or authentication.
- No delete, edit, listing, or metadata API.
- No multipart upload support in the first version.
- No validation of trackers, piece hashes, legality, or downloadability of torrent contents.
- No changes to `routes.js`; it remains the static redirect map.

## Route Contract

### `POST /torrent`

Accepts the torrent file as the raw request body. `Content-Type: application/x-bittorrent` is preferred but not required or trusted.

Behavior:

1. Reject empty bodies.
2. Reject uploads over 100 MB.
3. Parse the body as bencode.
4. Require a top-level dictionary containing an `info` dictionary.
5. Compute the torrent v1 info hash by SHA-1 hashing the exact bencoded `info` dictionary bytes.
6. Store the original uploaded torrent bytes in R2 as `torrents/<infoHash>.torrent`.
7. Return duplicate uploads with the same ID and URL. Re-uploading the same torrent may overwrite the R2 object to refresh its lifecycle age.

Example response:

```json
{
    "id": "<infoHash>",
    "url": "https://example.com/torrent/<infoHash>.torrent"
}
```

### `GET /torrent/<infoHash>.torrent`

Serves the stored torrent bytes from R2. The extensionless path is intentionally unsupported.

Response headers:

- `Content-Type: application/x-bittorrent`
- `Content-Disposition: attachment; filename="<infoHash>.torrent"`
- `Cache-Control: private, max-age=0, no-store`

## Storage Design

Use Cloudflare R2 instead of KV. KV has a 25 MiB value limit, which does not fit the 100 MB upload target. R2 receives a new bucket binding, for example `TORRENTS`, and the bucket should have a lifecycle rule deleting objects under `torrents/` after 30 days.

The existing `DFT` KV namespace can be reused for best-effort upload rate counters.

## Module Boundaries

- `index.js`: route registration only. It wires `POST /torrent` and `GET /torrent/<hash>.torrent` to torrent handlers.
- `routes.js`: static redirects only. Do not add torrent behavior here.
- `r2.js`: general-purpose R2 compatibility layer. Wraps object `put`, `get`, and optional `head` behavior, normalizing not-found handling.
- `torrent.js`: feature module for upload/download handlers, response JSON, status codes, size limits, rate limiting, and download headers.
- `torrent-parse.js`: pure bencode/torrent parser and info-hash computation. No route code and no R2 calls.

The parser should keep the bencode byte-range logic DRY and hidden behind a small API. The upload implementation should avoid a large route handler even if stream handling requires teeing or controlled buffering.

## Error Handling

`POST /torrent`:

- `400`: empty body, malformed bencode, or bencoded data that is not a torrent.
- `413`: body exceeds 100 MB.
- `429`: upload rate limit exceeded.
- `500`: unexpected R2 or Worker failure.

`GET /torrent/<infoHash>.torrent`:

- `400`: invalid hash format.
- `404`: missing or expired R2 object.
- `200`: torrent bytes found.

## Rate Limiting

Use a loose public upload limit by client IP, stored in KV with an hourly TTL. A reasonable initial default is 20 uploads per hour per IP. Downloads are not rate-limited in the first version.

Rate limiting is best-effort only; it is intended to reduce accidental or basic abuse, not provide strong public API protection.

## Extension Compatibility

The download route is designed for browser extensions and userscripts that need a fetchable torrent URL. `auto_feed_js` can use a `torrent_url` field directly. `easy-upload` needs its small planned `torrentUrl` support patch before using the same URL style. Serving with `Content-Disposition: attachment` is still compatible with programmatic fetches and gives a usable manual fallback in a browser.

## Testing Strategy

Add focused tests around the new modules:

- `torrent-parse.js`: valid torrent, malformed bencode, missing `info`, and stable info hash.
- `torrent.js`: upload status codes, duplicate ID behavior, download headers, missing-object response, and rate-limit response.
- `r2.js`: mocked object get/put not-found normalization.

Manual verification:

```bash
curl --data-binary @file.torrent https://example.com/torrent
curl -OJ https://example.com/torrent/<infoHash>.torrent
```

## Incremental Implementation Plan

Implement in small verified slices:

1. Add `torrent-parse.js` with parser/hash tests.
2. Add `r2.js` with mocked storage tests.
3. Add `torrent.js` upload/download handlers with mocked parser and R2 tests.
4. Wire routes in `index.js` and update Wrangler R2 binding documentation/config.
5. Run the available test/build checks and perform a manual `curl` upload/download check where credentials allow.
