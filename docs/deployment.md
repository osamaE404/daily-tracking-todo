# Deployment

The binary embeds an explicit allowlist of public assets. Source files, environment files, and databases are never served. SQLite runs in WAL mode with full synchronous commits and a 2 MiB page cache.

Build on Linux x86-64 with glibc 2.39 or compatible:

```sh
cargo test
cargo build --release --locked
```

Copy `target/release/gharawi-todo`, `deploy/Dockerfile`, and `deploy/compose.yaml` to `/opt/gharawi-todo` on the server. Create a private `.env` there containing `TODO_SYNC_TOKEN=<random token>` and `TODO_PROXY_NETWORK=<existing proxy network>`; never use the example token. Create `data/` owned by UID/GID 65532. Run `docker compose up -d --build`.

The included compose file uses the existing external Caddy network, applies a 96 MiB memory ceiling and half a CPU ceiling, drops capabilities, makes the container root filesystem read-only, and publishes no ports. These are limits, not measured consumption. Change the network name if using a different proxy.

Place `deploy/todo.caddy` in the existing proxy's imported configuration directory. Validate the Caddy configuration before reloading. Caddy obtains and renews HTTPS certificates for `todo.gharawi.sa`. Do not restart unrelated services.

To retrieve the private token on the authorized VPS, inspect `/opt/gharawi-todo/.env` over SSH. Enter its value in the app's Connect private sync dialog. Anyone with the token can read and change the owner's synchronized tasks; rotate it by generating a new `.env` token and recreating only the Todo container. Installed devices then reconnect with the new token.

Back up SQLite using its online backup API, or stop only Todo briefly and copy the entire `data/` directory. Copying only a live `todo.db` while ignoring its WAL is unsafe. Keep backup copies outside the VPS too. For rollback, preserve the previous binary/image and database together; never restore an older database over newer edits without exporting device data first.

`deploy/backup.py` uses SQLite's online backup API and verifies integrity, retaining seven daily copies in `/opt/gharawi-todo/backups`. Install the supplied cron file in `/etc/cron.d/gharawi-todo-backup` with mode 0644 and the script in `/opt/gharawi-todo`. These copies protect against accidental changes, not loss of the VPS; off-server backups remain to be configured.

Include `deploy/.dockerignore` in the build directory so credentials and database files never enter the Docker build context.

`deploy/import_sync.py` accepts a base64-encoded schema-v2 sync batch in `IMPORT_B64` and reads the private token on the server, keeping credentials out of command history. Set `IMPORT_UPDATE_EXISTING=1` only for a deliberate migration that should update matching record IDs; normal imports leave it unset. Back up SQLite before any import.

PWA updates: increment the cache version in `sw.js` and the matching `?v=` shell URLs when changing app assets. Version every imported JavaScript module too. This prevents an older worker from pairing new HTML with stale CSS or modules while the replacement worker waits for old windows to close. API responses and private task data are never put in the service-worker cache.

Browser installation varies: Android/Chromium may offer a native prompt; iPhone uses Safari's Share → Add to Home Screen. The website supplies instructions when a browser does not expose a prompt. HTTPS, a manifest, icons, and an offline app shell are provided; final installation remains a user action on the phone.
