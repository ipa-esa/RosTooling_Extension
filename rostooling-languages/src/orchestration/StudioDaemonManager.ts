import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import * as http from 'http';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { RosCatalogueManager } from '../model/RosCatalogueManager';
import { StudioApiClient } from './DraftContentProvider';
import { PythonEnvResolver, ResolvedStudioBackend } from './PythonEnvResolver';

export class StudioDaemonError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(message: string, status = 500, code = 'daemon_error', details?: unknown) {
    super(message);
    this.name = 'StudioDaemonError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface StudioDaemonOptions {
  extensionPath: string;
  outputChannel?: vscode.OutputChannel;
  port?: number;
  storageRoot?: string;
  catalogueDir?: string;
  mcpScriptPath?: string;
  envResolver?: PythonEnvResolver;
  silentMissingBackend?: boolean;
}

export interface ExternalStageUrlOptions {
  projectId?: string;
  view?: 'intent' | 'packages' | 'architecture' | 'checks' | 'deployment';
  tab?: string;
}

/**
 * Manages the lifecycle of the local RosTooling Studio Python HTTP daemon (`studio_server.py`),
 * handles `X-Studio-Token` authentication, proxies JSON REST requests over `127.0.0.1`,
 * and constructs multi-monitor external browser URLs via `vscode.env.asExternalUri`.
 */
export class StudioDaemonManager implements StudioApiClient, vscode.Disposable {
  private readonly extensionPath: string;
  private readonly outputChannel?: vscode.OutputChannel;
  private readonly envResolver: PythonEnvResolver;
  private readonly explicitPort?: number;
  private readonly explicitStorageRoot?: string;
  private readonly explicitCatalogueDir?: string;
  private readonly explicitMcpScriptPath?: string;
  private readonly silentMissingBackend: boolean;

  private daemonProcess: cp.ChildProcess | null = null;
  private activePort: number | null = null;
  private activeToken: string | null = null;
  private activeBackend: ResolvedStudioBackend | null = null;
  private startPromise: Promise<void> | null = null;

  constructor(options: StudioDaemonOptions) {
    this.extensionPath = options.extensionPath;
    this.outputChannel = options.outputChannel;
    this.envResolver = options.envResolver ?? new PythonEnvResolver(options.extensionPath);
    this.explicitPort = options.port;
    this.explicitStorageRoot = options.storageRoot;
    this.explicitCatalogueDir = options.catalogueDir;
    this.explicitMcpScriptPath = options.mcpScriptPath;
    this.silentMissingBackend = Boolean(options.silentMissingBackend);
  }

  public getStorageRoot(): string {
    if (this.explicitStorageRoot) {
      return path.resolve(this.explicitStorageRoot);
    }
    const cfgRoot = vscode.workspace
      .getConfiguration('rostooling-languages')
      .get<string>('studio.storageRoot')
      ?.trim();
    if (cfgRoot) {
      return path.resolve(cfgRoot.replace(/^~(?=$|\/|\\)/, os.homedir()));
    }
    const envRoot = process.env.ROSTOOLING_STUDIO_STORAGE?.trim();
    if (envRoot) {
      return path.resolve(envRoot);
    }
    return path.join(os.homedir(), '.rostooling', 'studio-data');
  }

  public getConfiguredPort(): number {
    if (typeof this.explicitPort === 'number' && this.explicitPort > 0) {
      return this.explicitPort;
    }
    const cfgPort = vscode.workspace
      .getConfiguration('rostooling-languages')
      .get<number>('studio.port');
    return typeof cfgPort === 'number' && cfgPort > 0 ? cfgPort : 8765;
  }

  public getActivePort(): number | null {
    return this.activePort;
  }

  public isRunning(): boolean {
    return Boolean(this.activePort && this.activeToken);
  }

  public getResolvedBackend(): ResolvedStudioBackend | null {
    return this.activeBackend;
  }

  public async isAvailable(): Promise<boolean> {
    if (this.activePort && this.activeToken) {
      const ok = await this.checkHealth(this.activePort);
      if (ok) {
        return true;
      }
    }
    const backend = await this.envResolver.resolveStudioBackend();
    return Boolean(backend);
  }

