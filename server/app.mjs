import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import express from "express";
import { prepareBackup, restoreBackupArchive, writeBackupArchive } from "./backup.mjs";
import { renderMapCsv, renderMapMarkdown, renderMapPdf, renderMapSvg, renderMapText, safeExportSlug } from "./exports.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDist = path.join(packageRoot, "dist");

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function safeEqual(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function createSessions(secret, { now = () => Date.now(), lifetimeMs = 12 * 60 * 60 * 1000 } = {}) {
  function signature(payload) { return crypto.createHmac("sha256", secret).update(payload).digest("base64url"); }
  function create(username) {
    const payload = Buffer.from(JSON.stringify({ username, expiresAt: now() + lifetimeMs, nonce: crypto.randomUUID() })).toString("base64url");
    return `${payload}.${signature(payload)}`;
  }
  function verify(token) {
    if (typeof token !== "string") return null;
    const [payload, supplied, extra] = token.split(".");
    if (!payload || !supplied || extra || !safeEqual(signature(payload), supplied)) return null;
    try {
      const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return typeof value.username === "string" && value.expiresAt > now() ? value : null;
    } catch { return null; }
  }
  return { create, verify };
}

function contentDisposition(filename, disposition = "attachment") {
  const safe = filename.replace(/[\u0000-\u001f\u007f-\u009f"\\]/g, "_").slice(0, 240) || "attachment";
  return `${disposition}; filename="${safe}"`;
}

function safeAttachmentId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value);
}

const safeRecordId = safeAttachmentId;

function verifiedImageMime(buffer, claimedMime) {
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const gif = buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  const webp = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  const avif = buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(buffer.subarray(8, 12).toString("ascii"));
  return ({ "image/png": png, "image/jpeg": jpeg, "image/gif": gif, "image/webp": webp, "image/avif": avif })[claimedMime] ? claimedMime : "application/octet-stream";
}

function ordinaryExportWorkspace(workspace) {
  const activeNodes = workspace.nodes.filter((node) => !node.trashedAt);
  const nodeIds = new Set(activeNodes.map((node) => node.id));
  const nodes = activeNodes.map((node) => node.parentId && !nodeIds.has(node.parentId) ? { ...node, parentId: null } : node);
  return {
    ...workspace,
    nodes,
    edges: workspace.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
  };
}

async function receiveRequestFile(request, targetPath, maximumBytes) {
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > maximumBytes) {
        const error = new Error("The backup is larger than this server accepts.");
        error.code = "BACKUP_TOO_LARGE";
        callback(error);
      } else callback(null, chunk);
    },
  });
  await pipeline(request, limiter, createWriteStream(targetPath, { flags: "wx", mode: 0o600 }));
  if (size === 0) throw new Error("Choose a non-empty AuDHDMAP backup.");
  return size;
}

