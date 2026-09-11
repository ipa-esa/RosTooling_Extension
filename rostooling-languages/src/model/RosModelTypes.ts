export type RosInteractionKind = 'pub' | 'sub' | 'ss' | 'sc' | 'as' | 'ac' | 'param';

export interface RosInterface {
  id: string;
  name: string;
  kind: RosInteractionKind;
  type?: string;
  qos?: Record<string, string>;
  label?: string;
  exposed?: boolean;
  comments?: Record<string, unknown>;
}

export interface RosParameter {
  id?: string;
  name: string;
  ptype?: string;
  value?: string | number | boolean;
  label?: string;
  exposed?: boolean;
  sysValue?: string | number | boolean;
  comments?: Record<string, unknown>;
}

export interface RosNode {
  id: string;
  label: string;
  pkg?: string;
  artifact?: string;
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
  comments?: Record<string, unknown>;
  diag?: string[];
}

export interface RosConnection {
  id: string;
  from: { n: string; i: string };
  to: { n: string; i: string };
  midX?: number;
  midY?: number;
  connectorMode?: 'orthogonal' | 'linear' | 'spline';
  waypoints?: { x: number; y: number }[];
  midOffset?: number;
  comments?: Record<string, unknown>;
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
  comments?: Record<string, unknown>;
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
  type: string;
  name: string;
  constant?: boolean;
  value?: string;
  array?: boolean;
  arrayLength?: number;
  comments?: Record<string, unknown>;
}

export interface RosTypeSpec {
  name: string;
  category: 'msg' | 'srv' | 'action';
  pkg: string;
  fields?: Record<string, RosField[]>;
  comments?: Record<string, unknown>;
}

export interface RosPackage {
  name: string;
  fromGitRepo?: string;
  artifacts: {
    name: string;
    node?: string;
    ifaces: RosInterface[];
    params: RosParameter[];
    comments?: Record<string, unknown>;
  }[];
  comments?: Record<string, unknown>;
}

export interface RosProject {
  formatVersion: number;
  isRosSystem?: boolean;
  isRos?: boolean;
  system: {
    name: string;
    fromFile?: string;
    comments?: Record<string, unknown>;
  };
  subSystems: RosSubSystem[];
  nodes: RosNode[];
  connections: RosConnection[];
  packages: Record<string, RosPackage>;
  types: Record<string, RosTypeSpec>;
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

