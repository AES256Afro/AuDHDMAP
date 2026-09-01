import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, link, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const snapshotIdPattern = /^snapshot-r(0|[1-9]\d{0,9})-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function timestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Recovery point time is invalid.");
  return date.toISOString();
}

function attachmentInventory(workspace) {
  const inventory = new Map();
  for (const node of workspace.nodes) for (const attachment of node.attachments) inventory.set(attachment.id, attachment);
  return inventory;
}

async function linkOrCopy(source, destination) {
  try { await link(source, destination); }
  catch { await copyFile(source, destination, constants.COPYFILE_EXCL); }
}

export function createSnapshotManager({
  dataDirectory,
  attachmentDirectory,
  normalizeWorkspace,
  now = () => new Date(),
  intervalMs = 5 * 60_000,
  maximumSnapshots = 10,
}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error("snapshot interval must be a non-negative number");
  if (!Number.isInteger(maximumSnapshots) || maximumSnapshots < 1 || maximumSnapshots > 100) throw new Error("maximumSnapshots must be between 1 and 100");
  const root = path.join(dataDirectory, "snapshots");
  let lastEntry = null;
  let lastProblems = [];
  let validSnapshotCount = 0;

  function snapshotPath(id) {
    if (typeof id !== "string" || !snapshotIdPattern.test(id)) {
      const error = new Error("Recovery point not found."); error.code = "SNAPSHOT_NOT_FOUND"; throw error;
    }
    return path.join(root, id);
  }

  async function readSnapshot(id) {
    const directory = snapshotPath(id);
    let manifest;
    let rawWorkspace;
    try {
      const topLevel = await readdir(directory, { withFileTypes: true });
      const names = topLevel.map((entry) => entry.name).sort();
      if (names.join("\n") !== "attachments\nmanifest.json\nworkspace.json") throw new Error("Recovery point contains unexpected files.");
      const attachmentsEntry = topLevel.find((entry) => entry.name === "attachments");
      const manifestEntry = topLevel.find((entry) => entry.name === "manifest.json");
      const workspaceEntry = topLevel.find((entry) => entry.name === "workspace.json");
      if (!attachmentsEntry?.isDirectory() || attachmentsEntry.isSymbolicLink()) throw new Error("Recovery point attachment storage is unsafe.");
      if (!manifestEntry?.isFile() || manifestEntry.isSymbolicLink() || !workspaceEntry?.isFile() || workspaceEntry.isSymbolicLink()) throw new Error("Recovery point metadata is unsafe.");
      manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
      rawWorkspace = JSON.parse(await readFile(path.join(directory, "workspace.json"), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") { const missing = new Error("Recovery point not found."); missing.code = "SNAPSHOT_NOT_FOUND"; throw missing; }
      throw new Error(`Recovery point ${id} is unreadable: ${error.message}`);
    }
    const idMatch = snapshotIdPattern.exec(id);
    if (manifest?.format !== "audhdmap-snapshot" || manifest?.snapshotVersion !== 1 || manifest?.application !== "AuDHDMAP" || manifest?.schemaVersion !== 1 || manifest?.id !== id || !Number.isInteger(manifest.workspaceRevision) || manifest.workspaceRevision < 0 || Number(idMatch?.[1]) !== manifest.workspaceRevision) {
      throw new Error(`Recovery point ${id} has an invalid manifest.`);
    }
    const createdAt = typeof manifest.createdAt === "string" && Number.isFinite(Date.parse(manifest.createdAt)) ? new Date(manifest.createdAt).toISOString() : null;
    if (!createdAt || rawWorkspace?.revision !== manifest.workspaceRevision) throw new Error(`Recovery point ${id} does not match its workspace.`);
    const workspace = normalizeWorkspace(rawWorkspace, { revision: manifest.workspaceRevision });
    const inventory = attachmentInventory(workspace);
    const declared = new Map();
    if (!Array.isArray(manifest.attachments)) throw new Error(`Recovery point ${id} has no attachment inventory.`);
    for (const attachment of manifest.attachments) {
      if (!attachment || typeof attachment.id !== "string" || declared.has(attachment.id) || !Number.isInteger(attachment.size) || attachment.size < 0) throw new Error(`Recovery point ${id} has an invalid attachment inventory.`);
      declared.set(attachment.id, attachment);
    }
    const storedNames = (await readdir(path.join(directory, "attachments"), { withFileTypes: true })).map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Recovery point ${id} contains unsafe attachment data.`);
      return entry.name;
    }).sort();
    if (inventory.size !== declared.size || storedNames.join("\n") !== [...inventory.keys()].sort().join("\n")) throw new Error(`Recovery point ${id} attachment inventory does not match its workspace.`);
    for (const [attachmentId, metadata] of inventory) {
      const item = declared.get(attachmentId);
      if (!item || item.name !== metadata.name || item.mime !== metadata.mime || item.size !== metadata.size) throw new Error(`Recovery point ${id} attachment metadata does not match.`);
      const info = await lstat(path.join(directory, "attachments", attachmentId));
      if (!info.isFile() || info.isSymbolicLink() || info.size !== metadata.size) throw new Error(`Recovery point ${id} attachment data is incomplete.`);
    }
    return {
      id,
      revision: workspace.revision,
      createdAt,
      thoughts: workspace.nodes.length,
      trashed: workspace.nodes.filter((node) => node.trashedAt).length,
      attachments: inventory.size,
      workspace,
      directory,
    };
  }

  async function inspect() {
    const snapshots = [];
    const problems = [];
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !snapshotIdPattern.test(entry.name)) continue;
      try {
        const snapshot = await readSnapshot(entry.name);
        const { workspace: _workspace, directory: _directory, ...description } = snapshot;
        snapshots.push(description);
      } catch (error) { problems.push({ id: entry.name, error: error.message }); }
    }
    snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.revision - left.revision || right.id.localeCompare(left.id));
    problems.sort((left, right) => left.id.localeCompare(right.id));
    return { snapshots, problems };
  }

  async function initialize() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    const entries = await readdir(dataDirectory, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory() && (/^\.snapshot-staging-[0-9a-f-]{36}$/i.test(entry.name) || /^\.snapshot-restore-[0-9a-f-]{36}$/i.test(entry.name)))
      .map((entry) => rm(path.join(dataDirectory, entry.name), { recursive: true, force: true })));
    const state = await inspect();
    lastEntry = state.snapshots[0] ?? null;
    lastProblems = state.problems;
    validSnapshotCount = state.snapshots.length;
    return state;
  }

  async function capture(workspace, { force = false } = {}) {
    if (lastEntry?.revision === workspace.revision) {
      try {
        await readSnapshot(lastEntry.id);
        return lastEntry;
      } catch (error) {
        const failedId = lastEntry.id;
        lastEntry = null;
        validSnapshotCount = Math.max(0, validSnapshotCount - 1);
        lastProblems = [...lastProblems, { id: failedId, error: error.message }];
      }
    }
    const createdAt = timestamp(now);
    const elapsed = lastEntry ? Date.parse(createdAt) - Date.parse(lastEntry.createdAt) : null;
    if (!force && lastEntry && elapsed >= 0 && elapsed < intervalMs) return null;
    const id = `snapshot-r${workspace.revision}-${randomUUID()}`;
    const staging = path.join(dataDirectory, `.snapshot-staging-${randomUUID()}`);
    const stagingAttachments = path.join(staging, "attachments");
    const inventory = attachmentInventory(workspace);
    try {
      await mkdir(stagingAttachments, { recursive: true, mode: 0o700 });
      for (const [attachmentId, metadata] of inventory) {
        const source = path.join(attachmentDirectory, attachmentId);
        const info = await lstat(source);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== metadata.size) throw new Error(`Cannot create a recovery point because attachment data is incomplete for ${metadata.name}.`);
        await linkOrCopy(source, path.join(stagingAttachments, attachmentId));
      }
      const manifest = {
        format: "audhdmap-snapshot", snapshotVersion: 1, application: "AuDHDMAP", schemaVersion: 1, id, createdAt,
        workspaceRevision: workspace.revision,
        attachments: [...inventory.values()].map(({ id: attachmentId, name, mime, size }) => ({ id: attachmentId, name, mime, size })),
      };
      await writeFile(path.join(staging, "workspace.json"), `${JSON.stringify(workspace, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await rename(staging, path.join(root, id));
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const entry = { id, revision: workspace.revision, createdAt, thoughts: workspace.nodes.length, trashed: workspace.nodes.filter((node) => node.trashedAt).length, attachments: inventory.size };
    const state = await inspect();
    await Promise.all(state.snapshots.slice(maximumSnapshots).map((snapshot) => rm(path.join(root, snapshot.id), { recursive: true, force: true })));
    const retained = state.snapshots.slice(0, maximumSnapshots);
    lastEntry = retained[0] ?? entry;
    lastProblems = state.problems;
    validSnapshotCount = retained.length;
    return entry;
  }

  async function list() {
    const state = await inspect();
    lastEntry = state.snapshots[0] ?? null;
    lastProblems = state.problems;
    validSnapshotCount = state.snapshots.length;
    return state;
  }

  async function stage(id) {
    const snapshot = await readSnapshot(id);
    const staging = path.join(dataDirectory, `.snapshot-restore-${randomUUID()}`);
    try {
      await mkdir(staging, { mode: 0o700 });
      for (const attachmentId of attachmentInventory(snapshot.workspace).keys()) {
        await linkOrCopy(path.join(snapshot.directory, "attachments", attachmentId), path.join(staging, attachmentId));
      }
      return { workspace: snapshot.workspace, stagedAttachmentDirectory: staging };
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  function status() {
    return { snapshots: validSnapshotCount, snapshotProblems: lastProblems.length };
  }

  return { root, initialize, capture, list, stage, status };
}
