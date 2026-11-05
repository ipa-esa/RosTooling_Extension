import React, { useState, useEffect } from 'react';
import {
  Target,
  Package,
  ShieldCheck,
  Rocket,
  Plus,
  Trash2,
  Sparkles,
  Check,
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
  Bot,
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

export function buildIntentContext(project) {
  const p = project || {};
  const studio = p.studio || {};
  const brief = studio.brief || {};
  const criteria = Array.isArray(studio.criteria) ? studio.criteria : [];
  const behaviors = Array.isArray(studio.behavior) ? studio.behavior : [];

  const parts = [];
  const sysName = p.system?.name;
  if (sysName) {
    parts.push(`- **System Name**: ${sysName}`);
  }
  if (brief.purpose || brief.goal) {
    parts.push(`- **Mission Purpose / Goal**: ${brief.purpose || brief.goal}`);
  }
  if (brief.environment || brief.context) {
    parts.push(`- **Operating Environment & Platform**: ${brief.environment || brief.context}`);
  }
  if (brief.constraints) {
    parts.push(`- **Architectural & Real-Time Constraints**: ${brief.constraints}`);
  }
  if (brief.acceptance) {
    parts.push(`- **Acceptance Gate**: ${brief.acceptance}`);
  }
  if (criteria.length > 0) {
    const critList = criteria
      .map((c, i) => `  ${i + 1}. ${c.statement || c.name || ''} (Verification: ${c.verification || 'check'})`)
      .join('\n');
    parts.push(`- **Acceptance Criteria**:\n${critList}`);
  }
  if (behaviors.length > 0) {
    const behList = behaviors
      .map((b, i) => `  ${i + 1}. **${b.name || `Behavior ${i + 1}`}**: When \`${b.trigger || 'trigger'}\` -> Then \`${b.response || 'response'}\``)
      .join('\n');
    parts.push(`- **Target Behaviors & Operational Sequence**:\n${behList}`);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

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
                        hostBridge.macroDeleteProject(macroActiveProjectId);
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
  const { project, nodeIndex, typeIndex, macroSources, macroBusy, macroWorkspaceRoot, macroCustomScanPath } = useStudio();
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBranch, setRepoBranch] = useState('main');
  const [scanPath, setScanPath] = useState(macroCustomScanPath || macroWorkspaceRoot || '');

  const p = project || {};
  const studio = p.studio || {};
  const brief = studio.brief || {};
  const selectedPackages = Array.isArray(p.studio?.selectedPackages)
    ? p.studio.selectedPackages
    : Object.keys(p.packages || {}).map((name) => ({
        name,
        path: p.packages[name]?.path || '',
        buildType: p.packages[name]?.buildType || 'unknown',
      }));

  const copyIntentModelingPrompt = (targetPackages = null) => {
    const pkgs = macroSources?.packages || [];
    const pkgList = pkgs
      .map((pkg, i) => `${i + 1}. \`${pkg.name}\` (${pkg.path}) [${pkg.buildType}]`)
      .join('\n');
    const intentBlock = buildIntentContext(p);
    const isSpecific = Array.isArray(targetPackages) && targetPackages.length > 0;
    const targetNames = isSpecific ? targetPackages.map((s) => s.name).join(', ') : null;

    const promptText = `Please assist with ROS 2 system modeling using the \`ros-model\` and \`ros-modeler\` skills in .rostooling/active_project.json.

## 🎯 System Mission & Intent Context (from Stage 1 Intent)
${intentBlock || 'No detailed brief recorded in project.json. Please inspect .rostooling/active_project.json.'}

## 📦 Discovered Workspace Packages (${pkgs.length} found)
${pkgList || 'No packages discovered in workspace scan.'}

${targetNames ? `## 📌 Currently Selected Packages\n${targetNames}\n` : ''}
## 📋 Agent Instructions:
1. **Analyze Package Fit with Intent**:
   Review the Mission Purpose, Operating Environment, Constraints, Acceptance Criteria, and Target Behaviors above. Compare them against the discovered workspace packages. Determine which packages are relevant or required to achieve this robotic application (including perception, planning, control, manipulation, simulation, and hardware interfaces).
2. **Select & Suggest Packages**:
   In \`.rostooling/active_project.json\`, ensure \`studio.selectedPackages\` contains all packages required for this mission. If you recommend additional packages, explain why they are needed for specific mission behaviors.
3. **Extract & Author .ros2 Component Models**:
   For the selected packages, generate or update component models in \`models/<package_name>.ros2\` (and message specs in \`models/<package_name>.ros\`).
4. **Resolve Dynamic Topics & Parameters with Intent**:
   Use the System Intent context above to resolve any runtime-built topic/service/action names, gripper commands, or dynamic parameters to concrete mission-appropriate names and values rather than leaving unresolved flags.
5. **Verify**:
   Run \`rosmodel_lint.py\` to verify 0 errors. When complete, instruct the user to click **Reload** in RosTooling Studio to reconcile the models into Stage 3 Architecture.`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(promptText);
    }
    showToast(isSpecific ? 'Copied Intent-guided modeling prompt to clipboard' : 'Copied Intent package selection prompt to clipboard');
  };

  const isSelected = (pkgName) =>
    selectedPackages.some((sp) => sp.name === pkgName);

  const togglePackageSelection = (pkg) => {
    mutateProject((proj) => {
      if (!proj.studio) proj.studio = {};
      if (!Array.isArray(proj.studio.selectedPackages)) {
        proj.studio.selectedPackages = [];
      }
      if (!proj.packages) proj.packages = {};

      const existingIdx = proj.studio.selectedPackages.findIndex((sp) => sp.name === pkg.name);
      if (existingIdx >= 0) {
        proj.studio.selectedPackages.splice(existingIdx, 1);
        delete proj.packages[pkg.name];
      } else {
        proj.studio.selectedPackages.push({
          name: pkg.name,
          path: pkg.path,
          buildType: pkg.buildType,
        });
        proj.packages[pkg.name] = {
          path: pkg.path,
          buildType: pkg.buildType,
        };
      }
    });
  };

  const selectAllPackages = (allPkgs) => {
    mutateProject((proj) => {
      if (!proj.studio) proj.studio = {};
      if (!proj.packages) proj.packages = {};
      proj.studio.selectedPackages = allPkgs.map((pkg) => ({
        name: pkg.name,
        path: pkg.path,
        buildType: pkg.buildType,
      }));
      for (const pkg of allPkgs) {
        proj.packages[pkg.name] = {
          path: pkg.path,
          buildType: pkg.buildType,
        };
      }
    });
  };

  const deselectAllPackages = () => {
    mutateProject((proj) => {
      if (!proj.studio) proj.studio = {};
      proj.studio.selectedPackages = [];
      proj.packages = {};
    });
  };

  useEffect(() => {
    if (macroCustomScanPath) {
      setScanPath(macroCustomScanPath);
    } else if (!scanPath && macroWorkspaceRoot) {
      setScanPath(macroWorkspaceRoot);
    }
  }, [macroCustomScanPath, macroWorkspaceRoot]);

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="rt-btn subtle"
                  style={{ height: 26, fontSize: 11.5, padding: '0 8px', gap: 5 }}
                  title="Install AI Agent Skills & MCP server for Claude Code, Antigravity, and Cursor"
                  onClick={() => hostBridge.macroInstallAgentSkills()}
                >
                  <Bot size={13} /> Install Agent Skills...
                </button>
                <button
                  type="button"
                  className="rt-btn primary"
                  disabled={macroBusy}
                  onClick={() => hostBridge.macroInspectSources(scanPath.trim())}
                >
                  Scan Workspace Sources
                </button>
              </div>
            </div>
            <p className="rt-macro-help">
              Inspect <code>package.xml</code>, C++, Python, interfaces, and launch files in your active IDE workspace or a custom path.
            </p>
            <div className="rt-form-group" style={{ marginBottom: 12 }}>
              <label className="rt-form-label">Source Workspace Directory</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="rt-input"
                  placeholder={macroWorkspaceRoot || '/path/to/ros2_ws'}
                  value={scanPath}
                  onChange={(e) => setScanPath(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="rt-btn"
                  title="Browse local folder"
                  onClick={() => hostBridge.macroBrowseWorkspaceFolder()}
                >
                  Browse...
                </button>
                {macroWorkspaceRoot && scanPath !== macroWorkspaceRoot && (
                  <button
                    type="button"
                    className="rt-btn subtle"
                    title="Reset to currently open IDE workspace"
                    onClick={() => setScanPath(macroWorkspaceRoot)}
                  >
                    Use Open Workspace
                  </button>
                )}
              </div>
            </div>
            {macroSources ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--rt-muted)' }}>
                    Scanned root: <code>{macroSources.root}</code> ({macroSources.files?.length || 0} files)
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="rt-badge" style={{ background: 'rgba(59, 130, 246, 0.16)', color: 'var(--rt-accent, #3b82f6)' }}>
                      {macroSources.packages?.length || 0} packages found
                    </span>
                    <span
                      className="rt-badge"
                      style={{
                        background: selectedPackages.length > 0 ? 'rgba(34, 197, 94, 0.16)' : 'var(--rt-surface-accent)',
                        color: selectedPackages.length > 0 ? '#22c55e' : 'var(--rt-muted)',
                        fontWeight: 600,
                      }}
                    >
                      {selectedPackages.length} selected for modeling
                    </span>
                  </div>
                </div>

                {Array.isArray(macroSources.packages) && macroSources.packages.length > 0 ? (
                  <div style={{ marginBottom: 14 }}>
                    {/* Stage 1 Intent Summary Banner */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        marginBottom: 10,
                        background: 'rgba(59, 130, 246, 0.06)',
                        border: '1px solid rgba(59, 130, 246, 0.25)',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                        <Target size={15} color="var(--rt-accent, #3b82f6)" style={{ flexShrink: 0 }} />
                        <div style={{ overflow: 'hidden' }}>
                          <span style={{ fontWeight: 600, color: 'var(--rt-accent, #3b82f6)' }}>Stage 1 Intent Context: </span>
                          <span style={{ color: 'var(--rt-text)' }}>
                            {brief.purpose || brief.goal || 'No mission goal recorded in Stage 1 yet.'}
                          </span>
                          {(brief.environment || brief.constraints) && (
                            <span style={{ color: 'var(--rt-muted)', marginLeft: 8, fontSize: 11 }}>
                              ({[brief.environment, brief.constraints].filter(Boolean).join(' • ')})
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rt-btn subtle"
                        style={{ height: 22, fontSize: 11, padding: '0 8px', flexShrink: 0 }}
                        onClick={() => setUIState({ macroStage: 'intent' })}
                      >
                        Edit Intent →
                      </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--rt-text)' }}>
                        Select packages for the agent to model in Stage 3 Architecture:
                      </span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                          type="button"
                          className="rt-btn subtle"
                          style={{ height: 22, fontSize: 11, padding: '0 8px', gap: 4, color: 'var(--rt-accent, #3b82f6)' }}
                          title="Copy prompt asking the agent to evaluate workspace packages against Intent and automatically select/model them"
                          onClick={() => copyIntentModelingPrompt(null)}
                        >
                          <Sparkles size={11} /> AI Auto-Select from Intent
                        </button>
                        <button
                          type="button"
                          className="rt-btn subtle"
                          style={{ height: 22, fontSize: 11, padding: '0 6px' }}
                          onClick={() => selectAllPackages(macroSources.packages)}
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          className="rt-btn subtle"
                          style={{ height: 22, fontSize: 11, padding: '0 6px' }}
                          onClick={deselectAllPackages}
                        >
                          Deselect All
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
                      {macroSources.packages.map((pkg) => {
                        const checked = isSelected(pkg.name);
                        return (
                          <div
                            key={pkg.name}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '7px 10px',
                              borderRadius: 5,
                              background: checked ? 'rgba(59, 130, 246, 0.08)' : 'var(--rt-surface-accent, #23272e)',
                              border: `1px solid ${checked ? 'var(--rt-accent, #3b82f6)' : 'var(--rt-border, #333)'}`,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                            onClick={() => togglePackageSelection(pkg)}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {}} // handled by parent onClick
                                style={{ cursor: 'pointer' }}
                              />
                              <div>
                                <span style={{ fontWeight: 600, fontSize: 13, color: checked ? 'var(--rt-accent, #3b82f6)' : 'var(--rt-text)' }}>
                                  {pkg.name}
                                </span>
                                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--rt-muted)' }}>
                                  {pkg.path}
                                </span>
                              </div>
                            </div>
                            <span className="rt-badge" style={{ fontSize: 11 }}>
                              {pkg.buildType}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rt-empty-state" style={{ padding: 12, marginBottom: 12 }}>
                    No packages with <code>package.xml</code> were found in the scanned path.
                  </div>
                )}

                {/* Selected Packages Agentic Context Banner */}
                {selectedPackages.length > 0 && (
                  <div
                    style={{
                      background: 'rgba(34, 197, 94, 0.08)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      borderRadius: 6,
                      padding: '10px 14px',
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12.5, color: '#22c55e' }}>
                        <Sparkles size={14} />
                        <span>Ready for Agentic Modeling ({selectedPackages.length} package{selectedPackages.length > 1 ? 's' : ''} selected)</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          className="rt-btn subtle"
                          style={{ height: 24, fontSize: 11, padding: '0 8px', gap: 4 }}
                          title="Copy a prompt with Intent context for the agent to model these packages"
                          onClick={() => copyIntentModelingPrompt(selectedPackages)}
                        >
                          <Sparkles size={12} /> Copy Agent Prompt
                        </button>
                        <button
                          type="button"
                          className="rt-btn subtle"
                          style={{ height: 24, fontSize: 11, padding: '0 8px', gap: 4 }}
                          title="Install AI agent skills for Claude Code, Antigravity, Cursor, and configure MCP"
                          onClick={() => hostBridge.macroInstallAgentSkills()}
                        >
                          <Bot size={12} /> Install Agent Skills...
                        </button>
                        <button
                          type="button"
                          className="rt-btn primary"
                          disabled={macroBusy || selectedPackages.length === 0}
                          style={{ height: 24, fontSize: 11, padding: '0 10px', gap: 5 }}
                          title="Extract AST models (.ros2 and .ros) for selected packages and load into Stage 3 Architecture"
                          onClick={() => hostBridge.macroExtractSelectedPackages(selectedPackages)}
                        >
                          <Sparkles size={12} />
                          {macroBusy ? 'Extracting Models...' : 'Extract Models for Architecture'}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--rt-muted)', marginBottom: 6 }}>
                      Click <strong>Extract Models for Architecture</strong> to automatically extract AST component models (<code>.ros2</code>) and message specs (<code>.ros</code>) and populate Stage 3 Architecture, or copy the prompt to have the agent customize them.
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {selectedPackages.map((sp) => (
                        <span
                          key={sp.name}
                          className="rt-badge"
                          style={{
                            background: 'rgba(34, 197, 94, 0.16)',
                            color: '#22c55e',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Check size={11} /> {sp.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {Array.isArray(macroSources.launchFiles) && macroSources.launchFiles.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--rt-muted)', marginBottom: 8 }}>
                    <strong>Launch files ({macroSources.launchFiles.length}):</strong> {macroSources.launchFiles.slice(0, 5).join(', ')}
                    {macroSources.launchFiles.length > 5 ? ` +${macroSources.launchFiles.length - 5} more` : ''}
                  </div>
                )}
                <pre className="rt-macro-pre" style={{ maxHeight: 150, overflowY: 'auto' }}>
                  {JSON.stringify(macroSources.summary || macroSources, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="rt-empty-state" style={{ padding: 18 }}>
                Click &ldquo;Scan Workspace Sources&rdquo; to discover ROS packages and launch files in the workspace.
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
