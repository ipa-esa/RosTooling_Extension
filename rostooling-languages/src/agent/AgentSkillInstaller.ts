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
  error?: string;
}

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
   * Install agent skills and configure MCP for the specified platform and scope.
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
        error: 'Bundled agent skills directory not found in extension package.',
      };
    }

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
          error: 'No active workspace folder open. Open a workspace folder or choose Global scope.',
        };
      }
      targetRoot = wsFolder;
    }

    const installedPlatforms: string[] = [];
    let installedCount = 0;
    let mcpConfigured = false;

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
          this.safeCopyDir(srcSkillPath, destSkillPath);
        }
        installedPlatforms.push('Antigravity / Universal (.agents/skills)');
      }

      // 2. Install Claude Code Commands (.claude/commands/) + .claude/skills/ + MCP config
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
            this.safeCopyFile(skillMdPath, commandDestPath);

            // Also copy companion references if present
            const refsDir = path.join(srcSkillPath, 'references');
            if (fs.existsSync(refsDir) && fs.statSync(refsDir).isDirectory()) {
              const destRefsDir = path.join(claudeCommandsDir, 'references', skillName);
              fs.mkdirSync(destRefsDir, { recursive: true });
              this.safeCopyDir(refsDir, destRefsDir);
            }
          }

          // Also copy complete skill folder into .claude/skills
          const destClaudeSkill = path.join(claudeSkillsDir, skillName);
          this.safeCopyDir(srcSkillPath, destClaudeSkill);
        }

        // Configure .mcp.json for Claude Code
        mcpConfigured = this.configureMcpServer(context, targetRoot);
        installedPlatforms.push('Claude Code (.claude/commands & .mcp.json)');
      }

      // 3. Install Cursor Rules (.cursor/rules/)
      if (shouldInstallCursor) {
        const cursorRulesDir = path.join(targetRoot, '.cursor', 'rules');
        fs.mkdirSync(cursorRulesDir, { recursive: true });

        for (const skillName of skillDirs) {
          const srcSkillMd = path.join(sourceDir, skillName, 'SKILL.md');
          if (fs.existsSync(srcSkillMd)) {
            const destRule = path.join(cursorRulesDir, `${skillName}.mdc`);
            this.safeCopyFile(srcSkillMd, destRule);
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
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        installedCount: 0,
        platforms: installedPlatforms,
        targetDir: targetRoot,
        mcpConfigured,
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
   * Safely copy directory to destination, removing any existing symlink, file, or dir first.
   */
  private static safeCopyDir(src: string, dest: string): void {
    try {
      fs.rmSync(dest, { recursive: true, force: true });
    } catch {
      // Ignore removal errors
    }
    fs.cpSync(src, dest, { recursive: true, force: true });
  }

  /**
   * Safely copy single file to destination, removing any existing symlink or file first.
   */
  private static safeCopyFile(src: string, dest: string): void {
    try {
      fs.rmSync(dest, { force: true });
    } catch {
      // Ignore removal errors
    }
    fs.copyFileSync(src, dest);
  }

  /**
   * Interactive prompt for user to choose platform and scope.
   */
  public static async promptInstallSkills(context: vscode.ExtensionContext): Promise<void> {
    interface PlatformChoice extends vscode.QuickPickItem {
      platform: AgentPlatform;
    }

    const platformItems: PlatformChoice[] = [
      {
        label: '$(sparkle) All Platforms (Recommended)',
        description: 'Claude Code, Antigravity, Cursor, and universal agent tools',
        detail: 'Installs .agents/skills, .claude/commands slash commands, and configures .mcp.json',
        platform: 'all',
      },
      {
        label: '$(terminal) Claude Code',
        description: 'Slash commands (/ros-model, /ros-system-builder) & MCP server',
        detail: 'Installs into .claude/commands/ and configures .mcp.json',
        platform: 'claude',
      },
      {
        label: '$(hubot) Antigravity / Universal Agent Standard',
        description: 'Agent Skills format for Antigravity, Codex, Copilot',
        detail: 'Installs into .agents/skills/',
        platform: 'antigravity',
      },
      {
        label: '$(symbol-rule) Cursor IDE',
        description: 'Rules for Cursor AI',
        detail: 'Installs into .cursor/rules/',
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
          const mcpMsg = res.mcpConfigured ? ' and configured RosTooling MCP server' : '';
          const action = await vscode.window.showInformationMessage(
            `Installed ${res.installedCount} RosTooling agent skill(s)${mcpMsg} in ${chosenScope.scope === 'global' ? 'User Global' : 'Workspace'} (${res.targetDir})!`,
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
      : 'RosTooling AI Agent Skills & MCP server can be installed for Claude Code, Antigravity, and Cursor.';

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
          `Installed ${res.installedCount} skills for Claude Code in .claude/commands/ and configured .mcp.json!`
        );
      }
    } else if (selection === optionInstallAll) {
      const res = await this.installSkills(context, { platform: 'all', scope: 'workspace' });
      if (res.success) {
        void vscode.window.showInformationMessage(
          `Installed ${res.installedCount} RosTooling agent skills in .agents/skills/ and .claude/commands/!`
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
