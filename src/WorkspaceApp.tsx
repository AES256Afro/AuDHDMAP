import DOMPurify from "dompurify";
import { marked } from "marked";
import type { ResizeParams } from "@xyflow/react";
import { ChangeEvent, DragEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { deleteAttachment, importWorkspace, logout, mapExportUrl, purgeTrashedThought, restoreBackup, saveWorkspace, uploadAttachment } from "./api";
import { CanvasView } from "./CanvasView";
import {
  descendantThoughtIds, formatBytes, gridLayoutPositions, isActiveThought, isPreviewableImage, newId, themeLabels, treeLayoutPositions, type MapGroup, type TaskStatus, type ThoughtNode, type ViewMode,
  viewLabels, type Workspace, type WorkspaceSettings,
} from "./model";
import { BoardView, GanttView, OutlineView, TimelineView } from "./Views";

interface Props {
  initialWorkspace: Workspace;
  username: string;
  onSignedOut: () => void;
}

type SaveState = "saved" | "unsaved" | "saving" | "failed";
const taskStatuses: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "Not started" }, { id: "doing", label: "Doing" }, { id: "waiting", label: "Waiting" },
  { id: "blocked", label: "Blocked" }, { id: "done", label: "Done" },
];

export function WorkspaceApp({ initialWorkspace, username, onSignedOut }: Props) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [activeMapId, setActiveMapId] = useState(initialWorkspace.maps[0].id);
  const [view, setView] = useState<ViewMode>("canvas");
  const [selectedId, setSelectedId] = useState<string | null>(initialWorkspace.nodes.find((node) => node.mapId === initialWorkspace.maps[0].id && isActiveThought(node))?.id ?? null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [changeVersion, setChangeVersion] = useState(0);
  const [toast, setToast] = useState("");
  const workspaceRef = useRef(workspace);
  const revisionRef = useRef(workspace.revision);
  const versionRef = useRef(changeVersion);
  const saveStateRef = useRef<SaveState>(saveState);
  const queuedVersionRef = useRef(-1);
  const queueRef = useRef(Promise.resolve());
  const historyRef = useRef<Workspace[]>([]);
  const futureRef = useRef<Workspace[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  workspaceRef.current = workspace;
  versionRef.current = changeVersion;
  saveStateRef.current = saveState;

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.settings.theme;
    document.documentElement.dataset.crt = workspace.settings.crtEffects ? "on" : "off";
    document.documentElement.dataset.reducedMotion = workspace.settings.reducedMotion ? "on" : "off";
  }, [workspace.settings]);

  const mutate = useCallback((updater: (current: Workspace) => Workspace, remember = true) => {
    setWorkspace((current) => {
      if (remember) {
        historyRef.current = [...historyRef.current.slice(-39), current];
        futureRef.current = [];
      }
      const next = updater(current);
      workspaceRef.current = next;
      return next;
    });
    setSaveState("unsaved"); saveStateRef.current = "unsaved"; setSaveError("");
    setChangeVersion((version) => { const next = version + 1; versionRef.current = next; return next; });
  }, []);

  const enqueueSave = useCallback(() => {
    if (saveStateRef.current === "saved") return;
    const snapshot = workspaceRef.current;
    const savingVersion = versionRef.current;
    if (queuedVersionRef.current >= savingVersion && saveStateRef.current !== "failed") return;
    queuedVersionRef.current = savingVersion;
    queueRef.current = queueRef.current.then(async () => {
      setSaveState("saving"); saveStateRef.current = "saving";
      try {
        const saved = await saveWorkspace(snapshot, revisionRef.current);
        revisionRef.current = saved.revision;
        workspaceRef.current = { ...workspaceRef.current, revision: saved.revision };
        setWorkspace((current) => ({ ...current, revision: saved.revision }));
        setSaveError("");
        const nextState = versionRef.current === savingVersion ? "saved" : "unsaved";
        setSaveState(nextState); saveStateRef.current = nextState;
      } catch (error) {
        if (queuedVersionRef.current === savingVersion) queuedVersionRef.current = savingVersion - 1;
        setSaveState("failed"); saveStateRef.current = "failed"; setSaveError(error instanceof Error ? error.message : "Autosave failed.");
      }
    });
  }, []);

  useEffect(() => {
    if (changeVersion === 0) return;
    const timer = window.setTimeout(enqueueSave, 650);
    return () => window.clearTimeout(timer);
  }, [changeVersion, enqueueSave]);

  useEffect(() => {
    function protectUnsaved(event: BeforeUnloadEvent) {
      if (saveState === "saved") return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [saveState]);

  const activeNodes = useMemo(() => workspace.nodes.filter(isActiveThought), [workspace.nodes]);
  const trashedNodes = useMemo(() => workspace.nodes.filter((node) => !isActiveThought(node)), [workspace.nodes]);
  const nodeById = useMemo(() => new Map(activeNodes.map((node) => [node.id, node])), [activeNodes]);
  const mapById = useMemo(() => new Map(workspace.maps.map((map) => [map.id, map])), [workspace.maps]);
  const nodeCountByMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of activeNodes) counts.set(node.mapId, (counts.get(node.mapId) ?? 0) + 1);
    return counts;
  }, [activeNodes]);
  const selected = selectedId ? nodeById.get(selectedId) ?? null : null;
  const selectedGroup = workspace.groups.find((group) => group.id === selectedGroupId) ?? null;
  const activeMap = mapById.get(activeMapId) ?? workspace.maps[0];
  const deferredSearch = useDeferredValue(search);
  const searchResults = useMemo(() => {
    const query = deferredSearch.trim().toLocaleLowerCase();
    return query ? activeNodes.filter((node) => `${node.title} ${node.note} ${node.tags.join(" ")}`.toLocaleLowerCase().includes(query)).slice(0, 20) : [];
  }, [deferredSearch, activeNodes]);
  const focusPath = useMemo(() => {
    if (!focusId) return [];
    const path: ThoughtNode[] = []; const seen = new Set<string>();
    let current = nodeById.get(focusId);
    while (current && !seen.has(current.id)) { path.unshift(current); seen.add(current.id); current = current.parentId ? nodeById.get(current.parentId) : undefined; }
    return path;
  }, [focusId, nodeById]);

  function updateNode(id: string, patch: Partial<ThoughtNode>) {
    mutate((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch, updatedAt: new Date().toISOString() } : node) }));
  }

  function updateGroup(id: string, patch: Partial<MapGroup>) {
    mutate((current) => ({ ...current, groups: current.groups.map((group) => group.id === id ? { ...group, ...patch } : group) }));
  }

  function navigateToNode(id: string) {
    const node = workspaceRef.current.nodes.find((item) => item.id === id);
    if (!node || !isActiveThought(node)) return;
    setActiveMapId(node.mapId); setSelectedId(node.id); setSelectedGroupId(null); setFocusId(null); setView("canvas");
  }

  function createThought(parentId: string | null, x = 340, y = 220) {
    const id = newId("node"); const now = new Date().toISOString();
    mutate((current) => ({
      ...current,
      nodes: [...current.nodes, { id, mapId: activeMapId, parentId, groupId: null, title: "New thought", note: "", x, y, width: 190, shape: current.settings.nodeShape, categoryId: null, tags: [], attachments: [], links: [], task: null, trashedAt: null, createdAt: now, updatedAt: now }],
      edges: parentId ? [...current.edges, { id: newId("edge"), mapId: activeMapId, source: parentId, target: id, type: "branch", label: "" }] : current.edges,
    }));
    setSelectedId(id); setSelectedGroupId(null);
    window.requestAnimationFrame(() => {
      const title = document.querySelector<HTMLInputElement>(`.title-input[data-node-id="${id}"]`);
      title?.focus(); title?.select();
    });
    return id;
  }

  function quickCapture(titles: string[]) {
    const cleanTitles = titles.map((title) => title.trim().slice(0, 240)).filter(Boolean).slice(0, 100);
    if (!cleanTitles.length) return;
    const mapNodes = workspaceRef.current.nodes.filter((node) => node.mapId === activeMapId && isActiveThought(node));
    const startY = mapNodes.length ? Math.min(90_000, Math.max(...mapNodes.map((node) => node.y)) + 150) : 100;
    const now = new Date().toISOString();
    const created = cleanTitles.map((title, index) => ({
      id: newId("node"), mapId: activeMapId, parentId: null, groupId: null, title, note: "",
      x: 100 + (index % 3) * 270, y: startY + Math.floor(index / 3) * 130, width: 190,
      shape: workspaceRef.current.settings.nodeShape, categoryId: null, tags: [], attachments: [], links: [], task: null,
      trashedAt: null, createdAt: now, updatedAt: now,
    } satisfies ThoughtNode));
    mutate((current) => ({ ...current, nodes: [...current.nodes, ...created] }));
    setSelectedId(created.at(-1)!.id); setSelectedGroupId(null); setQuickCaptureOpen(false);
    setToast(`Captured ${created.length} unconnected thought${created.length === 1 ? "" : "s"}. Undo removes the whole batch.`);
  }

  function connect(source: string, target: string) {
    if (source === target || workspace.edges.some((edge) => edge.type === "reference" && ((edge.source === source && edge.target === target) || (edge.source === target && edge.target === source)))) return;
    mutate((current) => ({
      ...current,
      edges: [...current.edges, { id: newId("edge"), mapId: activeMapId, source, target, type: "reference", label: "related" }],
    }));
  }

  function addReference(source: string, target: string, label: string) {
    if (source === target) return;
    const sourceNode = workspaceRef.current.nodes.find((node) => node.id === source && isActiveThought(node));
    const targetNode = workspaceRef.current.nodes.find((node) => node.id === target && isActiveThought(node));
    if (!sourceNode || !targetNode) return;
    if (workspaceRef.current.edges.some((edge) => edge.type === "reference" && ((edge.source === source && edge.target === target) || (edge.source === target && edge.target === source)))) {
      setToast("Those thoughts are already linked."); return;
    }
    mutate((current) => ({
      ...current,
      edges: [...current.edges, { id: newId("edge"), mapId: sourceNode.mapId, source, target, type: "reference", label: label.trim() || "related" }],
    }));
    setToast("Reference linked in both directions.");
  }

  function removeReference(id: string) {
    mutate((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== id) }));
  }

  function createBoundary() {
    if (!selected) return;
    const enclosed = descendantThoughtIds(activeNodes, activeMapId, selected.id);
    const nodes = activeNodes.filter((node) => enclosed.has(node.id));
    const padding = 52;
    const x = Math.min(...nodes.map((node) => node.x)) - padding;
    const y = Math.min(...nodes.map((node) => node.y)) - padding;
    const right = Math.max(...nodes.map((node) => node.x + node.width)) + padding;
    const bottom = Math.max(...nodes.map((node) => node.y + 100)) + padding;
    const id = newId("group");
    const color = workspace.categories.find((category) => category.id === selected.categoryId)?.color ?? "#47b6a8";
    mutate((current) => ({
      ...current,
      groups: [...current.groups, { id, mapId: activeMapId, title: `${selected.title} boundary`, description: "", x, y, width: Math.max(240, right - x), height: Math.max(160, bottom - y), color, shape: "rectangle", collapsed: false }],
      nodes: current.nodes.map((node) => enclosed.has(node.id) ? { ...node, groupId: id } : node),
    }));
    setSelectedId(null); setSelectedGroupId(id); setToast(`Enclosed ${nodes.length} thought${nodes.length === 1 ? "" : "s"}.`);
  }

  function moveGroup(id: string, x: number, y: number) {
    const group = workspaceRef.current.groups.find((item) => item.id === id);
    if (!group) return;
    const dx = x - group.x; const dy = y - group.y;
    mutate((current) => ({
      ...current,
      groups: current.groups.map((item) => item.id === id ? { ...item, x, y } : item),
      nodes: current.nodes.map((node) => node.groupId === id && isActiveThought(node) ? { ...node, x: node.x + dx, y: node.y + dy } : node),
    }));
  }

  function resizeGroup(id: string, size: ResizeParams) {
    updateGroup(id, { x: size.x, y: size.y, width: size.width, height: size.height });
  }

  function autoLayout(mode: "tree" | "grid") {
    const nodes = activeNodes.filter((node) => node.mapId === activeMapId);
    const positions = new Map<string, { x: number; y: number }>();
    if (mode === "grid") for (const [id, position] of gridLayoutPositions(nodes)) positions.set(id, position);
    else for (const [id, position] of treeLayoutPositions(nodes)) positions.set(id, position);
    mutate((current) => ({ ...current, nodes: current.nodes.map((node) => positions.has(node.id) ? { ...node, ...positions.get(node.id)! } : node) }));
    setToast(`${mode === "tree" ? "Tree" : "Grid"} layout applied. Undo is available.`);
  }

  function outdentSelected() {
    if (!selected?.parentId) return;
    const parent = activeNodes.find((node) => node.id === selected.parentId);
    const nextParentId = parent?.parentId ?? null;
    mutate((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selected.id ? { ...node, parentId: nextParentId } : node),
      edges: [
        ...current.edges.filter((edge) => !(edge.type === "branch" && edge.target === selected.id)),
        ...(nextParentId ? [{ id: newId("edge"), mapId: selected.mapId, source: nextParentId, target: selected.id, type: "branch" as const, label: "" }] : []),
      ],
    }));
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return setToast("Nothing to undo yet.");
    futureRef.current = [...futureRef.current.slice(-39), workspaceRef.current];
    setWorkspace(previous); workspaceRef.current = previous;
    setChangeVersion((version) => { const value = version + 1; versionRef.current = value; return value; });
    setSaveState("unsaved"); saveStateRef.current = "unsaved";
  }

  function redo() {
    const next = futureRef.current.pop();
    if (!next) return setToast("Nothing to redo yet.");
    historyRef.current = [...historyRef.current.slice(-39), workspaceRef.current];
    setWorkspace(next); workspaceRef.current = next;
    setChangeVersion((version) => { const value = version + 1; versionRef.current = value; return value; });
    setSaveState("unsaved"); saveStateRef.current = "unsaved";
  }

  function deleteSelected() {
    if (!selected) return;
    const id = selected.id;
    mutate((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === id ? { ...node, trashedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : node),
    }));
    setSelectedId(null); if (focusId === id) setFocusId(null);
    setToast("Thought moved to trash. Its structure and attachments are preserved.");
  }

  function restoreTrashed(id: string) {
    const thought = workspaceRef.current.nodes.find((node) => node.id === id && !isActiveThought(node));
    if (!thought) return;
    mutate((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === id ? { ...node, trashedAt: null, updatedAt: new Date().toISOString() } : node),
    }));
    setToast(`Restored “${thought.title}” with its original relationships.`);
  }

  function deleteSelectedGroup() {
    if (!selectedGroup) return;
    const id = selectedGroup.id;
    mutate((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== id),
      nodes: current.nodes.map((node) => node.groupId === id ? { ...node, groupId: null } : node),
    }));
    setSelectedGroupId(null);
  }

  function addMap() {
    const id = newId("map"); const now = new Date().toISOString();
    mutate((current) => ({ ...current, maps: [...current.maps, { id, title: "Untitled map", createdAt: now, updatedAt: now }] }));
    setActiveMapId(id); setSelectedId(null); setSelectedGroupId(null); setFocusId(null); setView("canvas");
  }

  async function ensureSaved(failureMessage: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (saveStateRef.current === "saved") return true;
      if (saveStateRef.current !== "saving") enqueueSave();
      await queueRef.current;
      if (String(saveStateRef.current) === "saved") return true;
      if (String(saveStateRef.current) === "failed") break;
    }
    setToast(failureMessage);
    return false;
  }

  async function signOut() {
    if (!await ensureSaved("Save the workspace successfully before signing out.")) return;
    await logout().catch(() => {}); onSignedOut();
  }

  async function openExport() {
    if (!await ensureSaved("Save the workspace successfully before exporting.")) return;
    setExportOpen(true);
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try {
      if (!await ensureSaved("Save the workspace successfully before importing.")) return;
      const parsed = JSON.parse(await file.text());
      const imported = await importWorkspace(parsed, revisionRef.current);
      adoptWorkspace(imported);
      setToast(`Imported ${imported.nodes.length} thoughts from ${file.name}.`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Import failed without changing the workspace."); }
  }

  function adoptWorkspace(next: Workspace) {
    revisionRef.current = next.revision; historyRef.current = []; futureRef.current = [];
    setWorkspace(next); workspaceRef.current = next; setActiveMapId(next.maps[0].id); setSelectedId(null); setSelectedGroupId(null); setFocusId(null);
    setSaveState("saved"); saveStateRef.current = "saved"; setSaveError("");
  }

  async function handleBackupRestore(file: File) {
    if (saveState !== "saved") { setToast("Wait for the current workspace to finish saving before a restore."); return; }
    setRestoring(true);
    try {
      const restored = await restoreBackup(file, revisionRef.current);
      adoptWorkspace(restored); setExportOpen(false);
      setToast(`Restored ${restored.nodes.length} thoughts and their attachments from ${file.name}.`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Restore failed without changing the workspace."); }
    finally { setRestoring(false); }
  }

  async function removeNodeAttachment(nodeId: string, attachmentId: string) {
    if (saveStateRef.current !== "saved") {
      enqueueSave();
      await queueRef.current;
      if (String(saveStateRef.current) !== "saved") { setToast("Save the workspace successfully before removing an attachment."); return; }
    }
    const operationVersion = versionRef.current;
    const candidate = {
      ...workspaceRef.current,
      nodes: workspaceRef.current.nodes.map((node) => node.id === nodeId
        ? { ...node, attachments: node.attachments.filter((attachment) => attachment.id !== attachmentId), updatedAt: new Date().toISOString() }
        : node),
    };
    setSaveState("saving"); saveStateRef.current = "saving";
    const work = queueRef.current.then(async () => {
      try {
        const saved = await deleteAttachment(attachmentId, candidate, revisionRef.current);
        revisionRef.current = saved.revision;
        historyRef.current = []; futureRef.current = [];
        if (versionRef.current === operationVersion) {
          workspaceRef.current = saved; setWorkspace(saved); setSaveState("saved"); saveStateRef.current = "saved";
        } else {
          const current = { ...workspaceRef.current, revision: saved.revision };
          workspaceRef.current = current; setWorkspace(current); setSaveState("unsaved"); saveStateRef.current = "unsaved";
        }
        setSaveError("");
      } catch (error) {
        setSaveState("failed"); saveStateRef.current = "failed";
        setSaveError(error instanceof Error ? error.message : "Attachment could not be removed.");
        setToast(error instanceof Error ? error.message : "Attachment could not be removed.");
      }
    });
    queueRef.current = work.catch(() => {});
    await work;
  }

  async function permanentlyDeleteTrashed(nodeId: string) {
    if (!await ensureSaved("Save the workspace successfully before permanently deleting a thought.")) return;
    const thought = workspaceRef.current.nodes.find((node) => node.id === nodeId && !isActiveThought(node));
    if (!thought) { setToast("That thought is no longer in trash."); return; }
    const operationVersion = versionRef.current;
    const candidate = {
      ...workspaceRef.current,
      nodes: workspaceRef.current.nodes.filter((node) => node.id !== nodeId),
      edges: workspaceRef.current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    };
    setPurgingId(nodeId); setSaveState("saving"); saveStateRef.current = "saving";
    const work = queueRef.current.then(async () => {
      try {
        const saved = await purgeTrashedThought(nodeId, candidate, revisionRef.current);
        revisionRef.current = saved.revision;
        historyRef.current = []; futureRef.current = [];
        if (versionRef.current === operationVersion) {
          workspaceRef.current = saved; setWorkspace(saved); setSaveState("saved"); saveStateRef.current = "saved";
        } else {
          const current = { ...workspaceRef.current, revision: saved.revision };
          workspaceRef.current = current; setWorkspace(current); setSaveState("unsaved"); saveStateRef.current = "unsaved";
        }
        setSaveError(""); setToast(`Permanently deleted “${thought.title}” and its attachment data.`);
      } catch (error) {
        setSaveState("failed"); saveStateRef.current = "failed";
        setSaveError(error instanceof Error ? error.message : "Thought could not be permanently deleted.");
        setToast(error instanceof Error ? error.message : "Thought could not be permanently deleted.");
      } finally { setPurgingId(null); }
    });
    queueRef.current = work.catch(() => {});
    await work;
  }

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); enqueueSave(); return; }
      if (event.key === "Escape") {
        if (quickCaptureOpen) setQuickCaptureOpen(false);
        else if (trashOpen && !purgingId) setTrashOpen(false);
        else if (helpOpen) setHelpOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (exportOpen && !restoring) setExportOpen(false);
        else if (target === searchRef.current) { setSearch(""); searchRef.current?.blur(); }
        else if (focusId) setFocusId(null);
        else { setSelectedId(null); setSelectedGroupId(null); }
        return;
      }
      if (quickCaptureOpen || trashOpen || helpOpen || settingsOpen || exportOpen) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (event.repeat && ["n", "q", "tab", "enter"].includes(event.key.toLowerCase())) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); createThought(null); }
      else if (event.key.toLowerCase() === "q") { event.preventDefault(); setQuickCaptureOpen(true); }
      else if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); }
      else if (event.key === "Tab" && event.shiftKey && selected) { event.preventDefault(); outdentSelected(); }
      else if (event.key === "Tab" && selected) { event.preventDefault(); createThought(selected.id, selected.x + 280, selected.y + 120); }
      else if (event.key === "Enter" && selected) { event.preventDefault(); createThought(selected.parentId, selected.x, selected.y + 140); }
      else if (event.key.toLowerCase() === "f" && selected) { event.preventDefault(); setFocusId((current) => current === selected.id ? null : selected.id); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); selectedGroup ? deleteSelectedGroup() : deleteSelected(); }
      else if (event.key === "?") setHelpOpen(true);
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  const sharedViewProps = { workspace, mapId: activeMapId, selectedId, onSelect: navigateToNode, onTitle: (id: string, title: string) => updateNode(id, { title }), onStatus: (id: string, status: TaskStatus) => {
    const node = workspace.nodes.find((item) => item.id === id); if (node?.task) updateNode(id, { task: { ...node.task, status } });
  } };

  return <div className="app-shell" style={{ filter: `brightness(${workspace.settings.brightness}%) saturate(${workspace.settings.saturation}%)` }}>
    <aside className="workspace-rail">
      <div className="brand"><span className="brand-network" aria-hidden="true">⌘</span><div><strong>AuDHDMAP</strong><small>{themeLabels[workspace.settings.theme]}</small></div></div>
      <button className="new-thought" onClick={() => createThought(selected?.id ?? null)}><span>＋</span> New thought</button>
      <button className="quick-capture-button" onClick={() => setQuickCaptureOpen(true)}><span>≡</span> Quick capture <kbd>Q</kbd></button>
      <label className="search-box"><span>⌕</span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search maps and notes" /></label>
      {search ? <div className="search-results"><span>{searchResults.length} results</span>{searchResults.map((node) => <button key={node.id} onClick={() => { navigateToNode(node.id); setSearch(""); }}><strong>{node.title}</strong><small>{mapById.get(node.mapId)?.title}</small></button>)}</div> : <nav className="map-list" aria-label="Maps"><div className="rail-heading"><span>Maps</span><button aria-label="Add map" onClick={addMap}>＋</button></div>{workspace.maps.map((map) => <button key={map.id} className={activeMapId === map.id ? "active" : ""} onClick={() => { setActiveMapId(map.id); setSelectedId(activeNodes.find((node) => node.mapId === map.id)?.id ?? null); setSelectedGroupId(null); setFocusId(null); }}><span>⌂</span><span>{map.title}</span><small>{nodeCountByMap.get(map.id) ?? 0}</small></button>)}</nav>}
      <div className="rail-bottom"><button onClick={() => setTrashOpen(true)}>♲ <span>Trash</span>{trashedNodes.length > 0 && <small>{trashedNodes.length}</small>}</button><button onClick={() => setSettingsOpen(true)}>⚙ <span>Visual settings</span></button><button onClick={() => setHelpOpen(true)}>? <span>Help and shortcuts</span></button><button onClick={signOut}>⇥ <span>Sign out {username}</span></button></div>
    </aside>

    <main className="workspace-main">
      <header className="view-header">
        <nav aria-label="Workspace views">{(Object.keys(viewLabels) as ViewMode[]).map((id) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><span>{id === "canvas" ? "⌘" : id === "outline" ? "☷" : id === "board" ? "▦" : id === "timeline" ? "◷" : "▤"}</span>{viewLabels[id]}</button>)}</nav>
        <div className="document-status"><button aria-label="Undo" onClick={undo}>↶</button><button aria-label="Redo" onClick={redo}>↷</button><span className={`save-state ${saveState}`} role="status" aria-live="polite" title={saveError}>{saveState === "saved" ? "✓ Saved" : saveState === "saving" ? "Saving..." : saveState === "failed" ? "Save failed" : "Unsaved"}</span>{saveState === "failed" && <button className="retry-save" title={saveError} onClick={enqueueSave}>Retry save</button>}<button onClick={openExport} title="Export and restore">⇩ Export</button><button onClick={() => importRef.current?.click()}>⇧ Import JSON</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={handleImport} /></div>
      </header>
      {focusId && <div className="focus-banner"><nav aria-label="Focused branch path"><span>{activeMap.title}</span>{focusPath.map((node, index) => <button key={node.id} aria-current={index === focusPath.length - 1 ? "location" : undefined} onClick={() => setFocusId(node.id)}>› {node.title}</button>)}</nav><button onClick={() => setFocusId(null)}>Exit focus</button></div>}
      {view === "canvas" && <div className="canvas-shell">
        <div className="canvas-toolbar"><button onClick={() => createThought(null)}>＋ Thought</button><button onClick={() => setQuickCaptureOpen(true)}>≡ Quick capture</button><button disabled={!selected} onClick={() => selected && createThought(selected.id, selected.x + 270, selected.y + 130)}>↳ Child</button><button disabled={!selected} onClick={createBoundary}>▢ Enclose branch</button><button onClick={() => autoLayout("tree")}>Tree layout</button><button onClick={() => autoLayout("grid")}>Grid layout</button><button disabled={!selected} onClick={() => selected && setFocusId(focusId === selected.id ? null : selected.id)}>◎ Focus branch</button><label><input type="checkbox" checked={workspace.settings.snapToGrid} onChange={(event) => mutate((current) => ({ ...current, settings: { ...current.settings, snapToGrid: event.target.checked } }))} /> Grid {workspace.settings.gridSize}</label></div>
        <CanvasView
          workspace={workspace}
          mapId={activeMapId}
          selectedId={selectedId}
          selectedGroupId={selectedGroupId}
          focusId={focusId}
          onSelectThought={setSelectedId}
          onSelectGroup={setSelectedGroupId}
          onMoveThought={(id, x, y) => updateNode(id, { x, y })}
          onMoveGroup={moveGroup}
          onResizeGroup={resizeGroup}
          onConnect={connect}
          onCreateAt={(x, y) => createThought(null, x, y)}
        />
      </div>}
      {view === "outline" && <OutlineView {...sharedViewProps} />}
      {view === "board" && <BoardView {...sharedViewProps} />}
      {view === "timeline" && <TimelineView {...sharedViewProps} />}
      {view === "gantt" && <GanttView {...sharedViewProps} />}
    </main>

    {selectedGroup
      ? <BoundaryInspector group={selectedGroup} updateGroup={updateGroup} deleteGroup={deleteSelectedGroup} />
      : <Inspector key={selected?.id ?? "empty"} workspace={workspace} selected={selected} updateNode={updateNode} deleteNode={deleteSelected} navigateToNode={navigateToNode} addReference={addReference} removeReference={removeReference} removeAttachment={removeNodeAttachment} />}
    {settingsOpen && <VisualSettings settings={workspace.settings} onChange={(patch) => mutate((current) => ({ ...current, settings: { ...current.settings, ...patch } }))} onClose={() => setSettingsOpen(false)} />}
    {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    {exportOpen && <ExportDialog workspace={workspace} mapId={activeMap.id} focusId={focusId} restoring={restoring} onRestore={handleBackupRestore} onClose={() => setExportOpen(false)} />}
    {quickCaptureOpen && <QuickCaptureDialog onCapture={quickCapture} onClose={() => setQuickCaptureOpen(false)} />}
    {trashOpen && <TrashDialog nodes={trashedNodes} maps={workspace.maps} purgingId={purgingId} onRestore={restoreTrashed} onPurge={permanentlyDeleteTrashed} onClose={() => setTrashOpen(false)} />}
    {toast && <div className="toast" role="status" onAnimationEnd={() => setToast("")}>{toast}</div>}
    <div className="crt-overlay" aria-hidden="true" />
  </div>;
}

