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
  task: TaskFields | null;
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
