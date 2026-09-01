import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { ZipArchive } from "archiver";
import yauzl from "yauzl";
import { normalizeWorkspace } from "./workspace.mjs";

const attachmentName = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

function attachmentInventory(workspace) {
  const inventory = new Map();
  for (const node of workspace.nodes) {
    for (const attachment of node.attachments) {
      if (inventory.has(attachment.id)) throw new Error(`Attachment id ${attachment.id} is referenced more than once.`);
      inventory.set(attachment.id, attachment);
    }
  }
  return inventory;
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function prepareBackup({ workspace, attachmentDirectory, version, now = () => new Date() }) {
  const inventory = attachmentInventory(workspace);
  const attachments = [];
  for (const attachment of inventory.values()) {
    const filePath = path.join(attachmentDirectory, attachment.id);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) {
      const error = new Error(`Attachment data is missing for ${attachment.name}.`);
      error.code = "BACKUP_INTEGRITY";
      throw error;
    }
    if (info.size !== attachment.size) {
      const error = new Error(`Attachment size does not match the saved metadata for ${attachment.name}.`);
      error.code = "BACKUP_INTEGRITY";
      throw error;
    }
    attachments.push({ ...attachment, filePath, sha256: await hashFile(filePath) });
  }
  const exportedAt = new Date(now()).toISOString();
  return {
    workspace,
    attachments,
    manifest: {
      format: "audhdmap-backup",
      backupVersion: 1,
      application: "AuDHDMAP",
      applicationVersion: version,
      schemaVersion: workspace.schemaVersion,
      workspaceRevision: workspace.revision,
      exportedAt,
      attachments: attachments.map(({ id, name, mime, size, sha256 }) => ({ id, name, mime, size, sha256 })),
    },
  };
}

export function writeBackupArchive(output, prepared) {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      archive.abort();
      reject(error);
    };
    output.once("finish", () => { if (!settled) { settled = true; resolve(); } });
    output.once("error", fail);
    output.once("close", () => {
      if (!settled && !output.writableFinished) {
        fail(new Error("The backup download ended before the archive was complete."));
      }
    });
    archive.once("error", fail);
    archive.once("warning", fail);
    archive.pipe(output);
    archive.append(`${JSON.stringify(prepared.manifest, null, 2)}\n`, { name: "manifest.json", mode: 0o600 });
    archive.append(`${JSON.stringify(prepared.workspace, null, 2)}\n`, { name: "workspace.json", mode: 0o600 });
    for (const attachment of prepared.attachments) archive.file(attachment.filePath, { name: `attachments/${attachment.id}`, mode: 0o600 });
    void archive.finalize().catch(fail);
  });
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => error ? reject(error) : resolve(zip));
  });
}

function openEntry(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
}

