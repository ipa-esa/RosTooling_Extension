import React, { useState, useEffect } from 'react';
import {
  Plus,
  Layers,
  Cpu,
  Code2,
  RefreshCw,
  Undo2,
  Redo2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Play,
  FileCode2,
  BookOpen,
} from 'lucide-react';
import {
  useStudio,
  setUIState,
  renameModel,
  editProperty,
  createProcess,
  getDisplayModelName,
  KIND_META,
  showToast,
} from './state/studioStore';
import { CommitInput } from './components/CommitInput';
import { hostBridge } from './state/vscodeBridge';
import { ReadOnlyBanner } from './components/ReadOnlyBanner';
import { CatalogueDrawer } from './components/CatalogueDrawer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RosSystemView } from './views/RosSystemView';
import { RosComponentView } from './views/RosComponentView';
import { RosCommObjectsView, addNewCommObjectSpec } from './views/RosCommObjectsView';

export function RosStudioApp() {
  const studio = useStudio();
  const [diagOpen, setDiagOpen] = useState(false);

  const {
    project,
    mode,
    isReadOnly,
    docFileName,
    interfaceFilter,
    typeCategoryFilter,
    toast,
  } = studio;

  useEffect(() => {
    const onKeyDown = (e) => {
      if (isReadOnly) return;
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
        return;
      }
      // Undo/redo is VS Code's document history (model edits are WorkspaceEdits). In the
      // .rossystem diagram the GLSP client's own Ctrl+Z binding is routed there by the host.
      if (mode !== 'system' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) hostBridge.redo();
        else hostBridge.undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isReadOnly, mode]);

  const displayModelName = getDisplayModelName(project, mode, docFileName);
  const diags = project.diagnostics || [];
  const errCount = diags.filter((d) => d.severity === 'error').length;
  const warnCount = diags.filter((d) => d.severity === 'warning').length;

  const modeBadgeLabel =
    mode === 'ros'
      ? 'Communication Objects (.ros)'
      : mode === 'component'
      ? 'Component (.ros2)'
      : 'System (.rossystem)';

  
  return (
    <div className={`rt-app mode-${mode}`}>
      <ReadOnlyBanner isReadOnly={isReadOnly} docFileName={docFileName} />

      <header className="rt-topbar">
        <div className="rt-brand">
          <span>RosTooling Studio</span>
          <span className={`rt-mode-badge mode-${mode}`}>{modeBadgeLabel}</span>
        </div>

        {/* Editable System / Package Name */}
        <div className="rt-name-group">
          <label htmlFor="sysNameInput">{mode === 'system' ? 'System:' : 'Package:'}</label>
          <CommitInput
            className="rt-sysname-input"
            disabled={isReadOnly}
            placeholder={mode === 'system' ? 'ros_system' : 'Enter package name...'}
            value={displayModelName}
            onCommit={(v) => renameModel(v)}
          />
        </div>

        <div className="rt-divider" />

        {/* Mode-Specific Primary Toolbar Controls */}
        <div className="rt-toolbar-actions">
          {mode === 'system' && (
            <>
              {!isReadOnly && (
                <>
                  <button
                    id="btnAddSystemNode"
                    type="button"
                    className="rt-btn primary"
                    onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'nodes' })}
                  >
                    <Plus size={13} /> + Import Node
                  </button>
                  <button
                    id="btnAddSubsystem"
                    type="button"
                    className="rt-btn"
                    onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'systems' })}
                  >
                    <Layers size={13} /> + Import Subsystem
                  </button>
                  <button
                    id="btnAddProcess"
                    type="button"
                    className="rt-btn"
                    title="Add a process (composable node container)"
                    onClick={() => {
                      const taken = new Set((project.processes || []).map((p) => p.name));
                      let i = taken.size + 1;
                      while (taken.has(`container_${i}`)) i += 1;
                      createProcess({ processName: `container_${i}`, threads: 1 });
                    }}
                  >
                    <Cpu size={13} /> + Add Process
                  </button>
                </>
              )}

              <span id="filterInterfaceSection">
                <select
                  className="rt-select"
                  title="Filter ports & wires by interaction kind"
                  value={interfaceFilter}
                  onChange={(e) => setUIState({ interfaceFilter: e.target.value })}
                >
                  <option value="all">All Interfaces</option>
                  {Object.entries(KIND_META).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label} ({v.short})
                    </option>
                  ))}
                </select>
              </span>

              <button
                type="button"
                className="rt-btn"
                title="Generate ROS 2 launch & package files"
                onClick={() => hostBridge.generateCode()}
              >
                <Play size={13} /> Generate ROS 2 Package
              </button>
            </>
          )}

          {mode === 'component' && (
            <>
              {!isReadOnly && (
                <button
                  id="btnAddNode"
                  type="button"
                  className="rt-btn primary"
                  onClick={() => {
                    const pkg = Object.values(project.packages || {})[0];
                    if (!pkg?.id) return;
                    const taken = new Set((project.nodes || []).map((n) => n.artifact || n.label));
                    let i = taken.size + 1;
                    while (taken.has(`node_${i}`)) i += 1;
                    editProperty(pkg.id, 'addArtifact', `node_${i}`, { key: `node_${i}` });
                  }}
                >
                  <Plus size={13} /> + Add New Node
                </button>
              )}

              <span id="filterInterfaceSection">
                <select
                  className="rt-select"
                  value={interfaceFilter}
                  onChange={(e) => setUIState({ interfaceFilter: e.target.value })}
                >
                  <option value="all">All Interfaces</option>
                  {Object.entries(KIND_META).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label} ({v.short})
                    </option>
                  ))}
                </select>
              </span>

              <button
                type="button"
                className="rt-btn"
                onClick={() =>
                  hostBridge.generateWrappers((project.nodes || []).map((n) => n.label))
                }
              >
                <FileCode2 size={13} /> Generate Wrappers
              </button>
            </>
          )}

          {mode === 'ros' && (
            <>
              {!isReadOnly && (
                <>
                  <button
                    id="btnAddCommObject"
                    type="button"
                    className="rt-btn primary"
                    onClick={() => {
                      const n = addNewCommObjectSpec('msg', isReadOnly, project, docFileName);
                      if (n) setUIState({ selectedTypeName: n });
                    }}
                  >
                    <Plus size={13} /> + Message
                  </button>
                  <button
                    type="button"
                    className="rt-btn"
                    onClick={() => {
                      const n = addNewCommObjectSpec('srv', isReadOnly, project, docFileName);
                      if (n) setUIState({ selectedTypeName: n });
                    }}
                  >
                    <Plus size={13} /> + Service
                  </button>
                  <button
                    type="button"
                    className="rt-btn"
                    onClick={() => {
                      const n = addNewCommObjectSpec('action', isReadOnly, project, docFileName);
                      if (n) setUIState({ selectedTypeName: n });
                    }}
                  >
                    <Plus size={13} /> + Action
                  </button>
                </>
              )}

              <span id="filterTypeSection">
                <select
                  className="rt-select"
                  value={typeCategoryFilter}
                  onChange={(e) => setUIState({ typeCategoryFilter: e.target.value })}
                >
                  <option value="all">All Categories</option>
                  <option value="msg">Messages (msg)</option>
                  <option value="srv">Services (srv)</option>
                  <option value="action">Actions (action)</option>
                </select>
              </span>
            </>
          )}
        </div>

        {/* Right-Side Shared Controls: Undo/Redo, Diagnostics, Catalogue, Open Code */}
        <div className="rt-toolbar-right">
          {!isReadOnly && (
            <>
              <button
                type="button"
                className="rt-btn icon-only subtle"
                title="Undo (Ctrl+Z)"
                onClick={() => hostBridge.undo()}
              >
                <Undo2 size={14} />
              </button>
              <button
                type="button"
                className="rt-btn icon-only subtle"
                title="Redo (Ctrl+Shift+Z)"
                onClick={() => hostBridge.redo()}
              >
                <Redo2 size={14} />
              </button>
            </>
          )}

          {/* Diagnostics Pill & Popover */}
          <div className="rt-diag-wrap">
            <button
              type="button"
              className={`rt-diag-pill ${errCount > 0 ? 'err' : warnCount > 0 ? 'warn' : 'ok'}`}
              title="Xtext LSP & Semantic Model Diagnostics"
              onClick={() => setDiagOpen((o) => !o)}
            >
              {errCount > 0 ? (
                <>
                  <AlertCircle size={13} /> {errCount} {errCount === 1 ? 'error' : 'errors'}
                  {warnCount > 0 ? `, ${warnCount} warn` : ''}
                </>
              ) : warnCount > 0 ? (
                <>
                  <AlertTriangle size={13} /> {warnCount} {warnCount === 1 ? 'warning' : 'warnings'}
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} /> Valid
                </>
              )}
            </button>

            {diagOpen && (
              <div className="rt-diag-popover">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: 12.5 }}>Model Diagnostics ({diags.length})</strong>
                  <button
                    type="button"
                    className="rt-btn subtle"
                    style={{ height: 22, padding: '0 6px', fontSize: 11 }}
                    onClick={() => setDiagOpen(false)}
                  >
                    Close
                  </button>
                </div>
                {diags.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--rt-muted)' }}>
                    No Xtext grammar or semantic validation issues detected.
                  </p>
                ) : (
                  diags.map((d, idx) => (
                    <div
                      key={idx}
                      className="rt-diag-item"
                      onClick={() => {
                        if (d.elementKind === 'node' && d.elementId) {
                          setUIState({
                            selectedNodeId: d.elementId,
                            selectedEdgeId: null,
                            selectedSubsystemRef: null,
                            selectedProcessName: null,
                          });
                        } else if (d.elementKind === 'connection' && d.elementId) {
                          setUIState({
                            selectedEdgeId: d.elementId,
                            selectedNodeId: null,
                            selectedSubsystemRef: null,
                            selectedProcessName: null,
                          });
                        } else if (d.elementKind === 'process' && d.elementId) {
                          setUIState({
                            selectedProcessName: d.elementId,
                            selectedNodeId: null,
                            selectedEdgeId: null,
                            selectedSubsystemRef: null,
                          });
                        } else if (d.elementKind === 'subsystem' && d.elementId) {
                          setUIState({
                            selectedSubsystemRef: d.elementId,
                            selectedNodeId: null,
                            selectedEdgeId: null,
                            selectedProcessName: null,
                          });
                        }
                        setDiagOpen(false);
                      }}
                    >
                      <span className={`rt-badge ${d.severity === 'error' ? 'diag-err' : 'diag-warn'}`}>
                        {d.severity}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ display: 'block' }}>
                          {d.targetName || d.elementKind}
                          {d.line ? ` (L${d.line})` : ''}
                        </strong>
                        <span style={{ color: 'var(--rt-muted)' }}>{d.message}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {!isReadOnly && (
            <button
              id="btnOpenCatalogue"
              type="button"
              className="rt-btn"
              title="Browse Catalogue & Sources"
              onClick={() =>
                setUIState({
                  catalogueOpen: true,
                  catalogueTab: mode === 'ros' ? 'types' : 'nodes',
                })
              }
            >
              <BookOpen size={13} /> Catalogue
            </button>
          )}

          <button
            type="button"
            className="rt-btn"
            title="Sync RosModelsCatalog & RosCommonObjects from GitHub"
            onClick={() => {
              hostBridge.pullCatalogue();
              showToast('Syncing component & type catalogues from GitHub...');
            }}
          >
            <RefreshCw size={13} /> Sync Catalogue
          </button>

          <button
            type="button"
            className="rt-btn"
            title="Open raw Xtext DSL source file in VS Code editor"
            onClick={() => hostBridge.openCodeView()}
          >
            <Code2 size={13} /> Open Code
          </button>
        </div>
      </header>

      {/* Mode View Router */}
      <ErrorBoundary>
        {mode === 'ros' ? (
          <RosCommObjectsView />
        ) : mode === 'component' ? (
          <RosComponentView />
        ) : (
          <RosSystemView />
        )}
      </ErrorBoundary>

      <CatalogueDrawer />

      {toast && (
        <div className={`rt-toast ${toast.isError ? 'error' : ''}`} role="status">
          {toast.isError ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
