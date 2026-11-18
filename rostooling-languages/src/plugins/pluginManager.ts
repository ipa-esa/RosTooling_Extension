import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  collectPluginJarFiles,
  computeFileSha256,
  normalizePluginSettingList,
} from './pluginPaths.js';
import {
  computeEffectivePluginConfig,
  ConfigInspectLike,
  DiscoveredPlugin,
  EffectivePluginConfig,
  normalizeTrustedChecksums,
  SettingScopeSource,
} from './pluginTrust.js';

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
  getGlobalTrustedChecksums(): Record<string, string>;
  setGlobalTrustedChecksum(pluginId: string, sha256: string): Promise<void>;
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

  public getGlobalTrustedChecksums(): Record<string, string> {
    const inspect = vscode.workspace
      .getConfiguration(PLUGIN_SETTINGS_SECTION)
      .inspect<Record<string, string>>('plugins.trustedChecksums');
    return normalizeTrustedChecksums(inspect?.globalValue);
  }

  public async setGlobalTrustedChecksum(pluginId: string, sha256: string): Promise<void> {
    this.callbacks.beginInternalConfigUpdate();
    const current = this.getGlobalTrustedChecksums();
    current[pluginId] = sha256.toLowerCase();
    await vscode.workspace
      .getConfiguration(PLUGIN_SETTINGS_SECTION)
      .update('plugins.trustedChecksums', current, vscode.ConfigurationTarget.Global);
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
  private unconfirmedNoticeKey = '';

  constructor(private readonly host: PluginHostAdapter) {}

  public evaluateEffectiveConfig(logWarnings = false): EffectivePluginConfig {
    const config = computeEffectivePluginConfig({
      isTrusted: this.host.isWorkspaceTrusted(),
      workspaceDir: this.host.getWorkspaceDir(),
      pathsInspect: this.host.inspectPaths(),
      enabledInspect: this.host.inspectEnabled(),
      trustedChecksums: this.host.getGlobalTrustedChecksums(),
    });
    if (logWarnings) {
      for (const w of config.warnings) {
        this.host.logWarning(w);
      }
    }
    return config;
  }

  public async notifyIfBlockedByTrustOrChecksum(effective: EffectivePluginConfig): Promise<void> {
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

    const pendingIds = [...effective.untrustedChecksumIds, ...effective.changedChecksumIds];
    const key = `${effective.untrustedChecksumIds.join(',')}|${effective.changedChecksumIds.join(',')}`;
    if (pendingIds.length > 0 && key !== this.unconfirmedNoticeKey) {
      this.unconfirmedNoticeKey = key;
      const parts: string[] = [];
      if (effective.untrustedChecksumIds.length > 0) {
        parts.push(`awaiting trust confirmation: ${effective.untrustedChecksumIds.join(', ')}`);
      }
      if (effective.changedChecksumIds.length > 0) {
        parts.push(`JAR checksum changed (re-confirm required): ${effective.changedChecksumIds.join(', ')}`);
      }
      const action = await this.host.showWarning(
        `RosTooling plugins blocked (${parts.join('; ')}). Open Manage Plugins to review and confirm.`,
        'Manage Plugins'
      );
      if (action === 'Manage Plugins') {
        await this.managePlugins();
      }
    } else if (pendingIds.length === 0) {
      this.unconfirmedNoticeKey = '';
    }
  }

  public async listDiscoveredPlugins(): Promise<DiscoveredPlugin[]> {
    if (!this.host.isLspReady()) {
      const becameReady = await this.host.waitForLspReady();
      if (!becameReady) {
        return [];
      }
    }
    const raw = await this.host.sendExecuteCommand<unknown>(LIST_DISCOVERED_PLUGINS_CMD, []);
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        id: String(item.id ?? ''),
        version: String(item.version ?? ''),
        summary: String(item.summary ?? ''),
        supportedCoreVersionRange: String(item.supportedCoreVersionRange ?? ''),
        compatible: Boolean(item.compatible),
        enabled: Boolean(item.enabled),
        active: Boolean(item.active),
        sourceJarPath: String(item.sourceJarPath ?? ''),
        loadError: String(item.loadError ?? ''),
      }));
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
    const plugins = await this.listDiscoveredPlugins();
    const pendingTrustSet = new Set([...effective.untrustedChecksumIds, ...effective.changedChecksumIds]);

    const items: PluginQuickPickItem[] = plugins.map((plugin) => {
      const isIncompatible = !plugin.compatible;
      const hasError = plugin.loadError !== '';
      const tickable = Boolean(plugin.id) && !isIncompatible && !hasError;
      const untickReason = !plugin.id
        ? plugin.loadError || NO_METADATA_LOAD_ERROR
        : hasError
          ? `Plugin '${plugin.id}' failed to load: ${plugin.loadError}`
          : isIncompatible
            ? `Plugin '${plugin.id}' requires RosTooling core ${plugin.supportedCoreVersionRange}.`
            : '';

      const statusParts: string[] = [];
      if (plugin.version) {
        statusParts.push(`v${plugin.version}`);
      }
      if (hasError) {
        statusParts.push(`Error: ${plugin.loadError}`);
      } else if (isIncompatible) {
        statusParts.push(`Incompatible (requires ${plugin.supportedCoreVersionRange})`);
      } else if (effective.changedChecksumIds.includes(plugin.id)) {
        statusParts.push('Checksum changed — confirm to re-enable');
      } else if (effective.untrustedChecksumIds.includes(plugin.id)) {
        statusParts.push('Confirmation required');
      } else if (plugin.active) {
        statusParts.push('Active');
      } else if (plugin.enabled) {
        statusParts.push('Enabled');
      } else {
        statusParts.push('Disabled');
      }

      const jarLine = plugin.sourceJarPath
        ? `JAR: ${plugin.sourceJarPath}`
        : 'Source: Built-in / Classpath';
      const detail = plugin.summary ? `${plugin.summary} — ${jarLine}` : jarLine;

      return {
        label: plugin.id || path.basename(plugin.sourceJarPath) || '(plugin without metadata)',
        description: statusParts.join(' · '),
        detail,
        picked:
          tickable &&
          (effective.approvedEnabledIds.includes(plugin.id) || (plugin.active && !pendingTrustSet.has(plugin.id))),
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

    const approvedFinalIds = await this.confirmChecksumsForEnabledIds(nextEnabledIds, plugins, effective);
    if (!approvedFinalIds) {
      return;
    }

    // Preserve any explicitly entered non-discovered IDs unless user removed everything? Only discovered IDs are controlled here;
    // keep order de-duplicated.
    const unchanged =
      approvedFinalIds.length === effective.approvedEnabledIds.length &&
      approvedFinalIds.every((id, idx) => id === effective.approvedEnabledIds[idx]);
    if (unchanged && effective.untrustedChecksumIds.length === 0 && effective.changedChecksumIds.length === 0) {
      return;
    }

    const preferredSource =
      effective.enabledSource !== 'none' ? effective.enabledSource : effective.pathsSource;
    const scope = await this.host.pickScope(preferredSource);
    if (!scope) {
      return;
    }

    await this.host.updatePluginsSetting('plugins.enabled', approvedFinalIds, scope);
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
    if (plugin.loadError) {
      await this.host.showWarning(`Plugin '${plugin.id}' has a load error: ${plugin.loadError}`);
      return;
    }

    const effective = this.evaluateEffectiveConfig(false);
    const confirmed = await this.confirmPluginJarChecksum(plugin);
    if (!confirmed) {
      return;
    }

    const nextIds = normalizePluginSettingList([...effective.rawEnabledIds, plugin.id]);
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
    const nextIds = effective.rawEnabledIds.filter((id) => id !== plugin.id);
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
    const label = plugin.id || path.basename(plugin.sourceJarPath) || 'plugin';
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

  private async confirmChecksumsForEnabledIds(
    targetIds: string[],
    plugins: DiscoveredPlugin[],
    effective: EffectivePluginConfig
  ): Promise<string[] | undefined> {
    const trusted = this.host.getGlobalTrustedChecksums();
    const byId = new Map<string, DiscoveredPlugin>();
    for (const p of plugins) {
      if (p.id && !byId.has(p.id)) {
        byId.set(p.id, p);
      }
    }

    const approved: string[] = [];
    for (const id of targetIds) {
      const plugin = byId.get(id);
      if (plugin) {
        const ok = await this.confirmPluginJarChecksum(plugin, trusted);
        if (!ok) {
          return undefined;
        }
        approved.push(id);
      } else if (effective.approvedEnabledIds.includes(id)) {
        approved.push(id);
      }
    }
    return approved;
  }

  private async confirmPluginJarChecksum(
    plugin: DiscoveredPlugin,
    trustedMap = this.host.getGlobalTrustedChecksums()
  ): Promise<boolean> {
    const jarPath = plugin.sourceJarPath || this.findFallbackNoMetaJar(plugin.id);
    if (!jarPath) {
      return true;
    }
    let sha256: string;
    try {
      sha256 = computeFileSha256(jarPath);
    } catch (err) {
      await this.host.showError(`Unable to compute SHA-256 checksum for '${jarPath}': ${String(err)}`);
      return false;
    }
    const recorded = trustedMap[plugin.id];
    if (recorded && recorded.toLowerCase() === sha256.toLowerCase()) {
      return true;
    }

    const isChange = Boolean(recorded);
    const header = isChange
      ? `The JAR checksum for RosTooling plugin '${plugin.id}' has changed. Confirm enabling this plugin?`
      : `Enable RosTooling plugin '${plugin.id}'?`;
    const detail = [
      `Plugin ID: ${plugin.id}`,
      `Version: ${plugin.version || '(unspecified)'}`,
      `JAR path: ${jarPath}`,
      `SHA-256: ${sha256}`,
      ...(isChange ? [`Previous SHA-256: ${recorded}`] : []),
      '',
      PLUGIN_TRUST_WARNING,
    ].join('\n');

    const accepted = await this.host.showModalConfirm(
      header,
      detail,
      isChange ? 'Confirm New Checksum & Enable' : 'Trust & Enable'
    );
    if (!accepted) {
      return false;
    }
    await this.host.setGlobalTrustedChecksum(plugin.id, sha256);
    trustedMap[plugin.id] = sha256.toLowerCase();
    return true;
  }

  private findFallbackNoMetaJar(pluginId: string): string | undefined {
    const effective = this.evaluateEffectiveConfig(false);
    const jars = collectPluginJarFiles(effective.resolvedPaths);
    if (jars.length === 1 && pluginId) {
      return jars[0];
    }
    return undefined;
  }
}
