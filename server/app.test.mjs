import { mkdtemp, rm } from "node:fs/promises";
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

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "audhdmap-api-"));
  const store = createWorkspaceStore({ dataDirectory: directory, now: () => new Date("2026-09-01T12:00:00.000Z") });
  await store.initialize();
  const app = createApp({ store, adminUsername: "owner", adminPassword: "correct horse", sessionSecret: "test-session-secret-is-long", now: () => Date.parse("2026-09-01T12:00:00.000Z"), distDirectory: path.join(directory, "missing-dist") });
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
    expect(await health.json()).toMatchObject({ ok: true, storage: "ready", revision: 0, maps: 2 });
    expect((await fetch(`${base}/api/workspace`)).status).toBe(401);
  });

  it("requires the custom mutation header and rejects a wrong password", async () => {
    const { base } = await setup();
    const missingHeader = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(missingHeader.status).toBe(403);
    const { response } = await signIn(base, "wrong");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "The username or password is not correct." });
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

  it("rejects an invalid import without changing the current revision", async () => {
    const { base, store } = await setup(); const { cookie } = await signIn(base);
    const response = await fetch(`${base}/api/import`, { method: "POST", headers: { cookie, "content-type": "application/json", "x-audhdmap-request": "1" }, body: JSON.stringify({ expectedRevision: 0, workspace: { schemaVersion: 999 } }) });
    expect(response.status).toBe(400);
    expect((await store.read()).revision).toBe(0);
  });
});