function QuickCaptureDialog({ onCapture, onClose }: { onCapture: (titles: string[]) => void; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const titles = draft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const accepted = titles.slice(0, 100);
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="quick-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-capture-title">
    <header><div><span className="eyebrow">Thoughts first, structure later</span><h2 id="quick-capture-title">Quick capture</h2></div><button aria-label="Close quick capture" onClick={onClose}>×</button></header>
    <p>Put one thought on each line. AuDHDMAP will add them as a clean, unconnected batch on the current map.</p>
    <textarea autoFocus aria-label="Thoughts to capture" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && accepted.length) { event.preventDefault(); onCapture(accepted); }
    }} placeholder={"Call the electrician\nCompare backup drives\nSketch the migration order"} />
    <footer><span>{accepted.length} of 100 thoughts ready{titles.length > 100 ? `, ${titles.length - 100} over the limit` : ""}</span><div><button onClick={onClose}>Cancel</button><button className="primary-button" disabled={!accepted.length} onClick={() => onCapture(accepted)}>Capture {accepted.length || ""} thought{accepted.length === 1 ? "" : "s"}</button></div></footer>
  </section></div>;
}

function TrashDialog({ nodes, maps, purgingId, onRestore, onPurge, onClose }: {
  nodes: ThoughtNode[];
  maps: Workspace["maps"];
  purgingId: string | null;
  onRestore: (id: string) => void;
  onPurge: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const mapById = new Map(maps.map((map) => [map.id, map]));
  const ordered = [...nodes].sort((left, right) => (right.trashedAt ?? "").localeCompare(left.trashedAt ?? ""));
  useEffect(() => { if (confirmId && !nodes.some((node) => node.id === confirmId)) setConfirmId(null); }, [confirmId, nodes]);
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !purgingId && onClose()}><section className="trash-dialog" role="dialog" aria-modal="true" aria-labelledby="trash-title">
    <header><div><span className="eyebrow">Recoverable by default</span><h2 id="trash-title">Trash</h2></div><button autoFocus aria-label="Close trash" disabled={Boolean(purgingId)} onClick={onClose}>×</button></header>
    <p>Trashed thoughts stay out of maps, search, projects, and ordinary exports. Complete ZIP backups still include them and their attachments.</p>
    {ordered.length === 0 ? <div className="trash-empty"><span>♲</span><strong>Trash is empty</strong><small>Deleting a thought moves it here first.</small></div> : <div className="trash-list">{ordered.map((node) => <article key={node.id}>
      <div><strong>{node.title}</strong><small>{mapById.get(node.mapId)?.title ?? "Unknown map"} · {node.attachments.length} attachment{node.attachments.length === 1 ? "" : "s"}</small></div>
      <button disabled={Boolean(purgingId)} onClick={() => { setConfirmId(null); onRestore(node.id); }}>Restore</button>
      <button className={confirmId === node.id ? "confirm-purge" : ""} disabled={Boolean(purgingId)} onClick={() => {
        if (confirmId !== node.id) { setConfirmId(node.id); return; }
        void onPurge(node.id);
      }}>{purgingId === node.id ? "Deleting..." : confirmId === node.id ? "Confirm permanent delete" : "Delete permanently"}</button>
    </article>)}</div>}
    {confirmId && !purgingId && <p className="purge-warning">This second action cannot be undone. The thought record, its links, and its stored attachment bytes will be removed.</p>}
  </section></div>;
}

