import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import {
  collectPluginJarFiles,
  computeFileSha256,
  normalizePluginSettingList,
  resolvePluginPaths,
} from './pluginPaths.js';

export type SettingScopeSource = 'workspace' | 'user' | 'none';

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
}

export interface EffectivePluginConfig {
  rawPaths: string[];
  resolvedPaths: string[];
  rawEnabledIds: string[];
  approvedEnabledIds: string[];
  untrustedChecksumIds: string[];
  changedChecksumIds: string[];
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
  trustedChecksums?: Record<string, string>;
}

const METADATA_ENTRY = 'META-INF/rostooling-plugin.properties';
const MAX_METADATA_BYTES = 16 * 1024;

/**
 * Parse a Java `.properties` string into a trimmed key -> value map.
 */
export function parseSimpleProperties(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const eqIdx = line.indexOf('=');
    const colonIdx = line.indexOf(':');
    let sepIdx = -1;
    if (eqIdx >= 0 && colonIdx >= 0) {
      sepIdx = Math.min(eqIdx, colonIdx);
    } else {
      sepIdx = Math.max(eqIdx, colonIdx);
    }
    if (sepIdx <= 0) {
      continue;
    }
    const key = line.slice(0, sepIdx).trim();
    const val = line.slice(sepIdx + 1).trim();
    if (key) {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Passively read `META-INF/rostooling-plugin.properties` from a `.jar` (ZIP archive)
 * using only Node built-in `zlib`, without invoking Java or any plugin classloader.
 */
export function readJarPluginMetadataId(jarPath: string): string | null {
  try {
    const buf = fs.readFileSync(jarPath);
    if (buf.length < 22) {
      return null;
    }
    // Find End of Central Directory (0x06054b50) within last 64 KB + header
    const searchStart = Math.max(0, buf.length - 65557);
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= searchStart; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) {
      return null;
    }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdSize = buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    if (cdOffset + cdSize > buf.length) {
      return null;
    }

    let pos = cdOffset;
    for (let idx = 0; idx < totalEntries && pos + 46 <= cdOffset + cdSize; idx++) {
      if (buf.readUInt32LE(pos) !== 0x02014b50) {
        break;
      }
      const method = buf.readUInt16LE(pos + 10);
      const compSize = buf.readUInt32LE(pos + 20);
      const uncompSize = buf.readUInt32LE(pos + 24);
      const nameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const localHeaderOffset = buf.readUInt32LE(pos + 42);
      const entryName = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
      pos += 46 + nameLen + extraLen + commentLen;

      if (entryName !== METADATA_ENTRY) {
        continue;
      }
      if (uncompSize > MAX_METADATA_BYTES || localHeaderOffset + 30 > buf.length) {
        return null;
      }
      if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        return null;
      }
      const lfNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lfExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfNameLen + lfExtraLen;
      if (dataStart + compSize > buf.length) {
        return null;
      }
      const compSlice = buf.subarray(dataStart, dataStart + compSize);
      let text: string;
      if (method === 0) {
        text = compSlice.toString('utf8');
      } else if (method === 8) {
        text = zlib.inflateRawSync(compSlice, { maxOutputLength: MAX_METADATA_BYTES }).toString('utf8');
      } else {
        return null;
      }
      const props = parseSimpleProperties(text);
      return props.id ? props.id.trim() : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeTrustedChecksums(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return out;
  }
  for (const [k, v] of Object.entries(raw)) {
    if (k.trim() && typeof v === 'string' && v.trim()) {
      out[k.trim()] = v.trim().toLowerCase();
    }
  }
  return out;
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
 * Compute effective plugin paths and trusted-checksum-verified enabled plugin IDs
 * while enforcing VS Code Workspace Trust and SHA-256 checksum pinning.
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

  const trusted = normalizeTrustedChecksums(input.trustedChecksums);
  const jarFiles = collectPluginJarFiles(resolvedPaths);
  const jarByPluginId = new Map<string, { jarPath: string; sha256: string }>();
  const unattributedJars: { jarPath: string; sha256: string }[] = [];

  for (const jarPath of jarFiles) {
    try {
      const sha256 = computeFileSha256(jarPath);
      const declaredId = readJarPluginMetadataId(jarPath);
      if (declaredId) {
        if (!jarByPluginId.has(declaredId)) {
          jarByPluginId.set(declaredId, { jarPath, sha256 });
        }
      } else {
        unattributedJars.push({ jarPath, sha256 });
      }
    } catch {
      warnings.push(`Unable to hash plugin JAR: ${path.basename(jarPath)}`);
    }
  }

  const approvedEnabledIds: string[] = [];
  const untrustedChecksumIds: string[] = [];
  const changedChecksumIds: string[] = [];

  for (const id of enabledChoice.values) {
    const matchedJar = jarByPluginId.get(id);
    const recordedHash = trusted[id];
    if (matchedJar) {
      if (!recordedHash) {
        untrustedChecksumIds.push(id);
      } else if (recordedHash !== matchedJar.sha256) {
        changedChecksumIds.push(id);
      } else {
        approvedEnabledIds.push(id);
      }
      continue;
    }

    // No JAR metadata claimed `id`: if unattributed JARs exist on path, require matching hash on one of them
    if (unattributedJars.length > 0) {
      if (!recordedHash) {
        untrustedChecksumIds.push(id);
      } else if (unattributedJars.some((j) => j.sha256 === recordedHash)) {
        approvedEnabledIds.push(id);
      } else {
        changedChecksumIds.push(id);
      }
      continue;
    }

    // No external JARs on configured path -> allow non-JAR / classpath / OSGi plugin IDs if configured
    approvedEnabledIds.push(id);
  }

  return {
    rawPaths: pathChoice.values,
    resolvedPaths,
    rawEnabledIds: enabledChoice.values,
    approvedEnabledIds,
    untrustedChecksumIds,
    changedChecksumIds,
    blockedByWorkspaceTrust,
    pathsSource: pathChoice.source,
    enabledSource: enabledChoice.source,
    warnings,
  };
}