  public async ensureRunning(): Promise<void> {
    if (this.activePort && this.activeToken && (await this.checkHealth(this.activePort))) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    const storageRoot = this.getStorageRoot();
    await fs.promises.mkdir(storageRoot, { recursive: true });
    const preferredPort = this.getConfiguredPort();

    // 1. Reuse an already-running Studio daemon if it matches our storageRoot token
    const existingToken = this.readTokenFromStorage(storageRoot);
    if (existingToken && (await this.checkHealth(preferredPort))) {
      const valid = await this.verifyToken(preferredPort, existingToken);
      if (valid) {
        this.activePort = preferredPort;
        this.activeToken = existingToken;
        this.activeBackend = await this.envResolver.resolveStudioBackend();
        this.log(`Attached to existing RosTooling Studio daemon on 127.0.0.1:${preferredPort}`);
        return;
      }
    }

    // 2. Resolve Python >= 3.9 + studio_server.py
    const backend = await this.envResolver.resolveStudioBackend();
    if (!backend) {
      const py = await this.envResolver.resolvePythonEnvironment();
      if (!this.silentMissingBackend) {
        void this.envResolver.promptMissingBackend(py?.pythonBin);
      }
      throw new StudioDaemonError(
        'RosTooling Studio backend could not be resolved. Ensure Python >= 3.9 is available, install rostooling-studio, or configure rostooling-languages.studio.serverScriptPath.',
        503,
        'backend_missing'
      );
    }
    this.activeBackend = backend;

    // 3. Pick preferred port if free, otherwise allocate an ephemeral localhost port
    const portFree = await this.isPortFree(preferredPort);
    const targetPort = portFree ? preferredPort : await this.findFreePort();

    const catalogueDir =
      this.explicitCatalogueDir ?? RosCatalogueManager.getInstance().getStorageDir();
    const mcpBin =
      this.explicitMcpScriptPath ?? path.join(this.extensionPath, 'bin', 'rostooling-mcp.js');

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      ROSMODEL_CATALOGUE_DIR: catalogueDir,
      ROSTOOLING_CATALOGUE_DIR: catalogueDir,
      ...(fs.existsSync(mcpBin) ? { ROSTOOLING_MCP_BIN: mcpBin } : {}),
    };

    this.log(
      `Spawning RosTooling Studio daemon: ${backend.python.pythonBin} ${backend.serverScriptPath} --port ${targetPort} --storage-root ${storageRoot}`
    );

