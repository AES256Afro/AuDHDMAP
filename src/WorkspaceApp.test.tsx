// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceApp } from "./WorkspaceApp";
import type { Workspace } from "./model";

const api = vi.hoisted(() => ({
  createRecoveryPoint: vi.fn(),
  deleteAttachment: vi.fn(),
  importWorkspace: vi.fn(),
  listRecoveryPoints: vi.fn(),
  logout: vi.fn(),
  previewWorkspaceImport: vi.fn(),
  purgeTrashedThought: vi.fn(),
  restoreBackup: vi.fn(),
  restoreRecoveryPoint: vi.fn(),
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
    api.listRecoveryPoints.mockResolvedValue({ snapshots: [], problems: [], warning: null });
    api.createRecoveryPoint.mockResolvedValue({ snapshot: { id: "snapshot-r0-11111111-1111-4111-8111-111111111111", revision: 0, createdAt: "2026-09-01T12:00:00.000Z", thoughts: 1, trashed: 0, attachments: 0 } });
  });

  it("previews exact JSON changes before an explicit recovery-protected import", async () => {
    const imported = fixture(); imported.revision = 1; imported.maps[0].title = "Imported map";
    const emptyChange = { added: 0, updated: 0, removed: 0, unchanged: 0, total: 0 };
    api.previewWorkspaceImport.mockResolvedValue({
      status: "ready", confirmation: "a".repeat(64),
      preview: {
        currentRevision: 0, nextRevision: 1,
        changes: { maps: { ...emptyChange, updated: 1, total: 1 }, thoughts: { ...emptyChange, unchanged: 1, total: 1 }, connections: emptyChange, boundaries: emptyChange, categories: emptyChange, attachments: emptyChange },
        totals: { maps: 1, thoughts: 1, trashed: 0, tasks: 0, references: 0, attachments: 0 }, settingsChanged: false,
      },
    });
    api.importWorkspace.mockResolvedValue(imported);
    const rendered = render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"][accept*="application/json"]')!;
    const file = new File([JSON.stringify(imported)], "handoff.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify(imported) });
    fireEvent.change(input, { target: { files: [file] } });

    const dialog = await screen.findByRole("dialog", { name: "JSON import preview" });
    expect(within(dialog).getByText("✓ READY")).not.toBeNull();
    expect(within(dialog).getByText("handoff.json")).not.toBeNull();
    expect(api.previewWorkspaceImport).toHaveBeenCalledWith(imported, 0);
    expect(api.importWorkspace).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace workspace with this JSON" }));
    await waitFor(() => expect(api.importWorkspace).toHaveBeenCalledWith(imported, 0, "a".repeat(64)));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "JSON import preview" })).toBeNull());
    expect(screen.getByText(/A recovery point preserves the previous workspace/)).not.toBeNull();
  });

  it("shows a rejected JSON preview without offering a mutation action", async () => {
    api.previewWorkspaceImport.mockResolvedValue({ status: "rejected", error: "Unsupported workspace schema version." });
    const rendered = render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    const input = rendered.container.querySelector<HTMLInputElement>('input[type="file"][accept*="application/json"]')!;
    const file = new File(["{}"], "wrong.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => "{}" });
    fireEvent.change(input, { target: { files: [file] } });
    const dialog = await screen.findByRole("dialog", { name: "JSON import preview" });
    expect(within(dialog).getByText("× REJECTED")).not.toBeNull();
    expect(within(dialog).getByText(/Unsupported workspace schema/)).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Replace workspace/ })).toBeNull();
    expect(api.importWorkspace).not.toHaveBeenCalled();
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

  it("jumps to maps, thoughts, and tasks with Cmd or Ctrl K and keeps tab-local recents", async () => {
    const workspace = fixture();
    const now = "2026-09-01T13:00:00.000Z";
    workspace.maps.push({ id: "map-two", title: "Remote office", createdAt: now, updatedAt: now });
    workspace.nodes.push({
      id: "node-remote", mapId: "map-two", parentId: null, groupId: null, title: "Rotate VPN keys", note: "Security maintenance", x: 100, y: 100, width: 190,
      shape: "rounded", categoryId: null, tags: ["security"], attachments: [], links: [], task: { status: "doing", start: "", due: "", progress: 25, priority: "high", milestone: false },
      trashedAt: null, createdAt: now, updatedAt: now,
    });
    render(<WorkspaceApp initialWorkspace={workspace} username="owner" onSignedOut={() => {}} />);
    const title = screen.getByDisplayValue("Root thought");
    fireEvent.keyDown(title, { key: "k", ctrlKey: true });
    const switcher = await screen.findByRole("dialog", { name: "Jump anywhere" });
    const query = screen.getByRole("textbox", { name: "Search maps, thoughts, and tasks" });
    fireEvent.change(query, { target: { value: "vpn doing" } });
    expect(await within(switcher).findByRole("option", { name: /Rotate VPN keys/ })).not.toBeNull();
    fireEvent.keyDown(query, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Jump anywhere" })).toBeNull());
    expect(screen.getByDisplayValue("Rotate VPN keys")).not.toBeNull();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const reopened = await screen.findByRole("dialog", { name: "Jump anywhere" });
    const recent = within(reopened).getAllByRole("option");
    expect(recent[0].textContent).toContain("Rotate VPN keys");
  });

  it("closes the export dialog with Escape", async () => {
    render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    await screen.findByRole("dialog", { name: "Export and recovery" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Export and recovery" })).toBeNull());
  });

  it("creates and refreshes server-local recovery points", async () => {
    const point = { id: "snapshot-r0-11111111-1111-4111-8111-111111111111", revision: 0, createdAt: "2026-09-01T12:00:00.000Z", thoughts: 1, trashed: 0, attachments: 0 };
    api.listRecoveryPoints.mockResolvedValueOnce({ snapshots: [], problems: [], warning: null }).mockResolvedValue({ snapshots: [point], problems: [], warning: null });
    render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    await screen.findByText(/No recovery points yet/);
    fireEvent.click(screen.getByRole("button", { name: /Save current point/ }));
    await waitFor(() => expect(api.createRecoveryPoint).toHaveBeenCalledWith(0));
    expect(await screen.findByText(/Revision 0/)).not.toBeNull();
    expect(api.listRecoveryPoints).toHaveBeenCalledTimes(2);
  });

  it("requires confirmation before restoring a server recovery point", async () => {
    const point = { id: "snapshot-r0-11111111-1111-4111-8111-111111111111", revision: 0, createdAt: "2026-09-01T12:00:00.000Z", thoughts: 1, trashed: 0, attachments: 0 };
    api.listRecoveryPoints.mockResolvedValue({ snapshots: [point], problems: [], warning: null });
    const restored = fixture(); restored.revision = 1; restored.maps[0].title = "Recovered map";
    api.restoreRecoveryPoint.mockResolvedValue(restored);
    render(<WorkspaceApp initialWorkspace={fixture()} username="owner" onSignedOut={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Export/ }));
    await screen.findByText(/Revision 0/);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(api.restoreRecoveryPoint).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm replace" }));
    await waitFor(() => expect(api.restoreRecoveryPoint).toHaveBeenCalledWith(point.id, 0));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Export and recovery" })).toBeNull());
    expect(screen.getByText(/Restored server recovery point as revision 1/)).not.toBeNull();
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
