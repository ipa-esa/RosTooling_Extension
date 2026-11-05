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
    const bundledDir = AgentSkillInstaller.getBundledSkillsDir(mockContext);
    assert.ok(bundledDir, 'Expected bundled skills directory to be resolved');
    assert.ok(fs.existsSync(bundledDir), 'Bundled skills directory must exist');
    assert.ok(
      fs.existsSync(path.join(bundledDir, 'ros-model', 'SKILL.md')),
      'ros-model/SKILL.md must exist in bundled skills'
    );
  });

  test('Installs skills for Claude Code (.claude/commands/ and .mcp.json)', async () => {
    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'claude',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(res.success, true);
    assert.ok(res.installedCount >= 5, `Expected at least 5 skills, got ${res.installedCount}`);

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
  });

  test('Installs skills for Antigravity / Universal (.agents/skills)', async () => {
    const res = await AgentSkillInstaller.installSkills(mockContext, {
      platform: 'antigravity',
      scope: 'workspace',
      customTargetRoot: tempDir,
    });

    assert.strictEqual(res.success, true);
    const skillPath = path.join(tempDir, '.agents', 'skills', 'ros-model', 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'SKILL.md should exist in .agents/skills/ros-model');
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
    assert.ok(fs.existsSync(path.join(tempDir, '.claude', 'commands', 'ros-model.md')));
    assert.ok(fs.existsSync(path.join(tempDir, '.cursor', 'rules', 'ros-model.mdc')));
    assert.ok(fs.existsSync(path.join(tempDir, '.mcp.json')));
  });
});
