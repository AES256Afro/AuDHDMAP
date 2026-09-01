# AuDHDMAP

AuDHDMAP is a private, self-hosted mind-mapping and note-taking workspace. Capture thoughts without imposing a hierarchy, connect them when the relationship becomes clear, write full Markdown notes, and project actionable branches into Board, Timeline, or Gantt views.

![Signal Garden branch focus](docs/mockups/02-signal-garden-focus.png)

## What works in 0.1.0

- Free pan-and-zoom canvas with draggable nodes, branches, labeled cross-references, group boundaries, grid snapping, and explicit tree or grid auto-layout.
- Editable hierarchical Outline plus a separate References section for non-tree links.
- Board, Timeline, and read-only Gantt views over the same node data.
- Optional task status, priority, dates, progress, and milestones on any thought.
- Full Markdown note editing and sanitized preview.
- Categories, tags, semantic colors, attachment upload and protected retrieval.
- Branch focus with a visible exit and dimmed context.
- Keyboard creation, deletion, focus, undo, and visible shortcut help.
- Quiet Canvas, Signal Garden, Amber Operator, Workstation 84, and Paper Atlas themes.
- Brightness, saturation, branch font, node shape, line weight, reduced motion, and optional CRT effects.
- Queued autosave with revision-conflict protection, JSON export, validated import, and atomic persistence.
- Owner authentication, login throttling, secure cookies, response hardening, and custom-header CSRF protection.

The detailed interaction contract and post-0.1 scope are in [docs/PRODUCT-DIRECTION.md](docs/PRODUCT-DIRECTION.md).

## Run with Docker Compose

```sh
cp .env.example .env
```

Replace both placeholder secrets in `.env`, then run:

```sh
docker compose up -d --build
```

Open `http://localhost:3010` and sign in with the username and password from `.env`.

All durable state is stored in the `audhdmap-data` volume at `/data` inside the container. Back up that one volume to capture the workspace database and attachments together.

## Run for development

Requires Node.js 24 or newer.

```sh
npm install
npm run dev
```

The development login is `owner` with password `boxpilot`. Development data is written to `.dev-data`, which is ignored by Git.

## Verification

```sh
npm run check
npm audit
docker build -t audhdmap:0.1.0 .
```

The health endpoint is available without authentication at `/api/health`. It reports only application version, storage readiness, revision, and bounded object counts. It never returns workspace content.

## BoxPilot

The production image is designed for BoxPilot's generic application catalog:

- image: `ghcr.io/aes256afro/audhdmap:0.1.0`
- container port: `3010`
- persistent volume: `/data`
- required generated secrets: `AUDHDMAP_ADMIN_PASSWORD` and `AUDHDMAP_SESSION_SECRET`
- optional username: `AUDHDMAP_ADMIN_USERNAME`, default `owner`
- health: the image's built-in Docker health check against `/api/health`

BoxPilot can install, expose, back up, restore, update, and uninstall AuDHDMAP without app-specific server code.
