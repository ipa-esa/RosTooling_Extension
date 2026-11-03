import React, { useState, useEffect } from 'react';
import {
  Plus,
  Layers,
  Cpu,
  LayoutGrid,
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
  ExternalLink,
  Globe,
  ArrowRightCircle,
} from 'lucide-react';
import {
  useStudio,
  setUIState,
  mutateProject,
  mutateLayout,
  syncPackagesFromNodes,
  updateModelName,
  getDisplayModelName,
  runDagreAutoLayout,
  undoEdit,
  redoEdit,
  KIND_META,
  showToast,
} from './state/studioStore';
import { hostBridge } from './state/vscodeBridge';
import { ReadOnlyBanner } from './components/ReadOnlyBanner';
import { CatalogueDrawer } from './components/CatalogueDrawer';
import { RosSystemView } from './views/RosSystemView';
import { RosComponentView, createNewComponentNode } from './views/RosComponentView';
import { RosCommObjectsView, addNewCommObjectSpec } from './views/RosCommObjectsView';
import {
  MACRO_STAGES,
  MacroIntentView,
  MacroPackagesView,
  MacroChecksView,
  MacroDeploymentView,
} from './views/MacroLifecycleViews';

export function RosStudioApp() {
  const studio = useStudio();
  const [diagOpen, setDiagOpen] = useState(false);
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjName, setNewProjName] = useState('');

  const {
    project,
    mode,
    macroStage,
    macroProjects,
    macroActiveProjectId,
    macroRevision,
    macroModelState,
    macroBusy,
    isReadOnly,
    docFileName,
    interfaceFilter,
    typeCategoryFilter,
    toast,
    past,
    future,
  } = studio;

  useEffect(() => {
    const onKeyDown = (e) => {
      if (isReadOnly) return;
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoEdit();
        else undoEdit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isReadOnly]);

  const isMacro = mode === 'macro';
  const showSystemCanvasControls = mode === 'system' || (isMacro && macroStage === 'architecture');

  const displayModelName = getDisplayModelName(project, mode, docFileName);
  const diags = project.diagnostics || [];
  const errCount = diags.filter((d) => d.severity === 'error').length;
  const warnCount = diags.filter((d) => d.severity === 'warning').length;

  const modeBadgeLabel =
    mode === 'macro'
      ? 'Macro Lifecycle Workbench'
      : mode === 'ros'
      ? 'Communication Objects (.ros)'
      : mode === 'component'
      ? 'Component (.ros2)'
      : 'System (.rossystem)';

  const connectorMode = project.view?.connectorMode || 'orthogonal';

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
          <label htmlFor="sysNameInput">
            {mode === 'system' || isMacro ? 'System:' : 'Package:'}
          </label>
          <input
            id="sysNameInput"
            className="rt-sysname-input"
            disabled={isReadOnly}
            placeholder={mode === 'system' || isMacro ? 'ros_system' : 'Enter package name...'}
            value={displayModelName}
            onChange={(e) => updateModelName(e.target.value)}
          />
        </div>

        <div className="rt-divider" />

        {/* Mode-Specific Primary Toolbar Controls */}
        <div className="rt-toolbar-actions">
          {showSystemCanvasControls && (
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
                    onClick={() => {
                      let createdName = 'container_1';
                      mutateProject((proj) => {
                        if (!proj.processes) proj.processes = [];
                        let idx = proj.processes.length + 1;
                        createdName = `container_${idx}`;
                        while (proj.processes.some((p) => p.name === createdName)) {
                          idx += 1;
                          createdName = `container_${idx}`;
                        }
                        proj.processes.push({ name: createdName, nodes: [], threads: 2 });
                      });
                      setUIState({
                        selectedProcessName: createdName,
                        selectedNodeId: null,
                        selectedEdgeId: null,
                        selectedSubsystemRef: null,
                      });
                    }}
                  >
                    <Cpu size={13} /> + Add Process
                  </button>
                  <button
                    type="button"
                    className="rt-btn"
                    title="Arrange system nodes left-to-right with Dagre"
                    onClick={runDagreAutoLayout}
                  >
                    <LayoutGrid size={13} /> Auto Layout
                  </button>
                </>
              )}

              <select
                className="rt-select"
                title="Edge routing style"
                disabled={isReadOnly}
                value={connectorMode}
                onChange={(e) => {
                  const nextStyle = e.target.value;
                  mutateLayout((proj) => {
                    if (!proj.view) proj.view = {};
                    proj.view.connectorMode = nextStyle;
                  });
                }}
              >
                <option value="orthogonal">Orthogonal (SmoothStep)</option>
                <option value="spline">Spline (Bézier)</option>
                <option value="linear">Linear (Straight)</option>
              </select>

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

              {mode === 'system' && (
                <button
                  type="button"
                  className="rt-btn"
                  title="Generate ROS 2 launch & package files"
                  onClick={() => hostBridge.generateCode()}
                >
                  <Play size={13} /> Generate ROS 2 Package
                </button>
              )}
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
                    let newId = null;
                    mutateProject((proj) => {
                      const created = createNewComponentNode(proj, docFileName);
                      newId = created.id;
                      if (!proj.nodes) proj.nodes = [];
                      proj.nodes.push(created);
                      syncPackagesFromNodes(proj);
                    });
                    if (newId) setUIState({ selectedNodeId: newId });
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

        {/* Right-Side Shared Controls */}
        <div className="rt-toolbar-right">
          {!isReadOnly && (
            <>
              <button
                type="button"
                className="rt-btn icon-only subtle"
                disabled={past.length === 0}
                title="Undo (Ctrl+Z)"
                onClick={undoEdit}
              >
                <Undo2 size={14} />
              </button>
              <button
                type="button"
                className="rt-btn icon-only subtle"
                disabled={future.length === 0}
                title="Redo (Ctrl+Shift+Z)"
                onClick={redoEdit}
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

          {isMacro ? (
            <>
              <button
                type="button"
                className="rt-btn"
                title="Preview virtual uncommitted .rossystem / .ros2 drafts (rostooling-draft://)"
                onClick={() => hostBridge.macroPreviewDraftDsl()}
              >
                <FileCode2 size={13} /> Draft DSL
              </button>
              <button
                type="button"
                className="rt-btn primary"
                disabled={macroBusy}
                title="Materialize Studio architecture into workspace models/*.rossystem & *.ros2 and open Micro Visual Editor"
                onClick={() => hostBridge.macroPromoteToModels('models')}
              >
                <ArrowRightCircle size={13} /> Promote to Models
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rt-btn"
              title="Open raw Xtext DSL source file in VS Code editor"
              onClick={() => hostBridge.openCodeView()}
            >
              <Code2 size={13} /> Open Code
            </button>
          )}
        </div>
      </header>

      {/* Macro 5-Stage Lifecycle & Multi-Monitor Ribbon */}
      {isMacro && (
        <nav className="rt-macro-bar" aria-label="CoreSense Studio Lifecycle Stages">
          <div className="rt-macro-proj-switcher">
            <select
              className="rt-select"
              title="Active CoreSense Studio Project"
              value={macroActiveProjectId || ''}
              onChange={(e) => {
                if (e.target.value) {
                  hostBridge.macroSelectProject(e.target.value);
                }
              }}
            >
              {macroProjects.length === 0 && <option value="">Loading projects...</option>}
              {macroProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.systemName || p.id}
                </option>
              ))}
            </select>
            {newProjOpen ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  className="rt-input"
                  style={{ width: 135, height: 26 }}
                  placeholder="project_name"
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newProjName.trim()) {
                      hostBridge.macroCreateProject(newProjName.trim(), '');
                      setNewProjName('');
                      setNewProjOpen(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="rt-btn primary"
                  style={{ height: 26, padding: '0 8px' }}
                  onClick={() => {
                    if (newProjName.trim()) {
                      hostBridge.macroCreateProject(newProjName.trim(), '');
                      setNewProjName('');
                      setNewProjOpen(false);
                    }
                  }}
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="rt-btn subtle"
                style={{ height: 26, padding: '0 8px' }}
                title="Create new CoreSense Studio project"
                onClick={() => setNewProjOpen(true)}
              >
                <Plus size={12} /> New
              </button>
            )}
            <span className="rt-macro-rev-pill">
              rev #{macroRevision || 1} · {macroModelState || 'clean'}
            </span>
          </div>

          <div className="rt-macro-stage-tabs">
            {MACRO_STAGES.map((st) => (
              <button
                key={st.id}
                type="button"
                className={`rt-macro-stage-tab ${macroStage === st.id ? 'active' : ''}`}
                onClick={() => setUIState({ macroStage: st.id })}
              >
                <span>{st.emoji}</span>
                <span>{st.label}</span>
              </button>
            ))}
          </div>

          <div className="rt-macro-multimonitor">
            <button
              type="button"
              className="rt-btn subtle"
              style={{ height: 26, padding: '0 9px' }}
              title="Pop out this lifecycle stage into a floating VS Code window for a secondary monitor"
              onClick={() => hostBridge.macroPopOutStage(macroStage)}
            >
              <ExternalLink size={12} /> Pop Out Window
            </button>
            <button
              type="button"
              className="rt-btn subtle"
              style={{ height: 26, padding: '0 9px' }}
              title="Open this project and stage in an external system browser window (multi-monitor)"
              onClick={() => hostBridge.macroOpenExternalBrowser(macroStage)}
            >
              <Globe size={12} /> Open in Browser
            </button>
          </div>
        </nav>
      )}

      {/* Mode View Router */}
      {isMacro ? (
        macroStage === 'intent' ? (
          <MacroIntentView />
        ) : macroStage === 'packages' ? (
          <MacroPackagesView />
        ) : macroStage === 'architecture' ? (
          <RosSystemView />
        ) : macroStage === 'checks' ? (
          <MacroChecksView />
        ) : (
          <MacroDeploymentView />
        )
      ) : mode === 'ros' ? (
        <RosCommObjectsView />
      ) : mode === 'component' ? (
        <RosComponentView />
      ) : (
        <RosSystemView />
      )}

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
