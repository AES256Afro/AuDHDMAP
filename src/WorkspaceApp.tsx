import DOMPurify from "dompurify";
import { marked } from "marked";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteAttachment, importWorkspace, logout, saveWorkspace, uploadAttachment } from "./api";
import { CanvasView } from "./CanvasView";
import {
  formatBytes, newId, themeLabels, type TaskStatus, type ThoughtNode, type ViewMode,
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
  const [selectedId, setSelectedId] = useState<string | null>(initialWorkspace.nodes.find((node) => node.mapId === initialWorkspace.maps[0].id)?.id ?? null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [changeVersion, setChangeVersion] = useState(0);
  const [toast, setToast] = useState("");
  const workspaceRef = useRef(workspace);
  const revisionRef = useRef(workspace.revision);
  const versionRef = useRef(changeVersion);
  const queueRef = useRef(Promise.resolve());
  const historyRef = useRef<Workspace[]>([]);
  const importRef = useRef<HTMLInputElement>(null);

  workspaceRef.current = workspace;
  versionRef.current = changeVersion;

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.settings.theme;
    document.documentElement.dataset.crt = workspace.settings.crtEffects ? "on" : "off";
    document.documentElement.dataset.reducedMotion = workspace.settings.reducedMotion ? "on" : "off";
  }, [workspace.settings]);

  const mutate = useCallback((updater: (current: Workspace) => Workspace, remember = true) => {
    setWorkspace((current) => {
      if (remember) {
        historyRef.current = [...historyRef.current.slice(-39), current];
      }
      const next = updater(current);
      workspaceRef.current = next;
      return next;
    });
    setSaveState("unsaved"); setSaveError("");
    setChangeVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (changeVersion === 0) return;
    const timer = window.setTimeout(() => {
      const snapshot = workspaceRef.current;
      const savingVersion = versionRef.current;
      queueRef.current = queueRef.current.then(async () => {
        setSaveState("saving");
        try {
          const saved = await saveWorkspace(snapshot, revisionRef.current);
          revisionRef.current = saved.revision;
          setWorkspace((current) => ({ ...current, revision: saved.revision }));
          setSaveState(versionRef.current === savingVersion ? "saved" : "unsaved");
        } catch (error) {
          setSaveState("failed"); setSaveError(error instanceof Error ? error.message : "Autosave failed.");
        }
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [changeVersion]);

  const selected = workspace.nodes.find((node) => node.id === selectedId) ?? null;
  const activeMap = workspace.maps.find((map) => map.id === activeMapId) ?? workspace.maps[0];
  const searchResults = search.trim() ? workspace.nodes.filter((node) => `${node.title} ${node.note} ${node.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase())).slice(0, 20) : [];

  function updateNode(id: string, patch: Partial<ThoughtNode>) {
    mutate((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch, updatedAt: new Date().toISOString() } : node) }));
  }

  function createThought(parentId: string | null, x = 340, y = 220) {
    const id = newId("node"); const now = new Date().toISOString();
    mutate((current) => ({
      ...current,
      nodes: [...current.nodes, { id, mapId: activeMapId, parentId, groupId: null, title: "New thought", note: "", x, y, width: 190, shape: current.settings.nodeShape, categoryId: null, tags: [], attachments: [], task: null, createdAt: now, updatedAt: now }],
      edges: parentId ? [...current.edges, { id: newId("edge"), mapId: activeMapId, source: parentId, target: id, type: "branch", label: "" }] : current.edges,
    }));
    setSelectedId(id); return id;
  }

  function connect(source: string, target: string) {
    if (source === target || workspace.edges.some((edge) => edge.source === source && edge.target === target)) return;
    mutate((current) => ({
      ...current,
      edges: [...current.edges, { id: newId("edge"), mapId: activeMapId, source, target, type: "reference", label: "related" }],
    }));
  }

  function autoLayout(mode: "tree" | "grid") {
    const nodes = workspace.nodes.filter((node) => node.mapId === activeMapId);
    const positions = new Map<string, { x: number; y: number }>();
    if (mode === "grid") nodes.forEach((node, index) => positions.set(node.id, { x: 100 + (index % 3) * 280, y: 100 + Math.floor(index / 3) * 150 }));
    else {
      const children = new Map<string | null, ThoughtNode[]>();
      nodes.forEach((node) => children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]));
      let row = 0;
      const walk = (parent: string | null, depth: number) => (children.get(parent) ?? []).forEach((node) => {
        const ownRow = row++;
        positions.set(node.id, { x: 100 + depth * 270, y: 90 + ownRow * 135 });
        walk(node.id, depth + 1);
      });
      walk(null, 0);
    }
    mutate((current) => ({ ...current, nodes: current.nodes.map((node) => positions.has(node.id) ? { ...node, ...positions.get(node.id)! } : node) }));
    setToast(`${mode === "tree" ? "Tree" : "Grid"} layout applied. Undo is available.`);
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return setToast("Nothing to undo yet.");
    setWorkspace(previous); workspaceRef.current = previous;
    setChangeVersion((version) => version + 1); setSaveState("unsaved");
  }

  function deleteSelected() {
    if (!selected) return;
    const id = selected.id;
    mutate((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id).map((node) => node.parentId === id ? { ...node, parentId: null } : node),
      edges: current.edges.filter((edge) => edge.source !== id && edge.target !== id),
    }));
    setSelectedId(null);
  }

  function addMap() {
    const id = newId("map"); const now = new Date().toISOString();
    mutate((current) => ({ ...current, maps: [...current.maps, { id, title: "Untitled map", createdAt: now, updatedAt: now }] }));
    setActiveMapId(id); setSelectedId(null); setView("canvas");
  }

  async function signOut() {
    await logout().catch(() => {}); onSignedOut();
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = await importWorkspace(parsed, revisionRef.current);
      revisionRef.current = imported.revision; historyRef.current = [];
      setWorkspace(imported); workspaceRef.current = imported; setActiveMapId(imported.maps[0].id); setSelectedId(null); setSaveState("saved");
      setToast(`Imported ${imported.nodes.length} thoughts from ${file.name}.`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Import failed without changing the workspace."); }
  }

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); return; }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); createThought(null); }
      else if (event.key === "Tab" && selected) { event.preventDefault(); createThought(selected.id, selected.x + 280, selected.y + 120); }
      else if (event.key === "Enter" && selected) { event.preventDefault(); createThought(selected.parentId, selected.x, selected.y + 140); }
      else if (event.key.toLowerCase() === "f" && selected) { event.preventDefault(); setFocusId((current) => current === selected.id ? null : selected.id); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
      else if (event.key === "?") setHelpOpen(true);
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  const sharedViewProps = { workspace, mapId: activeMapId, selectedId, onSelect: setSelectedId, onTitle: (id: string, title: string) => updateNode(id, { title }), onStatus: (id: string, status: TaskStatus) => {
    const node = workspace.nodes.find((item) => item.id === id); if (node?.task) updateNode(id, { task: { ...node.task, status } });
  } };

  return <div className="app-shell" style={{ filter: `brightness(${workspace.settings.brightness}%) saturate(${workspace.settings.saturation}%)` }}>
    <aside className="workspace-rail">
      <div className="brand"><span className="brand-network" aria-hidden="true">⌘</span><div><strong>AuDHDMAP</strong><small>{themeLabels[workspace.settings.theme]}</small></div></div>
      <button className="new-thought" onClick={() => createThought(selected?.id ?? null)}><span>＋</span> New thought</button>
      <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search maps and notes" /></label>
      {search ? <div className="search-results"><span>{searchResults.length} results</span>{searchResults.map((node) => <button key={node.id} onClick={() => { setActiveMapId(node.mapId); setSelectedId(node.id); setSearch(""); }}><strong>{node.title}</strong><small>{workspace.maps.find((map) => map.id === node.mapId)?.title}</small></button>)}</div> : <nav className="map-list" aria-label="Maps"><div className="rail-heading"><span>Maps</span><button aria-label="Add map" onClick={addMap}>＋</button></div>{workspace.maps.map((map) => <button key={map.id} className={activeMapId === map.id ? "active" : ""} onClick={() => { setActiveMapId(map.id); setSelectedId(workspace.nodes.find((node) => node.mapId === map.id)?.id ?? null); setFocusId(null); }}><span>⌂</span><span>{map.title}</span><small>{workspace.nodes.filter((node) => node.mapId === map.id).length}</small></button>)}</nav>}
      <div className="rail-bottom"><button onClick={() => setSettingsOpen(true)}>⚙ <span>Visual settings</span></button><button onClick={() => setHelpOpen(true)}>? <span>Help and shortcuts</span></button><button onClick={signOut}>⇥ <span>Sign out {username}</span></button></div>
    </aside>

    <main className="workspace-main">
      <header className="view-header">
        <nav aria-label="Workspace views">{(Object.keys(viewLabels) as ViewMode[]).map((id) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><span>{id === "canvas" ? "⌘" : id === "outline" ? "☷" : id === "board" ? "▦" : id === "timeline" ? "◷" : "▤"}</span>{viewLabels[id]}</button>)}</nav>
        <div className="document-status"><button aria-label="Undo" onClick={undo}>↶</button><span className={`save-state ${saveState}`} title={saveError}>{saveState === "saved" ? "✓ Saved" : saveState === "saving" ? "Saving..." : saveState === "failed" ? "Save failed" : "Unsaved"}</span><a href="/api/export" download title="Export workspace">⇩ Export</a><button onClick={() => importRef.current?.click()}>⇧ Import</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={handleImport} /></div>
      </header>
      {focusId && <div className="focus-banner"><span>Focus: <strong>{workspace.nodes.find((node) => node.id === focusId)?.title}</strong></span><button onClick={() => setFocusId(null)}>Exit focus</button></div>}
      {view === "canvas" && <div className="canvas-shell">
        <div className="canvas-toolbar"><button onClick={() => createThought(null)}>＋ Thought</button><button disabled={!selected} onClick={() => selected && createThought(selected.id, selected.x + 270, selected.y + 130)}>↳ Child</button><button onClick={() => autoLayout("tree")}>Tree layout</button><button onClick={() => autoLayout("grid")}>Grid layout</button><button disabled={!selected} onClick={() => selected && setFocusId(focusId === selected.id ? null : selected.id)}>◎ Focus branch</button><label><input type="checkbox" checked={workspace.settings.snapToGrid} onChange={(event) => mutate((current) => ({ ...current, settings: { ...current.settings, snapToGrid: event.target.checked } }))} /> Grid {workspace.settings.gridSize}</label></div>
        <CanvasView workspace={workspace} mapId={activeMapId} selectedId={selectedId} focusId={focusId} onSelect={setSelectedId} onMove={(id, x, y) => updateNode(id, { x, y })} onConnect={connect} onCreateAt={(x, y) => createThought(null, x, y)} />
      </div>}
      {view === "outline" && <OutlineView {...sharedViewProps} />}
      {view === "board" && <BoardView {...sharedViewProps} />}
      {view === "timeline" && <TimelineView {...sharedViewProps} />}
      {view === "gantt" && <GanttView {...sharedViewProps} />}
    </main>

    <Inspector workspace={workspace} selected={selected} updateNode={updateNode} deleteNode={deleteSelected} mutate={mutate} />
    {settingsOpen && <VisualSettings settings={workspace.settings} onChange={(patch) => mutate((current) => ({ ...current, settings: { ...current.settings, ...patch } }))} onClose={() => setSettingsOpen(false)} />}
    {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    {toast && <div className="toast" role="status" onAnimationEnd={() => setToast("")}>{toast}</div>}
    <div className="crt-overlay" aria-hidden="true" />
  </div>;
}

function Inspector({ workspace, selected, updateNode, deleteNode, mutate }: {
  workspace: Workspace; selected: ThoughtNode | null; updateNode: (id: string, patch: Partial<ThoughtNode>) => void; deleteNode: () => void;
  mutate: (updater: (current: Workspace) => Workspace) => void;
}) {
  const [preview, setPreview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(selected?.note ?? "") as string), [selected?.note]);
  if (!selected) return <aside className="inspector empty-inspector"><div><span>○</span><h2>No thought selected</h2><p>Select a thought to edit its note, category, task fields, tags, and attachments.</p></div></aside>;
  const thought = selected;
  const category = workspace.categories.find((item) => item.id === thought.categoryId);

  async function files(event: ChangeEvent<HTMLInputElement>) {
    const chosen = [...(event.target.files ?? [])]; event.target.value = ""; if (!chosen.length) return;
    setUploading(true);
    try {
      const attachments = [];
      for (const file of chosen) attachments.push(await uploadAttachment(file));
      updateNode(thought.id, { attachments: [...thought.attachments, ...attachments] });
    } finally { setUploading(false); }
  }

  async function removeAttachment(id: string) {
    await deleteAttachment(id).catch(() => {});
    updateNode(thought.id, { attachments: thought.attachments.filter((attachment) => attachment.id !== id) });
  }

  function toggleTask() {
    updateNode(thought.id, { task: thought.task ? null : { status: "todo", start: "", due: "", progress: 0, priority: "medium", milestone: false } });
  }

  return <aside className="inspector">
    <header><div className="inspector-symbol" style={{ background: category?.color }}>{category?.icon ?? "○"}</div><input className="title-input" value={selected.title} onChange={(event) => updateNode(selected.id, { title: event.target.value })} /><button aria-label="Delete thought" onClick={deleteNode}>⋯</button></header>
    <div className="inspector-tabs"><button className={!preview ? "active" : ""} onClick={() => setPreview(false)}>Note</button><button className={preview ? "active" : ""} onClick={() => setPreview(true)}>Preview</button></div>
    {preview ? <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} /> : <textarea className="note-editor" aria-label="Markdown note" value={selected.note} onChange={(event) => updateNode(selected.id, { note: event.target.value })} placeholder="Write a note with Markdown..." />}
    <section className="inspector-section"><h3>Properties</h3><label>Category<select value={selected.categoryId ?? ""} onChange={(event) => updateNode(selected.id, { categoryId: event.target.value || null })}><option value="">None</option>{workspace.categories.map((item) => <option key={item.id} value={item.id}>{item.icon} {item.name}</option>)}</select></label><label>Tags<input value={selected.tags.join(", ")} onChange={(event) => updateNode(selected.id, { tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })} placeholder="storage, research" /></label></section>
    <section className="inspector-section"><div className="section-heading"><h3>Task</h3><button onClick={toggleTask}>{selected.task ? "Remove task fields" : "Make actionable"}</button></div>{selected.task && <div className="task-grid"><label>Status<select value={selected.task.status} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, status: event.target.value as TaskStatus } })}>{taskStatuses.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></label><label>Priority<select value={selected.task.priority} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, priority: event.target.value as "low" | "medium" | "high" } })}><option>low</option><option>medium</option><option>high</option></select></label><label>Start<input type="date" value={selected.task.start} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, start: event.target.value } })} /></label><label>Due<input type="date" value={selected.task.due} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, due: event.target.value } })} /></label><label className="progress-label">Progress <output>{selected.task.progress}%</output><input type="range" min="0" max="100" step="5" value={selected.task.progress} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, progress: Number(event.target.value) } })} /></label><label className="check-label"><input type="checkbox" checked={selected.task.milestone} onChange={(event) => updateNode(selected.id, { task: { ...selected.task!, milestone: event.target.checked } })} /> Milestone</label></div>}</section>
    <section className="inspector-section attachments"><div className="section-heading"><h3>Attachments</h3><button disabled={uploading} onClick={() => inputRef.current?.click()}>{uploading ? "Uploading..." : "＋ Add"}</button><input ref={inputRef} hidden multiple type="file" onChange={files} /></div>{selected.attachments.length === 0 ? <button className="attachment-drop" onClick={() => inputRef.current?.click()}>Drop or choose images, PDFs, and files</button> : selected.attachments.map((attachment) => <div className="attachment-card" key={attachment.id}><span>{attachment.mime.startsWith("image/") ? "▧" : attachment.mime === "application/pdf" ? "PDF" : "FILE"}</span><a href={`/api/attachments/${attachment.id}`} target="_blank" rel="noreferrer"><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></a><button aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment.id)}>×</button></div>)}</section>
  </aside>;
}

function VisualSettings({ settings, onChange, onClose }: { settings: WorkspaceSettings; onChange: (patch: Partial<WorkspaceSettings>) => void; onClose: () => void }) {
  function reset() { onChange({ theme: "quiet", snapToGrid: true, gridSize: 16, reducedMotion: false, crtEffects: true, brightness: 100, saturation: 100, lineThickness: 2, branchFont: "system", nodeShape: "rounded" }); }
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header><div><span className="eyebrow">Workspace appearance</span><h2 id="settings-title">Visual settings</h2></div><button aria-label="Close settings" onClick={onClose}>×</button></header>
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
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><header><div><span className="eyebrow">Nothing hidden</span><h2 id="help-title">Help and shortcuts</h2></div><button aria-label="Close help" onClick={onClose}>×</button></header>
    <p>Buttons remain available when you do not want to use the keyboard. Shortcuts are ignored while you are typing in a field.</p>
    <dl><div><dt><kbd>N</kbd></dt><dd>Create an unconnected thought</dd></div><div><dt><kbd>Tab</kbd></dt><dd>Create a child of the selected thought</dd></div><div><dt><kbd>Enter</kbd></dt><dd>Create a sibling</dd></div><div><dt><kbd>F</kbd></dt><dd>Focus or leave the selected branch</dd></div><div><dt><kbd>Delete</kbd></dt><dd>Remove the selected thought</dd></div><div><dt><kbd>Cmd/Ctrl Z</kbd></dt><dd>Undo the last workspace change</dd></div><div><dt><kbd>?</kbd></dt><dd>Open this help</dd></div></dl>
    <h3>Canvas basics</h3><p>Double-click empty canvas space to create a thought there. Drag from a node's connection handle to another node to add a labeled reference. Tree and Grid layout are explicit, undoable actions.</p>
    <button className="primary-button" onClick={onClose}>Back to the map</button>
  </section></div>;
}
