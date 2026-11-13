import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Block 5 verification gate (end-to-end over MCP stdio, against the real Java GLSP/Xtext
 * server): an agent builds and wires a multi-node ROS 2 system from nothing using only the
 * semantic, coordinate-free tools, and the result is a valid .rossystem (zero validation
 * errors, checked by the official language server) plus an SVG diagram. No .layout sidecar
 * is written and no coordinates are ever passed.
 */

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const JAR = path.join(EXT_ROOT, 'server', 'rostooling_extension-2.3.5.jar');
const BIN = path.join(EXT_ROOT, 'bin', 'rostooling-mcp.js');

const MSGS = `warehouse_msgs:
  msgs:
    Scan
      message
        float32[] ranges
        float32 angle_increment
    ObstacleList
      message
        float32[] distances
        string frame_id
  srvs:
    SetSpeedLimit
      request
        float64 limit
      response
        bool success
`;

const NODES = `warehouse_nodes:
  artifacts:
    lidar_driver:
      node: lidar_driver
      publishers:
        scan:
          type: "warehouse_msgs/msg/Scan"
      parameters:
        frame_id:
          type: String
          default: "laser"
        rate_hz:
          type: Integer
          default: 10
    obstacle_detector:
      node: obstacle_detector
      subscribers:
        scan_in:
          type: "warehouse_msgs/msg/Scan"
      publishers:
        obstacles:
          type: "warehouse_msgs/msg/ObstacleList"
      serviceservers:
        set_speed_limit:
          type: "warehouse_msgs/srv/SetSpeedLimit"
      parameters:
        min_range:
          type: Double
          default: 0.1
    planner:
      node: planner
      subscribers:
        obstacles_in:
          type: "warehouse_msgs/msg/ObstacleList"
      serviceclients:
        speed_limit_client:
          type: "warehouse_msgs/srv/SetSpeedLimit"
`;

interface Outcome {
  success: boolean;
  error?: string;
  errors: string[];
  warnings: string[];
  [k: string]: unknown;
}

