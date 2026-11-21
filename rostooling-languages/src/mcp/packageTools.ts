import * as path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { GGraph, GModelElement, GlspClientBridge } from '../glsp/GlspClientBridge.js';
import { readViewData } from '../glsp/RosViewData.js';
import {
  Bridge,
  ModelSession,
  ToolOutcome,
  asMcpResult,
  commitModel,
  failOutcome,
  runOperation,
  summarizeMarkers,
  walkGModel,
  withModel,
} from './mcpGlspSession.js';

// ============================================================================
// Semantic MCP tools for .ros2 (and .ros1 / .ros) package & node contracts.
//
// Like systemTools.ts, every mutation goes through the Java GLSP/Xtext server
// via editRosProperty / deleteElement and requestRosTextEdits so all Ecore AST
// construction, canonical formatting, surgical span edits, and Xtext checks
// live on the Java server with zero TypeScript DSL serialization.
// ============================================================================

const PACKAGE_EXTENSIONS = ['.ros2', '.ros1', '.ros'];

const QOS_FIELD_KEYS = [
  'profile',
  'history',
  'depth',
  'reliability',
  'durability',
  'liveliness',
  'lease_duration',
  'lifespan',
  'deadline',
] as const;

type QosFieldKey = (typeof QOS_FIELD_KEYS)[number];

interface ParsedInterface {
  id: string;
  kind: string;
  kindCode: string;
  name: string;
  spec: string;
  ns: string;
  qos: Record<string, string>;
  activeStates: string[];
}

interface ParsedParameter {
  id: string;
  name: string;
  type: string;
  typeClass: string;
  default: string;
  hasDefault: boolean;
  ns: string;
  value: string;
}

export interface QosInput {
  profile?: string;
  history?: string;
  depth?: string;
  reliability?: string;
  durability?: string;
  liveliness?: string;
  lease_duration?: string;
  lifespan?: string;
  deadline?: string;
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function packageElements(graph: GGraph): GModelElement[] {
  return walkGModel(graph, (e) => e.type === 'node:ros-package');
}

function artifactElements(graph: GGraph): GModelElement[] {
  return walkGModel(graph, (e) => e.type === 'node:ros-node');
}

function findArtifactElement(graph: GGraph, name: string): GModelElement | undefined {
  const els = artifactElements(graph);
  return (
    els.find((n) => n.args?.nodeName === name || (!isPluginElement(n) && n.args?.artifactName === name)) ||
    els.find((n) => n.args?.artifactName === name)
  );
}

function isPluginElement(el: GModelElement): boolean {
  return readViewData(el, 'plugin') !== undefined;
}

function artifactKey(el: GModelElement): string {
  if (isPluginElement(el)) {
    return String(el.args?.nodeName || el.args?.artifactName || '');
  }
  return String(el.args?.artifactName || el.args?.nodeName || '');
}

function parseInterfaces(artEl: GModelElement): ParsedInterface[] {
  return parseJsonArray<ParsedInterface>(artEl.args?.interfacesJson);
}

function parseParameters(artEl: GModelElement): ParsedParameter[] {
  return parseJsonArray<ParsedParameter>(artEl.args?.parametersJson);
}

function describeArtifact(artEl: GModelElement): Record<string, unknown> {
  const pluginSlots = (readViewData(artEl, 'node')?.pluginSlots || []).map((sl) => ({
    name: sl.name,
    base: sl.base,
    parameter: sl.parameter,
    format: sl.format,
    multiple: sl.multiple,
    ...(sl.default ? { default: sl.default } : {}),
  }));
  const plugin = readViewData(artEl, 'plugin');
  return {
    artifact: artEl.args?.artifactName,
    node: artEl.args?.nodeName,
    package: artEl.args?.packageName,
    lifecycle: Boolean(artEl.args?.isLifecycle),
    ...(plugin ? { isPlugin: true } : {}),
    ...(plugin?.implements ? { implements: plugin.implements } : {}),
    ...(plugin?.loader ? { loader: plugin.loader } : {}),
    ...(pluginSlots.length ? { pluginSlots } : {}),
    interfaces: parseInterfaces(artEl).map((i) => ({
      name: i.name,
      kind: i.kindCode,
      type: i.spec,
      ...(i.ns ? { namespace: i.ns } : {}),
      ...(i.activeStates.length ? { active_in: i.activeStates } : {}),
      ...(Object.keys(i.qos || {}).length ? { qos: i.qos } : {}),
    })),
    parameters: parseParameters(artEl).map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.hasDefault ? { default: p.default } : {}),
      ...(p.value ? { value: p.value } : {}),
      ...(p.ns ? { namespace: p.ns } : {}),
    })),
  };
}

