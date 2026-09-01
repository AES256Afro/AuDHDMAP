import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZipArchive } from "archiver";
import { afterEach, describe, expect, it } from "vitest";
import { prepareBackup, restoreBackupArchive, writeBackupArchive } from "./backup.mjs";
import { createWorkspaceStore } from "./workspace.mjs";

const directories = [];
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function tempStore() {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "audhdmap-backup-"));
  directories.push(dataDirectory);
  const store = createWorkspaceStore({ dataDirectory, now: () => new Date("2026-09-01T12:00:00.000Z") });
  await store.initialize();
  return store;
}

async function writeArchive(filePath, entries) {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(filePath, { flags: "wx", mode: 0o600 });
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.once("finish", resolve); output.once("error", reject); archive.once("error", reject);
    archive.pipe(output);
    for (const [name, value] of entries) archive.append(value, { name, mode: 0o600 });
    void archive.finalize().catch(reject);
  });
}

describe("complete backups", () => {
  it("round-trips workspace data and attachment bytes with a new revision", async () => {
    const store = await tempStore();
    const attachment = { id: "attachment-roundtrip", name: "evidence.txt", mime: "text/plain", size: 14, createdAt: "2026-09-01T12:00:00.000Z" };
    await writeFile(path.join(store.attachmentDirectory, attachment.id), "backup payload", { mode: 0o600 });
    const workspace = await store.read();
    workspace.nodes[0].attachments.push(attachment);
    workspace.nodes[0].title = "Backed up title";
    const saved = await store.replace(workspace, 0);
    const prepared = await prepareBackup({ workspace: saved, attachmentDirectory: store.attachmentDirectory, version: "0.3.0", now: () => new Date("2026-09-01T13:00:00.000Z") });
    expect(prepared.manifest.attachments[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    const archivePath = path.join(store.dataDirectory, "roundtrip.zip");
    await writeBackupArchive(createWriteStream(archivePath, { flags: "wx", mode: 0o600 }), prepared);

    const changed = await store.read(); changed.nodes[0].title = "Changed after backup";
    await store.replace(changed, 1);
    const restored = await restoreBackupArchive({ archivePath, store, expectedRevision: 2 });
    expect(restored.revision).toBe(3);
    expect(restored.nodes[0].title).toBe("Backed up title");
    expect(await readFile(path.join(store.attachmentDirectory, attachment.id), "utf8")).toBe("backup payload");
  });

  it("rejects a checksum mismatch without changing the workspace", async () => {
    const store = await tempStore();
    const workspace = await store.read();
    const attachment = { id: "attachment-corrupt", name: "corrupt.txt", mime: "text/plain", size: 7, createdAt: "2026-09-01T12:00:00.000Z" };
    workspace.nodes[0].attachments.push(attachment);
    const manifest = {
      format: "audhdmap-backup", backupVersion: 1, application: "AuDHDMAP", applicationVersion: "0.3.0",
      schemaVersion: 1, workspaceRevision: 0, exportedAt: "2026-09-01T13:00:00.000Z",
      attachments: [{ ...attachment, sha256: "0".repeat(64) }],
    };
    const archivePath = path.join(store.dataDirectory, "corrupt.zip");
    await writeArchive(archivePath, [
      ["manifest.json", `${JSON.stringify(manifest)}\n`],
      ["workspace.json", `${JSON.stringify(workspace)}\n`],
      [`attachments/${attachment.id}`, "corrupt"],
    ]);
    await expect(restoreBackupArchive({ archivePath, store, expectedRevision: 0 })).rejects.toThrow(/integrity check/i);
    expect((await store.read()).revision).toBe(0);
    expect((await store.read()).nodes[0].attachments).toEqual([]);
  });

  it("fails closed when saved attachment data is missing", async () => {
    const store = await tempStore();
    const workspace = await store.read();
    workspace.nodes[0].attachments.push({ id: "attachment-missing", name: "missing.pdf", mime: "application/pdf", size: 10, createdAt: "2026-09-01T12:00:00.000Z" });
    await expect(prepareBackup({ workspace, attachmentDirectory: store.attachmentDirectory, version: "0.3.0" })).rejects.toThrow(/missing/i);
  });

  it("removes its staging directory when a ZIP cannot be opened", async () => {
    const store = await tempStore();
    const archivePath = path.join(store.dataDirectory, "not-a-zip.zip");
    await writeFile(archivePath, "definitely not a zip", { mode: 0o600 });
    await expect(restoreBackupArchive({ archivePath, store, expectedRevision: 0 })).rejects.toThrow();
    expect((await readdir(store.dataDirectory)).filter((name) => name.startsWith(".restore-"))).toEqual([]);
  });

  it("rejects unexpected archive entries without changing current data", async () => {
    const store = await tempStore();
    const workspace = await store.read();
    const manifest = {
      format: "audhdmap-backup", backupVersion: 1, application: "AuDHDMAP", applicationVersion: "0.3.0",
      schemaVersion: 1, workspaceRevision: 0, exportedAt: "2026-09-01T13:00:00.000Z", attachments: [],
    };
    const archivePath = path.join(store.dataDirectory, "unexpected.zip");
    await writeArchive(archivePath, [
      ["manifest.json", JSON.stringify(manifest)],
      ["workspace.json", JSON.stringify(workspace)],
      ["unexpected.txt", "not permitted"],
    ]);
    await expect(restoreBackupArchive({ archivePath, store, expectedRevision: 0 })).rejects.toThrow(/unexpected backup entry/i);
    expect((await store.read()).revision).toBe(0);
  });

  it("rejects a manifest that does not describe its workspace", async () => {
    const store = await tempStore();
    const workspace = await store.read();
    const manifest = {
      format: "audhdmap-backup", backupVersion: 1, application: "AuDHDMAP", applicationVersion: "0.3.0",
      schemaVersion: 1, workspaceRevision: 99, exportedAt: "2026-09-01T13:00:00.000Z", attachments: [],
    };
    const archivePath = path.join(store.dataDirectory, "mismatch.zip");
    await writeArchive(archivePath, [
      ["manifest.json", JSON.stringify(manifest)],
      ["workspace.json", JSON.stringify(workspace)],
    ]);
    await expect(restoreBackupArchive({ archivePath, store, expectedRevision: 0 })).rejects.toThrow(/manifest does not match/i);
    expect((await store.read()).revision).toBe(0);
  });
});