async function readSmallEntry(zip, entry, limit) {
  if (entry.uncompressedSize > limit) throw new Error(`${entry.fileName} is larger than this backup format permits.`);
  const stream = await openEntry(zip, entry);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error(`${entry.fileName} is larger than this backup format permits.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function extractAttachment(zip, entry, targetPath, maximumBytes) {
  if (entry.uncompressedSize > maximumBytes) throw new Error(`${entry.fileName} exceeds the per-file attachment limit.`);
  const stream = await openEntry(zip, entry);
  const hash = crypto.createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > maximumBytes) return callback(new Error(`${entry.fileName} exceeds the per-file attachment limit.`));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(stream, meter, createWriteStream(targetPath, { flags: "wx", mode: 0o600 }));
  return { size, sha256: hash.digest("hex") };
}

function parseJson(text, name) {
  try { return JSON.parse(text); }
  catch { throw new Error(`${name} does not contain valid JSON.`); }
}

export async function restoreBackupArchive({
  archivePath,
  store,
  expectedRevision,
  maxEntries = 20_010,
  maxUncompressedBytes = 2 * 1024 * 1024 * 1024,
  maxAttachmentBytes = 25 * 1024 * 1024,
}) {
  const stagingRoot = await mkdtemp(path.join(store.dataDirectory, ".restore-"));
  const stagedAttachments = path.join(stagingRoot, "attachments");
  await mkdir(stagedAttachments, { mode: 0o700 });
  const extracted = new Map();
  let manifestText = null;
  let workspaceText = null;
  let entryCount = 0;
  let uncompressedBytes = 0;
  let zip = null;
  try {
    zip = await openZip(archivePath);
    await new Promise((resolve, reject) => {
      let finished = false;
      const fail = (error) => {
        if (finished) return;
        finished = true;
        zip.close();
        reject(error);
      };
      zip.once("error", fail);
      zip.once("end", () => { if (!finished) { finished = true; resolve(); } });
      zip.on("entry", (entry) => {
        void (async () => {
          entryCount += 1;
          uncompressedBytes += entry.uncompressedSize;
          if (entryCount > maxEntries) throw new Error("The backup contains too many files.");
          if (uncompressedBytes > maxUncompressedBytes) throw new Error("The expanded backup is too large.");
          if (entry.fileName.includes("\\") || entry.fileName.startsWith("/") || entry.fileName.split("/").includes("..")) throw new Error("The backup contains an unsafe path.");
          if (entry.fileName.endsWith("/")) {
            if (entry.fileName !== "attachments/") throw new Error(`Unexpected backup entry: ${entry.fileName}`);
            zip.readEntry(); return;
          }
          if (entry.fileName === "manifest.json") {
            if (manifestText !== null) throw new Error("The backup contains more than one manifest.");
            manifestText = await readSmallEntry(zip, entry, 5 * 1024 * 1024);
          } else if (entry.fileName === "workspace.json") {
            if (workspaceText !== null) throw new Error("The backup contains more than one workspace.");
            workspaceText = await readSmallEntry(zip, entry, 5 * 1024 * 1024);
          } else {
            const match = /^attachments\/([A-Za-z0-9][A-Za-z0-9_-]{0,95})$/.exec(entry.fileName);
            if (!match || !attachmentName.test(match[1])) throw new Error(`Unexpected backup entry: ${entry.fileName}`);
            if (extracted.has(match[1])) throw new Error(`The backup repeats attachment ${match[1]}.`);
            extracted.set(match[1], await extractAttachment(zip, entry, path.join(stagedAttachments, match[1]), maxAttachmentBytes));
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });

    if (manifestText === null || workspaceText === null) throw new Error("The backup must contain manifest.json and workspace.json.");
    const manifest = parseJson(manifestText, "manifest.json");
    const rawWorkspace = parseJson(workspaceText, "workspace.json");
    if (manifest?.format !== "audhdmap-backup" || manifest?.backupVersion !== 1) throw new Error("This is not a supported AuDHDMAP backup.");
    if (manifest.application !== "AuDHDMAP" || manifest.schemaVersion !== rawWorkspace?.schemaVersion || manifest.workspaceRevision !== rawWorkspace?.revision) {
      throw new Error("The backup manifest does not match its workspace data.");
    }
    const workspace = normalizeWorkspace(rawWorkspace, { revision: 0 });
    const inventory = attachmentInventory(workspace);
    const manifestAttachments = new Map();
    if (!Array.isArray(manifest.attachments)) throw new Error("The backup manifest has no attachment inventory.");
    for (const attachment of manifest.attachments) {
      if (!attachmentName.test(attachment?.id) || manifestAttachments.has(attachment.id)) throw new Error("The backup manifest contains an invalid or repeated attachment id.");
      if (!/^[a-f0-9]{64}$/.test(attachment?.sha256)) throw new Error(`The backup checksum for ${attachment.id} is invalid.`);
      manifestAttachments.set(attachment.id, attachment);
    }
    if (inventory.size !== manifestAttachments.size || inventory.size !== extracted.size) throw new Error("The backup attachment inventory does not match the workspace.");
    for (const [id, metadata] of inventory) {
      const declared = manifestAttachments.get(id); const actual = extracted.get(id);
      if (!declared || !actual) throw new Error(`The backup is missing attachment ${metadata.name}.`);
      if (declared.name !== metadata.name || declared.mime !== metadata.mime || declared.size !== metadata.size) throw new Error(`The backup metadata does not match attachment ${metadata.name}.`);
      if (actual.size !== metadata.size || actual.sha256 !== declared.sha256) throw new Error(`Attachment ${metadata.name} failed its integrity check.`);
    }
    return await store.restore(workspace, expectedRevision, stagedAttachments);
  } finally {
    zip?.close();
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