function ExportDialog({ workspace, mapId, focusId, restoring, onRestore, onClose }: {
  workspace: Workspace;
  mapId: string;
  focusId: string | null;
  restoring: boolean;
  onRestore: (file: File) => Promise<void>;
  onClose: () => void;
}) {
  const [backup, setBackup] = useState<File | null>(null);
  const map = workspace.maps.find((entry) => entry.id === mapId)!;
  const focus = focusId ? workspace.nodes.find((node) => node.id === focusId && isActiveThought(node)) : null;
  const scope = focus ? `Focused branch: ${focus.title}` : `Current map: ${map.title}`;
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !restoring && onClose()}><section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
    <header><div><span className="eyebrow">Portable by design</span><h2 id="export-title">Export and recovery</h2></div><button autoFocus aria-label="Close export" disabled={restoring} onClick={onClose}>×</button></header>
    <section className="export-section"><div className="export-heading"><div><h3>Share what you see</h3><p>{scope}. PDF includes a visual overview and readable outline.</p></div><span>{focus ? "BRANCH" : "MAP"}</span></div>
      <div className="export-grid">
        <a href={mapExportUrl("pdf", mapId, focusId)} download><strong>PDF</strong><span>Visual map plus notes</span></a>
        <a href={mapExportUrl("svg", mapId, focusId)} download><strong>SVG</strong><span>Scalable visual map</span></a>
        <a href={mapExportUrl("md", mapId, focusId)} download><strong>Markdown</strong><span>Structured editable outline</span></a>
        <a href={mapExportUrl("txt", mapId, focusId)} download><strong>Plain text</strong><span>Portable indented outline</span></a>
      </div>
    </section>
    <section className="export-section"><div className="export-heading"><div><h3>Back up everything</h3><p>The ZIP contains workspace data, every attachment, and SHA-256 integrity checks.</p></div><span>FULL</span></div>
      <div className="backup-actions"><a className="primary-button" href="/api/export/backup.zip" download>⇩ Complete ZIP backup</a><a href="/api/export" download>JSON data only</a></div>
    </section>
    <section className="export-section restore-section"><div className="export-heading"><div><h3>Restore a complete backup</h3><p>The archive is validated in a staging area before the current workspace changes.</p></div><span>SAFE</span></div>
      <label className="backup-picker"><input type="file" accept="application/zip,.zip" disabled={restoring} onChange={(event) => setBackup(event.target.files?.[0] ?? null)} /><span>{backup ? backup.name : "Choose an AuDHDMAP ZIP backup"}</span></label>
      {backup && <div className="restore-confirm"><p>This replaces the current workspace and attachments. Download a fresh backup first if you need the current state.</p><button className="danger-button" disabled={restoring} onClick={() => onRestore(backup)}>{restoring ? "Validating and restoring..." : "Replace workspace from this backup"}</button></div>}
    </section>
  </section></div>;
}

