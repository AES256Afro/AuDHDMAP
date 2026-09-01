// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { focusedThoughtIds } from "./CanvasView";
import { descendantThoughtIds, flattenThoughtHierarchy, gridLayoutPositions, treeLayoutPositions, type ThoughtNode, type Workspace } from "./model";

function thought(id: string, mapId: string, parentId: string | null): ThoughtNode {
  return { id, mapId, parentId, groupId: null, title: id, note: "", x: 0, y: 0, width: 190, shape: "rounded", categoryId: null, tags: [], attachments: [], links: [], task: null, trashedAt: null, createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" };
}

function fixture(): Workspace {
  return {
    schemaVersion: 1,
    revision: 0,
    maps: [
      { id: "map-home-server", title: "Home server", createdAt: "", updatedAt: "" },
      { id: "map-inbox", title: "Inbox", createdAt: "", updatedAt: "" },
    ],
    categories: [],
    nodes: [
      thought("node-root", "map-home-server", null),
      thought("node-inventory", "map-home-server", "node-root"),
      thought("node-storage", "map-home-server", "node-root"),
      thought("node-backups", "map-home-server", "node-storage"),
      thought("node-restore", "map-home-server", "node-backups"),
      thought("node-network", "map-home-server", "node-root"),
      thought("node-apps", "map-home-server", "node-network"),
      thought("node-inbox", "map-inbox", null),
    ],
    edges: [{ id: "reference", mapId: "map-home-server", source: "node-apps", target: "node-restore", type: "reference", label: "before" }],
    groups: [],
    settings: { theme: "quiet", snapToGrid: true, gridSize: 16, reducedMotion: false, crtEffects: false, brightness: 100, saturation: 100, lineThickness: 2, branchFont: "system", nodeShape: "rounded" },
  };
}

describe("branch focus", () => {
  it("shows the focused branch, its ancestors, and explicit references without leaking sibling branches", () => {
    const workspace = fixture();
    const visible = focusedThoughtIds(workspace, "map-home-server", "node-storage");
    expect([...visible].sort()).toEqual(["node-apps", "node-backups", "node-restore", "node-root", "node-storage"].sort());
    expect(visible.has("node-inventory")).toBe(false);
    expect(visible.has("node-network")).toBe(false);
    expect(visible.has("node-inbox")).toBe(false);
  });

  it("shows every thought on the current map when focus is off", () => {
    const workspace = fixture();
    const visible = focusedThoughtIds(workspace, "map-home-server", null);
    expect(visible.size).toBe(7);
  });

  it("keeps trashed thoughts out while treating their active children as visible roots", () => {
    const workspace = fixture();
    workspace.nodes.find((node) => node.id === "node-storage")!.trashedAt = "2026-09-01T13:00:00.000Z";
    const visible = focusedThoughtIds(workspace, "map-home-server", null);
    expect(visible.has("node-storage")).toBe(false);
    expect(visible.has("node-backups")).toBe(true);
    const focused = focusedThoughtIds(workspace, "map-home-server", "node-backups");
    expect(focused.has("node-storage")).toBe(false);
  });

  it("walks a deeply nested map iteratively without overflowing the call stack", () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => thought(`node-${index}`, "map-deep", index ? `node-${index - 1}` : null));
    const descendants = descendantThoughtIds(nodes, "map-deep", "node-0");
    const rows = flattenThoughtHierarchy(nodes);
    const positions = treeLayoutPositions(nodes);
    const gridPositions = gridLayoutPositions(nodes);
    expect(descendants.size).toBe(10_000);
    expect(rows).toHaveLength(10_000);
    expect(rows.at(-1)).toMatchObject({ depth: 9_999, node: { id: "node-9999" } });
    expect(positions.get("node-9999")).toEqual({ x: 94_870, y: 26_955 });
    expect(Math.max(...Array.from(positions.values(), (position) => position.x))).toBeLessThan(100_000);
    expect(Math.max(...Array.from(positions.values(), (position) => position.y))).toBeLessThan(100_000);
    expect(Math.max(...Array.from(gridPositions.values(), (position) => position.x))).toBeLessThan(100_000);
    expect(Math.max(...Array.from(gridPositions.values(), (position) => position.y))).toBeLessThan(100_000);
  });
});
