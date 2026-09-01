// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskStatus, ThoughtNode, Workspace } from "./model";
import { BoardView, GanttView, OutlineView, STRUCTURED_VIEW_PAGE_SIZE, TimelineView } from "./Views";

afterEach(cleanup);

const statuses: TaskStatus[] = ["todo", "doing", "waiting", "blocked", "done"];

function fixture(count = 450): Workspace {
  const createdAt = "2026-09-01T12:00:00.000Z";
  const nodes: ThoughtNode[] = Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`, mapId: "map-large", parentId: index > 0 && index % 4 !== 0 ? `node-${index - 1}` : null, groupId: null,
    title: `Thought ${String(index).padStart(4, "0")}`, note: `Note ${index}`, x: index * 10, y: index * 10, width: 190,
    shape: "rounded", categoryId: null, tags: [], attachments: [], links: [],
    task: { status: statuses[index % statuses.length], start: index % 3 === 0 ? "2026-09-01" : "", due: index % 3 === 0 ? "2026-09-15" : "", progress: index % 100, priority: "medium", milestone: false },
    trashedAt: null, createdAt, updatedAt: new Date(Date.parse(createdAt) + index * 1_000).toISOString(),
  }));
  return {
    schemaVersion: 1, revision: 0,
    maps: [{ id: "map-large", title: "Large map", createdAt, updatedAt: createdAt }], categories: [], nodes, edges: [], groups: [],
    settings: { theme: "quiet", snapToGrid: true, gridSize: 16, reducedMotion: true, crtEffects: false, brightness: 100, saturation: 100, lineThickness: 2, branchFont: "system", nodeShape: "rounded" },
  };
}

function props(workspace: Workspace) {
  return { workspace, mapId: "map-large", selectedId: null, onSelect: vi.fn(), onTitle: vi.fn(), onStatus: vi.fn() };
}

describe("progressive structured views", () => {
  it("renders large outlines in bounded, explicit pages", () => {
    const workspace = fixture();
    const rendered = render(<OutlineView {...props(workspace)} />);
    expect(STRUCTURED_VIEW_PAGE_SIZE).toBe(200);
    expect(rendered.container.querySelectorAll(".outline-row")).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: "Show 200 more" }));
    expect(rendered.container.querySelectorAll(".outline-row")).toHaveLength(400);
    fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }));
    expect(rendered.container.querySelectorAll(".outline-row")).toHaveLength(450);
    expect(screen.queryByRole("button", { name: /Show .* more/ })).toBeNull();
  });

  it.each([
    ["board", BoardView, ".board-card"],
    ["timeline", TimelineView, ".timeline-track button, .undated-tray button"],
    ["gantt", GanttView, ".gantt-row"],
  ] as const)("bounds the %s DOM before the user asks for more", (_name, View, selector) => {
    const workspace = fixture();
    if (_name === "gantt") for (const node of workspace.nodes) { node.task!.start = "2026-09-01"; node.task!.due = "2026-09-15"; }
    const rendered = render(<View {...props(workspace)} />);
    expect(rendered.container.querySelectorAll(selector)).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: "Show 200 more" }));
    expect(rendered.container.querySelectorAll(selector)).toHaveLength(400);
  });
});