function Inspector({ workspace, selected, updateNode, deleteNode, navigateToNode, addReference, removeReference, removeAttachment }: {
  workspace: Workspace;
  selected: ThoughtNode | null;
  updateNode: (id: string, patch: Partial<ThoughtNode>) => void;
  deleteNode: () => void;
  navigateToNode: (id: string) => void;
  addReference: (source: string, target: string, label: string) => void;
  removeReference: (id: string) => void;
  removeAttachment: (nodeId: string, attachmentId: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [referenceTarget, setReferenceTarget] = useState("");
  const [referenceLabel, setReferenceLabel] = useState("related");
  const [linkUrl, setLinkUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(selected?.note ?? "") as string), [selected?.note]);
  if (!selected) return <aside className="inspector empty-inspector"><div><span>○</span><h2>No thought selected</h2><p>Select a thought or boundary to edit it.</p></div></aside>;
  const thought = selected;
  const category = workspace.categories.find((item) => item.id === thought.categoryId);
  const activeIds = new Set(workspace.nodes.filter(isActiveThought).map((node) => node.id));
  const references = workspace.edges.filter((edge) => edge.type === "reference" && activeIds.has(edge.source) && activeIds.has(edge.target) && (edge.source === thought.id || edge.target === thought.id));

  async function uploadFiles(chosen: File[]) {
    if (!chosen.length) return;
    setUploading(true);
    try {
      const attachments = [];
      for (const file of chosen) attachments.push(await uploadAttachment(file));
      updateNode(thought.id, { attachments: [...thought.attachments, ...attachments] });
    } finally { setUploading(false); }
  }

  async function files(event: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files ?? [])]; event.target.value = ""; await uploadFiles(chosen);
  }

  function addWebLink(raw: string) {
    try {
      const url = new URL(raw.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      updateNode(thought.id, { links: [...thought.links, { id: newId("link"), url: url.toString(), title: url.hostname.replace(/^www\./, ""), createdAt: new Date().toISOString() }] });
      setLinkUrl("");
    } catch { return; }
  }

  async function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const chosen = [...event.dataTransfer.files];
    if (chosen.length) { await uploadFiles(chosen); return; }
    const raw = event.dataTransfer.getData("text/uri-list").split("\n").find((line) => line && !line.startsWith("#"))
      ?? event.dataTransfer.getData("text/plain");
    if (raw) addWebLink(raw);
  }

  function toggleTask() {
    updateNode(thought.id, { task: thought.task ? null : { status: "todo", start: "", due: "", progress: 0, priority: "medium", milestone: false } });
  }

  return <aside className="inspector">
    <header><div className="inspector-symbol" style={{ background: category?.color }}>{category?.icon ?? "○"}</div><input className="title-input" data-node-id={selected.id} value={selected.title} onChange={(event) => updateNode(selected.id, { title: event.target.value })} /><button aria-label="Delete thought" onClick={deleteNode}>×</button></header>
    <div className="inspector-tabs"><button className={!preview ? "active" : ""} onClick={() => setPreview(false)}>Note</button><button className={preview ? "active" : ""} onClick={() => setPreview(true)}>Preview</button></div>
    {preview ? <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} /> : <textarea className="note-editor" aria-label="Markdown note" value={selected.note} onChange={(event) => updateNode(selected.id, { note: event.target.value })} placeholder="Write a note with Markdown..." />}
    <section className="inspector-section"><h3>Properties</h3><label>Category<select value={selected.categoryId ?? ""} onChange={(event) => updateNode(selected.id, { categoryId: event.target.value || null })}><option value="">None</option>{workspace.categories.map((item) => <option key={item.id} value={item.id}>{item.icon} {item.name}</option>)}</select></label><label>Tags<input value={selected.tags.join(", ")} onChange={(event) => updateNode(selected.id, { tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} placeholder="storage, research" /></label></section>
    <section className="inspector-section"><div className="section-heading"><h3>Task</h3><button onClick={toggleTask}>{selected.task ? "Remove task fields" : "Make actionable"}</button></div>{selected.task && <div className="task-grid"><label>Status<select value={selected.task.status} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, status: event.target.value as TaskStatus } })}>{taskStatuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></label><label>Priority<select value={selected.task.priority} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, priority: event.target.value as "low" | "medium" | "high" } })}><option>low</option><option>medium</option><option>high</option></select></label><label>Start<input type="date" value={selected.task.start} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, start: event.target.value } })} /></label><label>Due<input type="date" value={selected.task.due} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, due: event.target.value } })} /></label><label className="progress-label">Progress <output>{selected.task.progress}%</output><input type="range" min="0" max="100" step="5" value={selected.task.progress} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, progress: Number(event.target.value) } })} /></label><label className="check-label"><input type="checkbox" checked={selected.task.milestone} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, milestone: event.target.checked } })} /> Milestone</label></div>}</section>
    <section className="inspector-section references"><div className="section-heading"><h3>Linked thoughts</h3><span>{references.length}</span></div>
      {references.map((edge) => { const relatedId = edge.source === thought.id ? edge.target : edge.source; const related = workspace.nodes.find((node) => node.id === relatedId); const map = workspace.maps.find((item) => item.id === related?.mapId); return <div className="reference-card" key={edge.id}><button onClick={() => related && navigateToNode(related.id)}><strong>{related?.title ?? "Missing thought"}</strong><small>{edge.label || "related"} · {map?.title}</small></button><button aria-label={`Remove link to ${related?.title}`} onClick={() => removeReference(edge.id)}>×</button></div>; })}
      <div className="reference-builder"><select aria-label="Thought to link" value={referenceTarget} onChange={(event) => setReferenceTarget(event.target.value)}><option value="">Choose any thought...</option>{workspace.maps.map((map) => <optgroup key={map.id} label={map.title}>{workspace.nodes.filter((node) => node.mapId === map.id && node.id !== thought.id && isActiveThought(node)).map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</optgroup>)}</select><input aria-label="Reference label" value={referenceLabel} onChange={(event) => setReferenceLabel(event.target.value)} placeholder="related" /><button disabled={!referenceTarget} onClick={() => { if (referenceTarget) { addReference(thought.id, referenceTarget, referenceLabel); setReferenceTarget(""); } }}>＋ Link thoughts</button></div>
    </section>
    <section className="inspector-section attachments"><div className="section-heading"><h3>Media</h3><button disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "Uploading..." : "＋ File"}</button><input ref={inputRef} hidden multiple type="file" onChange={files} /></div>
      <div className="attachment-drop" role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={drop}>Drop files or a web link here</div>
      {selected.attachments.map((attachment) => <div className="attachment-card" key={attachment.id}>{isPreviewableImage(attachment.mime) ? <img src={`/api/attachments/${attachment.id}`} alt="" /> : <span>{attachment.mime === "application/pdf" ? "PDF" : "FILE"}</span>}<a href={`/api/attachments/${attachment.id}`} target="_blank" rel="noreferrer"><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></a><button aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(thought.id, attachment.id)}>×</button></div>)}
      {selected.links.map((link) => <div className="web-link-card" key={link.id}><span>↗</span><a href={link.url} target="_blank" rel="noreferrer"><strong>{link.title}</strong><small>{new URL(link.url).hostname}</small></a><button aria-label={`Remove ${link.title}`} onClick={() => updateNode(thought.id, { links: thought.links.filter((item) => item.id !== link.id) })}>×</button></div>)}
      <div className="link-builder"><input type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://example.com" /><button disabled={!linkUrl.trim()} onClick={() => addWebLink(linkUrl)}>＋ Link</button></div>
    </section>
  </aside>;
}