interface ParsedPluginBase {
  id: string;
  name: string;
  ref: string;
  class: string;
  header: string;
  loader: string;
}

function pluginBases(graph: GGraph): Omit<ParsedPluginBase, 'id'>[] {
  const pkg = packageElements(graph)[0];
  return (readViewData(pkg, 'package')?.pluginBases || []).map((b) => ({
    name: b.name,
    ref: b.ref,
    class: b.class,
    header: b.header,
    loader: b.loader,
  }));
}

function describePackage(graph: GGraph): Record<string, unknown> {
  const pkg = packageElements(graph)[0];
  return {
    name: pkg?.args?.packageName,
    kind: pkg?.args?.packageKind,
    ...(pkg?.args?.fromGitRepo ? { fromGitRepo: pkg.args.fromGitRepo } : {}),
    ...(pluginBases(graph).length ? { pluginBases: pluginBases(graph) } : {}),
    artifacts: artifactElements(graph).map(describeArtifact),
  };
}

function withPackage(
  bridge: Bridge,
  packagePath: string,
  mustExist: boolean,
  body: (s: ModelSession) => Promise<ToolOutcome>
): Promise<ToolOutcome> {
  return withModel(bridge, packagePath, PACKAGE_EXTENSIONS, mustExist, 'mcp_package', body);
}

async function applyQosFields(
  bridge: Bridge,
  s: ModelSession,
  targetId: string,
  qos: QosInput
): Promise<void> {
  for (const field of QOS_FIELD_KEYS) {
    const val = qos[field as QosFieldKey];
    if (val !== undefined) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: targetId,
        property: 'qos',
        key: field,
        value: val,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tool implementations (exported for tests and other hosts)
// ---------------------------------------------------------------------------

export async function addArtifact(
  bridge: Bridge,
  p: {
    package_path: string;
    artifact_name: string;
    node_name?: string;
    package_name?: string;
    from_git_repo?: string;
    lifecycle?: boolean;
    is_library?: boolean;
  }
): Promise<ToolOutcome> {
  return withPackage(bridge, p.package_path, false, async (s) => {
    const existing = findArtifactElement(s.graph, p.artifact_name);
    if (existing) {
      return failOutcome(
        s,
        `Artifact '${p.artifact_name}' already exists in ${path.basename(s.file)}.`,
        { artifact: describeArtifact(existing) }
      );
    }
    if (p.package_name) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: 'root',
        property: 'name',
        value: p.package_name,
      });
    }
    if (p.from_git_repo !== undefined) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: 'root',
        property: 'fromGitRepo',
        value: p.from_git_repo,
      });
    }
    const isLibrary = Boolean(p.is_library) || p.node_name === '';
    await runOperation(bridge, s, {
      kind: 'editRosProperty',
      elementId: 'root',
      property: 'addArtifact',
      key: p.artifact_name,
      value: isLibrary ? '' : (p.node_name || p.artifact_name),
      ...(isLibrary ? { valueType: 'library' } : {}),
    });
    if (p.lifecycle !== undefined && !isLibrary) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: p.artifact_name,
        property: 'isLifecycle',
        value: String(p.lifecycle),
      });
    }
    const { changed, graph, markers } = await commitModel(bridge, s);
    const createdArt = findArtifactElement(graph, p.artifact_name);
    const m = summarizeMarkers(markers);
    if (!createdArt && !isLibrary) {
      return failOutcome(s, `Artifact '${p.artifact_name}' was not created.`, m);
    }
    return {
      success: m.errors.length === 0,
      file: s.file,
      created: !s.existed,
      changed,
      package: describePackage(graph),
      ...(createdArt ? { artifact: describeArtifact(createdArt) } : { artifact: p.artifact_name, isLibrary: true }),
      ...m,
    };
  });
}

