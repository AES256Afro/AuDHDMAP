import type { Attachment, Workspace } from "./model";

const mutationHeaders = { "x-audhdmap-request": "1" };

export interface RecoveryPoint {
  id: string;
  revision: number;
  createdAt: string;
  thoughts: number;
  trashed: number;
  attachments: number;
}

export interface RecoveryPointList {
  snapshots: RecoveryPoint[];
  problems: { id: string; error: string }[];
  warning: string | null;
}

export interface ImportRecordChanges {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  total: number;
}

export interface ImportPreview {
  currentRevision: number;
  nextRevision: number;
  changes: Record<"maps" | "thoughts" | "connections" | "boundaries" | "categories" | "attachments", ImportRecordChanges>;
  totals: { maps: number; thoughts: number; trashed: number; tasks: number; references: number; attachments: number };
  settingsChanged: boolean;
}

export type ImportPreviewResult =
  | { status: "ready"; confirmation: string; preview: ImportPreview }
  | { status: "rejected"; error: string };

export interface SiteConfig {
  publicSite: boolean;
  publicDemo: boolean;
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed with status ${response.status}.`);
  return body as T;
}

export async function session() {
  return parse<{ authenticated: boolean; username: string | null }>(await fetch("/api/session", { cache: "no-store" }));
}

export async function loadSiteConfig() {
  return parse<SiteConfig>(await fetch("/api/config", { cache: "no-store" }));
}

export async function login(username: string, password: string) {
  return parse<{ authenticated: true; username: string }>(await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mutationHeaders },
    body: JSON.stringify({ username, password }),
  }));
}

export async function logout() {
  return parse<{ authenticated: false }>(await fetch("/api/auth/logout", { method: "POST", headers: mutationHeaders }));
}

export async function loadWorkspace() {
  return parse<Workspace>(await fetch("/api/workspace", { cache: "no-store" }));
}

export async function saveWorkspace(workspace: Workspace, expectedRevision: number) {
  return parse<Workspace>(await fetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...mutationHeaders },
    body: JSON.stringify({ workspace, expectedRevision }),
  }));
}

export async function listRecoveryPoints() {
  return parse<RecoveryPointList>(await fetch("/api/snapshots", { cache: "no-store" }));
}

export async function createRecoveryPoint(expectedRevision: number) {
  return parse<{ snapshot: RecoveryPoint }>(await fetch("/api/snapshots", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mutationHeaders },
    body: JSON.stringify({ expectedRevision }),
  }));
}

export async function restoreRecoveryPoint(id: string, expectedRevision: number) {
  return parse<Workspace>(await fetch(`/api/snapshots/${encodeURIComponent(id)}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mutationHeaders },
    body: JSON.stringify({ expectedRevision }),
  }));
}

export async function previewWorkspaceImport(workspace: unknown, expectedRevision: number): Promise<ImportPreviewResult> {
  const response = await fetch("/api/import/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mutationHeaders },
    body: JSON.stringify({ workspace, expectedRevision }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 422) return { status: "rejected", error: body.error || "The JSON file is not a supported AuDHDMAP workspace." };
  if (!response.ok) throw new Error(body.error || `Request failed with status ${response.status}.`);
  return body as ImportPreviewResult;
}

export async function importWorkspace(workspace: unknown, expectedRevision: number, confirmation: string) {
  return parse<Workspace>(await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mutationHeaders },
    body: JSON.stringify({ workspace, expectedRevision, confirmation }),
  }));
}

export async function restoreBackup(file: File, expectedRevision: number) {
  return parse<Workspace>(await fetch("/api/import/backup", {
    method: "POST",
    headers: { "Content-Type": file.type === "application/zip" ? file.type : "application/octet-stream", "x-audhdmap-revision": String(expectedRevision), ...mutationHeaders },
    body: file,
  }));
}

export function mapExportUrl(format: "pdf" | "svg" | "md" | "txt" | "csv", mapId: string, focusId: string | null) {
  const query = new URLSearchParams({ mapId });
  if (focusId) query.set("focusId", focusId);
  return `/api/export/map.${format}?${query}`;
}

export async function uploadAttachment(file: File) {
  return parse<Attachment>(await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name), "x-file-type": file.type || "application/octet-stream", ...mutationHeaders },
    body: file,
  }));
}

export async function deleteAttachment(id: string, workspace: Workspace, expectedRevision: number) {
  return parse<Workspace>(await fetch(`/api/attachments/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...mutationHeaders },
    body: JSON.stringify({ workspace, expectedRevision }),
  }));
}

export async function purgeTrashedThought(id: string, workspace: Workspace, expectedRevision: number) {
  return parse<Workspace>(await fetch(`/api/trash/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...mutationHeaders },
    body: JSON.stringify({ workspace, expectedRevision }),
  }));
}
