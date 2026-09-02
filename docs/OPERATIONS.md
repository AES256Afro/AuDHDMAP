# AuDHDMAP operations and recovery

AuDHDMAP is a single-owner, single-container application. Its complete durable state lives under `/data`. The application does not require a database, cloud account, or third-party synchronization service.

## First start

Create `.env` from `.env.example` and replace both placeholder secrets. The owner password must contain at least 8 characters. The session secret must contain at least 32 characters and should be random.

One way to generate a session secret is:

```sh
openssl rand -base64 48
```

Start the application:

```sh
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:3010/api/health
```

The health response intentionally contains only the version, storage state, revision, bounded active-map, active-thought, trash, recovery-point, and recovery-problem counts.

## Reverse proxies and HTTPS

Leave `AUDHDMAP_TRUST_PROXY=0` when a browser connects directly to the container port.

Set `AUDHDMAP_TRUST_PROXY=1` only when exactly one trusted reverse proxy is between the browser and AuDHDMAP. In that topology, the application uses that proxy's forwarded client address and HTTPS state for throttling, Secure cookies, and HSTS. Forwarded headers are ignored in the default direct-access configuration.

Do not publish the container port separately when a reverse proxy is the intended public entry point. Apply authentication and network policy at the proxy or BoxPilot boundary as an additional layer, not as a replacement for AuDHDMAP's owner login.

## Portable backup

1. Sign in and wait for the header to show **Saved**.
2. Choose **Export**.
3. Download **Complete ZIP backup**.
4. Store the ZIP somewhere separate from the server.

The ZIP includes:

- `manifest.json`, with application and schema versions, workspace revision, attachment metadata, and SHA-256 checksums;
- `workspace.json`, with maps, thoughts, notes, tasks, references, groups, categories, and settings;
- `attachments/<id>` for every attachment referenced by the workspace.

ZIP creation fails rather than producing a partial backup when a referenced attachment is missing or its size does not match the saved metadata.

Complete ZIP backups include trashed thoughts and their attachments. PDF, SVG, Markdown, plain text, project CSV, and data-only JSON exports omit trash. Use the ZIP when the goal is recovery; use the other formats when the goal is sharing or interchange.

## Project CSV and JSON handoff

Project CSV is scoped to the current map or focused branch. It includes every visible thought, not just tasks, so parent/child structure remains reconstructable. Stable IDs, hierarchy path and depth, task fields, tags, plain-text notes, labeled reference direction, web links, and attachment metadata each have explicit columns. Values are consistently quoted, formula-leading cells are prefixed for spreadsheet safety, and rows use portable CRLF endings.

Data-only JSON is useful for moving a workspace structure back into AuDHDMAP. It does not contain attachment bytes. After selecting a JSON file, AuDHDMAP performs a non-mutating server preview that:

- validates and normalizes the supported workspace schema within the 8 MiB request ceiling;
- compares stable IDs and reports records that will be added, replaced, removed, or retained;
- verifies that every referenced attachment is already a regular local file with the declared byte size;
- binds a SHA-256 confirmation value to the exact candidate and current revision.

Only the explicit **Replace workspace with this JSON** action can commit a ready preview. The server rechecks the payload, confirmation value, revision, schema, relationships, and attachment inventory, then requires a current server recovery point before the atomic workspace write. After that write commits, attachment files referenced by the old workspace but absent from the import are removed from the current attachment directory. The required recovery point can still retain those files according to recovery retention. A rejected, changed, stale, or unpreviewed candidate changes nothing. Use a complete ZIP, not JSON, when moving attachment bytes to another server.

## Server recovery points

AuDHDMAP keeps up to 10 valid recovery points under `/data/snapshots`. A point contains a private workspace document, a versioned manifest, and every referenced attachment. On filesystems that support hard links, unchanged immutable attachment bytes share storage with the current workspace. AuDHDMAP falls back to a private copy when linking is unavailable.

Recovery capture follows these rules:

- The first persisted edit captures the preceding revision.
- Later ordinary edits capture the preceding revision at most once every five minutes.
- **Save current point** in the Export and recovery panel captures the current revision immediately. Repeating it without another saved change reuses the same point.
- Permanent thought deletion, attachment deletion, complete-ZIP restore, and recovery-point restore require a current recovery point before changing data.
- A required capture failure aborts the destructive operation without incrementing the workspace revision.

The application validates a point's fixed directory layout, regular-file types, manifest identity, schema, stored revision, complete attachment inventory, metadata, and exact byte sizes before listing or restoring it. Unlike portable ZIP backups, local points do not carry independent SHA-256 checksums and are not intended as an off-host tamper-evident archive. Keep tested complete ZIP or volume backups on separate storage.

Restoring a point is a two-step action. The server checks the current revision, captures the current state, stages the selected point's attachments, and then uses the same crash-recoverable directory swap as complete-ZIP restore. The restored document receives a new revision, so stale browser tabs cannot overwrite it.

Recovery points are part of `/data` and therefore part of a volume-level backup. They are deliberately excluded from complete ZIP downloads to avoid recursively packaging retained history. A corrupt point is reported in the authenticated recovery panel and counted by `/api/health`, but it does not prevent the current healthy workspace from opening.

## Trash and permanent deletion

