import PDFDocument from "pdfkit";

const NODE_HEIGHT = 96;
const MAP_PADDING = 36;

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

function plainText(markdown = "") {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[*_~`]/g, "")
    .trim();
}

export function safeExportSlug(value, fallback = "map") {
  const slug = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
  return slug || fallback;
}

export function exportSelection(workspace, mapId, focusId = null) {
  const map = workspace.maps.find((entry) => entry.id === mapId);
  if (!map) throw new Error("Choose a map that exists before exporting.");
  const mapNodes = workspace.nodes.filter((node) => node.mapId === mapId && !node.trashedAt);
  const nodeById = new Map(mapNodes.map((node) => [node.id, node]));
  if (!focusId || !nodeById.has(focusId)) return { map, nodes: mapNodes, focus: null };

  const children = new Map();
  for (const node of mapNodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId);
    if (siblings) siblings.push(node.id);
    else children.set(node.parentId, [node.id]);
  }
  const included = new Set();
  const pending = [focusId];
  while (pending.length) {
    const id = pending.pop();
    if (!id || included.has(id)) continue;
    included.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return { map, nodes: mapNodes.filter((node) => included.has(node.id)), focus: nodeById.get(focusId) };
}

function hierarchy(nodes) {
  const ids = new Set(nodes.map((node) => node.id));
  const children = new Map();
  for (const node of nodes) {
    const parentId = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(node);
    else children.set(parentId, [node]);
  }
  return children;
}

function orderedNodes(nodes) {
  const children = hierarchy(nodes);
  const ordered = [];
  const visited = new Set();
  function append(roots, depth) {
    const pending = roots.map((node) => ({ node, depth })).reverse();
    while (pending.length) {
      const item = pending.pop();
      if (!item || visited.has(item.node.id)) continue;
      visited.add(item.node.id); ordered.push(item);
      const descendants = children.get(item.node.id) ?? [];
      for (let index = descendants.length - 1; index >= 0; index -= 1) pending.push({ node: descendants[index], depth: item.depth + 1 });
    }
  }
  append(children.get(null) ?? [], 0);
  for (const node of nodes) if (!visited.has(node.id)) append([node], 0);
  return ordered;
}

function indentation(depth) {
  return "  ".repeat(Math.min(depth, 32));
}

function categoryFor(workspace, node) {
  return workspace.categories.find((category) => category.id === node.categoryId) ?? null;
}

function taskSummary(task) {
  if (!task) return "";
  return [
    `Status: ${task.status}`,
    task.start ? `Start: ${task.start}` : "",
    task.due ? `Due: ${task.due}` : "",
    `Priority: ${task.priority}`,
    `Progress: ${task.progress}%`,
    task.milestone ? "Milestone" : "",
  ].filter(Boolean).join(" | ");
}

function noteForOutline(node) {
  const lines = plainText(node.note).split("\n");
  if (lines[0]?.trim().toLocaleLowerCase() === node.title.trim().toLocaleLowerCase()) lines.shift();
  return lines.join("\n").trim();
}

export function renderMapMarkdown(workspace, mapId, focusId = null) {
  const { map, nodes, focus } = exportSelection(workspace, mapId, focusId);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const lines = [`# ${focus ? `${map.title}: ${focus.title}` : map.title}`, ""];
  lines.push(focus ? "_Focused branch exported from AuDHDMAP._" : "_Map exported from AuDHDMAP._", "");

  for (const { node, depth } of orderedNodes(nodes)) {
    const category = categoryFor(workspace, node);
    lines.push(`${indentation(depth)}- **${node.title}**${category ? ` [${category.name}]` : ""}`);
    if (node.tags.length) lines.push(`${indentation(depth + 1)}- Tags: ${node.tags.map((tag) => `\`${tag}\``).join(", ")}`);
    if (node.task) lines.push(`${indentation(depth + 1)}- ${taskSummary(node.task)}`);
    if (node.note.trim()) {
      lines.push("");
      for (const noteLine of node.note.trim().split("\n")) lines.push(`${indentation(depth + 1)}${noteLine}`);
      lines.push("");
    }
    for (const attachment of node.attachments) lines.push(`${indentation(depth + 1)}- Attachment: ${attachment.name} (${attachment.mime}, ${attachment.size} bytes)`);
    for (const link of node.links) lines.push(`${indentation(depth + 1)}- [${link.title}](${link.url})`);
  }

  const references = workspace.edges.filter((edge) => edge.type === "reference" && nodeIds.has(edge.source) && nodeIds.has(edge.target));
  if (references.length) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    lines.push("", "## References", "");
    for (const edge of references) lines.push(`- ${nodeById.get(edge.source)?.title} ${edge.label || "references"} ${nodeById.get(edge.target)?.title}`);
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function renderMapText(workspace, mapId, focusId = null) {
  const { map, nodes, focus } = exportSelection(workspace, mapId, focusId);
  const lines = [focus ? `${map.title}: ${focus.title}` : map.title, "=".repeat(Math.min(80, (focus ? `${map.title}: ${focus.title}` : map.title).length)), ""];
  for (const { node, depth } of orderedNodes(nodes)) {
    const category = categoryFor(workspace, node);
    lines.push(`${indentation(depth)}- ${node.title}${category ? ` [${category.name}]` : ""}`);
    if (node.task) lines.push(`${indentation(depth + 1)}${taskSummary(node.task)}`);
    if (node.tags.length) lines.push(`${indentation(depth + 1)}Tags: ${node.tags.join(", ")}`);
    if (node.note.trim()) for (const noteLine of plainText(node.note).split("\n")) lines.push(`${indentation(depth + 1)}${noteLine}`);
    for (const attachment of node.attachments) lines.push(`${indentation(depth + 1)}Attachment: ${attachment.name}`);
    for (const link of node.links) lines.push(`${indentation(depth + 1)}Link: ${link.title} - ${link.url}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function spreadsheetSafe(value) {
  const text = String(value ?? "");
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  return `"${spreadsheetSafe(value).replace(/"/g, '""')}"`;
}

export function renderMapCsv(workspace, mapId, focusId = null) {
  const { map, nodes } = exportSelection(workspace, mapId, focusId);
  const ordered = orderedNodes(nodes);
  const pathById = new Map();
  const activeNodeById = new Map(workspace.nodes.filter((node) => !node.trashedAt).map((node) => [node.id, node]));
  const mapById = new Map(workspace.maps.map((entry) => [entry.id, entry]));
  const referencesByNode = new Map();
  for (const edge of workspace.edges) {
    if (edge.type !== "reference") continue;
    const source = activeNodeById.get(edge.source); const target = activeNodeById.get(edge.target);
    if (!source || !target) continue;
    const outgoing = ["out", target.id, target.title, mapById.get(target.mapId)?.title ?? "", edge.label].join("|");
    const incoming = ["in", source.id, source.title, mapById.get(source.mapId)?.title ?? "", edge.label].join("|");
    referencesByNode.set(source.id, [...(referencesByNode.get(source.id) ?? []), outgoing]);
    referencesByNode.set(target.id, [...(referencesByNode.get(target.id) ?? []), incoming]);
  }
  const headers = [
    "map_title", "map_id", "hierarchy_path", "depth", "title", "thought_id", "parent_id", "record_type",
    "status", "start", "due", "priority", "progress_percent", "milestone", "tags", "note",
    "references", "web_links", "attachments",
  ];
  const rows = [headers.map(csvCell).join(",")];

  for (const { node, depth } of ordered) {
    const parentPath = node.parentId ? pathById.get(node.parentId) : "";
    const hierarchyPath = parentPath ? `${parentPath} > ${node.title}` : node.title;
    pathById.set(node.id, hierarchyPath);
    const references = (referencesByNode.get(node.id) ?? []).join("\n");
    const links = node.links.map((link) => `${link.title}|${link.url}`).join("\n");
    const attachments = node.attachments.map((attachment) => `${attachment.name}|${attachment.mime}|${attachment.size}`).join("\n");
    const values = [
      map.title, map.id, hierarchyPath, depth, node.title, node.id, node.parentId ?? "", node.task ? "task" : "thought",
      node.task?.status ?? "", node.task?.start ?? "", node.task?.due ?? "", node.task?.priority ?? "",
      node.task?.progress ?? "", node.task ? String(node.task.milestone) : "", node.tags.join("|"), plainText(node.note),
      references, links, attachments,
    ];
    rows.push(values.map(csvCell).join(","));
  }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

function mapGeometry(workspace, mapId, focusId = null) {
  const selection = exportSelection(workspace, mapId, focusId);
  const ids = new Set(selection.nodes.map((node) => node.id));
  const includedGroupIds = new Set(selection.nodes.map((node) => node.groupId).filter(Boolean));
  const groups = workspace.groups.filter((group) => group.mapId === mapId && includedGroupIds.has(group.id));
  const boxes = [
    ...selection.nodes.map((node) => ({ x: node.x, y: node.y, width: node.width, height: NODE_HEIGHT })),
    ...groups.map((group) => ({ x: group.x, y: group.y, width: group.width, height: group.height })),
  ];
  const minX = boxes.length ? Math.min(...boxes.map((box) => box.x)) : 0;
  const minY = boxes.length ? Math.min(...boxes.map((box) => box.y)) : 0;
  const maxX = boxes.length ? Math.max(...boxes.map((box) => box.x + box.width)) : 800;
  const maxY = boxes.length ? Math.max(...boxes.map((box) => box.y + box.height)) : 500;
  return {
    ...selection,
    groups,
    edges: workspace.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    bounds: { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) },
  };
}

function splitTitle(title, max = 28) {
  const words = String(title).split(/\s+/).filter(Boolean);
  const lines = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > max) lines.push(word.slice(0, max));
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines.slice(0, 3);
}

export function renderMapSvg(workspace, mapId, focusId = null) {
  const geometry = mapGeometry(workspace, mapId, focusId);
  const width = geometry.bounds.width + MAP_PADDING * 2;
  const height = geometry.bounds.height + MAP_PADDING * 2 + 62;
  const offsetX = MAP_PADDING - geometry.bounds.minX;
  const offsetY = MAP_PADDING + 62 - geometry.bounds.minY;
  const nodeById = new Map(geometry.nodes.map((node) => [node.id, node]));
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" role="img" aria-labelledby="title description">`,
    `<title id="title">${escapeXml(geometry.focus ? `${geometry.map.title}: ${geometry.focus.title}` : geometry.map.title)}</title>`,
    `<desc id="description">AuDHDMAP visual map export with ${geometry.nodes.length} thoughts.</desc>`,
    `<rect width="100%" height="100%" fill="#f5f1e8"/>`,
    `<text x="${MAP_PADDING}" y="32" font-family="ui-monospace, monospace" font-size="20" font-weight="700" fill="#27231d">${escapeXml(geometry.focus ? `${geometry.map.title}: ${geometry.focus.title}` : geometry.map.title)}</text>`,
    `<text x="${MAP_PADDING}" y="50" font-family="system-ui, sans-serif" font-size="11" fill="#6e665b">AuDHDMAP ${geometry.focus ? "focused branch" : "map"} export</text>`,
  ];

  for (const group of geometry.groups) {
    parts.push(`<rect x="${group.x + offsetX}" y="${group.y + offsetY}" width="${group.width}" height="${group.height}" rx="${group.shape === "cloud" ? 28 : 8}" fill="${group.color}" fill-opacity="0.07" stroke="${group.color}" stroke-width="2" stroke-dasharray="${group.shape === "bracket" ? "12 7" : "none"}"/>`);
    parts.push(`<text x="${group.x + offsetX + 12}" y="${group.y + offsetY + 21}" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="${group.color}">${escapeXml(group.title)}</text>`);
  }
  for (const edge of geometry.edges) {
    const source = nodeById.get(edge.source); const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    const x1 = source.x + source.width / 2 + offsetX; const y1 = source.y + NODE_HEIGHT / 2 + offsetY;
    const x2 = target.x + target.width / 2 + offsetX; const y2 = target.y + NODE_HEIGHT / 2 + offsetY;
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#82786c" stroke-width="${edge.type === "reference" ? 1.5 : 2.5}" stroke-dasharray="${edge.type === "reference" ? "7 5" : "none"}"/>`);
  }
  for (const node of geometry.nodes) {
    const category = categoryFor(workspace, node);
    const x = node.x + offsetX; const y = node.y + offsetY;
    parts.push(`<rect x="${x}" y="${y}" width="${node.width}" height="${NODE_HEIGHT}" rx="${node.shape === "square" ? 0 : node.shape === "pill" ? 42 : 10}" fill="#fffdf8" stroke="#b9ae9f" stroke-width="1.5"/>`);
    parts.push(`<rect x="${x}" y="${y}" width="6" height="${NODE_HEIGHT}" rx="3" fill="${category?.color ?? "#64748b"}"/>`);
    parts.push(`<text x="${x + 16}" y="${y + 20}" font-family="system-ui, sans-serif" font-size="9" font-weight="700" letter-spacing=".8" fill="${category?.color ?? "#64748b"}">${escapeXml((category?.name ?? "Thought").toUpperCase())}</text>`);
    splitTitle(node.title).forEach((line, index) => parts.push(`<text x="${x + 16}" y="${y + 43 + index * 16}" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#27231d">${escapeXml(line)}</text>`));
    if (node.task) parts.push(`<text x="${x + 16}" y="${y + 86}" font-family="ui-monospace, monospace" font-size="9" fill="#6e665b">${escapeXml(`${node.task.status}${node.task.due ? ` | ${node.task.due}` : ""}`)}</text>`);
  }
  parts.push(`</svg>`);
  return `${parts.join("\n")}\n`;
}

