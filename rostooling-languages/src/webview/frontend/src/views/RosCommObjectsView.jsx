import React, { useState, useMemo } from 'react';
import { Braces, Plus, Trash2, Search, FolderOpen } from 'lucide-react';
import {
  useStudio,
  setUIState,
  editProperty,
  deleteElements,
  getDisplayModelName,
  markersFor,
} from '../state/studioStore';
import { CommitInput } from '../components/CommitInput';

// ============================================================================
// .ros communication objects: React form over the server GGraph (specsJson).
// Every edit is a GLSP editRosProperty / deleteElement operation; the Java server
// applies it to the Xtext AST and returns surgical text edits.
// ============================================================================

const COMPARTMENTS = {
  msg: ['message'],
  srv: ['request', 'response'],
  action: ['goal', 'result', 'feedback'],
};

const BASE_NAMES = { msg: 'CustomMessage', srv: 'CustomService', action: 'CustomAction' };

function splitType(raw = '') {
  const t = String(raw || '').trim();
  const array = t.endsWith('[]');
  const base = (array ? t.slice(0, -2) : t).replace(/^['"]|['"]$/g, '');
  return { base, array };
}

function joinType(base, array) {
  const clean = String(base || 'string').trim().replace(/^['"]|['"]$/g, '') || 'string';
  return array ? `${clean}[]` : clean;
}

function specsOf(project) {
  return Object.values(project.types || {})
    .filter((s) => s && s.id)
    .map((s) => ({ ...s, fields: s.fields || {} }));
}

function packageOf(project) {
  return Object.values(project.packages || {})[0] || null;
}

/** Adds a new msg/srv/action spec to the package through the server; returns its name. */
export function addNewCommObjectSpec(category = 'msg', isReadOnly = false, project = null) {
  if (isReadOnly || !project) return null;
  const pkg = packageOf(project);
  if (!pkg?.id) return null;
  const taken = new Set(specsOf(project).map((s) => s.name));
  const base = BASE_NAMES[category] || 'CustomMessage';
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}${i++}`;
  editProperty(pkg.id, 'addSpec', category, { key: name });
  return name;
}

export function RosCommObjectsView() {
  const studio = useStudio();
  const { project, isReadOnly, docFileName, typeCategoryFilter, typeIndex, selectedTypeName, pending, vocabulary } = studio;
  const [search, setSearch] = useState('');

  const pkg = packageOf(project);
  const pkgName = getDisplayModelName(project, 'ros', docFileName);
  const specs = useMemo(() => specsOf(project), [project]);
  const busy = isReadOnly || pending > 0;

  const availableFieldTypes = useMemo(() => {
    // Base (non-array) field types from PrimitivesTypes.ecore, as sent by the server; [] is a checkbox.
    const set = new Set((vocabulary.messageFieldTypes || []).filter((t) => !t.endsWith('[]')));
    for (const s of specs) if (s.category === 'msg' && s.name) set.add(`${s.pkg}/msg/${s.name}`);
    for (const [k, info] of Object.entries(typeIndex?.types || {})) {
      const cat = info?.category || (k.includes('/srv/') ? 'srv' : k.includes('/action/') ? 'action' : 'msg');
      if (cat === 'msg') set.add(k);
    }
    return Array.from(set);
  }, [specs, typeIndex, vocabulary]);

  const filteredSpecs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return specs.filter((s) => {
      if (typeCategoryFilter !== 'all' && s.category !== typeCategoryFilter) return false;
      if (!q) return true;
      const inFields = Object.values(s.fields).some((arr) =>
        (arr || []).some((f) => (f.name || '').toLowerCase().includes(q) || (f.type || '').toLowerCase().includes(q))
      );
      return s.name.toLowerCase().includes(q) || inFields;
    });
  }, [specs, typeCategoryFilter, search]);

  const addButtons = (primaryFirst) => (
    <>
      {['msg', 'srv', 'action'].map((cat, i) => (
        <button key={cat} type="button" className={`rt-btn ${primaryFirst && i === 0 ? 'primary' : ''}`} disabled={busy || !pkg}
          onClick={() => {
            const n = addNewCommObjectSpec(cat, isReadOnly, project);
            if (n) setUIState({ selectedTypeName: n });
          }}>
          <Plus size={12} /> {cat === 'msg' ? 'Msg' : cat === 'srv' ? 'Srv' : 'Action'}
        </button>
      ))}
    </>
  );

  return (
    <div className="rt-comp-layout">
      <aside className="rt-sidebar-left">
        <div className="rt-panel-pad">
          <div className="rt-section-hdr">
            <h2>Interface Package</h2>
          </div>
          <div className="rt-field">
            <label>ROS Interface Package Name</label>
            <CommitInput value={pkgName} placeholder="my_robot_msgs" disabled={busy || !pkg?.id}
              onCommit={(v) => v.trim() && editProperty(pkg.id, 'name', v.trim())} />
          </div>
          <div className="rt-search-box" style={{ marginBottom: 10 }}>
            <Search size={13} />
            <input placeholder="Search definitions or fields..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {!isReadOnly && <div style={{ display: 'flex', gap: 5, marginBottom: 12, flexWrap: 'wrap' }}>{addButtons(true)}</div>}
          <div className="rt-section-hdr">
            <h3>Definitions ({filteredSpecs.length})</h3>
          </div>
          {filteredSpecs.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>No communication objects match the filter.</p>
          ) : (
            filteredSpecs.map((s) => {
              const total = Object.values(s.fields).reduce((acc, arr) => acc + (arr || []).length, 0);
              const badge = s.category === 'srv' ? 'ss' : s.category === 'action' ? 'as' : 'pub';
              return (
                <button key={s.id} type="button" className={`rt-node-list-item ${selectedTypeName === s.name ? 'active' : ''}`}
                  onClick={() => {
                    setUIState({ selectedTypeName: s.name });
                    document.getElementById(`spec-card-${s.name}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 12.5 }}>{s.name}</strong>
                    <small style={{ color: 'var(--rt-muted)', fontSize: 10.5 }}>{total} {total === 1 ? 'field' : 'fields'}</small>
                  </div>
                  <span className={`rt-port-kind ${badge}`}>{s.category}</span>
                </button>
              );
            })
          )}
          <button type="button" className="rt-btn" style={{ width: '100%', marginTop: 12 }}
            onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'types' })}>
            <FolderOpen size={13} /> Browse Standard ROS Types
          </button>
        </div>
      </aside>

      <main className="rt-types-main">
        <div className="rt-types-grid">
          <datalist id="rt-comm-field-types">
            {availableFieldTypes.map((t) => <option key={t} value={t} />)}
          </datalist>
          {filteredSpecs.length === 0 ? (
            <div className="rt-empty-state">
              <Braces size={32} style={{ color: '#c084fc', marginBottom: 10 }} />
              <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Define ROS Communication Objects (`.ros`)</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13 }}>
                Author custom Messages (`msgs`), Services (`srvs`), and Actions (`actions`) with typed fields.
              </p>
              {!isReadOnly && <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>{addButtons(true)}</div>}
            </div>
          ) : (
            filteredSpecs.map((spec) => {
              const badge = spec.category === 'srv' ? 'ss' : spec.category === 'action' ? 'as' : 'pub';
              const specMarkers = markersFor(spec.id);
              return (
                <section id={`spec-card-${spec.name}`} key={spec.id} className="rt-type-spec-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span className={`rt-port-kind ${badge}`} style={{ padding: '4px 8px', fontSize: 11 }}>{spec.category.toUpperCase()}</span>
                    <CommitInput value={spec.name} placeholder="TypeName (PascalCase)" disabled={busy}
                      style={{ width: 240, fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--rt-mono)' }}
                      onCommit={(v) => v.trim() && editProperty(spec.id, 'name', v.trim())} />
                    <span style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', fontSize: 11.5 }}>
                      {spec.pkg || pkgName}/{spec.category}/{spec.name}
                    </span>
                    {!isReadOnly && (
                      <button type="button" className="rt-btn danger icon-only" style={{ marginLeft: 'auto' }} disabled={busy}
                        title={`Delete ${spec.name}`} onClick={() => deleteElements([spec.id])}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {specMarkers.map((m, i) => (
                    <div key={i} className={`rt-diag-item ${m.kind === 'error' ? 'err' : 'warn'}`}>{m.description || m.label}</div>
                  ))}

                  {(COMPARTMENTS[spec.category] || ['message']).map((comp) => {
                    const fields = spec.fields[comp] || [];
                    return (
                      <div key={comp} className="rt-compartment">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <h4>{comp}</h4>
                          {!isReadOnly && (
                            <button type="button" className="rt-btn" disabled={busy}
                              onClick={() => {
                                const taken = new Set(fields.map((f) => f.name));
                                let n = fields.length + 1;
                                while (taken.has(`field_${n}`)) n += 1;
                                editProperty(spec.id, 'addField', 'float64', { key: `field_${n}`, valueType: comp });
                              }}>
                              <Plus size={12} /> Add `{comp}` field
                            </button>
                          )}
                        </div>
                        {fields.length === 0 ? (
                          <div style={{ fontSize: 11.5, color: 'var(--rt-dim)', padding: '4px 0' }}>Empty `{comp}` payload</div>
                        ) : (
                          fields.map((field) => {
                            const { base, array } = splitType(field.type);
                            const errs = markersFor(field.id).filter((m) => m.kind === 'error');
                            return (
                              <div key={field.id} className="rt-field-row" title={errs.map((m) => m.description).join('\n')}>
                                <CommitInput value={base} list="rt-comm-field-types" disabled={busy}
                                  className={`rt-input ${errs.length ? 'invalid' : ''}`}
                                  placeholder="Type (e.g. float64, geometry_msgs/msg/Pose)" style={{ fontFamily: 'var(--rt-mono)' }}
                                  onCommit={(v) => editProperty(field.id, 'type', joinType(v, array))} />
                                <CommitInput value={field.name} disabled={busy} placeholder="field_name"
                                  style={{ fontFamily: 'var(--rt-mono)' }}
                                  onCommit={(v) => v.trim() && editProperty(field.id, 'name', v.trim())} />
                                <label className="rt-checkbox-row" title="Array field ([])">
                                  <input type="checkbox" disabled={busy} checked={array}
                                    onChange={(e) => editProperty(field.id, 'type', joinType(base, e.target.checked))} />
                                  <span>[]</span>
                                </label>
                                {!isReadOnly && (
                                  <button type="button" className="rt-btn danger icon-only" disabled={busy} title="Delete field"
                                    onClick={() => deleteElements([field.id])}>
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}
