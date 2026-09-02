import path from "node:path";
import packageMetadata from "../package.json" with { type: "json" };
import { createApp } from "./app.mjs";
import { createWorkspaceStore } from "./workspace.mjs";

const port = Number(process.env.PORT ?? 3010);
const host = process.env.HOST ?? "0.0.0.0";
const dataDirectory = path.resolve(process.env.AUDHDMAP_DATA_DIR ?? "/data");
const adminUsername = process.env.AUDHDMAP_ADMIN_USERNAME ?? "owner";
const adminPassword = process.env.AUDHDMAP_ADMIN_PASSWORD;
const sessionSecret = process.env.AUDHDMAP_SESSION_SECRET;
const trustProxy = process.env.AUDHDMAP_TRUST_PROXY === "1" ? 1 : false;
const publicDemo = process.env.AUDHDMAP_PUBLIC_DEMO === "1";

if (!publicDemo && !adminPassword) throw new Error("AUDHDMAP_ADMIN_PASSWORD is required.");
if (!sessionSecret || sessionSecret.length < 32) throw new Error("AUDHDMAP_SESSION_SECRET must contain at least 32 characters.");

const store = createWorkspaceStore({ dataDirectory });
await store.initialize();
const app = createApp({ store, adminUsername, adminPassword, sessionSecret, trustProxy, version: packageMetadata.version, publicDemo });
const server = app.listen(port, host, () => console.log(`AuDHDMAP listening on http://${host}:${port}`));

function shutdown(signal) {
  console.log(`${signal} received; closing AuDHDMAP.`);
  server.close((error) => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
