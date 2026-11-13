import * as net from 'net';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createMessageConnection,
  MessageConnection,
  SocketMessageReader,
  SocketMessageWriter,
} from 'vscode-jsonrpc/node';
import {
  RosProject,
  RosNode,
  RosInterface,
  RosParameter,
  RosConnection,
  RosSubSystem,
  RosProcess,
  RosModelDiagnostic,
  RosInteractionKind,
  RosPackage,
  RosTypeSpec,
  RosField,
  RosLifecycleState,
} from '../model/RosModelTypes';

export interface GPoint {
  x: number;
  y: number;
}

export interface GDimension {
  width: number;
  height: number;
}

export interface GModelElement {
  id: string;
  type: string;
  children?: GModelElement[];
  position?: GPoint;
  size?: GDimension;
  args?: Record<string, unknown>;
  // GLabel
  text?: string;
  // GEdge
  sourceId?: string;
  targetId?: string;
  routerKind?: string;
  routingPoints?: GPoint[];
  // GGraph
  revision?: number;
}

export interface GGraph extends GModelElement {
  type: 'graph' | string;
  children: GModelElement[];
}

export interface GlspMarker {
  label: string;
  description: string;
  elementId: string;
  kind: 'error' | 'warning' | 'info' | string;
}

export interface GlspAction {
  kind: string;
  requestId?: string;
  responseId?: string;
  isOperation?: boolean;
  [key: string]: unknown;
}

export interface GlspActionMessage {
  clientId: string;
  action: GlspAction;
}

export interface GlspBridgeOptions {
  host?: string;
  port?: number;
  javaExecutable?: string;
  jarPath?: string;
  cataloguePath?: string;
  autoSpawn?: boolean;
}

interface SessionSubscription {
  clientId: string;
  sourceUri: string;
  latestGraph?: GGraph;
  latestMarkers: GlspMarker[];
  onModelUpdate?: (graph: GGraph) => void;
  onMarkersUpdate?: (markers: GlspMarker[]) => void;
  /** Proxy sessions (Sprotty/GLSP client in the webview) receive every server action raw. */
  onRawAction?: (action: GlspAction) => void;
  pendingModelResolvers: ((graph: GGraph) => void)[];
  pendingMarkerResolvers: ((markers: GlspMarker[]) => void)[];
}

const CLIENT_ACTION_KINDS = [
  'setModel',
  'updateModel',
  'setMarkers',
  'setDirtyState',
  'status',
  'message',
  'startProgress',
  'updateProgress',
  'endProgress',
  'exportSvg',
  'setRosIndex',
  'setRosTextEdits',
];

/** Surgical text change computed by the Java serializer (offsets refer to `baseText`). */
export interface RosTextEditsResult {
  sourceUri: string;
  baseText: string;
  newText: string;
  edits: { offset: number; length: number; text: string }[];
}

/** One model file as described by the Java server's `requestRosIndex` action. */
export interface RosIndexFile {
  path: string;
  kind?: 'ros' | 'ros2' | 'rossystem';
  syntaxErrors?: number;
  error?: string;
  packages?: {
    name: string;
    kind: string;
    fromGitRepo: string;
    artifacts: {
      artifact: string;
      node: string;
      isLifecycle: boolean;
      interfaces: { name: string; kind: string; type: string }[];
      parameters: { name: string; type: string; default: string }[];
    }[];
    specs: {
      name: string;
      category: 'msg' | 'srv' | 'action';
      fullname: string;
      sections: Record<string, { type: string; name: string }[]>;
    }[];
  }[];
  system?: {
    name: string;
    fromFile: string;
    nodes: { name: string; namespace: string; from: string; interfaces: { name: string; kind: string }[] }[];
    subsystems: { name: string }[];
  };
}

const UTILITY_CLIENT_ID = 'rostooling_utility_session';

export class GlspClientBridge {
  private static instance: GlspClientBridge | null = null;

