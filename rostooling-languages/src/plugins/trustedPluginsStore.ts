import * as fs from 'node:fs';
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

export class TrustStoreError extends Error {
  constructor(public readonly storePath: string, message: string) {
    super(message);
    this.name = 'TrustStoreError';
  }
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

interface RawTrustDocument extends Record<string, unknown> {
  version: 1;
  approved: unknown[];
}

function readRawTrustedPluginsDocument(storePath: string): {
  status: 'missing' | 'valid';
  document: RawTrustDocument;
} {
  let raw: string;
  try {
    raw = fs.readFileSync(storePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { status: 'missing', document: { version: 1, approved: [] } };
    }
    throw new TrustStoreError(
      storePath,
      `Plugin approval file '${storePath}' could not be read and was not modified. Fix or remove it by hand.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TrustStoreError(
      storePath,
      `Plugin approval file '${storePath}' contains invalid JSON and was not modified. Fix or remove it by hand.`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TrustStoreError(
      storePath,
      `Plugin approval file '${storePath}' is invalid and was not modified. Fix or remove it by hand.`
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.approved)) {
    throw new TrustStoreError(
      storePath,
      `Plugin approval file '${storePath}' has unsupported version or format and was not modified. Fix or remove it by hand.`
    );
  }

  return { status: 'valid', document: obj as RawTrustDocument };
}

/**
 * Read known-valid entries from an existing `trusted-plugins.json` file; returns an empty list if missing,
 * and throws `TrustStoreError` if the file exists but is unreadable, invalid JSON, or not version 1.
 */
export function readTrustedPluginsFile(storePath: string): TrustedPluginsFile {
  const { document } = readRawTrustedPluginsDocument(storePath);
  const entries: TrustedPluginEntry[] = [];
  for (const item of document.approved) {
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
}

/**
 * Atomically write `trusted-plugins.json` (temp file in target directory followed by `renameSync`).
 */
export function writeTrustedPluginsFileAtomic(storePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpName = `.trusted-plugins.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tmpPath = path.join(dir, tmpName);
  const payload = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, storePath);
}

function documentHasSha256(document: RawTrustDocument, sha256: string): boolean {
  return document.approved.some(
    (item) =>
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).sha256 === 'string' &&
      String((item as Record<string, unknown>).sha256).trim().toLowerCase() === sha256
  );
}

/**
 * Append a single verified JAR fingerprint entry to `storePath`, preserving all existing entries
 * and unknown fields verbatim. Throws `TrustStoreError` without writing if the file exists and is
 * unreadable, corrupt JSON, or not version 1.
 */
export function approveTrustedPluginEntry(
  storePath: string,
  entry: { sha256: string; fileName: string; id: string; approvedAt?: string }
): boolean {
  if (!storePath || !storePath.trim()) {
    throw new Error('Cannot approve plugin JAR: core did not provide an approval file path.');
  }
  const sha = entry.sha256.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(sha)) {
    throw new Error(`Invalid SHA-256 fingerprint: ${entry.sha256}`);
  }

  const { document } = readRawTrustedPluginsDocument(storePath);
  if (documentHasSha256(document, sha)) {
    return false;
  }

  const updated: RawTrustDocument = {
    ...document,
    version: 1,
    approved: [
      ...document.approved,
      {
        sha256: sha,
        fileName: entry.fileName.trim(),
        id: entry.id.trim(),
        approvedAt: entry.approvedAt || new Date().toISOString(),
      },
    ],
  };
  writeTrustedPluginsFileAtomic(storePath, updated);
  return true;
}

/**
 * One-time idempotent migration from legacy user setting `rostooling-languages.plugins.trustedChecksums`
 * (`id -> sha256`) into the core-reported `storePath`. Preserves all existing entries and unknown fields,
 * and throws `TrustStoreError` without writing if `storePath` exists and is corrupt/unreadable/non-v1.
 */
export function migrateLegacyTrustedChecksums(options: {
  legacyChecksums: unknown;
  rawPluginPaths: unknown;
  workspaceDir?: string;
  storePath: string;
}): number {
  if (!options.storePath || !options.storePath.trim()) {
    throw new Error('Cannot migrate legacy plugin checksums without core trustStorePath.');
  }
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

  const { document } = readRawTrustedPluginsDocument(options.storePath);

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
  const appended: TrustedPluginEntry[] = [];
  for (const { id, sha256 } of pairs) {
    if (documentHasSha256(document, sha256) || appended.some((e) => e.sha256 === sha256)) {
      continue;
    }
    appended.push({
      sha256,
      fileName: fileNameBySha.get(sha256) ?? '',
      id,
      approvedAt: now,
    });
  }

  if (appended.length > 0) {
    writeTrustedPluginsFileAtomic(options.storePath, {
      ...document,
      version: 1,
      approved: [...document.approved, ...appended],
    });
  }
  return appended.length;
}
