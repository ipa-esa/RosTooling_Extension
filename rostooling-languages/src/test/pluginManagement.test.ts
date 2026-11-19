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
  TrustStoreError,
} from '../plugins/trustedPluginsStore';

suite('Plugin Discovery, Core Approval Store, Migration & UI Suite', function () {
  this.timeout(120000);

  const EXT_ROOT = path.resolve(__dirname, '..', '..');
  const TEST_PLUGINS_DIR = path.resolve(EXT_ROOT, '..', 'build', 'test-plugins');
  const TEST_PROBE_JAR = path.join(TEST_PLUGINS_DIR, 'rostooling-test-plugins.jar');
  const SERVER_JAR = path.resolve(EXT_ROOT, 'server', 'rostooling_extension-2.5.0.jar');

  function makeDummyPlugin(overrides: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin {
    return {
      id: 'de.example.extprobe',
      version: '1.0.0',
      summary: 'Probe',
      supportedCoreVersionRange: '[3.6.0,4.0.0)',
      compatible: true,
      enabled: false,
      active: false,
      sourceJarPath: TEST_PROBE_JAR,
      loadError: '',
      fileName: 'rostooling-test-plugins.jar',
      sha256: 'd'.repeat(64),
      approvalState: 'unapproved',
      ...overrides,
    };
  }

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

  test('missing file creates one entry, approving U1 never approves U2, and corrupt/unknown-version files are never overwritten', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-store-safety-'));
    try {
      const freshPath = path.join(tmpDir, 'fresh', 'trusted-plugins.json');
      const u1Sha = '1'.repeat(64);
      const u2Sha = '2'.repeat(64);

      assert.strictEqual(
        approveTrustedPluginEntry(freshPath, { sha256: u1Sha, fileName: 'u1.jar', id: '' }),
        true
      );
      const parsedFresh = readTrustedPluginsFile(freshPath);
      assert.strictEqual(parsedFresh.version, 1);
      assert.strictEqual(parsedFresh.approved.length, 1);
      assert.strictEqual(parsedFresh.approved[0].sha256, u1Sha);
      assert.strictEqual(parsedFresh.approved.some((e) => e.sha256 === u2Sha), false);

      // Corrupt JSON left byte-identical on approve and migrate
      const corruptPath = path.join(tmpDir, 'corrupt-trusted-plugins.json');
      const corruptContent = '{not-valid-json\n';
      fs.writeFileSync(corruptPath, corruptContent, 'utf8');
      assert.throws(
        () => approveTrustedPluginEntry(corruptPath, { sha256: u1Sha, fileName: 'u1.jar', id: '' }),
        (err: unknown) =>
          err instanceof TrustStoreError &&
          err.message.includes(corruptPath) &&
          err.message.includes('Fix or remove it by hand')
      );
      assert.strictEqual(fs.readFileSync(corruptPath, 'utf8'), corruptContent);
      assert.throws(
        () =>
          migrateLegacyTrustedChecksums({
            legacyChecksums: { 'de.example.a': u1Sha },
            rawPluginPaths: [],
            storePath: corruptPath,
          }),
        TrustStoreError
      );
      assert.strictEqual(fs.readFileSync(corruptPath, 'utf8'), corruptContent);

      // Unknown version left byte-identical untouched
      const unknownVerPath = path.join(tmpDir, 'v9-trusted-plugins.json');
      const unknownVerContent = '{\n  "version": 9,\n  "approved": []\n}\n';
      fs.writeFileSync(unknownVerPath, unknownVerContent, 'utf8');
      assert.throws(
        () => approveTrustedPluginEntry(unknownVerPath, { sha256: u1Sha, fileName: 'u1.jar', id: '' }),
        (err: unknown) => err instanceof TrustStoreError && err.message.includes(unknownVerPath)
      );
      assert.strictEqual(fs.readFileSync(unknownVerPath, 'utf8'), unknownVerContent);

      // Existing entry with invalid sha256 and unknown fields survives new approval verbatim
      const preservePath = path.join(tmpDir, 'preserve-trusted-plugins.json');
      const originalRaw = {
        version: 1,
        topExtra: { owner: 'user' },
        approved: [
          {
            sha256: 'not-a-valid-hex-digest',
            fileName: 'legacy.jar',
            id: 'de.example.custom',
            customTag: 'keep-me-intact',
          },
        ],
      };
      fs.writeFileSync(preservePath, JSON.stringify(originalRaw, null, 2) + '\n', 'utf8');
      assert.strictEqual(
        approveTrustedPluginEntry(preservePath, { sha256: u2Sha, fileName: 'u2.jar', id: 'de.example.u2' }),
        true
      );
      const afterPreserve = JSON.parse(fs.readFileSync(preservePath, 'utf8')) as {
        version: number;
        topExtra: unknown;
        approved: Record<string, unknown>[];
      };
      assert.deepStrictEqual(afterPreserve.topExtra, { owner: 'user' });
      assert.strictEqual(afterPreserve.approved.length, 2);
      assert.deepStrictEqual(afterPreserve.approved[0], originalRaw.approved[0]);
      assert.strictEqual(afterPreserve.approved[1].sha256, u2Sha);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('missing core response aborts approval with error and writes nothing; corrupt approval file surfaces error in controller', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ctrl-errors-'));
    try {
      const errorsShown: string[] = [];
      let approveCalls = 0;

      // 1. No core response (LSP not ready) -> shows error, writes nothing
      const offlineHost: PluginHostAdapter = {
        isWorkspaceTrusted: () => true,
        getWorkspaceDir: () => tmpDir,
        inspectPaths: () => ({ workspaceValue: [TEST_PROBE_JAR] }),
        inspectEnabled: () => ({ workspaceValue: [] }),
        getLegacyGlobalTrustedChecksums: () => undefined,
        approvePluginJar: async () => {
          approveCalls += 1;
        },
        migrateLegacyChecksums: async () => 0,
        updatePluginsSetting: async () => undefined,
        isLspReady: () => false,
        waitForLspReady: async () => false,
        sendExecuteCommand: async <T = unknown>(): Promise<T> => ({}) as T,
        restartServers: async () => undefined,
        refreshMcpConfigs: async () => undefined,
        refreshPluginsView: () => undefined,
        log: () => undefined,
        logWarning: () => undefined,
        showInfo: async () => undefined,
        showWarning: async () => undefined,
        showError: async (msg) => {
          errorsShown.push(msg);
          return undefined;
        },
        showModalConfirm: async () => true,
        pickQuickPick: async () => undefined,
        pickScope: async () => 'workspace',
        promptAddPluginPath: async () => undefined,
        openPluginSettings: async () => undefined,
        openTrustManagement: async () => undefined,
        openMarkdownPreview: async () => undefined,
      };
      const offlineCtrl = new PluginManagerController(offlineHost);
      const samplePlugin = makeDummyPlugin();
      await offlineCtrl.approvePluginJarCommand(samplePlugin);
      await offlineCtrl.enableSinglePlugin(samplePlugin);
      assert.strictEqual(approveCalls, 0);
      assert.strictEqual(errorsShown.length, 2);
      assert.ok(errorsShown.every((m) => m.includes('did not report')));

      // 2. Corrupt file at core-reported path -> controller shows error naming path, file stays byte-identical
      const corruptPath = path.join(tmpDir, 'trusted-plugins.json');
      const rawBytes = 'CORRUPT!';
      fs.writeFileSync(corruptPath, rawBytes, 'utf8');
      const corruptErrors: string[] = [];
      const corruptCtrl = new PluginManagerController({
        ...offlineHost,
        isLspReady: () => true,
        waitForLspReady: async () => true,
        sendExecuteCommand: async <T = unknown>(): Promise<T> =>
          ({ trustStorePath: corruptPath, plugins: [samplePlugin], notices: [] }) as unknown as T,
        approvePluginJar: async (storePath, entry) => {
          approveTrustedPluginEntry(storePath, entry);
        },
        showError: async (msg) => {
          corruptErrors.push(msg);
          return undefined;
        },
      });
      await corruptCtrl.approvePluginJarCommand(samplePlugin);
      assert.strictEqual(fs.readFileSync(corruptPath, 'utf8'), rawBytes);
      assert.strictEqual(corruptErrors.length, 1);
      assert.ok(corruptErrors[0].includes(corruptPath));
      assert.ok(corruptErrors[0].includes('Fix or remove it by hand'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('approval and migration write strictly to core trustStorePath even when it differs from os.homedir()', async () => {
    assert.ok(fs.existsSync(TEST_PROBE_JAR), `Missing test JAR at ${TEST_PROBE_JAR}`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ctrl-core-path-'));
    try {
      // Simulate Java user.home differing completely from Node os.homedir()
      const javaHome = path.join(tmpDir, 'java-user-home');
      const coreTrustPath = path.join(javaHome, '.rostooling', 'trusted-plugins.json');
      const fakeNodeHome = path.join(tmpDir, 'node-os-home');
      const probeSha = computeFileSha256(TEST_PROBE_JAR);
      const legacySetting = { 'de.example.extprobe': probeSha };
      let restarts = 0;
      let mcpRefreshes = 0;
      let viewRefreshes = 0;

      const host: PluginHostAdapter = {
        isWorkspaceTrusted: () => true,
        getWorkspaceDir: () => tmpDir,
        inspectPaths: () => ({ workspaceValue: [TEST_PROBE_JAR] }),
        inspectEnabled: () => ({ workspaceValue: [] }),
        getLegacyGlobalTrustedChecksums: () => legacySetting,
        approvePluginJar: async (storePath, entry) => {
          approveTrustedPluginEntry(storePath, entry);
        },
        migrateLegacyChecksums: async (opts) => migrateLegacyTrustedChecksums(opts),
        updatePluginsSetting: async () => undefined,
        isLspReady: () => true,
        waitForLspReady: async () => true,
        sendExecuteCommand: async <T = unknown>(command: string): Promise<T> => {
          if (command === 'rostooling.listDiscoveredPlugins') {
            return { trustStorePath: coreTrustPath, plugins: [], notices: [] } as unknown as T;
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
        showModalConfirm: async () => true,
        pickQuickPick: async () => undefined,
        pickScope: async () => 'workspace',
        promptAddPluginPath: async () => undefined,
        openPluginSettings: async () => undefined,
        openTrustManagement: async () => undefined,
        openMarkdownPreview: async () => undefined,
      };

      const controller = new PluginManagerController(host);
      const restartedFirst = await controller.runLegacyMigrationOnce();
      assert.strictEqual(restartedFirst, true);
      assert.strictEqual(restarts, 1);
      assert.strictEqual(mcpRefreshes, 1);
      assert.strictEqual(viewRefreshes, 1);
      assert.strictEqual(fs.existsSync(fakeNodeHome), false);

      const migratedStore = readTrustedPluginsFile(coreTrustPath);
      assert.strictEqual(migratedStore.approved.length, 1);
      assert.strictEqual(migratedStore.approved[0].sha256, probeSha);
      assert.strictEqual(migratedStore.approved[0].fileName, 'rostooling-test-plugins.jar');
      assert.strictEqual(legacySetting['de.example.extprobe'], probeSha, 'Legacy setting must not be deleted');

      // Second migration call is idempotent (no duplicate entry, no extra restart)
      const restartedSecond = await controller.runLegacyMigrationOnce();
      assert.strictEqual(restartedSecond, false);
      assert.strictEqual(restarts, 1);
      assert.strictEqual(readTrustedPluginsFile(coreTrustPath).approved.length, 1);

      // Approve another JAR via Approve JAR action -> lands in coreTrustPath, never os.homedir()
      const extraSha = 'e'.repeat(64);
      await controller.approvePluginJarCommand(
        makeDummyPlugin({ id: '', fileName: 'extra.jar', sha256: extraSha })
      );
      const updatedStore = readTrustedPluginsFile(coreTrustPath);
      assert.strictEqual(updatedStore.approved.length, 2);
      assert.ok(updatedStore.approved.some((e) => e.sha256 === extraSha && e.fileName === 'extra.jar'));
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
        makeDummyPlugin({
          sourceJarPath: probeJar,
          fileName: 'extprobe.jar',
          sha256: probeSha,
        }),
        makeDummyPlugin({
          id: 'de.example.future',
          version: '2.0.0',
          summary: 'Incompatible plugin',
          supportedCoreVersionRange: '[99.0.0,100.0.0)',
          compatible: false,
          sourceJarPath: '/tmp/future.jar',
          fileName: 'future.jar',
          sha256: 'b'.repeat(64),
        }),
        makeDummyPlugin({
          id: '',
          version: '',
          summary: '',
          supportedCoreVersionRange: '',
          compatible: false,
          sourceJarPath: unlabeledJar1,
          loadError: NO_METADATA_LOAD_ERROR,
          fileName: 'u1.jar',
          sha256: u1Sha,
        }),
        makeDummyPlugin({
          id: '',
          version: '',
          summary: '',
          supportedCoreVersionRange: '',
          compatible: false,
          sourceJarPath: unlabeledJar2,
          loadError: NO_METADATA_LOAD_ERROR,
          fileName: 'u2.jar',
          sha256: u2Sha,
        }),
      ];

      const globalPaths: string[] | undefined = [tmpDir];
      const workspacePaths: string[] | undefined = undefined;
      const globalEnabled: string[] | undefined = undefined;
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
        getLegacyGlobalTrustedChecksums: () => undefined,
        approvePluginJar: async (storePath, entry) => {
          approveTrustedPluginEntry(storePath, entry);
        },
        migrateLegacyChecksums: async () => 0,
        updatePluginsSetting: async (key, value, target) => {
          if (key === 'plugins.enabled' && target === 'workspace') {
            workspaceEnabled = [...value];
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

      // 1. Cancel modal -> writes nothing
      modalAccept = false;
      await controller.managePlugins();
      assert.strictEqual(modalCalls.length, 1);
      assert.ok(modalCalls[0].detail.includes('extprobe.jar'));
      assert.ok(modalCalls[0].detail.includes(probeSha));
      assert.ok(modalCalls[0].detail.includes(PLUGIN_TRUST_WARNING));
      assert.strictEqual(fs.existsSync(trustStorePath), false);
      assert.strictEqual(restarts, 0);

      // 2. Confirm -> writes one entry to trustStorePath, saves enabled list, restarts
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

      // 4. Changed state triggers changed modal on enable
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
        typeof resp.trustStorePath === 'string' &&
          resp.trustStorePath.endsWith(path.join('.rostooling', 'trusted-plugins.json')),
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
