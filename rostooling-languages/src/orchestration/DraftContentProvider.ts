import * as vscode from 'vscode';

export interface StudioApiClient {
  request<T = unknown>(method: string, apiPath: string, body?: unknown): Promise<T>;
  isAvailable?(): Promise<boolean>;
  isRunning?(): boolean;
}

interface PreviewOutputEntry {
  path: string;
  content?: string;
  text?: string;
}

interface ProjectEnvelopeLike {
  revision?: number;
}

interface PreviewResponseLike {
  outputs?: PreviewOutputEntry[];
  files?: PreviewOutputEntry[];
}

/**
 * Virtual read-only document provider for uncommitted RosTooling Studio drafts.
 *
 * URI format:
 *   rostooling-draft://<projectId>/<relativePath>
 *   e.g. rostooling-draft://my-robot-abc123/models/navigation.rossystem
 *
 * Preserves the `.rossystem` / `.ros2` / `.ros` suffix in `uri.path` so VS Code
 * automatically applies RosTooling TextMate syntax highlighting without writing
 * temporary files to disk.
 */
export class DraftContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  public static readonly scheme = 'rostooling-draft';

  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly cache = new Map<string, string>();
  private apiClient: StudioApiClient | null;

  constructor(apiClient?: StudioApiClient | null) {
    this.apiClient = apiClient ?? null;
  }

  public setApiClient(client: StudioApiClient | null): void {
    this.apiClient = client;
  }

  public static buildDraftUri(projectId: string, relativePath: string): vscode.Uri {
    const cleanRel = relativePath.replace(/^\/+/, '');
    return vscode.Uri.from({
      scheme: DraftContentProvider.scheme,
      authority: projectId,
      path: `/${cleanRel}`,
    });
  }

  private normalizeKey(projectId: string, relativePath: string): string {
    const cleanRel = relativePath.replace(/^\/+/, '');
    return `${projectId}::${cleanRel}`;
  }

  public setDraftContent(uri: vscode.Uri, content: string): void {
    const projectId = uri.authority;
    const relPath = uri.path.replace(/^\/+/, '');
    this.cache.set(this.normalizeKey(projectId, relPath), content);
    const stripped = relPath.replace(/^models\//, '');
    if (stripped !== relPath) {
      this.cache.set(this.normalizeKey(projectId, stripped), content);
    } else {
      this.cache.set(this.normalizeKey(projectId, `models/${relPath}`), content);
    }
    this.onDidChangeEmitter.fire(uri);
  }

  /**
   * Populate all draft files for a project from an in-memory map or preview response
   * and return their `rostooling-draft://` URIs.
   */
  public setProjectDraftFiles(projectId: string, files: Record<string, string>): vscode.Uri[] {
    const uris: vscode.Uri[] = [];
    for (const [rawPath, content] of Object.entries(files)) {
      const cleanRel = rawPath.replace(/^\/+/, '');
      const uri = DraftContentProvider.buildDraftUri(projectId, cleanRel);
      this.setDraftContent(uri, content);
      uris.push(uri);
    }
    return uris;
  }

  public clearProjectDrafts(projectId: string): void {
    const prefix = `${projectId}::`;
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  public async fetchAndCacheProjectDrafts(projectId: string): Promise<vscode.Uri[]> {
    if (!this.apiClient) {
      return [];
    }
    const envelope = await this.apiClient.request<ProjectEnvelopeLike>(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}`
    );
    const preview = await this.apiClient.request<PreviewResponseLike>(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/generation/preview`,
      {
        expectedRevision: envelope.revision,
        kind: 'models',
      }
    );
    const entries = preview.outputs ?? preview.files ?? [];
    const fileMap: Record<string, string> = {};
    for (const item of entries) {
      if (item.path) {
        fileMap[item.path] = item.content ?? item.text ?? '';
      }
    }
    return this.setProjectDraftFiles(projectId, fileMap);
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const projectId = uri.authority;
    const relPath = uri.path.replace(/^\/+/, '');
    const directKey = this.normalizeKey(projectId, relPath);
    const cached = this.cache.get(directKey);
    if (cached !== undefined) {
      return cached;
    }

    if (this.apiClient && projectId) {
      try {
        await this.fetchAndCacheProjectDrafts(projectId);
        const refreshed = this.cache.get(directKey);
        if (refreshed !== undefined) {
          return refreshed;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `// Unable to render RosTooling Studio draft for ${projectId}/${relPath}\n// ${message}\n`;
      }
    }

    return `// RosTooling Studio draft "${relPath}" is not available in cache.\n`;
  }

  public dispose(): void {
    this.cache.clear();
    this.onDidChangeEmitter.dispose();
  }
}
