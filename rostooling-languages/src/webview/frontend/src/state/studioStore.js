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

export const PIPELINE_ROLES = {
  Sensing: {
    label: 'Sensing',
    description: 'Acquires raw measurements or sensor observations from the robot or environment.',
    color: '#06b6d4',
    bg: 'rgba(6, 182, 212, 0.16)',
  },
  Perception: {
    label: 'Perception',
    description: 'Transforms sensor data into detections, localization, or semantic estimates.',
    color: '#3b82f6',
    bg: 'rgba(59, 130, 246, 0.16)',
  },
  'World Modeling': {
    label: 'World Modeling',
    description: 'Maintains persistent spatial, map, or knowledge state of the robot and world.',
    color: '#818cf8',
    bg: 'rgba(129, 140, 248, 0.16)',
  },
  Planning: {
    label: 'Planning',
    description: 'Computes task, motion, or trajectory plans to achieve mission objectives.',
    color: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.16)',
  },
  Control: {
    label: 'Control',
    description: 'Regulates closed-loop motion, tracking, or behavioral execution.',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.16)',
  },
  Actuation: {
    label: 'Actuation',
    description: 'Drives hardware actuators, motors, grippers, or external effectors.',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.16)',
  },
  Communication: {
    label: 'Communication',
    description: 'Bridges networks, telemetry, fleet interfaces, or human-robot interaction.',
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.16)',
  },
  Unassigned: {
    label: 'Unassigned',
    description: 'Engineering pipeline role has not yet been assigned.',
    color: '#94a3b8',
    bg: 'rgba(148, 163, 184, 0.14)',
  },
};

export const PIPELINE_ROLE_KEYS = Object.keys(PIPELINE_ROLES);

/** @deprecated Use PIPELINE_ROLES */
export const CORESENSE_ROLES = PIPELINE_ROLES;
/** @deprecated Use PIPELINE_ROLE_KEYS */
export const CORESENSE_ROLE_KEYS = PIPELINE_ROLE_KEYS;

export function getNodeRole(node, project) {
  if (!node) return 'Unassigned';
  const raw = node.role || project?.studio?.modules?.[node.id]?.role || 'Unassigned';
  return PIPELINE_ROLES[raw] ? raw : 'Unassigned';
}

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
      ...(Array.isArray(f.activeStates) && f.activeStates.length > 0
        ? { activeStates: [...f.activeStates] }
        : {}),
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
        ...(Array.isArray(obj.activeStates) && obj.activeStates.length > 0
          ? { activeStates: [...obj.activeStates] }
          : {}),
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

export function normalizeDiagnostics(diag) {
  if (!diag) return [];
  if (Array.isArray(diag)) {
    return diag.map((d) => {
      if (typeof d === 'string') return { severity: 'warning', message: d };
      if (typeof d === 'object' && d !== null) {
        return { severity: d.severity || 'warning', message: d.message || '', ...d };
      }
      return { severity: 'warning', message: String(d) };
    });
  }
  if (typeof diag === 'object' && diag !== null) {
    const out = [];
    if (Array.isArray(diag.global)) {
      out.push(
        ...diag.global.map((d) =>
          typeof d === 'string'
            ? { severity: 'warning', message: d }
            : { severity: d.severity || 'warning', message: d.message || '', ...d }
        )
      );
    }
    if (diag.byNode && typeof diag.byNode === 'object') {
      for (const [nodeId, list] of Object.entries(diag.byNode)) {
        if (Array.isArray(list)) {
          out.push(
            ...list.map((d) =>
              typeof d === 'string'
                ? { severity: 'warning', message: d, targetName: nodeId }
                : { severity: d.severity || 'warning', message: d.message || '', targetName: nodeId, ...d }
            )
          );
        }
      }
    }
    return out;
  }
  return [];
}

