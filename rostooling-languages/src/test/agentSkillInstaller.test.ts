import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentSkillInstaller } from '../agent/AgentSkillInstaller';

suite('AgentSkillInstaller Test Suite', () => {
  const extRoot = path.resolve(__dirname, '..', '..');
  let tempDir: string;

  const mockContext = {
    extensionPath: extRoot,
    asAbsolutePath: (rel: string) => path.join(extRoot, rel),
  } as unknown as vscode.ExtensionContext;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-agent-test-'));
  });

  teardown(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test('Resolves bundled skills directory', () => {
    const bundledSkillsDir = AgentSkillInstaller.getBundledSkillsDir(mockContext);
    assert.ok(bundledSkillsDir, 'Expected bundled skills directory to be resolved');
    assert.ok(fs.existsSync(bundledSkillsDir), 'Bundled skills directory must exist');
    assert.ok(
      fs.existsSync(path.join(bundledSkillsDir, 'ros-model', 'SKILL.md')),
      'ros-model/SKILL.md must exist in bundled skills'
    );
  });

  test('Resolves bundled scripts directory', () => {
    const bundledScriptsDir = AgentSkillInstaller.getBundledScriptsDir(mockContext);
    assert.ok(bundledScriptsDir, 'Expected bundled scripts directory to be resolved');
    assert.ok(fs.existsSync(bundledScriptsDir), 'Bundled scripts directory must exist');
    assert.ok(
      fs.existsSync(path.join(bundledScriptsDir, 'rosmodel_lint.py')),
      'rosmodel_lint.py must exist in bundled scripts'
    );
  });

  test('Resolves bundled hooks file', () => {
    const bundledHooksFile = AgentSkillInstaller.getBundledHooksFile(mockContext);
    assert.ok(bundledHooksFile, 'Expected bundled hooks file to be resolved');
    assert.ok(fs.existsSync(bundledHooksFile), 'Bundled hooks file must exist');
  });

  test('Adapts script paths in markdown content', () => {
    const scriptsDir = '/opt/rostooling/scripts';
    const rawContent = 'Run `python3 scripts/ros_plot.py $ARGUMENTS` or python scripts/rosmodel_lint.py model.rossystem';
    const adapted = AgentSkillInstaller.adaptScriptPaths(rawContent, scriptsDir);

    assert.ok(adapted.includes('"/opt/rostooling/scripts/ros_plot.py"'));
    assert.ok(adapted.includes('"/opt/rostooling/scripts/rosmodel_lint.py"'));
    assert.ok(!adapted.includes('`python3 scripts/ros_plot.py'));
  });

  test('Installs skills for Claude Code (.claude/commands/, .claude/skills/, .mcp.json, and hooks.json)', async () => {
    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'claude',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.installedCount >= 5, `Expected at least 5 skills, got ${res.installedCount}`);
    assert.strictEqual(res.mcpConfigured, true);
    assert.strictEqual(res.hooksConfigured, true);

    // Verify .claude/commands
    const cmdPath = path.join(tempDir, '.claude', 'commands', 'ros-model.md');
    assert.ok(fs.existsSync(cmdPath), 'ros-model.md should exist in .claude/commands');
    const content = fs.readFileSync(cmdPath, 'utf8');
    assert.ok(content.includes('ros-model'), 'File should contain ros-model documentation');

    // Verify companion references
    const refPath = path.join(tempDir, '.claude', 'commands', 'references', 'ros-model', 'ros2-syntax.md');
    assert.ok(fs.existsSync(refPath), 'Companion references should be copied');

    // Verify .mcp.json
    const mcpPath = path.join(tempDir, '.mcp.json');
    assert.ok(fs.existsSync(mcpPath), '.mcp.json should be created');
    const mcpData = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    assert.ok(mcpData.mcpServers?.rostooling, 'rostooling server should be configured in .mcp.json');
    assert.strictEqual(mcpData.mcpServers.rostooling.command, 'node');

    // Verify .claude/hooks.json
    const hooksPath = path.join(tempDir, '.claude', 'hooks.json');
    assert.ok(fs.existsSync(hooksPath), '.claude/hooks.json should be created');
    const hooksData = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    assert.ok(Array.isArray(hooksData.hooks?.PostToolUse), 'PostToolUse hooks should be defined');
    const hasLintHook = hooksData.hooks.PostToolUse.some((group: { matcher: string; hooks: { command: string }[] }) =>
      group.matcher === 'Write|Edit' && group.hooks.some((h) => h.command.includes('rosmodel_lint.py'))
    );
    assert.ok(hasLintHook, 'Claude Code hooks should include rosmodel_lint.py --hook for Write|Edit');
  });

  test('Installs skills for Antigravity / Universal (.agents/skills and hooks.json)', async () => {
    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'antigravity',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.hooksConfigured, true);

    const skillPath = path.join(tempDir, '.agents', 'skills', 'ros-model', 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'SKILL.md should exist in .agents/skills/ros-model');

    // Verify .agents/hooks.json
    const hooksPath = path.join(tempDir, '.agents', 'hooks.json');
    assert.ok(fs.existsSync(hooksPath), '.agents/hooks.json should be created');
    const hooksData = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    assert.ok(hooksData['rosmodel-lint']?.PostToolUse, 'rosmodel-lint hook should be configured in .agents/hooks.json');
    const lintGroup = hooksData['rosmodel-lint'].PostToolUse[0];
    assert.ok(lintGroup.matcher.includes('write_file'), 'Matcher should cover write_file');
    assert.ok(
      lintGroup.hooks[0].command.includes('rosmodel_lint.py') && lintGroup.hooks[0].command.includes('--hook'),
      'Command should invoke rosmodel_lint.py --hook'
    );
  });

  test('Installs skills for Cursor (.cursor/rules)', async () => {
    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'cursor',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(res.success, true);
    const rulePath = path.join(tempDir, '.cursor', 'rules', 'ros-model.mdc');
    assert.ok(fs.existsSync(rulePath), 'ros-model.mdc should exist in .cursor/rules');
  });

  test('Installs for All Platforms simultaneously', async () => {
    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'all',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(res.success, true);
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'skills', 'ros-model', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'hooks.json')));
    assert.ok(fs.existsSync(path.join(tempDir, '.claude', 'commands', 'ros-model.md')));
    assert.ok(fs.existsSync(path.join(tempDir, '.claude', 'hooks.json')));
    assert.ok(fs.existsSync(path.join(tempDir, '.cursor', 'rules', 'ros-model.mdc')));
    assert.ok(fs.existsSync(path.join(tempDir, '.mcp.json')));
  });

  test('Safely overwrites pre-existing symlinks in destination without non-directory error', async () => {
    const claudeSkills = path.join(tempDir, '.claude', 'skills');
    fs.mkdirSync(claudeSkills, { recursive: true });
    const dummyTarget = path.join(tempDir, 'dummy-target');
    fs.mkdirSync(dummyTarget, { recursive: true });
    fs.symlinkSync(dummyTarget, path.join(claudeSkills, 'ros-model'));

    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'claude',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(res.success, true, `Expected success but got error: ${res.error}`);
    const stat = fs.lstatSync(path.join(claudeSkills, 'ros-model'));
    assert.ok(!stat.isSymbolicLink(), 'Expected symlink to be replaced by a real directory');
    assert.ok(stat.isDirectory(), 'Expected real directory');
    assert.ok(fs.existsSync(path.join(claudeSkills, 'ros-model', 'SKILL.md')));
  });

  test('Preserves pre-existing custom hooks when configuring hooks.json', async () => {
    // Setup existing custom hook in .claude/hooks.json
    const claudeDir = path.join(tempDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const preExistingClaudeHooks = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'run_command',
            hooks: [{ type: 'command', command: './my-custom-check.sh' }],
          },
        ],
      },
    };
    fs.writeFileSync(path.join(claudeDir, 'hooks.json'), JSON.stringify(preExistingClaudeHooks, null, 2));

    // Setup existing custom hook in .agents/hooks.json
    const agentsDir = path.join(tempDir, '.agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const preExistingAgentHooks = {
      'custom-guard': {
        PreToolUse: [{ matcher: 'run_command', hooks: [{ command: './guard.sh' }] }],
      },
    };
    fs.writeFileSync(path.join(agentsDir, 'hooks.json'), JSON.stringify(preExistingAgentHooks, null, 2));

    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'all',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(res.success, true);

    // Verify custom hook still present in .claude/hooks.json
    const updatedClaude = JSON.parse(fs.readFileSync(path.join(claudeDir, 'hooks.json'), 'utf8'));
    const hasCustomClaudeHook = updatedClaude.hooks?.PostToolUse?.some((g: { matcher: string }) => g.matcher === 'run_command');
    assert.ok(hasCustomClaudeHook, 'Custom hook in .claude/hooks.json must be preserved');

    // Verify custom hook still present in .agents/hooks.json
    const updatedAgents = JSON.parse(fs.readFileSync(path.join(agentsDir, 'hooks.json'), 'utf8'));
    assert.ok(updatedAgents['custom-guard'], 'Custom hook in .agents/hooks.json must be preserved');
    assert.ok(updatedAgents['rosmodel-lint'], 'rosmodel-lint hook must be added');
  });
});
