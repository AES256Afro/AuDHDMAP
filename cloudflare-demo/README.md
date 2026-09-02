# Cloudflare demo deployment

This package publishes the current AuDHDMAP Dockerfile through one Cloudflare Container and routes `audhdmap.com` to it. The demo keeps the normal owner login and supports every server export, including PDF.

The container's local `/data` is demo state, not a durable production backup. A container replacement or rollout can reset it to the checked-in seed workspace. Never place the only copy of real notes in this deployment.

## First deployment

```sh
npm ci
npm run check
npm run deploy
npx wrangler secret put AUDHDMAP_DEMO_PASSWORD
npx wrangler secret put AUDHDMAP_SESSION_SECRET
```

Use a session secret with at least 32 random characters. Secrets stay in Cloudflare and are passed to the container at start.

## Promote a finished milestone

After the milestone commit, version tag, tests, and public multi-platform image are all verified:

```sh
npm ci
npm run check
npm run deploy
```

Verify `/api/health`, sign in, and download a PDF before treating the hosted demo as updated.