export function hydrateMacroProjectForCanvas(rawProj) {
  const proj = cloneDeep(rawProj || {});
  proj.formatVersion = 5;
  proj.isRosSystem = true;
  proj.isRos = false;
  proj.diagnostics = normalizeDiagnostics(proj.diagnostics);
  if (!proj.system) proj.system = { name: 'ros_system' };
  if (!proj.nodes) proj.nodes = [];
  if (!proj.subSystems) proj.subSystems = [];
  if (!proj.processes) proj.processes = [];
  if (!proj.connections) proj.connections = [];
  if (!proj.packages) proj.packages = {};
  if (!proj.types) proj.types = {};
  if (!proj.view) {
    proj.view = { tx: 40, ty: 40, k: 1, connectorMode: 'orthogonal', subStates: {}, subPos: {} };
  }
  if (!proj.studio) {
    proj.studio = { brief: {}, behavior: [], criteria: [], modules: {}, deployment: { units: [] } };
  }
  if (!proj.studio.modules) proj.studio.modules = {};

  for (const node of proj.nodes) {
    const modRole = proj.studio.modules[node.id]?.role;
    node.role = CORESENSE_ROLES[node.role]
      ? node.role
      : CORESENSE_ROLES[modRole]
      ? modRole
      : 'Unassigned';
    if (!proj.studio.modules[node.id]) {
      proj.studio.modules[node.id] = { role: node.role, unit: 'unassigned', sourcePaths: [] };
    } else {
      proj.studio.modules[node.id].role = node.role;
    }
    if (!node.from && node.pkg && (node.artifact || node.node)) {
      node.from = `${node.pkg}.${node.artifact || node.node}`;
    }
    for (const iface of node.ifaces || []) {
      if (iface.exposed === undefined) iface.exposed = true;
      if (!iface.label) iface.label = iface.name || iface.id;
      if (!iface.name) iface.name = iface.label || iface.id;
    }
  }
  return proj;
}

export function prepareMacroProjectForDaemon(rawProj) {
  const proj = cloneDeep(rawProj || {});
  proj.formatVersion = 5;
  if (!proj.studio) {
    proj.studio = { brief: {}, behavior: [], criteria: [], modules: {}, deployment: { units: [] } };
  }
  if (!proj.studio.modules) proj.studio.modules = {};
  for (const node of proj.nodes || []) {
    const role = getNodeRole(node, proj);
    node.role = role;
    node.node = node.node || node.artifact || node.label;
    node.artifact = node.artifact || node.node || node.label;
    if (!node.pkg && node.from && node.from.includes('.')) {
      node.pkg = node.from.split('.')[0];
    }
    if (!proj.studio.modules[node.id]) {
      proj.studio.modules[node.id] = { role, unit: 'unassigned', sourcePaths: [] };
    } else {
      proj.studio.modules[node.id].role = role;
    }
  }
  return proj;
}

const initialProject = init.mode === 'macro' ? hydrateMacroProjectForCanvas(init.project) : (init.project || {});
if (initialProject) {
  initialProject.diagnostics = normalizeDiagnostics(initialProject.diagnostics);
}

const state = {
  project: initialProject,
  mode: init.mode,
  macroStage: init.macroStage || 'intent',
  macroPinnedStage: Boolean(init.macroPinnedStage),
  macroProjects: [],
  macroActiveProjectId: init.macroInitialProjectId || '',
  macroRevision: 0,
  macroModelState: 'clean',
  macroChecks: [],
  macroEvidence: [],
  macroMcpStatus: null,
  macroMcpResult: null,
  macroSources: null,
  macroBusy: false,
  macroExternalChange: null,
  macroWorkspaceRoot: init.macroWorkspaceRoot || '',
  macroCustomScanPath: '',

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
  selectedCatalogueKeys: {},
  autoWireResult: null,

  toast: null,
  fitTrigger: 1,
  past: [],
  future: [],
};

let version = 0;
const listeners = new Set();
let toastTimer = null;
let macroSaveTimer = null;

function dispatchProjectPersist(proj, isLayoutOnly = false) {
  if (state.mode === 'macro') {
    if (macroSaveTimer) clearTimeout(macroSaveTimer);
    const prepared = prepareMacroProjectForDaemon(proj);
    macroSaveTimer = setTimeout(() => {
      hostBridge.macroSaveProject(prepared);
    }, isLayoutOnly ? 220 : 120);
    return;
  }
  if (isLayoutOnly) {
    hostBridge.saveLayout(proj);
  } else {
    hostBridge.applyEdit(proj);
  }
}

function emitChange() {
  version += 1;
  for (const fn of listeners) {
    fn();
  }
}

