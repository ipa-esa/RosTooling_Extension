import * as fs from 'fs';
import * as path from 'path';
import { RosProject, RosLayoutSchematic } from './RosModelTypes';

export const RosLayoutManager = {
  /**
   * Safely normalize interfaces from various catalogue formats:
   * 1. Object map format: { "odom_cart": "sub", "scan_cart": "sub" } or { "cmd_vel": { kind: "sub", type: "Twist" } }
   * 2. Array format: [{ name: "cmd_vel", kind: "sub", type: "Twist" }]
   */
  normalizeInterfaces(rawIfaces: unknown): { name: string; label: string; kind: string; type: string }[] {
    if (!rawIfaces) return [];
    if (Array.isArray(rawIfaces)) {
      return rawIfaces.map((f) => ({
        name: f.name || f.label || '',
        label: f.label || f.name || '',
        kind: f.kind || 'pub',
        type: f.type || '',
      }));
    }
    if (typeof rawIfaces === 'object') {
      return Object.entries(rawIfaces as Record<string, unknown>).map(([k, val]) => {
        if (typeof val === 'string') {
          return { name: k, label: k, kind: val, type: '' };
        }
        const obj = val as Record<string, unknown> | null;
        return {
          name: (obj?.name as string) || (obj?.label as string) || k,
          label: (obj?.label as string) || (obj?.name as string) || k,
          kind: (obj?.kind as string) || 'pub',
          type: (obj?.type as string) || '',
        };
      });
    }
    return [];
  },

  /**
   * Resolve layout file path under Option 2:
   * ${workspaceRoot}/.rostooling/layout/<model_name>.<ext>.layout.json
   */
  getLayoutFilePath(docFilePath: string, workspaceRoot?: string): string {
    const rootDir = workspaceRoot || path.dirname(docFilePath);
    const layoutDir = path.join(rootDir, '.rostooling', 'layout');
    try {
      if (!fs.existsSync(layoutDir)) {
        fs.mkdirSync(layoutDir, { recursive: true });
      }
    } catch (e) {
      console.warn('Failed to create .rostooling/layout directory:', e);
    }
    const baseName = path.basename(docFilePath);
    return path.join(layoutDir, `${baseName}.layout.json`);
  },

  /**
   * Read and parse layout JSON schematic from disk
   */
  loadLayoutSchematic(docFilePath: string, workspaceRoot?: string): RosLayoutSchematic | null {
    try {
      const primaryPath = this.getLayoutFilePath(docFilePath, workspaceRoot);
      let targetPath = primaryPath;
      if (!fs.existsSync(targetPath)) {
        const sidePath = `${docFilePath}.layout.json`;
        if (fs.existsSync(sidePath)) {
          targetPath = sidePath;
        } else {
          return null;
        }
      }
      const raw = fs.readFileSync(targetPath, 'utf-8');
      return JSON.parse(raw) as RosLayoutSchematic;
    } catch (err) {
      console.warn(`Failed to read layout schematic for ${docFilePath}:`, err);
      return null;
    }
  },

  /**
   * Apply schematic visual attributes onto in-memory RosProject
   */
  applyLayoutSchematic(project: RosProject, schematic: RosLayoutSchematic): void {
    if (!project.view) project.view = {};
    if (schematic.canvas) {
      if (schematic.canvas.view) {
        if (schematic.canvas.view.tx != null) project.view.tx = schematic.canvas.view.tx;
        if (schematic.canvas.view.ty != null) project.view.ty = schematic.canvas.view.ty;
        if (schematic.canvas.view.zoom != null) project.view.k = schematic.canvas.view.zoom;
      }
      if (schematic.canvas.connectorMode) {
        project.view.connectorMode = schematic.canvas.connectorMode;
      }
    }

    if (!project.view.nodeSize) project.view.nodeSize = {};
    if (Array.isArray(schematic.nodes)) {
      for (const sn of schematic.nodes) {
        const node = project.nodes.find((n) => n.id === sn.id || n.label === sn.label);
        if (node) {
          if (sn.x != null) node.x = sn.x;
          if (sn.y != null) node.y = sn.y;
          if (sn.width != null) node.w = sn.width;
          if (sn.height != null) node.h = sn.height;
          project.view.nodeSize[node.label] = { w: sn.width || node.w || 240, h: sn.height || node.h || 140 };
        }
      }
    }

    if (!project.view.subPos) project.view.subPos = {};
    if (!project.view.subSize) project.view.subSize = {};
    if (!project.view.subStates) project.view.subStates = {};
    if (Array.isArray(schematic.subsystems)) {
      for (const ss of schematic.subsystems) {
        const sub = project.subSystems.find((s) => s.ref === ss.ref);
        if (sub) {
          if (ss.state) {
            sub.state = ss.state;
            project.view.subStates[sub.ref] = ss.state;
          }
          if (ss.x != null && ss.y != null) {
            sub.x = ss.x;
            sub.y = ss.y;
            project.view.subPos[sub.ref] = { x: ss.x, y: ss.y };
          }
          if (ss.width != null && ss.height != null) {
            sub.w = ss.width;
            sub.h = ss.height;
            project.view.subSize[sub.ref] = { w: ss.width, h: ss.height };
          }
          if (ss.frameWidth != null && ss.frameHeight != null) {
            project.view.subSize[`${sub.ref}_frame`] = { w: ss.frameWidth, h: ss.frameHeight };
          }
        }
      }
    }

    if (!project.view.connMidX) project.view.connMidX = {};
    if (!project.view.connMidY) project.view.connMidY = {};
    if (!project.view.connWaypoints) project.view.connWaypoints = {};
    if (Array.isArray(schematic.connections)) {
      for (const sc of schematic.connections) {
        const conn = project.connections.find(
          (c) => c.id === sc.id || (c.from.n === sc.from?.node && c.from.i === sc.from?.iface && c.to.n === sc.to?.node && c.to.i === sc.to?.iface)
        );
        if (conn) {
          if (sc.midX != null) {
            conn.midX = sc.midX;
            project.view.connMidX[conn.id] = sc.midX;
          }
          if (sc.midY != null) {
            conn.midY = sc.midY;
            project.view.connMidY[conn.id] = sc.midY;
          }
          if (sc.connectorMode) conn.connectorMode = sc.connectorMode;
          if (sc.waypoints) {
            conn.waypoints = sc.waypoints;
            project.view.connWaypoints[conn.id] = sc.waypoints;
          }
        }
      }
    }
  },

  /**
   * Save layout JSON schematic adhering to standard schema to Option 2 path
   */
  async saveLayoutSchematic(docFilePath: string, project: RosProject, workspaceRoot?: string): Promise<void> {
    try {
      const layoutPath = this.getLayoutFilePath(docFilePath, workspaceRoot);
      const isRos = Boolean(project.isRos || docFilePath.endsWith('.ros'));
      const isRosSystem = project.isRosSystem !== false && !isRos && docFilePath.endsWith('.rossystem');
      const modelType: RosLayoutSchematic['modelType'] = isRos
        ? 'ros'
        : isRosSystem
        ? 'rossystem'
        : docFilePath.endsWith('.ros1')
        ? 'ros1'
        : 'ros2';

      const schematic: RosLayoutSchematic = {
        $schema: 'https://rostooling.ipa.fraunhofer.de/schema/layout-v1.json',
        version: 1,
        modelFile: path.basename(docFilePath),
        modelType,
        canvas: {
          view: {
            tx: project.view?.tx != null ? project.view.tx : 40,
            ty: project.view?.ty != null ? project.view.ty : 40,
            zoom: project.view?.k != null ? project.view.k : 1,
          },
          connectorMode: project.view?.connectorMode || 'orthogonal',
        },
        nodes: (project.nodes || []).map((n) => ({
          id: n.id,
          label: n.label,
          x: n.x != null ? n.x : 0,
          y: n.y != null ? n.y : 0,
          width: n.w || project.view?.nodeSize?.[n.label]?.w,
          height: n.h || project.view?.nodeSize?.[n.label]?.h,
        })),
        subsystems: (project.subSystems || []).map((s) => ({
          ref: s.ref,
          state: (project.view?.subStates?.[s.ref] || s.state || 'collapsed') as 'collapsed' | 'framed',
          x: project.view?.subPos?.[s.ref]?.x != null ? project.view.subPos[s.ref].x : s.x,
          y: project.view?.subPos?.[s.ref]?.y != null ? project.view.subPos[s.ref].y : s.y,
          width: s.w || project.view?.subSize?.[s.ref]?.w,
          height: s.h || project.view?.subSize?.[s.ref]?.h,
          frameWidth: project.view?.subSize?.[`${s.ref}_frame`]?.w,
          frameHeight: project.view?.subSize?.[`${s.ref}_frame`]?.h,
        })),
        connections: (project.connections || []).map((c) => ({
          id: c.id,
          from: { node: c.from.n, iface: c.from.i },
          to: { node: c.to.n, iface: c.to.i },
          connectorMode: c.connectorMode || project.view?.connectorMode || 'orthogonal',
          midX: c.midX != null ? c.midX : project.view?.connMidX?.[c.id],
          midY: c.midY != null ? c.midY : project.view?.connMidY?.[c.id],
          waypoints: c.waypoints || project.view?.connWaypoints?.[c.id],
        })),
      };

      await fs.promises.writeFile(layoutPath, JSON.stringify(schematic, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`Failed to save layout schematic for ${docFilePath}:`, err);
    }
  },
};
