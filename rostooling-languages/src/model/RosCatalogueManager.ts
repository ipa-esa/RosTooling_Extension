import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { RosModelParser } from './RosModelParser';
import {
  RosCatalogueIndex,
  RosCatalogueFolder,
} from './RosModelTypes';

export interface RepositoryConfig {
  id: string;
  name: string;
  url: string;
  branch?: string;
}

export class RosCatalogueManager {
  private static instance: RosCatalogueManager | null = null;

  public static readonly DEFAULT_REPOSITORIES: RepositoryConfig[] = [
    {
      id: 'ros_models_catalog',
      name: 'RosModelsCatalog',
      url: 'https://github.com/ipa-nhg/RosModelsCatalog.git',
      branch: 'main',
    },
    {
      id: 'ros_common_objects',
      name: 'RosCommonObjects',
      url: 'https://github.com/ipa320/RosCommonObjects.git',
      branch: 'master',
    },
  ];

  private storageDir: string;
  private customFolders: RosCatalogueFolder[] = [];
  private lastSyncTimestamp = 0;
  private cacheIndex: RosCatalogueIndex | null = null;
  private fileCache = new Map<string, { mtime: number; data: unknown }>();

  constructor(storageDir?: string) {
    this.storageDir = storageDir || path.join(os.homedir(), '.rostooling', 'catalogue_repos');
    this.ensureDirectory(this.storageDir);
    this.loadCustomFoldersConfig();
  }

  public static getInstance(storageDir?: string): RosCatalogueManager {
    if (!RosCatalogueManager.instance) {
      RosCatalogueManager.instance = new RosCatalogueManager(storageDir);
    }
    return RosCatalogueManager.instance;
  }

  public getStorageDir(): string {
    return this.storageDir;
  }

  public getLastSyncTimestamp(): number {
    return this.lastSyncTimestamp;
  }

