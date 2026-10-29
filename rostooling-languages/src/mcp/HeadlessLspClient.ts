import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Diagnostic {
  file: string;
  line: number;
  character: number;
  severity: 'ERROR' | 'WARNING' | 'INFO' | 'HINT';
  message: string;
  source?: string;
}

export interface LspMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface RawDiagnostic {
  range?: {
    start?: {
      line?: number;
      character?: number;
    };
  };
  severity?: number;
  message?: string;
  source?: string;
}

export class HeadlessLspClient {
  private proc: cp.ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number | string, { resolve: (res: unknown) => void; reject: (err: Error) => void }>();
  private diagnosticListeners = new Map<string, (diags: Diagnostic[]) => void>();
  private incomingBuffer = Buffer.alloc(0);
  private expectedContentLength: number | null = null;
  private isInitialized = false;

  constructor(
    private javaExecutable?: string,
    private jarPath?: string,
    private cataloguePath?: string
  ) {}

  public static findJavaExecutable(): string {
    if (process.env.ROSMODEL_JAVA && fs.existsSync(process.env.ROSMODEL_JAVA)) {
      return process.env.ROSMODEL_JAVA;
    }
    if (process.env.JAVA_HOME) {
      const javaBin = path.join(process.env.JAVA_HOME, 'bin', 'java');
      if (fs.existsSync(javaBin)) {
        return javaBin;
      }
    }
    return 'java';
  }

