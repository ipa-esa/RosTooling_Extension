export type RosInteractionKind = 'pub' | 'sub' | 'ss' | 'sc' | 'as' | 'ac' | 'param';

export type RosLifecycleState = 'Unconfigured' | 'Inactive' | 'Active' | 'Finalized';

export interface RosInterface {
  id: string;
  name: string;
  kind: RosInteractionKind;
  type?: string;
  activeStates?: RosLifecycleState[];
  qos?: Record<string, string>;
  /** `ns:` namespace expression (e.g. "GlobalNamespace"), .ros2 interfaces only. */
  ns?: string;
  label?: string;
  exposed?: boolean;
  artifact?: string;
  line?: number;
  comments?: Record<string, unknown>;
  quoted?: boolean;
  targetRefQuoted?: boolean;
  lineComment?: string;
}

export interface RosSystemParameter {
  name: string;
  type: string;
  value?: unknown;
  quoted?: boolean;
  valueQuoted?: boolean;
  rawValText?: string;
  line?: number;
  comments?: Record<string, unknown>;
  lineComment?: string;
}

export interface RosParameter {
  id?: string;
  name: string;
  /** `ns:` namespace expression, .ros2 parameters only. */
  ns?: string;
  ptype?: string;
  value?: unknown;
  label?: string;
  exposed?: boolean;
  sysValue?: unknown;
  artifact?: string;
  line?: number;
  comments?: Record<string, unknown>;
  quoted?: boolean;
  targetRefQuoted?: boolean;
  valueQuoted?: boolean;
  rawValText?: string;
  lineComment?: string;
}

export interface RosNode {
  id: string;
  /** GLSP element id of the owning .ros2 Artifact (package models only). */
  artifactId?: string;
  label: string;
  pkg?: string;
  artifact?: string;
  isLifecycle?: boolean;
  namespace?: string;
  from?: string;
  backing?: 'local' | 'cat' | 'sub' | 'type';
  typeCategory?: 'msg' | 'srv' | 'action';
  typeSpec?: RosTypeSpec;
  subRef?: string;
  ifaces: RosInterface[];
  params: RosParameter[];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  line?: number;
  lineEnd?: number;
  comments?: Record<string, unknown>;
  diag?: string[];
  quoted?: boolean;
  fromQuoted?: boolean;
  fromComment?: string;
  lineComment?: string;
}

export interface RosConnection {
  id: string;
  from: { n: string; i: string };
  to: { n: string; i: string };
  rawFrom?: string;
  rawTo?: string;
  midX?: number;
  midY?: number;
  connectorMode?: 'orthogonal' | 'linear' | 'spline';
  waypoints?: { x: number; y: number }[];
  midOffset?: number;
  line?: number;
  comments?: Record<string, unknown>;
  fromQuoted?: boolean;
  toQuoted?: boolean;
  hasBrackets?: boolean;
  lineComment?: string;
}

export interface RosSubSystem {
  ref: string;
  fromFile?: string;
  localFile?: string;
  state?: 'collapsed' | 'framed' | 'drill';
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  line?: number;
  comments?: Record<string, unknown>;
  quoted?: boolean;
  lineComment?: string;
  fromComment?: string;
  graph?: {
    nodes: {
      label: string;
      pkg?: string;
      artifact?: string;
      interfaces: { label: string; name: string; kind: RosInteractionKind; type?: string }[];
      parameters?: { label: string; name: string; ptype?: string; value?: string | number | boolean }[];
    }[];
    connections: {
      from: { n: string; i: string };
      to: { n: string; i: string };
    }[];
  };
}

export interface RosField {
  /** GLSP element id of the message field (MessagePart). */
  id?: string;
  type: string;
  name: string;
  constant?: boolean;
  value?: string;
  array?: boolean;
  arrayLength?: number;
  comments?: Record<string, unknown>;
}

export interface RosTypeSpec {
  /** GLSP element id of the spec. */
  id?: string;
  name: string;
  category: 'msg' | 'srv' | 'action';
  pkg: string;
  fields?: Record<string, RosField[]>;
  line?: number;
  comments?: Record<string, unknown>;
}

