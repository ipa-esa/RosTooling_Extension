import type {
  ActionMessage,
  DisposeClientSessionParameters,
  GLSPClientProxy,
  GLSPServer,
  GLSPServerListener,
  InitializeClientSessionParameters,
  InitializeParameters,
  InitializeResult,
} from '@eclipse-glsp/client';
import { getVsCodeApi } from '../state/vscodeBridge';

/**
 * GLSPServer adapter for the VS Code webview. The standard Eclipse GLSP (Sprotty) client talks to
 * this object; it relays every call over postMessage to the extension host, which forwards it to
 * the Java GLSP server through GlspClientBridge. Server actions come back the same way and are
 * handed to the client proxy unchanged.
 */
export class WebviewGlspServer implements GLSPServer {
  private proxy: GLSPClientProxy | undefined;
  private listeners = new Set<GLSPServerListener>();
  private requestCounter = 0;
  private pending = new Map<string, (result: unknown) => void>();
  private reloadHandler: (() => void) | undefined;

  constructor() {
    window.addEventListener('message', (event) => this.onHostMessage(event.data));
  }

  connectProxy(proxy: GLSPClientProxy): void {
    this.proxy = proxy;
  }

  /** Called when the host asks the diagram to re-request its model (text edits, undo/redo). */
  onReload(handler: () => void): void {
    this.reloadHandler = handler;
  }

  initialize(params: InitializeParameters): Promise<InitializeResult> {
    return this.request('glspInitServer', { params }) as Promise<InitializeResult>;
  }

  async initializeClientSession(params: InitializeClientSessionParameters): Promise<void> {
    await this.request('glspInitSession', { params });
  }

  async disposeClientSession(params: DisposeClientSessionParameters): Promise<void> {
    getVsCodeApi().postMessage({ type: 'glspDisposeSession', params });
  }

  process(message: ActionMessage): void {
    getVsCodeApi().postMessage({ type: 'glspClientAction', clientId: message.clientId, action: message.action });
  }

  shutdown(): void {
    // The Java server is shared by all editors; it is shut down by the extension host.
  }

  addListener(listener: GLSPServerListener): boolean {
    this.listeners.add(listener);
    return true;
  }

  removeListener(listener: GLSPServerListener): boolean {
    return this.listeners.delete(listener);
  }

  private request(type: string, payload: Record<string, unknown>): Promise<unknown> {
    const requestId = `wv_${++this.requestCounter}`;
    return new Promise((resolve) => {
      this.pending.set(requestId, resolve);
      getVsCodeApi().postMessage({ type, requestId, ...payload });
    });
  }

  private onHostMessage(msg: { type?: string; requestId?: string; result?: unknown; clientId?: string; action?: unknown }): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'glspResponse' && msg.requestId && this.pending.has(msg.requestId)) {
      const resolve = this.pending.get(msg.requestId)!;
      this.pending.delete(msg.requestId);
      resolve(msg.result);
    } else if (msg.type === 'glspServerAction' && this.proxy && msg.action) {
      this.proxy.process({ clientId: String(msg.clientId), action: msg.action } as ActionMessage);
    } else if (msg.type === 'glspReload') {
      this.reloadHandler?.();
    }
  }
}