export async function addPlugin(
  bridge: Bridge,
  p: {
    package_path: string;
    artifact_name: string;
    plugin_name: string;
    implements?: string;
    package_name?: string;
    from_git_repo?: string;
  }
): Promise<ToolOutcome> {
  return withPackage(bridge, p.package_path, false, async (s) => {
    const existingPlugin = artifactElements(s.graph).find(
      (n) => isPluginElement(n) && n.args?.artifactName === p.artifact_name && n.args?.nodeName === p.plugin_name
    );
    if (existingPlugin) {
      return failOutcome(
        s,
        `Plugin '${p.plugin_name}' already exists on artifact '${p.artifact_name}' in ${path.basename(s.file)}.`,
        { plugin: describeArtifact(existingPlugin) }
      );
    }
    if (p.package_name) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: 'root',
        property: 'name',
        value: p.package_name,
      });
    }
    if (p.from_git_repo !== undefined) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: 'root',
        property: 'fromGitRepo',
        value: p.from_git_repo,
      });
    }
    await runOperation(bridge, s, {
      kind: 'editRosProperty',
      elementId: 'root',
      property: 'addPlugin',
      key: `${p.artifact_name}::${p.plugin_name}`,
      value: JSON.stringify({
        implements: p.implements || '',
      }),
    });
    const { changed, graph, markers } = await commitModel(bridge, s);
    const createdPlugin =
      artifactElements(graph).find(
        (n) => isPluginElement(n) && n.args?.artifactName === p.artifact_name && n.args?.nodeName === p.plugin_name
      ) || findArtifactElement(graph, p.plugin_name);
    const m = summarizeMarkers(markers);
    if (!createdPlugin) {
      return failOutcome(s, `Plugin '${p.plugin_name}' was not created.`, m);
    }
    return {
      success: m.errors.length === 0,
      file: s.file,
      created: !s.existed,
      changed,
      package: describePackage(graph),
      plugin: describeArtifact(createdPlugin),
      ...m,
    };
  });
}

export async function addPluginBase(
  bridge: Bridge,
  p: {
    package_path: string;
    name: string;
    class: string;
    header: string;
    loader?: string;
    package_name?: string;
  }
): Promise<ToolOutcome> {
  return withPackage(bridge, p.package_path, false, async (s) => {
    if (pluginBases(s.graph).some((b) => b.name === p.name)) {
      return failOutcome(s, `Plugin base '${p.name}' already exists in ${path.basename(s.file)}.`, {
        pluginBases: pluginBases(s.graph),
      });
    }
    if (p.package_name) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: 'root',
        property: 'name',
        value: p.package_name,
      });
    }
    await runOperation(bridge, s, {
      kind: 'editRosProperty',
      elementId: 'root',
      property: 'addPluginBase',
      key: p.name,
      value: JSON.stringify({
        class: p.class,
        header: p.header,
        loader: p.loader || 'pluginlib',
      }),
    });
    const { changed, graph, markers } = await commitModel(bridge, s);
    const created = pluginBases(graph).find((b) => b.name === p.name);
    const m = summarizeMarkers(markers);
    if (!created) {
      return failOutcome(s, `Plugin base '${p.name}' was not created.`, m);
    }
    return {
      success: m.errors.length === 0,
      file: s.file,
      created: !s.existed,
      changed,
      pluginBase: created,
      ...m,
    };
  });
}

export async function addPluginSlot(
  bridge: Bridge,
  p: {
    package_path: string;
    artifact: string;
    name: string;
    base: string;
    parameter: string;
    format?: 'class' | 'library';
    multiple?: boolean;
    default_plugin?: string;
  }
): Promise<ToolOutcome> {
  return withPackage(bridge, p.package_path, true, async (s) => {
    const art = findArtifactElement(s.graph, p.artifact);
    if (!art) {
      return failOutcome(s, `Unknown artifact '${p.artifact}'.`, {
        artifacts: artifactElements(s.graph).map(artifactKey),
      });
    }
    const artName = artifactKey(art);
    const existingSlots = readViewData(art, 'node')?.pluginSlots || [];
    if (existingSlots.some((sl) => sl.name === p.name)) {
      return failOutcome(s, `PluginSlot '${p.name}' already exists on '${artName}'.`, {
        artifact: describeArtifact(art),
      });
    }
    await runOperation(bridge, s, {
      kind: 'editRosProperty',
      elementId: artName,
      property: 'addPluginSlot',
      key: p.name,
      value: JSON.stringify({
        base: p.base,
        parameter: p.parameter,
        ...(p.format ? { format: p.format } : {}),
        ...(p.multiple ? { multiple: 'true' } : {}),
        ...(p.default_plugin ? { default: p.default_plugin } : {}),
      }),
    });
    const { changed, graph, markers } = await commitModel(bridge, s);
    const afterArt = findArtifactElement(graph, artName);
    const createdSlot = afterArt
      ? (readViewData(afterArt, 'node')?.pluginSlots || []).find((sl) => sl.name === p.name)
      : undefined;
    const m = summarizeMarkers(markers);
    if (!afterArt || !createdSlot) {
      return failOutcome(s, `PluginSlot '${p.name}' was not created.`, m);
    }
    return {
      success: m.errors.length === 0,
      file: s.file,
      changed,
      slot: createdSlot,
      artifact: describeArtifact(afterArt),
      ...m,
    };
  });
}

