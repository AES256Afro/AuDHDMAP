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

export async function uploadAttachment(file: File) {
  return parse<Attachment>(await fetch("/api/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "x-file-name": file.name, "x-file-type": file.type || "application/octet-stream", ...mutationHeaders },
    body: file,
  }));
}

export async function deleteAttachment(id: string) {
  const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE", headers: mutationHeaders });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Could not delete attachment.");
}
