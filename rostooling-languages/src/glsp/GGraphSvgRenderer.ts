/**
 * Pure (DOM-free) geometry + SVG rendering for the server-layouted RosTooling GGraph.
 *
 * Shared by:
 *  - the webview .rossystem canvas (interactive React SVG, same geometry),
 *  - the webview "Export SVG" button,
 *  - the headless MCP `export_system_diagram` tool.
 *
 * Layout is NEVER computed here: node positions/sizes, port positions and orthogonal edge
 * routing points come from the Java server (Eclipse ELK in RosLayoutEngine). This module only
 * converts relative GModel coordinates to absolute ones and draws Sprotty-style
 * JumpingPolylineEdgeView arc bridges where a horizontal wire segment crosses a vertical one.
 */

export interface GPointLike {
  x: number;
  y: number;
}

export interface GElementLike {
  id: string;
  type: string;
  children?: GElementLike[];
  position?: GPointLike;
  size?: { width: number; height: number };
  args?: Record<string, unknown>;
  text?: string;
  sourceId?: string;
  targetId?: string;
  routingPoints?: GPointLike[];
}

export interface GMarkerLike {
  elementId: string;
  kind: string;
  description?: string;
  label?: string;
}

export type PortKind = 'pub' | 'sub' | 'ss' | 'sc' | 'as' | 'ac';

export interface DiagramPort {
  id: string;
  kind: PortKind;
  name: string;
  spec: string;
  explicit: boolean;
  /** "name : Type", wrapped by the server to the card width. */
  labelLines: string[];
  nodeId: string;
  side: 'west' | 'east';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where wires attach: outer edge of the port, vertically centred. */
  anchor: GPointLike;
}

export interface DiagramNode {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  parentId?: string;
  el: GElementLike;
  ports: DiagramPort[];
}

export interface DiagramEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: 'topic' | 'service' | 'action';
  label: string;
  points: GPointLike[];
  path: string;
  midpoint: GPointLike;
}

export interface DiagramLayout {
  nodes: DiagramNode[];
  ports: Map<string, DiagramPort>;
  edges: DiagramEdge[];
  bounds: { x: number; y: number; w: number; h: number };
}

export const PORT_COLORS: Record<PortKind, string> = {
  pub: '#2ec49b',
  sub: '#4c9aff',
  ss: '#f59e0b',
  sc: '#f97316',
  as: '#a855f7',
  ac: '#ec4899',
};

export const EDGE_COLORS: Record<'topic' | 'service' | 'action', string> = {
  topic: '#2ec49b',
  service: '#f59e0b',
  action: '#a855f7',
};

const JUMP_RADIUS = 5;

// --------------------------------------------------------------------------------------------
// Geometry
// --------------------------------------------------------------------------------------------

export function layoutFromGGraph(graph: GElementLike | null | undefined): DiagramLayout {
  const nodes: DiagramNode[] = [];
  const ports = new Map<string, DiagramPort>();
  const edges: DiagramEdge[] = [];
  if (!graph) {
    return { nodes, ports, edges, bounds: { x: 0, y: 0, w: 800, h: 600 } };
  }

  const visit = (el: GElementLike, offX: number, offY: number, depth: number, parentId?: string) => {
    for (const child of el.children || []) {
      if (!child.type.startsWith('node:')) continue;
      const x = offX + (child.position?.x || 0);
      const y = offY + (child.position?.y || 0);
      const w = child.size?.width || 280;
      const h = child.size?.height || 120;
      const node: DiagramNode = { id: child.id, type: child.type, x, y, w, h, depth, parentId, el: child, ports: [] };
      for (const p of child.children || []) {
        if (!p.type.startsWith('port:')) continue;
        const px = x + (p.position?.x || 0);
        const py = y + (p.position?.y || 0);
        const pw = p.size?.width || 12;
        const ph = p.size?.height || 12;
        const side: 'west' | 'east' = (p.position?.x || 0) < w / 2 ? 'west' : 'east';
        const port: DiagramPort = {
          id: p.id,
          kind: p.type.slice('port:'.length) as PortKind,
          name: String(p.args?.interfaceName || p.id),
          spec: String(p.args?.specName || ''),
          labelLines: p.args?.labelLines ? String(p.args.labelLines).split('\n') : [],
          explicit: Boolean(p.args?.isExplicit),
          nodeId: child.id,
          side,
          x: px,
          y: py,
          w: pw,
          h: ph,
          anchor: { x: side === 'west' ? px : px + pw, y: py + ph / 2 },
        };
        node.ports.push(port);
        ports.set(port.id, port);
      }
      nodes.push(node);
      visit(child, x, y, depth + 1, child.id);
    }
  };
  visit(graph, 0, 0, 0);

  for (const el of graph.children || []) {
    if (el.type !== 'edge:ros-connection' || !el.sourceId || !el.targetId) continue;
    const src = ports.get(el.sourceId);
    const tgt = ports.get(el.targetId);
    if (!src || !tgt) continue;
    const kindArg = String(el.args?.connectionKind || 'topic');
    const kind = (kindArg === 'service' || kindArg === 'action' ? kindArg : 'topic') as DiagramEdge['kind'];
    const points = edgePoints(src, tgt, el.routingPoints || []);
    edges.push({
      id: el.id,
      sourceId: el.sourceId,
      targetId: el.targetId,
      kind,
      label: String(el.args?.fromInterfaceName || src.name),
      points,
      path: '',
      midpoint: polylineMidpoint(points),
    });
  }
  applyJumpPaths(edges);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const n of nodes) {
    grow(n.x - 16, n.y - 8);
    grow(n.x + n.w + 16, n.y + n.h + 8);
  }
  for (const e of edges) for (const p of e.points) grow(p.x, p.y);
  if (!isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }
  const pad = 24;
  return {
    nodes,
    ports,
    edges,
    bounds: { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad },
  };
}

