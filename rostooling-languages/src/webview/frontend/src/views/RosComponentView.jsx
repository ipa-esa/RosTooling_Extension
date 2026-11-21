import React, { useMemo } from 'react';
import { Box, Plus, Trash2, Copy, Activity, Sliders, Settings2, Braces, FileCode2, Puzzle, Library, Plug } from 'lucide-react';
import {
  useStudio,
  setUIState,
  editProperty,
  deleteElements,
  getDisplayModelName,
  markersFor,
  KIND_META,
  SRC_SIDE,
  orderedInterfaceKinds,
} from '../state/studioStore';
import { hostBridge } from '../state/vscodeBridge';
import { CommitInput } from '../components/CommitInput';
import { Contributions } from '../components/Contributions';
import { BlockInspector } from '../components/BlockInspector';

// ============================================================================
// .ros2 component contracts: React form over the server GGraph (node:ros-package).
// Every control dispatches a GLSP editRosProperty / deleteElement operation; the Java
// server edits the Xtext AST and returns field-granular text edits (comments survive).
// ============================================================================

function packageOf(project) {
  return Object.values(project.packages || {})[0] || null;
}

function uniqueName(existing, prefix) {
  const taken = new Set(existing);
  let i = existing.length + 1;
  while (taken.has(`${prefix}_${i}`)) i += 1;
  return `${prefix}_${i}`;
}

function familyOf(kind) {
  return KIND_META[kind]?.family || 'Topic';
}

function ErrorText({ ids }) {
  const list = ids.flatMap((id) => markersFor(id)).filter((m) => m.kind === 'error');
  if (list.length === 0) return null;
  return (
    <div className="rt-diag-item err" style={{ fontSize: 11.5 }}>
      {list.map((m, i) => <div key={i}>{m.description || m.label}</div>)}
    </div>
  );
}

const isPlugin = (n) => n?.viewData?.kind === 'plugin';

/** Plugins grouped by the library artifact that holds them, in model order. */
function librariesOf(plugins) {
  const libs = new Map();
  for (const p of plugins) {
    const lib = p.viewData?.artifact?.name || p.artifact || '';
    if (!libs.has(lib)) libs.set(lib, { name: lib, id: p.viewData?.artifact?.id || p.artifactId, plugins: [] });
    libs.get(lib).plugins.push(p);
  }
  return [...libs.values()];
}

