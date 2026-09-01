import { describe, expect, it } from "vitest";
import { defaultWorkspace } from "./default-workspace.mjs";
import { exportSelection, renderMapMarkdown, renderMapPdf, renderMapSvg, renderMapText, safeExportSlug } from "./exports.mjs";

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

  it("keeps exported filenames portable", () => {
    expect(safeExportSlug(" Home Server: Rébuild / 2026 ")).toBe("home-server-rebuild-2026");
    expect(safeExportSlug("***", "workspace")).toBe("workspace");
  });
});
