import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HeadlessLspClient } from '../mcp/HeadlessLspClient';
import { computeFileSha256, resolvePluginPaths } from '../plugins/pluginPaths';
import {
  NO_METADATA_LOAD_ERROR,
  PLUGIN_TRUST_WARNING,
  PluginHostAdapter,
  PluginManagerController,
  PluginQuickPickItem,
} from '../plugins/pluginManager';
import {
  computeEffectivePluginConfig,
  DiscoveredPlugin,
  DiscoveredPluginsResponse,
} from '../plugins/pluginTrust';
import { buildPluginTreeDescriptors } from '../plugins/pluginsTreeView';
import {
  approveTrustedPluginEntry,
  migrateLegacyTrustedChecksums,
  readTrustedPluginsFile,
} from '../plugins/trustedPluginsStore';

suite('Plugin Discovery, Core Approval Store, Migration & UI Suite', function () {
  this.timeout(120000);

  const EXT_ROOT = path.resolve(__dirname, '..', '..');
  const TEST_PLUGINS_DIR = path.resolve(EXT_ROOT, '..', 'build', 'test-plugins');
  const TEST_PROBE_JAR = path.join(TEST_PLUGINS_DIR, 'rostooling-test-plugins.jar');
  const SERVER_JAR = path.resolve(EXT_ROOT, 'server', 'rostooling_extension-2.5.0.jar');

  test('resolvePluginPaths handles absolute, relative, ${workspaceFolder}, and warns on missing paths', () => {
    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-plugin-paths-'));
    try {
      const subDir = path.join(tmpWs, 'local-plugins');
      fs.mkdirSync(subDir, { recursive: true });
      const warnings: string[] = [];

      const resolved = resolvePluginPaths(
        [
          TEST_PROBE_JAR,
          './local-plugins',
          '${workspaceFolder}/local-plugins',
          '${workspaceFolder}/does-not-exist.jar',
        ],
        {
          workspaceDir: tmpWs,
          onWarning: (w) => warnings.push(w),
        }
      );

      assert.deepStrictEqual(resolved, [
        path.normalize(TEST_PROBE_JAR),
        subDir,
        path.join(tmpWs, 'does-not-exist.jar'),
      ]);
      assert.strictEqual(warnings.length, 1);
      assert.ok(warnings[0].includes('does-not-exist.jar'));
    } finally {
      fs.rmSync(tmpWs, { recursive: true, force: true });
    }
  });

  test('computeEffectivePluginConfig enforces Workspace Trust without duplicating fingerprint checks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-plugin-trust-'));
    try {
      const untrusted = computeEffectivePluginConfig({
        isTrusted: false,
        workspaceDir: tmpDir,
        pathsInspect: { workspaceValue: [TEST_PROBE_JAR] },
        enabledInspect: { workspaceValue: ['de.example.extprobe'] },
      });
      assert.strictEqual(untrusted.blockedByWorkspaceTrust, true);
      assert.deepStrictEqual(untrusted.resolvedPaths, []);
      assert.deepStrictEqual(untrusted.enabledIds, []);

      const trusted = computeEffectivePluginConfig({
        isTrusted: true,
        workspaceDir: tmpDir,
        pathsInspect: { workspaceValue: [TEST_PROBE_JAR] },
        enabledInspect: { workspaceValue: ['de.example.extprobe'] },
      });
      assert.strictEqual(trusted.blockedByWorkspaceTrust, false);
      assert.deepStrictEqual(trusted.resolvedPaths, [path.normalize(TEST_PROBE_JAR)]);
      assert.deepStrictEqual(trusted.enabledIds, ['de.example.extprobe']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('approving writes exactly one atomic entry and approving U1 never approves U2', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-store-atomic-'));
    try {
      const storePath = path.join(tmpDir, '.rostooling', 'trusted-plugins.json');
      const u1Path = path.join(tmpDir, 'u1.jar');
      const u2Path = path.join(tmpDir, 'u2.jar');
      fs.writeFileSync(u1Path, 'unlabeled-jar-u1');
      fs.writeFileSync(u2Path, 'unlabeled-jar-u2');
      const sha1 = computeFileSha256(u1Path);
      const sha2 = computeFileSha256(u2Path);

      const addedFirst = approveTrustedPluginEntry(storePath, {
        sha256: sha1,
        fileName: 'u1.jar',
        id: '',
      });
      assert.strictEqual(addedFirst, true);
      const addedDup = approveTrustedPluginEntry(storePath, {
        sha256: sha1,
        fileName: 'u1.jar',
        id: '',
      });
      assert.strictEqual(addedDup, false);

      const parsed = readTrustedPluginsFile(storePath);
      assert.strictEqual(parsed.version, 1);
      assert.strictEqual(parsed.approved.length, 1);
      assert.strictEqual(parsed.approved[0].sha256, sha1);
      assert.strictEqual(parsed.approved[0].fileName, 'u1.jar');
      assert.strictEqual(parsed.approved.some((e) => e.sha256 === sha2), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('migration copies legacy trustedChecksums into trusted-plugins.json once and is idempotent', () => {
    assert.ok(fs.existsSync(TEST_PROBE_JAR), `Missing test JAR at ${TEST_PROBE_JAR}`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-store-migrate-'));
    try {
      const storePath = path.join(tmpDir, '.rostooling', 'trusted-plugins.json');
      const probeSha = computeFileSha256(TEST_PROBE_JAR);
      const otherSha = 'a'.repeat(64);
      const legacy = {
        'de.example.extprobe': probeSha,
        'de.example.other': otherSha,
      };

      const firstCount = migrateLegacyTrustedChecksums({
        legacyChecksums: legacy,
        rawPluginPaths: [TEST_PROBE_JAR],
        workspaceDir: tmpDir,
        storePath,
      });
      assert.strictEqual(firstCount, 2);

      const fileAfterFirst = readTrustedPluginsFile(storePath);
      assert.strictEqual(fileAfterFirst.approved.length, 2);
      const probeEntry = fileAfterFirst.approved.find((e) => e.id === 'de.example.extprobe');
      assert.strictEqual(probeEntry?.sha256, probeSha);
      assert.strictEqual(probeEntry?.fileName, 'rostooling-test-plugins.jar');
      const otherEntry = fileAfterFirst.approved.find((e) => e.id === 'de.example.other');
      assert.strictEqual(otherEntry?.sha256, otherSha);
      assert.strictEqual(otherEntry?.fileName, '');

      // Second run must be a no-op (idempotent) and preserve original entries
      const mtimeBefore = fs.statSync(storePath).mtimeMs;
      const secondCount = migrateLegacyTrustedChecksums({
        legacyChecksums: legacy,
        rawPluginPaths: [TEST_PROBE_JAR],
        workspaceDir: tmpDir,
        storePath,
      });
      assert.strictEqual(secondCount, 0);
      assert.strictEqual(readTrustedPluginsFile(storePath).approved.length, 2);
      assert.strictEqual(fs.statSync(storePath).mtimeMs, mtimeBefore);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('PluginManagerController approves using core sha256/fileName, supports Approve JAR, and renders TreeView statuses', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-plugin-ctrl-'));
    try {
      const trustStorePath = path.join(tmpDir, '.rostooling', 'trusted-plugins.json');
      const probeJar = path.join(tmpDir, 'extprobe.jar');
      const unlabeledJar1 = path.join(tmpDir, 'u1.jar');
      const unlabeledJar2 = path.join(tmpDir, 'u2.jar');
      fs.copyFileSync(TEST_PROBE_JAR, probeJar);
      fs.writeFileSync(unlabeledJar1, 'unlabeled-1');
      fs.writeFileSync(unlabeledJar2, 'unlabeled-2');
      const probeSha = computeFileSha256(probeJar);
      const u1Sha = computeFileSha256(unlabeledJar1);
      const u2Sha = computeFileSha256(unlabeledJar2);

      const discovered: DiscoveredPlugin[] = [
        {
          id: 'de.example.extprobe',
          version: '1.0.0',
          summary: 'External probe plugin summary',
          supportedCoreVersionRange: '[3.6.0,4.0.0)',
          compatible: true,
          enabled: false,
          active: false,
          sourceJarPath: probeJar,
          loadError: '',
          fileName: 'extprobe.jar',
          sha256: probeSha,
          approvalState: 'unapproved',
        },
        {
          id: 'de.example.future',
          version: '2.0.0',
          summary: 'Incompatible plugin',
          supportedCoreVersionRange: '[99.0.0,100.0.0)',
          compatible: false,
          enabled: false,
          active: false,
          sourceJarPath: '/tmp/future.jar',
          loadError: '',
          fileName: 'future.jar',
          sha256: 'b'.repeat(64),
          approvalState: 'unapproved',
        },
        {
          id: '',
          version: '',
          summary: '',
          supportedCoreVersionRange: '',
          compatible: false,
          enabled: false,
          active: false,
          sourceJarPath: unlabeledJar1,
          loadError: NO_METADATA_LOAD_ERROR,
          fileName: 'u1.jar',
          sha256: u1Sha,
          approvalState: 'unapproved',
        },
        {
          id: '',
          version: '',
          summary: '',
          supportedCoreVersionRange: '',
          compatible: false,
          enabled: false,
          active: false,
          sourceJarPath: unlabeledJar2,
          loadError: NO_METADATA_LOAD_ERROR,
          fileName: 'u2.jar',
          sha256: u2Sha,
          approvalState: 'unapproved',
        },
      ];

      let globalPaths: string[] | undefined = [tmpDir];
      let workspacePaths: string[] | undefined;
      let globalEnabled: string[] | undefined;
      let workspaceEnabled: string[] | undefined;
      let modalAccept = false;
      const chosenScope: 'workspace' | 'user' = 'workspace';
      const quickPickHandler = (items: PluginQuickPickItem[]): PluginQuickPickItem[] | undefined => {
        const probe = items.find((i) => i.plugin?.id === 'de.example.extprobe');
        const incompat = items.find((i) => i.plugin?.id === 'de.example.future');
        const u1 = items.find((i) => i.plugin?.fileName === 'u1.jar');
        const u2 = items.find((i) => i.plugin?.fileName === 'u2.jar');
        assert.ok(probe?.tickable);
        assert.strictEqual(incompat?.tickable, false);
        assert.ok(u1 && u2, 'Unlabeled JARs must be listed individually');
        assert.ok(probe?.detail?.includes('extprobe.jar'));
        assert.ok(probe?.detail?.includes(probeSha.slice(0, 12)));
        if (!probe) {
          throw new Error('Expected probe item');
        }
        return [probe];
      };
      const modalCalls: { message: string; detail: string; confirmLabel: string }[] = [];
      let restarts = 0;
      let mcpRefreshes = 0;
      let viewRefreshes = 0;
      let previewOpened: { pluginId: string; markdown: string } | undefined;

      const host: PluginHostAdapter = {
        isWorkspaceTrusted: () => true,
        getWorkspaceDir: () => tmpDir,
        inspectPaths: () => ({ globalValue: globalPaths, workspaceValue: workspacePaths }),
        inspectEnabled: () => ({ globalValue: globalEnabled, workspaceValue: workspaceEnabled }),
        approvePluginJar: async (storePath, entry) => {
          approveTrustedPluginEntry(storePath, entry);
        },
        updatePluginsSetting: async (key, value, target) => {
          if (key === 'plugins.paths') {
            if (target === 'workspace') workspacePaths = [...value];
            else globalPaths = [...value];
          } else {
            if (target === 'workspace') workspaceEnabled = [...value];
            else globalEnabled = [...value];
          }
        },
        isLspReady: () => true,
        waitForLspReady: async () => true,
        sendExecuteCommand: async <T = unknown>(command: string): Promise<T> => {
          if (command === 'rostooling.listDiscoveredPlugins') {
            return { trustStorePath, plugins: discovered, notices: [] } as unknown as T;
          }
          if (command === 'rostooling.getPluginDocumentation') {
            return { id: 'de.example.extprobe', documentationMarkdown: '# Probe Docs\n\nBody.' } as unknown as T;
          }
          return {} as T;
        },
        restartServers: async () => {
          restarts += 1;
        },
        refreshMcpConfigs: async () => {
          mcpRefreshes += 1;
        },
        refreshPluginsView: () => {
          viewRefreshes += 1;
        },
        log: () => undefined,
        logWarning: () => undefined,
        showInfo: async () => undefined,
        showWarning: async () => undefined,
        showError: async () => undefined,
        showModalConfirm: async (message, detail, confirmLabel) => {
          modalCalls.push({ message, detail, confirmLabel });
          return modalAccept;
        },
        pickQuickPick: async (items) => quickPickHandler(items),
        pickScope: async () => chosenScope,
        promptAddPluginPath: async () => '/tmp/extra-plugins',
        openPluginSettings: async () => undefined,
        openTrustManagement: async () => undefined,
        openMarkdownPreview: async (pluginId, markdown) => {
          previewOpened = { pluginId, markdown };
        },
      };

      const controller = new PluginManagerController(host);

      // 1. Picker shows fileName/sha256, lists U1 & U2 individually, gates incompatible; cancelling writes nothing
      modalAccept = false;
      await controller.managePlugins();
      assert.strictEqual(modalCalls.length, 1);
      assert.ok(modalCalls[0].detail.includes('extprobe.jar'));
      assert.ok(modalCalls[0].detail.includes(probeSha));
      assert.ok(modalCalls[0].detail.includes(PLUGIN_TRUST_WARNING));
      assert.strictEqual(fs.existsSync(trustStorePath), false);
      assert.strictEqual(restarts, 0);

      // 2. Confirm writes one entry to trustStorePath, saves enabled list, restarts
      modalAccept = true;
      await controller.managePlugins();
      const store1 = readTrustedPluginsFile(trustStorePath);
      assert.strictEqual(store1.approved.length, 1);
      assert.strictEqual(store1.approved[0].sha256, probeSha);
      assert.strictEqual(store1.approved[0].fileName, 'extprobe.jar');
      assert.strictEqual(store1.approved[0].id, 'de.example.extprobe');
      assert.deepStrictEqual(workspaceEnabled, ['de.example.extprobe']);
      assert.strictEqual(restarts, 1);
      assert.strictEqual(mcpRefreshes, 1);
      assert.strictEqual(viewRefreshes, 1);

      // 3. Approve JAR action on unlabeled U1 approves ONLY U1 (never U2) and restarts
      const treeBefore = buildPluginTreeDescriptors(discovered, controller.evaluateEffectiveConfig(false));
      const u1Node = treeBefore.find((n) => n.plugin?.fileName === 'u1.jar');
      assert.strictEqual(u1Node?.contextValue, 'pluginFailedNeedsApproval');
      await controller.approvePluginJarCommand(discovered[2]);
      const store2 = readTrustedPluginsFile(trustStorePath);
      assert.strictEqual(store2.approved.length, 2);
      assert.ok(store2.approved.some((e) => e.sha256 === u1Sha && e.fileName === 'u1.jar'));
      assert.strictEqual(store2.approved.some((e) => e.sha256 === u2Sha), false);
      assert.strictEqual(restarts, 2);

      // 4. Changed state in Core triggers changed modal on enable
      discovered[0].approvalState = 'changed';
      discovered[0].sha256 = 'c'.repeat(64);
      const changedTree = buildPluginTreeDescriptors(discovered, controller.evaluateEffectiveConfig(false));
      const changedNode = changedTree.find((n) => n.plugin?.id === 'de.example.extprobe');
      assert.strictEqual(changedNode?.contextValue, 'pluginDisabledNeedsApproval');
      assert.ok(changedNode?.description.includes('Changed'));
      await controller.enableSinglePlugin(discovered[0]);
      assert.strictEqual(modalCalls.length, 4);
      assert.ok(modalCalls[3].detail.includes('c'.repeat(64)));

      // 5. Documentation preview works
      await controller.openPluginDocumentation(discovered[0]);
      assert.deepStrictEqual(previewOpened, {
        pluginId: 'de.example.extprobe',
        markdown: '# Probe Docs\n\nBody.',
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('Headless LSP lists discovered metadata + trustStorePath + sha256 + approvalState passively', async () => {
    assert.ok(fs.existsSync(SERVER_JAR), `Server JAR missing at ${SERVER_JAR}`);
    assert.ok(fs.existsSync(TEST_PROBE_JAR), `Test plugin JAR missing at ${TEST_PROBE_JAR}`);

    const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-passive-lsp-'));
    const client = new HeadlessLspClient(undefined, SERVER_JAR);
    const prevDir = process.env.ROS_PLUGINS_DIR;
    const prevEnabled = process.env.ROS_PLUGINS_ENABLED;
    process.env.ROS_PLUGINS_DIR = TEST_PLUGINS_DIR;
    process.env.ROS_PLUGINS_ENABLED = '';
    try {
      await client.start(wsDir);
      const resp = (await client.executeCommand(
        'rostooling.listDiscoveredPlugins',
        []
      )) as DiscoveredPluginsResponse;
      assert.ok(
        typeof resp.trustStorePath === 'string' && resp.trustStorePath.endsWith(path.join('.rostooling', 'trusted-plugins.json')),
        `Expected fixed trustStorePath, got ${JSON.stringify(resp)}`
      );
      assert.ok(Array.isArray(resp.plugins));

      const probe = resp.plugins.find((p) => p.id === 'de.example.extprobe');
      assert.ok(probe, `Missing de.example.extprobe in ${JSON.stringify(resp)}`);
      assert.strictEqual(probe.version, '1.0.0');
      assert.strictEqual(probe.compatible, true);
      assert.strictEqual(probe.enabled, false);
      assert.strictEqual(probe.active, false);
      assert.strictEqual(probe.fileName, 'rostooling-test-plugins.jar');
      assert.strictEqual(probe.sha256, computeFileSha256(TEST_PROBE_JAR));
      assert.strictEqual(probe.approvalState, 'unapproved');
      assert.strictEqual(probe.loadError, '');

      const doc = (await client.executeCommand('rostooling.getPluginDocumentation', ['de.example.extprobe'])) as {
        id: string;
        documentationMarkdown: string;
      };
      assert.strictEqual(doc.id, 'de.example.extprobe');
      assert.ok(doc.documentationMarkdown.includes('External Probe Plugin'));
    } finally {
      await client.stop();
      if (prevDir === undefined) delete process.env.ROS_PLUGINS_DIR;
      else process.env.ROS_PLUGINS_DIR = prevDir;
      if (prevEnabled === undefined) delete process.env.ROS_PLUGINS_ENABLED;
      else process.env.ROS_PLUGINS_ENABLED = prevEnabled;
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
  });
});
