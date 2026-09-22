# Personal synchronization v2

The landing page and PWA are public. `POST /api/sync` requires `Authorization: Bearer <private token>`. Use a cryptographically random token of at least 32 characters. Tokens are compared as SHA-256 digests in constant time. HTTPS terminates at Caddy; there is no cross-origin API configuration and no token in a URL. Requests are limited to 2 MiB and 500 changes.

Request: `{ "schema": 2, "cursor": 0, "changes": [], "collections": [] }`. Each task contains `id`, `title`, `notes`, `start` (optional local datetime string), `due` (the end or deadline), `priority` (0–3), `parent` (ID or null), `list_id`, `tags`, `pinned`, `done`, `completed_at` (an ISO timestamp or an empty string), `deleted`, and `revision`. A task with `start` remains active through `due`. Collections represent folders, lists, and tags. New records start at revision 0. Older records without `start` or `completed_at` remain valid and gain empty values when loaded.

Response: `{ "cursor": 1, "records": [...], "conflicts": [], "collections": [...], "collection_conflicts": [] }`. The server assigns one monotonically increasing revision across tasks and collections. It returns records newer than the supplied cursor. Matching retries are idempotent; stale edits are returned as conflicts. The device retains the pending local version until the owner explicitly chooses the local or server version. Invalid references or task cycles roll back the batch. Tombstones remain available to devices that were offline.

The browser serializes writes and sync operations and uses the Web Locks API to prevent two tabs from overwriting one snapshot. A single IndexedDB transaction saves tasks, collections, pending sets, conflict records, and cursor. A network error never clears pending work. Sync runs on a local change, an online event, launch with an unlocked session, or the Sync button. The outbox drains in batches of 500.

The sync control is gray while disconnected or checking, green only after a successful server round trip, and red for rejected credentials, an unreachable server, offline state, or unresolved changes. Every color is paired with an icon and text. Disconnecting removes the session token but leaves the local IndexedDB copy intact.

Recurring tasks use a deterministic occurrence ID derived from the series and next local date. Completing the same occurrence on two offline devices therefore converges on one next task instead of creating duplicates. Day, week, month, and year intervals are supported; month and year repeats retain the original calendar anchor. The completed occurrence remains in history. Subtasks remain attached to that occurrence and are not copied.

Known limits: single owner; no end-to-end encryption; token held for the current browser session; device storage can be removed by the browser or user; no push or scheduled notifications yet; dates retain their entered local wall time; pulling changes currently returns all records after the cursor without pagination. Export local backups before clearing storage. Server rollback behind a device cursor is rejected for manual recovery instead of silently discarding history.

Installation is not a separate backend instance. Each installed PWA has device-local browser storage and connects to the same authenticated API on its own origin.
