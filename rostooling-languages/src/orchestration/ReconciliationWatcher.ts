import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RosLayoutManager } from '../model/RosLayoutManager';
import { StudioApiClient } from './DraftContentProvider';
import { MaterializationGate } from './MaterializationGate';

export interface ProjectLookupResponse {
  ok?: boolean;
  found?: boolean;
  projectId?: string | null;
}

export interface ReconcileFileResponse {
  ok?: boolean;
  revision?: number;
  reconciledFile?: string | null;
  project?: unknown;
  [key: string]: unknown;
}

export interface ReconciliationEvent {
  projectId: string;
  filePath: string;
  envelope: ReconcileFileResponse;
}

export interface ReconciliationWatcherOptions {
  debounceMs?: number;
  enableWatchers?: boolean;
}

/**
 * Watches workspace `.ros`, `.ros2`, `.rossystem`, and `.layout.json` saves and
 * dispatches `POST /api/projects/:id/reconcile-file` to synchronize Model Studio
 * or raw Xtext DSL edits back into the RosTooling Studio Macro project without losing
 * high-level intent, behavior, pipeline roles, or deployment units.
 */
export class ReconciliationWatcher implements vscode.Disposable {
  private apiClient: StudioApiClient | null;
  private readonly materializationGate: MaterializationGate | null;
  private readonly debounceMs: number;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly onDidReconcileEmitter = new vscode.EventEmitter<ReconciliationEvent>();
  public readonly onDidReconcile = this.onDidReconcileEmitter.event;

  constructor(
    apiClient?: StudioApiClient | null,
    materializationGate?: MaterializationGate | null,
    options: ReconciliationWatcherOptions = {}
  ) {
    this.apiClient = apiClient ?? null;
    this.materializationGate = materializationGate ?? null;
    this.debounceMs = options.debounceMs ?? 250;

    if (options.enableWatchers !== false) {
      this.registerWorkspaceListeners();
    }
  }

  public setApiClient(client: StudioApiClient | null): void {
    this.apiClient = client;
  }

  private registerWorkspaceListeners(): void {
    const modelWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ros,ros2,rossystem}');
    const onModelFsEvent = (uri: vscode.Uri) => {
      if (uri.scheme === 'file') {
        this.scheduleReconcile(uri.fsPath);
      }
    };
    this.disposables.push(
      modelWatcher,
      modelWatcher.onDidChange(onModelFsEvent),
      modelWatcher.onDidCreate(onModelFsEvent)
    );