  public static findJarPath(hintDir?: string): string {
    if (process.env.ROSMODEL_JAR && fs.existsSync(process.env.ROSMODEL_JAR)) {
      return process.env.ROSMODEL_JAR;
    }

    // Check .vscode/settings.json for 'rostooling-languages.server.jarPath'
    const settingsDirs = [process.cwd()];
    if (hintDir && !settingsDirs.includes(hintDir)) {
      settingsDirs.push(hintDir);
    }
    for (const d of settingsDirs) {
      try {
        const sPath = path.join(d, '.vscode', 'settings.json');
        if (fs.existsSync(sPath)) {
          const content = JSON.parse(fs.readFileSync(sPath, 'utf8'));
          const customJar = content['rostooling-languages.server.jarPath'];
          if (customJar && typeof customJar === 'string' && fs.existsSync(customJar)) {
            return customJar;
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Check CoreSense Studio runtime settings for 'rosmodelJar'
    const studioSettings = [
      path.join(os.homedir(), '.rostooling', 'settings.json'),
      path.join(os.homedir(), 'ros-studio', 'runtime-settings.json')
    ];
    for (const sPath of studioSettings) {
      try {
        if (fs.existsSync(sPath)) {
          const content = JSON.parse(fs.readFileSync(sPath, 'utf8'));
          const customJar = content['rosmodelJar'];
          if (customJar && typeof customJar === 'string' && fs.existsSync(customJar)) {
            return customJar;
          }
        }
      } catch {
        // Ignore
      }
    }

    const candidateDirs: string[] = [];
    if (hintDir) {
      candidateDirs.push(hintDir);
      candidateDirs.push(path.join(hintDir, 'server'));
    }

    // Relative to compiled out/mcp or src/mcp (extension bundled server)
    candidateDirs.push(path.resolve(__dirname, '../../server'));
    candidateDirs.push(path.resolve(__dirname, '../server'));
    candidateDirs.push(path.resolve(__dirname, 'server'));

    // Check sibling extension directories in workspace
    candidateDirs.push(path.resolve(process.cwd(), 'server'));
    candidateDirs.push(path.resolve(process.cwd(), 'rostooling-languages/server'));

    // Check installed VS Code, Antigravity, and Cursor extensions
    const home = os.homedir();
    const extensionDirs = [
      path.join(home, '.antigravity-ide', 'extensions'),
      path.join(home, '.vscode', 'extensions'),
      path.join(home, '.cursor', 'extensions'),
      path.join(home, '.vscode-server', 'extensions'),
      path.join(home, '.vscode-oss', 'extensions')
    ];

    for (const extDir of extensionDirs) {
      if (fs.existsSync(extDir)) {
        try {
          const entries = fs.readdirSync(extDir);
          for (const entry of entries) {
            if (entry.includes('rostooling-languages') || entry.includes('rostooling')) {
              candidateDirs.push(path.join(extDir, entry, 'server'));
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          const jarFiles = files
            .filter(f => f.startsWith('rostooling_extension') && f.endsWith('.jar'))
            .sort()
            .reverse();
          if (jarFiles.length > 0) {
            return path.join(dir, jarFiles[0]);
          }
        } catch {
          // Ignore
        }
      }
    }

    throw new Error(
      'Could not locate rostooling_extension fat JAR. Set ROSMODEL_JAR environment variable or ensure RosTooling_Extension is built.'
    );
  }

  public async start(workspaceDir: string): Promise<void> {
    const javaBin = this.javaExecutable || HeadlessLspClient.findJavaExecutable();
    const jar = this.jarPath || HeadlessLspClient.findJarPath();
    const catPath =
      this.cataloguePath ||
      process.env.ROSMODEL_CATALOGUE_DIR ||
      path.join(os.homedir(), '.rostooling', 'catalogue_repos');

    const args = [
      '--add-opens=java.base/java.lang=ALL-UNNAMED',
      '--add-opens=java.base/java.util=ALL-UNNAMED',
    ];

    if (fs.existsSync(catPath)) {
      args.push(`-Drostooling.catalogue.path=${catPath}`);
    }

    args.push('-jar', jar);

    this.proc = cp.spawn(javaBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (chunk: Buffer) => this.onStdoutData(chunk));
    this.proc.stderr.on('data', () => {
      // Keep stderr quiet unless needed
    });

    this.proc.on('close', (code) => {
      for (const p of this.pendingRequests.values()) {
        p.reject(new Error(`Language server process exited with code ${code}`));
      }
      this.pendingRequests.clear();
      this.isInitialized = false;
    });

    const rootUri = pathToFileURL(path.resolve(workspaceDir)).href;

    await this.sendRequest('initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(workspaceDir),
        },
      ],
      capabilities: {
        workspace: {
          workspaceFolders: true,
          executeCommand: {
            dynamicRegistration: false,
          },
        },
        textDocument: {
          publishDiagnostics: {
            relatedInformation: true,
          },
        },
      },
    });

    this.sendNotification('initialized', {});
    this.isInitialized = true;
  }

  public async openDocument(filePath: string, languageId?: string, content?: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);
    const text = content ?? (await fsp.readFile(resolvedPath, 'utf-8'));
    const ext = path.extname(resolvedPath).replace(/^\./, '');
    const langId = languageId || ext;
    const uri = pathToFileURL(resolvedPath).href;

    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: langId,
        version: 1,
        text,
      },
    });
  }

  public async executeCommand<T = unknown>(command: string, args: unknown[]): Promise<T> {
    if (!this.isInitialized) {
      throw new Error('LSP server is not initialized');
    }
    const response = await this.sendRequest<T>('workspace/executeCommand', {
      command,
      arguments: args,
    });
    return response;
  }

  public async collectDiagnostics(filePath: string, timeoutMs = 2500): Promise<Diagnostic[]> {
    const targetUri = pathToFileURL(path.resolve(filePath)).href.toLowerCase();
    return new Promise<Diagnostic[]>((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.diagnosticListeners.delete(targetUri);
          resolve([]);
        }
      }, timeoutMs);

      this.diagnosticListeners.set(targetUri, (diags) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.diagnosticListeners.delete(targetUri);
          resolve(diags);
        }
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.sendRequest('shutdown', {});
      this.sendNotification('exit', {});
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          this.proc?.kill('SIGKILL');
          resolve();
        }, 1500);
        this.proc?.on('close', () => {
          clearTimeout(killTimer);
          resolve();
        });
      });
    } catch {
      this.proc?.kill('SIGKILL');
    } finally {
      this.proc = null;
      this.isInitialized = false;
    }
  }

  private sendRequest<T = unknown>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pendingRequests.set(id, {
        resolve: (val: unknown) => resolve(val as T),
        reject,
      });
      this.sendMessage({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    });
  }

  private sendNotification(method: string, params: unknown): void {
    this.sendMessage({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  private sendMessage(msg: LspMessage): void {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error('LSP process is not running or stdin is closed');
    }
    const json = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    this.proc.stdin.write(header + json, 'utf8');
  }

  private onStdoutData(chunk: Buffer): void {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk]);

    while (this.incomingBuffer.length > 0) {
      if (this.expectedContentLength === null) {
        const headerEnd = this.incomingBuffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          break; // Need more header bytes
        }
        const headerText = this.incomingBuffer.subarray(0, headerEnd).toString('utf8');
        const match = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Bad header, skip
          this.incomingBuffer = this.incomingBuffer.subarray(headerEnd + 4);
          continue;
        }
        this.expectedContentLength = parseInt(match[1], 10);
        this.incomingBuffer = this.incomingBuffer.subarray(headerEnd + 4);
      }

      if (this.incomingBuffer.length < this.expectedContentLength) {
        break; // Need more body bytes
      }

      const bodyBuffer = this.incomingBuffer.subarray(0, this.expectedContentLength);
      this.incomingBuffer = this.incomingBuffer.subarray(this.expectedContentLength);
      this.expectedContentLength = null;

      try {
        const message = JSON.parse(bodyBuffer.toString('utf8')) as LspMessage;
        this.handleMessage(message);
      } catch (err) {
        console.error('Failed to parse LSP JSON-RPC message:', err);
      }
    }
  }

  private handleMessage(msg: LspMessage): void {
    if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
      const handler = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      if (handler) {
        if (msg.error) {
          handler.reject(new Error(msg.error.message || 'LSP command error'));
        } else {
          handler.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method === 'textDocument/publishDiagnostics' && msg.params && typeof msg.params === 'object') {
      const params = msg.params as { uri?: string; diagnostics?: RawDiagnostic[] };
      const uri = String(params.uri || '').toLowerCase();
      const rawDiags: RawDiagnostic[] = params.diagnostics || [];
      const severityMap: Record<number, Diagnostic['severity']> = {
        1: 'ERROR',
        2: 'WARNING',
        3: 'INFO',
        4: 'HINT',
      };

      const diagnostics: Diagnostic[] = rawDiags.map((d: RawDiagnostic) => ({
        file: path.basename(params.uri || ''),
        line: (d.range?.start?.line ?? 0) + 1,
        character: (d.range?.start?.character ?? 0) + 1,
        severity: d.severity ? severityMap[d.severity] || 'ERROR' : 'ERROR',
        message: d.message || '',
        source: d.source,
      }));

      const listener = this.diagnosticListeners.get(uri);
      if (listener) {
        listener(diagnostics);
      }
    }
  }
}
