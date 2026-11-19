import * as path from 'node:path';
import * as vscode from 'vscode';
import { normalizePluginSettingList } from './pluginPaths.js';
import {
  computeEffectivePluginConfig,
  ConfigInspectLike,
  DiscoveredPlugin,
  DiscoveredPluginsResponse,
  EffectivePluginConfig,
  PluginApprovalState,
  SettingScopeSource,
} from './pluginTrust.js';
import {
  approveTrustedPluginEntry,
  migrateLegacyTrustedChecksums,
} from './trustedPluginsStore.js';

export const PLUGIN_SETTINGS_SECTION = 'rostooling-languages';
export const LIST_DISCOVERED_PLUGINS_CMD = 'rostooling.listDiscoveredPlugins';
export const GET_PLUGIN_DOCUMENTATION_CMD = 'rostooling.getPluginDocumentation';
export const PLUGIN_TRUST_WARNING =
  'This plugin will run with your permissions. Only enable plugins from sources you trust.';
export const NO_METADATA_LOAD_ERROR = 'no plugin metadata; enable by id in settings';

export interface PluginHostAdapter {
  isWorkspaceTrusted(): boolean;
  getWorkspaceDir(): string | undefined;
  inspectPaths(): ConfigInspectLike<string[]> | undefined;
  inspectEnabled(): ConfigInspectLike<string[]> | undefined;
  getLegacyGlobalTrustedChecksums(): unknown;
  approvePluginJar(
    storePath: string,
    entry: { sha256: string; fileName: string; id: string }
  ): Promise<void>;
  migrateLegacyChecksums(options: {
    legacyChecksums: unknown;
    rawPluginPaths: unknown;
    workspaceDir?: string;
    storePath: string;
  }): Promise<number>;
  updatePluginsSetting(
    key: 'plugins.paths' | 'plugins.enabled',
    value: string[],
    target: 'workspace' | 'user'
  ): Promise<void>;
  isLspReady(): boolean;
  waitForLspReady(): Promise<boolean>;
  sendExecuteCommand<T = unknown>(command: string, args?: unknown[]): Promise<T>;
  restartServers(): Promise<void>;
  refreshMcpConfigs(): Promise<void>;
  refreshPluginsView(): void;
  log(message: string): void;
  logWarning(message: string): void;
  showInfo(message: string, ...items: string[]): Promise<string | undefined>;
  showWarning(message: string, ...items: string[]): Promise<string | undefined>;
  showError(message: string, ...items: string[]): Promise<string | undefined>;
  showModalConfirm(message: string, detail: string, confirmLabel: string): Promise<boolean>;
  pickQuickPick(
    items: PluginQuickPickItem[],
    options: { title: string; placeholder: string; untickableError: string }
  ): Promise<PluginQuickPickItem[] | undefined>;
  pickScope(defaultScope: SettingScopeSource): Promise<'workspace' | 'user' | undefined>;
  promptAddPluginPath(): Promise<string | undefined>;
  openPluginSettings(): Promise<void>;
  openTrustManagement(): Promise<void>;
  openMarkdownPreview(pluginId: string, markdown: string): Promise<void>;
}

export interface PluginQuickPickItem extends vscode.QuickPickItem {
  action?: 'addPath' | 'openSettings';
  plugin?: DiscoveredPlugin;
  tickable?: boolean;
  untickReason?: string;
}

export class PluginDocContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'rostooling-plugin-doc';
  private readonly docsByUri = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.emitter.event;

  public setDocumentation(pluginId: string, markdown: string): vscode.Uri {
    const safeFile = (pluginId || 'plugin').replace(/[^A-Za-z0-9._-]/g, '_');
    const uri = vscode.Uri.parse(`${PluginDocContentProvider.scheme}:/${encodeURIComponent(pluginId)}/${safeFile}.md`);
    this.docsByUri.set(uri.toString(), markdown);
    this.emitter.fire(uri);
    return uri;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.docsByUri.get(uri.toString()) ?? '';
  }

  public dispose(): void {
    this.emitter.dispose();
  }
}

