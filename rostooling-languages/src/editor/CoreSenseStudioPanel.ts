import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { RosCatalogueManager } from '../model/RosCatalogueManager';
import { getMacroStudioHtml } from '../webview/studioHtml';
import { DraftContentProvider } from '../orchestration/DraftContentProvider';
import { MaterializationGate } from '../orchestration/MaterializationGate';
import { ReconciliationWatcher } from '../orchestration/ReconciliationWatcher';
import { StudioDaemonManager, StudioDaemonError } from '../orchestration/StudioDaemonManager';

export type MacroStageId = 'intent' | 'packages' | 'architecture' | 'checks' | 'deployment';

interface BootstrapResponse {
  ok?: boolean;
  projects?: { id: string; name?: string; systemName?: string; root?: string }[];
  recentProjects?: { id: string; name?: string; systemName?: string; root?: string }[];
}

interface ProjectEnvelope {
  ok?: boolean;
  projectId?: string;
  revision?: number;
  modelState?: string;
  project?: Record<string, unknown>;
  evidence?: unknown[];
  [key: string]: unknown;
}

interface PanelInstance {
  panel: vscode.WebviewPanel;
  pinnedStage: boolean;
  stage: MacroStageId;
}

/**
 * Multi-instance WebviewPanel manager for the Unified RosTooling Studio Workbench.
 *
 * Supports:
 * - Main IDE Workbench tab (`rostooling.openStudio`)
 * - Stage-pinned panels popped out into floating OS windows (`rostooling.openStudioStage`)
 *   for multi-monitor layouts
 * - External system browser deep-links (`rostooling.openStudioExternal`) via `asExternalUri`
 * - Live round-trip updates whenever `ReconciliationWatcher` reconciles workspace model edits
 */
export class RosStudioWorkbenchController implements vscode.Disposable {
  public static readonly viewType = 'rostooling.studioWorkbench';

  private mainPanel: PanelInstance | null = null;
  private readonly panels = new Set<PanelInstance>();
  private readonly disposables: vscode.Disposable[] = [];

  private activeProjectId = '';
  private latestProjects: { id: string; name?: string; systemName?: string; root?: string }[] = [];
  private latestEnvelope: ProjectEnvelope | null = null;
  private latestMcpStatus: unknown = null;

