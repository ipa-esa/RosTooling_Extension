import React, { useMemo } from 'react';
import {
  Box,
  Plus,
  Trash2,
  Copy,
  Activity,
  Sliders,
  Settings2,
  RotateCcw,
  Braces,
  FileCode2,
} from 'lucide-react';
import {
  useStudio,
  setUIState,
  mutateProject,
  syncPackagesFromNodes,
  getDisplayModelName,
  KIND_ORDER,
  KIND_META,
  SRC_SIDE,
  LIFECYCLE_STATES,
  PARAM_TYPES,
  QOS_PROFILES,
} from '../state/studioStore';
import { hostBridge } from '../state/vscodeBridge';

export function createNewComponentNode(project, docFileName) {
  const pkgName = getDisplayModelName(project, 'component', docFileName);
  let idx = (project.nodes || []).length + 1;
  let label = `node_${idx}`;
  while ((project.nodes || []).some((n) => n.label === label)) {
    idx += 1;
    label = `node_${idx}`;
  }
  return {
    id: `n_${label}_${Date.now().toString(36)}`,
    label,
    pkg: pkgName,
    artifact: label,
    from: `${pkgName}.${label}`,
    isLifecycle: false,
    backing: 'local',
    ifaces: [],
    params: [],
  };
}

export function RosComponentView() {
  const studio = useStudio();
  const { project, isReadOnly, docFileName, selectedNodeId, interfaceFilter, typeIndex } = studio;

  const nodes = (project.nodes || []).filter((n) => n.backing !== 'type');
  const activeNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0] || null;
  const pkgName = getDisplayModelName(project, 'component', docFileName);
  const pkgObj =
    project.packages?.[pkgName] || Object.values(project.packages || {})[0] || { name: pkgName };

  // Build categorized type lists from typeIndex + project.types for fast autocomplete
  const typesByFamily = useMemo(() => {
    const map = { Topic: [], Service: [], Action: [] };
    const raw = typeIndex?.types || {};
    for (const [k, info] of Object.entries(raw)) {
      const cat = info?.category || info?.kind || (k.includes('/srv/') ? 'srv' : k.includes('/action/') ? 'action' : 'msg');
      if (cat === 'srv') map.Service.push(k);
      else if (cat === 'action') map.Action.push(k);
      else map.Topic.push(k);
    }
    for (const spec of Object.values(project.types || {})) {
      if (!spec?.name) continue;
      const full = `${spec.pkg || pkgName}/${spec.category || 'msg'}/${spec.name}`;
      if (spec.category === 'srv') map.Service.push(full);
      else if (spec.category === 'action') map.Action.push(full);
      else map.Topic.push(full);
    }
    return map;
  }, [typeIndex, project.types, pkgName]);

  const handleAddNode = () => {
    if (isReadOnly) return;
    let newId = null;
    mutateProject((proj) => {
      const created = createNewComponentNode(proj, docFileName);
      newId = created.id;
      if (!proj.nodes) proj.nodes = [];
      proj.nodes.push(created);
      syncPackagesFromNodes(proj, pkgName);
    });
    if (newId) setUIState({ selectedNodeId: newId });
  };

  const handleAddInterface = (kind) => {
    if (isReadOnly || !activeNode) return;
    mutateProject((proj) => {
      const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
      if (!n) return;
      if (!n.ifaces) n.ifaces = [];
      let idx = n.ifaces.length + 1;
      const prefix = kind === 'pub' || kind === 'sub' ? 'topic' : kind === 'ss' || kind === 'sc' ? 'service' : 'action';
      let name = `${prefix}_${idx}`;
      while (n.ifaces.some((f) => f.name === name)) {
        idx += 1;
        name = `${prefix}_${idx}`;
      }
      const defaultType =
        kind === 'pub' || kind === 'sub'
          ? 'std_msgs/msg/String'
          : kind === 'ss' || kind === 'sc'
          ? 'std_srvs/srv/Trigger'
          : 'action_tutorials_interfaces/action/Fibonacci';

      n.ifaces.push({
        id: `i_${n.artifact || n.label}_${name}_${Date.now().toString(36)}`,
        name,
        label: name,
        kind,
        type: defaultType,
        exposed: true,
      });
      syncPackagesFromNodes(proj);
    });
  };

  const handleAddParameter = () => {
    if (isReadOnly || !activeNode) return;
    mutateProject((proj) => {
      const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
      if (!n) return;
      if (!n.params) n.params = [];
      let idx = n.params.length + 1;
      let pName = `param_${idx}`;
      while (n.params.some((p) => p.name === pName)) {
        idx += 1;
        pName = `param_${idx}`;
      }
      n.params.push({
        id: `p_${n.artifact || n.label}_${pName}_${Date.now().toString(36)}`,
        name: pName,
        label: pName,
        ptype: 'String',
        value: '',
        exposed: true,
      });
      syncPackagesFromNodes(proj);
    });
  };

  return (
    <div className="rt-comp-layout">
      {/* Left Sidebar: Package Metadata + Artifacts List */}
      <aside className="rt-sidebar-left">
        <div className="rt-panel-pad">
          <div className="rt-section-hdr">
            <h2>Package Metadata</h2>
          </div>

          <div className="rt-field">
            <label>Ament Package Name</label>
            <input
              className="rt-input"
              disabled={isReadOnly}
              value={pkgName}
              onChange={(e) => {
                const nextPkg = e.target.value;
                mutateProject((proj) => {
                  syncPackagesFromNodes(proj, nextPkg);
                });
              }}
            />
          </div>

          <div className="rt-field">
            <label>Git Repository (`fromGitRepo`)</label>
            <input
              className="rt-input"
              disabled={isReadOnly}
              placeholder="https://github.com/org/repo.git"
              value={pkgObj.fromGitRepo || ''}
              onChange={(e) => {
                const repoUrl = e.target.value;
                mutateProject((proj) => {
                  syncPackagesFromNodes(proj, pkgName);
                  const p = proj.packages?.[pkgName] || Object.values(proj.packages || {})[0];
                  if (p) {
                    if (repoUrl.trim()) p.fromGitRepo = repoUrl.trim();
                    else delete p.fromGitRepo;
                  }
                });
              }}
            />
          </div>

          <div className="rt-section-hdr">
            <h3>Component Nodes ({nodes.length})</h3>
            {!isReadOnly && (
              <button
                type="button"
                className="rt-btn primary"
                onClick={handleAddNode}
              >
                <Plus size={12} /> New
              </button>
            )}
          </div>

          {nodes.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>
              No artifacts defined in this `.ros2` package yet.
            </p>
          ) : (
            nodes.map((n) => {
              const isSelected = activeNode?.id === n.id;
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`rt-node-list-item ${isSelected ? 'active' : ''}`}
                  onClick={() => setUIState({ selectedNodeId: n.id })}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 12.5 }}>{n.label}</strong>
                    <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', fontSize: 10.5 }}>
                      exec: {n.artifact || n.label} · {(n.ifaces || []).length} ports
                    </small>
                  </div>
                  {n.isLifecycle && (
                    <span className="rt-badge lifecycle" title="LifecycleNode">
                      LC
                    </span>
                  )}
                </button>
              );
            })
          )}

          {nodes.length > 0 && (
            <button
              type="button"
              className="rt-btn"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => hostBridge.generateWrappers(nodes.map((n) => n.label))}
            >
              <FileCode2 size={14} /> Generate ROS 2 Wrappers
            </button>
          )}
        </div>
      </aside>

      {/* Main Contract Authoring Area */}
      <main className="rt-comp-main">
        <div className="rt-comp-container">
          {!activeNode ? (
            <div className="rt-empty-state">
              <Box size={32} style={{ color: '#34d399', marginBottom: 10 }} />
              <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Author a ROS 2 Node Contract</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13 }}>
                Define executables, publishers, subscribers, services, actions, QoS policies, lifecycle states, and parameters.
              </p>
              {!isReadOnly && (
                <button type="button" className="rt-btn primary" onClick={handleAddNode}>
                  <Plus size={14} /> Add New Node
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Visual Contract Schematic Preview */}
              <div className="rt-card" style={{ background: 'var(--rt-surface-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Box size={20} style={{ color: '#34d399' }} />
                    <div>
                      <h2 style={{ margin: 0, fontSize: 16 }}>
                        {pkgName}.{activeNode.label}
                      </h2>
                      <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
                        artifact: {activeNode.artifact || activeNode.label}
                        {activeNode.namespace ? ` · ns: ${activeNode.namespace}` : ''}
                      </small>
                    </div>
                    {activeNode.isLifecycle && (
                      <span className="rt-badge lifecycle">
                        <Activity size={11} /> LifecycleNode
                      </span>
                    )}
                  </div>

                  {!isReadOnly && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="rt-btn"
                        title="Duplicate Node Contract"
                        onClick={() => {
                          let dupId = null;
                          mutateProject((proj) => {
                            const copy = JSON.parse(JSON.stringify(activeNode));
                            copy.id = `n_${copy.label}_copy_${Date.now().toString(36)}`;
                            copy.label = `${copy.label}_copy`;
                            copy.artifact = `${copy.artifact || activeNode.label}_copy`;
                            dupId = copy.id;
                            proj.nodes.push(copy);
                            syncPackagesFromNodes(proj, pkgName);
                          });
                          if (dupId) setUIState({ selectedNodeId: dupId });
                        }}
                      >
                        <Copy size={13} /> Duplicate
                      </button>
                      <button
                        type="button"
                        className="rt-btn danger"
                        title="Delete Node Contract"
                        onClick={() => {
                          mutateProject((proj) => {
                            proj.nodes = (proj.nodes || []).filter((n) => n.id !== activeNode.id);
                            syncPackagesFromNodes(proj, pkgName);
                          });
                          setUIState({ selectedNodeId: null });
                        }}
                      >
                        <Trash2 size={13} /> Delete Node
                      </button>
                    </div>
                  )}
                </div>

                {/* Live Two-Column Port Diagram */}
                <div className="rt-grid-2">
                  <div style={{ padding: 10, borderRadius: 6, background: 'var(--rt-surface)', border: '1px solid var(--rt-border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--rt-muted)', marginBottom: 6 }}>
                      INPUT PORTS (SUB / SC / AC)
                    </div>
                    {(activeNode.ifaces || []).filter((f) => SRC_SIDE[f.kind] === false).length === 0 ? (
                      <small style={{ color: 'var(--rt-dim)' }}>No input ports</small>
                    ) : (
                      (activeNode.ifaces || [])
                        .filter((f) => SRC_SIDE[f.kind] === false)
                        .map((f) => (
                          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12 }}>
                            <span className={`rt-port-kind ${f.kind}`}>{KIND_META[f.kind]?.short || f.kind}</span>
                            <strong style={{ fontWeight: 600 }}>{f.name}</strong>
                            <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', marginLeft: 'auto' }}>
                              {(f.type || '').split('/').pop() || 'untyped'}
                            </small>
                          </div>
                        ))
                    )}
                  </div>
                  <div style={{ padding: 10, borderRadius: 6, background: 'var(--rt-surface)', border: '1px solid var(--rt-border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--rt-muted)', marginBottom: 6 }}>
                      OUTPUT PORTS (PUB / SS / AS)
                    </div>
                    {(activeNode.ifaces || []).filter((f) => SRC_SIDE[f.kind] === true).length === 0 ? (
                      <small style={{ color: 'var(--rt-dim)' }}>No output ports</small>
                    ) : (
                      (activeNode.ifaces || [])
                        .filter((f) => SRC_SIDE[f.kind] === true)
                        .map((f) => (
                          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12 }}>
                            <span className={`rt-port-kind ${f.kind}`}>{KIND_META[f.kind]?.short || f.kind}</span>
                            <strong style={{ fontWeight: 600 }}>{f.name}</strong>
                            <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', marginLeft: 'auto' }}>
                              {(f.type || '').split('/').pop() || 'untyped'}
                            </small>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              </div>

              {/* 1. Node Identity & Lifecycle Configuration */}
              <div className="rt-card">
                <div className="rt-section-hdr">
                  <h3>Node Identity & Lifecycle</h3>
                </div>
                <div className="rt-grid-2">
                  <div className="rt-field">
                    <label>ROS Node Name (`node`)</label>
                    <input
                      className="rt-input"
                      disabled={isReadOnly}
                      value={activeNode.label}
                      onChange={(e) => {
                        const val = e.target.value;
                        mutateProject((proj) => {
                          const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                          if (n) {
                            const prevLabel = n.label;
                            n.label = val;
                            if (!n.artifact || n.artifact === prevLabel) {
                              n.artifact = val;
                            }
                            syncPackagesFromNodes(proj, pkgName);
                          }
                        });
                      }}
                    />
                  </div>
                  <div className="rt-field">
                    <label>Artifact / Executable Name (`artifacts`)</label>
                    <input
                      className="rt-input"
                      disabled={isReadOnly}
                      value={activeNode.artifact || activeNode.label}
                      onChange={(e) => {
                        const val = e.target.value;
                        mutateProject((proj) => {
                          const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                          if (n) {
                            n.artifact = val;
                            syncPackagesFromNodes(proj, pkgName);
                          }
                        });
                      }}
                    />
                  </div>
                </div>

                <div className="rt-grid-2" style={{ alignItems: 'center' }}>
                  <div className="rt-field" style={{ marginBottom: 0 }}>
                    <label>Default Namespace (Optional)</label>
                    <input
                      className="rt-input"
                      disabled={isReadOnly}
                      placeholder="/sensor_ns"
                      value={activeNode.namespace || ''}
                      onChange={(e) => {
                        const ns = e.target.value;
                        mutateProject((proj) => {
                          const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                          if (n) n.namespace = ns || undefined;
                        });
                      }}
                    />
                  </div>

                  <div style={{ paddingTop: 14 }}>
                    <label className="rt-checkbox-row" style={{ fontWeight: 600 }}>
                      <input
                        type="checkbox"
                        disabled={isReadOnly}
                        checked={Boolean(activeNode.isLifecycle)}
                        onChange={(e) => {
                          const lc = e.target.checked;
                          mutateProject((proj) => {
                            const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                            if (n) {
                              n.isLifecycle = lc;
                              if (!lc) {
                                for (const f of n.ifaces || []) {
                                  delete f.activeStates;
                                }
                              }
                              syncPackagesFromNodes(proj, pkgName);
                            }
                          });
                        }}
                      />
                      <Activity size={14} style={{ color: 'var(--rt-lifecycle)' }} />
                      <span>Managed ROS 2 `LifecycleNode` (`lifecycle: true`)</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* 2. Interfaces Contract Editor */}
              <div className="rt-card">
                <div className="rt-section-hdr">
                  <h3>
                    Interfaces ({(activeNode.ifaces || []).length})
                  </h3>
                  <button
                    type="button"
                    className="rt-btn subtle"
                    onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'types' })}
                  >
                    <Braces size={13} /> Browse ROS Types
                  </button>
                </div>

                {!isReadOnly && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {KIND_ORDER.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="rt-btn"
                        onClick={() => handleAddInterface(k)}
                      >
                        <Plus size={12} style={{ color: KIND_META[k].color }} /> {KIND_META[k].label}
                      </button>
                    ))}
                  </div>
                )}

                {['Topic', 'Service', 'Action'].map((fam) => (
                  <datalist key={fam} id={`rt-types-${fam}`}>
                    {(typesByFamily[fam] || []).map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                ))}

                {(activeNode.ifaces || [])
                  .filter((f) => interfaceFilter === 'all' || f.kind === interfaceFilter)
                  .map((iface) => {
                    const meta = KIND_META[iface.kind] || KIND_META.pub;
                    const qos = iface.qos || {};
                    const hasQos = Object.values(qos).some((v) => v != null && String(v).trim() !== '');
                    const activeStates = iface.activeStates || [];

                    return (
                      <div key={iface.id} className="rt-iface-card">
                        <div className="rt-iface-top">
                          <select
                            className="rt-select"
                            disabled={isReadOnly}
                            value={iface.kind}
                            onChange={(e) => {
                              const nextKind = e.target.value;
                              mutateProject((proj) => {
                                const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                if (f) {
                                  f.kind = nextKind;
                                  syncPackagesFromNodes(proj, pkgName);
                                }
                              });
                            }}
                          >
                            {KIND_ORDER.map((k) => (
                              <option key={k} value={k}>
                                {KIND_META[k].short} — {KIND_META[k].label}
                              </option>
                            ))}
                          </select>

                          <input
                            className="rt-input"
                            disabled={isReadOnly}
                            placeholder="Interface name (e.g. cmd_vel)"
                            value={iface.name}
                            onChange={(e) => {
                              const nextName = e.target.value;
                              mutateProject((proj) => {
                                const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                if (f) {
                                  f.name = nextName;
                                  f.label = nextName;
                                  syncPackagesFromNodes(proj, pkgName);
                                }
                              });
                            }}
                          />

                          <input
                            className="rt-input"
                            disabled={isReadOnly}
                            list={`rt-types-${meta.family}`}
                            placeholder={
                              meta.family === 'Service'
                                ? 'pkg/srv/ServiceType'
                                : meta.family === 'Action'
                                ? 'pkg/action/ActionType'
                                : 'pkg/msg/MessageType'
                            }
                            value={iface.type || ''}
                            onChange={(e) => {
                              const nextType = e.target.value;
                              mutateProject((proj) => {
                                const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                if (f) {
                                  f.type = nextType;
                                  syncPackagesFromNodes(proj, pkgName);
                                }
                              });
                            }}
                          />

                          {!isReadOnly && (
                            <button
                              type="button"
                              className="rt-btn danger icon-only"
                              title="Delete Interface"
                              onClick={() => {
                                mutateProject((proj) => {
                                  const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                  if (n) {
                                    n.ifaces = (n.ifaces || []).filter((x) => x.id !== iface.id);
                                    syncPackagesFromNodes(proj, pkgName);
                                  }
                                });
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                        {/* Per-interface Lifecycle activeStates */}
                        {activeNode.isLifecycle && (
                          <div className="rt-lifecycle-states">
                            <strong style={{ color: 'var(--rt-lifecycle)' }}>Active Lifecycle States:</strong>
                            {LIFECYCLE_STATES.map((st) => {
                              const checked = activeStates.includes(st);
                              return (
                                <label key={st} className="rt-checkbox-row">
                                  <input
                                    type="checkbox"
                                    disabled={isReadOnly}
                                    checked={checked}
                                    onChange={(e) => {
                                      const on = e.target.checked;
                                      mutateProject((proj) => {
                                        const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                        const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                        if (f) {
                                          const set = new Set(f.activeStates || []);
                                          if (on) set.add(st);
                                          else set.delete(st);
                                          f.activeStates = LIFECYCLE_STATES.filter((s) => set.has(s));
                                          syncPackagesFromNodes(proj, pkgName);
                                        }
                                      });
                                    }}
                                  />
                                  <span>{st}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}

                        {/* Collapsible Quality of Service (QoS) Panel */}
                        <details className="qos-details">
                          <summary>
                            <Settings2 size={13} />
                            <span>
                              Quality of Service (QoS)
                              {hasQos ? ` — ${qos.profile || qos.reliability || 'configured'}` : ' (default)'}
                            </span>
                          </summary>
                          <div className="qos-grid">
                            <div className="rt-field" style={{ marginBottom: 0 }}>
                              <label>Profile</label>
                              <select
                                className="rt-select"
                                data-qos-key="profile"
                                disabled={isReadOnly}
                                value={qos.profile || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      f.qos = { ...(f.qos || {}), profile: v };
                                      if (!v) delete f.qos.profile;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              >
                                <option value="">— None —</option>
                                {QOS_PROFILES.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="rt-field" style={{ marginBottom: 0 }}>
                              <label>Reliability</label>
                              <select
                                className="rt-select"
                                data-qos-key="reliability"
                                disabled={isReadOnly}
                                value={qos.reliability || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      f.qos = { ...(f.qos || {}), reliability: v };
                                      if (!v) delete f.qos.reliability;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              >
                                <option value="">— Default —</option>
                                <option value="reliable">reliable</option>
                                <option value="best_effort">best_effort</option>
                                <option value="system_default">system_default</option>
                              </select>
                            </div>

                            <div className="rt-field" style={{ marginBottom: 0 }}>
                              <label>Durability</label>
                              <select
                                className="rt-select"
                                data-qos-key="durability"
                                disabled={isReadOnly}
                                value={qos.durability || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      f.qos = { ...(f.qos || {}), durability: v };
                                      if (!v) delete f.qos.durability;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              >
                                <option value="">— Default —</option>
                                <option value="volatile">volatile</option>
                                <option value="transient_local">transient_local</option>
                                <option value="system_default">system_default</option>
                              </select>
                            </div>

                            <div className="rt-field" style={{ marginBottom: 0 }}>
                              <label>History</label>
                              <select
                                className="rt-select"
                                data-qos-key="history"
                                disabled={isReadOnly}
                                value={qos.history || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      f.qos = { ...(f.qos || {}), history: v };
                                      if (!v) delete f.qos.history;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              >
                                <option value="">— Default —</option>
                                <option value="keep_last">keep_last</option>
                                <option value="keep_all">keep_all</option>
                                <option value="system_default">system_default</option>
                              </select>
                            </div>

                            <div className="rt-field" style={{ marginBottom: 0 }}>
                              <label>Depth</label>
                              <input
                                type="number"
                                min="1"
                                className="rt-input"
                                data-qos-key="depth"
                                disabled={isReadOnly}
                                placeholder="10"
                                value={qos.depth || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      f.qos = { ...(f.qos || {}), depth: v };
                                      if (!v) delete f.qos.depth;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              />
                            </div>

                            <div className="rt-field" style={{ marginBottom: 0 }}>
                              <label>Liveliness</label>
                              <select
                                className="rt-select"
                                data-qos-key="liveliness"
                                disabled={isReadOnly}
                                value={qos.liveliness || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      f.qos = { ...(f.qos || {}), liveliness: v };
                                      if (!v) delete f.qos.liveliness;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              >
                                <option value="">— Default —</option>
                                <option value="automatic">automatic</option>
                                <option value="manual_by_topic">manual_by_topic</option>
                                <option value="system_default">system_default</option>
                              </select>
                            </div>

                            <div className="rt-field" style={{ marginBottom: 0 }}>
                              <label>Deadline</label>
                              <input
                                className="rt-input"
                                data-qos-key="deadline"
                                disabled={isReadOnly}
                                placeholder="e.g. 100"
                                value={qos.deadline || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      f.qos = { ...(f.qos || {}), deadline: v };
                                      if (!v) delete f.qos.deadline;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              />
                            </div>

                            <div className="rt-field" style={{ marginBottom: 0 }}>
                              <label>Lifespan</label>
                              <input
                                className="rt-input"
                                data-qos-key="lifespan"
                                disabled={isReadOnly}
                                placeholder="e.g. infinite"
                                value={qos.lifespan || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      f.qos = { ...(f.qos || {}), lifespan: v };
                                      if (!v) delete f.qos.lifespan;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              />
                            </div>

                            <div className="rt-field" style={{ marginBottom: 0 }}>
                              <label>Lease Duration</label>
                              <input
                                className="rt-input"
                                data-qos-key="lease_duration"
                                disabled={isReadOnly}
                                placeholder="e.g. infinite"
                                value={qos.lease_duration || ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      f.qos = { ...(f.qos || {}), lease_duration: v };
                                      if (!v) delete f.qos.lease_duration;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              />
                            </div>
                          </div>

                          {!isReadOnly && hasQos && (
                            <div style={{ marginTop: 8 }}>
                              <button
                                type="button"
                                className="rt-btn subtle btn-clear-qos"
                                onClick={() => {
                                  mutateProject((proj) => {
                                    const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                                    const f = (n?.ifaces || []).find((x) => x.id === iface.id);
                                    if (f) {
                                      delete f.qos;
                                      syncPackagesFromNodes(proj, pkgName);
                                    }
                                  });
                                }}
                              >
                                <RotateCcw size={12} /> Reset QoS to Default
                              </button>
                            </div>
                          )}
                        </details>
                      </div>
                    );
                  })}
              </div>

              {/* 3. Parameters Contract Editor */}
              <div className="rt-card">
                <div className="rt-section-hdr">
                  <h3>
                    <Sliders size={15} /> Parameters ({(activeNode.params || []).length})
                  </h3>
                  {!isReadOnly && (
                    <button type="button" className="rt-btn primary" onClick={handleAddParameter}>
                      <Plus size={12} /> Add Parameter
                    </button>
                  )}
                </div>

                {(activeNode.params || []).length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>
                    No ROS parameters declared on this component yet.
                  </p>
                ) : (
                  (activeNode.params || []).map((param, pIdx) => (
                    <div
                      key={param.id || `${param.name}_${pIdx}`}
                      className="rt-iface-card"
                      style={{ display: 'grid', gridTemplateColumns: '1.2fr 150px 1.2fr auto', gap: 8, alignItems: 'center' }}
                    >
                      <input
                        className="rt-input"
                        disabled={isReadOnly}
                        placeholder="Parameter name"
                        value={param.name}
                        onChange={(e) => {
                          const val = e.target.value;
                          mutateProject((proj) => {
                            const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                            const p = (n?.params || [])[pIdx];
                            if (p) {
                              p.name = val;
                              p.label = val;
                              syncPackagesFromNodes(proj, pkgName);
                            }
                          });
                        }}
                      />

                      <select
                        className="rt-select"
                        disabled={isReadOnly}
                        value={param.ptype || 'String'}
                        onChange={(e) => {
                          const nextPtype = e.target.value;
                          mutateProject((proj) => {
                            const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                            const p = (n?.params || [])[pIdx];
                            if (p) {
                              p.ptype = nextPtype;
                              syncPackagesFromNodes(proj, pkgName);
                            }
                          });
                        }}
                      >
                        {PARAM_TYPES.map((pt) => (
                          <option key={pt} value={pt}>
                            {pt}
                          </option>
                        ))}
                      </select>

                      {param.ptype === 'Boolean' ? (
                        <select
                          className="rt-select"
                          disabled={isReadOnly}
                          value={param.value === undefined || param.value === '' ? '' : String(param.value)}
                          onChange={(e) => {
                            const v = e.target.value;
                            mutateProject((proj) => {
                              const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                              const p = (n?.params || [])[pIdx];
                              if (p) {
                                p.value = v === '' ? undefined : v;
                                syncPackagesFromNodes(proj, pkgName);
                              }
                            });
                          }}
                        >
                          <option value="">No default</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : (
                        <input
                          className="rt-input"
                          disabled={isReadOnly}
                          placeholder={
                            param.ptype === 'Double'
                              ? 'Default (e.g. 1.0)'
                              : param.ptype === 'Integer'
                              ? 'Default (e.g. 10)'
                              : 'Default value (optional)'
                          }
                          value={param.value !== undefined && param.value !== null ? String(param.value) : ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            mutateProject((proj) => {
                              const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                              const p = (n?.params || [])[pIdx];
                              if (p) {
                                p.value = v;
                                syncPackagesFromNodes(proj, pkgName);
                              }
                            });
                          }}
                        />
                      )}

                      {!isReadOnly && (
                        <button
                          type="button"
                          className="rt-btn danger icon-only"
                          title="Delete Parameter"
                          onClick={() => {
                            mutateProject((proj) => {
                              const n = (proj.nodes || []).find((x) => x.id === activeNode.id);
                              if (n) {
                                n.params = (n.params || []).filter((_, i) => i !== pIdx);
                                syncPackagesFromNodes(proj, pkgName);
                              }
                            });
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
