import * as vscode from 'vscode';
import { RosProject } from '../model/RosModelTypes';

export function getStudioHtml(
  project: RosProject,
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  nodeIndex: unknown,
  typeIndex: unknown
): string {
  void extensionUri;
  void webview;
  const nonce = getNonce();
  const isRos = Boolean(project.isRos);
  const isRosSystem = project.isRosSystem !== false && !isRos;
  const modeClass = isRos ? 'mode-ros' : (isRosSystem ? 'mode-system' : 'mode-component');
  const modeBadgeText = isRos ? 'Communication Objects (.ros)' : (isRosSystem ? 'System (.rossystem)' : 'Component (.ros2)');
  const modeBadgeClass = isRos ? 'mode-ros' : (isRosSystem ? 'mode-sys' : 'mode-comp');
  const projectJson = JSON.stringify(project).replace(/</g, '\\u003c');
  const nodeIndexJson = JSON.stringify(nodeIndex || {}).replace(/</g, '\\u003c');
  const typeIndexJson = JSON.stringify(typeIndex || {}).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>RosTooling Visual Studio</title>
<style>
  :root {
    --paper: var(--vscode-editor-background, #1e1e1e);
    --surface: var(--vscode-sideBar-background, #252526);
    --surface-2: var(--vscode-input-background, #2d2d2d);
    --surface-hover: var(--vscode-list-hoverBackground, #2a2d2e);
    --rule: var(--vscode-panel-border, #3c3c3c);
    --rule-soft: rgba(255, 255, 255, 0.08);
    --ink: var(--vscode-foreground, #cccccc);
    --ink-2: var(--vscode-descriptionForeground, #9d9d9d);
    --ink-3: var(--vscode-disabledForeground, #666666);
    --accent: var(--vscode-button-background, #0e639c);
    --accent-hover: var(--vscode-button-hoverBackground, #1177bb);
    --accent-text: var(--vscode-button-foreground, #ffffff);
    --warn: #d9a94a;
    --warn-wash: rgba(217, 169, 74, 0.15);
    --dead: #f14c4c;
    --dead-wash: rgba(241, 76, 76, 0.15);
    --edge: #6c7b76;
    --edge-hot: #4fdfb1;
    --glow: #4fdfb1;
    
    /* Semantic Interaction Colors */
    --k-pub: #4fdfb1;
    --k-pub-bg: rgba(79, 223, 177, 0.15);
    --k-sub: #7c9bd1;
    --k-sub-bg: rgba(124, 155, 209, 0.15);
    --k-ss: #d9a94a;
    --k-ss-bg: rgba(217, 169, 74, 0.15);
    --k-sc: #c79362;
    --k-sc-bg: rgba(199, 147, 98, 0.15);
    --k-as: #a78be0;
    --k-as-bg: rgba(167, 139, 224, 0.15);
    --k-ac: #d9707c;
    --k-ac-bg: rgba(217, 112, 124, 0.15);
    --k-param: #8fb39b;
    --k-param-bg: rgba(143, 179, 155, 0.15);
    --k-subsystem: #5c88c7;
    --k-subsystem-bg: rgba(92, 136, 199, 0.12);

    --shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    --shadow-lift: 0 8px 24px rgba(0, 0, 0, 0.45);
    --font-mono: var(--vscode-editor-font-family, "Cascadia Code", Consolas, monospace);
    --font-sans: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  }

  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; background: var(--paper); color: var(--ink); font-family: var(--font-sans); font-size: 13px; user-select: none; }
  button, input, select { font-family: inherit; }

  /* Top Navigation Bar */
  .topbar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.45rem 0.9rem;
    background: var(--surface);
    border-bottom: 1px solid var(--rule);
    z-index: 10;
    flex-shrink: 0;
  }
  .brand {
    font-weight: 700;
    font-size: 0.95rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--ink);
  }
  .brand-badge {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
    background: var(--accent);
    color: var(--accent-text);
  }
  .sysname-wrap {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    color: var(--ink-2);
  }
  .sysname-input {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    background: var(--surface-2);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 0.2rem 0.45rem;
    color: var(--ink);
    width: 18ch;
  }
  .sysname-input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .spacer { flex: 1; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.78rem;
    font-weight: 500;
    padding: 0.32rem 0.65rem;
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--ink);
    border: 1px solid var(--rule);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn:hover {
    background: var(--surface-hover);
    border-color: var(--ink-3);
  }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .btn.primary:hover {
    background: var(--accent-hover);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Main Workspace Layout */
  .workspace {
    display: flex;
    flex: 1;
    height: calc(100% - 41px);
    position: relative;
    overflow: hidden;
  }

  /* Left Sidebar / Rail */
  .rail {
    width: 210px;
    background: var(--surface);
    border-right: 1px solid var(--rule);
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 0.8rem;
    overflow-y: auto;
    flex-shrink: 0;
    z-index: 5;
  }
  .rail-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .rail-title {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-3);
    margin: 0 0 0.2rem 0;
  }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.76rem;
    color: var(--ink-2);
    cursor: pointer;
    padding: 0.15rem 0;
  }
  .filter-swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  /* Canvas Area */
  .canvas-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
    touch-action: none;
    background: radial-gradient(circle, var(--rule-soft) 1.2px, transparent 1.2px);
    background-size: 24px 24px;
  }
  .canvas-wrap.panning { cursor: grabbing; }
  .canvas {
    position: absolute;
    width: 6000px;
    height: 6000px;
    min-width: 6000px;
    min-height: 6000px;
    transform-origin: 0 0;
  }
  .canvas svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible !important;
    pointer-events: none;
    z-index: 1;
  }

  /* Nodes */
  .node {
    position: absolute;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    border: 1.5px solid var(--rule);
    border-radius: 8px;
    box-shadow: var(--shadow);
    min-width: 220px;
    z-index: 2;
    cursor: pointer;
    transition: box-shadow 0.15s ease, border-color 0.15s ease;
  }
  .node:hover {
    box-shadow: var(--shadow-lift);
    border-color: var(--ink-3);
  }
  .node.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent), var(--shadow-lift);
  }
  .node .nhead {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.65rem;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid var(--rule-soft);
    cursor: grab;
  }
  .node .nhead:active { cursor: grabbing; }
  .node .ntitle {
    font-weight: 650;
    font-size: 0.84rem;
    color: var(--ink);
  }
  .node .nmeta {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: var(--ink-3);
    padding: 0.2rem 0.65rem 0;
  }
  .node .badge {
    font-size: 0.6rem;
    font-weight: 600;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    background: var(--surface-2);
    color: var(--ink-2);
    margin-left: auto;
  }
  .node .badge.cat {
    background: var(--k-pub-bg);
    color: var(--k-pub);
  }

  .ifaces {
    padding: 0.35rem 0;
  }
  .iface-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0.65rem;
    font-size: 0.76rem;
    min-height: 24px;
  }
  .iface-row .kd {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 700;
    text-transform: uppercase;
    width: 2.2em;
    text-align: center;
    border-radius: 3px;
    padding: 0.1rem 0;
    color: #fff;
    flex-shrink: 0;
  }
  .kd.pub { background: var(--k-pub); color: #111; }
  .kd.sub { background: var(--k-sub); }
  .kd.ss { background: var(--k-ss); color: #111; }
  .kd.sc { background: var(--k-sc); }
  .kd.as { background: var(--k-as); }
  .kd.ac { background: var(--k-ac); }

  .iface-row .inm {
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
  }
  .iface-row .ity {
    font-family: var(--font-mono);
    font-size: 0.63rem;
    color: var(--ink-3);
    margin-left: auto;
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: 0.4rem;
  }

  /* Parameters inside Node */
  .params-band {
    border-top: 1px dashed var(--rule);
    padding: 0.25rem 0.65rem;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.72rem;
    padding: 0.1rem 0;
  }
  .prow .pk {
    font-family: var(--font-mono);
    font-size: 0.54rem;
    font-weight: 700;
    border-radius: 3px;
    padding: 0.05rem 0.3rem;
    background: var(--k-param);
    color: #111;
  }
  .prow .pnm { font-weight: 600; }
  .prow .pvl {
    font-family: var(--font-mono);
    font-size: 0.63rem;
    color: var(--ink-3);
    margin-left: auto;
    max-width: 12ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Inline addition buttons on node cards */
  .iface-add-row {
    padding: 3px 8px;
    font-size: 0.72rem;
    color: var(--accent-hover);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    border-top: 1px dashed var(--rule-soft);
  }
  .iface-add-row:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.05);
  }
  .param-add-row {
    padding: 2px 8px;
    font-size: 0.7rem;
    color: var(--k-param);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    border-top: 1px dashed var(--rule-soft);
    margin-top: 2px;
  }
  .param-add-row:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.05);
  }

  /* UML Type Schema Cards (.ros) */
  .mode-ros { background: rgba(167, 139, 224, 0.2); color: var(--k-as); border: 1px solid rgba(167, 139, 224, 0.4); }
  .node.type-card {
    min-width: 210px;
    border-color: rgba(167, 139, 224, 0.35);
    background: var(--surface);
  }
  .type-badge {
    font-size: 0.62rem;
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .type-badge.msg { background: var(--k-pub-bg); color: var(--k-pub); border: 1px solid var(--k-pub); }
  .type-badge.srv { background: var(--k-ss-bg); color: var(--k-ss); border: 1px solid var(--k-ss); }
  .type-badge.action { background: var(--k-as-bg); color: var(--k-as); border: 1px solid var(--k-as); }

  .type-sec {
    padding: 2px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  .type-sec-title {
    font-size: 0.64rem;
    text-transform: uppercase;
    color: var(--ink-3);
    font-weight: 700;
    padding: 2px 8px;
    letter-spacing: 0.5px;
    background: rgba(255, 255, 255, 0.02);
  }
  .type-field-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 8px;
    font-size: 0.76rem;
    font-family: var(--font-mono);
  }
  .type-field-row:hover {
    background: var(--surface-hover);
  }
  .type-field-row .f-type {
    color: var(--k-sub);
    margin-right: 6px;
  }
  .type-field-row .f-name {
    color: var(--ink);
    font-weight: 500;
  }
  .type-field-row .f-val {
    color: var(--warn);
    font-weight: 600;
    margin-left: 4px;
  }

  /* Ports */
  .port {
    position: absolute;
    top: 50%;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--surface);
    transform: translateY(-50%);
    cursor: crosshair;
    z-index: 4;
    transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  }
  .port.src { right: -6px; }
  .port.snk { left: -6px; }
  .port.pub { background: var(--k-pub); }
  .port.sub { background: var(--k-sub); }
  .port.ss { background: var(--k-ss); }
  .port.sc { background: var(--k-sc); }
  .port.as { background: var(--k-as); }
  .port.ac { background: var(--k-ac); }

  /* Interactive Wire Dragging States */
  .port.legal {
    transform: translateY(-50%) scale(1.4);
    box-shadow: 0 0 0 4px var(--glow), 0 0 12px var(--glow);
    z-index: 6;
    animation: portPulse 1.2s infinite alternate;
  }
  .port.illegal {
    opacity: 0.15 !important;
  }
  .port.snapped {
    transform: translateY(-50%) scale(1.6);
    box-shadow: 0 0 0 6px #fff, 0 0 16px var(--glow);
  }
  @keyframes portPulse {
    0% { box-shadow: 0 0 0 3px var(--glow); }
    100% { box-shadow: 0 0 0 7px rgba(79, 223, 177, 0.4); }
  }

  /* Subsystem Container Styles */
  .node.subbox {
    border: 2px solid var(--k-subsystem);
    background: var(--surface);
    min-width: 240px;
  }
  .node.subbox .nhead {
    background: var(--k-subsystem-bg);
  }
  .subtog {
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--ink);
  }
  .subtog:hover { background: rgba(255, 255, 255, 0.2); }

  .subframe {
    position: absolute;
    border: 2px dashed var(--k-subsystem);
    border-radius: 12px;
    background: var(--k-subsystem-bg);
    z-index: 0;
    pointer-events: none;
  }
  .subframe .sfhead {
    position: absolute;
    top: -0.9rem;
    left: 0.9rem;
    background: var(--surface);
    border: 1.5px solid var(--k-subsystem);
    border-radius: 999px;
    padding: 0.1rem 0.6rem;
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--k-subsystem);
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  /* Edges / Connections - Boxy Orthogonal & Jump Bridges */
  path.edge {
    fill: none;
    stroke: var(--edge);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: stroke 0.15s ease, stroke-width 0.15s ease;
  }
  path.edge:hover {
    stroke: var(--edge-hot);
    stroke-width: 3.2;
  }
  path.edge.sel {
    stroke: var(--edge-hot);
    stroke-width: 3.4;
  }
  path.edge.topic { marker-end: url(#ah); }
  path.edge.rr { marker-end: url(#ah); marker-start: url(#ahOpen); }
  path.rubber {
    stroke: var(--edge-hot);
    stroke-width: 2.2;
    stroke-dasharray: 6 4;
    stroke-linecap: round;
    stroke-linejoin: round;
    fill: none;
    pointer-events: none;
  }
  path.edge.abstracted {
    stroke: var(--k-subsystem);
    stroke-width: 2.4;
    stroke-dasharray: 4 2;
  }

  /* Floating HUD Tooltip */
  .wire-hud {
    position: absolute;
    z-index: 100;
    pointer-events: none;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 0.4rem 0.65rem;
    box-shadow: var(--shadow-lift);
    font-size: 0.74rem;
    display: none;
    transform: translate(14px, 14px);
    max-width: 280px;
  }
  .wire-hud.valid {
    border-color: var(--k-pub);
    background: rgba(20, 40, 30, 0.95);
  }
  .wire-hud.invalid {
    border-color: var(--dead);
    background: rgba(50, 20, 25, 0.95);
  }
  .wire-hud .hud-title { font-weight: 700; margin-bottom: 0.15rem; }
  .wire-hud .hud-sub { font-size: 0.66rem; color: var(--ink-2); font-family: var(--font-mono); }

  /* Mode Badge and Component Mode Adjustments */
  .brand-badge.mode-sys {
    background: var(--k-subsystem-bg);
    color: var(--k-subsystem);
  }
  .brand-badge.mode-comp {
    background: var(--k-pub-bg);
    color: var(--k-pub);
  }
  body.mode-component .port {
    cursor: default;
  }

  /* Block Resize Handles */
  .resize-handle {
    position: absolute;
    width: 14px;
    height: 14px;
    right: 0;
    bottom: 0;
    cursor: nwse-resize;
    z-index: 12;
    pointer-events: auto;
  }
  .resize-handle::after {
    content: '';
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 6px;
    height: 6px;
    border-right: 2px solid var(--ink-3);
    border-bottom: 2px solid var(--ink-3);
    transition: border-color 0.15s ease;
  }
  .resize-handle:hover::after {
    border-color: var(--accent);
  }

  /* Movable Connection Edge Handles & Waypoints */
  .edge-handle {
    fill: var(--surface);
    stroke: var(--edge);
    stroke-width: 2.5;
    transition: stroke 0.15s ease, r 0.15s ease, fill 0.15s ease;
    pointer-events: auto !important;
  }
  .edge-handle.handle-v {
    cursor: col-resize;
  }
  .edge-handle.handle-h {
    cursor: row-resize;
  }
  .edge-handle.handle-waypoint {
    fill: #4fdfb1;
    stroke: #ffffff;
    stroke-width: 2.5;
    cursor: move;
  }
  .edge-handle:hover, .edge-handle.sel {
    stroke: #ffffff;
    fill: var(--accent);
    r: 7.5;
  }
  .edge-handle.handle-waypoint:hover, .edge-handle.handle-waypoint.sel {
    stroke: #ffffff;
    fill: #1177bb;
    r: 9;
    filter: drop-shadow(0 0 5px #4fdfb1);
  }

  /* Hide connection dots in .ros Communication Objects Mode */
  .mode-ros .port, .type-card .port {
    display: none !important;
  }
  .mode-ros .edge-handle {
    display: none !important;
  }

  /* Connector Mode Segmented Group */
  .connector-mode-group {
    display: inline-flex;
    align-items: center;
    background: var(--surface-2);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 2px;
    gap: 2px;
  }
  .connector-mode-group .mode-btn {
    border: none;
    background: transparent;
    padding: 0.22rem 0.5rem;
    font-size: 0.72rem;
    border-radius: 3px;
    color: var(--ink-2);
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
  }
  .connector-mode-group .mode-btn:hover {
    color: var(--ink);
    background: var(--surface-hover);
  }
  .connector-mode-group .mode-btn.active {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }

  /* Catalogue Tabs */
  .cat-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 0.55rem;
  }
  .cat-tab-btn {
    flex: 1;
    text-align: center;
    padding: 0.22rem 0.4rem;
    font-size: 0.72rem;
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--ink-2);
    border: 1px solid var(--rule);
    cursor: pointer;
  }
  .cat-tab-btn:hover {
    color: var(--ink);
    background: var(--surface-hover);
  }
  .cat-tab-btn.active {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
    border-color: var(--accent);
  }

  /* Floating Controls */
  .viewbar, .findbar {
    position: absolute;
    z-index: 7;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 6px;
    box-shadow: var(--shadow);
    padding: 0.3rem 0.45rem;
  }
  .viewbar { bottom: 0.8rem; left: 0.8rem; }
  .findbar { top: 0.8rem; left: 0.8rem; }
  .findbar input {
    font-family: var(--font-mono);
    font-size: 0.76rem;
    background: var(--surface-2);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 0.2rem 0.4rem;
    color: var(--ink);
    width: 16ch;
  }
  .findbar input:focus { border-color: var(--accent); outline: none; }

  /* Collapsible Right Inspector Panel */
  .inspector {
    width: 290px;
    background: var(--surface);
    border-left: 1px solid var(--rule);
    overflow-y: auto;
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    flex-shrink: 0;
    transition: width 0.22s ease, padding 0.22s ease;
    position: relative;
  }
  .inspector.collapsed {
    width: 0px !important;
    padding: 0 !important;
    overflow: hidden !important;
    border-left: none !important;
  }
  .btn-toggle-inspector {
    position: absolute;
    top: 0.8rem;
    right: 290px;
    z-index: 8;
    background: var(--surface);
    border: 1px solid var(--rule);
    border-right: none;
    border-radius: 4px 0 0 4px;
    padding: 0.32rem 0.55rem;
    cursor: pointer;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--ink);
    box-shadow: var(--shadow);
    transition: right 0.22s ease, background 0.15s ease;
  }
  .btn-toggle-inspector:hover {
    background: var(--surface-hover);
    color: #fff;
  }
  .btn-toggle-inspector.collapsed {
    right: 0px !important;
    border-right: 1px solid var(--rule);
    border-radius: 4px 0 0 4px;
  }

  .insec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--rule-soft);
    padding-bottom: 0.35rem;
    margin-bottom: 0.4rem;
  }
  .insec-title {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-2);
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    margin-bottom: 0.45rem;
  }
  .fld label {
    font-size: 0.68rem;
    color: var(--ink-2);
  }
  .fld input, .fld select {
    font-family: var(--font-mono);
    font-size: 0.76rem;
    background: var(--surface-2);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 0.25rem 0.4rem;
    color: var(--ink);
    width: 100%;
  }
  .fld input:focus, .fld select:focus {
    border-color: var(--accent);
    outline: none;
  }

  /* Toast Notification Alerts */
  .toast-container {
    position: absolute;
    top: 1rem;
    right: 1rem;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    pointer-events: none;
  }
  .toast {
    background: rgba(35, 30, 20, 0.96);
    border: 1.5px solid var(--warn);
    border-radius: 6px;
    padding: 0.55rem 0.85rem;
    box-shadow: var(--shadow-lift);
    font-size: 0.76rem;
    color: var(--ink);
    max-width: 380px;
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    animation: toastSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes toastSlideIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Node Catalogue Drawer */
  .drawer {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 330px;
    background: var(--surface);
    border-left: 1px solid var(--rule);
    box-shadow: -4px 0 20px rgba(0, 0, 0, 0.4);
    z-index: 30;
    display: none;
    flex-direction: column;
    padding: 0.85rem;
  }
  .drawer.open { display: flex; }
  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.8rem;
  }
  .drawer-title { font-weight: 700; font-size: 0.85rem; }
  .cat-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .cat-card {
    padding: 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--surface-2);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .cat-card:hover {
    border-color: var(--accent);
    background: var(--surface-hover);
  }
  .cat-card .ctitle { font-weight: 650; font-size: 0.78rem; }
  .cat-card .csub { font-size: 0.65rem; color: var(--ink-2); font-family: var(--font-mono); }
