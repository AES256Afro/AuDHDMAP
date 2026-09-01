# AuDHDMAP milestones

This roadmap keeps the product centered on private, low-friction visual thinking. A milestone is complete only when its implementation, automated checks, live interaction review, documentation, container image, and BoxPilot catalog reference all agree on the same commit.

## 0.1.0 - Runnable private workspace

Status: shipped

- Canvas, Outline, Board, Timeline, and Gantt projections share one thought model.
- Markdown notes, categories, tasks, themes, authentication, persistence, Docker packaging, and the first BoxPilot catalog entry are usable.

## 0.2.0 - Core map interactions

Status: shipped

- Strict branch focus, editable boundary enclosures, cross-map references, real attachment and link cards, keyboard outdent, undo, and redo are usable.
- Workspace normalization repairs invalid group membership and blocks unsafe cross-map branch edges.

## 0.3.0 - Portable work and dependable recovery

Status: shipped

Acceptance criteria:

- A complete ZIP backup contains the workspace and every attachment, with a manifest and SHA-256 integrity checks.
- Restore validates archive paths, entry counts, expanded size, attachment size, metadata, and checksums in a staging area before changing current data.
- A failed or stale restore changes neither the workspace nor its attachments.
- The current map or focused branch exports as a clean PDF, scalable SVG, Markdown outline, or plain-text outline.
- PDF output contains a visual overview and readable notes/task pages without clipped content or blank trailing pages.
- Parent cycles and cross-map parent links cannot crash outline or export traversal.
- Daily export and restore actions are understandable without documentation.
- Measured performance and security findings are fixed and protected by regression tests.

## 0.4.0 - Faster capture and recoverable deletion

Status: shipped

- Multi-line quick capture creates one unconnected thought per non-empty line as a single undoable action.
- Deleting a thought moves it to a visible workspace trash instead of immediately erasing its note, task fields, links, attachments, or original parent relationship.
- Restoring a thought returns the same record and relationships without creating a duplicate.
- Permanent deletion is an explicit second action. The server commits the revision-checked metadata removal before attachment bytes are removed.
- Trashed thoughts stay out of maps, search, project views, focus, counts, and ordinary exports, while complete backups retain them and their attachments.
- Keyboard, API, deep-hierarchy, backup round-trip, stale-tab, and live interaction tests cover the full path.

## 0.5.0 - Large-workspace navigation and snapshots

Status: shipped

Acceptance criteria:

- `Cmd/Ctrl+K` opens a keyboard-operated switcher that finds maps, thoughts, tags, and tasks, supports arrow-key selection, and keeps recent locations only in tab memory.
- The canvas renders only visible graph elements. Outline, Board, Timeline, Gantt, references, and Trash start with bounded DOM pages and reveal more only by explicit action.
- Up to 10 recovery points remain under `/data/snapshots`. Ordinary edits capture the preceding revision at most once every five minutes, while manual capture and destructive operations force the current revision.
- Permanent thought deletion, attachment deletion, and either restore path fail closed if the current state cannot first be captured.
- Recovery point restore is revision checked, validates the point before mutation, stages attachment bytes, uses the crash-recoverable directory swap, and increments the current revision.
- Corrupt points are reported without blocking the healthy live workspace. Existing backup and snapshot retention is disclosed anywhere permanent deletion is offered.
- Supported-limit tests and benchmarks cover 10,000 thoughts, progressive view rendering, recovery capture, recovery listing, recovery restore, stale revisions, unsafe point metadata, and attachment restoration.

## 0.6.0 - Interoperable project handoff

Status: dependent on 0.3.0 export stability

- Task-oriented CSV and document exports preserve hierarchy, dates, statuses, and references.
- Import previews explain what will be added, replaced, or rejected before mutation.
- Format compatibility is tested with durable fixtures rather than vendor-specific UI automation alone.

## Later gates

Collaboration, cloud synchronization, OCR, speech capture, and automated link retrieval remain outside the core until local recovery, export stability, and large-map performance are proven. These features must not weaken offline ownership or make a third-party account mandatory.