function BoundaryInspector({ group, updateGroup, deleteGroup }: {
  group: MapGroup;
  updateGroup: (id: string, patch: Partial<MapGroup>) => void;
  deleteGroup: () => void;
}) {
  return <aside className="inspector boundary-inspector">
    <header><div className="inspector-symbol boundary-symbol" style={{ borderColor: group.color }}>▢</div><input className="title-input" value={group.title} onChange={(event) => updateGroup(group.id, { title: event.target.value })} /><button aria-label="Delete boundary" onClick={deleteGroup}>×</button></header>
    <section className="inspector-section"><span className="eyebrow">Boundary enclosure</span><p className="section-copy">Move the enclosure to move its grouped thoughts. Drag its handles on the canvas to resize it.</p><label>Description<textarea value={group.description} onChange={(event) => updateGroup(group.id, { description: event.target.value })} placeholder="What belongs inside this boundary?" /></label><label>Shape<select value={group.shape} onChange={(event) => updateGroup(group.id, { shape: event.target.value as MapGroup["shape"] })}><option value="rectangle">Rectangle</option><option value="cloud">Cloud</option><option value="bracket">Bracket</option></select></label><label>Semantic color<input type="color" value={group.color} onChange={(event) => updateGroup(group.id, { color: event.target.value })} /></label></section>
    <section className="inspector-section boundary-dimensions"><h3>Dimensions</h3><label>Width<input type="number" min="180" max="10000" value={Math.round(group.width)} onChange={(event) => updateGroup(group.id, { width: Math.min(10_000, Math.max(180, Number(event.target.value) || 180)) })} /></label><label>Height<input type="number" min="120" max="10000" value={Math.round(group.height)} onChange={(event) => updateGroup(group.id, { height: Math.min(10_000, Math.max(120, Number(event.target.value) || 120)) })} /></label></section>
    <section className="inspector-section"><button className="danger-button" onClick={deleteGroup}>Remove boundary, keep thoughts</button></section>
  </aside>;
}

