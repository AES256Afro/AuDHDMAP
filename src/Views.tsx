import { useEffect, useState } from "react";
import { flattenThoughtHierarchy, isActiveThought, type TaskStatus, type ThoughtNode, type Workspace } from "./model";

export const STRUCTURED_VIEW_PAGE_SIZE = 200;

interface ViewProps {
  workspace: Workspace;
  mapId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTitle: (id: string, title: string) => void;
  onStatus: (id: string, status: TaskStatus) => void;
}

function categoryFor(workspace: Workspace, node: ThoughtNode) {
  return workspace.categories.find((category) => category.id === node.categoryId) ?? null;
}

function useProgressiveRows(total: number, resetKey: string) {
  const [limit, setLimit] = useState(STRUCTURED_VIEW_PAGE_SIZE);
  useEffect(() => setLimit(STRUCTURED_VIEW_PAGE_SIZE), [resetKey]);
  const visible = Math.min(total, limit);
  return { visible, showMore: () => setLimit((current) => Math.min(total, current + STRUCTURED_VIEW_PAGE_SIZE)) };
}

function ProgressiveFooter({ visible, total, onMore }: { visible: number; total: number; onMore: () => void }) {
  if (total <= STRUCTURED_VIEW_PAGE_SIZE) return null;
  const remaining = total - visible;
  return <footer className="progressive-footer"><span>Showing {visible.toLocaleString()} of {total.toLocaleString()}</span>{remaining > 0 && <button onClick={onMore}>Show {Math.min(STRUCTURED_VIEW_PAGE_SIZE, remaining).toLocaleString()} more</button>}</footer>;
}

export function OutlineView(props: ViewProps) {
  const nodes = props.workspace.nodes.filter((node) => node.mapId === props.mapId && isActiveThought(node));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const childrenCount = new Map<string, number>();
  for (const node of nodes) if (node.parentId) childrenCount.set(node.parentId, (childrenCount.get(node.parentId) ?? 0) + 1);
  const rows = flattenThoughtHierarchy(nodes);
  const progressive = useProgressiveRows(rows.length, props.mapId);
  const visibleRows = rows.slice(0, progressive.visible);
  const references = props.workspace.edges.filter((edge) => edge.type === "reference" && (nodeIds.has(edge.source) || nodeIds.has(edge.target)));
  const progressiveReferences = useProgressiveRows(references.length, `${props.mapId}:references`);
  const nodeById = new Map(props.workspace.nodes.filter(isActiveThought).map((node) => [node.id, node]));
  const mapById = new Map(props.workspace.maps.map((map) => [map.id, map]));

  return <div className="structured-view outline-view">
    <header><div><span className="eyebrow">Editable outline</span><h2>{props.workspace.maps.find((map) => map.id === props.mapId)?.title}</h2></div><span>{nodes.length} thoughts</span></header>
    <div className="outline-sheet">{visibleRows.map(({ node, depth }) => { const category = categoryFor(props.workspace, node); return <div className={`outline-row ${props.selectedId === node.id ? "selected" : ""}`} style={{ paddingLeft: `${18 + Math.min(depth, 24) * 28}px` }} onClick={() => props.onSelect(node.id)} key={node.id}>
      <span className="outline-disclosure">{(childrenCount.get(node.id) ?? 0) > 0 ? "⌄" : "•"}</span>
      <input aria-label={`Title for ${node.title}`} value={node.title} onChange={(event) => props.onTitle(node.id, event.target.value)} />
      {category && <span className="category-badge" style={{ "--category": category.color } as React.CSSProperties}>{category.icon} {category.name}</span>}
      {node.task && <span className={`status-badge status-${node.task.status}`}>{node.task.status}</span>}
    </div>; })}</div>
    <ProgressiveFooter visible={progressive.visible} total={rows.length} onMore={progressive.showMore} />
    {references.length > 0 && <section className="references-section"><h3>References</h3>{references.slice(0, progressiveReferences.visible).map((edge) => {
      const source = nodeById.get(edge.source); const target = nodeById.get(edge.target);
      const related = source && nodeIds.has(source.id) ? target : source;
      const relatedMap = related ? mapById.get(related.mapId) : undefined;
      return <button key={edge.id} onClick={() => related && props.onSelect(related.id)}><span>↔</span><strong>{source?.title}</strong><span>{edge.label || "references"}</span><strong>{target?.title}<small>{relatedMap?.id !== props.mapId ? relatedMap?.title : ""}</small></strong></button>;
    })}<ProgressiveFooter visible={progressiveReferences.visible} total={references.length} onMore={progressiveReferences.showMore} /></section>}
    <footer className="shortcut-footer"><kbd>Enter</kbd> sibling <kbd>Tab</kbd> child <kbd>Shift+Tab</kbd> outdent</footer>
  </div>;
}

const columns: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "Not started" }, { id: "doing", label: "Doing" }, { id: "waiting", label: "Waiting" },
  { id: "blocked", label: "Blocked" }, { id: "done", label: "Done" },
];