registerHostMessageListener({
  onUpdateModel(freshProject) {
    const hydrated = state.mode === 'macro' ? hydrateMacroProjectForCanvas(freshProject) : (freshProject || {});
    if (hydrated) {
      hydrated.diagnostics = normalizeDiagnostics(hydrated.diagnostics);
    }
    state.project = hydrated;
    if (state.selectedNodeId && !(hydrated.nodes || []).some((n) => n.id === state.selectedNodeId)) {
      state.selectedNodeId = state.mode === 'component' ? hydrated.nodes?.[0]?.id || null : null;
    }
    if (state.selectedEdgeId && !(hydrated.connections || []).some((c) => c.id === state.selectedEdgeId)) {
      state.selectedEdgeId = null;
    }
    emitChange();
  },
  onUpdateDiagnostics(diagnostics) {
    state.project = {
      ...state.project,
      diagnostics: normalizeDiagnostics(diagnostics),
    };
    emitChange();
  },
  onUpdateCatalogue(nodeCatalog, typeCatalog) {
    state.nodeIndex = nodeCatalog || {};
    state.typeIndex = typeCatalog || {};
    emitChange();
  },
  onMacroState(msg) {
    if (Array.isArray(msg.projects)) {
      state.macroProjects = msg.projects
        .map((p) => {
          const id = String(p.id || p.projectId || '').trim();
          const name = String(p.name || p.systemName || id || 'Untitled system').trim();
          return {
            id,
            projectId: id,
            name,
            systemName: p.systemName || p.name || name,
            root: p.root,
            promotedTargetDir: p.promotedTargetDir,
          };
        })
        .filter((p) => Boolean(p.id));
    }
    if (msg.activeProjectId !== undefined) {
      state.macroActiveProjectId = msg.activeProjectId || '';
    }
    if (msg.envelope) {
      state.macroExternalChange = null;
      const env = msg.envelope;
      state.macroRevision = env.revision ?? state.macroRevision;
      state.macroModelState = env.modelState || 'clean';
      if (env.project) {
        state.project = hydrateMacroProjectForCanvas(env.project);
      }
      if (Array.isArray(env.evidence)) {
        state.macroEvidence = env.evidence;
      }
    }
    if (msg.mcpStatus !== undefined) {
      state.macroMcpStatus = msg.mcpStatus;
    }
    if (msg.busy !== undefined) {
      state.macroBusy = Boolean(msg.busy);
    }
    if (msg.stage && !state.macroPinnedStage) {
      state.macroStage = msg.stage;
    }
    if (msg.workspaceRoot !== undefined) {
      state.macroWorkspaceRoot = msg.workspaceRoot || '';
    }
    emitChange();
  },
  onMacroChecksResult(msg) {
    state.macroBusy = false;
    state.macroChecks = msg.checks || [];
    if (Array.isArray(msg.evidence)) {
      state.macroEvidence = msg.evidence;
    }
    emitChange();
  },
  onMacroMcpResult(msg) {
    state.macroBusy = false;
    state.macroMcpResult = msg.result || null;
    emitChange();
  },
  onMacroSourcesResult(msg) {
    state.macroBusy = false;
    state.macroSources = msg.sources || null;
    emitChange();
  },
  onMacroWorkspaceFolderPicked(folderPath) {
    state.macroCustomScanPath = folderPath;
    emitChange();
  },
  onMacroNavigateStage(stage) {
    if (stage) {
      state.macroStage = stage;
      emitChange();
    }
  },
  onMacroToast(text, isError) {
    state.macroBusy = false;
    if (text) {
      showToast(text, isError);
    } else {
      emitChange();
    }
  },
  onMacroExternalChange(msg) {
    state.macroExternalChange = {
      source: msg.source || 'disk',
      timestamp: Date.now(),
    };
    emitChange();
  },
});

if (state.mode === 'macro') {
  setTimeout(() => hostBridge.macroReady(), 0);
}

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
  dispatchProjectPersist(next, false);
  emitChange();
}

export function mutateLayout(recipe) {
  if (state.isReadOnly) return;
  const next = cloneDeep(state.project);
  if (!next.view) next.view = {};
  recipe(next);
  state.project = next;
  dispatchProjectPersist(next, true);
  emitChange();
}

export function undoEdit() {
  if (state.isReadOnly || state.past.length === 0) return;
  state.future.push(cloneDeep(state.project));
  const prev = state.past.pop();
  state.project = prev;
  dispatchProjectPersist(prev, false);
  emitChange();
}

