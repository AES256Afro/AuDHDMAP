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

## 0.4.0 - Faster daily capture and recovery

Status: queued after 0.3.0

- Multi-line quick capture creates a reviewable stack of thoughts.
- A keyboard quick switcher jumps between maps, thoughts, tasks, and recent work without changing layout.
- Large-map canvas and structured views virtualize or progressively reveal content where DOM volume, not data traversal, becomes the bottleneck.
- Workspace trash and automatic local snapshots make deletion recovery independent of the current tab's undo history.

## 0.5.0 - Interoperable project handoff

Status: dependent on 0.3.0 export stability

- Task-oriented CSV and document exports preserve hierarchy, dates, statuses, and references.
- Import previews explain what will be added, replaced, or rejected before mutation.
- Format compatibility is tested with durable fixtures rather than vendor-specific UI automation alone.

## Later gates

Collaboration, cloud synchronization, OCR, speech capture, and automated link retrieval remain outside the core until local recovery, export stability, and large-map performance are proven. These features must not weaken offline ownership or make a third-party account mandatory.
