# Cloudflare demo deployment

This package publishes the current AuDHDMAP Dockerfile through one Cloudflare Container and routes `audhdmap.com` to it. The root path serves the product website and `/demo` opens a passwordless shared sandbox with server-generated map exports, including PDF.

The container's local `/data` is demo state, not a durable production backup. A container replacement or rollout can reset it to the checked-in seed workspace. Never place the only copy of real notes in this deployment.

## First deployment

```sh
npm ci
npm run check
npm run deploy
npx wrangler secret put AUDHDMAP_SESSION_SECRET
```

Use a session secret with at least 32 random characters. The public mode does not issue login sessions, but the application keeps the secret validation as a fail-closed startup invariant. The secret stays in Cloudflare and is passed to the container at start.

`AUDHDMAP_PUBLIC_DEMO=1` is set by the container wrapper. In this mode, map editing and map-level PDF, SVG, Markdown, text, CSV, and JSON exports are anonymous. Complete backup, restore, import, recovery-point, attachment, and permanent-delete routes return `403`.

## Promote a finished milestone

After the milestone commit, version tag, tests, and public multi-platform image are all verified:

```sh
npm ci
npm run check
npm run deploy
```

Verify the product site, open `/demo` without a password, download a PDF, and confirm a private-only route returns `403` before treating the hosted demo as updated.
