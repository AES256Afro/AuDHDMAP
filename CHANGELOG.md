# Changelog

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
