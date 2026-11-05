import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { PIPELINE_ROLES, CORESENSE_ROLES, RosProject } from '../model/RosModelTypes';
import { RosLayoutManager } from '../model/RosLayoutManager';
import { DraftContentProvider, StudioApiClient } from '../orchestration/DraftContentProvider';
import { MaterializationGate } from '../orchestration/MaterializationGate';
import { ReconciliationWatcher } from '../orchestration/ReconciliationWatcher';
import { PythonEnvResolver } from '../orchestration/PythonEnvResolver';
import { StudioDaemonManager } from '../orchestration/StudioDaemonManager';
import { getMacroStudioHtml } from '../webview/studioHtml';
import { RosStudioWorkbenchController } from '../editor/CoreSenseStudioPanel';

suite('Unified RosTooling Studio Consolidation Suite', () => {
  const extRoot = path.resolve(__dirname, '..', '..');

  test('PIPELINE_ROLES defines the 8 canonical pipeline roles', () => {
    assert.deepStrictEqual(Array.from(PIPELINE_ROLES), [
      'Sensing',
      'Perception',
      'World Modeling',
      'Planning',
      'Control',
      'Actuation',
      'Communication',
      'Unassigned',
    ]);
    assert.strictEqual(CORESENSE_ROLES, PIPELINE_ROLES);
  });

  test('RosLayoutManager persists and restores pipeline roles in .layout.json sidecar', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rostooling-layout-role-'));
    try {
      const sysPath = path.join(tmpDir, 'nav_system.rossystem');
      fs.writeFileSync(sysPath, 'name: "nav_system"\n', 'utf-8');

      const project: RosProject = {
        formatVersion: 4,
        isRosSystem: true,
        system: { name: 'nav_system' },
        subSystems: [],
        processes: [],
        nodes: [
          {
            id: 'n_lidar',
            label: 'lidar_driver',
            x: 120,
            y: 200,
            role: 'Sensing',
            ifaces: [],
            params: [],
          },
          {
            id: 'n_planner',
            label: 'global_planner',
            x: 460,
            y: 200,
            role: 'Planning',
            ifaces: [],
            params: [],
          },
        ],
        connections: [],
        packages: {},
        types: {},
        view: { tx: 40, ty: 40, k: 1, connectorMode: 'orthogonal' },
      };

      await RosLayoutManager.saveLayoutSchematic(sysPath, project, tmpDir);
      const loaded = RosLayoutManager.loadLayoutSchematic(sysPath, tmpDir);
      assert.ok(loaded, 'Expected layout schematic to be written and loaded');
      assert.strictEqual(loaded.nodes[0]?.role, 'Sensing');
      assert.strictEqual(loaded.nodes[1]?.role, 'Planning');

      const freshProject: RosProject = {
        ...project,
        nodes: [
          { id: 'n_lidar', label: 'lidar_driver', ifaces: [], params: [] },
          { id: 'n_planner', label: 'global_planner', ifaces: [], params: [] },
        ],
      };
      RosLayoutManager.applyLayoutSchematic(freshProject, loaded);
      assert.strictEqual(freshProject.nodes[0]?.role, 'Sensing');
      assert.strictEqual(freshProject.nodes[1]?.role, 'Planning');
      assert.strictEqual(freshProject.nodes[0]?.x, 120);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('DraftContentProvider serves virtual rostooling-draft:// previews from cache and API', async () => {
    const mockClient: StudioApiClient = {
      async request<T>(method: string, apiPath: string): Promise<T> {
        if (method === 'GET' && apiPath.startsWith('/api/projects/')) {
          return { revision: 3 } as T;
        }
        if (method === 'POST' && apiPath.endsWith('/generation/preview')) {
          return {
            outputs: [
              {
                path: 'models/demo_sys.rossystem',
                content: 'name: "demo_sys"\n',
              },
            ],
          } as T;
        }
        throw new Error(`Unexpected mock API call: ${method} ${apiPath}`);
      },
    };

    const provider = new DraftContentProvider(mockClient);
    try {
      const uri = DraftContentProvider.buildDraftUri('proj_alpha', 'models/demo_sys.rossystem');
      assert.strictEqual(uri.scheme, 'rostooling-draft');
      const rendered = await provider.provideTextDocumentContent(uri);
      assert.strictEqual(rendered, 'name: "demo_sys"\n');
    } finally {
      provider.dispose();
    }
  });

  test('getMacroStudioHtml renders CSP-safe Macro Workbench HTML payload', () => {
    const fakeWebview = {
      cspSource: 'vscode-webview-resource:',
      asWebviewUri: (u: vscode.Uri) => u,
    } as unknown as vscode.Webview;

    const html = getMacroStudioHtml({
      extensionUri: vscode.Uri.file(extRoot),
      webview: fakeWebview,
      initialStage: 'architecture',
      pinnedStage: true,
      initialProjectId: 'proj_123',
    });

    assert.ok(html.includes('Content-Security-Policy'));
    assert.ok(html.includes('"mode":"macro"'));
    assert.ok(html.includes('"macroStage":"architecture"'));
    assert.ok(html.includes('"macroPinnedStage":true'));
  });

  test('PythonEnvResolver resolves bundled backend scripts within extension package', async () => {
    const resolver = new PythonEnvResolver(extRoot);
    const backend = await resolver.resolveStudioBackend();
    assert.ok(backend, 'Expected PythonEnvResolver to resolve backend');
    assert.ok(fs.existsSync(backend.serverScriptPath), `Server script must exist: ${backend.serverScriptPath}`);
    assert.strictEqual(path.basename(backend.serverScriptPath), 'studio_server.py');
    assert.ok(fs.existsSync(backend.rosStudioScriptPath), `ros_studio.py must exist: ${backend.rosStudioScriptPath}`);
  });

  test('End-to-end Daemon + MaterializationGate + ReconciliationWatcher round-trip', async function () {
    this.timeout(25000);

    const resolver = new PythonEnvResolver(extRoot);
    const backend = await resolver.resolveStudioBackend();
    if (!backend) {
      this.skip();
      return;
    }

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rostooling-e2e-'));
    const storageRoot = path.join(tmpRoot, 'studio-storage');
    const workspaceDir = path.join(tmpRoot, 'ros_ws');
    fs.mkdirSync(workspaceDir, { recursive: true });

    const daemon = new StudioDaemonManager({
      extensionPath: extRoot,
      storageRoot,
      port: 0,
      envResolver: resolver,
      silentMissingBackend: true,
    });
    const gate = new MaterializationGate(daemon);
    const watcher = new ReconciliationWatcher(daemon, gate, { enableWatchers: false });

    try {
      await daemon.ensureRunning();
      assert.strictEqual(daemon.isRunning(), true);

      // 1. Create a starter project on the daemon and populate Macro brief metadata
      const created = await daemon.request<{
        projectId?: string;
        revision: number;
        project: {
          studio: {
            projectId?: string;
            brief: Record<string, string>;
            modules: Record<string, { role?: string }>;
          };
          nodes: { id: string; label: string }[];
        };
      }>('POST', '/api/projects', { name: 'warehouse_nav', mode: 'starter' });

      const pid = created.projectId ?? created.project.studio.projectId ?? '';
      assert.ok(pid, 'Expected created Studio project ID');

      created.project.studio.brief.purpose = 'Autonomous warehouse AMR navigation';
      const saved = await daemon.request<{ revision: number }>(
        'PUT',
        `/api/projects/${encodeURIComponent(pid)}`,
        {
          expectedRevision: created.revision,
          project: created.project,
        }
      );
      assert.ok(saved.revision >= 1);

      // 2. Verify multi-monitor external stage deep-link URL generation
      const extUrl = await daemon.getExternalStageUrl({
        projectId: pid,
        view: 'architecture',
      });
      const rawUrl = extUrl.toString(true);
      assert.ok(rawUrl.includes('view=architecture'));
      assert.ok(rawUrl.includes(`project=${pid}`));
      assert.ok(rawUrl.includes('token='));

      // 3. Promote Studio architecture to workspace models/ via MaterializationGate
      const promoted = await gate.promoteProjectToWorkspace(pid, workspaceDir, {
        targetSubdir: 'models',
        openInEditor: false,
      });
      assert.ok(promoted.primarySystemFile && fs.existsSync(promoted.primarySystemFile));
      assert.ok(promoted.writtenFiles.length >= 2);
      assert.ok(promoted.layoutFile && fs.existsSync(promoted.layoutFile));

      const initialSchematic = RosLayoutManager.loadLayoutSchematic(
        promoted.primarySystemFile,
        workspaceDir
      );
      assert.ok(initialSchematic);
      const pubLayout = initialSchematic.nodes.find((n) => n.label === 'publisher');
      assert.strictEqual(pubLayout?.role, 'Sensing');

      // 4. Simulate Micro Visual Editor role update + save and run ReconciliationWatcher
      for (const n of initialSchematic.nodes) {
        if (n.label === 'subscriber') {
          n.role = 'Control';
          n.x = 640;
        }
      }
      fs.writeFileSync(promoted.layoutFile, JSON.stringify(initialSchematic, null, 2), 'utf-8');

      let eventFired = false;
      const sub = watcher.onDidReconcile((evt) => {
        if (evt.projectId === pid) {
          eventFired = true;
        }
      });

      const reconciled = await watcher.reconcileFile(promoted.primarySystemFile, pid);
      sub.dispose();

      assert.ok(reconciled, 'Expected ReconciliationWatcher to reconcile promoted .rossystem');
      assert.strictEqual(eventFired, true);

      const finalEnv = reconciled.envelope as {
        project?: {
          nodes?: { id: string; label: string; x?: number }[];
          studio?: {
            brief?: { purpose?: string };
            modules?: Record<string, { role?: string }>;
          };
        };
      };
      // Macro brief intent MUST be preserved intact across Micro round-trip!
      assert.strictEqual(
        finalEnv.project?.studio?.brief?.purpose,
        'Autonomous warehouse AMR navigation'
      );
      // Updated Micro role & coordinate MUST be reflected in Studio project!
      const subNode = finalEnv.project?.nodes?.find((n) => n.label === 'subscriber');
      assert.ok(subNode);
      assert.strictEqual(finalEnv.project?.studio?.modules?.[subNode.id]?.role, 'Control');
      assert.strictEqual(subNode.x, 640);
    } finally {
      watcher.dispose();
      daemon.dispose();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('RosStudioWorkbenchController: reloadActiveProject handles external project.json changes', async function () {
    this.timeout(15000);
    const resolver = new PythonEnvResolver(extRoot);
    const backend = await resolver.resolveStudioBackend();
    if (!backend) {
      this.skip();
      return;
    }

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-reload-test-'));
    const daemon = new StudioDaemonManager({
      extensionPath: extRoot,
      storageRoot: path.join(tmpRoot, 'studio-storage'),
      port: 0,
      envResolver: resolver,
      silentMissingBackend: true,
    });

    try {
      await daemon.ensureRunning();
      const created = await daemon.request<{ projectId?: string; project?: Record<string, unknown> }>(
        'POST',
        '/api/projects',
        { name: 'reload_demo', mode: 'starter' }
      );
      const pid = String(created.projectId || '');
      assert.ok(pid);

      const gate = new MaterializationGate(daemon);
      const draft = new DraftContentProvider(daemon);
      const watcher = new ReconciliationWatcher(daemon, gate, { enableWatchers: false });

      const mockCtx = {
        extensionPath: extRoot,
        extensionUri: vscode.Uri.file(extRoot),
        asAbsolutePath: (rel: string) => path.join(extRoot, rel),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext;

      const controller = new RosStudioWorkbenchController(mockCtx, daemon, gate, draft, watcher);

      // Select project in controller
      controller.openOrShow('intent', pid);
      assert.strictEqual(controller.getActiveProjectId(), pid);

      // Simulate external project modification on daemon
      const modProj = JSON.parse(JSON.stringify(created.project || {}));
      if (!modProj.studio) modProj.studio = {};
      if (!modProj.studio.brief) modProj.studio.brief = {};
      modProj.studio.brief.purpose = 'Modified externally by agent';

      await daemon.request('PUT', `/api/projects/${encodeURIComponent(pid)}`, {
        expectedRevision: 1,
        project: modProj,
      });

      // Reload project via controller
      await controller.reloadActiveProject();

      controller.dispose();
      watcher.dispose();
    } finally {
      daemon.dispose();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
