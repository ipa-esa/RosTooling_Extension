/**
 * View data sent by the GLSP server in the GModel argument `viewData` (Java: RosViewData).
 * One JSON object per element, with a `version` field. It carries the plugin side of the model
 * (bases, slots, attached plugins, `@` blocks with their schema) and the GUI contributions core
 * derives for an element. The extension host, the MCP tools and the webview all read it here.
 *
 * Contributions are `{ kind, plugin, data }`, filled in by core from the plugin registry. Clients
 * pick a renderer by `kind` and skip kinds they do not know; the only kind is `badge`.
 *
 * Pure module: no vscode or Node imports, so the webview bundle can import it too.
 */

/** The view-data version this client understands. */
export const VIEW_DATA_VERSION = 1;

/** GModel argument holding the JSON view data of an element. */
export const VIEW_DATA_ARG = 'viewData';

export interface BadgeData {
  /** Short name shown in the badge. */
  label: string;
  /** Plugin id and version, shown as tooltip. */
  title: string;
}

export interface ViewContribution {
  kind: string;
  plugin: string;
  data: unknown;
}

/** JSON schema of a block, as ExtensionSchemaMapper.schemaToJsonMap writes it. */
export interface BlockSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  'x-order'?: number;
  'x-choices'?: string[];
  items?: BlockSchemaProperty;
  enum?: string[];
  properties?: Record<string, BlockSchemaProperty>;
}

export interface BlockSchema {
  name: string;
  description?: string;
  allowedLocations?: string[];
  schema?: {
    type?: string;
    title?: string;
    description?: string;
    properties?: Record<string, BlockSchemaProperty>;
    required?: string[];
  };
}

export interface ViewBlock {
  name: string;
  /** Owning plugin id, or "" when no active plugin registers the block. */
  plugin: string;
  entries: Record<string, unknown>;
  schema?: BlockSchema;
}

export interface AvailableBlock extends BlockSchema {
  plugin: string;
}

export interface ViewPluginBase {
  id: string;
  name: string;
  ref: string;
  class: string;
  header: string;
  loader: string;
  contributions: ViewContribution[];
}

export interface ViewPluginSlot {
  id: string;
  name: string;
  base: string;
  parameter: string;
  format: string;
  multiple: boolean;
  default: string;
}

export interface ViewSlotAttachment {
  slot: string;
  base: string;
  multiple: boolean;
  plugins: string[];
}

interface ViewDataBase {
  version: number;
  blocks: ViewBlock[];
  contributions: ViewContribution[];
}

export interface ViewLoader {
  id: string;
  plugin: string;
  summary: string;
}

interface RootViewDataBase extends ViewDataBase {
  availableBlocks: AvailableBlock[];
  /** Loaders registered by plugins; `pluginlib` is core's and not listed. */
  loaders: ViewLoader[];
}

/** Root of a .rossystem model: the system's own blocks. */
export interface SystemViewData extends RootViewDataBase {
  kind: 'system';
}

/** Root of a package model (.ros2/.ros1/.ros). */
export interface PackageSetViewData extends RootViewDataBase {
  kind: 'packageSet';
}

export type RootViewData = SystemViewData | PackageSetViewData;

export interface PackageViewData extends ViewDataBase {
  kind: 'package';
  pluginBases: ViewPluginBase[];
}

export interface NodeViewData extends ViewDataBase {
  kind: 'node';
  artifact: { id: string; name: string };
  pluginSlots: ViewPluginSlot[];
}

export interface PluginViewData extends ViewDataBase {
  kind: 'plugin';
  artifact: { id: string; name: string };
  implements: string;
  loader: string;
}

export interface RosNodeViewData extends ViewDataBase {
  kind: 'rosNode';
  slots: ViewSlotAttachment[];
}

export type ElementViewData = RootViewData | PackageViewData | NodeViewData | PluginViewData | RosNodeViewData;

/**
 * The view data of a GModel element, or undefined when it has none, cannot be parsed or has a
 * version this client does not know (the client then shows no plugin data rather than wrong data).
 */
export function readViewData<K extends ElementViewData['kind']>(
  el: { args?: Record<string, unknown> } | undefined | null,
  kind?: K
): Extract<ElementViewData, { kind: K }> | undefined {
  const raw = el?.args?.[VIEW_DATA_ARG];
  if (raw === undefined || raw === null || raw === '') return undefined;
  try {
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ElementViewData;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== VIEW_DATA_VERSION) return undefined;
    if (kind && parsed.kind !== kind) return undefined;
    return parsed as Extract<ElementViewData, { kind: K }>;
  } catch {
    return undefined;
  }
}

/** The badges among contributions (the only kind core produces today). */
export function badgesOf(contributions: ViewContribution[] | undefined): { plugin: string; data: BadgeData }[] {
  return (contributions || [])
    .filter((c) => c && c.kind === 'badge')
    .map((c) => ({ plugin: c.plugin, data: c.data as BadgeData }));
}
