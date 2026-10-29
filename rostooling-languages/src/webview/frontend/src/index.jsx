import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './studio.css';
import { RosStudioApp } from './RosStudioApp';
import { RosSystemView } from './views/RosSystemView';
import { RosComponentView } from './views/RosComponentView';
import { RosCommObjectsView } from './views/RosCommObjectsView';
import { ProcessGroupNode } from './components/ProcessGroupNode';
import { RosNodeCard } from './components/RosNodeCard';
import { SubsystemNodeCard } from './components/SubsystemNodeCard';
import { CatalogueDrawer } from './components/CatalogueDrawer';
import { ReadOnlyBanner } from './components/ReadOnlyBanner';
import {
  validatePortConnection,
  updateNodeLabel,
  updateNodePackageAndArtifact,
  runDagreAutoLayout,
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
    CatalogueDrawer,
    ReadOnlyBanner,
    validatePortConnection,
    updateNodeLabel,
    updateNodePackageAndArtifact,
    runDagreAutoLayout,
  };
}

function mountStudio() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const rootEl = document.getElementById('root');
  if (!rootEl) return;
  const root = createRoot(rootEl);
  root.render(<RosStudioApp />);
}

mountStudio();
