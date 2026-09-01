import { memo, useMemo } from "react";
import {
  Background, Connection, Controls, Edge, Handle, MarkerType, Node, NodeProps, NodeResizer,
  Position, ReactFlow, ReactFlowProvider, type ResizeParams, useReactFlow,
} from "@xyflow/react";
import type { Category, MapGroup, ThoughtNode, Workspace } from "./model";

type ThoughtData = { thought: ThoughtNode; category: Category | null };
type GroupData = { group: MapGroup; onResize: (id: string, size: ResizeParams) => void };

const ThoughtCard = memo(function ThoughtCard({ data, selected }: NodeProps<Node<ThoughtData>>) {
  const { thought, category } = data;
  return <div className={`flow-thought shape-${thought.shape} ${selected ? "selected" : ""}`} style={{ "--category": category?.color ?? "var(--accent)" } as React.CSSProperties}>
    <Handle type="target" position={Position.Left} />
    <div className="thought-category"><span>{category?.icon ?? "○"}</span>{category?.name ?? "Thought"}</div>
    <strong>{thought.title}</strong>
    {thought.tags.length > 0 && <div className="thought-tags">{thought.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}</div>}
    {(thought.attachments.length > 0 || thought.links.length > 0) && <div className="thought-media"><span>▧ {thought.attachments.length}</span><span>↗ {thought.links.length}</span></div>}
    {thought.task && <div className="thought-task"><span>{thought.task.status === "done" ? "✓" : "□"} {thought.task.status}</span>{thought.task.due && <span>{thought.task.due.slice(5)}</span>}</div>}
    <Handle type="source" position={Position.Right} />
  </div>;
});

const GroupCard = memo(function GroupCard({ data, selected }: NodeProps<Node<GroupData>>) {
  return <div className={`flow-group group-${data.group.shape} ${selected ? "selected" : ""}`} style={{ borderColor: data.group.color }}>
    <NodeResizer
      color={data.group.color}
      isVisible={selected}
      minWidth={180}
      minHeight={120}
      onResizeEnd={(_event, size) => data.onResize(data.group.id, size)}
    />
    <span>{data.group.title}</span>
    {data.group.description && <small>{data.group.description}</small>}
  </div>;
});

const nodeTypes = { thought: ThoughtCard, group: GroupCard };

export function focusedThoughtIds(workspace: Workspace, mapId: string, focusId: string | null) {
  const mapNodes = workspace.nodes.filter((node) => node.mapId === mapId);
  const mapNodeIds = new Set(mapNodes.map((node) => node.id));
  if (!focusId || !mapNodeIds.has(focusId)) return mapNodeIds;

  const visible = new Set<string>([focusId]);
  const descendants = new Set<string>([focusId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of mapNodes) {
      if (node.parentId && descendants.has(node.parentId) && !descendants.has(node.id)) {
        descendants.add(node.id);
        visible.add(node.id);
        changed = true;
      }
    }
  }

  let current = mapNodes.find((node) => node.id === focusId) ?? null;
  while (current?.parentId) {
    visible.add(current.parentId);
    current = mapNodes.find((node) => node.id === current?.parentId) ?? null;
  }

  for (const edge of workspace.edges.filter((edge) => edge.type === "reference")) {
    if (visible.has(edge.source) && mapNodeIds.has(edge.target)) visible.add(edge.target);
    if (visible.has(edge.target) && mapNodeIds.has(edge.source)) visible.add(edge.source);
  }
  return visible;
}

interface CanvasProps {
  workspace: Workspace;
  mapId: string;
  selectedId: string | null;
  selectedGroupId: string | null;
  focusId: string | null;
  onSelectThought: (id: string | null) => void;
  onSelectGroup: (id: string | null) => void;
  onMoveThought: (id: string, x: number, y: number) => void;
  onMoveGroup: (id: string, x: number, y: number) => void;
  onResizeGroup: (id: string, size: ResizeParams) => void;
  onConnect: (source: string, target: string) => void;
  onCreateAt: (x: number, y: number) => void;
}

function CanvasInner(props: CanvasProps) {
  const flow = useReactFlow();
  const mapNodes = props.workspace.nodes.filter((node) => node.mapId === props.mapId);
  const visibleIds = useMemo(
    () => focusedThoughtIds(props.workspace, props.mapId, props.focusId),
    [props.workspace, props.mapId, props.focusId],
  );
  const visibleNodes = mapNodes.filter((node) => visibleIds.has(node.id));
  const visibleGroups = props.workspace.groups.filter((group) => {
    if (group.mapId !== props.mapId || group.collapsed) return false;
    return !props.focusId || visibleNodes.some((node) => node.groupId === group.id);
  });

  const nodes: Node[] = [
    ...visibleGroups.map((group) => ({
      id: group.id,
      type: "group",
      position: { x: group.x, y: group.y },
      data: { group, onResize: props.onResizeGroup },
      style: { width: group.width, height: group.height },
      selected: props.selectedGroupId === group.id,
      selectable: true,
      draggable: true,
      connectable: false,
      zIndex: -2,
    })),
    ...visibleNodes.map((thought) => ({
      id: thought.id,
      type: "thought",
      position: { x: thought.x, y: thought.y },
      data: {
        thought,
        category: props.workspace.categories.find((category) => category.id === thought.categoryId) ?? null,
      },
      style: { width: thought.width },
      selected: props.selectedId === thought.id,
      zIndex: 2,
    })),
  ];
  const edges: Edge[] = props.workspace.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: "smoothstep",
    animated: edge.type === "reference" && !props.workspace.settings.reducedMotion,
    style: { strokeWidth: props.workspace.settings.lineThickness, opacity: .8 },
    labelStyle: { fill: "var(--text-muted)", fontSize: 11 },
    markerEnd: edge.type === "reference" ? { type: MarkerType.ArrowClosed } : undefined,
  }));

  return <ReactFlow
    nodes={nodes}
    edges={edges}
    nodeTypes={nodeTypes}
    fitView
    minZoom={0.2}
    maxZoom={2.5}
    snapToGrid={props.workspace.settings.snapToGrid}
    snapGrid={[props.workspace.settings.gridSize, props.workspace.settings.gridSize]}
    onNodeClick={(_event, node) => {
      if (node.type === "thought") { props.onSelectThought(node.id); props.onSelectGroup(null); }
      if (node.type === "group") { props.onSelectGroup(node.id); props.onSelectThought(null); }
    }}
    onPaneClick={() => { props.onSelectThought(null); props.onSelectGroup(null); }}
    onNodeDragStop={(_event, node) => {
      if (node.type === "thought") props.onMoveThought(node.id, node.position.x, node.position.y);
      if (node.type === "group") props.onMoveGroup(node.id, node.position.x, node.position.y);
    }}
    onConnect={(connection: Connection) => connection.source && connection.target && props.onConnect(connection.source, connection.target)}
    onDoubleClick={(event) => {
      if (!(event.target as Element).classList.contains("react-flow__pane")) return;
      const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      props.onCreateAt(position.x, position.y);
    }}
    nodesDraggable
    nodesConnectable
    elementsSelectable
    elevateNodesOnSelect={false}
    deleteKeyCode={null}
  >
    <Background gap={props.workspace.settings.gridSize} size={1} color="var(--grid)" />
    <Controls position="bottom-left" showInteractive={false} />
  </ReactFlow>;
}

export function CanvasView(props: CanvasProps) {
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}
