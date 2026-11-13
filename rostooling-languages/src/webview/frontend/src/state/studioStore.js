import { useSyncExternalStore } from 'react';
import { getInitialData, registerHostMessageListener, hostBridge } from './vscodeBridge';
import { rosDiagramApi } from '../glsp/rosDiagramApi';

// ============================================================================
// RosTooling Studio store
//
// The Java GLSP/Xtext server is the single source of truth. This store only holds
//   - the latest server GGraph + markers (and the read-only RosProject projection of it),
//   - UI state (selection, filters, drawer),
// and turns user intent into typed GLSP operations. It never edits model data locally,
// never validates connections and never produces DSL text.
// ============================================================================

export const KIND_META = {
  pub: { label: 'Publisher', short: 'PUB', side: 'source', partner: 'sub', color: '#2ec49b', family: 'Topic' },
  sub: { label: 'Subscriber', short: 'SUB', side: 'target', partner: 'pub', color: '#4c9aff', family: 'Topic' },
  ss: { label: 'Service Server', short: 'SS', side: 'source', partner: 'sc', color: '#f59e0b', family: 'Service' },
  sc: { label: 'Service Client', short: 'SC', side: 'target', partner: 'ss', color: '#f97316', family: 'Service' },
  as: { label: 'Action Server', short: 'AS', side: 'source', partner: 'ac', color: '#a855f7', family: 'Action' },
  ac: { label: 'Action Client', short: 'AC', side: 'target', partner: 'as', color: '#ec4899', family: 'Action' },
};

/** Presentation only: which column of a node card a port kind is drawn in. */
export const SRC_SIDE = { pub: true, ss: true, as: true, sub: false, sc: false, ac: false };

// ============================================================================
// Editor vocabulary: value sets offered by the forms (lifecycle states, parameter
// types, message field types, namespace kinds, interface kinds, QoS keywords).
// They are NOT defined here: the Java server derives them from the Ecore metamodel
// (QoS spellings from the grammar) and sends them as GGraph root arg `metamodelJson`.
// ============================================================================

const EMPTY_VOCABULARY = {
  lifecycleStates: [],
  parameterTypes: [],
  messageFieldTypes: [],
  namespaceKinds: [],
  interfaceKinds: [],
  qos: {},
};

function vocabularyFrom(gGraph, previous = EMPTY_VOCABULARY) {
  const raw = gGraph && gGraph.args && gGraph.args.metamodelJson;
  if (!raw) return previous;
  try {
    return { ...EMPTY_VOCABULARY, ...JSON.parse(String(raw)) };
  } catch {
    return previous;
  }
}

/** Interface kinds offered by the server, in the display order of KIND_META. */
export function orderedInterfaceKinds(vocabulary) {
  return Object.keys(KIND_META).filter((k) => (vocabulary.interfaceKinds || []).includes(k));
}

export function normalizeCatalogueInterfaces(rawIfaces) {
  if (!rawIfaces) return [];
  if (Array.isArray(rawIfaces)) {
    return rawIfaces.map((f) => ({
      name: f.name || f.label || '',
      label: f.label || f.name || '',
      kind: f.kind || 'pub',
      type: f.type || '',
    }));
  }
  if (typeof rawIfaces === 'object') {
    return Object.entries(rawIfaces).map(([k, val]) => {
      if (typeof val === 'string') return { name: k, label: k, kind: val, type: '' };
      const obj = val || {};
      return { name: obj.name || obj.label || k, label: obj.label || obj.name || k, kind: obj.kind || 'pub', type: obj.type || '' };
    });
  }
  return [];
}

// ============================================================================
// Reactive store singleton
// ============================================================================

const init = getInitialData();