export async function addInterface(
  bridge: Bridge,
  p: {
    package_path: string;
    artifact: string;
    kind: 'pub' | 'sub' | 'ss' | 'sc' | 'as' | 'ac';
    name: string;
    type: string;
    namespace?: string;
    active_in?: string[];
    qos?: QosInput;
  }
): Promise<ToolOutcome> {
  return withPackage(bridge, p.package_path, true, async (s) => {
    const art = findArtifactElement(s.graph, p.artifact);
    if (!art) {
      return failOutcome(s, `Unknown artifact '${p.artifact}'.`, {
        artifacts: artifactElements(s.graph).map(artifactKey),
      });
    }
    const artName = artifactKey(art);
    if (parseInterfaces(art).some((i) => i.name === p.name)) {
      return failOutcome(s, `Interface '${p.name}' already exists on '${artName}'.`, {
        artifact: describeArtifact(art),
      });
    }
    await runOperation(bridge, s, {
      kind: 'editRosProperty',
      elementId: artName,
      property: 'addInterface',
      key: p.name,
      value: p.type,
      valueType: p.kind,
    });
    const ifaceRef = `${artName}.${p.name}`;
    if (p.namespace !== undefined) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: ifaceRef,
        property: 'namespace',
        value: p.namespace,
      });
    }
    if (p.active_in && p.active_in.length > 0) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: ifaceRef,
        property: 'activeStates',
        value: p.active_in.join(', '),
      });
    }
    if (p.qos) {
      await applyQosFields(bridge, s, ifaceRef, p.qos);
    }
    const { changed, graph, markers } = await commitModel(bridge, s);
    const afterArt = findArtifactElement(graph, artName);
    const createdIface = afterArt ? parseInterfaces(afterArt).find((i) => i.name === p.name) : undefined;
    const m = summarizeMarkers(markers);
    if (!afterArt || !createdIface) {
      return failOutcome(s, `Interface '${ifaceRef}' was not created.`, m);
    }
    return {
      success: m.errors.length === 0,
      file: s.file,
      changed,
      interface: createdIface,
      artifact: describeArtifact(afterArt),
      ...m,
    };
  });
}

export async function addParameter(
  bridge: Bridge,
  p: {
    package_path: string;
    artifact: string;
    name: string;
    type: 'String' | 'Integer' | 'Double' | 'Boolean' | 'Base64' | 'Array';
    default_value?: string;
    value?: string;
    namespace?: string;
  }
): Promise<ToolOutcome> {
  return withPackage(bridge, p.package_path, true, async (s) => {
    const art = findArtifactElement(s.graph, p.artifact);
    if (!art) {
      return failOutcome(s, `Unknown artifact '${p.artifact}'.`, {
        artifacts: artifactElements(s.graph).map(artifactKey),
      });
    }
    const artName = artifactKey(art);
    if (parseParameters(art).some((param) => param.name === p.name)) {
      return failOutcome(s, `Parameter '${p.name}' already exists on '${artName}'.`, {
        artifact: describeArtifact(art),
      });
    }
    await runOperation(bridge, s, {
      kind: 'editRosProperty',
      elementId: artName,
      property: 'addParameter',
      key: p.name,
      value: p.default_value ?? '',
      valueType: p.type,
    });
    const paramRef = `${artName}.${p.name}`;
    if (p.namespace !== undefined) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: paramRef,
        property: 'namespace',
        value: p.namespace,
      });
    }
    if (p.value !== undefined) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: paramRef,
        property: 'value',
        value: p.value,
        valueType: p.type,
      });
    }
    const { changed, graph, markers } = await commitModel(bridge, s);
    const afterArt = findArtifactElement(graph, artName);
    const createdParam = afterArt ? parseParameters(afterArt).find((param) => param.name === p.name) : undefined;
    const m = summarizeMarkers(markers);
    if (!afterArt || !createdParam) {
      return failOutcome(s, `Parameter '${paramRef}' was not created.`, m);
    }
    return {
      success: m.errors.length === 0,
      file: s.file,
      changed,
      parameter: createdParam,
      artifact: describeArtifact(afterArt),
      ...m,
    };
  });
}