  public getCustomFolders(): RosCatalogueFolder[] {
    return [...this.customFolders];
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.warn(`Failed to create catalogue storage directory: ${dir}`, e);
      }
    }
  }

  private getConfigFilePath(): string {
    return path.join(this.storageDir, 'catalogue_config.json');
  }

  private loadCustomFoldersConfig(): void {
    const cfgPath = this.getConfigFilePath();
    if (fs.existsSync(cfgPath)) {
      try {
        const raw = fs.readFileSync(cfgPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.customFolders)) {
          this.customFolders = parsed.customFolders;
        }
        if (typeof parsed.lastSyncTimestamp === 'number') {
          this.lastSyncTimestamp = parsed.lastSyncTimestamp;
        }
      } catch (e) {
        console.warn('Failed to load catalogue_config.json:', e);
      }
    }
  }

  private saveCustomFoldersConfig(): void {
    const cfgPath = this.getConfigFilePath();
    try {
      const data = {
        customFolders: this.customFolders,
        lastSyncTimestamp: this.lastSyncTimestamp,
      };
      fs.writeFileSync(cfgPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Failed to save catalogue_config.json:', e);
    }
  }

  public addCustomFolder(folderPath: string, folderName?: string): boolean {
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return false;
    }
    const id = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const name = folderName || path.basename(resolved);
    const existing = this.customFolders.find((f) => path.resolve(f.path) === resolved);
    if (!existing) {
      this.customFolders.push({ id, name, path: resolved, isCustom: true });
      this.saveCustomFoldersConfig();
      this.invalidateCache();
      return true;
    }
    return false;
  }

  public removeCustomFolder(idOrPath: string): boolean {
    const initLen = this.customFolders.length;
    this.customFolders = this.customFolders.filter(
      (f) => f.id !== idOrPath && path.resolve(f.path) !== path.resolve(idOrPath)
    );
    if (this.customFolders.length !== initLen) {
      this.saveCustomFoldersConfig();
      this.invalidateCache();
      return true;
    }
    return false;
  }

  public invalidateCache(): void {
    this.cacheIndex = null;
  }

  /**
   * Sync/Pull default GitHub repositories with 24-hour interval or manual trigger
   */
  public async syncRepositories(
    force = false,
    progressCallback?: (msg: string) => void
  ): Promise<{ success: boolean; updated: string[]; errors: string[] }> {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    if (!force && this.lastSyncTimestamp && now - this.lastSyncTimestamp < oneDay) {
      return { success: true, updated: [], errors: [] };
    }

    const updated: string[] = [];
    const errors: string[] = [];

    for (const repo of RosCatalogueManager.DEFAULT_REPOSITORIES) {
      const repoTargetDir = path.join(this.storageDir, repo.name);
      if (progressCallback) {
        progressCallback(`Updating ${repo.name}...`);
      }

      try {
        if (!fs.existsSync(repoTargetDir)) {
          // Clone shallow depth 1
          await this.execGit(['clone', '--depth', '1', repo.url, repoTargetDir]);
          updated.push(repo.name);
        } else {
          // Pull fast-forward
          await this.execGit(['-C', repoTargetDir, 'pull', '--ff-only']);
          updated.push(repo.name);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Could not pull repository ${repo.name}: ${msg}`);
        errors.push(`${repo.name}: ${msg}`);
      }
    }

    this.lastSyncTimestamp = now;
    this.saveCustomFoldersConfig();
    this.invalidateCache();

    return {
      success: errors.length === 0,
      updated,
      errors,
    };
  }

  private execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.execFile('git', args, { timeout: 45000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || stdout || error.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Search for all model files in candidate directories and build a live index
   */
  public buildCatalogueIndex(extraSearchRoots: string[] = []): RosCatalogueIndex {
    if (this.cacheIndex) {
      return this.cacheIndex;
    }

    const index: RosCatalogueIndex = {
      types: {},
      nodes: {},
      systems: [],
      sources: [],
      lastSync: this.lastSyncTimestamp,
    };

    const searchRoots: { root: string; sourceName: string; isDefault?: boolean }[] = [];

    // 1. Storage dir repositories
    for (const repo of RosCatalogueManager.DEFAULT_REPOSITORIES) {
      const repoPath = path.join(this.storageDir, repo.name);
      if (fs.existsSync(repoPath)) {
        searchRoots.push({ root: repoPath, sourceName: repo.name, isDefault: true });
      }
    }

    // 2. Sibling repositories in workspace/src if present
    for (const extra of extraSearchRoots) {
      if (fs.existsSync(extra)) {
        const base = path.basename(extra);
        searchRoots.push({ root: extra, sourceName: base });
      }
    }

    // 3. User custom folders
    for (const cf of this.customFolders) {
      if (fs.existsSync(cf.path)) {
        searchRoots.push({ root: cf.path, sourceName: cf.name });
      }
    }

    const uniqueSources = new Set<string>();

    for (const { root, sourceName } of searchRoots) {
      uniqueSources.add(sourceName);
      const modelFiles = this.findModelFilesRecursively(root);

      for (const filePath of modelFiles) {
        try {
          const stats = fs.statSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const relPath = path.relative(root, filePath);
          const domain = relPath.includes(path.sep) ? relPath.split(path.sep)[0] : 'general';

          // Check cache
          const cacheKey = `${filePath}:${stats.mtimeMs}`;
          let parsedData = this.fileCache.get(cacheKey)?.data;

          if (!parsedData) {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (ext === '.ros') {
              parsedData = { kind: 'ros', project: RosModelParser.parseRos(content, filePath) };
            } else if (ext === '.ros2' || ext === '.ros1') {
              parsedData = { kind: 'ros2', project: RosModelParser.parseRos2(content, filePath) };
            } else if (ext === '.rossystem') {
              parsedData = { kind: 'rossystem', project: RosModelParser.parseRosSystem(content, filePath) };
            }
            if (parsedData) {
              this.fileCache.set(cacheKey, { mtime: stats.mtimeMs, data: parsedData });
            }
          }

          if (!parsedData) continue;
          const parsed = parsedData as { kind: string; project: ReturnType<typeof RosModelParser.parse> };
          const p = parsed.project;

          if (parsed.kind === 'ros') {
            // Index Communication types (messages, services, actions)
            for (const tKey of Object.keys(p.types || {})) {
              const spec = p.types[tKey];
              const compositeKey = `${spec.pkg}/${spec.category}/${spec.name}`;
              index.types[compositeKey] = {
                pkg: spec.pkg,
                category: spec.category,
                file: relPath,
                source: sourceName,
                domain,
                fields: spec.fields,
              };
            }
          } else if (parsed.kind === 'ros2') {
            // Index Component nodes
            for (const n of p.nodes || []) {
              const pkgName = n.pkg || (p.system ? p.system.name : 'ros_pkg');
              const nodeKey = `${pkgName}.${n.label}`;
              const ifaceMap: Record<string, string | { kind: string; type?: string }> = {};
              for (const iface of n.ifaces || []) {
                ifaceMap[iface.name] = {
                  kind: iface.kind,
                  type: iface.type || '',
                };
              }
              const paramMap: Record<string, { type?: string; value?: string | number | boolean }> = {};
              for (const param of n.params || []) {
                paramMap[param.name] = {
                  type: param.ptype || 'String',
                  value: param.value,
                };
              }

              index.nodes[nodeKey] = {
                artifact: n.artifact || n.label,
                from: n.from || `${pkgName}.${n.label}`,
                pkg: pkgName,
                file: relPath,
                source: sourceName,
                domain,
                interfaces: ifaceMap,
                parameters: paramMap,
              };
            }
          } else if (parsed.kind === 'rossystem') {
            // Index Systems / Subsystems
            const sysName = p.system?.name || path.basename(filePath, '.rossystem');
            const nodesMap: Record<string, { from?: string; interfaces?: Record<string, string> }> = {};
            for (const n of p.nodes || []) {
              const ifaces: Record<string, string> = {};
              for (const i of n.ifaces || []) {
                ifaces[i.name] = i.kind;
              }
              nodesMap[n.label] = { from: n.from, interfaces: ifaces };
            }
            index.systems.push({
              system: sysName,
              file: relPath,
              source: sourceName,
              domain,
              nodes: nodesMap,
            });
          }
        } catch (err) {
          console.warn(`Error indexing model file ${filePath}:`, err);
        }
      }
    }

    index.sources = Array.from(uniqueSources);
    this.cacheIndex = index;
    return index;
  }

  private findModelFilesRecursively(dir: string, depth = 0): string[] {
    const results: string[] = [];
    if (depth > 8 || !fs.existsSync(dir)) return results;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'build') {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.findModelFilesRecursively(fullPath, depth + 1));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.ros', '.ros2', '.ros1', '.rossystem'].includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // Ignore read permission errors
    }

    return results;
  }
}
