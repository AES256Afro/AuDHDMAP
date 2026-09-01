import crypto from "node:crypto";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDist = path.join(packageRoot, "dist");

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
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
  const safe = filename.replace(/[\r\n"\\]/g, "_").slice(0, 240) || "attachment";
  return `${disposition}; filename="${safe}"`;
}

export function createApp({
  store,
  adminUsername = "owner",
  adminPassword,
  sessionSecret,
  distDirectory = defaultDist,
  now = () => Date.now(),
  maxAttachmentBytes = 25 * 1024 * 1024,
  version = "development",
} = {}) {
  if (!store) throw new Error("store is required");
  if (!adminPassword) throw new Error("AUDHDMAP_ADMIN_PASSWORD is required");
  if (!sessionSecret || sessionSecret.length < 16) throw new Error("AUDHDMAP_SESSION_SECRET must contain at least 16 characters");

  const app = express();
  const sessions = createSessions(sessionSecret, { now });
  const failures = new Map();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: "3mb" }));

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
    const attempt = failures.get(key) ?? { count: 0, blockedUntil: 0 };
    if (attempt.blockedUntil > now()) return response.status(429).json({ error: "Too many attempts. Wait a minute and try again." });
    const username = typeof request.body?.username === "string" ? request.body.username : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!safeEqual(username, adminUsername) || !safeEqual(password, adminPassword)) {
      attempt.count += 1;
      if (attempt.count >= 6) { attempt.count = 0; attempt.blockedUntil = now() + 60_000; }
      failures.set(key, attempt);
      return response.status(401).json({ error: "The username or password is not correct." });
    }
    failures.delete(key);
    const token = sessions.create(adminUsername);
    const secure = request.secure || request.get("x-forwarded-proto") === "https";
    response.cookie("audhdmap_session", token, { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: 12 * 60 * 60 * 1000 });
    response.json({ authenticated: true, username: adminUsername });
  });

  app.post("/api/auth/logout", (_request, response) => {
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

  app.get("/api/export", requireAuth, async (_request, response) => {
    const workspace = await store.read();
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="audhdmap-export-r${workspace.revision}.json"`);
    response.send(`${JSON.stringify({ exportedAt: new Date(now()).toISOString(), application: "AuDHDMAP", workspace }, null, 2)}\n`);
  });

  app.post("/api/import", requireAuth, async (request, response) => {
    const expectedRevision = Number(request.body?.expectedRevision);
    const candidate = request.body?.workspace?.workspace ?? request.body?.workspace;
    try { response.json(await store.replace(candidate, expectedRevision)); }
    catch (error) {
      if (error.code === "REVISION_CONFLICT") return response.status(409).json({ error: error.message, workspace: error.current });
      response.status(400).json({ error: error.message });
    }
  });

  app.post("/api/attachments", requireAuth, express.raw({ type: "application/octet-stream", limit: maxAttachmentBytes }), async (request, response) => {
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) return response.status(400).json({ error: "Choose a non-empty file." });
    const id = `attachment-${crypto.randomUUID()}`;
    const name = String(request.get("x-file-name") || "attachment").slice(0, 240);
    const mime = String(request.get("x-file-type") || "application/octet-stream").slice(0, 120);
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
      response.send(await readFile(filePath));
    } catch { response.status(404).json({ error: "Attachment data is missing." }); }
  });

  app.delete("/api/attachments/:id", requireAuth, async (request, response) => {
    if (!/^attachment-[A-Za-z0-9-]+$/.test(request.params.id)) return response.status(400).json({ error: "Invalid attachment id." });
    await unlink(path.join(store.attachmentDirectory, request.params.id)).catch(() => {});
    response.status(204).end();
  });

  app.use(express.static(distDirectory, { index: false, maxAge: "1h", immutable: false }));
  app.get("/{*path}", async (request, response, next) => {
    if (request.path.startsWith("/api/")) return next();
    try { response.sendFile(path.join(distDirectory, "index.html")); }
    catch (error) { next(error); }
  });

  app.use((error, _request, response, _next) => {
    if (error?.type === "entity.too.large") return response.status(413).json({ error: "The request is larger than this server accepts." });
    console.error(error);
    response.status(500).json({ error: "AuDHDMAP could not complete that request." });
  });

  return app;
}