</style>
</head>
<body class="${modeClass}">

<!-- HTML5 Datalists for Content Assist Type Autocomplete -->
<datalist id="typeSuggestions_msg"></datalist>
<datalist id="typeSuggestions_srv"></datalist>
<datalist id="typeSuggestions_action"></datalist>
<datalist id="typeSuggestions_all"></datalist>

<!-- Toast Warning Container -->
<div class="toast-container" id="toastContainer"></div>

<div class="topbar">
  <div class="brand">
    <span>RosTooling Studio</span>
    <span class="brand-badge ${modeBadgeClass}" id="modelTypeBadge">${modeBadgeText}</span>
  </div>

  <div class="sysname-wrap">
    <label>Model:</label>
    <input type="text" id="sysNameInput" class="sysname-input" value="${escapeHtml(project.system.name || 'ros_system')}">
  </div>

  <div class="spacer"></div>

  <button class="btn" id="btnUndo" title="Undo (Ctrl+Z)">↶ Undo</button>
  <button class="btn" id="btnRedo" title="Redo (Ctrl+Y)">↷ Redo</button>
  <button class="btn" id="btnAutoLayout" title="Auto-layout Canvas">☵ Auto Layout</button>
  <div class="connector-mode-group" title="Connector Routing Style">
    <button class="mode-btn active" id="btnWireOrthogonal" title="Orthogonal Connectors">⌐ Orthogonal</button>
    <button class="mode-btn" id="btnWireLinear" title="Linear Connectors">╱ Linear</button>
    <button class="mode-btn" id="btnWireSpline" title="Spline Connectors">∿ Spline</button>
  </div>
  <button class="btn" id="btnOpenCatalogue" title="Browse Catalogue">+ Add from Catalogue</button>
  <button class="btn primary" id="btnGenerate" title="Generate ROS 2 Package & Launch Files">⚡ Generate & Launch</button>
  <button class="btn" id="btnSwitchToCode" title="View Source Code">📝 Code</button>
</div>

<div class="workspace">
  <!-- Left Filter Rail -->
  <div class="rail">
    <div class="rail-section">
      <div class="rail-title">Quick Actions</div>
      <button class="btn" id="btnAddNode" style="width:100%; justify-content:center;">+ Add New Node</button>
      <button class="btn" id="btnAddSubsystem" style="width:100%; justify-content:center;">+ Import Subsystem</button>
    </div>

    <div class="rail-section">
      <div class="rail-title">Filter Interfaces</div>
      <label class="filter-row"><input type="checkbox" id="fltPub" checked><span class="filter-swatch" style="background:var(--k-pub)"></span> Publishers</label>
      <label class="filter-row"><input type="checkbox" id="fltSub" checked><span class="filter-swatch" style="background:var(--k-sub)"></span> Subscribers</label>
      <label class="filter-row"><input type="checkbox" id="fltSS" checked><span class="filter-swatch" style="background:var(--k-ss)"></span> Service Servers</label>
      <label class="filter-row"><input type="checkbox" id="fltSC" checked><span class="filter-swatch" style="background:var(--k-sc)"></span> Service Clients</label>
      <label class="filter-row"><input type="checkbox" id="fltAS" checked><span class="filter-swatch" style="background:var(--k-as)"></span> Action Servers</label>
      <label class="filter-row"><input type="checkbox" id="fltAC" checked><span class="filter-swatch" style="background:var(--k-ac)"></span> Action Clients</label>
      <label class="filter-row"><input type="checkbox" id="fltParam" checked><span class="filter-swatch" style="background:var(--k-param)"></span> Parameters</label>
    </div>

    <div class="rail-section" id="subsystemSection">
      <div class="rail-title">Subsystem Views</div>
      <button class="btn" id="btnCollapseAll" style="font-size:0.72rem; width:100%;">Collapse All Subsystems</button>
      <button class="btn" id="btnExpandAll" style="font-size:0.72rem; width:100%;">Expand All Subsystems</button>
    </div>
  </div>

  <!-- Central Canvas -->
  <div class="canvas-wrap" id="canvasWrap">
    <div class="canvas" id="canvas">
      <svg id="svgRoot">
        <defs>
          <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,1 L9,5 L0,9 z" fill="context-stroke"></path>
          </marker>
          <marker id="ahOpen" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M9,1 L1,5 L9,9" fill="none" stroke="context-stroke" stroke-width="1.6"></path>
          </marker>
        </defs>
      </svg>
    </div>

    <!-- Floating HUD -->
    <div class="wire-hud" id="wireHud">
      <div class="hud-title" id="hudTitle">Connecting</div>
      <div class="hud-sub" id="hudSub">Select target port</div>
    </div>

    <!-- Floating Viewbar -->
    <div class="viewbar">
      <button class="btn" id="btnZoomOut" style="padding:0.2rem 0.45rem;">−</button>
      <span id="zoomDisplay" style="font-family:var(--font-mono); font-size:0.7rem; min-width:3.5ch; text-align:center;">100%</span>
      <button class="btn" id="btnZoomIn" style="padding:0.2rem 0.45rem;">+</button>
      <button class="btn" id="btnFitView" style="padding:0.2rem 0.45rem;">Fit</button>
    </div>

    <!-- Floating Findbar -->
    <div class="findbar">
      <input type="text" id="findInput" placeholder="Find node / interface...">
    </div>

    <!-- Catalogue Drawer -->
    <div class="drawer" id="catalogueDrawer">
      <div class="drawer-head">
        <div class="drawer-title" id="catDrawerTitle">ROS Catalogue</div>
        <button class="btn" id="btnCloseCatalogue" style="padding:0.2rem 0.4rem;">✕</button>
      </div>
      <div class="cat-tabs" id="catTabs" style="display:none;">
        <button class="cat-tab-btn active" id="tabCatNodes">Nodes</button>
        <button class="cat-tab-btn" id="tabCatSubsystems">Subsystems</button>
      </div>
      <input type="text" id="catSearchInput" class="sysname-input" placeholder="Search catalog..." style="width:100%; margin-bottom:0.6rem;">
      <div class="cat-list" id="catList"></div>
    </div>
  </div>

  <!-- Collapsible Properties Panel -->
  <button class="btn-toggle-inspector" id="btnToggleInspector" title="Toggle Properties Panel">◀ Properties</button>
  <div class="inspector" id="inspector">
    <div class="insec-head">
      <span class="insec-title">Properties</span>
      <button class="btn" id="btnCollapseInspector" style="padding:0.15rem 0.35rem; font-size:0.7rem;" title="Collapse Panel">⇥</button>
    </div>
    <div id="inspectorContent">Select an element to inspect</div>
  </div>
</div>