export async function setQos(
  bridge: Bridge,
  p: { package_path: string; artifact: string; interface_name: string } & QosInput
): Promise<ToolOutcome> {
  return withPackage(bridge, p.package_path, true, async (s) => {
    const art = findArtifactElement(s.graph, p.artifact);
    if (!art) {
      return failOutcome(s, `Unknown artifact '${p.artifact}'.`, {
        artifacts: artifactElements(s.graph).map(artifactKey),
      });
    }
    const artName = artifactKey(art);
    const iface = parseInterfaces(art).find((i) => i.name === p.interface_name);
    if (!iface) {
      return failOutcome(s, `Unknown interface '${p.interface_name}' on '${artName}'.`, {
        interfaces: parseInterfaces(art).map((i) => i.name),
      });
    }
    await applyQosFields(bridge, s, iface.id, p);
    const { changed, graph, markers } = await commitModel(bridge, s);
    const afterArt = findArtifactElement(graph, artName);
    const updatedIface = afterArt
      ? parseInterfaces(afterArt).find((i) => i.name === p.interface_name)
      : undefined;
    const m = summarizeMarkers(markers);
    return {
      success: m.errors.length === 0,
      file: s.file,
      changed,
      interface: updatedIface,
      ...m,
    };
  });
}

export async function setPackageProperty(
  bridge: Bridge,
  p: {
    package_path: string;
    target: string;
    property: string;
    value: string;
    key?: string;
    value_type?: string;
  }
): Promise<ToolOutcome> {
  return withPackage(bridge, p.package_path, true, async (s) => {
    await runOperation(bridge, s, {
      kind: 'editRosProperty',
      elementId: p.target,
      property: p.property,
      ...(p.key !== undefined ? { key: p.key } : {}),
      value: p.value,
      ...(p.value_type !== undefined ? { valueType: p.value_type } : {}),
    });
    const { changed, graph, markers } = await commitModel(bridge, s);
    const m = summarizeMarkers(markers);
    return {
      success: m.errors.length === 0,
      file: s.file,
      changed,
      package: describePackage(graph),
      ...m,
    };
  });
}

function resolveRemovableId(graph: GGraph, target: string): string | undefined {
  const dot = Math.max(target.lastIndexOf('.'), target.lastIndexOf('/'));
  if (dot > 0 && dot < target.length - 1) {
    const head = target.slice(0, dot);
    const tail = target.slice(dot + 1);
    const art = findArtifactElement(graph, head);
    if (art) {
      const iface = parseInterfaces(art).find((i) => i.name === tail);
      if (iface) return iface.id;
      const param = parseParameters(art).find((pr) => pr.name === tail);
      if (param) return param.id;
    }
  }
  const art = findArtifactElement(graph, target);
  if (art) {
    return String(art.args?.artifactId || art.id);
  }
  const pkg = packageElements(graph)[0];
  if (pkg) {
    const specs = parseJsonArray<{
      id: string;
      name: string;
      sections: { name: string; fields: { id: string; name: string }[] }[];
    }>(pkg.args?.specsJson);
    if (dot > 0 && dot < target.length - 1) {
      const head = target.slice(0, dot);
      const tail = target.slice(dot + 1);
      const sp = specs.find((x) => x.name === head);
      const fld = sp?.sections.flatMap((sec) => sec.fields).find((f) => f.name === tail);
      if (fld) return fld.id;
    }
    const sp = specs.find((x) => x.name === target);
    if (sp) return sp.id;
  }
  return undefined;
}

interface ParsedSpec {
  id: string;
  name: string;
  category: string;
  fullname: string;
  sections: { name: string; fields: { id: string; type: string; name: string }[] }[];
}

