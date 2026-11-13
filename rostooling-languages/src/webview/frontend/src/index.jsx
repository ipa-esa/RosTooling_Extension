import 'reflect-metadata';
import React from 'react';
import { createRoot } from 'react-dom/client';
import './studio.css';
import { RosStudioApp } from './RosStudioApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RosSystemView } from './views/RosSystemView';
import { RosComponentView } from './views/RosComponentView';
import { RosCommObjectsView } from './views/RosCommObjectsView';
import { CatalogueDrawer, filterCatalogueSystems } from './components/CatalogueDrawer';
import { ReadOnlyBanner } from './components/ReadOnlyBanner';
import { layoutFromGGraph, renderDiagramSvg } from '../../../glsp/GGraphSvgRenderer';

if (typeof window !== 'undefined') {
  window.__ROSTOOLING_STUDIO__ = {
    RosStudioApp,
    RosSystemView,
    RosComponentView,
    RosCommObjectsView,
    CatalogueDrawer,
    filterCatalogueSystems,
    ReadOnlyBanner,
    layoutFromGGraph,
    renderDiagramSvg,
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
