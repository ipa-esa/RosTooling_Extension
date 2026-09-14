import * as cp from 'child_process';
import * as path from 'path';

export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number;
  code?: string;
  message: string;
}

export class LspValidator {
  private proc: cp.ChildProcess;
  private buffer = Buffer.alloc(0);
  private listeners = new Map<string, (diags: LspDiagnostic[]) => void>();

  constructor(extensionRoot: string, cataloguePath?: string) {
    const jarPath = path.join(extensionRoot, 'server', 'rostooling_extension-1.2.1.jar');
    const args = [
      '--add-opens=java.base/java.lang=ALL-UNNAMED',
      '--add-opens=java.base/java.util=ALL-UNNAMED',
    ];
    if (cataloguePath) {
      args.push(`-Drostooling.catalogue.path=${cataloguePath}`);
    }
    args.push('-jar', jarPath);

    this.proc = cp.spawn('java', args);

    this.proc.stdout?.on('data', (data: Buffer) => this.onData(data));
  }

  private onData(data: Buffer) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const headerStr = this.buffer.slice(0, headerEnd).toString('utf-8');
      const clMatch = /Content-Length:\s*(\d+)/i.exec(headerStr);
      if (!clMatch) break;
      const cl = parseInt(clMatch[1], 10);
      if (this.buffer.length < headerEnd + 4 + cl) break;
      const bodyStr = this.buffer.slice(headerEnd + 4, headerEnd + 4 + cl).toString('utf-8');
      this.buffer = this.buffer.slice(headerEnd + 4 + cl);

      try {
        const msg = JSON.parse(bodyStr);
        if (msg.method === 'textDocument/publishDiagnostics') {
          const uri = msg.params.uri;
          const handler = this.listeners.get(uri);
          if (handler) {
            handler(msg.params.diagnostics);
          }
        }
      } catch {
        // ignore parse error
      }
    }
  }

  private send(obj: unknown) {
    const json = JSON.stringify(obj);
    const msg = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;
    this.proc.stdin?.write(msg);
  }

  public async init(rootUri?: string, workspaceFolders?: { uri: string; name: string }[]): Promise<void> {
    const params: Record<string, unknown> = {
      processId: process.pid,
      rootUri: rootUri || ('file://' + process.cwd()),
      capabilities: {
        workspace: {
          workspaceFolders: true,
        },
      },
    };
    if (workspaceFolders) {
      params.workspaceFolders = workspaceFolders;
    }
    this.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params,
    });
    this.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  public validate(
    uri: string,
    languageId: 'ros' | 'ros1' | 'ros2' | 'rossystem',
    text: string,
    timeoutMs = 4000
  ): Promise<LspDiagnostic[]> {
    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.listeners.delete(uri);
          resolve([]);
        }
      }, timeoutMs);

      this.listeners.set(uri, (diags) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.listeners.delete(uri);
          resolve(diags);
        }
      });

      this.send({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: { uri, languageId, version: 1, text },
        },
      });
    });
  }

  public stop() {
    try {
      this.proc.kill();
    } catch {
      // ignore
    }
  }
}
