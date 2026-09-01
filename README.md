# AuDHDMAP

AuDHDMAP is a private, self-hosted mind-mapping and note-taking workspace. Capture thoughts without imposing a hierarchy, connect them when the relationship becomes clear, write full Markdown notes, and project actionable branches into Board, Timeline, or Gantt views.

![Signal Garden branch focus](docs/mockups/02-signal-garden-focus.png)

## What works in 0.2.0

- Free pan-and-zoom canvas with draggable nodes, branches, two-way labeled references, editable group boundaries, grid snapping, and explicit tree or grid auto-layout.
- Strict Branch Focus that shows the selected branch, its ancestors, descendants, and explicit references while hiding unrelated clutter.
- Editable hierarchical Outline plus a separate References section for same-map and cross-map links.
- Board, Timeline, and read-only Gantt views over the same node data.
- Optional task status, priority, dates, progress, and milestones on any thought.
- Full Markdown note editing and sanitized preview.
- Categories, tags, semantic colors, actual file or web-link dropping, protected attachment retrieval, image thumbnails, and clean web-link cards.
- Boundary creation around a selected branch, including editable names, descriptions, colors, shapes, position, and dimensions.
- Keyboard creation, outdent, deletion, focus, undo, redo, and visible shortcut help.
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
docker build -t audhdmap:0.2.0 .
```

The health endpoint is available without authentication at `/api/health`. It reports only application version, storage readiness, revision, and bounded object counts. It never returns workspace content.

## BoxPilot

The production image is designed for BoxPilot's generic application catalog:

- image: `ghcr.io/aes256afro/audhdmap:0.2.0`
- container port: `3010`
- persistent volume: `/data`
- required generated secrets: `AUDHDMAP_ADMIN_PASSWORD` and `AUDHDMAP_SESSION_SECRET`
- optional username: `AUDHDMAP_ADMIN_USERNAME`, default `owner`
- health: the image's built-in Docker health check against `/api/health`

BoxPilot can install, expose, back up, restore, update, and uninstall AuDHDMAP without app-specific server code.
