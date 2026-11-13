import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GlspClientBridge, GGraph, GModelElement, RosTextEditsResult } from '../glsp/GlspClientBridge';
import { layoutFromGGraph, renderDiagramSvg } from '../glsp/GGraphSvgRenderer';

/**
 * Block 4 verification gate (headless, against the real Java GLSP/Xtext server):
 *  - GGraph rendering: ELK-layouted GGraph -> geometry + standalone SVG with line jumps
 *  - glspOperation round-trip: operation -> surgical span edits (WorkspaceEdit payload) ->
 *    applied text -> re-parsed model, with the file on disk untouched and comments preserved
 *  - SVG export
 * Runs under `vscode-test` and also under plain mocha (no `vscode` import).
 */

const EXT_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.resolve(EXT_ROOT, '..', 'demo', 'test_ws', 'src', 'mock_robot_system');
const JAR = path.join(EXT_ROOT, 'server', 'rostooling_extension-2.3.5.jar');

function applyEdits(base: string, result: RosTextEditsResult): string {
  let out = '';
  let cursor = 0;
  for (const e of result.edits) {
    assert.ok(e.offset >= cursor, 'edits must be ordered and non-overlapping');
    out += base.slice(cursor, e.offset) + e.text;
    cursor = e.offset + e.length;
  }
  return out + base.slice(cursor);
}

function findAll(el: GModelElement, pred: (e: GModelElement) => boolean, acc: GModelElement[] = []): GModelElement[] {
  for (const c of el.children || []) {
    if (pred(c)) acc.push(c);
    findAll(c, pred, acc);
  }
  return acc;
}