const state = {
  project: init.project,
  gGraph: init.gGraph,
  /** Ecore-derived value sets from the server (see vocabularyFrom). */
  vocabulary: vocabularyFrom(init.gGraph),
  markers: init.glspMarkers,
  mode: init.mode,
  isReadOnly: init.isReadOnly,
  docFileName: init.docFileName,
  nodeIndex: init.nodeIndex,
  typeIndex: init.typeIndex,

  selectedNodeId: init.mode === 'component' ? init.project.nodes?.[0]?.id || null : null,
  selectedEdgeId: null,
  selectedSubsystemRef: null,
  selectedProcessName: null,
  selectedTypeName: null,

  interfaceFilter: 'all',
  typeCategoryFilter: 'all',
  catalogueOpen: false,
  catalogueTab: init.mode === 'ros' ? 'types' : 'nodes',

  /** Number of GLSP operations awaiting the server's refreshed model. */
  pending: 0,
  toast: null,
  fitTrigger: 1,
};

let version = 0;
const listeners = new Set();
let toastTimer = null;

function emitChange() {
  version += 1;
  for (const fn of listeners) fn();
}

function collectElementIds(el, acc = new Set()) {
  for (const child of (el && el.children) || []) {
    acc.add(child.id);
    collectElementIds(child, acc);
  }
  return acc;
}

function reconcileSelection() {
  const nodes = state.project.nodes || [];
  // In the diagram, processes and subsystems are selectable too: keep any id the model still has.
  const exists = (id) =>
    nodes.some((n) => n.id === id) || (state.mode === 'system' && collectElementIds(state.gGraph).has(id));
  if (state.selectedNodeId && !exists(state.selectedNodeId)) {
    state.selectedNodeId = state.mode === 'component' ? nodes[0]?.id || null : null;
  }
  if (state.selectedEdgeId && !(state.project.connections || []).some((c) => c.id === state.selectedEdgeId)) {
    state.selectedEdgeId = null;
  }
}

registerHostMessageListener({
  onUpdateGlspModel(gGraph, markers, project) {
    state.gGraph = gGraph;
    state.vocabulary = vocabularyFrom(gGraph, state.vocabulary);
    state.markers = markers || [];
    if (project) state.project = project;
    state.pending = 0;
    reconcileSelection();
    emitChange();
  },
  onUpdateCatalogue(nodeCatalog, typeCatalog) {
    state.nodeIndex = nodeCatalog || {};
    state.typeIndex = typeCatalog || {};
    emitChange();
  },
});

export function useStudio() {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version
  );
  return state;
}

export function getStudioState() {
  return state;
}

export function showToast(text, isError = false) {
  if (toastTimer) clearTimeout(toastTimer);
  state.toast = { text, isError };
  emitChange();
  toastTimer = setTimeout(() => {
    state.toast = null;
    emitChange();
  }, isError ? 4500 : 2800);
}

export function setUIState(patch) {
  Object.assign(state, patch);
  emitChange();
}

export function requestFitView() {
  state.fitTrigger = (state.fitTrigger || 0) + 1;
  emitChange();
}

// ============================================================================
// GLSP operations (the ONLY way the webview changes a model)
// ============================================================================

export function dispatchOperation(operation) {
  if (state.isReadOnly) {
    showToast('Core catalogue models are read-only and cannot be modified.', true);
    return false;
  }
  state.pending += 1;
  emitChange();
  const op = { isOperation: true, ...operation };
  // .rossystem: the Sprotty diagram owns the GLSP client session, so operations go through its
  // action dispatcher; forms (.ros2/.ros) use the extension host's session.
  if (!(state.mode === 'system' && rosDiagramApi.dispatch(op))) {
    hostBridge.glspOperation(op);
  }
  return true;
}

/** EditRosPropertyOperation (kind "editRosProperty"). */
export function editProperty(elementId, property, value, { key, valueType } = {}) {
  if (!elementId) return false;
  return dispatchOperation({
    kind: 'editRosProperty',
    elementId,
    property,
    key: key ?? null,
    value: value === undefined || value === null ? '' : String(value),
    valueType: valueType ?? null,
  });
}

export function deleteElements(elementIds) {
  const ids = (elementIds || []).filter(Boolean);
  if (ids.length === 0) return false;
  return dispatchOperation({ kind: 'deleteElement', elementIds: ids });
}

