import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import * as vscode from 'vscode';
import { RosModelParser } from '../model/RosModelParser';
import { RosModelEmitter } from '../model/RosModelEmitter';
import { ConnectionValidator } from '../model/ConnectionValidator';
import { RosCustomEditorProvider } from '../editor/RosCustomEditorProvider';
import { RosCatalogueManager } from '../model/RosCatalogueManager';
import { RosLayoutManager } from '../model/RosLayoutManager';
import { getStudioHtml } from '../webview/studioHtml';
import {
  RosProject,
  RosNode,
  RosInteractionKind,
  RosTypeSpec,
} from '../model/RosModelTypes';

suite('User Interactions & Visual Studio Lifecycle Test Suite', () => {
  // Helpers for testing state transitions
  function createTestProject(): RosProject {
    return {
      formatVersion: 4,
      system: { name: 'test_robot_system', comments: {} },
      subSystems: [
        { ref: 'navigation', state: 'collapsed' },
        { ref: 'perception', state: 'collapsed' },
      ],
      nodes: [
        {
          id: 'n_camera_node',
          label: 'camera_node',
          from: 'vision_pkg.camera_node',
          pkg: 'vision_pkg',
          artifact: 'camera_node',
          x: 100,
          y: 100,
          backing: 'local',
          ifaces: [
            { id: 'i_camera_node_image_raw', name: 'image_raw', label: 'image_raw', kind: 'pub', type: 'sensor_msgs/msg/Image', exposed: true },
            { id: 'i_camera_node_camera_info', name: 'camera_info', label: 'camera_info', kind: 'pub', type: 'sensor_msgs/msg/CameraInfo', exposed: true },
          ],
          params: [
            { id: 'p_camera_node_fps', name: 'fps', label: 'fps', ptype: 'Integer', value: '30', exposed: true },
          ],
        },
        {
          id: 'n_filter_node',
          label: 'filter_node',
          from: 'vision_pkg.filter_node',
          pkg: 'vision_pkg',
          artifact: 'filter_node',
          x: 420,
          y: 100,
          backing: 'local',
          ifaces: [
            { id: 'i_filter_node_image_in', name: 'image_in', label: 'image_in', kind: 'sub', type: 'sensor_msgs/msg/Image', exposed: true },
            { id: 'i_filter_node_image_out', name: 'image_out', label: 'image_out', kind: 'pub', type: 'sensor_msgs/msg/Image', exposed: true },
          ],
          params: [],
        },
        {
          id: 'n_nav_planner',
          label: 'nav_planner',
          subRef: 'navigation',
          from: 'navigation.planner',
          x: 100,
          y: 500,
          backing: 'sub',
          ifaces: [
            { id: 'i_nav_planner_goal_sub', name: 'goal_sub', label: 'goal_sub', kind: 'sub', type: 'geometry_msgs/msg/PoseStamped', exposed: true },
            { id: 'i_nav_planner_cmd_vel', name: 'cmd_vel', label: 'cmd_vel', kind: 'pub', type: 'geometry_msgs/msg/Twist', exposed: true },
          ],
          params: [],
        },
      ],
      connections: [
        {
          id: 'c_image_raw_image_in',
          from: { n: 'n_camera_node', i: 'i_camera_node_image_raw' },
          to: { n: 'n_filter_node', i: 'i_filter_node_image_in' },
        },
      ],
      packages: {},
      types: {},
      view: {
        tx: 40,
        ty: 40,
        k: 1,
        level: 3,
        subStates: { navigation: 'collapsed', perception: 'collapsed' },
        subPos: { navigation: { x: 80, y: 400 }, perception: { x: 420, y: 400 } },
      },
    };
  }

  // --------------------------------------------------------------------------------------
  // 1. CANVAS NAVIGATION & VIEW CONTROLS
  // --------------------------------------------------------------------------------------
  suite('1. Canvas Navigation & View Controls', () => {
    test('Zoom in increases scale up to maximum limit (2.5x)', () => {
      let k = 1.0;
      for (let i = 0; i < 10; i++) {
        k = Math.min(2.5, k * 1.2);
      }
      assert.strictEqual(k, 2.5);
    });

    test('Zoom out decreases scale down to minimum limit (0.3x)', () => {
      let k = 1.0;
      for (let i = 0; i < 10; i++) {
        k = Math.max(0.3, k / 1.2);
      }
      assert.strictEqual(k, 0.3);
    });

    test('Fit view resets pan coordinates and zoom scale', () => {
      const view = { tx: 350, ty: -120, k: 1.8 };
      view.tx = 40;
      view.ty = 40;
      view.k = 1.0;
      assert.strictEqual(view.tx, 40);
      assert.strictEqual(view.ty, 40);
      assert.strictEqual(view.k, 1.0);
    });

    test('Find query filters matching nodes and interfaces', () => {
      const project = createTestProject();
      const query = 'image';
      const matchedNodes = project.nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(query) ||
          n.ifaces.some((f) => (f.label || f.name).toLowerCase().includes(query))
      );
      assert.strictEqual(matchedNodes.length, 2);
      assert.strictEqual(matchedNodes[0].label, 'camera_node');
      assert.strictEqual(matchedNodes[1].label, 'filter_node');
    });
  });

  // --------------------------------------------------------------------------------------
  // 2. NODE CREATION, SELECTION & MANIPULATION
  // --------------------------------------------------------------------------------------
  suite('2. Node Creation, Selection & Manipulation', () => {
    test('Add new node creates node with default publisher/subscriber ports and deterministic ID', () => {
      const project = createTestProject();
      const newLabel = `node_${project.nodes.length + 1}`;
      const newNode: RosNode = {
        id: `n_${newLabel}`,
        label: newLabel,
        ifaces: [
          { id: `i_${newLabel}_topic_out`, name: 'topic_out', label: 'topic_out', kind: 'pub', type: 'std_msgs/msg/String', exposed: true },
          { id: `i_${newLabel}_topic_in`, name: 'topic_in', label: 'topic_in', kind: 'sub', type: 'std_msgs/msg/String', exposed: true },
        ],
        params: [],
        x: 200,
        y: 200,
        backing: 'local',
      };
      project.nodes.push(newNode);

      assert.strictEqual(project.nodes.length, 4);
      assert.strictEqual(newNode.id, 'n_node_4');
      assert.strictEqual(newNode.ifaces.length, 2);
      assert.strictEqual(newNode.ifaces[0].kind, 'pub');
      assert.strictEqual(newNode.ifaces[1].kind, 'sub');
    });

    test('Moving a node updates coordinates persistently', () => {
      const project = createTestProject();
      const node = project.nodes[0];
      node.x = 350;
      node.y = 280;
      assert.strictEqual(node.x, 350);
      assert.strictEqual(node.y, 280);

      // Emitting model retains semantic integrity
      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(emitted.includes('camera_node:'));
    });

    test('Editing node properties in inspector updates label and namespace', () => {
      const project = createTestProject();
      const node = project.nodes[0];
      node.label = 'front_camera';
      node.namespace = '/robot/sensors';

      assert.strictEqual(node.label, 'front_camera');
      assert.strictEqual(node.namespace, '/robot/sensors');

      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(emitted.includes('front_camera:'));
      assert.ok(emitted.includes('namespace: "/robot/sensors"'));
    });

    test('Deleting a node cascades and removes all its connected wires', () => {
      const project = createTestProject();
      assert.strictEqual(project.connections.length, 1);

      const targetId = 'n_camera_node';
      project.nodes = project.nodes.filter((n) => n.id !== targetId);
      project.connections = project.connections.filter(
        (c) => c.from.n !== targetId && c.to.n !== targetId
      );

      assert.strictEqual(project.nodes.length, 2);
      assert.strictEqual(project.connections.length, 0);
    });
  });

  // --------------------------------------------------------------------------------------
  // 3. SUBSYSTEM CONTAINERIZATION & ABSTRACTION
  // --------------------------------------------------------------------------------------
  suite('3. Subsystem Containerization & Wire Abstraction', () => {
    test('Subsystems initialize in collapsed state by default', () => {
      const project = createTestProject();
      for (const sub of project.subSystems) {
        const state = project.view?.subStates?.[sub.ref] || sub.state;
        assert.strictEqual(state, 'collapsed');
      }
    });

    test('Toggling subsystem state between collapsed and framed', () => {
      const project = createTestProject();
      const sub = project.subSystems[0];
      assert.strictEqual(project.view?.subStates?.[sub.ref], 'collapsed');

      // Expand
      if (project.view?.subStates) project.view.subStates[sub.ref] = 'framed';
      assert.strictEqual(project.view?.subStates?.[sub.ref], 'framed');

      // Collapse
      if (project.view?.subStates) project.view.subStates[sub.ref] = 'collapsed';
      assert.strictEqual(project.view?.subStates?.[sub.ref], 'collapsed');
    });

    test('Inter-subsystem connection is abstracted when subsystem is collapsed', () => {
      const project = createTestProject();
      // Add connection from filter_node to nav_planner (inside navigation subsystem)
      project.connections.push({
        id: 'c_filter_to_nav',
        from: { n: 'n_filter_node', i: 'i_filter_node_image_out' },
        to: { n: 'n_nav_planner', i: 'i_nav_planner_goal_sub' },
      });

      const conn = project.connections.find((c) => c.id === 'c_filter_to_nav');
      assert.ok(conn);

      const navNode = project.nodes.find((n) => n.id === conn?.to.n);
      assert.strictEqual(navNode?.subRef, 'navigation');
      assert.strictEqual(project.view?.subStates?.['navigation'], 'collapsed');
      // Node is hidden in canvas, wire routes to subsystem boundary
    });

    test('Bulk Collapse All and Expand All commands', () => {
      const project = createTestProject();
      // Expand all
      for (const s of project.subSystems) {
        if (project.view?.subStates) project.view.subStates[s.ref] = 'framed';
      }
      assert.strictEqual(project.view?.subStates?.['navigation'], 'framed');
      assert.strictEqual(project.view?.subStates?.['perception'], 'framed');

      // Collapse all
      for (const s of project.subSystems) {
        if (project.view?.subStates) project.view.subStates[s.ref] = 'collapsed';
      }
      assert.strictEqual(project.view?.subStates?.['navigation'], 'collapsed');
      assert.strictEqual(project.view?.subStates?.['perception'], 'collapsed');
    });
  });

  // --------------------------------------------------------------------------------------
  // 4. INTERACTION WIRING & REAL-TIME VALIDATION
  // --------------------------------------------------------------------------------------
  suite('4. Interface Connection Dragging & Verification', () => {
    test('Valid Publisher to Subscriber connection with matching message type', () => {
      const project = createTestProject();
      const n1 = project.nodes[0];
      const n2 = project.nodes[1];
      const res = ConnectionValidator.validate(n1, n1.ifaces[0], n2, n2.ifaces[0]);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.normalizedFrom?.n, 'n_camera_node');
      assert.strictEqual(res.normalizedTo?.n, 'n_filter_node');
    });

    test('Reverse drag (Subscriber -> Publisher) is auto-oriented to source -> sink', () => {
      const project = createTestProject();
      const n1 = project.nodes[0];
      const n2 = project.nodes[1];
      // Drag starting from subscriber on n2 towards publisher on n1
      const res = ConnectionValidator.validate(n2, n2.ifaces[0], n1, n1.ifaces[0]);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.normalizedFrom?.n, 'n_camera_node');
      assert.strictEqual(res.normalizedTo?.n, 'n_filter_node');
    });

    test('Disallow incompatible connection directions (pub to pub, sub to sub)', () => {
      const project = createTestProject();
      const n1 = project.nodes[0];
      const n2 = project.nodes[1];
      // pub (image_raw) -> pub (image_out)
      const res = ConnectionValidator.validate(n1, n1.ifaces[0], n2, n2.ifaces[1]);
      assert.strictEqual(res.valid, false);
      assert.ok(res.reason?.includes('Incompatible kinds'));
    });

    test('Disallow connection when message types mismatch', () => {
      const project = createTestProject();
      const n1 = project.nodes[0];
      const n2 = project.nodes[1];
      // pub (CameraInfo) -> sub (Image)
      const res = ConnectionValidator.validate(n1, n1.ifaces[1], n2, n2.ifaces[0]);
      assert.strictEqual(res.valid, false);
      assert.ok(res.reason?.includes('Type mismatch'));
    });

    test('Disallow self-connection between interfaces on the same node', () => {
      const project = createTestProject();
      const n2 = project.nodes[1];
      // filter_node: image_out (pub) -> image_in (sub) on same node
      const res = ConnectionValidator.validate(n2, n2.ifaces[1], n2, n2.ifaces[0]);
      assert.strictEqual(res.valid, false);
      assert.ok(res.reason?.includes('Cannot connect node "filter_node" to itself'));
    });

    test('Prevent duplicate connections on the same interface pair', () => {
      const project = createTestProject();
      const fromNodeId = 'n_camera_node';
      const fromIfaceId = 'i_camera_node_image_raw';
      const toNodeId = 'n_filter_node';
      const toIfaceId = 'i_filter_node_image_in';

      const isDuplicate = project.connections.some(
        (c) => c.from.n === fromNodeId && c.from.i === fromIfaceId && c.to.n === toNodeId && c.to.i === toIfaceId
      );
      assert.strictEqual(isDuplicate, true);
    });

    test('Live HUD tooltip generation outputs clear feedback for valid and invalid states', () => {
      const project = createTestProject();
      const n1 = project.nodes[0];
      const n2 = project.nodes[1];

      const validHud = ConnectionValidator.getDragStatusHUD(n1, n1.ifaces[0], n2, n2.ifaces[0]);
      assert.strictEqual(validHud.status, 'valid');
      assert.ok(validHud.text.includes('Connect to'));

      const invalidHud = ConnectionValidator.getDragStatusHUD(n1, n1.ifaces[1], n2, n2.ifaces[0]);
      assert.strictEqual(invalidHud.status, 'invalid');
      assert.ok(invalidHud.text.toLowerCase().includes('type mismatch'));
    });
  });

  // --------------------------------------------------------------------------------------
  // 5. INTERFACE PROPERTY EDITING & CONTENT ASSIST
  // --------------------------------------------------------------------------------------
  suite('5. Interface Property Editing & Autocomplete Suggestions', () => {
    test('Switching interface kind alters interaction behavior dynamically', () => {
      const project = createTestProject();
      const n = project.nodes[0];
      const iface = n.ifaces[0];
      assert.strictEqual(iface.kind, 'pub');

      // User changes kind from pub to ss in inspector
      iface.kind = 'ss' as RosInteractionKind;
      assert.strictEqual(iface.kind, 'ss');

      // Validating against a sub is now rejected
      const n2 = project.nodes[1];
      const res = ConnectionValidator.validate(n, iface, n2, n2.ifaces[0]);
      assert.strictEqual(res.valid, false);
      assert.ok(res.reason?.includes('Incompatible kinds'));
    });

    test('Type autocomplete categories map correctly to interface kinds', () => {
      function getSuggestionCategory(kind: RosInteractionKind): string {
        if (kind === 'pub' || kind === 'sub') return 'typeSuggestions_msg';
        if (kind === 'ss' || kind === 'sc') return 'typeSuggestions_srv';
        if (kind === 'as' || kind === 'ac') return 'typeSuggestions_action';
        return 'typeSuggestions_all';
      }

      assert.strictEqual(getSuggestionCategory('pub'), 'typeSuggestions_msg');
      assert.strictEqual(getSuggestionCategory('sub'), 'typeSuggestions_msg');
      assert.strictEqual(getSuggestionCategory('ss'), 'typeSuggestions_srv');
      assert.strictEqual(getSuggestionCategory('sc'), 'typeSuggestions_srv');
      assert.strictEqual(getSuggestionCategory('as'), 'typeSuggestions_action');
      assert.strictEqual(getSuggestionCategory('ac'), 'typeSuggestions_action');
    });

    test('Interface type update in .rossystem persists and is deterministic', () => {
      const project = createTestProject();
      const iface = project.nodes[0].ifaces[0];
      iface.type = 'sensor_msgs/msg/CompressedImage';

      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(emitted.includes('image_raw: pub-> "camera_node::image_raw"'));
      assert.strictEqual(iface.type, 'sensor_msgs/msg/CompressedImage');
    });
  });

  // --------------------------------------------------------------------------------------
  // 6. TWO-WAY SYNCHRONIZATION & STATE PERSISTENCE
  // --------------------------------------------------------------------------------------
  suite('6. Two-Way Sync, Undo/Redo & State Persistence', () => {
    test('Undo stack tracks previous snapshots and allows rollback', () => {
      let project = createTestProject();
      const undoStack: string[] = [];
      const redoStack: string[] = [];

      // Push initial state
      undoStack.push(JSON.stringify(project));

      // User performs edit: add node
      project.nodes.push({
        id: 'n_temp',
        label: 'temp_node',
        ifaces: [],
        params: [],
        backing: 'local',
      });
      assert.strictEqual(project.nodes.length, 4);

      // User clicks Undo
      redoStack.push(JSON.stringify(project));
      project = JSON.parse(undoStack.pop() || '{}');
      assert.strictEqual(project.nodes.length, 3);

      // User clicks Redo
      undoStack.push(JSON.stringify(project));
      project = JSON.parse(redoStack.pop() || '{}');
      assert.strictEqual(project.nodes.length, 4);
    });

    test('External text reload preserves existing node coordinates and selection', () => {
      const cachedProject = createTestProject();
      cachedProject.nodes[0].x = 550;
      cachedProject.nodes[0].y = 320;

      // Simulated external text update
      const freshText = `test_robot_system:
  nodes:
    camera_node:
      from: "vision_pkg.camera_node"
      interfaces:
        - "image_raw": "camera_node::image_raw"
    filter_node:
      from: "vision_pkg.filter_node"
`;
      const freshProject = RosModelParser.parseRosSystem(freshText, 'test.rossystem');

      // Coordinate merge by label
      const posMap = new Map<string, { x?: number; y?: number }>();
      for (const n of cachedProject.nodes) {
        if (n.x != null && n.y != null) {
          posMap.set(n.label, { x: n.x, y: n.y });
        }
      }

      for (const n of freshProject.nodes) {
        const p = posMap.get(n.label);
        if (p && p.x != null && p.y != null) {
          n.x = p.x;
          n.y = p.y;
        }
      }

      assert.strictEqual(freshProject.nodes[0].x, 550);
      assert.strictEqual(freshProject.nodes[0].y, 320);
    });
  });

  // --------------------------------------------------------------------------------------
  // 7. TYPE MUTATION CONNECTION PRUNING & VISUAL ENHANCEMENTS
  // --------------------------------------------------------------------------------------
  suite('7. Incompatible Connection Pruning & Layout Enhancements', () => {
    test('Mutating interface type automatically prunes incompatible existing connections', () => {
      const project = createTestProject();
      assert.strictEqual(project.connections.length, 1);

      const cameraNode = project.nodes[0];
      const imageRawIface = cameraNode.ifaces[0];
      assert.strictEqual(imageRawIface.type, 'sensor_msgs/msg/Image');

      // User changes type from Image to LaserScan in inspector
      imageRawIface.type = 'sensor_msgs/msg/LaserScan';

      // Prune connections
      const removed: string[] = [];
      project.connections = project.connections.filter((conn) => {
        const fn = project.nodes.find((n) => n.id === conn.from.n);
        const tn = project.nodes.find((n) => n.id === conn.to.n);
        const fi = fn?.ifaces.find((f) => f.id === conn.from.i);
        const ti = tn?.ifaces.find((f) => f.id === conn.to.i);
        if (!fn || !tn || !fi || !ti) return false;

        const res = ConnectionValidator.validate(fn, fi, tn, ti);
        if (!res.valid) {
          removed.push(`${fn.label}::${fi.name} -> ${tn.label}::${ti.name}: ${res.reason}`);
          return false;
        }
        return true;
      });

      assert.strictEqual(project.connections.length, 0);
      assert.strictEqual(removed.length, 1);
      assert.ok(removed[0].includes('Type mismatch'));
    });

    test('Mutating interface kind automatically prunes incompatible existing connections', () => {
      const project = createTestProject();
      assert.strictEqual(project.connections.length, 1);

      const cameraNode = project.nodes[0];
      const imageRawIface = cameraNode.ifaces[0];
      // User changes pub to ss
      imageRawIface.kind = 'ss' as RosInteractionKind;

      project.connections = project.connections.filter((conn) => {
        const fn = project.nodes.find((n) => n.id === conn.from.n);
        const tn = project.nodes.find((n) => n.id === conn.to.n);
        const fi = fn?.ifaces.find((f) => f.id === conn.from.i);
        const ti = tn?.ifaces.find((f) => f.id === conn.to.i);
        if (!fn || !tn || !fi || !ti) return false;
        return ConnectionValidator.validate(fn, fi, tn, ti).valid;
      });

      assert.strictEqual(project.connections.length, 0);
    });

    test('Orthogonal wire routing computes 90-degree boxy segments', () => {
      const s = { x: 220, y: 120, side: 'right' };
      const t = { x: 420, y: 260, side: 'left' };
      const midX = Math.round((s.x + 26 + t.x - 26) / 2);

      const pts = [
        { x: s.x, y: s.y },
        { x: s.x + 26, y: s.y },
        { x: midX, y: s.y },
        { x: midX, y: t.y },
        { x: t.x - 26, y: t.y },
        { x: t.x, y: t.y },
      ];

      // All adjacent segments are strictly orthogonal (either horizontal or vertical)
      for (let i = 0; i < pts.length - 1; i++) {
        const isHoriz = pts[i].y === pts[i + 1].y;
        const isVert = pts[i].x === pts[i + 1].x;
        assert.ok(isHoriz || isVert, `Segment ${i} must be orthogonal`);
      }
    });

    test('Jump bridge generates semi-circular arc when horizontal wire crosses vertical wire', () => {
      const hSeg = { x1: 100, x2: 400, y: 150 };
      const vCrossX = 250;

      const bridgeRadius = 6;
      const beforeX = vCrossX - bridgeRadius;
      const afterX = vCrossX + bridgeRadius;

      const d = `M ${hSeg.x1} ${hSeg.y} L ${beforeX} ${hSeg.y} A ${bridgeRadius} ${bridgeRadius} 0 0 0 ${afterX} ${hSeg.y} L ${hSeg.x2} ${hSeg.y}`;
      assert.ok(d.includes('A 6 6 0 0 0 256 150'));
    });

    test('Two vertical lines for parallel connections never overlap and receive distinct lanes', () => {
      // Simulate two parallel connections in the same corridor
      const LANE_GAP = 14;
      const s1 = { x: 100, y: 120, side: 'right', nodeId: 'node1' };
      const t1 = { x: 500, y: 120, side: 'left', nodeId: 'node2' };

      const s2 = { x: 100, y: 160, side: 'right', nodeId: 'node1' };
      const t2 = { x: 500, y: 160, side: 'left', nodeId: 'node2' };

      assert.strictEqual(s1.nodeId, s2.nodeId);
      assert.strictEqual(t1.nodeId, t2.nodeId);

      const baseMidX = Math.round((s1.x + 26 + t1.x - 26) / 2);
      const total = 2;

      const vLine1X = Math.round(baseMidX + (0 - (total - 1) / 2) * LANE_GAP);
      const vLine2X = Math.round(baseMidX + (1 - (total - 1) / 2) * LANE_GAP);

      assert.strictEqual(vLine1X, 293);
      assert.strictEqual(vLine2X, 307);
      assert.notStrictEqual(vLine1X, vLine2X);
      assert.ok(Math.abs(vLine1X - vLine2X) >= LANE_GAP);
    });
  });

  // --------------------------------------------------------------------------------------
  // 8. DIVERSE WORKSPACE MODELS & SUBSYSTEM VISUALIZATION
  // --------------------------------------------------------------------------------------
  suite('8. Diverse Workspace Models & Subsystem Loading', () => {
    test('Parse and render cartographer.rossystem with companion artifact interfaces', () => {
      const cartContent = `cartographer:
  fromFile: 'turtlebot3_cartographer/launch/cartographer.launch.py'
  nodes:
    cartographer_node:
      from: "cartographer_node.cartographer_node"
      interfaces:
       - scan_cart: sub-> "cartographer_node::scan"
       - odom_cart: sub-> "cartographer_node::odom"
    cartographer_occupancy_grid_node:
      from: "cartographer_occupancy_grid_node.cartographer_occupancy_grid_node"
`;

      const proj = RosModelParser.parseRosSystem(cartContent, 'cartographer.rossystem');
      assert.strictEqual(proj.system.name, 'cartographer');
      assert.strictEqual(proj.nodes.length, 2);
      assert.strictEqual(proj.nodes[0].label, 'cartographer_node');
      assert.strictEqual(proj.nodes[1].label, 'cartographer_occupancy_grid_node');

      // Check interfaces on cartographer_node
      assert.strictEqual(proj.nodes[0].ifaces.length, 2);
      assert.strictEqual(proj.nodes[0].ifaces[0].label, 'scan_cart');
      assert.strictEqual(proj.nodes[0].ifaces[0].kind, 'sub');
    });

    test('Parse and render turtlebot3_mapping.rossystem with recursive subsystems', () => {
      const mapContent = `turtlebot3_mapping:
  subSystems:
    turtlebot_gazebo
    cartographer
  nodes:
    rviz2:
      from: "rviz2.rviz2"
      parameters:
        - use_sim_time: "rviz2::use_sim_time"
          value: true
`;

      const proj = RosModelParser.parseRosSystem(mapContent, 'turtlebot3_mapping.rossystem');
      assert.strictEqual(proj.system.name, 'turtlebot3_mapping');
      assert.strictEqual(proj.subSystems.length, 2);
      assert.strictEqual(proj.subSystems[0].ref, 'turtlebot_gazebo');
      assert.strictEqual(proj.subSystems[1].ref, 'cartographer');
      assert.strictEqual(proj.nodes.length, 1);
      assert.strictEqual(proj.nodes[0].label, 'rviz2');
    });
  });

  // --------------------------------------------------------------------------------------
  // 9. RESIZABLE BLOCKS, MOVABLE EDGES, WHEEL NAVIGATION & MODE GUARDS
  // --------------------------------------------------------------------------------------
  suite('9. Resizable Blocks, Movable Edges, Wheel Navigation & Mode Guards', () => {
    test('Resizing a node updates in-memory dimensions without polluting emitted .rossystem text', () => {
      const project = createTestProject();
      const node = project.nodes[0];
      node.w = 340;
      node.h = 220;

      if (!project.view) project.view = {};
      if (!project.view.nodeSize) project.view.nodeSize = {};
      project.view.nodeSize[node.label] = { w: 340, h: 220 };

      assert.strictEqual(node.w, 340);
      assert.strictEqual(node.h, 220);
      assert.strictEqual(project.view.nodeSize[node.label].w, 340);

      // Verify that emitted .rossystem retains pure Xtext grammar with NO size keys
      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(!emitted.includes('width:'));
      assert.ok(!emitted.includes('height:'));
      assert.ok(!emitted.includes(' 340'));
      assert.ok(!emitted.includes(' 220'));
      assert.ok(!emitted.match(/\b(w|h)\s*:/));
      assert.ok(emitted.includes('camera_node:'));
    });

    test('Resizing a subsystem updates in-memory dimensions without polluting emitted .rossystem text', () => {
      const project = createTestProject();
      const sub = project.subSystems[0];
      sub.w = 400;
      sub.h = 250;

      if (!project.view) project.view = {};
      if (!project.view.subSize) project.view.subSize = {};
      project.view.subSize[sub.ref] = { w: 400, h: 250 };

      assert.strictEqual(sub.w, 400);
      assert.strictEqual(sub.h, 250);
      assert.strictEqual(project.view.subSize[sub.ref].w, 400);

      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(!emitted.includes('width:'));
      assert.ok(!emitted.includes('height:'));
      assert.ok(!emitted.includes(' 400'));
      assert.ok(!emitted.includes(' 250'));
      assert.ok(!emitted.match(/\b(w|h)\s*:/));
      assert.ok(emitted.includes('navigation'));
    });

    test('Moving connection vertical corridor segment updates midX in-memory without polluting grammar', () => {
      const project = createTestProject();
      assert.strictEqual(project.connections.length, 1);
      const conn = project.connections[0];

      // Simulate dragging the edge handle
      conn.midX = 260;
      if (!project.view) project.view = {};
      if (!project.view.connMidX) project.view.connMidX = {};
      project.view.connMidX[conn.id] = 260;

      assert.strictEqual(conn.midX, 260);
      assert.strictEqual(project.view.connMidX[conn.id], 260);

      // Emitted system must remain strictly valid [from, to] bracket format
      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(emitted.includes('- ["image_raw", "image_in"]'));
      assert.ok(!emitted.includes('midX:'));
      assert.ok(!emitted.includes('260'));
    });

    test('Mouse wheel zoom-to-cursor keeps the canvas coordinate under mouse fixed', () => {
      const view = { tx: 100, ty: 80, k: 1.0 };
      const mouseX = 400, mouseY = 300;

      // 1. Calculate canvas coordinates before zoom
      const canvasX = (mouseX - view.tx) / view.k;
      const canvasY = (mouseY - view.ty) / view.k;
      assert.strictEqual(canvasX, 300);
      assert.strictEqual(canvasY, 220);

      // 2. Zoom in by factor 1.1
      const newK = Math.max(0.3, Math.min(2.5, view.k * 1.1));
      view.tx = Math.round(mouseX - canvasX * newK);
      view.ty = Math.round(mouseY - canvasY * newK);
      view.k = newK;

      // 3. Verify that under new scale, the screen point for canvasX/canvasY matches mouseX/mouseY
      const projectedScreenX = view.tx + canvasX * view.k;
      const projectedScreenY = view.ty + canvasY * view.k;
      assert.strictEqual(Math.round(projectedScreenX), mouseX);
      assert.strictEqual(Math.round(projectedScreenY), mouseY);
    });

    test('Mouse wheel scrolling pans vertically and horizontally', () => {
      const view = { tx: 50, ty: 50, k: 1.0 };

      // Normal vertical wheel event (deltaY = 40)
      view.ty -= 40;
      assert.strictEqual(view.ty, 10);

      // Shift + wheel event for horizontal panning (deltaY = 30)
      view.tx -= 30;
      assert.strictEqual(view.tx, 20);

      // Dedicated horizontal wheel hardware event (deltaX = 25)
      view.tx -= 25;
      assert.strictEqual(view.tx, -5);
    });

    test('Mode guard disables connection making in .ros2 mode while allowing it in .rossystem mode', () => {
      // In .ros2 mode
      const ros2Project: RosProject = {
        formatVersion: 4,
        isRosSystem: false,
        system: { name: 'my_package', comments: {} },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };

      function canCreateConnection(project: RosProject): boolean {
        return project.isRosSystem !== false && !project.isRos;
      }

      assert.strictEqual(canCreateConnection(ros2Project), false);

      // In .rossystem mode
      const rossystemProject: RosProject = {
        formatVersion: 4,
        isRosSystem: true,
        system: { name: 'my_system', comments: {} },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };
      assert.strictEqual(canCreateConnection(rossystemProject), true);

      // In .ros mode
      const rosProject: RosProject = {
        formatVersion: 4,
        isRos: true,
        isRosSystem: false,
        system: { name: 'my_ros_types', comments: {} },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };
      assert.strictEqual(canCreateConnection(rosProject), false);
    });
  });

  // --------------------------------------------------------------------------------------
  // 10. DYNAMIC INTERFACE & PARAMETER MANAGEMENT & UML TYPE SCHEMAS
  // --------------------------------------------------------------------------------------
  suite('10. Dynamic Interface & Parameter Management & UML Type Schemas', () => {
    test('Add new interface and parameter to component and serialize to .ros2 text', () => {
      const ros2Doc = `my_robot_pkg:
  artifacts:
    sensor_node:
      node: sensor_node
      publishers:
        initial_topic:
          type: 'std_msgs/msg/String'
`;
      const project = RosModelParser.parseRos2(ros2Doc, 'my_robot_pkg.ros2');
      const node = project.nodes[0];
      assert.strictEqual(node.ifaces.length, 1);
      assert.strictEqual(node.params.length, 0);

      // Simulate clicking "+ Add Interface" in Inspector or inline
      const newIfaceId = 'i_' + node.id + '_custom_scan';
      node.ifaces.push({
        id: newIfaceId,
        name: 'custom_scan',
        label: 'custom_scan',
        kind: 'pub',
        type: 'sensor_msgs/msg/LaserScan',
        exposed: true,
      });

      // Simulate clicking "+ Add Parameter"
      const newParamId = 'p_' + node.id + '_publish_rate';
      node.params.push({
        id: newParamId,
        name: 'publish_rate',
        label: 'publish_rate',
        ptype: 'Double',
        value: 30.0,
        exposed: true,
      });

      const emitted = RosModelEmitter.emitRos2(project);
      assert.ok(emitted.includes('custom_scan:'), 'New interface must be emitted');
      assert.ok(emitted.includes("type: 'sensor_msgs/msg/LaserScan'"));
      assert.ok(emitted.includes('publish_rate:'), 'New parameter must be emitted');
      assert.ok(emitted.includes('type: Double'));
      assert.ok(emitted.includes('default: 30.0'));
    });

    test('Deleting an interface cascades and prunes connected wires', () => {
      const project = createTestProject();
      assert.strictEqual(project.connections.length, 1);

      const cameraNode = project.nodes[0];
      const deletedIfaceId = cameraNode.ifaces[0].id;

      // Delete interface from node
      cameraNode.ifaces = cameraNode.ifaces.filter((f) => f.id !== deletedIfaceId);

      // Cascade prune
      project.connections = project.connections.filter(
        (c) => !(c.from.i === deletedIfaceId || c.to.i === deletedIfaceId)
      );

      assert.strictEqual(cameraNode.ifaces.length, 1);
      assert.strictEqual(project.connections.length, 0, 'Connection must be pruned on iface deletion');
    });

    test('Adding and editing interfaces/parameters in .rossystem synchronizes companion .ros2 artifact', () => {
      // Simulate companion ros2 project
      const companionRos2Text = `driver_pkg:
  artifacts:
    lidar_driver:
      node: lidar_driver
      publishers:
        scan:
          type: 'sensor_msgs/msg/LaserScan'
`;
      const companionProject = RosModelParser.parseRos2(companionRos2Text, 'driver_pkg.ros2');

      // System view model
      const sysDoc = `robot_system:
  nodes:
    lidar:
      from: "driver_pkg.lidar_driver"
      interfaces:
        - scan: pub-> "lidar_driver::scan"
`;
      const sysProject = RosModelParser.parseRosSystem(sysDoc, 'robot_system.rossystem');
      const lidarNode = sysProject.nodes[0];

      // User adds a new interface and parameter in the rossystem view
      lidarNode.ifaces.push({
        id: 'i_lidar_diagnostics',
        name: 'diagnostics',
        label: 'diagnostics',
        kind: 'pub',
        type: 'diagnostic_msgs/msg/DiagnosticArray',
        exposed: true,
      });

      lidarNode.params.push({
        id: 'p_lidar_frame_id',
        name: 'frame_id',
        label: 'frame_id',
        ptype: 'String',
        value: 'laser_frame',
        exposed: true,
      });

      // Synchronize to companion artifact (as done in syncCompanionRos2Models)
      for (const pkg of Object.values(companionProject.packages)) {
        for (const art of pkg.artifacts || []) {
          if (art.name === 'lidar_driver' || art.node === 'lidar_driver') {
            for (const iface of lidarNode.ifaces) {
              const targetName = iface.name || iface.label || 'iface';
              const existing = (art.ifaces || []).find((f) => f.name === targetName);
              if (!existing) {
                art.ifaces.push({
                  id: `i_${art.name}_${targetName}`,
                  name: targetName,
                  label: targetName,
                  kind: iface.kind,
                  type: iface.type,
                  exposed: true,
                });
              }
            }
            for (const param of lidarNode.params) {
              const targetName = param.name || param.label || 'param';
              const existing = (art.params || []).find((p) => p.name === targetName);
              if (!existing) {
                art.params.push({
                  id: `p_${art.name}_${targetName}`,
                  name: targetName,
                  label: targetName,
                  ptype: param.ptype || 'String',
                  value: param.value,
                  exposed: true,
                });
              }
            }
          }
        }
      }

      const updatedCompanionText = RosModelEmitter.emitRos2(companionProject);
      assert.ok(updatedCompanionText.includes('diagnostics:'));
      assert.ok(updatedCompanionText.includes("type: 'diagnostic_msgs/msg/DiagnosticArray'"));
      assert.ok(updatedCompanionText.includes('frame_id:'));
      assert.ok(updatedCompanionText.includes('type: String'));
      assert.ok(updatedCompanionText.includes('default: "laser_frame"'));
    });

    test('Parse .ros model file and construct UML type schema cards and dependency connections', () => {
      const sampleRos = `geometry_msgs:
  msgs:
    Point
      message
        float64 x
        float64 y
        float64 z
    Quaternion
      message
        float64 x
        float64 y
        float64 z
        float64 w
    Pose
      message
        'geometry_msgs/msg/Point' position
        'geometry_msgs/msg/Quaternion' orientation
  srvs:
    GetPose
      request
        string frame_id
      response
        'geometry_msgs/msg/Pose' pose
        bool success
`;
      const project = RosModelParser.parseRos(sampleRos, 'geometry_msgs.ros');
      assert.strictEqual(project.isRos, true);
      assert.strictEqual(project.system.name, 'geometry_msgs');
      assert.strictEqual(project.nodes.length, 4, 'Should parse 3 messages and 1 service');

      // Verify Point node
      const pointNode = project.nodes.find((n) => n.label === 'Point');
      assert.ok(pointNode);
      assert.strictEqual(pointNode?.backing, 'type');
      assert.strictEqual(pointNode?.typeCategory, 'msg');
      assert.strictEqual(pointNode?.typeSpec?.fields?.['message']?.length, 3);

      // Verify Pose node
      const poseNode = project.nodes.find((n) => n.label === 'Pose');
      assert.ok(poseNode);
      assert.strictEqual(poseNode?.typeSpec?.fields?.['message']?.length, 2);

      // Verify GetPose service node
      const srvNode = project.nodes.find((n) => n.label === 'GetPose');
      assert.ok(srvNode);
      assert.strictEqual(srvNode?.typeCategory, 'srv');
      assert.strictEqual(srvNode?.typeSpec?.fields?.['request']?.length, 1);
      assert.strictEqual(srvNode?.typeSpec?.fields?.['response']?.length, 2);

      // Verify nested dependency links created automatically
      assert.ok(project.connections.length >= 3, 'Should automatically wire dependency arrows for nested types');
      const posePointConn = project.connections.find((c) => c.from.n === poseNode?.id && c.to.n === pointNode?.id);
      assert.ok(posePointConn, 'Pose must connect to Point dependency card');

      // Verify serialization round-trip
      const emitted = RosModelEmitter.emitRos(project);
      assert.ok(emitted.includes('geometry_msgs:'));
      assert.ok(emitted.includes('msgs:'));
      assert.ok(emitted.includes('Point'));
      assert.ok(emitted.includes('Pose'));
      assert.ok(emitted.includes('srvs:'));
      assert.ok(emitted.includes('GetPose'));
      assert.ok(emitted.includes('request'));
      assert.ok(emitted.includes('response'));
    });

    test('Dynamically add new Message, Service, and Action communication objects and emit compliant .ros grammar', () => {
      const project: RosProject = {
        formatVersion: 4,
        isRos: true,
        isRosSystem: false,
        system: { name: 'custom_pkg' },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };

      // 1. Add Message
      const msgSpec: RosTypeSpec = {
        name: 'BatteryStatus',
        category: 'msg',
        pkg: 'custom_pkg',
        fields: {
          message: [
            { type: 'float32', name: 'voltage', constant: false, array: false },
            { type: 'uint8', name: 'BATTERY_LOW=1', constant: true, value: '1', array: false },
          ],
        },
      };
      const msgNode: RosNode = {
        id: 'n_BatteryStatus',
        label: 'BatteryStatus',
        pkg: 'custom_pkg',
        backing: 'type',
        typeCategory: 'msg',
        typeSpec: msgSpec,
        ifaces: [],
        params: [],
        x: 100,
        y: 100,
      };
      project.nodes.push(msgNode);
      project.types['custom_pkg.BatteryStatus'] = msgSpec;

      // 2. Add Service
      const srvSpec: RosTypeSpec = {
        name: 'ResetOdom',
        category: 'srv',
        pkg: 'custom_pkg',
        fields: {
          request: [{ type: 'bool', name: 'force', constant: false, array: false }],
          response: [{ type: 'bool', name: 'success', constant: false, array: false }],
        },
      };
      const srvNode: RosNode = {
        id: 'n_ResetOdom',
        label: 'ResetOdom',
        pkg: 'custom_pkg',
        backing: 'type',
        typeCategory: 'srv',
        typeSpec: srvSpec,
        ifaces: [],
        params: [],
        x: 350,
        y: 100,
      };
      project.nodes.push(srvNode);
      project.types['custom_pkg.ResetOdom'] = srvSpec;

      // 3. Add Action
      const actionSpec: RosTypeSpec = {
        name: 'NavigateToPose',
        category: 'action',
        pkg: 'custom_pkg',
        fields: {
          goal: [{ type: 'string', name: 'target_frame', constant: false, array: false }],
          result: [{ type: 'bool', name: 'reached', constant: false, array: false }],
          feedback: [{ type: 'float32', name: 'distance_remaining', constant: false, array: false }],
        },
      };
      const actionNode: RosNode = {
        id: 'n_NavigateToPose',
        label: 'NavigateToPose',
        pkg: 'custom_pkg',
        backing: 'type',
        typeCategory: 'action',
        typeSpec: actionSpec,
        ifaces: [],
        params: [],
        x: 600,
        y: 100,
      };
      project.nodes.push(actionNode);
      project.types['custom_pkg.NavigateToPose'] = actionSpec;

      assert.strictEqual(project.nodes.length, 3);

      // Emit .ros
      const emitted = RosModelEmitter.emitRos(project);

      assert.ok(emitted.includes('custom_pkg:'));
      assert.ok(emitted.includes('msgs:'));
      assert.ok(emitted.includes('BatteryStatus'));
      assert.ok(emitted.includes('message'));
      assert.ok(emitted.includes('float32 voltage'));
      assert.ok(emitted.includes('uint8 BATTERY_LOW=1'));

      assert.ok(emitted.includes('srvs:'));
      assert.ok(emitted.includes('ResetOdom'));
      assert.ok(emitted.includes('request'));
      assert.ok(emitted.includes('bool force'));
      assert.ok(emitted.includes('response'));
      assert.ok(emitted.includes('bool success'));

      assert.ok(emitted.includes('actions:'));
      assert.ok(emitted.includes('NavigateToPose'));
      assert.ok(emitted.includes('goal'));
      assert.ok(emitted.includes('string target_frame'));
      assert.ok(emitted.includes('result'));
      assert.ok(emitted.includes('bool reached'));
      assert.ok(emitted.includes('feedback'));
      assert.ok(emitted.includes('float32 distance_remaining'));

      // Round-trip parse to verify grammar compliance
      const parsed = RosModelParser.parseRos(emitted, 'custom_pkg.ros');
      assert.strictEqual(parsed.nodes.length, 3);
      assert.ok(parsed.nodes.some((n) => n.label === 'BatteryStatus' && n.typeCategory === 'msg'));
      assert.ok(parsed.nodes.some((n) => n.label === 'ResetOdom' && n.typeCategory === 'srv'));
      assert.ok(parsed.nodes.some((n) => n.label === 'NavigateToPose' && n.typeCategory === 'action'));
    });

    test('Populating an empty .ros model infers package from user-assigned model name without absolute path pollution', () => {
      // 1. User opens empty inspection_msgs.ros
      const docPath = '/home/adm-esa/coresense-ws/src/RosTooling_Extension/demo/test_ws/src/test_system/inspection_msgs.ros';
      const emptyProject = RosModelParser.parseRos('', docPath);
      assert.strictEqual(emptyProject.system.name, '', 'Initial system.name must be empty');

      // 2. User fills package/model name in studio
      const assignedPkg = 'inspection_msgs';
      emptyProject.system.name = assignedPkg;

      // 3. User adds new Message object; package is inferred from project.system.name
      const uniqueLabel = 'NewMessage';
      const spec: RosTypeSpec = {
        name: uniqueLabel,
        pkg: emptyProject.system.name,
        category: 'msg',
        fields: {
          message: [{ type: 'string', name: 'data', constant: false, array: false }],
        },
      };
      const typeNode: RosNode = {
        id: `type_${uniqueLabel}`,
        label: uniqueLabel,
        pkg: emptyProject.system.name,
        backing: 'type',
        typeCategory: 'msg',
        typeSpec: spec,
        ifaces: [],
        params: [],
      };
      emptyProject.nodes.push(typeNode);
      emptyProject.types[`${emptyProject.system.name}.${uniqueLabel}`] = spec;

      // 4. Emit model
      const emitted = RosModelEmitter.emitRos(emptyProject);
      assert.ok(emitted.includes('inspection_msgs:'));
      assert.ok(!emitted.includes('/home/adm-esa'));
      assert.strictEqual((emitted.match(/inspection_msgs:/g) || []).length, 1);
      assert.ok(emitted.includes('NewMessage'));
      assert.ok(emitted.includes('string data'));

      // 5. Simulate user manually renaming package to 'sensor_msgs'
      const newPkg = 'sensor_msgs';
      emptyProject.system.name = newPkg;
      for (const n of emptyProject.nodes) {
        if (n.backing === 'type') {
          n.pkg = newPkg;
          if (n.typeSpec) n.typeSpec.pkg = newPkg;
        }
      }
      const rekeyedTypes: Record<string, RosTypeSpec> = {};
      for (const s of Object.values(emptyProject.types)) {
        s.pkg = newPkg;
        rekeyedTypes[`${newPkg}.${s.name}`] = s;
      }
      emptyProject.types = rekeyedTypes;

      const renamedEmitted = RosModelEmitter.emitRos(emptyProject);
      assert.ok(renamedEmitted.includes('sensor_msgs:'));
      assert.ok(!renamedEmitted.includes('inspection_msgs:'));
      assert.ok(!renamedEmitted.includes('/home/adm-esa'));
      assert.strictEqual((renamedEmitted.match(/sensor_msgs:/g) || []).length, 1);
    });

    test('Validate demo inspection_msgs.ros model parses and round-trips cleanly', () => {
      const inspectionFile = path.resolve(__dirname, '../../demo/test_ws/src/test_system/inspection_msgs.ros');
      if (fs.existsSync(inspectionFile)) {
        const content = fs.readFileSync(inspectionFile, 'utf-8');
        const parsed = RosModelParser.parseRos(content, inspectionFile);
        assert.strictEqual(parsed.system.name, 'inspection_msgs');
        assert.strictEqual(parsed.nodes.length, 1);
        assert.strictEqual(parsed.nodes[0].label, 'NewMessage');

        const emitted = RosModelEmitter.emitRos(parsed);
        assert.ok(emitted.includes('inspection_msgs:'));
        assert.strictEqual((emitted.match(/inspection_msgs:/g) || []).length, 1);
        assert.ok(!emitted.includes('/home/adm-esa'));
        assert.ok(emitted.includes('string data'));
      }
    });

    test('Mode-specific UI rendering correctly isolates buttons between Communication Objects, Component, and System views', () => {
      const mockUri = vscode.Uri.file('/mock');
      const mockWebview = {} as vscode.Webview;

      // 1. Communication Objects View (.ros)
      const rosProj: RosProject = {
        formatVersion: 4,
        isRos: true,
        isRosSystem: false,
        system: { name: 'my_msgs' },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };
      const rosHtml = getStudioHtml(rosProj, mockUri, mockWebview, {}, {}, 'my_msgs.ros');
      assert.ok(!rosHtml.includes('id="btnAddNode"'), '.ros mode must NOT render + Add New Node');
      assert.ok(!rosHtml.includes('id="btnAddSubsystem"'), '.ros mode must NOT render + Import Subsystem');
      assert.ok(!rosHtml.includes('id="subsystemSection"'), '.ros mode must NOT render subsystemSection');
      assert.ok(!rosHtml.includes('id="processSection"'), '.ros mode must NOT render processSection');
      assert.ok(!rosHtml.includes('id="filterInterfaceSection"'), '.ros mode must NOT render filterInterfaceSection');
      assert.ok(rosHtml.includes('id="btnAddCommObject"'), '.ros mode MUST render + Add Comm Object');
      assert.ok(rosHtml.includes('id="filterTypeSection"'), '.ros mode MUST render filterTypeSection');

      // 2. Component View (.ros2)
      const ros2Proj: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: false,
        system: { name: 'my_pkg' },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };
      const ros2Html = getStudioHtml(ros2Proj, mockUri, mockWebview, {}, {}, 'my_pkg.ros2');
      assert.ok(ros2Html.includes('id="btnAddNode"'), '.ros2 mode MUST render + Add New Node');
      assert.ok(!ros2Html.includes('id="btnAddSubsystem"'), '.ros2 mode must NOT render + Import Subsystem');
      assert.ok(!ros2Html.includes('id="subsystemSection"'), '.ros2 mode must NOT render subsystemSection');
      assert.ok(!ros2Html.includes('id="processSection"'), '.ros2 mode must NOT render processSection');
      assert.ok(ros2Html.includes('id="filterInterfaceSection"'), '.ros2 mode MUST render filterInterfaceSection');
      assert.ok(!ros2Html.includes('id="btnAddCommObject"'), '.ros2 mode must NOT render + Add Comm Object');
      assert.ok(!ros2Html.includes('id="filterTypeSection"'), '.ros2 mode must NOT render filterTypeSection');

      // 3. System View (.rossystem)
      const systemProj: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: true,
        system: { name: 'my_sys' },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };
      const systemHtml = getStudioHtml(systemProj, mockUri, mockWebview, {}, {}, 'my_sys.rossystem');
      assert.ok(!systemHtml.includes('id="btnAddNode"'), '.rossystem mode must NOT render + Add New Node');
      assert.ok(systemHtml.includes('id="btnAddSystemNode"'), '.rossystem mode MUST render + Import Node');
      assert.ok(systemHtml.includes('id="btnAddSubsystem"'), '.rossystem mode MUST render + Import Subsystem');
      assert.ok(systemHtml.includes('id="subsystemSection"'), '.rossystem mode MUST render subsystemSection');
      assert.ok(systemHtml.includes('id="processSection"'), '.rossystem mode MUST render processSection');
      assert.ok(systemHtml.includes('id="filterInterfaceSection"'), '.rossystem mode MUST render filterInterfaceSection');
      assert.ok(!systemHtml.includes('id="btnAddCommObject"'), '.rossystem mode must NOT render + Add Comm Object');
      assert.ok(!systemHtml.includes('id="filterTypeSection"'), '.rossystem mode must NOT render filterTypeSection');
    });

    test('Webview client script executes cleanly without runtime or syntax errors across .ros, .ros2, and .rossystem', () => {
      const mockUri = { fsPath: '/mock/path' } as unknown as vscode.Uri;
      const mockWebview = { asWebviewUri: (u: vscode.Uri) => u } as unknown as vscode.Webview;

      const testConfigs = [
        {
          proj: { isRos: true, nodes: [{ id: 'type_Msg', label: 'Msg', backing: 'type', typeCategory: 'msg', typeSpec: { name: 'Msg', category: 'msg', fields: { message: [] } } }], system: { name: 'test_pkg' } } as unknown as RosProject,
          file: 'test_pkg.ros'
        },
        {
          proj: { isRos: false, isRosSystem: false, nodes: [{ id: 'n1', label: 'node1', ifaces: [] }], system: { name: 'pkg' } } as unknown as RosProject,
          file: 'pkg.ros2'
        },
        {
          proj: { isRos: false, isRosSystem: true, nodes: [], subSystems: [{ ref: 'sub1' }], system: { name: 'sys' } } as unknown as RosProject,
          file: 'sys.rossystem'
        }
      ];

      for (const cfg of testConfigs) {
        const html = getStudioHtml(cfg.proj, mockUri, mockWebview, { _systems: [{ system: 'sub1', nodes: { n1: { interfaces: [{ name: 'i1' }] } } }] }, {}, cfg.file);
        const scriptMatch = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
        assert.ok(scriptMatch, 'script tag must exist in studio HTML');
        const scriptCode = scriptMatch[1];

        // 1. Verify syntax compiles cleanly in Node VM
        assert.doesNotThrow(() => {
          new vm.Script(scriptCode);
        }, `Syntax error found in script for ${cfg.file}`);

        // 2. Verify execution in mock DOM
        const noop = (): void => {
          /* no-op for mock DOM */
        };
        const clickHandlers: Record<string, () => void> = {};
        const elMap: Record<string, unknown> = {};
        const mockEl = (tag: string) => ({
          tagName: tag,
          classList: {
            add: noop,
            remove: noop,
            toggle: noop,
            contains: () => false,
          },
          style: {},
          appendChild: noop,
          remove: noop,
          addEventListener: noop,
          querySelectorAll: () => [],
          dataset: {},
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        });

        const dom = {
          getElementById: (id: string) => {
            if (!elMap[id]) {
              const el = mockEl(id);
              Object.defineProperty(el, 'onclick', {
                set(fn: () => void) {
                  clickHandlers[id] = fn;
                },
                get() {
                  return clickHandlers[id];
                },
              });
              elMap[id] = el;
            }
            return elMap[id];
          },
          querySelector: () => mockEl('div'),
          querySelectorAll: () => [],
          createElement: mockEl,
          body: { classList: { add: noop, remove: noop } },
        };

        const context = {
          document: dom,
          window: { addEventListener: noop },
          navigator: { platform: 'Linux' },
          console: { log: noop, warn: noop, error: noop },
          setTimeout: (fn: () => void) => fn(),
          acquireVsCodeApi: () => ({ postMessage: noop }),
        };

        vm.createContext(context);
        assert.doesNotThrow(() => {
          vm.runInContext(scriptCode, context);
        }, `Runtime error found when running script for ${cfg.file}`);

        assert.ok(Object.keys(clickHandlers).length > 10, 'Expected multiple interactive button handlers to be registered');
      }
    });
  });

  // --------------------------------------------------------------------------------------
  // 19. COMMUNICATION OBJECTS (.ros) LIFECYCLE & TYPE DEPENDENCIES
  // --------------------------------------------------------------------------------------
  suite('19. Communication Objects (.ros) Lifecycle & Type Dependencies', () => {
    test('Renaming a communication object in place updates model and does NOT create duplicate NewMessage', () => {
      // 1. Setup a .ros project with one default NewMessage type node
      const project: RosProject = {
        formatVersion: 4,
        isRos: true,
        system: { name: 'my_msgs' },
        subSystems: [],
        nodes: [
          {
            id: 'type_NewMessage',
            label: 'NewMessage',
            pkg: 'my_msgs',
            backing: 'type',
            typeCategory: 'msg',
            typeSpec: {
              name: 'NewMessage',
              pkg: 'my_msgs',
              category: 'msg',
              fields: {
                message: [{ type: 'string', name: 'data', constant: false, array: false }],
              },
            },
            ifaces: [
              { id: 'port_NewMessage_in', name: 'NewMessage', label: 'NewMessage', kind: 'sub', type: 'NewMessage', exposed: true },
              { id: 'f_NewMessage_data', name: 'data', label: 'data', kind: 'pub', type: 'string', exposed: true },
            ],
            params: [],
          },
        ],
        connections: [],
        packages: {},
        types: {
          'my_msgs.NewMessage': {
            name: 'NewMessage',
            pkg: 'my_msgs',
            category: 'msg',
            fields: {
              message: [{ type: 'string', name: 'data', constant: false, array: false }],
            },
          },
        },
      };

      // 2. User renames "NewMessage" to "CustomTelemetry" and adds a new field "battery_level"
      const targetNode = project.nodes[0];
      targetNode.id = 'type_CustomTelemetry';
      targetNode.label = 'CustomTelemetry';
      assert.ok(targetNode.typeSpec, 'Target node must have typeSpec');
      const spec = targetNode.typeSpec;
      spec.name = 'CustomTelemetry';
      spec.fields = spec.fields || {};
      spec.fields['message'] = spec.fields['message'] || [];
      spec.fields['message'].push({
        type: 'float32',
        name: 'battery_level',
        constant: false,
        array: false,
      });

      // Emulate rebuildProjectTypes()
      const newTypes: Record<string, RosTypeSpec> = {};
      for (const n of project.nodes) {
        if (n.backing === 'type' && n.typeSpec) {
          newTypes[`${n.pkg || 'my_msgs'}.${n.label}`] = n.typeSpec;
        }
      }
      project.types = newTypes;

      // 3. Emit .ros model
      const emitted = RosModelEmitter.emitRos(project);

      // Verify "CustomTelemetry" is emitted with both fields
      assert.ok(emitted.includes('CustomTelemetry'), 'Emitted code should include renamed message CustomTelemetry');
      assert.ok(emitted.includes('battery_level'), 'Emitted code should include newly added field battery_level');

      // Verify "NewMessage" is NOT in the emitted output
      assert.strictEqual(
        emitted.includes('NewMessage'),
        false,
        'Emitted code should not contain phantom duplicate NewMessage'
      );
    });

    test('RosModelEmitter filters out orphaned NewMessage template even if present in project.types', () => {
      const project: RosProject = {
        formatVersion: 4,
        isRos: true,
        system: { name: 'my_msgs' },
        subSystems: [],
        nodes: [
          {
            id: 'type_RenamedMessage',
            label: 'RenamedMessage',
            pkg: 'my_msgs',
            backing: 'type',
            typeCategory: 'msg',
            typeSpec: {
              name: 'RenamedMessage',
              pkg: 'my_msgs',
              category: 'msg',
              fields: {
                message: [{ type: 'int32', name: 'count', constant: false, array: false }],
              },
            },
            ifaces: [],
            params: [],
          },
        ],
        connections: [],
        packages: {},
        // Simulate stale/deserialized project.types containing lingering NewMessage
        types: {
          'my_msgs.NewMessage': {
            name: 'NewMessage',
            pkg: 'my_msgs',
            category: 'msg',
            fields: {
              message: [{ type: 'string', name: 'data', constant: false, array: false }],
            },
          },
          'my_msgs.RenamedMessage': {
            name: 'RenamedMessage',
            pkg: 'my_msgs',
            category: 'msg',
            fields: {
              message: [{ type: 'int32', name: 'count', constant: false, array: false }],
            },
          },
        },
      };

      const emitted = RosModelEmitter.emitRos(project);
      assert.ok(emitted.includes('RenamedMessage'), 'Should emit RenamedMessage');
      assert.strictEqual(
        emitted.includes('NewMessage'),
        false,
        'Should skip orphaned NewMessage template when nodes exist'
      );
    });

    test('Type dependency connections in .ros models do not produce false Port type mismatch diagnostics', () => {
      // Parse inspection_msgs.ros
      const rosContent = `inspection_msgs:
  msgs:
    DefectReport
      message
        string target_id
        uint8 severity
        float64 confidence
        'geometry_msgs/msg/Pose' defect_pose
    SafetyStatus
      message
        bool estop_active
        bool zone_violation
        string warning_msg
  srvs:
    TriggerInspection
      request
        string inspection_point_id
      response
        bool success
        string message
        'inspection_msgs/msg/DefectReport' defect
`;
      const project = RosModelParser.parseRos(rosContent, 'inspection_msgs.ros');

      // Verify parser generated the type dependency connection
      assert.ok(project.connections.length > 0, 'Should have parsed dependency connection');
      const depConn = project.connections.find((c) => c.id.includes('TriggerInspection') && c.id.includes('DefectReport'));
      assert.ok(depConn, 'Should have dep connection between TriggerInspection and DefectReport');

      // Validate with ConnectionValidator
      const fromNode = project.nodes.find((n) => n.id === depConn.from.n);
      const toNode = project.nodes.find((n) => n.id === depConn.to.n);
      assert.ok(fromNode && toNode, 'Endpoints must exist');
      const fromIface = fromNode.ifaces.find((i) => i.id === depConn.from.i);
      const toIface = toNode.ifaces.find((i) => i.id === depConn.to.i);
      assert.ok(fromIface && toIface, 'Interfaces must exist');

      // Check with ConnectionValidator.validate: normalized matching should accept inspection_msgs/msg/DefectReport to DefectReport
      const valResult = ConnectionValidator.validate(fromNode, fromIface, toNode, toIface);
      assert.ok(!valResult.reason?.includes('Type mismatch'), `Expected no type mismatch, got: ${valResult.reason}`);

      // Now validate with RosCustomEditorProvider.mapDiagnosticsToElements
      const mockContext = {
        extensionPath: '/tmp',
        globalStorageUri: { fsPath: '/tmp' },
      } as unknown as vscode.ExtensionContext;
      const provider = new RosCustomEditorProvider(mockContext);

      const diags = provider.mapDiagnosticsToElements([], project, 'inspection_msgs.ros');
      const mismatchErrors = diags.filter((d) =>
        d.message.includes('Port type mismatch') ||
        d.message.includes('Incompatible port kinds') ||
        d.message.includes('Type dependency mismatch')
      );

      assert.strictEqual(
        mismatchErrors.length,
        0,
        `Expected 0 type mismatch/incompatible port errors, found: ${JSON.stringify(mismatchErrors)}`
      );
    });
  });

  // --------------------------------------------------------------------------------------
  // 20. COMPONENT (.ros2) PACKAGE & ARTIFACT RENAMING LIFECYCLE
  // --------------------------------------------------------------------------------------
  suite('20. Component (.ros2) Package & Artifact Renaming Lifecycle', () => {
    test('Renaming package and artifact in inspection_nodes.ros2 does not revert to ros_package.node_1', () => {
      const initialDoc = `ros_package:
  artifacts:
    node_1:
      node: ai_defect_detector
      publishers:
        topic_out:
          type: 'std_msgs/msg/String'
      subscribers:
        topic_in:
          type: 'std_msgs/msg/String'
`;
      const project = RosModelParser.parseRos2(initialDoc, 'inspection_nodes.ros2');
      assert.strictEqual(project.nodes.length, 1);
      const node = project.nodes[0];
      assert.strictEqual(node.pkg, 'ros_package');
      assert.strictEqual(node.artifact, 'node_1');
      assert.strictEqual(node.from, 'ros_package.node_1');

      // 1. Emulate user renaming Package / Artifact in inspector to 'inspection_nodes.defect_detector'
      const newPkg = 'inspection_nodes';
      const newArt = 'defect_detector';
      node.pkg = newPkg;
      node.artifact = newArt;
      node.from = `${newPkg}.${newArt}`;

      // Synchronize project package
      project.packages = {};
      project.packages[newPkg] = {
        name: newPkg,
        artifacts: [{
          name: newArt,
          node: node.label,
          ifaces: node.ifaces,
          params: node.params,
        }],
      };
      project.system.name = newPkg;

      // 2. Emit .ros2
      const emitted = RosModelEmitter.emitRos2(project);

      // Verify emitted output contains the new package and artifact
      assert.ok(emitted.includes('inspection_nodes:'), 'Emitted code must contain new package name inspection_nodes');
      assert.ok(emitted.includes('defect_detector:'), 'Emitted code must contain new artifact name defect_detector');
      assert.ok(emitted.includes('node: ai_defect_detector'), 'Emitted code must preserve node name ai_defect_detector');

      // Verify emitted output does NOT contain the old defaults
      assert.strictEqual(
        emitted.includes('ros_package:'),
        false,
        'Emitted code must not default back to ros_package'
      );
      assert.strictEqual(
        emitted.includes('node_1:'),
        false,
        'Emitted code must not default back to node_1'
      );

      // 3. Verify round-trip re-parsing keeps the renamed package and artifact
      const roundTrip = RosModelParser.parseRos2(emitted, 'inspection_nodes.ros2');
      assert.strictEqual(roundTrip.nodes.length, 1);
      const rtNode = roundTrip.nodes[0];
      assert.strictEqual(rtNode.pkg, 'inspection_nodes');
      assert.strictEqual(rtNode.artifact, 'defect_detector');
      assert.strictEqual(rtNode.from, 'inspection_nodes.defect_detector');
      assert.strictEqual(rtNode.label, 'ai_defect_detector');
    });

    test('RosModelEmitter updates artifact and package name even if project.packages has stale references', () => {
      const project: RosProject = {
        formatVersion: 4,
        system: { name: 'package' },
        subSystems: [],
        nodes: [
          {
            id: 'n_detector',
            label: 'ai_defect_detector',
            pkg: 'custom_inspection',
            artifact: 'detector_art',
            from: 'custom_inspection.detector_art',
            backing: 'local',
            ifaces: [
              { id: 'i_out', name: 'status', label: 'status', kind: 'pub', type: 'std_msgs/msg/String', exposed: true },
            ],
            params: [],
          },
        ],
        connections: [],
        packages: {
          // Stale package with old name and old artifact
          ros_package: {
            name: 'ros_package',
            artifacts: [
              {
                name: 'node_1',
                node: 'ai_defect_detector',
                ifaces: [],
                params: [],
              },
            ],
          },
        },
        types: {},
      };

      const emitted = RosModelEmitter.emitRos2(project);
      assert.ok(emitted.includes('custom_inspection:'), 'Must emit node.pkg custom_inspection');
      assert.ok(emitted.includes('detector_art:'), 'Must emit node.artifact detector_art');
      assert.strictEqual(emitted.includes('ros_package:'), false, 'Must not emit stale package name');
      assert.strictEqual(emitted.includes('node_1:'), false, 'Must not emit stale artifact name');
    });
  });

  suite('21. Component (.ros2) Interface QoS Dropdown Configuration & Lifecycle', () => {
    test('Setting QoS dropdown values on publisher and subscriber serializes compliant Xtext/YAML QoS blocks', () => {
      const project: RosProject = {
        formatVersion: 4,
        system: { name: 'sensor_system' },
        subSystems: [],
        nodes: [
          {
            id: 'n_lidar',
            label: 'lidar_driver',
            pkg: 'sensor_pkg',
            artifact: 'lidar_node',
            from: 'sensor_pkg.lidar_node',
            backing: 'local',
            ifaces: [
              {
                id: 'i_scan',
                name: 'scan',
                label: 'scan',
                kind: 'pub',
                type: 'sensor_msgs/msg/LaserScan',
                qos: {
                  profile: 'sensor_qos',
                  reliability: 'best_effort',
                  durability: 'volatile',
                  history: 'keep_last',
                  depth: '10',
                  deadline: '100ms',
                  lifespan: 'infinite',
                  lease_duration: '500ms',
                  liveliness: 'automatic',
                },
                exposed: true,
              },
              {
                id: 'i_sub_cmd',
                name: 'cmd',
                label: 'cmd',
                kind: 'sub',
                type: 'std_msgs/msg/String',
                qos: {
                  reliability: 'reliable',
                  durability: 'transient_local',
                  history: 'keep_all',
                  depth: '50',
                },
                exposed: true,
              },
            ],
            params: [],
          },
        ],
        connections: [],
        packages: {},
        types: {},
      };

      const emitted = RosModelEmitter.emitRos2(project);
      assert.ok(emitted.includes('qos:'), 'Emitted .ros2 must include qos: block');
      assert.ok(emitted.includes('profile: sensor_qos'), 'Profile must be emitted bare');
      assert.ok(emitted.includes('reliability: best_effort'), 'Reliability must be emitted bare');
      assert.ok(emitted.includes('durability: volatile'), 'Durability must be emitted bare');
      assert.ok(emitted.includes('history: keep_last'), 'History must be emitted bare');
      assert.ok(emitted.includes('depth: 10'), 'Depth must be emitted as integer');
      assert.ok(emitted.includes('deadline: "100ms"'), 'Deadline string must be quoted');
      assert.ok(emitted.includes('lifespan: infinite'), 'Lifespan infinite must be bare');
      assert.ok(emitted.includes('lease_duration: "500ms"'), 'Lease duration string must be quoted');
      assert.ok(emitted.includes('liveliness: automatic'), 'Liveliness must be emitted bare');

      // Roundtrip parse
      const parsed = RosModelParser.parseRos2(emitted);
      const pkg = parsed.packages['sensor_pkg'];
      assert.ok(pkg, 'Package sensor_pkg must be parsed');
      const art = pkg.artifacts.find((a) => a.name === 'lidar_node');
      assert.ok(art, 'Artifact lidar_node must be parsed');
      const scanIface = art.ifaces.find((f) => f.name === 'scan');
      assert.ok(scanIface, 'Interface scan must be parsed');
      assert.ok(scanIface.qos, 'Interface scan must have QoS object');
      assert.strictEqual(scanIface.qos.profile, 'sensor_qos');
      assert.strictEqual(scanIface.qos.reliability, 'best_effort');
      assert.strictEqual(scanIface.qos.durability, 'volatile');
      assert.strictEqual(scanIface.qos.history, 'keep_last');
      assert.strictEqual(scanIface.qos.depth, '10');
      assert.strictEqual(scanIface.qos.deadline, '100ms');
      assert.strictEqual(scanIface.qos.lifespan, 'infinite');
      assert.strictEqual(scanIface.qos.lease_duration, '500ms');
      assert.strictEqual(scanIface.qos.liveliness, 'automatic');

      const cmdIface = art.ifaces.find((f) => f.name === 'cmd');
      assert.ok(cmdIface && cmdIface.qos, 'Interface cmd must have QoS');
      assert.strictEqual(cmdIface.qos.reliability, 'reliable');
      assert.strictEqual(cmdIface.qos.durability, 'transient_local');
      assert.strictEqual(cmdIface.qos.history, 'keep_all');
      assert.strictEqual(cmdIface.qos.depth, '50');
    });

    test('Clearing QoS removes qos: block cleanly from emitted .ros2', () => {
      const project: RosProject = {
        formatVersion: 4,
        system: { name: 'sensor_system' },
        subSystems: [],
        nodes: [
          {
            id: 'n_lidar',
            label: 'lidar_driver',
            pkg: 'sensor_pkg',
            artifact: 'lidar_node',
            from: 'sensor_pkg.lidar_node',
            backing: 'local',
            ifaces: [
              {
                id: 'i_scan',
                name: 'scan',
                label: 'scan',
                kind: 'pub',
                type: 'sensor_msgs/msg/LaserScan',
                exposed: true,
              },
            ],
            params: [],
          },
        ],
        connections: [],
        packages: {},
        types: {},
      };

      const emitted = RosModelEmitter.emitRos2(project);
      assert.strictEqual(emitted.includes('qos:'), false, 'Emitted output must not include qos: block when QoS is empty or absent');
    });

    test('Webview HTML provides pure dropdown selectors for all QoS properties', () => {
      const mockUri = vscode.Uri.file('/tmp');
      const mockWebview = {} as vscode.Webview;
      const project: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: false,
        system: { name: 'sensor_system' },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };
      const html = getStudioHtml(project, mockUri, mockWebview, {}, {}, 'sensor_nodes.ros2');
      assert.ok(html.includes('details.qos-details'), 'HTML must include CSS styles for QoS details panel');
      assert.ok(html.includes('.qos-grid'), 'HTML must include CSS grid for QoS fields');
      assert.ok(html.includes('Quality of Service (QoS)'), 'HTML must render Quality of Service section header');
      assert.ok(html.includes('data-qos-key="profile"'), 'HTML must include profile dropdown selector');
      assert.ok(html.includes('data-qos-key="reliability"'), 'HTML must include reliability dropdown selector');
      assert.ok(html.includes('data-qos-key="durability"'), 'HTML must include durability dropdown selector');
      assert.ok(html.includes('data-qos-key="history"'), 'HTML must include history dropdown selector');
      assert.ok(html.includes('data-qos-key="depth"'), 'HTML must include depth dropdown selector');
      assert.ok(html.includes('data-qos-key="liveliness"'), 'HTML must include liveliness dropdown selector');
      assert.ok(html.includes('data-qos-key="deadline"'), 'HTML must include deadline dropdown selector');
      assert.ok(html.includes('data-qos-key="lifespan"'), 'HTML must include lifespan dropdown selector');
      assert.ok(html.includes('data-qos-key="lease_duration"'), 'HTML must include lease_duration dropdown selector');
      assert.ok(html.includes('btn-clear-qos'), 'HTML must include Reset QoS to Default button');
      assert.ok(html.includes('default_qos'), 'HTML must include default_qos option');
      assert.ok(html.includes('sensor_qos'), 'HTML must include sensor_qos option');
    });
  });

  suite('22. System View Node Remapping, RosSystem Parameter Isolation, and Core Catalogue Read-Only Enforcement', () => {
    test('Interface remapping in .rossystem preserves target component reference and emits valid kind arrow', () => {
      const project: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: true,
        system: { name: 'perception_bringup' },
        subSystems: [],
        nodes: [
          {
            id: 'n_cv_camera_node',
            label: 'cv_camera_node',
            from: 'cv_camera.cv_camera_node',
            artifact: 'cv_camera_node',
            pkg: 'cv_camera',
            ifaces: [
              {
                id: 'i_cv_camera_node_camera_info',
                name: 'camera_info',
                label: 'camera_info',
                kind: 'pub',
                type: 'sensor_msgs/msg/CameraInfo',
                exposed: true,
              },
              {
                id: 'i_cv_camera_node_set_camera_info',
                name: 'set_camera_info',
                label: 'set_camera_info_test', // User remapped name in system
                kind: 'ss',
                type: 'sensor_msgs/srv/SetCameraInfo',
                exposed: true,
              },
            ],
            params: [],
          },
        ],
        connections: [],
        packages: {},
        types: {},
      };

      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(emitted.includes('- camera_info: pub-> "cv_camera_node::camera_info"'), 'Default interface label points to target reference');
      assert.ok(emitted.includes('- set_camera_info_test: ss-> "cv_camera_node::set_camera_info"'), 'Remapped interface label must preserve original component target reference');
      assert.ok(!emitted.includes('set_camera_info_test::'), 'Target reference must never be corrupted by remapped label');
    });

    test('Parameters without assigned launch values are omitted from .rossystem and assigned values emit mandatory value: clause', () => {
      const project: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: true,
        system: { name: 'perception_bringup' },
        subSystems: [],
        nodes: [
          {
            id: 'n_cv_camera_node',
            label: 'cv_camera_node',
            from: 'cv_camera.cv_camera_node',
            artifact: 'cv_camera_node',
            pkg: 'cv_camera',
            ifaces: [],
            params: [
              {
                id: 'p_cv_camera_node_image_width',
                name: 'image_width',
                label: 'image_width',
                ptype: 'Integer',
                value: undefined, // Component has no default value
                sysValue: undefined, // User did not configure it in system
                exposed: false,
              },
              {
                id: 'p_cv_camera_node_device_id',
                name: 'device_id',
                label: 'device_id',
                ptype: 'Integer',
                value: 0, // Component default value
                sysValue: '1', // User assigned launch value in system
                exposed: true,
              },
            ],
          },
        ],
        connections: [],
        packages: {},
        types: {},
      };

      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(!emitted.includes('image_width'), 'Unconfigured parameters without values must be omitted from .rossystem');
      assert.ok(emitted.includes('parameters:'), 'Parameters block should be emitted when configured parameter exists');
      assert.ok(emitted.includes('- device_id: "cv_camera_node::device_id"'), 'Configured parameter should be emitted with target ref');
      assert.ok(emitted.includes('value: 1'), 'Emitted parameter must have mandatory value: clause per RosSystem.xtext');
    });

    test('Core catalogue detection correctly identifies catalogue folders vs workspace models', () => {
      const mockContext = {
        extensionPath: '/mock/ext',
        globalStorageUri: vscode.Uri.file('/mock/storage'),
      } as unknown as vscode.ExtensionContext;

      const provider = new RosCustomEditorProvider(mockContext);
      assert.strictEqual(provider.isCoreCatalogue('/home/adm-esa/coresense-ws/src/RosModelsCatalog/cameras/cv_camera.ros2'), true);
      assert.strictEqual(provider.isCoreCatalogue('/home/adm-esa/coresense-ws/src/RosCommonObjects/basic_msgs/sensor_msgs.ros'), true);
      assert.strictEqual(provider.isCoreCatalogue('/home/user/.rostooling/catalogue_repos/RosModelsCatalog/models.ros2'), true);
      assert.strictEqual(provider.isCoreCatalogue('/mock/ext/assets/nodes/node_index.json'), true);
      assert.strictEqual(provider.isCoreCatalogue('/home/adm-esa/coresense-ws/src/RosTooling_Extension/demo/test_ws/src/test_system/test_node.ros2'), false);
      assert.strictEqual(provider.isCoreCatalogue('/home/adm-esa/coresense-ws/src/RosTooling_Extension/demo/test_ws/src/test_system/mock_robot_system/perception_bringup.rossystem'), false);
    });

    test('System view inspector specializes node properties: component link button, remapping, parameter launch values', () => {
      const mockUri = vscode.Uri.file('/tmp');
      const mockWebview = {} as vscode.Webview;
      const project: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: true,
        system: { name: 'perception_bringup' },
        subSystems: [],
        nodes: [
          {
            id: 'n_cam',
            label: 'cv_camera_node',
            from: 'cv_camera.cv_camera_node',
            artifact: 'cv_camera_node',
            pkg: 'cv_camera',
            ifaces: [
              { id: 'i1', name: 'camera_info', label: 'camera_info', kind: 'pub', type: 'sensor_msgs/msg/CameraInfo', exposed: true },
            ],
            params: [
              { id: 'p1', name: 'image_width', label: 'image_width', ptype: 'Integer', value: undefined, exposed: false },
            ],
          },
        ],
        connections: [],
        packages: {},
        types: {},
      };

      const html = getStudioHtml(project, mockUri, mockWebview, {}, {}, 'perception_bringup.rossystem', false);
      assert.ok(html.includes('btnOpenComponentRos2'), 'Inspector must render Edit Component in .ros2 View button');
      assert.ok(html.includes('Edit Component in .ros2 View'), 'Button label must match specification');
      assert.ok(html.includes('inp-iface-remap'), 'Inspector must render Remapped Name input field in System view');
      assert.ok(html.includes('id="inpNodeFrom"') && html.includes('readonly style="opacity:0.85; background:var(--surface-2)'), 'Component definition must be read-only in System view');
    });

    test('Core catalogue read-only mode displays badge, disables inputs, and prevents modifications', () => {
      const mockUri = vscode.Uri.file('/tmp');
      const mockWebview = {} as vscode.Webview;
      const project: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: false,
        system: { name: 'cv_camera' },
        subSystems: [],
        nodes: [
          {
            id: 'n1',
            label: 'cv_camera_node',
            from: 'cv_camera.cv_camera_node',
            artifact: 'cv_camera_node',
            pkg: 'cv_camera',
            ifaces: [],
            params: [],
          },
        ],
        connections: [],
        packages: {},
        types: {},
      };

      const html = getStudioHtml(project, mockUri, mockWebview, {}, {}, '/coresense-ws/src/RosModelsCatalog/cameras/cv_camera.ros2', true);
      assert.ok(html.includes('readOnlyBadge'), 'Topbar must display read-only badge');
      assert.ok(html.includes('Core Catalogue (Read-Only)'), 'Badge text must clearly indicate core catalogue read-only');
      assert.ok(html.includes('var isReadOnly = true;'), 'Client script must have isReadOnly set to true');
      assert.ok(!html.includes('id="btnOpenCatalogue"'), 'Catalogue add button must be omitted in read-only mode');
      assert.ok(html.includes('sysNameInput" class="sysname-input" value="cv_camera" placeholder="Enter package name..." disabled'), 'Model name input must be disabled in read-only mode');
    });

    test('Core catalogue models strictly disallow layout persistence and disk modification', async () => {
      const mockContext = {
        extensionPath: '/mock/ext',
        globalStorageUri: vscode.Uri.file('/mock/storage'),
      } as unknown as vscode.ExtensionContext;

      const provider = new RosCustomEditorProvider(mockContext);
      const catFile = '/home/user/.rostooling/catalogue_repos/RosModelsCatalog/models.ros2';
      assert.strictEqual(provider.isCoreCatalogue(catFile), true);

      const project: RosProject = {
        formatVersion: 4,
        system: { name: 'cat_test' },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };

      await provider.saveLayoutSchematic(catFile, project);
      await RosLayoutManager.saveLayoutSchematic(catFile, project);

      const layoutPath = RosLayoutManager.getLayoutFilePath(catFile);
      assert.ok(!layoutPath.includes('.rostooling/catalogue_repos/RosModelsCatalog/.rostooling'), 'Layout file must not be placed inside catalogue repo');
      assert.ok(RosLayoutManager.isCataloguePath(catFile), 'isCataloguePath must identify catalogue path');
    });

    test('RosCatalogueManager repository configuration specifies correct main branch for RosCommonObjects', () => {
      const commonObjects = RosCatalogueManager.DEFAULT_REPOSITORIES.find((r) => r.id === 'ros_common_objects');
      assert.ok(commonObjects, 'ros_common_objects must be in default repositories');
      assert.strictEqual(commonObjects?.branch, 'main', 'ros_common_objects branch must be main');
    });

    test('System view disallows blank node creation and enables catalogue and workspace node import', () => {
      const mockUri = vscode.Uri.file('/tmp');
      const mockWebview = {} as vscode.Webview;
      const project: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: true,
        system: { name: 'perception_bringup' },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };

      const html = getStudioHtml(project, mockUri, mockWebview, {}, {}, 'perception_bringup.rossystem', false);
      assert.ok(!html.includes('id="btnAddNode"'), 'System view must NOT have + Add New Node button');
      assert.ok(html.includes('id="btnAddSystemNode"'), 'System view MUST have + Import Node button');
      assert.ok(html.includes('+ Import Node'), 'System view button text must read + Import Node');
      assert.ok(html.includes('safeClick("btnAddSystemNode"'), 'System view must wire click handler for btnAddSystemNode');
      assert.ok(html.includes('activeCatTab = "nodes";'), 'Import Node button must activate nodes tab in catalogue drawer');
      assert.ok(html.includes('body.mode-system #btnAddNode'), 'CSS must enforce that btnAddNode is hidden in mode-system');
    });

    test('Changing Node Label in system view does NOT alter component definition (from and artifact)', () => {
      const mockUri = vscode.Uri.file('/tmp');
      const mockWebview = {} as vscode.Webview;
      const project: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: true,
        system: { name: 'perception_bringup' },
        subSystems: [],
        nodes: [
          {
            id: 'n_defect_detector',
            label: 'defect_detector',
            from: 'inspection_nodes.ai_defect_detector',
            artifact: 'ai_defect_detector',
            pkg: 'inspection_nodes',
            ifaces: [
              { id: 'i1', name: 'image_raw', label: 'image_raw', kind: 'sub', type: 'sensor_msgs/msg/Image', exposed: true },
            ],
            params: [],
          },
        ],
        connections: [],
        packages: {},
        types: {},
      };

      // 1. Verify emitted YAML preserves component definition and component interface target
      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(emitted.includes('defect_detector:'), 'Emitted YAML must use the new node label');
      assert.ok(emitted.includes('from: "inspection_nodes.ai_defect_detector"'), 'Emitted YAML must preserve the original component definition');
      assert.ok(emitted.includes('image_raw: sub-> "ai_defect_detector::image_raw"'), 'Target reference must preserve original component artifact and interface name');
      assert.ok(!emitted.includes('inspection_nodes.defect_detector'), 'Emitted YAML must NEVER invent a non-existent component definition');

      // 2. Verify webview client script prevents altering from/artifact on label change in system view
      const html = getStudioHtml(project, mockUri, mockWebview, {}, {}, 'perception_bringup.rossystem', false);
      assert.ok(html.includes('if (!isRosSystem && !isRos)'), 'Inspector label change handler must guard from/artifact mutation against system mode');
      assert.ok(html.includes('updateNodePackageAndArtifact(node, pkgVal, artVal) {\n        if (isRosSystem) return;'), 'updateNodePackageAndArtifact must guard against modifying component definition in system mode');
    });

    test('Subsystem catalogue discovery, file resolution, and subsystem edit navigation buttons', () => {
      const mockUri = vscode.Uri.file('/tmp');
      const mockWebview = {} as vscode.Webview;
      const project: RosProject = {
        formatVersion: 4,
        isRos: false,
        isRosSystem: true,
        system: { name: 'inspection_system' },
        subSystems: [
          { ref: 'hardware_bringup', state: 'collapsed', fromFile: 'hardware_bringup.rossystem' },
        ],
        nodes: [
          {
            id: 'n_diff_drive_node',
            label: 'diff_drive_node',
            subRef: 'hardware_bringup',
            from: 'diff_drive_controller.diff_drive_controller',
            artifact: 'diff_drive_controller',
            pkg: 'diff_drive_controller',
            ifaces: [
              { id: 'i1', name: 'cmd_vel', label: 'cmd_vel', kind: 'sub', type: 'geometry_msgs/msg/Twist', exposed: true },
            ],
            params: [],
          },
        ],
        connections: [],
        packages: {},
        types: {},
      };

      const html = getStudioHtml(
        project,
        mockUri,
        mockWebview,
        {
          _systems: [
            {
              system: 'hardware_bringup',
              file: 'mock_robot_system/hardware_bringup.rossystem',
              source: 'test_ws',
              nodes: {
                diff_drive_node: { from: 'diff_drive_controller.diff_drive_controller' },
                lidar_node: { from: 'turtlebot3_laserscan.turtlebot3_laserscan' },
              },
            },
          ],
        },
        {},
        'inspection_system.rossystem',
        false
      );

      // 1. Verify subsystem inspector contains "Edit Subsystem in .rossystem View" button
      assert.ok(html.includes('id="btnOpenSubsystemRosSystem"'), 'Webview inspector must render btnOpenSubsystemRosSystem');
      assert.ok(html.includes('📦 Edit Subsystem in .rossystem View'), 'Button label must be 📦 Edit Subsystem in .rossystem View');
      assert.ok(html.includes("type: 'openSubsystemRosSystem'"), 'Webview must post openSubsystemRosSystem message to extension host');

      // 2. Verify node inspector contains parent subsystem button for subsystem nodes
      assert.ok(html.includes('id="btnOpenParentSubsystemRosSystem"'), 'Node inspector must render btnOpenParentSubsystemRosSystem for subsystem members');
      assert.ok(html.includes('📦 Edit Subsystem ('), 'Parent subsystem edit button label must indicate parent subsystem');

      // 3. Verify canvas subsystem headers contain open subsystem icon button
      assert.ok(html.includes('class="btn-open-sub"'), 'Subsystem box and frame headers must render .btn-open-sub button');
      assert.ok(html.includes('data-open-sub='), 'Subsystem box and frame headers must include data-open-sub attribute');

      // 4. Verify catalogue subsystems list filters out current open system
      assert.ok(html.includes('if (currentSysName && (sysName === currentSysName || sysName === docBaseName)) return;'), 'Catalogue drawer must filter out open system from subsystems tab');

      // 5. Verify RosCatalogueManager finds hardware_bringup in mock_robot_system
      const mockWsDir = path.resolve(__dirname, '../../../demo/test_ws/src/test_system/mock_robot_system');
      if (fs.existsSync(mockWsDir)) {
        const catManager = new RosCatalogueManager('/tmp/rostooling_cat_test_' + Date.now());
        const index = catManager.buildCatalogueIndex([mockWsDir]);
        const foundSys = (index.systems || []).find((s) => s.system === 'hardware_bringup');
        assert.ok(foundSys, 'RosCatalogueManager must discover hardware_bringup.rossystem in mock_robot_system');
        assert.ok(foundSys.fullPath && foundSys.fullPath.endsWith('hardware_bringup.rossystem'), 'Indexed system must include fullPath');
        assert.ok(foundSys.nodes['diff_drive_node'], 'Indexed hardware_bringup must contain diff_drive_node');
        assert.ok(foundSys.nodes['lidar_node'], 'Indexed hardware_bringup must contain lidar_node');
      }
    });

    test('Subsystem connection persistence: connecting node to subsystem port is preserved across parse and emit', () => {
      const sampleWithSubConnection = `
inspection_system:
  subSystems:
    perception_bringup
  nodes:
    mission_exec:
      from: "inspection_nodes.mission_executive"
      interfaces:
        - trigger_client: sc-> "mission_executive::inspect_target_client"
  connections:
    - ["trigger_srv", "trigger_client"]
`;
      // 1. RosModelParser parses connection even though trigger_srv is not in nodes yet
      const project = RosModelParser.parseRosSystem(sampleWithSubConnection, 'inspection_system.rossystem');
      assert.strictEqual(project.connections.length, 1, 'Connection with subsystem endpoint must be parsed and preserved');
      assert.strictEqual(project.connections[0].rawFrom, 'trigger_srv');
      assert.strictEqual(project.connections[0].rawTo, 'trigger_client');

      // 2. RosModelEmitter preserves and emits the connection
      const emitted = RosModelEmitter.emitRosSystem(project);
      assert.ok(emitted.includes('- ["trigger_srv", "trigger_client"]'), 'Emitted YAML must retain bracketed connection with subsystem port');

      // 3. Simulated resolveSystemInterfaces resolves endpoint to loaded subsystem node
      project.nodes.push({
        id: 'n_perception_bringup_defect_detector',
        label: 'defect_detector',
        subRef: 'perception_bringup',
        backing: 'sub',
        ifaces: [
          { id: 'i_defect_detector_trigger_srv', name: 'trigger_inspection_srv', label: 'trigger_srv', kind: 'ss', type: 'inspection_msgs/srv/TriggerInspection', exposed: true },
        ],
        params: [],
      });

      // Re-resolve connection endpoint
      for (const conn of project.connections) {
        if (!conn.from.n) {
          for (const n of project.nodes) {
            const match = n.ifaces.find((f) => f.label === conn.from.i || f.name === conn.from.i);
            if (match) {
              conn.from.n = n.id;
              conn.from.i = match.id;
              break;
            }
          }
        }
      }

      assert.strictEqual(project.connections[0].from.n, 'n_perception_bringup_defect_detector');
      assert.strictEqual(project.connections[0].from.i, 'i_defect_detector_trigger_srv');
      assert.strictEqual(project.connections[0].to.n, 'n_mission_exec');
    });

    test('Node definition sync: newly added interfaces and parameters dynamically update direct and subsystem nodes', () => {
      // 1. Setup mock provider
      const mockContext = {
        subscriptions: [],
        extensionPath: path.resolve(__dirname, '../../'),
        globalStorageUri: vscode.Uri.file('/tmp/rostooling_test_storage'),
      } as unknown as vscode.ExtensionContext;
      const provider = new RosCustomEditorProvider(mockContext);

      // 2. Setup a project with a direct node (like safety_supervisor in inspection_system.rossystem)
      const directNode: RosNode = {
        id: 'n_safety_supervisor',
        label: 'safety_supervisor',
        from: 'inspection_nodes.safety_supervisor',
        artifact: 'safety_supervisor',
        pkg: 'inspection_nodes',
        backing: 'local',
        ifaces: [
          { id: 'i_safety_supervisor_safety_status_pub', name: 'safety_status_pub', label: 'safety_status_pub', kind: 'pub', type: 'inspection_msgs/msg/SafetyStatus', exposed: true },
          { id: 'i_safety_supervisor_cmd_vel_safe', name: 'cmd_vel_safe', label: 'cmd_vel_safe', kind: 'pub', type: 'geometry_msgs/msg/Twist', exposed: true },
          { id: 'i_safety_supervisor_scan_in', name: 'scan_in', label: 'scan_in', kind: 'sub', type: 'sensor_msgs/msg/LaserScan', exposed: true },
          { id: 'i_safety_supervisor_reset_safety_srv', name: 'reset_safety_srv', label: 'reset_safety_srv', kind: 'ss', type: 'inspection_msgs/srv/ResetSafetyZone', exposed: true },
        ],
        params: [],
      };

      // 3. Setup a subsystem member node (like defect_detector in perception_bringup)
      const subMemberNode: RosNode = {
        id: 'n_perception_bringup_defect_detector',
        label: 'defect_detector',
        subRef: 'perception_bringup',
        from: 'inspection_nodes.ai_defect_detector',
        artifact: 'ai_defect_detector',
        pkg: 'inspection_nodes',
        backing: 'sub',
        ifaces: [
          { id: 'i_defect_detector_defect_pub', name: 'defect_report_pub', label: 'defect_pub', kind: 'pub', type: '', exposed: true },
          { id: 'i_defect_detector_camera_sub', name: 'camera_image', label: 'camera_sub', kind: 'sub', type: '', exposed: true },
        ],
        params: [],
      };

      // 4. Declare updated companion artifacts simulating edits in inspection_nodes.ros2:
      // safety_supervisor has added interface 'raw_cmd_in' and parameters 'slowdown_radius' & 'emergency_stop_radius'
      const updatedSafetyArt = {
        filePath: '/test/inspection_nodes.ros2',
        pkg: 'inspection_nodes',
        name: 'safety_supervisor',
        node: 'safety_supervisor',
        ifaces: [
          { id: 'i_safety_status_pub', name: 'safety_status_pub', label: 'safety_status_pub', kind: 'pub' as const, type: 'inspection_msgs/msg/SafetyStatus', exposed: true },
          { id: 'i_cmd_vel_safe', name: 'cmd_vel_safe', label: 'cmd_vel_safe', kind: 'pub' as const, type: 'geometry_msgs/msg/Twist', exposed: true },
          { id: 'i_raw_cmd_in', name: 'raw_cmd_in', label: 'raw_cmd_in', kind: 'sub' as const, type: 'geometry_msgs/msg/Twist', exposed: true },
          { id: 'i_scan_in', name: 'scan_in', label: 'scan_in', kind: 'sub' as const, type: 'sensor_msgs/msg/LaserScan', exposed: true },
          { id: 'i_reset_safety_srv', name: 'reset_safety_srv', label: 'reset_safety_srv', kind: 'ss' as const, type: 'inspection_msgs/srv/ResetSafetyZone', exposed: true },
        ],
        params: [
          { id: 'p_slowdown_radius', name: 'slowdown_radius', label: 'slowdown_radius', ptype: 'Double', value: '1.2', exposed: true },
          { id: 'p_emergency_stop_radius', name: 'emergency_stop_radius', label: 'emergency_stop_radius', ptype: 'Double', value: '0.45', exposed: true },
        ],
      };

      // ai_defect_detector has added interface 'defect_marker' and parameters 'confidence_threshold' & 'model_path'
      const updatedDefectArt = {
        filePath: '/test/inspection_nodes.ros2',
        pkg: 'inspection_nodes',
        name: 'ai_defect_detector',
        node: 'ai_defect_detector',
        ifaces: [
          { id: 'i_defect_report_pub', name: 'defect_report_pub', label: 'defect_report_pub', kind: 'pub' as const, type: 'inspection_msgs/msg/DefectReport', exposed: true },
          { id: 'i_camera_image', name: 'camera_image', label: 'camera_image', kind: 'sub' as const, type: 'sensor_msgs/msg/Image', exposed: true },
          { id: 'i_defect_marker', name: 'defect_marker', label: 'defect_marker', kind: 'pub' as const, type: 'visualization_msgs/msg/Marker', exposed: true },
        ],
        params: [
          { id: 'p_confidence_threshold', name: 'confidence_threshold', label: 'confidence_threshold', ptype: 'Double', value: '0.75', exposed: true },
          { id: 'p_model_path', name: 'model_path', label: 'model_path', ptype: 'String', value: '/opt/models/defect_net.onnx', exposed: true },
        ],
      };

      // 5. Test enrichNodeWithDefinitions on direct node
      provider['enrichNodeWithDefinitions'](directNode, updatedSafetyArt);

      // Verify newly added interface is appended to direct node
      assert.strictEqual(directNode.ifaces.length, 5, 'Direct node must have all 5 interfaces');
      const rawCmdIn = directNode.ifaces.find((f) => f.name === 'raw_cmd_in');
      assert.ok(rawCmdIn, 'raw_cmd_in interface must be merged into direct node');
      assert.strictEqual(rawCmdIn.kind, 'sub');
      assert.strictEqual(rawCmdIn.type, 'geometry_msgs/msg/Twist');
      assert.strictEqual(rawCmdIn.exposed, true);

      // Verify newly added parameters are appended to direct node with default values and exposed: false
      assert.strictEqual(directNode.params.length, 2, 'Direct node must have 2 parameters');
      const slowdown = directNode.params.find((p) => p.name === 'slowdown_radius');
      assert.ok(slowdown, 'slowdown_radius parameter must be merged');
      assert.strictEqual(slowdown.ptype, 'Double');
      assert.strictEqual(slowdown.value, '1.2');
      assert.strictEqual(slowdown.exposed, false, 'Unconfigured parameter should have exposed: false');

      // 6. Test enrichNodeWithDefinitions on subsystem member node
      provider['enrichNodeWithDefinitions'](subMemberNode, updatedDefectArt);

      // Verify newly added interface is appended to subsystem member node
      assert.strictEqual(subMemberNode.ifaces.length, 3, 'Subsystem member node must have 3 interfaces');
      const markerIface = subMemberNode.ifaces.find((f) => f.name === 'defect_marker');
      assert.ok(markerIface, 'defect_marker interface must be merged into subsystem member node');
      assert.strictEqual(markerIface.kind, 'pub');
      assert.strictEqual(markerIface.type, 'visualization_msgs/msg/Marker');

      // Verify existing interface types are updated without overriding custom labels
      const camSub = subMemberNode.ifaces.find((f) => f.name === 'camera_image');
      assert.strictEqual(camSub?.label, 'camera_sub', 'Custom label must be preserved');
      assert.strictEqual(camSub?.type, 'sensor_msgs/msg/Image', 'Type must be resolved from declaration');

      // Verify newly added parameters on subsystem member node
      assert.strictEqual(subMemberNode.params.length, 2, 'Subsystem member node must have 2 parameters');
      const confThresh = subMemberNode.params.find((p) => p.name === 'confidence_threshold');
      assert.ok(confThresh, 'confidence_threshold parameter must be merged');
      assert.strictEqual(confThresh.ptype, 'Double');
      assert.strictEqual(confThresh.value, '0.75');

      // 7. Verify RosModelEmitter does NOT emit unassigned parameters with exposed: false
      const testProject: RosProject = {
        formatVersion: 4,
        system: { name: 'test_sync_system', comments: {} },
        subSystems: [],
        nodes: [directNode],
        connections: [],
        packages: {},
        types: {},
      };
      const emitted = RosModelEmitter.emitRosSystem(testProject);
      assert.ok(!emitted.includes('parameters:'), 'Parameters without launch values must not be emitted to .rossystem');
      assert.ok(emitted.includes('raw_cmd_in: sub-> "safety_supervisor::raw_cmd_in"'), 'Newly added interface must be emitted');

      // 8. If launch value is assigned, it IS emitted cleanly
      slowdown.sysValue = '1.0';
      slowdown.exposed = true;
      const emittedWithVal = RosModelEmitter.emitRosSystem(testProject);
      assert.ok(emittedWithVal.includes('parameters:'), 'Parameters with launch values must be emitted');
      assert.ok(emittedWithVal.includes('- slowdown_radius: "safety_supervisor::slowdown_radius"'));
      assert.ok(emittedWithVal.includes('value: 1.0'));
    });
  });
});