export class VsCodePluginHost implements PluginHostAdapter {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly docProvider: PluginDocContentProvider;
  private readonly callbacks: {
    isLspReady: () => boolean;
    waitForLspReady: () => Promise<boolean>;
    sendExecuteCommand: <T = unknown>(command: string, args?: unknown[]) => Promise<T>;
    restartServers: () => Promise<void>;
    refreshMcpConfigs: () => Promise<void>;
    refreshPluginsView: () => void;
    beginInternalConfigUpdate: () => void;
  };

  constructor(
    outputChannel: vscode.OutputChannel,
    docProvider: PluginDocContentProvider,
    callbacks: VsCodePluginHost['callbacks']
  ) {
    this.outputChannel = outputChannel;
    this.docProvider = docProvider;
    this.callbacks = callbacks;
  }

  public isWorkspaceTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  public getWorkspaceDir(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  public inspectPaths(): ConfigInspectLike<string[]> | undefined {
    return vscode.workspace.getConfiguration(PLUGIN_SETTINGS_SECTION).inspect<string[]>('plugins.paths');
  }

  public inspectEnabled(): ConfigInspectLike<string[]> | undefined {
    return vscode.workspace.getConfiguration(PLUGIN_SETTINGS_SECTION).inspect<string[]>('plugins.enabled');
  }

  public getLegacyGlobalTrustedChecksums(): unknown {
    return vscode.workspace
      .getConfiguration(PLUGIN_SETTINGS_SECTION)
      .inspect<Record<string, string>>('plugins.trustedChecksums')?.globalValue;
  }

  public async approvePluginJar(
    storePath: string,
    entry: { sha256: string; fileName: string; id: string }
  ): Promise<void> {
    approveTrustedPluginEntry(storePath, entry);
  }

  public async migrateLegacyChecksums(options: {
    legacyChecksums: unknown;
    rawPluginPaths: unknown;
    workspaceDir?: string;
    storePath: string;
  }): Promise<number> {
    return migrateLegacyTrustedChecksums(options);
  }

  public async updatePluginsSetting(
    key: 'plugins.paths' | 'plugins.enabled',
    value: string[],
    target: 'workspace' | 'user'
  ): Promise<void> {
    this.callbacks.beginInternalConfigUpdate();
    const configTarget =
      target === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration(PLUGIN_SETTINGS_SECTION).update(key, value, configTarget);
  }

  public isLspReady(): boolean {
    return this.callbacks.isLspReady();
  }

  public waitForLspReady(): Promise<boolean> {
    return this.callbacks.waitForLspReady();
  }

  public sendExecuteCommand<T = unknown>(command: string, args: unknown[] = []): Promise<T> {
    return this.callbacks.sendExecuteCommand<T>(command, args);
  }

  public restartServers(): Promise<void> {
    return this.callbacks.restartServers();
  }

  public refreshMcpConfigs(): Promise<void> {
    return this.callbacks.refreshMcpConfigs();
  }

  public refreshPluginsView(): void {
    this.callbacks.refreshPluginsView();
  }

  public log(message: string): void {
    this.outputChannel.appendLine(`[Plugins] ${message}`);
  }

  public logWarning(message: string): void {
    this.outputChannel.appendLine(`[Plugins warning] ${message}`);
  }

  public async showInfo(message: string, ...items: string[]): Promise<string | undefined> {
    return vscode.window.showInformationMessage(message, ...items);
  }

  public async showWarning(message: string, ...items: string[]): Promise<string | undefined> {
    return vscode.window.showWarningMessage(message, ...items);
  }

  public async showError(message: string, ...items: string[]): Promise<string | undefined> {
    return vscode.window.showErrorMessage(message, ...items);
  }

  public async showModalConfirm(message: string, detail: string, confirmLabel: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true, detail },
      confirmLabel
    );
    return choice === confirmLabel;
  }

  public async pickQuickPick(
    items: PluginQuickPickItem[],
    options: { title: string; placeholder: string; untickableError: string }
  ): Promise<PluginQuickPickItem[] | undefined> {
    return await new Promise<PluginQuickPickItem[] | undefined>((resolve) => {
      const qp = vscode.window.createQuickPick<PluginQuickPickItem>();
      qp.title = options.title;
      qp.placeholder = options.placeholder;
      qp.canSelectMany = true;
      qp.matchOnDescription = true;
      qp.matchOnDetail = true;
      qp.items = items;
      qp.selectedItems = items.filter((item) => Boolean(item.picked && item.tickable));

      let validSelection = [...qp.selectedItems];
      let resolved = false;
      const finish = (val: PluginQuickPickItem[] | undefined) => {
        if (resolved) {
          return;
        }
        resolved = true;
        qp.hide();
        qp.dispose();
        resolve(val);
      };

      qp.onDidChangeSelection((selection) => {
        const actionItem = selection.find((i) => i.action);
        if (actionItem) {
          finish([actionItem]);
          return;
        }
        const blocked = selection.find((i) => !i.tickable && i.kind !== vscode.QuickPickItemKind.Separator);
        if (blocked) {
          const reason = blocked.untickReason || options.untickableError;
          qp.placeholder = reason;
          qp.selectedItems = validSelection;
          void vscode.window.showWarningMessage(reason);
          return;
        }
        validSelection = [...selection];
      });

      qp.onDidAccept(() => {
        finish([...validSelection]);
      });

      qp.onDidHide(() => {
        finish(undefined);
      });

      qp.show();
    });
  }

  public async pickScope(defaultScope: SettingScopeSource): Promise<'workspace' | 'user' | undefined> {
    if (!this.getWorkspaceDir()) {
      return 'user';
    }
    const workspaceOption = {
      label: 'Workspace (.vscode/settings.json)',
      description: defaultScope === 'workspace' ? 'Current scope' : 'Applies to this workspace only',
      target: 'workspace' as const,
    };
    const userOption = {
      label: 'User Settings',
      description: defaultScope === 'user' ? 'Current scope' : 'Applies across all workspaces',
      target: 'user' as const,
    };
    const choices =
      defaultScope === 'workspace' ? [workspaceOption, userOption] : [userOption, workspaceOption];
    const picked = await vscode.window.showQuickPick(choices, {
      title: 'Where should RosTooling save plugin settings?',
      placeHolder: 'Select settings scope',
      ignoreFocusOut: true,
    });
    return picked?.target;
  }

  public async promptAddPluginPath(): Promise<string | undefined> {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: 'Plugin JAR file (.jar)',
          description: 'Select an individual RosTooling plugin JAR',
          selectionKind: 'file' as const,
        },
        {
          label: 'Plugin folder',
          description: 'Select a directory containing RosTooling plugin JARs',
          selectionKind: 'folder' as const,
        },
      ],
      {
        title: 'Add RosTooling Plugin JAR or Folder',
        placeHolder: 'Choose whether to add a plugin JAR file or a folder',
      }
    );
    if (!choice) {
      return undefined;
    }
    const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const selected = await vscode.window.showOpenDialog({
      title:
        choice.selectionKind === 'file'
          ? 'Select RosTooling Plugin JAR'
          : 'Select RosTooling Plugin Folder',
      openLabel: 'Add to plugin paths',
      canSelectFiles: choice.selectionKind === 'file',
      canSelectFolders: choice.selectionKind === 'folder',
      canSelectMany: false,
      defaultUri,
      filters: choice.selectionKind === 'file' ? { 'JAR archives': ['jar'] } : undefined,
    });
    return selected?.[0]?.fsPath;
  }

  public async openPluginSettings(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', `${PLUGIN_SETTINGS_SECTION}.plugins`);
  }

  public async openTrustManagement(): Promise<void> {
    await vscode.commands.executeCommand('workbench.trust.manage');
  }

  public async openMarkdownPreview(pluginId: string, markdown: string): Promise<void> {
    const uri = this.docProvider.setDocumentation(pluginId, markdown);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
  }
}

