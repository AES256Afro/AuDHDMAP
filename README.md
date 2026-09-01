# AuDHDMAP

AuDHDMAP is a private, self-hosted mind-mapping and note-taking workspace. Capture thoughts without imposing a hierarchy, connect them when the relationship becomes clear, write full Markdown notes, and project actionable branches into Board, Timeline, or Gantt views.

![Signal Garden branch focus](docs/mockups/02-signal-garden-focus.png)

## What works in 0.5.0

- Free pan-and-zoom canvas with draggable nodes, branches, two-way labeled references, editable group boundaries, grid snapping, and explicit tree or grid auto-layout.
- Strict Branch Focus that shows the selected branch, its ancestors, descendants, and explicit references while hiding unrelated clutter.
- Editable hierarchical Outline plus a separate References section for same-map and cross-map links.
- Board, Timeline, and read-only Gantt views over the same node data.
- Optional task status, priority, dates, progress, and milestones on any thought.
- Full Markdown note editing and sanitized preview.
- Categories, tags, semantic colors, actual file or web-link dropping, protected attachment retrieval, image thumbnails, and clean web-link cards.
- Boundary creation around a selected branch, including editable names, descriptions, colors, shapes, position, and dimensions.
- Keyboard creation, multi-line quick capture, outdent, recoverable deletion, focus, undo, redo, and visible shortcut help.
- Global `Cmd/Ctrl+K` navigation across maps, thoughts, tags, and tasks, with arrow-key selection and tab-local recent locations.
- Quiet Canvas, Signal Garden, Amber Operator, Workstation 84, and Paper Atlas themes.
- Brightness, saturation, branch font, node shape, line weight, reduced motion, and optional CRT effects.
- Queued autosave with visible retry, save-before-export/import/sign-out protection, revision conflicts, undo/redo, and atomic persistence.
- Complete ZIP backup and staged restore, including every referenced attachment and a SHA-256 integrity manifest.
- Up to 10 server-local recovery points with manual capture, automatic pre-change capture, and fail-closed safety capture before permanent deletion or restore.
- Current-map or focused-branch export to a two-part PDF, scalable SVG, editable Markdown, or plain-text outline. JSON remains available for data-only interchange.
- Visible trash with exact-record restore. Everyday views and share exports omit trash, while complete ZIP backups retain it and its attachments.
- Immediate keyboard naming after `N`, `Tab`, or `Enter`; batch capture with `Q`; `/` search; `Esc` navigation; and a visible shortcut guide.
- Owner authentication, bounded login throttling, secure cookies behind an explicitly trusted HTTPS proxy, hardened response headers, attachment signature checks, and custom-header CSRF protection.
- Measured supported-limit handling for balanced and deeply nested 10,000-node workspaces without recursive outline, export, focus, or auto-layout failure. Tree and grid layouts stay inside persisted coordinate bounds.
- Viewport-only canvas rendering and progressive 200-record pages for large Outline, Board, Timeline, Gantt, and reference views. Trash uses 100-record pages.
- A small boot and login bundle, with the full visual workspace loaded only after authentication.

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

All durable state is stored in the `audhdmap-data` volume at `/data` inside the container. Back up that volume for infrastructure-level recovery. The in-app **Export** panel can create a portable ZIP containing the workspace, all referenced attachment bytes, and integrity checks. It also shows server-local recovery points, which remain in `/data/snapshots` and are not embedded in downloaded ZIP files.

If exactly one trusted reverse proxy terminates HTTPS in front of AuDHDMAP, set `AUDHDMAP_TRUST_PROXY=1`. Leave it at `0` for direct access. Forwarded client and HTTPS headers are ignored by default so a direct client cannot spoof them.

See [Operations and recovery](docs/OPERATIONS.md) for backup drills, restore behavior, upgrades, limits, and troubleshooting. The security boundary is documented in [Security](docs/SECURITY.md).

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
docker build -t audhdmap:0.5.0 .
```

The health endpoint is available without authentication at `/api/health`. It reports only application version, storage readiness, revision, bounded object counts, and recovery-point health counts. It never returns workspace content, filenames, point identifiers, or error details.

## BoxPilot

The production image is designed for BoxPilot's generic application catalog:

- image: `ghcr.io/aes256afro/audhdmap:0.5.0`
- container port: `3010`
- persistent volume: `/data`
- required generated secrets: `AUDHDMAP_ADMIN_PASSWORD` and `AUDHDMAP_SESSION_SECRET`
- optional username: `AUDHDMAP_ADMIN_USERNAME`, default `owner`
- optional trusted proxy hop: `AUDHDMAP_TRUST_PROXY`, default `0`
- health: the image's built-in Docker health check against `/api/health`

BoxPilot can install, expose, back up, restore, update, and uninstall AuDHDMAP without app-specific server code.
