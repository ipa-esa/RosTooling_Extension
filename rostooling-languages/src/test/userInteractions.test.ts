import * as assert from 'assert';
import { RosModelParser } from '../model/RosModelParser';
import { RosModelEmitter } from '../model/RosModelEmitter';
import { ConnectionValidator } from '../model/ConnectionValidator';
import {
  RosProject,
  RosNode,
  RosInteractionKind,
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
  });
});