function VisualSettings({ settings, onChange, onClose }: { settings: WorkspaceSettings; onChange: (patch: Partial<WorkspaceSettings>) => void; onClose: () => void }) {
  function reset() { onChange({ theme: "quiet", snapToGrid: true, gridSize: 16, reducedMotion: false, crtEffects: true, brightness: 100, saturation: 100, lineThickness: 2, branchFont: "system", nodeShape: "rounded" }); }
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><div><span className="eyebrow">Workspace appearance</span><h2 id="settings-title">Visual settings</h2></div><button autoFocus aria-label="Close settings" onClick={onClose}>×</button></header>
    <label>Theme<select value={settings.theme} onChange={(event) => onChange({ theme: event.target.value as WorkspaceSettings["theme"] })}>{Object.entries(themeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <fieldset><legend>Node shape</legend><div className="shape-options">{(["rounded", "square", "pill", "oval"] as const).map((shape) => <button className={settings.nodeShape === shape ? "active" : ""} key={shape} onClick={() => onChange({ nodeShape: shape })}><i className={`shape-${shape}`} /><span>{shape}</span></button>)}</div></fieldset>
    <label>Branch font<select value={settings.branchFont} onChange={(event) => onChange({ branchFont: event.target.value as WorkspaceSettings["branchFont"] })}><option value="system">System sans</option><option value="mono">Terminal mono</option><option value="serif">Readable serif</option></select></label>
    <Range label="Brightness" value={settings.brightness} min={60} max={140} onChange={(brightness) => onChange({ brightness })} />
    <Range label="Saturation" value={settings.saturation} min={0} max={160} onChange={(saturation) => onChange({ saturation })} />
    <Range label="Line thickness" value={settings.lineThickness} min={1} max={6} onChange={(lineThickness) => onChange({ lineThickness })} />
    <label className="toggle-row"><span>Snap to grid<small>Manual moves lock to a predictable grid.</small></span><input type="checkbox" checked={settings.snapToGrid} onChange={(event) => onChange({ snapToGrid: event.target.checked })} /></label>
    <label className="toggle-row"><span>Reduced motion<small>Stops animated reference lines and transitions.</small></span><input type="checkbox" checked={settings.reducedMotion} onChange={(event) => onChange({ reducedMotion: event.target.checked })} /></label>
    <label className="toggle-row"><span>CRT effects<small>Scanlines and glow in Signal and Amber themes.</small></span><input type="checkbox" checked={settings.crtEffects} onChange={(event) => onChange({ crtEffects: event.target.checked })} /></label>
    <button className="reset-button" onClick={reset}>↶ Reset visual settings</button>
  </section></div>;
}

function Range({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label className="range-row"><span>{label}<output>{value}</output></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><header><div><span className="eyebrow">Nothing hidden</span><h2 id="help-title">Help and shortcuts</h2></div><button autoFocus aria-label="Close help" onClick={onClose}>×</button></header>
    <p>Buttons remain available when you do not want to use the keyboard. Shortcuts are ignored while you are typing in a field.</p>
    <dl><div><dt><kbd>N</kbd></dt><dd>Create and immediately name an unconnected thought</dd></div><div><dt><kbd>Q</kbd></dt><dd>Capture several unconnected thoughts, one per line</dd></div><div><dt><kbd>Tab</kbd></dt><dd>Create and name a child of the selected thought</dd></div><div><dt><kbd>Shift+Tab</kbd></dt><dd>Move the selected thought out one level</dd></div><div><dt><kbd>Enter</kbd></dt><dd>Create and name a sibling</dd></div><div><dt><kbd>F</kbd></dt><dd>Focus or leave the selected branch</dd></div><div><dt><kbd>/</kbd></dt><dd>Search maps and notes</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Close a panel, leave focus, or clear selection</dd></div><div><dt><kbd>Cmd/Ctrl S</kbd></dt><dd>Save the current workspace now</dd></div><div><dt><kbd>Delete</kbd></dt><dd>Move the selected thought to trash or remove a boundary</dd></div><div><dt><kbd>Cmd/Ctrl Z</kbd></dt><dd>Undo the last workspace change</dd></div><div><dt><kbd>Cmd/Ctrl Shift Z</kbd></dt><dd>Redo the last undone change</dd></div><div><dt><kbd>?</kbd></dt><dd>Open this help</dd></div></dl>
    <h3>Canvas basics</h3><p>Double-click empty canvas space to create a thought there. Drag between connection handles to link thoughts on the same map, or use Linked thoughts to connect any two maps. Enclose branch creates an editable boundary around the selected branch. Files and web links can be dropped into the Media panel.</p>
    <button className="primary-button" onClick={onClose}>Back to the map</button>
  </section></div>;
}
