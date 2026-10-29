import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './studio.css';
import { RosStudioApp } from './RosStudioApp';

function mountStudio() {
  if (typeof document === 'undefined') return;
  const rootEl = document.getElementById('root');
  if (!rootEl) return;
  const root = createRoot(rootEl);
  root.render(<RosStudioApp />);
}

mountStudio();
