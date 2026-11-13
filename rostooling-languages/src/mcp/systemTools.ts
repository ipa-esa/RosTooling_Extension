import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { GGraph, GModelElement, GlspClientBridge } from '../glsp/GlspClientBridge.js';
import { renderDiagramSvg } from '../glsp/GGraphSvgRenderer.js';
import {
  Bridge,
  ModelSession,
  ToolOutcome,
  asMcpResult as asResult,
  commitModel as commit,
  failOutcome as fail,
  runOperation,
  summarizeMarkers,
  walkGModel as walk,
  withModel,
} from './mcpGlspSession.js';

// ============================================================================
// Coordinate-free, semantic MCP tools for .rossystem compositions.
//
// Every tool is a thin client of the Java GLSP/Xtext server: it dispatches a GLSP operation
// (createNode / createEdge / editRosProperty / deleteElement) that the server applies to the
// Ecore model, asks the server for the resulting surgical span edits (requestRosTextEdits),
// writes the server-produced text and re-parses it to verify the effect and collect Xtext
// validation markers. No DSL text is parsed or emitted in TypeScript, and no coordinates or
// .layout sidecars are involved: placement is ELK auto-layout on the server.
// ============================================================================

export type { ToolOutcome };
type SystemSession = ModelSession;

const PORT_KIND: Record<string, string> = {
  'port:pub': 'publisher',
  'port:sub': 'subscriber',
  'port:ss': 'service_server',
  'port:sc': 'service_client',
  'port:as': 'action_server',
  'port:ac': 'action_client',
};

/** Top-level ROS node elements of the system (subsystem members are scoped and excluded). */
function systemNodes(graph: GGraph): GModelElement[] {
  return walk(graph, (e) => e.type === 'node:ros-node' && !String(e.id).includes('::'));
}

function findNode(graph: GGraph, name: string): GModelElement | undefined {
  return systemNodes(graph).find((n) => n.args?.nodeName === name);
}

function portsOf(node: GModelElement): GModelElement[] {
  return walk(node, (e) => e.type in PORT_KIND);
}

function describeNode(node: GModelElement): Record<string, unknown> {
  // parametersJson: {name: value} of the node type's declared parameters, overridden by the
  // instance's values.
  let parameters: Record<string, string> = {};
  try {
    parameters = JSON.parse(String(node.args?.parametersJson || '{}'));
  } catch {
    parameters = {};
  }
  return {
    name: node.args?.nodeName,
    from: node.args?.from,
    namespace: node.args?.namespace || undefined,
    interfaces: portsOf(node).map((p) => ({
      ref: `${node.args?.nodeName}.${p.args?.interfaceName}`,
      kind: PORT_KIND[p.type],
      type: p.args?.specName,
    })),
    parameters,
  };
}

/** Resolves "node.interface" to the GGraph port of a top-level node. */
function findPort(graph: GGraph, ref: string): GModelElement | undefined {
  const dot = ref.indexOf('.');
  if (dot <= 0) return undefined;
  const node = findNode(graph, ref.slice(0, dot));
  const iface = ref.slice(dot + 1);
  return node ? portsOf(node).find((p) => p.args?.interfaceName === iface) : undefined;
}

function connections(graph: GGraph): { id: string; from: string; to: string }[] {
  const portRef = new Map<string, string>();
  for (const n of systemNodes(graph)) {
    for (const p of portsOf(n)) portRef.set(p.id, `${n.args?.nodeName}.${p.args?.interfaceName}`);
  }
  return walk(graph, (e) => e.type === 'edge:ros-connection').map((e) => ({
    id: e.id,
    from: portRef.get(String(e.sourceId)) || String(e.sourceId),
    to: portRef.get(String(e.targetId)) || String(e.targetId),
  }));
}

function processes(graph: GGraph): { id: string; name: string; threads: unknown; nodes: string[] }[] {
  return walk(graph, (e) => e.type === 'node:process').map((p) => {
    let members: { id?: string; name?: string }[] = [];
    try {
      members = JSON.parse(String(p.args?.membersJson || '[]'));
    } catch {
      members = [];
    }
    return {
      id: p.id,
      name: String(p.args?.processName || ''),
      threads: p.args?.threads,
      nodes: members.map((m) => String(m.name || '')),
    };
  });
}

