import { normalizePluginSettingList, resolvePluginPaths } from './pluginPaths.js';

export type SettingScopeSource = 'workspace' | 'user' | 'none';
export type PluginApprovalState = 'approved' | 'unapproved' | 'changed';

export interface ConfigInspectLike<T> {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  defaultValue?: T;
}

export interface DiscoveredPlugin {
  id: string;
  version: string;
  summary: string;
  supportedCoreVersionRange: string;
  compatible: boolean;
  enabled: boolean;
  active: boolean;
  sourceJarPath: string;
  loadError: string;
  fileName: string;
  sha256: string;
  approvalState: PluginApprovalState;
}

export interface DiscoveredPluginsResponse {
  trustStorePath: string;
  plugins: DiscoveredPlugin[];
  notices: string[];
}

export interface EffectivePluginConfig {
  rawPaths: string[];
  resolvedPaths: string[];
  enabledIds: string[];
  blockedByWorkspaceTrust: boolean;
  pathsSource: SettingScopeSource;
  enabledSource: SettingScopeSource;
  warnings: string[];
}

export interface EffectivePluginConfigInput {
  isTrusted: boolean;
  workspaceDir?: string;
  pathsInspect?: ConfigInspectLike<string[]>;
  enabledInspect?: ConfigInspectLike<string[]>;
}

function inspectHasWorkspaceValue(inspect?: ConfigInspectLike<string[]>): boolean {
  if (!inspect) {
    return false;
  }
  return (
    normalizePluginSettingList(inspect.workspaceFolderValue).length > 0 ||
    normalizePluginSettingList(inspect.workspaceValue).length > 0
  );
}

function selectValueAndSource(
  inspect: ConfigInspectLike<string[]> | undefined,
  isTrusted: boolean
): { values: string[]; source: SettingScopeSource } {
  if (!inspect) {
    return { values: [], source: 'none' };
  }
  if (isTrusted) {
    if (inspect.workspaceFolderValue !== undefined) {
      return {
        values: normalizePluginSettingList(inspect.workspaceFolderValue),
        source: 'workspace',
      };
    }
    if (inspect.workspaceValue !== undefined) {
      return {
        values: normalizePluginSettingList(inspect.workspaceValue),
        source: 'workspace',
      };
    }
  }
  if (inspect.globalValue !== undefined) {
    return {
      values: normalizePluginSettingList(inspect.globalValue),
      source: 'user',
    };
  }
  return {
    values: normalizePluginSettingList(inspect.defaultValue),
    source: 'none',
  };
}

/**
 * Compute effective plugin paths and configured enabled plugin IDs while enforcing VS Code
 * Workspace Trust. JAR fingerprint verification (`approvalState`) is owned by RosTooling core.
 */
export function computeEffectivePluginConfig(input: EffectivePluginConfigInput): EffectivePluginConfig {
  const warnings: string[] = [];
  const blockedByWorkspaceTrust =
    !input.isTrusted &&
    (inspectHasWorkspaceValue(input.pathsInspect) || inspectHasWorkspaceValue(input.enabledInspect));

  const pathChoice = selectValueAndSource(input.pathsInspect, input.isTrusted);
  const enabledChoice = selectValueAndSource(input.enabledInspect, input.isTrusted);

  const resolvedPaths = resolvePluginPaths(pathChoice.values, {
    workspaceDir: input.workspaceDir,
    onWarning: (w) => warnings.push(w),
  });

  return {
    rawPaths: pathChoice.values,
    resolvedPaths,
    enabledIds: enabledChoice.values,
    blockedByWorkspaceTrust,
    pathsSource: pathChoice.source,
    enabledSource: enabledChoice.source,
    warnings,
  };
}
