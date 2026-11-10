import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './studio.css';
import { RosStudioApp } from './RosStudioApp';
import { ErrorBoundary } from './components/ErrorBoundary';
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
  updateNodePackageAndArtifact,
  runDagreAutoLayout,
  flushPendingEdits,
} from './state/studioStore';

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
    updateNodePackageAndArtifact,
    runDagreAutoLayout,
    flushPendingEdits,
  };
}

function mountStudio() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const rootEl = document.getElementById('root');
  if (!rootEl) return;
  const root = createRoot(rootEl);
  root.render(
    <ErrorBoundary>
      <RosStudioApp />
    </ErrorBoundary>
  );
}

mountStudio();