  private host: string;
  private port: number;
  private javaExecutable: string;
  private jarPath: string;
  private cataloguePath: string;
  private autoSpawn: boolean;

  private socket: net.Socket | null = null;
  private connection: MessageConnection | null = null;
  private serverProcess: cp.ChildProcess | null = null;
  private connectPromise: Promise<MessageConnection> | null = null;
  private isServerInitialized = false;
  private sessions = new Map<string, SessionSubscription>();
  private reqCounter = 0;
  private pendingResponses = new Map<string, (action: GlspAction) => void>();
  private utilitySessionReady: Promise<void> | null = null;
  private initializeResult: unknown = null;

  public static getInstance(options?: GlspBridgeOptions): GlspClientBridge {
    if (!GlspClientBridge.instance) {
      GlspClientBridge.instance = new GlspClientBridge(options);
    } else if (options) {
      GlspClientBridge.instance.configure(options);
    }
    return GlspClientBridge.instance;
  }

  constructor(options?: GlspBridgeOptions) {
    this.host = options?.host || process.env.ROS_GLSP_HOST || '127.0.0.1';
    this.port = options?.port || Number(process.env.ROS_GLSP_PORT || 5008);
    this.javaExecutable = options?.javaExecutable || 'java';
    this.jarPath = options?.jarPath || this.resolveDefaultJarPath();
    this.cataloguePath =
      options?.cataloguePath || path.join(os.homedir(), '.rostooling', 'catalogue_repos');
    this.autoSpawn = options?.autoSpawn ?? true;
  }

  public configure(options: GlspBridgeOptions): void {
    if (options.host) this.host = options.host;
    if (options.port) this.port = options.port;
    if (options.javaExecutable) this.javaExecutable = options.javaExecutable;
    if (options.jarPath) this.jarPath = options.jarPath;
    if (options.cataloguePath) this.cataloguePath = options.cataloguePath;
    if (options.autoSpawn !== undefined) this.autoSpawn = options.autoSpawn;
  }

  public getPort(): number {
    return this.port;
  }

  private resolveDefaultJarPath(): string {
    if (process.env.ROSMODEL_JAR && fs.existsSync(process.env.ROSMODEL_JAR)) {
      return path.resolve(process.env.ROSMODEL_JAR);
    }
    const candidates = [
      path.resolve(__dirname, '..', '..', 'server'),
      path.resolve(__dirname, '..', '..', '..', 'build', 'libs'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        const jars = fs.readdirSync(dir).filter((f) => f.endsWith('.jar'));
        if (jars.length > 0) {
          return path.join(dir, jars[0]);
        }
      }
    }
    return '';
  }

  public async ensureConnected(): Promise<MessageConnection> {
    if (this.connection && this.isServerInitialized) {
      return this.connection;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    this.connectPromise = this.connectInternal().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async connectInternal(): Promise<MessageConnection> {
    let socket = await this.tryConnectSocket(this.host, this.port, 1200);
    if (!socket && this.autoSpawn) {
      await this.spawnStandaloneGlspServer();
      socket = await this.waitForSocket(this.host, this.port, 15000);
    }
    if (!socket) {
      throw new Error(`Could not connect to RosTooling GLSP Server at ${this.host}:${this.port}`);
    }

    this.socket = socket;
    const reader = new SocketMessageReader(socket, 'utf-8');
    const writer = new SocketMessageWriter(socket, 'utf-8');
    const conn = createMessageConnection(reader, writer);

    conn.onNotification('process', (msg: GlspActionMessage) => {
      this.handleServerActionMessage(msg);
    });

    conn.onClose(() => {
      this.connection = null;
      this.isServerInitialized = false;
    });

    conn.listen();

    this.initializeResult = await conn.sendRequest('initialize', {
      applicationId: 'rostooling-vscode-glsp',
      protocolVersion: '1.0.0',
      args: {
        cataloguePath: this.cataloguePath,
      },
    });

    this.connection = conn;
    this.isServerInitialized = true;
    return conn;
  }

  private tryConnectSocket(host: string, port: number, timeoutMs: number): Promise<net.Socket | null> {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          sock.destroy();
          resolve(null);
        }
      }, timeoutMs);