<script nonce="${nonce}">
  var vscode = acquireVsCodeApi();
  var project = ${projectJson};
  var nodeCatalog = ${nodeIndexJson};
  var typeCatalog = ${typeIndexJson};

  var COMPLEMENT = { pub: "sub", sub: "pub", ss: "sc", sc: "ss", as: "ac", ac: "as" };
  var SRC_SIDE = { pub: true, ss: true, as: true, sub: false, sc: false, ac: false };
  var KIND_LABELS = {
    pub: "Publisher", sub: "Subscriber",
    ss: "Service Server", sc: "Service Client",
    as: "Action Server", ac: "Action Client",
    param: "Parameter"
  };

  var view = { tx: 40, ty: 40, k: 1 };
  var selNode = null;
  var selEdge = null;
  var selSub = null;
  var undoStack = [];
  var redoStack = [];
  var wireState = null;
  var panState = null;
  var dragState = null;
  var resizeState = null;
  var edgeDragState = null;
  var isInspectorCollapsed = false;
  var isRos = !!(project && project.isRos);
  var isRosSystem = (project.isRosSystem !== false && !isRos);

  var currentConnectorMode = (project && project.view && project.view.connectorMode) || "orthogonal";
  var activeCatTab = "nodes";
  var saveLayoutTimer = null;

  function saveLayout(immediate) {
    if (saveLayoutTimer) {
      clearTimeout(saveLayoutTimer);
      saveLayoutTimer = null;
    }
    function doSave() {
      if (!project.view) project.view = {};
      project.view.tx = view.tx;
      project.view.ty = view.ty;
      project.view.k = view.k;
      project.view.connectorMode = currentConnectorMode;
      vscode.postMessage({ type: "saveLayout", project: project });
    }
    if (immediate) {
      doSave();
    } else {
      saveLayoutTimer = setTimeout(doSave, 300);
    }
  }

  function updateConnectorModeButtons() {
    var btnOrth = document.getElementById("btnWireOrthogonal");
    var btnLin = document.getElementById("btnWireLinear");
    var btnSpl = document.getElementById("btnWireSpline");
    if (btnOrth) btnOrth.classList.toggle("active", currentConnectorMode === "orthogonal");
    if (btnLin) btnLin.classList.toggle("active", currentConnectorMode === "linear");
    if (btnSpl) btnSpl.classList.toggle("active", currentConnectorMode === "spline");
  }

  function setConnectorMode(mode) {
    currentConnectorMode = mode;
    if (!project.view) project.view = {};
    project.view.connectorMode = mode;
    updateConnectorModeButtons();
    drawEdges();
    saveLayout(true);
  }

  var filterKind = { pub: true, sub: true, ss: true, sc: true, as: true, ac: true, param: true };

  var canvasWrap = document.getElementById("canvasWrap");
  var canvas = document.getElementById("canvas");
  var svg = document.getElementById("svgRoot");
  var wireHud = document.getElementById("wireHud");
  var inspectorEl = document.getElementById("inspector");
  var btnToggleInspector = document.getElementById("btnToggleInspector");
  var toastContainer = document.getElementById("toastContainer");

  if (!isRosSystem) {
    var subSection = document.getElementById("subsystemSection");
    if (subSection) subSection.style.display = "none";
    var btnAddSub = document.getElementById("btnAddSubsystem");
    if (btnAddSub) btnAddSub.style.display = "none";
  }

  function esc(s) {
    return ("" + (s == null ? "" : s)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function nextId(p) {
    return (p || "x") + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  }

  function showToastWarning(msg) {
    if (!toastContainer) return;
    var t = document.createElement("div");
    t.className = "toast warn";
    t.innerHTML = '<span style="font-size:1rem; line-height:1;">⚠️</span><div style="flex:1;">' + esc(msg) + '</div>';
    toastContainer.appendChild(t);
    setTimeout(function() {
      t.style.opacity = "0";
      t.style.transition = "opacity 0.3s ease";
      setTimeout(function() { t.remove(); }, 300);
    }, 4500);
  }

  function showToastSuccess(msg) {
    if (!toastContainer) return;
    var t = document.createElement("div");
    t.className = "toast success";
    t.innerHTML = '<span style="font-size:1rem; line-height:1;">✅</span><div style="flex:1;">' + esc(msg) + '</div>';
    toastContainer.appendChild(t);
    setTimeout(function() {
      t.style.opacity = "0";
      t.style.transition = "opacity 0.3s ease";
      setTimeout(function() { t.remove(); }, 300);
    }, 3500);
  }

  function toggleInspector(collapse) {
    if (collapse !== undefined) isInspectorCollapsed = collapse;
    else isInspectorCollapsed = !isInspectorCollapsed;

    if (isInspectorCollapsed) {
      inspectorEl.classList.add("collapsed");
      btnToggleInspector.classList.add("collapsed");
      btnToggleInspector.textContent = "◀ Properties";
    } else {
      inspectorEl.classList.remove("collapsed");
      btnToggleInspector.classList.remove("collapsed");
      btnToggleInspector.textContent = "▶ Properties";
    }
  }

  function pushUndo() {
    undoStack.push(JSON.stringify(project));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
  }

  function syncDoc() {
    vscode.postMessage({ type: "applyEdit", project: project });
  }

  function applyView() {
    canvas.style.transform = "translate(" + view.tx + "px, " + view.ty + "px) scale(" + view.k + ")";
    document.getElementById("zoomDisplay").textContent = Math.round(view.k * 100) + "%";
    saveLayout(false);
  }

  function nodeById(id) {
    if (!id) return null;
    for (var i = 0; i < project.nodes.length; i++) {
      if (project.nodes[i].id === id || project.nodes[i].label === id) return project.nodes[i];
    }
    return null;
  }

  function ifaceById(n, id) {
    if (!n || !n.ifaces) return null;
    for (var i = 0; i < n.ifaces.length; i++) {
      if (n.ifaces[i].id === id || n.ifaces[i].label === id || n.ifaces[i].name === id) return n.ifaces[i];
    }
    return null;
  }

  function subState(ref) {
    if (project.view && project.view.subStates && project.view.subStates[ref]) {
      return project.view.subStates[ref];
    }
    var sub = (project.subSystems || []).find(function(s) { return s.ref === ref; });
    return (sub && sub.state) || "collapsed";
  }

  function setSubState(ref, st) {
    if (!project.view) project.view = {};
    if (!project.view.subStates) project.view.subStates = {};
    project.view.subStates[ref] = st;
    var sub = (project.subSystems || []).find(function(s) { return s.ref === ref; });
    if (sub) sub.state = st;
  }

  function subMembers(ref) {
    return project.nodes.filter(function(n) { return n.subRef === ref || (n.backing === "sub" && n.from && n.from.startsWith(ref)); });
  }

  function arrangeSubsystemMembers(subRef) {
    var pos = (project.view && project.view.subPos && project.view.subPos[subRef]) || { x: 80, y: 80 };
    var members = subMembers(subRef);
    var cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
    members.forEach(function(m, idx) {
      if (m.x == null || m.y == null || (m.x === 100 && m.y === 100) || (m.x === 80 && m.y === 80)) {
        var c = idx % cols;
        var r = Math.floor(idx / cols);
        m.x = pos.x + 30 + c * 300;
        m.y = pos.y + 50 + r * 240;
      }
    });
  }

  /* Mathematical distance from point p to line segment (v, w) */
  function distToSegment(p, v, w) {
    var l2 = (w.x - v.x) * (w.x - v.x) + (w.y - v.y) * (w.y - v.y);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    var t = Math.max(0, Math.min(1, ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2));
    var projX = v.x + t * (w.x - v.x);
    var projY = v.y + t * (w.y - v.y);
    return Math.hypot(p.x - projX, p.y - projY);
  }

  /* Insert a waypoint into the connection at the geometrically correct segment */
  function insertWaypointIntoConnection(conn, clickX, clickY, existingPts) {
    if (!conn.waypoints) conn.waypoints = [];
    if (conn.waypoints.length === 0 || !existingPts || existingPts.length < 2) {
      conn.waypoints.push({ x: clickX, y: clickY });
      return;
    }

    var bestSegIdx = 0;
    var bestDist = Infinity;
    for (var i = 0; i < existingPts.length - 1; i++) {
      var d = distToSegment({ x: clickX, y: clickY }, existingPts[i], existingPts[i + 1]);
      if (d < bestDist) {
        bestDist = d;
        bestSegIdx = i;
      }
    }

    var insertIdx = conn.waypoints.length;
    for (var w = 0; w < conn.waypoints.length; w++) {
      var wp = conn.waypoints[w];
      var ptIdx = existingPts.findIndex(function(pt) {
        return Math.abs(pt.x - wp.x) < 4 && Math.abs(pt.y - wp.y) < 4;
      });
      if (ptIdx !== -1 && bestSegIdx < ptIdx) {
        insertIdx = w;
        break;
      }
    }
    conn.waypoints.splice(insertIdx, 0, { x: clickX, y: clickY });
  }

  /* Automatically expand the canvas and protect against negative coordinates */
  function ensureCanvasEncompasses() {
    var minX = 60, minY = 60, maxX = 3000, maxY = 3000;

    (project.nodes || []).forEach(function(n) {
      var nx = n.x != null ? n.x : 100;
      var ny = n.y != null ? n.y : 100;
      var nw = n.w || (project.view && project.view.nodeSize && project.view.nodeSize[n.label] && project.view.nodeSize[n.label].w) || 260;
      var nh = n.h || (project.view && project.view.nodeSize && project.view.nodeSize[n.label] && project.view.nodeSize[n.label].h) || 160;
      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      maxX = Math.max(maxX, nx + nw);
      maxY = Math.max(maxY, ny + nh);
    });

    (project.subSystems || []).forEach(function(sub) {
      var spos = (project.view && project.view.subPos && project.view.subPos[sub.ref]) || { x: sub.x || 80, y: sub.y || 80 };
      minX = Math.min(minX, spos.x);
      minY = Math.min(minY, spos.y);
      maxX = Math.max(maxX, spos.x + (sub.w || 320));
      maxY = Math.max(maxY, spos.y + (sub.h || 200));
    });

    (project.connections || []).forEach(function(c) {
      var wps = c.waypoints || (project.view && project.view.connWaypoints && project.view.connWaypoints[c.id]) || [];
      wps.forEach(function(wp) {
        minX = Math.min(minX, wp.x);
        minY = Math.min(minY, wp.y);
        maxX = Math.max(maxX, wp.x);
        maxY = Math.max(maxY, wp.y);
      });
      if (c.midX != null) {
        minX = Math.min(minX, c.midX);
        maxX = Math.max(maxX, c.midX);
      }
      if (c.midY != null) {
        minY = Math.min(minY, c.midY);
        maxY = Math.max(maxY, c.midY);
      }
    });

    // If any item extends into negative space (< 60), shift all coordinates and viewport
    if (minX < 60 || minY < 60) {
      var shiftX = minX < 60 ? Math.ceil(100 - minX) : 0;
      var shiftY = minY < 60 ? Math.ceil(100 - minY) : 0;

      (project.nodes || []).forEach(function(n) {
        if (n.x != null) n.x += shiftX;
        if (n.y != null) n.y += shiftY;
      });

      (project.subSystems || []).forEach(function(sub) {
        if (sub.x != null) sub.x += shiftX;
        if (sub.y != null) sub.y += shiftY;
        if (project.view && project.view.subPos && project.view.subPos[sub.ref]) {
          project.view.subPos[sub.ref].x += shiftX;
          project.view.subPos[sub.ref].y += shiftY;
        }
      });

      (project.connections || []).forEach(function(c) {
        var wps = c.waypoints || (project.view && project.view.connWaypoints && project.view.connWaypoints[c.id]) || [];
        wps.forEach(function(wp) {
          wp.x += shiftX;
          wp.y += shiftY;
        });
        if (c.midX != null) c.midX += shiftX;
        if (c.midY != null) c.midY += shiftY;
        if (project.view && project.view.connMidX && project.view.connMidX[c.id] != null) project.view.connMidX[c.id] += shiftX;
        if (project.view && project.view.connMidY && project.view.connMidY[c.id] != null) project.view.connMidY[c.id] += shiftY;
      });

      view.tx -= shiftX * view.k;
      view.ty -= shiftY * view.k;
      applyView();
    }

    var reqW = Math.max(6000, Math.ceil(maxX + 1200));
    var reqH = Math.max(6000, Math.ceil(maxY + 1200));
    canvas.style.width = reqW + "px";
    canvas.style.height = reqH + "px";
  }

  function autoLayout() {
    pushUndo();
    var nodeCount = (project.nodes || []).length;
    var cols = Math.max(1, Math.ceil(Math.sqrt(nodeCount || 1)));
    (project.nodes || []).forEach(function(n, idx) {
      var c = idx % cols;
      var r = Math.floor(idx / cols);
      n.x = 80 + c * 340;
      n.y = 80 + r * 260;
    });

    var rows = Math.ceil((nodeCount || 1) / cols);
    var subBaseY = 80 + rows * 260;
    var subIdx = 0;
    (project.subSystems || []).forEach(function(sub) {
      if (!project.view) project.view = {};
      if (!project.view.subPos) project.view.subPos = {};
      var spos = { x: 80 + (subIdx++) * 360, y: subBaseY };
      sub.x = spos.x;
      sub.y = spos.y;
      project.view.subPos[sub.ref] = spos;
    });

    // Clear stale custom corridor handles so auto-layout routes cleanly
    (project.connections || []).forEach(function(c) {
      delete c.midX;
      delete c.midY;
    });
    if (project.view) {
      project.view.connMidX = {};
      project.view.connMidY = {};
    }

    view.tx = 40;
    view.ty = 40;
    view.k = 1;
    applyView();

    ensureCanvasEncompasses();
    render();
    syncDoc();
    saveLayout(true);
    showToastSuccess("Auto-layout applied");
  }

  function layoutInitialPositions() {
    var needsLayout = false;
    (project.nodes || []).forEach(function(n) {
      if (n.x == null || n.y == null) needsLayout = true;
    });
    if (needsLayout) {
      autoLayout();
    } else {
      ensureCanvasEncompasses();
    }
  }

  /* Mathematically exact port center calculation relative to canvas */
  function getPortPosition(nodeId, ifaceId) {
    var port = canvas.querySelector('.port[data-n="' + nodeId + '"][data-i="' + ifaceId + '"]');
    if (!port) {
      var n = nodeById(nodeId);
      if (n && n.subRef && subState(n.subRef) === "collapsed") {
        var subBox = canvas.querySelector('.node.subbox[data-sub="' + n.subRef + '"]');
        if (subBox) {
          var iface = ifaceById(n, ifaceId);
          var subPort = subBox.querySelector('.port[data-label="' + (iface ? (iface.label || iface.name) : '') + '"]') || subBox.querySelector('.port');
          var cr = canvas.getBoundingClientRect();
          if (subPort) {
            var pr = subPort.getBoundingClientRect();
            return {
              x: (pr.left + pr.width / 2 - cr.left) / view.k,
              y: (pr.top + pr.height / 2 - cr.top) / view.k,
              isAbstracted: true,
              nodeId: nodeId,
              side: subPort.classList.contains("src") ? "right" : "left"
            };
          }
          var sbr = subBox.getBoundingClientRect();
          return {
            x: (sbr.left + sbr.width / 2 - cr.left) / view.k,
            y: (sbr.top + sbr.height / 2 - cr.top) / view.k,
            isAbstracted: true,
            nodeId: nodeId,
            side: "right"
          };
        }
      }
      return null;
    }
    var cr = canvas.getBoundingClientRect();
    var pr = port.getBoundingClientRect();
    return {
      x: (pr.left + pr.width / 2 - cr.left) / view.k,
      y: (pr.top + pr.height / 2 - cr.top) / view.k,
      isAbstracted: false,
      nodeId: nodeId,
      side: port.classList.contains("src") ? "right" : "left"
    };
  }

  /* Collect bounding boxes of all node obstacles on canvas */
  function getNodeObstacles(excludeNodeA, excludeNodeB) {
    var boxes = [];
    canvas.querySelectorAll(".node").forEach(function(el) {
      var nid = el.dataset.n || el.dataset.sub;
      if (nid === excludeNodeA || nid === excludeNodeB) return;
      var PAD = 16;
      boxes.push({
        id: nid,
        left: el.offsetLeft - PAD,
        top: el.offsetTop - PAD,
        right: el.offsetLeft + el.offsetWidth + PAD,
        bottom: el.offsetTop + el.offsetHeight + PAD
      });
    });
    return boxes;
  }

  /* Simplify consecutive collinear points */
  function simplifyPolyline(pts) {
    if (pts.length <= 2) return pts;
    var res = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var prev = res[res.length - 1];
      var cur = pts[i];
      var next = pts[i + 1];
      var isCollinearX = (prev.x === cur.x && cur.x === next.x);
      var isCollinearY = (prev.y === cur.y && cur.y === next.y);
      if (!isCollinearX && !isCollinearY) {
        res.push(cur);
      }
    }
    res.push(pts[pts.length - 1]);
    return res;
  }

  /* Orthogonal (Boxy) Wire Path Computation with Multi-Wire Lane Allocation & Obstacle Avoidance */
  function computeAllOrthogonalPaths(wireEntries) {
    var STUB = 26;
    var LANE_GAP = 14;

    // Group direct horizontal connections by routing channel/corridor
    var channelGroups = {};
    wireEntries.forEach(function(w) {
      var s = w.s, t = w.t;
      var sStubX = s.x + (s.side === "right" ? STUB : -STUB);
      var tStubX = t.x + (t.side === "left" ? -STUB : STUB);
      var isDirect = (s.side === "right" && t.side === "left" && sStubX < tStubX);

      if (isDirect) {
        var key = s.nodeId + "->" + t.nodeId;
        if (!channelGroups[key]) channelGroups[key] = [];
        channelGroups[key].push(w);
      }
    });

    // Assign unique channel lane offset to each direct wire in the same channel
    var directLaneAssignments = new Map();
    Object.keys(channelGroups).forEach(function(key) {
      var group = channelGroups[key];
      // Sort wires in group by source port Y to prevent crossing vertical lines within same corridor
      group.sort(function(a, b) { return a.s.y - b.s.y; });
      var total = group.length;
      group.forEach(function(w, idx) {
        var offset = (idx - (total - 1) / 2) * LANE_GAP;
        directLaneAssignments.set(w.index, offset);
      });
    });

    // Track assigned vertical segments across all wires to guarantee NO TWO VERTICAL LINES OVERLAP
    var assignedVerticalSegments = [];

    var polylines = [];

    // Helper to find non-overlapping X coordinate for vertical segments
    function findFreeVerticalX(baseX, minY, maxY, minAllowedX, maxAllowedX, obstacles) {
      var candidateX = Math.round(baseX);
      var tries = 0;
      var step = LANE_GAP;

      while (tries < 30) {
        // Check collision with node obstacles
        var hitObstacle = obstacles.some(function(b) {
          return candidateX >= b.left && candidateX <= b.right && maxY >= b.top && minY <= b.bottom;
        });

        // Check collision with already assigned vertical lines
        var hitVertical = assignedVerticalSegments.some(function(v) {
          var xOverlap = Math.abs(v.x - candidateX) < 8;
          var yOverlap = Math.max(minY, v.minY) < Math.min(maxY, v.maxY) - 2;
          return xOverlap && yOverlap;
        });

        if (!hitObstacle && !hitVertical && candidateX >= minAllowedX && candidateX <= maxAllowedX) {
          return candidateX;
        }

        tries++;
        var sign = (tries % 2 === 1) ? 1 : -1;
        var magnitude = Math.ceil(tries / 2) * step;
        candidateX = Math.round(baseX + sign * magnitude);
      }

      return Math.round(baseX);
    }

    // Separate wrap-around wires to distribute their wrap horizontal/vertical corridors
    var wrapTopIdx = 0, wrapBotIdx = 0;

    wireEntries.forEach(function(w) {
      var s = w.s, t = w.t;
      var obstacles = getNodeObstacles(s.nodeId, t.nodeId);

      var sDir = (s.side === "right") ? 1 : -1;
      var tDir = (t.side === "left") ? -1 : 1;

      var sStubX = s.x + sDir * STUB;
      var tStubX = t.x + tDir * STUB;

      var isDirect = (s.side === "right" && t.side === "left" && sStubX < tStubX);

      // 1. Waypoints Override (Arbitrary Custom Orthogonal Route)
      if (w.conn.waypoints && w.conn.waypoints.length > 0) {
        var ptsWp = [{ x: s.x, y: s.y }, { x: sStubX, y: s.y }];
        var curX = sStubX;
        var curY = s.y;
        w.conn.waypoints.forEach(function(wp) {
          ptsWp.push({ x: wp.x, y: curY });
          ptsWp.push({ x: wp.x, y: wp.y });
          curX = wp.x;
          curY = wp.y;
        });
        ptsWp.push({ x: tStubX, y: curY });
        ptsWp.push({ x: tStubX, y: t.y });
        ptsWp.push({ x: t.x, y: t.y });

        polylines.push({
          conn: w.conn,
          index: w.index,
          s: s,
          t: t,
          waypoints: w.conn.waypoints,
          pts: simplifyPolyline(ptsWp)
        });
        return;
      }

      var pts = [];

      if (isDirect) {
        var laneOffset = directLaneAssignments.get(w.index) || 0;
        var rawMidX = (sStubX + tStubX) / 2 + laneOffset;
        var minY = Math.min(s.y, t.y), maxY = Math.max(s.y, t.y);

        var customMidX = (w.conn.midX != null)
          ? w.conn.midX
          : (project.view && project.view.connMidX && project.view.connMidX[w.conn.id]);

        var finalMidX = (customMidX != null)
          ? customMidX
          : findFreeVerticalX(rawMidX, minY, maxY, s.x + 12, t.x - 12, obstacles);

        // Register vertical segment
        assignedVerticalSegments.push({
          wireIdx: w.index,
          x: finalMidX,
          minY: minY,
          maxY: maxY
        });

        pts = [
          { x: s.x, y: s.y },
          { x: sStubX, y: s.y },
          { x: finalMidX, y: s.y },
          { x: finalMidX, y: t.y },
          { x: tStubX, y: t.y },
          { x: t.x, y: t.y }
        ];

        polylines.push({
          conn: w.conn,
          index: w.index,
          s: s,
          t: t,
          midX: finalMidX,
          minY: minY,
          maxY: maxY,
          pts: simplifyPolyline(pts)
        });
      } else {
        // Wrap-around route around top or bottom
        var isTopCloser = Math.abs(s.y - t.y) < 120 || (s.y + t.y) / 2 < 380;
        var wrapY;
        var sVertX, tVertX;

        if (isTopCloser) {
          var curWrap = wrapTopIdx++;
          var baseTop = Math.min(s.y, t.y) - 40 - (curWrap * 16);
          obstacles.forEach(function(b) {
            if ((s.x <= b.right && t.x >= b.left) || (t.x <= b.right && s.x >= b.left)) {
              baseTop = Math.min(baseTop, b.top - 20 - (curWrap * 16));
            }
          });
          wrapY = Math.round(baseTop);

          var sMinY = Math.min(s.y, wrapY), sMaxY = Math.max(s.y, wrapY);
          sVertX = findFreeVerticalX(sStubX + (curWrap * 10), sMinY, sMaxY, 0, 5000, obstacles);
          assignedVerticalSegments.push({ wireIdx: w.index, x: sVertX, minY: sMinY, maxY: sMaxY });

          var tMinY = Math.min(t.y, wrapY), tMaxY = Math.max(t.y, wrapY);
          tVertX = findFreeVerticalX(tStubX - (curWrap * 10), tMinY, tMaxY, 0, 5000, obstacles);
          assignedVerticalSegments.push({ wireIdx: w.index, x: tVertX, minY: tMinY, maxY: tMaxY });
        } else {
          var curWrapB = wrapBotIdx++;
          var baseBot = Math.max(s.y, t.y) + 40 + (curWrapB * 16);
          obstacles.forEach(function(b) {
            if ((s.x <= b.right && t.x >= b.left) || (t.x <= b.right && s.x >= b.left)) {
              baseBot = Math.max(baseBot, b.bottom + 20 + (curWrapB * 16));
            }
          });
          wrapY = Math.round(baseBot);

          var sMinYB = Math.min(s.y, wrapY), sMaxYB = Math.max(s.y, wrapY);
          sVertX = findFreeVerticalX(sStubX + (curWrapB * 10), sMinYB, sMaxYB, 0, 5000, obstacles);
          assignedVerticalSegments.push({ wireIdx: w.index, x: sVertX, minY: sMinYB, maxY: sMaxYB });

          var tMinYB = Math.min(t.y, wrapY), tMaxYB = Math.max(t.y, wrapY);
          tVertX = findFreeVerticalX(tStubX - (curWrapB * 10), tMinYB, tMaxYB, 0, 5000, obstacles);
          assignedVerticalSegments.push({ wireIdx: w.index, x: tVertX, minY: tMinYB, maxY: tMaxYB });
        }

        var wrapCustomX = (w.conn.midX != null)
          ? w.conn.midX
          : (project.view && project.view.connMidX && project.view.connMidX[w.conn.id]);
        if (wrapCustomX != null) {
          sVertX = wrapCustomX;
        }

        var wrapCustomY = (w.conn.midY != null)
          ? w.conn.midY
          : (project.view && project.view.connMidY && project.view.connMidY[w.conn.id]);
        if (wrapCustomY != null) {
          wrapY = wrapCustomY;
        }

        pts = [
          { x: s.x, y: s.y },
          { x: sVertX, y: s.y },
          { x: sVertX, y: wrapY },
          { x: tVertX, y: wrapY },
          { x: tVertX, y: t.y },
          { x: t.x, y: t.y }
        ];

        polylines.push({
          conn: w.conn,
          index: w.index,
          s: s,
          t: t,
          midX: sVertX,
          minY: isTopCloser ? Math.min(s.y, wrapY) : sMinYB,
          maxY: isTopCloser ? Math.max(s.y, wrapY) : sMaxYB,
          wrapY: wrapY,
          wrapMinX: Math.min(sVertX, tVertX),
          wrapMaxX: Math.max(sVertX, tVertX),
          pts: simplifyPolyline(pts)
        });
      }
    });

    return polylines;
  }

  /* Render Single Node Card or Type Schema Card */
  function renderNode(n) {
    if (n.backing === "type") {
      renderTypeCard(n);
      return;
    }

    var el = document.createElement("div");
    el.className = "node" + (selNode === n.id ? " sel" : "") + (n.backing === "cat" ? " cat" : "");
    el.style.left = (n.x != null ? n.x : 100) + "px";
    el.style.top = (n.y != null ? n.y : 100) + "px";
    var size = (project.view && project.view.nodeSize && project.view.nodeSize[n.label]) || {};
    var nw = n.w || size.w;
    var nh = n.h || size.h;
    if (nw) el.style.width = nw + "px";
    if (nh) el.style.height = nh + "px";
    el.dataset.n = n.id;

    var html = '<div class="nhead" data-drag="' + n.id + '">'
      + '<span class="ntitle">' + esc(n.label) + '</span>'
      + (n.pkg ? '<span class="badge">' + esc(n.pkg) + '</span>' : '')
      + '</div>'
      + '<div class="nmeta">' + esc(n.from || '(local artifact)') + (n.namespace ? ' | ' + esc(n.namespace) : '') + '</div>'
      + '<div class="ifaces">';

    (n.ifaces || []).forEach(function(f) {
      if (!filterKind[f.kind]) return;
      var src = SRC_SIDE[f.kind];
      html += '<div class="iface-row" data-kind="' + f.kind + '">'
        + '<span class="kd ' + f.kind + '">' + f.kind + '</span>'
        + '<span class="inm">' + esc(f.label || f.name) + '</span>'
        + '<span class="ity">' + esc(f.type || '—') + '</span>'
        + '<span class="port ' + (src ? 'src' : 'snk') + ' ' + f.kind + '" data-n="' + n.id + '" data-i="' + f.id + '" data-kind="' + f.kind + '" data-type="' + esc(f.type || '') + '"></span>'
        + '</div>';
    });
    html += '<div class="iface-add-row" data-add-iface-node="' + esc(n.id) + '" title="Add Interface">+ Iface</div>';
    html += '</div>';

    if (filterKind.param) {
      html += '<div class="params-band">';
      (n.params || []).forEach(function(p) {
        html += '<div class="prow">'
          + '<span class="pk">P</span>'
          + '<span class="pnm">' + esc(p.label || p.name) + '</span>'
          + '<span class="pvl">' + esc(p.sysValue != null ? p.sysValue : (p.value != null ? p.value : '')) + '</span>'
          + '</div>';
      });
      html += '<div class="param-add-row" data-add-param-node="' + esc(n.id) + '" title="Add Parameter">+ Param</div>';
      html += '</div>';
    }

    html += '<div class="resize-handle se" data-resize-node="' + esc(n.id) + '" title="Drag to resize node"></div>';

    el.innerHTML = html;
    canvas.appendChild(el);
  }

  /* Render UML Type Schema Card (.ros) - Pure Class Block with Zero Connection Dots */
  function renderTypeCard(n) {
    var el = document.createElement("div");
    el.className = "node type-card" + (selNode === n.id ? " sel" : "");
    el.style.left = (n.x != null ? n.x : 100) + "px";
    el.style.top = (n.y != null ? n.y : 100) + "px";
    var size = (project.view && project.view.nodeSize && project.view.nodeSize[n.label]) || {};
    var nw = n.w || size.w;
    var nh = n.h || size.h;
    if (nw) el.style.width = nw + "px";
    if (nh) el.style.height = nh + "px";
    el.dataset.n = n.id;

    var spec = n.typeSpec || { name: n.label, category: n.typeCategory || 'msg', pkg: n.pkg, fields: {} };
    if (!spec.fields) spec.fields = {};
    var cat = spec.category || 'msg';
    var catBadge = cat.toUpperCase();

    var html = '<div class="nhead" data-drag="' + esc(n.id) + '">'
      + '<span class="type-badge ' + cat + '">' + catBadge + '</span>'
      + '<span class="ntitle" style="flex:1; margin-left:6px;">' + esc(n.label) + '</span>'
      + (n.pkg ? '<span class="badge">' + esc(n.pkg) + '</span>' : '')
      + '</div>';

    if (cat === 'msg') {
      var fList = spec.fields['message'] || [];
      var consts = fList.filter(function(f) { return f.constant; });
      var nonConsts = fList.filter(function(f) { return !f.constant; });

      if (consts.length > 0) {
        html += '<div class="type-sec"><div class="type-sec-title">Constants</div>';
        consts.forEach(function(c) {
          html += '<div class="type-field-row">'
            + '<span class="f-type">' + esc(c.type) + '</span>'
            + '<span class="f-name">' + esc(c.name) + '</span>'
            + '<span class="f-val">=' + esc(c.value != null ? c.value : '') + '</span>'
            + '</div>';
        });
        html += '</div>';
      }

      html += '<div class="type-sec"><div class="type-sec-title">Fields</div>';
      nonConsts.forEach(function(f) {
        html += '<div class="type-field-row">'
          + '<span class="f-type">' + esc(f.type) + '</span>'
          + '<span class="f-name">' + esc(f.name) + '</span>'
          + '</div>';
      });
      if (nonConsts.length === 0 && consts.length === 0) {
        html += '<div style="padding:4px 8px; font-size:0.75rem; color:var(--ink-3);">(empty message)</div>';
      }
      html += '</div>';
    } else if (cat === 'srv') {
      var reqs = spec.fields['request'] || [];
      var resps = spec.fields['response'] || [];

      html += '<div class="type-sec"><div class="type-sec-title">Request</div>';
      reqs.forEach(function(f) {
        html += '<div class="type-field-row">'
          + '<span class="f-type">' + esc(f.type) + '</span>'
          + '<span class="f-name">' + esc(f.name) + '</span>'
          + '</div>';
      });
      if (reqs.length === 0) html += '<div style="padding:2px 8px; font-size:0.72rem; color:var(--ink-3);">(empty)</div>';
      html += '</div>';

      html += '<div class="type-sec"><div class="type-sec-title">Response</div>';
      resps.forEach(function(f) {
        html += '<div class="type-field-row">'
          + '<span class="f-type">' + esc(f.type) + '</span>'
          + '<span class="f-name">' + esc(f.name) + '</span>'
          + '</div>';
      });
      if (resps.length === 0) html += '<div style="padding:2px 8px; font-size:0.72rem; color:var(--ink-3);">(empty)</div>';
      html += '</div>';
    } else if (cat === 'action') {
      var goals = spec.fields['goal'] || [];
      var results = spec.fields['result'] || [];
      var fbs = spec.fields['feedback'] || [];

      html += '<div class="type-sec"><div class="type-sec-title">Goal</div>';
      goals.forEach(function(f) {
        html += '<div class="type-field-row">'
          + '<span class="f-type">' + esc(f.type) + '</span>'
          + '<span class="f-name">' + esc(f.name) + '</span>'
          + '</div>';
      });
      if (goals.length === 0) html += '<div style="padding:2px 8px; font-size:0.72rem; color:var(--ink-3);">(empty)</div>';
      html += '</div>';

      html += '<div class="type-sec"><div class="type-sec-title">Result</div>';
      results.forEach(function(f) {
        html += '<div class="type-field-row">'
          + '<span class="f-type">' + esc(f.type) + '</span>'
          + '<span class="f-name">' + esc(f.name) + '</span>'
          + '</div>';
      });
      if (results.length === 0) html += '<div style="padding:2px 8px; font-size:0.72rem; color:var(--ink-3);">(empty)</div>';
      html += '</div>';

      html += '<div class="type-sec"><div class="type-sec-title">Feedback</div>';
      fbs.forEach(function(f) {
        html += '<div class="type-field-row">'
          + '<span class="f-type">' + esc(f.type) + '</span>'
          + '<span class="f-name">' + esc(f.name) + '</span>'
          + '</div>';
      });
      if (fbs.length === 0) html += '<div style="padding:2px 8px; font-size:0.72rem; color:var(--ink-3);">(empty)</div>';
      html += '</div>';
    }

    html += '<div class="resize-handle se" data-resize-node="' + esc(n.id) + '" title="Drag to resize type card"></div>';
    el.innerHTML = html;
    canvas.appendChild(el);
  }

  /* Render Collapsed Subsystem Box */
  function renderSubBox(sub) {
    var el = document.createElement("div");
    el.className = "node subbox" + (selSub === sub.ref ? " sel" : "");
    var pos = (project.view && project.view.subPos && project.view.subPos[sub.ref]) || { x: sub.x || 80, y: sub.y || 80 };
    el.style.left = pos.x + "px";
    el.style.top = pos.y + "px";
    var size = (project.view && project.view.subSize && project.view.subSize[sub.ref]) || {};
    var sw = sub.w || size.w;
    var sh = sub.h || size.h;
    if (sw) el.style.width = sw + "px";
    if (sh) el.style.height = sh + "px";
    el.dataset.sub = sub.ref;

    var members = subMembers(sub.ref);
    var html = '<div class="nhead" data-drag-sub="' + esc(sub.ref) + '">'
      + '<span class="subtog" data-expand="' + esc(sub.ref) + '" title="Expand container">▸</span>'
      + '<span class="ntitle">' + esc(sub.ref) + '</span>'
      + '<span class="badge" style="background:var(--k-subsystem-bg); color:var(--k-subsystem);">Subsystem</span>'
      + '</div>'
      + '<div class="nmeta">' + members.length + ' node(s) collapsed | ' + esc(sub.fromFile || sub.ref + '.rossystem') + '</div>'
      + '<div class="ifaces">';

    var seenLabels = {};
    members.forEach(function(m) {
      (m.ifaces || []).forEach(function(f) {
        var lbl = f.label || f.name;
        if (!seenLabels[lbl]) {
          seenLabels[lbl] = true;
          var src = SRC_SIDE[f.kind];
          html += '<div class="iface-row" data-kind="' + f.kind + '">'
            + '<span class="kd ' + f.kind + '">' + f.kind + '</span>'
            + '<span class="inm">' + esc(lbl) + '</span>'
            + '<span class="ity">' + esc(f.type || '—') + '</span>'
            + '<span class="port ' + (src ? 'src' : 'snk') + ' ' + f.kind + '" data-sub="' + esc(sub.ref) + '" data-label="' + esc(lbl) + '" data-n="' + m.id + '" data-i="' + f.id + '" data-kind="' + f.kind + '" data-type="' + esc(f.type || '') + '"></span>'
            + '</div>';
        }
      });
    });
    html += '</div>';
    html += '<div class="resize-handle se" data-resize-sub="' + esc(sub.ref) + '" title="Drag to resize subsystem"></div>';

    el.innerHTML = html;
    canvas.appendChild(el);
  }

  /* Render Framed (Expanded) Subsystem Boundary */
  function renderSubFrame(sub) {
    var members = subMembers(sub.ref);
    if (!members.length) return;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    members.forEach(function(m) {
      var nodeEl = canvas.querySelector('.node[data-n="' + m.id + '"]');
      if (nodeEl) {
        x0 = Math.min(x0, nodeEl.offsetLeft);
        y0 = Math.min(y0, nodeEl.offsetTop);
        x1 = Math.max(x1, nodeEl.offsetLeft + nodeEl.offsetWidth);
        y1 = Math.max(y1, nodeEl.offsetTop + nodeEl.offsetHeight);
      }
    });
    if (x0 > x1) return;

    var PAD = 24, TOP = 28;
    var frame = document.createElement("div");
    frame.className = "subframe";
    frame.style.left = (x0 - PAD) + "px";
    frame.style.top = (y0 - TOP) + "px";
    var size = (project.view && project.view.subSize && project.view.subSize[sub.ref + "_frame"]) || {};
    var fw = size.w || (x1 - x0 + 2 * PAD);
    var fh = size.h || (y1 - y0 + TOP + PAD);
    frame.style.width = fw + "px";
    frame.style.height = fh + "px";
    frame.innerHTML = '<div class="sfhead">'
      + '<span class="subtog" data-collapse="' + esc(sub.ref) + '" title="Collapse container">▾</span>'
      + esc(sub.ref) + ' (Expanded)'
      + '</div>'
      + '<div class="resize-handle se" data-resize-frame="' + esc(sub.ref) + '" title="Drag to resize subsystem frame"></div>';
    canvas.appendChild(frame);
  }

  function renderWaypointHandles(conn) {
    var isSel = selEdge === conn.id;
    (conn.waypoints || []).forEach(function(wp, wpIdx) {
      var handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      handle.setAttribute("cx", wp.x);
      handle.setAttribute("cy", wp.y);
      handle.setAttribute("r", isSel ? "7" : "5");
      handle.setAttribute("class", "edge-handle handle-waypoint" + (isSel ? " sel" : ""));
      handle.dataset.cid = conn.id;
      handle.dataset.dir = "wp";
      handle.dataset.wpidx = wpIdx;
      handle.dataset.wpx = wp.x;
      handle.dataset.wpy = wp.y;
      handle.setAttribute("title", "Drag bend waypoint (Right-click or double-click to delete)");

      var removeWp = function(ev) {
        ev.stopPropagation();
        ev.preventDefault();
        conn.waypoints.splice(wpIdx, 1);
        if (!project.view) project.view = {};
        if (!project.view.connWaypoints) project.view.connWaypoints = {};
        project.view.connWaypoints[conn.id] = conn.waypoints;
        pushUndo();
        drawEdges();
        saveLayout(true);
      };
      handle.addEventListener("contextmenu", removeWp);
      handle.addEventListener("dblclick", removeWp);
      svg.appendChild(handle);
    });
  }

  function drawLinearEdges(wireEntries) {
    wireEntries.forEach(function(w) {
      var s = w.s, t = w.t;
      var pts = [s].concat(w.conn.waypoints || []).concat([t]);
      var pathD = "M " + pts[0].x + " " + pts[0].y + " ";
      for (var i = 1; i < pts.length; i++) {
        pathD += "L " + pts[i].x + " " + pts[i].y + " ";
      }

      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      var isSel = selEdge === w.conn.id;
      var isAbs = w.s.isAbstracted || w.t.isAbstracted;
      p.setAttribute("class", "edge topic" + (isSel ? " sel" : "") + (isAbs ? " abstracted" : ""));
      p.setAttribute("d", pathD.trim());
      p.dataset.cid = w.conn.id;
      p.style.pointerEvents = "stroke";
      p.style.cursor = "pointer";

      p.addEventListener("click", function(ev) {
        ev.stopPropagation();
        selEdge = w.conn.id;
        selNode = null;
        selSub = null;
        render();
        toggleInspector(false);
        fillInspector();
      });

      p.addEventListener("dblclick", function(ev) {
        ev.stopPropagation();
        ev.preventDefault();
        var cr = canvas.getBoundingClientRect();
        var clickX = Math.round((ev.clientX - cr.left) / view.k);
        var clickY = Math.round((ev.clientY - cr.top) / view.k);
        insertWaypointIntoConnection(w.conn, clickX, clickY, pts);
        if (!project.view) project.view = {};
        if (!project.view.connWaypoints) project.view.connWaypoints = {};
        project.view.connWaypoints[w.conn.id] = w.conn.waypoints;
        selEdge = w.conn.id;
        selNode = null;
        selSub = null;

        var wrapRect = canvasWrap.getBoundingClientRect();
        var screenX = view.tx + clickX * view.k;
        var screenY = view.ty + clickY * view.k;
        var margin = 60;
        if (screenX < margin || screenX > wrapRect.width - margin || screenY < margin || screenY > wrapRect.height - margin) {
          view.tx = Math.round(wrapRect.width / 2 - clickX * view.k);
          view.ty = Math.round(wrapRect.height / 2 - clickY * view.k);
          applyView();
        }

        ensureCanvasEncompasses();
        pushUndo();
        drawEdges();
        toggleInspector(false);
        fillInspector();
        saveLayout(true);
      });

      svg.appendChild(p);
      renderWaypointHandles(w.conn);
    });
  }

  function drawSplineEdges(wireEntries) {
    wireEntries.forEach(function(w) {
      var s = w.s, t = w.t;
      var wps = w.conn.waypoints || [];
      var pathD = "";

      if (wps.length === 0) {
        var dx = Math.max(50, Math.abs(t.x - s.x) * 0.5);
        var cp1x = (s.side === "left") ? (s.x - dx) : (s.x + dx);
        var cp2x = (t.side === "right") ? (t.x + dx) : (t.x - dx);
        pathD = "M " + s.x + " " + s.y + " C " + cp1x + " " + s.y + ", " + cp2x + " " + t.y + ", " + t.x + " " + t.y;
      } else {
        var pts = [s].concat(wps).concat([t]);
        pathD = "M " + pts[0].x + " " + pts[0].y;
        for (var i = 0; i < pts.length - 1; i++) {
          var p0 = pts[i], p1 = pts[i + 1];
          var mx = (p0.x + p1.x) / 2;
          pathD += " C " + mx + " " + p0.y + ", " + mx + " " + p1.y + ", " + p1.x + " " + p1.y;
        }
      }

      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      var isSel = selEdge === w.conn.id;
      var isAbs = w.s.isAbstracted || w.t.isAbstracted;
      p.setAttribute("class", "edge topic" + (isSel ? " sel" : "") + (isAbs ? " abstracted" : ""));
      p.setAttribute("d", pathD.trim());
      p.dataset.cid = w.conn.id;
      p.style.pointerEvents = "stroke";
      p.style.cursor = "pointer";

      p.addEventListener("click", function(ev) {
        ev.stopPropagation();
        selEdge = w.conn.id;
        selNode = null;
        selSub = null;
        render();
        toggleInspector(false);
        fillInspector();
      });

      p.addEventListener("dblclick", function(ev) {
        ev.stopPropagation();
        ev.preventDefault();
        var cr = canvas.getBoundingClientRect();
        var clickX = Math.round((ev.clientX - cr.left) / view.k);
        var clickY = Math.round((ev.clientY - cr.top) / view.k);
        insertWaypointIntoConnection(w.conn, clickX, clickY, pts);
        if (!project.view) project.view = {};
        if (!project.view.connWaypoints) project.view.connWaypoints = {};
        project.view.connWaypoints[w.conn.id] = w.conn.waypoints;
        selEdge = w.conn.id;
        selNode = null;
        selSub = null;

        var wrapRect = canvasWrap.getBoundingClientRect();
        var screenX = view.tx + clickX * view.k;
        var screenY = view.ty + clickY * view.k;
        var margin = 60;
        if (screenX < margin || screenX > wrapRect.width - margin || screenY < margin || screenY > wrapRect.height - margin) {
          view.tx = Math.round(wrapRect.width / 2 - clickX * view.k);
          view.ty = Math.round(wrapRect.height / 2 - clickY * view.k);
          applyView();
        }

        ensureCanvasEncompasses();
        pushUndo();
        drawEdges();
        toggleInspector(false);
        fillInspector();
        saveLayout(true);
      });

      svg.appendChild(p);
      renderWaypointHandles(w.conn);
    });
  }

  function drawOrthogonalEdges(validWireEntries) {
    var wirePolylines = computeAllOrthogonalPaths(validWireEntries);

    // Collect all vertical segments across all wires for jump bridge detection
    var vertSegments = [];
    wirePolylines.forEach(function(w) {
      for (var i = 0; i < w.pts.length - 1; i++) {
        var p1 = w.pts[i], p2 = w.pts[i + 1];
        if (p1.x === p2.x) {
          vertSegments.push({
            wireIdx: w.index,
            x: p1.x,
            minY: Math.min(p1.y, p2.y),
            maxY: Math.max(p1.y, p2.y)
          });
        }
      }
    });

    // Generate SVG path d-strings with bridge jump arcs
    wirePolylines.forEach(function(w) {
      var pathD = "";
      var pts = w.pts;
      if (pts.length < 2) return;

      pathD += "M " + pts[0].x + " " + pts[0].y + " ";

      for (var i = 0; i < pts.length - 1; i++) {
        var p1 = pts[i], p2 = pts[i + 1];
        var isHoriz = (p1.y === p2.y);

        if (!isHoriz) {
          pathD += "L " + p2.x + " " + p2.y + " ";
        } else {
          var y = p1.y;
          var minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
          var goingRight = (p2.x > p1.x);

          // Find intersecting vertical segments from other wires
          var intersections = [];
          vertSegments.forEach(function(v) {
            if (v.wireIdx !== w.index) {
              if (v.x > minX + 8 && v.x < maxX - 8 && y > v.minY + 4 && y < v.maxY - 4) {
                intersections.push(v.x);
              }
            }
          });

          if (intersections.length === 0) {
            pathD += "L " + p2.x + " " + p2.y + " ";
          } else {
            // Sort intersections along movement direction
            intersections.sort(function(a, b) {
              return goingRight ? (a - b) : (b - a);
            });

            intersections.forEach(function(ix) {
              var bridgeRadius = 6;
              var beforeX = goingRight ? (ix - bridgeRadius) : (ix + bridgeRadius);
              var afterX = goingRight ? (ix + bridgeRadius) : (ix - bridgeRadius);

              pathD += "L " + beforeX + " " + y + " ";
              var sweep = goingRight ? 0 : 1;
              pathD += "A " + bridgeRadius + " " + bridgeRadius + " 0 0 " + sweep + " " + afterX + " " + y + " ";
            });
            pathD += "L " + p2.x + " " + p2.y + " ";
          }
        }
      }

      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      var isSel = selEdge === w.conn.id;
      var isAbs = w.s.isAbstracted || w.t.isAbstracted;
      p.setAttribute("class", "edge topic" + (isSel ? " sel" : "") + (isAbs ? " abstracted" : ""));
      p.setAttribute("d", pathD.trim());
      p.dataset.cid = w.conn.id;
      p.style.pointerEvents = "stroke";
      p.style.cursor = "pointer";

      p.addEventListener("click", function(ev) {
        ev.stopPropagation();
        selEdge = w.conn.id;
        selNode = null;
        selSub = null;
        render();
        toggleInspector(false);
        fillInspector();
      });

      p.addEventListener("dblclick", function(ev) {
        ev.stopPropagation();
        ev.preventDefault();
        var cr = canvas.getBoundingClientRect();
        var clickX = Math.round((ev.clientX - cr.left) / view.k);
        var clickY = Math.round((ev.clientY - cr.top) / view.k);
        insertWaypointIntoConnection(w.conn, clickX, clickY, pts);
        if (!project.view) project.view = {};
        if (!project.view.connWaypoints) project.view.connWaypoints = {};
        project.view.connWaypoints[w.conn.id] = w.conn.waypoints;
        selEdge = w.conn.id;
        selNode = null;
        selSub = null;

        var wrapRect = canvasWrap.getBoundingClientRect();
        var screenX = view.tx + clickX * view.k;
        var screenY = view.ty + clickY * view.k;
        var margin = 60;
        if (screenX < margin || screenX > wrapRect.width - margin || screenY < margin || screenY > wrapRect.height - margin) {
          view.tx = Math.round(wrapRect.width / 2 - clickX * view.k);
          view.ty = Math.round(wrapRect.height / 2 - clickY * view.k);
          applyView();
        }

        ensureCanvasEncompasses();
        pushUndo();
        drawEdges();
        toggleInspector(false);
        fillInspector();
        saveLayout(true);
      });

      svg.appendChild(p);

      // 1. Draggable edge handle on vertical corridor segment
      if (w.midX != null && w.minY != null && w.maxY != null && Math.abs(w.maxY - w.minY) > 8) {
        var handleY = Math.round((w.minY + w.maxY) / 2);
        var handleV = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        handleV.setAttribute("cx", w.midX);
        handleV.setAttribute("cy", handleY);
        handleV.setAttribute("r", isSel ? "6.5" : "4.5");
        handleV.setAttribute("class", "edge-handle handle-v" + (isSel ? " sel" : ""));
        handleV.dataset.cid = w.conn.id;
        handleV.dataset.dir = "v";
        handleV.dataset.vx = w.midX;
        handleV.setAttribute("title", "Drag to move vertical wire corridor");
        svg.appendChild(handleV);
      }

      // 2. Draggable edge handle on horizontal wrap-around corridor segment
      if (w.wrapY != null && w.wrapMinX != null && w.wrapMaxX != null && Math.abs(w.wrapMaxX - w.wrapMinX) > 16) {
        var handleX = Math.round((w.wrapMinX + w.wrapMaxX) / 2);
        var handleH = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        handleH.setAttribute("cx", handleX);
        handleH.setAttribute("cy", w.wrapY);
        handleH.setAttribute("r", isSel ? "6.5" : "4.5");
        handleH.setAttribute("class", "edge-handle handle-h" + (isSel ? " sel" : ""));
        handleH.dataset.cid = w.conn.id;
        handleH.dataset.dir = "h";
        handleH.dataset.vy = w.wrapY;
        handleH.setAttribute("title", "Drag to move horizontal wire corridor");
        svg.appendChild(handleH);
      }

      // 3. Waypoint handles
      renderWaypointHandles(w.conn);
    });
  }

  /* Draw Boxy Connections with Non-Overlapping Vertical Lanes, Jump Bridges, or Linear/Spline styles */
  function drawEdges() {
    var old = svg.querySelectorAll("path.edge, .edge-handle");
    for (var k = 0; k < old.length; k++) old[k].remove();

    if (isRos) return; // In Type Schema (.ros) mode: NO connection lines or dots!

    var validWireEntries = [];
    (project.connections || []).forEach(function(c, idx) {
      var s = getPortPosition(c.from.n, c.from.i);
      var t = getPortPosition(c.to.n, c.to.i);
      if (!s || !t) return;
      if (!c.waypoints && project.view && project.view.connWaypoints && project.view.connWaypoints[c.id]) {
        c.waypoints = project.view.connWaypoints[c.id];
      }
      if (c.midX == null && project.view && project.view.connMidX && project.view.connMidX[c.id] != null) {
        c.midX = project.view.connMidX[c.id];
      }
      if (c.midY == null && project.view && project.view.connMidY && project.view.connMidY[c.id] != null) {
        c.midY = project.view.connMidY[c.id];
      }
      validWireEntries.push({
        conn: c,
        index: idx,
        s: s,
        t: t
      });
    });

    if (currentConnectorMode === "linear") {
      drawLinearEdges(validWireEntries);
    } else if (currentConnectorMode === "spline") {
      drawSplineEdges(validWireEntries);
    } else {
      drawOrthogonalEdges(validWireEntries);
    }
  }

  /* Main Render Loop */
  function render() {
    var existingNodes = canvas.querySelectorAll(".node, .subframe");
    for (var k = 0; k < existingNodes.length; k++) existingNodes[k].remove();

    (project.subSystems || []).forEach(function(sub) {
      if (subState(sub.ref) === "collapsed") {
        renderSubBox(sub);
      }
    });

    (project.nodes || []).forEach(function(n) {
      if (n.subRef && subState(n.subRef) === "collapsed") return;
      renderNode(n);
    });

    (project.subSystems || []).forEach(function(sub) {
      if (subState(sub.ref) === "framed") {
        renderSubFrame(sub);
      }
    });

    wireSubToggles();
    drawEdges();
  }

  function wireSubToggles() {
    canvas.querySelectorAll("[data-expand]").forEach(function(btn) {
      btn.onclick = function(ev) {
        ev.stopPropagation();
        var sref = btn.dataset.expand;
        setSubState(sref, "framed");
        arrangeSubsystemMembers(sref);
        pushUndo();
        render();
        fillInspector();
        syncDoc();
      };
    });
    canvas.querySelectorAll("[data-collapse]").forEach(function(btn) {
      btn.onclick = function(ev) {
        ev.stopPropagation();
        var sref = btn.dataset.collapse;
        setSubState(sref, "collapsed");
        pushUndo();
        render();
        fillInspector();
        syncDoc();
      };
    });

    canvas.querySelectorAll("[data-add-iface-node]").forEach(function(btn) {
      btn.onclick = function(ev) {
        ev.stopPropagation();
        var nid = btn.dataset.addIfaceNode;
        var node = nodeById(nid);
        if (node) {
          pushUndo();
          var newName = "iface_" + (node.ifaces.length + 1);
          node.ifaces.push({
            id: "i_" + node.id + "_" + Date.now().toString(36),
            name: newName,
            label: newName,
            kind: "pub",
            type: "std_msgs/msg/String",
            exposed: true
          });
          selNode = node.id;
          selSub = null;
          selEdge = null;
          render();
          toggleInspector(false);
          fillInspector();
          syncDoc();
        }
      };
    });

    canvas.querySelectorAll("[data-add-param-node]").forEach(function(btn) {
      btn.onclick = function(ev) {
        ev.stopPropagation();
        var nid = btn.dataset.addParamNode;
        var node = nodeById(nid);
        if (node) {
          pushUndo();
          node.params = node.params || [];
          var newName = "param_" + (node.params.length + 1);
          node.params.push({
            id: "p_" + node.id + "_" + Date.now().toString(36),
            name: newName,
            label: newName,
            ptype: "String",
            value: "",
            sysValue: "",
            exposed: true
          });
          selNode = node.id;
          selSub = null;
          selEdge = null;
          render();
          toggleInspector(false);
          fillInspector();
          syncDoc();
        }
      };
    });
  }

  /* Real-time Connection Dragging & Verification */
  function setupWireInteractions() {
    canvasWrap.addEventListener("pointerdown", function(ev) {
      // Check Resize Handles first
      var resizeHandle = ev.target.closest("[data-resize-node], [data-resize-sub], [data-resize-frame]");
      if (resizeHandle) {
        ev.stopPropagation();
        var rNode = resizeHandle.dataset.resizeNode;
        var rSub = resizeHandle.dataset.resizeSub;
        var rFrame = resizeHandle.dataset.resizeFrame;
        var targetEl = resizeHandle.closest(".node, .subframe");
        if (targetEl) {
          resizeState = {
            rNode: rNode,
            rSub: rSub,
            rFrame: rFrame,
            el: targetEl,
            startX: ev.clientX,
            startY: ev.clientY,
            origW: targetEl.offsetWidth,
            origH: targetEl.offsetHeight,
            minW: rFrame ? 260 : 200,
            minH: rFrame ? 160 : 90
          };
          return;
        }
      }

      // Check Edge Corridor Move Handle
      var edgeHandle = ev.target.closest(".edge-handle");
      if (edgeHandle) {
        ev.stopPropagation();
        var cid = edgeHandle.dataset.cid;
        var dir = edgeHandle.dataset.dir || (edgeHandle.classList.contains("handle-h") ? "h" : edgeHandle.classList.contains("handle-waypoint") ? "wp" : "v");
        var wpIdx = edgeHandle.dataset.wpidx != null ? parseInt(edgeHandle.dataset.wpidx, 10) : -1;
        edgeDragState = {
          cid: cid,
          dir: dir,
          wpIdx: wpIdx,
          startX: ev.clientX,
          startY: ev.clientY,
          origMidX: parseFloat(edgeHandle.dataset.vx || "0"),
          origMidY: parseFloat(edgeHandle.dataset.vy || "0"),
          origWpX: parseFloat(edgeHandle.dataset.wpx || "0"),
          origWpY: parseFloat(edgeHandle.dataset.wpy || "0")
        };
        selEdge = cid;
        selNode = null;
        selSub = null;
        svg.querySelectorAll(".edge-handle").forEach(function(h) { h.classList.remove("sel"); });
        edgeHandle.classList.add("sel");
        toggleInspector(false);
        fillInspector();
        return;
      }

      var port = ev.target.closest(".port");
      if (port) {
        ev.stopPropagation();
        if (!isRosSystem) {
          showToastWarning(isRos ? "Wire connections are disabled in Type Schema mode (.ros). Links represent data type references." : "Wire connections can only be created in .rossystem models.");
          return;
        }

        var srcKind = port.dataset.kind;
        var wantKind = COMPLEMENT[srcKind];
        var srcType = port.dataset.type || "";
        var srcNodeId = port.dataset.n;
        var srcIfaceId = port.dataset.i;

        wireState = {
          from: { n: srcNodeId, i: srcIfaceId, kind: srcKind, type: srcType },
          startX: ev.clientX,
          startY: ev.clientY
        };

        canvas.querySelectorAll(".port").forEach(function(p) {
          if (p === port) return;
          var pKind = p.dataset.kind;
          var pType = p.dataset.type || "";
          var pNodeId = p.dataset.n;

          var typeMatch = !srcType || !pType || srcType === pType;
          var isLegal = (pKind === wantKind && pNodeId !== srcNodeId && typeMatch);

          if (isLegal) {
            p.classList.add("legal");
          } else {
            p.classList.add("illegal");
          }
        });

        var rb = document.createElementNS("http://www.w3.org/2000/svg", "path");
        rb.setAttribute("class", "rubber");
        rb.id = "rubberBand";
        svg.appendChild(rb);

        wireHud.style.display = "block";
        wireHud.className = "wire-hud";
        document.getElementById("hudTitle").textContent = "Connecting " + KIND_LABELS[srcKind];
        document.getElementById("hudSub").textContent = "Type: " + (srcType || "Unspecified") + " -> Target: " + KIND_LABELS[wantKind];
        return;
      }

      var clickedNode = ev.target.closest(".node:not(.subbox)");
      if (clickedNode && !ev.target.closest(".port") && !ev.target.closest(".subtog") && !ev.target.closest(".resize-handle")) {
        var nid = clickedNode.dataset.n;
        var nodeObj = nodeById(nid);
        if (nodeObj) {
          dragState = {
            n: nodeObj,
            px: ev.clientX,
            py: ev.clientY,
            ox: nodeObj.x != null ? nodeObj.x : 100,
            oy: nodeObj.y != null ? nodeObj.y : 100,
            hasMoved: false
          };
          selNode = nodeObj.id;
          selEdge = null;
          selSub = null;
          render();
          toggleInspector(false);
          fillInspector();
        }
        return;
      }

      var dragSubHead = ev.target.closest("[data-drag-sub]");
      if (dragSubHead && !ev.target.closest(".resize-handle")) {
        var sref = dragSubHead.dataset.dragSub;
        if (!project.view) project.view = {};
        if (!project.view.subPos) project.view.subPos = {};
        var spos = project.view.subPos[sref] || { x: 80, y: 80 };
        dragState = { subRef: sref, px: ev.clientX, py: ev.clientY, ox: spos.x, oy: spos.y, hasMoved: false };
        selSub = sref;
        selNode = null;
        selEdge = null;
        render();
        toggleInspector(false);
        fillInspector();
        return;
      }

      if (ev.target === canvasWrap || ev.target === canvas || ev.target === svg) {
        selNode = null;
        selEdge = null;
        selSub = null;
        render();
        fillInspector();
        panState = { px: ev.clientX, py: ev.clientY, ox: view.tx, oy: view.ty };
        canvasWrap.classList.add("panning");
        return;
      }
    });

    window.addEventListener("pointermove", function(ev) {
      if (resizeState) {
        var rdx = (ev.clientX - resizeState.startX) / view.k;
        var rdy = (ev.clientY - resizeState.startY) / view.k;
        var newW = Math.max(resizeState.minW, Math.round(resizeState.origW + rdx));
        var newH = Math.max(resizeState.minH, Math.round(resizeState.origH + rdy));
        resizeState.el.style.width = newW + "px";
        resizeState.el.style.height = newH + "px";

        if (!project.view) project.view = {};
        if (resizeState.rNode) {
          var nObj = nodeById(resizeState.rNode);
          if (nObj) { nObj.w = newW; nObj.h = newH; }
          if (!project.view.nodeSize) project.view.nodeSize = {};
          if (nObj) project.view.nodeSize[nObj.label] = { w: newW, h: newH };
        } else if (resizeState.rSub) {
          var sObj = (project.subSystems || []).find(function(s) { return s.ref === resizeState.rSub; });
          if (sObj) { sObj.w = newW; sObj.h = newH; }
          if (!project.view.subSize) project.view.subSize = {};
          project.view.subSize[resizeState.rSub] = { w: newW, h: newH };
        } else if (resizeState.rFrame) {
          if (!project.view.subSize) project.view.subSize = {};
          project.view.subSize[resizeState.rFrame + "_frame"] = { w: newW, h: newH };
        }

        drawEdges();
        return;
      }

      if (edgeDragState) {
        var conn = (project.connections || []).find(function(c) { return c.id === edgeDragState.cid; });
        if (!project.view) project.view = {};
        if (edgeDragState.dir === "v") {
          var edx = (ev.clientX - edgeDragState.startX) / view.k;
          var newMidX = Math.round(edgeDragState.origMidX + edx);
          if (conn) conn.midX = newMidX;
          if (!project.view.connMidX) project.view.connMidX = {};
          project.view.connMidX[edgeDragState.cid] = newMidX;
        } else if (edgeDragState.dir === "h") {
          var edy = (ev.clientY - edgeDragState.startY) / view.k;
          var newMidY = Math.round(edgeDragState.origMidY + edy);
          if (conn) conn.midY = newMidY;
          if (!project.view.connMidY) project.view.connMidY = {};
          project.view.connMidY[edgeDragState.cid] = newMidY;
        } else if (edgeDragState.dir === "wp") {
          var edx = (ev.clientX - edgeDragState.startX) / view.k;
          var edy = (ev.clientY - edgeDragState.startY) / view.k;
          var newWpX = Math.round(edgeDragState.origWpX + edx);
          var newWpY = Math.round(edgeDragState.origWpY + edy);
          if (conn && conn.waypoints && conn.waypoints[edgeDragState.wpIdx]) {
            conn.waypoints[edgeDragState.wpIdx].x = newWpX;
            conn.waypoints[edgeDragState.wpIdx].y = newWpY;
            if (!project.view) project.view = {};
            if (!project.view.connWaypoints) project.view.connWaypoints = {};
            project.view.connWaypoints[edgeDragState.cid] = conn.waypoints;
          }
        }

        // Auto-pan viewport if dragging near canvasWrap edges
        var wrapRect = canvasWrap.getBoundingClientRect();
        var edgeMargin = 45;
        var panStep = 12;
        var didPan = false;
        if (ev.clientX > wrapRect.right - edgeMargin) {
          view.tx -= panStep;
          didPan = true;
        } else if (ev.clientX < wrapRect.left + edgeMargin) {
          view.tx += panStep;
          didPan = true;
        }
        if (ev.clientY > wrapRect.bottom - edgeMargin) {
          view.ty -= panStep;
          didPan = true;
        } else if (ev.clientY < wrapRect.top + edgeMargin) {
          view.ty += panStep;
          didPan = true;
        }
        if (didPan) {
          applyView();
        }

        drawEdges();
        return;
      }

      if (wireState) {
        var cr = canvas.getBoundingClientRect();
        var mx = (ev.clientX - cr.left) / view.k;
        var my = (ev.clientY - cr.top) / view.k;
        var s = getPortPosition(wireState.from.n, wireState.from.i);
        var rb = document.getElementById("rubberBand");
        if (s && rb) {
          var midX = Math.round((s.x + mx) / 2);
          rb.setAttribute("d", "M " + s.x + " " + s.y + " L " + midX + " " + s.y + " L " + midX + " " + my + " L " + mx + " " + my);
        }

        wireHud.style.left = ev.clientX + "px";
        wireHud.style.top = ev.clientY + "px";

        var hoverPort = ev.target.closest(".port");
        if (hoverPort && hoverPort.dataset.n !== wireState.from.n) {
          var hKind = hoverPort.dataset.kind;
          var hType = hoverPort.dataset.type || "";
          var wantKind = COMPLEMENT[wireState.from.kind];

          if (hKind === wantKind && (!wireState.from.type || !hType || wireState.from.type === hType)) {
            wireHud.className = "wire-hud valid";
            document.getElementById("hudTitle").textContent = "✅ Valid Target (" + KIND_LABELS[hKind] + ")";
            document.getElementById("hudSub").textContent = "Matches: [" + (hType || wireState.from.type) + "]";
          } else if (hKind !== wantKind) {
            wireHud.className = "wire-hud invalid";
            document.getElementById("hudTitle").textContent = "⛔ Incompatible Direction";
            document.getElementById("hudSub").textContent = "Cannot connect " + KIND_LABELS[wireState.from.kind] + " to " + KIND_LABELS[hKind];
          } else {
            wireHud.className = "wire-hud invalid";
            document.getElementById("hudTitle").textContent = "⛔ Type Mismatch";
            document.getElementById("hudSub").textContent = '"' + wireState.from.type + '" ≠ "' + hType + '"';
          }
        }
      }

      if (panState) {
        view.tx = panState.ox + (ev.clientX - panState.px);
        view.ty = panState.oy + (ev.clientY - panState.py);
        applyView();
      }

      if (dragState) {
        var rawDx = Math.abs(ev.clientX - dragState.px);
        var rawDy = Math.abs(ev.clientY - dragState.py);
        if (rawDx > 3 || rawDy > 3) {
          dragState.hasMoved = true;
        }

        var dx = (ev.clientX - dragState.px) / view.k;
        var dy = (ev.clientY - dragState.py) / view.k;
        if (dragState.n) {
          dragState.n.x = Math.round(dragState.ox + dx);
          dragState.n.y = Math.round(dragState.oy + dy);
          var el = canvas.querySelector('.node[data-n="' + dragState.n.id + '"]');
          if (el) {
            el.style.left = dragState.n.x + "px";
            el.style.top = dragState.n.y + "px";
          }
        } else if (dragState.subRef) {
          var npos = { x: Math.round(dragState.ox + dx), y: Math.round(dragState.oy + dy) };
          project.view.subPos[dragState.subRef] = npos;
          var sel = canvas.querySelector('.node.subbox[data-sub="' + dragState.subRef + '"]');
          if (sel) {
            sel.style.left = npos.x + "px";
            sel.style.top = npos.y + "px";
          }
        }
        drawEdges();
      }
    });

    window.addEventListener("pointerup", function(ev) {
      if (resizeState) {
        resizeState = null;
        ensureCanvasEncompasses();
        pushUndo();
        syncDoc();
        saveLayout(true);
      }

      if (edgeDragState) {
        edgeDragState = null;
        ensureCanvasEncompasses();
        render();
        pushUndo();
        saveLayout(true);
      }

      if (wireState) {
        var tgt = ev.target.closest(".port.legal");
        if (tgt) {
          var a = { n: wireState.from.n, i: wireState.from.i, kind: wireState.from.kind };
          var b = { n: tgt.dataset.n, i: tgt.dataset.i, kind: tgt.dataset.kind };
          var fromEnd = SRC_SIDE[a.kind] ? a : b;
          var toEnd = SRC_SIDE[a.kind] ? b : a;

          var dup = project.connections.some(function(c) {
            return c.from.n === fromEnd.n && c.from.i === fromEnd.i && c.to.n === toEnd.n && c.to.i === toEnd.i;
          });

          if (!dup) {
            pushUndo();
            project.connections.push({
              id: nextId("c"),
              from: { n: fromEnd.n, i: fromEnd.i },
              to: { n: toEnd.n, i: toEnd.i }
            });
            syncDoc();
            saveLayout(true);
          }
        }

        wireState = null;
        canvas.querySelectorAll(".port").forEach(function(p) {
          p.classList.remove("legal", "illegal", "snapped");
        });
        var rb = document.getElementById("rubberBand");
        if (rb) rb.remove();
        wireHud.style.display = "none";
        render();
      }

      if (panState) {
        panState = null;
        canvasWrap.classList.remove("panning");
        saveLayout(true);
      }

      if (dragState) {
        var didMove = dragState.hasMoved;
        dragState = null;
        if (didMove) {
          ensureCanvasEncompasses();
          render();
          pushUndo();
          syncDoc();
          saveLayout(true);
        }
      }
    });

    // Mouse-wheel zoom, vertical scroll, and horizontal scroll
    canvasWrap.addEventListener("wheel", function(ev) {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        // Zoom-to-cursor
        var zoomFactor = ev.deltaY < 0 ? 1.1 : 0.9;
        var rect = canvasWrap.getBoundingClientRect();
        var mouseX = ev.clientX - rect.left;
        var mouseY = ev.clientY - rect.top;

        var canvasX = (mouseX - view.tx) / view.k;
        var canvasY = (mouseY - view.ty) / view.k;

        var newK = Math.max(0.3, Math.min(2.5, view.k * zoomFactor));
        view.tx = Math.round(mouseX - canvasX * newK);
        view.ty = Math.round(mouseY - canvasY * newK);
        view.k = Math.round(newK * 1000) / 1000;
        applyView();
      } else if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        // Horizontal scroll: Shift+wheel or horizontal scroll wheel hardware
        var dx = ev.shiftKey ? ev.deltaY : ev.deltaX;
        view.tx = Math.round(view.tx - dx);
        applyView();
      } else {
        // Vertical scroll: Normal wheel
        view.ty = Math.round(view.ty - ev.deltaY);
        applyView();
      }
    }, { passive: false });
  }

  /* Automatically prune incompatible connections and warn user upon interface mutation */
  function pruneIncompatibleConnections(targetNode, targetIface) {
    var removedConnections = [];
    project.connections = project.connections.filter(function(conn) {
      var fn = nodeById(conn.from.n), tn = nodeById(conn.to.n);
      var fi = ifaceById(fn, conn.from.i), ti = ifaceById(tn, conn.to.i);
      if (!fn || !tn || !fi || !ti) return false;

      // Check if this connection touches the modified interface
      if ((fn.id === targetNode.id && fi.id === targetIface.id) || (tn.id === targetNode.id && ti.id === targetIface.id)) {
        var wantKind = COMPLEMENT[fi.kind];
        var isKindValid = (ti.kind === wantKind);
        var isTypeValid = (!fi.type || !ti.type || fi.type === ti.type);

        if (!isKindValid || !isTypeValid) {
          var reason = !isKindValid
            ? ("Incompatible kind (" + fi.kind + " ≠ " + ti.kind + ")")
            : ("Type mismatch ('" + fi.type + "' ≠ '" + ti.type + "')");

          removedConnections.push({
            from: fn.label + "::" + (fi.label || fi.name),
            to: tn.label + "::" + (ti.label || ti.name),
            reason: reason
          });
          return false;
        }
      }
      return true;
    });

    if (removedConnections.length > 0) {
      removedConnections.forEach(function(rc) {
        showToastWarning("Removed invalid connection [" + rc.from + " -> " + rc.to + "]: " + rc.reason);
      });
    }
  }

  /* Populate HTML5 datalists from type_index.json */
  function populateTypeSuggestions() {
    var msgList = document.getElementById("typeSuggestions_msg");
    var srvList = document.getElementById("typeSuggestions_srv");
    var actList = document.getElementById("typeSuggestions_action");
    var allList = document.getElementById("typeSuggestions_all");

    if (!msgList || !srvList || !actList || !allList) return;
    msgList.innerHTML = "";
    srvList.innerHTML = "";
    actList.innerHTML = "";
    allList.innerHTML = "";

    var types = (typeCatalog && typeCatalog.types) || {};
    var typeKeys = Object.keys(types).sort();

    var commonDefaults = [
      { name: "sensor_msgs/msg/Image", kind: "msg" },
      { name: "sensor_msgs/msg/CompressedImage", kind: "msg" },
      { name: "sensor_msgs/msg/LaserScan", kind: "msg" },
      { name: "sensor_msgs/msg/PointCloud2", kind: "msg" },
      { name: "sensor_msgs/msg/Imu", kind: "msg" },
      { name: "std_msgs/msg/String", kind: "msg" },
      { name: "std_msgs/msg/Header", kind: "msg" },
      { name: "std_msgs/msg/Bool", kind: "msg" },
      { name: "std_msgs/msg/Int32", kind: "msg" },
      { name: "std_msgs/msg/Float64", kind: "msg" },
      { name: "geometry_msgs/msg/Twist", kind: "msg" },
      { name: "geometry_msgs/msg/PoseStamped", kind: "msg" },
      { name: "geometry_msgs/msg/TransformStamped", kind: "msg" },
      { name: "nav_msgs/msg/Odometry", kind: "msg" },
      { name: "nav_msgs/msg/OccupancyGrid", kind: "msg" },
      { name: "nav_msgs/msg/Path", kind: "msg" },
      { name: "std_srvs/srv/SetBool", kind: "srv" },
      { name: "std_srvs/srv/Trigger", kind: "srv" },
      { name: "std_srvs/srv/Empty", kind: "srv" },
      { name: "nav2_msgs/action/NavigateToPose", kind: "action" }
    ];

    var seen = {};
    commonDefaults.forEach(function(d) {
      seen[d.name] = true;
      function addOpt(list) {
        if (!list) return;
        var o = document.createElement("option");
        o.value = d.name;
        list.appendChild(o);
      }
      if (d.kind === "msg") addOpt(msgList);
      if (d.kind === "srv") addOpt(srvList);
      if (d.kind === "action") addOpt(actList);
      addOpt(allList);
    });

    typeKeys.forEach(function(tname) {
      if (seen[tname]) return;
      seen[tname] = true;
      var info = types[tname] || {};
      function addOpt(list) {
        if (!list) return;
        var o = document.createElement("option");
        o.value = tname;
        list.appendChild(o);
      }
      if (info.kind === "msg" || tname.includes("/msg/")) addOpt(msgList);
      else if (info.kind === "srv" || tname.includes("/srv/")) addOpt(srvList);
      else if (info.kind === "action" || tname.includes("/action/")) addOpt(actList);
      addOpt(allList);
    });
  }

  /* Inspector Form Generation with Type Content Assist */
  function fillInspector() {
    var container = document.getElementById("inspectorContent");
    if (selNode) {
      var n = nodeById(selNode);
      if (!n) { container.innerHTML = "Select an element to inspect"; return; }

      // UML Type Schema Card (.ros) Inspector
      if (n.backing === "type") {
        var spec = n.typeSpec || { name: n.label, category: n.typeCategory || 'msg', pkg: n.pkg, fields: {} };
        if (!spec.fields) spec.fields = {};
        var h = '<div class="fld"><label>Type Name</label><input type="text" id="inpTypeLabel" value="' + esc(n.label) + '"></div>'
          + '<div class="fld"><label>Package</label><input type="text" id="inpTypePkg" value="' + esc(n.pkg || '') + '"></div>'
          + '<div class="fld"><label>Category</label><select id="inpTypeCat">'
          + '<option value="msg"' + (spec.category === 'msg' ? ' selected' : '') + '>Message (TopicSpec)</option>'
          + '<option value="srv"' + (spec.category === 'srv' ? ' selected' : '') + '>Service (ServiceSpec)</option>'
          + '<option value="action"' + (spec.category === 'action' ? ' selected' : '') + '>Action (ActionSpec)</option>'
          + '</select></div>';

        var comps = spec.category === 'msg' ? ['message']
          : spec.category === 'srv' ? ['request', 'response']
          : ['goal', 'result', 'feedback'];

        comps.forEach(function(comp) {
          var compTitle = comp.toUpperCase();
          var fList = spec.fields[comp] || [];
          h += '<div class="insec-head" style="margin-top:0.8rem; display:flex; justify-content:space-between; align-items:center;">'
            + '<span class="insec-title">' + compTitle + ' (' + fList.length + ')</span>'
            + '<button class="btn btn-sm btn-add-field" data-comp="' + comp + '" style="padding:2px 8px; font-size:0.72rem; background:var(--accent); color:var(--accent-text);" title="Add Field">+ Add Field</button>'
            + '</div>';

          fList.forEach(function(f, fIdx) {
            h += '<div style="padding:0.4rem 0; border-bottom:1px solid var(--rule-soft);">'
              + '<div style="display:flex; align-items:center; gap:0.4rem;">'
              + '<input type="text" class="inp-f-type" data-comp="' + comp + '" data-fidx="' + fIdx + '" value="' + esc(f.type) + '" placeholder="Type" style="width:45%; font-family:var(--font-mono); font-size:0.75rem; padding:2px 4px;">'
              + '<input type="text" class="inp-f-name" data-comp="' + comp + '" data-fidx="' + fIdx + '" value="' + esc(f.name) + '" placeholder="Field name" style="flex:1; font-family:var(--font-mono); font-size:0.75rem; font-weight:bold; padding:2px 4px;">'
              + '<button class="btn btn-sm btn-del-field" data-comp="' + comp + '" data-fidx="' + fIdx + '" title="Delete Field" style="color:var(--dead); border-color:var(--dead); padding:1px 5px;">🗑️</button>'
              + '</div>'
              + (spec.category === 'msg' ? (
                  '<div style="display:flex; align-items:center; gap:0.4rem; margin-top:0.3rem; font-size:0.75rem;">'
                  + '<label style="display:flex; align-items:center; gap:0.2rem; cursor:pointer;"><input type="checkbox" class="chk-f-const" data-comp="' + comp + '" data-fidx="' + fIdx + '"' + (f.constant ? ' checked' : '') + '> Constant</label>'
                  + (f.constant ? '<input type="text" class="inp-f-val" data-comp="' + comp + '" data-fidx="' + fIdx + '" value="' + esc(f.value != null ? f.value : '') + '" placeholder="Value" style="flex:1; font-family:var(--font-mono); font-size:0.75rem; padding:1px 4px;">' : '')
                  + '</div>'
                ) : '')
              + '</div>';
          });
        });

        h += '<button class="btn" id="btnDeleteTypeCard" style="margin-top:1rem; color:var(--dead); border-color:var(--dead);">Delete Type Card</button>';
        container.innerHTML = h;

        document.getElementById("inpTypeLabel").onchange = function(e) {
          pushUndo();
          var oldName = n.label;
          var newName = e.target.value.trim();
          n.label = newName;
          spec.name = newName;
          if (project.types[spec.pkg + "." + oldName]) {
            delete project.types[spec.pkg + "." + oldName];
            project.types[spec.pkg + "." + newName] = spec;
          }
          render(); fillInspector(); syncDoc();
        };

        document.getElementById("inpTypePkg").onchange = function(e) {
          pushUndo();
          n.pkg = e.target.value.trim();
          spec.pkg = n.pkg;
          render(); fillInspector(); syncDoc();
        };

        document.getElementById("inpTypeCat").onchange = function(e) {
          pushUndo();
          spec.category = e.target.value;
          n.typeCategory = spec.category;
          render(); fillInspector(); syncDoc();
        };

        document.querySelectorAll(".btn-add-field").forEach(function(btn) {
          btn.onclick = function() {
            pushUndo();
            var comp = btn.dataset.comp;
            spec.fields[comp] = spec.fields[comp] || [];
            var newF = {
              type: "string",
              name: "field_" + (spec.fields[comp].length + 1),
              constant: false,
              array: false
            };
            spec.fields[comp].push(newF);
            render(); fillInspector(); syncDoc();
          };
        });

        document.querySelectorAll(".btn-del-field").forEach(function(btn) {
          btn.onclick = function() {
            var comp = btn.dataset.comp;
            var fidx = parseInt(btn.dataset.fidx, 10);
            if (spec.fields[comp] && spec.fields[comp][fidx]) {
              pushUndo();
              spec.fields[comp].splice(fidx, 1);
              render(); fillInspector(); syncDoc();
            }
          };
        });

        document.querySelectorAll(".inp-f-type").forEach(function(inp) {
          inp.onchange = function(e) {
            var comp = inp.dataset.comp;
            var fidx = parseInt(inp.dataset.fidx, 10);
            if (spec.fields[comp] && spec.fields[comp][fidx]) {
              pushUndo();
              spec.fields[comp][fidx].type = e.target.value.trim();
              spec.fields[comp][fidx].array = e.target.value.trim().endsWith("[]");
              render(); fillInspector(); syncDoc();
            }
          };
        });

        document.querySelectorAll(".inp-f-name").forEach(function(inp) {
          inp.onchange = function(e) {
            var comp = inp.dataset.comp;
            var fidx = parseInt(inp.dataset.fidx, 10);
            if (spec.fields[comp] && spec.fields[comp][fidx]) {
              pushUndo();
              spec.fields[comp][fidx].name = e.target.value.trim();
              render(); fillInspector(); syncDoc();
            }
          };
        });

        document.querySelectorAll(".chk-f-const").forEach(function(chk) {
          chk.onchange = function(e) {
            var comp = chk.dataset.comp;
            var fidx = parseInt(chk.dataset.fidx, 10);
            if (spec.fields[comp] && spec.fields[comp][fidx]) {
              pushUndo();
              spec.fields[comp][fidx].constant = e.target.checked;
              if (!spec.fields[comp][fidx].constant) {
                delete spec.fields[comp][fidx].value;
              } else {
                spec.fields[comp][fidx].value = "0";
              }
              render(); fillInspector(); syncDoc();
            }
          };
        });

        document.querySelectorAll(".inp-f-val").forEach(function(inp) {
          inp.onchange = function(e) {
            var comp = inp.dataset.comp;
            var fidx = parseInt(inp.dataset.fidx, 10);
            if (spec.fields[comp] && spec.fields[comp][fidx]) {
              pushUndo();
              spec.fields[comp][fidx].value = e.target.value.trim();
              render(); fillInspector(); syncDoc();
            }
          };
        });

        document.getElementById("btnDeleteTypeCard").onclick = function() {
          pushUndo();
          project.nodes = project.nodes.filter(function(x) { return x.id !== n.id; });
          project.connections = project.connections.filter(function(c) { return c.from.n !== n.id && c.to.n !== n.id; });
          if (project.types[spec.pkg + "." + n.label]) {
            delete project.types[spec.pkg + "." + n.label];
          }
          selNode = null;
          render(); fillInspector(); syncDoc();
        };
        return;
      }

      // Standard Component / RosSystem Node Inspector
      var h = '<div class="fld"><label>Node Label</label><input type="text" id="inpNodeLabel" value="' + esc(n.label) + '"></div>'
        + '<div class="fld"><label>Package / Artifact</label><input type="text" id="inpNodeFrom" value="' + esc(n.from || '') + '"></div>'
        + '<div class="fld"><label>Namespace</label><input type="text" id="inpNodeNs" value="' + esc(n.namespace || '') + '"></div>'
        + '<div class="insec-head" style="margin-top:0.8rem; display:flex; justify-content:space-between; align-items:center;">'
        + '<span class="insec-title">Interfaces (' + n.ifaces.length + ')</span>'
        + '<button class="btn btn-sm" id="btnAddIface" style="padding:2px 8px; font-size:0.72rem; background:var(--accent); color:var(--accent-text);" title="Add Interface">+ Add Interface</button>'
        + '</div>';

      n.ifaces.forEach(function(f, idx) {
        var listId = (f.kind === 'pub' || f.kind === 'sub') ? 'typeSuggestions_msg'
          : (f.kind === 'ss' || f.kind === 'sc') ? 'typeSuggestions_srv'
          : (f.kind === 'as' || f.kind === 'ac') ? 'typeSuggestions_action'
          : 'typeSuggestions_all';

        h += '<div style="padding:0.4rem 0; border-bottom:1px solid var(--rule-soft);">'
          + '<div style="display:flex; align-items:center; gap:0.3rem;">'
          + '<span class="kd ' + f.kind + '">' + f.kind + '</span>'
          + '<input type="text" class="inp-iface-name" data-iface-name-idx="' + idx + '" value="' + esc(f.name || f.label) + '" placeholder="Interface name" style="flex:1; font-weight:600; font-size:0.8rem; padding:2px 5px;">'
          + '<button class="btn btn-sm btn-del-iface" data-del-iface-idx="' + idx + '" title="Delete Interface" style="color:var(--dead); border-color:var(--dead); padding:1px 5px;">🗑️</button>'
          + '</div>'
          + '<div class="fld" style="margin-top:0.3rem;"><label>Kind</label>'
          + '<select data-iface-kind-idx="' + idx + '" class="inp-iface-kind">'
          + '<option value="pub"' + (f.kind === 'pub' ? ' selected' : '') + '>Publisher (pub)</option>'
          + '<option value="sub"' + (f.kind === 'sub' ? ' selected' : '') + '>Subscriber (sub)</option>'
          + '<option value="ss"' + (f.kind === 'ss' ? ' selected' : '') + '>Service Server (ss)</option>'
          + '<option value="sc"' + (f.kind === 'sc' ? ' selected' : '') + '>Service Client (sc)</option>'
          + '<option value="as"' + (f.kind === 'as' ? ' selected' : '') + '>Action Server (as)</option>'
          + '<option value="ac"' + (f.kind === 'ac' ? ' selected' : '') + '>Action Client (ac)</option>'
          + '</select></div>'
          + '<div class="fld" style="margin-top:0.3rem;"><label>Type (Message / Topic)</label>'
          + '<input type="text" list="' + listId + '" data-iface-idx="' + idx + '" class="inp-iface-type" value="' + esc(f.type || '') + '" placeholder="e.g. sensor_msgs/msg/Image">'
          + '</div>'
          + '</div>';
      });

      // Parameters Section
      var paramsList = n.params || [];
      h += '<div class="insec-head" style="margin-top:1.1rem; display:flex; justify-content:space-between; align-items:center;">'
        + '<span class="insec-title">Parameters (' + paramsList.length + ')</span>'
        + '<button class="btn btn-sm" id="btnAddParam" style="padding:2px 8px; font-size:0.72rem; background:var(--accent); color:var(--accent-text);" title="Add Parameter">+ Add Parameter</button>'
        + '</div>';

      paramsList.forEach(function(p, pIdx) {
        h += '<div style="padding:0.4rem 0; border-bottom:1px solid var(--rule-soft);">'
          + '<div style="display:flex; align-items:center; gap:0.3rem;">'
          + '<span class="pk" style="background:var(--k-param-bg); color:var(--k-param); padding:1px 4px; border-radius:3px; font-size:0.65rem; font-weight:bold;">P</span>'
          + '<input type="text" class="inp-param-name" data-param-name-idx="' + pIdx + '" value="' + esc(p.name || p.label) + '" placeholder="Parameter name" style="flex:1; font-weight:600; font-size:0.8rem; padding:2px 5px;">'
          + '<button class="btn btn-sm btn-del-param" data-del-param-idx="' + pIdx + '" title="Delete Parameter" style="color:var(--dead); border-color:var(--dead); padding:1px 5px;">🗑️</button>'
          + '</div>'
          + '<div style="display:flex; gap:0.4rem; margin-top:0.3rem;">'
          + '<select class="inp-param-type" data-param-type-idx="' + pIdx + '" style="width:40%;">'
          + '<option value="String"' + (p.ptype === 'String' ? ' selected' : '') + '>String</option>'
          + '<option value="Integer"' + (p.ptype === 'Integer' ? ' selected' : '') + '>Integer</option>'
          + '<option value="Double"' + (p.ptype === 'Double' ? ' selected' : '') + '>Double</option>'
          + '<option value="Boolean"' + (p.ptype === 'Boolean' ? ' selected' : '') + '>Boolean</option>'
          + '<option value="Array"' + (p.ptype === 'Array' ? ' selected' : '') + '>Array</option>'
          + '</select>'
          + '<input type="text" class="inp-param-val" data-param-val-idx="' + pIdx + '" value="' + esc(p.sysValue != null ? p.sysValue : (p.value != null ? p.value : '')) + '" placeholder="Value" style="flex:1; padding:2px 5px;">'
          + '</div>'
          + '</div>';
      });

      h += '<button class="btn" id="btnDeleteNode" style="margin-top:1rem; color:var(--dead); border-color:var(--dead);">Delete Node</button>';
      container.innerHTML = h;

      document.getElementById("inpNodeLabel").onchange = function(e) {
        pushUndo(); n.label = e.target.value; render(); fillInspector(); syncDoc();
      };
      document.getElementById("inpNodeFrom").onchange = function(e) {
        pushUndo(); n.from = e.target.value; render(); fillInspector(); syncDoc();
      };
      document.getElementById("inpNodeNs").onchange = function(e) {
        pushUndo(); n.namespace = e.target.value; render(); fillInspector(); syncDoc();
      };

      var btnAddIface = document.getElementById("btnAddIface");
      if (btnAddIface) {
        btnAddIface.onclick = function() {
          pushUndo();
          var newName = "iface_" + (n.ifaces.length + 1);
          n.ifaces.push({
            id: "i_" + n.id + "_" + Date.now().toString(36),
            name: newName,
            label: newName,
            kind: "pub",
            type: "std_msgs/msg/String",
            exposed: true
          });
          render(); fillInspector(); syncDoc();
        };
      }

      document.querySelectorAll(".btn-del-iface").forEach(function(btn) {
        btn.onclick = function(e) {
          e.stopPropagation();
          var idx = parseInt(btn.dataset.delIfaceIdx, 10);
          var removed = n.ifaces[idx];
          if (!removed) return;
          pushUndo();
          n.ifaces.splice(idx, 1);
          project.connections = project.connections.filter(function(c) {
            return !((c.from.n === n.id && c.from.i === removed.id) || (c.to.n === n.id && c.to.i === removed.id));
          });
          render(); fillInspector(); syncDoc();
        };
      });

      document.querySelectorAll(".inp-iface-name").forEach(function(inp) {
        inp.onchange = function(e) {
          var idx = parseInt(inp.dataset.ifaceNameIdx, 10);
          if (n.ifaces[idx]) {
            pushUndo();
            var val = e.target.value.trim();
            n.ifaces[idx].name = val;
            n.ifaces[idx].label = val;
            render(); fillInspector(); syncDoc();
          }
        };
      });

      document.querySelectorAll(".inp-iface-kind").forEach(function(sel) {
        sel.onchange = function(e) {
          var idx = parseInt(sel.dataset.ifaceKindIdx, 10);
          pushUndo();
          n.ifaces[idx].kind = e.target.value;
          pruneIncompatibleConnections(n, n.ifaces[idx]);
          render();
          fillInspector();
          syncDoc();
        };
      });

      document.querySelectorAll(".inp-iface-type").forEach(function(inp) {
        inp.onchange = function(e) {
          var idx = parseInt(inp.dataset.ifaceIdx, 10);
          pushUndo();
          n.ifaces[idx].type = e.target.value;
          pruneIncompatibleConnections(n, n.ifaces[idx]);
          render();
          fillInspector();
          syncDoc();
        };
      });

      var btnAddParam = document.getElementById("btnAddParam");
      if (btnAddParam) {
        btnAddParam.onclick = function() {
          pushUndo();
          n.params = n.params || [];
          var newName = "param_" + (n.params.length + 1);
          n.params.push({
            id: "p_" + n.id + "_" + Date.now().toString(36),
            name: newName,
            label: newName,
            ptype: "String",
            value: "",
            sysValue: "",
            exposed: true
          });
          render(); fillInspector(); syncDoc();
        };
      }

      document.querySelectorAll(".btn-del-param").forEach(function(btn) {
        btn.onclick = function(e) {
          e.stopPropagation();
          var idx = parseInt(btn.dataset.delParamIdx, 10);
          if (n.params && n.params[idx]) {
            pushUndo();
            n.params.splice(idx, 1);
            render(); fillInspector(); syncDoc();
          }
        };
      });

      document.querySelectorAll(".inp-param-name").forEach(function(inp) {
        inp.onchange = function(e) {
          var idx = parseInt(inp.dataset.paramNameIdx, 10);
          if (n.params && n.params[idx]) {
            pushUndo();
            var val = e.target.value.trim();
            n.params[idx].name = val;
            n.params[idx].label = val;
            render(); fillInspector(); syncDoc();
          }
        };
      });

      document.querySelectorAll(".inp-param-type").forEach(function(sel) {
        sel.onchange = function(e) {
          var idx = parseInt(sel.dataset.paramTypeIdx, 10);
          if (n.params && n.params[idx]) {
            pushUndo();
            n.params[idx].ptype = e.target.value;
            render(); fillInspector(); syncDoc();
          }
        };
      });

      document.querySelectorAll(".inp-param-val").forEach(function(inp) {
        inp.onchange = function(e) {
          var idx = parseInt(inp.dataset.paramValIdx, 10);
          if (n.params && n.params[idx]) {
            pushUndo();
            n.params[idx].value = e.target.value;
            n.params[idx].sysValue = e.target.value;
            render(); fillInspector(); syncDoc();
          }
        };
      });

      document.getElementById("btnDeleteNode").onclick = function() {
        pushUndo();
        project.nodes = project.nodes.filter(function(x) { return x.id !== n.id; });
        project.connections = project.connections.filter(function(c) { return c.from.n !== n.id && c.to.n !== n.id; });
        selNode = null;
        render(); fillInspector(); syncDoc();
      };
      return;
    }

    if (selEdge) {
      var conn = project.connections.find(function(c) { return c.id === selEdge; });
      if (conn) {
        var fn = nodeById(conn.from.n), tn = nodeById(conn.to.n);
        var fi = ifaceById(fn, conn.from.i), ti = ifaceById(tn, conn.to.i);
        var wps = conn.waypoints || (project.view && project.view.connWaypoints && project.view.connWaypoints[conn.id]) || [];
        var hasOffset = conn.midX != null || (project.view && project.view.connMidX && project.view.connMidX[conn.id] != null);
        var h = '<div class="fld"><label>From</label><div class="sysname-input">' + esc(fn ? fn.label : '') + ' :: ' + esc(fi ? (fi.label || fi.name) : '') + '</div></div>'
          + '<div class="fld"><label>To</label><div class="sysname-input">' + esc(tn ? tn.label : '') + ' :: ' + esc(ti ? (ti.label || ti.name) : '') + '</div></div>'
          + '<div class="fld"><label>Type</label><div class="sysname-input">' + esc(fi ? fi.type : '—') + '</div></div>'
          + '<div class="fld"><label>Routing / Waypoints</label><div class="sysname-input">' + wps.length + ' custom waypoint(s)' + (hasOffset ? ' + corridor offset' : '') + '</div></div>'
          + '<button class="btn" id="btnResetConnBends" style="margin-top:0.6rem; width:100%; font-size:0.75rem;">↺ Reset Bends &amp; Waypoints</button>'
          + '<button class="btn" id="btnDeleteConn" style="margin-top:0.6rem; width:100%; color:var(--dead); border-color:var(--dead);">Delete Connection</button>';
        container.innerHTML = h;

        var btnReset = document.getElementById("btnResetConnBends");
        if (btnReset) {
          btnReset.onclick = function() {
            pushUndo();
            conn.waypoints = [];
            delete conn.midX;
            delete conn.midY;
            if (project.view) {
              if (project.view.connWaypoints) delete project.view.connWaypoints[conn.id];
              if (project.view.connMidX) delete project.view.connMidX[conn.id];
              if (project.view.connMidY) delete project.view.connMidY[conn.id];
            }
            render();
            fillInspector();
            saveLayout(true);
            showToastSuccess("Connection route reset to default");
          };
        }

        document.getElementById("btnDeleteConn").onclick = function() {
          pushUndo();
          project.connections = project.connections.filter(function(c) { return c.id !== selEdge; });
          selEdge = null;
          render(); fillInspector(); syncDoc();
        };
        return;
      }
    }

    container.innerHTML = '<div style="color:var(--ink-3);">Select a node or connection on canvas to view and edit properties.</div>';
  }

  /* Setup UI Event Listeners */
  function setupUI() {
    try {
      function safeClick(id, fn) {
        var el = document.getElementById(id);
        if (el) el.onclick = fn;
      }

      var sysNameEl = document.getElementById("sysNameInput");
      if (sysNameEl) {
        sysNameEl.onchange = function(e) {
          pushUndo();
          project.system.name = e.target.value;
          syncDoc();
        };
      }

      if (btnToggleInspector) {
        btnToggleInspector.onclick = function() {
          toggleInspector();
        };
      }
      safeClick("btnCollapseInspector", function() {
        toggleInspector(true);
      });

      safeClick("btnUndo", function() {
        if (!undoStack.length) return;
        redoStack.push(JSON.stringify(project));
        project = JSON.parse(undoStack.pop());
        render(); fillInspector(); syncDoc();
      });

      safeClick("btnRedo", function() {
        if (!redoStack.length) return;
        undoStack.push(JSON.stringify(project));
        project = JSON.parse(redoStack.pop());
        render(); fillInspector(); syncDoc();
      });

      safeClick("btnAutoLayout", function() {
        autoLayout();
      });

      safeClick("btnFitView", function() {
        view.tx = 40; view.ty = 40; view.k = 1; applyView();
      });
      safeClick("btnZoomIn", function() {
        view.k = Math.min(2.5, view.k * 1.2); applyView();
      });
      safeClick("btnZoomOut", function() {
        view.k = Math.max(0.3, view.k / 1.2); applyView();
      });

      safeClick("btnGenerate", function() {
        vscode.postMessage({ type: "generateCode" });
      });
      safeClick("btnSwitchToCode", function() {
        vscode.postMessage({ type: "openCodeView" });
      });

      safeClick("btnAddNode", function() {
        pushUndo();
        var nodeName = "node_" + (project.nodes.length + 1);
        var newNode = {
          id: "n_" + nodeName,
          label: nodeName,
          ifaces: [
            { id: "i_" + nodeName + "_topic_out", name: "topic_out", label: "topic_out", kind: "pub", type: "std_msgs/msg/String", exposed: true },
            { id: "i_" + nodeName + "_topic_in", name: "topic_in", label: "topic_in", kind: "sub", type: "std_msgs/msg/String", exposed: true }
          ],
          params: [],
          x: 120 + project.nodes.length * 30,
          y: 120 + project.nodes.length * 30,
          backing: "local"
        };
        project.nodes.push(newNode);
        render();
        selNode = newNode.id;
        toggleInspector(false);
        fillInspector();
        syncDoc();
      });

      safeClick("btnCollapseAll", function() {
        pushUndo();
        (project.subSystems || []).forEach(function(s) { setSubState(s.ref, "collapsed"); });
        render(); syncDoc();
      });
      safeClick("btnExpandAll", function() {
        pushUndo();
        (project.subSystems || []).forEach(function(s) {
          setSubState(s.ref, "framed");
          arrangeSubsystemMembers(s.ref);
        });
        render(); syncDoc();
      });

      var filterKeys = { fltPub: "pub", fltSub: "sub", fltSS: "ss", fltSC: "sc", fltAS: "as", fltAC: "ac", fltParam: "param" };
      Object.keys(filterKeys).forEach(function(id) {
        var k = filterKeys[id];
        var el = document.getElementById(id);
        if (el) {
          el.onchange = function(e) {
            filterKind[k] = e.target.checked;
            render();
          };
        }
      });

      safeClick("btnWireOrthogonal", function() { setConnectorMode("orthogonal"); });
      safeClick("btnWireLinear", function() { setConnectorMode("linear"); });
      safeClick("btnWireSpline", function() { setConnectorMode("spline"); });

      var catDrawer = document.getElementById("catalogueDrawer");
      var catTitleEl = document.getElementById("catDrawerTitle");
      var catTabsEl = document.getElementById("catTabs");
      var tabNodesBtn = document.getElementById("tabCatNodes");
      var tabSubsystemsBtn = document.getElementById("tabCatSubsystems");
      var catSearchInput = document.getElementById("catSearchInput");

      safeClick("btnOpenCatalogue", function() {
        if (catDrawer) {
          catDrawer.classList.toggle("open");
          if (catDrawer.classList.contains("open")) {
            renderCatalogue();
          }
        }
      });
      safeClick("btnCloseCatalogue", function() {
        if (catDrawer) catDrawer.classList.remove("open");
      });
      safeClick("btnAddSubsystem", function() {
        if (catDrawer) {
          catDrawer.classList.add("open");
          if (tabSubsystemsBtn) {
            activeCatTab = "subsystems";
            tabSubsystemsBtn.classList.add("active");
            if (tabNodesBtn) tabNodesBtn.classList.remove("active");
          }
          renderCatalogue();
        }
      });

      if (tabNodesBtn) {
        tabNodesBtn.onclick = function() {
          activeCatTab = "nodes";
          tabNodesBtn.classList.add("active");
          if (tabSubsystemsBtn) tabSubsystemsBtn.classList.remove("active");
          renderCatalogue();
        };
      }
      if (tabSubsystemsBtn) {
        tabSubsystemsBtn.onclick = function() {
          activeCatTab = "subsystems";
          tabSubsystemsBtn.classList.add("active");
          if (tabNodesBtn) tabNodesBtn.classList.remove("active");
          renderCatalogue();
        };
      }
      if (catSearchInput) {
        catSearchInput.oninput = function() {
          renderCatalogue();
        };
      }

      function normalizeCatalogueInterfaces(rawIfaces) {
        var ifaces = [];
        if (!rawIfaces) return ifaces;
        if (Array.isArray(rawIfaces)) {
          rawIfaces.forEach(function(f) {
            var iname = f.name || f.label || "iface";
            ifaces.push({
              id: iname,
              name: iname,
              label: f.label || iname,
              kind: f.kind || "pub",
              type: f.type || "",
              exposed: true
            });
          });
        } else if (typeof rawIfaces === "object") {
          Object.keys(rawIfaces).forEach(function(iname) {
            var kindOrObj = rawIfaces[iname];
            var kind = typeof kindOrObj === "string" ? kindOrObj : (kindOrObj.kind || "pub");
            var type = typeof kindOrObj === "object" ? (kindOrObj.type || "") : "";
            ifaces.push({
              id: iname,
              name: iname,
              label: iname,
              kind: kind,
              type: type,
              exposed: true
            });
          });
        }
        return ifaces;
      }

      function renderCatalogue() {
      var list = document.getElementById("catList");
      if (!list) return;
      list.innerHTML = "";
      var q = (catSearchInput ? catSearchInput.value : "").trim().toLowerCase();

      if (isRos) {
        // 1. Communication Objects View (.ros) -> Only .ros communication objects
        if (catTitleEl) catTitleEl.textContent = "Communication Objects";
        if (catTabsEl) catTabsEl.style.display = "none";

        var types = (typeCatalog && typeCatalog.types) || {};
        var typeKeys = Object.keys(types).sort();
        var count = 0;

        typeKeys.forEach(function(k) {
          if (q && !k.toLowerCase().includes(q)) return;
          count++;
          var tinfo = types[k] || {};
          var kind = tinfo.kind || (k.includes("/srv/") ? "srv" : k.includes("/action/") ? "action" : "msg");
          var parts = k.split("/");
          var pkgName = parts[0] || "ros_package";
          var typeLabel = parts[parts.length - 1];

          var card = document.createElement("div");
          card.className = "cat-card";
          card.innerHTML = '<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">'
            + '<span class="type-badge ' + kind + '">' + kind.toUpperCase() + '</span>'
            + '<span class="ctitle" style="font-size:0.8rem; font-weight:600;">' + esc(typeLabel) + '</span>'
            + '</div>'
            + '<div class="csub">' + esc(k) + '</div>';

          card.onclick = function() {
            pushUndo();
            var uniqueLabel = typeLabel;
            var suffix = 1;
            while (project.nodes.some(function(n) { return n.label === uniqueLabel; })) {
              uniqueLabel = typeLabel + "_" + (++suffix);
            }

            var spec = {
              name: uniqueLabel,
              pkg: pkgName,
              category: kind,
              fields: {}
            };
            if (kind === "msg") spec.fields["message"] = [];
            else if (kind === "srv") { spec.fields["request"] = []; spec.fields["response"] = []; }
            else if (kind === "action") { spec.fields["goal"] = []; spec.fields["result"] = []; spec.fields["feedback"] = []; }

            var newTypeNode = {
              id: "n_" + uniqueLabel,
              label: uniqueLabel,
              pkg: pkgName,
              backing: "type",
              typeCategory: kind,
              typeSpec: spec,
              ifaces: [],
              params: [],
              x: 140 + project.nodes.length * 25,
              y: 140 + project.nodes.length * 25
            };
            project.nodes.push(newTypeNode);
            if (!project.types) project.types = {};
            project.types[pkgName + "." + uniqueLabel] = spec;

            catDrawer.classList.remove("open");
            render();
            selNode = newTypeNode.id;
            toggleInspector(false);
            fillInspector();
            syncDoc();
            saveLayout(true);
          };
          list.appendChild(card);
        });

        if (count === 0) {
          list.innerHTML = '<div style="padding:1rem; color:var(--ink-3); text-align:center;">No matching communication objects found.</div>';
        }
      } else if (!isRosSystem) {
        // 2. Component View (.ros2 / .ros1) -> Only Component Node templates
        if (catTitleEl) catTitleEl.textContent = "Component Templates";
        if (catTabsEl) catTabsEl.style.display = "none";

        var nodes = (nodeCatalog && nodeCatalog.nodes) || {};
        var nodeKeys = Object.keys(nodes).sort();
        var count = 0;

        nodeKeys.forEach(function(k) {
          var catEntry = nodes[k];
          var nodeLbl = k.includes(".") ? k.split(".")[1] : k;
          var pkgName = catEntry.pkg || (k.includes(".") ? k.split(".")[0] : "");
          var searchable = (k + " " + (catEntry.from || "") + " " + pkgName).toLowerCase();
          if (q && !searchable.includes(q)) return;
          count++;

          var ifaces = normalizeCatalogueInterfaces(catEntry.interfaces);
          var card = document.createElement("div");
          card.className = "cat-card";
          card.innerHTML = '<div class="ctitle">' + esc(nodeLbl) + '</div>'
            + '<div class="csub">' + esc(catEntry.from || k) + (pkgName ? ' (' + esc(pkgName) + ')' : '') + '</div>'
            + '<div style="font-size:0.68rem; color:var(--ink-3); margin-top:2px;">' + ifaces.length + ' interface(s)</div>';

          card.onclick = function() {
            pushUndo();
            var uniqueLabel = nodeLbl;
            var suffix = 1;
            while (project.nodes.some(function(n) { return n.label === uniqueLabel; })) {
              uniqueLabel = nodeLbl + "_" + (++suffix);
            }

            var nodeIfaces = ifaces.map(function(f) {
              return {
                id: "i_" + uniqueLabel + "_" + f.name,
                name: f.name,
                label: f.label || f.name,
                kind: f.kind || "pub",
                type: f.type || "",
                exposed: true
              };
            });

            var n = {
              id: "n_" + uniqueLabel,
              label: uniqueLabel,
              from: catEntry.from || k,
              artifact: catEntry.artifact || nodeLbl,
              pkg: pkgName,
              backing: "cat",
              ifaces: nodeIfaces,
              params: [],
              x: 140 + project.nodes.length * 25,
              y: 140 + project.nodes.length * 25
            };
            project.nodes.push(n);
            catDrawer.classList.remove("open");
            render();
            selNode = n.id;
            toggleInspector(false);
            fillInspector();
            syncDoc();
            saveLayout(true);
          };
          list.appendChild(card);
        });

        if (count === 0) {
          list.innerHTML = '<div style="padding:1rem; color:var(--ink-3); text-align:center;">No matching components found.</div>';
        }
      } else {
        // 3. ROS System View (.rossystem) -> Nodes and Subsystems
        if (catTitleEl) catTitleEl.textContent = "ROS System Components";
        if (catTabsEl) catTabsEl.style.display = "flex";

        if (activeCatTab === "nodes") {
          var nodes = (nodeCatalog && nodeCatalog.nodes) || {};
          var nodeKeys = Object.keys(nodes).sort();
          var count = 0;

          nodeKeys.forEach(function(k) {
            var catEntry = nodes[k];
            var nodeLbl = k.includes(".") ? k.split(".")[1] : k;
            var pkgName = catEntry.pkg || (k.includes(".") ? k.split(".")[0] : "");
            var searchable = (k + " " + (catEntry.from || "") + " " + pkgName).toLowerCase();
            if (q && !searchable.includes(q)) return;
            count++;

            var ifaces = normalizeCatalogueInterfaces(catEntry.interfaces);
            var card = document.createElement("div");
            card.className = "cat-card";
            card.innerHTML = '<div class="ctitle">' + esc(nodeLbl) + '</div>'
              + '<div class="csub">' + esc(catEntry.from || k) + (pkgName ? ' (' + esc(pkgName) + ')' : '') + '</div>'
              + '<div style="font-size:0.68rem; color:var(--ink-3); margin-top:2px;">' + ifaces.length + ' interface(s)</div>';

            card.onclick = function() {
              pushUndo();
              var uniqueLabel = nodeLbl;
              var suffix = 1;
              while (project.nodes.some(function(n) { return n.label === uniqueLabel; })) {
                uniqueLabel = nodeLbl + "_" + (++suffix);
              }

              var nodeIfaces = ifaces.map(function(f) {
                return {
                  id: "i_" + uniqueLabel + "_" + f.name,
                  name: f.name,
                  label: f.label || f.name,
                  kind: f.kind || "pub",
                  type: f.type || "",
                  exposed: true
                };
              });

              var n = {
                id: "n_" + uniqueLabel,
                label: uniqueLabel,
                from: catEntry.from || k,
                artifact: catEntry.artifact || nodeLbl,
                pkg: pkgName,
                backing: "cat",
                ifaces: nodeIfaces,
                params: [],
                x: 140 + project.nodes.length * 25,
                y: 140 + project.nodes.length * 25
              };
              project.nodes.push(n);
              catDrawer.classList.remove("open");
              render();
              selNode = n.id;
              toggleInspector(false);
              fillInspector();
              syncDoc();
              saveLayout(true);
            };
            list.appendChild(card);
          });

          if (count === 0) {
            list.innerHTML = '<div style="padding:1rem; color:var(--ink-3); text-align:center;">No matching nodes found.</div>';
          }
        } else {
          // Subsystems tab
          var systems = (nodeCatalog && nodeCatalog._systems) || [];
          var count = 0;

          systems.forEach(function(sys) {
            var sysName = sys.system || "subsystem";
            var searchable = (sysName + " " + (sys.file || "")).toLowerCase();
            if (q && !searchable.includes(q)) return;
            count++;

            var nodeCount = Object.keys(sys.nodes || {}).length;
            var card = document.createElement("div");
            card.className = "cat-card";
            card.innerHTML = '<div class="ctitle">' + esc(sysName) + '</div>'
              + '<div class="csub">' + esc(sys.file || '') + '</div>'
              + '<div style="font-size:0.68rem; color:var(--k-subsystem); margin-top:2px;">' + nodeCount + ' component node(s)</div>';

            card.onclick = function() {
              pushUndo();
              var uniqueRef = sysName;
              var suffix = 1;
              while ((project.subSystems || []).some(function(s) { return s.ref === uniqueRef; })) {
                uniqueRef = sysName + "_" + (++suffix);
              }

              if (!project.subSystems) project.subSystems = [];
              var subEntry = {
                ref: uniqueRef,
                state: "collapsed",
                fromFile: sys.file
              };
              project.subSystems.push(subEntry);

              if (!project.view) project.view = {};
              if (!project.view.subPos) project.view.subPos = {};
              project.view.subPos[uniqueRef] = {
                x: 100 + project.subSystems.length * 40,
                y: 100 + project.subSystems.length * 40
              };

              Object.keys(sys.nodes || {}).forEach(function(nKey) {
                var nodeDef = sys.nodes[nKey];
                var ifaces = normalizeCatalogueInterfaces(nodeDef.interfaces);
                var nodeIfaces = ifaces.map(function(f) {
                  return {
                    id: "i_" + nKey + "_" + f.name,
                    name: f.name,
                    label: f.label || f.name,
                    kind: f.kind || "pub",
                    type: f.type || "",
                    exposed: true
                  };
                });

                var n = {
                  id: "n_" + uniqueRef + "_" + nKey,
                  label: nKey,
                  from: nodeDef.from || nKey,
                  subRef: uniqueRef,
                  backing: "sub",
                  ifaces: nodeIfaces,
                  params: [],
                  x: 100,
                  y: 100
                };
                project.nodes.push(n);
              });

              catDrawer.classList.remove("open");
              render();
              selSub = uniqueRef;
              toggleInspector(false);
              fillInspector();
              syncDoc();
              saveLayout(true);
            };
            list.appendChild(card);
          });

          if (count === 0) {
            list.innerHTML = '<div style="padding:1rem; color:var(--ink-3); text-align:center;">No matching subsystems found.</div>';
          }
        }
      }
    }
    } catch (err) {
      console.error("Error in setupUI:", err);
    }
  }

  // Handle messages from VS Code Extension Host
  window.addEventListener("message", function(event) {
    var msg = event.data;
    if (msg.type === "updateModel") {
      var fresh = msg.project;
      
      var selectedLabel = null;
      if (selNode) {
        var oldN = nodeById(selNode);
        if (oldN) selectedLabel = oldN.label;
      }

      var posByLabel = {};
      var sizeByLabel = {};
      (project.nodes || []).forEach(function(n) {
        if (n.x != null && n.y != null) {
          posByLabel[n.label] = { x: n.x, y: n.y };
        }
        if (n.w || n.h) {
          sizeByLabel[n.label] = { w: n.w, h: n.h };
        }
      });

      var cols = Math.max(1, Math.ceil(Math.sqrt((fresh.nodes || []).length)));
      (fresh.nodes || []).forEach(function(n, idx) {
        if (posByLabel[n.label]) {
          n.x = posByLabel[n.label].x;
          n.y = posByLabel[n.label].y;
        } else if (n.x == null || n.y == null) {
          var c = idx % cols;
          var r = Math.floor(idx / cols);
          n.x = 80 + c * 320;
          n.y = 80 + r * 260;
        }
        if (sizeByLabel[n.label]) {
          n.w = sizeByLabel[n.label].w;
          n.h = sizeByLabel[n.label].h;
        }
      });

      var midXByConn = {};
      (project.connections || []).forEach(function(c) {
        if (c.midX != null) {
          midXByConn[c.id] = c.midX;
          midXByConn[c.from.n + "->" + c.to.n] = c.midX;
        }
      });
      (fresh.connections || []).forEach(function(c) {
        var saved = midXByConn[c.id] || midXByConn[c.from.n + "->" + c.to.n];
        if (saved != null) c.midX = saved;
      });

      if (project.view) {
        fresh.view = fresh.view || {};
        // Live client user interactions take precedence over incoming defaults
        fresh.view.subStates = Object.assign({}, fresh.view.subStates, project.view.subStates);
        fresh.view.subPos = Object.assign({}, fresh.view.subPos, project.view.subPos);
        fresh.view.nodeSize = Object.assign({}, fresh.view.nodeSize, project.view.nodeSize);
        fresh.view.subSize = Object.assign({}, fresh.view.subSize, project.view.subSize);
        fresh.view.connMidX = Object.assign({}, fresh.view.connMidX, project.view.connMidX);
        fresh.view.connMidY = Object.assign({}, fresh.view.connMidY, project.view.connMidY);
        fresh.view.connWaypoints = Object.assign({}, fresh.view.connWaypoints, project.view.connWaypoints);
        if (project.view.connectorMode) fresh.view.connectorMode = project.view.connectorMode;
      }

      if (fresh.view && fresh.view.connectorMode) {
        currentConnectorMode = fresh.view.connectorMode;
        updateConnectorModeButtons();
      }

      project = fresh;
      if (selectedLabel) {
        var newSelectedNode = project.nodes.find(function(n) { return n.label === selectedLabel; });
        selNode = newSelectedNode ? newSelectedNode.id : null;
      }

      render();
      fillInspector();
    }
  });

  populateTypeSuggestions();
  updateConnectorModeButtons();
  layoutInitialPositions();
  applyView();
  render();
  setupWireInteractions();
  setupUI();
  fillInspector();
</script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
