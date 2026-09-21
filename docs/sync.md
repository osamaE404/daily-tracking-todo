# Personal synchronization v1

The landing page and PWA are public. `POST /api/sync` requires `Authorization: Bearer <private token>`. Use a cryptographically random token of at least 32 characters. Tokens are compared as SHA-256 digests in constant time. HTTPS terminates at Caddy; there is no cross-origin API configuration and no token in a URL. Requests are limited to 2 MiB and 500 changes.

Request: `{ "cursor": 0, "changes": [] }`. Each task contains `id`, `title`, `notes`, `due` (local datetime string), `priority` (0–3), `parent` (ID or null), `done`, `deleted`, and `revision`. New records start at revision 0.

Response: `{ "cursor": 1, "records": [...], "conflicts": [...] }`. The server assigns a monotonically increasing revision to accepted changes. It returns records newer than the supplied cursor. Matching retries are idempotent; stale edits are returned as conflicts. The device retains the pending local version until the owner explicitly chooses the local or server version. An invalid parent or cycle rolls back the batch. Tombstones remain available to devices that were offline.

The browser serializes writes and sync operations. A single IndexedDB transaction saves tasks, the pending set, conflict records, and cursor. A network error never clears pending work. Sync runs on a local change, an online event, launch with an unlocked session, or the Sync now button. A large outbox sends up to 500 entries per request; repeat Sync now for additional batches.

Known limits: single owner; no end-to-end encryption; token held for the current browser session; device storage can be removed by the browser or user; no push or scheduled notifications yet; dates retain their entered local wall time; pulling changes currently returns all records after the cursor without pagination. Export local backups before clearing storage. Deletions are supported in the protocol; the initial UI does not expose deletion. Server rollback behind a device cursor is rejected for manual recovery instead of silently discarding history.

Installation is not a separate backend instance. Each installed PWA has device-local browser storage and connects to the same authenticated API on its own origin.
