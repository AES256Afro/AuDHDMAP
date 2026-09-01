import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
    expect(clean.nodes.every((node) => node.trashedAt === null)).toBe(true);
  });

  it("normalizes valid trash timestamps and rejects timestamp-shaped junk", () => {
    const raw = defaultWorkspace();
    raw.nodes[0].trashedAt = "2026-09-01T12:34:56-05:00";
    raw.nodes[1].trashedAt = "not-a-date";
    raw.nodes[2].trashedAt = "2026";
    const clean = normalizeWorkspace(raw);
    expect(clean.nodes[0].trashedAt).toBe("2026-09-01T17:34:56.000Z");
    expect(clean.nodes[1].trashedAt).toBeNull();
    expect(clean.nodes[2].trashedAt).toBeNull();
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

  it("breaks parent cycles and cross-map parents before outline consumers recurse", () => {
    const raw = defaultWorkspace();
    raw.nodes[0].parentId = raw.nodes[1].id;
    raw.nodes[1].parentId = raw.nodes[0].id;
    raw.nodes.find((node) => node.id === "node-inbox").parentId = raw.nodes[0].id;
    const clean = normalizeWorkspace(raw);
    expect(clean.nodes.find((node) => node.id === raw.nodes[0].id).parentId).toBeNull();
    expect(clean.nodes.find((node) => node.id === "node-inbox").parentId).toBeNull();
  });

  it("rejects duplicate attachment and web-link ids", () => {
    const duplicateAttachment = defaultWorkspace();
    const attachment = { id: "attachment-shared", name: "same.txt", mime: "text/plain", size: 4, createdAt: "2026-09-01T12:00:00.000Z" };
    duplicateAttachment.nodes[0].attachments = [attachment];
    duplicateAttachment.nodes[1].attachments = [attachment];
    expect(() => normalizeWorkspace(duplicateAttachment)).toThrow(/Duplicate attachment id/i);

    const duplicateLink = defaultWorkspace();
    const link = { id: "link-shared", title: "Same", url: "https://example.com/", createdAt: "2026-09-01T12:00:00.000Z" };
    duplicateLink.nodes[0].links = [link]; duplicateLink.nodes[1].links = [link];
    expect(() => normalizeWorkspace(duplicateLink)).toThrow(/Duplicate web link id/i);
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

  it("returns detached snapshots from its in-memory read cache", async () => {
    const store = await tempStore();
    const first = await store.read();
    first.maps[0].title = "Mutated outside the store";
    expect((await store.read()).maps[0].title).not.toBe("Mutated outside the store");
  });

  it("commits attachment metadata removal before deleting its bytes", async () => {
    const store = await tempStore();
    const attachment = { id: "attachment-atomic", name: "atomic.txt", mime: "text/plain", size: 4, createdAt: "2026-09-01T12:00:00.000Z" };
    const attachmentPath = path.join(store.attachmentDirectory, attachment.id);
    await writeFile(attachmentPath, "safe", { mode: 0o600 });
    const workspace = await store.read(); workspace.nodes[0].attachments.push(attachment);
    const referenced = await store.replace(workspace, 0);

    await expect(store.removeAttachment(referenced, attachment.id, 1)).rejects.toThrow(/remove the attachment/i);
    await expect(access(attachmentPath)).resolves.toBeUndefined();
    expect((await store.read()).nodes[0].attachments).toHaveLength(1);

    const candidate = structuredClone(referenced); candidate.nodes[0].attachments = [];
    const removed = await store.removeAttachment(candidate, attachment.id, 1);
    expect(removed.revision).toBe(2);
    expect(removed.nodes[0].attachments).toEqual([]);
    await expect(access(attachmentPath)).rejects.toThrow();
  });

  it("permanently purges only a trashed thought and commits metadata before attachment cleanup", async () => {
    const store = await tempStore();
    const attachment = { id: "attachment-trashed", name: "trashed.txt", mime: "text/plain", size: 7, createdAt: "2026-09-01T12:00:00.000Z" };
    const attachmentPath = path.join(store.attachmentDirectory, attachment.id);
    await writeFile(attachmentPath, "discard", { mode: 0o600 });
    const workspace = await store.read();
    workspace.nodes[0].attachments.push(attachment);
    await expect(store.purgeTrashedNode(workspace, workspace.nodes[0].id, 0)).rejects.toMatchObject({ code: "NODE_NOT_TRASHED" });
    workspace.nodes[0].trashedAt = "2026-09-01T12:30:00.000Z";
    const trashed = await store.replace(workspace, 0);

    await expect(store.purgeTrashedNode(trashed, trashed.nodes[0].id, 1)).rejects.toThrow(/remove the thought/i);
    expect((await store.read()).nodes[0].attachments).toHaveLength(1);
    await expect(access(attachmentPath)).resolves.toBeUndefined();

    const candidate = structuredClone(trashed);
    const purgedId = candidate.nodes[0].id;
    candidate.nodes = candidate.nodes.filter((node) => node.id !== purgedId);
    candidate.edges = candidate.edges.filter((edge) => edge.source !== purgedId && edge.target !== purgedId);
    const purged = await store.purgeTrashedNode(candidate, purgedId, 1);
    expect(purged.revision).toBe(2);
    expect(purged.nodes.some((node) => node.id === purgedId)).toBe(false);
    await expect(access(attachmentPath)).rejects.toThrow();
  });

  it("rolls back attachment directories after a restore interrupted before its workspace commit", async () => {
    const store = await tempStore();
    await writeFile(path.join(store.attachmentDirectory, "old-file"), "old", { mode: 0o600 });
    const previousName = ".attachments-previous-11111111-1111-4111-8111-111111111111";
    await rename(store.attachmentDirectory, path.join(store.dataDirectory, previousName));
    await mkdir(store.attachmentDirectory, { mode: 0o700 });
    await writeFile(path.join(store.attachmentDirectory, "new-file"), "new", { mode: 0o600 });
    await writeFile(path.join(store.dataDirectory, ".restore-state.json"), `${JSON.stringify({ previousDirectory: previousName, targetRevision: 1 })}\n`, { mode: 0o600 });

    const recovered = createWorkspaceStore({ dataDirectory: store.dataDirectory });
    await recovered.initialize();
    expect(await readFile(path.join(recovered.attachmentDirectory, "old-file"), "utf8")).toBe("old");
    await expect(access(path.join(recovered.attachmentDirectory, "new-file"))).rejects.toThrow();
    await expect(access(path.join(store.dataDirectory, ".restore-state.json"))).rejects.toThrow();
  });

  it("finishes cleanup after a restore interrupted after its workspace commit", async () => {
    const store = await tempStore();
    const workspace = await store.read(); workspace.maps[0].title = "Committed restore";
    await store.replace(workspace, 0);
    const previousName = ".attachments-previous-22222222-2222-4222-8222-222222222222";
    await mkdir(path.join(store.dataDirectory, previousName), { mode: 0o700 });
    await writeFile(path.join(store.dataDirectory, previousName, "old-file"), "old", { mode: 0o600 });
    await writeFile(path.join(store.attachmentDirectory, "new-file"), "new", { mode: 0o600 });
    await writeFile(path.join(store.dataDirectory, ".restore-state.json"), `${JSON.stringify({ previousDirectory: previousName, targetRevision: 1 })}\n`, { mode: 0o600 });

    const recovered = createWorkspaceStore({ dataDirectory: store.dataDirectory });
    expect((await recovered.initialize()).maps[0].title).toBe("Committed restore");
    expect(await readFile(path.join(recovered.attachmentDirectory, "new-file"), "utf8")).toBe("new");
    await expect(access(path.join(store.dataDirectory, previousName))).rejects.toThrow();
    await expect(access(path.join(store.dataDirectory, ".restore-state.json"))).rejects.toThrow();
  });
});
