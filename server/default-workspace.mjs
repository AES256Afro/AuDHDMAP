export function defaultWorkspace(now = new Date()) {
  const createdAt = now.toISOString();
  return {
    schemaVersion: 1,
    revision: 0,
    maps: [
      { id: "map-home-server", title: "Home server rebuild", createdAt, updatedAt: createdAt },
      { id: "map-inbox", title: "Inbox", createdAt, updatedAt: createdAt },
    ],
    categories: [
      { id: "decision", name: "Decision", color: "#8b6cf6", icon: "◆" },
      { id: "question", name: "Question", color: "#e5a84b", icon: "?" },
      { id: "evidence", name: "Evidence", color: "#47b6a8", icon: "●" },
      { id: "risk", name: "Risk", color: "#df6c62", icon: "!" },
      { id: "action", name: "Next action", color: "#55a5c8", icon: "✓" },
    ],
    nodes: [
      {
        id: "node-root", mapId: "map-home-server", parentId: null, groupId: null,
        title: "Home server rebuild", note: "# Home server rebuild\n\nA working map can begin as loose thoughts, then become a project only when dates and dependencies are useful.",
        x: 80, y: 260, width: 220, shape: "rounded", categoryId: "decision", tags: ["server"], attachments: [], links: [],
        task: null, createdAt, updatedAt: createdAt,
      },
      {
        id: "node-inventory", mapId: "map-home-server", parentId: "node-root", groupId: "group-preparation",
        title: "Inventory", note: "List the hardware, services, data, accounts, and network dependencies that already exist.",
        x: 390, y: 120, width: 190, shape: "rounded", categoryId: "evidence", tags: ["hardware"], attachments: [], links: [],
        task: { status: "doing", start: "2026-09-14", due: "2026-09-16", progress: 50, priority: "medium", milestone: false }, createdAt, updatedAt: createdAt,
      },
      {
        id: "node-storage", mapId: "map-home-server", parentId: "node-root", groupId: "group-preparation",
        title: "Storage plan", note: "## Storage plan\n\nDefine capacity, drives, redundancy, and filesystem choices.\n\n### Decision\n\nKeep application data and recovery copies on separately recoverable storage.",
        x: 390, y: 260, width: 210, shape: "rounded", categoryId: "decision", tags: ["storage", "backup"], attachments: [], links: [],
        task: { status: "doing", start: "2026-09-15", due: "2026-09-18", progress: 50, priority: "high", milestone: false }, createdAt, updatedAt: createdAt,
      },
      {
        id: "node-backups", mapId: "map-home-server", parentId: "node-storage", groupId: "group-preparation",
        title: "Backups", note: "Back up the controller and every application. Keep at least one copy away from the server.",
        x: 700, y: 130, width: 190, shape: "rounded", categoryId: "question", tags: ["recovery"], attachments: [], links: [],
        task: { status: "todo", start: "2026-09-18", due: "2026-09-20", progress: 0, priority: "high", milestone: false }, createdAt, updatedAt: createdAt,
      },
      {
        id: "node-network", mapId: "map-home-server", parentId: "node-root", groupId: null,
        title: "Network", note: "Record service addresses, reachability, DNS, and the cutover order.",
        x: 390, y: 430, width: 190, shape: "rounded", categoryId: "risk", tags: ["network"], attachments: [], links: [],
        task: { status: "todo", start: "2026-09-19", due: "2026-09-22", progress: 0, priority: "medium", milestone: false }, createdAt, updatedAt: createdAt,
      },
      {
        id: "node-apps", mapId: "map-home-server", parentId: "node-network", groupId: null,
        title: "App migration", note: "Move one service at a time. Verify it before changing the next dependency.",
        x: 700, y: 400, width: 190, shape: "rounded", categoryId: "action", tags: ["apps"], attachments: [], links: [],
        task: { status: "todo", start: "2026-09-22", due: "2026-09-25", progress: 0, priority: "medium", milestone: false }, createdAt, updatedAt: createdAt,
      },
      {
        id: "node-restore", mapId: "map-home-server", parentId: "node-backups", groupId: "group-preparation",
        title: "Test restore", note: "## Goal\n\nVerify that backups can be restored completely.\n\n## Acceptance\n\n- [ ] All services start\n- [ ] Data integrity verified",
        x: 700, y: 270, width: 190, shape: "rounded", categoryId: "action", tags: ["recovery"], attachments: [], links: [],
        task: { status: "todo", start: "2026-09-25", due: "2026-09-27", progress: 0, priority: "high", milestone: true }, createdAt, updatedAt: createdAt,
      },
      {
        id: "node-inbox", mapId: "map-inbox", parentId: null, groupId: null,
        title: "Drop thoughts here", note: "This map is for thoughts that do not have a structure yet.",
        x: 180, y: 180, width: 210, shape: "rounded", categoryId: null, tags: [], attachments: [], links: [], task: null, createdAt, updatedAt: createdAt,
      },
    ],
    edges: [
      { id: "edge-root-inventory", mapId: "map-home-server", source: "node-root", target: "node-inventory", type: "branch", label: "" },
      { id: "edge-root-storage", mapId: "map-home-server", source: "node-root", target: "node-storage", type: "branch", label: "" },
      { id: "edge-storage-backups", mapId: "map-home-server", source: "node-storage", target: "node-backups", type: "branch", label: "depends on" },
      { id: "edge-root-network", mapId: "map-home-server", source: "node-root", target: "node-network", type: "branch", label: "" },
      { id: "edge-network-apps", mapId: "map-home-server", source: "node-network", target: "node-apps", type: "branch", label: "" },
      { id: "edge-backups-restore", mapId: "map-home-server", source: "node-backups", target: "node-restore", type: "branch", label: "proves" },
      { id: "edge-apps-restore", mapId: "map-home-server", source: "node-apps", target: "node-restore", type: "reference", label: "before cutover" },
    ],
    groups: [
      { id: "group-preparation", mapId: "map-home-server", title: "Preparation", description: "Inventory, storage, and recovery work that should be resolved before cutover.", x: 350, y: 70, width: 600, height: 310, color: "#47b6a8", shape: "rectangle", collapsed: false },
    ],
    settings: {
      theme: "quiet",
      snapToGrid: true,
      gridSize: 16,
      reducedMotion: false,
      crtEffects: true,
      brightness: 100,
      saturation: 100,
      lineThickness: 2,
      branchFont: "system",
      nodeShape: "rounded",
    },
  };
}
