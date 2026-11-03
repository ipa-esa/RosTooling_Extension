import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './studio.css';
import { RosStudioApp } from './RosStudioApp';
import { RosSystemView, estimateCardHeight, estimateCardWidth } from './views/RosSystemView';
import { RosComponentView } from './views/RosComponentView';
import { RosCommObjectsView } from './views/RosCommObjectsView';
import { ProcessGroupNode } from './components/ProcessGroupNode';
import { RosNodeCard } from './components/RosNodeCard';
import { SubsystemNodeCard } from './components/SubsystemNodeCard';
import { JumpOrthogonalEdge } from './components/JumpOrthogonalEdge';
import { CatalogueDrawer, filterCatalogueSystems } from './components/CatalogueDrawer';
import { ReadOnlyBanner } from './components/ReadOnlyBanner';
import {
  validatePortConnection,
  updateNodeLabel,
  updateNodeRole,
  getNodeRole,
  updateNodePackageAndArtifact,
  runDagreAutoLayout,
  PIPELINE_ROLES,
  PIPELINE_ROLE_KEYS,
  CORESENSE_ROLES,
  CORESENSE_ROLE_KEYS,
  normalizeRosType,
  nameOf,
  getPortTokens,
  portsMatch,
  connectionProblem,
  connectMatchingOnProject,
  connectPlaced,
  addAndConnect,
  normalizeDiagnostics,
} from './state/studioStore';
import { hostBridge } from './state/vscodeBridge';

if (typeof window !== 'undefined') {
  window.__ROSTOOLING_STUDIO__ = {
    RosStudioApp,
    RosSystemView,
    RosComponentView,
    RosCommObjectsView,
    ProcessGroupNode,
    RosNodeCard,
    SubsystemNodeCard,
    JumpOrthogonalEdge,
    CatalogueDrawer,
    filterCatalogueSystems,
    ReadOnlyBanner,
    estimateCardHeight,
    estimateCardWidth,
    validatePortConnection,
    updateNodeLabel,
    updateNodeRole,
    getNodeRole,
    updateNodePackageAndArtifact,
    runDagreAutoLayout,
    PIPELINE_ROLES,
    PIPELINE_ROLE_KEYS,
    CORESENSE_ROLES,
    CORESENSE_ROLE_KEYS,
    normalizeRosType,
    nameOf,
    getPortTokens,
    portsMatch,
    connectionProblem,
    connectMatchingOnProject,
    connectPlaced,
    addAndConnect,
    normalizeDiagnostics,
  };
}

class GlobalStudioErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[RosTooling Studio Global Error]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 30, background: '#1e1e24', color: '#f3f4f6', minHeight: '100vh', fontFamily: 'sans-serif' }}>
          <h2 style={{ color: '#ef4444', margin: '0 0 12px' }}>RosTooling Studio Display Recovery</h2>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: '#9ca3af' }}>An unexpected render error occurred:</p>
          <pre style={{ background: '#111827', color: '#f87171', padding: 12, borderRadius: 6, fontSize: 12, overflowX: 'auto' }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button
            type="button"
            style={{ marginTop: 14, background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
            onClick={() => {
              this.setState({ hasError: false, error: null });
              try {
                hostBridge.macroReady();
              } catch (_) {}
            }}
          >
            Reload Studio
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function mountStudio() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const rootEl = document.getElementById('root');
  if (!rootEl) return;
  const root = createRoot(rootEl);
  root.render(
    <GlobalStudioErrorBoundary>
      <RosStudioApp />
    </GlobalStudioErrorBoundary>
  );
}

mountStudio();