/** "MyPlanner" -> "my_planner" */
function snake(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function RosComponentView() {
  const studio = useStudio();
  const { project, isReadOnly, docFileName, selectedNodeId, selectedBaseId, interfaceFilter, typeIndex, pending } = studio;

  const artifacts = (project.nodes || []).filter((n) => n.backing !== 'type');
  const nodes = artifacts.filter((n) => !isPlugin(n));
  const libraries = librariesOf(artifacts.filter(isPlugin));
  const pkg = packageOf(project);
  const bases = pkg?.viewData?.pluginBases || [];
  const activeBase = bases.find((b) => b.id === selectedBaseId) || null;
  const activeNode = activeBase ? null : artifacts.find((n) => n.id === selectedNodeId) || artifacts[0] || null;
  const pkgName = getDisplayModelName(project, 'component', docFileName);
  const busy = isReadOnly || pending > 0;

  const typesByFamily = useMemo(() => {
    const map = { Topic: [], Service: [], Action: [] };
    for (const [k, info] of Object.entries(typeIndex?.types || {})) {
      const cat = info?.category || (k.includes('/srv/') ? 'srv' : k.includes('/action/') ? 'action' : 'msg');
      if (cat === 'srv') map.Service.push(k);
      else if (cat === 'action') map.Action.push(k);
      else map.Topic.push(k);
    }
    return map;
  }, [typeIndex]);

  const addNode = () => {
    if (!pkg?.id) return;
    const name = uniqueName(nodes.map((n) => n.artifact || n.label), 'node');
    editProperty(pkg.id, 'addArtifact', name, { key: name });
  };
  const addPlugin = (libName) => {
    if (!pkg?.id) return;
    const lib = libName || uniqueName(libraries.map((l) => l.name), 'plugins');
    const existing = libraries.find((l) => l.name === lib)?.plugins.map((p) => p.label) || [];
    editProperty(pkg.id, 'addPlugin', bases[0]?.ref || '', { key: `${lib}::${uniqueName(existing, 'Plugin')}` });
  };
  const addBase = () => {
    if (!pkg?.id) return;
    const name = uniqueName(bases.map((b) => b.name), 'Base');
    editProperty(pkg.id, 'addPluginBase',
      JSON.stringify({ class: `${pkgName}::${name}`, header: `${pkgName}/${snake(name)}.hpp`, loader: 'pluginlib' }), { key: name });
  };
  const selectArtifact = (id) => setUIState({ selectedNodeId: id, selectedBaseId: null });

  return (
    <div className="rt-comp-layout">
      <aside className="rt-sidebar-left">
        <div className="rt-panel-pad">
          <div className="rt-section-hdr">
            <h2>Package Metadata</h2>
          </div>
          <div className="rt-field">
            <label>Ament Package Name</label>
            <CommitInput value={pkgName} disabled={busy || !pkg?.id}
              onCommit={(v) => v.trim() && editProperty(pkg.id, 'name', v.trim())} />
          </div>
          <div className="rt-field">
            <label>Git Repository (`fromGitRepo`)</label>
            <CommitInput value={pkg?.fromGitRepo || ''} placeholder="https://github.com/org/repo.git" disabled={busy || !pkg?.id}
              onCommit={(v) => editProperty(pkg.id, 'fromGitRepo', v.trim())} />
          </div>

          <div className="rt-section-hdr">
            <h3>Component Nodes ({nodes.length})</h3>
            {!isReadOnly && (
              <button type="button" className="rt-btn primary" disabled={busy || !pkg?.id} onClick={addNode}>
                <Plus size={12} /> New
              </button>
            )}
          </div>
          {nodes.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>No nodes in this `.ros2` package yet.</p>
          ) : (
            nodes.map((n) => (
              <button key={n.id} type="button" className={`rt-node-list-item ${activeNode?.id === n.id ? 'active' : ''}`}
                onClick={() => selectArtifact(n.id)}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: 12.5 }}>{n.label}</strong>
                  <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', fontSize: 10.5 }}>
                    exec: {n.artifact || n.label} · {(n.ifaces || []).length} ports
                    {(n.viewData?.pluginSlots || []).length > 0 ? ` · ${n.viewData.pluginSlots.length} slots` : ''}
                  </small>
                </div>
                {n.isLifecycle && <span className="rt-badge lifecycle" title="LifecycleNode">LC</span>}
                <Contributions items={n.viewData?.contributions} />
              </button>
            ))
          )}

          <div className="rt-section-hdr">
            <h3><Library size={13} /> Plugin Libraries ({libraries.length})</h3>
            {!isReadOnly && (
              <button type="button" className="rt-btn" disabled={busy || !pkg?.id} title="New library artifact with one plugin"
                onClick={() => addPlugin(null)}>
                <Plus size={12} /> New
              </button>
            )}
          </div>
          {libraries.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>No plugin libraries in this package.</p>
          ) : (
            libraries.map((lib) => (
              <div key={lib.name} className="rt-library-card" data-testid={`library-${lib.name}`}>
                <div className="rt-library-hdr">
                  <small style={{ fontFamily: 'var(--rt-mono)' }}>library: {lib.name}</small>
                  {!isReadOnly && (
                    <button type="button" className="rt-btn subtle icon-only" disabled={busy} title={`Add a plugin to ${lib.name}`}
                      onClick={() => addPlugin(lib.name)}>
                      <Plus size={12} />
                    </button>
                  )}
                </div>
                {lib.plugins.map((p) => (
                  <button key={p.id} type="button" className={`rt-node-list-item ${activeNode?.id === p.id ? 'active' : ''}`}
                    onClick={() => selectArtifact(p.id)}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: 12.5 }}><Plug size={11} /> {p.label}</strong>
                      <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', fontSize: 10.5 }}>
                        implements: {p.viewData?.implements || '—'}
                      </small>
                    </div>
                    <Contributions items={p.viewData?.contributions} />
                  </button>
                ))}
              </div>
            ))
          )}

          <div className="rt-section-hdr">
            <h3><Puzzle size={13} /> Plugin Bases ({bases.length})</h3>
            {!isReadOnly && (
              <button type="button" className="rt-btn" disabled={busy || !pkg?.id} onClick={addBase}>
                <Plus size={12} /> New
              </button>
            )}
          </div>
          {bases.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>No plugin bases declared.</p>
          ) : (
            bases.map((b) => (
              <button key={b.id} type="button" className={`rt-node-list-item ${activeBase?.id === b.id ? 'active' : ''}`}
                data-testid={`base-${b.name}`} onClick={() => setUIState({ selectedBaseId: b.id })}>
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: 12.5 }}>{b.name}</strong>
                  <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', fontSize: 10.5 }}>
                    {b.class} · {b.loader}
                  </small>
                </div>
                <Contributions items={b.contributions} />
              </button>
            ))
          )}

          {artifacts.length > 0 && (
            <button type="button" className="rt-btn" style={{ width: '100%', marginTop: 12 }}
              onClick={() => hostBridge.generateWrappers(artifacts.map((n) => n.label))}>
              <FileCode2 size={14} /> Generate ROS 2 Wrappers
            </button>
          )}
        </div>
      </aside>

      <main className="rt-comp-main">
        <div className="rt-comp-container">
          {activeBase ? (
            <BaseEditor base={activeBase} pkg={pkg} artifacts={artifacts} busy={busy} isReadOnly={isReadOnly} />
          ) : !activeNode ? (
            <div className="rt-empty-state">
              <Box size={32} style={{ color: '#34d399', marginBottom: 10 }} />
              <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Author a ROS 2 Node Contract</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13 }}>
                Define executables, publishers, subscribers, services, actions, QoS policies, lifecycle states, and parameters.
              </p>
              {!isReadOnly && (
                <button type="button" className="rt-btn primary" disabled={busy || !pkg?.id} onClick={addNode}>
                  <Plus size={14} /> Add Node
                </button>
              )}
            </div>
          ) : (
            <NodeEditor node={activeNode} pkg={pkg} busy={busy} isReadOnly={isReadOnly} interfaceFilter={interfaceFilter}
              typesByFamily={typesByFamily} baseRefs={bases.map((b) => b.ref)} />
          )}
        </div>
      </main>
    </div>
  );
}

