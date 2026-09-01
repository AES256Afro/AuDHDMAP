import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.mjs";
import { createWorkspaceStore } from "./workspace.mjs";

const resources = [];
afterEach(async () => {
  await Promise.all(resources.splice(0).map(async (resource) => {
    if (resource.server) await new Promise((resolve) => resource.server.close(resolve));
    if (resource.directory) await rm(resource.directory, { recursive: true, force: true });
  }));
});

async function setup({ trustProxy = false, maxBackupBytes } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "audhdmap-api-"));
  const store = createWorkspaceStore({ dataDirectory: directory, now: () => new Date("2026-09-01T12:00:00.000Z") });
  await store.initialize();
  const app = createApp({ store, adminUsername: "owner", adminPassword: "correct horse", sessionSecret: "test-session-secret-is-long-enough", trustProxy, maxBackupBytes, now: () => Date.parse("2026-09-01T12:00:00.000Z"), distDirectory: path.join(directory, "missing-dist") });
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  resources.push({ server, directory });
  const address = server.address();
  return { base: `http://127.0.0.1:${address.port}`, store };
}

async function signIn(base, password = "correct horse") {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ username: "owner", password }) });
  return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

describe("AuDHDMAP API", () => {
  it("exposes bounded readiness without exposing the workspace", async () => {
    const { base } = await setup();
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(health.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(health.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(await health.json()).toMatchObject({ ok: true, storage: "ready", revision: 0, maps: 2 });
    expect((await fetch(`${base}/api/workspace`)).status).toBe(401);
    expect((await fetch(`${base}/api/health`, { headers: { "x-forwarded-proto": "https" } })).headers.get("strict-transport-security")).toBeNull();
  });

  it("honors HTTPS forwarding only when a trusted proxy is explicitly configured", async () => {
    const { base } = await setup({ trustProxy: 1 });
    const health = await fetch(`${base}/api/health`, { headers: { "x-forwarded-proto": "https" } });
    expect(health.headers.get("strict-transport-security")).toBe("max-age=31536000");
    const { response } = await signIn(base);
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
    const proxied = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-audhdmap-request": "1", "x-forwarded-proto": "https" }, body: JSON.stringify({ username: "owner", password: "correct horse" }) });
    expect(proxied.headers.get("set-cookie")).toContain("Secure");
  });

  it("requires the custom mutation header and rejects a wrong password", async () => {
    const { base } = await setup();
    const missingHeader = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(missingHeader.status).toBe(403);
    const { response } = await signIn(base, "wrong");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "The username or password is not correct." });
  });

  it("temporarily blocks repeated login failures", async () => {
    const { base } = await setup();
    for (let attempt = 0; attempt < 6; attempt += 1) expect((await signIn(base, `wrong-${attempt}`)).response.status).toBe(401);
    const blocked = await signIn(base, "correct horse");
    expect(blocked.response.status).toBe(429);
    expect(await blocked.response.json()).toEqual({ error: "Too many attempts. Wait a minute and try again." });
  });

  it("does not let direct clients evade login throttling with spoofed forwarding headers", async () => {
    const { base } = await setup();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-audhdmap-request": "1", "x-forwarded-for": `203.0.113.${attempt + 1}` }, body: JSON.stringify({ username: "owner", password: "wrong" }) });
      expect(response.status).toBe(401);
    }
    expect((await signIn(base)).response.status).toBe(429);
  });

  it("signs in, reads, saves, and detects a stale revision", async () => {
    const { base } = await setup();
    const { response, cookie } = await signIn(base);
    expect(response.status).toBe(200);
    expect(cookie).toMatch(/^audhdmap_session=/);
    const workspace = await (await fetch(`${base}/api/workspace`, { headers: { cookie } })).json();
    workspace.maps[0].title = "Changed through API";
    const savedResponse = await fetch(`${base}/api/workspace`, { method: "PUT", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace, expectedRevision: 0 }) });
    expect(savedResponse.status).toBe(200);
    expect((await savedResponse.json()).revision).toBe(1);
    const stale = await fetch(`${base}/api/workspace`, { method: "PUT", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace, expectedRevision: 0 }) });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/another session/i);
  });

  it("uploads an attachment but does not expose it until workspace metadata references it", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const uploaded = await fetch(`${base}/api/attachments`, { method: "POST", headers: { cookie, "content-type": "application/octet-stream", "x-audhdmap-request": "1", "x-file-name": "notes.txt", "x-file-type": "text/plain" }, body: "hello" });
    expect(uploaded.status).toBe(201);
    const attachment = await uploaded.json();
    expect(attachment).toMatchObject({ name: "notes.txt", mime: "text/plain", size: 5 });
    expect((await fetch(`${base}/api/attachments/${attachment.id}`, { headers: { cookie } })).status).toBe(404);
  });

  it("forces active image formats to download instead of executing at the app origin", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const uploaded = await fetch(`${base}/api/attachments`, { method: "POST", headers: { cookie, "content-type": "application/octet-stream", "x-audhdmap-request": "1", "x-file-name": "unsafe.svg", "x-file-type": "image/svg+xml" }, body: "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>" });
    const attachment = await uploaded.json();
    const workspace = await (await fetch(`${base}/api/workspace`, { headers: { cookie } })).json();
    workspace.nodes[0].attachments.push(attachment);
    const saved = await fetch(`${base}/api/workspace`, { method: "PUT", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace, expectedRevision: 0 }) });
    expect(saved.status).toBe(200);
    const response = await fetch(`${base}/api/attachments/${attachment.id}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("downgrades an image MIME claim when the bytes do not match", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const response = await fetch(`${base}/api/attachments`, { method: "POST", headers: { cookie, "content-type": "application/octet-stream", "x-audhdmap-request": "1", "x-file-name": "not-really.png", "x-file-type": "image/png" }, body: "<html>not an image</html>" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ name: "not-really.png", mime: "application/octet-stream" });
  });

  it("removes attachment metadata and bytes as one revision-checked operation", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const uploaded = await fetch(`${base}/api/attachments`, { method: "POST", headers: { cookie, "content-type": "application/octet-stream", "x-audhdmap-request": "1", "x-file-name": "remove-me.txt", "x-file-type": "text/plain" }, body: "delete safely" });
    const attachment = await uploaded.json();
    const workspace = await (await fetch(`${base}/api/workspace`, { headers: { cookie } })).json();
    workspace.nodes[0].attachments.push(attachment);
    const referenced = await (await fetch(`${base}/api/workspace`, { method: "PUT", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace, expectedRevision: 0 }) })).json();
    const candidate = structuredClone(referenced); candidate.nodes[0].attachments = [];
    const removed = await fetch(`${base}/api/attachments/${attachment.id}`, { method: "DELETE", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace: candidate, expectedRevision: 1 }) });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ revision: 2 });
    expect((await fetch(`${base}/api/attachments/${attachment.id}`, { headers: { cookie } })).status).toBe(404);
  });

  it("requires trash and a current revision before permanently deleting a thought", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const uploaded = await fetch(`${base}/api/attachments`, { method: "POST", headers: { cookie, "content-type": "application/octet-stream", "x-audhdmap-request": "1", "x-file-name": "trash-proof.txt", "x-file-type": "text/plain" }, body: "keep until commit" });
    const attachment = await uploaded.json();
    const workspace = await (await fetch(`${base}/api/workspace`, { headers: { cookie } })).json();
    workspace.nodes[0].attachments.push(attachment);
    const activeDelete = await fetch(`${base}/api/trash/${workspace.nodes[0].id}`, { method: "DELETE", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace, expectedRevision: 0 }) });
    expect(activeDelete.status).toBe(404);

    workspace.nodes[0].trashedAt = "2026-09-01T12:30:00.000Z";
    const trashed = await (await fetch(`${base}/api/workspace`, { method: "PUT", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace, expectedRevision: 0 }) })).json();
    const purgedId = trashed.nodes[0].id;
    const candidate = structuredClone(trashed);
    candidate.nodes = candidate.nodes.filter((node) => node.id !== purgedId);
    candidate.edges = candidate.edges.filter((edge) => edge.source !== purgedId && edge.target !== purgedId);

    const stale = await fetch(`${base}/api/trash/${purgedId}`, { method: "DELETE", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace: candidate, expectedRevision: 0 }) });
    expect(stale.status).toBe(409);
    expect((await fetch(`${base}/api/attachments/${attachment.id}`, { headers: { cookie } })).status).toBe(200);

    const removed = await fetch(`${base}/api/trash/${purgedId}`, { method: "DELETE", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace: candidate, expectedRevision: 1 }) });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ revision: 2 });
    expect((await fetch(`${base}/api/attachments/${attachment.id}`, { headers: { cookie } })).status).toBe(404);
  });

  it("excludes trash from ordinary JSON export", async () => {
    const { base, store } = await setup(); const { cookie } = await signIn(base);
    const workspace = await store.read();
    workspace.nodes[0].trashedAt = "2026-09-01T12:30:00.000Z";
    await store.replace(workspace, 0);
    const response = await fetch(`${base}/api/export`, { headers: { cookie } });
    const exported = await response.json();
    expect(exported.workspace.nodes.some((node) => node.id === workspace.nodes[0].id)).toBe(false);
    expect(exported.workspace.edges.some((edge) => edge.source === workspace.nodes[0].id || edge.target === workspace.nodes[0].id)).toBe(false);
    const exportedIds = new Set(exported.workspace.nodes.map((node) => node.id));
    expect(exported.workspace.nodes.every((node) => node.parentId === null || exportedIds.has(node.parentId))).toBe(true);
  });

  it("exports PDF, SVG, Markdown, and plain text for an authenticated map", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const formats = [
      ["pdf", "application/pdf", "%PDF-"],
      ["svg", "image/svg+xml", "<?xml"],
      ["md", "text/markdown", "# Home server rebuild"],
      ["txt", "text/plain", "Home server rebuild"],
    ];
    for (const [format, contentType, prefix] of formats) {
      const response = await fetch(`${base}/api/export/map.${format}?mapId=map-home-server`, { headers: { cookie } });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
      expect((await response.text()).slice(0, prefix.length)).toBe(prefix);
    }
  });

  it("exports and restores a complete ZIP backup", async () => {
    const { base, store } = await setup(); const { cookie } = await signIn(base);
    const backupResponse = await fetch(`${base}/api/export/backup.zip`, { headers: { cookie } });
    expect(backupResponse.status).toBe(200);
    expect(backupResponse.headers.get("content-type")).toContain("application/zip");
    const backup = Buffer.from(await backupResponse.arrayBuffer());
    expect(backup.subarray(0, 2).toString("ascii")).toBe("PK");

    const workspace = await store.read(); workspace.maps[0].title = "Changed after export";
    await store.replace(workspace, 0);
    const restored = await fetch(`${base}/api/import/backup`, { method: "POST", headers: { cookie, "content-type": "application/zip", "x-audhdmap-request": "1", "x-audhdmap-revision": "1" }, body: backup });
    expect(restored.status).toBe(200);
    const document = await restored.json();
    expect(document.revision).toBe(2);
    expect(document.maps[0].title).toBe("Home server rebuild");
  });

  it("reports backup integrity failures without streaming a partial archive", async () => {
    const { base, store } = await setup(); const { cookie } = await signIn(base);
    const workspace = await store.read();
    workspace.nodes[0].attachments.push({ id: "attachment-missing-export", name: "missing.txt", mime: "text/plain", size: 7, createdAt: "2026-09-01T12:00:00.000Z" });
    await store.replace(workspace, 0);
    const response = await fetch(`${base}/api/export/backup.zip`, { headers: { cookie } });
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Attachment data is missing for missing.txt." });
  });

  it("rejects an oversized backup before writing an upload file", async () => {
    const { base, store } = await setup({ maxBackupBytes: 10 }); const { cookie } = await signIn(base);
    const response = await fetch(`${base}/api/import/backup`, { method: "POST", headers: { cookie, "content-type": "application/zip", "x-audhdmap-request": "1", "x-audhdmap-revision": "0" }, body: Buffer.alloc(11, 1) });
    expect(response.status).toBe(413);
    expect((await readdir(store.dataDirectory)).filter((name) => name.startsWith(".backup-upload-"))).toEqual([]);
  });

  it("rejects an invalid import without changing the current revision", async () => {
    const { base, store } = await setup(); const { cookie } = await signIn(base);
    const response = await fetch(`${base}/api/import`, { method: "POST", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ expectedRevision: 0, workspace: { schemaVersion: 999 } }) });
    expect(response.status).toBe(400);
    expect((await store.read()).revision).toBe(0);
  });
});