export async function addSpec(
  bridge: Bridge,
  p: {
    spec_path: string;
    spec_name: string;
    kind: 'msg' | 'srv' | 'action';
    package_name?: string;
    fields?: {
      name: string;
      type: string;
      section?: 'message' | 'request' | 'response' | 'goal' | 'result' | 'feedback';
    }[];
  }
): Promise<ToolOutcome> {
  return withModel(bridge, p.spec_path, ['.ros'], false, 'mcp_spec', async (s) => {
    const pkg = packageElements(s.graph)[0];
    const existingSpecs = pkg ? parseJsonArray<ParsedSpec>(pkg.args?.specsJson) : [];
    const existing = existingSpecs.find((sp) => sp.name === p.spec_name);
    if (existing) {
      return failOutcome(s, `Spec '${p.spec_name}' already exists in ${path.basename(s.file)}.`, {
        spec: existing,
      });
    }
    if (p.package_name) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: 'root',
        property: 'name',
        value: p.package_name,
      });
    }
    await runOperation(bridge, s, {
      kind: 'editRosProperty',
      elementId: 'root',
      property: 'addSpec',
      key: p.spec_name,
      value: p.kind,
    });
    const defaultSection = p.kind === 'srv' ? 'request' : p.kind === 'action' ? 'goal' : 'message';
    for (const f of p.fields || []) {
      await runOperation(bridge, s, {
        kind: 'editRosProperty',
        elementId: p.spec_name,
        property: 'addField',
        key: f.name,
        value: f.type,
        valueType: f.section || defaultSection,
      });
    }
    const { changed, graph, markers } = await commitModel(bridge, s);
    const afterPkg = packageElements(graph)[0];
    const createdSpec = afterPkg
      ? parseJsonArray<ParsedSpec>(afterPkg.args?.specsJson).find((sp) => sp.name === p.spec_name)
      : undefined;
    const m = summarizeMarkers(markers);
    if (!createdSpec) {
      return failOutcome(s, `Spec '${p.spec_name}' was not created.`, m);
    }
    return {
      success: m.errors.length === 0,
      file: s.file,
      created: !s.existed,
      changed,
      spec: createdSpec,
      ...m,
    };
  });
}

export async function removePackageElement(
  bridge: Bridge,
  p: { package_path: string; element: string }
): Promise<ToolOutcome> {
  return withPackage(bridge, p.package_path, true, async (s) => {
    const elementId = resolveRemovableId(s.graph, p.element);
    if (!elementId) {
      return failOutcome(s, `Nothing named '${p.element}' in ${path.basename(s.file)}.`, {
        available: artifactElements(s.graph).flatMap((a) => {
          const name = artifactKey(a);
          return [
            name,
            ...parseInterfaces(a).map((i) => `${name}.${i.name}`),
            ...parseParameters(a).map((pr) => `${name}.${pr.name}`),
          ];
        }),
      });
    }
    await runOperation(bridge, s, { kind: 'deleteElement', elementIds: [elementId] });
    const { changed, graph, markers } = await commitModel(bridge, s);
    const m = summarizeMarkers(markers);
    if (!changed) {
      return failOutcome(s, `The server did not remove '${p.element}'.`, m);
    }
    return {
      success: m.errors.length === 0,
      file: s.file,
      changed,
      removed: p.element,
      remaining: describePackage(graph),
      ...m,
    };
  });
}

// ---------------------------------------------------------------------------
// MCP registration
// ---------------------------------------------------------------------------

