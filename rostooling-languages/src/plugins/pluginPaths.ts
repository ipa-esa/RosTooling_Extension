import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PluginPathResolutionOptions {
  workspaceDir?: string;
  onWarning?: (warning: string) => void;
}

/**
 * Normalize an arbitrary setting value into a de-duplicated list of trimmed non-empty strings.
 */
export function normalizePluginSettingList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Shared path resolver used identically by the VS Code LSP client, GLSP bridge,
 * headless MCP client, and AgentSkillInstaller MCP config writer.
 *
 * Supports absolute paths, paths relative to the first workspace folder, and `${workspaceFolder}`
 * substitution. Non-existent paths emit a warning via `onWarning` rather than throwing.
 */
export function resolvePluginPaths(
  rawPaths: readonly string[],
  options: PluginPathResolutionOptions = {}
): string[] {
  const { workspaceDir, onWarning } = options;
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const rawEntry of rawPaths) {
    const trimmed = String(rawEntry ?? '').trim();
    if (!trimmed) {
      continue;
    }

    let expanded = trimmed;
    if (expanded.includes('${workspaceFolder}')) {
      if (!workspaceDir) {
        onWarning?.(`Skipping plugin path '${trimmed}': no workspace folder open to resolve \${workspaceFolder}.`);
        continue;
      }
      expanded = expanded.split('${workspaceFolder}').join(workspaceDir);
    }

    let normalized: string;
    if (path.isAbsolute(expanded)) {
      normalized = path.normalize(expanded);
    } else {
      if (!workspaceDir) {
        onWarning?.(`Skipping relative plugin path '${trimmed}': no workspace folder open.`);
        continue;
      }
      normalized = path.resolve(workspaceDir, expanded);
    }

    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    if (!fs.existsSync(normalized)) {
      onWarning?.(`Configured plugin path does not exist: ${normalized}`);
    }
    resolved.push(normalized);
  }

  return resolved;
}

/**
 * Collect candidate `.jar` files from already-resolved plugin files and directories
 * (single directory level, matching Java PluginRegistry.collectJarPaths).
 */
export function collectPluginJarFiles(resolvedPaths: readonly string[]): string[] {
  const jars: string[] = [];
  const seen = new Set<string>();

  for (const p of resolvedPaths) {
    try {
      if (!fs.existsSync(p)) {
        continue;
      }
      const stat = fs.statSync(p);
      if (stat.isFile() && p.endsWith('.jar')) {
        const norm = path.resolve(p);
        if (!seen.has(norm)) {
          seen.add(norm);
          jars.push(norm);
        }
      } else if (stat.isDirectory()) {
        const entries = fs.readdirSync(p).sort();
        for (const entry of entries) {
          if (!entry.endsWith('.jar')) {
            continue;
          }
          const full = path.resolve(p, entry);
          try {
            if (fs.statSync(full).isFile() && !seen.has(full)) {
              seen.add(full);
              jars.push(full);
            }
          } catch {
            // Ignore unreadable entry
          }
        }
      }
    } catch {
      // Ignore unreadable path
    }
  }

  return jars;
}

/**
 * Compute lowercase hex SHA-256 checksum of a file.
 */
export function computeFileSha256(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Build CLI flags passed to `bin/rostooling-mcp.js` when plugin settings are active,
 * or an empty array when no plugins are configured/trusted.
 */
export function buildMcpPluginCliArgs(resolvedPaths: readonly string[], enabledIds: readonly string[]): string[] {
  const pathsArg = resolvedPaths.filter(Boolean).join(path.delimiter);
  const enabledArg = enabledIds.filter(Boolean).join(',');
  if (!pathsArg || !enabledArg) {
    return [];
  }
  return ['--plugins-dir', pathsArg, '--enable-plugins', enabledArg];
}