function drawPdfOverview(document, workspace, geometry) {
  const page = document.page;
  const title = geometry.focus ? `${geometry.map.title}: ${geometry.focus.title}` : geometry.map.title;
  document.fillColor("#27231d").font("Helvetica-Bold").fontSize(20).text(title, 36, 28, { lineBreak: false });
  document.fillColor("#6e665b").font("Helvetica").fontSize(9).text(`AuDHDMAP ${geometry.focus ? "focused branch" : "map"} export | ${geometry.nodes.length} thoughts`, 36, 53, { lineBreak: false });
  const area = { x: 36, y: 76, width: page.width - 72, height: page.height - 118 };
  const scale = Math.min(area.width / geometry.bounds.width, area.height / geometry.bounds.height, 1.4);
  const offsetX = area.x + (area.width - geometry.bounds.width * scale) / 2 - geometry.bounds.minX * scale;
  const offsetY = area.y + (area.height - geometry.bounds.height * scale) / 2 - geometry.bounds.minY * scale;
  const nodeById = new Map(geometry.nodes.map((node) => [node.id, node]));

  for (const group of geometry.groups) {
    document.save().fillOpacity(0.06).fillColor(group.color).strokeOpacity(0.7).strokeColor(group.color).lineWidth(1.2)
      .roundedRect(group.x * scale + offsetX, group.y * scale + offsetY, group.width * scale, group.height * scale, 6).fillAndStroke().restore();
  }
  for (const edge of geometry.edges) {
    const source = nodeById.get(edge.source); const target = nodeById.get(edge.target);
    if (!source || !target) continue;
    document.save().strokeColor("#82786c").lineWidth(edge.type === "reference" ? 0.8 : 1.4);
    if (edge.type === "reference") document.dash(4, { space: 3 });
    document.moveTo((source.x + source.width / 2) * scale + offsetX, (source.y + NODE_HEIGHT / 2) * scale + offsetY)
      .lineTo((target.x + target.width / 2) * scale + offsetX, (target.y + NODE_HEIGHT / 2) * scale + offsetY).stroke().restore();
  }
  for (const node of geometry.nodes) {
    const category = categoryFor(workspace, node);
    const x = node.x * scale + offsetX; const y = node.y * scale + offsetY; const width = node.width * scale; const height = NODE_HEIGHT * scale;
    document.save().fillColor("#fffdf8").strokeColor("#b9ae9f").lineWidth(0.8).roundedRect(x, y, width, height, Math.min(7, 7 * scale)).fillAndStroke();
    document.fillColor(category?.color ?? "#64748b").rect(x, y, Math.max(3, 5 * scale), height).fill();
    const fontSize = Math.max(5.5, Math.min(10, 10 * scale));
    document.fillColor("#27231d").font("Helvetica-Bold").fontSize(fontSize).text(node.title, x + 10 * scale, y + 19 * scale, { width: width - 18 * scale, height: height - 25 * scale, ellipsis: true });
    document.restore();
  }
}

