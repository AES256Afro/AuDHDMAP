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

Status: shipped

Acceptance criteria:

- Current-map and focused-branch project CSV preserves stable map and thought IDs, hierarchy path and depth, task dates/status/priority/progress/milestones, tags, notes, web links, attachment metadata, and labeled reference direction.
- CSV text is quoted consistently, carries a UTF-8 marker, uses portable CRLF rows, and neutralizes formula-leading cells before spreadsheet handoff.
- JSON selection opens a non-mutating preview that reports added, replaced, removed, and retained records before any confirmation action is available.
- Unsupported schema, unsafe relationships, size limits, and missing or mismatched attachment bytes are rejected without changing the revision.
- Import confirmation is bound to the exact previewed payload and current revision. The server validates both again and requires a recovery point before replacement.
- Checked-in JSON and CSV fixtures, API tests, UI tests, and the supported-limit benchmark cover compatibility and the full preview-confirm path.

## 0.6.1 through 0.6.10 - Hardened daily interaction

Status: shipped

- Authentication runs before the large workspace and import body parser, while login and small mutations retain a separate 64 KiB ceiling.
- Malformed and oversized JSON receives a bounded response, and large authenticated workspace saves retain the documented 8 MiB allowance.
- Every modal dialog contains forward and reverse keyboard focus within the active panel and returns focus to its launching control when it closes.
- Malformed cookie encoding fails closed, public health failures hide internal error details, and Unicode attachment names survive safe request and download headers.
- Existing workspace access failures stop startup without replacing stored data; only a truly absent file receives the initial seed workspace.
- Every authenticated workspace, export, recovery, and attachment response prevents shared or browser cache retention.
- Filesystem-heavy restore, attachment, export, and application fallback routes enforce bounded per-IP request rates before doing their expensive work.
- PDF generation requires a focused scope at or below 1,000 active thoughts so page-total buffering remains viable in a small container; complete non-PDF exports remain available at the workspace limit.
- The production container upgrades patched OpenSSL libraries and excludes the unused npm CLI, with critical and high severity scanning against the exact release image.
- API and interaction regression tests cover parser order, both body ceilings, malformed JSON and cookies, bounded health failures, Unicode filenames, fail-closed startup, focus containment, and focus restoration.

## 0.7.0 - Public product site and safe shared demo

Status: shipped

- `audhdmap.com` presents a responsive product website with real Canvas, Outline, and Export screenshots, core features, sensory themes, self-hosting guidance, and a direct demo path.
- `/demo` opens without a password only when the explicit public-demo environment flag is present. Normal BoxPilot and Docker installations retain their owner login and refuse to start without its configured password.
- The shared sandbox keeps low-friction map editing and PDF, SVG, Markdown, plain-text, project CSV, and JSON exports.
- Complete backup, restore, JSON import, recovery-point, attachment, and permanent-delete routes fail closed in public-demo mode, and their controls are absent from the public interface.
- The interface labels public data as shared and temporary, links back to the product site, and explains where the complete private toolset is available.
- API and interaction regression tests cover anonymous entry, editable state, PDF output, private-operation denial, public controls, screenshots, and self-hosting links.

## Later gates

Collaboration, cloud synchronization, OCR, speech capture, and automated link retrieval remain outside the core until local recovery, export stability, and large-map performance are proven. These features must not weaken offline ownership or make a third-party account mandatory.
