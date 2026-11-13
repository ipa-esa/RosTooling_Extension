import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getStudioHtml } from '../webview/studioHtml';
import { RosProject } from '../model/RosModelTypes';
import { RosCatalogueManager } from '../model/RosCatalogueManager';
import { GlspClientBridge, GGraph, GlspMarker, GlspAction, RosIndexFile } from '../glsp/GlspClientBridge';

/**
 * Hybrid RosTooling custom editor.
 *
 * The Java GLSP/Xtext server (`de.fraunhofer.ipa.ros.glsp`) is the single source of truth:
 *  - it parses, links, validates and lays out (ELK) the model and returns a GGraph + markers;
 *  - every webview edit is a GLSP operation, executed as an EMF command and written back by the
 *    surgical, comment-preserving RosAstNodeModelSerializer (`saveModel`).
 * This provider only relays GLSP actions between the webview and the server. It never parses or
 * emits DSL text and never rewrites files.
 */
export class RosCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'rostooling.visualStudio';
  public static activeCustomDocument?: vscode.TextDocument;

  private catalogueManager: RosCatalogueManager | null = null;
  private nodeIndex: Record<string, unknown> | null = null;
  private typeIndex: Record<string, unknown> | null = null;
  private catalogueLoad: Promise<void> | null = null;
  /** Server-side descriptions of workspace model files, keyed by path (invalidated by mtime). */
  private companionIndex = new Map<string, { mtimeMs: number; entry: RosIndexFile }>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.initCatalogueManager();
  }

  public invalidateCompanionCache(): void {
    this.companionIndex.clear();
  }

  // ------------------------------------------------------------------------------------------
  // Catalogue (component nodes + communication types), indexed by the Java server
  // ------------------------------------------------------------------------------------------

  private initCatalogueManager(): void {
    try {
      const storageDir = this.context?.globalStorageUri
        ? path.join(this.context.globalStorageUri.fsPath, 'catalogue_repos')
        : path.join(os.homedir(), '.rostooling', 'catalogue_repos');
      this.catalogueManager = RosCatalogueManager.getInstance(storageDir);
      const isTestEnv =
        this.context?.extensionMode === vscode.ExtensionMode.Test || process.env.VSCODE_TEST_RUN === '1';
      if (!isTestEnv) {
        void this.catalogueManager.syncRepositories(false).then((res) => {
          if (res.updated.length > 0) {
            void this.refreshCatalogues();
          }
        });
      }
    } catch (e) {
      console.warn('Failed to initialise RosTooling catalogue manager:', e);
    }
  }

  private getSearchRoots(docFilePath?: string): string[] {
    const roots = new Set<string>();
    for (const ws of vscode.workspace.workspaceFolders || []) {
      roots.add(ws.uri.fsPath);
      const parent = path.dirname(ws.uri.fsPath);
      for (const sib of ['RosModelsCatalog', 'RosCommonObjects']) {
        const p = path.join(parent, sib);
        if (fs.existsSync(p)) roots.add(p);
      }
    }
    const defaultUserPath = path.join(os.homedir(), '.rostooling', 'catalogue_repos');
    for (const repo of RosCatalogueManager.DEFAULT_REPOSITORIES) {
      const p = path.join(defaultUserPath, repo.name);
      if (fs.existsSync(p)) roots.add(p);
    }
    const targetDoc = docFilePath || vscode.window.activeTextEditor?.document.fileName;
    if (targetDoc) {
      let curDir = path.dirname(targetDoc);
      let foundWsRoot: string | undefined;
      for (let i = 0; i < 8; i++) {
        if (!curDir || curDir === '/' || curDir === '.') break;
        try {
          const srcPath = path.join(curDir, 'src');
          if (fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()) {
            foundWsRoot = curDir;
          }
        } catch {
          // ignore
        }
        for (const sib of ['RosModelsCatalog', 'RosCommonObjects']) {
          const p = path.join(curDir, sib);
          if (fs.existsSync(p)) roots.add(p);
        }
        const parent = path.dirname(curDir);
        if (parent === curDir) break;
        curDir = parent;
      }
      if (foundWsRoot) roots.add(foundWsRoot);
      const dirOfFile = path.dirname(targetDoc);
      if (fs.existsSync(dirOfFile)) roots.add(dirOfFile);
    }
    return Array.from(roots);
  }

  /** (Re)builds the catalogue index through the Java server and caches it for new editors. */
  public async refreshCatalogues(
    docFilePath?: string
  ): Promise<{ nodeIndex: Record<string, unknown>; typeIndex: Record<string, unknown> }> {
    if (!this.catalogueManager) {
      this.initCatalogueManager();
    }
    if (this.catalogueManager) {
      try {
        this.catalogueManager.invalidateCache();
        const catIndex = await this.catalogueManager.buildCatalogueIndex(this.getSearchRoots(docFilePath));
        this.nodeIndex = {
          nodes: catIndex.nodes,
          _systems: catIndex.systems,
          sources: catIndex.sources,
          lastSync: catIndex.lastSync,
        };
        this.typeIndex = { types: catIndex.types, sources: catIndex.sources };
      } catch (e) {
        console.warn('Failed to index RosTooling catalogue via GLSP server:', e);
      }
    }
    return { nodeIndex: this.nodeIndex || {}, typeIndex: this.typeIndex || {} };
  }

  private ensureCatalogues(docFilePath?: string): Promise<void> {
    if (!this.catalogueLoad) {
      this.catalogueLoad = this.refreshCatalogues(docFilePath).then(() => undefined);
    }
    return this.catalogueLoad;
  }

  public isCoreCatalogue(filePath?: string): boolean {
    if (!filePath) return false;
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('/RosModelsCatalog/') || normalized.endsWith('/RosModelsCatalog')) return true;
    if (normalized.includes('/RosCommonObjects/') || normalized.endsWith('/RosCommonObjects')) return true;
    if (normalized.includes('/.rostooling/catalogue_repos/') || normalized.includes('/catalogue_repos/')) return true;
    if (normalized.includes('/assets/nodes/') || normalized.includes('/assets/types/')) return true;
    if (this.catalogueManager) {
      const storage = this.catalogueManager.getStorageDir().replace(/\\/g, '/');
      if (storage && (normalized.startsWith(storage) || normalized.includes(storage))) return true;
      for (const cf of this.catalogueManager.getCustomFolders()) {
        const cfPath = cf.path.replace(/\\/g, '/');
        if (cfPath && (normalized.startsWith(cfPath + '/') || normalized === cfPath)) {
          return true;
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------
  // Locating companion .ros2 / .rossystem files (described by the Java server)
  // ------------------------------------------------------------------------------------------

  private findModelFilesRecursive(dir: string, exts: string[], maxDepth = 4, curDepth = 0): string[] {
    let results: string[] = [];
    if (curDepth > maxDepth) return results;
    try {
      if (!fs.existsSync(dir)) return results;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          ent.name.startsWith('.') ||
          ['node_modules', 'build', 'install', 'log', '__pycache__'].includes(ent.name)
        ) {
          continue;
        }
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          results = results.concat(this.findModelFilesRecursive(full, exts, maxDepth, curDepth + 1));
        } else if (ent.isFile() && exts.some((e) => ent.name.endsWith(e))) {
          results.push(full);
        }
      }
    } catch {
      // ignore read errors
    }
    return results;
  }

  private getWorkspaceRoots(docFilePath: string): string[] {
    const rawRoots = new Set<string>();
    for (const wf of vscode.workspace.workspaceFolders || []) {
      rawRoots.add(wf.uri.fsPath);
    }
    if (docFilePath) {
      const fileDir = path.dirname(docFilePath);
      rawRoots.add(fileDir);
      let curDir = fileDir;
      const homeDir = os.homedir();
      for (let i = 0; i < 6; i++) {
        if (!curDir || curDir === '/' || curDir === '.' || curDir === homeDir) break;
        for (const sib of ['RosModelsCatalog', 'RosCommonObjects']) {
          const p = path.join(curDir, sib);
          if (fs.existsSync(p)) rawRoots.add(p);
        }
        const srcDir = path.join(curDir, 'src');
        if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
          rawRoots.add(curDir);
          break;
        }
        if (fs.existsSync(path.join(curDir, 'package.xml')) || fs.existsSync(path.join(curDir, '.git'))) {
          rawRoots.add(curDir);
        }
        const parent = path.dirname(curDir);
        if (parent === curDir || parent === homeDir) break;
        curDir = parent;
      }
    }
    if (this.catalogueManager) {
      const storageDir = this.catalogueManager.getStorageDir();
      if (fs.existsSync(storageDir)) rawRoots.add(storageDir);
      for (const cf of this.catalogueManager.getCustomFolders()) {
        if (cf.path && fs.existsSync(cf.path)) rawRoots.add(cf.path);
      }
    }
    const sorted = Array.from(rawRoots).sort((a, b) => a.length - b.length);
    const nonRedundant: string[] = [];
    for (const r of sorted) {
      const isSub = nonRedundant.some((parent) => {
        const rel = path.relative(parent, r);
        return !rel.startsWith('..') && !path.isAbsolute(rel);
      });
      if (!isSub) nonRedundant.push(r);
    }
    return nonRedundant;
  }

  private async loadCompanionIndex(docFilePath: string): Promise<RosIndexFile[]> {
    const files: string[] = [];
    for (const root of this.getWorkspaceRoots(docFilePath)) {
      files.push(...this.findModelFilesRecursive(root, ['.ros2', '.ros1', '.rossystem']));
    }
    const stale: string[] = [];
    for (const f of files) {
      try {
        const mtimeMs = fs.statSync(f).mtimeMs;
        const cached = this.companionIndex.get(f);
        if (!cached || cached.mtimeMs !== mtimeMs) stale.push(f);
      } catch {
        // file vanished
      }
    }
    if (stale.length > 0) {
      const described = await GlspClientBridge.getInstance().requestRosIndex(stale);
      for (const entry of described) {
        try {
          this.companionIndex.set(entry.path, { mtimeMs: fs.statSync(entry.path).mtimeMs, entry });
        } catch {
          // ignore
        }
      }
    }
    return files.map((f) => this.companionIndex.get(f)?.entry).filter(Boolean) as RosIndexFile[];
  }

  public async resolveComponentFilePath(
    from?: string,
    pkg?: string,
    artifact?: string,
    label?: string,
    docFilePath?: string
  ): Promise<string | undefined> {
    const keys = new Set(
      [from, pkg && artifact ? `${pkg}.${artifact}` : undefined, pkg && label ? `${pkg}.${label}` : undefined, artifact, label]
        .filter(Boolean) as string[]
    );
    for (const entry of await this.loadCompanionIndex(docFilePath || '')) {
      for (const p of entry.packages || []) {
        for (const a of p.artifacts || []) {
          const candidates = [`${p.name}.${a.node}`, `${p.name}.${a.artifact}`, `${p.name}.${a.artifact}.${a.node}`, a.artifact, a.node];
          if (candidates.some((c) => keys.has(c))) {
            return entry.path;
          }
        }
      }
    }
    return undefined;
  }

  public async resolveSubsystemFilePath(
    subRef?: string,
    fromFile?: string,
    docFilePath?: string
  ): Promise<string | undefined> {
    if (!subRef && !fromFile) return undefined;
    const names = new Set(
      [subRef, subRef?.replace(/_\d+$/, ''), fromFile ? path.basename(fromFile, '.rossystem') : undefined].filter(Boolean) as string[]
    );
    if (docFilePath && fromFile) {
      const resolved = path.resolve(path.dirname(docFilePath), fromFile);
      if (fs.existsSync(resolved)) return resolved;
    }
    for (const entry of await this.loadCompanionIndex(docFilePath || '')) {
      if (entry.kind === 'rossystem' && entry.system && names.has(entry.system.name)) {
        return entry.path;
      }
    }
    if (docFilePath && subRef) {
      for (const base of [subRef, subRef.replace(/_\d+$/, '')]) {
        const resolved = path.resolve(path.dirname(docFilePath), base.endsWith('.rossystem') ? base : `${base}.rossystem`);
        if (fs.existsSync(resolved)) return resolved;
      }
    }
    return undefined;
  }

  // ------------------------------------------------------------------------------------------
  // Editor lifecycle
  // ------------------------------------------------------------------------------------------

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    void _token;
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    RosCustomEditorProvider.activeCustomDocument = document;
    const viewStateSubscription = webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        RosCustomEditorProvider.activeCustomDocument = document;
      } else if (RosCustomEditorProvider.activeCustomDocument === document) {
        RosCustomEditorProvider.activeCustomDocument = undefined;
      }
    });

    const docKey = document.uri.toString();
    const fileName = document.fileName;
    const isDiagram = fileName.endsWith('.rossystem');
    const isReadOnly = this.isCoreCatalogue(fileName);
    const glspBridge = GlspClientBridge.getInstance();
    /** Host-managed session (forms) — the Sprotty client of a .rossystem brings its own id. */
    const hostClientId = `ros_editor_${docKey}`;
    let diagramClientId: string | null = null;
    let currentGGraph: GGraph | null = null;
    let currentMarkers: GlspMarker[] = [];
    let disposed = false;
    /** Text the server last parsed for this document; document changes equal to it are ours. */
    let serverText: string | null = null;

    const toProject = (): RosProject =>
      GlspClientBridge.gGraphToRosProject(
        currentGGraph || { id: 'root', type: 'graph', children: [] },
        currentMarkers,
        { fileName }
      );

    const postModel = () => {
      if (disposed || !currentGGraph) return;
      void webviewPanel.webview.postMessage({
        type: 'updateGlspModel',
        gGraph: currentGGraph,
        markers: currentMarkers,
        project: toProject(),
      });
    };

    const post = (msg: unknown) => {
      if (!disposed) void webviewPanel.webview.postMessage(msg);
    };

    /**
     * Pulls the surgical span edits for the session's pending AST mutations from the server and
     * applies them to the open document as ONE undoable WorkspaceEdit. The file is never
     * rewritten; VS Code keeps the undo history and dirty state.
     */
    const applyServerEdits = async (clientId: string): Promise<boolean> => {
      const result = await glspBridge.requestTextEdits(clientId);
      serverText = result.newText;
      if (result.edits.length === 0) return true;
      if (document.getText() !== result.baseText) {
        // The buffer changed while the server computed the edits: re-sync instead of guessing.
        void vscode.window.showWarningMessage('RosTooling: the document changed during a diagram edit; the edit was not applied.');
        serverText = null;
        await reloadFromDocument();
        return false;
      }
      const edit = new vscode.WorkspaceEdit();
      for (const e of result.edits) {
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(e.offset), document.positionAt(e.offset + e.length)),
          e.text
        );
      }
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) {
        void vscode.window.showErrorMessage('RosTooling: VS Code rejected the model edit.');
        serverText = null;
        await reloadFromDocument();
      }
      return ok;
    };

    /** Re-parses the current buffer on the server (text edits, VS Code undo/redo, companions). */
    const reloadFromDocument = async () => {
      serverText = document.getText();
      if (diagramClientId) {
        // The Sprotty client owns its session: let it re-request the model (sourceText is injected below).
        post({ type: 'glspReload' });
        return;
      }
      try {
        currentGGraph = await glspBridge.reloadModel(hostClientId, document.uri.fsPath, document.getText());
        currentMarkers = await glspBridge.requestMarkers(hostClientId);
        postModel();
      } catch (err) {
        console.warn('Could not refresh GLSP model from document:', err);
      }
    };

    if (!isDiagram) {
      try {
        const session = await glspBridge.openSession(
          hostClientId,
          document.uri.fsPath,
          (updatedGraph) => {
            currentGGraph = updatedGraph;
          },
          (updatedMarkers) => {
            currentMarkers = updatedMarkers;
          }
        );
        currentGGraph = session.graph;
        currentMarkers = session.markers;
        if (document.isDirty) {
          currentGGraph = await glspBridge.reloadModel(hostClientId, document.uri.fsPath, document.getText());
          currentMarkers = await glspBridge.requestMarkers(hostClientId);
        }
        serverText = document.getText();
      } catch (glspErr) {
        console.warn('GLSP server not reachable yet:', glspErr);
        void vscode.window.showWarningMessage(`RosTooling: GLSP model server unavailable (${glspErr}).`);
      }
    }

    await this.ensureCatalogues(fileName);

    webviewPanel.webview.html = getStudioHtml(
      toProject(),
      this.context.extensionUri,
      webviewPanel.webview,
      this.nodeIndex,
      this.typeIndex,
      fileName,
      isReadOnly,
      currentGGraph,
      currentMarkers
    );

    const isOperation = (action: GlspAction) => action.isOperation === true;

    /** Runs one model operation and lands its text change in the document. */
    const runOperation = async (clientId: string, action: GlspAction) => {
      if (isReadOnly) {
        vscode.window.showInformationMessage('Core catalogue models are read-only and cannot be modified.');
        return;
      }
      if (serverText !== null && document.getText() !== serverText) {
        await reloadFromDocument();
      }
      await glspBridge.sendAction(clientId, action);
      await applyServerEdits(clientId);
      if (clientId === hostClientId) {
        currentGGraph = await glspBridge.reloadModel(hostClientId, document.uri.fsPath, document.getText());
        currentMarkers = await glspBridge.requestMarkers(hostClientId);
        serverText = document.getText();
        postModel();
      } else {
        await glspBridge.sendAction(clientId, { kind: 'requestMarkers', requestId: '', elementsIDs: ['root'], reason: 'live' });
      }
    };

    const messageListener = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        // ---------------- Sprotty / GLSP client proxy (.rossystem) ----------------
        case 'glspInitServer': {
          post({ type: 'glspResponse', requestId: msg.requestId, result: await glspBridge.getInitializeResult() });
          break;
        }
        case 'glspInitSession': {
          const params = msg.params || {};
          diagramClientId = String(params.clientSessionId);
          await glspBridge.initializeProxySession(
            diagramClientId,
            String(params.diagramType || 'ros-system-diagram'),
            params.clientActionKinds || [],
            document.uri.fsPath,
            (action) => {
              if (action.kind === 'setModel' || action.kind === 'updateModel') {
                currentGGraph = (action.newRoot as GGraph) || currentGGraph;
                postModel();
              } else if (action.kind === 'setMarkers') {
                currentMarkers = (action.markers as GlspMarker[]) || [];
                postModel();
              }
              post({ type: 'glspServerAction', clientId: diagramClientId, action });
            }
          );
          serverText = document.getText();
          post({ type: 'glspResponse', requestId: msg.requestId, result: null });
          break;
        }
        case 'glspDisposeSession': {
          if (diagramClientId) await glspBridge.disposeSession(diagramClientId);
          diagramClientId = null;
          break;
        }
        case 'glspClientAction': {
          const action: GlspAction = msg.action;
          const clientId = String(msg.clientId || diagramClientId || hostClientId);
          if (!action?.kind) return;
          try {
            if (action.kind === 'requestModel') {
              // Always parse the live buffer (may be unsaved).
              const options = { ...((action.options as Record<string, unknown>) || {}) };
              options.sourceUri = GlspClientBridge.toFileUri(document.uri.fsPath);
              options.sourceText = document.getText();
              serverText = document.getText();
              await glspBridge.sendAction(clientId, { ...action, options });
            } else if (action.kind === 'saveModel') {
              await document.save();
            } else if (action.kind === 'glspUndo' || action.kind === 'undo') {
              await vscode.commands.executeCommand('undo');
            } else if (action.kind === 'glspRedo' || action.kind === 'redo') {
              await vscode.commands.executeCommand('redo');
            } else if (isOperation(action)) {
              await runOperation(clientId, action);
            } else {
              await glspBridge.sendAction(clientId, action);
            }
          } catch (err) {
            vscode.window.showErrorMessage(`GLSP action '${action.kind}' failed: ${err}`);
          }
          break;
        }

        // ---------------- Forms (.ros2 / .ros) ----------------
        case 'glspOperation':
        case 'glspAction': {
          const action: GlspAction = msg.action || msg.operation;
          if (!action || !action.kind) return;
          try {
            await runOperation(diagramClientId || hostClientId, { isOperation: true, ...action });
          } catch (err) {
            vscode.window.showErrorMessage(`GLSP operation '${action.kind}' failed: ${err}`);
          }
          break;
        }

        case 'undo':
        case 'redo': {
          await vscode.commands.executeCommand(msg.type);
          break;
        }

        case 'requestModelRefresh': {
          await reloadFromDocument();
          break;
        }

        case 'exportSvg': {
          try {
            const svgContent = String(msg.svg || '');
            if (!svgContent) return;
            const defaultSvgPath = document.uri.fsPath.replace(/\.[^.]+$/, '.svg');
            const targetUri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(defaultSvgPath),
              filters: { 'SVG Diagram (*.svg)': ['svg'] },
              saveLabel: 'Export Diagram SVG',
            });
            if (targetUri) {
              await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(svgContent));
              vscode.window.showInformationMessage(`Exported system diagram to ${path.basename(targetUri.fsPath)}`);
            }
          } catch (err) {
            vscode.window.showErrorMessage(`Failed to export SVG diagram: ${err}`);
          }
          break;
        }

        case 'openComponentRos2': {
          const compPath = await this.resolveComponentFilePath(msg.from, msg.pkg, msg.artifact, msg.label, fileName);
          if (compPath && fs.existsSync(compPath)) {
            await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(compPath), RosCustomEditorProvider.viewType);
          } else {
            vscode.window.showWarningMessage(`Could not locate component source file for '${msg.from || msg.label || 'component'}'.`);
          }
          break;
        }

        case 'openSubsystemRosSystem': {
          const subPath = await this.resolveSubsystemFilePath(msg.subRef, msg.fromFile, fileName);
          if (subPath && fs.existsSync(subPath)) {
            await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(subPath), RosCustomEditorProvider.viewType);
          } else {
            vscode.window.showWarningMessage(`Could not locate subsystem source file for '${msg.subRef || msg.fromFile || 'subsystem'}'.`);
          }
          break;
        }

        case 'generateCode': {
          if (document.isDirty) await document.save();
          await vscode.commands.executeCommand('rossystem.triggerCodeGeneration', document.uri);
          break;
        }

        case 'generateWrappers': {
          if (document.isDirty) await document.save();
          await vscode.commands.executeCommand('ros2.generateWrappers', document.uri, msg.selectedNodes);
          break;
        }

        case 'openCodeView': {
          await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
          break;
        }

        case 'pullCatalogue': {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'RosTooling: Updating component models from GitHub...',
              cancellable: false,
            },
            async (progress) => {
              if (!this.catalogueManager) return;
              const res = await this.catalogueManager.syncRepositories(true, (step) => progress.report({ message: step }));
              const updated = await this.refreshCatalogues(fileName);
              post({ type: 'updateCatalogue', nodeCatalog: updated.nodeIndex, typeCatalog: updated.typeIndex });
              if (res.success) {
                vscode.window.showInformationMessage('RosTooling: Catalogue updated with latest models.');
              } else if (res.errors.length > 0) {
                vscode.window.showWarningMessage(`RosTooling: Catalogue updated with some notices: ${res.errors.join(', ')}`);
              }
            }
          );
          break;
        }

        case 'browseCatalogueFolder': {
          const selected = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: true,
            openLabel: 'Add to RosTooling Catalogue',
          });
          if (selected && selected.length > 0 && this.catalogueManager) {
            for (const uri of selected) this.catalogueManager.addCustomFolder(uri.fsPath);
            const updated = await this.refreshCatalogues(fileName);
            post({ type: 'updateCatalogue', nodeCatalog: updated.nodeIndex, typeCatalog: updated.typeIndex });
            vscode.window.showInformationMessage(`Added ${selected.length} folder(s) to RosTooling Catalogue.`);
          }
          break;
        }

        case 'removeCatalogueFolder': {
          if (msg.folderId && this.catalogueManager) {
            this.catalogueManager.removeCustomFolder(msg.folderId);
            const updated = await this.refreshCatalogues(fileName);
            post({ type: 'updateCatalogue', nodeCatalog: updated.nodeIndex, typeCatalog: updated.typeIndex });
            vscode.window.showInformationMessage('Folder removed from RosTooling Catalogue.');
          }
          break;
        }
      }
    });

    // Text edits, VS Code undo/redo and external reloads re-sync the server with the buffer.
    // Changes that equal the text the server already has (our own WorkspaceEdits) are skipped.
    let debounce: NodeJS.Timeout | undefined;
    const changeDocSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== docKey) return;
      if (serverText !== null && e.document.getText() === serverText) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void reloadFromDocument(), 350);
    });

    // Companion models (.ros2/.ros/.rossystem) saved -> re-link and re-validate.
    const saveDocSubscription = vscode.workspace.onDidSaveTextDocument((savedDoc) => {
      const savedPath = savedDoc.fileName || savedDoc.uri.fsPath;
      if (!/\.(ros2|ros1|ros|rossystem)$/.test(savedPath)) return;
      this.invalidateCompanionCache();
      if (savedPath !== fileName) {
        void reloadFromDocument();
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      void glspBridge.disposeSession(hostClientId);
      if (diagramClientId) void glspBridge.disposeSession(diagramClientId);
      viewStateSubscription.dispose();
      messageListener.dispose();
      changeDocSubscription.dispose();
      saveDocSubscription.dispose();
      if (RosCustomEditorProvider.activeCustomDocument === document) {
        RosCustomEditorProvider.activeCustomDocument = undefined;
      }
    });
  }
}
