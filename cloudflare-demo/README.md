# Cloudflare demo deployment

This package publishes the current AuDHDMAP Dockerfile through one Cloudflare Container and routes `audhdmap.com` to it. The root path serves the product website. `/demo` loads an isolated workspace into the current browser tab and provides server-generated map exports, including PDF.

Workspace changes are stored only in that tab's `sessionStorage`. The Cloudflare container does not initialize or retain a demo workspace. Closing the tab removes the browser state.

## First deployment

```sh
npm ci
npm run check
npm run deploy
```

`AUDHDMAP_PUBLIC_DEMO=1` is set by the container wrapper. In this mode, the client saves map edits in the current tab. PDF, SVG, Markdown, text, and CSV exports use a bounded no-store request that is rendered and discarded. Workspace, JSON, complete backup, restore, import, recovery-point, attachment, and permanent-delete routes return `403`.

## Promote a finished milestone

After the milestone commit, version tag, tests, and public multi-platform image are all verified:

```sh
npm ci
npm run check
npm run deploy
```

Verify the product site, open `/demo` without a password, confirm two tabs are isolated, download a PDF, and confirm `/api/workspace` plus a private-only route return `403` before treating the hosted demo as updated.
