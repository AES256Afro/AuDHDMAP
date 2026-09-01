// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { focusedThoughtIds } from "./CanvasView";
import type { ThoughtNode, Workspace } from "./model";

function thought(id: string, mapId: string, parentId: string | null): ThoughtNode {
  return { id, mapId, parentId, groupId: null, title: id, note: "", x: 0, y: 0, width: 190, shape: "rounded", categoryId: null, tags: [], attachments: [], links: [], task: null, createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" };
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
});