function withSystem(
  bridge: Bridge,
  systemPath: string,
  mustExist: boolean,
  body: (s: SystemSession) => Promise<ToolOutcome>
): Promise<ToolOutcome> {
  return withModel(bridge, systemPath, ['.rossystem'], mustExist, 'mcp_system', body);
}

// ---------------------------------------------------------------------------
// Tool implementations (exported for tests and other hosts)
// ---------------------------------------------------------------------------

export async function addNode(
  bridge: Bridge,
  p: {
    system_path: string;
    node_name: string;
    from: string;
    namespace?: string;
    system_name?: string;
    from_file?: string;
  }
): Promise<ToolOutcome> {
  return withSystem(bridge, p.system_path, false, async (s) => {
    const existing = findNode(s.graph, p.node_name);
    if (existing) {
      return fail(s, `Node '${p.node_name}' already exists in ${path.basename(s.file)}.`, { node: describeNode(existing) });
    }
    if (p.system_name) {
      await runOperation(bridge, s, { kind: 'editRosProperty', elementId: 'root', property: 'name', value: p.system_name });
    }
    if (p.from_file) {
      await runOperation(bridge, s, { kind: 'editRosProperty', elementId: 'root', property: 'fromFile', value: p.from_file });
    }
    const args: Record<string, string> = { nodeName: p.node_name, from: p.from };
    if (p.namespace) args.namespace = p.namespace;
    await runOperation(bridge, s, { kind: 'createNode', elementTypeId: 'node:ros-node', args });
    const { changed, graph, markers } = await commit(bridge, s);
    const node = findNode(graph, p.node_name);
    if (!node) {
      return fail(s, `Node '${p.node_name}' was not created. Check that '${p.from}' names "<package>.<node>" of a .ros2 model in the workspace.`, summarizeMarkers(markers));
    }
    const m = summarizeMarkers(markers);
    return { success: m.errors.length === 0, file: s.file, created: !s.existed, changed, node: describeNode(node), ...m };
  });
}

export async function addSubSystem(
  bridge: Bridge,
  p: { system_path: string; subsystem_name: string; system_name?: string; from_file?: string }
): Promise<ToolOutcome> {
  return withSystem(bridge, p.system_path, false, async (s) => {
    const existing = walk(
      s.graph,
      (e) => e.type === 'node:subsystem' && e.args?.subSystemName === p.subsystem_name
    )[0];
    if (existing) {
      return fail(s, `Subsystem '${p.subsystem_name}' already exists in ${path.basename(s.file)}.`);
    }
    if (p.system_name) {
      await runOperation(bridge, s, { kind: 'editRosProperty', elementId: 'root', property: 'name', value: p.system_name });
    }
    if (p.from_file) {
      await runOperation(bridge, s, { kind: 'editRosProperty', elementId: 'root', property: 'fromFile', value: p.from_file });
    }
    await runOperation(bridge, s, {
      kind: 'createNode',
      elementTypeId: 'node:subsystem',
      args: { subSystemName: p.subsystem_name },
    });
    const { changed, graph, markers } = await commit(bridge, s);
    const createdSub = walk(
      graph,
      (e) => e.type === 'node:subsystem' && e.args?.subSystemName === p.subsystem_name
    )[0];
    const m = summarizeMarkers(markers);
    if (!createdSub) {
      return fail(s, `Subsystem '${p.subsystem_name}' was not created.`, m);
    }
    return {
      success: m.errors.length === 0,
      file: s.file,
      created: !s.existed,
      changed,
      subsystem: { name: p.subsystem_name, id: createdSub.id },
      ...m,
    };
  });
}

export async function setSystemProperty(
  bridge: Bridge,
  p: { system_path: string; property: 'name' | 'fromFile'; value: string }
): Promise<ToolOutcome> {
  return withSystem(bridge, p.system_path, true, async (s) => {
    await runOperation(bridge, s, {
      kind: 'editRosProperty',
      elementId: 'root',
      property: p.property,
      value: p.value,
    });
    const { changed, markers } = await commit(bridge, s);
    const m = summarizeMarkers(markers);
    return {
      success: m.errors.length === 0,
      file: s.file,
      changed,
      property: p.property,
      value: p.value,
      ...m,
    };
  });
}

