// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceApp } from "./WorkspaceApp";
import type { Workspace } from "./model";

const api = vi.hoisted(() => ({
  deleteAttachment: vi.fn(),
  importWorkspace: vi.fn(),
  logout: vi.fn(),
  purgeTrashedThought: vi.fn(),
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
    nodes: [{ id: "node-root", mapId: "map-one", parentId: null, groupId: null, title: "Root thought", note: "", x: 100, y: 100, width: 190, shape: "rounded", categoryId: null, tags: [], attachments: [], links: [], task: null, trashedAt: null, createdAt: now, updatedAt: now }],
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
    api.deleteAttachment.mockImplementation(async (_id: string, workspace: Workspace, revision: number) => ({ ...structuredClone(workspace), revision: revision + 1 }));
    api.purgeTrashedThought.mockImplementation(async (_id: string, workspace: Workspace, revision: number) => ({ ...structuredClone(workspace), revision: revision + 1 }));
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

  it("captures multiple lines as one undoable batch", async () => {
    render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    fireEvent.keyDown(window, { key: "q" });
    const dialog = await screen.findByRole("dialog", { name: "Quick capture" });
    fireEvent.change(screen.getByRole("textbox", { name: "Thoughts to capture" }), { target: { value: "First idea\n\nSecond idea\nThird idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Capture 3 thoughts" }));
    expect(dialog.isConnected).toBe(false);
    expect(await screen.findByDisplayValue("Third idea")).not.toBeNull();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(api.saveWorkspace).toHaveBeenCalledTimes(1));
    expect((api.saveWorkspace.mock.calls[0][0] as Workspace).nodes.map((node) => node.title)).toEqual(["Root thought", "First idea", "Second idea", "Third idea"]);

    await screen.findByText("✓ Saved");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(api.saveWorkspace).toHaveBeenCalledTimes(2));
    expect((api.saveWorkspace.mock.calls[1][0] as Workspace).nodes.map((node) => node.title)).toEqual(["Root thought"]);
  });

  it("moves a thought to trash and restores the same complete record", async () => {
    const workspace = fixture();
    workspace.nodes[0].note = "Keep this note";
    workspace.nodes[0].attachments = [{ id: "attachment-one", name: "keep.txt", mime: "text/plain", size: 4, createdAt: "2026-09-01T12:00:00.000Z" }];
    render(<WorkspaceApp initialWorkspace={workspace} username="owner" onSignedOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete thought" }));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(api.saveWorkspace).toHaveBeenCalledTimes(1));
    const trashed = (api.saveWorkspace.mock.calls[0][0] as Workspace).nodes[0];
    expect(trashed.trashedAt).toMatch(/^2026-|^20/);
    expect(trashed).toMatchObject({ id: "node-root", note: "Keep this note", attachments: [{ id: "attachment-one" }] });

    fireEvent.click(screen.getByRole("button", { name: /Trash/ }));
    await screen.findByRole("dialog", { name: "Trash" });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await screen.findByText("Trash is empty");
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(api.saveWorkspace).toHaveBeenCalledTimes(2));
    const restored = (api.saveWorkspace.mock.calls[1][0] as Workspace).nodes[0];
    expect(restored.trashedAt).toBeNull();
    expect(restored).toMatchObject({ id: "node-root", note: "Keep this note", attachments: [{ id: "attachment-one" }] });
  });

  it("requires a second explicit action before permanent deletion", async () => {
    render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete thought" }));
    fireEvent.click(screen.getByRole("button", { name: /Trash/ }));
    await screen.findByRole("dialog", { name: "Trash" });
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(api.purgeTrashedThought).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm permanent delete" }));
    await waitFor(() => expect(api.purgeTrashedThought).toHaveBeenCalledTimes(1));
    expect((api.purgeTrashedThought.mock.calls[0][1] as Workspace).nodes).toEqual([]);
    await screen.findByText("Trash is empty");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("✓ Saved")).not.toBeNull();
    expect(api.saveWorkspace).toHaveBeenCalledTimes(1);
  });

  it("does not let undo resurrect metadata after attachment bytes are deleted", async () => {
    const workspace = fixture();
    workspace.nodes[0].attachments = [{ id: "attachment-one", name: "keep.txt", mime: "text/plain", size: 4, createdAt: "2026-09-01T12:00:00.000Z" }];
    render(<WorkspaceApp initialWorkspace={workspace} username="owner" onSignedOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove keep.txt" }));
    await waitFor(() => expect(api.deleteAttachment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText("keep.txt")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByText("keep.txt")).toBeNull();
    expect(screen.getByText("✓ Saved")).not.toBeNull();
  });
});
