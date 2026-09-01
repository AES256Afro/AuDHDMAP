import { createHash, randomUUID } from "node:crypto";
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { defaultWorkspace } from "./default-workspace.mjs";
import { createSnapshotManager } from "./snapshots.mjs";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const hexColor = /^#[0-9a-fA-F]{6}$/;
const fallbackTimestamp = "1970-01-01T00:00:00.000Z";
const themes = new Set(["quiet", "signal", "amber", "workstation", "paper"]);
const statuses = new Set(["todo", "doing", "waiting", "blocked", "done"]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shortString(value, max, fallback = "") {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function finite(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function validTimestamp(value) {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function validWebUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeWorkspace(raw, { revision = 0 } = {}) {
  if (!plainObject(raw)) throw new Error("Workspace must be an object.");
  if (raw.schemaVersion !== 1) throw new Error("Unsupported workspace schema version.");
  const maps = Array.isArray(raw.maps) ? raw.maps : [];
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  const categories = Array.isArray(raw.categories) ? raw.categories : [];
  if (maps.length < 1 || maps.length > 200) throw new Error("Workspace must contain between 1 and 200 maps.");
  if (nodes.length > 10_000 || edges.length > 25_000 || groups.length > 2_000) throw new Error("Workspace is larger than this release supports.");

  const seen = new Set();
  const takeId = (value, kind) => {
    if (typeof value !== "string" || !idPattern.test(value)) throw new Error(`${kind} has an invalid id.`);
    if (seen.has(value)) throw new Error(`Duplicate id: ${value}`);
    seen.add(value);
    return value;
  };

  const cleanMaps = maps.map((map) => ({
    id: takeId(map?.id, "Map"),
    title: shortString(map?.title, 160, "Untitled map").trim() || "Untitled map",
    createdAt: shortString(map?.createdAt, 40, fallbackTimestamp),
    updatedAt: shortString(map?.updatedAt, 40, fallbackTimestamp),
  }));
  const mapIds = new Set(cleanMaps.map((map) => map.id));

  const categoryIds = new Set();
  const cleanCategories = categories.slice(0, 64).map((category) => {
    const id = takeId(category?.id, "Category"); categoryIds.add(id);
    return { id, name: shortString(category?.name, 60, "Category"), color: hexColor.test(category?.color) ? category.color : "#6b7280", icon: shortString(category?.icon, 8, "●") };
  });

  const nodeIds = new Set();
  const attachmentIds = new Set();
  const webLinkIds = new Set();
  const cleanNodes = nodes.map((node) => {
    const id = takeId(node?.id, "Node"); nodeIds.add(id);
    if (!mapIds.has(node?.mapId)) throw new Error(`Node ${id} belongs to an unknown map.`);
    const attachments = Array.isArray(node?.attachments) ? node.attachments.slice(0, 100).map((attachment) => {
      const id = shortString(attachment?.id, 96);
      if (!idPattern.test(id)) return null;
      if (attachmentIds.has(id)) throw new Error(`Duplicate attachment id: ${id}`);
      attachmentIds.add(id);
      return {
        id,
        name: shortString(attachment?.name, 240, "attachment"),
        mime: shortString(attachment?.mime, 120, "application/octet-stream"),
        size: finite(attachment?.size, 0, 0, 25 * 1024 * 1024),
        createdAt: shortString(attachment?.createdAt, 40, fallbackTimestamp),
      };
    }).filter(Boolean) : [];
    const links = Array.isArray(node?.links) ? node.links.slice(0, 100).map((link) => {
      const id = shortString(link?.id, 96);
      const url = validWebUrl(link?.url);
      if (!idPattern.test(id) || !url) return null;
      if (webLinkIds.has(id)) throw new Error(`Duplicate web link id: ${id}`);
      webLinkIds.add(id);
      return {
        id, url,
        title: shortString(link?.title, 240, "Web link").trim() || "Web link",
        createdAt: shortString(link?.createdAt, 40, fallbackTimestamp),
      };
    }).filter(Boolean) : [];
    const task = plainObject(node?.task) ? {
      status: statuses.has(node.task.status) ? node.task.status : "todo",
      start: validDate(node.task.start),
      due: validDate(node.task.due),
      progress: finite(node.task.progress, 0, 0, 100),
      priority: ["low", "medium", "high"].includes(node.task.priority) ? node.task.priority : "medium",
      milestone: Boolean(node.task.milestone),
    } : null;
    return {
      id, mapId: node.mapId,
      parentId: typeof node.parentId === "string" ? node.parentId : null,
      groupId: typeof node.groupId === "string" ? node.groupId : null,
      title: shortString(node.title, 240, "Untitled thought").trim() || "Untitled thought",
      note: shortString(node.note, 200_000),
      x: finite(node.x, 0, -100_000, 100_000), y: finite(node.y, 0, -100_000, 100_000),
      width: finite(node.width, 190, 120, 500),
      shape: ["rounded", "square", "pill", "oval"].includes(node.shape) ? node.shape : "rounded",
      categoryId: categoryIds.has(node.categoryId) ? node.categoryId : null,
      tags: Array.isArray(node.tags) ? node.tags.slice(0, 30).map((tag) => shortString(tag, 40)).filter(Boolean) : [],
      attachments, links, task,
      trashedAt: validTimestamp(node.trashedAt),
      createdAt: shortString(node.createdAt, 40, fallbackTimestamp),
      updatedAt: shortString(node.updatedAt, 40, fallbackTimestamp),
    };
  });
  const nodeById = new Map(cleanNodes.map((node) => [node.id, node]));
  for (const node of cleanNodes) {
    if (node.parentId && (!nodeIds.has(node.parentId) || nodeById.get(node.parentId)?.mapId !== node.mapId)) node.parentId = null;
    if (node.parentId === node.id) node.parentId = null;
  }

  const parentState = new Map();
  for (const start of cleanNodes) {
    if (parentState.get(start.id) === 2) continue;
    const path = [];
    let current = start;
    while (current) {
      const state = parentState.get(current.id) ?? 0;
      if (state === 1) { current.parentId = null; break; }
      if (state === 2) break;
      parentState.set(current.id, 1); path.push(current);
      current = current.parentId ? nodeById.get(current.parentId) : null;
    }
    for (const node of path) parentState.set(node.id, 2);
  }

  const nodeMapIds = new Map(cleanNodes.map((node) => [node.id, node.mapId]));
  const cleanEdges = edges.map((edge) => {
    const id = takeId(edge?.id, "Edge");
    if (!mapIds.has(edge?.mapId) || !nodeIds.has(edge?.source) || !nodeIds.has(edge?.target)) throw new Error(`Edge ${id} has an unknown endpoint.`);
    const sourceMapId = nodeMapIds.get(edge.source);
    const targetMapId = nodeMapIds.get(edge.target);
    const type = edge.type === "reference" ? "reference" : "branch";
    if (type === "branch" && sourceMapId !== targetMapId) throw new Error(`Branch edge ${id} cannot cross maps.`);
    return { id, mapId: sourceMapId, source: edge.source, target: edge.target, type, label: shortString(edge.label, 100) };
  });

  const cleanGroups = groups.map((group) => {
    const id = takeId(group?.id, "Group");
    if (!mapIds.has(group?.mapId)) throw new Error(`Group ${id} belongs to an unknown map.`);
    return {
      id, mapId: group.mapId, title: shortString(group.title, 120, "Group"),
      description: shortString(group.description, 1_000),
      x: finite(group.x, 0, -100_000, 100_000), y: finite(group.y, 0, -100_000, 100_000),
      width: finite(group.width, 400, 180, 10_000), height: finite(group.height, 260, 120, 10_000),
      color: hexColor.test(group.color) ? group.color : "#47b6a8",
      shape: ["rectangle", "cloud", "bracket"].includes(group.shape) ? group.shape : "rectangle",
      collapsed: Boolean(group.collapsed),
    };
  });
  const groupMaps = new Map(cleanGroups.map((group) => [group.id, group.mapId]));
  for (const node of cleanNodes) {
    if (node.groupId && groupMaps.get(node.groupId) !== node.mapId) node.groupId = null;
  }

  const settings = plainObject(raw.settings) ? raw.settings : {};
  return {
    schemaVersion: 1, revision,
    maps: cleanMaps, categories: cleanCategories, nodes: cleanNodes, edges: cleanEdges, groups: cleanGroups,
    settings: {
      theme: themes.has(settings.theme) ? settings.theme : "quiet",
      snapToGrid: settings.snapToGrid !== false,
      gridSize: finite(settings.gridSize, 16, 4, 64),
      reducedMotion: Boolean(settings.reducedMotion),
      crtEffects: settings.crtEffects !== false,
      brightness: finite(settings.brightness, 100, 60, 140),
      saturation: finite(settings.saturation, 100, 0, 160),
      lineThickness: finite(settings.lineThickness, 2, 1, 6),
      branchFont: ["system", "mono", "serif"].includes(settings.branchFont) ? settings.branchFont : "system",
      nodeShape: ["rounded", "square", "pill", "oval"].includes(settings.nodeShape) ? settings.nodeShape : "rounded",
    },
  };
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function importConfirmation(candidate, expectedRevision) {
  const pending = [{ value: candidate, depth: 0 }];
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (value === null || typeof value !== "object") continue;
    if (depth > 32) throw new Error("The JSON import is nested more deeply than this release supports.");
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) pending.push({ value: child, depth: depth + 1 });
  }
  return createHash("sha256").update(JSON.stringify({ expectedRevision, workspace: candidate })).digest("hex");
}

function recordChanges(currentRecords, nextRecords) {
  const current = new Map(currentRecords.map((record) => [record.id, record]));
  const next = new Map(nextRecords.map((record) => [record.id, record]));
  let added = 0; let updated = 0; let unchanged = 0;
  for (const [id, record] of next) {
    if (!current.has(id)) added += 1;
    else if (canonicalJson(current.get(id)) === canonicalJson(record)) unchanged += 1;
    else updated += 1;
  }
  let removed = 0;
  for (const id of current.keys()) if (!next.has(id)) removed += 1;
  return { added, updated, removed, unchanged, total: next.size };
}

function attachmentRecords(workspace) {
  return workspace.nodes.flatMap((node) => node.attachments.map((attachment) => ({ ...attachment, nodeId: node.id })));
}

export function describeImport(current, next) {
  return {
    currentRevision: current.revision,
    nextRevision: current.revision + 1,
    changes: {
      maps: recordChanges(current.maps, next.maps),
      thoughts: recordChanges(current.nodes, next.nodes),
      connections: recordChanges(current.edges, next.edges),
      boundaries: recordChanges(current.groups, next.groups),
      categories: recordChanges(current.categories, next.categories),
      attachments: recordChanges(attachmentRecords(current), attachmentRecords(next)),
    },
    totals: {
      maps: next.maps.length,
      thoughts: next.nodes.filter((node) => !node.trashedAt).length,
      trashed: next.nodes.filter((node) => Boolean(node.trashedAt)).length,
      tasks: next.nodes.filter((node) => Boolean(node.task) && !node.trashedAt).length,
      references: next.edges.filter((edge) => edge.type === "reference").length,
      attachments: attachmentRecords(next).length,
    },
    settingsChanged: canonicalJson(current.settings) !== canonicalJson(next.settings),
  };
}

export function createWorkspaceStore({ dataDirectory, now = () => new Date(), snapshotIntervalMs = 5 * 60_000, maximumSnapshots = 10 }) {
  if (!dataDirectory) throw new Error("dataDirectory is required");
  const workspacePath = path.join(dataDirectory, "workspace.json");
  const attachmentDirectory = path.join(dataDirectory, "attachments");
  const restoreStatePath = path.join(dataDirectory, ".restore-state.json");
  let queue = Promise.resolve();
  let currentDocument = null;
  let lastSnapshotWarning = "";
  const snapshots = createSnapshotManager({
    dataDirectory,
    attachmentDirectory,
    normalizeWorkspace,
    now,
    intervalMs: snapshotIntervalMs,
    maximumSnapshots,
  });

  async function captureSnapshot(document, { force = false, required = false } = {}) {
    try {
      const entry = await snapshots.capture(document, { force });
      if (entry) lastSnapshotWarning = "";
      return entry;
    } catch (error) {
      lastSnapshotWarning = error instanceof Error ? error.message : "AuDHDMAP could not create a recovery point.";
      if (required) {
        const failure = new Error(`AuDHDMAP could not create a recovery point before changing stored data. ${lastSnapshotWarning}`);
        failure.code = "SNAPSHOT_FAILED";
        throw failure;
      }
      return null;
    }
  }

  async function writeAtomic(document) {
    const temporary = `${workspacePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, workspacePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function writeRestoreState(state) {
    const temporary = `${restoreStatePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, restoreStatePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function exists(target) {
    try { await access(target); return true; }
    catch { return false; }
  }

  async function recoverInterruptedRestore() {
    if (!await exists(restoreStatePath)) return;
    let state;
    try { state = JSON.parse(await readFile(restoreStatePath, "utf8")); }
    catch { throw new Error("AuDHDMAP found an unreadable restore recovery marker. Preserve the data directory and repair it before starting."); }
    if (!state || !/^\.attachments-previous-[0-9a-f-]{36}$/i.test(state.previousDirectory) || !Number.isInteger(state.targetRevision) || state.targetRevision < 1) {
      throw new Error("AuDHDMAP found an invalid restore recovery marker. Preserve the data directory and repair it before starting.");
    }
    if (!await exists(workspacePath)) throw new Error("AuDHDMAP found restore recovery state without a workspace. Preserve the data directory and repair it before starting.");
    const stored = JSON.parse(await readFile(workspacePath, "utf8"));
    const previousDirectory = path.join(dataDirectory, state.previousDirectory);
    const previousExists = await exists(previousDirectory);
    const currentExists = await exists(attachmentDirectory);
    if (Number.isInteger(stored.revision) && stored.revision >= state.targetRevision) {
      if (!currentExists) throw new Error("AuDHDMAP cannot finish restore recovery because the committed attachment directory is missing.");
      if (previousExists) await rm(previousDirectory, { recursive: true, force: true });
    } else if (previousExists) {
      if (currentExists) await rm(attachmentDirectory, { recursive: true, force: true });
      await rename(previousDirectory, attachmentDirectory);
    } else if (!currentExists) {
      throw new Error("AuDHDMAP cannot roll back an interrupted restore because both attachment directories are missing.");
    }
    await rm(restoreStatePath, { force: true });
  }

  async function initialize() {
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    await recoverInterruptedRestore();
    await mkdir(attachmentDirectory, { recursive: true, mode: 0o700 });
    try { await access(workspacePath, constants.R_OK | constants.W_OK); }
    catch { await writeAtomic(defaultWorkspace(now())); }
    const stored = JSON.parse(await readFile(workspacePath, "utf8"));
    const clean = normalizeWorkspace(stored, { revision: Number.isInteger(stored.revision) ? stored.revision : 0 });
    await writeAtomic(clean);
    currentDocument = clean;
    await snapshots.initialize();
    return structuredClone(clean);
  }

  async function read() {
    if (!currentDocument) throw new Error("Workspace storage is not initialized.");
    return structuredClone(currentDocument);
  }

  async function replace(raw, expectedRevision) {
    const work = queue.then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) {
        const error = new Error("Workspace changed in another session. Reload before saving again.");
        error.code = "REVISION_CONFLICT"; error.current = current; throw error;
      }
      const next = normalizeWorkspace(raw, { revision: current.revision + 1 });
      await captureSnapshot(current);
      await writeAtomic(next);
      currentDocument = next;
      return structuredClone(next);
    });
    queue = work.catch(() => {});
    return work;
  }

  async function assertImportAttachments(next) {
    const attachments = attachmentRecords(next);
    const problems = [];
    for (let start = 0; start < attachments.length; start += 64) {
      const batch = attachments.slice(start, start + 64);
      const results = await Promise.all(batch.map(async (attachment) => {
        try {
          const info = await lstat(path.join(attachmentDirectory, attachment.id));
          return info.isFile() && !info.isSymbolicLink() && info.size === attachment.size ? null : attachment;
        } catch { return attachment; }
      }));
      problems.push(...results.filter(Boolean));
      if (problems.length >= 8) break;
    }
    if (problems.length) {
      const names = problems.slice(0, 3).map((attachment) => attachment.name).join(", ");
      const error = new Error(`The JSON references attachment data that is missing or has a different size (${names}${problems.length > 3 ? ", ..." : ""}). Use a complete ZIP backup when moving attachments between servers.`);
      error.code = "IMPORT_ATTACHMENT_MISSING";
      throw error;
    }
  }

  async function previewImport(raw, expectedRevision) {
    const work = queue.then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) {
        const error = new Error("Workspace changed in another session. Reload before previewing the import again.");
        error.code = "REVISION_CONFLICT"; error.current = current; throw error;
      }
      const next = normalizeWorkspace(raw, { revision: current.revision + 1 });
      await assertImportAttachments(next);
      return {
        status: "ready",
        confirmation: importConfirmation(raw, expectedRevision),
        preview: describeImport(current, next),
      };
    });
    return work;
  }

  async function replaceImported(raw, expectedRevision, confirmation) {
    const work = queue.then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) {
        const error = new Error("Workspace changed in another session. Preview the import again before replacing it.");
        error.code = "REVISION_CONFLICT"; error.current = current; throw error;
      }
      const next = normalizeWorkspace(raw, { revision: current.revision + 1 });
      if (typeof confirmation !== "string" || !/^[a-f0-9]{64}$/.test(confirmation) || confirmation !== importConfirmation(raw, expectedRevision)) {
        const error = new Error("Preview this exact JSON file before importing it.");
        error.code = "IMPORT_NOT_PREVIEWED";
        throw error;
      }
      await assertImportAttachments(next);
      const nextAttachmentIds = new Set(attachmentRecords(next).map((attachment) => attachment.id));
      const removedAttachmentIds = attachmentRecords(current).map((attachment) => attachment.id).filter((id) => !nextAttachmentIds.has(id));
      await captureSnapshot(current, { force: true, required: true });
      await writeAtomic(next);
      currentDocument = next;
      await Promise.all(removedAttachmentIds.map((id) => rm(path.join(attachmentDirectory, id), { force: true }).catch(() => {})));
      return structuredClone(next);
    });
    queue = work.catch(() => {});
    return work;
  }

  async function removeAttachment(raw, attachmentId, expectedRevision) {
    const work = queue.then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) {
        const error = new Error("Workspace changed in another session. Reload before removing the attachment.");
        error.code = "REVISION_CONFLICT"; error.current = current; throw error;
      }
      const currentReferences = current.nodes.some((node) => node.attachments.some((attachment) => attachment.id === attachmentId));
      if (!currentReferences) {
        const error = new Error("Attachment not found.");
        error.code = "ATTACHMENT_NOT_FOUND";
        throw error;
      }
      const next = normalizeWorkspace(raw, { revision: current.revision + 1 });
      const nextReferences = next.nodes.some((node) => node.attachments.some((attachment) => attachment.id === attachmentId));
      if (nextReferences) throw new Error("Remove the attachment from the workspace before deleting its data.");
      await captureSnapshot(current, { force: true, required: true });
      await writeAtomic(next);
      currentDocument = next;
      await rm(path.join(attachmentDirectory, attachmentId), { force: true }).catch(() => {});
      return structuredClone(next);
    });
    queue = work.catch(() => {});
    return work;
  }

  async function purgeTrashedNode(raw, nodeId, expectedRevision) {
    const work = queue.then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) {
        const error = new Error("Workspace changed in another session. Reload before permanently deleting the thought.");
        error.code = "REVISION_CONFLICT"; error.current = current; throw error;
      }
      const currentNode = current.nodes.find((node) => node.id === nodeId);
      if (!currentNode) {
        const error = new Error("Thought not found.");
        error.code = "NODE_NOT_FOUND";
        throw error;
      }
      if (!currentNode.trashedAt) {
        const error = new Error("Move the thought to trash before permanently deleting it.");
        error.code = "NODE_NOT_TRASHED";
        throw error;
      }
      const attachmentIds = new Set(currentNode.attachments.map((attachment) => attachment.id));
      const next = normalizeWorkspace(raw, { revision: current.revision + 1 });
      if (next.nodes.some((node) => node.id === nodeId)) throw new Error("Remove the thought from the workspace before permanently deleting it.");
      if (next.edges.some((edge) => edge.source === nodeId || edge.target === nodeId)) throw new Error("Remove every link to the thought before permanently deleting it.");
      if (next.nodes.some((node) => node.attachments.some((attachment) => attachmentIds.has(attachment.id)))) {
        throw new Error("Remove the thought's attachments from workspace metadata before permanently deleting it.");
      }
      await captureSnapshot(current, { force: true, required: true });
      await writeAtomic(next);
      currentDocument = next;
      await Promise.all([...attachmentIds].map((attachmentId) => rm(path.join(attachmentDirectory, attachmentId), { force: true }).catch(() => {})));
      return structuredClone(next);
    });
    queue = work.catch(() => {});
    return work;
  }

  async function replaceWithStagedAttachments(current, raw, stagedAttachmentDirectory) {
    await access(stagedAttachmentDirectory, constants.R_OK | constants.W_OK);
    const next = normalizeWorkspace(raw, { revision: current.revision + 1 });
    await captureSnapshot(current, { force: true, required: true });
    const previousDirectory = path.join(dataDirectory, `.attachments-previous-${randomUUID()}`);
    await writeRestoreState({ previousDirectory: path.basename(previousDirectory), targetRevision: next.revision });
    let previousMoved = false;
    let stagedMoved = false;
    try {
      await rename(attachmentDirectory, previousDirectory); previousMoved = true;
      await rename(stagedAttachmentDirectory, attachmentDirectory);
      stagedMoved = true;
      await writeAtomic(next);
    } catch (error) {
      let rolledBack = true;
      if (stagedMoved) await rm(attachmentDirectory, { recursive: true, force: true }).catch(() => { rolledBack = false; });
      if (previousMoved) await rename(previousDirectory, attachmentDirectory).catch(() => { rolledBack = false; });
      if (rolledBack) await rm(restoreStatePath, { force: true }).catch(() => {});
      throw error;
    }
    currentDocument = next;
    await rm(previousDirectory, { recursive: true, force: true }).catch(() => {});
    await rm(restoreStatePath, { force: true }).catch(() => {});
    return structuredClone(next);
  }

  async function restore(raw, expectedRevision, stagedAttachmentDirectory) {
    const work = queue.then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) {
        const error = new Error("Workspace changed in another session. Reload before restoring a backup.");
        error.code = "REVISION_CONFLICT"; error.current = current; throw error;
      }
      return replaceWithStagedAttachments(current, raw, stagedAttachmentDirectory);
    });
    queue = work.catch(() => {});
    return work;
  }

  async function listSnapshots() {
    const state = await snapshots.list();
    return { ...state, warning: lastSnapshotWarning || null };
  }

  async function createSnapshot(expectedRevision) {
    const work = queue.then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) {
        const error = new Error("Workspace changed in another session. Reload before creating a recovery point.");
        error.code = "REVISION_CONFLICT"; error.current = current; throw error;
      }
      const snapshot = await captureSnapshot(current, { force: true, required: true });
      return snapshot;
    });
    queue = work.catch(() => {});
    return work;
  }

  async function restoreSnapshot(id, expectedRevision) {
    const work = queue.then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) {
        const error = new Error("Workspace changed in another session. Reload before restoring a recovery point.");
        error.code = "REVISION_CONFLICT"; error.current = current; throw error;
      }
      const staged = await snapshots.stage(id);
      try { return await replaceWithStagedAttachments(current, staged.workspace, staged.stagedAttachmentDirectory); }
      finally { await rm(staged.stagedAttachmentDirectory, { recursive: true, force: true }); }
    });
    queue = work.catch(() => {});
    return work;
  }

  async function readiness() {
    await access(dataDirectory, constants.R_OK | constants.W_OK);
    const workspace = await read();
    const trashed = workspace.nodes.filter((node) => node.trashedAt).length;
    const snapshotStatus = snapshots.status();
    return {
      revision: workspace.revision,
      maps: workspace.maps.length,
      nodes: workspace.nodes.length - trashed,
      trashed,
      snapshots: snapshotStatus.snapshots,
      snapshotProblems: snapshotStatus.snapshotProblems + (lastSnapshotWarning ? 1 : 0),
    };
  }

  return {
    initialize, read, replace, previewImport, replaceImported, removeAttachment, purgeTrashedNode, restore,
    listSnapshots, createSnapshot, restoreSnapshot, readiness,
    dataDirectory, workspacePath, attachmentDirectory, snapshotDirectory: snapshots.root,
  };
}