    let capturedToken: string | null = null;
    let stderrTail = '';
    const child = cp.spawn(
      backend.python.pythonBin,
      [backend.serverScriptPath, '--port', String(targetPort), '--storage-root', storageRoot],
      {
        cwd: backend.studioRoot,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    this.daemonProcess = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.log(`[studio_server] ${text.trimEnd()}`);
      const m = /#token=([a-f0-9]{32,128})/i.exec(text);
      if (m?.[1]) {
        capturedToken = m[1];
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      this.log(`[studio_server] ${text.trimEnd()}`);
    });

    child.on('exit', (code, signal) => {
      this.log(`RosTooling Studio daemon exited (code=${code}, signal=${signal})`);
      if (this.daemonProcess === child) {
        this.daemonProcess = null;
        this.activePort = null;
        this.activeToken = null;
      }
    });

    // 4. Poll /api/health until ready
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (this.daemonProcess !== child) {
        throw new StudioDaemonError(
          `RosTooling Studio daemon exited prematurely: ${stderrTail.trim()}`,
          500,
          'daemon_exit'
        );
      }
      if (await this.checkHealth(targetPort)) {
        const token = capturedToken ?? this.readTokenFromStorage(storageRoot);
        if (token) {
          this.activePort = targetPort;
          this.activeToken = token;
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new StudioDaemonError(
      `Timed out waiting for RosTooling Studio daemon on 127.0.0.1:${targetPort}. ${stderrTail.trim()}`,
      504,
      'daemon_timeout'
    );
  }

  public async request<T = unknown>(
    method: string,
    apiPath: string,
    body?: unknown
  ): Promise<T> {
    await this.ensureRunning();
    const port = this.activePort;
    const token = this.activeToken;
    if (!port || !token) {
      throw new StudioDaemonError('Studio daemon is not initialized.', 503, 'not_ready');
    }
    return this.rawHttpRequest<T>(port, token, method, apiPath, body);
  }

  public async getExternalStageUrl(options: ExternalStageUrlOptions = {}): Promise<vscode.Uri> {
    await this.ensureRunning();
    const port = this.activePort;
    const token = this.activeToken;
    if (!port || !token) {
      throw new StudioDaemonError('Studio daemon is not initialized.', 503, 'not_ready');
    }
    const localBase = vscode.Uri.parse(`http://127.0.0.1:${port}/`);
    const externalBase = await vscode.env.asExternalUri(localBase);

    const hashParams = new URLSearchParams();
    hashParams.set('token', token);
    if (options.projectId) {
      hashParams.set('project', options.projectId);
    }
    if (options.view) {
      hashParams.set('view', options.view);
    }
    if (options.tab) {
      hashParams.set('tab', options.tab);
    }
    const baseWithoutHash = externalBase.with({ fragment: hashParams.toString() });
    return baseWithoutHash;
  }

  private readTokenFromStorage(storageRoot: string): string | null {
    const tokenPath = path.join(storageRoot, '.studio-token');
    try {
      if (fs.existsSync(tokenPath)) {
        const tok = fs.readFileSync(tokenPath, 'utf-8').trim();
        return tok || null;
      }
    } catch {
      // ignore unreadable token
    }
    return null;
  }

  private checkHealth(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/health',
          method: 'GET',
          headers: { Host: `127.0.0.1:${port}` },
          timeout: 1000,
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk: Buffer) => {
            raw += chunk.toString();
          });
          res.on('end', () => {
            if (res.statusCode !== 200) {
              resolve(false);
              return;
            }
            try {
              const parsed = JSON.parse(raw) as { ok?: boolean; service?: string };
              resolve(Boolean(parsed.ok && parsed.service === 'rostooling-studio'));
            } catch {
              resolve(false);
            }
          });
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  private async verifyToken(port: number, token: string): Promise<boolean> {
    try {
      await this.rawHttpRequest(port, token, 'GET', '/api/bootstrap');
      return true;
    } catch {
      return false;
    }
  }

  private rawHttpRequest<T>(
    port: number,
    token: string,
    method: string,
    apiPath: string,
    body?: unknown
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
      const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf-8') : null;
      const headers: Record<string, string> = {
        Host: `127.0.0.1:${port}`,
        'X-Studio-Token': token,
        Accept: 'application/json',
      };
      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(payload.byteLength);
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: cleanPath,
          method: method.toUpperCase(),
          headers,
          timeout: 180000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8');
            let parsed: Record<string, unknown> = {};
            if (raw.trim()) {
              try {
                parsed = JSON.parse(raw) as Record<string, unknown>;
              } catch {
                reject(
                  new StudioDaemonError(
                    `Invalid JSON response from Studio daemon (${res.statusCode}): ${raw.slice(0, 240)}`,
                    res.statusCode ?? 500,
                    'invalid_json'
                  )
                );
                return;
              }
            }
            const status = res.statusCode ?? 500;
            if (status >= 400 || parsed.ok === false) {
              const errObj = (parsed.error ?? {}) as {
                code?: string;
                message?: string;
                details?: unknown;
              };
              reject(
                new StudioDaemonError(
                  errObj.message ?? `Studio daemon request failed (${status})`,
                  status,
                  errObj.code ?? 'request_failed',
                  errObj.details
                )
              );
              return;
            }
            resolve(parsed as T);
          });
        }
      );

      req.on('error', (err) => {
        reject(new StudioDaemonError(`Daemon connection error: ${err.message}`, 503, 'network'));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new StudioDaemonError('Studio daemon request timed out.', 504, 'timeout'));
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => {
        srv.close(() => resolve(true));
      });
      srv.listen(port, '127.0.0.1');
    });
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', (err) => reject(err));
      srv.once('listening', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => {
          if (port > 0) {
            resolve(port);
          } else {
            reject(new Error('Unable to allocate an ephemeral localhost port.'));
          }
        });
      });
      srv.listen(0, '127.0.0.1');
    });
  }

  private log(msg: string): void {
    this.outputChannel?.appendLine(msg);
  }

  public dispose(): void {
    const child = this.daemonProcess;
    this.daemonProcess = null;
    this.activePort = null;
    this.activeToken = null;
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          } catch {
            // ignore already-exited child
          }
        }, 1500);
        killTimer.unref();
      } catch {
        // ignore
      }
    }
  }
}
