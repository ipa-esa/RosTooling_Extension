import React, { useState } from 'react';
import {
  Target,
  Package,
  ShieldCheck,
  Rocket,
  Plus,
  Trash2,
  Play,
  FileCode2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  GitBranch,
  FolderSearch,
  BookOpen,
  RefreshCw,
  Cpu,
  Layers,
} from 'lucide-react';
import {
  useStudio,
  mutateProject,
  setUIState,
  PIPELINE_ROLES,
  PIPELINE_ROLE_KEYS,
  getNodeRole,
  showToast,
} from '../state/studioStore';
import { hostBridge } from '../state/vscodeBridge';

export const MACRO_STAGES = [
  { id: 'intent', label: '1. Intent', emoji: '🎯' },
  { id: 'packages', label: '2. Packages', emoji: '📦' },
  { id: 'architecture', label: '3. Architecture', emoji: '📐' },
  { id: 'checks', label: '4. Checks', emoji: '🛡️' },
  { id: 'deployment', label: '5. Deployment', emoji: '🚀' },
];

export function MacroIntentView() {
  const { project, macroProjects, macroActiveProjectId } = useStudio();
  const [newProjName, setNewProjName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const p = project || {};
  const studio = p.studio || {};
  const brief = studio.brief || {};
  const criteria = Array.isArray(studio.criteria) ? studio.criteria : [];
  const behaviors = Array.isArray(studio.behavior) ? studio.behavior : [];
  const nodes = Array.isArray(p.nodes) ? p.nodes : [];

  const activeProjMeta = (macroProjects || []).find((pr) => pr.id === macroActiveProjectId);

  const updateBrief = (field, value) => {
    mutateProject((proj) => {
      if (!proj.studio) proj.studio = {};
      if (!proj.studio.brief) proj.studio.brief = {};
      proj.studio.brief[field] = value;
    });
  };

  const roleCounts = {};
  for (const r of PIPELINE_ROLE_KEYS) roleCounts[r] = 0;
  for (const n of nodes) {
    const r = getNodeRole(n, p);
    roleCounts[r] = (roleCounts[r] || 0) + 1;
  }

  return (
    <div className="rt-macro-stage-scroll">
      <div className="rt-macro-container">
        {/* Project Context & Persistence Card */}
        <div className="rt-card" style={{ marginBottom: 12 }}>
          <div className="rt-macro-section-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={16} color="var(--rt-border-strong)" />
              <h3 style={{ margin: 0, fontSize: 14 }}>
                Active System Project:{' '}
                <span style={{ color: 'var(--rt-accent, #3b82f6)' }}>
                  {p.system?.name || activeProjMeta?.name || 'Untitled system'}
                </span>
              </h3>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {createOpen ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    className="rt-input"
                    style={{ width: 160, height: 26 }}
                    placeholder="new_project_name"
                    value={newProjName}
                    onChange={(e) => setNewProjName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newProjName.trim()) {
                        hostBridge.macroCreateProject(newProjName.trim(), '');
                        setNewProjName('');
                        setCreateOpen(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="rt-btn primary"
                    style={{ height: 26, padding: '0 10px' }}
                    onClick={() => {
                      if (newProjName.trim()) {
                        hostBridge.macroCreateProject(newProjName.trim(), '');
                        setNewProjName('');
                        setCreateOpen(false);
                      }
                    }}
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    className="rt-btn subtle"
                    style={{ height: 26, padding: '0 8px' }}
                    onClick={() => setCreateOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="rt-btn"
                    style={{ height: 26, padding: '0 10px' }}
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus size={12} /> New Project
                  </button>
                  {macroActiveProjectId && (
                    <button
                      type="button"
                      className="rt-btn subtle"
                      style={{ height: 26, padding: '0 8px', color: 'var(--rt-danger, #ef4444)' }}
                      title="Delete active RosTooling Studio project"
                      onClick={() => {
                        const projName = p.system?.name || activeProjMeta?.name || macroActiveProjectId;
                        if (
                          window.confirm(
                            `Are you sure you want to delete project "${projName}"? This action cannot be undone.`
                          )
                        ) {
                          hostBridge.macroDeleteProject(macroActiveProjectId);
                        }
                      }}
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="rt-macro-help" style={{ margin: 0 }}>
            Project state is persisted in <code>~/ros-studio/projects/{activeProjMeta?.id ? `${activeProjMeta.id.slice(0, 16)}…` : 'storage'}</code>. All edits auto-save to disk and persist across restarts.
          </p>
        </div>

        <div className="rt-card">
          <div className="rt-macro-section-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Target size={16} color="var(--rt-border-strong)" />
              <h3 style={{ margin: 0, fontSize: 15 }}>System Intent & Engineering Brief</h3>
            </div>
            <button
              type="button"
              className="rt-btn primary"
              onClick={() => setUIState({ macroStage: 'architecture' })}
            >
              Open Architecture Canvas →
            </button>
          </div>
          <p className="rt-macro-help">
            Capture mission goals, operating context, and verification criteria before materializing
            concrete <code>.rossystem</code> and <code>.ros2</code> artifacts.
          </p>

          <div className="rt-macro-grid-2">
            <div className="rt-form-group">
              <label className="rt-form-label">Mission Purpose / Goal</label>
              <textarea
                className="rt-input rt-textarea"
                rows={3}
                placeholder="Describe what the robotic system must accomplish..."
                value={brief.purpose ?? brief.goal ?? ''}
                onChange={(e) => updateBrief('purpose', e.target.value)}
              />
            </div>
            <div className="rt-form-group">
              <label className="rt-form-label">Operating Context & Environment</label>
              <textarea
                className="rt-input rt-textarea"
                rows={3}
                placeholder="Indoor warehouse, ROS 2 Humble, mobile manipulator, safety envelope..."
                value={brief.environment ?? brief.context ?? ''}
                onChange={(e) => updateBrief('environment', e.target.value)}
              />
            </div>
          </div>

          <div className="rt-macro-grid-2" style={{ marginTop: 10 }}>
            <div className="rt-form-group">
              <label className="rt-form-label">Architectural & Real-Time Constraints</label>
              <input
                className="rt-input"
                placeholder="e.g., 20 Hz control loop, zero dynamic topic names in safety path..."
                value={brief.constraints || ''}
                onChange={(e) => updateBrief('constraints', e.target.value)}
              />
            </div>
            <div className="rt-form-group">
              <label className="rt-form-label">Acceptance Summary</label>
              <input
                className="rt-input"
                placeholder="High-level mission acceptance gate..."
                value={brief.acceptance || ''}
                onChange={(e) => updateBrief('acceptance', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="rt-macro-grid-2">
          {/* Acceptance Criteria */}
          <div className="rt-card">
            <div className="rt-macro-section-hdr">
              <h4 style={{ margin: 0, fontSize: 13.5 }}>Acceptance Criteria ({criteria.length})</h4>
              <button
                type="button"
                className="rt-btn"
                onClick={() =>
                  mutateProject((proj) => {
                    if (!proj.studio) proj.studio = {};
                    if (!Array.isArray(proj.studio.criteria)) proj.studio.criteria = [];
                    proj.studio.criteria.push({
                      id: `crit_${Date.now()}`,
                      statement: 'System passes Xtext LSP grammar & port compatibility checks',
                      verification: 'check',
                    });
                  })
                }
              >
                <Plus size={12} /> Add Criterion
              </button>
            </div>
            {criteria.length === 0 ? (
              <div className="rt-empty-state" style={{ padding: 18 }}>
                No acceptance criteria recorded yet.
              </div>
            ) : (
              criteria.map((c, idx) => (
                <div key={c.id || idx} className="rt-macro-list-row">
                  <input
                    className="rt-input"
                    value={c.statement || c.text || ''}
                    placeholder="Acceptance criterion statement..."
                    onChange={(e) => {
                      const val = e.target.value;
                      mutateProject((proj) => {
                        const target = proj.studio?.criteria?.[idx];
                        if (target) target.statement = val;
                      });
                    }}
                  />
                  <button
                    type="button"
                    className="rt-btn icon-only subtle"
                    title="Remove criterion"
                    onClick={() =>
                      mutateProject((proj) => {
                        proj.studio.criteria.splice(idx, 1);
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Expected Behaviors */}
          <div className="rt-card">
            <div className="rt-macro-section-hdr">
              <h4 style={{ margin: 0, fontSize: 13.5 }}>High-Level Behaviors ({behaviors.length})</h4>
              <button
                type="button"
                className="rt-btn"
                onClick={() =>
                  mutateProject((proj) => {
                    if (!proj.studio) proj.studio = {};
                    if (!Array.isArray(proj.studio.behavior)) proj.studio.behavior = [];
                    proj.studio.behavior.push({
                      id: `beh_${Date.now()}`,
                      name: `Behavior ${proj.studio.behavior.length + 1}`,
                      trigger: '',
                      response: '',
                    });
                  })
                }
              >
                <Plus size={12} /> Add Behavior
              </button>
            </div>
            {behaviors.length === 0 ? (
              <div className="rt-empty-state" style={{ padding: 18 }}>
                No behavioral flows specified yet.
              </div>
            ) : (
              behaviors.map((b, idx) => (
                <div key={b.id || idx} className="rt-macro-list-row">
                  <input
                    className="rt-input"
                    style={{ maxWidth: 160 }}
                    value={b.name || ''}
                    placeholder="Behavior name"
                    onChange={(e) => {
                      const val = e.target.value;
                      mutateProject((proj) => {
                        const target = proj.studio?.behavior?.[idx];
                        if (target) target.name = val;
                      });
                    }}
                  />
                  <input
                    className="rt-input"
                    value={b.response || b.description || ''}
                    placeholder="Trigger -> expected system response..."
                    onChange={(e) => {
                      const val = e.target.value;
                      mutateProject((proj) => {
                        const target = proj.studio?.behavior?.[idx];
                        if (target) target.response = val;
                      });
                    }}
                  />
                  <button
                    type="button"
                    className="rt-btn icon-only subtle"
                    title="Remove behavior"
                    onClick={() =>
                      mutateProject((proj) => {
                        proj.studio.behavior.splice(idx, 1);
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* System Pipeline Architecture Coverage */}
        <div className="rt-card">
          <h4 style={{ margin: '0 0 10px', fontSize: 13.5 }}>
            System Pipeline Architecture Coverage ({nodes.length} placed nodes)
          </h4>
          <div className="rt-macro-role-grid">
            {PIPELINE_ROLE_KEYS.map((roleKey) => {
              const meta = PIPELINE_ROLES[roleKey];
              const count = roleCounts[roleKey] || 0;
              return (
                <div
                  key={roleKey}
                  className="rt-macro-role-tile"
                  style={{ borderColor: count > 0 ? meta.color : 'var(--rt-border)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: meta.color,
                      }}
                    >
                      {meta.label}
                    </span>
                    <span className="rt-badge" style={{ background: meta.bg, color: meta.color }}>
                      {count}
                    </span>
                  </div>
                  <small style={{ color: 'var(--rt-muted)', fontSize: 11, display: 'block', marginTop: 4 }}>
                    {meta.description}
                  </small>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MacroPackagesView() {
  const { nodeIndex, typeIndex, macroSources, macroBusy } = useStudio();
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBranch, setRepoBranch] = useState('main');

  const nodeCount = Object.keys(nodeIndex?.nodes || {}).length;
  const sysCount = Object.keys(nodeIndex?._systems || {}).length;
  const typeCount = Object.keys(typeIndex?.types || {}).length;

  return (
    <div className="rt-macro-stage-scroll">
      <div className="rt-macro-container">
        <div className="rt-card">
          <div className="rt-macro-section-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Package size={16} color="var(--rt-border-strong)" />
              <h3 style={{ margin: 0, fontSize: 15 }}>Shared RosTooling Catalogue (~/.rostooling/catalogue_repos)</h3>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="rt-btn"
                onClick={() => {
                  hostBridge.pullCatalogue();
                  showToast('Syncing RosModelsCatalog & RosCommonObjects from GitHub...');
                }}
              >
                <RefreshCw size={13} /> Sync GitHub Catalogues
              </button>
              <button
                type="button"
                className="rt-btn primary"
                onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'nodes' })}
              >
                <BookOpen size={13} /> Browse & Add Components
              </button>
            </div>
          </div>
          <p className="rt-macro-help">
            Single source of truth shared between the Model Studio and RosTooling Studio daemon.
            Select multiple components in the Catalogue Drawer and click <strong>Add &amp; Connect</strong> to
            place and auto-wire them into Stage 3 Architecture.
          </p>

          <div className="rt-macro-stats-row">
            <div className="rt-macro-stat-box">
              <strong>{nodeCount}</strong>
              <span>Component Nodes (.ros2)</span>
            </div>
            <div className="rt-macro-stat-box">
              <strong>{sysCount}</strong>
              <span>Subsystems (.rossystem)</span>
            </div>
            <div className="rt-macro-stat-box">
              <strong>{typeCount}</strong>
              <span>Interface Specs (.ros)</span>
            </div>
          </div>
        </div>

        <div className="rt-macro-grid-2">
          <div className="rt-card">
            <div className="rt-macro-section-hdr">
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <GitBranch size={15} />
                <h4 style={{ margin: 0, fontSize: 13.5 }}>Clone ROS 2 Source Repository</h4>
              </div>
            </div>
            <p className="rt-macro-help">
              Fetch an external ROS 2 Git repository into the active Studio project for contract extraction.
            </p>
            <div className="rt-form-group">
              <label className="rt-form-label">Git URL</label>
              <input
                className="rt-input"
                placeholder="https://github.com/ros-navigation/navigation2.git"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
            </div>
            <div className="rt-form-group" style={{ marginTop: 8 }}>
              <label className="rt-form-label">Branch / Tag</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="rt-input"
                  placeholder="main"
                  value={repoBranch}
                  onChange={(e) => setRepoBranch(e.target.value)}
                />
                <button
                  type="button"
                  className="rt-btn primary"
                  disabled={!repoUrl.trim() || macroBusy}
                  onClick={() => hostBridge.macroFetchRepository(repoUrl.trim(), repoBranch.trim())}
                >
                  Fetch Repo
                </button>
              </div>
            </div>
          </div>

          <div className="rt-card">
            <div className="rt-macro-section-hdr">
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <FolderSearch size={15} />
                <h4 style={{ margin: 0, fontSize: 13.5 }}>Workspace Source Discovery</h4>
              </div>
              <button
                type="button"
                className="rt-btn"
                disabled={macroBusy}
                onClick={() => hostBridge.macroInspectSources()}
              >
                Scan Project Sources
              </button>
            </div>
            <p className="rt-macro-help">
              Inspect <code>package.xml</code>, C++, Python, and launch files attached to this Studio project.
            </p>
            {macroSources ? (
              <pre className="rt-macro-pre">
                {JSON.stringify(macroSources.summary || macroSources, null, 2)}
              </pre>
            ) : (
              <div className="rt-empty-state" style={{ padding: 18 }}>
                Click &ldquo;Scan Project Sources&rdquo; to inspect repositories in this project.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MacroChecksView() {
  const { macroChecks, macroEvidence, macroBusy } = useStudio();

  return (
    <div className="rt-macro-stage-scroll">
      <div className="rt-macro-container">
        <div className="rt-card">
          <div className="rt-macro-section-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck size={16} color="var(--rt-ok)" />
              <h3 style={{ margin: 0, fontSize: 15 }}>Model Gate, RosModel Linter &amp; Xtext Oracle</h3>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="rt-btn"
                onClick={() => hostBridge.macroPreviewDraftDsl()}
              >
                <FileCode2 size={13} /> Preview Virtual Draft DSL
              </button>
              <button
                type="button"
                className="rt-btn primary"
                disabled={macroBusy}
                onClick={() => hostBridge.macroRunChecks()}
              >
                <Play size={13} /> {macroBusy ? 'Running Checks...' : 'Run All Checks'}
              </button>
            </div>
          </div>
          <p className="rt-macro-help">
            Validates the Macro architectural draft against <code>ros_studio.validate_project</code>,{' '}
            <code>rosmodel_lint.py</code> (RM001–RM020), and the real Java Xtext Language Server Oracle.
          </p>

          {macroChecks.length === 0 ? (
            <div className="rt-empty-state">
              Run checks to verify model completeness, RM010 quoting discipline, and Xtext grammar validity.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {macroChecks.map((chk, idx) => {
                const passed = chk.status === 'passed';
                const skipped = chk.status === 'not-run';
                return (
                  <div key={idx} className="rt-macro-check-row">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {passed ? (
                          <CheckCircle2 size={15} color="var(--rt-ok)" />
                        ) : skipped ? (
                          <AlertTriangle size={15} color="var(--rt-warn)" />
                        ) : (
                          <AlertCircle size={15} color="var(--rt-err)" />
                        )}
                        <strong>{chk.name}</strong>
                        {chk.tool && (
                          <code style={{ fontSize: 11, color: 'var(--rt-muted)' }}>{chk.tool}</code>
                        )}
                      </div>
                      <span
                        className={`rt-badge ${
                          passed ? 'status-ok' : skipped ? 'diag-warn' : 'diag-err'
                        }`}
                      >
                        {chk.status}
                      </span>
                    </div>
                    {Array.isArray(chk.diagnostics) && chk.diagnostics.length > 0 && (
                      <pre className="rt-macro-pre" style={{ marginTop: 8 }}>
                        {JSON.stringify(chk.diagnostics, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rt-card">
          <h4 style={{ margin: '0 0 10px', fontSize: 13.5 }}>
            Recorded Verification Evidence ({macroEvidence.length})
          </h4>
          {macroEvidence.length === 0 ? (
            <div className="rt-empty-state" style={{ padding: 18 }}>
              No verification evidence snapshots captured yet.
            </div>
          ) : (
            macroEvidence.slice(0, 10).map((ev) => (
              <div key={ev.id} className="rt-macro-list-row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{ev.label}</strong>
                  <small style={{ display: 'block', color: 'var(--rt-muted)' }}>
                    rev #{ev.revision} · {ev.capturedAt}
                  </small>
                </div>
                <span className={`rt-badge ${ev.stale ? 'diag-warn' : 'status-ok'}`}>
                  {ev.stale ? 'Stale' : 'Current'}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function MacroDeploymentView() {
  const { project, macroMcpStatus, macroMcpResult, macroBusy } = useStudio();
  const [targetDir, setTargetDir] = useState('');
  const [defaultLanguage, setDefaultLanguage] = useState('cpp');

  const units = project.studio?.deployment?.units || [];
  const nodes = project.nodes || [];

  return (
    <div className="rt-macro-stage-scroll">
      <div className="rt-macro-container">
        {/* Stage 5 MCP Codegen & Build Pipeline */}
        <div className="rt-card">
          <div className="rt-macro-section-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Rocket size={16} color="var(--rt-border-strong)" />
              <h3 style={{ margin: 0, fontSize: 15 }}>
                ROS 2 Codegen &amp; Colcon Build (Coupled to <code>rostooling-mcp</code>)
              </h3>
            </div>
            <span
              className={`rt-badge ${macroMcpStatus?.available ? 'status-ok' : 'diag-warn'}`}
            >
              {macroMcpStatus?.available ? 'rostooling-mcp Connected' : 'MCP Standby'}
            </span>
          </div>
          <p className="rt-macro-help">
            Executes headless Xtext validation, C++/Python ROS 2 node wrapper synthesis, launch/YAML
            system generation, and <code>colcon build</code> over stdio JSON-RPC while enforcing the{' '}
            <strong>Domain Logic Protection Shield</strong> (never overwriting existing{' '}
            <code>*Algorithm.hpp</code> or <code>*_logic.py</code>).
          </p>

          <div className="rt-macro-grid-2" style={{ marginBottom: 12 }}>
            <div className="rt-form-group">
              <label className="rt-form-label">Target ROS 2 Workspace Directory (optional override)</label>
              <input
                className="rt-input"
                placeholder="Defaults to active VS Code workspace folder"
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
              />
            </div>
            <div className="rt-form-group">
              <label className="rt-form-label">Default Wrapper Language</label>
              <select
                className="rt-select"
                style={{ width: '100%', height: 32 }}
                value={defaultLanguage}
                onChange={(e) => setDefaultLanguage(e.target.value)}
              >
                <option value="cpp">C++ (ament_cmake · *Algorithm.hpp)</option>
                <option value="python">Python (ament_python · *_logic.py)</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="rt-btn"
              disabled={macroBusy}
              onClick={() =>
                hostBridge.macroRunMcpStep('validate', {
                  ...(targetDir.trim() ? { workspaceDir: targetDir.trim() } : {}),
                })
              }
            >
              <ShieldCheck size={13} /> 1. Validate Models (MCP)
            </button>
            <button
              type="button"
              className="rt-btn primary"
              disabled={macroBusy}
              onClick={() =>
                hostBridge.macroRunMcpStep('wrappers', {
                  language: defaultLanguage,
                  ...(targetDir.trim() ? { workspaceDir: targetDir.trim() } : {}),
                })
              }
            >
              <FileCode2 size={13} /> 2. Generate ROS 2 Wrappers
            </button>
            <button
              type="button"
              className="rt-btn primary"
              disabled={macroBusy}
              onClick={() =>
                hostBridge.macroRunMcpStep('system', {
                  ...(targetDir.trim() ? { workspaceDir: targetDir.trim() } : {}),
                })
              }
            >
              <Cpu size={13} /> 3. Generate System Launch &amp; Config
            </button>
            <button
              type="button"
              className="rt-btn"
              disabled={macroBusy}
              onClick={() =>
                hostBridge.macroRunMcpStep('build', {
                  ...(targetDir.trim() ? { workspaceDir: targetDir.trim() } : {}),
                })
              }
            >
              <Play size={13} /> 4. Build Workspace (colcon)
            </button>
          </div>

          {macroMcpResult && (
            <div style={{ marginTop: 14 }}>
              {Array.isArray(macroMcpResult.protectedDomainFiles) &&
                macroMcpResult.protectedDomainFiles.length > 0 && (
                  <div className="rt-macro-shield-banner">
                    <ShieldCheck size={14} />
                    <span>
                      Domain Logic Protection Shield preserved{' '}
                      <strong>{macroMcpResult.protectedDomainFiles.length}</strong> user logic file(s)
                      unchanged.
                    </span>
                  </div>
                )}
              <pre className="rt-macro-pre" style={{ marginTop: 8 }}>
                {JSON.stringify(macroMcpResult, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Deployment Execution Units */}
        <div className="rt-card">
          <div className="rt-macro-section-hdr">
            <h4 style={{ margin: 0, fontSize: 13.5 }}>
              Deployment Execution Units ({units.length}) &amp; Node Allocation ({nodes.length} nodes)
            </h4>
            <button
              type="button"
              className="rt-btn"
              onClick={() =>
                mutateProject((proj) => {
                  if (!proj.studio) proj.studio = {};
                  if (!proj.studio.deployment) proj.studio.deployment = { units: [] };
                  if (!Array.isArray(proj.studio.deployment.units)) proj.studio.deployment.units = [];
                  proj.studio.deployment.units.push({
                    id: `unit_${Date.now()}`,
                    name: `compute_unit_${proj.studio.deployment.units.length + 1}`,
                    host: 'robot-ipc',
                    runtime: 'ros2-humble',
                  });
                })
              }
            >
              <Plus size={12} /> Add Execution Unit
            </button>
          </div>
          {units.length === 0 ? (
            <div className="rt-empty-state" style={{ padding: 18 }}>
              Add compute or container units here to track hardware/runtime allocation alongside ROS 2 code generation.
            </div>
          ) : (
            units.map((u, idx) => (
              <div key={u.id || idx} className="rt-macro-list-row">
                <input
                  className="rt-input"
                  value={u.name || ''}
                  placeholder="Unit name"
                  onChange={(e) => {
                    const val = e.target.value;
                    mutateProject((proj) => {
                      const target = proj.studio?.deployment?.units?.[idx];
                      if (target) target.name = val;
                    });
                  }}
                />
                <input
                  className="rt-input"
                  value={u.host || ''}
                  placeholder="Target host / container"
                  onChange={(e) => {
                    const val = e.target.value;
                    mutateProject((proj) => {
                      const target = proj.studio?.deployment?.units?.[idx];
                      if (target) target.host = val;
                    });
                  }}
                />
                <button
                  type="button"
                  className="rt-btn icon-only subtle"
                  onClick={() =>
                    mutateProject((proj) => {
                      proj.studio.deployment.units.splice(idx, 1);
                    })
                  }
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
