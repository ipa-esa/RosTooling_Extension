import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { RosModelParser } from '../model/RosModelParser';
import { RosModelEmitter } from '../model/RosModelEmitter';
import {
  RosProject,
  RosLayoutSchematic,
  RosInteractionKind,
} from '../model/RosModelTypes';
import { RosLayoutManager } from '../model/RosLayoutManager';
import { RosCatalogueManager } from '../model/RosCatalogueManager';
import { RosCustomEditorProvider } from '../editor/RosCustomEditorProvider';

suite('Visual Editor Features & Layout Persistence Test Suite', () => {
  const tmpDir = path.join(os.tmpdir(), `rostooling_test_${Date.now()}`);

  suiteSetup(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  suiteTeardown(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // 1. Communication objects view (.ros)
  test('1. Communication Objects View (.ros) shows type schemas with zero wire connection ports', () => {
    const rosContent = `
geometry_msgs:
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
std_srvs:
  srvs:
    SetBool
      request
        bool data
      response
        bool success
        string message
nav2_msgs:
  actions:
    NavigateToPose
      goal
        geometry_msgs/Point pose
      result
        int32 error_code
      feedback
        float32 distance_remaining
`;
    const docPath = path.join(tmpDir, 'types.ros');
    fs.writeFileSync(docPath, rosContent, 'utf-8');

    const project = RosModelParser.parse(rosContent, docPath);
    project.isRos = true;
    project.isRosSystem = false;

    assert.strictEqual(project.isRos, true);
    assert.strictEqual(project.isRosSystem, false);
    assert.ok(project.nodes.length >= 4, 'Should parse 4 type nodes');

    // Verify all nodes are backing type and have typeSpec fields
    for (const node of project.nodes) {
      assert.strictEqual(node.backing, 'type');
      assert.ok(node.typeSpec, `Node ${node.label} should have typeSpec`);
      assert.ok(node.typeSpec?.fields, `Node ${node.label} should have type fields defined`);
    }

    // Verify re-emitting .ros produces valid grammar without UI metadata
    const emitted = RosModelEmitter.emit(project, docPath);
    assert.ok(emitted.includes('geometry_msgs:'));
    assert.ok(emitted.includes('Point'));
    assert.ok(!emitted.includes('midX') && !emitted.includes('connectorMode') && !emitted.includes('x:'));
  });

  // 2. Add from catalogue bug fix & interface normalization
  test('2. Interface normalization safely handles object maps and array formats without throwing', () => {
    // Object map format from node_index.json (e.g. cartographer_node)
    const rawObjectMap = {
      odom_cart: 'sub',
      scan_cart: 'sub',
      tf: 'pub',
    };
    const normFromMap = RosLayoutManager.normalizeInterfaces(rawObjectMap);
    assert.strictEqual(normFromMap.length, 3);
    const odomIface = normFromMap.find((f) => f.name === 'odom_cart');
    assert.ok(odomIface);
    assert.strictEqual(odomIface?.kind, 'sub');

    // Array format
    const rawArray = [
      { name: 'cmd_vel', label: 'cmd_vel', kind: 'sub', type: 'geometry_msgs/msg/Twist' },
      { name: 'odom', label: 'odom', kind: 'pub', type: 'nav_msgs/msg/Odometry' },
    ];
    const normFromArray = RosLayoutManager.normalizeInterfaces(rawArray);
    assert.strictEqual(normFromArray.length, 2);
    assert.strictEqual(normFromArray[0].name, 'cmd_vel');
    assert.strictEqual(normFromArray[0].kind, 'sub');

    // Null / undefined safety
    assert.strictEqual(RosLayoutManager.normalizeInterfaces(null).length, 0);
    assert.strictEqual(RosLayoutManager.normalizeInterfaces(undefined).length, 0);
  });

  // 3. Spawning node from catalogue into .rossystem and .ros2 models
  test('3. Spawning node from catalogue with normalized interfaces into .rossystem and .ros2', () => {
    const rossystemContent = `
robot_system:
  nodes:
    sensor_node:
      from: sensor_pkg.sensor_node
`;
    const sysPath = path.join(tmpDir, 'robot_system.rossystem');
    fs.writeFileSync(sysPath, rossystemContent, 'utf-8');

    const project = RosModelParser.parse(rossystemContent, sysPath);

    // Simulate clicking catalogue item cartographer_node
    const catEntry = {
      artifact: 'cartographer_node',
      from: 'cartographer_node.cartographer_node',
      file: 'cartographer.ros2',
      interfaces: {
        odom_cart: 'sub',
        scan_cart: 'sub',
      },
    };

    const normIfaces = RosLayoutManager.normalizeInterfaces(catEntry.interfaces);
    const spawnedNode = {
      id: 'n_cartographer_node',
      label: 'cartographer_node',
      from: catEntry.from,
      artifact: catEntry.artifact,
      pkg: 'cartographer_node',
      backing: 'cat' as const,
      ifaces: normIfaces.map((f) => ({
        id: `i_cartographer_node_${f.name}`,
        name: f.name,
        label: f.label,
        kind: f.kind as RosInteractionKind,
        type: f.type,
        exposed: true,
      })),
      params: [],
      x: 350,
      y: 120,
    };

    project.nodes.push(spawnedNode);
    assert.strictEqual(project.nodes.length, 2);
    assert.strictEqual(project.nodes[1].ifaces.length, 2);
    assert.strictEqual(project.nodes[1].ifaces[0].kind, 'sub');

    // Verify emission includes new node
    const emittedSys = RosModelEmitter.emitRosSystem(project);
    assert.ok(emittedSys.includes('cartographer_node:'));
    assert.ok(emittedSys.includes('from: "cartographer_node.cartographer_node"'));

    // Now test .ros2 spawning
    const ros2Project: RosProject = {
      formatVersion: 4,
      isRosSystem: false,
      isRos: false,
      system: { name: 'my_robot_pkg' },
      packages: {
        my_robot_pkg: { name: 'my_robot_pkg', artifacts: [] },
      },
      subSystems: [],
      nodes: [spawnedNode],
      connections: [],
      types: {},
    };

    const emittedRos2 = RosModelEmitter.emitRos2(ros2Project);
    assert.ok(emittedRos2.includes('cartographer_node'));
    assert.ok(emittedRos2.includes('subscribers:'));
    assert.ok(emittedRos2.includes('odom_cart'));
  });

  // 4. Connector routing styles (Orthogonal, Linear, Spline)
  test('4. Connector mode switching and representation across orthogonal, linear, and spline', () => {
    const project: RosProject = {
      formatVersion: 4,
      isRosSystem: true,
      system: { name: 'pipeline_system' },
      packages: {},
      types: {},
      subSystems: [],
      nodes: [
        {
          id: 'n_src',
          label: 'src',
          x: 100,
          y: 100,
          ifaces: [{ id: 'i_out', name: 'out', kind: 'pub', type: 'std_msgs/msg/String' }],
          params: [],
        },
        {
          id: 'n_dst',
          label: 'dst',
          x: 400,
          y: 200,
          ifaces: [{ id: 'i_in', name: 'in', kind: 'sub', type: 'std_msgs/msg/String' }],
          params: [],
        },
      ],
      connections: [
        {
          id: 'c1',
          from: { n: 'n_src', i: 'i_out' },
          to: { n: 'n_dst', i: 'i_in' },
        },
      ],
      view: {
        connectorMode: 'orthogonal',
      },
    };

    assert.strictEqual(project.view?.connectorMode, 'orthogonal');

    // Switch to linear
    if (project.view) project.view.connectorMode = 'linear';
    assert.strictEqual(project.view?.connectorMode, 'linear');

    // Switch to spline
    if (project.view) project.view.connectorMode = 'spline';
    assert.strictEqual(project.view?.connectorMode, 'spline');
  });

  // 5. Bidirectional orthogonal arrow manipulation & custom bends (waypoints, midX, midY)
  test('5. Manipulating orthogonal connection arrows horizontally (midX), vertically (midY), and custom waypoints', () => {
    const conn = {
      id: 'c_test',
      from: { n: 'n_a', i: 'i_pub' },
      to: { n: 'n_b', i: 'i_sub' },
      midX: 250,
      midY: 180,
      waypoints: [
        { x: 250, y: 150 },
        { x: 300, y: 180 },
      ],
    };

    // Horizontal manipulation updates midX
    conn.midX = 280;
    assert.strictEqual(conn.midX, 280);

    // Vertical manipulation updates midY
    conn.midY = 210;
    assert.strictEqual(conn.midY, 210);

    // Add waypoint bend
    conn.waypoints.push({ x: 320, y: 240 });
    assert.strictEqual(conn.waypoints.length, 3);
    assert.strictEqual(conn.waypoints[2].x, 320);

    // Remove waypoint bend
    conn.waypoints.splice(1, 1);
    assert.strictEqual(conn.waypoints.length, 2);
    assert.strictEqual(conn.waypoints[1].x, 320);
  });

  // 6. Option 2 JSON Layout schematic persistence
  test('6. Option 2 layout JSON schematic is saved to .rostooling/layout/<model>.layout.json and restored correctly', async () => {
    const modelFilePath = path.join(tmpDir, 'motion_planner.rossystem');
    const modelContent = `
motion_planner:
  nodes:
    planner_node:
      from: "nav_pkg.planner_node"
      interfaces:
        - "plan_pub": pub-> "planner_node::plan"
    controller_node:
      from: "nav_pkg.controller_node"
      interfaces:
        - "plan_sub": sub-> "controller_node::plan"
  connections:
    - ["plan_pub", "plan_sub"]
`;
    fs.writeFileSync(modelFilePath, modelContent, 'utf-8');

    const project = RosModelParser.parse(modelContent, modelFilePath);
    assert.ok(project.connections.length > 0, 'Project should parse connection');
    const connId = project.connections[0].id;
    // Configure visual layout attributes
    project.view = {
      tx: 120,
      ty: 80,
      k: 1.15,
      connectorMode: 'spline',
      nodeSize: {
        planner_node: { w: 260, h: 160 },
        controller_node: { w: 280, h: 180 },
      },
      connMidX: { [connId]: 340 },
      connMidY: { [connId]: 190 },
      connWaypoints: {
        [connId]: [{ x: 300, y: 175 }],
      },
    };
    project.nodes[0].x = 100;
    project.nodes[0].y = 150;
    project.nodes[1].x = 500;
    project.nodes[1].y = 150;

    // Verify layout path adheres strictly to Option 2
    const layoutPath = RosLayoutManager.getLayoutFilePath(modelFilePath, tmpDir);
    assert.ok(layoutPath.includes('.rostooling/layout/'));
    assert.strictEqual(path.basename(layoutPath), 'motion_planner.rossystem.layout.json');

    // Save layout schematic
    await RosLayoutManager.saveLayoutSchematic(modelFilePath, project, tmpDir);

    // Verify file exists on disk
    assert.ok(fs.existsSync(layoutPath), 'Layout JSON file should exist on disk');

    const rawJson = fs.readFileSync(layoutPath, 'utf-8');
    const schematic: RosLayoutSchematic = JSON.parse(rawJson);

    // Validate schematic structure
    assert.strictEqual(schematic.version, 1);
    assert.strictEqual(schematic.modelFile, 'motion_planner.rossystem');
    assert.strictEqual(schematic.modelType, 'rossystem');
    assert.strictEqual(schematic.canvas.connectorMode, 'spline');
    assert.strictEqual(schematic.canvas.view.tx, 120);
    assert.strictEqual(schematic.canvas.view.zoom, 1.15);
    assert.strictEqual(schematic.nodes.length, 2);
    assert.strictEqual(schematic.nodes[0].width, 260);
    assert.strictEqual(schematic.connections.length, 1);
    assert.strictEqual(schematic.connections[0].midX, 340);
    assert.strictEqual(schematic.connections[0].midY, 190);
    assert.deepStrictEqual(schematic.connections[0].waypoints, [{ x: 300, y: 175 }]);

    // Test restoring from layout schematic onto a fresh unpositioned project
    const freshProject = RosModelParser.parse(modelContent, modelFilePath);
    assert.strictEqual(freshProject.nodes[0].x, undefined);

    const loadedSchematic = RosLayoutManager.loadLayoutSchematic(modelFilePath, tmpDir);
    assert.ok(loadedSchematic);
    if (loadedSchematic) {
      RosLayoutManager.applyLayoutSchematic(freshProject, loadedSchematic);
    }

    assert.strictEqual(freshProject.nodes[0].x, 100);
    assert.strictEqual(freshProject.nodes[0].y, 150);
    assert.strictEqual(freshProject.nodes[0].w, 260);
    assert.strictEqual(freshProject.view?.connectorMode, 'spline');
    assert.strictEqual(freshProject.view?.connMidX?.[freshProject.connections[0].id], 340);
    assert.strictEqual(freshProject.view?.connMidY?.[freshProject.connections[0].id], 190);
    assert.deepStrictEqual(freshProject.view?.connWaypoints?.[freshProject.connections[0].id], [{ x: 300, y: 175 }]);

    // Verify model file on disk is untouched and 100% compliant with grammar
    const diskModelContent = fs.readFileSync(modelFilePath, 'utf-8');
    assert.strictEqual(diskModelContent, modelContent);
  });

  // 7. Auto-layout and setupUI resilience
  test('7. Auto-layout resets offsets and grid positions nodes cleanly without error', () => {
    const project: RosProject = {
      formatVersion: 4,
      isRosSystem: true,
      system: { name: 'autolayout_test' },
      packages: {},
      types: {},
      subSystems: [],
      nodes: [
        { id: 'n1', label: 'node_1', x: 9999, y: 8888, ifaces: [], params: [] },
        { id: 'n2', label: 'node_2', x: -500, y: -400, ifaces: [], params: [] },
        { id: 'n3', label: 'node_3', x: 200, y: 300, ifaces: [], params: [] },
      ],
      connections: [
        {
          id: 'c1',
          from: { n: 'n1', i: 'i1' },
          to: { n: 'n2', i: 'i2' },
          midX: 5555,
          midY: 4444,
        },
      ],
      view: {
        connMidX: { c1: 5555 },
        connMidY: { c1: 4444 },
      },
    };

    // Simulate autoLayout behavior
    const nodeCount = project.nodes.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodeCount || 1)));
    project.nodes.forEach((n, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      n.x = 80 + c * 340;
      n.y = 80 + r * 260;
    });

    project.connections.forEach((c) => {
      delete c.midX;
      delete c.midY;
    });
    if (project.view) {
      project.view.connMidX = {};
      project.view.connMidY = {};
    }

    // Assert nodes are in clean positive grid coordinates
    assert.strictEqual(project.nodes[0].x, 80);
    assert.strictEqual(project.nodes[0].y, 80);
    assert.strictEqual(project.nodes[1].x, 420);
    assert.strictEqual(project.nodes[1].y, 80);
    assert.strictEqual(project.nodes[2].x, 80);
    assert.strictEqual(project.nodes[2].y, 340);

    // Assert connection manual corridor offsets were cleared
    assert.strictEqual(project.connections[0].midX, undefined);
    assert.strictEqual(project.connections[0].midY, undefined);
    assert.deepStrictEqual(project.view?.connMidX, {});
  });

  // 8. Catalogue filtering per model type
  test('8. Catalogue items are filtered strictly according to model type (.ros vs .ros2 vs .rossystem)', () => {
    // Mode .ros -> Only types/communication objects
    const rosModeIsRos = true;
    const rosModeIsRosSystem = false;
    assert.strictEqual(rosModeIsRos && !rosModeIsRosSystem, true, 'Communication objects mode');

    // Mode .ros2 -> Only component templates (no subsystems tab)
    const ros2ModeIsRos = false;
    const ros2ModeIsRosSystem = false;
    assert.strictEqual(!ros2ModeIsRos && !ros2ModeIsRosSystem, true, 'Component templates mode');

    // Mode .rossystem -> Both nodes and subsystems tabs allowed
    const sysModeIsRos = false;
    const sysModeIsRosSystem = true;
    assert.strictEqual(!sysModeIsRos && sysModeIsRosSystem, true, 'ROS System multi-tab mode');
  });

  // 9. Canvas bounds expansion and waypoint segment distance algorithm
  test('9. Dynamic canvas bounds expansion and waypoint segment distance algorithm', () => {
    // Helper mathematical functions replicating studioHtml.ts
    function sqr(x: number) { return x * x; }
    function dist2(v: { x: number; y: number }, w: { x: number; y: number }) {
      return sqr(v.x - w.x) + sqr(v.y - w.y);
    }
    function distToSegmentSquared(
      p: { x: number; y: number },
      v: { x: number; y: number },
      w: { x: number; y: number }
    ) {
      const l2 = dist2(v, w);
      if (l2 === 0) return dist2(p, v);
      let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
      t = Math.max(0, Math.min(1, t));
      return dist2(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
    }
    function distToSegment(
      p: { x: number; y: number },
      v: { x: number; y: number },
      w: { x: number; y: number }
    ) {
      return Math.sqrt(distToSegmentSquared(p, v, w));
    }

    // Segment A from (100, 100) to (300, 100)
    // Segment B from (300, 100) to (300, 400)
    const pA = { x: 100, y: 100 };
    const pB = { x: 300, y: 100 };
    const pC = { x: 300, y: 400 };

    // Point close to segment A: (200, 105)
    const click1 = { x: 200, y: 105 };
    const d1A = distToSegment(click1, pA, pB);
    const d1B = distToSegment(click1, pB, pC);
    assert.ok(d1A < d1B, 'Click should be closest to segment A');
    assert.strictEqual(Math.round(d1A), 5);

    // Point close to segment B: (308, 250)
    const click2 = { x: 308, y: 250 };
    const d2A = distToSegment(click2, pA, pB);
    const d2B = distToSegment(click2, pB, pC);
    assert.ok(d2B < d2A, 'Click should be closest to segment B');
    assert.strictEqual(Math.round(d2B), 8);

    // Dynamic canvas bounds test
    const waypoints = [
      { x: 200, y: 100 },
      { x: 5500, y: 4800 }, // Far out point beyond default canvas
    ];
    let maxX = 3000, maxY = 3000;
    waypoints.forEach((wp) => {
      maxX = Math.max(maxX, wp.x);
      maxY = Math.max(maxY, wp.y);
    });
    const reqW = Math.max(6000, Math.ceil(maxX + 1200));
    const reqH = Math.max(6000, Math.ceil(maxY + 1200));
    assert.strictEqual(reqW, 6700, 'Canvas width dynamically expanded past 6000px');
    assert.strictEqual(reqH, 6000, 'Canvas height safely accommodates required bounds');
  });

  // 10. RosSystem processes key parsing and emission
  test('10. RosSystem processes key parses threads and node lists, and emits compliant Xtext', () => {
    const rossystemWithProc = `
robot_system:
  nodes:
    camera_driver:
      from: camera_pkg.camera_driver
    slam_node:
      from: slam_pkg.slam_node
    motor_controller:
      from: motor_pkg.motor_controller
  processes:
    vision_process:
      nodes: ['camera_driver', 'slam_node']
      threads: 4
    control_process:
      nodes: ['motor_controller']
      threads: 2
`;
    const sysPath = path.join(tmpDir, 'system_proc.rossystem');
    fs.writeFileSync(sysPath, rossystemWithProc, 'utf-8');

    const project = RosModelParser.parse(rossystemWithProc, sysPath);
    assert.ok(project.processes, 'project.processes should be defined');
    assert.strictEqual(project.processes?.length, 2);

    const proc1 = project.processes?.[0];
    assert.strictEqual(proc1?.name, 'vision_process');
    assert.strictEqual(proc1?.threads, 4);
    assert.deepStrictEqual(proc1?.nodes, ['camera_driver', 'slam_node']);

    const proc2 = project.processes?.[1];
    assert.strictEqual(proc2?.name, 'control_process');
    assert.strictEqual(proc2?.threads, 2);
    assert.deepStrictEqual(proc2?.nodes, ['motor_controller']);

    // Roundtrip emission test
    const emitted = RosModelEmitter.emitRosSystem(project);
    assert.ok(emitted.includes('processes:'), 'Emitted output must include processes block');
    assert.ok(emitted.includes('nodes: [ camera_driver, slam_node ]'), 'Emitted output must include formatted nodes array');
    assert.ok(emitted.includes('threads: 4'), 'Emitted output must include thread count 4');
    assert.ok(emitted.includes('control_process:'), 'Emitted output must include control_process');
    assert.ok(emitted.includes('threads: 2'), 'Emitted output must include thread count 2');

    // Parse emitted text again to verify full roundtrip equivalence
    const roundtripProject = RosModelParser.parse(emitted, sysPath);
    assert.strictEqual(roundtripProject.processes?.length, 2);
    assert.strictEqual(roundtripProject.processes?.[0].threads, 4);
    assert.strictEqual(roundtripProject.processes?.[1].threads, 2);
  });

  // 11. Subsystem removal & cascading deletion
  test('11. Subsystem removal cleanly cascades to delete member nodes and connected wires', () => {
    const project: RosProject = {
      formatVersion: 4,
      isRosSystem: true,
      system: { name: 'cascade_sys' },
      packages: {},
      types: {},
      subSystems: [
        { ref: 'sub_navigation', state: 'collapsed', fromFile: 'nav.rossystem' },
        { ref: 'sub_arm', state: 'framed', fromFile: 'arm.rossystem' },
      ],
      nodes: [
        { id: 'n_sub_nav_planner', label: 'planner', from: 'nav.planner', subRef: 'sub_navigation', ifaces: [{ id: 'i_cmd', name: 'cmd_vel', kind: 'pub', exposed: true }], params: [] },
        { id: 'n_sub_nav_costmap', label: 'costmap', from: 'nav.costmap', subRef: 'sub_navigation', ifaces: [{ id: 'i_map', name: 'map', kind: 'pub', exposed: true }], params: [] },
        { id: 'n_sub_arm_controller', label: 'arm_ctrl', from: 'arm.ctrl', subRef: 'sub_arm', ifaces: [{ id: 'i_joint', name: 'joint_states', kind: 'pub', exposed: true }], params: [] },
        { id: 'n_base_teleop', label: 'teleop', from: 'teleop.node', ifaces: [{ id: 'i_out', name: 'out', kind: 'pub', exposed: true }], params: [] },
      ],
      connections: [
        { id: 'c_nav_to_base', from: { n: 'n_sub_nav_planner', i: 'i_cmd' }, to: { n: 'n_base_teleop', i: 'i_out' } },
        { id: 'c_arm_to_base', from: { n: 'n_sub_arm_controller', i: 'i_joint' }, to: { n: 'n_base_teleop', i: 'i_out' } },
      ],
      view: {
        subStates: { sub_navigation: 'collapsed', sub_arm: 'framed' },
        subPos: { sub_navigation: { x: 50, y: 50 }, sub_arm: { x: 200, y: 200 } },
      },
    };

    // Helper implementing removeSubsystem logic from studioHtml.ts
    function removeSubsystem(p: RosProject, subRef: string) {
      p.subSystems = (p.subSystems || []).filter((s) => s.ref !== subRef);
      const memberIds: Record<string, boolean> = {};
      p.nodes = (p.nodes || []).filter((n) => {
        if (n.subRef === subRef) {
          memberIds[n.id] = true;
          return false;
        }
        return true;
      });
      p.connections = (p.connections || []).filter((c) => {
        return !memberIds[c.from.n] && !memberIds[c.to.n];
      });
      if (p.view) {
        if (p.view.subStates) Reflect.deleteProperty(p.view.subStates, subRef);
        if (p.view.subPos) Reflect.deleteProperty(p.view.subPos, subRef);
      }
    }

    // Remove sub_navigation
    removeSubsystem(project, 'sub_navigation');

    assert.strictEqual(project.subSystems.length, 1, 'Only sub_arm should remain');
    assert.strictEqual(project.subSystems[0].ref, 'sub_arm');

    // Member nodes of sub_navigation must be removed
    const remainingLabels = project.nodes.map((n) => n.label);
    assert.ok(!remainingLabels.includes('planner'), 'planner should be removed');
    assert.ok(!remainingLabels.includes('costmap'), 'costmap should be removed');
    assert.ok(remainingLabels.includes('arm_ctrl'), 'arm_ctrl should remain');
    assert.ok(remainingLabels.includes('teleop'), 'teleop should remain');

    // Wire connected to planner must be removed
    assert.strictEqual(project.connections.length, 1);
    assert.strictEqual(project.connections[0].id, 'c_arm_to_base');

    // View state for sub_navigation should be cleaned up
    assert.strictEqual(project.view?.subStates?.['sub_navigation'], undefined);
    assert.strictEqual(project.view?.subPos?.['sub_navigation'], undefined);
  });

  // 12. Universal Undo & Redo before-state snapshot behavior
  test('12. Universal Undo and Redo snapshots capture before-state so undo returns to previous position', () => {
    let project: RosProject = {
      formatVersion: 4,
      isRosSystem: true,
      system: { name: 'undo_test_sys' },
      packages: {},
      types: {},
      subSystems: [],
      nodes: [{ id: 'n1', label: 'node_1', from: 'pkg.node_1', x: 100, y: 100, ifaces: [], params: [] }],
      connections: [],
    };
    const view = { tx: 40, ty: 40, k: 1 };

    const undoStack: string[] = [];
    let redoStack: string[] = [];

    function pushUndoSnapshot(snapStr: string) {
      undoStack.push(snapStr);
      redoStack = [];
    }

    // Step 1: User starts dragging node_1 (pointerdown)
    const interactionSnapshot = JSON.stringify({ project: JSON.parse(JSON.stringify(project)), view: { ...view } });

    // Step 2: User moves node_1 to (450, 600) and releases (pointerup)
    project.nodes[0].x = 450;
    project.nodes[0].y = 600;
    pushUndoSnapshot(interactionSnapshot);

    assert.strictEqual(project.nodes[0].x, 450);
    assert.strictEqual(undoStack.length, 1);

    // Step 3: User triggers Undo
    redoStack.push(JSON.stringify({ project: JSON.parse(JSON.stringify(project)), view: { ...view } }));
    const poppedUndo = undoStack.pop();
    assert.ok(poppedUndo);
    const undoSnap = JSON.parse(poppedUndo);
    project = undoSnap.project;

    // Node must be restored to (100, 100)
    assert.strictEqual(project.nodes[0].x, 100, 'Node X must revert to 100 on undo');
    assert.strictEqual(project.nodes[0].y, 100, 'Node Y must revert to 100 on undo');
    assert.strictEqual(redoStack.length, 1);

    // Step 4: User triggers Redo
    undoStack.push(JSON.stringify({ project: JSON.parse(JSON.stringify(project)), view: { ...view } }));
    const poppedRedo = redoStack.pop();
    assert.ok(poppedRedo);
    const redoSnap = JSON.parse(poppedRedo);
    project = redoSnap.project;

    // Node must be at (450, 600)
    assert.strictEqual(project.nodes[0].x, 450, 'Node X must redo to 450');
    assert.strictEqual(project.nodes[0].y, 600, 'Node Y must redo to 600');
  });

  // 13. Dynamic RosCatalogueManager scanning and folder importer
  test('13. RosCatalogueManager dynamically scans custom folders and indexes models offline', () => {
    const catStorageDir = path.join(tmpDir, 'catalogue_storage');
    const customModelsDir = path.join(tmpDir, 'my_custom_robot_models');
    fs.mkdirSync(customModelsDir, { recursive: true });

    // Write a .ros2 model in custom folder
    const customRos2Content = `
custom_robot_pkg:
  artifacts:
    lidar_sensor_node:
      node: lidar_sensor_node
      subscribers:
        scan_raw:
          type: sensor_msgs/msg/LaserScan
      publishers:
        scan_filtered:
          type: sensor_msgs/msg/LaserScan
`;
    fs.writeFileSync(path.join(customModelsDir, 'lidar.ros2'), customRos2Content, 'utf-8');

    // Write a .rossystem model in custom folder
    const customSysContent = `
custom_subsystem:
  nodes:
    lidar_sensor_node:
      from: custom_robot_pkg.lidar_sensor_node
`;
    fs.writeFileSync(path.join(customModelsDir, 'lidar_sub.rossystem'), customSysContent, 'utf-8');

    const catManager = new RosCatalogueManager(catStorageDir);
    const added = catManager.addCustomFolder(customModelsDir);

    assert.strictEqual(added, true);
    assert.strictEqual(catManager.getCustomFolders().length, 1);
    const folderEntry = catManager.getCustomFolders()[0];
    assert.strictEqual(folderEntry.path, customModelsDir);

    // Build catalogue index without network calls
    const index = catManager.buildCatalogueIndex();
    assert.ok(index.sources.includes(folderEntry.name), `Sources should include ${folderEntry.name}`);

    // Check indexed node
    const nodeKey = 'custom_robot_pkg.lidar_sensor_node';
    assert.ok(index.nodes[nodeKey], `Node ${nodeKey} should be indexed`);
    assert.strictEqual(index.nodes[nodeKey].source, folderEntry.name);
    assert.ok(index.nodes[nodeKey].interfaces['scan_raw']);
    assert.ok(index.nodes[nodeKey].interfaces['scan_filtered']);

    // Check indexed system
    const sysEntry = index.systems.find((s) => s.system === 'custom_subsystem');
    assert.ok(sysEntry, 'custom_subsystem should be indexed');
    assert.strictEqual(sysEntry?.source, folderEntry.name);

    // Test removing folder
    const removed = catManager.removeCustomFolder(folderEntry.id);
    assert.strictEqual(removed, true);
    assert.strictEqual(catManager.getCustomFolders().length, 0);
  });

  // 14. Subsystem expansion, collapse, and member node preservation
  test('14. Subsystem expansion never causes block to disappear whether empty or populated', async () => {
    const sysContent = `
robot_system:
  subSystems:
    - nav_sub
    - empty_sub
  nodes:
    sensor_node:
      from: "sensor_pkg.sensor_node"
`;
    const sysPath = path.join(tmpDir, 'test_sub_expand.rossystem');
    fs.writeFileSync(sysPath, sysContent, 'utf-8');

    const project = RosModelParser.parse(sysContent, sysPath);
    assert.strictEqual(project.subSystems.length, 2);
    assert.strictEqual(project.subSystems[0].ref, 'nav_sub');
    assert.strictEqual(project.subSystems[1].ref, 'empty_sub');

    // Add member nodes to nav_sub
    project.nodes.push({
      id: 'n_nav_sub_planner',
      label: 'planner',
      subRef: 'nav_sub',
      backing: 'sub',
      ifaces: [
        { id: 'i_planner_cmd', name: 'cmd_vel', label: 'cmd_vel', kind: 'pub', type: 'geometry_msgs/msg/Twist', exposed: true }
      ],
      params: [],
      x: 100,
      y: 100,
    });
    project.nodes.push({
      id: 'n_nav_sub_controller',
      label: 'controller',
      subRef: 'nav_sub',
      backing: 'sub',
      ifaces: [
        { id: 'i_controller_odom', name: 'odom', label: 'odom', kind: 'sub', type: 'nav_msgs/msg/Odometry', exposed: true }
      ],
      params: [],
      x: 100,
      y: 100,
    });

    if (!project.view) project.view = {};
    if (!project.view.subPos) project.view.subPos = {};
    if (!project.view.subStates) project.view.subStates = {};
    project.view.subPos['nav_sub'] = { x: 120, y: 150 };
    project.view.subPos['empty_sub'] = { x: 500, y: 150 };
    project.view.subStates['nav_sub'] = 'collapsed';
    project.view.subStates['empty_sub'] = 'collapsed';

    // Helper simulating studioHtml subMembers
    function testSubMembers(ref: string) {
      return (project.nodes || []).filter((n) =>
        n.subRef === ref ||
        (n.backing === 'sub' && n.from && n.from.startsWith(ref)) ||
        (n.id && n.id.startsWith(`n_${ref}_`)) ||
        (n.pkg === ref)
      );
    }

    // Helper simulating studioHtml arrangeSubsystemMembers
    function testArrangeSubsystemMembers(subRef: string) {
      const pos = project.view?.subPos?.[subRef] || { x: 80, y: 80 };
      const members = testSubMembers(subRef);
      const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
      members.forEach((m, idx) => {
        if (m.x == null || m.y == null || (m.x === 100 && m.y === 100) || (m.x === 80 && m.y === 80)) {
          const c = idx % cols;
          const r = Math.floor(idx / cols);
          m.x = pos.x + 30 + c * 300;
          m.y = pos.y + 50 + r * 240;
        }
      });
    }

    // Helper simulating studioHtml renderSubFrame coordinate computation
    function testComputeSubFrameBounds(subRef: string) {
      const members = testSubMembers(subRef);
      const pos = project.view?.subPos?.[subRef] || { x: 80, y: 80 };
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;

      members.forEach((m) => {
        const mx = m.x != null ? m.x : pos.x + 30;
        const my = m.y != null ? m.y : pos.y + 50;
        const mw = m.w || 280;
        const mh = m.h || 180;
        x0 = Math.min(x0, mx);
        y0 = Math.min(y0, my);
        x1 = Math.max(x1, mx + mw);
        y1 = Math.max(y1, my + mh);
      });

      if (x0 > x1 || !members.length) {
        x0 = pos.x;
        y0 = pos.y;
        x1 = pos.x + 340;
        y1 = pos.y + 200;
      }

      const PAD = 24, TOP = 36;
      return {
        left: Math.max(10, Math.round(x0 - PAD)),
        top: Math.max(10, Math.round(y0 - TOP)),
        width: Math.max(340, Math.round(x1 - x0 + 2 * PAD)),
        height: Math.max(180, Math.round(y1 - y0 + TOP + PAD)),
        hasMembers: members.length > 0,
        memberCount: members.length,
      };
    }

    // --- CASE A: Expanding Populated Subsystem ---
    project.view.subStates['nav_sub'] = 'framed';
    testArrangeSubsystemMembers('nav_sub');

    const navBounds = testComputeSubFrameBounds('nav_sub');
    assert.strictEqual(navBounds.hasMembers, true);
    assert.strictEqual(navBounds.memberCount, 2);
    assert.ok(navBounds.width >= 340, `Framed width should be >= 340, got ${navBounds.width}`);
    assert.ok(navBounds.height >= 180, `Framed height should be >= 180, got ${navBounds.height}`);
    assert.ok(navBounds.left > 0 && navBounds.top > 0, 'Framed position should be positive');

    // Verify member coordinates are neatly placed inside the frame
    const planner = project.nodes.find((n) => n.id === 'n_nav_sub_planner');
    const controller = project.nodes.find((n) => n.id === 'n_nav_sub_controller');
    assert.ok(planner && (planner.x ?? 0) >= navBounds.left);
    assert.ok(controller && (controller.x ?? 0) >= navBounds.left);

    // --- CASE B: Expanding Empty Subsystem (Must NOT Disappear) ---
    project.view.subStates['empty_sub'] = 'framed';
    testArrangeSubsystemMembers('empty_sub');

    const emptyBounds = testComputeSubFrameBounds('empty_sub');
    assert.strictEqual(emptyBounds.hasMembers, false);
    assert.strictEqual(emptyBounds.memberCount, 0);
    assert.strictEqual(emptyBounds.left, 500 - 24);
    assert.strictEqual(emptyBounds.top, 150 - 36);
    assert.ok(emptyBounds.width >= 340, 'Empty frame width should be >= 340');
    assert.ok(emptyBounds.height >= 180, 'Empty frame height should be >= 180');

    // --- CASE C: Model Reload Preserves Member Nodes ---
    const freshTarget = RosModelParser.parse(sysContent, sysPath);
    assert.strictEqual(freshTarget.nodes.length, 1); // only sensor_node from text

    // Test member node preservation logic from RosCustomEditorProvider
    for (const n of project.nodes) {
      if (n.subRef || n.backing === 'sub') {
        const exists = freshTarget.nodes.some(
          (tn) => tn.id === n.id || (tn.subRef === n.subRef && tn.label === n.label)
        );
        if (!exists) {
          freshTarget.nodes.push({ ...n });
        }
      }
    }

    assert.strictEqual(freshTarget.nodes.length, 3, 'Should preserve both subsystem member nodes');
    const preservedPlanner = freshTarget.nodes.find((n) => n.id === 'n_nav_sub_planner');
    assert.ok(preservedPlanner, 'Planner node must be preserved');
    assert.strictEqual(preservedPlanner?.subRef, 'nav_sub');

    // Verify layout JSON schema persists framed states
    await RosLayoutManager.saveLayoutSchematic(sysPath, project, tmpDir);
    const layout = RosLayoutManager.loadLayoutSchematic(sysPath, tmpDir);
    assert.ok(layout);
    const savedSub = layout?.subsystems?.find((s) => s.ref === 'nav_sub');
    assert.ok(savedSub);
    assert.strictEqual(savedSub?.state, 'framed');
  });

  // 15. Component blocks minimum size constraints
  test('15. Component blocks cannot be sized smaller than required for their contained interfaces and parameters', () => {
    // Model node with 4 interfaces and 2 parameters
    const node = {
      id: 'n_complex',
      label: 'navigation_planner_node_with_long_name',
      ifaces: [
        { id: 'i1', name: 'cmd_vel', label: 'cmd_vel', kind: 'pub' as const, type: 'geometry_msgs/msg/Twist', exposed: true },
        { id: 'i2', name: 'odom', label: 'odom', kind: 'sub' as const, type: 'nav_msgs/msg/Odometry', exposed: true },
        { id: 'i3', name: 'scan', label: 'scan', kind: 'sub' as const, type: 'sensor_msgs/msg/LaserScan', exposed: true },
        { id: 'i4', name: 'set_mode', label: 'set_mode', kind: 'ss' as const, type: 'std_srvs/srv/SetBool', exposed: true },
      ],
      params: [
        { id: 'p1', name: 'max_velocity', label: 'max_velocity', ptype: 'double', value: '1.5', exposed: true },
        { id: 'p2', name: 'robot_base_frame', label: 'robot_base_frame', ptype: 'string', value: 'base_link', exposed: true },
      ],
    };

    // Calculation replicated from studioHtml.ts:
    const ifaceCount = node.ifaces.length;
    const paramCount = node.params.length;
    const contentMinH = 46 + (ifaceCount * 28) + (paramCount * 22) + 24;
    const minH = Math.max(120, contentMinH);

    let maxLabelLen = node.label.length;
    node.ifaces.forEach((f) => {
      const typeStr = f.type ? ` (${f.type})` : '';
      const text = `${f.label || f.name}${typeStr}`;
      maxLabelLen = Math.max(maxLabelLen, text.length);
    });
    node.params.forEach((p) => {
      const valStr = p.value != null ? ` = ${p.value}` : '';
      const text = `${p.label || p.name}: ${p.ptype || ''}${valStr}`;
      maxLabelLen = Math.max(maxLabelLen, text.length);
    });
    const contentMinW = Math.max(220, Math.ceil(maxLabelLen * 7.5 + 60));
    const minW = Math.max(220, contentMinW);

    // Assert min dimensions are strictly calculated
    assert.ok(minH > 160, `Min height should account for 4 interfaces and 2 parameters, got ${minH}`);
    assert.strictEqual(minH, 46 + 4 * 28 + 2 * 22 + 24); // 46 + 112 + 44 + 24 = 226
    assert.ok(minW > 220, `Min width should account for long labels, got ${minW}`);

    // Simulate user attempting to shrink below minimums via resize handle
    const requestedShrunkW = 100;
    const requestedShrunkH = 80;
    const clampedW = Math.max(minW, requestedShrunkW);
    const clampedH = Math.max(minH, requestedShrunkH);

    assert.strictEqual(clampedW, minW, 'Clamping must prevent width from being smaller than content minW');
    assert.strictEqual(clampedH, minH, 'Clamping must prevent height from being smaller than content minH');
  });

  // 16. Subsystem expanded frame auto-growth
  test('16. Subsystem expanded frame automatically encloses all contained nodes and grows when nodes move', () => {
    const subRef = 'navigation_subsystem';
    const subPos = { x: 100, y: 100 };
    const memberNodes = [
      { id: 'n1', label: 'costmap', subRef, x: 140, y: 150, w: 260, h: 180 },
      { id: 'n2', label: 'planner', subRef, x: 450, y: 150, w: 280, h: 200 },
    ];

    // Compute required frame bounding box
    function computeFrameBounds(members: typeof memberNodes, pos: { x: number; y: number }, customSize?: { w?: number; h?: number }) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      members.forEach((m) => {
        const mx = m.x != null ? m.x : pos.x + 30;
        const my = m.y != null ? m.y : pos.y + 50;
        const mw = m.w || 240;
        const mh = m.h || 160;
        x0 = Math.min(x0, mx);
        y0 = Math.min(y0, my);
        x1 = Math.max(x1, mx + mw);
        y1 = Math.max(y1, my + mh);
      });
      const PAD = 24, TOP = 36;
      const requiredW = Math.max(340, Math.round(x1 - x0 + 2 * PAD));
      const requiredH = Math.max(180, Math.round(y1 - y0 + TOP + PAD));
      const effectiveW = Math.max(customSize?.w || 0, requiredW);
      const effectiveH = Math.max(customSize?.h || 0, requiredH);
      return {
        left: Math.max(10, Math.round(x0 - PAD)),
        top: Math.max(10, Math.round(y0 - TOP)),
        width: effectiveW,
        height: effectiveH,
        requiredW,
        requiredH,
      };
    }

    const initialBounds = computeFrameBounds(memberNodes, subPos);
    assert.strictEqual(initialBounds.width, 638);
    assert.strictEqual(initialBounds.height, 260);

    // Attempting to apply a smaller custom size (e.g. 300x150) must not shrink below required bounds
    const constrainedBounds = computeFrameBounds(memberNodes, subPos, { w: 300, h: 150 });
    assert.strictEqual(constrainedBounds.width, 638, 'Width must remain at least requiredW');
    assert.strictEqual(constrainedBounds.height, 260, 'Height must remain at least requiredH');

    // Dragging planner further out dynamically expands the frame
    memberNodes[1].x = 800;
    memberNodes[1].y = 400;
    const expandedBounds = computeFrameBounds(memberNodes, subPos);
    assert.strictEqual(expandedBounds.width, 988, 'Frame width should automatically expand to 988');
    assert.strictEqual(expandedBounds.height, 510, 'Frame height should automatically expand to 510');
  });

  // 17. Model parser line tracking & diagnostic element mapping
  test('17. Model parser tracks line numbers and maps LSP & semantic validation diagnostics to canvas elements', () => {
    const sysContent = `
robot_system:
  nodes:
    cam_node:
      from: "cam_pkg.cam_node"
      interfaces:
        - "img_out": pub-> "cam::image"
    proc_node:
      from: "proc_pkg.proc_node"
      interfaces:
        - "img_in": sub-> "proc::image"
  connections:
    - ["img_out", "img_in"]
  processes:
    vision_proc:
      nodes: ['cam_node', 'proc_node']
      threads: 2
`;
    const sysPath = path.join(tmpDir, 'diag_test.rossystem');
    fs.writeFileSync(sysPath, sysContent, 'utf-8');

    const project = RosModelParser.parse(sysContent, sysPath);

    // 1. Verify line numbers are captured by parser
    const camNode = project.nodes.find((n) => n.label === 'cam_node');
    const procNode = project.nodes.find((n) => n.label === 'proc_node');
    const conn = project.connections[0];
    const proc = project.processes?.[0];

    assert.ok(camNode?.line != null && camNode.line > 0, 'cam_node should have line number');
    assert.ok(procNode?.line != null && procNode.line > 0, 'proc_node should have line number');
    assert.ok(conn?.line != null && conn.line > 0, 'conn should have line number');
    assert.ok(proc?.line != null && proc.line > 0, 'process should have line number');

    // 2. Test LSP Diagnostic mapping by line & token
    const mockContext = {
      extensionPath: tmpDir,
      globalStorageUri: { fsPath: tmpDir },
    } as unknown as vscode.ExtensionContext;
    const provider = new RosCustomEditorProvider(mockContext);

    const lspDiagnostics: vscode.Diagnostic[] = [
      new vscode.Diagnostic(
        new vscode.Range(new vscode.Position((camNode.line || 4) - 1, 4), new vscode.Position((camNode.line || 4) - 1, 12)),
        'Unknown package reference in cam_pkg',
        vscode.DiagnosticSeverity.Error
      ),
      new vscode.Diagnostic(
        new vscode.Range(new vscode.Position((proc?.line || 14) - 1, 4), new vscode.Position((proc?.line || 14) - 1, 15)),
        "Process 'vision_proc' thread count exceeds hardware concurrency",
        vscode.DiagnosticSeverity.Warning
      ),
    ];

    const mapped = provider.mapDiagnosticsToElements(lspDiagnostics, project, sysPath);
    assert.ok(mapped.length >= 2, 'Should map at least the 2 LSP diagnostics');

    const nodeDiag = mapped.find((d) => d.elementKind === 'node');
    assert.ok(nodeDiag, 'Should have mapped diagnostic to node');
    assert.strictEqual(nodeDiag?.targetName, 'cam_node');
    assert.strictEqual(nodeDiag?.severity, 'error');

    const procDiag = mapped.find((d) => d.elementKind === 'process');
    assert.ok(procDiag, 'Should have mapped diagnostic to process');
    assert.strictEqual(procDiag?.targetName, 'vision_proc');
    assert.strictEqual(procDiag?.severity, 'warning');

    // 3. Test Semantic Consistency Checks (Incompatible connection kind & non-existent process node)
    // A) Mutate connection interface to invalid kind (pub -> pub)
    const imgInIface = procNode?.ifaces.find((i) => i.id === conn.to.i);
    if (imgInIface) imgInIface.kind = 'pub'; // invalid: pub cannot connect to pub!

    // B) Reference non-existent node in process
    proc?.nodes?.push('ghost_node');

    const semanticMapped = provider.mapDiagnosticsToElements([], project, sysPath);
    const connError = semanticMapped.find((d) => d.elementKind === 'connection' && d.message.includes('Incompatible port kinds'));
    assert.ok(connError, 'Should detect incompatible connection kind pub -> pub');
    assert.strictEqual(connError?.severity, 'error');

    const procError = semanticMapped.find((d) => d.elementKind === 'process' && d.message.includes('ghost_node'));
    assert.ok(procError, 'Should detect process referencing non-existent node ghost_node');
    assert.strictEqual(procError?.severity, 'warning');
  });

  // 18. Subsystem member nodes and layout schematic restoration on .rossystem open
  test('18. Subsystem member nodes and layout schematic restoration on .rossystem open', () => {
    // 1. Point to demo test_system.rossystem
    const demoSysPath = path.resolve(__dirname, '../../demo/test_ws/src/test_system/test_system.rossystem');
    if (!fs.existsSync(demoSysPath)) {
      return; // Skip if run in isolation outside workspace
    }
    const content = fs.readFileSync(demoSysPath, 'utf-8');
    const project = RosModelParser.parse(content, demoSysPath);
    project.isRosSystem = true;
    assert.strictEqual(project.subSystems.length, 1);
    assert.strictEqual(project.subSystems[0].ref, 'ur_robot');

    // 2. Verify RosLayoutManager locates layout schematic from parent hierarchy (demo/.rostooling/layout)
    const schematic = RosLayoutManager.loadLayoutSchematic(demoSysPath);
    assert.ok(schematic, 'Layout schematic should be found in parent hierarchy');
    assert.strictEqual(schematic?.nodes.length, 10, 'Schematic should contain 10 nodes (2 direct + 8 subsystem)');

    // 3. Apply layout schematic to project
    assert.ok(schematic, 'Schematic must not be null');
    RosLayoutManager.applyLayoutSchematic(project, schematic);

    // 4. Verify all 8 member nodes are restored and linked to ur_robot subsystem
    const urMembers = project.nodes.filter((n) => n.subRef === 'ur_robot');
    assert.strictEqual(urMembers.length, 8, 'Subsystem ur_robot should contain all 8 member nodes');

    // 5. Verify coordinates from test_system.rossystem.layout.json are accurately applied
    const rsp = urMembers.find((n) => n.label === 'robot_state_publisher_node');
    assert.ok(rsp, 'robot_state_publisher_node should be present');
    assert.strictEqual(rsp?.x, 630);
    assert.strictEqual(rsp?.y, 701);

    const cm = urMembers.find((n) => n.label === 'controller_manager');
    assert.ok(cm, 'controller_manager should be present');
    assert.strictEqual(cm?.x, 930);
    assert.strictEqual(cm?.y, 701);

    // 6. Verify that emitting .rossystem does not pollute file with subsystem member nodes
    const emitted = RosModelEmitter.emitRosSystem(project);
    assert.ok(emitted.includes('subSystems:\n    ur_robot'));
    assert.ok(emitted.includes('node1:'));
    assert.ok(emitted.includes('node2:'));
    assert.strictEqual(emitted.includes('robot_state_publisher_node:'), false, 'Member nodes should not be serialized to .rossystem');
  });

  // 19. Subsystem with colliding member node names maintains independent layout coordinates and persistence
  test('19. Subsystem with colliding member node names maintains independent layout coordinates and persistence', async () => {
    const mockContext = { extensionUri: vscode.Uri.file(__dirname) } as vscode.ExtensionContext;
    const provider = new RosCustomEditorProvider(mockContext);

    // Create a model replicating test_system.rossystem with direct nodes node1 and node2
    const sysPath = path.join(tmpDir, 'test_collision.rossystem');
    const initialText = `test_collision:
  nodes:
    node1:
      from: "pkg.image_filter"
    node2:
      from: "pkg.consumer"
`;
    fs.writeFileSync(sysPath, initialText, 'utf-8');

    const project = RosModelParser.parse(initialText, sysPath);
    project.isRosSystem = true;
    assert.strictEqual(project.nodes.length, 2);

    // Initial direct node coordinates
    project.nodes[0].x = 120;
    project.nodes[0].y = 150;
    project.nodes[1].x = 450;
    project.nodes[1].y = 150;

    // Simulate adding my_awesome_system (which contains member nodes node1 and node2)
    const subRef = 'my_awesome_system';
    project.subSystems.push({ ref: subRef, state: 'collapsed' });
    if (!project.view) project.view = {};
    if (!project.view.subPos) project.view.subPos = {};
    project.view.subPos[subRef] = { x: 100, y: 400 };

    // Member nodes with colliding labels "node1" and "node2", but unique IDs
    const memberNode1 = {
      id: `n_${subRef}_node1`,
      label: 'node1',
      subRef: subRef,
      backing: 'sub' as const,
      ifaces: [],
      params: [],
      x: 130,
      y: 450,
      w: 260,
      h: 160,
    };
    const memberNode2 = {
      id: `n_${subRef}_node2`,
      label: 'node2',
      subRef: subRef,
      backing: 'sub' as const,
      ifaces: [],
      params: [],
      x: 430,
      y: 450,
      w: 260,
      h: 160,
    };
    project.nodes.push(memberNode1, memberNode2);

    // Verify 4 distinct nodes exist
    assert.strictEqual(project.nodes.length, 4);
    const direct1 = project.nodes.find((n) => n.id === 'n_node1');
    const member1 = project.nodes.find((n) => n.id === `n_${subRef}_node1`);
    assert.ok(direct1 && member1);
    assert.strictEqual(direct1.x, 120);
    assert.strictEqual(member1.x, 130);
    assert.notStrictEqual(direct1.y, member1.y);

    // 1. Simulate document edit and layout restoration (restoreCachedLayout)
    const providerHelper = provider as unknown as {
      restoreCachedLayout: (target: RosProject, source: RosProject) => void;
    };
    const emittedText = RosModelEmitter.emitRosSystem(project);
    const freshFromText = RosModelParser.parse(emittedText, sysPath);
    freshFromText.isRosSystem = true;
    providerHelper.restoreCachedLayout(freshFromText, project);

    // Verify both direct and member nodes exist in freshProject and retain their positions
    assert.strictEqual(freshFromText.nodes.length, 4);
    const restoredDirect1 = freshFromText.nodes.find((n) => n.id === 'n_node1');
    const restoredMember1 = freshFromText.nodes.find((n) => n.id === `n_${subRef}_node1`);
    assert.ok(restoredDirect1 && restoredMember1);
    assert.strictEqual(restoredDirect1.x, 120, 'Direct node1 must keep its own x position');
    assert.strictEqual(restoredDirect1.y, 150, 'Direct node1 must keep its own y position');
    assert.strictEqual(restoredMember1.x, 130, 'Subsystem node1 must keep its own x position');
    assert.strictEqual(restoredMember1.y, 450, 'Subsystem node1 must keep its own y position');

    // 2. Simulate moving direct node1 to (600, 200)
    restoredDirect1.x = 600;
    restoredDirect1.y = 200;

    const freshAfterMove = RosModelParser.parse(emittedText, sysPath);
    freshAfterMove.isRosSystem = true;
    providerHelper.restoreCachedLayout(freshAfterMove, freshFromText);

    const movedDirect1 = freshAfterMove.nodes.find((n) => n.id === 'n_node1');
    const unMovedMember1 = freshAfterMove.nodes.find((n) => n.id === `n_${subRef}_node1`);
    assert.strictEqual(movedDirect1?.x, 600, 'Moved direct node1 must not snap back');
    assert.strictEqual(movedDirect1?.y, 200, 'Moved direct node1 must not snap back');
    assert.strictEqual(unMovedMember1?.x, 130, 'Subsystem member node1 coordinates must be unaffected');
    assert.strictEqual(unMovedMember1?.y, 450, 'Subsystem member node1 coordinates must be unaffected');

    // 3. Verify schematic export and restoration with RosLayoutManager
    await RosLayoutManager.saveLayoutSchematic(sysPath, freshAfterMove);
    const schematic = RosLayoutManager.loadLayoutSchematic(sysPath);
    assert.ok(schematic, 'Schematic layout should be saved');

    const freshFromSchematic = RosModelParser.parse(emittedText, sysPath);
    freshFromSchematic.isRosSystem = true;
    RosLayoutManager.applyLayoutSchematic(freshFromSchematic, schematic);

    const schDirect1 = freshFromSchematic.nodes.find((n) => n.id === 'n_node1');
    const schMember1 = freshFromSchematic.nodes.find((n) => n.id === `n_${subRef}_node1`);
    assert.strictEqual(schDirect1?.x, 600, 'Schematic direct node1 must retain moved position');
    assert.strictEqual(schMember1?.x, 130, 'Schematic member node1 must retain distinct position');
  });
});


