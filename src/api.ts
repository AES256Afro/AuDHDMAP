import type { Attachment, Workspace } from "./model";

const mutationHeaders = { "x-audhdmap-request": "1" };

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed with status ${response.status}.`);
  return body as T;
}

export async function session() {
  return parse<{ authenticated: boolean; username: string | null }>(await fetch("/api/session", { cache: "no-store" }));
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

export async function importWorkspace(workspace: unknown, expectedRevision: number) {
  return parse<Workspace>(await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mutationHeaders },
    body: JSON.stringify({ workspace, expectedRevision }),
  }));
}

export async function restoreBackup(file: File, expectedRevision: number) {
  return parse<Workspace>(await fetch("/api/import/backup", {
    method: "POST",
    headers: { "Content-Type": file.type === "application/zip" ? file.type : "application/octet-stream", "x-audhdmap-revision": String(expectedRevision), ...mutationHeaders },
    body: file,
  }));
}

export function mapExportUrl(format: "pdf" | "svg" | "md" | "txt", mapId: string, focusId: string | null) {
  const query = new URLSearchParams({ mapId });
  if (focusId) query.set("focusId", focusId);
  return `/api/export/map.${format}?${query}`;
}

export async function uploadAttachment(file: File) {
  return parse<Attachment>(await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "x-file-name": file.name, "x-file-type": file.type || "application/octet-stream", ...mutationHeaders },
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
