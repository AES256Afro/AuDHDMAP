import { performance } from "node:perf_hooks";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderMapMarkdown, renderMapText } from "../server/exports.mjs";
import { createWorkspaceStore, normalizeWorkspace } from "../server/workspace.mjs";

const nodeCount = 10_000;
const now = "2026-09-01T12:00:00.000Z";
const workspace = {
  schemaVersion: 1,
  revision: 0,
  maps: [{ id: "map-benchmark", title: "Supported limit benchmark", createdAt: now, updatedAt: now }],
  categories: [{ id: "category-benchmark", name: "Thought", color: "#47b6a8", icon: "T" }],
  nodes: Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    mapId: "map-benchmark",
    parentId: index === 0 ? null : `node-${Math.floor((index - 1) / 4)}`,
    groupId: null,
    title: `Benchmark thought ${index}`,
    note: `A bounded note for thought ${index}.`,
    x: (index % 100) * 220,
    y: Math.floor(index / 100) * 120,
    width: 190,
    shape: "rounded",
    categoryId: "category-benchmark",
    tags: ["benchmark"],
    attachments: [],
    links: [],
    task: null,
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  })),
  edges: [], groups: [],
  settings: { theme: "quiet", snapToGrid: true, gridSize: 16, reducedMotion: true, crtEffects: false, brightness: 100, saturation: 100, lineThickness: 2, branchFont: "system", nodeShape: "rounded" },
};

function timed(action) {
  const started = performance.now();
  const value = action();
  return { value, milliseconds: performance.now() - started };
}

const normalized = timed(() => normalizeWorkspace(workspace));
const markdown = timed(() => renderMapMarkdown(normalized.value, "map-benchmark"));
const trashWorkspace = {
  ...normalized.value,
  nodes: normalized.value.nodes.map((node, index) => index % 10 === 0 ? { ...node, trashedAt: "2026-09-01T13:00:00.000Z" } : node),
};
const trashFilteredMarkdown = timed(() => renderMapMarkdown(trashWorkspace, "map-benchmark"));
const deepWorkspace = { ...workspace, nodes: workspace.nodes.map((node, index) => ({ ...node, parentId: index === 0 ? null : `node-${index - 1}` })) };
const deepNormalized = timed(() => normalizeWorkspace(deepWorkspace));
const deepText = timed(() => renderMapText(deepNormalized.value, "map-benchmark"));
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "audhdmap-performance-"));
try {
  const store = createWorkspaceStore({ dataDirectory });
  await store.initialize();
  const saveStarted = performance.now();
  await store.replace(normalized.value, 0);
  const saveMilliseconds = performance.now() - saveStarted;
  const snapshotStarted = performance.now();
  const recoveryPoint = await store.createSnapshot(1);
  const snapshotMilliseconds = performance.now() - snapshotStarted;
  const snapshotListStarted = performance.now();
  const recoveryPoints = await store.listSnapshots();
  const snapshotListMilliseconds = performance.now() - snapshotListStarted;
  const restoreStarted = performance.now();
  await store.restoreSnapshot(recoveryPoint.id, 1);
  const snapshotRestoreMilliseconds = performance.now() - restoreStarted;
  const readStarted = performance.now();
  for (let index = 0; index < 20; index += 1) await store.read();
  const cachedReadMilliseconds = performance.now() - readStarted;
  const report = {
    nodes: nodeCount,
    normalizeMilliseconds: Number(normalized.milliseconds.toFixed(1)),
    markdownMilliseconds: Number(markdown.milliseconds.toFixed(1)),
    markdownBytes: Buffer.byteLength(markdown.value),
    trashFilteredThoughts: trashWorkspace.nodes.filter((node) => !node.trashedAt).length,
    trashFilteredMarkdownMilliseconds: Number(trashFilteredMarkdown.milliseconds.toFixed(1)),
    deepChainNormalizeMilliseconds: Number(deepNormalized.milliseconds.toFixed(1)),
    deepChainTextMilliseconds: Number(deepText.milliseconds.toFixed(1)),
    deepChainTextBytes: Buffer.byteLength(deepText.value),
    saveMilliseconds: Number(saveMilliseconds.toFixed(1)),
    recoveryPointMilliseconds: Number(snapshotMilliseconds.toFixed(1)),
    recoveryPointListMilliseconds: Number(snapshotListMilliseconds.toFixed(1)),
    recoveryPointRestoreMilliseconds: Number(snapshotRestoreMilliseconds.toFixed(1)),
    recoveryPoints: recoveryPoints.snapshots.length,
    twentyDetachedReadsMilliseconds: Number(cachedReadMilliseconds.toFixed(1)),
  };
  console.log(JSON.stringify(report, null, 2));
  if (normalized.milliseconds > 2_000 || markdown.milliseconds > 2_000 || trashFilteredMarkdown.milliseconds > 2_000 || deepNormalized.milliseconds > 2_000 || deepText.milliseconds > 2_000 || saveMilliseconds > 5_000 || snapshotMilliseconds > 5_000 || snapshotListMilliseconds > 5_000 || snapshotRestoreMilliseconds > 5_000 || cachedReadMilliseconds > 5_000) {
    throw new Error("A supported-limit performance budget was exceeded.");
  }
} finally {
  await rm(dataDirectory, { recursive: true, force: true });
}