/** ELK routing points run port-edge to port-edge; fall back to a simple elbow when absent. */
function edgePoints(src: DiagramPort, tgt: DiagramPort, routing: GPointLike[]): GPointLike[] {
  let pts: GPointLike[];
  if (routing.length >= 2) {
    pts = routing.map((p) => ({ x: p.x, y: p.y }));
    if (dist(pts[0], src.anchor) > 1) pts.unshift({ ...src.anchor });
    if (dist(pts[pts.length - 1], tgt.anchor) > 1) pts.push({ ...tgt.anchor });
  } else {
    const a = src.anchor;
    const b = tgt.anchor;
    const midX = a.x + (b.x - a.x) / 2;
    pts = [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  return simplify(pts);
}

function dist(a: GPointLike, b: GPointLike): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function simplify(pts: GPointLike[]): GPointLike[] {
  const out: GPointLike[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && dist(last, p) < 0.5) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      const collinear =
        (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) ||
        (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5);
      if (collinear) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

function polylineMidpoint(pts: GPointLike[]): GPointLike {
  if (pts.length === 0) return { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  let remaining = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (seg >= remaining && seg > 0) {
      const t = remaining / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    remaining -= seg;
  }
  return pts[pts.length - 1];
}

/**
 * Sprotty JumpingPolylineEdgeView behaviour: wherever a horizontal segment of an edge crosses a
 * vertical segment of another edge, draw a semicircular bridge (`A r r 0 0 1`) on the horizontal
 * segment. Crossings within 2r of a segment end (bends, ports) are not bridged.
 */
export function applyJumpPaths(edges: DiagramEdge[], radius = JUMP_RADIUS): void {
  const verticals: { edge: number; x: number; y1: number; y2: number }[] = [];
  edges.forEach((e, idx) => {
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1];
      const b = e.points[i];
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5) {
        verticals.push({ edge: idx, x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) });
      }
    }
  });

  edges.forEach((e, idx) => {
    const pts = e.points;
    if (pts.length === 0) {
      e.path = '';
      return;
    }
    let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const horizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 0.5;
      if (horizontal) {
        const dir = b.x > a.x ? 1 : -1;
        const lo = Math.min(a.x, b.x) + 2 * radius;
        const hi = Math.max(a.x, b.x) - 2 * radius;
        const crossings = verticals
          .filter((v) => v.edge !== idx && v.x > lo && v.x < hi && a.y > v.y1 + radius && a.y < v.y2 - radius)
          .map((v) => v.x)
          .sort((p, q) => (p - q) * dir);
        let lastX = -Infinity;
        for (const cx of crossings) {
          if (Math.abs(cx - lastX) < 2 * radius + 1) continue;
          lastX = cx;
          d += ` L ${fmt(cx - dir * radius)} ${fmt(a.y)} A ${radius} ${radius} 0 0 ${dir > 0 ? 1 : 0} ${fmt(cx + dir * radius)} ${fmt(a.y)}`;
        }
      }
      d += ` L ${fmt(b.x)} ${fmt(b.y)}`;
    }
    e.path = d;
  });
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