export class PluginManagerController {
  private blockedTrustNoticeShown = false;
  private lastCoreNoticesKey = '';
  private legacyMigrationAttempted = false;

  constructor(private readonly host: PluginHostAdapter) {}

  public evaluateEffectiveConfig(logWarnings = false): EffectivePluginConfig {
    const config = computeEffectivePluginConfig({
      isTrusted: this.host.isWorkspaceTrusted(),
      workspaceDir: this.host.getWorkspaceDir(),
      pathsInspect: this.host.inspectPaths(),
      enabledInspect: this.host.inspectEnabled(),
    });
    if (logWarnings) {
      for (const w of config.warnings) {
        this.host.logWarning(w);
      }
    }
    return config;
  }

  /**
   * Perform one-time migration from user-level `plugins.trustedChecksums` into the exact
   * `trustStorePath` reported by core. Returns `true` if entries were migrated and servers
   * were restarted cleanly.
   */
  public async runLegacyMigrationOnce(): Promise<boolean> {
    if (this.legacyMigrationAttempted) {
      return false;
    }
    const legacy = this.host.getLegacyGlobalTrustedChecksums();
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy) || Object.keys(legacy).length === 0) {
      this.legacyMigrationAttempted = true;
      return false;
    }

    const resp = await this.listDiscoveredPluginsResponse();
    if (!resp.trustStorePath) {
      return false;
    }

    this.legacyMigrationAttempted = true;
    const effective = this.evaluateEffectiveConfig(false);
    try {
      const migrated = await this.host.migrateLegacyChecksums({
        legacyChecksums: legacy,
        rawPluginPaths: effective.rawPaths,
        workspaceDir: this.host.getWorkspaceDir(),
        storePath: resp.trustStorePath,
      });
      if (migrated > 0) {
        this.host.log(`Migrated ${migrated} legacy trustedChecksums entry/entries into ${resp.trustStorePath}.`);
        await this.host.refreshMcpConfigs();
        await this.host.restartServers();
        this.host.refreshPluginsView();
        return true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.host.logWarning(message);
      await this.host.showError(message);
    }
    return false;
  }

  public async notifyIfBlockedByTrustOrNotices(effective: EffectivePluginConfig): Promise<void> {
    if (effective.blockedByWorkspaceTrust && !this.blockedTrustNoticeShown) {
      this.blockedTrustNoticeShown = true;
      const choice = await this.host.showWarning(
        'Workspace RosTooling plugin settings are blocked until you trust this workspace.',
        'Manage Workspace Trust'
      );
      if (choice === 'Manage Workspace Trust') {
        await this.host.openTrustManagement();
      }
    }

    if (!this.host.isLspReady()) {
      return;
    }
    try {
      const resp = await this.listDiscoveredPluginsResponse();
      const unapprovedEnabled = resp.plugins.filter(
        (p) => p.sourceJarPath && p.approvalState !== 'approved' && (p.enabled || effective.enabledIds.includes(p.id))
      );
      const noticeKey = `${resp.notices.join('|')}#${unapprovedEnabled.map((p) => p.sha256).join(',')}`;
      if (resp.notices.length > 0 && noticeKey !== this.lastCoreNoticesKey) {
        this.lastCoreNoticesKey = noticeKey;
        for (const n of resp.notices) {
          this.host.logWarning(n);
        }
        if (unapprovedEnabled.length > 0 || effective.enabledIds.length > 0) {
          const action = await this.host.showWarning(resp.notices[0], 'Manage Plugins');
          if (action === 'Manage Plugins') {
            await this.managePlugins();
          }
        }
      }
    } catch {
      // Ignore startup query failure
    }
  }

  public async listDiscoveredPluginsResponse(): Promise<DiscoveredPluginsResponse> {
    if (!this.host.isLspReady()) {
      const becameReady = await this.host.waitForLspReady();
      if (!becameReady) {
        return { trustStorePath: '', plugins: [], notices: [] };
      }
    }
    let raw: unknown;
    try {
      raw = await this.host.sendExecuteCommand<unknown>(LIST_DISCOVERED_PLUGINS_CMD, []);
    } catch {
      return { trustStorePath: '', plugins: [], notices: [] };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { trustStorePath: '', plugins: [], notices: [] };
    }

    const obj = raw as Record<string, unknown>;
    const trustStorePath = typeof obj.trustStorePath === 'string' ? obj.trustStorePath.trim() : '';
    const rawList = Array.isArray(obj.plugins) ? obj.plugins : [];
    const notices = Array.isArray(obj.notices) ? obj.notices.map((n) => String(n)).filter(Boolean) : [];

    const plugins: DiscoveredPlugin[] = rawList
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => {
        const sourceJarPath = String(item.sourceJarPath ?? '');
        const rawState = String(item.approvalState ?? '');
        const approvalState: PluginApprovalState =
          rawState === 'approved' || rawState === 'unapproved' || rawState === 'changed'
            ? rawState
            : sourceJarPath
              ? 'unapproved'
              : 'approved';
        const fileName = String(
          item.fileName ?? (sourceJarPath ? path.basename(sourceJarPath) : '')
        );
        return {
          id: String(item.id ?? ''),
          version: String(item.version ?? ''),
          summary: String(item.summary ?? ''),
          supportedCoreVersionRange: String(item.supportedCoreVersionRange ?? ''),
          compatible: Boolean(item.compatible),
          enabled: Boolean(item.enabled),
          active: Boolean(item.active),
          sourceJarPath,
          loadError: String(item.loadError ?? ''),
          fileName,
          sha256: String(item.sha256 ?? ''),
          approvalState,
        };
      });

    return { trustStorePath, plugins, notices };
  }

  public async listDiscoveredPlugins(): Promise<DiscoveredPlugin[]> {
    const resp = await this.listDiscoveredPluginsResponse();
    return resp.plugins;
  }

  public async managePlugins(): Promise<void> {
    if (!this.host.isLspReady()) {
      const ready = await this.host.waitForLspReady();
      if (!ready) {
        const choice = await this.host.showInfo(
          'RosTooling language server is not running yet. Open a ROS model or wait for startup to finish before managing plugins.',
          'Open Plugin Settings'
        );
        if (choice === 'Open Plugin Settings') {
          await this.host.openPluginSettings();
        }
        return;
      }
    }

    const effective = this.evaluateEffectiveConfig(false);
    const { trustStorePath, plugins } = await this.listDiscoveredPluginsResponse();

    const items: PluginQuickPickItem[] = plugins.map((plugin) => {
      const isIncompatible = !plugin.compatible;
      const isUnapprovedActivationMsg =
        Boolean(plugin.sourceJarPath) &&
        plugin.approvalState !== 'approved' &&
        (plugin.loadError.includes('unapproved') || plugin.loadError.includes('changed'));
      const hasBlockingError = plugin.loadError !== '' && !isUnapprovedActivationMsg;
      const tickable = Boolean(plugin.id) && !isIncompatible && !hasBlockingError;
      const fileLabel = plugin.fileName || (plugin.sourceJarPath ? path.basename(plugin.sourceJarPath) : '');

      const untickReason = !plugin.id
        ? `Unlabeled JAR '${fileLabel}' (${plugin.approvalState}). Use Approve JAR in the RosTooling Plugins view and configure its ID in settings.`
        : hasBlockingError
          ? `Plugin '${plugin.id}' failed to load: ${plugin.loadError}`
          : isIncompatible
            ? `Plugin '${plugin.id}' requires RosTooling core ${plugin.supportedCoreVersionRange}.`
            : '';

      const statusParts: string[] = [];
      if (plugin.version) {
        statusParts.push(`v${plugin.version}`);
      }
      if (hasBlockingError) {
        statusParts.push(`Error: ${plugin.loadError}`);
      } else if (isIncompatible) {
        statusParts.push(`Incompatible (requires ${plugin.supportedCoreVersionRange})`);
      } else if (plugin.sourceJarPath && plugin.approvalState === 'changed') {
        statusParts.push('Changed — confirm to re-enable');
      } else if (plugin.sourceJarPath && plugin.approvalState === 'unapproved') {
        statusParts.push('Unapproved — confirm to enable');
      } else if (plugin.active) {
        statusParts.push('Active');
      } else if (plugin.enabled) {
        statusParts.push('Enabled');
      } else {
        statusParts.push('Disabled');
      }

      const jarParts: string[] = [];
      if (fileLabel) {
        jarParts.push(fileLabel);
      }
      if (plugin.sha256) {
        jarParts.push(`sha256:${plugin.sha256.slice(0, 12)}…`);
      }
      if (plugin.sourceJarPath) {
        jarParts.push(`JAR: ${plugin.sourceJarPath}`);
      } else {
        jarParts.push('Source: Built-in / Classpath');
      }
      const jarLine = jarParts.join(' · ');
      const detail = plugin.summary ? `${plugin.summary} — ${jarLine}` : jarLine;

      return {
        label: plugin.id || fileLabel || '(plugin without metadata)',
        description: statusParts.join(' · '),
        detail,
        picked:
          tickable &&
          plugin.approvalState === 'approved' &&
          (effective.enabledIds.includes(plugin.id) || plugin.active),
        plugin,
        tickable,
        untickReason,
      };
    });

    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      {
        label: 'Add plugin JAR or folder…',
        description: 'Configure ros plugin path',
        detail: 'Select a plugin .jar file or directory to scan for RosTooling plugins',
        action: 'addPath',
        tickable: true,
      },
      {
        label: 'Open plugin settings',
        description: 'Edit rostooling-languages.plugins.* in VS Code Settings',
        action: 'openSettings',
        tickable: true,
      }
    );

    const selection = await this.host.pickQuickPick(items, {
      title: 'Manage RosTooling Plugins',
      placeholder:
        plugins.length === 0
          ? 'No plugins discovered in configured paths. Choose "Add plugin JAR or folder…".'
          : 'Select plugins to enable (incompatible or failed entries cannot be ticked)',
      untickableError: 'This plugin cannot be enabled due to incompatibility or a load error.',
    });
    if (!selection) {
      return;
    }

    const chosenAction = selection.find((s) => s.action)?.action;
    if (chosenAction === 'openSettings') {
      await this.host.openPluginSettings();
      return;
    }
    if (chosenAction === 'addPath') {
      await this.addPluginPathFlow(effective);
      return;
    }

    const nextEnabledIds = selection
      .map((s) => s.plugin?.id)
      .filter((id): id is string => Boolean(id));

    const approvedOk = await this.confirmApprovalsForEnabledIds(
      nextEnabledIds,
      plugins,
      trustStorePath
    );
    if (!approvedOk) {
      return;
    }

    const hadUnapprovedPreviously = plugins.some(
      (p) => nextEnabledIds.includes(p.id) && p.sourceJarPath && p.approvalState !== 'approved'
    );
    const unchanged =
      nextEnabledIds.length === effective.enabledIds.length &&
      nextEnabledIds.every((id, idx) => id === effective.enabledIds[idx]);
    if (unchanged && !hadUnapprovedPreviously) {
      return;
    }

    if (!unchanged) {
      const preferredSource =
        effective.enabledSource !== 'none' ? effective.enabledSource : effective.pathsSource;
      const scope = await this.host.pickScope(preferredSource);
      if (!scope) {
        return;
      }
      await this.host.updatePluginsSetting('plugins.enabled', nextEnabledIds, scope);
    }

    await this.host.refreshMcpConfigs();
    await this.host.restartServers();
    this.host.refreshPluginsView();
  }

  public async approvePluginJarCommand(plugin: DiscoveredPlugin): Promise<void> {
    const resp = await this.listDiscoveredPluginsResponse();
    if (!resp.trustStorePath) {
      await this.host.showError(
        'Cannot approve plugin JAR: RosTooling language server is not running or did not report trustStorePath.'
      );
      return;
    }
    const confirmed = await this.confirmAndApproveJar(plugin, resp.trustStorePath);
    if (!confirmed) {
      return;
    }
    await this.host.refreshMcpConfigs();
    await this.host.restartServers();
    this.host.refreshPluginsView();
  }

  public async enableSinglePlugin(plugin: DiscoveredPlugin): Promise<void> {
    if (!plugin.id) {
      await this.host.showWarning(plugin.loadError || NO_METADATA_LOAD_ERROR);
      return;
    }
    if (!plugin.compatible) {
      await this.host.showWarning(
        `Plugin '${plugin.id}' requires RosTooling core ${plugin.supportedCoreVersionRange} and cannot be enabled.`
      );
      return;
    }
    const isUnapprovedActivationMsg =
      Boolean(plugin.sourceJarPath) &&
      plugin.approvalState !== 'approved' &&
      (plugin.loadError.includes('unapproved') || plugin.loadError.includes('changed'));
    if (plugin.loadError && !isUnapprovedActivationMsg) {
      await this.host.showWarning(`Plugin '${plugin.id}' has a load error: ${plugin.loadError}`);
      return;
    }

    const effective = this.evaluateEffectiveConfig(false);
    if (plugin.sourceJarPath && plugin.approvalState !== 'approved') {
      const resp = await this.listDiscoveredPluginsResponse();
      if (!resp.trustStorePath) {
        await this.host.showError(
          'Cannot approve plugin JAR: RosTooling language server is not running or did not report trustStorePath.'
        );
        return;
      }
      const confirmed = await this.confirmAndApproveJar(plugin, resp.trustStorePath);
      if (!confirmed) {
        return;
      }
    }

    const nextIds = normalizePluginSettingList([...effective.enabledIds, plugin.id]);
    const preferredSource =
      effective.enabledSource !== 'none' ? effective.enabledSource : effective.pathsSource;
    const scope = await this.host.pickScope(preferredSource);
    if (!scope) {
      return;
    }

    await this.host.updatePluginsSetting('plugins.enabled', nextIds, scope);
    await this.host.refreshMcpConfigs();
    await this.host.restartServers();
    this.host.refreshPluginsView();
  }

  public async disableSinglePlugin(plugin: DiscoveredPlugin): Promise<void> {
    if (!plugin.id) {
      return;
    }
    const effective = this.evaluateEffectiveConfig(false);
    const nextIds = effective.enabledIds.filter((id) => id !== plugin.id);
    const preferredSource =
      effective.enabledSource !== 'none' ? effective.enabledSource : effective.pathsSource;
    const scope = await this.host.pickScope(preferredSource);
    if (!scope) {
      return;
    }

    await this.host.updatePluginsSetting('plugins.enabled', nextIds, scope);
    await this.host.refreshMcpConfigs();
    await this.host.restartServers();
    this.host.refreshPluginsView();
  }

  public async showPluginLoadError(plugin: DiscoveredPlugin): Promise<void> {
    const label = plugin.id || plugin.fileName || path.basename(plugin.sourceJarPath) || 'plugin';
    const message = plugin.loadError
      ? `${label}: ${plugin.loadError}`
      : !plugin.compatible
        ? `${label}: incompatible with current core (requires ${plugin.supportedCoreVersionRange})`
        : `${label}: no load error recorded`;
    await this.host.showError(message);
  }

  public async openPluginDocumentation(plugin: DiscoveredPlugin): Promise<void> {
    if (!plugin.id) {
      await this.host.showInfo(
        'Documentation preview requires a plugin id in META-INF/rostooling-plugin.properties.'
      );
      return;
    }
    if (!this.host.isLspReady()) {
      const ready = await this.host.waitForLspReady();
      if (!ready) {
        await this.host.showInfo('RosTooling language server is not running yet.');
        return;
      }
    }
    const res = await this.host.sendExecuteCommand<{ id?: string; documentationMarkdown?: string }>(
      GET_PLUGIN_DOCUMENTATION_CMD,
      [plugin.id]
    );
    const markdown = String(res?.documentationMarkdown ?? '').trim();
    if (!markdown) {
      await this.host.showInfo(`No documentation provided by plugin '${plugin.id}'.`);
      return;
    }
    await this.host.openMarkdownPreview(plugin.id, markdown);
  }

  private async addPluginPathFlow(effective: EffectivePluginConfig): Promise<void> {
    const pickedPath = await this.host.promptAddPluginPath();
    if (!pickedPath) {
      return;
    }
    const preferredSource =
      effective.pathsSource !== 'none' ? effective.pathsSource : effective.enabledSource;
    const scope = await this.host.pickScope(preferredSource);
    if (!scope) {
      return;
    }
    const currentInspect = this.host.inspectPaths();
    const existingRaw =
      scope === 'workspace'
        ? normalizePluginSettingList(currentInspect?.workspaceValue)
        : normalizePluginSettingList(currentInspect?.globalValue);
    const updatedPaths = normalizePluginSettingList([...existingRaw, pickedPath]);
    await this.host.updatePluginsSetting('plugins.paths', updatedPaths, scope);
    await this.host.refreshMcpConfigs();
    await this.host.restartServers();
    this.host.refreshPluginsView();
    await this.managePlugins();
  }

  private async confirmApprovalsForEnabledIds(
    targetIds: string[],
    plugins: DiscoveredPlugin[],
    trustStorePath: string
  ): Promise<boolean> {
    const byId = new Map<string, DiscoveredPlugin>();
    for (const p of plugins) {
      if (p.id && !byId.has(p.id)) {
        byId.set(p.id, p);
      }
    }
    for (const id of targetIds) {
      const plugin = byId.get(id);
      if (plugin && plugin.sourceJarPath && plugin.approvalState !== 'approved') {
        const ok = await this.confirmAndApproveJar(plugin, trustStorePath);
        if (!ok) {
          return false;
        }
      }
    }
    return true;
  }

  private async confirmAndApproveJar(
    plugin: DiscoveredPlugin,
    trustStorePath: string
  ): Promise<boolean> {
    if (!plugin.sourceJarPath || plugin.approvalState === 'approved') {
      return true;
    }
    if (!trustStorePath || !trustStorePath.trim()) {
      await this.host.showError(
        'Cannot approve plugin JAR: RosTooling language server did not report an approval file path.'
      );
      return false;
    }
    const fileName = plugin.fileName || path.basename(plugin.sourceJarPath);
    const sha256 = plugin.sha256;
    if (!sha256) {
      await this.host.showError(`Unable to approve '${fileName}': SHA-256 fingerprint unavailable from core.`);
      return false;
    }

    const isChange = plugin.approvalState === 'changed';
    const labelName = plugin.id || fileName;
    const header = isChange
      ? `JAR '${fileName}' for RosTooling plugin '${labelName}' has changed. Approve this JAR?`
      : `Approve RosTooling plugin JAR '${fileName}'?`;
    const detail = [
      `File: ${fileName}`,
      `Plugin ID: ${plugin.id || '(unlabeled)'}`,
      `Version: ${plugin.version || '(unspecified)'}`,
      `JAR path: ${plugin.sourceJarPath}`,
      `SHA-256: ${sha256}`,
      '',
      PLUGIN_TRUST_WARNING,
    ].join('\n');

    const accepted = await this.host.showModalConfirm(
      header,
      detail,
      isChange ? 'Approve Changed JAR' : 'Approve JAR'
    );
    if (!accepted) {
      return false;
    }
    try {
      await this.host.approvePluginJar(trustStorePath, {
        sha256,
        fileName,
        id: plugin.id,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.host.showError(msg);
      return false;
    }
  }
}
