import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * End-to-end integration test for semantic .ros2 package authoring tools over MCP stdio,
 * backed by the real Java GLSP/Xtext server: creates a .ros2 file from scratch via
 * ros2_add_artifact / ros2_add_interface / ros2_add_parameter / ros2_set_qos /
 * ros2_set_property / ros2_remove_element, verifies zero Xtext validation errors via
 * validate_ros_model, and then wires a .rossystem node from that generated .ros2 file.
 */

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const JAR = path.join(EXT_ROOT, 'server', 'rostooling_extension-2.4.0.jar');
const BIN = path.join(EXT_ROOT, 'bin', 'rostooling-mcp.js');

interface Outcome {
  success: boolean;
  error?: string;
  errors: string[];
  warnings: string[];
  [k: string]: unknown;
}

suite('MCP semantic .ros2 package tools', function () {
  this.timeout(240000);
  let dir: string;
  let client: Client;

  async function call(name: string, args: Record<string, unknown>): Promise<Outcome> {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    return JSON.parse(res.content[0].text) as Outcome;
  }

  async function ok(name: string, args: Record<string, unknown>): Promise<Outcome> {
    const out = await call(name, args);
    assert.ok(out.success, `${name} failed: ${JSON.stringify(out, null, 2)}`);
    assert.deepStrictEqual(out.errors, [], `${name} reported validation errors`);
    return out;
  }

  suiteSetup(async () => {
    assert.ok(fs.existsSync(JAR), `GLSP server JAR missing at ${JAR}`);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-mcp-ros2-'));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.ROS_GLSP_PORT = String(
      Number(process.env.ROS_GLSP_ROS2_IT_PORT) || 6200 + Math.floor(Math.random() * 600)
    );
    client = new Client({ name: 'rostooling-ros2-e2e', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BIN, '--jar', JAR],
        env,
        stderr: process.env.RT_MCP_DEBUG ? 'inherit' : 'ignore',
      })
    );
  });

  suiteTeardown(async () => {
    await client?.close();
  });

  test('exposes coordinate-free .ros and .ros2 authoring tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of [
      'ros_add_spec',
      'ros_add_subsystem',
      'ros_set_system_property',
      'ros2_add_artifact',
      'ros2_add_interface',
      'ros2_add_parameter',
      'ros2_set_qos',
      'ros2_set_property',
      'ros2_remove_element',
    ]) {
      assert.ok(names.includes(n), `missing tool ${n}: ${names.join(', ')}`);
    }
  });

  test('builds, mutates, validates .ros, .ros2 and .rossystem packages end-to-end without hand-written DSL text', async () => {
    const rosPath = path.join(dir, 'warehouse_msgs.ros');
    assert.ok(!fs.existsSync(rosPath));

    // 0. Create .ros message & service specs via ros_add_spec
    await ok('ros_add_spec', {
      spec_path: rosPath,
      spec_name: 'Scan',
      kind: 'msg',
      fields: [
        { name: 'ranges', type: 'float32[]' },
        { name: 'angle_increment', type: 'float32' },
      ],
    });
    await ok('ros_add_spec', {
      spec_path: rosPath,
      spec_name: 'SetSpeedLimit',
      kind: 'srv',
      fields: [
        { name: 'limit', type: 'float64', section: 'request' },
        { name: 'success', type: 'bool', section: 'response' },
      ],
    });

    const ros2Path = path.join(dir, 'Warehouse-Nodes.ros2');
    assert.ok(!fs.existsSync(ros2Path));

    // 1. Create a brand-new .ros2 file with lowercase package name & lifecycle artifact
    const art1 = await ok('ros2_add_artifact', {
      package_path: ros2Path,
      artifact_name: 'lidar_driver',
      node_name: 'lidar_node',
      package_name: 'warehouse_nodes',
      from_git_repo: 'https://github.com/example/warehouse_nodes.git',
      lifecycle: true,
    });
    assert.strictEqual(art1.created, true);

    await ok('ros2_add_interface', {
      package_path: ros2Path,
      artifact: 'lidar_driver',
      kind: 'pub',
      name: 'scan',
      type: 'warehouse_msgs/msg/Scan',
      active_in: ['active'],
      qos: { profile: 'sensor_qos', depth: '5' },
    });

    await ok('ros2_add_parameter', {
      package_path: ros2Path,
      artifact: 'lidar_driver',
      name: 'frame_id',
      type: 'String',
      default_value: 'laser',
    });

    await ok('ros2_add_parameter', {
      package_path: ros2Path,
      artifact: 'lidar_driver',
      name: 'obsolete_param',
      type: 'Integer',
      default_value: '42',
    });

    // 2. Add a second artifact + subscriber + service server
    await ok('ros2_add_artifact', {
      package_path: ros2Path,
      artifact_name: 'obstacle_detector',
      node_name: 'detector_node',
    });
    await ok('ros2_add_interface', {
      package_path: ros2Path,
      artifact: 'obstacle_detector',
      kind: 'sub',
      name: 'scan_in',
      type: 'warehouse_msgs/msg/Scan',
    });
    await ok('ros2_add_interface', {
      package_path: ros2Path,
      artifact: 'obstacle_detector',
      kind: 'ss',
      name: 'set_speed_limit',
      type: 'warehouse_msgs/srv/SetSpeedLimit',
    });

    // 3. Mutate QoS, property, and delete temporary parameter via semantic tools
    await ok('ros2_set_qos', {
      package_path: ros2Path,
      artifact: 'lidar_driver',
      interface_name: 'scan',
      depth: '10',
      reliability: 'best_effort',
    });
    await ok('ros2_set_property', {
      package_path: ros2Path,
      target: 'lidar_driver.frame_id',
      property: 'value',
      value: 'base_laser',
      value_type: 'String',
    });
    await ok('ros2_remove_element', {
      package_path: ros2Path,
      element: 'lidar_driver.obsolete_param',
    });

    const text = fs.readFileSync(ros2Path, 'utf-8');
    assert.ok(text.startsWith('warehouse_nodes:\n'), text);
    assert.ok(text.includes('fromGitRepo: "https://github.com/example/warehouse_nodes.git"'), text);
    assert.ok(text.includes('lifecycle: true'), text);
    assert.ok(text.includes('depth: 10'), text);
    assert.ok(text.includes('reliability: best_effort'), text);
    assert.ok(text.includes('value: "base_laser"'), text);
    assert.ok(!text.includes('obsolete_param'), text);

    // 4. Independent validation check
    const validation = (await call('validate_ros_model', {
      model_path: ros2Path,
      workspace_dir: dir,
    })) as Outcome & { isValid: boolean; errorCount: number; diagnostics: unknown[] };
    assert.ok(
      validation.isValid && validation.errorCount === 0,
      JSON.stringify(validation.diagnostics, null, 2)
    );

    // 5. Wire a .rossystem composition (with from_file) and compose it into a parent via ros_add_subsystem
    const sysPath = path.join(dir, 'warehouse_system.rossystem');
    await ok('ros_add_node', {
      system_path: sysPath,
      node_name: 'lidar',
      from: 'warehouse_nodes.lidar_node',
      from_file: 'warehouse_bringup/launch/warehouse.launch.py',
    });
    await ok('ros_add_node', {
      system_path: sysPath,
      node_name: 'detector',
      from: 'warehouse_nodes.detector_node',
    });
    await ok('ros_connect_interfaces', {
      system_path: sysPath,
      from: 'lidar.scan',
      to: 'detector.scan_in',
    });
    await ok('ros_set_parameter', {
      system_path: sysPath,
      node: 'lidar',
      parameter: 'frame_id',
      value: 'front_lidar',
    });

    const topSysPath = path.join(dir, 'top_system.rossystem');
    await ok('ros_add_subsystem', {
      system_path: topSysPath,
      subsystem_name: 'warehouse_system',
      from_file: 'warehouse_bringup/launch/top.launch.py',
    });
    assert.ok(fs.readFileSync(topSysPath, 'utf-8').includes('subSystems:\n    warehouse_system'));
  });
});