export async function connectInterfaces(
  bridge: Bridge,
  p: { system_path: string; from: string; to: string }
): Promise<ToolOutcome> {
  return withSystem(bridge, p.system_path, true, async (s) => {
    const src = findPort(s.graph, p.from);
    const tgt = findPort(s.graph, p.to);
    if (!src || !tgt) {
      const available = systemNodes(s.graph).flatMap((n) => (describeNode(n).interfaces as { ref: string }[]).map((i) => i.ref));
      return fail(s, `Unknown interface ${!src ? `'${p.from}'` : `'${p.to}'`}; use "<node>.<interface>".`, { available });
    }
    // The server normalizes the direction (e.g. service server/client order), so match both.
    const same = (c: { from: string; to: string }) => (c.from === p.from && c.to === p.to) || (c.from === p.to && c.to === p.from);
    if (connections(s.graph).some(same)) {
      return fail(s, `Connection ${p.from} -> ${p.to} already exists.`);
    }
    await runOperation(bridge, s, { kind: 'createEdge', elementTypeId: 'edge:ros-connection', sourceElementId: src.id, targetElementId: tgt.id, args: {} });
    const { changed, graph, markers } = await commit(bridge, s);
    const made = connections(graph).find(same);
    const m = summarizeMarkers(markers);
    if (!made) {
      return fail(s, `The server rejected ${p.from} -> ${p.to} (incompatible interface kinds or message types?).`, m);
    }
    return { success: m.errors.length === 0, file: s.file, changed, connection: { from: made.from, to: made.to }, ...m };
  });
}

export async function setParameter(
  bridge: Bridge,
  p: { system_path: string; node: string; parameter: string; value: string; type_hint?: string }
): Promise<ToolOutcome> {
  return withSystem(bridge, p.system_path, true, async (s) => {
    const node = findNode(s.graph, p.node);
    if (!node) return fail(s, `Unknown node '${p.node}'.`, { nodes: systemNodes(s.graph).map((n) => n.args?.nodeName) });
    const declared = describeNode(node).parameters as Record<string, string>;
    if (!(p.parameter in declared)) {
      return fail(s, `Parameter '${p.parameter}' is not declared by the node type of '${p.node}'.`, { parameters: declared });
    }
    await runOperation(bridge, s, {
      kind: 'editRosProperty', elementId: p.node, property: 'parameter', key: p.parameter, value: p.value,
      ...(p.type_hint ? { valueType: p.type_hint } : {}),
    });
    const { changed, graph, markers } = await commit(bridge, s);
    const after = findNode(graph, p.node);
    const params = (after ? describeNode(after).parameters : {}) as Record<string, string>;
    const m = summarizeMarkers(markers);
    if (!(p.parameter in params)) {
      return fail(s, `Parameter '${p.parameter}' is not declared by the node type of '${p.node}'.`, { parameters: params, ...m });
    }
    if (!changed && params[p.parameter] !== p.value) {
      return fail(s, `The server did not set '${p.node}.${p.parameter}'.`, { parameters: params, ...m });
    }
    return { success: m.errors.length === 0, file: s.file, changed, parameter: { node: p.node, name: p.parameter, value: params[p.parameter] }, ...m };
  });
}

export async function addProcess(
  bridge: Bridge,
  p: { system_path: string; process_name: string; nodes: string[]; threads?: number }
): Promise<ToolOutcome> {
  return withSystem(bridge, p.system_path, true, async (s) => {
    const missing = p.nodes.filter((n) => !findNode(s.graph, n));
    if (missing.length) return fail(s, `Unknown node(s): ${missing.join(', ')}.`);
    const existing = processes(s.graph).find((x) => x.name === p.process_name);
    if (existing) {
      for (const n of p.nodes.filter((x) => !existing.nodes.includes(x))) {
        await runOperation(bridge, s, { kind: 'editRosProperty', elementId: existing.id, property: 'addNode', value: n });
      }
      if (p.threads !== undefined) {
        await runOperation(bridge, s, { kind: 'editRosProperty', elementId: existing.id, property: 'threads', value: String(p.threads) });
      }
    } else {
      await runOperation(bridge, s, {
        kind: 'createNode', elementTypeId: 'node:process',
        args: { processName: p.process_name, nodes: p.nodes.join(','), threads: String(p.threads ?? 1) },
      });
    }
    const { changed, graph, markers } = await commit(bridge, s);
    const proc = processes(graph).find((x) => x.name === p.process_name);
    const m = summarizeMarkers(markers);
    if (!proc) return fail(s, `Process '${p.process_name}' was not created.`, m);
    return { success: m.errors.length === 0, file: s.file, changed, process: { name: proc.name, threads: proc.threads, nodes: proc.nodes }, ...m };
  });
}

