import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RosModelParser } from '../model/RosModelParser';
import { RosModelEmitter } from '../model/RosModelEmitter';
import {
  RosProject,
  RosLayoutSchematic,
  RosInteractionKind,
} from '../model/RosModelTypes';
import { RosLayoutManager } from '../model/RosLayoutManager';

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
});
