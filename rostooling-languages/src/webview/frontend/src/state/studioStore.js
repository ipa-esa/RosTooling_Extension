import { useSyncExternalStore } from 'react';
import dagre from '@dagrejs/dagre';
import { getInitialData, registerHostMessageListener, hostBridge } from './vscodeBridge';

// ============================================================================
// Constants & Connection Validator (100% Parity with ConnectionValidator.ts)
// ============================================================================

export const KIND_ORDER = ['pub', 'sub', 'ss', 'sc', 'as', 'ac'];

export const KIND_META = {
  pub: { label: 'Publisher', short: 'PUB', side: 'source', partner: 'sub', color: '#2ec49b', family: 'Topic' },
  sub: { label: 'Subscriber', short: 'SUB', side: 'target', partner: 'pub', color: '#4c9aff', family: 'Topic' },
  ss:  { label: 'Service Server', short: 'SS', side: 'source', partner: 'sc', color: '#f59e0b', family: 'Service' },
  sc:  { label: 'Service Client', short: 'SC', side: 'target', partner: 'ss', color: '#f97316', family: 'Service' },
  as:  { label: 'Action Server', short: 'AS', side: 'source', partner: 'ac', color: '#a855f7', family: 'Action' },
  ac:  { label: 'Action Client', short: 'AC', side: 'target', partner: 'as', color: '#ec4899', family: 'Action' },
};

export const COMPLEMENT_KINDS = {
  pub: 'sub',
  sub: 'pub',
  ss: 'sc',
  sc: 'ss',
  as: 'ac',
  ac: 'as',
};

export const SRC_SIDE = {
  pub: true,
  ss: true,
  as: true,
  sub: false,
  sc: false,
  ac: false,
};

export const LIFECYCLE_STATES = ['Unconfigured', 'Inactive', 'Active', 'Finalized'];

export const PARAM_TYPES = ['String', 'Integer', 'Double', 'Boolean', 'Array', 'Struct', 'Byte'];

export const ROS_PRIMITIVE_TYPES = [
  'bool', 'byte', 'char', 'float32', 'float64',
  'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64',
  'string', 'wstring',
];

export const QOS_PROFILES = [
  'default_qos',
  'sensor_qos',
  'system_default',
  'services_default',
  'parameters_qos',
  'parameter_events',
];

export function cloneDeep(val) {
  return JSON.parse(JSON.stringify(val));
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
      if (typeof val === 'string') {
        return { name: k, label: k, kind: val, type: '' };
      }
      const obj = val || {};
      return {
        name: obj.name || obj.label || k,
        label: obj.label || obj.name || k,
        kind: obj.kind || 'pub',
        type: obj.type || '',
      };
    });
  }
  return [];
}

