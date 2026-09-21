# Project decisions

This file records decisions that constrain the implementation. It does not record ideas that have not been accepted.

## 2026-09-21: AGPL-3.0-or-later

The public project uses AGPL-3.0-or-later. People may run, study, change, and redistribute it. Operators who modify the software and provide it over a network must offer the corresponding source under the same license.

## 2026-09-21: Build a focused product

We will build the application around its defined workflow instead of forking a broad task-management suite.

Reference projects:

- Tasks.org for deep subtasks, reminders, recurrence, filters, and offline behavior.
- Super Productivity for local persistence, focus tracking, recovery, and synchronization research.
- Vikunja for self-hosting, SQLite, task relations, reminders, and recurrence.
- Taskwarrior for compact task semantics, dependencies, recurrence templates, and filtering.

We may reuse compatible libraries after license review. We will not copy source from these applications into the project without recording its license and attribution requirements.

## 2026-09-21: Dependency-free public face page

The public landing page uses semantic HTML, CSS, and one small JavaScript module for the interactive project-tree demonstration. It has no framework, runtime dependency, external font request, analytics, or client-side tracking. Bun provides the local development server and test runner only.

The application itself will require JavaScript for IndexedDB, synchronization, service-worker behavior, and interactive task editing.

## 2026-09-21: Landing-page visual language

Design read: a public build journal for a serious daily-work tool, using an editorial and tactile visual language at ENERGY 3, RHYTHM 3, MOTION 2.

- Color: dark neutral section fields replace purple so the coral, blue, green, and yellow states carry meaning instead of decorating the page.
- Layout: each section uses a different composition because the narrative moves from personal context, to product behavior, to system architecture.
- Typography: the system sans stack keeps the page fast and makes the oversized editorial headlines feel direct rather than technical.
- Spacing: generous section gaps separate changes in subject; dense spacing is reserved for the task interface where information belongs together.
- Cards: hard-edged cards appear only for task records and system boundaries, where containment is meaningful.
- Motion: route signals, return milestones, tree branches, and sync packets remain visibly active because they explain continuity, hierarchy, and data flow. Pointer depth makes the hero preview feel operable. Reduced-motion users receive the complete static state.

## 2026-09-21: First backend uses Rust and SQLite

Go was proposed but is not mandatory. Rust was selected for this implementation: its toolchain was available locally, it can ship one compiled service, and Axum plus a bundled SQLite driver cover the required HTTP and persistence work. Resource use is measured after deployment. The backend must:

- compile to one deployable service;
- embed or serve the static client;
- use SQLite safely;
- schedule online reminders without idle polling;
- expose a compact synchronization API;
- remain readable and maintainable;
- meet the measured VPS memory budget.

One SQLite connection serializes changes. Revision checks reject conflicting edits without overwriting the device's pending work. This is a single-owner service with a random private token, not a multi-user account system.

## 2026-09-21: Deployment contract

The production site uses `todo.gharawi.sa`. Inspection found an existing Docker-hosted Caddy proxy. The first deployment reuses that network with one resource-limited container, no host port, and persistent SQLite data outside the container. The executable can also run directly without Docker.

Private infrastructure details, SSH configuration, credentials, TickTick data, and real environment files must never enter the public repository.