    const layoutWatcher = vscode.workspace.createFileSystemWatcher(
      '**/.rostooling/layout/*.rossystem.layout.json'
    );
    const onLayoutFsEvent = (uri: vscode.Uri) => {
      if (uri.scheme === 'file') {
        const modelPath = this.resolveModelPathFromLayout(uri.fsPath);
        if (modelPath) {
          this.scheduleReconcile(modelPath);
        }
      }
    };
    this.disposables.push(
      layoutWatcher,
      layoutWatcher.onDidChange(onLayoutFsEvent),
      layoutWatcher.onDidCreate(onLayoutFsEvent)
    );

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.uri.scheme !== 'file') {
          return;
        }
        const fsPath = doc.uri.fsPath;
        if (/\.(ros|ros2|rossystem)$/.test(fsPath)) {
          this.scheduleReconcile(fsPath);
        } else if (fsPath.endsWith('.rossystem.layout.json')) {
          const modelPath = this.resolveModelPathFromLayout(fsPath);
          if (modelPath) {
            this.scheduleReconcile(modelPath);
          }
        }
      })
    );
  }

  private shouldIgnorePath(filePath: string): boolean {
    if (!filePath || RosLayoutManager.isCataloguePath(filePath)) {
      return true;
    }
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('/.work/') || normalized.includes('/.studio/')) {
      return true;
    }
    if (this.materializationGate?.isRecentlyMaterialized(filePath)) {
      return true;
    }
    return false;
  }

  private resolveModelPathFromLayout(layoutFilePath: string): string | null {
    const baseName = path.basename(layoutFilePath).replace(/\.layout\.json$/, '');
    if (!baseName.endsWith('.rossystem')) {
      return null;
    }
    // Layout path is typically `<root>/.rostooling/layout/<name>.rossystem.layout.json`
    const layoutDir = path.dirname(layoutFilePath);
    const dotRostooling = path.dirname(layoutDir);
    const rootDir = path.dirname(dotRostooling);
    const candidates = [
      path.join(rootDir, 'models', baseName),
      path.join(rootDir, baseName),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    return null;
  }

  public scheduleReconcile(filePath: string): void {
    const resolved = path.resolve(filePath);
    if (this.shouldIgnorePath(resolved)) {
      return;
    }
    const prev = this.pendingTimers.get(resolved);
    if (prev) {
      clearTimeout(prev);
    }
    const handle = setTimeout(() => {
      this.pendingTimers.delete(resolved);
      void this.reconcileFile(resolved).catch((err) => {
        console.warn(`[ReconciliationWatcher] Failed to reconcile ${resolved}:`, err);
      });
    }, this.debounceMs);
    this.pendingTimers.set(resolved, handle);
  }

  public async reconcileFile(
    filePath: string,
    explicitProjectId?: string
  ): Promise<ReconciliationEvent | null> {
    if (!this.apiClient) {
      return null;
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved) || RosLayoutManager.isCataloguePath(resolved)) {
      return null;
    }

    let projectId = explicitProjectId ?? this.materializationGate?.lookupLocalProjectId(resolved);
    if (!projectId) {
      // Avoid cold-spawning a Python daemon on unrelated standalone file saves when Studio is idle
      if (this.apiClient.isRunning && !this.apiClient.isRunning()) {
        return null;
      }
      if (this.apiClient.isAvailable && !(await this.apiClient.isAvailable())) {
        return null;
      }
      const lookup = await this.apiClient.request<ProjectLookupResponse>(
        'GET',
        `/api/projects/lookup?filePath=${encodeURIComponent(resolved)}`
      );
      if (lookup.found && lookup.projectId) {
        projectId = lookup.projectId;
      }
    } else if (this.apiClient.isAvailable && !(await this.apiClient.isAvailable())) {
      return null;
    }
    if (!projectId) {
      return null;
    }

    const rolesByLabel = this.extractRolesByLabel(resolved);
    const envelope = await this.apiClient.request<ReconcileFileResponse>(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/reconcile-file`,
      {
        filePath: resolved,
        ...(Object.keys(rolesByLabel).length > 0 ? { rolesByLabel } : {}),
      }
    );

    const event: ReconciliationEvent = {
      projectId,
      filePath: resolved,
      envelope,
    };
    this.onDidReconcileEmitter.fire(event);
    return event;
  }

  private extractRolesByLabel(modelFilePath: string): Record<string, string> {
    const roles: Record<string, string> = {};
    const wsFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(modelFilePath));
    const wsRoot = wsFolder?.uri.fsPath;

    const systemCandidates: string[] = [];
    if (modelFilePath.endsWith('.rossystem')) {
      systemCandidates.push(modelFilePath);
    } else {
      try {
        const dir = path.dirname(modelFilePath);
        for (const name of fs.readdirSync(dir)) {
          if (name.endsWith('.rossystem')) {
            systemCandidates.push(path.join(dir, name));
          }
        }
      } catch {
        // ignore unreadable directory
      }
    }

    for (const sysFile of systemCandidates) {
      const schematic = RosLayoutManager.loadLayoutSchematic(sysFile, wsRoot);
      for (const node of schematic?.nodes ?? []) {
        if (node.label && node.role) {
          roles[node.label] = node.role;
        }
      }
    }
    return roles;
  }

  public dispose(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.onDidReconcileEmitter.dispose();
  }
}