export function createRosNode({ nodeName, from, namespace }) {
  return dispatchOperation({
    kind: 'createNode',
    elementTypeId: 'node:ros-node',
    args: { nodeName, from: from || '', namespace: namespace || '' },
  });
}

/** Creates a process (composable node container) with optional member node names. */
export function createProcess({ processName, threads = 1, nodes = [] }) {
  return dispatchOperation({
    kind: 'createNode',
    elementTypeId: 'node:process',
    args: { processName, threads: String(threads), ...(nodes.length ? { nodes: nodes.join(',') } : {}) },
  });
}

export function createSubSystem(systemName) {
  return dispatchOperation({ kind: 'createNode', elementTypeId: 'node:subsystem', args: { system: systemName } });
}

export function createConnection(sourceElementId, targetElementId) {
  return dispatchOperation({
    kind: 'createEdge',
    elementTypeId: 'edge:ros-connection',
    sourceElementId,
    targetElementId,
    args: {},
  });
}

export function reconnectConnection(edgeElementId, sourceElementId, targetElementId) {
  return dispatchOperation({ kind: 'reconnectEdge', edgeElementId, sourceElementId, targetElementId, args: {} });
}

export function toggleSubSystem(elementId, collapsed) {
  return dispatchOperation({
    kind: 'toggleSubSystem',
    elementId,
    ...(collapsed === undefined ? {} : { collapsed }),
  });
}

/** ChangeBoundsOperation: pins a node (written to the optional .layout sidecar by the server). */
export function pinNodePosition(elementId, position, size) {
  return dispatchOperation({
    kind: 'changeBounds',
    newBounds: [{ elementId, newPosition: position, newSize: size || { width: -1, height: -1 } }],
  });
}

// ============================================================================
// Domain helpers built on operations
// ============================================================================

export function getDisplayModelName(project, mode, docFileName = '') {
  const baseName = docFileName ? docFileName.replace(/^.*[\\/]/, '').replace(/\.(rossystem|ros2|ros1|ros)$/, '') : '';
  if (mode === 'ros' || mode === 'component') {
    return Object.keys(project.packages || {})[0] || project.system?.name || baseName || '';
  }
  return project.system?.name || baseName || 'ros_system';
}

/** Renames the model root: the system (.rossystem) or the first package (.ros2/.ros). */
export function renameModel(newName) {
  const trimmed = String(newName || '').trim();
  if (!trimmed) return;
  if (state.mode === 'system') {
    editProperty('root', 'name', trimmed);
  } else {
    const pkg = Object.values(state.project.packages || {})[0];
    if (pkg?.id) editProperty(pkg.id, 'name', trimmed);
  }
}

function uniqueNodeName(base) {
  const taken = new Set((state.project.nodes || []).map((n) => n.label));
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}_${i++}`;
  return name;
}

export function importCatalogueNode(catKey, catEntry) {
  if (state.isReadOnly) return;
  const baseName = catEntry.node || catEntry.artifact || catKey.split('.').pop() || 'node';
  const pkg = catEntry.pkg || (catEntry.from ? catEntry.from.split('.')[0] : '');
  const from = catEntry.from || (pkg ? `${pkg}.${baseName}` : baseName);
  createRosNode({ nodeName: uniqueNodeName(baseName), from });
  setUIState({ catalogueOpen: false });
}

export function importCatalogueSubsystem(sysEntry) {
  if (state.isReadOnly || !sysEntry?.system) return;
  if ((state.project.subSystems || []).some((s) => s.ref === sysEntry.system)) {
    showToast(`Subsystem "${sysEntry.system}" is already imported in this system.`, true);
    return;
  }
  createSubSystem(sysEntry.system);
  setUIState({ catalogueOpen: false });
}

/** Markers of a GLSP element (exact id match). */
export function markersFor(elementId) {
  return (state.markers || []).filter((m) => m.elementId === elementId);
}
