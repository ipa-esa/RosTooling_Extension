import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  collectPluginJarFiles,
  computeFileSha256,
  normalizePluginSettingList,
  resolvePluginPaths,
} from './pluginPaths.js';

export interface TrustedPluginEntry {
  sha256: string;
  fileName: string;
  id: string;
  approvedAt: string;
}

export interface TrustedPluginsFile {
  version: 1;
  approved: TrustedPluginEntry[];
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export function defaultTrustStorePath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.rostooling', 'trusted-plugins.json');
}

/**
 * Read an existing `trusted-plugins.json` file; returns an empty v1 structure if missing or invalid.
 */
export function readTrustedPluginsFile(storePath: string): TrustedPluginsFile {
  try {
    if (!fs.existsSync(storePath)) {
      return { version: 1, approved: [] };
    }
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { version: 1, approved: [] };
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== 1 || !Array.isArray(obj.approved)) {
      return { version: 1, approved: [] };
    }
    const entries: TrustedPluginEntry[] = [];
    for (const item of obj.approved) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const rec = item as Record<string, unknown>;
      const sha = typeof rec.sha256 === 'string' ? rec.sha256.trim().toLowerCase() : '';
      if (!SHA256_HEX_RE.test(sha)) {
        continue;
      }
      entries.push({
        sha256: sha,
        fileName: typeof rec.fileName === 'string' ? rec.fileName.trim() : '',
        id: typeof rec.id === 'string' ? rec.id.trim() : '',
        approvedAt: typeof rec.approvedAt === 'string' ? rec.approvedAt.trim() : '',
      });
    }
    return { version: 1, approved: entries };
  } catch {
    return { version: 1, approved: [] };
  }
}

/**
 * Atomically write `trusted-plugins.json` (temp file in target directory followed by `renameSync`).
 */
export function writeTrustedPluginsFileAtomic(storePath: string, data: TrustedPluginsFile): void {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpName = `.trusted-plugins.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tmpPath = path.join(dir, tmpName);
  const payload = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, storePath);
}

/**
 * Append a single verified JAR fingerprint entry to `trusted-plugins.json` unless its SHA-256
 * is already approved. Returns true if an entry was added.
 */
export function approveTrustedPluginEntry(
  storePath: string,
  entry: { sha256: string; fileName: string; id: string; approvedAt?: string }
): boolean {
  const sha = entry.sha256.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(sha)) {
    throw new Error(`Invalid SHA-256 fingerprint: ${entry.sha256}`);
  }
  const current = readTrustedPluginsFile(storePath);
  if (current.approved.some((e) => e.sha256 === sha)) {
    return false;
  }
  current.approved.push({
    sha256: sha,
    fileName: entry.fileName.trim(),
    id: entry.id.trim(),
    approvedAt: entry.approvedAt || new Date().toISOString(),
  });
  writeTrustedPluginsFileAtomic(storePath, current);
  return true;
}

/**
 * One-time idempotent migration from legacy user setting `rostooling-languages.plugins.trustedChecksums`
 * (`id -> sha256`) into `~/.rostooling/trusted-plugins.json`. Does not delete the legacy setting.
 */
export function migrateLegacyTrustedChecksums(options: {
  legacyChecksums: unknown;
  rawPluginPaths: unknown;
  workspaceDir?: string;
  storePath?: string;
}): number {
  const raw = options.legacyChecksums;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 0;
  }
  const pairs = Object.entries(raw as Record<string, unknown>)
    .map(([id, hash]) => ({
      id: id.trim(),
      sha256: typeof hash === 'string' ? hash.trim().toLowerCase() : '',
    }))
    .filter((p) => p.id.length > 0 && SHA256_HEX_RE.test(p.sha256));
  if (pairs.length === 0) {
    return 0;
  }

  const storePath = options.storePath || defaultTrustStorePath();
  const current = readTrustedPluginsFile(storePath);
  const existingShas = new Set(current.approved.map((e) => e.sha256));

  // Index JARs on configured paths by SHA-256 to recover fileName when present
  const resolvedPaths = resolvePluginPaths(normalizePluginSettingList(options.rawPluginPaths), {
    workspaceDir: options.workspaceDir,
  });
  const fileNameBySha = new Map<string, string>();
  for (const jarPath of collectPluginJarFiles(resolvedPaths)) {
    try {
      const sha = computeFileSha256(jarPath).toLowerCase();
      if (!fileNameBySha.has(sha)) {
        fileNameBySha.set(sha, path.basename(jarPath));
      }
    } catch {
      // Ignore unreadable JAR
    }
  }

  const now = new Date().toISOString();
  let added = 0;
  for (const { id, sha256 } of pairs) {
    if (existingShas.has(sha256)) {
      continue;
    }
    existingShas.add(sha256);
    current.approved.push({
      sha256,
      fileName: fileNameBySha.get(sha256) ?? '',
      id,
      approvedAt: now,
    });
    added += 1;
  }

  if (added > 0) {
    writeTrustedPluginsFileAtomic(storePath, current);
  }
  return added;
}
