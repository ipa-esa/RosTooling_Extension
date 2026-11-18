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

  test('Installs skills, hooks, and mcp_config.json for Antigravity (workspace & global, incl. 0-byte file)', async () => {
    // Pre-create a 0-byte mcp_config.json to match Antigravity's fresh default state.
    const geminiConfigDir = path.join(tempDir, '.gemini', 'config');
    fs.mkdirSync(geminiConfigDir, { recursive: true });
    fs.writeFileSync(path.join(geminiConfigDir, 'mcp_config.json'), '');

    const wsRes = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'antigravity',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(wsRes.success, true);
    assert.strictEqual(wsRes.hooksConfigured, true);
    assert.strictEqual(wsRes.mcpConfigured, true);

    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'skills', 'ros-model', 'SKILL.md')));
    const wsHooksData = JSON.parse(fs.readFileSync(path.join(tempDir, '.agents', 'hooks.json'), 'utf8'));
    assert.ok(wsHooksData['rosmodel-lint']?.PostToolUse, 'rosmodel-lint hook should be configured in .agents/hooks.json');
    const lintGroup = wsHooksData['rosmodel-lint'].PostToolUse[0];
    assert.ok(lintGroup.matcher.includes('write_file'), 'Matcher should cover write_file');
    assert.ok(
      lintGroup.hooks[0].command.includes('rosmodel_lint.py') && lintGroup.hooks[0].command.includes('--hook'),
      'Command should invoke rosmodel_lint.py --hook'
    );

    const agyMcpData = JSON.parse(fs.readFileSync(path.join(geminiConfigDir, 'mcp_config.json'), 'utf8'));
    assert.strictEqual(agyMcpData.mcpServers?.rostooling?.command, 'node');
    assert.strictEqual(agyMcpData.mcpServers?.rostooling?.args?.[0], path.join(extRoot, 'bin', 'rostooling-mcp.js'));

    // Global scope puts skills & hooks under ~/.gemini/config/ rather than ~/.agents/
    const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-agy-global-'));
    try {
      const globalRes = await AgentSkillInstaller.installSkills(mockContext, {
        platform: 'antigravity',
        scope: 'global',
        customTargetRoot: globalRoot,
      });
      assert.strictEqual(globalRes.success, true);
      assert.strictEqual(globalRes.mcpConfigured, true);
      assert.strictEqual(globalRes.hooksConfigured, true);
      assert.ok(fs.existsSync(path.join(globalRoot, '.gemini', 'config', 'skills', 'ros-model', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(globalRoot, '.gemini', 'config', 'hooks.json')));
      assert.ok(fs.existsSync(path.join(globalRoot, '.gemini', 'config', 'mcp_config.json')));
      assert.ok(!fs.existsSync(path.join(globalRoot, '.agents')), 'Global Antigravity install should use .gemini/config, not .agents');
    } finally {
      fs.rmSync(globalRoot, { recursive: true, force: true });
    }
  });

  test('Installs skills and .cursor/mcp.json for Cursor', async () => {
    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'cursor',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.mcpConfigured, true);
    assert.ok(fs.existsSync(path.join(tempDir, '.cursor', 'rules', 'ros-model.mdc')));
    const cursorMcp = JSON.parse(fs.readFileSync(path.join(tempDir, '.cursor', 'mcp.json'), 'utf8'));
    assert.strictEqual(cursorMcp.mcpServers?.rostooling?.command, 'node');
  });

  test('Installs Codex CLI (.codex/config.toml) and Gemini CLI (.gemini/settings.json) preserving existing config', async () => {
    const codexDir = path.join(tempDir, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(
      path.join(codexDir, 'config.toml'),
      'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "uvx"\nargs = ["other-mcp"]\n'
    );

    const geminiDir = path.join(tempDir, '.gemini');
    fs.mkdirSync(geminiDir, { recursive: true });
    fs.writeFileSync(
      path.join(geminiDir, 'settings.json'),
      JSON.stringify({ theme: 'dark', mcpServers: { existing: { command: 'echo', args: [] } } }, null, 2)
    );

    const codexRes = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'codex',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });
    assert.strictEqual(codexRes.success, true);
    assert.strictEqual(codexRes.mcpConfigured, true);
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'skills', 'ros-model', 'SKILL.md')));
    const toml = fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8');
    assert.ok(toml.includes('model = "gpt-5"'));
    assert.ok(toml.includes('[mcp_servers.other]'));
    assert.ok(toml.includes('[mcp_servers.rostooling]'));
    assert.ok(toml.includes(path.join(extRoot, 'bin', 'rostooling-mcp.js')));

    const geminiRes = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'gemini',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });
    assert.strictEqual(geminiRes.success, true);
    assert.strictEqual(geminiRes.mcpConfigured, true);
    const settings = JSON.parse(fs.readFileSync(path.join(geminiDir, 'settings.json'), 'utf8'));
    assert.strictEqual(settings.theme, 'dark');
    assert.ok(settings.mcpServers?.existing);
    assert.strictEqual(settings.mcpServers?.rostooling?.command, 'node');
  });

  test('Claude Code global installs to ~/.claude.json instead of ~/.mcp.json', async () => {
    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'claude',
      scope: 'global',
      customTargetRoot: tempDir,
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.mcpConfigured, true);
    assert.ok(fs.existsSync(path.join(tempDir, '.claude.json')));
    assert.ok(!fs.existsSync(path.join(tempDir, '.mcp.json')));
    const claudeCfg = JSON.parse(fs.readFileSync(path.join(tempDir, '.claude.json'), 'utf8'));
    assert.strictEqual(claudeCfg.mcpServers?.rostooling?.command, 'node');
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
    assert.ok(fs.existsSync(path.join(tempDir, '.gemini', 'config', 'mcp_config.json')));
    assert.ok(fs.existsSync(path.join(tempDir, '.cursor', 'mcp.json')));
    assert.ok(fs.existsSync(path.join(tempDir, '.gemini', 'settings.json')));
    assert.ok(fs.existsSync(path.join(tempDir, '.codex', 'config.toml')));
  });

  test('refreshExistingMcpConfigs updates stale rostooling-mcp.js paths without creating missing files', () => {
    const homeDir = path.join(tempDir, 'home');
    const wsDir = path.join(tempDir, 'ws');
    const stalePath = '/home/user/.antigravity-ide/extensions/rostooling.rostooling-languages-2.3.0/bin/rostooling-mcp.js';
    const currentPath = path.join(extRoot, 'bin', 'rostooling-mcp.js');

    fs.mkdirSync(path.join(homeDir, '.gemini', 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, '.gemini', 'config', 'mcp_config.json'),
      JSON.stringify({ mcpServers: { rostooling: { command: 'node', args: [stalePath] }, other: { command: 'foo' } } }, null, 2)
    );
    fs.mkdirSync(path.join(wsDir, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(wsDir, '.codex', 'config.toml'),
      `[mcp_servers.rostooling]\ncommand = "node"\nargs = ["${stalePath}"]\n\n[mcp_servers.keep]\ncommand = "bar"\n`
    );

    const updated = AgentSkillInstaller.refreshExistingMcpConfigs(mockContext, { homeDir, workspaceDir: wsDir });
    assert.strictEqual(updated, 2);

    const agyMcp = JSON.parse(fs.readFileSync(path.join(homeDir, '.gemini', 'config', 'mcp_config.json'), 'utf8'));
    assert.strictEqual(agyMcp.mcpServers.rostooling.args[0], currentPath);
    assert.deepStrictEqual(agyMcp.mcpServers.other, { command: 'foo' });

    const codexToml = fs.readFileSync(path.join(wsDir, '.codex', 'config.toml'), 'utf8');
    assert.ok(codexToml.includes(currentPath));
    assert.ok(!codexToml.includes(stalePath));
    assert.ok(codexToml.includes('[mcp_servers.keep]'));

    // Never creates files that were not already configured
    assert.ok(!fs.existsSync(path.join(homeDir, '.claude.json')));
    assert.ok(!fs.existsSync(path.join(wsDir, '.mcp.json')));
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

  test('MCP config install and refresh propagate plugin CLI flags and remove them when empty', async () => {
    const homeDir = path.join(tempDir, 'plugin-home');
    const wsDir = path.join(tempDir, 'plugin-ws');
    const currentScript = path.join(extRoot, 'bin', 'rostooling-mcp.js');
    const pluginFlags = ['--plugins-dir', '/tmp/example-plugins', '--enable-plugins', 'de.example.extprobe'];

    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'all',
      scope: 'workspace',
      customTargetRoot: wsDir,
      pluginCliArgs: pluginFlags,
    });
    assert.strictEqual(res.success, true);

    const claudeJson = JSON.parse(fs.readFileSync(path.join(wsDir, '.mcp.json'), 'utf8'));
    assert.deepStrictEqual(claudeJson.mcpServers?.rostooling?.args, [currentScript, ...pluginFlags]);

    const codexToml = fs.readFileSync(path.join(wsDir, '.codex', 'config.toml'), 'utf8');
    assert.ok(codexToml.includes('--plugins-dir'));
    assert.ok(codexToml.includes('de.example.extprobe'));

    // Refresh existing configs with cleared plugin flags (e.g. disabled or untrusted workspace): flags must be removed cleanly
    const homeGemini = path.join(homeDir, '.gemini', 'config', 'mcp_config.json');
    fs.mkdirSync(path.dirname(homeGemini), { recursive: true });
    fs.writeFileSync(
      homeGemini,
      JSON.stringify({
        mcpServers: {
          rostooling: { command: 'node', args: [currentScript, ...pluginFlags] },
          other: { command: 'keep-me' },
        },
      }),
      'utf8'
    );

    const clearedCount = AgentSkillInstaller.refreshExistingMcpConfigs(mockContext, {
      homeDir,
      workspaceDir: wsDir,
      pluginCliArgs: [],
    });
    assert.ok(clearedCount >= 4, `Expected JSON and TOML MCP configs updated, got ${clearedCount}`);

    const claudeCleared = JSON.parse(fs.readFileSync(path.join(wsDir, '.mcp.json'), 'utf8'));
    assert.deepStrictEqual(claudeCleared.mcpServers?.rostooling?.args, [currentScript]);
    const geminiCleared = JSON.parse(fs.readFileSync(homeGemini, 'utf8'));
    assert.deepStrictEqual(geminiCleared.mcpServers?.rostooling?.args, [currentScript]);
    assert.deepStrictEqual(geminiCleared.mcpServers?.other, { command: 'keep-me' });
    const codexCleared = fs.readFileSync(path.join(wsDir, '.codex', 'config.toml'), 'utf8');
    assert.ok(!codexCleared.includes('--plugins-dir'));
    assert.ok(!codexCleared.includes('--enable-plugins'));
  });
});
