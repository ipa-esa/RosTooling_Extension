import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HeadlessLspClient } from '../mcp/HeadlessLspClient.js';
import {
  deletePrunedFiles,
  isPluginOwnedPrunePath,
  processAndWriteFiles,
  scanExistingFiles,
} from '../mcp/PostProcessor.js';
import { syncDynamicPluginsWithServer, type PluginLspDeps } from '../mcp/pluginTools.js';
import { pathToFileURL } from 'node:url';

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

suite('Standalone external plugin JAR integration (--plugins-dir & VS Code settings)', function () {
  this.timeout(240000);
  const TEST_PLUGIN_JAR = path.resolve(EXT_ROOT, '..', 'build', 'test-plugins', 'rostooling-test-plugins.jar');

  function cleanPluginEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== 'ROS_PLUGINS_DIR' && k !== 'ROS_PLUGINS_ENABLED') {
        env[k] = v;
      }
    }
    return env;
  }

  test('loads external plugin JAR via --plugins-dir/--enable-plugins and exercises validate, MCP tools, docs resource, package & system generation', async () => {
    assert.ok(process.env.RT_MCP_BIN || fs.existsSync(JAR), `GLSP server JAR missing at ${JAR}`);
    assert.ok(fs.existsSync(TEST_PLUGIN_JAR), `External test plugin JAR missing at ${TEST_PLUGIN_JAR}`);

    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ext-cli-'));
    const env = cleanPluginEnv();
    env.ROS_GLSP_PORT = String(6900 + Math.floor(Math.random() * 500));

    const cliArgs = [
      ...BIN_ARGS,
      '--plugins-dir',
      TEST_PLUGIN_JAR,
      '--enable-plugins',
      'de.example.extprobe,de.example.extoverlap',
    ];
    const client = new Client({ name: 'ext-plugin-cli-client', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: cliArgs,
        cwd: wsDir,
        env,
        stderr: process.env.RT_MCP_DEBUG ? 'inherit' : 'ignore',
      })
    );

    const callJson = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as {
        content: { type: string; text: string }[];
        isError?: boolean;
      };
      return {
        isError: Boolean(res.isError),
        body: JSON.parse(res.content[0].text) as Record<string, unknown>,
      };
    };

    try {
      // 1. Dynamic tools + typed set_<block> tools + docs resource registered from external JAR
      const listedTools = await client.listTools();
      const toolNames = listedTools.tools.map((t) => t.name);
      for (const expected of [
        'de_example_extprobe__inspect_probe',
        'de_example_extprobe__set_probe',
        'de_example_extoverlap__set_overlap',
      ]) {
        assert.ok(toolNames.includes(expected), `Missing dynamic tool ${expected} in: ${toolNames.join(', ')}`);
      }

      const setProbeDef = listedTools.tools.find((t) => t.name === 'de_example_extprobe__set_probe');
      assert.ok(setProbeDef, 'Missing de_example_extprobe__set_probe tool');
      const setProbeSchema = setProbeDef.inputSchema as {
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      };
      assert.ok(setProbeSchema.required?.includes('profile'));
      assert.strictEqual(setProbeSchema.properties?.interval_ms?.type, 'number');

      const listedResources = await client.listResources();
      const docsUri = 'rostooling://plugin/de.example.extprobe/docs';
      assert.ok(
        listedResources.resources.some((r) => r.uri === docsUri),
        `Missing docs resource ${docsUri}`
      );
      const readDocs = await client.readResource({ uri: docsUri });
      const docsText = String((readDocs.contents[0] as { text?: string }).text || '');
      assert.ok(docsText.includes('# External Probe Plugin'), docsText);

      // 2. Write .ros2 package with invalid @probe -> validate_ros_model reports EXTPROBE_INVALID_INTERVAL
      const pkgPath = path.join(wsDir, 'probe_demo.ros2');
      fs.writeFileSync(
        pkgPath,
        [
          'probe_demo:',
          '  artifacts:',
          '    cam_art:',
          '      node: cam_node',
          '      parameters:',
          '        cam_rate:',
          '          type: Integer',
          '          default: 10',
          '      @probe:',
          '        profile: "fast"',
          '        interval_ms: -5',
          '',
        ].join('\n'),
        'utf8'
      );

      const badVal = await callJson('validate_ros_model', {
        model_path: pkgPath,
        workspace_dir: wsDir,
      });
      const badDiags = (badVal.body.diagnostics as { message?: string }[]) || [];
      assert.strictEqual(badVal.body.isValid, false, `Expected invalid @probe: ${JSON.stringify(badVal.body)}`);
      assert.ok(
        badDiags.some((d) => String(d.message || '').includes('interval_ms must be > 0')),
        `Expected external plugin validation diagnostic: ${JSON.stringify(badDiags)}`
      );

      // 3. Fix @probe via schema-derived tool + add @overlap via ros_set_extension_block + round-trip ros_get_extension_block
      const setProbeRes = await callJson('de_example_extprobe__set_probe', {
        model_path: pkgPath,
        target_kind: 'Node',
        target_name: 'cam_node',
        profile: 'fast',
        interval_ms: 25,
        enabled: true,
        workspace_dir: wsDir,
      });
      assert.strictEqual(setProbeRes.isError, false, JSON.stringify(setProbeRes));
      assert.strictEqual(setProbeRes.body.success, true, JSON.stringify(setProbeRes.body));

      const setOverlapRes = await callJson('ros_set_extension_block', {
        model_path: pkgPath,
        block_name: 'overlap',
        entries: { note: 'merged' },
        target_kind: 'Node',
        target_name: 'cam_node',
        workspace_dir: wsDir,
      });
      assert.strictEqual(setOverlapRes.body.success, true, JSON.stringify(setOverlapRes.body));

      const getProbeRes = await callJson('ros_get_extension_block', {
        model_path: pkgPath,
        block_name: 'probe',
        target_kind: 'Node',
        target_name: 'cam_node',
        workspace_dir: wsDir,
      });
      assert.strictEqual(getProbeRes.body.found, true, JSON.stringify(getProbeRes.body));
      assert.strictEqual((getProbeRes.body.entries as Record<string, unknown>).profile, 'fast');
      assert.strictEqual((getProbeRes.body.entries as Record<string, unknown>).interval_ms, 25);

      const okVal = await callJson('validate_ros_model', {
        model_path: pkgPath,
        workspace_dir: wsDir,
      });
      assert.strictEqual(okVal.body.isValid, true, JSON.stringify(okVal.body));

      // 4. Invoke plugin custom tool (de_example_extprobe__inspect_probe)
      const inspectRes = await callJson('de_example_extprobe__inspect_probe', {
        model_path: pkgPath,
        filePath: pkgPath,
        label: 'ci-check',
        workspace_dir: wsDir,
      });
      assert.strictEqual(inspectRes.isError, false, JSON.stringify(inspectRes));
      const inspectData = (inspectRes.body.data || {}) as Record<string, unknown>;
      assert.strictEqual(inspectData.pluginId, 'de.example.extprobe');
      assert.strictEqual(inspectData.label, 'ci-check');

      // 5. Generate package outputs and verify merged PackageBuild entries from both external plugins
      const pkgGenRes = await callJson('generate_plugin_outputs', {
        model_path: pkgPath,
        language: 'cpp',
        ros_distro: 'jazzy',
        workspace_dir: wsDir,
      });
      assert.strictEqual(pkgGenRes.isError, false, JSON.stringify(pkgGenRes));
      assert.deepStrictEqual(
        pkgGenRes.body.notices,
        ["[de.example.extprobe] probe profile 'fast' generated for probe_demo"],
        JSON.stringify(pkgGenRes.body)
      );
      const pkgGenDir = path.join(wsDir, 'src-gen', 'probe_demo');
      const probeTxt = fs.readFileSync(
        path.join(pkgGenDir, 'plugins', 'de.example.extprobe', 'probe_fast.txt'),
        'utf8'
      );
      assert.ok(probeTxt.includes('profile=fast') && probeTxt.includes('distro=jazzy'), probeTxt);
      assert.ok(
        fs.existsSync(path.join(pkgGenDir, 'plugins', 'de.example.extoverlap', 'overlap.txt')),
        'Expected overlap.txt from ExternalOverlapPlugin'
      );
      const pkgXml = fs.readFileSync(path.join(pkgGenDir, 'package.xml'), 'utf8');
      const cmakeTxt = fs.readFileSync(path.join(pkgGenDir, 'CMakeLists.txt'), 'utf8');
      assert.strictEqual(
        pkgXml.split('<depend>std_msgs</depend>').length - 1,
        1,
        `std_msgs dependency must deduplicate by set union:\n${pkgXml}`
      );
      assert.ok(pkgXml.includes('<depend>rclcpp</depend>'), pkgXml);
      assert.strictEqual(
        cmakeTxt.split('find_package(std_msgs REQUIRED)').length - 1,
        1,
        `std_msgs find_package must deduplicate by set union:\n${cmakeTxt}`
      );
      assert.ok(
        cmakeTxt.indexOf('share/${PROJECT_NAME}/extprobe') <
          cmakeTxt.indexOf('share/${PROJECT_NAME}/extoverlap'),
        `install(DIRECTORY) rules must append in dependency/plugin order:\n${cmakeTxt}`
      );

      // 6. Author .rossystem referencing cam_node, set @probe on System, and generate system outputs
      const sysPath = path.join(wsDir, 'probe_sys.rossystem');
      fs.writeFileSync(
        sysPath,
        [
          'probe_sys:',
          '  nodes:',
          '    cam_inst:',
          '      from: "probe_demo.cam_node"',
          '      parameters:',
          '        - cam_rate: "cam_art::cam_rate"',
          '          value: 20',
          '',
        ].join('\n'),
        'utf8'
      );

      const sysSetRes = await callJson('de_example_extprobe__set_probe', {
        model_path: sysPath,
        target_kind: 'System',
        target_name: 'probe_sys',
        profile: 'sys_hi',
        interval_ms: 40,
        workspace_dir: wsDir,
      });
      assert.strictEqual(sysSetRes.isError, false, JSON.stringify(sysSetRes));
      assert.strictEqual(sysSetRes.body.success, true, JSON.stringify(sysSetRes.body));

      const sysGenRes = await callJson('generate_plugin_outputs', {
        model_path: sysPath,
        ros_distro: 'jazzy',
        workspace_dir: wsDir,
      });
      assert.strictEqual(sysGenRes.isError, false, JSON.stringify(sysGenRes));
      assert.deepStrictEqual(
        sysGenRes.body.notices,
        ["[de.example.extprobe] system probe 'sys_hi' generated"],
        JSON.stringify(sysGenRes.body)
      );
      const sysGenDir = path.join(wsDir, 'src-gen', 'probe_sys');
      const sysProbeYaml = fs.readFileSync(
        path.join(sysGenDir, 'config', 'de_example_extprobe', 'system_probe.yaml'),
        'utf8'
      );
      assert.ok(sysProbeYaml.includes('profile: sys_hi'), sysProbeYaml);
      assert.ok(sysProbeYaml.includes('resolved_packages: [probe_demo]'), sysProbeYaml);
      assert.ok(sysProbeYaml.includes('resolved_nodes: [cam_node[cam_rate]]'), sysProbeYaml);
      assert.ok(sysProbeYaml.includes('cam_inst') && sysProbeYaml.includes('params=[cam_rate]'), sysProbeYaml);
      assert.ok(
        fs.existsSync(path.join(sysGenDir, 'launch', 'de_example_extprobe', 'probe.launch.py')),
        'Expected plugin launch file in launch/de_example_extprobe/'
      );
      const mainLaunch = fs.readFileSync(
        path.join(sysGenDir, 'launch', 'probe_sys.launch.py'),
        'utf8'
      );
      assert.ok(mainLaunch.includes('IncludeLaunchDescription('), mainLaunch);
      assert.ok(mainLaunch.includes('/launch/de_example_extprobe/probe.launch.py'), mainLaunch);
      assert.ok(mainLaunch.includes("TextSubstitution(text=\"sys_hi\")"), mainLaunch);

      // 7. Verify generate_rossystem_code also invokes system plugins directly
      fs.rmSync(sysGenDir, { recursive: true, force: true });
      const rawSysGenRes = await callJson('generate_rossystem_code', {
        model_path: sysPath,
        workspace_dir: wsDir,
      });
      assert.strictEqual(rawSysGenRes.isError, false, JSON.stringify(rawSysGenRes));
      assert.deepStrictEqual(
        rawSysGenRes.body.notices,
        ["[de.example.extprobe] system probe 'sys_hi' generated"],
        JSON.stringify(rawSysGenRes.body)
      );
      assert.ok(
        fs.existsSync(path.join(sysGenDir, 'config', 'de_example_extprobe', 'system_probe.yaml')),
        'generate_rossystem_code must write plugin config YAML'
      );
      assert.ok(
        fs.readFileSync(path.join(sysGenDir, 'launch', 'probe_sys.launch.py'), 'utf8').includes(
          'IncludeLaunchDescription('
        ),
        'generate_rossystem_code must render plugin launch include'
      );

      // 8. Verify outputRoot propagation & prune ordering via GenerationContext.readOwnedFile
      // 8a. Rotate @probe profile fast -> slow on pkgPath; generate_plugin_outputs must read snapshot_fast.txt
      // before deletePrunedFiles removes it from disk.
      const rotateSetRes = await callJson('de_example_extprobe__set_probe', {
        model_path: pkgPath,
        target_kind: 'Node',
        target_name: 'cam_node',
        profile: 'slow',
        interval_ms: 50,
        workspace_dir: wsDir,
      });
      assert.strictEqual(rotateSetRes.isError, false, JSON.stringify(rotateSetRes));
      const rotateGenRes = await callJson('generate_plugin_outputs', {
        model_path: pkgPath,
        language: 'cpp',
        ros_distro: 'jazzy',
        workspace_dir: wsDir,
      });
      assert.strictEqual(rotateGenRes.isError, false, JSON.stringify(rotateGenRes));
      assert.deepStrictEqual(
        rotateGenRes.body.notices,
        [
          "[de.example.extprobe] rotated probe profile from 'fast' (had_old=true) to 'slow'",
          "[de.example.extprobe] probe profile 'slow' generated for probe_demo",
        ],
        JSON.stringify(rotateGenRes.body)
      );
      const prunedFiles = (rotateGenRes.body.prunedFiles || []) as string[];
      assert.ok(
        prunedFiles.some((p) => p.endsWith('plugins/de_example_extprobe/snapshot_fast.txt')),
        `Expected snapshot_fast.txt in prunedFiles, got: ${JSON.stringify(prunedFiles)}`
      );
      assert.ok(
        !fs.existsSync(path.join(pkgGenDir, 'plugins', 'de_example_extprobe', 'snapshot_fast.txt')),
        'snapshot_fast.txt must be deleted from disk after generate_plugin_outputs'
      );

      // 8b. generate_ros2_wrappers re-run must pass pkgDir outputRoot and read probe_state.txt
      const rawPkgReRun = await callJson('generate_ros2_wrappers', {
        model_path: pkgPath,
        language: 'cpp',
        ros_distro: 'jazzy',
        workspace_dir: wsDir,
      });
      assert.strictEqual(rawPkgReRun.isError, false, JSON.stringify(rawPkgReRun));
      assert.deepStrictEqual(
        rawPkgReRun.body.notices,
        [
          "[de.example.extprobe] regenerated probe profile 'slow'",
          "[de.example.extprobe] probe profile 'slow' generated for probe_demo",
        ],
        JSON.stringify(rawPkgReRun.body)
      );

      // 8c. Re-running generate_plugin_outputs and generate_rossystem_code without rmSync must pass sysGen parent (src-gen) as outputRoot
      const sysReGenRes = await callJson('generate_plugin_outputs', {
        model_path: sysPath,
        ros_distro: 'jazzy',
        workspace_dir: wsDir,
      });
      assert.strictEqual(sysReGenRes.isError, false, JSON.stringify(sysReGenRes));
      assert.deepStrictEqual(
        sysReGenRes.body.notices,
        [
          '[de.example.extprobe] prev_system_profile=sys_hi',
          "[de.example.extprobe] system probe 'sys_hi' generated",
        ],
        JSON.stringify(sysReGenRes.body)
      );

      const rawSysReGenRes = await callJson('generate_rossystem_code', {
        model_path: sysPath,
        workspace_dir: wsDir,
      });
      assert.strictEqual(rawSysReGenRes.isError, false, JSON.stringify(rawSysReGenRes));
      assert.deepStrictEqual(
        rawSysReGenRes.body.notices,
        [
          '[de.example.extprobe] prev_system_profile=sys_hi',
          "[de.example.extprobe] system probe 'sys_hi' generated",
        ],
        JSON.stringify(rawSysReGenRes.body)
      );
    } finally {
      await client.close();
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
  });

  test('loads external plugin JAR via .vscode/settings.json in workspace', async () => {
    assert.ok(process.env.RT_MCP_BIN || fs.existsSync(JAR), `GLSP server JAR missing at ${JAR}`);
    assert.ok(fs.existsSync(TEST_PLUGIN_JAR), `External test plugin JAR missing at ${TEST_PLUGIN_JAR}`);

    const vscodeWs = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ext-vscode-'));
    fs.mkdirSync(path.join(vscodeWs, '.vscode'), { recursive: true });
    fs.writeFileSync(
      path.join(vscodeWs, '.vscode', 'settings.json'),
      JSON.stringify(
        {
          'rostooling-languages.plugins.paths': [TEST_PLUGIN_JAR],
          'rostooling-languages.plugins.enabled': ['de.example.extprobe'],
        },
        null,
        2
      ),
      'utf8'
    );
    const badPkgPath = path.join(vscodeWs, 'settings_probe.ros2');
    fs.writeFileSync(
      badPkgPath,
      [
        'settings_probe:',
        '  artifacts:',
        '    art1:',
        '      node: node1',
        '      @probe:',
        '        profile: "vs"',
        '        interval_ms: 0',
        '',
      ].join('\n'),
      'utf8'
    );

    const env = cleanPluginEnv();
    env.ROS_GLSP_PORT = String(7450 + Math.floor(Math.random() * 400));
    const client = new Client({ name: 'ext-plugin-vscode-client', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: BIN_ARGS,
        cwd: vscodeWs,
        env,
        stderr: process.env.RT_MCP_DEBUG ? 'inherit' : 'ignore',
      })
    );

    try {
      const toolNames = (await client.listTools()).tools.map((t) => t.name);
      assert.ok(toolNames.includes('de_example_extprobe__inspect_probe'), toolNames.join(', '));
      assert.ok(toolNames.includes('de_example_extprobe__set_probe'), toolNames.join(', '));
      assert.ok(!toolNames.includes('de_example_extoverlap__set_overlap'), 'Unenabled plugin must remain inactive');

      const valRes = (await client.callTool({
        name: 'validate_ros_model',
        arguments: { model_path: badPkgPath, workspace_dir: vscodeWs },
      })) as { content: { type: string; text: string }[] };
      const parsed = JSON.parse(valRes.content[0].text) as { isValid: boolean; diagnostics: { message?: string }[] };
      assert.strictEqual(parsed.isValid, false, JSON.stringify(parsed));
      assert.ok(
        parsed.diagnostics.some((d) => String(d.message || '').includes('interval_ms must be > 0')),
        JSON.stringify(parsed)
      );
    } finally {
      await client.close();
      fs.rmSync(vscodeWs, { recursive: true, force: true });
    }
  });

  test('no-plugin language="both" preserves edited logic files and keeps node files across generate_ros2_wrappers, generate_plugin_outputs, and extension command', async () => {
    assert.ok(process.env.RT_MCP_BIN || fs.existsSync(JAR), `GLSP server JAR missing at ${JAR}`);

    // Safeguard check: PostProcessor only allows deleting inside config/<pf>/, launch/<pf>/, plugins/<pf>/
    for (const disallowedPath of [
      'demo_pkg/demo_pkg/talker_logic.py',
      'demo_pkg/include/demo_pkg/TalkerArtAlgorithm.hpp',
      'demo_pkg/include/demo_pkg/helper.hpp',
      'demo_pkg/src/TalkerArtWrapper.cpp',
      'demo_pkg/src/helpers.cpp',
      'demo_pkg/test/test_helper.cpp',
      'demo_pkg/config/other.yaml',
      'demo_pkg/CMakeLists.txt',
      'demo_pkg/package.xml',
      'demo_pkg/launch/demo_sys.launch.py',
      'demo_pkg/resource/demo_pkg',
    ]) {
      assert.strictEqual(isPluginOwnedPrunePath(disallowedPath), false, `Must refuse path: ${disallowedPath}`);
    }
    assert.strictEqual(isPluginOwnedPrunePath('demo_pkg/plugins/de_example_extprobe/old.txt'), true);
    assert.strictEqual(isPluginOwnedPrunePath('demo_sys/config/de_example_extprobe/old.yaml'), true);
    assert.strictEqual(isPluginOwnedPrunePath('demo_sys/launch/de_example_extprobe/old.launch.py'), true);

    const pruneGuardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-prune-guard-'));
    try {
      const keepHelper = path.join(pruneGuardDir, 'demo_pkg', 'src', 'helpers.cpp');
      const keepOtherCfg = path.join(pruneGuardDir, 'demo_pkg', 'config', 'other.yaml');
      const stalePluginTxt = path.join(pruneGuardDir, 'demo_pkg', 'plugins', 'de_example_extprobe', 'old.txt');
      const stalePluginCfg = path.join(pruneGuardDir, 'demo_pkg', 'config', 'de_example_extprobe', 'old.yaml');
      const stalePluginLaunch = path.join(pruneGuardDir, 'demo_pkg', 'launch', 'de_example_extprobe', 'old.launch.py');
      for (const p of [keepHelper, keepOtherCfg, stalePluginTxt, stalePluginCfg, stalePluginLaunch]) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, 'content\n', 'utf8');
      }
      const deletedByPrune = await deletePrunedFiles(pruneGuardDir, [
        'demo_pkg/src/helpers.cpp',
        'demo_pkg/config/other.yaml',
        'demo_pkg/plugins/de_example_extprobe/old.txt',
        'demo_pkg/config/de_example_extprobe/old.yaml',
        'demo_pkg/launch/de_example_extprobe/old.launch.py',
      ]);
      assert.ok(fs.existsSync(keepHelper), 'deletePrunedFiles must never delete src/helpers.cpp');
      assert.ok(fs.existsSync(keepOtherCfg), 'deletePrunedFiles must never delete config/other.yaml');
      assert.strictEqual(fs.existsSync(stalePluginTxt), false);
      assert.strictEqual(fs.existsSync(stalePluginCfg), false);
      assert.strictEqual(fs.existsSync(stalePluginLaunch), false);
      assert.deepStrictEqual(deletedByPrune, [
        'demo_pkg/plugins/de_example_extprobe/old.txt',
        'demo_pkg/config/de_example_extprobe/old.yaml',
        'demo_pkg/launch/de_example_extprobe/old.launch.py',
      ]);
    } finally {
      fs.rmSync(pruneGuardDir, { recursive: true, force: true });
    }

    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-both-shield-'));
    const pkgPath = path.join(ws, 'both_shield.ros2');
    fs.writeFileSync(
      pkgPath,
      [
        'both_shield:',
        '  artifacts:',
        '    talker_art:',
        '      node: talker',
        '      publishers:',
        '        chatter:',
        '          type: "std_msgs/msg/String"',
        '',
      ].join('\n'),
      'utf8'
    );

    const env = cleanPluginEnv();
    env.ROS_GLSP_PORT = String(7900 + Math.floor(Math.random() * 400));
    const client = new Client({ name: 'no-plugin-both-client', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: BIN_ARGS,
        cwd: ws,
        env,
        stderr: process.env.RT_MCP_DEBUG ? 'inherit' : 'ignore',
      })
    );

    const callJson = async (name: string, args: Record<string, unknown>) => {
      const res = (await client.callTool({ name, arguments: args })) as {
        content: { type: string; text: string }[];
        isError?: boolean;
      };
      return {
        isError: Boolean(res.isError),
        body: JSON.parse(res.content[0].text) as Record<string, unknown>,
      };
    };

    const pkgGenDir = path.join(ws, 'src-gen', 'both_shield');
    const logicPyPath = path.join(pkgGenDir, 'both_shield', 'talker_logic.py');
    const algoHppPath = path.join(pkgGenDir, 'include', 'both_shield', 'TalkerArtAlgorithm.hpp');
    const customLogicPy = '# USER CUSTOM PYTHON LOGIC — MUST SURVIVE\n';
    const customAlgoHpp = '// USER CUSTOM CPP ALGORITHM — MUST SURVIVE\n';

    const lspClient = new HeadlessLspClient(undefined, JAR);

    try {
      // 1. Fresh "both" run via generate_ros2_wrappers leaves node files on disk
      const freshBoth = await callJson('generate_ros2_wrappers', {
        model_path: pkgPath,
        language: 'both',
        ros_distro: 'jazzy',
        workspace_dir: ws,
      });
      assert.strictEqual(freshBoth.isError, false, JSON.stringify(freshBoth));
      assert.deepStrictEqual(freshBoth.body.prunedFiles, [], JSON.stringify(freshBoth.body));
      assert.deepStrictEqual(freshBoth.body.notices, [], JSON.stringify(freshBoth.body));
      assert.ok(fs.existsSync(path.join(pkgGenDir, 'both_shield', 'talker_wrapper.py')), 'Fresh both must leave wrapper on disk');
      assert.ok(fs.existsSync(logicPyPath), 'Fresh both must create talker_logic.py');

      // 2. Generate with "python", edit talker_logic.py, and seed edited TalkerArtAlgorithm.hpp
      const pyGen = await callJson('generate_ros2_wrappers', {
        model_path: pkgPath,
        language: 'python',
        ros_distro: 'jazzy',
        workspace_dir: ws,
      });
      assert.strictEqual(pyGen.isError, false, JSON.stringify(pyGen));
      fs.writeFileSync(logicPyPath, customLogicPy, 'utf8');
      fs.mkdirSync(path.dirname(algoHppPath), { recursive: true });
      fs.writeFileSync(algoHppPath, customAlgoHpp, 'utf8');

      // 3. Re-run generate_ros2_wrappers with "both"
      const reBoth = await callJson('generate_ros2_wrappers', {
        model_path: pkgPath,
        language: 'both',
        ros_distro: 'jazzy',
        workspace_dir: ws,
      });
      assert.strictEqual(reBoth.isError, false, JSON.stringify(reBoth));
      assert.deepStrictEqual(reBoth.body.prunedFiles, [], JSON.stringify(reBoth.body));
      assert.strictEqual(fs.readFileSync(logicPyPath, 'utf8'), customLogicPy);
      assert.strictEqual(fs.readFileSync(algoHppPath, 'utf8'), customAlgoHpp);
      assert.ok(fs.existsSync(path.join(pkgGenDir, 'both_shield', 'talker_wrapper.py')));
      assert.ok(fs.existsSync(path.join(pkgGenDir, 'both_shield', 'talker_runner.py')));

      // 4. Re-run generate_plugin_outputs with "both" (default)
      const pluginBoth = await callJson('generate_plugin_outputs', {
        model_path: pkgPath,
        language: 'both',
        ros_distro: 'jazzy',
        workspace_dir: ws,
      });
      assert.strictEqual(pluginBoth.isError, false, JSON.stringify(pluginBoth));
      assert.deepStrictEqual(pluginBoth.body.prunedFiles, [], JSON.stringify(pluginBoth.body));
      assert.deepStrictEqual(pluginBoth.body.notices, [], JSON.stringify(pluginBoth.body));
      assert.strictEqual(fs.readFileSync(logicPyPath, 'utf8'), customLogicPy);
      assert.strictEqual(fs.readFileSync(algoHppPath, 'utf8'), customAlgoHpp);
      assert.ok(fs.existsSync(path.join(pkgGenDir, 'both_shield', 'talker_wrapper.py')));

      // 5. Re-run the extension command path directly (ros2.generateWrappersServer + deletePrunedFiles + processAndWriteFiles)
      await lspClient.start(ws);
      await lspClient.openDocument(pkgPath, 'ros2');
      const srcGenDir = path.join(ws, 'src-gen');
      const existing = await scanExistingFiles(pkgGenDir, 'both_shield');
      const cmdRes = await lspClient.executeCommand<{
        files?: Record<string, string>;
        prunedFiles?: string[];
        error?: string;
      }>('ros2.generateWrappersServer', [pathToFileURL(pkgPath).href, ['talker_art'], 'both', 'jazzy', existing]);
      assert.ok(!cmdRes.error, cmdRes.error);
      assert.deepStrictEqual(cmdRes.prunedFiles, [], JSON.stringify(cmdRes.prunedFiles));
      const deleted = await deletePrunedFiles(srcGenDir, cmdRes.prunedFiles);
      assert.deepStrictEqual(deleted, []);
      await processAndWriteFiles(srcGenDir, cmdRes.files || {}, false);
      assert.strictEqual(fs.readFileSync(logicPyPath, 'utf8'), customLogicPy);
      assert.strictEqual(fs.readFileSync(algoHppPath, 'utf8'), customAlgoHpp);
      assert.ok(fs.existsSync(path.join(pkgGenDir, 'both_shield', 'talker_wrapper.py')));
    } finally {
      await lspClient.stop().catch(() => undefined);
      await client.close();
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
