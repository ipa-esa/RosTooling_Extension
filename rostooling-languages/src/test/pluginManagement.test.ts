import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HeadlessLspClient } from '../mcp/HeadlessLspClient';
import {
  buildMcpPluginCliArgs,
  computeFileSha256,
  resolvePluginPaths,
} from '../plugins/pluginPaths';
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
  readJarPluginMetadataId,
} from '../plugins/pluginTrust';
import { buildPluginTreeDescriptors } from '../plugins/pluginsTreeView';

suite('Plugin Discovery, Trust, UI Controller & Tree View Suite', function () {
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

  test('computeEffectivePluginConfig enforces Workspace Trust and SHA-256 checksum pinning', () => {
    assert.ok(fs.existsSync(TEST_PROBE_JAR), `Missing test JAR at ${TEST_PROBE_JAR}`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-plugin-trust-'));
    try {
      const copiedJar = path.join(tmpDir, 'probe-copy.jar');
      fs.copyFileSync(TEST_PROBE_JAR, copiedJar);
      const realSha = computeFileSha256(copiedJar);
      assert.strictEqual(readJarPluginMetadataId(copiedJar), 'de.example.extprobe');

      // 1. Untrusted workspace ignores workspace paths/enabled and signals blockedByWorkspaceTrust
      const untrusted = computeEffectivePluginConfig({
        isTrusted: false,
        workspaceDir: tmpDir,
        pathsInspect: { workspaceValue: [copiedJar] },
        enabledInspect: { workspaceValue: ['de.example.extprobe'] },
        trustedChecksums: { 'de.example.extprobe': realSha },
      });
      assert.strictEqual(untrusted.blockedByWorkspaceTrust, true);
      assert.deepStrictEqual(untrusted.resolvedPaths, []);
      assert.deepStrictEqual(untrusted.approvedEnabledIds, []);
      assert.deepStrictEqual(buildMcpPluginCliArgs(untrusted.resolvedPaths, untrusted.approvedEnabledIds), []);

      // 2. Trusted workspace WITHOUT trustedChecksums blocks execution until user confirms
      const unconfirmed = computeEffectivePluginConfig({
        isTrusted: true,
        workspaceDir: tmpDir,
        pathsInspect: { workspaceValue: [copiedJar] },
        enabledInspect: { workspaceValue: ['de.example.extprobe'] },
        trustedChecksums: {},
      });
      assert.strictEqual(unconfirmed.blockedByWorkspaceTrust, false);
      assert.deepStrictEqual(unconfirmed.approvedEnabledIds, []);
      assert.deepStrictEqual(unconfirmed.untrustedChecksumIds, ['de.example.extprobe']);

      // 3. Trusted workspace WITH matching checksum approves plugin
      const confirmed = computeEffectivePluginConfig({
        isTrusted: true,
        workspaceDir: tmpDir,
        pathsInspect: { workspaceValue: [copiedJar] },
        enabledInspect: { workspaceValue: ['de.example.extprobe'] },
        trustedChecksums: { 'de.example.extprobe': realSha },
      });
      assert.deepStrictEqual(confirmed.approvedEnabledIds, ['de.example.extprobe']);
      assert.deepStrictEqual(confirmed.untrustedChecksumIds, []);
      assert.deepStrictEqual(confirmed.changedChecksumIds, []);

      // 4. Stale checksum after JAR modification blocks activation
      const stale = computeEffectivePluginConfig({
        isTrusted: true,
        workspaceDir: tmpDir,
        pathsInspect: { workspaceValue: [copiedJar] },
        enabledInspect: { workspaceValue: ['de.example.extprobe'] },
        trustedChecksums: { 'de.example.extprobe': '0'.repeat(64) },
      });
      assert.deepStrictEqual(stale.approvedEnabledIds, []);
      assert.deepStrictEqual(stale.changedChecksumIds, ['de.example.extprobe']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('PluginManagerController handles enable confirmation, cancellation, checksum change, incompatible gating, docs & view refresh', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-plugin-ctrl-'));
    try {
      const copiedJar = path.join(tmpDir, 'extprobe.jar');
      fs.copyFileSync(TEST_PROBE_JAR, copiedJar);
      const sha1 = computeFileSha256(copiedJar);

      const discovered: DiscoveredPlugin[] = [
        {
          id: 'de.example.extprobe',
          version: '1.0.0',
          summary: 'External probe plugin summary',
          supportedCoreVersionRange: '[3.6.0,4.0.0)',
          compatible: true,
          enabled: false,
          active: false,
          sourceJarPath: copiedJar,
          loadError: '',
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
        },
        {
          id: '',
          version: '',
          summary: '',
          supportedCoreVersionRange: '',
          compatible: false,
          enabled: false,
          active: false,
          sourceJarPath: '/tmp/nometadata.jar',
          loadError: NO_METADATA_LOAD_ERROR,
        },
      ];

      let globalPaths: string[] | undefined = [copiedJar];
      let workspacePaths: string[] | undefined;
      let globalEnabled: string[] | undefined;
      let workspaceEnabled: string[] | undefined;
      const trustedChecksums: Record<string, string> = {};
      let modalAccept = false;
      let chosenScope: 'workspace' | 'user' = 'workspace';
      let quickPickHandler: ((items: PluginQuickPickItem[]) => PluginQuickPickItem[] | undefined) | undefined;
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
        getGlobalTrustedChecksums: () => ({ ...trustedChecksums }),
        setGlobalTrustedChecksum: async (id, hash) => {
          trustedChecksums[id] = hash;
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
            return discovered as unknown as T;
          }
          if (command === 'rostooling.getPluginDocumentation') {
            return { id: 'de.example.extprobe', documentationMarkdown: '# Probe Docs\n\nBody text.' } as unknown as T;
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
        pickQuickPick: async (items) => {
          return quickPickHandler ? quickPickHandler(items) : undefined;
        },
        pickScope: async () => chosenScope,
        promptAddPluginPath: async () => '/tmp/extra-plugins',
        openPluginSettings: async () => undefined,
        openTrustManagement: async () => undefined,
        openMarkdownPreview: async (pluginId, markdown) => {
          previewOpened = { pluginId, markdown };
        },
      };

      const controller = new PluginManagerController(host);

      // 1. Picker shows untickable incompatible/no-metadata items + extra actions; cancelling modal leaves plugin disabled
      quickPickHandler = (items) => {
        const probe = items.find((i) => i.plugin?.id === 'de.example.extprobe');
        const compatBlocked = items.find((i) => i.plugin?.id === 'de.example.future');
        const noMeta = items.find((i) => i.plugin?.loadError === NO_METADATA_LOAD_ERROR);
        assert.ok(probe?.tickable, 'Compatible plugin must be tickable');
        assert.strictEqual(compatBlocked?.tickable, false, 'Incompatible plugin must not be tickable');
        assert.strictEqual(noMeta?.tickable, false, 'No-metadata JAR must not be tickable');
        assert.ok(probe?.detail?.includes(copiedJar), 'Picker must display JAR path');
        assert.ok(items.some((i) => i.action === 'addPath'));
        assert.ok(items.some((i) => i.action === 'openSettings'));
        if (!probe) {
          throw new Error('Expected probe item');
        }
        return [probe];
      };
      modalAccept = false;
      await controller.managePlugins();
      assert.strictEqual(modalCalls.length, 1);
      assert.ok(modalCalls[0].detail.includes('de.example.extprobe'));
      assert.ok(modalCalls[0].detail.includes('1.0.0'));
      assert.ok(modalCalls[0].detail.includes(copiedJar));
      assert.ok(modalCalls[0].detail.includes(sha1));
      assert.ok(modalCalls[0].detail.includes(PLUGIN_TRUST_WARNING));
      assert.strictEqual(workspaceEnabled, undefined, 'Cancelled modal must not save enabled list');
      assert.deepStrictEqual(trustedChecksums, {});
      assert.strictEqual(restarts, 0);

      // 2. Accepting modal records SHA-256 in user trustedChecksums, writes workspace enabled list, refreshes MCP & restarts
      modalAccept = true;
      await controller.managePlugins();
      assert.strictEqual(trustedChecksums['de.example.extprobe'], sha1);
      assert.deepStrictEqual(workspaceEnabled, ['de.example.extprobe']);
      assert.strictEqual(restarts, 1);
      assert.strictEqual(mcpRefreshes, 1);
      assert.strictEqual(viewRefreshes, 1);

      // 3. Re-opening QuickPick when already confirmed in same session should NOT re-prompt modal unless JAR changes
      discovered[0].enabled = true;
      discovered[0].active = true;
      await controller.managePlugins();
      assert.strictEqual(modalCalls.length, 2, 'Should stay 2 because selection unchanged');

      // 4. Modify JAR checksum on disk -> tree descriptor flags change & re-enabling re-prompts modal
      fs.appendFileSync(copiedJar, '\n');
      const sha2 = computeFileSha256(copiedJar);
      assert.notStrictEqual(sha2, sha1);
      const effChanged = controller.evaluateEffectiveConfig(false);
      assert.deepStrictEqual(effChanged.changedChecksumIds, ['de.example.extprobe']);

      const treeNodes = buildPluginTreeDescriptors(discovered, effChanged);
      const probeNode = treeNodes.find((n) => n.plugin?.id === 'de.example.extprobe');
      assert.strictEqual(typeof probeNode?.tooltip, 'string', 'Tooltip must be plain text');
      assert.ok(probeNode?.description.includes('Checksum changed'));
      const futureNode = treeNodes.find((n) => n.plugin?.id === 'de.example.future');
      assert.strictEqual(futureNode?.contextValue, 'pluginIncompatible');
      const noMetaNode = treeNodes.find((n) => n.plugin?.loadError === NO_METADATA_LOAD_ERROR);
      assert.strictEqual(noMetaNode?.contextValue, 'pluginFailed');

      chosenScope = 'user';
      modalAccept = true;
      await controller.enableSinglePlugin(discovered[0]);
      assert.strictEqual(modalCalls.length, 3, 'Changed checksum must re-prompt modal');
      assert.ok(modalCalls[2].detail.includes(sha2));
      assert.strictEqual(trustedChecksums['de.example.extprobe'], sha2);
      assert.deepStrictEqual(globalEnabled, ['de.example.extprobe']);

      // 5. Open documentation preview passes plain markdown fetched from server
      await controller.openPluginDocumentation(discovered[0]);
      assert.deepStrictEqual(previewOpened, {
        pluginId: 'de.example.extprobe',
        markdown: '# Probe Docs\n\nBody text.',
      });

      // 6. Disable single plugin removes it from enabled list and restarts
      workspaceEnabled = ['de.example.extprobe'];
      chosenScope = 'workspace';
      await controller.disableSinglePlugin(discovered[0]);
      assert.deepStrictEqual(workspaceEnabled, []);

      // 7. Add plugin JAR or folder... appends path and restarts
      let pickerCalls = 0;
      quickPickHandler = (items) => {
        pickerCalls += 1;
        if (pickerCalls === 1) {
          const addItem = items.find((i) => i.action === 'addPath');
          if (!addItem) {
            throw new Error('Expected addPath action item');
          }
          return [addItem];
        }
        return undefined;
      };
      chosenScope = 'workspace';
      await controller.managePlugins();
      assert.deepStrictEqual(workspacePaths, ['/tmp/extra-plugins']);

      // 8. showPluginLoadError reports incompatible or error details
      const errorsShown: string[] = [];
      const errController = new PluginManagerController({
        ...host,
        showError: async (msg) => {
          errorsShown.push(msg);
          return undefined;
        },
      });
      await errController.showPluginLoadError(discovered[2]);
      assert.ok(errorsShown[0].includes(NO_METADATA_LOAD_ERROR));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('Headless LSP lists discovered metadata plugins passively and returns inactive documentation without activating', async () => {
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
      const discovered = (await client.executeCommand('rostooling.listDiscoveredPlugins', [])) as DiscoveredPlugin[];
      assert.ok(Array.isArray(discovered), `Expected array, got ${JSON.stringify(discovered)}`);

      const probe = discovered.find((p) => p.id === 'de.example.extprobe');
      assert.ok(probe, `Missing de.example.extprobe in ${JSON.stringify(discovered)}`);
      assert.strictEqual(probe.version, '1.0.0');
      assert.strictEqual(probe.compatible, true);
      assert.strictEqual(probe.enabled, false);
      assert.strictEqual(probe.active, false);
      assert.ok(probe.sourceJarPath.endsWith('rostooling-test-plugins.jar'));
      assert.strictEqual(probe.loadError, '');

      const doc = (await client.executeCommand('rostooling.getPluginDocumentation', ['de.example.extprobe'])) as {
        id: string;
        documentationMarkdown: string;
      };
      assert.strictEqual(doc.id, 'de.example.extprobe');
      assert.ok(
        doc.documentationMarkdown.includes('External Probe Plugin'),
        `Expected inactive doc content, got: ${doc.documentationMarkdown}`
      );
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
