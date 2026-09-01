# AuDHDMAP product direction

Status: concept and interaction specification for the first Docker release.

AuDHDMAP is a private, self-hosted place to capture disconnected thoughts, connect them when useful, write full notes, and turn selected branches into work. It does not require every thought to begin in a hierarchy, and it does not make medical or diagnostic claims.

## One thought, several views

A thought is stored once. The user can look at the same information through different views without exporting, duplicating, or synchronizing it.

| View | Purpose | What it shows |
| --- | --- | --- |
| Canvas | Unrestricted capture and spatial thinking | Freely placed nodes, labeled links, groups, attachments, and note previews |
| Outline | Sequential reading and keyboard editing | The selected hierarchy as nested text, plus a separate References section for non-hierarchical links |
| Board | Actionable workflow | Nodes with task status grouped into customizable columns |
| Timeline | Time-oriented context | Nodes with dates arranged chronologically, including undated work in a visible tray |
| Gantt | Project dependencies | Scheduled tasks, duration, progress, milestones, and explicit dependency lines |

Switching views never creates another copy of a node. A title or task status changed in Outline or Gantt immediately changes that node everywhere.

## Capture without cleanup first

- Double-click or press `N` on empty canvas space to create an unconnected thought.
- Paste several lines to create a loose stack of thoughts without inventing links.
- Drop an image, PDF, text file, or web link onto a node to attach it.
- Drag between node handles to connect thoughts later.
- Give a connection an optional type and label, such as `depends on`, `supports`, `questions`, `example`, or custom text.
- Link to a node in another map instead of duplicating it.
- Keep an Inbox map for thoughts that have not found a structure yet.

## Predictable structure when requested

Auto-layout is an explicit, undoable action. It is never continuously rearranging the canvas behind the user.

- Tree layout: top-down or left-to-right hierarchy.
- Radial layout: branches around one selected center.
- Grid layout: clean rows and columns for mixed, non-hierarchical material.
- Compact layout: tight packing for overview and printing.
- Auto-align: align left, center, right, top, middle, or bottom.
- Equal spacing: distribute selected nodes horizontally or vertically.
- Strict grid snapping: configurable grid size, on/off toggle, and temporary bypass while holding a modifier key.
- Overlap check: highlights collisions and offers a one-click repair without moving unaffected nodes.

## Outline and map toggle

The Outline is a real editor, not a read-only export.

- `Enter` creates a sibling.
- `Tab` creates or indents a child.
- `Shift+Tab` moves a node one level out.
- Arrow keys move through visible nodes.
- `Space` or `F2` edits the selected title.
- `Cmd/Ctrl+Enter` opens the full note.
- Dragging an outline row changes hierarchy after showing the exact new parent.
- Non-hierarchical connections remain under a References disclosure so the outline never pretends the map is only a tree.

## Tasks and projects

Any node can remain a plain thought or gain optional work fields:

- status, such as Not started, Doing, Waiting, Blocked, or Done;
- start date and due date;
- duration and percent complete;
- priority and effort estimate;
- milestone flag;
- dependency links;
- checklist;
- recurrence in a later release.

A branch can be promoted to a project. Promotion exposes Board, Timeline, and Gantt views for that branch, but it does not move or duplicate its nodes. Removing project fields returns a node to an ordinary thought without deleting its note or links.

## Branch focus and boundaries

- Focus mode shows one selected branch, its ancestors, its children, and explicitly linked references.
- A breadcrumb always shows where the focused branch lives and provides one-click exit.
- Users can choose whether references outside the branch are hidden, dimmed, or shown in a side list.
- Sub-branches can become named sub-maps while retaining a visible link to their original context.
- Boundary enclosures use consistent rectangles, soft clouds, or bracket shapes around a group.
- Boundaries can carry a name, description, semantic color, and collapsed state.
- Collapsing a boundary leaves a labeled summary node so content never appears to vanish without explanation.

## Semantic color rules

Color can communicate a user-defined meaning instead of becoming decoration.

- A workspace defines named categories, for example `Decision`, `Question`, `Evidence`, `Risk`, and `Next action`.
- Every category has a color, icon or pattern, optional node shape, and text label.
- The category name remains visible to screen readers and can be shown as a compact badge, so meaning never depends on color alone.
- Priority colors are separate from category colors and cannot silently override them.
- A legend is available from every map and included in printed or exported views.
- Rules can be locked per workspace to keep the same meaning across maps.

## Markdown and full notes