export function validatePortConnection(sourceNode, sourceIface, targetNode, targetIface, existingConnections = []) {
  if (!sourceNode || !sourceIface || !targetNode || !targetIface) {
    return { valid: false, reason: 'Select valid source and target interface ports.' };
  }
  if (sourceNode.id === targetNode.id) {
    return { valid: false, reason: `Cannot connect node "${sourceNode.label}" to itself.` };
  }
  const expectedTargetKind = COMPLEMENT_KINDS[sourceIface.kind];
  if (!expectedTargetKind) {
    return { valid: false, reason: `Port "${sourceIface.name}" is not connectable.` };
  }
  if (targetIface.kind !== expectedTargetKind) {
    const srcLbl = KIND_META[sourceIface.kind]?.label || sourceIface.kind;
    const tgtLbl = KIND_META[targetIface.kind]?.label || targetIface.kind;
    const expLbl = KIND_META[expectedTargetKind]?.label || expectedTargetKind;
    return {
      valid: false,
      reason: `Incompatible kinds: Cannot connect ${srcLbl} (${sourceIface.kind}) to ${tgtLbl} (${targetIface.kind}). Expected ${expLbl}.`,
    };
  }

  const srcType = (sourceIface.type || '').trim();
  const tgtType = (targetIface.type || '').trim();
  const cleanSrc = srcType.replace(/^['"]|['"]$/g, '').trim();
  const cleanTgt = tgtType.replace(/^['"]|['"]$/g, '').trim();
  const normSrc = cleanSrc.replace(/\/msg\//, '/').replace(/\/srv\//, '/').replace(/\/action\//, '/');
  const normTgt = cleanTgt.replace(/\/msg\//, '/').replace(/\/srv\//, '/').replace(/\/action\//, '/');
  const isTypeMatch =
    cleanSrc === cleanTgt ||
    normSrc === normTgt ||
    (cleanSrc.includes('/') && !cleanTgt.includes('/') && cleanSrc.endsWith('/' + cleanTgt)) ||
    (!cleanSrc.includes('/') && cleanTgt.includes('/') && cleanTgt.endsWith('/' + cleanSrc));

  if (cleanSrc && cleanTgt && cleanSrc !== '—' && cleanTgt !== '—' && !isTypeMatch) {
    return {
      valid: false,
      reason: `Type mismatch: "${srcType}" does not match "${tgtType}".`,
    };
  }

  const isSourceFrom = SRC_SIDE[sourceIface.kind];
  const fromEnd = isSourceFrom
    ? { n: sourceNode.id, i: sourceIface.id, kind: sourceIface.kind }
    : { n: targetNode.id, i: targetIface.id, kind: targetIface.kind };
  const toEnd = isSourceFrom
    ? { n: targetNode.id, i: targetIface.id, kind: targetIface.kind }
    : { n: sourceNode.id, i: sourceIface.id, kind: sourceIface.kind };

  const isDuplicate = (existingConnections || []).some(
    (c) => c.from.n === fromEnd.n && c.from.i === fromEnd.i && c.to.n === toEnd.n && c.to.i === toEnd.i
  );
  if (isDuplicate) {
    return {
      valid: false,
      reason: `Connection already exists between "${sourceIface.name}" and "${targetIface.name}".`,
    };
  }

  return {
    valid: true,
    reason: `Compatible: ${srcType || tgtType || 'Unspecified Type'}`,
    normalizedFrom: fromEnd,
    normalizedTo: toEnd,
  };
}

// ============================================================================
// Synchronizers for .ros2 Packages & .ros Communication Objects
// ============================================================================

export function syncPackagesFromNodes(project, explicitPkgName) {
  const pkgFromNode = (project.nodes || []).find((n) => n.pkg && n.pkg !== 'ros_package')?.pkg;
  const pkgFromMap = Object.keys(project.packages || {})[0];
  const rawName =
    explicitPkgName ||
    pkgFromNode ||
    pkgFromMap ||
    (project.system?.name || '').replace(/_system$/, '') ||
    'ros_package';
  const cleanPkg = rawName.replace(/^.*[\\/]/, '').replace(/\.(ros2|ros1)$/, '').trim() || 'ros_package';

  const prevPkg =
    (project.packages && (project.packages[cleanPkg] || Object.values(project.packages)[0])) || {};
  const fromGitRepo = prevPkg.fromGitRepo;

  project.system = { ...(project.system || {}), name: cleanPkg };
  const artifacts = [];
  for (const node of project.nodes || []) {
    if (node.backing === 'type') continue;
    node.pkg = cleanPkg;
    const artName = node.artifact || node.label;
    node.artifact = artName;
    node.from = `${cleanPkg}.${node.label}`;
    if (!node.isLifecycle) {
      for (const iface of node.ifaces || []) {
        delete iface.activeStates;
      }
    }
    artifacts.push({
      name: artName,
      node: node.label,
      isLifecycle: Boolean(node.isLifecycle),
      ifaces: node.ifaces || [],
      params: node.params || [],
    });
  }

  project.packages = {
    [cleanPkg]: {
      name: cleanPkg,
      ...(fromGitRepo ? { fromGitRepo } : {}),
      artifacts,
    },
  };
}

export function extractRosSpecsList(project) {
  const seen = new Set();
  const list = [];
  const fallbackPkg = (project.system?.name || '').replace(/^.*[\\/]/, '').replace(/\.ros$/, '').trim() || 'ros_package';

  for (const node of project.nodes || []) {
    if (node.backing === 'type' && node.typeSpec) {
      const spec = cloneDeep(node.typeSpec);
      spec.name = node.label || spec.name;
      spec.pkg = (node.pkg || spec.pkg || fallbackPkg).replace(/\.ros$/, '').trim() || fallbackPkg;
      if (spec.name && !seen.has(spec.name)) {
        seen.add(spec.name);
        list.push(spec);
      }
    }
  }
  for (const spec of Object.values(project.types || {})) {
    if (!spec || !spec.name) continue;
    if (!seen.has(spec.name)) {
      const copy = cloneDeep(spec);
      copy.pkg = (copy.pkg || fallbackPkg).replace(/\.ros$/, '').trim() || fallbackPkg;
      seen.add(copy.name);
      list.push(copy);
    }
  }
  return list;
}

export function syncRosTypesAndNodes(project, specsList, explicitPkgName) {
  const pkgName =
    (explicitPkgName !== undefined ? explicitPkgName : project.system?.name || specsList[0]?.pkg || 'ros_package')
      .replace(/^.*[\\/]/, '')
      .replace(/\.ros$/, '')
      .trim() || 'ros_package';

  project.system = { ...(project.system || {}), name: pkgName };
  project.types = {};
  project.nodes = [];
  project.connections = [];

  for (const spec of specsList) {
    spec.pkg = pkgName;
    project.types[`${pkgName}.${spec.name}`] = spec;

    const nodeIfaces = [
      {
        id: `port_${spec.name}_in`,
        name: spec.name,
        label: spec.name,
        kind: 'sub',
        type: spec.name,
        exposed: true,
      },
    ];
    const nodeParams = [];

    for (const fList of Object.values(spec.fields || {})) {
      for (const f of fList || []) {
        if (f.constant) {
          nodeParams.push({
            id: `p_${spec.name}_${f.name}`,
            name: f.name,
            label: f.name,
            ptype: f.type,
            value: f.value,
            exposed: true,
          });
        } else {
          nodeIfaces.push({
            id: `f_${spec.name}_${f.name}`,
            name: f.name,
            label: f.name,
            kind: 'pub',
            type: f.type,
            exposed: true,
          });
        }
      }
    }

    project.nodes.push({
      id: `type_${spec.name}`,
      label: spec.name,
      pkg: pkgName,
      backing: 'type',
      typeCategory: spec.category,
      typeSpec: spec,
      ifaces: nodeIfaces,
      params: nodeParams,
    });
  }

  // Rebuild nested type dependency links
  for (const node of project.nodes) {
    const spec = node.typeSpec;
    if (!spec || !spec.fields) continue;
    for (const fList of Object.values(spec.fields)) {
      for (const f of fList || []) {
        if (f.constant) continue;
        const cleanType = (f.type || '').replace(/\[\d*\]$/, '').replace(/^['"]|['"]$/g, '');
        const baseTypeName = cleanType.split('/').pop()?.split('.').pop() || cleanType;
        const targetNode = project.nodes.find((n) => n.label === baseTypeName && n.id !== node.id);
        if (targetNode) {
          project.connections.push({
            id: `dep_${node.label}_${f.name}_${targetNode.label}`,
            from: { n: node.id, i: `f_${node.label}_${f.name}` },
            to: { n: targetNode.id, i: `port_${targetNode.label}_in` },
          });
        }
      }
    }
  }
}

// ============================================================================
// Reactive Store Singleton
// ============================================================================

const init = getInitialData();

const state = {
  project: init.project,
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

  toast: null,
  fitTrigger: 1,
  past: [],
  future: [],
};

let version = 0;
const listeners = new Set();
let toastTimer = null;

function emitChange() {
  version += 1;
  for (const fn of listeners) {
    fn();
  }
}

registerHostMessageListener({
  onUpdateModel(freshProject) {
    state.project = freshProject;
    if (state.selectedNodeId && !(freshProject.nodes || []).some((n) => n.id === state.selectedNodeId)) {
      state.selectedNodeId = state.mode === 'component' ? freshProject.nodes?.[0]?.id || null : null;
    }
    if (state.selectedEdgeId && !(freshProject.connections || []).some((c) => c.id === state.selectedEdgeId)) {
      state.selectedEdgeId = null;
    }
    emitChange();
  },
  onUpdateDiagnostics(diagnostics) {
    state.project = {
      ...state.project,
      diagnostics: diagnostics || [],
    };
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

export function mutateProject(recipe) {
  if (state.isReadOnly) {
    showToast('Core catalogue models are read-only and cannot be modified.', true);
    return;
  }
  state.past.push(cloneDeep(state.project));
  if (state.past.length > 60) state.past.shift();
  state.future = [];

  const next = cloneDeep(state.project);
  recipe(next);
  state.project = next;
  hostBridge.applyEdit(next);
  emitChange();
}

export function mutateLayout(recipe) {
  if (state.isReadOnly) return;
  const next = cloneDeep(state.project);
  if (!next.view) next.view = {};
  recipe(next);
  state.project = next;
  hostBridge.saveLayout(next);
  emitChange();
}

export function undoEdit() {
  if (state.isReadOnly || state.past.length === 0) return;
  state.future.push(cloneDeep(state.project));
  const prev = state.past.pop();
  state.project = prev;
  hostBridge.applyEdit(prev);
  emitChange();
}

export function redoEdit() {
  if (state.isReadOnly || state.future.length === 0) return;
  state.past.push(cloneDeep(state.project));
  const next = state.future.pop();
  state.project = next;
  hostBridge.applyEdit(next);
  emitChange();
}

// ============================================================================
// High-Level Domain Actions (Preserving All System / Component / Ros Invariants)
// ============================================================================

export function getDisplayModelName(project, mode, docFileName = '') {
  const baseName = docFileName
    ? docFileName.replace(/^.*[\\/]/, '').replace(/\.(rossystem|ros2|ros1|ros)$/, '')
    : '';
  if (mode === 'ros') {
    return project.system?.name || Object.values(project.types || {})[0]?.pkg || baseName || '';
  }
  if (mode === 'component') {
    const pkgFromNode = (project.nodes || []).find((n) => n.pkg && n.pkg !== 'ros_package')?.pkg;
    const pkgFromPackage = Object.keys(project.packages || {})[0];
    const pkgFromSys = (project.system?.name || '').replace(/_system$/, '');
    return (
      pkgFromNode ||
      pkgFromPackage ||
      (pkgFromSys && pkgFromSys !== 'package' && pkgFromSys !== 'ros_package' ? pkgFromSys : '') ||
      baseName ||
      'ros_package'
    );
  }
  return project.system?.name || baseName || 'ros_system';
}

export function updateModelName(newName) {
  const trimmed = String(newName || '').trim();
  mutateProject((proj) => {
    if (state.mode === 'system') {
      proj.system = { ...(proj.system || {}), name: trimmed || 'ros_system' };
    } else if (state.mode === 'component') {
      syncPackagesFromNodes(proj, trimmed || 'ros_package');
    } else if (state.mode === 'ros') {
      const specs = extractRosSpecsList(proj);
      syncRosTypesAndNodes(proj, specs, trimmed || 'ros_package');
    }
  });
}

/**
 * CRITICAL INVARIANT:
 * In System View (.rossystem), changing node.label MUST NEVER alter node.from, node.pkg, or node.artifact!
 */
export function updateNodeLabel(nodeId, rawNewLabel) {
  const newLabel = String(rawNewLabel || '').trim();
  if (!newLabel) return;
  mutateProject((proj) => {
    const isRosSystem = state.mode === 'system' || Boolean(proj.isRosSystem);
    const isRos = state.mode === 'ros' || Boolean(proj.isRos);
    const node = (proj.nodes || []).find((n) => n.id === nodeId);
    if (!node) return;
    const oldLabel = node.label;
    node.label = newLabel;

    if (!isRosSystem && !isRos) {
      node.from = node.pkg ? `${node.pkg}.${newLabel}` : newLabel;
      syncPackagesFromNodes(proj);
    } else if (isRosSystem) {
      // Update any process node references that pointed to oldLabel
      for (const proc of proj.processes || []) {
        proc.nodes = (proc.nodes || []).map((nl) => (nl === oldLabel ? newLabel : nl));
      }
    }
  });
}

export function updateNodePackageAndArtifact(node, pkgVal, artVal) {
  const isRosSystem = state.mode === 'system' || Boolean(state.project?.isRosSystem);
  if (isRosSystem) return;
  mutateProject((proj) => {
    const target = (proj.nodes || []).find((n) => n.id === node.id);
    if (!target) return;
    if (pkgVal !== undefined) target.pkg = pkgVal;
    if (artVal !== undefined) target.artifact = artVal;
    syncPackagesFromNodes(proj, pkgVal);
  });
}

export function importCatalogueNode(catKey, catEntry, position) {
  if (state.isReadOnly) return;
  let createdId = null;
  mutateProject((proj) => {
    const baseName = catEntry.node || catEntry.artifact || catKey.split('.').pop() || 'node';
    let label = baseName;
    let suffix = 2;
    while ((proj.nodes || []).some((n) => n.label === label)) {
      label = `${baseName}_${suffix++}`;
    }
    const nodeId = `n_${label}`;
    createdId = nodeId;
    const pkg = catEntry.pkg || (catEntry.from ? catEntry.from.split('.')[0] : 'ros_pkg');
    const artifact = catEntry.artifact || catEntry.node || baseName;
    const fromRef = catEntry.from || `${pkg}.${artifact}`;

    const normIfaces = normalizeCatalogueInterfaces(catEntry.interfaces).map((f) => ({
      id: `i_${label}_${f.name}`,
      name: f.name,
      label: f.label || f.name,
      kind: f.kind || 'pub',
      type: f.type || '',
      exposed: true,
      artifact,
    }));

    const params = Object.entries(catEntry.parameters || {}).map(([pName, pDef]) => ({
      id: `p_${label}_${pName}`,
      name: pName,
      label: pName,
      ptype: (pDef && typeof pDef === 'object' ? pDef.type : 'String') || 'String',
      value: pDef && typeof pDef === 'object' ? pDef.value : undefined,
      sysValue: undefined,
      exposed: false,
      artifact,
    }));

    const idx = (proj.nodes || []).filter((n) => !n.subRef).length;
    const pos = position || {
      x: 80 + (idx % 3) * 340,
      y: 80 + Math.floor(idx / 3) * 240,
    };

    proj.nodes.push({
      id: nodeId,
      label,
      pkg,
      artifact,
      from: fromRef,
      backing: 'cat',
      ifaces: normIfaces,
      params,
      x: pos.x,
      y: pos.y,
    });
  });

  if (createdId) {
    setUIState({
      selectedNodeId: createdId,
      selectedEdgeId: null,
      selectedSubsystemRef: null,
      selectedProcessName: null,
      catalogueOpen: false,
    });
  }
}

export function importCatalogueSubsystem(sysEntry, position) {
  if (state.isReadOnly) return;
  const subRef = sysEntry.system;
  if (!subRef) return;

  if ((state.project.subSystems || []).some((s) => s.ref === subRef)) {
    showToast(`Subsystem "${subRef}" is already imported in this system.`, true);
    return;
  }

  mutateProject((proj) => {
    if (!proj.subSystems) proj.subSystems = [];
    const idx = proj.subSystems.length;
    const pos = position || { x: 100 + idx * 360, y: 360 };
    proj.subSystems.push({
      ref: subRef,
      fromFile: sysEntry.file,
      state: 'collapsed',
      x: pos.x,
      y: pos.y,
    });
    if (!proj.view) proj.view = {};
    if (!proj.view.subStates) proj.view.subStates = {};
    if (!proj.view.subPos) proj.view.subPos = {};
    proj.view.subStates[subRef] = 'collapsed';
    proj.view.subPos[subRef] = pos;

    // Populate backing='sub' member nodes so ports are immediately connectable
    const catNodes = state.nodeIndex?.nodes || {};
    for (const [nKey, nDef] of Object.entries(sysEntry.nodes || {})) {
      const memberId = `n_${subRef}_${nKey}`;
      if ((proj.nodes || []).some((n) => n.id === memberId)) continue;
      const fromKey = nDef?.from || nKey;
      const catMatch = catNodes[fromKey] || catNodes[nKey] || {};
      const rawIfaces =
        nDef?.interfaces && Object.keys(nDef.interfaces).length > 0
          ? nDef.interfaces
          : catMatch.interfaces || {};
      const ifaces = normalizeCatalogueInterfaces(rawIfaces).map((f) => ({
        id: `i_${subRef}_${nKey}_${f.name}`,
        name: f.name,
        label: f.label || f.name,
        kind: f.kind || 'pub',
        type: f.type || '',
        exposed: true,
        artifact: catMatch.artifact || (fromKey.includes('.') ? fromKey.split('.')[1] : nKey),
      }));
      proj.nodes.push({
        id: memberId,
        label: nKey,
        from: fromKey,
        pkg: catMatch.pkg || (fromKey.includes('.') ? fromKey.split('.')[0] : ''),
        artifact: catMatch.artifact || (fromKey.includes('.') ? fromKey.split('.')[1] : nKey),
        subRef,
        backing: 'sub',
        ifaces,
        params: [],
      });
    }
  });

  setUIState({
    selectedSubsystemRef: subRef,
    selectedNodeId: null,
    selectedEdgeId: null,
    selectedProcessName: null,
    catalogueOpen: false,
  });
}

export function runDagreAutoLayout() {
  if (state.isReadOnly) return;
  mutateLayout((proj) => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 65, ranksep: 190, marginx: 50, marginy: 60 });
    g.setDefaultEdgeLabel(() => ({}));

    const directNodes = (proj.nodes || []).filter((n) => !n.subRef && n.backing !== 'sub');
    for (const n of directNodes) {
      const portCount = (n.ifaces || []).filter((f) => f.exposed !== false).length;
      const h = Math.max(130, 84 + portCount * 32);
      g.setNode(n.id, { width: 280, height: h });
    }

    for (const sub of proj.subSystems || []) {
      const subMembers = (proj.nodes || []).filter((n) => n.subRef === sub.ref);
      const portCount = subMembers.reduce((acc, m) => acc + (m.ifaces || []).length, 0);
      const isFramed = (proj.view?.subStates?.[sub.ref] || sub.state) === 'framed';
      const w = isFramed ? Math.max(360, subMembers.length * 310) : 295;
      const h = isFramed ? 280 : Math.max(140, 88 + portCount * 30);
      g.setNode(`sub_${sub.ref}`, { width: w, height: h });
    }

    for (const c of proj.connections || []) {
      const fn = (proj.nodes || []).find((n) => n.id === c.from.n);
      const tn = (proj.nodes || []).find((n) => n.id === c.to.n);
      const srcId = fn?.subRef ? `sub_${fn.subRef}` : c.from.n;
      const tgtId = tn?.subRef ? `sub_${tn.subRef}` : c.to.n;
      if (srcId && tgtId && srcId !== tgtId && g.hasNode(srcId) && g.hasNode(tgtId)) {
        g.setEdge(srcId, tgtId);
      }
    }

    dagre.layout(g);

    for (const n of directNodes) {
      const pos = g.node(n.id);
      if (pos) {
        n.x = Math.round(pos.x - pos.width / 2);
        n.y = Math.round(pos.y - pos.height / 2);
      }
    }

    if (!proj.view.subPos) proj.view.subPos = {};
    for (const sub of proj.subSystems || []) {
      const pos = g.node(`sub_${sub.ref}`);
      if (pos) {
        sub.x = Math.round(pos.x - pos.width / 2);
        sub.y = Math.round(pos.y - pos.height / 2);
        proj.view.subPos[sub.ref] = { x: sub.x, y: sub.y };
      }
      // Also arrange member nodes neatly if framed
      const subMembers = (proj.nodes || []).filter((n) => n.subRef === sub.ref);
      subMembers.forEach((m, idx) => {
        m.x = (sub.x || 0) + 28 + idx * 305;
        m.y = (sub.y || 0) + 58;
      });
    }
  });
  requestFitView();
}