      sock.once('connect', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(sock);
        }
      });

      sock.once('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          sock.destroy();
          resolve(null);
        }
      });

      sock.connect(port, host);
    });
  }

  private async waitForSocket(host: string, port: number, maxWaitMs: number): Promise<net.Socket | null> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const sock = await this.tryConnectSocket(host, port, 500);
      if (sock) {
        return sock;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }

  private async spawnStandaloneGlspServer(): Promise<void> {
    if (this.serverProcess && !this.serverProcess.killed) {
      return;
    }
    if (!this.jarPath || !fs.existsSync(this.jarPath)) {
      throw new Error(`GLSP Server JAR not found at '${this.jarPath}'`);
    }

    const args = [
      '--add-opens=java.base/java.lang=ALL-UNNAMED',
      '--add-opens=java.base/java.util=ALL-UNNAMED',
      `-Drostooling.catalogue.path=${this.cataloguePath}`,
      '-XX:TieredStopAtLevel=1',
      '-Xms128m',
      '-Xmx1024m',
      '-jar',
      this.jarPath,
      '--glsp',
      '--host',
      this.host,
      '--port',
      String(this.port),
    ];

    await new Promise<void>((resolve, reject) => {
      const proc = cp.spawn(this.javaExecutable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.serverProcess = proc;

      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      }, 6000);

      const onData = (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (
          !resolved &&
          (text.includes('Accepting requests on port') || text.includes('Starting standalone GLSP server'))
        ) {
          resolved = true;
          clearTimeout(timer);
          resolve();
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.once('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(err);
        }
      });
      proc.once('exit', () => {
        this.serverProcess = null;
      });
    });
  }

  private handleServerActionMessage(msg: GlspActionMessage): void {
    if (!msg || !msg.clientId || !msg.action) {
      return;
    }
    const responseId = msg.action.responseId;
    const pendingResolve = responseId ? this.pendingResponses.get(responseId) : undefined;
    if (responseId && pendingResolve) {
      this.pendingResponses.delete(responseId);
      pendingResolve(msg.action);
      return;
    }
    const sub = this.sessions.get(msg.clientId);
    if (!sub) {
      return;
    }
    const action = msg.action;
    sub.onRawAction?.(action);
    if (action.kind === 'setModel' || action.kind === 'updateModel') {
      const newRoot = action.newRoot as GGraph | undefined;
      if (newRoot) {
        sub.latestGraph = newRoot;
        while (sub.pendingModelResolvers.length > 0) {
          const resolve = sub.pendingModelResolvers.shift();
          resolve?.(newRoot);
        }
        sub.onModelUpdate?.(newRoot);
      }
    } else if (action.kind === 'setMarkers') {
      const markers = (action.markers as GlspMarker[]) || [];
      sub.latestMarkers = markers;
      while (sub.pendingMarkerResolvers.length > 0) {
        const resolve = sub.pendingMarkerResolvers.shift();
        resolve?.(markers);
      }
      sub.onMarkersUpdate?.(markers);
    }
  }

  public static toFileUri(filePathOrUri: string): string {
    if (filePathOrUri.startsWith('file://')) {
      return filePathOrUri;
    }
    const abs = path.resolve(filePathOrUri);
    return `file://${abs}`;
  }

  public async openSession(
    clientId: string,
    filePathOrUri: string,
    onModelUpdate?: (graph: GGraph) => void,
    onMarkersUpdate?: (markers: GlspMarker[]) => void
  ): Promise<{ graph: GGraph; markers: GlspMarker[] }> {
    const conn = await this.ensureConnected();
    const sourceUri = GlspClientBridge.toFileUri(filePathOrUri);

    let sub = this.sessions.get(clientId);
    if (!sub) {
      sub = {
        clientId,
        sourceUri,
        latestMarkers: [],
        onModelUpdate,
        onMarkersUpdate,
        pendingModelResolvers: [],
        pendingMarkerResolvers: [],
      };
      this.sessions.set(clientId, sub);

      await conn.sendRequest('initializeClientSession', {
        clientSessionId: clientId,
        diagramType: 'ros-system-diagram',
        clientActionKinds: CLIENT_ACTION_KINDS,
        args: { sourceUri },
      });
    } else {
      sub.sourceUri = sourceUri;
      sub.onModelUpdate = onModelUpdate;
      sub.onMarkersUpdate = onMarkersUpdate;
    }

    const graph = await this.requestModel(clientId, sourceUri);
    const markers = await this.requestMarkers(clientId);
    return { graph, markers };
  }

  /**
   * Asks the Java/Xtext server to parse the given model files and describe them (packages,
   * nodes, interfaces, parameters, specs, systems). The TypeScript side never parses DSL text.
   */
  public async requestRosIndex(files: string[], timeoutMs = 60000): Promise<RosIndexFile[]> {
    if (files.length === 0) {
      return [];
    }
    const conn = await this.ensureConnected();
    if (!this.utilitySessionReady) {
      this.utilitySessionReady = conn
        .sendRequest('initializeClientSession', {
          clientSessionId: UTILITY_CLIENT_ID,
          diagramType: 'ros-system-diagram',
          clientActionKinds: CLIENT_ACTION_KINDS,
          args: {},
        })
        .then(() => undefined);
    }
    await this.utilitySessionReady;
    const requestId = `req_index_${++this.reqCounter}`;
    const response = new Promise<GlspAction>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error(`Timed out waiting for setRosIndex (${files.length} files)`));
      }, timeoutMs);
      this.pendingResponses.set(requestId, (action) => {
        clearTimeout(timer);
        resolve(action);
      });
    });
    await conn.sendNotification('process', {
      clientId: UTILITY_CLIENT_ID,
      action: { kind: 'requestRosIndex', requestId, files: files.map((f) => path.resolve(f)) },
    });
    const action = await response;
    const parsed = JSON.parse(String(action.indexJson || '{"files":[]}')) as { files: RosIndexFile[] };
    return parsed.files || [];
  }

  /** The server's InitializeResult (protocol version + serverActions), needed by the GLSP client. */
  public async getInitializeResult(): Promise<unknown> {
    await this.ensureConnected();
    return this.initializeResult;
  }

  /**
   * Opens a session driven by a GLSP (Sprotty) client running in a webview: the client's own
   * action kinds are registered and every server action is handed to `onRawAction`.
   */
  public async initializeProxySession(
    clientId: string,
    diagramType: string,
    clientActionKinds: string[],
    sourceFile: string,
    onRawAction: (action: GlspAction) => void,
    onModelUpdate?: (graph: GGraph) => void,
    onMarkersUpdate?: (markers: GlspMarker[]) => void
  ): Promise<void> {
    const conn = await this.ensureConnected();
    const sourceUri = GlspClientBridge.toFileUri(sourceFile);
    const kinds = Array.from(new Set([...clientActionKinds, ...CLIENT_ACTION_KINDS]));
    this.sessions.set(clientId, {
      clientId,
      sourceUri,
      latestMarkers: [],
      onModelUpdate,
      onMarkersUpdate,
      onRawAction,
      pendingModelResolvers: [],
      pendingMarkerResolvers: [],
    });
    await conn.sendRequest('initializeClientSession', {
      clientSessionId: clientId,
      diagramType,
      clientActionKinds: kinds,
      args: { sourceUri },
    });
  }

  /** Forwards an action unchanged to the server (fire-and-forget, GLSP `process`). */
  public async sendAction(clientId: string, action: GlspAction): Promise<void> {
    const conn = await this.ensureConnected();
    await conn.sendNotification('process', { clientId, action });
  }

  /**
   * Commits the session's pending AST mutations on the server and returns the surgical span
   * edits instead of writing the file (applied by the extension as an undoable WorkspaceEdit).
   */
  public async requestTextEdits(clientId: string, timeoutMs = 20000): Promise<RosTextEditsResult> {
    const conn = await this.ensureConnected();
    const requestId = `req_edits_${++this.reqCounter}`;
    const response = new Promise<GlspAction>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(requestId);
        reject(new Error('Timed out waiting for setRosTextEdits'));
      }, timeoutMs);
      this.pendingResponses.set(requestId, (action) => {
        clearTimeout(timer);
        resolve(action);
      });
    });
    await conn.sendNotification('process', { clientId, action: { kind: 'requestRosTextEdits', requestId } });
    const action = await response;
    return {
      sourceUri: String(action.sourceUri || ''),
      baseText: String(action.baseText ?? ''),
      newText: String(action.newText ?? ''),
      edits: (action.edits as RosTextEditsResult['edits']) || [],
    };
  }

  /**
   * Re-reads the model on the server. When `sourceText` is given (unsaved editor buffer), the
   * server parses that text instead of the file on disk.
   */
  public async reloadModel(clientId: string, filePathOrUri: string, sourceText?: string): Promise<GGraph> {
    return this.requestModel(clientId, filePathOrUri, sourceText);
  }

  public async requestModel(clientId: string, filePathOrUri?: string, sourceText?: string): Promise<GGraph> {
    const conn = await this.ensureConnected();
    let sub = this.sessions.get(clientId);
    const sourceUri = GlspClientBridge.toFileUri(filePathOrUri || sub?.sourceUri || '');
    if (!sub) {
      sub = {
        clientId,
        sourceUri,
        latestMarkers: [],
        pendingModelResolvers: [],
        pendingMarkerResolvers: [],
      };
      this.sessions.set(clientId, sub);
    }
    const session: SessionSubscription = sub;

    const modelPromise = new Promise<GGraph>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = session.pendingModelResolvers.indexOf(wrappedResolve);
        if (idx >= 0) session.pendingModelResolvers.splice(idx, 1);
        if (session.latestGraph) {
          resolve(session.latestGraph);
        } else {
          reject(new Error(`Timed out waiting for GLSP setModel/updateModel on session ${clientId}`));
        }
      }, 8000);

      const wrappedResolve = (g: GGraph) => {
        clearTimeout(timer);
        resolve(g);
      };
      session.pendingModelResolvers.push(wrappedResolve);
    });

    const reqId = `req_model_${++this.reqCounter}`;
    await conn.sendNotification('process', {
      clientId,
      action: {
        kind: 'requestModel',
        requestId: reqId,
        options: {
          sourceUri,
          diagramType: 'ros-system-diagram',
          isReconnecting: 'false',
          ...(sourceText !== undefined ? { sourceText } : {}),
        },
      },
    });

    return modelPromise;
  }

  public async requestMarkers(clientId: string): Promise<GlspMarker[]> {
    const conn = await this.ensureConnected();
    const sub = this.sessions.get(clientId);
    if (!sub) {
      return [];
    }

    const markerPromise = new Promise<GlspMarker[]>((resolve) => {
      const timer = setTimeout(() => {
        const idx = sub.pendingMarkerResolvers.indexOf(wrappedResolve);
        if (idx >= 0) sub.pendingMarkerResolvers.splice(idx, 1);
        resolve(sub.latestMarkers);
      }, 1500);

      const wrappedResolve = (m: GlspMarker[]) => {
        clearTimeout(timer);
        resolve(m);
      };
      sub.pendingMarkerResolvers.push(wrappedResolve);
    });

    const reqId = `req_markers_${++this.reqCounter}`;
    await conn.sendNotification('process', {
      clientId,
      action: {
        kind: 'requestMarkers',
        requestId: reqId,
        elementsIDs: ['root'],
        reason: 'live',
      },
    });

    return markerPromise;
  }

  public async dispatchAction(
    clientId: string,
    action: GlspAction,
    waitForModelUpdate = false
  ): Promise<GGraph | undefined> {
    const conn = await this.ensureConnected();
    const sub = this.sessions.get(clientId);

    let modelPromise: Promise<GGraph> | undefined;
    if (waitForModelUpdate && sub) {
      modelPromise = new Promise<GGraph>((resolve) => {
        const timer = setTimeout(() => {
          const idx = sub.pendingModelResolvers.indexOf(wrappedResolve);
          if (idx >= 0) sub.pendingModelResolvers.splice(idx, 1);
          resolve(sub.latestGraph || { id: 'root', type: 'graph', children: [] });
        }, 5000);
        const wrappedResolve = (g: GGraph) => {
          clearTimeout(timer);
          resolve(g);
        };
        sub.pendingModelResolvers.push(wrappedResolve);
      });
    }

    await conn.sendNotification('process', {
      clientId,
      action,
    });

    if (modelPromise) {
      return modelPromise;
    }
    return sub?.latestGraph;
  }

  public async saveModel(clientId: string, filePathOrUri?: string): Promise<void> {
    const sub = this.sessions.get(clientId);
    const fileUri = GlspClientBridge.toFileUri(filePathOrUri || sub?.sourceUri || '');
    await this.dispatchAction(
      clientId,
      {
        kind: 'saveModel',
        fileUri,
      },
      false
    );
  }

  public async disposeSession(clientId: string): Promise<void> {
    this.sessions.delete(clientId);
    if (this.connection && this.isServerInitialized) {
      try {
        await this.connection.sendRequest('disposeClientSession', {
          clientSessionId: clientId,
          args: {},
        });
      } catch {
        // Ignore errors when disposing closed session
      }
    }
  }

  public async dispose(): Promise<void> {
    for (const clientId of Array.from(this.sessions.keys())) {
      await this.disposeSession(clientId);
    }
    if (this.connection) {
      try {
        this.connection.dispose();
      } catch {
        // Ignore
      }
      this.connection = null;
    }
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // Ignore
      }
      this.socket = null;
    }
    if (this.serverProcess && !this.serverProcess.killed) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
    this.isServerInitialized = false;
  }

  /**
   * Derives the read-only RosProject view-model used by the webview panels from the server's
   * GGraph + markers. This is a pure projection of server data: it never parses DSL text and
   * nothing derived here is ever written back to disk (all edits are GLSP operations).
   */
  public static gGraphToRosProject(
    gGraph: GGraph,
    markers: GlspMarker[] = [],
    options: { fileName?: string } = {}
  ): RosProject {
    const modelKind = String(gGraph.args?.modelKind || 'rossystem');
    const fileName = options.fileName || '';
    const isRosSystem = modelKind === 'rossystem';
    const isRos = fileName.endsWith('.ros');

    const diagnostics: RosModelDiagnostic[] = markers.map((m) => ({
      elementId: m.elementId,
      elementKind: m.elementId.includes('@connections')
        ? 'connection'
        : m.elementId.includes('@rosinterfaces') || /@(publisher|subscriber|service|action)/.test(m.elementId)
        ? 'interface'
        : m.elementId.includes('@parameter') || m.elementId.includes('@rosparameters')
        ? 'parameter'
        : m.elementId === 'root'
        ? 'system'
        : 'node',
      targetName: m.label,
      severity: m.kind === 'warning' ? 'warning' : m.kind === 'info' ? 'info' : 'error',
      message: m.description || m.label,
      source: 'RosGlspValidator',
    }));

    if (!isRosSystem) {
      return GlspClientBridge.packageGraphToProject(gGraph, diagnostics, isRos, fileName);
    }

    const nodes: RosNode[] = [];
    const subSystems: RosSubSystem[] = [];
    const processes: RosProcess[] = [];
    const connections: RosConnection[] = [];
    const portOwner = new Map<string, { nodeId: string; ifaceName: string }>();

    const visitRosNode = (child: GModelElement, subRef?: string) => {
      const nodeName = String(child.args?.nodeName || child.id);
      const fromRef = String(child.args?.from || '');
      const segs = fromRef.split('.');
      const ifaces: RosInterface[] = [];
      for (const port of child.children || []) {
        if (!port.type || !port.type.startsWith('port:')) continue;
        const ifaceName = String(port.args?.interfaceName || port.id);
        ifaces.push({
          id: port.id,
          name: String(port.args?.originName || ifaceName),
          label: ifaceName,
          kind: port.type.slice('port:'.length) as RosInteractionKind,
          type: String(port.args?.specName || ''),
          exposed: Boolean(port.args?.isExplicit),
        });
        portOwner.set(port.id, { nodeId: child.id, ifaceName });
      }
      const params: RosParameter[] = [];
      try {
        const parsed = JSON.parse(String(child.args?.parametersJson || '{}'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [pName, pVal] of Object.entries(parsed)) {
            params.push({ id: `${child.id}__param__${pName}`, name: pName, label: pName, value: pVal, sysValue: pVal, exposed: true });
          }
        }
      } catch {
        // parametersJson is produced by the server; ignore if absent
      }
      nodes.push({
        id: child.id,
        label: nodeName,
        namespace: String(child.args?.namespace || '') || undefined,
        from: fromRef || undefined,
        pkg: segs.length > 1 ? segs[0] : undefined,
        artifact: segs.length > 2 ? segs[1] : undefined,
        isLifecycle: Boolean(child.args?.isLifecycle),
        backing: subRef ? 'sub' : 'local',
        subRef,
        ifaces,
        params,
        x: child.position?.x,
        y: child.position?.y,
        w: child.size?.width,
        h: child.size?.height,
      });
    };

    for (const child of gGraph.children || []) {
      if (child.type === 'node:ros-node') {
        visitRosNode(child);
      } else if (child.type === 'node:subsystem') {
        const subName = String(child.args?.subSystemName || child.id);
        subSystems.push({
          ref: subName,
          state: child.args?.collapsed ? 'collapsed' : 'framed',
          x: child.position?.x,
          y: child.position?.y,
          w: child.size?.width,
          h: child.size?.height,
        });
        for (const inner of child.children || []) {
          if (inner.type === 'node:ros-node') visitRosNode(inner, subName);
        }
      } else if (child.type === 'node:process') {
        processes.push({
          id: child.id,
          name: String(child.args?.processName || child.id),
          nodes: GlspClientBridge.parseJsonArray<{ id: string; name: string }>(child.args?.membersJson).map((m) => m.name),
          threads: Number(child.args?.threads || 1),
        });
      }
    }

    for (const child of gGraph.children || []) {
      if (child.type === 'edge:ros-connection' && child.sourceId && child.targetId) {
        const src = portOwner.get(child.sourceId);
        const tgt = portOwner.get(child.targetId);
        connections.push({
          id: child.id,
          from: { n: src?.nodeId || '', i: child.sourceId },
          to: { n: tgt?.nodeId || '', i: child.targetId },
          rawFrom: String(child.args?.fromInterfaceName || src?.ifaceName || ''),
          rawTo: String(child.args?.toInterfaceName || tgt?.ifaceName || ''),
          waypoints: child.routingPoints,
        });
      }
    }

    return {
      formatVersion: 4,
      isRosSystem: true,
      isRos: false,
      system: {
        name: String(gGraph.args?.systemName || 'system'),
        fromFile: String(gGraph.args?.fromFile || '') || undefined,
      },
      subSystems,
      processes,
      nodes,
      connections,
      packages: {},
      types: {},
      diagnostics,
    };
  }

  private static parseJsonArray<T>(raw: unknown): T[] {
    try {
      const parsed = JSON.parse(String(raw ?? '[]'));
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  /** Projection of a .ros2 / .ros1 / .ros package-model GGraph (node:ros-package children). */
  private static packageGraphToProject(
    gGraph: GGraph,
    diagnostics: RosModelDiagnostic[],
    isRos: boolean,
    fileName: string
  ): RosProject {
    const nodes: RosNode[] = [];
    const packages: Record<string, RosPackage> = {};
    const types: Record<string, RosTypeSpec> = {};
    let firstPackageName = '';

    for (const pkgEl of gGraph.children || []) {
      if (pkgEl.type !== 'node:ros-package') continue;
      const pkgName = String(pkgEl.args?.packageName || '');
      if (!firstPackageName) firstPackageName = pkgName;
      const pkg: RosPackage = {
        id: pkgEl.id,
        name: pkgName,
        fromGitRepo: String(pkgEl.args?.fromGitRepo || '') || undefined,
        artifacts: [],
      };
      packages[pkgName] = pkg;

      for (const nodeEl of pkgEl.children || []) {
        if (nodeEl.type !== 'node:ros-node') continue;
        const nodeName = String(nodeEl.args?.nodeName || '');
        const artifactName = String(nodeEl.args?.artifactName || nodeName);
        const ifaces: RosInterface[] = GlspClientBridge.parseJsonArray<{
          id: string;
          kindCode: string;
          name: string;
          spec: string;
          qos?: Record<string, string>;
          ns?: string;
          activeStates?: RosLifecycleState[];
        }>(nodeEl.args?.interfacesJson).map((i) => ({
          id: i.id,
          name: i.name,
          label: i.name,
          kind: (i.kindCode || 'pub') as RosInteractionKind,
          type: i.spec,
          qos: i.qos && Object.keys(i.qos).length > 0 ? i.qos : undefined,
          ns: i.ns || undefined,
          activeStates: i.activeStates && i.activeStates.length > 0 ? i.activeStates : undefined,
          exposed: true,
          artifact: artifactName,
        }));
        const params: RosParameter[] = GlspClientBridge.parseJsonArray<{
          id: string;
          name: string;
          type: string;
          default: string;
          hasDefault?: boolean;
          value: string;
          ns?: string;
        }>(nodeEl.args?.parametersJson).map((p) => ({
          id: p.id,
          name: p.name,
          ns: p.ns || undefined,
          label: p.name,
          ptype: p.type || 'String',
          value: p.hasDefault ? p.default : p.value || undefined,
          exposed: true,
          artifact: artifactName,
        }));
        nodes.push({
          id: nodeEl.id,
          artifactId: String(nodeEl.args?.artifactId || nodeEl.id),
          label: nodeName,
          pkg: pkgName,
          artifact: artifactName,
          from: `${pkgName}.${nodeName}`,
          isLifecycle: Boolean(nodeEl.args?.isLifecycle),
          backing: 'local',
          ifaces,
          params,
        });
        pkg.artifacts.push({ name: artifactName, node: nodeName, isLifecycle: Boolean(nodeEl.args?.isLifecycle), ifaces, params });
      }

      for (const spec of GlspClientBridge.parseJsonArray<{
        id: string;
        name: string;
        category: 'msg' | 'srv' | 'action';
        fullname: string;
        sections: { name: string; fields: { id: string; type: string; name: string }[] }[];
      }>(pkgEl.args?.specsJson)) {
        const fields: Record<string, RosField[]> = {};
        for (const section of spec.sections || []) {
          fields[section.name] = (section.fields || []).map((f) => ({
            id: f.id,
            type: f.type,
            name: f.name,
            array: f.type.endsWith('[]'),
          }));
        }
        types[spec.fullname || `${pkgName}/${spec.category}/${spec.name}`] = {
          id: spec.id,
          name: spec.name,
          category: spec.category,
          pkg: pkgName,
          fields,
        };
      }
    }

    return {
      formatVersion: 4,
      isRosSystem: false,
      isRos,
      system: { name: firstPackageName || path.basename(fileName, path.extname(fileName)) },
      subSystems: [],
      nodes,
      connections: [],
      packages,
      types,
      diagnostics,
    };
  }
}