- Node titles are plain text for predictable navigation.
- Each node has a full Markdown note with headings, lists, checkboxes, links, tables, code blocks, block quotes, and fenced code.
- Edit and Preview are explicit modes. A split Markdown preview is optional.
- Heading structure appears in a note table of contents.
- Pasting formatted text produces reviewable Markdown rather than hidden rich-text formatting.
- Internal links use a stable node identifier while displaying the current node title.

## Attachments

- Drag-and-drop accepts images, PDFs, text files, and web links.
- Images show a bounded thumbnail with filename, dimensions, and file size.
- PDFs show the first page when a thumbnail can be generated, plus filename, page count, and file size.
- Web links show domain, title, description, and thumbnail only when safely retrievable. The original URL remains visible.
- Unsupported files show a consistent file card rather than a broken preview.
- Attachments live under `/data/attachments` and are included in BoxPilot backups.
- The first release sets configurable per-file and total-workspace limits and rejects oversized uploads before writing them.

## Themes and visual comfort

The control layout remains fixed when themes change. A theme cannot rename actions, move primary navigation, or change shortcut behavior.

Planned first-release themes:

1. Quiet Canvas: neutral dark and light modes with generous whitespace.
2. Paper Atlas: warm paper surfaces and restrained ink colors.
3. Signal Garden: green phosphor CRT.
4. Amber Operator: warm amber terminal.
5. Workstation 84: friendly early-workstation windows and pixel accents.

Independent comfort controls:

- interface scale;
- branch and note font family;
- branch font size and line height;
- canvas brightness and saturation;
- connection contrast and thickness;
- node corner shape and density;
- grid size and visibility;
- reduced motion;
- optional CRT scanlines, glow, curvature, flicker, and chromatic offset;
- high-contrast light and dark presets;
- an immediate Reset visual settings action.

CRT effects default to subtle, respect reduced-motion settings, and can all be disabled while keeping the CRT palette.

## Keyboard and accessibility contract

- Every operation is reachable without a pointer.
- A visible shortcut panel groups commands by Canvas, Outline, Editing, and Navigation.
- Shortcuts can be remapped and conflicts are shown before saving.
- Canvas nodes have a navigable DOM representation and never exist only as pixels.
- Outline provides a linear equivalent for spatial content.
- Links, categories, task states, and selection have text or shape indicators in addition to color.
- Focus is always visible.
- Effects honor reduced motion and increased contrast.
- Automated accessibility checks are required, but they are not a substitute for a real keyboard and screen-reader review.

## Safety and recovery

- Autosave shows `Saving`, `Saved`, or a specific failure with a Retry action.
- Local undo and redo cover node edits, links, moves, deletions, layout, hierarchy changes, and imports.
- Deletions go to a workspace trash view before permanent removal.
- JSON export includes maps, nodes, links, categories, view settings, task fields, and attachment metadata.
- Import validates schema, size, paths, identifiers, and references before changing the workspace.
- A failed import changes nothing.
- Automatic internal snapshots provide recovery between BoxPilot backups.

## Docker and BoxPilot boundary

The first release is one Linux container with:

- one HTTP port;
- one `/data` volume containing the workspace database, attachments, thumbnails, and internal snapshots;
- owner username, generated owner password, and generated session secret supplied through environment variables;
- an unauthenticated `/api/health` endpoint that performs a bounded read/write readiness check without exposing workspace content;
- no required third-party account or cloud service;
- a non-root runtime user;
- deterministic startup and graceful shutdown;
- versioned JSON export independent of the internal storage engine.

BoxPilot can therefore install, expose, back up, restore, update, and uninstall the application through its generic catalog path.

## First release cut

The first runnable release should include Canvas, Outline, full Markdown notes, semantic categories, labeled cross-map links, focus mode, boundaries, tree and grid auto-layout, grid snapping, basic task fields, Board, a read-only Gantt projection, attachments, export/import, undo/redo, the five themes, owner authentication, and Docker packaging.

Direct Gantt editing, recurrence, live collaboration, OCR, speech input, external cloud storage, and automated web-link retrieval can follow after the storage, backup, and interaction foundations are proven.

## References reviewed

- [Built In: mind-mapping software and tools](https://builtin.com/articles/mind-mapping-software-tools)
- [MatchWare: what makes MindView AT an assistive technology](https://www.matchware.com/what-makes-mindview-at)
- [Ayoa: mind-mapping software for DSA students](https://www.ayoa.com/education/dsa/)