export async function removeElement(
  bridge: Bridge,
  p: { system_path: string; element?: string; from?: string; to?: string }
): Promise<ToolOutcome> {
  return withSystem(bridge, p.system_path, true, async (s) => {
    let elementId: string | undefined;
    let what = '';
    const between = (a: string, b: string) => connections(s.graph).find((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a))?.id;
    if (p.from && p.to) {
      elementId = between(p.from, p.to);
      what = `connection ${p.from} -> ${p.to}`;
    } else if (p.element) {
      what = p.element;
      elementId =
        findNode(s.graph, p.element)?.id ??
        processes(s.graph).find((x) => x.name === p.element)?.id ??
        walk(s.graph, (e) => e.type === 'node:subsystem' && e.args?.subSystemName === p.element)[0]?.id;
      if (!elementId && p.element.includes('->')) {
        const [from, to] = p.element.split('->').map((x) => x.trim());
        elementId = between(from, to);
      }
    } else {
      return fail(s, 'Pass `element` (node, process or subsystem name) or `from` + `to` for a connection.');
    }
    if (!elementId) return fail(s, `Nothing named ${what} in ${path.basename(s.file)}.`);
    await runOperation(bridge, s, { kind: 'deleteElement', elementIds: [elementId] });
    const { changed, graph, markers } = await commit(bridge, s);
    const m = summarizeMarkers(markers);
    if (!changed) return fail(s, `The server did not remove ${what}.`, m);
    return {
      success: m.errors.length === 0, file: s.file, changed, removed: what,
      remaining: { nodes: systemNodes(graph).map((n) => n.args?.nodeName), connections: connections(graph).map(({ from, to }) => ({ from, to })) },
      ...m,
    };
  });
}

export async function exportSystemDiagram(
  bridge: Bridge,
  p: { system_path: string; output_path?: string; dark?: boolean }
): Promise<ToolOutcome> {
  return withSystem(bridge, p.system_path, true, async (s) => {
    const markers = await bridge.requestMarkers(s.clientId);
    const title = path.basename(s.file, '.rossystem');
    const svg = renderDiagramSvg(s.graph, markers, { title, dark: !!p.dark });
    const out = path.resolve(p.output_path || s.file.replace(/\.rossystem$/, '.svg'));
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, svg, 'utf-8');
    const m = summarizeMarkers(markers);
    return {
      success: true, file: s.file, svgPath: out, bytes: Buffer.byteLength(svg),
      nodes: systemNodes(s.graph).map((n) => describeNode(n)),
      connections: connections(s.graph).map(({ from, to }) => ({ from, to })),
      processes: processes(s.graph).map(({ name, threads, nodes }) => ({ name, threads, nodes })),
      ...m,
    };
  });
}

// ---------------------------------------------------------------------------
// MCP registration
// ---------------------------------------------------------------------------