suite('GLSP Integration (Block 4 gate)', function () {
  this.timeout(120000);
  let dir: string;
  let bridge: GlspClientBridge;

  suiteSetup(() => {
    assert.ok(fs.existsSync(JAR), `GLSP server JAR missing at ${JAR}`);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-glsp-it-'));
    for (const f of fs.readdirSync(FIXTURE)) {
      fs.copyFileSync(path.join(FIXTURE, f), path.join(dir, f));
    }
    // Comments that every edit below must preserve.
    const sys = path.join(dir, 'inspection_system.rossystem');
    fs.writeFileSync(sys, '# inspection system header\n' + fs.readFileSync(sys, 'utf-8').replace('    safety_mgr:\n', '    safety_mgr: # safety supervisor instance\n'));
    const ros2 = path.join(dir, 'inspection_nodes.ros2');
    fs.writeFileSync(ros2, '# inspection component contracts\n' + fs.readFileSync(ros2, 'utf-8').replace('            profile: sensor_qos\n', '            profile: sensor_qos # camera QoS\n'));
    bridge = new GlspClientBridge({ port: Number(process.env.ROS_GLSP_IT_PORT) || 5900 + Math.floor(Math.random() * 90), jarPath: JAR });
  });

  suiteTeardown(async () => {
    await bridge?.dispose();
  });

  test('renders the server ELK-layouted GGraph (nodes, ports, routed wires with jumps) and exports SVG', async () => {
    const { graph } = await bridge.openSession('it_render', path.join(dir, 'inspection_system.rossystem'));
    assert.strictEqual(graph.args?.modelKind, 'rossystem');
    const rosNodes = findAll(graph, (e) => e.type === 'node:ros-node');
    const edges = (graph.children || []).filter((e) => e.type === 'edge:ros-connection');
    assert.ok(rosNodes.length >= 3, `expected ROS nodes, got ${rosNodes.length}`);
    assert.ok(edges.length >= 5, `expected connections, got ${edges.length}`);
    assert.ok(rosNodes.every((n) => n.position && n.size), 'every node carries server-side layout');

    const layout = layoutFromGGraph(graph);
    assert.ok(layout.edges.length >= 5);
    assert.ok(layout.edges.every((e) => e.path.startsWith('M ')));
    assert.ok(layout.edges.some((e) => e.path.includes(' A ')), 'expected at least one line-jump bridge');

    const svg = renderDiagramSvg(graph, [], { title: 'inspection_system' });
    assert.ok(svg.startsWith('<svg') && svg.trim().endsWith('</svg>'));
    for (const n of rosNodes) assert.ok(svg.includes(String(n.args?.nodeName)), `SVG lacks node ${n.args?.nodeName}`);
    const out = path.join(dir, 'inspection_system.svg');
    fs.writeFileSync(out, svg);
    assert.ok(fs.statSync(out).size > 1000);
    await bridge.disposeSession('it_render');
  });

  test('.ros2 form operations round-trip as surgical edits without touching the file', async () => {
    const file = path.join(dir, 'inspection_nodes.ros2');
    const before = fs.readFileSync(file, 'utf-8');
    await bridge.openSession('it_ros2', file);

    await bridge.dispatchAction('it_ros2', {
      kind: 'editRosProperty', isOperation: true, elementId: 'ai_defect_detector',
      property: 'addInterface', key: 'status_pub', value: 'inspection_msgs/msg/SafetyStatus', valueType: 'pub',
    });
    await bridge.dispatchAction('it_ros2', {
      kind: 'editRosProperty', isOperation: true, elementId: 'ai_defect_detector.camera_image',
      property: 'qos', key: 'reliability', value: 'best_effort',
    });
    await bridge.dispatchAction('it_ros2', {
      kind: 'editRosProperty', isOperation: true, elementId: 'ai_defect_detector.confidence_threshold',
      property: 'default', value: '0.9',
    });
    const result = await bridge.requestTextEdits('it_ros2');

    assert.strictEqual(fs.readFileSync(file, 'utf-8'), before, 'server must not write the file');
    assert.strictEqual(result.baseText, before);
    assert.ok(result.edits.length >= 3, `expected span edits, got ${result.edits.length}`);
    const after = applyEdits(before, result);
    assert.strictEqual(after, result.newText);
    assert.ok(after.startsWith('# inspection component contracts\n'));
    assert.ok(after.includes('profile: sensor_qos # camera QoS\n            reliability: best_effort'), after);
    assert.ok(after.includes('status_pub:\n          type: "inspection_msgs/msg/SafetyStatus"'), after);
    assert.ok(after.includes('default: 0.9'), after);
    const changedLines = after.split('\n').length - before.split('\n').length;
    assert.ok(changedLines >= 3 && changedLines <= 4, `only inserted lines may be added (got ${changedLines})`);

    // The editor buffer (= `after`) is what the server parses next.
    const graph: GGraph = await bridge.reloadModel('it_ros2', file, after);
    const project = GlspClientBridge.gGraphToRosProject(graph, [], { fileName: file });
    const detector = project.nodes.find((n) => n.label === 'ai_defect_detector');
    assert.ok(detector?.ifaces.some((i) => i.name === 'status_pub' && i.kind === 'pub'));
    assert.strictEqual(detector?.ifaces.find((i) => i.name === 'camera_image')?.qos?.reliability, 'best_effort');
    await bridge.disposeSession('it_ros2');
  });

  test('.rossystem diagram operations (create node, connect ports, delete) round-trip surgically', async () => {
    const file = path.join(dir, 'inspection_system.rossystem');
    let text = fs.readFileSync(file, 'utf-8');
    const onDisk = text;
    await bridge.openSession('it_sys', file);

    await bridge.dispatchAction('it_sys', {
      kind: 'createNode', isOperation: true, elementTypeId: 'node:ros-node',
      args: { nodeName: 'detector_b', from: 'inspection_nodes.ai_defect_detector' },
    });
    let res = await bridge.requestTextEdits('it_sys');
    text = applyEdits(text, res);
    assert.ok(text.includes('    detector_b:\n      from: "inspection_nodes.ai_defect_detector"'), text);

    let graph = await bridge.reloadModel('it_sys', file, text);
    const detector = findAll(graph, (n) => n.type === 'node:ros-node' && n.args?.nodeName === 'detector_b')[0];
    const src = (detector?.children || []).find((p) => p.type === 'port:pub' && p.args?.interfaceName === 'defect_report_pub');
    const tgt = findAll(graph, (p) => p.type === 'port:sub' && p.args?.interfaceName === 'defect_sub')[0];
    assert.ok(src && tgt, 'expected detector_b.defect_report_pub and mission_exec.defect_sub ports');

    await bridge.dispatchAction('it_sys', {
      kind: 'createEdge', isOperation: true, elementTypeId: 'edge:ros-connection',
      sourceElementId: src.id, targetElementId: tgt.id, args: {},
    });
    res = await bridge.requestTextEdits('it_sys');
    text = applyEdits(text, res);
    assert.ok(/- \[ defect_report_pub , defect_sub \]/.test(text), text);
    assert.ok(text.startsWith('# inspection system header\n'));
    assert.ok(text.includes('safety_mgr: # safety supervisor instance'));

    graph = await bridge.reloadModel('it_sys', file, text);
    const edgeCount = (graph.children || []).filter((e) => e.type === 'edge:ros-connection').length;
    const node = findAll(graph, (n) => n.args?.nodeName === 'detector_b')[0];
    await bridge.dispatchAction('it_sys', { kind: 'deleteElement', isOperation: true, elementIds: [node.id] });
    res = await bridge.requestTextEdits('it_sys');
    text = applyEdits(text, res);
    assert.ok(!text.includes('detector_b'), 'node and its connection removed');
    graph = await bridge.reloadModel('it_sys', file, text);
    assert.strictEqual((graph.children || []).filter((e) => e.type === 'edge:ros-connection').length, edgeCount - 1);
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), onDisk, 'server must not write the file');
    await bridge.disposeSession('it_sys');
  });

  test('processes (composable containers) are created and edited surgically', async () => {
    const file = path.join(dir, 'inspection_system.rossystem');
    let text = fs.readFileSync(file, 'utf-8');
    await bridge.openSession('it_proc', file);
    await bridge.dispatchAction('it_proc', {
      kind: 'createNode', isOperation: true, elementTypeId: 'node:process',
      args: { processName: 'fleet_container', threads: '2', nodes: 'fleet_bridge' },
    });
    text = applyEdits(text, await bridge.requestTextEdits('it_proc'));
    assert.ok(text.includes('    fleet_container:\n      nodes: [ fleet_bridge ]\n      threads: 2'), text);
    let graph = await bridge.reloadModel('it_proc', file, text);
    const proc = (graph.children || []).find((e) => e.type === 'node:process' && e.args?.processName === 'safety_process');
    assert.ok(proc, 'safety_process present');
    await bridge.dispatchAction('it_proc', { kind: 'editRosProperty', isOperation: true, elementId: proc.id, property: 'addNode', value: 'mission_exec' });
    await bridge.dispatchAction('it_proc', { kind: 'editRosProperty', isOperation: true, elementId: proc.id, property: 'threads', value: '3' });
    const res = await bridge.requestTextEdits('it_proc');
    text = applyEdits(text, res);
    assert.ok(text.includes('nodes: [ safety_mgr , mission_exec ]'), text);
    assert.ok(text.includes('    safety_process:\n      nodes: [ safety_mgr , mission_exec ]\n      threads: 3'), text);
    graph = await bridge.reloadModel('it_proc', file, text);
    const p2 = (graph.children || []).find((e) => e.type === 'node:process' && e.args?.processName === 'safety_process');
    assert.strictEqual(JSON.parse(String(p2?.args?.membersJson)).length, 2);
    await bridge.disposeSession('it_proc');
  });

  test('requestRosIndex describes packages, specs and systems via Xtext (no TypeScript parsing)', async () => {
    const files = ['inspection_nodes.ros2', 'inspection_msgs.ros', 'inspection_system.rossystem'].map((f) => path.join(dir, f));
    const index = await bridge.requestRosIndex(files);
    const ros2 = index.find((f) => f.path.endsWith('.ros2'));
    const ros = index.find((f) => f.path.endsWith('.ros'));
    const sys = index.find((f) => f.path.endsWith('.rossystem'));
    assert.strictEqual(ros2?.kind, 'ros2');
    assert.ok((ros2?.packages?.[0].artifacts.length || 0) >= 3);
    assert.ok(ros?.packages?.[0].specs.some((s) => s.fullname === 'inspection_msgs/msg/DefectReport'));
    assert.strictEqual(sys?.system?.name, 'inspection_system');
  });
});