function NodeEditor({ node, pkg, busy, isReadOnly, interfaceFilter, typesByFamily, baseRefs }) {
  const { vocabulary, project } = useStudio();
  const ifaces = node.ifaces || [];
  const params = node.params || [];
  const artifactId = node.artifactId || node.id;
  const plugin = isPlugin(node) ? node.viewData : null;

  return (
    <>
      <div className="rt-card">
        <div className="rt-section-hdr">
          <div>
            <h2 style={{ margin: 0, fontSize: 16 }}>{plugin && <Plug size={14} />} {node.label}</h2>
            <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
              {plugin
                ? `${node.pkg}.${node.label} · plugin in library \`${node.artifact}\``
                : `${node.pkg}.${node.label} · executable \`${node.artifact}\``}
            </small>
          </div>
          {node.isLifecycle && <span className="rt-badge lifecycle"><Activity size={11} /> LifecycleNode</span>}
          <Contributions items={node.viewData?.contributions} />
          {plugin && !isReadOnly && (
            <button type="button" className="rt-btn danger" disabled={busy} title="Delete Plugin"
              onClick={() => { deleteElements([node.id]); setUIState({ selectedNodeId: null }); }}>
              <Trash2 size={13} /> Delete Plugin
            </button>
          )}
          {!plugin && !isReadOnly && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="rt-btn" disabled={busy || !pkg?.id} title="Duplicate Node Contract"
                onClick={() => editProperty(pkg.id, 'duplicateArtifact', `${node.artifact}_copy`, { key: artifactId })}>
                <Copy size={13} /> Duplicate
              </button>
              <button type="button" className="rt-btn danger" disabled={busy} title="Delete Node Contract"
                onClick={() => {
                  deleteElements([artifactId]);
                  setUIState({ selectedNodeId: null });
                }}>
                <Trash2 size={13} /> Delete Node
              </button>
            </div>
          )}
        </div>
        <ErrorText ids={[node.id, artifactId]} />

        <div className="rt-grid-2">
          {[false, true].map((outputs) => (
            <div key={String(outputs)} style={{ padding: 10, borderRadius: 6, background: 'var(--rt-surface)', border: '1px solid var(--rt-border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--rt-muted)', marginBottom: 6 }}>
                {outputs ? 'OUTPUT PORTS (PUB / SS / AS)' : 'INPUT PORTS (SUB / SC / AC)'}
              </div>
              {ifaces.filter((f) => SRC_SIDE[f.kind] === outputs).length === 0 ? (
                <small style={{ color: 'var(--rt-dim)' }}>{outputs ? 'No output ports' : 'No input ports'}</small>
              ) : (
                ifaces.filter((f) => SRC_SIDE[f.kind] === outputs).map((f) => (
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
          ))}
        </div>
      </div>

      {plugin && (
        <div className="rt-card">
          <div className="rt-section-hdr"><h3>Plugin Identity</h3></div>
          <div className="rt-grid-2">
            <div className="rt-field">
              <label>Plugin Name</label>
              <CommitInput value={node.label} disabled={busy} onCommit={(v) => v.trim() && editProperty(node.id, 'name', v.trim())} />
            </div>
            <div className="rt-field">
              <label>Library (`artifacts`)</label>
              <CommitInput value={node.artifact || ''} disabled={busy}
                onCommit={(v) => v.trim() && editProperty(artifactId, 'artifactName', v.trim())} />
            </div>
            <div className="rt-field">
              <label>Implements (`package.Base`)</label>
              <CommitInput value={plugin.implements || ''} disabled={busy} list="rt-base-refs" placeholder="pkg.Base"
                onCommit={(v) => v.trim() && editProperty(node.id, 'implements', v.trim())} />
            </div>
            <div className="rt-field">
              <label>Loader (from the base)</label>
              <code className="rt-sys-code">{plugin.loader || '—'}</code>
            </div>
          </div>
          <BaseRefList baseRefs={baseRefs} />
        </div>
      )}

      {!plugin && (
      <div className="rt-card">
        <div className="rt-section-hdr"><h3>Node Identity & Lifecycle</h3></div>
        <div className="rt-grid-2">
          <div className="rt-field">
            <label>ROS Node Name (`node`)</label>
            <CommitInput value={node.label} disabled={busy} onCommit={(v) => v.trim() && editProperty(node.id, 'name', v.trim())} />
          </div>
          <div className="rt-field">
            <label>Artifact / Executable Name (`artifacts`)</label>
            <CommitInput value={node.artifact || node.label} disabled={busy}
              onCommit={(v) => v.trim() && editProperty(artifactId, 'artifactName', v.trim())} />
          </div>
        </div>
        <label className="rt-checkbox-row" style={{ fontWeight: 600 }}>
          <input type="checkbox" disabled={busy} checked={Boolean(node.isLifecycle)}
            onChange={(e) => editProperty(node.id, 'isLifecycle', e.target.checked)} />
          <Activity size={14} style={{ color: 'var(--rt-lifecycle)' }} />
          <span>Managed ROS 2 `LifecycleNode` (`lifecycle: true`)</span>
        </label>
      </div>
      )}

      {!plugin && node.viewData?.kind === 'node' && (
        <SlotsCard node={node} busy={busy} isReadOnly={isReadOnly} baseRefs={baseRefs} />
      )}

      <div className="rt-card">
        <div className="rt-section-hdr">
          <h3>Interfaces ({ifaces.length})</h3>
          <button type="button" className="rt-btn subtle" onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'types' })}>
            <Braces size={13} /> Browse ROS Types
          </button>
        </div>
        {!isReadOnly && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {orderedInterfaceKinds(vocabulary).map((k) => (
              <button key={k} type="button" className="rt-btn" disabled={busy}
                onClick={() => {
                  const prefix = familyOf(k) === 'Topic' ? 'topic' : familyOf(k) === 'Service' ? 'service' : 'action';
                  editProperty(node.id, 'addInterface', '', { key: uniqueName(ifaces.map((f) => f.name), prefix), valueType: k });
                }}>
                <Plus size={12} style={{ color: KIND_META[k].color }} /> {KIND_META[k].label}
              </button>
            ))}
          </div>
        )}
        {['Topic', 'Service', 'Action'].map((fam) => (
          <datalist key={fam} id={`rt-types-${fam}`}>
            {(typesByFamily[fam] || []).map((t) => <option key={t} value={t} />)}
          </datalist>
        ))}
        {ifaces
          .filter((f) => interfaceFilter === 'all' || f.kind === interfaceFilter)
          .map((iface) => (
            <InterfaceCard key={iface.id} iface={iface} busy={busy} isReadOnly={isReadOnly} lifecycle={Boolean(node.isLifecycle)} />
          ))}
      </div>

      <div className="rt-card">
        <div className="rt-section-hdr">
          <h3><Sliders size={14} /> Parameters ({params.length})</h3>
          {!isReadOnly && (
            <button type="button" className="rt-btn" disabled={busy}
              onClick={() => editProperty(node.id, 'addParameter', '', { key: uniqueName(params.map((p) => p.name), 'param'), valueType: 'String' })}>
              <Plus size={12} /> Add Parameter
            </button>
          )}
        </div>
        {params.length === 0 ? (
          <small style={{ color: 'var(--rt-dim)' }}>No parameters declared.</small>
        ) : (
          params.map((p) => (
            <div key={p.id} className="rt-field-row">
              <CommitInput value={p.name} disabled={busy} placeholder="name" style={{ fontFamily: 'var(--rt-mono)' }}
                onCommit={(v) => v.trim() && editProperty(p.id, 'name', v.trim())} />
              <select className="rt-select" disabled={busy} value={vocabulary.parameterTypes.includes(p.ptype) ? p.ptype : ''}
                onChange={(e) => editProperty(p.id, 'type', e.target.value)}>
                {!vocabulary.parameterTypes.includes(p.ptype) && <option value="">{p.ptype || '—'}</option>}
                {vocabulary.parameterTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {p.ptype === 'Boolean' ? (
                <select className="rt-select" disabled={busy} value={p.value === undefined ? '' : String(p.value)}
                  onChange={(e) => editProperty(p.id, 'default', e.target.value)}>
                  <option value="">— no default —</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <CommitInput value={p.value === undefined ? '' : String(p.value)} disabled={busy || p.ptype === 'Array'}
                  placeholder="default" style={{ fontFamily: 'var(--rt-mono)' }}
                  onCommit={(v) => editProperty(p.id, 'default', v)} />
              )}
              <NamespaceSelect elementId={p.id} value={p.ns} busy={busy} />
              {!isReadOnly && (
                <button type="button" className="rt-btn danger icon-only" disabled={busy} title="Delete parameter"
                  onClick={() => deleteElements([p.id])}>
                  <Trash2 size={13} />
                </button>
              )}
              <ErrorText ids={[p.id]} />
            </div>
          ))
        )}
      </div>

      <BlockInspector className="rt-card" elementId={node.id} blocks={node.viewData?.blocks}
        available={project.viewData?.availableBlocks} location={plugin ? 'PLUGIN' : 'NODE'} editable={!busy} />
    </>
  );
}

