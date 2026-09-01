// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceApp } from "./WorkspaceApp";
import type { Workspace } from "./model";

const api = vi.hoisted(() => ({
  deleteAttachment: vi.fn(),
  importWorkspace: vi.fn(),
  logout: vi.fn(),
  restoreBackup: vi.fn(),
  saveWorkspace: vi.fn(),
  uploadAttachment: vi.fn(),
}));

vi.mock("./api", () => ({
  ...api,
  mapExportUrl: (format: string, mapId: string) => `/api/export/map.${format}?mapId=${mapId}`,
}));
vi.mock("./CanvasView", () => ({ CanvasView: () => <div data-testid="canvas" /> }));
vi.mock("./Views", () => ({
  BoardView: () => <div />,
  GanttView: () => <div />,
  OutlineView: () => <div />,
  TimelineView: () => <div />,
}));

function fixture(): Workspace {
  const now = "2026-09-01T12:00:00.000Z";
  return {
    schemaVersion: 1,
    revision: 0,
    maps: [{ id: "map-one", title: "First map", createdAt: now, updatedAt: now }],
    categories: [],
    nodes: [{ id: "node-root", mapId: "map-one", parentId: null, groupId: null, title: "Root thought", note: "", x: 100, y: 100, width: 190, shape: "rounded", categoryId: null, tags: [], attachments: [], links: [], task: null, createdAt: now, updatedAt: now }],
    edges: [],
    groups: [],
    settings: { theme: "quiet", snapToGrid: true, gridSize: 16, reducedMotion: true, crtEffects: false, brightness: 100, saturation: 100, lineThickness: 2, branchFont: "system", nodeShape: "rounded" },
  };
}

describe("workspace daily-use safeguards", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    api.saveWorkspace.mockImplementation(async (workspace: Workspace, revision: number) => ({ ...structuredClone(workspace), revision: revision + 1 }));
  });

  it("saves an edited workspace before opening export", async () => {
    render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    fireEvent.change(screen.getByDisplayValue("Root thought"), { target: { value: "Saved before export" } });
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    await screen.findByRole("dialog", { name: "Export and recovery" });
    expect(api.saveWorkspace).toHaveBeenCalledTimes(1);
    expect((api.saveWorkspace.mock.calls[0][0] as Workspace).nodes[0].title).toBe("Saved before export");
  });

  it("flushes edits made while an earlier save is still running before export", async () => {
    let finishFirst: (() => void) | undefined;
    api.saveWorkspace
      .mockImplementationOnce((workspace: Workspace) => new Promise<Workspace>((resolve) => { finishFirst = () => resolve({ ...structuredClone(workspace), revision: 1 }); }))
      .mockImplementationOnce(async (workspace: Workspace) => ({ ...structuredClone(workspace), revision: 2 }));
    render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    const title = screen.getByDisplayValue("Root thought");
    fireEvent.change(title, { target: { value: "First edit" } });
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    await waitFor(() => expect(api.saveWorkspace).toHaveBeenCalledTimes(1));
    fireEvent.change(title, { target: { value: "Latest edit" } });
    finishFirst?.();
    await screen.findByRole("dialog", { name: "Export and recovery" });
    expect(api.saveWorkspace).toHaveBeenCalledTimes(2);
    expect((api.saveWorkspace.mock.calls[1][0] as Workspace).nodes[0].title).toBe("Latest edit");
  });

  it("focuses and selects the title after keyboard capture and ignores a held-key repeat", async () => {
    render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    fireEvent.keyDown(window, { key: "n" });
    const title = await screen.findByDisplayValue("New thought");
    await waitFor(() => expect(document.activeElement).toBe(title));
    fireEvent.keyDown(window, { key: "n", repeat: true });
    expect(screen.getAllByDisplayValue("New thought")).toHaveLength(1);
  });

  it("closes the export dialog with Escape", async () => {
    render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    await screen.findByRole("dialog", { name: "Export and recovery" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Export and recovery" })).toBeNull());
  });
});
