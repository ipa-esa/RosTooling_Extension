import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { RosModelParser } from '../model/RosModelParser';
import { RosModelEmitter } from '../model/RosModelEmitter';
import { getStudioHtml } from '../webview/studioHtml';
import { RosProject, RosNode, RosInterface, RosParameter, RosLayoutSchematic, RosModelDiagnostic } from '../model/RosModelTypes';
import { RosLayoutManager } from '../model/RosLayoutManager';
import { RosCatalogueManager } from '../model/RosCatalogueManager';
import { SRC_SIDE } from '../model/ConnectionValidator';

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
  public static activeCustomDocument?: vscode.TextDocument;

  private catalogueManager: RosCatalogueManager | null = null;
  private nodeIndex: Record<string, unknown> | null = null;
  private typeIndex: Record<string, unknown> | null = null;
  private projectCache = new Map<string, RosProject>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadCatalogues();
  }

  private getSearchRoots(docFilePath?: string): string[] {
    const roots = new Set<string>();
    for (const ws of vscode.workspace.workspaceFolders || []) {
      roots.add(ws.uri.fsPath);
      const parent = path.dirname(ws.uri.fsPath);
      const sibModels = path.join(parent, 'RosModelsCatalog');
      if (fs.existsSync(sibModels)) roots.add(sibModels);
      const sibCommon = path.join(parent, 'RosCommonObjects');
      if (fs.existsSync(sibCommon)) roots.add(sibCommon);
    }
    const known1 = '/home/adm-esa/coresense-ws/src/RosModelsCatalog';
    if (fs.existsSync(known1)) roots.add(known1);
    const known2 = '/home/adm-esa/coresense-ws/src/RosCommonObjects';
    if (fs.existsSync(known2)) roots.add(known2);

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
        const sibModels = path.join(curDir, 'RosModelsCatalog');
        if (fs.existsSync(sibModels)) roots.add(sibModels);
        const sibCommon = path.join(curDir, 'RosCommonObjects');
        if (fs.existsSync(sibCommon)) roots.add(sibCommon);
        const parent = path.dirname(curDir);
        if (parent === curDir) break;
        curDir = parent;
      }
      if (foundWsRoot) {
        roots.add(foundWsRoot);
      }
      const dirOfFile = path.dirname(targetDoc);
      if (fs.existsSync(dirOfFile)) roots.add(dirOfFile);
      const parentOfFile = path.dirname(dirOfFile);
      if (fs.existsSync(parentOfFile) && parentOfFile !== '/') roots.add(parentOfFile);
    }
    return Array.from(roots);
  }

  private loadCatalogues(docFilePath?: string) {
    try {
      const storageDir = this.context.globalStorageUri
        ? path.join(this.context.globalStorageUri.fsPath, 'catalogue_repos')
        : path.join(os.homedir(), '.rostooling', 'catalogue_repos');
      this.catalogueManager = RosCatalogueManager.getInstance(storageDir);

      const catIndex = this.catalogueManager.buildCatalogueIndex(this.getSearchRoots(docFilePath));
      const hasNodes = Object.keys(catIndex.nodes).length > 0;
      const hasTypes = Object.keys(catIndex.types).length > 0;

      if (hasNodes || hasTypes) {
        this.nodeIndex = {
          nodes: catIndex.nodes,
          _systems: catIndex.systems,
          sources: catIndex.sources,
          lastSync: catIndex.lastSync,
        };
        this.typeIndex = {
          types: catIndex.types,
          sources: catIndex.sources,
        };
      } else {
        const nodeIndexPath = path.join(this.context.extensionPath, 'assets', 'node_index.json');
        if (fs.existsSync(nodeIndexPath)) {
          this.nodeIndex = JSON.parse(fs.readFileSync(nodeIndexPath, 'utf-8'));
        }
        const typeIndexPath = path.join(this.context.extensionPath, 'assets', 'type_index.json');
        if (fs.existsSync(typeIndexPath)) {
          this.typeIndex = JSON.parse(fs.readFileSync(typeIndexPath, 'utf-8'));
        }
      }

      // Check 24-hour sync in background (skip in test mode to avoid uncoordinated git processes)
      const isTestEnv = this.context.extensionMode === vscode.ExtensionMode.Test || process.env.VSCODE_TEST_RUN === '1';
      if (!isTestEnv) {
        this.catalogueManager.syncRepositories(false).then((res) => {
          if (res.updated.length > 0) {
            this.refreshCatalogues();
          }
        });
      }
    } catch (e) {
      console.warn('Failed to load dynamic catalogue:', e);
    }
  }

  public refreshCatalogues(docFilePath?: string): { nodeIndex: Record<string, unknown>; typeIndex: Record<string, unknown> } {
    if (!this.catalogueManager) {
      this.loadCatalogues(docFilePath);
    } else {
      this.catalogueManager.invalidateCache();
      const catIndex = this.catalogueManager.buildCatalogueIndex(this.getSearchRoots(docFilePath));
      this.nodeIndex = {
        nodes: catIndex.nodes,
        _systems: catIndex.systems,
        sources: catIndex.sources,
        lastSync: catIndex.lastSync,
      };
      this.typeIndex = {
        types: catIndex.types,
        sources: catIndex.sources,
      };
    }
    return { nodeIndex: this.nodeIndex || {}, typeIndex: this.typeIndex || {} };
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

  public resolveComponentFilePath(
    from?: string,
    pkg?: string,
    artifact?: string,
    label?: string,
    docFilePath?: string
  ): string | undefined {
    const { artifactMap } = this.loadCompanionArtifacts(docFilePath || '');
    const keys = [
      from,
      (pkg && artifact) ? `${pkg}.${artifact}` : undefined,
      (pkg && label) ? `${pkg}.${label}` : undefined,
      artifact,
      label
    ].filter(Boolean) as string[];

    for (const k of keys) {
      const art = artifactMap.get(k);
      if (art && art.filePath && fs.existsSync(art.filePath)) {
        return art.filePath;
      }
    }
    return undefined;
  }

  public resolveSubsystemFilePath(
    subRef?: string,
    fromFile?: string,
    docFilePath?: string
  ): string | undefined {
    if (!subRef && !fromFile) return undefined;
    const { subsystemMap } = this.loadCompanionArtifacts(docFilePath || '');
    const keys = [
      subRef,
      fromFile,
      fromFile ? path.basename(fromFile, '.rossystem') : undefined,
      fromFile ? path.basename(fromFile) : undefined,
      subRef ? path.basename(subRef, '.rossystem') : undefined,
      subRef ? subRef.replace(/_\d+$/, '') : undefined,
    ].filter(Boolean) as string[];

    for (const k of keys) {
      const match = subsystemMap.get(k);
      if (match && fs.existsSync(match)) {
        return match;
      }
    }

    // Check catalogue index systems
    const catSystems = (this.nodeIndex && (this.nodeIndex['_systems'] as {
      system: string;
      file?: string;
      fullPath?: string;
    }[])) || [];

    for (const sys of catSystems) {
      if (
        (subRef && (sys.system === subRef || sys.system === subRef.replace(/_\d+$/, ''))) ||
        (fromFile && (sys.file === fromFile || (sys.file && path.basename(sys.file) === path.basename(fromFile))))
      ) {
        if (sys.fullPath && fs.existsSync(sys.fullPath)) {
          return sys.fullPath;
        }
      }
    }

    // Check relative to docFilePath
    if (docFilePath && fromFile) {
      const resolved = path.resolve(path.dirname(docFilePath), fromFile);
      if (fs.existsSync(resolved)) return resolved;
    }
    if (docFilePath && subRef) {
      const resolved = path.resolve(
        path.dirname(docFilePath),
        subRef.endsWith('.rossystem') ? subRef : `${subRef}.rossystem`
      );
      if (fs.existsSync(resolved)) return resolved;
      const base = subRef.replace(/_\d+$/, '');
      const resolvedBase = path.resolve(
        path.dirname(docFilePath),
        base.endsWith('.rossystem') ? base : `${base}.rossystem`
      );
      if (fs.existsSync(resolvedBase)) return resolvedBase;
    }

    return undefined;
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
    for (let i = 0; i < 8; i++) {
      if (curDir && curDir !== '/' && !roots.includes(curDir)) {
        roots.push(curDir);
      }
      const sibModels = path.join(curDir, 'RosModelsCatalog');
      if (fs.existsSync(sibModels) && !roots.includes(sibModels)) {
        roots.push(sibModels);
      }
      const sibCommon = path.join(curDir, 'RosCommonObjects');
      if (fs.existsSync(sibCommon) && !roots.includes(sibCommon)) {
        roots.push(sibCommon);
      }
      const parent = path.dirname(curDir);
      if (parent === curDir) break;
      curDir = parent;
    }
    for (const sr of this.getSearchRoots()) {
      if (sr && !roots.includes(sr)) {
        roots.push(sr);
      }
    }
    if (this.catalogueManager) {
      const storageDir = this.catalogueManager.getStorageDir();
      if (fs.existsSync(storageDir) && !roots.includes(storageDir)) {
        roots.push(storageDir);
      }
      for (const cf of this.catalogueManager.getCustomFolders()) {
        if (cf.path && fs.existsSync(cf.path) && !roots.includes(cf.path)) {
          roots.push(cf.path);
        }
      }
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
          subsystemMap.set(path.basename(fullPath), fullPath);
          subsystemMap.set(fullPath, fullPath);
          const rel = path.relative(root, fullPath);
          subsystemMap.set(rel, fullPath);
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

  private enrichNodeWithDefinitions(
    node: RosNode,
    declaredArt?: DeclaredArtifact,
    catEntry?: { interfaces?: unknown; parameters?: Record<string, unknown> }
  ): void {
    if (declaredArt) {
      if (declaredArt.name) {
        node.artifact = declaredArt.name;
      }
      const declaredIfacesByName = new Map<string, RosInterface>();
      for (const iface of declaredArt.ifaces || []) {
        declaredIfacesByName.set(iface.name, iface);
        if (iface.label) declaredIfacesByName.set(iface.label, iface);
      }

      const existingIfacesByName = new Set<string>();
      for (const iface of node.ifaces || []) {
        const match = declaredIfacesByName.get(iface.name) || (iface.label ? declaredIfacesByName.get(iface.label) : undefined);
        if (match) {
          iface.kind = match.kind;
          iface.type = match.type || iface.type;
          iface.qos = match.qos || iface.qos;
        }
        if (!iface.artifact && declaredArt.name) {
          iface.artifact = declaredArt.name;
        }
        if (iface.name) existingIfacesByName.add(iface.name);
        if (iface.label) existingIfacesByName.add(iface.label);
      }

      // Append newly declared interfaces not yet in node.ifaces
      for (const decF of declaredArt.ifaces || []) {
        if (!existingIfacesByName.has(decF.name) && (!decF.label || !existingIfacesByName.has(decF.label))) {
          node.ifaces.push({
            ...decF,
            id: `i_${node.id || node.label}_${decF.name || decF.label}`,
            exposed: true,
            artifact: declaredArt.name,
          });
          existingIfacesByName.add(decF.name);
          if (decF.label) existingIfacesByName.add(decF.label);
        }
      }

      // Merge parameters
      const existingParamsByName = new Map<string, RosParameter>();
      for (const p of node.params || []) {
        if (!p.artifact && declaredArt.name) {
          p.artifact = declaredArt.name;
        }
        existingParamsByName.set(p.name, p);
        if (p.label) existingParamsByName.set(p.label, p);
      }

      const mergedParams: RosParameter[] = [];
      for (const decP of declaredArt.params || []) {
        const existing = existingParamsByName.get(decP.name) || (decP.label ? existingParamsByName.get(decP.label) : undefined);
        if (existing) {
          mergedParams.push({
            ...decP,
            id: existing.id || `p_${node.id || node.label}_${decP.name}`,
            label: existing.label || decP.name,
            ptype: decP.ptype || existing.ptype || 'String',
            value: decP.value,
            sysValue: existing.sysValue,
            exposed: existing.exposed !== undefined ? existing.exposed : true,
            artifact: existing.artifact || declaredArt.name,
          });
          existingParamsByName.delete(decP.name);
          if (decP.label) existingParamsByName.delete(decP.label);
        } else {
          mergedParams.push({
            ...decP,
            id: `p_${node.id || node.label}_${decP.name}`,
            label: decP.name,
            ptype: decP.ptype || 'String',
            value: decP.value,
            sysValue: undefined,
            exposed: false,
            artifact: declaredArt.name,
          });
        }
      }
      for (const remaining of existingParamsByName.values()) {
        mergedParams.push(remaining);
      }
      node.params = mergedParams;
    } else if (catEntry) {
      const normalized = this.normalizeInterfaces(catEntry.interfaces);
      const catIfacesByName = new Map<string, { kind?: string; type?: string }>();
      for (const f of normalized) {
        const nm = f.name || f.label || '';
        if (nm) catIfacesByName.set(nm, f);
      }

      const existingIfacesByName = new Set<string>();
      for (const iface of node.ifaces || []) {
        const match = catIfacesByName.get(iface.name) || (iface.label ? catIfacesByName.get(iface.label) : undefined);
        if (match && match.kind) {
          iface.kind = match.kind as RosInterface['kind'];
          iface.type = match.type || iface.type;
        }
        if (iface.name) existingIfacesByName.add(iface.name);
        if (iface.label) existingIfacesByName.add(iface.label);
      }

      for (const f of normalized) {
        const nm = f.name || f.label || '';
        if (nm && !existingIfacesByName.has(nm) && (!f.label || !existingIfacesByName.has(f.label))) {
          node.ifaces.push({
            id: `i_${node.id || node.label}_${nm}`,
            name: nm,
            label: f.label || nm,
            kind: (f.kind as RosInterface['kind']) || 'pub',
            type: f.type || '',
            exposed: true,
          });
          existingIfacesByName.add(nm);
          if (f.label) existingIfacesByName.add(f.label);
        }
      }

      if (catEntry.parameters) {
        const existingParamsByName = new Map<string, RosParameter>();
        for (const p of node.params || []) {
          existingParamsByName.set(p.name, p);
          if (p.label) existingParamsByName.set(p.label, p);
        }
        const mergedParams: RosParameter[] = [];
        for (const [pName, pDef] of Object.entries(catEntry.parameters)) {
          const ptype = typeof pDef === 'object' && pDef !== null && 'type' in pDef ? ((pDef as { type?: string }).type as RosParameter['ptype']) : 'String';
          const val = typeof pDef === 'object' && pDef !== null && 'value' in pDef ? ((pDef as { value?: string | number | boolean }).value) : undefined;
          const existing = existingParamsByName.get(pName);
          if (existing) {
            mergedParams.push({
              id: existing.id || `p_${node.id || node.label}_${pName}`,
              name: pName,
              label: existing.label || pName,
              ptype: ptype || existing.ptype || 'String',
              value: val,
              sysValue: existing.sysValue,
              exposed: existing.exposed !== undefined ? existing.exposed : true,
            });
            existingParamsByName.delete(pName);
            if (existing.label) existingParamsByName.delete(existing.label);
          } else {
            mergedParams.push({
              id: `p_${node.id || node.label}_${pName}`,
              name: pName,
              label: pName,
              ptype: ptype || 'String',
              value: val,
              sysValue: undefined,
              exposed: false,
            });
          }
        }
        for (const remaining of existingParamsByName.values()) {
          mergedParams.push(remaining);
        }
        node.params = mergedParams;
      }
    }
  }

  private resolveSystemInterfaces(project: RosProject, docFilePath: string) {
    const { artifactMap, subsystemMap } = this.loadCompanionArtifacts(docFilePath);
    const catNodes = (this.nodeIndex && (this.nodeIndex['nodes'] as Record<string, {
      from?: string;
      pkg?: string;
      interfaces?: unknown;
      parameters?: Record<string, unknown>;
    }>)) || {};

    // 1. Resolve and load subsystems recursively into project.nodes
    for (const sub of project.subSystems || []) {
      const subFilePath =
        this.resolveSubsystemFilePath(sub.ref, sub.fromFile, docFilePath) ||
        subsystemMap.get(sub.ref) ||
        (sub.fromFile ? subsystemMap.get(sub.fromFile) : undefined) ||
        (sub.fromFile ? subsystemMap.get(path.basename(sub.fromFile, '.rossystem')) : undefined) ||
        (sub.fromFile ? subsystemMap.get(path.basename(sub.fromFile)) : undefined) ||
        subsystemMap.get(path.basename(sub.ref, '.rossystem')) ||
        subsystemMap.get(sub.ref.replace(/_\d+$/, ''));

      let loadedNodes = 0;
      if (subFilePath && fs.existsSync(subFilePath)) {
        try {
          const subContent = this.readDocumentOrFile(subFilePath);
          const subProject = RosModelParser.parseRosSystem(subContent, subFilePath);

          for (const subNode of subProject.nodes) {
            const existingNode = project.nodes.find(
              (n) => (n.subRef === sub.ref && n.label === subNode.label) || n.id === `n_${sub.ref}_${subNode.label}`
            );
            const targetNode = existingNode || subNode;
            if (!existingNode) {
              subNode.id = `n_${sub.ref}_${subNode.label}`;
              subNode.subRef = sub.ref;
              subNode.backing = 'sub';
            } else {
              existingNode.subRef = sub.ref;
              existingNode.backing = 'sub';
              if (!existingNode.id.startsWith(`n_${sub.ref}_`)) {
                existingNode.id = `n_${sub.ref}_${subNode.label}`;
              }
            }

            const fromKey = targetNode.from || '';
            const declaredArt =
              artifactMap.get(fromKey) ||
              artifactMap.get(targetNode.artifact || '') ||
              artifactMap.get(targetNode.label);
            const catEntry = catNodes[fromKey] || catNodes[targetNode.label] || catNodes[targetNode.artifact || ''];

            this.enrichNodeWithDefinitions(targetNode, declaredArt, catEntry);

            if (!existingNode) {
              project.nodes.push(targetNode);
              loadedNodes++;
            }
          }
        } catch (e) {
          console.warn(`Failed to resolve subsystem ${sub.ref}:`, e);
        }
      }

      // Fallback: If no member nodes loaded from file, resolve from catalogue index _systems
      if (loadedNodes === 0) {
        const catSystems = (this.nodeIndex && (this.nodeIndex['_systems'] as {
          system: string;
          file?: string;
          nodes?: Record<string, { from?: string; interfaces?: Record<string, string> }>;
        }[])) || [];
        const baseRef = sub.ref.replace(/_\d+$/, '');
        const matchSys = catSystems.find((s) =>
          s.system === sub.ref ||
          s.system === baseRef ||
          (sub.fromFile && (s.file === sub.fromFile || path.basename(s.file || '') === path.basename(sub.fromFile)))
        );

        if (matchSys && matchSys.nodes) {
          for (const [nKey, nDef] of Object.entries(matchSys.nodes)) {
            let targetNode = project.nodes.find(
              (n) => (n.subRef === sub.ref && n.label === nKey) || n.id === `n_${sub.ref}_${nKey}`
            );
            if (!targetNode) {
              const fromKey = nDef.from || nKey;
              targetNode = {
                id: `n_${sub.ref}_${nKey}`,
                label: nKey,
                from: fromKey,
                subRef: sub.ref,
                backing: 'sub',
                ifaces: [],
                params: [],
              };
              if (nDef.interfaces) {
                for (const [iName, iKind] of Object.entries(nDef.interfaces)) {
                  targetNode.ifaces.push({
                    id: `i_${sub.ref}_${nKey}_${iName}`,
                    name: iName,
                    label: iName,
                    kind: (iKind as RosInterface['kind']) || 'pub',
                    type: '',
                    exposed: true,
                  });
                }
              }
              project.nodes.push(targetNode);
              loadedNodes++;
            }
            const fromKey = targetNode.from || nDef.from || nKey;
            const declaredArt = artifactMap.get(fromKey) || artifactMap.get(nKey);
            const catEntry = catNodes[fromKey] || catNodes[nKey];
            this.enrichNodeWithDefinitions(targetNode, declaredArt, catEntry);
          }
        }
      }
    }

    // 2. Resolve direct nodes
    for (const node of project.nodes) {
      if (node.subRef || node.backing === 'sub') {
        continue;
      }
      const fromKey = node.from || '';
      const declaredArt =
        artifactMap.get(fromKey) ||
        artifactMap.get(node.artifact || '') ||
        artifactMap.get(node.label);
      const catEntry = catNodes[fromKey] || catNodes[node.label] || catNodes[node.artifact || ''];

      this.enrichNodeWithDefinitions(node, declaredArt, catEntry);
    }

    // 3. Resolve connection endpoints across all nodes (including subsystem nodes)
    for (const conn of project.connections || []) {
      const fromLookup = conn.rawFrom || (!conn.from.n ? conn.from.i : undefined);
      const toLookup = conn.rawTo || (!conn.to.n ? conn.to.i : undefined);

      let fromNode = project.nodes.find((n) => n.id === conn.from.n);
      let fromIface = fromNode?.ifaces?.find(
        (f) => f.id === conn.from.i || f.label === conn.from.i || f.name === conn.from.i
      );
      let toNode = project.nodes.find((n) => n.id === conn.to.n);
      let toIface = toNode?.ifaces?.find(
        (f) => f.id === conn.to.i || f.label === conn.to.i || f.name === conn.to.i
      );

      if (!fromNode || !fromIface) {
        const targetLabel = fromLookup || conn.from.i;
        for (const n of project.nodes) {
          const matchIface = n.ifaces?.find(
            (f) => f.label === targetLabel || f.name === targetLabel || f.id === targetLabel
          );
          if (matchIface) {
            conn.from.n = n.id;
            conn.from.i = matchIface.id;
            fromNode = n;
            fromIface = matchIface;
            break;
          }
        }
      }

      if (!toNode || !toIface) {
        const targetLabel = toLookup || conn.to.i;
        for (const n of project.nodes) {
          const matchIface = n.ifaces?.find(
            (f) => f.label === targetLabel || f.name === targetLabel || f.id === targetLabel
          );
          if (matchIface) {
            conn.to.n = n.id;
            conn.to.i = matchIface.id;
            toNode = n;
            toIface = matchIface;
            break;
          }
        }
      }

      // Canonical orientation check: ensure from is source (pub/ss/as) and to is sink (sub/sc/ac)
      if (fromIface && toIface) {
        const srcSideFrom = SRC_SIDE[fromIface.kind];
        const srcSideTo = SRC_SIDE[toIface.kind];
        if (srcSideFrom === false && srcSideTo === true) {
          const tmpEnd = conn.from;
          conn.from = conn.to;
          conn.to = tmpEnd;
          const tmpRaw = conn.rawFrom;
          conn.rawFrom = conn.rawTo;
          conn.rawTo = tmpRaw;
        }
      }
    }
  }

  public normalizeInterfaces(rawIfaces: unknown): { name: string; label: string; kind: string; type: string }[] {
    return RosLayoutManager.normalizeInterfaces(rawIfaces);
  }

  private async syncCompanionRos2Models(project: RosProject, docFilePath: string) {
    void project;
    void docFilePath;
    // System view must not mutate companion .ros2 / .ros1 component models.
    // Parameters and interfaces configured in .rossystem are isolated to the system model.
    return;
  }

  private assignGridPositions(project: RosProject) {
    let subIdx = 0;
    for (const sub of project.subSystems || []) {
      if (!project.view) project.view = {};
      if (!project.view.subPos) project.view.subPos = {};
      if (!project.view.subPos[sub.ref]) {
        project.view.subPos[sub.ref] = { x: 80 + subIdx * 340, y: 380 };
        subIdx++;
      }
    }

    const unpositionedDirect = project.nodes.filter(
      (n) => !n.subRef && n.backing !== 'sub' && (n.x == null || n.y == null)
    );
    if (unpositionedDirect.length > 0) {
      const cols = Math.max(1, Math.ceil(Math.sqrt(unpositionedDirect.length)));
      unpositionedDirect.forEach((n, idx) => {
        const c = idx % cols;
        const r = Math.floor(idx / cols);
        n.x = 80 + c * 300;
        n.y = 80 + r * 260;
      });
    }

    const unpositionedSubMembers = project.nodes.filter(
      (n) => (n.subRef || n.backing === 'sub') && (n.x == null || n.y == null)
    );
    if (unpositionedSubMembers.length > 0) {
      const bySub = new Map<string, typeof unpositionedSubMembers>();
      for (const sn of unpositionedSubMembers) {
        const key = sn.subRef || 'default';
        const list = bySub.get(key) || [];
        list.push(sn);
        bySub.set(key, list);
      }
      for (const [subRef, members] of bySub.entries()) {
        const sPos = project.view?.subPos?.[subRef] || { x: 100, y: 100 };
        const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
        members.forEach((n, idx) => {
          const c = idx % cols;
          const r = Math.floor(idx / cols);
          n.x = sPos.x + 30 + c * 300;
          n.y = sPos.y + 50 + r * 240;
        });
      }
    }
  }

  private restoreCachedLayout(target: RosProject, source: RosProject) {
    // Preserve member nodes of subsystems from source (e.g. from catalogue or external systems)
    for (const n of source.nodes) {
      if (n.subRef || n.backing === 'sub') {
        const exists = target.nodes.some(
          (tn) => tn.id === n.id || (tn.subRef === n.subRef && tn.label === n.label)
        );
        if (!exists) {
          target.nodes.push({ ...n });
        }
      }
    }

    // Preserve node coordinates & dimensions keyed strictly by unique ID, with direct node label fallback
    const nodeDataById = new Map<string, { x?: number; y?: number; w?: number; h?: number }>();
    const directNodeDataByLabel = new Map<string, { x?: number; y?: number; w?: number; h?: number }>();
    for (const n of source.nodes) {
      nodeDataById.set(n.id, { x: n.x, y: n.y, w: n.w, h: n.h });
      if (!n.subRef && n.backing !== 'sub') {
        directNodeDataByLabel.set(n.label, { x: n.x, y: n.y, w: n.w, h: n.h });
      }
    }

    for (const n of target.nodes) {
      const data =
        nodeDataById.get(n.id) ||
        (!n.subRef && n.backing !== 'sub' ? directNodeDataByLabel.get(n.label) : undefined);
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

    // Preserve connections from source if not already present in target
    for (const sc of source.connections || []) {
      const exists = target.connections.some(
        (tc) =>
          tc.id === sc.id ||
          (tc.from.n === sc.from.n && tc.from.i === sc.from.i && tc.to.n === sc.to.n && tc.to.i === sc.to.i) ||
          ((tc.rawFrom || tc.from.i) === (sc.rawFrom || sc.from.i) && (tc.rawTo || tc.to.i) === (sc.rawTo || sc.to.i))
      );
      if (!exists && sc.from?.n && sc.to?.n) {
        const fromExists = target.nodes.some((n) => n.id === sc.from.n);
        const toExists = target.nodes.some((n) => n.id === sc.to.n);
        if (fromExists && toExists) {
          target.connections.push({ ...sc });
        }
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
    if (this.isCoreCatalogue(docFilePath)) {
      return;
    }
    const roots = this.getWorkspaceRoots(docFilePath);
    const rootDir = roots.length > 0 ? roots[0] : path.dirname(docFilePath);
    if (this.isCoreCatalogue(rootDir)) {
      return;
    }
    await RosLayoutManager.saveLayoutSchematic(docFilePath, project, rootDir);
  }

  public mapDiagnosticsToElements(
    diagnostics: readonly vscode.Diagnostic[],
    project: RosProject,
    docFilePath: string
  ): RosModelDiagnostic[] {
    void docFilePath;
    const results: RosModelDiagnostic[] = [];

    // 1. Map VS Code / LSP diagnostics (from RosTooling Xtext validator or LSP)
    for (const diag of diagnostics || []) {
      const line = diag.range ? diag.range.start.line + 1 : undefined;
      const msg = diag.message || '';
      const sev: 'error' | 'warning' | 'info' =
        diag.severity === vscode.DiagnosticSeverity.Warning
          ? 'warning'
          : diag.severity === vscode.DiagnosticSeverity.Information ||
            diag.severity === vscode.DiagnosticSeverity.Hint
          ? 'info'
          : 'error';
      const source = diag.source || 'RosTooling';

      let matched = false;

      // Try matching interfaces or parameters first (more granular than node)
      for (const node of project.nodes || []) {
        for (const iface of node.ifaces || []) {
          if (
            (line != null && iface.line === line) ||
            (iface.name &&
              (msg.includes(`'${iface.name}'`) ||
                msg.includes(`"${iface.name}"`) ||
                msg.includes(`::${iface.name}`) ||
                msg.includes(`.${iface.name}`) ||
                msg.includes(` ${iface.name} `)))
          ) {
            results.push({
              elementId: iface.id,
              elementKind: 'interface',
              targetName: iface.name,
              severity: sev,
              message: msg,
              line,
              source,
            });
            matched = true;
            break;
          }
        }
        if (matched) break;

        for (const param of node.params || []) {
          if (
            (line != null && param.line === line) ||
            (param.name &&
              (msg.includes(`'${param.name}'`) ||
                msg.includes(`"${param.name}"`) ||
                msg.includes(` ${param.name} `)))
          ) {
            results.push({
              elementId: param.id,
              elementKind: 'parameter',
              targetName: param.name,
              severity: sev,
              message: msg,
              line,
              source,
            });
            matched = true;
            break;
          }
        }
        if (matched) break;
      }

      if (!matched) {
        // Try matching node
        for (const node of project.nodes || []) {
          const lineInRange =
            (line != null && node.line != null && node.line === line) ||
            (line != null && node.line != null && node.lineEnd != null && line >= node.line && line <= node.lineEnd);
          const nameInMsg =
            node.label &&
            (msg.includes(`'${node.label}'`) ||
              msg.includes(`"${node.label}"`) ||
              msg.includes(`node ${node.label}`) ||
              msg.includes(`Node ${node.label}`));
          if (lineInRange || nameInMsg) {
            results.push({
              elementId: node.id,
              elementKind: 'node',
              targetName: node.label,
              severity: sev,
              message: msg,
              line,
              source,
            });
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        // Try matching connections
        for (const conn of project.connections || []) {
          if (
            (line != null && conn.line === line) ||
            (msg.toLowerCase().includes('connection') &&
              (msg.includes(conn.from.n) || msg.includes(conn.to.n)))
          ) {
            results.push({
              elementId: conn.id,
              elementKind: 'connection',
              targetName: `${conn.from.n} -> ${conn.to.n}`,
              severity: sev,
              message: msg,
              line,
              source,
            });
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        // Try matching processes
        for (const proc of project.processes || []) {
          if (
            (line != null && proc.line === line) ||
            (proc.name &&
              (msg.includes(`'${proc.name}'`) ||
                msg.includes(`"${proc.name}"`) ||
                msg.includes(`process ${proc.name}`)))
          ) {
            results.push({
              elementId: proc.name,
              elementKind: 'process',
              targetName: proc.name,
              severity: sev,
              message: msg,
              line,
              source,
            });
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        // Try matching subsystems
        for (const sub of project.subSystems || []) {
          if (
            (line != null && sub.line === line) ||
            (sub.ref &&
              (msg.includes(`'${sub.ref}'`) ||
                msg.includes(`"${sub.ref}"`) ||
                msg.includes(`subsystem ${sub.ref}`)))
          ) {
            results.push({
              elementId: sub.ref,
              elementKind: 'subsystem',
              targetName: sub.ref,
              severity: sev,
              message: msg,
              line,
              source,
            });
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        // Fallback to system-level
        results.push({
          elementId: 'system',
          elementKind: 'system',
          targetName: project.system?.name || 'system',
          severity: sev,
          message: msg,
          line,
          source,
        });
      }
    }

    // 2. Semantic model consistency validation (built-in RosTooling model checks)
    for (const conn of project.connections || []) {
      const fromNode = project.nodes.find((n) => n.id === conn.from.n);
      const toNode = project.nodes.find((n) => n.id === conn.to.n);
      const fromIface = fromNode?.ifaces.find((i) => i.id === conn.from.i);
      const toIface = toNode?.ifaces.find((i) => i.id === conn.to.i);

      const isTypeDep =
        Boolean(project.isRos) ||
        conn.id.startsWith('dep_') ||
        fromNode?.backing === 'type' ||
        toNode?.backing === 'type';

      if (!fromNode || !fromIface || !toNode || !toIface) {
        if (!isTypeDep) {
          results.push({
            elementId: conn.id,
            elementKind: 'connection',
            targetName: conn.id,
            severity: 'error',
            message: `Connection references unresolvable endpoint: from='${conn.from.n}::${conn.from.i}', to='${conn.to.n}::${conn.to.i}'`,
            line: conn.line,
            source: 'RosSystemValidator',
          });
        }
        continue;
      }

      if (isTypeDep) {
        // In .ros models, connections represent UML schema type dependencies
        const cleanFromType = (fromIface.type || '').replace(/^['"]|['"]$/g, '').replace(/\[\]$/, '').trim();
        const cleanToType = (toIface.type || '').replace(/^['"]|['"]$/g, '').replace(/\[\]$/, '').trim();
        const baseFrom = cleanFromType.split('/').pop()?.split('.').pop() || cleanFromType;
        const baseTo = cleanToType.split('/').pop()?.split('.').pop() || cleanToType;

        if (baseFrom !== baseTo && cleanFromType !== cleanToType && !cleanFromType.endsWith('/' + toNode.label)) {
          results.push({
            elementId: conn.id,
            elementKind: 'connection',
            targetName: `${fromNode.label}.${fromIface.name} -> ${toNode.label}.${toIface.name}`,
            severity: 'error',
            message: `Type dependency mismatch: '${fromIface.type}' does not reference '${toNode.label}'`,
            line: conn.line,
            source: 'RosValidator',
          });
        }
        continue;
      }

      const validKinds: Record<string, string> = {
        pub: 'sub',
        sub: 'pub',
        ss: 'sc',
        sc: 'ss',
        as: 'ac',
        ac: 'as',
      };
      if (validKinds[fromIface.kind] && validKinds[fromIface.kind] !== toIface.kind) {
        results.push({
          elementId: conn.id,
          elementKind: 'connection',
          targetName: `${fromNode.label}.${fromIface.name} -> ${toNode.label}.${toIface.name}`,
          severity: 'error',
          message: `Incompatible port kinds in connection: cannot connect '${fromIface.kind}' to '${toIface.kind}'`,
          line: conn.line,
          source: 'RosSystemValidator',
        });
      }

      const cleanFrom = (fromIface.type || '').replace(/^['"]|['"]$/g, '').trim();
      const cleanTo = (toIface.type || '').replace(/^['"]|['"]$/g, '').trim();
      const normFrom = cleanFrom.replace(/\/msg\//, '/').replace(/\/srv\//, '/').replace(/\/action\//, '/');
      const normTo = cleanTo.replace(/\/msg\//, '/').replace(/\/srv\//, '/').replace(/\/action\//, '/');
      const isMatch =
        cleanFrom === cleanTo ||
        normFrom === normTo ||
        (cleanFrom.includes('/') && !cleanTo.includes('/') && cleanFrom.endsWith('/' + cleanTo)) ||
        (!cleanFrom.includes('/') && cleanTo.includes('/') && cleanTo.endsWith('/' + cleanFrom));

      if (fromIface.type && toIface.type && fromIface.type !== '—' && toIface.type !== '—' && !isMatch) {
        results.push({
          elementId: conn.id,
          elementKind: 'connection',
          targetName: `${fromNode.label}.${fromIface.name} -> ${toNode.label}.${toIface.name}`,
          severity: 'error',
          message: `Port type mismatch: '${fromIface.type}' does not match '${toIface.type}'`,
          line: conn.line,
          source: 'RosSystemValidator',
        });
      }
    }

    // Validate Processes
    for (const proc of project.processes || []) {
      for (const nodeName of proc.nodes || []) {
        const found = project.nodes.some((n) => n.label === nodeName);
        if (!found) {
          results.push({
            elementId: proc.name,
            elementKind: 'process',
            targetName: proc.name,
            severity: 'warning',
            message: `Process '${proc.name}' references undefined node '${nodeName}'`,
            line: proc.line,
            source: 'RosSystemValidator',
          });
        }
      }
    }

    return results;
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

    RosCustomEditorProvider.activeCustomDocument = document;
    const viewStateSubscription = webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        RosCustomEditorProvider.activeCustomDocument = document;
      } else if (RosCustomEditorProvider.activeCustomDocument === document) {
        RosCustomEditorProvider.activeCustomDocument = undefined;
      }
    });

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
      const initialDiags = vscode.languages.getDiagnostics(document.uri);
      project.diagnostics = this.mapDiagnosticsToElements(initialDiags, project, document.fileName);
      this.projectCache.set(docKey, project);
    } catch (e) {
      console.error('Failed to parse RosTooling model:', e);
      project = {
        formatVersion: 4,
        isRosSystem,
        isRos,
        system: { name: isRos ? '' : path.basename(document.fileName, path.extname(document.fileName)) },
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
      const initialDiags = vscode.languages.getDiagnostics(document.uri);
      project.diagnostics = this.mapDiagnosticsToElements(initialDiags, project, document.fileName);
      this.projectCache.set(docKey, project);
    }

    this.refreshCatalogues(document.fileName);
    const isReadOnly = this.isCoreCatalogue(document.fileName);
    webviewPanel.webview.html = getStudioHtml(
      project,
      this.context.extensionUri,
      webviewPanel.webview,
      this.nodeIndex,
      this.typeIndex,
      document.fileName,
      isReadOnly
    );

    let isInternalUpdate = false;
    let lastInternalUpdateTime = 0;

    // Handle messages from Webview
    const messageListener = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'applyEdit': {
          if (this.isCoreCatalogue(document.fileName)) {
            vscode.window.showInformationMessage('Core catalogue models are read-only and cannot be modified.');
            return;
          }
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

            // Re-evaluate diagnostics and notify webview
            const diags = vscode.languages.getDiagnostics(document.uri);
            const mappedDiags = this.mapDiagnosticsToElements(diags, updatedProject, document.fileName);
            updatedProject.diagnostics = mappedDiags;
            void webviewPanel.webview.postMessage({
              type: 'updateDiagnostics',
              diagnostics: mappedDiags,
            });
          } catch (err) {
            vscode.window.showErrorMessage(`Failed to apply model changes: ${err}`);
          } finally {
            isInternalUpdate = false;
          }
          break;
        }

        case 'saveLayout': {
          if (this.isCoreCatalogue(document.fileName)) {
            return;
          }
          try {
            const updatedProject: RosProject = msg.project;
            this.projectCache.set(docKey, updatedProject);
            await this.saveLayoutSchematic(document.fileName, updatedProject);
          } catch (err) {
            console.warn('Failed to save layout schematic:', err);
          }
          break;
        }

        case 'openComponentRos2': {
          const compPath = this.resolveComponentFilePath(
            msg.from,
            msg.pkg,
            msg.artifact,
            msg.label,
            document.fileName
          );
          if (compPath && fs.existsSync(compPath)) {
            const targetUri = vscode.Uri.file(compPath);
            await vscode.commands.executeCommand('vscode.openWith', targetUri, RosCustomEditorProvider.viewType);
          } else {
            vscode.window.showWarningMessage(`Could not locate component source file for '${msg.from || msg.label || 'component'}'.`);
          }
          break;
        }

        case 'openSubsystemRosSystem': {
          const subPath = this.resolveSubsystemFilePath(
            msg.subRef,
            msg.fromFile,
            document.fileName
          );
          if (subPath && fs.existsSync(subPath)) {
            const targetUri = vscode.Uri.file(subPath);
            await vscode.commands.executeCommand('vscode.openWith', targetUri, RosCustomEditorProvider.viewType);
          } else {
            vscode.window.showWarningMessage(`Could not locate subsystem source file for '${msg.subRef || msg.fromFile || 'subsystem'}'.`);
          }
          break;
        }

        case 'generateCode': {
          if (document.isDirty) {
            await document.save();
          }
          await vscode.commands.executeCommand('rossystem.triggerCodeGeneration', document.uri);
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
              if (this.catalogueManager) {
                const res = await this.catalogueManager.syncRepositories(true, (step) =>
                  progress.report({ message: step })
                );
                const updated = this.refreshCatalogues();
                webviewPanel.webview.postMessage({
                  type: 'updateCatalogue',
                  nodeCatalog: updated.nodeIndex,
                  typeCatalog: updated.typeIndex,
                });
                if (res.success) {
                  vscode.window.showInformationMessage('RosTooling: Catalogue updated with latest models.');
                } else if (res.errors.length > 0) {
                  vscode.window.showWarningMessage(`RosTooling: Catalogue updated with some notices: ${res.errors.join(', ')}`);
                }
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
            for (const uri of selected) {
              this.catalogueManager.addCustomFolder(uri.fsPath);
            }
            const updated = this.refreshCatalogues();
            webviewPanel.webview.postMessage({
              type: 'updateCatalogue',
              nodeCatalog: updated.nodeIndex,
              typeCatalog: updated.typeIndex,
            });
            vscode.window.showInformationMessage(`Added ${selected.length} folder(s) to RosTooling Catalogue.`);
          }
          break;
        }

        case 'removeCatalogueFolder': {
          if (msg.folderId && this.catalogueManager) {
            this.catalogueManager.removeCustomFolder(msg.folderId);
            const updated = this.refreshCatalogues();
            webviewPanel.webview.postMessage({
              type: 'updateCatalogue',
              nodeCatalog: updated.nodeIndex,
              typeCatalog: updated.typeIndex,
            });
            vscode.window.showInformationMessage('Folder removed from RosTooling Catalogue.');
          }
          break;
        }
      }
    });

    const refreshWebviewFromDocument = () => {
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
        const diags = vscode.languages.getDiagnostics(document.uri);
        freshProject.diagnostics = this.mapDiagnosticsToElements(diags, freshProject, document.fileName);
        this.projectCache.set(docKey, freshProject);

        void webviewPanel.webview.postMessage({
          type: 'updateModel',
          project: freshProject,
        });
      } catch (err) {
        console.warn('Could not sync external text update to webview:', err);
      }
    };

    // Sync external text changes (both on active document AND companion .ros2/.ros1/.ros/.rossystem files) into Webview
    const changeDocSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (isInternalUpdate || Date.now() - lastInternalUpdateTime < 600) {
        return;
      }

      const changedPath = e.document.fileName || e.document.uri.fsPath;
      const isTargetDoc = e.document.uri.toString() === docKey;
      const isCompanionDoc =
        (changedPath.endsWith('.ros2') ||
          changedPath.endsWith('.ros1') ||
          changedPath.endsWith('.ros') ||
          changedPath.endsWith('.rossystem')) &&
        changedPath !== document.fileName;

      if (isTargetDoc || isCompanionDoc) {
        refreshWebviewFromDocument();
      }
    });

    // Sync saved model documents into Webview
    const saveDocSubscription = vscode.workspace.onDidSaveTextDocument((savedDoc) => {
      const savedPath = savedDoc.fileName || savedDoc.uri.fsPath;
      if (
        savedPath.endsWith('.ros2') ||
        savedPath.endsWith('.ros1') ||
        savedPath.endsWith('.ros') ||
        savedPath.endsWith('.rossystem')
      ) {
        refreshWebviewFromDocument();
      }
    });

    // Sync LSP / RosTooling Xtext diagnostics changes into Webview
    const diagSubscription = vscode.languages.onDidChangeDiagnostics((e) => {
      const isTarget = e.uris.some((u) => u.toString() === docKey);
      if (isTarget) {
        const currentProject = this.projectCache.get(docKey) || project;
        const diags = vscode.languages.getDiagnostics(document.uri);
        const mapped = this.mapDiagnosticsToElements(diags, currentProject, document.fileName);
        currentProject.diagnostics = mapped;
        void webviewPanel.webview.postMessage({
          type: 'updateDiagnostics',
          diagnostics: mapped,
        });
      }
    });

    webviewPanel.onDidDispose(() => {
      viewStateSubscription.dispose();
      messageListener.dispose();
      changeDocSubscription.dispose();
      saveDocSubscription.dispose();
      diagSubscription.dispose();
      if (RosCustomEditorProvider.activeCustomDocument === document) {
        RosCustomEditorProvider.activeCustomDocument = undefined;
      }
      this.projectCache.delete(docKey);
    });
  }
}