suite('MCP semantic system tools (Block 5 gate)', function () {
  this.timeout(240000);
  let dir: string;
  let client: Client;

  async function call(name: string, args: Record<string, unknown>): Promise<Outcome> {
    const res = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    const out = JSON.parse(res.content[0].text) as Outcome;
    return out;
  }

  async function ok(name: string, args: Record<string, unknown>): Promise<Outcome> {
    const out = await call(name, args);
    assert.ok(out.success, `${name} failed: ${JSON.stringify(out, null, 2)}`);
    assert.deepStrictEqual(out.errors, [], `${name} reported validation errors`);
    return out;
  }

  suiteSetup(async () => {
    assert.ok(fs.existsSync(JAR), `GLSP server JAR missing at ${JAR}`);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-mcp-e2e-'));
    fs.writeFileSync(path.join(dir, 'warehouse_msgs.ros'), MSGS);
    fs.writeFileSync(path.join(dir, 'warehouse_nodes.ros2'), NODES);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.ROS_GLSP_PORT = String(Number(process.env.ROS_GLSP_IT_PORT) || 6100 + Math.floor(Math.random() * 800));
    client = new Client({ name: 'rostooling-e2e', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, '--jar', JAR], env, stderr: process.env.RT_MCP_DEBUG ? 'inherit' : 'ignore' }));
  });

  suiteTeardown(async () => {
    await client?.close();
  });

  test('exposes the semantic tools next to the generators and the validator', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ['ros_add_node', 'ros_connect_interfaces', 'ros_set_parameter', 'ros_add_process', 'ros_remove_element',
      'export_system_diagram', 'generate_ros2_wrappers', 'generate_rossystem_code', 'validate_ros_model']) {
      assert.ok(names.includes(n), `missing tool ${n}: ${names.join(', ')}`);
    }
    for (const t of (await client.listTools()).tools) {
      const props = Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties || {});
      assert.ok(!props.some((p) => /^(x|y|position|location|coordinates?)$/i.test(p)), `${t.name} must be coordinate-free`);
    }
  });

  test('builds, wires and validates a multi-node system without coordinates', async () => {
    const sys = path.join(dir, 'warehouse_system.rossystem');
    assert.ok(!fs.existsSync(sys));

    const lidar = await ok('ros_add_node', { system_path: sys, node_name: 'lidar', from: 'warehouse_nodes.lidar_driver', system_name: 'warehouse_system' });
    assert.strictEqual(lidar.created, true);
    const lidarIfaces = (lidar.node as { interfaces: { ref: string; kind: string }[] }).interfaces;
    assert.deepStrictEqual(lidarIfaces.map((i) => [i.ref, i.kind]), [['lidar.scan', 'publisher']]);
    await ok('ros_add_node', { system_path: sys, node_name: 'detector', from: 'warehouse_nodes.obstacle_detector', namespace: 'perception' });
    await ok('ros_add_node', { system_path: sys, node_name: 'planner', from: 'warehouse_nodes.planner' });

    await ok('ros_connect_interfaces', { system_path: sys, from: 'lidar.scan', to: 'detector.scan_in' });
    await ok('ros_connect_interfaces', { system_path: sys, from: 'detector.obstacles', to: 'planner.obstacles_in' });
    await ok('ros_connect_interfaces', { system_path: sys, from: 'planner.speed_limit_client', to: 'detector.set_speed_limit' });

    const param = await ok('ros_set_parameter', { system_path: sys, node: 'lidar', parameter: 'frame_id', value: 'base_laser' });
    assert.deepStrictEqual(param.parameter, { node: 'lidar', name: 'frame_id', value: 'base_laser' });
    await ok('ros_set_parameter', { system_path: sys, node: 'detector', parameter: 'min_range', value: '0.25', type_hint: 'double' });
    await ok('ros_add_process', { system_path: sys, process_name: 'perception_container', nodes: ['lidar', 'detector'], threads: 2 });

    // Misuse is reported, never silently written.
    const bad = await call('ros_connect_interfaces', { system_path: sys, from: 'lidar.nope', to: 'detector.scan_in' });
    assert.strictEqual(bad.success, false);
    assert.ok((bad.available as string[]).includes('detector.scan_in'));
    const badParam = await call('ros_set_parameter', { system_path: sys, node: 'planner', parameter: 'not_declared', value: '1' });
    assert.strictEqual(badParam.success, false);
    const before = fs.readFileSync(sys, 'utf-8');
    const badNode = await call('ros_add_node', { system_path: sys, node_name: 'ghost', from: 'warehouse_nodes.no_such_node' });
    assert.strictEqual(badNode.success, false);
    assert.strictEqual(fs.readFileSync(sys, 'utf-8'), before, 'a refused call writes nothing');

    // A throw-away node is added and removed again (with its connection).
    await ok('ros_add_node', { system_path: sys, node_name: 'spare', from: 'warehouse_nodes.planner' });
    await ok('ros_connect_interfaces', { system_path: sys, from: 'detector.obstacles', to: 'spare.obstacles_in' });
    await ok('ros_remove_element', { system_path: sys, from: 'detector.obstacles', to: 'spare.obstacles_in' });
    const removed = await ok('ros_remove_element', { system_path: sys, element: 'spare' });
    assert.deepStrictEqual((removed.remaining as { nodes: string[] }).nodes, ['lidar', 'detector', 'planner']);

    const text = fs.readFileSync(sys, 'utf-8');
    assert.ok(text.startsWith('warehouse_system:\n'), text);
    assert.ok(text.includes('    perception_container:\n      nodes: [ lidar , detector ]\n      threads: 2\n'), text);
    assert.ok(text.includes('    lidar:\n      from: "warehouse_nodes.lidar_driver"'), text);
    assert.ok(text.includes('      namespace: "perception"'), text);
    assert.ok(text.includes('base_laser') && text.includes('0.25'), text);
    assert.ok(!text.includes('spare'), text);
    assert.ok(text.includes('    - [ "lidar::scan" , "detector::scan_in" ]\n'), text);
    assert.ok(text.includes('    - [ "detector::set_speed_limit" , "planner::speed_limit_client" ]\n'), text);
    assert.strictEqual((text.match(/^ {4}- \[ .+ , .+ \]$/gm) || []).length, 3, text);
    assert.ok(!text.includes('not_declared'), text);
    assert.ok(!/\b(x|y|position):/.test(text), 'no coordinates in the model');
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.layout')), [], 'no .layout sidecar');

    // Independent check by the official RosTooling language server.
    const validation = (await call('validate_ros_model', { model_path: sys, workspace_dir: dir })) as Outcome & { isValid: boolean; errorCount: number; diagnostics: unknown[] };
    assert.ok(validation.isValid && validation.errorCount === 0, JSON.stringify(validation.diagnostics, null, 2));

    const svgOut = path.join(dir, 'out', 'warehouse_system.svg');
    const diagram = await ok('export_system_diagram', { system_path: sys, output_path: svgOut });
    assert.strictEqual(diagram.svgPath, svgOut);
    assert.deepStrictEqual((diagram.connections as { from: string; to: string }[]).map((c) => `${c.from}->${c.to}`).sort(), [
      'detector.obstacles->planner.obstacles_in',
      'lidar.scan->detector.scan_in',
      'detector.set_speed_limit->planner.speed_limit_client', // stored server-first
    ].sort());
    const svg = fs.readFileSync(svgOut, 'utf-8');
    assert.ok(/^(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg) && svg.trimEnd().endsWith('</svg>'), svg.slice(0, 200));
    // Node cards are labelled with their namespace; the process frame with its name.
    for (const n of ['>lidar<', '>perception/detector<', '>planner<', 'perception_container']) assert.ok(svg.includes(n), `SVG shows ${n}`);
    assert.strictEqual((svg.match(/<svg/g) || []).length, 1);
  });
});