export interface RosPackage {
  /** GLSP element id of the package. */
  id?: string;
  name: string;
  fromGitRepo?: string;
  artifacts: {
    name: string;
    node?: string;
    isLifecycle?: boolean;
    ifaces: RosInterface[];
    params: RosParameter[];
    comments?: Record<string, unknown>;
  }[];
  comments?: Record<string, unknown>;
}

export interface RosProcess {
  /** GLSP element id of the process. */
  id?: string;
  name: string;
  nodes: string[];
  threads?: number;
  line?: number;
  comments?: Record<string, unknown>;
}

export interface RosModelDiagnostic {
  elementId?: string;
  elementKind: 'node' | 'interface' | 'parameter' | 'connection' | 'process' | 'subsystem' | 'system';
  targetName?: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  source?: string;
}

export interface RosCatalogueFolder {
  id: string;
  name: string;
  path: string;
  isCustom?: boolean;
}

export interface RosCatalogueIndex {
  types: Record<string, {
    pkg: string;
    category: 'msg' | 'srv' | 'action';
    file?: string;
    source?: string;
    domain?: string;
    fields?: Record<string, RosField[]>;
  }>;
  nodes: Record<string, {
    node?: string;
    artifact: string;
    from: string;
    pkg: string;
    file?: string;
    source?: string;
    domain?: string;
    interfaces: Record<string, string | { kind: string; type?: string }>;
    parameters?: Record<string, { type?: string; value?: string | number | boolean }>;
  }>;
  systems: {
    system: string;
    file: string;
    fullPath?: string;
    source?: string;
    domain?: string;
    nodes: Record<string, { from?: string; interfaces?: Record<string, string> }>;
  }[];
  sources: string[];
  lastSync?: number;
}

export interface RosProject {
  formatVersion: number;
  isRosSystem?: boolean;
  isRos?: boolean;
  system: {
    name: string;
    fromFile?: string;
    comments?: Record<string, unknown>;
    quoted?: boolean;
  };
  sectionOrder?: ('subSystems' | 'processes' | 'nodes' | 'parameters' | 'connections')[];
  parameters?: RosSystemParameter[];
  subSystems: RosSubSystem[];
  processes?: RosProcess[];
  nodes: RosNode[];
  connections: RosConnection[];
  packages: Record<string, RosPackage>;
  types: Record<string, RosTypeSpec>;
  diagnostics?: RosModelDiagnostic[];
  view?: {
    tx?: number;
    ty?: number;
    k?: number;
    level?: number;
    connectorMode?: 'orthogonal' | 'linear' | 'spline';
    subStates?: Record<string, 'collapsed' | 'framed' | 'drill'>;
    subPos?: Record<string, { x: number; y: number }>;
    nodeSize?: Record<string, { w: number; h: number }>;
    subSize?: Record<string, { w: number; h: number }>;
    connMidX?: Record<string, number>;
    connMidY?: Record<string, number>;
    connWaypoints?: Record<string, { x: number; y: number }[]>;
  };
  seededFrom?: string;
  seededFromAll?: string[];
}

export interface ConnectionValidationResult {
  valid: boolean;
  reason?: string;
  normalizedFrom?: { n: string; i: string; kind: RosInteractionKind };
  normalizedTo?: { n: string; i: string; kind: RosInteractionKind };
}

export interface RosLayoutSchematic {
  $schema: string;
  version: number;
  modelFile: string;
  modelType: 'rossystem' | 'ros2' | 'ros1' | 'ros';
  canvas: {
    view: { tx: number; ty: number; zoom: number };
    connectorMode: 'orthogonal' | 'linear' | 'spline';
  };
  nodes: {
    id: string;
    label: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
  }[];
  subsystems: {
    ref: string;
    state: 'collapsed' | 'framed';
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    frameWidth?: number;
    frameHeight?: number;
  }[];
  connections: {
    id: string;
    from: { node: string; iface: string };
    to: { node: string; iface: string };
    connectorMode?: 'orthogonal' | 'linear' | 'spline';
    midX?: number;
    midY?: number;
    waypoints?: { x: number; y: number }[];
  }[];
}