function drawPdfOutline(document, workspace, geometry) {
  document.addPage({ size: "A4", margin: 54 });
  document.fillColor("#27231d").font("Helvetica-Bold").fontSize(20).text(`${geometry.map.title} outline`);
  document.moveDown(0.25).fillColor("#6e665b").font("Helvetica").fontSize(9).text(`${geometry.nodes.length} thoughts | Notes and task details included`);
  document.moveDown(1.2);
  for (const { node, depth } of orderedNodes(geometry.nodes)) {
    const category = categoryFor(workspace, node);
    if (document.y > document.page.height - 100) document.addPage({ size: "A4", margin: 54 });
    const x = 54 + Math.min(depth, 8) * 18;
    const width = document.page.width - x - 54;
    document.fillColor(category?.color ?? "#64748b").font("Helvetica-Bold").fontSize(8).text((category?.name ?? "Thought").toUpperCase(), x, document.y, { width });
    document.fillColor("#27231d").font("Helvetica-Bold").fontSize(12).text(node.title, x, document.y + 2, { width });
    const metadata = [node.tags.length ? `Tags: ${node.tags.join(", ")}` : "", taskSummary(node.task)].filter(Boolean).join(" | ");
    if (metadata) document.fillColor("#6e665b").font("Helvetica").fontSize(8).text(metadata, x, document.y + 2, { width });
    const note = noteForOutline(node);
    if (note) document.fillColor("#403a32").font("Helvetica").fontSize(9).text(note, x, document.y + 4, { width, lineGap: 2 });
    for (const link of node.links) document.fillColor("#246b72").font("Helvetica").fontSize(8).text(`${link.title}: ${link.url}`, x, document.y + 3, { width, link: link.url, underline: true });
    for (const attachment of node.attachments) document.fillColor("#6e665b").font("Helvetica").fontSize(8).text(`Attachment: ${attachment.name} (${attachment.mime})`, x, document.y + 3, { width });
    document.moveDown(0.8);
  }
}

export async function renderMapPdf(workspace, mapId, focusId = null) {
  const geometry = mapGeometry(workspace, mapId, focusId);
  const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: geometry.focus ? `${geometry.map.title}: ${geometry.focus.title}` : geometry.map.title, Author: "AuDHDMAP", Subject: "Visual map and outline export" } });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => { document.once("end", resolve); document.once("error", reject); });
  drawPdfOverview(document, workspace, geometry);
  drawPdfOutline(document, workspace, geometry);
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    const footerY = document.page.height - document.page.margins.bottom - 12;
    document.fillColor("#8a8176").font("Helvetica").fontSize(8).text(`AuDHDMAP | ${index + 1} of ${range.count}`, 54, footerY, { width: document.page.width - 108, align: "right", lineBreak: false });
  }
  document.end();
  await completed;
  return Buffer.concat(chunks);
}