export function redoEdit() {
  if (state.isReadOnly || state.future.length === 0) return;
  state.past.push(cloneDeep(state.project));
  const next = state.future.pop();
  state.project = next;
  dispatchProjectPersist(next, false);
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
    if (state.mode === 'system' || state.mode === 'macro') {
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
    const isRosSystem = state.mode === 'system' || state.mode === 'macro' || Boolean(proj.isRosSystem);
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
  const isRosSystem = state.mode === 'system' || state.mode === 'macro' || Boolean(state.project?.isRosSystem);
  if (isRosSystem) return;
  mutateProject((proj) => {
    const target = (proj.nodes || []).find((n) => n.id === node.id);
    if (!target) return;
    if (pkgVal !== undefined) target.pkg = pkgVal;
    if (artVal !== undefined) target.artifact = artVal;
    syncPackagesFromNodes(proj, pkgVal);
  });
}

export function updateNodeRole(nodeId, rawRole) {
  if (state.isReadOnly) return;
  const validRole = CORESENSE_ROLES[rawRole] ? rawRole : 'Unassigned';
  mutateProject((proj) => {
    const target = (proj.nodes || []).find((n) => n.id === nodeId);
    if (!target) return;
    target.role = validRole;
    if (proj.studio && proj.studio.modules) {
      if (!proj.studio.modules[nodeId]) {
        proj.studio.modules[nodeId] = { role: validRole, unit: 'unassigned', sourcePaths: [] };
      } else {
        proj.studio.modules[nodeId].role = validRole;
      }
    }
  });
}

function buildNodeFromCatalogueEntry(proj, catKey, catEntry, position) {
  const baseName = catEntry.node || catEntry.artifact || catKey.split('.').pop() || 'node';
  let label = baseName;
  let suffix = 2;
  while ((proj.nodes || []).some((n) => n.label === label)) {
    label = `${baseName}_${suffix++}`;
  }
  const nodeId = `n_${label}`;
  const pkg = catEntry.pkg || (catEntry.from ? catEntry.from.split('.')[0] : 'ros_pkg');
  const artifact = catEntry.artifact || catEntry.node || baseName;
  const fromRef = catEntry.from || `${pkg}.${artifact}`;

  const normIfaces = normalizeCatalogueInterfaces(catEntry.interfaces).map((f) => ({
    id: `i_${label}_${f.name}`,
    name: f.name,
    label: f.label || f.name,
    kind: f.kind || 'pub',
    type: f.type || '',
    ...(Array.isArray(f.activeStates) && f.activeStates.length > 0
      ? { activeStates: [...f.activeStates] }
      : {}),
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

  return {
    id: nodeId,
    label,
    pkg,
    artifact,
    from: fromRef,
    isLifecycle: Boolean(catEntry.isLifecycle),
    role: catEntry.role && CORESENSE_ROLES[catEntry.role] ? catEntry.role : 'Unassigned',
    backing: 'cat',
    ifaces: normIfaces,
    params,
    x: pos.x,
    y: pos.y,
  };
}

export function importCatalogueNode(catKey, catEntry, position) {
  if (state.isReadOnly) return;
  let createdId = null;
  mutateProject((proj) => {
    const created = buildNodeFromCatalogueEntry(proj, catKey, catEntry, position);
    createdId = created.id;
    proj.nodes.push(created);
    if (proj.studio && proj.studio.modules) {
      proj.studio.modules[created.id] = {
        role: created.role || 'Unassigned',
        unit: 'unassigned',
        sourcePaths: [],
      };
    }
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

// ============================================================================
// Deterministic Auto-Wiring Engine (100% Parity with ipa-rostooling-studio)
// ============================================================================

export function normalizeRosType(type) {
  return String(type || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/(msg|srv|action)\//, '/');
}

export function nameOf(node, iface, proj = state.project) {
  const bound = proj?.studio?.modules?.[node?.id]?.portBindings?.[iface?.id];
  const raw = bound || iface?.name || iface?.label || '';
  return String(raw).trim().replace(/^\/+/, '');
}

export function getPortTokens(node, iface, proj = state.project) {
  const bound = proj?.studio?.modules?.[node?.id]?.portBindings?.[iface?.id];
  const cleanBound = bound ? String(bound).trim().replace(/^\/+/, '') : null;
  const cleanName = iface?.name ? String(iface.name).trim().replace(/^\/+/, '') : null;
  const cleanLabel = iface?.label ? String(iface.label).trim().replace(/^\/+/, '') : null;

  const remapName = cleanBound || cleanLabel || null;
  const baseName = cleanName || cleanLabel || null;

  return { baseName, remapName, bound: cleanBound };
}

/**
 * Tiered interface matching for auto-wiring:
 * - Tier 1: Intentional Remapping Match (Both ports explicitly remapped or bound to the same topic/service name)
 * - Tier 2: Directed Remapping Match (One port remapped to target the other component's interface name)
 * - Tier 3: Underlying Contract Match (Both ports share the same default ROS interface name)
 */
export function portsMatch(nodeA, ifaceA, nodeB, ifaceB, proj = state.project) {
  const tokA = getPortTokens(nodeA, ifaceA, proj);
  const tokB = getPortTokens(nodeB, ifaceB, proj);

  // 1. Tier 1: Intentional Remapping Match (Both ports bound or remapped to the exact same name)
  if (tokA.remapName && tokB.remapName && tokA.remapName === tokB.remapName) {
    return { matched: true, tier: 'remap', resolvedName: tokA.remapName };
  }

  // 2. Tier 2: Directed Remapping Match (One port remapped to target the other port)
  if (tokA.remapName && tokB.baseName && tokA.remapName === tokB.baseName) {
    return { matched: true, tier: 'directed-remap', resolvedName: tokB.baseName };
  }
  if (tokB.remapName && tokA.baseName && tokB.remapName === tokA.baseName) {
    return { matched: true, tier: 'directed-remap', resolvedName: tokA.baseName };
  }

  // 3. Tier 3: Underlying Contract Match (Both ports declare the same ROS interface name)
  if (tokA.baseName && tokB.baseName && tokA.baseName === tokB.baseName) {
    return { matched: true, tier: 'contract', resolvedName: tokA.baseName };
  }

  return { matched: false, tier: null, resolvedName: null };
}

function isContractLocked(node) {
  return Boolean(node && ['cat', 'sub'].includes(node.backing));
}

export function connectionProblem(connSpec, proj = state.project) {
  if (!connSpec || !proj) return 'Choose two interface ports.';
  const a = (proj.nodes || []).find((n) => n.id === connSpec.source);
  const b = (proj.nodes || []).find((n) => n.id === connSpec.target);
  const from = (a?.ifaces || []).find(
    (f) => f.id === connSpec.sourceHandle || f.label === connSpec.sourceHandle || f.name === connSpec.sourceHandle
  );
  const to = (b?.ifaces || []).find(
    (f) => f.id === connSpec.targetHandle || f.label === connSpec.targetHandle || f.name === connSpec.targetHandle
  );
  if (!a || !b || !from || !to) return 'Choose two interface ports.';
  if (a.id === b.id) return 'Cannot connect a component to itself.';
  const expectedPartner = KIND_META[from.kind]?.partner;
  if (!expectedPartner || expectedPartner !== to.kind) {
    const srcName = KIND_META[from.kind]?.label || from.kind;
    const expName = KIND_META[expectedPartner]?.label?.toLowerCase() || expectedPartner || 'partner port';
    return `${srcName} connects only to ${expName}.`;
  }
  const fromType = normalizeRosType(from.type);
  const toType = normalizeRosType(to.type);
  if (fromType && toType && fromType !== toType) {
    return `Types differ: ${from.type} and ${to.type}.`;
  }
  if ((!fromType && isContractLocked(a)) || (!toType && isContractLocked(b))) {
    return 'This referenced contract has an unresolved type. Update its source model before connecting.';
  }
  if (!fromType && !toType) {
    return 'Set a message, service or action type on one port first.';
  }
  if (
    (proj.connections || []).some(
      (c) => c.from.n === a.id && c.from.i === from.id && c.to.n === b.id && c.to.i === to.id
    )
  ) {
    return 'These interfaces are already connected.';
  }
  return null;
}

export function connectMatchingOnProject(proj, skipped = [], connected = []) {
  if (!proj.connections) proj.connections = [];
  const nodes = proj.nodes || [];
  for (const a of nodes) {
    for (const f of a.ifaces || []) {
      if (f.exposed === false) continue;
      if (KIND_META[f.kind]?.side !== 'source') continue;
      for (const b of nodes) {
        if (b.id === a.id) continue;
        // Never mutate internal wires inside the same imported subsystem
        if (a.subRef && a.subRef === b.subRef) continue;
        for (const t of b.ifaces || []) {
          if (t.exposed === false) continue;
          if (t.kind !== KIND_META[f.kind].partner) continue;

          const matchResult = portsMatch(a, f, b, t, proj);
          if (!matchResult.matched) continue;
          const srcResolvedName = matchResult.resolvedName;

          // Dynamic runtime token guard ({...})
          if (
            (f.name || '').includes('{') ||
            (f.label || '').includes('{') ||
            (t.name || '').includes('{') ||
            (t.label || '').includes('{') ||
            srcResolvedName.includes('{')
          ) {
            skipped.push(
              `${a.label} ${f.label || f.name} → ${b.label}: name still has a runtime {…} part`
            );
            continue;
          }

          const why = connectionProblem(
            { source: a.id, sourceHandle: f.id, target: b.id, targetHandle: t.id },
            proj
          );
          const wireLabel = `${a.label} ${srcResolvedName} → ${b.label}`;
          if (why) {
            if (!/already connected/i.test(why)) {
              skipped.push(`${wireLabel}: ${why}`);
            }
            continue;
          }

          if (!f.type) f.type = t.type;
          if (!t.type) t.type = f.type;

          const connId = `c_${f.id}_${t.id}_${proj.connections.length + 1}`;
          proj.connections.push({
            id: connId,
            from: { n: a.id, i: f.id },
            to: { n: b.id, i: t.id },
          });
          connected.push(`${wireLabel} (${normalizeRosType(f.type || t.type)})`);
        }
      }
    }
  }
  return { connected, skipped };
}

export function connectPlaced() {
  if (state.isReadOnly) {
    showToast('Core catalogue models are read-only and cannot be modified.', true);
    return { placed: [], connected: [], skipped: [] };
  }
  const skipped = [];
  const connected = [];
  mutateProject((proj) => {
    connectMatchingOnProject(proj, skipped, connected);
  });
  const onCanvas = (state.project.nodes || []).length;
  if (connected.length > 0) {
    runDagreAutoLayout();
  }
  const result = {
    mode: 'placed',
    placed: [],
    onCanvas,
    connected,
    skipped,
  };
  setUIState({ autoWireResult: result });
  return result;
}

export function addAndConnect(explicitEntries) {
  if (state.isReadOnly) {
    showToast('Core catalogue models are read-only and cannot be modified.', true);
    return { placed: [], connected: [], skipped: [] };
  }
  const rawMap = state.nodeIndex?.nodes || {};
  let entriesToPlace = explicitEntries;
  if (!Array.isArray(entriesToPlace)) {
    const pickedKeys = Object.keys(state.selectedCatalogueKeys || {}).filter(
      (k) => state.selectedCatalogueKeys[k]
    );
    entriesToPlace = pickedKeys
      .filter((k) => rawMap[k])
      .map((k) => ({ key: k, entry: rawMap[k] }));
  }

  const placed = [];
  const skipped = [];
  const connected = [];

  mutateProject((proj) => {
    if (!proj.nodes) proj.nodes = [];
    for (const item of entriesToPlace || []) {
      const catKey = item.key || item.from || item.name || 'node';
      const catEntry = item.entry || item;
      const pkg = catEntry.pkg || (catEntry.from ? catEntry.from.split('.')[0] : 'ros_pkg');
      const artOrNode = catEntry.artifact || catEntry.node || catKey.split('.').pop();
      const alreadyExists = proj.nodes.some(
        (n) => n.pkg === pkg && (n.artifact === artOrNode || n.label === artOrNode)
      );
      if (alreadyExists) {
        skipped.push(`${artOrNode}: already in the system`);
        continue;
      }
      const created = buildNodeFromCatalogueEntry(proj, catKey, catEntry);
      proj.nodes.push(created);
      if (proj.studio && proj.studio.modules) {
        proj.studio.modules[created.id] = {
          role: created.role || 'Unassigned',
          unit: 'unassigned',
          sourcePaths: [],
        };
      }
      placed.push(created.label);
    }

    connectMatchingOnProject(proj, skipped, connected);
  });

  if (placed.length > 0 || connected.length > 0) {
    runDagreAutoLayout();
  }

  const result = {
    mode: 'addAndConnect',
    placed,
    connected,
    skipped,
  };
  setUIState({
    catalogueOpen: false,
    selectedCatalogueKeys: {},
    autoWireResult: result,
  });
  return result;
}
