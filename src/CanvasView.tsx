import { memo, useMemo } from "react";
import {
  Background, Connection, Controls, Edge, Handle, MarkerType, Node, NodeProps,
  Position, ReactFlow, ReactFlowProvider, useReactFlow,
} from "@xyflow/react";
import type { Category, MapGroup, ThoughtNode, Workspace } from "./model";

type ThoughtData = { thought: ThoughtNode; category: Category | null; faded: boolean };
type GroupData = { group: MapGroup };

const ThoughtCard = memo(function ThoughtCard({ data, selected }: NodeProps<Node<ThoughtData>>) {
  const { thought, category, faded } = data;
  return <div className={`flow-thought shape-${thought.shape} ${selected ? "selected" : ""} ${faded ? "faded" : ""}`} style={{ "--category": category?.color ?? "var(--accent)" } as React.CSSProperties}>
    <Handle type="target" position={Position.Left} />
    <div className="thought-category"><span>{category?.icon ?? "○"}</span>{category?.name ?? "Thought"}</div>
    <strong>{thought.title}</strong>
    {thought.tags.length > 0 && <div className="thought-tags">{thought.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}</div>}
    {thought.task && <div className="thought-task"><span>{thought.task.status === "done" ? "✓" : "□"} {thought.task.status}</span>{thought.task.due && <span>{thought.task.due.slice(5)}</span>}</div>}
    <Handle type="source" position={Position.Right} />
  </div>;
});

const GroupCard = memo(function GroupCard({ data }: NodeProps<Node<GroupData>>) {
  return <div className={`flow-group group-${data.group.shape}`} style={{ borderColor: data.group.color }}><span>{data.group.title}</span></div>;
});

const nodeTypes = { thought: ThoughtCard, group: GroupCard };

interface CanvasProps {
  workspace: Workspace;
  mapId: string;
  selectedId: string | null;
  focusId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (source: string, target: string) => void;
  onCreateAt: (x: number, y: number) => void;
}

function CanvasInner(props: CanvasProps) {
  const flow = useReactFlow();
  const mapNodes = props.workspace.nodes.filter((node) => node.mapId === props.mapId);
  const focusVisible = useMemo(() => {
    if (!props.focusId) return new Set<string>();
    const visible = new Set([props.focusId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of mapNodes) {
        if ((node.parentId && visible.has(node.parentId)) || (visible.has(node.id) && node.parentId)) {
          if (node.parentId && !visible.has(node.parentId)) { visible.add(node.parentId); changed = true; }
          if (node.parentId && visible.has(node.parentId) && !visible.has(node.id)) { visible.add(node.id); changed = true; }
        }
      }
    }
    for (const edge of props.workspace.edges) if (visible.has(edge.source)) visible.add(edge.target);
    return visible;
  }, [props.focusId, mapNodes, props.workspace.edges]);

  const nodes: Node[] = [
    ...props.workspace.groups.filter((group) => group.mapId === props.mapId && !group.collapsed).map((group) => ({
      id: group.id, type: "group", position: { x: group.x, y: group.y }, data: { group },
      style: { width: group.width, height: group.height }, selectable: false, draggable: false, connectable: false, zIndex: -2,
    })),
    ...mapNodes.map((thought) => ({
      id: thought.id, type: "thought", position: { x: thought.x, y: thought.y }, data: {
        thought,
        category: props.workspace.categories.find((category) => category.id === thought.categoryId) ?? null,
        faded: Boolean(props.focusId && !focusVisible.has(thought.id)),
      }, style: { width: thought.width }, zIndex: 2,
    })),
  ];
  const edges: Edge[] = props.workspace.edges.filter((edge) => edge.mapId === props.mapId).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, label: edge.label,
    type: "smoothstep", animated: edge.type === "reference" && !props.workspace.settings.reducedMotion,
    style: { strokeWidth: props.workspace.settings.lineThickness, opacity: props.focusId && (!focusVisible.has(edge.source) || !focusVisible.has(edge.target)) ? .12 : .8 },
    labelStyle: { fill: "var(--text-muted)", fontSize: 11 },
    markerEnd: edge.type === "reference" ? { type: MarkerType.ArrowClosed } : undefined,
  }));

  return <ReactFlow
    nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.2} maxZoom={2.5}
    snapToGrid={props.workspace.settings.snapToGrid}
    snapGrid={[props.workspace.settings.gridSize, props.workspace.settings.gridSize]}
    onNodeClick={(_event, node) => node.type === "thought" && props.onSelect(node.id)}
    onPaneClick={() => props.onSelect(null)}
    onNodeDragStop={(_event, node) => node.type === "thought" && props.onMove(node.id, node.position.x, node.position.y)}
    onConnect={(connection: Connection) => connection.source && connection.target && props.onConnect(connection.source, connection.target)}
    onDoubleClick={(event) => {
      if (!(event.target as Element).classList.contains("react-flow__pane")) return;
      const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      props.onCreateAt(position.x, position.y);
    }}
    nodesDraggable nodesConnectable elementsSelectable deleteKeyCode={null}
  >
    <Background gap={props.workspace.settings.gridSize} size={1} color="var(--grid)" />
    <Controls position="bottom-left" showInteractive={false} />
  </ReactFlow>;
}

export function CanvasView(props: CanvasProps) {
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}
