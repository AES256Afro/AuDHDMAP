# Changelog

## 0.6.4

- Create the seed workspace only when `workspace.json` is truly absent.
- Fail closed with preservation and repair guidance when an existing workspace cannot be read and written, instead of treating every access error like a missing file.
- Add a filesystem-permission regression proving that blocked startup leaves the original workspace bytes unchanged.

## 0.6.3

- Treat malformed percent-encoded session cookies as invalid anonymous sessions instead of returning a server error.
- Keep public unavailable-health responses generic so internal storage errors and paths are not disclosed.
- Percent-encode Unicode attachment names in upload requests and use an ASCII fallback plus an RFC 5987 UTF-8 download filename.
- Find requested attachment metadata without allocating a flattened copy of every attachment list.
- Add API regressions for malformed cookies, health failure disclosure, Unicode attachment round trips, and safe download headers.

## 0.6.2

- Keep Tab and Shift+Tab focus inside every active dialog so keyboard navigation cannot disappear behind an open panel.
- Restore focus to the launching control when a dialog closes, including Escape-driven closure.
- Add interaction regression coverage for initial dialog focus, forward and reverse wrapping, and focus restoration.

## 0.6.1

- Authenticate workspace and JSON-import requests before parsing their bodies, preventing anonymous clients from consuming the 8 MiB large-workspace parser allowance.
- Give login and small recovery mutations a separate 64 KiB JSON ceiling while retaining 8 MiB for supported large-workspace save and import paths.
- Return bounded JSON errors for malformed and oversized request bodies, with regression coverage for parser order and a workspace payload above the small-route ceiling.

## 0.6.0

- Add current-map and focused-branch project CSV export with stable IDs, hierarchy paths, task fields, tags, notes, web links, attachment metadata, and labeled incoming or outgoing references.
- Quote CSV consistently, add UTF-8 and CRLF compatibility, and neutralize formula-leading cells before spreadsheet handoff.
- Replace immediate JSON mutation with a non-mutating preview that reports added, replaced, removed, and retained maps, thoughts, connections, boundaries, categories, and attachment references.
- Reject unsupported, oversized, unsafe, stale, or attachment-incomplete JSON before mutation, with complete-ZIP guidance when attachment bytes need to move between servers.
- Bind confirmation to the exact previewed JSON and expected revision, revalidate inside the mutation queue, and require a server recovery point before replacement.
- Add durable JSON and CSV compatibility fixtures plus server, API, UI, security, stale-revision, attachment-integrity, and exact-confirmation regression coverage.
- Extend the 10,000-thought benchmark to project CSV and JSON import preview. The measured preview remains below 100 ms on the release development host.

## 0.5.0

- Add a global `Cmd/Ctrl+K` quick switcher for maps, thoughts, tasks, tags, task states, and recent locations. Recent history remains only in the current browser tab.
- Add server-local recovery points under `/data/snapshots`, with manual capture, automatic pre-change capture, a five-minute ordinary-save cadence, and a retention limit of 10 valid points.
- Force a valid recovery point before permanent thought deletion, attachment deletion, complete-backup restore, or local-point restore. A safety-copy failure blocks destructive work without changing the current revision.
- Validate recovery point layout, manifest identity, workspace schema and revision, attachment inventory, regular-file types, and exact file sizes before listing or restoring a point.
- Add revision-checked recovery APIs and a two-step restore interface that preserves the state from immediately before restore.
- Clarify that permanent deletion removes current workspace data while existing downloaded backups and server recovery points may retain copies.
- Render Outline, Board, Timeline, Gantt, reference lists, and Trash in bounded progressive pages while preserving complete counts and explicit Show more controls.
- Enable viewport-only React Flow rendering for large canvases.
- Split the authenticated workspace bundle from the boot and login shell, reducing initial JavaScript from about 510 KB to about 197 KB before compression.
- Extend supported-limit benchmarks to recovery-point creation, inspection, and restoration at 10,000 thoughts.

## 0.4.0

- Add multi-line quick capture from the `Q` shortcut or canvas, creating one unconnected thought per non-empty line as a single undoable batch.
- Replace destructive thought deletion with visible workspace trash that preserves notes, tasks, links, attachments, group membership, and original parent relationships.
- Add exact-record restore and a second-confirmation permanent delete flow.
- Commit permanent deletion as a revision-checked server transaction before cleaning up attachment bytes.
- Clear in-tab undo history after a permanent thought or attachment deletion so undo cannot resurrect metadata for bytes that no longer exist.
- Keep trashed thoughts out of maps, focus, search, task views, counts, PDF, SVG, Markdown, text, and JSON interchange while retaining them in complete ZIP backups.
- Treat active children of a trashed parent as visible roots without rewriting their stored relationship, so restoring the parent reconnects the branch.
- Extend supported-limit performance measurements and regression coverage across normalization, exports, backups, stale revisions, API deletion, keyboard capture, undo, and deep hierarchies.
- Make tree auto-layout iterative and keep tree and grid coordinates inside the persisted workspace bounds at the 10,000-thought limit.

## 0.3.0

- Add complete ZIP backups with workspace data, attachment bytes, a versioned manifest, and SHA-256 checksums.
- Add staged, fail-closed ZIP restore with path, entry-count, expanded-size, per-file, metadata, inventory, and checksum validation.
- Make attachment-directory swaps recoverable after an interrupted restore and make attachment removal commit metadata before deleting bytes.
- Add current-map and focused-branch PDF, SVG, Markdown, and plain-text exports. PDF includes a visual overview and a readable notes and tasks outline.
- Save pending edits before export, import, restore, or sign-out; add retryable failures and unload protection.
- Improve keyboard capture and navigation with immediate title focus, `/` search, `Esc`, `Cmd/Ctrl+S`, and held-key protection.
- Replace recursive or quadratic deep-tree, branch-focus, group, outline, and export paths with bounded iterative traversal.
- Add supported-limit benchmarks for balanced and 10,000-level-deep workspaces.
- Stream attachment downloads, validate image signatures, bound authentication state, require stronger secrets, and ignore forwarded headers unless proxy trust is explicitly enabled.
- Expand automated coverage for backups, exports, revision conflicts, archive attacks, crash recovery, proxy spoofing, attachment integrity, and deep hierarchies.

## 0.2.0

- Make Branch Focus a strict isolation view without leaking sibling branches back into the canvas.
- Add selectable, movable, resizable, and editable boundary enclosures around branches.
- Add direct two-way references between thoughts on the same map or different maps.
- Add file and web-link drop handling, safe local link cards, and protected image thumbnails.
- Add Shift+Tab outdent and redo support.
- Preserve the version 1 workspace schema with additive normalization for existing installations.

## 0.1.0

- Introduce the self-hosted Canvas, Outline, Board, Timeline, and Gantt workspace.
- Add Markdown notes, task fields, attachments, themes, authentication, Docker packaging, and BoxPilot catalogue support.