Deleting a thought moves it to workspace trash and keeps its note, task fields, links, attachments, group, and original parent relationship. Restore returns that same record. If a trashed parent has active children, the children appear as temporary roots until the parent is restored.

Permanent deletion requires a second explicit action in the Trash dialog. AuDHDMAP first verifies the current workspace revision, validates that the thought is already trashed, commits a workspace without the record and its links, and only then removes its stored attachment bytes. A stale browser receives a conflict instead of deleting current data.

Before the commit, AuDHDMAP requires a valid recovery point for the current revision. Permanent deletion therefore means removal from the current workspace and current attachment directory. Existing server recovery points, complete ZIP downloads, volume snapshots, and other backups may still retain copies. Apply retention policy to those separate copies when removal from every retained backup is required.

The in-tab undo and redo history is cleared after any permanent thought or attachment deletion. This prevents a later undo from restoring metadata that points to bytes already removed from storage.

## Restore drill

Use a disposable installation or a separate data volume for a routine drill:

1. Download a fresh complete ZIP from the source installation.
2. Open **Export** on the disposable installation.
3. Choose the ZIP under **Restore a complete backup**.
4. Read the replacement warning and choose **Replace workspace from this backup**.
5. Confirm map titles, notes, tasks, and at least one downloaded attachment.
6. Create a new complete ZIP from the restored installation and keep the drill result with the backup record.

Restore streams the upload to a private temporary file, expands into a private staging directory, validates the archive and every attachment, then performs a revision-checked swap. A rejected or stale restore does not change the current workspace. If the process stops during the final directory swap, a recovery marker lets the next startup either roll back the old attachment directory or finish cleanup according to the committed workspace revision.

## Volume-level backup

A stopped-container copy of the `audhdmap-data` volume captures `workspace.json`, the `attachments` directory, and server recovery points together. Prefer a consistent volume snapshot or stop the container briefly before copying files. Do not copy `workspace.json` and attachments at unrelated times while writes are active.

The portable ZIP is the easier format for user-controlled restore and integrity checking. A volume backup remains useful for BoxPilot or infrastructure-level disaster recovery.

## Upgrade

1. Create and verify a complete ZIP backup.
2. Pull the intended immutable version tag.
3. Recreate the container without deleting its `/data` volume.
4. Confirm `/api/health` reports the new version and `storage: "ready"`.
5. Sign in and check one map, one note, and one attachment.

For Docker Compose:

```sh
docker compose pull
docker compose up -d
docker compose ps
```

Avoid relying on the moving `edge` tag for a controlled installation. Use the catalog's versioned image.

## Limits in 0.6.6

- 200 maps
- 10,000 thoughts
- 100 thoughts per quick-capture batch
- 25,000 edges
- 2,000 boundaries
- 64 categories
- 100 attachments and 100 web links per thought
- 25 MiB per attachment
- 8 MiB workspace/import JSON payload; 64 KiB for login and small mutations
- 512 MiB compressed backup upload
- 2 GiB expanded backup and 20,010 ZIP entries
- 10 valid server recovery points
- 200 initially rendered records per structured view page
- 100 initially rendered Trash records

The large ZIP limits are hard safety ceilings, not capacity recommendations. Available disk space must cover the existing data, the uploaded ZIP, the staged restore, and the previous attachment directory during the final swap.

Recovery-point storage depends on filesystem support. Hard-linked immutable attachments consume one set of data blocks until a point is pruned; copy fallback can require another full attachment set per point. Monitor the `/data` volume and keep enough free space for a forced point plus a staged restore.

## Troubleshooting

**The app refuses to start:** check that the owner password is at least 8 characters, the session secret is at least 32 characters, and `/data` is writable by the container's non-root user. If the message says an existing workspace is not readable and writable, preserve the complete data directory first, then repair ownership, permissions, or the underlying storage. AuDHDMAP will not replace that file with seed data.

**A backup returns a conflict:** a referenced attachment is missing or differs from its metadata. Preserve `/data`, identify the named attachment, and repair the data before treating any new archive as complete.

**Restore is rejected:** keep the current data untouched. Confirm the file is an AuDHDMAP ZIP, has not been modified, is within configured limits, and was uploaded after the current workspace finished saving.

**JSON import is rejected:** read the preview reason. Use schema version 1, keep the file within 8 MiB, and use a complete ZIP if the workspace references attachments whose exact bytes are not already on this server. If the workspace changed after preview, select and preview the file again.

**Startup reports a restore recovery marker problem:** do not delete files at random. Preserve the whole data directory before repair. The fail-closed message means the application could not prove whether the old or new attachment directory belongs with the workspace revision.

**A save reports another session changed the workspace:** reload the current server version before editing again. Revision checks intentionally prevent an older browser tab from silently overwriting newer data.

**Permanent delete reports a stale workspace:** do not retry from the old tab. Reload, inspect the current trash record, and repeat the two-step action only if it is still intended.

**A destructive action says a recovery point could not be created:** the requested deletion or restore did not run. Preserve `/data`, open Export and recovery to read the authenticated warning, and verify that every referenced attachment exists with the expected size and that the volume has free space.

**Health reports `snapshotProblems` above zero:** the current workspace can still be healthy. Sign in, open Export and recovery, preserve the whole `/data` volume, and inspect the reported point before removing or repairing anything. Corrupt points are never silently used for restore.
