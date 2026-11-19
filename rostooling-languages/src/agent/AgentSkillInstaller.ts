import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { buildMcpPluginCliArgs } from '../plugins/pluginPaths.js';
import { computeEffectivePluginConfig } from '../plugins/pluginTrust.js';

export type AgentPlatform = 'claude' | 'antigravity' | 'codex' | 'cursor' | 'gemini' | 'all';
export type InstallScope = 'workspace' | 'global';

export interface InstallResult {
  success: boolean;
  installedCount: number;
  platforms: string[];
  targetDir: string;
  mcpConfigured: boolean;
  hooksConfigured: boolean;
  error?: string;
}

interface HookEntry {
  type: string;
  if?: string;
  command: string;
  timeout?: number;
  statusMessage?: string;
}

interface HookGroup {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeHooksConfig {
  hooks?: {
    PostToolUse?: HookGroup[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface UniversalHookSpec {
  PostToolUse?: HookGroup[];
  [key: string]: unknown;
}

type UniversalHooksConfig = Record<string, UniversalHookSpec | unknown>;

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AgentSkillInstaller {
  /**
   * Resolve directory containing bundled skills within the extension or development tree.
   */
  public static getBundledSkillsDir(context: vscode.ExtensionContext): string | null {
    const candidates = [
      context.asAbsolutePath(path.join('assets', 'skills')),
      context.asAbsolutePath('skills'),
      path.resolve(context.extensionPath, '..', '..', 'ipa-rostooling-studio', '.agents', 'skills'),
      path.resolve(context.extensionPath, '..', 'ipa-rostooling-studio', '.agents', 'skills'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
        try {
          const entries = fs.readdirSync(cand);
          if (entries.includes('ros-model') || entries.some((e) => fs.existsSync(path.join(cand, e, 'SKILL.md')))) {
            return cand;
          }
        } catch {
          // Continue to next candidate
        }
      }
    }

    return null;
  }

  /**
   * Resolve directory containing bundled Python scripts within the extension or development tree.
   */
  public static getBundledScriptsDir(context: vscode.ExtensionContext): string | null {
    const candidates = [
      context.asAbsolutePath('scripts'),
      path.resolve(context.extensionPath, 'scripts'),
      path.resolve(context.extensionPath, '..', '..', 'ipa-rostooling-studio', 'scripts'),
      path.resolve(context.extensionPath, '..', 'ipa-rostooling-studio', 'scripts'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
        if (fs.existsSync(path.join(cand, 'rosmodel_lint.py'))) {
          return cand;
        }
      }
    }

    return null;
  }

  /**
   * Resolve bundled hooks template file within the extension or development tree.
   */
  public static getBundledHooksFile(context: vscode.ExtensionContext): string | null {
    const candidates = [
      context.asAbsolutePath(path.join('assets', 'hooks', 'hooks.json')),
      context.asAbsolutePath(path.join('hooks', 'hooks.json')),
      path.resolve(context.extensionPath, '..', '..', 'ipa-rostooling-studio', 'hooks', 'hooks.json'),
      path.resolve(context.extensionPath, '..', 'ipa-rostooling-studio', 'hooks', 'hooks.json'),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return cand;
      }
    }

    return null;
  }

  /**
   * Adapt script execution paths in markdown documentation to point directly
   * to the extension's bundled scripts directory.
   */
  public static adaptScriptPaths(content: string, scriptsDir: string): string {
    const escapedScriptsDir = scriptsDir.replace(/\\/g, '/');
    const scriptNames = [
      'rosmodel_lint.py',
      'ros_plot.py',
      'extract_ros2_interfaces.py',
      'extract_rossystem.py',
      'collect_deps.py',
      'build_node_index.py',
      'build_type_index.py',
      'sync_catalogue.sh',
    ];

    let result = content;
    for (const name of scriptNames) {
      const pattern = new RegExp(`(?<=["'\\s]|^)scripts/${name}`, 'g');
      result = result.replace(pattern, `"${escapedScriptsDir}/${name}"`);
    }

    return result;
  }

  /**
   * Install agent skills, configure MCP, and set up validation hooks for the specified platform and scope.
   */
  public static async installSkills(
    context: vscode.ExtensionContext,
    options: {
      platform: AgentPlatform;
      scope: InstallScope;
      customTargetRoot?: string;
      pluginCliArgs?: string[];
    }
  ): Promise<InstallResult> {
    const sourceDir = this.getBundledSkillsDir(context);
    if (!sourceDir) {
      return {
        success: false,
        installedCount: 0,
        platforms: [],
        targetDir: '',
        mcpConfigured: false,
        hooksConfigured: false,
        error: 'Bundled agent skills directory not found in extension package.',
      };
    }

    const scriptsDir = this.getBundledScriptsDir(context);

    let targetRoot: string;
    if (options.customTargetRoot) {
      targetRoot = options.customTargetRoot;
    } else if (options.scope === 'global') {
      targetRoot = os.homedir();
    } else {
      const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsFolder) {
        return {
          success: false,
          installedCount: 0,
          platforms: [],
          targetDir: '',
          mcpConfigured: false,
          hooksConfigured: false,
          error: 'No active workspace folder open. Open a workspace folder or choose Global scope.',
        };
      }
      targetRoot = wsFolder;
    }

    const installedPlatforms: string[] = [];
    let installedCount = 0;
    let mcpConfigured = false;
    let hooksConfigured = false;

    try {
      const skillDirs = fs
        .readdirSync(sourceDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      const shouldInstallClaude = options.platform === 'claude' || options.platform === 'all';
      const shouldInstallAntigravity = options.platform === 'antigravity' || options.platform === 'all';
      const shouldInstallCodex = options.platform === 'codex' || options.platform === 'all';
      const shouldInstallCursor = options.platform === 'cursor' || options.platform === 'all';
      const shouldInstallGemini = options.platform === 'gemini' || options.platform === 'all';

      const copySkillsInto = (destSkillsDir: string) => {
        fs.mkdirSync(destSkillsDir, { recursive: true });
        for (const skillName of skillDirs) {
          const srcSkillPath = path.join(sourceDir, skillName);
          const destSkillPath = path.join(destSkillsDir, skillName);
          this.safeCopyDir(srcSkillPath, destSkillPath, scriptsDir);
        }
      };

      const agentsSkillsDir = path.join(targetRoot, '.agents', 'skills');
      let copiedAgentsSkills = false;
      const ensureAgentsSkills = () => {
        if (!copiedAgentsSkills) {
          copySkillsInto(agentsSkillsDir);
          copiedAgentsSkills = true;
        }
      };

      const mcpScript = this.resolveMcpScript(context);
      const agyHome = options.customTargetRoot || os.homedir();
      const workspaceRootForPlugins =
        options.scope === 'workspace'
          ? targetRoot
          : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const pluginCliArgs = this.resolveMcpPluginArgs(workspaceRootForPlugins, options.pluginCliArgs);

      // 1. Antigravity (workspace: .agents/{skills,hooks.json}; global: ~/.gemini/config/{skills,hooks.json,mcp_config.json})
      if (shouldInstallAntigravity) {
        const agyBase = options.scope === 'global'
          ? path.join(targetRoot, '.gemini', 'config')
          : path.join(targetRoot, '.agents');
        const agySkillsDir = path.join(agyBase, 'skills');
        if (options.scope === 'workspace') {
          ensureAgentsSkills();
        } else {
          copySkillsInto(agySkillsDir);
        }

        if (scriptsDir && this.configureAntigravityHooks(agyBase, scriptsDir)) {
          hooksConfigured = true;
        }
        if (mcpScript) {
          const agyMcpPath = path.join(agyHome, '.gemini', 'config', 'mcp_config.json');
          if (this.upsertJsonMcpServer(agyMcpPath, mcpScript, true, pluginCliArgs)) {
            mcpConfigured = true;
          }
        }

        installedPlatforms.push(
          options.scope === 'global'
            ? 'Antigravity (~/.gemini/config/{skills,hooks.json,mcp_config.json})'
            : 'Antigravity (.agents/skills, hooks.json, mcp_config.json)'
        );
      }

      // 2. Claude Code (.claude/commands, .claude/skills, .mcp.json or ~/.claude.json, .claude/hooks.json)
      if (shouldInstallClaude) {
        const claudeCommandsDir = path.join(targetRoot, '.claude', 'commands');
        const claudeSkillsDir = path.join(targetRoot, '.claude', 'skills');
        fs.mkdirSync(claudeCommandsDir, { recursive: true });
        fs.mkdirSync(claudeSkillsDir, { recursive: true });

        for (const skillName of skillDirs) {
          const srcSkillPath = path.join(sourceDir, skillName);
          const skillMdPath = path.join(srcSkillPath, 'SKILL.md');

          if (fs.existsSync(skillMdPath)) {
            // Copy as Claude Code slash command (/ros-model, /ros-system-builder, etc.)
            const commandDestPath = path.join(claudeCommandsDir, `${skillName}.md`);
            this.safeCopyFile(skillMdPath, commandDestPath, scriptsDir);

            // Also copy companion references if present
            const refsDir = path.join(srcSkillPath, 'references');
            if (fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
              const destRefsDir = path.join(claudeCommandsDir, 'references', skillName);
              fs.mkdirSync(destRefsDir, { recursive: true });
              this.safeCopyDir(refsDir, destRefsDir, scriptsDir);
            }
          }

          // Also copy complete skill folder into .claude/skills
          const destClaudeSkill = path.join(claudeSkillsDir, skillName);
          this.safeCopyDir(srcSkillPath, destClaudeSkill, scriptsDir);
        }

        const claudeMcpPath = options.scope === 'global'
          ? path.join(targetRoot, '.claude.json')
          : path.join(targetRoot, '.mcp.json');
        if (mcpScript && this.upsertJsonMcpServer(claudeMcpPath, mcpScript, true, pluginCliArgs)) {
          mcpConfigured = true;
        }

        // Configure .claude/hooks.json for model validation
        if (scriptsDir && this.configureClaudeHooks(targetRoot, scriptsDir)) {
          hooksConfigured = true;
        }

        installedPlatforms.push(
          options.scope === 'global'
            ? 'Claude Code (.claude/commands, ~/.claude.json, hooks.json)'
            : 'Claude Code (.claude/commands, .mcp.json, hooks.json)'
        );
      }

      // 3. OpenAI Codex CLI (.agents/skills + .codex/config.toml)
      if (shouldInstallCodex) {
        ensureAgentsSkills();
        if (mcpScript && this.upsertTomlMcpServer(path.join(targetRoot, '.codex', 'config.toml'), mcpScript, true, pluginCliArgs)) {
          mcpConfigured = true;
        }
        installedPlatforms.push('Codex CLI (.agents/skills, .codex/config.toml)');
      }

      // 4. Cursor (.cursor/rules + .cursor/mcp.json)
      if (shouldInstallCursor) {
        const cursorRulesDir = path.join(targetRoot, '.cursor', 'rules');
        fs.mkdirSync(cursorRulesDir, { recursive: true });

        for (const skillName of skillDirs) {
          const srcSkillMd = path.join(sourceDir, skillName, 'SKILL.md');
          if (fs.existsSync(srcSkillMd)) {
            const destRule = path.join(cursorRulesDir, `${skillName}.mdc`);
            this.safeCopyFile(srcSkillMd, destRule, scriptsDir);
          }
        }
        if (mcpScript && this.upsertJsonMcpServer(path.join(targetRoot, '.cursor', 'mcp.json'), mcpScript, true, pluginCliArgs)) {
          mcpConfigured = true;
        }
        installedPlatforms.push('Cursor (.cursor/rules, .cursor/mcp.json)');
      }

      // 5. Gemini CLI (.agents/skills + .gemini/settings.json)
      if (shouldInstallGemini) {
        ensureAgentsSkills();
        if (mcpScript && this.upsertJsonMcpServer(path.join(targetRoot, '.gemini', 'settings.json'), mcpScript, true, pluginCliArgs)) {
          mcpConfigured = true;
        }
        installedPlatforms.push('Gemini CLI (.agents/skills, .gemini/settings.json)');
      }

      installedCount = skillDirs.length;

      return {
        success: true,
        installedCount,
        platforms: installedPlatforms,
        targetDir: targetRoot,
        mcpConfigured,
        hooksConfigured,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        installedCount: 0,
        platforms: installedPlatforms,
        targetDir: targetRoot,
        mcpConfigured,
        hooksConfigured,
        error: errMsg,
      };
    }
  }

  private static resolveMcpScript(context: vscode.ExtensionContext): string | null {
    const mcpScript = context.asAbsolutePath(path.join('bin', 'rostooling-mcp.js'));
    return fs.existsSync(mcpScript) ? mcpScript : null;
  }

  private static isBundledMcpScriptArg(arg: unknown): boolean {
    return typeof arg === 'string' && path.basename(arg.trim()) === 'rostooling-mcp.js';
  }

  private static resolveMcpPluginArgs(workspaceDir?: string, overrideArgs?: string[]): string[] {
    if (overrideArgs !== undefined) {
      return [...overrideArgs];
    }
    try {
      if (typeof vscode.workspace?.getConfiguration !== 'function') {
        return [];
      }
      const cfg = vscode.workspace.getConfiguration('rostooling-languages');
      const effective = computeEffectivePluginConfig({
        isTrusted: Boolean(vscode.workspace.isTrusted),
        workspaceDir,
        pathsInspect: cfg.inspect<string[]>('plugins.paths'),
        enabledInspect: cfg.inspect<string[]>('plugins.enabled'),
      });
      return buildMcpPluginCliArgs(effective.resolvedPaths, effective.enabledIds);
    } catch {
      return [];
    }
  }

  /**
   * Merge or refresh the "rostooling" MCP server entry in a JSON config file (`mcpServers` map).
   */
  private static upsertJsonMcpServer(
    jsonPath: string,
    mcpScript: string,
    createIfMissing: boolean,
    extraArgs: string[] = []
  ): boolean {
    const exists = fs.existsSync(jsonPath);
    if (!exists && !createIfMissing) {
      return false;
    }

    let mcpConfig: { mcpServers?: Record<string, { command?: string; args?: unknown[] }> } = {};
    if (exists) {
      try {
        const raw = fs.readFileSync(jsonPath, 'utf8').trim();
        const parsed = raw ? (JSON.parse(raw) as unknown) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          mcpConfig = parsed as typeof mcpConfig;
        }
      } catch {
        if (!createIfMissing) {
          return false;
        }
        mcpConfig = {};
      }
    }

    if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object' || Array.isArray(mcpConfig.mcpServers)) {
      if (!createIfMissing) {
        return false;
      }
      mcpConfig.mcpServers = {};
    }

    const desiredArgs = [mcpScript, ...extraArgs];
    const current = mcpConfig.mcpServers['rostooling'];
    if (!createIfMissing) {
      if (!current || current.command !== 'node' || !Array.isArray(current.args) || !this.isBundledMcpScriptArg(current.args[0])) {
        return false;
      }
      if (
        current.args.length === desiredArgs.length &&
        current.args.every((val, idx) => val === desiredArgs[idx])
      ) {
        return false;
      }
    }

    mcpConfig.mcpServers['rostooling'] = {
      command: 'node',
      args: desiredArgs,
    };

    try {
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
      fs.writeFileSync(jsonPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Merge or refresh the `[mcp_servers.rostooling]` TOML table in Codex CLI's `config.toml`.
   */
  private static upsertTomlMcpServer(
    tomlPath: string,
    mcpScript: string,
    createIfMissing: boolean,
    extraArgs: string[] = []
  ): boolean {
    const exists = fs.existsSync(tomlPath);
    if (!exists && !createIfMissing) {
      return false;
    }

    const desiredArgs = [mcpScript, ...extraArgs];
    const serializedArgs = desiredArgs
      .map((arg) => `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(', ');
    const block = `[mcp_servers.rostooling]\ncommand = "node"\nargs = [${serializedArgs}]\n`;
    const raw = exists ? fs.readFileSync(tomlPath, 'utf8') : '';
    const sectionRe = /^\[mcp_servers\.rostooling\]\s*(?:#.*)?$/m;
    const match = sectionRe.exec(raw);

    if (!createIfMissing) {
      if (!match) {
        return false;
      }
      const afterHeader = raw.slice(match.index);
      const nextHeader = afterHeader.slice(match[0].length).search(/^\s*\[/m);
      const sectionBody = nextHeader >= 0 ? afterHeader.slice(0, match[0].length + nextHeader) : afterHeader;
      if (!sectionBody.includes('rostooling-mcp.js') || sectionBody === block || sectionBody.trim() === block.trim()) {
        return false;
      }
    }

    let updated: string;
    if (match) {
      const start = match.index;
      const tail = raw.slice(start + match[0].length);
      const nextHeaderRel = tail.search(/^\s*\[/m);
      const end = nextHeaderRel >= 0 ? start + match[0].length + nextHeaderRel : raw.length;
      const before = raw.slice(0, start);
      const after = raw.slice(end);
      const sep = after && !after.startsWith('\n') ? '\n' : '';
      updated = `${before}${block}${sep}${after}`;
    } else {
      const trimmed = raw.replace(/\s+$/, '');
      updated = trimmed ? `${trimmed}\n\n${block}` : block;
    }

    try {
      fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
      fs.writeFileSync(tomlPath, updated, 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Refresh any already-configured `rostooling` MCP server entries so they point to this
   * extension version's `bin/rostooling-mcp.js` and effective plugin flags (never creates new config files).
   */
  public static refreshExistingMcpConfigs(
    context: vscode.ExtensionContext,
    roots?: { homeDir?: string; workspaceDir?: string; pluginCliArgs?: string[] }
  ): number {
    const mcpScript = this.resolveMcpScript(context);
    if (!mcpScript) {
      return 0;
    }
    const homeDir = roots?.homeDir ?? os.homedir();
    const workspaceDir = roots?.workspaceDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const pluginCliArgs = this.resolveMcpPluginArgs(workspaceDir, roots?.pluginCliArgs);

    const jsonCandidates = [
      path.join(homeDir, '.gemini', 'config', 'mcp_config.json'),
      path.join(homeDir, '.claude.json'),
      path.join(homeDir, '.mcp.json'),
      path.join(homeDir, '.cursor', 'mcp.json'),
      path.join(homeDir, '.gemini', 'settings.json'),
    ];
    const tomlCandidates = [path.join(homeDir, '.codex', 'config.toml')];

    if (workspaceDir) {
      jsonCandidates.push(
        path.join(workspaceDir, '.mcp.json'),
        path.join(workspaceDir, '.cursor', 'mcp.json'),
        path.join(workspaceDir, '.gemini', 'settings.json')
      );
      tomlCandidates.push(path.join(workspaceDir, '.codex', 'config.toml'));
    }

    let updated = 0;
    for (const p of new Set(jsonCandidates)) {
      if (this.upsertJsonMcpServer(p, mcpScript, false, pluginCliArgs)) {
        updated += 1;
      }
    }
    for (const p of new Set(tomlCandidates)) {
      if (this.upsertTomlMcpServer(p, mcpScript, false, pluginCliArgs)) {
        updated += 1;
      }
    }
    return updated;
  }

  /**
   * Configure .claude/hooks.json pointing to bundled rosmodel_lint.py
   */
  private static configureClaudeHooks(targetRoot: string, scriptsDir: string): boolean {
    const claudeDir = path.join(targetRoot, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const hooksJsonPath = path.join(claudeDir, 'hooks.json');

    const escapedScriptsDir = scriptsDir.replace(/\\/g, '/');
    const lintScript = `${escapedScriptsDir}/rosmodel_lint.py`;
    const hookCommand = `"\${ROSMODEL_PYTHON:-python3}" "${lintScript}" --hook`;

    const modelExtensions = ['rossystem', 'ros2', 'ros'];
    const toolHooks: HookEntry[] = [];
    for (const ext of modelExtensions) {
      for (const op of ['Write', 'Edit']) {
        toolHooks.push({
          type: 'command',
          if: `${op}(**/*.${ext})`,
          command: hookCommand,
          timeout: 60,
          statusMessage: `Linting .${ext} model`,
        });
      }
    }

    let existingConfig: ClaudeHooksConfig = {};
    if (fs.existsSync(hooksJsonPath)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8')) as ClaudeHooksConfig;
      } catch {
        existingConfig = {};
      }
    }

    if (!existingConfig.hooks || typeof existingConfig.hooks !== 'object') {
      existingConfig.hooks = {};
    }
    if (!Array.isArray(existingConfig.hooks.PostToolUse)) {
      existingConfig.hooks.PostToolUse = [];
    }

    // Filter out previous rosmodel_lint hooks to prevent duplicate stacking
    existingConfig.hooks.PostToolUse = existingConfig.hooks.PostToolUse.filter(
      (entry) =>
        !entry?.hooks?.some((h) => typeof h.command === 'string' && h.command.includes('rosmodel_lint.py'))
    );

    existingConfig.hooks.PostToolUse.push({
      matcher: 'Write|Edit',
      hooks: toolHooks,
    });

    try {
      fs.writeFileSync(hooksJsonPath, JSON.stringify(existingConfig, null, 2) + '\n', 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Configure `hooks.json` inside the given agent config directory (`.agents` or `~/.gemini/config`)
   * pointing to bundled `rosmodel_lint.py`.
   */
  private static configureAntigravityHooks(configDir: string, scriptsDir: string): boolean {
    fs.mkdirSync(configDir, { recursive: true });
    const hooksJsonPath = path.join(configDir, 'hooks.json');

    const escapedScriptsDir = scriptsDir.replace(/\\/g, '/');
    const lintScript = `${escapedScriptsDir}/rosmodel_lint.py`;
    const hookCommand = `"\${ROSMODEL_PYTHON:-python3}" "${lintScript}" --hook`;

    let existingConfig: UniversalHooksConfig = {};
    if (fs.existsSync(hooksJsonPath)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8')) as UniversalHooksConfig;
      } catch {
        existingConfig = {};
      }
    }

    existingConfig['rosmodel-lint'] = {
      PostToolUse: [
        {
          matcher: 'write_file|edit_file|Write|Edit',
          hooks: [
            {
              type: 'command',
              command: hookCommand,
              timeout: 60,
            },
          ],
        },
      ],
    };

    try {
      fs.writeFileSync(hooksJsonPath, JSON.stringify(existingConfig, null, 2) + '\n', 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Safely copy directory to destination, removing any existing symlink, file, or dir first.
   */
  private static safeCopyDir(src: string, dest: string, scriptsDir?: string | null): void {
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {
      // Ignore removal errors
    }
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcChild = path.join(src, entry.name);
      const destChild = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.safeCopyDir(srcChild, destChild, scriptsDir);
      } else {
        this.safeCopyFile(srcChild, destChild, scriptsDir);
      }
    }
  }

  /**
   * Safely copy single file to destination, removing any existing symlink or file first,
   * adapting script paths if it is a markdown file.
   */
  private static safeCopyFile(src: string, dest: string, scriptsDir?: string | null): void {
    try {
      fs.rmSync(dest, { force: true });
    } catch {
      // Ignore removal errors
    }
    if (scriptsDir && (src.endsWith('.md') || src.endsWith('.mdc'))) {
      const raw = fs.readFileSync(src, 'utf8');
      const adapted = this.adaptScriptPaths(raw, scriptsDir);
      fs.writeFileSync(dest, adapted, 'utf8');
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  /**
   * Interactive prompt to install RosTooling skills across platforms and scopes.
   */
  public static async promptInstallSkills(context: vscode.ExtensionContext): Promise<void> {
    interface PlatformChoice extends vscode.QuickPickItem {
      platform: AgentPlatform;
    }

    const platformItems: PlatformChoice[] = [
      {
        label: '$(hubot) All Platforms (Antigravity, Claude Code, Codex, Cursor, Gemini CLI)',
        description: 'Install skills, validation hooks, and native MCP configs across all supported agents',
        platform: 'all',
      },
      {
        label: '$(sparkle) Antigravity (skills, hooks.json & ~/.gemini/config/mcp_config.json)',
        description: 'Workspace .agents/ or global ~/.gemini/config/ skills, hooks, and MCP config',
        platform: 'antigravity',
      },
      {
        label: '$(terminal) Claude Code (.claude/commands, hooks.json & .mcp.json / ~/.claude.json)',
        description: 'Slash commands, skills, MCP server, and PostToolUse lint hooks',
        platform: 'claude',
      },
      {
        label: '$(tools) OpenAI Codex CLI (.agents/skills & .codex/config.toml)',
        description: 'Skills and [mcp_servers.rostooling] entry in config.toml',
        platform: 'codex',
      },
      {
        label: '$(code) Cursor (.cursor/rules & .cursor/mcp.json)',
        description: 'MDC rules and Cursor MCP server config',
        platform: 'cursor',
      },
      {
        label: '$(rocket) Gemini CLI (.agents/skills & .gemini/settings.json)',
        description: 'Skills and mcpServers.rostooling entry in settings.json',
        platform: 'gemini',
      },
    ];

    const chosenPlatform = await vscode.window.showQuickPick(platformItems, {
      placeHolder: 'Select target AI Agent platform for RosTooling skills',
    });

    if (!chosenPlatform) {
      return;
    }

    interface ScopeChoice extends vscode.QuickPickItem {
      scope: InstallScope;
    }

    const hasWorkspace = Boolean(vscode.workspace.workspaceFolders?.[0]);
    const scopeItems: ScopeChoice[] = [];

    if (hasWorkspace) {
      scopeItems.push({
        label: '$(root-folder) Current Workspace',
        description: vscode.workspace.workspaceFolders?.[0]?.name || 'Current repository',
        detail: 'Installs skills locally in project root (can be committed with repository)',
        scope: 'workspace',
      });
    }

    scopeItems.push({
      label: '$(globe) User Global',
      description: `User home directory (${os.homedir()})`,
      detail: 'Available globally across all workspaces and Claude Code sessions',
      scope: 'global',
    });

    const chosenScope = await vscode.window.showQuickPick(scopeItems, {
      placeHolder: 'Select installation destination scope',
    });

    if (!chosenScope) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Installing RosTooling skills for ${chosenPlatform.label}...`,
      },
      async () => {
        const res = await this.installSkills(context, {
          platform: chosenPlatform.platform,
          scope: chosenScope.scope,
        });

        if (res.success) {
          const extras: string[] = [];
          if (res.mcpConfigured) {
            extras.push('MCP server');
          }
          if (res.hooksConfigured) {
            extras.push('validation hooks');
          }
          const extraMsg = extras.length > 0 ? ` and configured ${extras.join(' & ')}` : '';
          const action = await vscode.window.showInformationMessage(
            `Installed ${res.installedCount} RosTooling agent skill(s)${extraMsg} in ${chosenScope.scope === 'global' ? 'User Global' : 'Workspace'} (${res.targetDir})!`,
            'Open Folder'
          );
          if (action === 'Open Folder') {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(res.targetDir));
          }
        } else {
          void vscode.window.showErrorMessage(`Failed to install agent skills: ${res.error || 'Unknown error'}`);
        }
      }
    );
  }

  /**
   * Check on startup if workspace is a ROS workspace lacking skills, and offer 1-click install.
   */
  public static async checkAndPromptOnStartup(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('rostooling-languages');
    const promptEnabled = config.get<boolean>('agentSkills.promptOnStartup', true);
    if (!promptEnabled) {
      return;
    }

    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsFolder) {
      return;
    }

    // Check if skills already installed
    const hasUniversalSkills = fs.existsSync(path.join(wsFolder, '.agents', 'skills', 'ros-model'));
    const hasClaudeCommands = fs.existsSync(path.join(wsFolder, '.claude', 'commands', 'ros-model.md'));
    if (hasUniversalSkills || hasClaudeCommands) {
      return;
    }

    // Check if workspace contains ROS files
    let isRosWorkspace = false;
    try {
      const entries = fs.readdirSync(wsFolder);
      if (
        entries.includes('package.xml') ||
        entries.includes('.rostooling') ||
        entries.includes('.studio') ||
        entries.includes('src') ||
        entries.some((e) => e.endsWith('.rossystem') || e.endsWith('.ros2') || e.endsWith('.ros'))
      ) {
        isRosWorkspace = true;
      }
    } catch {
      return;
    }

    if (!isRosWorkspace) {
      return;
    }

    // Check if Claude Code or agent folder already exists in workspace
    const hasAgentContext =
      fs.existsSync(path.join(wsFolder, '.claude')) ||
      fs.existsSync(path.join(wsFolder, '.agents')) ||
      fs.existsSync(path.join(wsFolder, '.cursor'));

    // Offer installation
    const optionInstallClaude = 'Install for Claude Code';
    const optionInstallAll = 'Install for All Platforms';
    const optionGlobal = 'Install Globally';
    const optionDontAsk = "Don't Ask Again";

    const titleMsg = hasAgentContext
      ? 'RosTooling AI Agent Skills & MCP tools are ready to install for your workspace.'
      : 'RosTooling AI Agent Skills, MCP server, and validation hooks can be installed for Claude Code, Antigravity, and Cursor.';

    const selection = await vscode.window.showInformationMessage(
      titleMsg,
      optionInstallClaude,
      optionInstallAll,
      optionGlobal,
      optionDontAsk
    );

    if (selection === optionInstallClaude) {
      const res = await this.installSkills(context, { platform: 'claude', scope: 'workspace' });
      if (res.success) {
        void vscode.window.showInformationMessage(
          `Installed ${res.installedCount} skills for Claude Code in .claude/commands/, configured .mcp.json, and added validation hooks!`
        );
      }
    } else if (selection === optionInstallAll) {
      const res = await this.installSkills(context, { platform: 'all', scope: 'workspace' });
      if (res.success) {
        void vscode.window.showInformationMessage(
          `Installed ${res.installedCount} RosTooling agent skills in .agents/skills/ and .claude/commands/, configured MCP server, and added validation hooks!`
        );
      }
    } else if (selection === optionGlobal) {
      const res = await this.installSkills(context, { platform: 'all', scope: 'global' });
      if (res.success) {
        void vscode.window.showInformationMessage(
          `Installed ${res.installedCount} RosTooling agent skills globally in ${os.homedir()}!`
        );
      }
    } else if (selection === optionDontAsk) {
      await config.update('agentSkills.promptOnStartup', false, vscode.ConfigurationTarget.Global);
    }
  }
}