export function registerPackageTools(
  server: McpServer,
  getBridge: () => Bridge = () => GlspClientBridge.getInstance()
): void {
  const packagePath = z
    .string()
    .describe('Path to the .ros2 (or .ros1/.ros) file. ros2_add_artifact creates a new .ros2 file when it does not exist.');

  server.tool(
    'ros2_add_artifact',
    'Adds an artifact (executable/node contract or node-less library) to a .ros2 package model, creating the .ros2 file if it does not exist. All formatting, Ecore AST construction, and Xtext validation run on the Java GLSP server. Follow up with ros2_add_interface / ros2_add_parameter / ros2_add_plugin_slot.',
    {
      package_path: packagePath,
      artifact_name: z.string().describe('Artifact identifier in the package (unquoted RosNames), e.g. "lidar_driver".'),
      node_name: z.string().optional().describe('ROS node name inside the artifact (defaults to artifact_name; omit or pass is_library=true for node-less plugin libraries).'),
      package_name: z.string().optional().describe('Optional declared package name on line 1 (lowercase [a-z0-9_], defaults to sanitized file name).'),
      from_git_repo: z.string().optional().describe('Optional upstream Git repository URL for fromGitRepo:.'),
      lifecycle: z.boolean().optional().describe('Set true to mark the node as a ROS 2 lifecycle node.'),
      is_library: z.boolean().optional().describe('Set true to create a node-less library artifact for plugins.'),
    },
    async (p) => asMcpResult(await addArtifact(getBridge(), p))
  );

  server.tool(
    'ros2_add_plugin_base',
    'Declares a plugin base under `pluginbases:` in a .ros2 package model, creating the file if needed. A base is the C++ interface plugins implement and host slots accept; reference it elsewhere as "<package>.<Base>". RosTooling never generates the base class: the header is written by hand or comes from another package.',
    {
      package_path: packagePath,
      name: z.string().describe('Base name in the model, e.g. "GlobalPlanner".'),
      class: z.string().describe('Namespace-qualified C++ class, e.g. "nav2_core::GlobalPlanner".'),
      header: z.string().describe('Header that declares the class, e.g. "nav2_core/global_planner.hpp".'),
      loader: z
        .string()
        .optional()
        .describe('Loader id: "pluginlib" (default, built into core) or a loader registered by an enabled plugin (ros_list_plugins lists them).'),
      package_name: z.string().optional().describe('Optional declared package name on line 1 (lowercase [a-z0-9_]).'),
    },
    async (p) => asMcpResult(await addPluginBase(getBridge(), p))
  );

  server.tool(
    'ros2_add_plugin',
    'Adds a plugin to a node-less library artifact in a .ros2 model, creating the file and artifact if needed. The plugin implements a base declared with ros2_add_plugin_base; the base decides how it is loaded. Follow up with ros2_add_interface / ros2_add_parameter targeting plugin_name.',
    {
      package_path: packagePath,
      artifact_name: z.string().describe('Library artifact holding the plugins, e.g. "planner_plugins". An artifact holds a node or plugins, never both.'),
      plugin_name: z.string().describe('Plugin name, e.g. "StraightLine".'),
      implements: z.string().optional().describe('The base it implements, as "<package>.<Base>", e.g. "nav2_core.GlobalPlanner".'),
      package_name: z.string().optional().describe('Optional declared package name on line 1 (lowercase [a-z0-9_]).'),
      from_git_repo: z.string().optional().describe('Optional upstream Git repository URL for fromGitRepo:.'),
    },
    async (p) => asMcpResult(await addPlugin(getBridge(), p))
  );

  server.tool(
    'ros2_add_plugin_slot',
    'Declares a `pluginslots` entry on a host node in a .ros2 model: the base it accepts and the parameter that names the loaded plugin(s). For pluginlib bases the generated host loads the plugins and hands them to the logic. Attach plugins per system with ros_attach_plugins.',
    {
      package_path: packagePath,
      artifact: z.string().describe('Host artifact or node name in the .ros2 model, e.g. "planner_server".'),
      name: z.string().describe('Slot name, e.g. "planner".'),
      base: z.string().describe('Accepted base as "<package>.<Base>", e.g. "nav2_core.GlobalPlanner".'),
      parameter: z.string().describe('Parameter the slot owns and fills with the plugin name(s), e.g. "planner_plugin". It must not also be a node parameter.'),
      format: z.enum(['class', 'library']).optional().describe('Parameter value per plugin: "class" (default, "<package>::<Plugin>") or "library" (the plugin\'s library artifact).'),
      multiple: z.boolean().optional().describe('Set true when the slot takes several plugins; the parameter is then a list.'),
      default_plugin: z.string().optional().describe('Plugin used when a system attaches none, as "<package>.<Plugin>"; it must implement the base.'),
    },
    async (p) => asMcpResult(await addPluginSlot(getBridge(), p))
  );

  server.tool(
    'ros2_add_interface',
    'Adds a publisher, subscriber, service server/client, or action server/client to an existing artifact/node in a .ros2 model via the Java GLSP/Xtext server.',
    {
      package_path: packagePath,
      artifact: z.string().describe('Artifact or node name in the .ros2 model, e.g. "lidar_driver".'),
      kind: z.enum(['pub', 'sub', 'ss', 'sc', 'as', 'ac']).describe('Interface kind: pub, sub, ss (service server), sc (service client), as (action server), ac (action client).'),
      name: z.string().describe('Topic, service, or action name, e.g. "scan" or "/cmd_vel".'),
      type: z.string().describe('ROS message/service/action spec type, e.g. "sensor_msgs/msg/LaserScan".'),
      namespace: z.string().optional().describe('Optional interface namespace (ns:).'),
      active_in: z.array(z.string()).optional().describe('Optional lifecycle states (e.g. ["active"]) when node has lifecycle: true.'),
      qos: z
        .object({
          profile: z.string().optional(),
          history: z.string().optional(),
          depth: z.string().optional(),
          reliability: z.string().optional(),
          durability: z.string().optional(),
          liveliness: z.string().optional(),
          lease_duration: z.string().optional(),
          lifespan: z.string().optional(),
          deadline: z.string().optional(),
        })
        .optional()
        .describe('Optional QoS profile and policy fields.'),
    },
    async (p) => asMcpResult(await addInterface(getBridge(), p))
  );

  server.tool(
    'ros2_add_parameter',
    'Adds a parameter declaration to an existing artifact/node in a .ros2 model via the Java GLSP/Xtext server.',
    {
      package_path: packagePath,
      artifact: z.string().describe('Artifact or node name in the .ros2 model.'),
      name: z.string().describe('Parameter name, e.g. "frame_id".'),
      type: z.enum(['String', 'Integer', 'Double', 'Boolean', 'Base64', 'Array']).describe('Parameter data type.'),
      default_value: z.string().optional().describe('Optional default value literal (emits default: inside type:).'),
      value: z.string().optional().describe('Optional explicit value: literal.'),
      namespace: z.string().optional().describe('Optional parameter namespace (ns:).'),
    },
    async (p) => asMcpResult(await addParameter(getBridge(), p))
  );

  server.tool(
    'ros2_set_qos',
    'Sets or clears QoS fields on an existing interface in a .ros2 model via the Java GLSP/Xtext server. Pass "" to clear a field.',
    {
      package_path: packagePath,
      artifact: z.string().describe('Artifact or node name in the .ros2 model.'),
      interface_name: z.string().describe('Interface name on that node.'),
      profile: z.string().optional(),
      history: z.string().optional(),
      depth: z.string().optional(),
      reliability: z.string().optional(),
      durability: z.string().optional(),
      liveliness: z.string().optional(),
      lease_duration: z.string().optional(),
      lifespan: z.string().optional(),
      deadline: z.string().optional(),
    },
    async (p) => asMcpResult(await setQos(getBridge(), p))
  );

  server.tool(
    'ros2_set_property',
    'Updates a semantic property on a package ("root" or package name), plugin base ("<Base>": "name", "class", "header", "loader"), artifact/node, plugin ("<Plugin>": "implements"), plugin slot ("<artifact>.<slot>": "base", "parameter", "format", "multiple", "default"), interface ("<artifact>.<iface>"), or parameter ("<artifact>.<param>") in a .ros2 model via the Java GLSP/Xtext server (e.g. property="type", "name", "fromGitRepo", "isLifecycle", "default", "value", "namespace", "activeStates").',
    {
      package_path: packagePath,
      target: z.string().describe('Element identifier or name: "root" (package), "<artifact>", "<artifact>.<interface>", or "<artifact>.<parameter>".'),
      property: z.string().describe('Property name, e.g. "type", "name", "fromGitRepo", "isLifecycle", "default", "value", "namespace", "activeStates".'),
      value: z.string().describe('New value.'),
      key: z.string().optional().describe('Optional sub-key (for keyed properties like "qos").'),
      value_type: z.string().optional().describe('Optional type hint (e.g. parameter type on "type"/"value").'),
    },
    async (p) => asMcpResult(await setPackageProperty(getBridge(), p))
  );

  server.tool(
    'ros2_remove_element',
    'Removes an artifact, interface ("<artifact>.<interface>"), parameter ("<artifact>.<parameter>"), spec, or spec field cleanly via the Java GLSP/Xtext server, removing emptied section headers automatically.',
    {
      package_path: packagePath,
      element: z.string().describe('Artifact/node name, "<artifact>.<interface>", "<artifact>.<parameter>", or "<spec>[.<field>]".'),
    },
    async (p) => asMcpResult(await removePackageElement(getBridge(), p))
  );

  server.tool(
    'ros_add_spec',
    'Adds a ROS message (`msg`), service (`srv`), or action (`action`) type specification with typed fields to a .ros file (creating the .ros file if it does not exist) via the Java GLSP/Xtext server.',
    {
      spec_path: z.string().describe('Path to the .ros file (created if missing).'),
      spec_name: z.string().describe('Message, service, or action name, e.g. "Scan" or "SetSpeedLimit".'),
      kind: z.enum(['msg', 'srv', 'action']).describe('Specification kind: msg, srv, or action.'),
      package_name: z.string().optional().describe('Optional declared package name (defaults to sanitized file name).'),
      fields: z
        .array(
          z.object({
            name: z.string().describe('Field identifier, e.g. "ranges".'),
            type: z.string().describe('ROS field type, e.g. "float32[]", "string", or "\'pkg/msg/Type\'".'),
            section: z
              .enum(['message', 'request', 'response', 'goal', 'result', 'feedback'])
              .optional()
              .describe('Section name (defaults to message / request / goal).'),
          })
        )
        .optional()
        .describe('Typed fields to declare inside the specification.'),
    },
    async (p) => asMcpResult(await addSpec(getBridge(), p))
  );
}
