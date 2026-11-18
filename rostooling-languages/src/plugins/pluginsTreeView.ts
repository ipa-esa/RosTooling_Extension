import * as path from 'node:path';
import * as vscode from 'vscode';
import { PluginManagerController } from './pluginManager.js';
import { DiscoveredPlugin, EffectivePluginConfig } from './pluginTrust.js';

export type PluginTreeContextValue =
  | 'pluginEnabled'
  | 'pluginDisabled'
  | 'pluginFailed'
  | 'pluginIncompatible'
  | 'pluginNotice'
  | 'pluginEmpty';

export interface PluginTreeNodeDescriptor {
  label: string;
  description: string;
  tooltip: string;
  iconId: string;
  contextValue: PluginTreeContextValue;
  plugin?: DiscoveredPlugin;
  command?: vscode.Command;
}

/**
 * Pure descriptor builder shared between the Explorer TreeDataProvider and Mocha tests.
 * Uses plain strings only (never raw Markdown/HTML).
 */
export function buildPluginTreeDescriptors(
  plugins: readonly DiscoveredPlugin[],
  effective: EffectivePluginConfig
): PluginTreeNodeDescriptor[] {
  const nodes: PluginTreeNodeDescriptor[] = [];

  if (effective.blockedByWorkspaceTrust) {
    nodes.push({
      label: 'Workspace plugin settings blocked',
      description: 'Untrusted workspace',
      tooltip:
        'Workspace RosTooling plugin settings in .vscode/settings.json are ignored while this workspace is untrusted. Trust the workspace to use them.',
      iconId: 'shield',
      contextValue: 'pluginNotice',
      command: {
        command: 'workbench.trust.manage',
        title: 'Manage Workspace Trust',
      },
    });
  }

  for (const plugin of plugins) {
    const label = plugin.id || path.basename(plugin.sourceJarPath) || '(plugin without metadata)';
    const versionPart = plugin.version ? `v${plugin.version}` : '';
    const changedChecksum = Boolean(plugin.id && effective.changedChecksumIds.includes(plugin.id));
    const untrustedChecksum = Boolean(plugin.id && effective.untrustedChecksumIds.includes(plugin.id));

    let statusText: string;
    let iconId: string;
    let contextValue: PluginTreeContextValue;

    if (plugin.loadError) {
      statusText = `Failed: ${plugin.loadError}`;
      iconId = 'warning';
      contextValue = 'pluginFailed';
    } else if (!plugin.compatible) {
      statusText = `Incompatible (${plugin.supportedCoreVersionRange || 'version mismatch'})`;
      iconId = 'error';
      contextValue = 'pluginIncompatible';
    } else if (changedChecksum) {
      statusText = 'Checksum changed — re-confirm';
      iconId = 'shield';
      contextValue = 'pluginDisabled';
    } else if (untrustedChecksum) {
      statusText = 'Confirmation required';
      iconId = 'shield';
      contextValue = 'pluginDisabled';
    } else if (plugin.active || (plugin.id && effective.approvedEnabledIds.includes(plugin.id))) {
      statusText = 'Enabled';
      iconId = 'pass-filled';
      contextValue = 'pluginEnabled';
    } else {
      statusText = 'Disabled';
      iconId = 'circle-large-outline';
      contextValue = 'pluginDisabled';
    }

    const description = [versionPart, statusText].filter(Boolean).join(' · ');
    const tooltipLines = [
      `${label}${plugin.version ? ` (${plugin.version})` : ''}`,
      `Status: ${statusText}`,
    ];
    if (plugin.summary) {
      tooltipLines.push(`Summary: ${plugin.summary}`);
    }
    if (plugin.supportedCoreVersionRange) {
      tooltipLines.push(`Supported Core: ${plugin.supportedCoreVersionRange}`);
    }
    tooltipLines.push(
      plugin.sourceJarPath ? `JAR: ${plugin.sourceJarPath}` : 'Source: Built-in / Classpath'
    );
    if (plugin.loadError) {
      tooltipLines.push(`Error: ${plugin.loadError}`);
    }

    nodes.push({
      label,
      description,
      tooltip: tooltipLines.join('\n'),
      iconId,
      contextValue,
      plugin,
    });
  }

  if (nodes.length === 0) {
    nodes.push({
      label: 'No RosTooling plugins found',
      description: 'Click to add or manage plugins',
      tooltip: 'Configure rostooling-languages.plugins.paths via Manage Plugins.',
      iconId: 'extensions',
      contextValue: 'pluginEmpty',
      command: {
        command: 'rostooling.managePlugins',
        title: 'Manage Plugins',
      },
    });
  }

  return nodes;
}

export class PluginTreeItem extends vscode.TreeItem {
  public readonly plugin?: DiscoveredPlugin;

  constructor(descriptor: PluginTreeNodeDescriptor) {
    super(descriptor.label, vscode.TreeItemCollapsibleState.None);
    this.description = descriptor.description;
    this.tooltip = descriptor.tooltip;
    this.iconPath = new vscode.ThemeIcon(descriptor.iconId);
    this.contextValue = descriptor.contextValue;
    this.plugin = descriptor.plugin;
    if (descriptor.command) {
      this.command = descriptor.command;
    }
  }
}

export class PluginsTreeDataProvider implements vscode.TreeDataProvider<PluginTreeItem> {
  private readonly emitter = new vscode.EventEmitter<PluginTreeItem | undefined>();
  public readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly controller: PluginManagerController) {}

  public refresh(): void {
    this.emitter.fire(undefined);
  }

  public getTreeItem(element: PluginTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: PluginTreeItem): Promise<PluginTreeItem[]> {
    if (element) {
      return [];
    }
    const effective = this.controller.evaluateEffectiveConfig(false);
    const plugins = await this.controller.listDiscoveredPlugins();
    const descriptors = buildPluginTreeDescriptors(plugins, effective);
    return descriptors.map((d) => new PluginTreeItem(d));
  }

  public dispose(): void {
    this.emitter.dispose();
  }
}
