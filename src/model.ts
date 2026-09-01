export type ViewMode = "canvas" | "outline" | "board" | "timeline" | "gantt";
export type ThemeId = "quiet" | "signal" | "amber" | "workstation" | "paper";
export type TaskStatus = "todo" | "doing" | "waiting" | "blocked" | "done";

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface WebLink {
  id: string;
  url: string;
  title: string;
  createdAt: string;
}

export interface TaskFields {
  status: TaskStatus;
  start: string;
  due: string;
  progress: number;
  priority: "low" | "medium" | "high";
  milestone: boolean;
}

export interface ThoughtNode {
  id: string;
  mapId: string;
  parentId: string | null;
  groupId: string | null;
  title: string;
  note: string;
  x: number;
  y: number;
  width: number;
  shape: "rounded" | "square" | "pill" | "oval";
  categoryId: string | null;
  tags: string[];
  attachments: Attachment[];
  links: WebLink[];
  task: TaskFields | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThoughtEdge {
  id: string;
  mapId: string;
  source: string;
  target: string;
  type: "branch" | "reference";
  label: string;
}

export interface MapGroup {
  id: string;
  mapId: string;
  title: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  shape: "rectangle" | "cloud" | "bracket";
  collapsed: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface MapRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSettings {
  theme: ThemeId;
  snapToGrid: boolean;
  gridSize: number;
  reducedMotion: boolean;
  crtEffects: boolean;
  brightness: number;
  saturation: number;
  lineThickness: number;
  branchFont: "system" | "mono" | "serif";
  nodeShape: "rounded" | "square" | "pill" | "oval";
}

export interface Workspace {
  schemaVersion: 1;
  revision: number;
  maps: MapRecord[];
  categories: Category[];
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
  groups: MapGroup[];
  settings: WorkspaceSettings;
}

export const viewLabels: Record<ViewMode, string> = {
  canvas: "Canvas",
  outline: "Outline",
  board: "Board",
  timeline: "Timeline",
  gantt: "Gantt",
};

export const themeLabels: Record<ThemeId, string> = {
  quiet: "Quiet Canvas",
  signal: "Signal Garden",
  amber: "Amber Operator",
  workstation: "Workstation 84",
  paper: "Paper Atlas",
};

export function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isPreviewableImage(mime: string) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(mime);
}

export function isActiveThought(node: ThoughtNode) {
  return node.trashedAt === null;
}

export function descendantThoughtIds(nodes: ThoughtNode[], mapId: string, rootId: string) {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.mapId !== mapId || !node.parentId) continue;
    const siblings = children.get(node.parentId);
    if (siblings) siblings.push(node.id);
    else children.set(node.parentId, [node.id]);
  }
  const included = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (included.has(id)) continue;
    included.add(id);
    for (const childId of children.get(id) ?? []) pending.push(childId);
  }
  return included;
}

export function flattenThoughtHierarchy(nodes: ThoughtNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, ThoughtNode[]>();
  for (const node of nodes) {
    const parentId = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(node);
    else children.set(parentId, [node]);
  }
  const result: { node: ThoughtNode; depth: number }[] = [];
  const visited = new Set<string>();
  const append = (roots: ThoughtNode[], depth: number) => {
    const pending = roots.map((node) => ({ node, depth })).reverse();
    while (pending.length) {
      const item = pending.pop()!;
      if (visited.has(item.node.id)) continue;
      visited.add(item.node.id); result.push(item);
      const descendants = children.get(item.node.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index -= 1) pending.push({ node: descendants[index], depth: item.depth + 1 });
    }
  };
  append(children.get(null) ?? [], 0);
  for (const node of nodes) if (!visited.has(node.id)) append([node], 0);
  return result;
}

export function treeLayoutPositions(nodes: ThoughtNode[]) {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map<string | null, ThoughtNode[]>();
  for (const node of nodes) {
    const parentId = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(node);
    else children.set(parentId, [node]);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  const rowsPerBand = 700;
  const bandCount = Math.max(1, Math.ceil(nodes.length / rowsPerBand));
  const depthColumnsPerBand = Math.max(1, Math.floor(360 / bandCount));
  let row = 0;
  const append = (roots: ThoughtNode[], depth: number) => {
    const pending = roots.map((node) => ({ node, depth })).reverse();
    while (pending.length) {
      const item = pending.pop()!;
      if (visited.has(item.node.id)) continue;
      visited.add(item.node.id);
      const band = Math.floor(row / rowsPerBand);
      const rowInBand = row % rowsPerBand;
      const column = band * depthColumnsPerBand + (item.depth % depthColumnsPerBand);
      positions.set(item.node.id, { x: 100 + column * 270, y: 90 + rowInBand * 135 });
      row += 1;
      const descendants = children.get(item.node.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index -= 1) pending.push({ node: descendants[index], depth: item.depth + 1 });
    }
  };
  append(children.get(null) ?? [], 0);
  for (const node of nodes) if (!visited.has(node.id)) append([node], 0);
  return positions;
}

export function gridLayoutPositions(nodes: ThoughtNode[]) {
  const columns = Math.min(40, Math.max(3, Math.ceil(Math.sqrt(nodes.length))));
  return new Map(nodes.map((node, index) => [node.id, {
    x: 100 + (index % columns) * 280,
    y: 100 + Math.floor(index / columns) * 150,
  }]));
}
