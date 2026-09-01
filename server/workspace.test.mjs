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
  it("accepts the durable project-handoff JSON fixture without dropping core records", async () => {
    const fixture = JSON.parse(await readFile(new URL("../fixtures/project-handoff-workspace.json", import.meta.url), "utf8"));
    const clean = normalizeWorkspace(fixture);
    expect(clean.maps.map((map) => map.id)).toEqual(["map-fixture"]);
    expect(clean.nodes.map((node) => node.id)).toEqual(["thought-root", "thought-task"]);
    expect(clean.nodes[1].task).toMatchObject({ status: "doing", due: "2026-09-05", progress: 40, milestone: true });
    expect(clean.edges.find((edge) => edge.id === "edge-reference")).toMatchObject({ type: "reference", label: "supports" });
  });

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

  it("previews the exact JSON replacement and preserves the prior revision before import", async () => {
    const store = await tempStore();
    const candidate = await store.read();
    candidate.maps[0].title = "Imported project";
    candidate.nodes = candidate.nodes.filter((node) => node.id !== "node-inventory");
    candidate.edges = candidate.edges.filter((edge) => edge.source !== "node-inventory" && edge.target !== "node-inventory");
    candidate.maps.push({ id: "map-imported", title: "Imported map", createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" });

    const result = await store.previewImport(candidate, 0);
    expect(result).toMatchObject({
      status: "ready",
      confirmation: expect.stringMatching(/^[a-f0-9]{64}$/),
      preview: {
        currentRevision: 0, nextRevision: 1,
        changes: { maps: { added: 1, updated: 1 }, thoughts: { removed: 1 } },
      },
    });
    const tampered = structuredClone(candidate); tampered.maps[0].title = "Not previewed";
    await expect(store.replaceImported(tampered, 0, result.confirmation)).rejects.toMatchObject({ code: "IMPORT_NOT_PREVIEWED" });
    expect((await store.read()).revision).toBe(0);

    const imported = await store.replaceImported(candidate, 0, result.confirmation);
    expect(imported).toMatchObject({ revision: 1 });
    expect(imported.maps[0].title).toBe("Imported project");
    expect((await store.listSnapshots()).snapshots.map((point) => point.revision)).toContain(0);
    await expect(store.replaceImported(candidate, 0, result.confirmation)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("rejects excessively nested extra JSON before issuing an import confirmation", async () => {
    const store = await tempStore();
    const candidate = await store.read();
    let cursor = candidate;
    for (let depth = 0; depth < 34; depth += 1) { cursor.extra = {}; cursor = cursor.extra; }
    await expect(store.previewImport(candidate, 0)).rejects.toThrow(/nested more deeply/i);
    expect((await store.read()).revision).toBe(0);
  });

  it("rejects JSON attachment references unless matching regular bytes already exist", async () => {
    const store = await tempStore();
    const candidate = await store.read();
    candidate.nodes[0].attachments = [{ id: "attachment-import", name: "handoff.txt", mime: "text/plain", size: 7, createdAt: "2026-09-01T12:00:00.000Z" }];
    await expect(store.previewImport(candidate, 0)).rejects.toMatchObject({ code: "IMPORT_ATTACHMENT_MISSING" });
    expect((await store.read()).revision).toBe(0);

    await writeFile(path.join(store.attachmentDirectory, "attachment-import"), "content", { mode: 0o600 });
    const preview = await store.previewImport(candidate, 0);
    expect(preview.preview.totals.attachments).toBe(1);
    expect(preview.preview.changes.attachments.added).toBe(1);

    candidate.nodes[0].attachments[0].size = 8;
    await expect(store.previewImport(candidate, 0)).rejects.toMatchObject({ code: "IMPORT_ATTACHMENT_MISSING" });
  });

  it("removes attachment bytes dropped by import while preserving them in the required recovery point", async () => {
    const store = await tempStore();
    const attachment = { id: "attachment-before-import", name: "before.txt", mime: "text/plain", size: 6, createdAt: "2026-09-01T12:00:00.000Z" };
    const attachmentPath = path.join(store.attachmentDirectory, attachment.id);
    await writeFile(attachmentPath, "before", { mode: 0o600 });
    const current = await store.read(); current.nodes[0].attachments.push(attachment);
    const withAttachment = await store.replace(current, 0);
    const candidate = structuredClone(withAttachment); candidate.nodes[0].attachments = [];
    const preview = await store.previewImport(candidate, 1);
    expect(preview.preview.changes.attachments.removed).toBe(1);

    const imported = await store.replaceImported(candidate, 1, preview.confirmation);
    expect(imported.revision).toBe(2);
    await expect(access(attachmentPath)).rejects.toThrow();
    const point = (await store.listSnapshots()).snapshots.find((entry) => entry.revision === 1);
    expect(point).toBeTruthy();
    const restored = await store.restoreSnapshot(point.id, 2);
    expect(restored.nodes[0].attachments).toEqual([attachment]);
    expect(await readFile(attachmentPath, "utf8")).toBe("before");
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
