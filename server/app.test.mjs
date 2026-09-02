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

async function setup({ trustProxy = false, maxBackupBytes, readinessError = null, requestLimits } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "audhdmap-api-"));
  const store = createWorkspaceStore({ dataDirectory: directory, now: () => new Date("2026-09-01T12:00:00.000Z") });
  await store.initialize();
  if (readinessError) store.readiness = async () => { throw readinessError; };
  const app = createApp({ store, adminUsername: "owner", adminPassword: "correct horse", sessionSecret: "test-session-secret-is-long-enough", trustProxy, maxBackupBytes, requestLimits, now: () => Date.parse("2026-09-01T12:00:00.000Z"), distDirectory: path.join(directory, "missing-dist") });
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

  it("does not disclose storage failure details through public health", async () => {
    const { base } = await setup({ readinessError: new Error("private path /data/workspace.json failed") });
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({ ok: false, version: "development", storage: "unavailable" });
  });

  it("treats malformed cookie encoding as an invalid anonymous session", async () => {
    const { base } = await setup();
    const headers = { cookie: "audhdmap_session=%E0%A4%A" };
    const session = await fetch(`${base}/api/session`, { headers });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ authenticated: false, username: null });
    expect((await fetch(`${base}/api/workspace`, { headers })).status).toBe(401);
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

  it("rate-limits filesystem-heavy routes before repeating their work", async () => {
    const { base } = await setup({ requestLimits: { backupImports: 1, backupExports: 1, mapExports: 1, attachmentWrites: 1, attachmentReads: 1 } });
    const { cookie } = await signIn(base);
    const applicationHeaders = { cookie, "x-audhdmap-request": "1" };
    const uploaded = await fetch(`${base}/api/attachments`, { method: "POST", headers: { ...applicationHeaders, "content-type": "application/octet-stream", "x-file-name": "limited.txt", "x-file-type": "text/plain" }, body: "limited" });
    expect(uploaded.status).toBe(201);
    const attachment = await uploaded.json();
    const repeatedUpload = await fetch(`${base}/api/attachments`, { method: "POST", headers: { ...applicationHeaders, "content-type": "application/octet-stream", "x-file-name": "blocked.txt", "x-file-type": "text/plain" }, body: "blocked" });
    expect(repeatedUpload.status).toBe(429);
    expect(await repeatedUpload.json()).toEqual({ error: "Too many attachment uploads. Wait before trying again." });

    const workspace = await (await fetch(`${base}/api/workspace`, { headers: { cookie } })).json();
    workspace.nodes[0].attachments.push(attachment);
    expect((await fetch(`${base}/api/workspace`, { method: "PUT", headers: { ...applicationHeaders, "content-type": "application/json" }, body: JSON.stringify({ workspace, expectedRevision: 0 }) })).status).toBe(200);
    expect((await fetch(`${base}/api/attachments/${attachment.id}`, { headers: { cookie } })).status).toBe(200);
    const repeatedDownload = await fetch(`${base}/api/attachments/${attachment.id}`, { headers: { cookie } });
    expect(repeatedDownload.status).toBe(429);
    expect(await repeatedDownload.json()).toEqual({ error: "Too many attachment downloads. Wait before trying again." });

    expect((await fetch(`${base}/api/export/map.txt?mapId=map-home-server`, { headers: { cookie } })).status).toBe(200);
    const repeatedMapExport = await fetch(`${base}/api/export/map.pdf?mapId=map-home-server`, { headers: { cookie } });
    expect(repeatedMapExport.status).toBe(429);
    expect(await repeatedMapExport.json()).toEqual({ error: "Too many map exports. Wait before trying again." });

    expect((await fetch(`${base}/api/export/backup.zip`, { headers: { cookie } })).status).toBe(200);
    const repeatedBackupExport = await fetch(`${base}/api/export/backup.zip`, { headers: { cookie } });
    expect(repeatedBackupExport.status).toBe(429);
    expect(await repeatedBackupExport.json()).toEqual({ error: "Too many complete backups. Wait before trying again." });

    const restoreHeaders = { ...applicationHeaders, "content-type": "application/zip", "x-audhdmap-revision": "1" };
    expect((await fetch(`${base}/api/import/backup`, { method: "POST", headers: restoreHeaders, body: "not a zip" })).status).toBe(400);
    const repeatedRestore = await fetch(`${base}/api/import/backup`, { method: "POST", headers: restoreHeaders, body: "still not a zip" });
    expect(repeatedRestore.status).toBe(429);
    expect(await repeatedRestore.json()).toEqual({ error: "Too many backup restores. Wait before trying again." });
  });

  it("authenticates before parsing large-route JSON and keeps login bodies small", async () => {
    const { base } = await setup();
    const unauthorizedMalformed = await fetch(`${base}/api/workspace`, { method: "PUT", headers: { "content-type": "application/json", "x-audhdmap-request": "1" }, body: "{" });
    expect(unauthorizedMalformed.status).toBe(401);
    expect(await unauthorizedMalformed.json()).toEqual({ error: "Sign in to continue." });

    const malformedLogin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-audhdmap-request": "1" }, body: "{" });
    expect(malformedLogin.status).toBe(400);
    expect(await malformedLogin.json()).toEqual({ error: "The request does not contain valid JSON." });

    const oversizedLogin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ username: "owner", password: "x".repeat(70 * 1024) }) });
    expect(oversizedLogin.status).toBe(413);
    expect(await oversizedLogin.json()).toEqual({ error: "The request is larger than this server accepts." });
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

  it("accepts an authenticated workspace body larger than the small-route ceiling", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const workspace = await (await fetch(`${base}/api/workspace`, { headers: { cookie } })).json();
    workspace.nodes[0].note = "x".repeat(70 * 1024);
    const saved = await fetch(`${base}/api/workspace`, { method: "PUT", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace, expectedRevision: 0 }) });
    expect(saved.status).toBe(200);
    expect((await saved.json()).nodes[0].note).toHaveLength(70 * 1024);
  });

  it("creates, lists, and revision-checks server-local recovery points", async () => {
    const { base } = await setup();
    expect((await fetch(`${base}/api/snapshots`)).status).toBe(401);
    const { cookie } = await signIn(base);
    const headers = { cookie, "content-type": "application/json", "x-audhdmap-request": "1" };
    const workspace = await (await fetch(`${base}/api/workspace`, { headers: { cookie } })).json();
    workspace.maps[0].title = "Keep this revision";
    const revisionOne = await (await fetch(`${base}/api/workspace`, { method: "PUT", headers, body: JSON.stringify({ workspace, expectedRevision: 0 }) })).json();
    const created = await fetch(`${base}/api/snapshots`, { method: "POST", headers, body: JSON.stringify({ expectedRevision: 1 }) });
    expect(created.status).toBe(200);
    const point = (await created.json()).snapshot;
    expect(point).toMatchObject({ revision: 1 });

    revisionOne.maps[0].title = "Change after recovery point";
    const revisionTwo = await (await fetch(`${base}/api/workspace`, { method: "PUT", headers, body: JSON.stringify({ workspace: revisionOne, expectedRevision: 1 }) })).json();
    const stale = await fetch(`${base}/api/snapshots/${point.id}/restore`, { method: "POST", headers, body: JSON.stringify({ expectedRevision: 1 }) });
    expect(stale.status).toBe(409);
    const restored = await fetch(`${base}/api/snapshots/${point.id}/restore`, { method: "POST", headers, body: JSON.stringify({ expectedRevision: revisionTwo.revision }) });
    expect(restored.status).toBe(200);
    const restoredWorkspace = await restored.json();
    expect(restoredWorkspace.revision).toBe(3);
    expect(restoredWorkspace.maps[0].title).toBe("Keep this revision");

    const listed = await fetch(`${base}/api/snapshots`, { headers: { cookie } });
    expect(listed.headers.get("cache-control")).toBe("private, no-store");
    expect((await listed.json()).snapshots.map((snapshot) => snapshot.revision)).toEqual(expect.arrayContaining([0, 1, 2]));
    const missing = await fetch(`${base}/api/snapshots/not-a-recovery-point/restore`, { method: "POST", headers, body: JSON.stringify({ expectedRevision: 3 }) });
    expect(missing.status).toBe(404);
  });

  it("uploads an attachment but does not expose it until workspace metadata references it", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const uploaded = await fetch(`${base}/api/attachments`, { method: "POST", headers: { cookie, "content-type": "application/octet-stream", "x-audhdmap-request": "1", "x-file-name": "notes.txt", "x-file-type": "text/plain" }, body: "hello" });
    expect(uploaded.status).toBe(201);
    const attachment = await uploaded.json();
    expect(attachment).toMatchObject({ name: "notes.txt", mime: "text/plain", size: 5 });
    expect((await fetch(`${base}/api/attachments/${attachment.id}`, { headers: { cookie } })).status).toBe(404);
  });

  it("round-trips Unicode attachment names through safe request and download headers", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const name = "Résumé 🧠.txt";
    const uploaded = await fetch(`${base}/api/attachments`, { method: "POST", headers: { cookie, "content-type": "application/octet-stream", "x-audhdmap-request": "1", "x-file-name": encodeURIComponent(name), "x-file-type": "text/plain" }, body: "hello" });
    expect(uploaded.status).toBe(201);
    const attachment = await uploaded.json();
    expect(attachment.name).toBe(name);
    const workspace = await (await fetch(`${base}/api/workspace`, { headers: { cookie } })).json();
    workspace.nodes[0].attachments.push(attachment);
    expect((await fetch(`${base}/api/workspace`, { method: "PUT", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ workspace, expectedRevision: 0 }) })).status).toBe(200);
    const downloaded = await fetch(`${base}/api/attachments/${attachment.id}`, { headers: { cookie } });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded.headers.get("content-disposition")).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%F0%9F%A7%A0.txt");
    expect(await downloaded.text()).toBe("hello");
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
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const exported = await response.json();
    expect(exported.workspace.nodes.some((node) => node.id === workspace.nodes[0].id)).toBe(false);
    expect(exported.workspace.edges.some((edge) => edge.source === workspace.nodes[0].id || edge.target === workspace.nodes[0].id)).toBe(false);
    const exportedIds = new Set(exported.workspace.nodes.map((node) => node.id));
    expect(exported.workspace.nodes.every((node) => node.parentId === null || exportedIds.has(node.parentId))).toBe(true);
  });

  it("previews and content-binds JSON import before a recovery-protected replacement", async () => {
    const { base, store } = await setup(); const { cookie } = await signIn(base);
    const headers = { cookie, "content-type": "application/json", "x-audhdmap-request": "1" };
    const workspace = await store.read();
    workspace.maps[0].title = "Previewed import";
    workspace.nodes.pop();

    const rejected = await fetch(`${base}/api/import/preview`, { method: "POST", headers, body: JSON.stringify({ workspace: { schemaVersion: 99 }, expectedRevision: 0 }) });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ status: "rejected", error: expect.stringMatching(/schema version/i) });
    expect((await store.read()).revision).toBe(0);

    const previewed = await fetch(`${base}/api/import/preview`, { method: "POST", headers, body: JSON.stringify({ workspace, expectedRevision: 0 }) });
    expect(previewed.status).toBe(200);
    expect(previewed.headers.get("cache-control")).toBe("private, no-store");
    const preview = await previewed.json();
    expect(preview).toMatchObject({ status: "ready", confirmation: expect.stringMatching(/^[a-f0-9]{64}$/), preview: { currentRevision: 0, nextRevision: 1 } });

    const withoutPreview = await fetch(`${base}/api/import`, { method: "POST", headers, body: JSON.stringify({ workspace, expectedRevision: 0 }) });
    expect(withoutPreview.status).toBe(409);
    const tampered = structuredClone(workspace); tampered.maps[0].title = "Different payload";
    const mismatched = await fetch(`${base}/api/import`, { method: "POST", headers, body: JSON.stringify({ workspace: tampered, expectedRevision: 0, confirmation: preview.confirmation }) });
    expect(mismatched.status).toBe(409);
    expect((await store.read()).revision).toBe(0);

    const imported = await fetch(`${base}/api/import`, { method: "POST", headers, body: JSON.stringify({ workspace, expectedRevision: 0, confirmation: preview.confirmation }) });
    expect(imported.status).toBe(200);
    const importedWorkspace = await imported.json();
    expect(importedWorkspace.revision).toBe(1);
    expect(importedWorkspace.maps[0].title).toBe("Previewed import");
    expect((await store.listSnapshots()).snapshots.map((point) => point.revision)).toContain(0);
  });

  it("exports PDF, SVG, Markdown, plain text, and project CSV for an authenticated map", async () => {
    const { base } = await setup(); const { cookie } = await signIn(base);
    const formats = [
      ["pdf", "application/pdf", "%PDF-"],
      ["svg", "image/svg+xml", "<?xml"],
      ["md", "text/markdown", "# Home server rebuild"],
      ["txt", "text/plain", "Home server rebuild"],
      ["csv", "text/csv", "\"map_title\""],
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

  it("rejects an import that did not complete preview without changing the current revision", async () => {
    const { base, store } = await setup(); const { cookie } = await signIn(base);
    const workspace = await store.read();
    const response = await fetch(`${base}/api/import`, { method: "POST", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ expectedRevision: 0, workspace }) });
    expect(response.status).toBe(409);
    expect((await store.read()).revision).toBe(0);
  });
});
