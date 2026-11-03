// ============================================================================
// VS Code Webview Bidirectional Bridge
// Speaks the exact protocol implemented in RosCustomEditorProvider.ts
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
};
