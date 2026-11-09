import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export type AgentPlatform = 'claude' | 'antigravity' | 'cursor' | 'all';
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
      const shouldInstallUniversal = options.platform === 'antigravity' || options.platform === 'all';
      const shouldInstallCursor = options.platform === 'cursor' || options.platform === 'all';

      // 1. Install Universal Agent Skills (.agents/skills) -> Used by Antigravity, Claude Code, Cursor, Copilot
      if (shouldInstallUniversal) {
        const agentsDestDir = path.join(targetRoot, '.agents', 'skills');
        fs.mkdirSync(agentsDestDir, { recursive: true });

        for (const skillName of skillDirs) {
          const srcSkillPath = path.join(sourceDir, skillName);
          const destSkillPath = path.join(agentsDestDir, skillName);
          this.safeCopyDir(srcSkillPath, destSkillPath, scriptsDir);
        }

        if (scriptsDir) {
          const universalHooksOk = this.configureAntigravityHooks(targetRoot, scriptsDir);
          if (universalHooksOk) {
            hooksConfigured = true;
          }
        }

        installedPlatforms.push('Antigravity / Universal (.agents/skills & hooks.json)');
      }

      // 2. Install Claude Code Commands (.claude/commands/) + .claude/skills/ + MCP config + hooks
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

        // Configure .mcp.json for Claude Code
        mcpConfigured = this.configureMcpServer(context, targetRoot);

        // Configure .claude/hooks.json for model validation
        if (scriptsDir) {
          const claudeHooksOk = this.configureClaudeHooks(targetRoot, scriptsDir);
          if (claudeHooksOk) {
            hooksConfigured = true;
          }
        }

        installedPlatforms.push('Claude Code (.claude/commands, .mcp.json, hooks.json)');
      }

      // 3. Install Cursor Rules (.cursor/rules/)
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
        installedPlatforms.push('Cursor (.cursor/rules)');
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

  /**
   * Configure or merge .mcp.json pointing to bundled rostooling-mcp.js
   */
  private static configureMcpServer(context: vscode.ExtensionContext, targetRoot: string): boolean {
    const mcpScript = context.asAbsolutePath(path.join('bin', 'rostooling-mcp.js'));
    if (!fs.existsSync(mcpScript)) {
      return false;
    }

    const mcpJsonPath = path.join(targetRoot, '.mcp.json');
    let mcpConfig: { mcpServers?: Record<string, { command: string; args: string[] }> } = {};

    if (fs.existsSync(mcpJsonPath)) {
      try {
        mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));
      } catch {
        mcpConfig = {};
      }
    }

    if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
      mcpConfig.mcpServers = {};
    }

    mcpConfig.mcpServers['rostooling'] = {
      command: 'node',
      args: [mcpScript],
    };

    try {
      fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');
      return true;
    } catch {
      return false;
    }
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
   * Configure .agents/hooks.json for Antigravity & Universal agents pointing to bundled rosmodel_lint.py
   */
  private static configureAntigravityHooks(targetRoot: string, scriptsDir: string): boolean {
    const agentsDir = path.join(targetRoot, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const hooksJsonPath = path.join(agentsDir, 'hooks.json');

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
        label: '$(hubot) All Platforms (Claude Code, Antigravity, Cursor)',
        description: 'Install .agents/skills, .claude/commands, .cursor/rules, and validation hooks',
        platform: 'all',
      },
      {
        label: '$(terminal) Claude Code (.claude/commands/ & .mcp.json & hooks.json)',
        description: 'Slash commands (/ros-model, /ros-system-builder) and auto-lint hooks',
        platform: 'claude',
      },
      {
        label: '$(sparkle) Antigravity / Universal (.agents/skills & hooks.json)',
        description: 'Universal agent skills and PostToolUse validation hooks',
        platform: 'antigravity',
      },
      {
        label: '$(code) Cursor (.cursor/rules/)',
        description: 'MDC rule files for Cursor agentic workflow',
        platform: 'cursor',
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
