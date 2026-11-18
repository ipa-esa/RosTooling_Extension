import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HeadlessLspClient } from '../mcp/HeadlessLspClient.js';
import { syncDynamicPluginsWithServer, type PluginLspDeps } from '../mcp/pluginTools.js';

/**
 * End-to-end integration test for semantic .ros2 package authoring tools over MCP stdio,
 * backed by the real Java GLSP/Xtext server: creates a .ros2 file from scratch via
 * ros2_add_artifact / ros2_add_interface / ros2_add_parameter / ros2_set_qos /
 * ros2_set_property / ros2_remove_element, verifies zero Xtext validation errors via
 * validate_ros_model, and then wires a .rossystem node from that generated .ros2 file.
 */

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const JAR = path.join(EXT_ROOT, 'server', 'rostooling_extension-2.5.0.jar');
// RT_MCP_BIN runs the suite against an installed rostooling-mcp package, which finds its bundled JAR.
const BIN = process.env.RT_MCP_BIN || path.join(EXT_ROOT, 'bin', 'rostooling-mcp.js');
const BIN_ARGS = process.env.RT_MCP_BIN ? [BIN] : [BIN, '--jar', JAR];

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
    assert.ok(process.env.RT_MCP_BIN || fs.existsSync(JAR), `GLSP server JAR missing at ${JAR}`);
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
        args: BIN_ARGS,
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
      'ros2_add_plugin',
      'ros2_add_plugin_slot',
      'ros2_add_interface',
      'ros2_add_parameter',
      'ros2_set_qos',
      'ros2_set_property',
      'ros2_remove_element',
      'ros_list_plugins',
      'ros_get_extension_block',
      'ros_set_extension_block',
      'generate_plugin_outputs',
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

  test('authors pluginlib plugins, pluginslots, and system plugin attachments via MCP', async () => {
    const msgsPath = path.join(dir, 'plug_msgs.ros');
    await ok('ros_add_spec', {
      spec_path: msgsPath,
      spec_name: 'Status',
      kind: 'msg',
      fields: [{ name: 'ok', type: 'bool' }],
    });

    const hostPath = path.join(dir, 'plug_host_pkg.ros2');
    await ok('ros2_add_artifact', {
      package_path: hostPath,
      artifact_name: 'host_bin',
      node_name: 'host_node',
    });
    await ok('ros2_add_parameter', {
      package_path: hostPath,
      artifact: 'host_bin',
      name: 'active_plugin',
      type: 'String',
    });
    await ok('ros2_add_parameter', {
      package_path: hostPath,
      artifact: 'host_bin',
      name: 'leaf_libraries',
      type: 'Array',
    });
    await ok('ros2_add_plugin_slot', {
      package_path: hostPath,
      artifact: 'host_bin',
      name: 'planner',
      base: 'nav2_core::GlobalPlanner',
      parameter: 'active_plugin',
    });
    await ok('ros2_add_plugin_slot', {
      package_path: hostPath,
      artifact: 'host_bin',
      name: 'leaves',
      base: 'custom_core::LeafBase',
      parameter: 'leaf_libraries',
      format: 'library',
    });
    const hostText = fs.readFileSync(hostPath, 'utf-8');
    assert.ok(hostText.includes('pluginslots:'), hostText);
    assert.ok(hostText.includes('base: "nav2_core::GlobalPlanner"'), hostText);
    assert.ok(hostText.includes('format: library'), hostText);

    const plugPath = path.join(dir, 'plug_lib_pkg.ros2');
    await ok('ros2_add_plugin', {
      package_path: plugPath,
      artifact_name: 'planner_lib',
      plugin_name: 'StraightLine',
      implements: 'nav2_core::GlobalPlanner',
      loader: 'pluginlib',
    });
    await ok('ros2_add_interface', {
      package_path: plugPath,
      artifact: 'StraightLine',
      kind: 'pub',
      name: 'plan_status',
      type: 'plug_msgs/msg/Status',
    });
    await ok('ros2_add_plugin', {
      package_path: plugPath,
      artifact_name: 'planner_lib',
      plugin_name: 'ExternalHelper',
      loader: 'external',
    });
    const plugText = fs.readFileSync(plugPath, 'utf-8');
    assert.ok(plugText.includes('plugins:'), plugText);
    assert.ok(plugText.includes('implements: "nav2_core::GlobalPlanner"'), plugText);
    assert.ok(plugText.includes('loader: external'), plugText);

    const plugSysPath = path.join(dir, 'plug_sys.rossystem');
    const hostSysRes = await ok('ros_add_node', {
      system_path: plugSysPath,
      node_name: 'host_inst',
      from: 'plug_host_pkg.host_node',
      plugins: ['plug_lib_pkg.StraightLine'],
      from_file: 'plug_bringup/launch/plug.launch.py',
    });
    assert.deepStrictEqual(
      (hostSysRes.node as { plugins?: string[] }).plugins,
      ['StraightLine']
    );
    const sysText = fs.readFileSync(plugSysPath, 'utf-8');
    assert.ok(sysText.includes('plugins:'), sysText);
  });

  test('lists plugins, reads/writes @ extension blocks, and runs generate_plugin_outputs via MCP', async () => {
    const pluginList = (await call('ros_list_plugins', { workspace_dir: dir })) as unknown as {
      plugins: unknown[];
      tools: unknown[];
      loadErrors: string[];
    };
    assert.ok(Array.isArray(pluginList.plugins), JSON.stringify(pluginList));
    assert.ok(Array.isArray(pluginList.tools), JSON.stringify(pluginList));

    const extPkgPath = path.join(dir, 'ext_app_pkg.ros2');
    await ok('ros2_add_artifact', {
      package_path: extPkgPath,
      artifact_name: 'ext_bin',
      node_name: 'ext_node',
    });

    const setRes = (await call('ros_set_extension_block', {
      model_path: extPkgPath,
      block_name: 'custom_meta',
      target_kind: 'Node',
      target_name: 'ext_node',
      entries: {
        channel: 'main',
        rate_hz: 20,
        tags: ['a', 'b'],
      },
      workspace_dir: dir,
    })) as Outcome & { dslBlock?: string };
    assert.strictEqual(setRes.success, true, JSON.stringify(setRes));
    assert.ok(fs.readFileSync(extPkgPath, 'utf-8').includes('@custom_meta:'));

    const getRes = (await call('ros_get_extension_block', {
      model_path: extPkgPath,
      block_name: 'custom_meta',
      target_kind: 'Node',
      target_name: 'ext_node',
      workspace_dir: dir,
    })) as Outcome & { found: boolean; entries: Record<string, unknown> };
    assert.strictEqual(getRes.found, true, JSON.stringify(getRes));
    assert.strictEqual(getRes.entries.channel, 'main');
    assert.strictEqual(getRes.entries.rate_hz, 20);

    const genRes = (await call('generate_plugin_outputs', {
      model_path: extPkgPath,
      language: 'cpp',
      ros_distro: 'jazzy',
      workspace_dir: dir,
    })) as unknown as { status?: string; writtenFiles?: string[]; error?: string };
    assert.strictEqual(genRes.status, 'success', JSON.stringify(genRes));
    assert.ok(
      Array.isArray(genRes.writtenFiles) && genRes.writtenFiles.some((f) => f.endsWith('CMakeLists.txt')),
      JSON.stringify(genRes)
    );

    const remRes = (await call('ros_set_extension_block', {
      model_path: extPkgPath,
      block_name: 'custom_meta',
      target_kind: 'Node',
      target_name: 'ext_node',
      remove: true,
      workspace_dir: dir,
    })) as Outcome;
    assert.strictEqual(remRes.success, true, JSON.stringify(remRes));
    assert.ok(!fs.readFileSync(extPkgPath, 'utf-8').includes('@custom_meta:'));
  });

  test('registers typed <plugin>__set_<block> tools from Ecore schema and writes validated blocks', async () => {
    const typedPkgPath = path.join(dir, 'typed_ext_pkg.ros2');
    await ok('ros2_add_artifact', {
      package_path: typedPkgPath,
      artifact_name: 'typed_bin',
      node_name: 'typed_node',
    });

    const recordedCalls: Record<string, unknown>[] = [];
    const mockClient = {
      openDocument: async () => undefined,
      executeCommand: async (command: string, args: unknown[]) => {
        if (command === 'rostooling.listPluginTools') {
          return {
            plugins: [
              {
                id: 'de.example.audit',
                version: '1.0.0',
                documentationMarkdown: '# Audit Docs',
                blocks: [
                  {
                    name: 'audit',
                    setToolName: 'de_example_audit__set_audit',
                    allowedLocations: ['NODE'],
                    description: 'Audit metadata block',
                    schema: {
                      type: 'object',
                      properties: {
                        channel: { type: 'string' },
                        rate_hz: { type: 'integer' },
                        mode: { type: 'string', enum: ['sync', 'async'] },
                        tags: { type: 'array', items: { type: 'string' } },
                        rules: {
                          type: 'array',
                          description: "Array of items (or object map keyed by 'name')",
                          items: {
                            type: 'object',
                            properties: {
                              weight: { type: 'integer' },
                            },
                          },
                        },
                      },
                      required: ['channel'],
                    },
                  },
                ],
              },
            ],
            tools: [],
            loadErrors: [],
          };
        }
        if (command === 'rostooling.setExtensionBlock') {
          const req = (args?.[0] || {}) as Record<string, unknown>;
          recordedCalls.push(req);
          return call('ros_set_extension_block', {
            model_path: String(req.modelPath || typedPkgPath),
            block_name: String(req.blockName || 'audit'),
            entries: (req.entries || {}) as Record<string, unknown>,
            target_kind: typeof req.targetKind === 'string' ? req.targetKind : undefined,
            target_name: typeof req.targetName === 'string' ? req.targetName : undefined,
            artifact_name: typeof req.artifactName === 'string' ? req.artifactName : undefined,
            remove: Boolean(req.remove),
            workspace_dir: dir,
          });
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    } as unknown as HeadlessLspClient;

    const deps: PluginLspDeps = {
      getClient: async () => mockClient,
      workspaceDir: () => dir,
      resolveWorkspaceDir: () => dir,
      openCompanionFiles: async () => undefined,
    };

    const mcpServer = new McpServer({ name: 'typed-block-test', version: '1.0.0' });
    const regTools = new Set<string>();
    const regResources = new Set<string>();
    await syncDynamicPluginsWithServer(mcpServer, mockClient, deps, regTools, regResources, false);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client({ name: 'typed-block-client', version: '1.0.0' });
    await Promise.all([mcpServer.connect(serverTransport), testClient.connect(clientTransport)]);

    try {
      const listed = await testClient.listTools();
      const setAuditTool = listed.tools.find((t) => t.name === 'de_example_audit__set_audit');
      assert.ok(setAuditTool, `Expected typed tool in: ${listed.tools.map((t) => t.name).join(', ')}`);

      const inputSchema = setAuditTool.inputSchema as {
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      };
      assert.ok(inputSchema.required?.includes('model_path'));
      assert.ok(inputSchema.required?.includes('channel'));
      assert.ok(!inputSchema.required?.includes('rate_hz'));
      assert.strictEqual(inputSchema.properties?.channel?.type, 'string');
      assert.strictEqual(inputSchema.properties?.rate_hz?.type, 'number');
      assert.deepStrictEqual(inputSchema.properties?.mode?.enum, ['sync', 'async']);
      assert.strictEqual(inputSchema.properties?.tags?.type, 'array');

      const missingReqRes = (await testClient.callTool({
        name: 'de_example_audit__set_audit',
        arguments: {
          model_path: typedPkgPath,
          rate_hz: 10,
        },
      })) as { isError?: boolean };
      assert.strictEqual(missingReqRes.isError, true, 'Missing required channel must fail MCP input validation');

      const invokeRes = (await testClient.callTool({
        name: 'de_example_audit__set_audit',
        arguments: {
          model_path: typedPkgPath,
          target_kind: 'Node',
          target_name: 'typed_node',
          channel: 'telemetry',
          rate_hz: 15,
          mode: 'async',
          tags: ['alpha', 'beta'],
        },
      })) as { isError?: boolean; content: { text: string }[] };
      assert.notStrictEqual(invokeRes.isError, true, invokeRes.content[0].text);
      assert.strictEqual(recordedCalls.length, 1);
      assert.strictEqual(recordedCalls[0].blockName, 'audit');

      const getRes = (await call('ros_get_extension_block', {
        model_path: typedPkgPath,
        block_name: 'audit',
        target_kind: 'Node',
        target_name: 'typed_node',
        workspace_dir: dir,
      })) as Outcome & { found: boolean; entries: Record<string, unknown> };
      assert.strictEqual(getRes.found, true, JSON.stringify(getRes));
      assert.strictEqual(getRes.entries.channel, 'telemetry');
      assert.strictEqual(getRes.entries.rate_hz, 15);
      assert.strictEqual(getRes.entries.mode, 'async');
      assert.deepStrictEqual(getRes.entries.tags, ['alpha', 'beta']);
    } finally {
      await testClient.close();
      await mcpServer.close();
    }
  });
});