/** Known base references, offered (not enforced) in `implements` and slot `base` fields. */
function BaseRefList({ baseRefs }) {
  return (
    <datalist id="rt-base-refs">
      {(baseRefs || []).map((r) => <option key={r} value={r} />)}
    </datalist>
  );
}

function SlotsCard({ node, busy, isReadOnly, baseRefs }) {
  const slots = node.viewData?.pluginSlots || [];
  const addSlot = () => {
    const name = uniqueName(slots.map((s) => s.name), 'slot');
    editProperty(node.id, 'addPluginSlot', JSON.stringify({ base: baseRefs?.[0] || '', parameter: `${name}_plugin` }), { key: name });
  };
  return (
    <div className="rt-card" data-testid="plugin-slots">
      <div className="rt-section-hdr">
        <h3><Plug size={14} /> Plugin Slots ({slots.length})</h3>
        {!isReadOnly && (
          <button type="button" className="rt-btn" disabled={busy} onClick={addSlot}>
            <Plus size={12} /> Add Slot
          </button>
        )}
      </div>
      <BaseRefList baseRefs={baseRefs} />
      {slots.length === 0 ? (
        <small style={{ color: 'var(--rt-dim)' }}>No plugin slots. A slot lets a system attach plugins of one base to this node.</small>
      ) : (
        slots.map((sl) => (
          <div key={sl.id} className="rt-slot-card">
            <div className="rt-grid-2">
              <div className="rt-field">
                <label>Slot</label>
                <CommitInput value={sl.name} disabled={busy} onCommit={(v) => v.trim() && editProperty(sl.id, 'name', v.trim())} />
              </div>
              <div className="rt-field">
                <label>Base (`package.Base`)</label>
                <CommitInput value={sl.base} disabled={busy} list="rt-base-refs"
                  onCommit={(v) => v.trim() && editProperty(sl.id, 'base', v.trim())} />
              </div>
              <div className="rt-field">
                <label>Parameter</label>
                <CommitInput value={sl.parameter} disabled={busy} style={{ fontFamily: 'var(--rt-mono)' }}
                  onCommit={(v) => v.trim() && editProperty(sl.id, 'parameter', v.trim())} />
              </div>
              <div className="rt-field">
                <label>Default plugin (`package.Plugin`)</label>
                <CommitInput value={sl.default} disabled={busy} placeholder="— none —"
                  onCommit={(v) => editProperty(sl.id, 'default', v.trim())} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label className="rt-checkbox-row">
                <input type="checkbox" disabled={busy} checked={Boolean(sl.multiple)}
                  onChange={(e) => editProperty(sl.id, 'multiple', e.target.checked)} />
                <span>Takes several plugins (`multiple`)</span>
              </label>
              <select className="rt-select" disabled={busy} value={sl.format} title="Value format of the parameter"
                onChange={(e) => editProperty(sl.id, 'format', e.target.value)}>
                <option value="class">class names</option>
                <option value="library">library names</option>
              </select>
              {!isReadOnly && (
                <button type="button" className="rt-btn danger icon-only" disabled={busy} title="Delete slot"
                  onClick={() => deleteElements([sl.id])}>
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <ErrorText ids={[sl.id]} />
          </div>
        ))
      )}
    </div>
  );
}

function BaseEditor({ base, pkg, artifacts, busy, isReadOnly }) {
  const { project } = useStudio();
  const loaders = ['pluginlib', ...((project.viewData?.loaders || []).map((l) => l.id))];
  const implementers = artifacts.filter((n) => isPlugin(n) && n.viewData.implements === base.ref);
  const field = (label, prop, value, opts = {}) => (
    <div className="rt-field">
      <label>{label}</label>
      <CommitInput value={value} disabled={busy} list={opts.list} style={{ fontFamily: 'var(--rt-mono)' }}
        onCommit={(v) => v.trim() && editProperty(base.id, prop, v.trim())} />
    </div>
  );
  return (
    <div className="rt-card" data-testid="base-editor">
      <div className="rt-section-hdr">
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}><Puzzle size={14} /> {base.name}</h2>
          <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>plugin base {base.ref}</small>
        </div>
        <Contributions items={base.contributions} />
        {!isReadOnly && (
          <button type="button" className="rt-btn danger" disabled={busy || !pkg?.id} title="Delete Plugin Base"
            onClick={() => { deleteElements([base.id]); setUIState({ selectedBaseId: null }); }}>
            <Trash2 size={13} /> Delete Base
          </button>
        )}
      </div>
      <ErrorText ids={[base.id]} />
      <div className="rt-grid-2">
        {field('Name', 'name', base.name)}
        {field('C++ class (`class`)', 'class', base.class)}
        {field('Header (`header`)', 'header', base.header)}
        {field('Loader (`loader`)', 'loader', base.loader, { list: 'rt-loaders' })}
      </div>
      <datalist id="rt-loaders">{loaders.map((l) => <option key={l} value={l} />)}</datalist>
      <div className="rt-section-hdr"><h3>Implemented in this package ({implementers.length})</h3></div>
      {implementers.length === 0 ? (
        <small style={{ color: 'var(--rt-dim)' }}>No plugin of this package implements {base.ref}.</small>
      ) : (
        implementers.map((p) => (
          <button key={p.id} type="button" className="rt-node-list-item"
            onClick={() => setUIState({ selectedNodeId: p.id, selectedBaseId: null })}>
            <strong style={{ fontSize: 12.5 }}><Plug size={11} /> {p.label}</strong>
            <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', fontSize: 10.5 }}>library: {p.artifact}</small>
          </button>
        ))
      )}
    </div>
  );
}

function InterfaceCard({ iface, busy, isReadOnly, lifecycle }) {
  const { vocabulary } = useStudio();
  const meta = KIND_META[iface.kind] || KIND_META.pub;
  const qos = iface.qos || {};
  const activeStates = iface.activeStates || [];
  const hasQos = Object.values(qos).some((v) => v != null && String(v).trim() !== '');
  const setQos = (key, value) => editProperty(iface.id, 'qos', value, { key });

  return (
    <div className="rt-iface-card">
      <div className="rt-iface-top">
        <select className="rt-select" disabled={busy} value={iface.kind} onChange={(e) => editProperty(iface.id, 'kind', e.target.value)}>
          {orderedInterfaceKinds(vocabulary).map((k) => <option key={k} value={k}>{KIND_META[k].short} — {KIND_META[k].label}</option>)}
        </select>
        <CommitInput value={iface.name} disabled={busy} placeholder="Interface name (e.g. cmd_vel)"
          onCommit={(v) => v.trim() && editProperty(iface.id, 'name', v.trim())} />
        <CommitInput value={iface.type || ''} disabled={busy} list={`rt-types-${meta.family}`}
          placeholder={meta.family === 'Service' ? 'pkg/srv/ServiceType' : meta.family === 'Action' ? 'pkg/action/ActionType' : 'pkg/msg/MessageType'}
          onCommit={(v) => v.trim() && editProperty(iface.id, 'type', v.trim())} />
        <NamespaceSelect elementId={iface.id} value={iface.ns} busy={busy} />
        {!isReadOnly && (
          <button type="button" className="rt-btn danger icon-only" disabled={busy} title="Delete Interface"
            onClick={() => deleteElements([iface.id])}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <ErrorText ids={[iface.id]} />

      {lifecycle && (
        <div className="rt-lifecycle-states">
          <strong style={{ color: 'var(--rt-lifecycle)' }}>Active Lifecycle States:</strong>
          {vocabulary.lifecycleStates.map((st) => (
            <label key={st} className="rt-checkbox-row">
              <input type="checkbox" disabled={busy} checked={activeStates.includes(st)}
                onChange={(e) => {
                  const set = new Set(activeStates);
                  if (e.target.checked) set.add(st);
                  else set.delete(st);
                  editProperty(iface.id, 'activeStates', vocabulary.lifecycleStates.filter((s) => set.has(s)).join(','));
                }} />
              <span>{st}</span>
            </label>
          ))}
        </div>
      )}

      <details className="qos-details">
        <summary>
          <Settings2 size={13} />
          <span>Quality of Service (QoS){hasQos ? ` — ${qos.profile || qos.reliability || 'configured'}` : ' (default)'}</span>
        </summary>
        <div className="qos-grid">
          {Object.entries(vocabulary.qos || {}).map(([key, field]) =>
            field.freeText ? (
              <QosText key={key} label={qosLabel(key)} value={qos[key]} busy={busy}
                placeholder={(field.values || []).join(' | ') || (key === 'depth' ? '10' : '')}
                onCommit={(v) => setQos(key, v)} />
            ) : (
              <QosSelect key={key} label={qosLabel(key)} value={qos[key]} options={field.values || []} busy={busy}
                onChange={(v) => setQos(key, v)} />
            )
          )}
        </div>
      </details>
    </div>
  );
}

/** `ns:` of an interface/parameter: the Ecore Namespace kind (Basics.xtext spelling). */
function NamespaceSelect({ elementId, value, busy }) {
  const { vocabulary } = useStudio();
  const kind = String(value || '').split(/\s+/)[0];
  return (
    <select className="rt-select" disabled={busy} value={vocabulary.namespaceKinds.includes(kind) ? kind : ''}
      title="ns: namespace of this element" onChange={(e) => editProperty(elementId, 'namespace', e.target.value)}>
      <option value="">— no ns —</option>
      {vocabulary.namespaceKinds.map((k) => <option key={k} value={k}>{k}</option>)}
    </select>
  );
}

/** "lease_duration" -> "Lease Duration" (keys come from the grammar's QualityOfService rule). */
function qosLabel(key) {
  return key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function QosSelect({ label, value, options, busy, onChange }) {
  return (
    <div className="rt-field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <select className="rt-select" disabled={busy} value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">— Default —</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function QosText({ label, value, placeholder, busy, onCommit }) {
  return (
    <div className="rt-field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <CommitInput value={value || ''} placeholder={placeholder} disabled={busy} onCommit={(v) => onCommit(v.trim())} />
    </div>
  );
}