// --------------------------------------------------------------------------------------------
// Standalone SVG (export + MCP)
// --------------------------------------------------------------------------------------------

export function escapeXml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface RenderOptions {
  title?: string;
  dark?: boolean;
}

function renderNodePortsSvg(
  out: string[],
  n: DiagramNode,
  c: { card: string; text: string },
  errorIds: Set<string>
): void {
  for (const p of n.ports) {
    const col = PORT_COLORS[p.kind] || '#94a3b8';
    out.push(`<rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.w)}" height="${fmt(p.h)}" rx="2" fill="${col}" stroke="${errorIds.has(p.id) ? '#ef4444' : c.card}" stroke-width="1"/>`);
    const ly = p.y + p.h / 2 + 4;
    const label = `${p.name}${p.spec ? ` : ${p.spec.split('/').pop()}` : ''}`;
    const lines = p.labelLines.length ? p.labelLines : [truncate(label, 20)];
    const west = p.side === 'west';
    const lx = west ? n.x + 8 : n.x + n.w - 8;
    const tspans = lines.map((line, i) => `<tspan x="${fmt(lx)}" dy="${i === 0 ? 0 : 13}">${escapeXml(line)}</tspan>`).join('');
    out.push(`<text x="${fmt(lx)}" y="${fmt(ly)}" font-size="10.5"${west ? '' : ' text-anchor="end"'} fill="${c.text}">${tspans}</text>`);
  }
}

/**
 * Renders the ELK-layouted GGraph as a self-contained SVG document (inline styles, no external
 * resources), suitable for files, docs and PRs.
 */
