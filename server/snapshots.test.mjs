import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceStore } from "./workspace.mjs";

const directories = [];

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function tempStore({ maximumSnapshots = 10, snapshotIntervalMs = 5 * 60_000 } = {}) {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "audhdmap-snapshots-"));
  directories.push(dataDirectory);
  let clock = Date.parse("2026-09-01T12:00:00.000Z");
  const store = createWorkspaceStore({ dataDirectory, maximumSnapshots, snapshotIntervalMs, now: () => new Date(clock) });
  await store.initialize();
  return { store, advance: (milliseconds) => { clock += milliseconds; } };
}

describe("server-local recovery points", () => {
  it("captures before saves, enforces retention, and reports accurate health counts", async () => {
    const { store, advance } = await tempStore({ maximumSnapshots: 2, snapshotIntervalMs: 0 });
    expect(await store.readiness()).toMatchObject({ snapshots: 0, snapshotProblems: 0 });

    let workspace = await store.read();
    workspace.maps[0].title = "Revision one";
    workspace = await store.replace(workspace, 0);
    advance(1_000);
    workspace.maps[0].title = "Revision two";
    workspace = await store.replace(workspace, 1);
    advance(1_000);
    workspace.maps[0].title = "Revision three";
    await store.replace(workspace, 2);

    const listed = await store.listSnapshots();
    expect(listed.snapshots.map((snapshot) => snapshot.revision)).toEqual([2, 1]);
    expect(listed.problems).toEqual([]);
    expect(await store.readiness()).toMatchObject({ snapshots: 2, snapshotProblems: 0 });
    expect((await lstat(store.snapshotDirectory)).mode & 0o777).toBe(0o700);
  });

  it("captures ordinary edits at the default five-minute cadence", async () => {
    const { store, advance } = await tempStore();
    let workspace = await store.read();
    workspace.maps[0].title = "First edit";
    workspace = await store.replace(workspace, 0);
    workspace.maps[0].title = "Second edit";
    workspace = await store.replace(workspace, 1);
    expect((await store.listSnapshots()).snapshots.map((snapshot) => snapshot.revision)).toEqual([0]);

    advance(5 * 60_000 + 1);
    workspace.maps[0].title = "Third edit";
    await store.replace(workspace, 2);
    expect((await store.listSnapshots()).snapshots.map((snapshot) => snapshot.revision)).toEqual([2, 0]);
  });

  it("restores metadata and immutable attachment bytes after permanent deletion", async () => {
    const { store, advance } = await tempStore();
    const attachment = { id: "attachment-recovery", name: "recover.txt", mime: "text/plain", size: 7, createdAt: "2026-09-01T12:00:00.000Z" };
    const attachmentPath = path.join(store.attachmentDirectory, attachment.id);
    await writeFile(attachmentPath, "recover", { mode: 0o600 });

    let workspace = await store.read();
    workspace.nodes[0].attachments.push(attachment);
    workspace = await store.replace(workspace, 0);
    advance(6 * 60_000);
    workspace.nodes[0].trashedAt = "2026-09-01T12:06:00.000Z";
    workspace = await store.replace(workspace, 1);
    const trashedId = workspace.nodes[0].id;
    const candidate = structuredClone(workspace);
    candidate.nodes = candidate.nodes.filter((node) => node.id !== trashedId);
    candidate.edges = candidate.edges.filter((edge) => edge.source !== trashedId && edge.target !== trashedId);
    const purged = await store.purgeTrashedNode(candidate, trashedId, 2);

    await expect(access(attachmentPath)).rejects.toThrow();
    const recoveryPoint = (await store.listSnapshots()).snapshots.find((snapshot) => snapshot.revision === 2);
    expect(recoveryPoint).toMatchObject({ thoughts: workspace.nodes.length, trashed: 1, attachments: 1 });

    const restored = await store.restoreSnapshot(recoveryPoint.id, purged.revision);
    expect(restored.revision).toBe(4);
    expect(restored.nodes.find((node) => node.id === trashedId)).toMatchObject({ trashedAt: "2026-09-01T12:06:00.000Z", attachments: [attachment] });
    expect(await readFile(attachmentPath, "utf8")).toBe("recover");
  });

  it("keeps a manual recovery point idempotent for the current revision", async () => {
    const { store } = await tempStore();
    const first = await store.createSnapshot(0);
    const second = await store.createSnapshot(0);
    expect(second).toEqual(first);
    expect((await store.listSnapshots()).snapshots).toHaveLength(1);
    await expect(store.createSnapshot(1)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("allows an ordinary save to continue but blocks deletion when a safety point cannot capture missing bytes", async () => {
    const { store, advance } = await tempStore();
    let workspace = await store.read();
    const missing = { id: "attachment-missing-snapshot", name: "missing.txt", mime: "text/plain", size: 7, createdAt: "2026-09-01T12:00:00.000Z" };
    workspace.nodes[0].attachments.push(missing);
    workspace = await store.replace(workspace, 0);
    advance(6 * 60_000);
    workspace.maps[0].title = "Still save metadata";
    workspace = await store.replace(workspace, 1);
    expect(workspace.revision).toBe(2);
    expect(await store.readiness()).toMatchObject({ snapshotProblems: 1 });

    const candidate = structuredClone(workspace);
    candidate.nodes[0].attachments = [];
    await expect(store.removeAttachment(candidate, missing.id, 2)).rejects.toMatchObject({ code: "SNAPSHOT_FAILED" });
    expect((await store.read()).revision).toBe(2);
    expect((await store.read()).nodes[0].attachments).toEqual([missing]);
  });

  it("fails closed on corrupt or symlinked recovery metadata without blocking the live workspace", async () => {
    const { store } = await tempStore();
    const point = await store.createSnapshot(0);
    const workspacePath = path.join(store.snapshotDirectory, point.id, "workspace.json");
    await rm(workspacePath);
    await symlink(store.workspacePath, workspacePath);

    const listed = await store.listSnapshots();
    expect(listed.snapshots).toEqual([]);
    expect(listed.problems).toHaveLength(1);
    expect(listed.problems[0]).toMatchObject({ id: point.id });
    expect(listed.problems[0].error).toMatch(/unsafe/i);
    await expect(store.restoreSnapshot(point.id, 0)).rejects.toThrow(/unsafe/i);
    expect((await store.read()).revision).toBe(0);
    expect(await store.readiness()).toMatchObject({ snapshots: 0, snapshotProblems: 1 });
  });

  it("cleans abandoned snapshot staging directories during initialization", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "audhdmap-snapshot-cleanup-"));
    directories.push(dataDirectory);
    const abandonedCapture = path.join(dataDirectory, ".snapshot-staging-11111111-1111-4111-8111-111111111111");
    const abandonedRestore = path.join(dataDirectory, ".snapshot-restore-22222222-2222-4222-8222-222222222222");
    await mkdir(abandonedCapture, { recursive: true });
    await mkdir(abandonedRestore, { recursive: true });
    const store = createWorkspaceStore({ dataDirectory });
    await store.initialize();
    await expect(access(abandonedCapture)).rejects.toThrow();
    await expect(access(abandonedRestore)).rejects.toThrow();
  });
});
