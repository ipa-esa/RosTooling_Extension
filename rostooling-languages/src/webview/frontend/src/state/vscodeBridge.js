// ============================================================================
// VS Code Webview Bidirectional Bridge
// Speaks the exact protocol implemented in RosCustomEditorProvider.ts
// and RosStudioWorkbenchPanel.ts (Macro Lifecycle Workbench)
// ============================================================================

let vscodeApiInstance = null;

export function getVsCodeApi() {
  if (!vscodeApiInstance) {
    if (typeof acquireVsCodeApi === 'function') {
      vscodeApiInstance = acquireVsCodeApi();
    } else {
      vscodeApiInstance = {
        postMessage: () => {},
        getState: () => null,
        setState: () => {},
      };
    }
  }
  return vscodeApiInstance;
}

export function getInitialData() {
  const raw = (typeof window !== 'undefined' && window.INITIAL_DATA) || {};
  const project = raw.project || {
    formatVersion: 4,
    isRosSystem: true,
    isRos: false,
    system: { name: 'ros_system' },
    subSystems: [],
    processes: [],
    nodes: [],
    connections: [],
    packages: {},
    types: {},
    diagnostics: [],
    view: { tx: 40, ty: 40, k: 1, connectorMode: 'orthogonal', subStates: {}, subPos: {} },
  };
  const mode =
    raw.mode ||
    (project.isRos ? 'ros' : project.isRosSystem !== false ? 'system' : 'component');

  return {
    project,
    mode,
    macroStage: raw.macroStage || 'intent',
    macroPinnedStage: Boolean(raw.macroPinnedStage),
    macroInitialProjectId: raw.macroInitialProjectId || '',
    macroWorkspaceRoot: raw.macroWorkspaceRoot || '',
    isReadOnly: Boolean(raw.isReadOnly),
    docFileName: raw.docFileName || '',
    nodeIndex: raw.nodeIndex || {},
    typeIndex: raw.typeIndex || {},
  };
}

export function registerHostMessageListener(handlers) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }
  const listener = (event) => {
    const msg = event && event.data;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'updateModel':
        if (handlers.onUpdateModel && msg.project) {
          handlers.onUpdateModel(msg.project);
        }
        break;
      case 'updateDiagnostics':
        if (handlers.onUpdateDiagnostics) {
          handlers.onUpdateDiagnostics(msg.diagnostics || []);
        }
        break;
      case 'updateCatalogue':
        if (handlers.onUpdateCatalogue) {
          handlers.onUpdateCatalogue(msg.nodeCatalog || {}, msg.typeCatalog || {});
        }
        break;
      case 'macroState':
        if (handlers.onMacroState) {
          handlers.onMacroState(msg);
        }
        break;
      case 'macroChecksResult':
        if (handlers.onMacroChecksResult) {
          handlers.onMacroChecksResult(msg);
        }
        break;
      case 'macroMcpResult':
        if (handlers.onMacroMcpResult) {
          handlers.onMacroMcpResult(msg);
        }
        break;
      case 'macroSourcesResult':
        if (handlers.onMacroSourcesResult) {
          handlers.onMacroSourcesResult(msg);
        }
        break;
      case 'macroWorkspaceFolderPicked':
        if (handlers.onMacroWorkspaceFolderPicked) {
          handlers.onMacroWorkspaceFolderPicked(msg.path || '');
        }
        break;
      case 'macroNavigateStage':
        if (handlers.onMacroNavigateStage) {
          handlers.onMacroNavigateStage(msg.stage || 'architecture');
        }
        break;
      case 'macroToast':
        if (handlers.onMacroToast) {
          handlers.onMacroToast(msg.text || '', Boolean(msg.isError));
        }
        break;
      case 'macroExternalChange':
        if (handlers.onMacroExternalChange) {
          handlers.onMacroExternalChange(msg);
        }
        break;
      default:
        break;
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export const hostBridge = {
  applyEdit(project) {
    getVsCodeApi().postMessage({ type: 'applyEdit', project });
  },
  saveLayout(project) {
    getVsCodeApi().postMessage({ type: 'saveLayout', project });
  },
  openComponentRos2({ from, pkg, artifact, label }) {
    getVsCodeApi().postMessage({ type: 'openComponentRos2', from, pkg, artifact, label });
  },
  openSubsystemRosSystem({ subRef, fromFile }) {
    getVsCodeApi().postMessage({ type: 'openSubsystemRosSystem', subRef, fromFile });
  },
  generateCode() {
    getVsCodeApi().postMessage({ type: 'generateCode' });
  },
  generateWrappers(selectedNodes) {
    getVsCodeApi().postMessage({ type: 'generateWrappers', selectedNodes });
  },
  openCodeView() {
    getVsCodeApi().postMessage({ type: 'openCodeView' });
  },
  pullCatalogue() {
    getVsCodeApi().postMessage({ type: 'pullCatalogue' });
  },
  browseCatalogueFolder() {
    getVsCodeApi().postMessage({ type: 'browseCatalogueFolder' });
  },
  removeCatalogueFolder(folderId) {
    getVsCodeApi().postMessage({ type: 'removeCatalogueFolder', folderId });
  },

  // Macro Lifecycle Workbench Messages
  macroReady() {
    getVsCodeApi().postMessage({ type: 'macroReady' });
  },
  macroSelectProject(projectId) {
    getVsCodeApi().postMessage({ type: 'macroSelectProject', projectId });
  },
  macroCreateProject(name, goal) {
    getVsCodeApi().postMessage({ type: 'macroCreateProject', name, goal });
  },
  macroDeleteProject(projectId) {
    getVsCodeApi().postMessage({ type: 'macroDeleteProject', projectId });
  },
  macroSaveProject(project) {
    getVsCodeApi().postMessage({ type: 'macroSaveProject', project });
  },
  macroPromoteToModels(targetSubdir = 'models') {
    getVsCodeApi().postMessage({ type: 'macroPromoteToModels', targetSubdir });
  },
  macroPreviewDraftDsl() {
    getVsCodeApi().postMessage({ type: 'macroPreviewDraftDsl' });
  },
  macroRunChecks() {
    getVsCodeApi().postMessage({ type: 'macroRunChecks' });
  },
  macroRunMcpStep(step, payload = {}) {
    getVsCodeApi().postMessage({ type: 'macroRunMcpStep', step, payload });
  },
  macroPopOutStage(stage) {
    getVsCodeApi().postMessage({ type: 'macroPopOutStage', stage });
  },
  macroOpenExternalBrowser(stage) {
    getVsCodeApi().postMessage({ type: 'macroOpenExternalBrowser', stage });
  },
  macroFetchRepository(url, branch) {
    getVsCodeApi().postMessage({ type: 'macroFetchRepository', url, branch });
  },
  macroInspectSources(customPath) {
    getVsCodeApi().postMessage({ type: 'macroInspectSources', path: customPath });
  },
  macroBrowseWorkspaceFolder() {
    getVsCodeApi().postMessage({ type: 'macroBrowseWorkspaceFolder' });
  },
  macroExtractSelectedPackages(packages) {
    getVsCodeApi().postMessage({ type: 'macroExtractSelectedPackages', packages });
  },
  macroInstallAgentSkills() {
    getVsCodeApi().postMessage({ type: 'macroInstallAgentSkills' });
  },
  macroReloadProject() {
    getVsCodeApi().postMessage({ type: 'macroReloadProject' });
  },
};
