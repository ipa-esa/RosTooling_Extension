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
    gGraph: raw.gGraph || null,
    glspMarkers: raw.glspMarkers || [],
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
      case 'updateGlspModel':
        if (handlers.onUpdateGlspModel) {
          handlers.onUpdateGlspModel(msg.gGraph || null, msg.markers || [], msg.project || null);
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
  /** Sends a GLSP Operation/Action to the Java server via the extension host. */
  glspOperation(operation) {
    getVsCodeApi().postMessage({ type: 'glspOperation', operation });
  },
  exportSvg(svg) {
    getVsCodeApi().postMessage({ type: 'exportSvg', svg });
  },
  requestModelRefresh() {
    getVsCodeApi().postMessage({ type: 'requestModelRefresh' });
  },
  undo() {
    getVsCodeApi().postMessage({ type: 'undo' });
  },
  redo() {
    getVsCodeApi().postMessage({ type: 'redo' });
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