export function renderDiagramSvg(
  graph: GElementLike | null | undefined,
  markers: GMarkerLike[] = [],
  options: RenderOptions = {}
): string {
  const layout = layoutFromGGraph(graph);
  const c = options.dark
    ? { bg: '#0f172a', card: '#1e293b', head: '#334155', text: '#e2e8f0', muted: '#94a3b8', border: '#475569', frame: '#64748b' }
    : { bg: '#ffffff', card: '#ffffff', head: '#f1f5f9', text: '#0f172a', muted: '#475569', border: '#cbd5e1', frame: '#94a3b8' };
  const errorIds = new Set(markers.filter((m) => m.kind === 'error').map((m) => m.elementId));
  const { x, y, w, h } = layout.bounds;
  const titleH = options.title ? 28 : 0;
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y - titleH)} ${fmt(w)} ${fmt(h + titleH)}" width="${Math.ceil(w)}" height="${Math.ceil(h + titleH)}" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif">`
  );
  out.push('<defs>');
  for (const [k, col] of Object.entries(EDGE_COLORS)) {
    out.push(
      `<marker id="arrow-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${col}"/></marker>`
    );
  }
  out.push('</defs>');
  out.push(`<rect x="${fmt(x)}" y="${fmt(y - titleH)}" width="${fmt(w)}" height="${fmt(h + titleH)}" fill="${c.bg}"/>`);
  if (options.title) {
    out.push(`<text x="${fmt(x + 16)}" y="${fmt(y - 8)}" font-size="15" font-weight="700" fill="${c.text}">${escapeXml(options.title)}</text>`);
  }

  // Containers first (subsystems, processes), then ROS nodes, then wires on top.
  const containers = layout.nodes.filter((n) => n.type !== 'node:ros-node').sort((a, b) => a.depth - b.depth);
  for (const n of containers) {
    if (n.type === 'node:subsystem') {
      const name = String(n.el.args?.subSystemName || n.id);
      const collapsed = Boolean(n.el.args?.collapsed);
      out.push(
        `<rect x="${fmt(n.x)}" y="${fmt(n.y)}" width="${fmt(n.w)}" height="${fmt(n.h)}" rx="10" fill="${options.dark ? '#111827' : '#f8fafc'}" stroke="${errorIds.has(n.id) ? '#ef4444' : c.frame}" stroke-width="1.5" stroke-dasharray="6 4"/>`
      );
      out.push(`<text x="${fmt(n.x + 14)}" y="${fmt(n.y + 22)}" font-size="12" font-weight="700" fill="${c.text}">${escapeXml(`SubSystem: ${name}`)}${collapsed ? ' (collapsed)' : ''}</text>`);
      if (collapsed && n.ports.length > 0) {
        out.push(`<line x1="${fmt(n.x + 8)}" y1="${fmt(n.y + 34)}" x2="${fmt(n.x + n.w - 8)}" y2="${fmt(n.y + 34)}" stroke="${c.frame}" stroke-opacity="0.35" stroke-width="1"/>`);
        renderNodePortsSvg(out, n, c, errorIds);
      }
    } else if (n.type === 'node:process') {
      const name = String(n.el.args?.processName || n.id);
      const threads = String(n.el.args?.threads ?? '');
      out.push(
        `<rect x="${fmt(n.x)}" y="${fmt(n.y)}" width="${fmt(n.w)}" height="${fmt(n.h)}" rx="10" fill="none" stroke="${c.frame}" stroke-width="1.2"/>`
      );
      out.push(`<text x="${fmt(n.x + 14)}" y="${fmt(n.y + 22)}" font-size="12" font-weight="700" fill="${c.text}">${escapeXml(`Process: ${name}`)}</text>`);
      out.push(`<text x="${fmt(n.x + 14)}" y="${fmt(n.y + 40)}" font-size="11" fill="${c.muted}">${escapeXml(`threads: ${threads}`)}</text>`);
    }
  }

  for (const n of layout.nodes.filter((nn) => nn.type === 'node:ros-node')) {
    const a = n.el.args || {};
    const name = String(a.nodeName || n.id);
    const ns = String(a.namespace || '');
    const from = String(a.from || '');
    const hasError = errorIds.has(n.id) || n.ports.some((p) => errorIds.has(p.id));
    out.push(
      `<rect x="${fmt(n.x)}" y="${fmt(n.y)}" width="${fmt(n.w)}" height="${fmt(n.h)}" rx="8" fill="${c.card}" stroke="${hasError ? '#ef4444' : c.border}" stroke-width="${hasError ? 2 : 1.2}"/>`
    );
    const fromLines = String(a.fromLines ?? from).split('\n');
    const headExtra = Math.max(0, fromLines.length - 1) * 13;
    out.push(`<path d="M ${fmt(n.x)} ${fmt(n.y + 8)} a 8 8 0 0 1 8 -8 h ${fmt(n.w - 16)} a 8 8 0 0 1 8 8 v ${44 + headExtra} h ${fmt(-n.w)} z" fill="${c.head}"/>`);
    const title = ns ? `${ns.replace(/\/$/, '')}/${name}` : name;
    // Long names are truncated on the card; the full name stays available as the hover title.
    out.push(`<text x="${fmt(n.x + 12)}" y="${fmt(n.y + 22)}" font-size="13" font-weight="700" fill="${c.text}"><title>${escapeXml(`${title}${from ? ` (${from})` : ''}`)}</title>${escapeXml(truncate(title, Number(a.titleMaxChars) || 34))}</text>`);
    out.push(`<text x="${fmt(n.x + 12)}" y="${fmt(n.y + 40)}" font-size="10.5" fill="${c.muted}">${fromLines.map((line, i) => `<tspan x="${fmt(n.x + 12)}" dy="${i === 0 ? 0 : 13}">${escapeXml(line)}</tspan>`).join('')}</text>`);
    const badges: string[] = [];
    if (a.isLifecycle) badges.push('LC');
    if (a.totalParams !== undefined) badges.push(`${a.activeParams ?? 0}/${a.totalParams} params`);
    let bx = n.x + n.w - 10;
    for (const b of badges.reverse()) {
      const bw = 8 + b.length * 6.2;
      bx -= bw;
      out.push(`<rect x="${fmt(bx)}" y="${fmt(n.y + 10)}" width="${fmt(bw)}" height="16" rx="8" fill="${b === 'LC' ? '#7c3aed' : c.border}"/>`);
      out.push(`<text x="${fmt(bx + bw / 2)}" y="${fmt(n.y + 21.5)}" font-size="9.5" text-anchor="middle" font-weight="700" fill="${b === 'LC' ? '#ffffff' : c.text}">${escapeXml(b)}</text>`);
      bx -= 4;
    }
    renderNodePortsSvg(out, n, c, errorIds);
  }

  for (const e of layout.edges) {
    const col = EDGE_COLORS[e.kind];
    const err = errorIds.has(e.id);
    out.push(`<path d="${e.path}" fill="none" stroke="${err ? '#ef4444' : col}" stroke-width="1.8" ${err ? 'stroke-dasharray="5 3" ' : ''}marker-end="url(#arrow-${e.kind})"/>`);
  }

  out.push('</svg>');
  return out.join('\n');
}
