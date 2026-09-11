import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RosModelParser } from '../model/RosModelParser';
import { RosModelEmitter } from '../model/RosModelEmitter';
import { getStudioHtml } from '../webview/studioHtml';
import { RosProject, RosInterface, RosParameter, RosLayoutSchematic } from '../model/RosModelTypes';
import { RosLayoutManager } from '../model/RosLayoutManager';

interface DeclaredArtifact {
  filePath: string;
  pkg: string;
  name: string;
  node: string;
  ifaces: RosInterface[];
  params: RosParameter[];
}

export class RosCustomEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'rostooling.visualStudio';

  private nodeIndex: Record<string, unknown> | null = null;
  private typeIndex: Record<string, unknown> | null = null;
  private projectCache = new Map<string, RosProject>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadCatalogues();
  }

  private loadCatalogues() {
    try {
      const nodeIndexPath = path.join(this.context.extensionPath, 'assets', 'node_index.json');
      if (fs.existsSync(nodeIndexPath)) {
        this.nodeIndex = JSON.parse(fs.readFileSync(nodeIndexPath, 'utf-8'));
      }
    } catch (e) {
      console.warn('Failed to load node_index.json:', e);
    }

    try {
      const typeIndexPath = path.join(this.context.extensionPath, 'assets', 'type_index.json');
      if (fs.existsSync(typeIndexPath)) {
        this.typeIndex = JSON.parse(fs.readFileSync(typeIndexPath, 'utf-8'));
      }
    } catch (e) {
      console.warn('Failed to load type_index.json:', e);
    }
  }

  private readDocumentOrFile(filePath: string): string {
    const openDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.fsPath === filePath || d.fileName === filePath
    );
    if (openDoc) {
      return openDoc.getText();
    }
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return '';
  }

  private findModelFilesRecursive(dir: string, exts: string[], maxDepth = 4, curDepth = 0): string[] {
    let results: string[] = [];
    if (curDepth > maxDepth) return results;
    try {
      if (!fs.existsSync(dir)) return results;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules' || ent.name === 'build' || ent.name === 'install') {
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
    const roots: string[] = [];
    if (vscode.workspace.workspaceFolders) {
      for (const wf of vscode.workspace.workspaceFolders) {
        roots.push(wf.uri.fsPath);
      }
    }
    let curDir = path.dirname(docFilePath);
    for (let i = 0; i < 4; i++) {
      if (curDir && curDir !== '/' && !roots.includes(curDir)) {
        roots.push(curDir);
      }
      const parent = path.dirname(curDir);
      if (parent === curDir) break;
      curDir = parent;
    }
    return roots;
  }

  private loadCompanionArtifacts(docFilePath: string): {
    artifactMap: Map<string, DeclaredArtifact>;
    subsystemMap: Map<string, string>;
  } {
    const artifactMap = new Map<string, DeclaredArtifact>();
    const subsystemMap = new Map<string, string>();
    const roots = this.getWorkspaceRoots(docFilePath);
    const seenFiles = new Set<string>();

    for (const root of roots) {
      const files = this.findModelFilesRecursive(root, ['.ros2', '.ros1', '.ros', '.rossystem'], 5);
      for (const fullPath of files) {
        if (seenFiles.has(fullPath)) continue;
        seenFiles.add(fullPath);

        if (fullPath.endsWith('.rossystem')) {
          const baseName = path.basename(fullPath, '.rossystem');
          subsystemMap.set(baseName, fullPath);
        } else if (fullPath.endsWith('.ros2') || fullPath.endsWith('.ros1') || fullPath.endsWith('.ros')) {
          try {
            const content = this.readDocumentOrFile(fullPath);
            if (!content) continue;
            const parsedPkg = RosModelParser.parseRos2(content, fullPath);
            for (const pkg of Object.values(parsedPkg.packages)) {
              for (const art of pkg.artifacts || []) {
                const declared: DeclaredArtifact = {
                  filePath: fullPath,
                  pkg: pkg.name,
                  name: art.name,
                  node: art.node || art.name,
                  ifaces: art.ifaces || [],
                  params: art.params || [],
                };
                artifactMap.set(`${pkg.name}.${art.name}`, declared);
                artifactMap.set(`${pkg.name}.${art.node}`, declared);
                artifactMap.set(art.name, declared);
                if (art.node) artifactMap.set(art.node, declared);
              }
            }
          } catch (err) {
            console.warn(`Error reading companion file ${fullPath}:`, err);
          }
        }
      }
    }

    return { artifactMap, subsystemMap };
  }

  private resolveSystemInterfaces(project: RosProject, docFilePath: string) {
    const { artifactMap, subsystemMap } = this.loadCompanionArtifacts(docFilePath);
    const catNodes = (this.nodeIndex && (this.nodeIndex['nodes'] as Record<string, {
      from?: string;
      pkg?: string;
      interfaces?: { name?: string; label?: string; kind?: string; type?: string }[];
    }>)) || {};

    // 1. Resolve and load subsystems recursively into project.nodes
    for (const sub of project.subSystems || []) {
      const subFilePath = subsystemMap.get(sub.ref);
      if (subFilePath && fs.existsSync(subFilePath)) {
        try {
          const subContent = this.readDocumentOrFile(subFilePath);
          const subProject = RosModelParser.parseRosSystem(subContent, subFilePath);

          for (const subNode of subProject.nodes) {
            const existingNode = project.nodes.find(
              (n) => (n.subRef === sub.ref && n.label === subNode.label) || n.id === `n_${sub.ref}_${subNode.label}`
            );
            if (!existingNode) {
              subNode.id = `n_${sub.ref}_${subNode.label}`;
              subNode.subRef = sub.ref;
              subNode.backing = 'sub';

              const fromKey = subNode.from || '';
              const declaredArt =
                artifactMap.get(fromKey) ||
                artifactMap.get(subNode.artifact || '') ||
                artifactMap.get(subNode.label);

              if (declaredArt) {
                if (subNode.ifaces.length === 0) {
                  subNode.ifaces = (declaredArt.ifaces || []).map((f) => ({ ...f, exposed: true }));
                } else {
                  const artIfaces = new Map(declaredArt.ifaces.map((f) => [f.name, f]));
                  for (const iface of subNode.ifaces) {
                    const match = artIfaces.get(iface.name);
                    if (match) {
                      iface.kind = match.kind;
                      iface.type = match.type || iface.type;
                      iface.qos = match.qos || iface.qos;
                    }
                  }
                }
                if (subNode.params.length === 0) {
                  subNode.params = (declaredArt.params || []).map((p) => ({ ...p, exposed: true }));
                }
              }
              project.nodes.push(subNode);
            }
          }
        } catch (e) {
          console.warn(`Failed to resolve subsystem ${sub.ref}:`, e);
        }
      }
    }

    // 2. Resolve direct nodes
    for (const node of project.nodes) {
      const fromKey = node.from || '';
      const declaredArt =
        artifactMap.get(fromKey) ||
        artifactMap.get(node.artifact || '') ||
        artifactMap.get(node.label);

      if (declaredArt) {
        if (node.ifaces.length === 0) {
          node.ifaces = (declaredArt.ifaces || []).map((f) => ({ ...f, exposed: true }));
        } else {
          // Map interfaces by declared name
          const declaredIfacesByName = new Map<string, RosInterface>();
          for (const iface of declaredArt.ifaces) {
            declaredIfacesByName.set(iface.name, iface);
          }

          for (const iface of node.ifaces) {
            const targetName = iface.name;
            const match = declaredIfacesByName.get(targetName);
            if (match) {
              iface.kind = match.kind;
              iface.type = match.type || iface.type;
              iface.qos = match.qos || iface.qos;
            }
          }
        }

        // Map parameters
        if (node.params.length === 0) {
          node.params = (declaredArt.params || []).map((p) => ({ ...p, exposed: true }));
        } else {
          const declaredParamsByName = new Map<string, RosParameter>();
          for (const param of declaredArt.params) {
            declaredParamsByName.set(param.name, param);
          }
          for (const param of node.params) {
            const match = declaredParamsByName.get(param.name);
            if (match) {
              param.ptype = match.ptype || param.ptype;
              if (param.value == null) param.value = match.value;
            }
          }
        }
      } else if (catNodes[fromKey]) {
        const catEntry = catNodes[fromKey];
        const normalizedIfaces = this.normalizeInterfaces(catEntry.interfaces);
        if (node.ifaces.length === 0) {
          node.ifaces = normalizedIfaces.map((f) => ({
            id: `i_${node.label}_${f.name || f.label}`,
            name: f.name || f.label || '',
            label: f.label || f.name || '',
            kind: (f.kind as RosInterface['kind']) || 'pub',
            type: f.type || '',
            exposed: true,
          }));
        } else {
          const catIfacesByName = new Map<string, { kind?: string; type?: string }>();
          for (const f of normalizedIfaces) {
            const nm = f.name || f.label || '';
            if (nm) catIfacesByName.set(nm, f);
          }
          for (const iface of node.ifaces) {
            const match = catIfacesByName.get(iface.name);
            if (match && match.kind) {
              iface.kind = match.kind as RosInterface['kind'];
              iface.type = match.type || iface.type;
            }
          }
        }
      }
    }
  }

  public normalizeInterfaces(rawIfaces: unknown): { name: string; label: string; kind: string; type: string }[] {
    return RosLayoutManager.normalizeInterfaces(rawIfaces);
  }

  private async syncCompanionRos2Models(project: RosProject, docFilePath: string) {
    if (!docFilePath.endsWith('.rossystem')) return;

    const { artifactMap } = this.loadCompanionArtifacts(docFilePath);
    const filesToUpdate = new Map<string, RosProject>();

    for (const node of project.nodes) {
      const fromKey = node.from || '';
      const declared = artifactMap.get(fromKey) || artifactMap.get(node.artifact || '') || artifactMap.get(node.label);
      if (!declared || !declared.filePath) continue;

      let ros2Project = filesToUpdate.get(declared.filePath);
      if (!ros2Project) {
        try {
          const content = this.readDocumentOrFile(declared.filePath);
          ros2Project = RosModelParser.parseRos2(content, path.basename(declared.filePath));
          filesToUpdate.set(declared.filePath, ros2Project);
        } catch (e) {
          console.warn(`Failed to read companion .ros2 file ${declared.filePath}:`, e);
          continue;
        }
      }

      // Update the artifact interfaces and parameters in ros2Project
      for (const pkg of Object.values(ros2Project.packages)) {
        for (const art of pkg.artifacts || []) {
          if (art.name === declared.name || art.node === declared.node) {
            // Sync interfaces
            for (const iface of node.ifaces) {
              const targetName = iface.name || iface.label;
              if (!targetName) continue;
              const existing = (art.ifaces || []).find((f) => f.name === targetName || f.label === targetName);
              if (existing) {
                existing.type = iface.type;
                existing.kind = iface.kind;
                if (iface.qos) existing.qos = iface.qos;
              } else {
                art.ifaces = art.ifaces || [];
                art.ifaces.push({
                  id: `i_${art.name}_${targetName}`,
                  name: targetName,
                  label: targetName,
                  kind: iface.kind,
                  type: iface.type,
                  qos: iface.qos,
                  exposed: true,
                });
              }
            }

            // Sync parameters
            for (const param of node.params || []) {
              const targetName = param.name || param.label;
              if (!targetName) continue;
              const existing = (art.params || []).find((p) => p.name === targetName || p.label === targetName);
              const val = param.value !== undefined ? param.value : (param.sysValue !== undefined ? param.sysValue : '');
              if (existing) {
                if (param.ptype) existing.ptype = param.ptype;
                existing.value = val;
              } else {
                art.params = art.params || [];
                art.params.push({
                  id: `p_${art.name}_${targetName}`,
                  name: targetName,
                  label: targetName,
                  ptype: param.ptype || 'String',
                  value: val,
                  exposed: true,
                });
              }
            }
          }
        }
      }
    }

    // Apply edits for all updated .ros2 files both in VS Code workspace and persist to disk
    for (const [filePath, ros2Proj] of filesToUpdate.entries()) {
      try {
        const newRos2Content = RosModelEmitter.emitRos2(ros2Proj);
        const fileUri = vscode.Uri.file(filePath);
        const openDoc = vscode.workspace.textDocuments.find(
          (d) => d.uri.fsPath === filePath || d.fileName === filePath
        );

        if (openDoc) {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            fileUri,
            new vscode.Range(0, 0, openDoc.lineCount + 5, 0),
            newRos2Content
          );
          await vscode.workspace.applyEdit(edit);
        }
        // Direct disk write ensures disk state is always identical to in-memory edits
        fs.writeFileSync(filePath, newRos2Content, 'utf-8');
      } catch (err) {
        console.warn(`Failed to apply sync edit to ${filePath}:`, err);
      }
    }
  }

  private assignGridPositions(project: RosProject) {
    const unpositioned = project.nodes.filter((n) => n.x == null || n.y == null);
    if (unpositioned.length > 0) {
      const cols = Math.max(1, Math.ceil(Math.sqrt(unpositioned.length)));
      unpositioned.forEach((n, idx) => {
        const c = idx % cols;
        const r = Math.floor(idx / cols);
        n.x = 80 + c * 300;
        n.y = 80 + r * 260;
      });
    }

    let subIdx = 0;
    for (const sub of project.subSystems || []) {
      if (!project.view) project.view = {};
      if (!project.view.subPos) project.view.subPos = {};
      if (!project.view.subPos[sub.ref]) {
        project.view.subPos[sub.ref] = { x: 80 + subIdx * 320, y: 380 };
        subIdx++;
      }
    }
  }

  private restoreCachedLayout(target: RosProject, source: RosProject) {
    // Preserve node coordinates & dimensions
    const nodeDataMap = new Map<string, { x?: number; y?: number; w?: number; h?: number }>();
    for (const n of source.nodes) {
      nodeDataMap.set(n.id, { x: n.x, y: n.y, w: n.w, h: n.h });
      nodeDataMap.set(n.label, { x: n.x, y: n.y, w: n.w, h: n.h });
    }

    for (const n of target.nodes) {
      const data = nodeDataMap.get(n.id) || nodeDataMap.get(n.label);
      if (data) {
        if (data.x != null && data.y != null) {
          n.x = data.x;
          n.y = data.y;
        }
        if (data.w != null) n.w = data.w;
        if (data.h != null) n.h = data.h;
      }
    }

    // Preserve subsystem dimensions
    const subDataMap = new Map<string, { x?: number; y?: number; w?: number; h?: number }>();
    for (const s of source.subSystems) {
      subDataMap.set(s.ref, { x: s.x, y: s.y, w: s.w, h: s.h });
    }
    for (const s of target.subSystems) {
      const data = subDataMap.get(s.ref);
      if (data) {
        if (data.x != null && data.y != null) {
          s.x = data.x;
          s.y = data.y;
        }
        if (data.w != null) s.w = data.w;
        if (data.h != null) s.h = data.h;
      }
    }

    // Preserve connection middle segment custom offsets
    const connMap = new Map<string, number>();
    for (const c of source.connections) {
      if (c.midX != null) {
        const key = `${c.from.n}::${c.from.i}->${c.to.n}::${c.to.i}`;
        connMap.set(c.id, c.midX);
        connMap.set(key, c.midX);
      }
    }
    for (const c of target.connections) {
      const key = `${c.from.n}::${c.from.i}->${c.to.n}::${c.to.i}`;
      const savedMidX = connMap.get(c.id) || connMap.get(key);
      if (savedMidX != null) {
        c.midX = savedMidX;
      }
    }

    // Preserve view states
    if (source.view) {
      const mergedSubStates = {
        ...(target.view?.subStates || {}),
        ...(source.view.subStates || {}),
      };
      const mergedSubPos = {
        ...(target.view?.subPos || {}),
        ...(source.view.subPos || {}),
      };
      const mergedNodeSize = {
        ...(target.view?.nodeSize || {}),
        ...(source.view.nodeSize || {}),
      };
      const mergedSubSize = {
        ...(target.view?.subSize || {}),
        ...(source.view.subSize || {}),
      };
      const mergedConnMidX = {
        ...(target.view?.connMidX || {}),
        ...(source.view.connMidX || {}),
      };

      target.view = {
        ...target.view,
        ...source.view,
        subStates: mergedSubStates,
        subPos: mergedSubPos,
        nodeSize: mergedNodeSize,
        subSize: mergedSubSize,
        connMidX: mergedConnMidX,
      };

      for (const sub of target.subSystems || []) {
        if (mergedSubStates[sub.ref]) {
          sub.state = mergedSubStates[sub.ref];
        }
      }
    }
  }

  public getLayoutFilePath(docFilePath: string): string {
    const roots = this.getWorkspaceRoots(docFilePath);
    const rootDir = roots.length > 0 ? roots[0] : path.dirname(docFilePath);
    return RosLayoutManager.getLayoutFilePath(docFilePath, rootDir);
  }

  public loadLayoutSchematic(docFilePath: string): RosLayoutSchematic | null {
    const roots = this.getWorkspaceRoots(docFilePath);
    const rootDir = roots.length > 0 ? roots[0] : path.dirname(docFilePath);
    return RosLayoutManager.loadLayoutSchematic(docFilePath, rootDir);
  }

  public applyLayoutSchematic(project: RosProject, schematic: RosLayoutSchematic): void {
    RosLayoutManager.applyLayoutSchematic(project, schematic);
  }

  public async saveLayoutSchematic(docFilePath: string, project: RosProject): Promise<void> {
    const roots = this.getWorkspaceRoots(docFilePath);
    const rootDir = roots.length > 0 ? roots[0] : path.dirname(docFilePath);
    await RosLayoutManager.saveLayoutSchematic(docFilePath, project, rootDir);
  }

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

    const docKey = document.uri.toString();
    const initialText = document.getText();
    const isRosSystem = document.fileName.endsWith('.rossystem');
    const isRos = document.fileName.endsWith('.ros');
    const cached = this.projectCache.get(docKey);
    let project: RosProject;

    try {
      project = RosModelParser.parse(initialText, document.fileName);
      project.isRosSystem = isRosSystem;
      project.isRos = isRos;
      if (!isRos) {
        this.resolveSystemInterfaces(project, document.fileName);
      }
      this.assignGridPositions(project);
      const schematic = this.loadLayoutSchematic(document.fileName);
      if (schematic) {
        this.applyLayoutSchematic(project, schematic);
      } else if (cached) {
        this.restoreCachedLayout(project, cached);
      }
      this.projectCache.set(docKey, project);
    } catch (e) {
      console.error('Failed to parse RosTooling model:', e);
      project = {
        formatVersion: 4,
        isRosSystem,
        isRos,
        system: { name: path.basename(document.fileName, path.extname(document.fileName)) },
        subSystems: [],
        nodes: [],
        connections: [],
        packages: {},
        types: {},
      };
      this.assignGridPositions(project);
      const schematic = this.loadLayoutSchematic(document.fileName);
      if (schematic) {
        this.applyLayoutSchematic(project, schematic);
      } else if (cached) {
        this.restoreCachedLayout(project, cached);
      }
      this.projectCache.set(docKey, project);
    }

    webviewPanel.webview.html = getStudioHtml(
      project,
      this.context.extensionUri,
      webviewPanel.webview,
      this.nodeIndex,
      this.typeIndex
    );

    let isInternalUpdate = false;
    let lastInternalUpdateTime = 0;

    // Handle messages from Webview
    const messageListener = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'applyEdit': {
          try {
            isInternalUpdate = true;
            lastInternalUpdateTime = Date.now();
            const updatedProject: RosProject = msg.project;
            updatedProject.isRosSystem = isRosSystem;
            updatedProject.isRos = isRos;
            this.projectCache.set(docKey, updatedProject);
            const newContent = RosModelEmitter.emit(updatedProject, document.fileName);

            const edit = new vscode.WorkspaceEdit();
            edit.replace(
              document.uri,
              new vscode.Range(0, 0, document.lineCount + 5, 0),
              newContent
            );
            await vscode.workspace.applyEdit(edit);

            // Sync type changes back to backing companion models (.ros2 / .ros1 / .ros)
            await this.syncCompanionRos2Models(updatedProject, document.fileName);

            // Save layout schematic
            await this.saveLayoutSchematic(document.fileName, updatedProject);
          } catch (err) {
            vscode.window.showErrorMessage(`Failed to apply model changes: ${err}`);
          } finally {
            isInternalUpdate = false;
          }
          break;
        }

        case 'saveLayout': {
          try {
            const updatedProject: RosProject = msg.project;
            this.projectCache.set(docKey, updatedProject);
            await this.saveLayoutSchematic(document.fileName, updatedProject);
          } catch (err) {
            console.warn('Failed to save layout schematic:', err);
          }
          break;
        }

        case 'generateCode': {
          await vscode.commands.executeCommand('rossystem.triggerCodeGeneration');
          break;
        }

        case 'openCodeView': {
          await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
          break;
        }
      }
    });

    // Sync external text changes (both on active document AND companion .ros2/.ros1/.ros files) into Webview
    const changeDocSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (isInternalUpdate || Date.now() - lastInternalUpdateTime < 600) {
        return;
      }

      const changedPath = e.document.fileName || e.document.uri.fsPath;
      const isTargetDoc = e.document.uri.toString() === docKey;
      const isCompanionDoc =
        (changedPath.endsWith('.ros2') ||
          changedPath.endsWith('.ros1') ||
          changedPath.endsWith('.ros')) &&
        path.dirname(changedPath) === path.dirname(document.fileName);

      if (isTargetDoc || isCompanionDoc) {
        try {
          const freshProject = RosModelParser.parse(document.getText(), document.fileName);
          freshProject.isRosSystem = isRosSystem;
          freshProject.isRos = isRos;
          if (!isRos) {
            this.resolveSystemInterfaces(freshProject, document.fileName);
          }
          const currentCached = this.projectCache.get(docKey);

          if (currentCached) {
            this.restoreCachedLayout(freshProject, currentCached);
          }

          this.assignGridPositions(freshProject);
          this.projectCache.set(docKey, freshProject);

          void webviewPanel.webview.postMessage({
            type: 'updateModel',
            project: freshProject,
          });
        } catch (err) {
          console.warn('Could not sync external text update to webview:', err);
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      messageListener.dispose();
      changeDocSubscription.dispose();
      this.projectCache.delete(docKey);
    });
  }
}
