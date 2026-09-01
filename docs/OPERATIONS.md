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

The health response intentionally contains only the version, storage state, revision, and bounded map and thought counts.

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

A stopped-container copy of the `audhdmap-data` volume captures `workspace.json` and the `attachments` directory together. Prefer a consistent volume snapshot or stop the container briefly before copying files. Do not copy `workspace.json` and attachments at unrelated times while writes are active.

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

## Limits in 0.3.0

- 200 maps
- 10,000 thoughts
- 25,000 edges
- 2,000 boundaries
- 64 categories
- 100 attachments and 100 web links per thought
- 25 MiB per attachment
- 3 MiB JSON API payload
- 512 MiB compressed backup upload
- 2 GiB expanded backup and 20,010 ZIP entries

The large ZIP limits are hard safety ceilings, not capacity recommendations. Available disk space must cover the existing data, the uploaded ZIP, the staged restore, and the previous attachment directory during the final swap.

## Troubleshooting

**The app refuses to start:** check that the owner password is at least 8 characters, the session secret is at least 32 characters, and `/data` is writable by the container's non-root user.

**A backup returns a conflict:** a referenced attachment is missing or differs from its metadata. Preserve `/data`, identify the named attachment, and repair the data before treating any new archive as complete.

**Restore is rejected:** keep the current data untouched. Confirm the file is an AuDHDMAP ZIP, has not been modified, is within configured limits, and was uploaded after the current workspace finished saving.

**Startup reports a restore recovery marker problem:** do not delete files at random. Preserve the whole data directory before repair. The fail-closed message means the application could not prove whether the old or new attachment directory belongs with the workspace revision.

**A save reports another session changed the workspace:** reload the current server version before editing again. Revision checks intentionally prevent an older browser tab from silently overwriting newer data.