  private nodeIndex: Record<string, unknown> = {};
  private typeIndex: Record<string, unknown> = {};

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly daemonManager: StudioDaemonManager,
    private readonly materializationGate: MaterializationGate,
    private readonly draftProvider: DraftContentProvider,
    private readonly reconciliationWatcher: ReconciliationWatcher
  ) {
    this.refreshLocalCatalogues();

    this.disposables.push(
      this.reconciliationWatcher.onDidReconcile((evt) => {
        if (!this.activeProjectId || evt.projectId === this.activeProjectId) {
          this.activeProjectId = evt.projectId;
          this.latestEnvelope = evt.envelope as ProjectEnvelope;
          this.broadcastMacroState();
          this.broadcastToast(
            `Reconciled ${path.basename(evt.filePath)} into Studio (rev #${evt.envelope.revision ?? '?'})`
          );
        }
      })
    );
  }

  public getActiveProjectId(): string {
    return this.activeProjectId;
  }

  public async ensureActiveProjectId(): Promise<string> {
    if (this.activeProjectId) {
      return this.activeProjectId;
    }
    await this.bootstrapFromDaemon();
    return this.activeProjectId;
  }

  public openOrShow(initialStage: MacroStageId = 'intent', projectId?: string): vscode.WebviewPanel {
    if (projectId) {
      this.activeProjectId = projectId;
    }
    if (this.mainPanel) {
      this.mainPanel.stage = initialStage;
      this.mainPanel.panel.reveal(vscode.ViewColumn.Active);
      void this.mainPanel.panel.webview.postMessage({
        type: 'macroState',
        stage: initialStage,
        projects: this.latestProjects,
        activeProjectId: this.activeProjectId,
        envelope: this.latestEnvelope,
        mcpStatus: this.latestMcpStatus,
      });
      return this.mainPanel.panel;
    }

    const created = this.createPanelInstance({
      title: 'RosTooling Studio Workbench',
      stage: initialStage,
      pinnedStage: false,
      column: vscode.ViewColumn.Active,
    });
    this.mainPanel = created;
    return created.panel;
  }

  public async openStageInNewWindow(
    stage: MacroStageId,
    projectId?: string
  ): Promise<vscode.WebviewPanel> {
    if (projectId) {
      this.activeProjectId = projectId;
    }
    const stageLabels: Record<MacroStageId, string> = {
      intent: '1. Intent',
      packages: '2. Packages',
      architecture: '3. Architecture',
      checks: '4. Checks',
      deployment: '5. Deployment',
    };
    const instance = this.createPanelInstance({
      title: `RosTooling Studio · ${stageLabels[stage]}`,
      stage,
      pinnedStage: true,
      column: vscode.ViewColumn.Beside,
    });

    try {
      await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
    } catch {
      // Fallback: keep open in Beside split group if floating windows are unsupported
    }
    return instance.panel;
  }

  public async openExternalBrowser(stage?: MacroStageId, projectId?: string): Promise<void> {
    const pid = projectId || (await this.ensureActiveProjectId());
    const uri = await this.daemonManager.getExternalStageUrl({
      projectId: pid || undefined,
      view: stage,
    });
    await vscode.env.openExternal(uri);
  }

  private createPanelInstance(opts: {
    title: string;
    stage: MacroStageId;
    pinnedStage: boolean;
    column: vscode.ViewColumn;
  }): PanelInstance {
    this.refreshLocalCatalogues();
    const localResourceRoots = [
      vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview', 'frontend', 'dist'),
      vscode.Uri.joinPath(this.context.extensionUri, 'images'),
    ];
    const panel = vscode.window.createWebviewPanel(
      RosStudioWorkbenchController.viewType,
      opts.title,
      opts.column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots,
      }
    );

    panel.webview.html = getMacroStudioHtml({
      extensionUri: this.context.extensionUri,
      webview: panel.webview,
      initialStage: opts.stage,
      pinnedStage: opts.pinnedStage,
      initialProjectId: this.activeProjectId,
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      nodeIndex: this.nodeIndex,
      typeIndex: this.typeIndex,
    });

    const instance: PanelInstance = {
      panel,
      pinnedStage: opts.pinnedStage,
      stage: opts.stage,
    };
    this.panels.add(instance);

    const msgSub = panel.webview.onDidReceiveMessage((msg: Record<string, unknown>) => {
      void this.handleWebviewMessage(instance, msg);
    });

    panel.onDidDispose(() => {
      msgSub.dispose();
      this.panels.delete(instance);
      if (this.mainPanel === instance) {
        this.mainPanel = null;
      }
    });

    return instance;
  }

  private refreshLocalCatalogues(): void {
    try {
      const storageDir =
        process.env.ROSTOOLING_CATALOGUE_DIR ||
        path.join(os.homedir(), '.rostooling', 'catalogue_repos');
      const mgr = RosCatalogueManager.getInstance(storageDir);
      const searchRoots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      const idx = mgr.buildCatalogueIndex(searchRoots);
      if (Object.keys(idx.nodes).length > 0 || Object.keys(idx.types).length > 0) {
        this.nodeIndex = {
          nodes: idx.nodes,
          _systems: idx.systems,
          sources: idx.sources,
          lastSync: idx.lastSync,
        };
        this.typeIndex = {
          types: idx.types,
          sources: idx.sources,
        };
        return;
      }
    } catch {
      // fallback to bundled static JSON indices below
    }

    const bundledNodes = path.join(this.context.extensionPath, 'assets', 'node_index.json');
    if (fs.existsSync(bundledNodes)) {
      this.nodeIndex = JSON.parse(fs.readFileSync(bundledNodes, 'utf-8')) as Record<
        string,
        unknown
      >;
    }
    const bundledTypes = path.join(this.context.extensionPath, 'assets', 'type_index.json');
    if (fs.existsSync(bundledTypes)) {
      this.typeIndex = JSON.parse(fs.readFileSync(bundledTypes, 'utf-8')) as Record<
        string,
        unknown
      >;
    }
  }

  private normalizeProjects(
    raw: { id?: string; projectId?: string; name?: string; systemName?: string; root?: string }[]
  ): { id: string; name?: string; systemName?: string; root?: string }[] {
    return (raw || [])
      .map((p) => {
        const id = String(p.id || p.projectId || '').trim();
        const name = String(p.name || p.systemName || id || 'Untitled system').trim();
        return {
          id,
          name,
          systemName: p.systemName || p.name || name,
          root: p.root,
        };
      })
      .filter((p) => Boolean(p.id));
  }

  private async bootstrapFromDaemon(): Promise<void> {
    const boot = await this.daemonManager.request<BootstrapResponse>('GET', '/api/bootstrap');
    const rawProjects = (boot.projects ?? boot.recentProjects ?? []) as {
      id?: string;
      projectId?: string;
      name?: string;
      systemName?: string;
      root?: string;
    }[];
    this.latestProjects = this.normalizeProjects(rawProjects);

    try {
      this.latestMcpStatus = await this.daemonManager.request('GET', '/api/mcp/status');
    } catch {
      this.latestMcpStatus = { available: false };
    }

    if (this.latestProjects.length === 0) {
      const defaultName =
        vscode.workspace.workspaceFolders?.[0]?.name?.replace(/[^a-zA-Z0-9_]+/g, '_') ||
        'robot_system';
      const created = await this.daemonManager.request<ProjectEnvelope>('POST', '/api/projects', {
        name: defaultName,
        mode: 'starter',
      });
      const createdId =
        created.projectId ??
        ((created.project as { studio?: { projectId?: string } } | undefined)?.studio?.projectId ||
          '');
      this.activeProjectId = createdId;
      this.latestEnvelope = created;
      const refreshedBoot = await this.daemonManager.request<BootstrapResponse>(
        'GET',
        '/api/bootstrap'
      );
      this.latestProjects = this.normalizeProjects(
        (refreshedBoot.projects ?? refreshedBoot.recentProjects ?? []) as {
          id?: string;
          projectId?: string;
          name?: string;
          systemName?: string;
          root?: string;
        }[]
      );
      if (createdId && !this.latestProjects.some((p) => p.id === createdId)) {
        this.latestProjects.unshift({ id: createdId, name: defaultName });
      }
      return;
    }

    if (!this.activeProjectId || !this.latestProjects.some((p) => p.id === this.activeProjectId)) {
      this.activeProjectId = this.latestProjects[0].id;
    }
    try {
      this.latestEnvelope = await this.daemonManager.request<ProjectEnvelope>(
        'GET',
        `/api/projects/${encodeURIComponent(this.activeProjectId)}`
      );
    } catch {
      this.latestEnvelope = null;
    }
  }

  private async handleWebviewMessage(
    sender: PanelInstance,
    msg: Record<string, unknown>
  ): Promise<void> {
    const msgType = typeof msg.type === 'string' ? msg.type : '';
    try {
      switch (msgType) {
        case 'macroReady': {
          this.setBusy(true);
          await this.bootstrapFromDaemon();
          this.setBusy(false);
          this.broadcastMacroState();
          break;
        }
        case 'macroSelectProject': {
          const pid = String(msg.projectId || '').trim();
          if (!pid) return;
          this.setBusy(true);
          this.activeProjectId = pid;
          this.latestEnvelope = await this.daemonManager.request<ProjectEnvelope>(
            'GET',
            `/api/projects/${encodeURIComponent(pid)}`
          );
          this.setBusy(false);
          this.broadcastMacroState();
          break;
        }
        case 'macroCreateProject': {
          const name = String(msg.name || 'robot_system').trim();
          this.setBusy(true);
          const created = await this.daemonManager.request<ProjectEnvelope>(
            'POST',
            '/api/projects',
            { name, mode: 'starter' }
          );
          const createdId =
            created.projectId ??
            ((created.project as { studio?: { projectId?: string } } | undefined)?.studio
              ?.projectId ||
              '');
          this.activeProjectId = createdId;
          this.latestEnvelope = created;
          const refreshed = await this.daemonManager.request<BootstrapResponse>(
            'GET',
            '/api/bootstrap'
          );
          this.latestProjects = this.normalizeProjects(
            (refreshed.projects ?? refreshed.recentProjects ?? []) as {
              id?: string;
              projectId?: string;
              name?: string;
              systemName?: string;
              root?: string;
            }[]
          );
          if (createdId && !this.latestProjects.some((p) => p.id === createdId)) {
            this.latestProjects.unshift({ id: createdId, name });
          }
          this.setBusy(false);
          this.broadcastMacroState();
          this.broadcastToast(`Created Studio project "${name}"`);
          break;
        }
        case 'macroDeleteProject': {
          const targetId = String(msg.projectId || this.activeProjectId || '').trim();
          if (!targetId) return;
          this.setBusy(true);
          await this.daemonManager.request(
            'DELETE',
            `/api/projects/${encodeURIComponent(targetId)}`,
            { purge: true }
          );
          const refreshed = await this.daemonManager.request<BootstrapResponse>(
            'GET',
            '/api/bootstrap'
          );
          this.latestProjects = this.normalizeProjects(
            (refreshed.projects ?? refreshed.recentProjects ?? []) as {
              id?: string;
              projectId?: string;
              name?: string;
              systemName?: string;
              root?: string;
            }[]
          );
          if (this.activeProjectId === targetId) {
            const nextProject = this.latestProjects[0];
            if (nextProject) {
              this.activeProjectId = nextProject.id;
              this.latestEnvelope = await this.daemonManager.request<ProjectEnvelope>(
                'GET',
                `/api/projects/${encodeURIComponent(nextProject.id)}`
              );
            } else {
              this.activeProjectId = '';
              this.latestEnvelope = null;
            }
          }
          this.setBusy(false);
          this.broadcastMacroState();
          this.broadcastToast('Deleted Studio project');
          break;
        }
        case 'macroSaveProject': {
          if (!this.activeProjectId || !msg.project) return;
          const expectedRevision = this.latestEnvelope?.revision ?? 1;
          try {
            this.latestEnvelope = await this.daemonManager.request<ProjectEnvelope>(
              'PUT',
              `/api/projects/${encodeURIComponent(this.activeProjectId)}`,
              {
                expectedRevision,
                project: msg.project,
              }
            );
          } catch (err) {
            if (err instanceof StudioDaemonError && err.status === 409) {
              const latest = await this.daemonManager.request<ProjectEnvelope>(
                'GET',
                `/api/projects/${encodeURIComponent(this.activeProjectId)}`
              );
              this.latestEnvelope = await this.daemonManager.request<ProjectEnvelope>(
                'PUT',
                `/api/projects/${encodeURIComponent(this.activeProjectId)}`,
                {
                  expectedRevision: latest.revision ?? 1,
                  project: msg.project,
                }
              );
            } else {
              throw err;
            }
          }
          // Update revision/state across any other open panels without clobbering active typing
          for (const inst of this.panels) {
            if (inst !== sender) {
              void inst.panel.webview.postMessage({
                type: 'macroState',
                projects: this.latestProjects,
                activeProjectId: this.activeProjectId,
                envelope: this.latestEnvelope,
                mcpStatus: this.latestMcpStatus,
              });
            }
          }
          void sender.panel.webview.postMessage({
            type: 'macroState',
            projects: this.latestProjects,
            activeProjectId: this.activeProjectId,
            envelope: {
              revision: this.latestEnvelope?.revision,
              modelState: this.latestEnvelope?.modelState,
            },
            mcpStatus: this.latestMcpStatus,
          });
          break;
        }
        case 'macroPromoteToModels': {
          const pid = await this.ensureActiveProjectId();
          const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!wsFolder) {
            throw new Error('Open a workspace folder in VS Code before promoting models.');
          }
          this.setBusy(true);
          const subdir = typeof msg.targetSubdir === 'string' ? msg.targetSubdir : 'models';
          const res = await this.materializationGate.promoteProjectToWorkspace(pid, wsFolder, {
            targetSubdir: subdir,
            openInEditor: true,
          });
          this.latestEnvelope = await this.daemonManager.request<ProjectEnvelope>(
            'GET',
            `/api/projects/${encodeURIComponent(pid)}`
          );
          this.setBusy(false);
          this.broadcastMacroState();
          this.broadcastToast(
            `Promoted ${res.writtenFiles.length} model file(s) to ${path.relative(wsFolder, res.targetDir) || 'models/'}`
          );
          break;
        }
        case 'macroPreviewDraftDsl': {
          const pid = await this.ensureActiveProjectId();
          this.setBusy(true);
          const uris = await this.draftProvider.fetchAndCacheProjectDrafts(pid);
          this.setBusy(false);
          const primaryUri =
            uris.find((u) => u.path.endsWith('.rossystem')) ?? uris[0];
          if (primaryUri) {
            const doc = await vscode.workspace.openTextDocument(primaryUri);
            await vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.Beside,
              preview: true,
            });
          } else {
            this.broadcastToast('No draft model files generated yet.', true);
          }
          break;
        }
        case 'macroRunChecks': {
          const pid = await this.ensureActiveProjectId();
          this.setBusy(true);
          const current = await this.daemonManager.request<ProjectEnvelope>(
            'GET',
            `/api/projects/${encodeURIComponent(pid)}`
          );
          const checkRes = await this.daemonManager.request<{
            checks?: unknown[];
            diagnostics?: unknown;
          }>('POST', `/api/projects/${encodeURIComponent(pid)}/validate`, {
            expectedRevision: current.revision,
          });
          const refreshed = await this.daemonManager.request<ProjectEnvelope>(
            'GET',
            `/api/projects/${encodeURIComponent(pid)}`
          );
          this.latestEnvelope = refreshed;
          this.setBusy(false);
          for (const inst of this.panels) {
            void inst.panel.webview.postMessage({
              type: 'macroChecksResult',
              checks: checkRes.checks ?? [],
              diagnostics: checkRes.diagnostics,
              evidence: refreshed.evidence ?? [],
            });
          }
          break;
        }
        case 'macroRunMcpStep': {
          const pid = await this.ensureActiveProjectId();
          const step = String(msg.step || 'validate');
          const routeMap: Record<string, string> = {
            validate: 'mcp/validate',
            wrappers: 'mcp/generate-wrappers',
            system: 'mcp/generate-system',
            build: 'mcp/build',
          };
          const subRoute = routeMap[step];
          if (!subRoute) {
            throw new Error(`Unsupported MCP step: ${step}`);
          }
          const payload = (msg.payload as Record<string, unknown> | undefined) ?? {};
          const defaultWs = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          const body = {
            ...(defaultWs ? { workspaceDir: defaultWs } : {}),
            ...payload,
          };
          this.setBusy(true);
          const result = await this.daemonManager.request(
            'POST',
            `/api/projects/${encodeURIComponent(pid)}/${subRoute}`,
            body
          );
          this.setBusy(false);
          for (const inst of this.panels) {
            void inst.panel.webview.postMessage({
              type: 'macroMcpResult',
              step,
              result,
            });
          }
          this.broadcastToast(`Completed MCP step: ${step}`);
          break;
        }
        case 'macroPopOutStage': {
          const stage = (msg.stage as MacroStageId | undefined) ?? sender.stage;
          await this.openStageInNewWindow(stage, this.activeProjectId);
          break;
        }
        case 'macroOpenExternalBrowser': {
          const stage = (msg.stage as MacroStageId | undefined) ?? sender.stage;
          await this.openExternalBrowser(stage, this.activeProjectId);
          break;
        }
        case 'macroFetchRepository': {
          const pid = await this.ensureActiveProjectId();
          this.setBusy(true);
          await this.daemonManager.request(
            'POST',
            `/api/projects/${encodeURIComponent(pid)}/repositories`,
            {
              url: msg.url,
              branch: msg.branch || 'main',
            }
          );
          this.setBusy(false);
          this.broadcastToast('Repository fetched into Studio project.');
          break;
        }
        case 'macroInspectSources': {
          const pid = await this.ensureActiveProjectId();
          this.setBusy(true);
          const defaultWs = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          const targetPath =
            typeof msg.path === 'string' && msg.path.trim()
              ? msg.path.trim()
              : defaultWs;
          const queryParam = targetPath ? `?path=${encodeURIComponent(targetPath)}` : '';
          const sources = await this.daemonManager.request(
            'GET',
            `/api/projects/${encodeURIComponent(pid)}/source/inspect${queryParam}`
          );
          this.setBusy(false);
          for (const inst of this.panels) {
            void inst.panel.webview.postMessage({
              type: 'macroSourcesResult',
              sources,
            });
          }
          break;
        }
        case 'macroBrowseWorkspaceFolder': {
          const defaultWs = vscode.workspace.workspaceFolders?.[0]?.uri;
          const picked = await vscode.window.showOpenDialog({
            title: 'Select ROS Workspace to Scan',
            defaultUri: defaultWs,
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
          });
          if (picked?.[0]) {
            for (const inst of this.panels) {
              void inst.panel.webview.postMessage({
                type: 'macroWorkspaceFolderPicked',
                path: picked[0].fsPath,
              });
            }
          }
          break;
        }
        case 'pullCatalogue': {
          const mgr = RosCatalogueManager.getInstance();
          const res = await mgr.syncRepositories();
          this.refreshLocalCatalogues();
          for (const inst of this.panels) {
            void inst.panel.webview.postMessage({
              type: 'updateCatalogue',
              nodeCatalog: this.nodeIndex,
              typeCatalog: this.typeIndex,
            });
          }
          this.broadcastToast(
            res.success
              ? `Synced catalogues (${res.updated.length} updated)`
              : `Catalogue sync finished with warnings: ${res.errors.join('; ')}`,
            !res.success
          );
          break;
        }
        case 'browseCatalogueFolder': {
          const picked = await vscode.window.showOpenDialog({
            title: 'Add Custom RosTooling Catalogue Folder',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
          });
          if (picked?.[0]) {
            RosCatalogueManager.getInstance().addCustomFolder(picked[0].fsPath);
            this.refreshLocalCatalogues();
            for (const inst of this.panels) {
              void inst.panel.webview.postMessage({
                type: 'updateCatalogue',
                nodeCatalog: this.nodeIndex,
                typeCatalog: this.typeIndex,
              });
            }
          }
          break;
        }
        case 'removeCatalogueFolder': {
          if (typeof msg.folderId === 'string') {
            RosCatalogueManager.getInstance().removeCustomFolder(msg.folderId);
            this.refreshLocalCatalogues();
            for (const inst of this.panels) {
              void inst.panel.webview.postMessage({
                type: 'updateCatalogue',
                nodeCatalog: this.nodeIndex,
                typeCatalog: this.typeIndex,
              });
            }
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      this.setBusy(false);
      const message = err instanceof Error ? err.message : String(err);
      this.broadcastToast(message, true);
    }
  }

  private setBusy(busy: boolean): void {
    for (const inst of this.panels) {
      void inst.panel.webview.postMessage({ type: 'macroState', busy });
    }
  }

  private broadcastMacroState(): void {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    for (const inst of this.panels) {
      void inst.panel.webview.postMessage({
        type: 'macroState',
        projects: this.latestProjects,
        activeProjectId: this.activeProjectId,
        envelope: this.latestEnvelope,
        mcpStatus: this.latestMcpStatus,
        workspaceRoot: wsRoot,
        busy: false,
      });
    }
  }

  private broadcastToast(text: string, isError = false): void {
    for (const inst of this.panels) {
      void inst.panel.webview.postMessage({
        type: 'macroToast',
        text,
        isError,
      });
    }
  }

  public dispose(): void {
    for (const inst of Array.from(this.panels)) {
      inst.panel.dispose();
    }
    this.panels.clear();
    this.mainPanel = null;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}

/** @deprecated Use RosStudioWorkbenchController */
export const CoreSenseStudioController = RosStudioWorkbenchController;
/** @deprecated Use RosStudioWorkbenchController */
export type CoreSenseStudioController = RosStudioWorkbenchController;