export function registerSystemTools(server: McpServer, getBridge: () => Bridge = () => GlspClientBridge.getInstance()): void {
  const systemPath = z.string().describe('Path to the .rossystem file. ros_add_node creates it when it does not exist.');

  server.tool(
    'ros_add_node',
    'Adds a ROS node instance to a .rossystem composition (creating the file if needed). The node type is referenced as "<package>.<node>" from a .ros2 model in the workspace. No coordinates: the diagram is auto-laid out. Returns the instance\'s interfaces as "<node>.<interface>" refs for ros_connect_interfaces, plus validation errors/warnings.',
    {
      system_path: systemPath,
      node_name: z.string().describe('Instance name in the system, e.g. "lidar".'),
      from: z.string().describe('Node type as "<package>.<node>", e.g. "nav_pkg.lidar_node" (package and node names from the .ros2 model).'),
      namespace: z.string().optional().describe('Optional ROS namespace for this instance.'),
      system_name: z.string().optional().describe('Optional system name (defaults to the file name for a new file).'),
      from_file: z.string().optional().describe('Optional launch file path for `fromFile:` (recommended for valid Xtext models, e.g. "my_bringup/launch/app.launch.py").'),
    },
    async (p) => asResult(await addNode(getBridge(), p))
  );

  server.tool(
    'ros_add_subsystem',
    'Adds a subSystems: entry referencing an existing .rossystem composition in the workspace (creating the parent .rossystem if needed). Runs through the Java GLSP/Xtext server.',
    {
      system_path: systemPath,
      subsystem_name: z.string().describe('Declared system name of the referenced .rossystem model.'),
      system_name: z.string().optional().describe('Optional parent system name (when creating a new .rossystem).'),
      from_file: z.string().optional().describe('Optional launch file path for `fromFile:`.'),
    },
    async (p) => asResult(await addSubSystem(getBridge(), p))
  );

  server.tool(
    'ros_set_system_property',
    'Sets a top-level .rossystem property (`name` or `fromFile`) via the Java GLSP/Xtext server.',
    {
      system_path: systemPath,
      property: z.enum(['name', 'fromFile']).describe('Top-level system property to update.'),
      value: z.string().describe('New value (for `fromFile`, a quoted path containing at least one `/`).'),
    },
    async (p) => asResult(await setSystemProperty(getBridge(), p))
  );

  server.tool(
    'ros_connect_interfaces',
    'Connects two interfaces of node instances in a .rossystem: publisher/subscriber, service server/client or action server/client with the same message type. Interfaces are named "<node>.<interface>" as returned by ros_add_node; the order does not matter (the server stores publisher/server first). The Java/Xtext server checks compatibility and the result lists validation errors.',
    {
      system_path: systemPath,
      from: z.string().describe('One endpoint, e.g. "lidar.scan" (usually the publisher / server side).'),
      to: z.string().describe('Other endpoint, e.g. "planner.scan_in" (usually the subscriber / client side).'),
    },
    async (p) => asResult(await connectInterfaces(getBridge(), p))
  );

  server.tool(
    'ros_set_parameter',
    'Sets the value of a parameter on a node instance in a .rossystem. The parameter must be declared by the node type in its .ros2 model; the value is typed by that declaration (pass type_hint for ambiguous literals, e.g. "double").',
    {
      system_path: systemPath,
      node: z.string().describe('Node instance name, e.g. "lidar".'),
      parameter: z.string().describe('Parameter name as declared in the .ros2 model, e.g. "frame_id".'),
      value: z.string().describe('Value literal, e.g. "laser_link", "10", "0.5", "true".'),
      type_hint: z.enum(['string', 'integer', 'double', 'boolean']).optional().describe('Optional literal type hint.'),
    },
    async (p) => asResult(await setParameter(getBridge(), p))
  );

  server.tool(
    'ros_add_process',
    'Groups node instances of a .rossystem into a process (a composable node container). Creates the process, or adds nodes / sets threads on an existing one.',
    {
      system_path: systemPath,
      process_name: z.string().describe('Process (container) name.'),
      nodes: z.array(z.string()).describe('Node instance names to put into the process.'),
      threads: z.number().int().positive().optional().describe('Executor threads (default 1).'),
    },
    async (p) => asResult(await addProcess(getBridge(), p))
  );

  server.tool(
    'ros_remove_element',
    'Removes a node instance (with its connections and process memberships), a process, a subsystem, or a connection from a .rossystem. Pass `element` for a node/process/subsystem name (or "<node>.<if> -> <node>.<if>"), or `from` + `to` for a connection.',
    {
      system_path: systemPath,
      element: z.string().optional().describe('Node, process or subsystem name.'),
      from: z.string().optional().describe('Connection source "<node>.<interface>".'),
      to: z.string().optional().describe('Connection target "<node>.<interface>".'),
    },
    async (p) => asResult(await removeElement(getBridge(), p))
  );

  server.tool(
    'export_system_diagram',
    'Renders the auto-laid-out (ELK) diagram of a .rossystem as a standalone SVG file and returns a structural summary (nodes with interfaces, connections, processes) plus validation errors/warnings.',
    {
      system_path: systemPath,
      output_path: z.string().optional().describe('Where to write the SVG (default: next to the .rossystem, same base name).'),
      dark: z.boolean().optional().describe('Dark theme.'),
    },
    async (p) => asResult(await exportSystemDiagram(getBridge(), p))
  );
}
