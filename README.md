# todo.gharawi.sa

An open-source, offline-first task system for daily and weekly planning, deep task trees, habits, and focus.

The current personal-use version includes an installable offline task app and a Rust/SQLite synchronization service. It has responsive phone and desktop layouts, collapsible colored lists and tags, priorities, task trees, notes, deadlines and multi-day durations, recurrence, reminders, completion history, and explicit synchronization status. Browser reminders currently fire while Todo is open; closed-app delivery still needs Web Push. Habits and a production focus tracker are planned. The landing-page focus timer is a demonstration.

## Why it exists

Existing task applications can store dates, priorities, reminders, notes, and subtasks. This project keeps those essentials while addressing two specific problems:

- Returning after a long interruption should not mean fighting an unexplained backlog.
- Professional deadlines can contain tens or hundreds of nested steps that flat lists hide.

The first version will combine daily and weekly planning, arbitrary-depth task trees, habits, focus sessions, reminders, and offline phone use.

## Product constraints

- The installed PWA must remain useful without a network connection.
- Core task operations happen against local storage first.
- Synchronization transfers changed records instead of whole projects.
- The self-hosted service runs as one small process with one SQLite database.
- Containers remain optional.
- The interface stays fast on modest phones and the server stays suitable for a small VPS.

The backend uses Rust, Axum, and SQLite in one process. The frontend uses browser APIs without a framework.

## Landing page

The current repository contains the public face page. Preview it locally with Bun:

```sh
bun run dev
```

Then open the URL printed by Bun.

The page and application use semantic HTML, CSS, and dependency-free JavaScript modules. There is no frontend framework, analytics, or external font request.

For the complete app and backend:

```sh
export TODO_SYNC_TOKEN="$(openssl rand -hex 32)"
cargo run
```

Open `http://localhost:8080`. The landing page has an install button, and `/app/` opens the task app. Inside the app, connect private sync using the token you generated. The token is held in session storage, never in URLs or cached API responses. Tasks remain in IndexedDB after locking sync. Use a trusted browser profile and device lock for local privacy.

The original Bun command previews the landing page only. Rust serves the complete PWA and API from the same origin.

```sh
cargo test
cargo build --release --locked
bun tests/smoke.mjs
```

The smoke check requires Bun and `google-chrome-stable`; it uses a temporary database and browser profile. It covers the versioned PWA shell, phone and desktop layouts, collections, recurrence, reminders, offline reload, and synchronization. See [deployment](docs/deployment.md) and [sync protocol](docs/sync.md).

Run the interaction check with:

```sh
bun test
```

## Documentation

Architecture, deployment, data-model, and synchronization documentation will be added with the corresponding implementation. Decisions that already constrain the project live in [`docs/decisions.md`](docs/decisions.md).

## License

This project is licensed under the GNU Affero General Public License v3.0 or later.
