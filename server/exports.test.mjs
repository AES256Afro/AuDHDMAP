import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { defaultWorkspace } from "./default-workspace.mjs";
import { exportSelection, PDF_THOUGHT_LIMIT, renderMapCsv, renderMapMarkdown, renderMapPdf, renderMapSvg, renderMapText, safeExportSlug } from "./exports.mjs";

describe("workspace exports", () => {
  it("exports a focused branch without leaking its siblings", () => {
    const workspace = defaultWorkspace(new Date("2026-09-01T12:00:00.000Z"));
    const selection = exportSelection(workspace, "map-home-server", "node-storage");
    expect(selection.nodes.map((node) => node.id)).toEqual(["node-storage", "node-backups", "node-restore"]);
    expect(selection.nodes.map((node) => node.id)).not.toContain("node-network");
  });

  it("produces readable Markdown and plain-text outlines", () => {
    const workspace = defaultWorkspace(new Date("2026-09-01T12:00:00.000Z"));
    const markdown = renderMapMarkdown(workspace, "map-home-server");
    const text = renderMapText(workspace, "map-home-server");
    expect(markdown).toContain("# Home server rebuild");
    expect(markdown).toContain("**Storage plan**");
    expect(markdown).toContain("Status: doing");
    expect(text).toContain("Home server rebuild");
    expect(text).toContain("  - Storage plan");
    expect(text).not.toContain("**");
  });

  it("exports a spreadsheet-safe project handoff with hierarchy, tasks, and references", () => {
    const workspace = defaultWorkspace(new Date("2026-09-01T12:00:00.000Z"));
    workspace.nodes.find((node) => node.id === "node-storage").title = "=unsafe formula";
    const csv = renderMapCsv(workspace, "map-home-server");
    expect(csv.startsWith("\uFEFF\"map_title\"")).toBe(true);
    expect(csv).toContain("Home server rebuild > =unsafe formula");
    expect(csv).toContain("\"'=unsafe formula\"");
    expect(csv).toContain('"task","doing","2026-09-15","2026-09-18","high","50","false"');
    expect(csv).toContain("out|node-restore|Test restore|Home server rebuild|before cutover");
    expect(csv).toContain("in|node-apps|App migration|Home server rebuild|before cutover");
    expect(csv).not.toContain(',"=unsafe formula"');
  });

  it("matches the durable project-handoff CSV fixture", async () => {
    const workspace = JSON.parse(await readFile(new URL("../fixtures/project-handoff-workspace.json", import.meta.url), "utf8"));
    const expected = await readFile(new URL("../fixtures/project-handoff.csv", import.meta.url), "utf8");
    const actual = renderMapCsv(workspace, "map-fixture").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    expect(actual).toBe(expected);
  });

  it("keeps trashed thoughts and their descendants out of ordinary exports", () => {
    const workspace = defaultWorkspace(new Date("2026-09-01T12:00:00.000Z"));
    workspace.nodes.find((node) => node.id === "node-storage").trashedAt = "2026-09-01T13:00:00.000Z";
    const selection = exportSelection(workspace, "map-home-server");
    expect(selection.nodes.map((node) => node.id)).not.toContain("node-storage");
    expect(selection.nodes.map((node) => node.id)).toContain("node-backups");
    expect(renderMapMarkdown(workspace, "map-home-server")).not.toContain("**Storage plan**");
  });

  it("creates a self-contained SVG without executable content", () => {
    const workspace = defaultWorkspace(new Date("2026-09-01T12:00:00.000Z"));
    workspace.nodes[0].title = "Plan <script>alert(1)</script>";
    const svg = renderMapSvg(workspace, "map-home-server");
    expect(svg).toContain("<svg");
    expect(svg).toContain("Plan</text>");
    expect(svg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("Home server rebuild");
  });

  it("creates a PDF with a visual overview and outline pages", async () => {
    const workspace = defaultWorkspace(new Date("2026-09-01T12:00:00.000Z"));
    const pdf = await renderMapPdf(workspace, "map-home-server");
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(4_000);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
  });

  it("requires branch focus before a PDF can exhaust a small container", async () => {
    const workspace = defaultWorkspace(new Date("2026-09-01T12:00:00.000Z"));
    const template = workspace.nodes[0];
    workspace.nodes = Array.from({ length: PDF_THOUGHT_LIMIT + 1 }, (_, index) => ({
      ...structuredClone(template), id: `node-pdf-limit-${index}`, parentId: index === 0 ? null : "node-pdf-limit-0", title: `Thought ${index}`,
    }));
    await expect(renderMapPdf(workspace, "map-home-server")).rejects.toMatchObject({
      code: "PDF_EXPORT_TOO_LARGE",
      message: expect.stringContaining("Focus a smaller branch"),
    });
    await expect(renderMapPdf(workspace, "map-home-server", "node-pdf-limit-1")).resolves.toBeInstanceOf(Buffer);
  });

  it("keeps exported filenames portable", () => {
    expect(safeExportSlug(" Home Server: Rébuild / 2026 ")).toBe("home-server-rebuild-2026");
    expect(safeExportSlug("***", "workspace")).toBe("workspace");
  });
});
