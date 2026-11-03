import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { CoreSenseRole, CORESENSE_ROLES, RosLayoutSchematic } from '../model/RosModelTypes';
import { RosLayoutManager } from '../model/RosLayoutManager';
import { RosCustomEditorProvider } from '../editor/RosCustomEditorProvider';
import { StudioApiClient } from './DraftContentProvider';

export interface MaterializedNodeLayout {
  id: string;
  label: string;
  pkg?: string;
  node?: string;
  artifact?: string;
  x: number;
  y: number;
  role?: string;
}

export interface MaterializationResponse {
  ok?: boolean;
  revision?: number;
  writtenFiles?: string[];
  projectModelFiles?: string[];
  primarySystemFile?: string | null;
  targetDir?: string;
  nodeLayouts?: MaterializedNodeLayout[];
  warnings?: unknown[];
}

export interface PromoteOptions {
  /** Subdirectory inside `workspaceDir` where `.rossystem` / `.ros2` files are written. Defaults to `'models'`. */
  targetSubdir?: string;
  /** Exact target directory override (takes precedence over `workspaceDir` + `targetSubdir`). */
  targetDir?: string;
  /** Automatically open the primary `.rossystem` in the Micro Visual Editor (`rostooling.visualStudio`). Defaults to `true`. */
  openInEditor?: boolean;
  /** Optional path to `ros_studio.py` + `project.json` for offline CLI fallback when the daemon is not running. */
  cliFallback?: {
    pythonBin: string;
    rosStudioScript: string;
    projectJsonPath: string;
  };
}

export interface MaterializationResult {
  projectId: string;
  targetDir: string;
  writtenFiles: string[];
  primarySystemFile: string | null;
  layoutFile: string | null;
  revision?: number;
}

function normalizeRole(role?: string): CoreSenseRole | undefined {
  if (!role) {
    return undefined;
  }
  const found = (CORESENSE_ROLES as readonly string[]).find((r) => r === role);
  return found ? (found as CoreSenseRole) : undefined;
}

/**
 * Explicit Materialization Gate ("Promote to Models").
 *
 * Bridges CoreSense Studio's Macro architectural draft (`project.json`) into concrete,
 * LSP-validated `.rossystem`, `.ros2`, and `.ros` files inside the active workspace,
 * writes `.rostooling/layout/<system>.rossystem.layout.json` preserving node coordinates
 * and CoreSense pipeline roles, and hands control to the Micro Visual Editor.
 */
export class MaterializationGate {
  private apiClient: StudioApiClient | null;
  private readonly dirToProject = new Map<string, string>();
  private readonly fileToProject = new Map<string, string>();
  private suppressReconcileUntil = new Map<string, number>();

  constructor(apiClient?: StudioApiClient | null) {
    this.apiClient = apiClient ?? null;
  }

  public setApiClient(client: StudioApiClient | null): void {
    this.apiClient = client;
  }

  public registerPromotedTarget(projectId: string, targetDir: string, files: string[] = []): void {
    const resolvedDir = path.resolve(targetDir);
    this.dirToProject.set(resolvedDir, projectId);
    for (const file of files) {
      const resolvedFile = path.resolve(file);
      this.fileToProject.set(resolvedFile, projectId);
      // Suppress bounce-back reconciliation for 1.5s right after materialization writes files
      this.suppressReconcileUntil.set(resolvedFile, Date.now() + 1500);
    }
  }

  public isRecentlyMaterialized(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const until = this.suppressReconcileUntil.get(resolved);
    if (until === undefined) {
      return false;
    }
    if (Date.now() <= until) {
      return true;
    }
    this.suppressReconcileUntil.delete(resolved);
    return false;
  }

  public lookupLocalProjectId(filePath: string): string | undefined {
    const resolved = path.resolve(filePath);
    const direct = this.fileToProject.get(resolved);
    if (direct) {
      return direct;
    }
    let cur = path.dirname(resolved);
    for (let i = 0; i < 6; i++) {
      const byDir = this.dirToProject.get(cur);
      if (byDir) {
        return byDir;
      }
      const parent = path.dirname(cur);
      if (parent === cur) {
        break;
      }
      cur = parent;
    }
    return undefined;
  }

