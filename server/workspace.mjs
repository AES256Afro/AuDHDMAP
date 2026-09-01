import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { defaultWorkspace } from "./default-workspace.mjs";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const hexColor = /^#[0-9a-fA-F]{6}$/;
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
    createdAt: shortString(map?.createdAt, 40, new Date().toISOString()),
    updatedAt: shortString(map?.updatedAt, 40, new Date().toISOString()),
  }));
  const mapIds = new Set(cleanMaps.map((map) => map.id));

  const categoryIds = new Set();
  const cleanCategories = categories.slice(0, 64).map((category) => {
    const id = takeId(category?.id, "Category"); categoryIds.add(id);
    return { id, name: shortString(category?.name, 60, "Category"), color: hexColor.test(category?.color) ? category.color : "#6b7280", icon: shortString(category?.icon, 8, "●") };
  });

  const nodeIds = new Set();
  const cleanNodes = nodes.map((node) => {
    const id = takeId(node?.id, "Node"); nodeIds.add(id);
    if (!mapIds.has(node?.mapId)) throw new Error(`Node ${id} belongs to an unknown map.`);
    const attachments = Array.isArray(node?.attachments) ? node.attachments.slice(0, 100).map((attachment) => ({
      id: shortString(attachment?.id, 96),
      name: shortString(attachment?.name, 240, "attachment"),
      mime: shortString(attachment?.mime, 120, "application/octet-stream"),
      size: finite(attachment?.size, 0, 0, 25 * 1024 * 1024),
      createdAt: shortString(attachment?.createdAt, 40, new Date().toISOString()),
    })).filter((attachment) => idPattern.test(attachment.id)) : [];
    const links = Array.isArray(node?.links) ? node.links.slice(0, 100).map((link) => ({
      id: shortString(link?.id, 96),
      url: validWebUrl(link?.url),
      title: shortString(link?.title, 240, "Web link").trim() || "Web link",
      createdAt: shortString(link?.createdAt, 40, new Date().toISOString()),
    })).filter((link) => idPattern.test(link.id) && link.url) : [];
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
      createdAt: shortString(node.createdAt, 40, new Date().toISOString()),
      updatedAt: shortString(node.updatedAt, 40, new Date().toISOString()),
    };
  });
  for (const node of cleanNodes) {
    if (node.parentId && !nodeIds.has(node.parentId)) node.parentId = null;
    if (node.parentId === node.id) node.parentId = null;
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

export function createWorkspaceStore({ dataDirectory, now = () => new Date() }) {
  if (!dataDirectory) throw new Error("dataDirectory is required");
  const workspacePath = path.join(dataDirectory, "workspace.json");
  const attachmentDirectory = path.join(dataDirectory, "attachments");
  let queue = Promise.resolve();

  async function writeAtomic(document) {
    const temporary = `${workspacePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, workspacePath);
  }

  async function initialize() {
    await mkdir(attachmentDirectory, { recursive: true, mode: 0o700 });
    try { await access(workspacePath, constants.R_OK | constants.W_OK); }
    catch { await writeAtomic(defaultWorkspace(now())); }
    const stored = JSON.parse(await readFile(workspacePath, "utf8"));
    const clean = normalizeWorkspace(stored, { revision: Number.isInteger(stored.revision) ? stored.revision : 0 });
    await writeAtomic(clean);
    return clean;
  }

  async function read() {
    const stored = JSON.parse(await readFile(workspacePath, "utf8"));
    return normalizeWorkspace(stored, { revision: Number.isInteger(stored.revision) ? stored.revision : 0 });
  }

  async function replace(raw, expectedRevision) {
    const work = queue.then(async () => {
      const current = await read();
      if (current.revision !== expectedRevision) {
        const error = new Error("Workspace changed in another session. Reload before saving again.");
        error.code = "REVISION_CONFLICT"; error.current = current; throw error;
      }
      const next = normalizeWorkspace(raw, { revision: current.revision + 1 });
      await writeAtomic(next);
      return next;
    });
    queue = work.catch(() => {});
    return work;
  }

  async function readiness() {
    await access(dataDirectory, constants.R_OK | constants.W_OK);
    const workspace = await read();
    return { revision: workspace.revision, maps: workspace.maps.length, nodes: workspace.nodes.length };
  }

  return { initialize, read, replace, readiness, workspacePath, attachmentDirectory };
}
