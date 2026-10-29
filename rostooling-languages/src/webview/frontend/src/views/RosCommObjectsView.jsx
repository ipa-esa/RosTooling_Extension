import React, { useState, useMemo } from 'react';
import { Braces, Plus, Trash2, Search, FolderOpen } from 'lucide-react';
import {
  useStudio,
  setUIState,
  mutateProject,
  extractRosSpecsList,
  syncRosTypesAndNodes,
  getDisplayModelName,
  ROS_PRIMITIVE_TYPES,
} from '../state/studioStore';

const COMPARTMENTS = {
  msg: ['message'],
  srv: ['request', 'response'],
  action: ['goal', 'result', 'feedback'],
};

function parseFieldTypeParts(rawType = '') {
  const trimmed = String(rawType || '').trim();
  const arrMatch = /^(.*)\[(\d*)\]$/.exec(trimmed);
  if (arrMatch) {
    const base = arrMatch[1].replace(/^['"]|['"]$/g, '');
    const len = arrMatch[2] ? parseInt(arrMatch[2], 10) : undefined;
    return { base, array: true, arrayLength: isNaN(len) ? undefined : len };
  }
  return { base: trimmed.replace(/^['"]|['"]$/g, ''), array: false, arrayLength: undefined };
}

function buildFieldTypeString(base, array, arrayLength) {
  const cleanBase = String(base || 'string').trim().replace(/\[\d*\]$/, '').replace(/^['"]|['"]$/g, '') || 'string';
  if (!array) return cleanBase;
  if (arrayLength != null && String(arrayLength).trim() !== '' && Number(arrayLength) > 0) {
    const n = parseInt(String(arrayLength), 10);
    if (cleanBase.includes('/') || cleanBase.includes('.')) {
      return `'${cleanBase}'[${n}]`;
    }
    return `${cleanBase}[${n}]`;
  }
  return `${cleanBase}[]`;
}

export function addNewCommObjectSpec(category = 'msg', isReadOnly = false, project = null, docFileName = '') {
  if (isReadOnly || !project) return null;
  const pkgName = getDisplayModelName(project, 'ros', docFileName) || 'ros_package';
  let addedName = null;
  mutateProject((proj) => {
    const specs = extractRosSpecsList(proj);
    const baseLabel = category === 'srv' ? 'CustomService' : category === 'action' ? 'CustomAction' : 'CustomMessage';
    let name = baseLabel;
    let idx = 2;
    while (specs.some((s) => s.name === name)) {
      name = `${baseLabel}${idx++}`;
    }
    addedName = name;
    const fields = {};
    for (const comp of COMPARTMENTS[category] || ['message']) {
      fields[comp] = [];
    }
    if (category === 'msg') {
      fields.message = [{ type: 'string', name: 'data', constant: false, array: false }];
    }
    specs.push({
      name,
      category,
      pkg: pkgName,
      fields,
    });
    syncRosTypesAndNodes(proj, specs, pkgName);
  });
  return addedName;
}

export function RosCommObjectsView() {
  const studio = useStudio();
  const { project, isReadOnly, docFileName, typeCategoryFilter, typeIndex, selectedTypeName } = studio;
  const [search, setSearch] = useState('');

  const pkgName = getDisplayModelName(project, 'ros', docFileName);
  const specs = useMemo(() => extractRosSpecsList(project), [project]);

  const availableFieldTypes = useMemo(() => {
    const set = new Set(ROS_PRIMITIVE_TYPES);
    for (const s of specs) {
      if (s.category === 'msg' && s.name) set.add(s.name);
    }
    for (const [k, info] of Object.entries(typeIndex?.types || {})) {
      const cat = info?.category || info?.kind || (k.includes('/srv/') ? 'srv' : k.includes('/action/') ? 'action' : 'msg');
      if (cat === 'msg') set.add(k);
    }
    return Array.from(set);
  }, [specs, typeIndex]);

  const filteredSpecs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return specs.filter((s) => {
      if (typeCategoryFilter !== 'all' && s.category !== typeCategoryFilter) return false;
      if (!q) return true;
      const inFields = Object.values(s.fields || {}).some((arr) =>
        (arr || []).some(
          (f) =>
            (f.name || '').toLowerCase().includes(q) ||
            (f.type || '').toLowerCase().includes(q)
        )
      );
      return s.name.toLowerCase().includes(q) || inFields;
    });
  }, [specs, typeCategoryFilter, search]);

  const updateSpecs = (mutator) => {
    if (isReadOnly) return;
    mutateProject((proj) => {
      const list = extractRosSpecsList(proj);
      mutator(list);
      syncRosTypesAndNodes(proj, list, pkgName || 'ros_package');
    });
  };

  return (
    <div className="rt-comp-layout">
      {/* Left Sidebar: Package & Communication Objects Index */}
      <aside className="rt-sidebar-left">
        <div className="rt-panel-pad">
          <div className="rt-section-hdr">
            <h2>Interface Package</h2>
          </div>

          <div className="rt-field">
            <label>ROS Interface Package Name</label>
            <input
              className="rt-input"
              disabled={isReadOnly}
              placeholder="my_robot_msgs"
              value={pkgName}
              onChange={(e) => {
                const nextPkg = e.target.value;
                mutateProject((proj) => {
                  const list = extractRosSpecsList(proj);
                  syncRosTypesAndNodes(proj, list, nextPkg);
                });
              }}
            />
          </div>

          <div className="rt-search-box" style={{ marginBottom: 10 }}>
            <Search size={13} />
            <input
              placeholder="Search definitions or fields..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {!isReadOnly && (
            <div style={{ display: 'flex', gap: 5, marginBottom: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="rt-btn primary"
                onClick={() => {
                  const n = addNewCommObjectSpec('msg', isReadOnly, project, docFileName);
                  if (n) setUIState({ selectedTypeName: n });
                }}
              >
                <Plus size={12} /> Msg
              </button>
              <button
                type="button"
                className="rt-btn"
                onClick={() => {
                  const n = addNewCommObjectSpec('srv', isReadOnly, project, docFileName);
                  if (n) setUIState({ selectedTypeName: n });
                }}
              >
                <Plus size={12} /> Srv
              </button>
              <button
                type="button"
                className="rt-btn"
                onClick={() => {
                  const n = addNewCommObjectSpec('action', isReadOnly, project, docFileName);
                  if (n) setUIState({ selectedTypeName: n });
                }}
              >
                <Plus size={12} /> Action
              </button>
            </div>
          )}

          <div className="rt-section-hdr">
            <h3>Definitions ({filteredSpecs.length})</h3>
          </div>

          {filteredSpecs.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>No communication objects match the filter.</p>
          ) : (
            filteredSpecs.map((s) => {
              const totalFields = Object.values(s.fields || {}).reduce(
                (acc, arr) => acc + (arr || []).length,
                0
              );
              const badgeColor =
                s.category === 'srv' ? 'ss' : s.category === 'action' ? 'as' : 'pub';
              return (
                <button
                  key={s.name}
                  type="button"
                  className={`rt-node-list-item ${selectedTypeName === s.name ? 'active' : ''}`}
                  onClick={() => {
                    setUIState({ selectedTypeName: s.name });
                    const el = document.getElementById(`spec-card-${s.name}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 12.5 }}>{s.name}</strong>
                    <small style={{ color: 'var(--rt-muted)', fontSize: 10.5 }}>
                      {totalFields} {totalFields === 1 ? 'field' : 'fields'}
                    </small>
                  </div>
                  <span className={`rt-port-kind ${badgeColor}`}>{s.category}</span>
                </button>
              );
            })
          )}

          <button
            type="button"
            className="rt-btn"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => setUIState({ catalogueOpen: true, catalogueTab: 'types' })}
          >
            <FolderOpen size={13} /> Browse Standard ROS Types
          </button>
        </div>
      </aside>

      {/* Main Type Spec Cards & Struct Fields Editor */}
      <main className="rt-types-main">
        <div className="rt-types-grid">
          <datalist id="rt-comm-field-types">
            {availableFieldTypes.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          {filteredSpecs.length === 0 ? (
            <div className="rt-empty-state">
              <Braces size={32} style={{ color: '#c084fc', marginBottom: 10 }} />
              <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Define ROS Communication Objects (`.ros`)</h2>
              <p style={{ margin: '0 0 16px', fontSize: 13 }}>
                Author custom Messages (`msgs`), Services (`srvs`), and Actions (`actions`) with typed struct fields, arrays, and constants.
              </p>
              {!isReadOnly && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="rt-btn primary"
                    onClick={() => addNewCommObjectSpec('msg', isReadOnly, project, docFileName)}
                  >
                    <Plus size={14} /> Add Message
                  </button>
                  <button
                    type="button"
                    className="rt-btn"
                    onClick={() => addNewCommObjectSpec('srv', isReadOnly, project, docFileName)}
                  >
                    <Plus size={14} /> Add Service
                  </button>
                  <button
                    type="button"
                    className="rt-btn"
                    onClick={() => addNewCommObjectSpec('action', isReadOnly, project, docFileName)}
                  >
                    <Plus size={14} /> Add Action
                  </button>
                </div>
              )}
            </div>
          ) : (
            filteredSpecs.map((spec) => {
              const specIdx = specs.findIndex((x) => x.name === spec.name);
              const compartments = COMPARTMENTS[spec.category] || ['message'];
              const kindBadge =
                spec.category === 'srv' ? 'ss' : spec.category === 'action' ? 'as' : 'pub';

              return (
                <section
                  id={`spec-card-${spec.name}`}
                  key={`${spec.category}_${specIdx}`}
                  className="rt-type-spec-card"
                >
                  {/* Card Header: Category + Name + Delete */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span className={`rt-port-kind ${kindBadge}`} style={{ padding: '4px 8px', fontSize: 11 }}>
                      {spec.category.toUpperCase()}
                    </span>

                    <input
                      className="rt-input"
                      style={{ width: 240, fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--rt-mono)' }}
                      disabled={isReadOnly}
                      value={spec.name}
                      placeholder="TypeName (PascalCase)"
                      onChange={(e) => {
                        const nextName = e.target.value.trim();
                        if (!nextName) return;
                        updateSpecs((list) => {
                          if (list[specIdx]) {
                            list[specIdx].name = nextName;
                          }
                        });
                      }}
                    />

                    <select
                      className="rt-select"
                      disabled={isReadOnly}
                      value={spec.category}
                      onChange={(e) => {
                        const nextCat = e.target.value;
                        updateSpecs((list) => {
                          const target = list[specIdx];
                          if (!target) return;
                          const prevFields = Object.values(target.fields || {}).flat();
                          target.category = nextCat;
                          const nextComps = COMPARTMENTS[nextCat] || ['message'];
                          target.fields = {};
                          nextComps.forEach((c, idx) => {
                            target.fields[c] = idx === 0 ? prevFields : [];
                          });
                        });
                      }}
                    >
                      <option value="msg">Message (msg)</option>
                      <option value="srv">Service (srv)</option>
                      <option value="action">Action (action)</option>
                    </select>

                    <span style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)', fontSize: 11.5 }}>
                      {pkgName || 'ros_package'}/{spec.category}/{spec.name}
                    </span>

                    {!isReadOnly && (
                      <button
                        type="button"
                        className="rt-btn danger icon-only"
                        style={{ marginLeft: 'auto' }}
                        title={`Delete ${spec.name}`}
                        onClick={() => {
                          updateSpecs((list) => {
                            list.splice(specIdx, 1);
                          });
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  {/* Compartments (message / request+response / goal+result+feedback) */}
                  {compartments.map((comp) => {
                    const fields = spec.fields?.[comp] || [];
                    return (
                      <div key={comp} className="rt-compartment">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <h4>{comp}</h4>
                          {!isReadOnly && (
                            <button
                              type="button"
                              className="rt-btn"
                              onClick={() => {
                                updateSpecs((list) => {
                                  const target = list[specIdx];
                                  if (!target) return;
                                  if (!target.fields) target.fields = {};
                                  if (!target.fields[comp]) target.fields[comp] = [];
                                  const fIdx = target.fields[comp].length + 1;
                                  target.fields[comp].push({
                                    type: 'float64',
                                    name: `field_${fIdx}`,
                                    array: false,
                                    constant: false,
                                  });
                                });
                              }}
                            >
                              <Plus size={12} /> Add `{comp}` field
                            </button>
                          )}
                        </div>

                        {fields.length === 0 ? (
                          <div style={{ fontSize: 11.5, color: 'var(--rt-dim)', padding: '4px 0' }}>
                            Empty `{comp}` payload
                          </div>
                        ) : (
                          fields.map((field, fIdx) => {
                            const parsed = parseFieldTypeParts(field.type);
                            const isArray = field.array !== undefined ? Boolean(field.array) : parsed.array;
                            const arrLen = field.arrayLength !== undefined ? field.arrayLength : parsed.arrayLength;

                            return (
                              <div key={fIdx} className="rt-field-row">
                                {/* Base Type */}
                                <input
                                  className="rt-input"
                                  style={{ fontFamily: 'var(--rt-mono)' }}
                                  list="rt-comm-field-types"
                                  disabled={isReadOnly}
                                  placeholder="Type (e.g. float64, geometry_msgs/msg/Pose)"
                                  value={parsed.base}
                                  onChange={(e) => {
                                    const newBase = e.target.value;
                                    updateSpecs((list) => {
                                      const f = list[specIdx]?.fields?.[comp]?.[fIdx];
                                      if (f) {
                                        f.type = buildFieldTypeString(newBase, isArray, arrLen);
                                      }
                                    });
                                  }}
                                />

                                {/* Field Name */}
                                <input
                                  className="rt-input"
                                  style={{ fontFamily: 'var(--rt-mono)' }}
                                  disabled={isReadOnly}
                                  placeholder={field.constant ? 'CONSTANT_NAME' : 'field_name'}
                                  value={field.name}
                                  onChange={(e) => {
                                    const newName = e.target.value;
                                    updateSpecs((list) => {
                                      const f = list[specIdx]?.fields?.[comp]?.[fIdx];
                                      if (f) f.name = newName;
                                    });
                                  }}
                                />

                                {/* Array Toggle + Optional Length */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                  <label className="rt-checkbox-row" title="Array field ([])">
                                    <input
                                      type="checkbox"
                                      disabled={isReadOnly || Boolean(field.constant)}
                                      checked={isArray && !field.constant}
                                      onChange={(e) => {
                                        const arrOn = e.target.checked;
                                        updateSpecs((list) => {
                                          const f = list[specIdx]?.fields?.[comp]?.[fIdx];
                                          if (f) {
                                            f.array = arrOn;
                                            if (!arrOn) delete f.arrayLength;
                                            f.type = buildFieldTypeString(
                                              parsed.base,
                                              arrOn,
                                              arrOn ? f.arrayLength : undefined
                                            );
                                          }
                                        });
                                      }}
                                    />
                                    <span>`[]`</span>
                                  </label>
                                  {isArray && !field.constant && (
                                    <input
                                      type="number"
                                      min="1"
                                      className="rt-input"
                                      style={{ width: 64 }}
                                      disabled={isReadOnly}
                                      placeholder="len"
                                      title="Optional fixed array length"
                                      value={arrLen ?? ''}
                                      onChange={(e) => {
                                        const rawLen = e.target.value;
                                        const numLen = rawLen ? parseInt(rawLen, 10) : undefined;
                                        updateSpecs((list) => {
                                          const f = list[specIdx]?.fields?.[comp]?.[fIdx];
                                          if (f) {
                                            f.arrayLength = numLen;
                                            f.type = buildFieldTypeString(parsed.base, true, numLen);
                                          }
                                        });
                                      }}
                                    />
                                  )}
                                </div>

                                {/* Constant Toggle + Value (supported on messages) */}
                                {spec.category === 'msg' ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <label className="rt-checkbox-row" title="Constant definition (TYPE NAME=VALUE)">
                                      <input
                                        type="checkbox"
                                        disabled={isReadOnly}
                                        checked={Boolean(field.constant)}
                                        onChange={(e) => {
                                          const cOn = e.target.checked;
                                          updateSpecs((list) => {
                                            const f = list[specIdx]?.fields?.[comp]?.[fIdx];
                                            if (f) {
                                              f.constant = cOn;
                                              if (cOn) {
                                                f.array = false;
                                                delete f.arrayLength;
                                                f.type = buildFieldTypeString(parsed.base, false);
                                                if (f.value === undefined) f.value = '0';
                                              } else {
                                                delete f.value;
                                              }
                                            }
                                          });
                                        }}
                                      />
                                      <span>Const</span>
                                    </label>
                                    {field.constant && (
                                      <input
                                        className="rt-input"
                                        style={{ width: 92, fontFamily: 'var(--rt-mono)' }}
                                        disabled={isReadOnly}
                                        placeholder="value"
                                        value={field.value ?? ''}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          updateSpecs((list) => {
                                            const f = list[specIdx]?.fields?.[comp]?.[fIdx];
                                            if (f) f.value = v;
                                          });
                                        }}
                                      />
                                    )}
                                  </div>
                                ) : (
                                  <div />
                                )}

                                {/* Delete Field */}
                                {!isReadOnly && (
                                  <button
                                    type="button"
                                    className="rt-btn danger icon-only"
                                    title="Remove field"
                                    onClick={() => {
                                      updateSpecs((list) => {
                                        list[specIdx]?.fields?.[comp]?.splice(fIdx, 1);
                                      });
                                    }}
                                  >
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