export function createApp({
  store,
  adminUsername = "owner",
  adminPassword,
  sessionSecret,
  distDirectory = defaultDist,
  now = () => Date.now(),
  maxAttachmentBytes = 25 * 1024 * 1024,
  maxBackupBytes = 512 * 1024 * 1024,
  trustProxy = false,
  version = "development",
} = {}) {
  if (!store) throw new Error("store is required");
  if (!adminPassword || String(adminPassword).length < 8) throw new Error("AUDHDMAP_ADMIN_PASSWORD must contain at least 8 characters");
  if (!sessionSecret || sessionSecret.length < 32) throw new Error("AUDHDMAP_SESSION_SECRET must contain at least 32 characters");

  const app = express();
  const sessions = createSessions(sessionSecret, { now });
  const failures = new Map();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);

  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    if (request.secure) response.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.use(express.json({ limit: "8mb" }));

  function requireApplicationRequest(request, response, next) {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method) || request.get("x-audhdmap-request") === "1") return next();
    response.status(403).json({ error: "The application request header is missing." });
  }
  app.use("/api", requireApplicationRequest);

  function sessionFor(request) {
    return sessions.verify(parseCookies(request.get("cookie")).audhdmap_session);
  }
  function requireAuth(request, response, next) {
    const session = sessionFor(request);
    if (!session) return response.status(401).json({ error: "Sign in to continue." });
    request.audhdmapUser = session.username;
    next();
  }

  app.get("/api/health", async (_request, response) => {
    try {
      const ready = await store.readiness();
      response.setHeader("Cache-Control", "no-store");
      response.json({ ok: true, version, storage: "ready", ...ready });
    } catch (error) {
      response.status(503).json({ ok: false, version, storage: "unavailable", error: error.message });
    }
  });

  app.get("/api/session", (request, response) => {
    const session = sessionFor(request);
    response.setHeader("Cache-Control", "no-store");
    response.json({ authenticated: Boolean(session), username: session?.username ?? null });
  });

  app.post("/api/auth/login", (request, response) => {
    const key = request.ip || "unknown";
    const cutoff = now() - 15 * 60_000;
    for (const [address, value] of failures) if (value.lastAttempt < cutoff && value.blockedUntil < now()) failures.delete(address);
    while (failures.size >= 2_048 && !failures.has(key)) failures.delete(failures.keys().next().value);
    const attempt = failures.get(key) ?? { count: 0, blockedUntil: 0, lastAttempt: now() };
    attempt.lastAttempt = now();
    response.setHeader("Cache-Control", "no-store");
    if (attempt.blockedUntil > now()) return response.status(429).json({ error: "Too many attempts. Wait a minute and try again." });
    const username = typeof request.body?.username === "string" ? request.body.username.slice(0, 512) : "";
    const password = typeof request.body?.password === "string" ? request.body.password.slice(0, 4_096) : "";
    const usernameMatches = safeEqual(username, adminUsername);
    const passwordMatches = safeEqual(password, adminPassword);
    if (!usernameMatches || !passwordMatches) {
      attempt.count += 1;
      if (attempt.count >= 6) { attempt.count = 0; attempt.blockedUntil = now() + 60_000; }
      failures.set(key, attempt);
      return response.status(401).json({ error: "The username or password is not correct." });
    }
    failures.delete(key);
    const token = sessions.create(adminUsername);
    const secure = request.secure;
    response.cookie("audhdmap_session", token, { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: 12 * 60 * 60 * 1000 });
    response.json({ authenticated: true, username: adminUsername });
  });

  app.post("/api/auth/logout", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.clearCookie("audhdmap_session", { httpOnly: true, sameSite: "strict", path: "/" });
    response.json({ authenticated: false });
  });

  app.get("/api/workspace", requireAuth, async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json(await store.read());
  });

  app.put("/api/workspace", requireAuth, async (request, response) => {
    const expectedRevision = Number(request.body?.expectedRevision);
    try {
      const next = await store.replace(request.body?.workspace, expectedRevision);
      response.json(next);
    } catch (error) {
      if (error.code === "REVISION_CONFLICT") return response.status(409).json({ error: error.message, workspace: error.current });
      response.status(400).json({ error: error.message });
    }
  });

  app.get("/api/snapshots", requireAuth, async (_request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.json(await store.listSnapshots());
  });

  app.post("/api/snapshots", requireAuth, async (request, response) => {
    const expectedRevision = Number(request.body?.expectedRevision);
    try {
      response.setHeader("Cache-Control", "private, no-store");
      response.json({ snapshot: await store.createSnapshot(expectedRevision) });
    } catch (error) {
      if (error.code === "REVISION_CONFLICT") return response.status(409).json({ error: error.message, workspace: error.current });
      if (error.code === "SNAPSHOT_FAILED") return response.status(409).json({ error: error.message });
      response.status(400).json({ error: error.message || "The recovery point could not be created." });
    }
  });

  app.post("/api/snapshots/:id/restore", requireAuth, async (request, response) => {
    const expectedRevision = Number(request.body?.expectedRevision);
    try {
      response.setHeader("Cache-Control", "private, no-store");
      response.json(await store.restoreSnapshot(request.params.id, expectedRevision));
    } catch (error) {
      if (error.code === "REVISION_CONFLICT") return response.status(409).json({ error: error.message, workspace: error.current });
      if (error.code === "SNAPSHOT_NOT_FOUND") return response.status(404).json({ error: error.message });
      if (error.code === "SNAPSHOT_FAILED") return response.status(409).json({ error: error.message });
      response.status(400).json({ error: error.message || "The recovery point could not be restored." });
    }
  });

  app.get("/api/export", requireAuth, async (_request, response) => {
    const workspace = await store.read();
    const exportedWorkspace = ordinaryExportWorkspace(workspace);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="audhdmap-export-r${workspace.revision}.json"`);
    response.send(`${JSON.stringify({ exportedAt: new Date(now()).toISOString(), application: "AuDHDMAP", workspace: exportedWorkspace }, null, 2)}\n`);
  });

  app.get("/api/export/backup.zip", requireAuth, async (_request, response, next) => {
    try {
      const workspace = await store.read();
      const prepared = await prepareBackup({ workspace, attachmentDirectory: store.attachmentDirectory, version, now: () => new Date(now()) });
      response.setHeader("Content-Type", "application/zip");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Disposition", `attachment; filename="audhdmap-backup-r${workspace.revision}.zip"`);
      await writeBackupArchive(response, prepared);
    } catch (error) {
      if (error.code === "BACKUP_INTEGRITY" && !response.headersSent) return response.status(409).json({ error: error.message });
      if (response.headersSent) { response.destroy(); return; }
      next(error);
    }
  });

  app.get("/api/export/map.:format", requireAuth, async (request, response, next) => {
    try {
      const workspace = await store.read();
      const mapId = typeof request.query.mapId === "string" ? request.query.mapId : "";
      const focusId = typeof request.query.focusId === "string" ? request.query.focusId : null;
      const map = workspace.maps.find((entry) => entry.id === mapId);
      if (!map) return response.status(400).json({ error: "Choose a map before exporting." });
      const focus = focusId ? workspace.nodes.find((node) => node.id === focusId && node.mapId === mapId && !node.trashedAt) : null;
      const slug = safeExportSlug(focus ? `${map.title}-${focus.title}` : map.title);
      response.setHeader("Cache-Control", "private, no-store");
      if (request.params.format === "pdf") {
        const document = await renderMapPdf(workspace, mapId, focus?.id ?? null);
        response.setHeader("Content-Type", "application/pdf");
        response.setHeader("Content-Disposition", `attachment; filename="${slug}.pdf"`);
        return response.send(document);
      }
      if (request.params.format === "svg") {
        response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        response.setHeader("Content-Disposition", `attachment; filename="${slug}.svg"`);
        return response.send(renderMapSvg(workspace, mapId, focus?.id ?? null));
      }
      if (request.params.format === "md") {
        response.setHeader("Content-Type", "text/markdown; charset=utf-8");
        response.setHeader("Content-Disposition", `attachment; filename="${slug}.md"`);
        return response.send(renderMapMarkdown(workspace, mapId, focus?.id ?? null));
      }
      if (request.params.format === "txt") {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Content-Disposition", `attachment; filename="${slug}.txt"`);
        return response.send(renderMapText(workspace, mapId, focus?.id ?? null));
      }
      if (request.params.format === "csv") {
        response.setHeader("Content-Type", "text/csv; charset=utf-8");
        response.setHeader("Content-Disposition", `attachment; filename="${slug}-project-handoff.csv"`);
        return response.send(renderMapCsv(workspace, mapId, focus?.id ?? null));
      }
      response.status(404).json({ error: "That export format is not available." });
    } catch (error) { next(error); }
  });

  app.post("/api/import/preview", requireAuth, async (request, response) => {
    const expectedRevision = Number(request.body?.expectedRevision);
    const candidate = request.body?.workspace?.workspace ?? request.body?.workspace;
    try {
      response.setHeader("Cache-Control", "private, no-store");
      response.json(await store.previewImport(candidate, expectedRevision));
    } catch (error) {
      if (error.code === "REVISION_CONFLICT") return response.status(409).json({ error: error.message, workspace: error.current });
      response.status(422).json({ status: "rejected", error: error.message || "The JSON file is not a supported AuDHDMAP workspace." });
    }
  });

  app.post("/api/import", requireAuth, async (request, response) => {
    const expectedRevision = Number(request.body?.expectedRevision);
    const candidate = request.body?.workspace?.workspace ?? request.body?.workspace;
    try { response.json(await store.replaceImported(candidate, expectedRevision, request.body?.confirmation)); }
    catch (error) {
      if (error.code === "REVISION_CONFLICT") return response.status(409).json({ error: error.message, workspace: error.current });
      if (error.code === "SNAPSHOT_FAILED" || error.code === "IMPORT_NOT_PREVIEWED") return response.status(409).json({ error: error.message });
      response.status(400).json({ error: error.message });
    }
  });

  app.post("/api/import/backup", requireAuth, async (request, response) => {
    const temporary = path.join(store.dataDirectory, `.backup-upload-${crypto.randomUUID()}.zip`);
    try {
      if (!request.is("application/zip") && !request.is("application/octet-stream")) return response.status(415).json({ error: "Choose an AuDHDMAP ZIP backup." });
      const declaredSize = Number(request.get("content-length"));
      if (Number.isFinite(declaredSize) && declaredSize > maxBackupBytes) return response.status(413).json({ error: "The backup is larger than this server accepts." });
      const expectedRevision = Number(request.get("x-audhdmap-revision"));
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return response.status(400).json({ error: "The current workspace revision is required." });
      await receiveRequestFile(request, temporary, maxBackupBytes);
      response.json(await restoreBackupArchive({ archivePath: temporary, store, expectedRevision, maxAttachmentBytes }));
    } catch (error) {
      if (error.code === "REVISION_CONFLICT") return response.status(409).json({ error: error.message, workspace: error.current });
      if (error.code === "BACKUP_TOO_LARGE") return response.status(413).json({ error: error.message });
      response.status(400).json({ error: error.message || "The backup could not be restored." });
    } finally { await unlink(temporary).catch(() => {}); }
  });

  app.post("/api/attachments", requireAuth, express.raw({ type: "application/octet-stream", limit: maxAttachmentBytes }), async (request, response) => {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) return response.status(400).json({ error: "Choose a non-empty file." });
    const id = `attachment-${crypto.randomUUID()}`;
    const name = String(request.get("x-file-name") || "attachment").slice(0, 240);
    const claimedMime = String(request.get("x-file-type") || "application/octet-stream").slice(0, 120);
    const mime = claimedMime.startsWith("image/") ? verifiedImageMime(request.body, claimedMime) : claimedMime;
    await writeFile(path.join(store.attachmentDirectory, id), request.body, { mode: 0o600, flag: "wx" });
    response.status(201).json({ id, name, mime, size: request.body.length, createdAt: new Date(now()).toISOString() });
  });

  app.get("/api/attachments/:id", requireAuth, async (request, response) => {
    const workspace = await store.read();
    const attachment = workspace.nodes.flatMap((node) => node.attachments).find((entry) => entry.id === request.params.id);
    if (!attachment) return response.status(404).json({ error: "Attachment not found." });
    const filePath = path.join(store.attachmentDirectory, attachment.id);
    try {
      const info = await stat(filePath);
      const inlineImages = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
      const previewable = inlineImages.has(attachment.mime);
      response.setHeader("Content-Type", previewable ? attachment.mime : "application/octet-stream");
      response.setHeader("Content-Length", String(info.size));
      response.setHeader("Content-Disposition", contentDisposition(attachment.name, previewable ? "inline" : "attachment"));
      await new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.once("error", reject);
        response.once("close", () => { stream.destroy(); resolve(); });
        response.once("finish", resolve);
        stream.pipe(response);
      });
    } catch {
      if (!response.headersSent) response.status(404).json({ error: "Attachment data is missing." });
      else response.destroy();
    }
  });

  app.delete("/api/attachments/:id", requireAuth, async (request, response) => {
    if (!safeAttachmentId(request.params.id)) return response.status(400).json({ error: "Invalid attachment id." });
    const expectedRevision = Number(request.body?.expectedRevision);
    try {
      response.json(await store.removeAttachment(request.body?.workspace, request.params.id, expectedRevision));
    } catch (error) {
      if (error.code === "REVISION_CONFLICT") return response.status(409).json({ error: error.message, workspace: error.current });
      if (error.code === "ATTACHMENT_NOT_FOUND") return response.status(404).json({ error: error.message });
      response.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/trash/:id", requireAuth, async (request, response) => {
    if (!safeRecordId(request.params.id)) return response.status(400).json({ error: "Invalid thought id." });
    const expectedRevision = Number(request.body?.expectedRevision);
    try {
      response.json(await store.purgeTrashedNode(request.body?.workspace, request.params.id, expectedRevision));
    } catch (error) {
      if (error.code === "REVISION_CONFLICT") return response.status(409).json({ error: error.message, workspace: error.current });
      if (error.code === "NODE_NOT_FOUND" || error.code === "NODE_NOT_TRASHED") return response.status(404).json({ error: error.message });
      response.status(400).json({ error: error.message });
    }
  });

  app.use(express.static(distDirectory, { index: false, maxAge: "1h", immutable: false }));
  app.get("/{*path}", async (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    try { response.sendFile(path.join(distDirectory, "index.html")); }
    catch (error) { next(error); }
  });

  app.use((error, _request, response, _next) => {
    if (response.headersSent) { response.destroy(); return; }
    if (error?.type === "entity.too.large") return response.status(413).json({ error: "The request is larger than this server accepts." });
    console.error(error);
    response.status(500).json({ error: "AuDHDMAP could not complete that request." });
  });

  return app;
}