export function BoardView(props: ViewProps) {
  const tasks = props.workspace.nodes.filter((node) => node.mapId === props.mapId && isActiveThought(node) && node.task).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title));
  const progressive = useProgressiveRows(tasks.length, props.mapId);
  const visibleTasks = tasks.slice(0, progressive.visible);
  return <div className="structured-view board-view"><header><div><span className="eyebrow">Project view</span><h2>Board</h2></div><span>{tasks.length} actionable thoughts</span></header>
    <div className="board-columns">{columns.map((column) => <section className="board-column" key={column.id}><h3>{column.label}<span>{tasks.filter((node) => node.task?.status === column.id).length}</span></h3>
      {visibleTasks.filter((node) => node.task?.status === column.id).map((node) => <button className={`board-card ${props.selectedId === node.id ? "selected" : ""}`} key={node.id} onClick={() => props.onSelect(node.id)}>
        <strong>{node.title}</strong><span>{node.note.replace(/[#*_`]/g, "").slice(0, 90) || "No note yet"}</span>
        <div><select aria-label={`Status for ${node.title}`} value={node.task!.status} onClick={(event) => event.stopPropagation()} onChange={(event) => props.onStatus(node.id, event.target.value as TaskStatus)}>{columns.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select>{node.task?.due && <time>{node.task.due.slice(5)}</time>}</div>
      </button>)}</section>)}</div>
    <ProgressiveFooter visible={progressive.visible} total={tasks.length} onMore={progressive.showMore} />
  </div>;
}

export function TimelineView(props: ViewProps) {
  const nodes = props.workspace.nodes.filter((node) => node.mapId === props.mapId && isActiveThought(node) && node.task);
  const dated = [...nodes].filter((node) => node.task?.start || node.task?.due).sort((a, b) => (a.task?.start || a.task?.due || "").localeCompare(b.task?.start || b.task?.due || ""));
  const undated = nodes.filter((node) => !node.task?.start && !node.task?.due).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const progressive = useProgressiveRows(nodes.length, props.mapId);
  let datedCount = Math.min(dated.length, undated.length ? Math.max(1, Math.floor(progressive.visible * 0.8)) : progressive.visible);
  let undatedCount = Math.min(undated.length, progressive.visible - datedCount);
  let spare = progressive.visible - datedCount - undatedCount;
  if (spare > 0) { const extra = Math.min(spare, dated.length - datedCount); datedCount += extra; spare -= extra; }
  if (spare > 0) undatedCount += Math.min(spare, undated.length - undatedCount);
  const visibleDated = dated.slice(0, datedCount);
  const visibleUndated = undated.slice(0, undatedCount);
  return <div className="structured-view timeline-view"><header><div><span className="eyebrow">Project view</span><h2>Timeline</h2></div><span>Undated work stays visible</span></header>
    <div className="timeline-track">{visibleDated.map((node) => <button key={node.id} onClick={() => props.onSelect(node.id)} className={props.selectedId === node.id ? "selected" : ""}><time>{node.task?.start || node.task?.due}</time><span className="timeline-dot" /><div><strong>{node.title}</strong><span>{node.task?.due && node.task.due !== node.task.start ? `Due ${node.task.due}` : node.task?.status}</span></div></button>)}</div>
    <section className="undated-tray"><h3>Undated</h3>{undated.length ? visibleUndated.map((node) => <button key={node.id} onClick={() => props.onSelect(node.id)}>{node.title}</button>) : <p>No undated project nodes.</p>}</section>
    <ProgressiveFooter visible={progressive.visible} total={nodes.length} onMore={progressive.showMore} />
  </div>;
}

export function GanttView(props: ViewProps) {
  const tasks = props.workspace.nodes.filter((node) => node.mapId === props.mapId && isActiveThought(node) && node.task && (node.task.start || node.task.due)).sort((left, right) => (left.task?.start || left.task?.due || "").localeCompare(right.task?.start || right.task?.due || ""));
  const progressive = useProgressiveRows(tasks.length, props.mapId);
  const visibleTasks = tasks.slice(0, progressive.visible);
  const dates = tasks.flatMap((node) => [node.task!.start, node.task!.due]).filter(Boolean).sort();
  const startMs = dates.length ? Date.parse(`${dates[0]}T00:00:00Z`) : Date.now();
  const endMs = dates.length ? Date.parse(`${dates.at(-1)}T00:00:00Z`) : startMs + 7 * 86_400_000;
  const span = Math.max(86_400_000, endMs - startMs);
  const position = (date: string) => 4 + Math.min(1, Math.max(0, (Date.parse(`${date}T00:00:00Z`) - startMs) / span)) * 90;
  return <div className="structured-view gantt-view"><header><div><span className="eyebrow">Read-only schedule projection</span><h2>Gantt</h2></div><span>Edit dates from the selected thought</span></header>
    <div className="gantt-table"><div className="gantt-head"><span>Thought</span><span>Start</span><span>Due</span><span className="gantt-scale"><i>Start</i><i>Finish</i></span></div>
      {visibleTasks.map((node) => { const left = position(node.task!.start || node.task!.due); const right = position(node.task!.due || node.task!.start); const width = Math.max(2, right - left); return <button className={`gantt-row ${props.selectedId === node.id ? "selected" : ""}`} key={node.id} onClick={() => props.onSelect(node.id)}>
        <strong>{node.title}</strong><time>{node.task!.start || "Unscheduled"}</time><time>{node.task!.due || "Unscheduled"}</time>
        <span className="gantt-lane"><i className={`gantt-bar ${node.task!.milestone ? "milestone" : ""}`} style={{ left: `${left}%`, width: node.task!.milestone ? 14 : `${width}%` }}><b style={{ width: `${node.task!.progress}%` }} /></i></span>
      </button>; })}
    </div>
    <ProgressiveFooter visible={progressive.visible} total={tasks.length} onMore={progressive.showMore} />
  </div>;
}
