# Changelog

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
