import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultWorkspace } from "./default-workspace.mjs";
import { createWorkspaceStore, normalizeWorkspace } from "./workspace.mjs";

const directories = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function tempStore() {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "audhdmap-store-")); directories.push(dataDirectory);
  const store = createWorkspaceStore({ dataDirectory, now: () => new Date("2026-09-01T12:00:00.000Z") });
  await store.initialize();
  return store;
}

describe("workspace normalization", () => {
  it("keeps the canonical seed valid and bounds visual settings", () => {
    const raw = defaultWorkspace(new Date("2026-09-01T12:00:00.000Z"));
    raw.settings.brightness = 999;
    raw.settings.gridSize = 1;
    const clean = normalizeWorkspace(raw, { revision: 7 });
    expect(clean.revision).toBe(7);
    expect(clean.settings.brightness).toBe(140);
    expect(clean.settings.gridSize).toBe(4);
    expect(clean.nodes.find((node) => node.id === "node-storage")?.task?.due).toBe("2026-09-18");
  });

  it("rejects unknown edge endpoints and duplicate ids", () => {
    const brokenEdge = defaultWorkspace(); brokenEdge.edges[0].target = "missing";
    expect(() => normalizeWorkspace(brokenEdge)).toThrow(/unknown endpoint/i);
    const duplicate = defaultWorkspace(); duplicate.nodes[1].id = duplicate.nodes[0].id;
    expect(() => normalizeWorkspace(duplicate)).toThrow(/Duplicate id/);
  });

  it("strips unsupported task values and repairs missing parents", () => {
    const raw = defaultWorkspace();
    raw.nodes[0].parentId = "missing";
    raw.nodes[1].task.status = "invented";
    raw.nodes[1].task.progress = 500;
    const clean = normalizeWorkspace(raw);
    expect(clean.nodes[0].parentId).toBeNull();
    expect(clean.nodes[1].task).toMatchObject({ status: "todo", progress: 100 });
  });

  it("keeps safe web links and rejects unsafe URL schemes", () => {
    const raw = defaultWorkspace();
    raw.nodes[0].links = [
      { id: "link-safe", url: "https://example.com/notes", title: "Reference", createdAt: "2026-09-01T12:00:00.000Z" },
      { id: "link-script", url: "javascript:alert(1)", title: "Unsafe", createdAt: "2026-09-01T12:00:00.000Z" },
      { id: "bad id", url: "https://example.com", title: "Bad id", createdAt: "2026-09-01T12:00:00.000Z" },
    ];
    const clean = normalizeWorkspace(raw);
    expect(clean.nodes[0].links).toEqual([{ id: "link-safe", url: "https://example.com/notes", title: "Reference", createdAt: "2026-09-01T12:00:00.000Z" }]);
  });

  it("allows references across maps but never branch edges across maps", () => {
    const raw = defaultWorkspace();
    raw.edges.push({ id: "edge-cross-map", mapId: "map-home-server", source: "node-root", target: "node-inbox", type: "reference", label: "capture" });
    const clean = normalizeWorkspace(raw);
    expect(clean.edges.find((edge) => edge.id === "edge-cross-map")).toMatchObject({ mapId: "map-home-server", type: "reference" });
    raw.edges.at(-1).type = "branch";
    expect(() => normalizeWorkspace(raw)).toThrow(/cannot cross maps/i);
  });

  it("keeps boundary descriptions and repairs unknown group membership", () => {
    const raw = defaultWorkspace();
    raw.groups[0].description = "A bounded preparation area";
    raw.nodes[0].groupId = "missing-group";
    const clean = normalizeWorkspace(raw);
    expect(clean.groups[0].description).toBe("A bounded preparation area");
    expect(clean.nodes[0].groupId).toBeNull();
  });
});

describe("workspace store", () => {
  it("initializes once, writes atomically, and persists revisions", async () => {
    const store = await tempStore();
    const first = await store.read();
    const edited = { ...first, maps: first.maps.map((map, index) => index === 0 ? { ...map, title: "Edited map" } : map) };
    const saved = await store.replace(edited, 0);
    expect(saved.revision).toBe(1);
    expect((await store.read()).maps[0].title).toBe("Edited map");
    expect(JSON.parse(await readFile(store.workspacePath, "utf8")).revision).toBe(1);
  });

  it("fails closed when a stale browser tries to save", async () => {
    const store = await tempStore();
    const first = await store.read();
    await store.replace(first, 0);
    await expect(store.replace(first, 0)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await store.read()).revision).toBe(1);
  });
});