  public async promoteProjectToWorkspace(
    projectId: string,
    workspaceDir: string,
    options: PromoteOptions = {}
  ): Promise<MaterializationResult> {
    const targetDir = path.resolve(
      options.targetDir ?? path.join(workspaceDir, options.targetSubdir ?? 'models')
    );
    await fs.promises.mkdir(targetDir, { recursive: true });

    let writtenFiles: string[] = [];
    let primarySystemFile: string | null = null;
    let nodeLayouts: MaterializedNodeLayout[] = [];
    let revision: number | undefined;

    if (this.apiClient) {
      const response = await this.apiClient.request<MaterializationResponse>(
        'POST',
        `/api/projects/${encodeURIComponent(projectId)}/generate/models`,
        { targetDir }
      );
      writtenFiles = (response.writtenFiles ?? []).map((f) => path.resolve(f));
      primarySystemFile = response.primarySystemFile
        ? path.resolve(response.primarySystemFile)
        : writtenFiles.find((f) => f.endsWith('.rossystem')) ?? null;
      nodeLayouts = response.nodeLayouts ?? [];
      revision = response.revision;
    } else if (options.cliFallback) {
      const { pythonBin, rosStudioScript, projectJsonPath } = options.cliFallback;
      await this.runCliGenerate(pythonBin, rosStudioScript, projectJsonPath, targetDir);
      const entries = await fs.promises.readdir(targetDir);
      writtenFiles = entries
        .filter((name) => /\.(rossystem|ros2|ros)$/.test(name))
        .sort()
        .map((name) => path.join(targetDir, name));
      primarySystemFile = writtenFiles.find((f) => f.endsWith('.rossystem')) ?? null;
      nodeLayouts = await this.extractNodeLayoutsFromProjectJson(projectJsonPath);
    } else {
      throw new Error(
        'Cannot materialize Studio models: CoreSense Studio daemon is not connected and no CLI fallback was provided.'
      );
    }

    this.registerPromotedTarget(projectId, targetDir, writtenFiles);

    let layoutFile: string | null = null;
    if (primarySystemFile && nodeLayouts.length > 0) {
      layoutFile = await this.writeSystemLayoutSidecar(primarySystemFile, workspaceDir, nodeLayouts);
    }

    if (options.openInEditor !== false && primarySystemFile && fs.existsSync(primarySystemFile)) {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(primarySystemFile),
        RosCustomEditorProvider.viewType
      );
    }

    return {
      projectId,
      targetDir,
      writtenFiles,
      primarySystemFile,
      layoutFile,
      revision,
    };
  }

  private async writeSystemLayoutSidecar(
    systemFilePath: string,
    workspaceDir: string,
    nodeLayouts: MaterializedNodeLayout[]
  ): Promise<string | null> {
    if (RosLayoutManager.isCataloguePath(systemFilePath)) {
      return null;
    }
    const existing = RosLayoutManager.loadLayoutSchematic(systemFilePath, workspaceDir);
    const existingByLabel = new Map(
      (existing?.nodes ?? []).map((n) => [n.label ?? n.id, n] as const)
    );

    const schematic: RosLayoutSchematic = {
      $schema: 'https://rostooling.ipa.fraunhofer.de/schema/layout-v1.json',
      version: 1,
      modelFile: path.basename(systemFilePath),
      modelType: 'rossystem',
      canvas: existing?.canvas ?? {
        view: { tx: 40, ty: 40, zoom: 1 },
        connectorMode: 'orthogonal',
      },
      nodes: nodeLayouts.map((nl) => {
        const prev = existingByLabel.get(nl.label);
        const role = normalizeRole(nl.role) ?? prev?.role;
        return {
          id: prev?.id ?? nl.id,
          label: nl.label,
          x: typeof nl.x === 'number' ? nl.x : prev?.x ?? 80,
          y: typeof nl.y === 'number' ? nl.y : prev?.y ?? 80,
          ...(prev?.width !== undefined ? { width: prev.width } : {}),
          ...(prev?.height !== undefined ? { height: prev.height } : {}),
          ...(role && role !== 'Unassigned' ? { role } : {}),
        };
      }),
      subsystems: existing?.subsystems ?? [],
      connections: existing?.connections ?? [],
    };

    const layoutPath = RosLayoutManager.getLayoutFilePath(systemFilePath, workspaceDir);
    await fs.promises.mkdir(path.dirname(layoutPath), { recursive: true });
    await fs.promises.writeFile(layoutPath, JSON.stringify(schematic, null, 2), 'utf-8');
    return layoutPath;
  }

  private async extractNodeLayoutsFromProjectJson(
    projectJsonPath: string
  ): Promise<MaterializedNodeLayout[]> {
    try {
      const raw = await fs.promises.readFile(projectJsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        nodes?: { id?: string; label?: string; x?: number; y?: number }[];
        studio?: { modules?: Record<string, { role?: string }> };
      };
      const modules = parsed.studio?.modules ?? {};
      return (parsed.nodes ?? []).map((n, idx) => {
        const id = n.id ?? `n_${idx + 1}`;
        return {
          id,
          label: n.label ?? id,
          x: typeof n.x === 'number' ? n.x : 80,
          y: typeof n.y === 'number' ? n.y : 80,
          role: modules[id]?.role ?? 'Unassigned',
        };
      });
    } catch {
      return [];
    }
  }

  private runCliGenerate(
    pythonBin: string,
    rosStudioScript: string,
    projectJsonPath: string,
    targetDir: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = cp.spawn(
        pythonBin,
        [rosStudioScript, 'generate', projectJsonPath, '--outdir', targetDir, '--no-oracle'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ros_studio.py generate exited with code ${code}: ${stderr.trim()}`));
        }
      });
    });
  }
}
