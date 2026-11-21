import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Download, RefreshCw, Trash2, FileCode2, ChevronsDownUp, ChevronsUpDown, Loader2, Cable, Wand2, X, Plug } from 'lucide-react';
import {
  useStudio,
  setUIState,
  editProperty,
  deleteElements,
  toggleSubSystem,
  KIND_META,
  openAutoConnect,
  closeAutoConnect,
  chooseAutoConnect,
  toggleAutoConnectExtra,
  autoConnectSelection,
  applyAutoConnect,
} from '../state/studioStore';
import { rosDiagramApi } from '../glsp/rosDiagramApi';
import { hostBridge } from '../state/vscodeBridge';
import { CommitInput } from '../components/CommitInput';
import { Contributions } from '../components/Contributions';
import { BlockInspector } from '../components/BlockInspector';
import { readViewData } from '../../../../glsp/RosViewData';
import { layoutFromGGraph } from '../../../../glsp/GGraphSvgRenderer';
import { mountRosDiagram } from '../glsp/rosDiagram';

// ============================================================================
// .rossystem view: the Eclipse GLSP (Sprotty) diagram client renders the server's
// ELK-layouted GModel and provides the standard GLSP interaction (select, move/pin,
// reconnect, delete, zoom/pan, markers, SVG export). Ports additionally support
// drag-to-connect. The React inspector edits properties through GLSP operations.
// ============================================================================

const BASE_DIV = 'ros-sprotty';
const HIDDEN_DIV = 'ros-sprotty-hidden';

function parseParams(node) {
  try {
    const parsed = JSON.parse(String(node?.el?.args?.parametersJson || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function RosSystemView() {
  const studio = useStudio();
  const { gGraph, isReadOnly, selectedNodeId, selectedEdgeId, pending, docFileName, fitTrigger } = studio;
  const layout = useMemo(() => layoutFromGGraph(gGraph), [gGraph]);
  const handleRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const sourceUri = `file://${docFileName}`;
    mountRosDiagram({
      baseDivId: BASE_DIV,
      hiddenDivId: HIDDEN_DIV,
      sourceUri,
      isReadOnly,
      onSelection: (ids) => {
        const id = ids[ids.length - 1] || null;
        const isEdge = id ? id.includes('@connections') : false;
        setUIState({ selectedNodeId: isEdge ? null : id, selectedEdgeId: isEdge ? id : null });
      },
    })
      .then((handle) => {
        if (cancelled) handle.dispose();
        else handleRef.current = handle;
      })
      .catch((err) => setError(String(err?.message || err)));
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handleRef.current?.fit();
  }, [fitTrigger]);

  const selectedNode = layout.nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedEdge = layout.edges.find((e) => e.id === selectedEdgeId) || null;

  return (
    <div className="rt-sys-layout">
      <div className="rt-sys-canvas-wrap">
        <div className="rt-sys-toolbar">
          <button type="button" className="rt-btn icon-only" title="Fit view" onClick={() => handleRef.current?.fit()}>
            <Maximize2 size={14} />
          </button>
          {!isReadOnly && (
            <button type="button" className="rt-btn" title="Connect: click a source port, then a target port (or drag between ports)"
              onClick={() => handleRef.current?.startConnectTool()}>
              <Cable size={14} /> Connect
            </button>
          )}
          {!isReadOnly && (
            <button type="button" className="rt-btn" data-testid="auto-connect"
              title="Auto-connect: propose connections between placed nodes whose interface names match, then choose which to add"
              onClick={() => openAutoConnect()}>
              <Wand2 size={14} /> Auto-connect
            </button>
          )}
          <button type="button" className="rt-btn" title="Export the ELK-layouted diagram as SVG" onClick={() => handleRef.current?.exportSvg()}>
            <Download size={14} /> Export SVG
          </button>
          <button type="button" className="rt-btn icon-only" title="Reload from model server" onClick={() => hostBridge.requestModelRefresh()}>
            <RefreshCw size={14} />
          </button>
          {pending > 0 && (
            <span className="rt-sys-pending" title="Waiting for the GLSP server">
              <Loader2 size={14} className="rt-spin" /> syncing…
            </span>
          )}
        </div>
        {error && <div className="rt-canvas-empty"><p>Diagram client failed to start: {error}</p></div>}
        <div id={BASE_DIV} className="rt-sprotty-host" data-testid="rossystem-canvas" />
        <div id={HIDDEN_DIV} className="rt-sprotty-hidden" />
        {studio.autoConnect && <AutoConnectDialog ac={studio.autoConnect} />}
      </div>
      <SystemInspector node={selectedNode} edge={selectedEdge} layout={layout} />
    </div>
  );
}

const TIER_LABELS = {
  remap: 'both remapped to the same name',
  'directed-remap': 'one remapped to the other interface name',
  contract: 'same interface name',
  fuzzy: 'similar names',
  'type-unique': 'only emitter of this type',
  'type-ambiguous': 'one of several emitters of this type',
};

const RECEIVER_LABEL = { sub: 'Subscriber', sc: 'Service client', ac: 'Action client' };

/** Highlights the receiver and a candidate emitter on the canvas while hovered. */
function hoverProps(receiver, candidate) {
  return {
    onMouseEnter: () => rosDiagramApi.highlight([receiver.portId || receiver.elementId,
      candidate ? candidate.emitterPortId || candidate.emitterElementId : null]),
    onMouseLeave: () => rosDiagramApi.highlight([]),
  };
}

/**
 * Auto-connect review. The receiver port is the only decision point: one radio group per
 * receiver (ranked candidates from the server + "leave unconnected"); topic subscribers may add
 * further publishers explicitly. Emitter fan-out is a read-only summary of those choices.
 * Everything shown comes from the server's dry run; "Add" sends the chosen ids back.
 */
function AutoConnectDialog({ ac }) {
  const [showSkipped, setShowSkipped] = useState(false);
  const [showFanOut, setShowFanOut] = useState(true);
  useEffect(() => () => rosDiagramApi.highlight([]), []);
  const selected = autoConnectSelection(ac);
  const selectedSet = new Set(selected);
  const receivers = ac.receivers || [];
  const byNode = new Map();
  for (const r of receivers) {
    if (!byNode.has(r.node)) byNode.set(r.node, []);
    byNode.get(r.node).push(r);
  }
  // Live fan-out: server-reported existing connections + the current choices.
  const chosenByEmitter = new Map();
  for (const r of receivers) {
    for (const c of r.candidates) {
      if (selectedSet.has(c.id)) chosenByEmitter.set(c.emitterRef, (chosenByEmitter.get(c.emitterRef) || 0) + 1);
    }
  }
  const short = (t) => (t ? t.split('/').pop() : '');
  return (
    <div className="rt-ac-panel" role="dialog" aria-label="Auto-connect" data-testid="auto-connect-dialog">
      <div className="rt-ac-hdr">
        <Wand2 size={14} />
        <strong>Auto-connect</strong>
        <span className="rt-ac-sub">
          {ac.loading ? 'asking the model server…' : `${receivers.length} open receiver${receivers.length === 1 ? '' : 's'}`}
        </span>
        <button type="button" className="rt-btn icon-only subtle" title="Close" onClick={() => closeAutoConnect()}>
          <X size={14} />
        </button>
      </div>
      <div className="rt-ac-body">
        {ac.applied && (
          <div className={`rt-ac-result ${ac.applied.notAdded.length ? 'warn' : ''}`} data-testid="auto-connect-result">
            Added {ac.applied.added.length} connection{ac.applied.added.length === 1 ? '' : 's'}
            {ac.applied.notAdded.length > 0 && <> · not added by the server: {ac.applied.notAdded.join(', ')}</>}
            <span className="rt-ac-hint"> (Undo reverts the whole batch)</span>
          </div>
        )}
        {ac.loading && (
          <div className="rt-ac-empty"><Loader2 size={14} className="rt-spin" /> asking the model server…</div>
        )}
        {ac.error && <div className="rt-ac-empty err">{ac.error}</div>}
        {!ac.loading && !ac.error && receivers.length === 0 && (
          <div className="rt-ac-empty">No open receivers: every subscriber/client is connected or has no compatible emitter.</div>
        )}
        {[...byNode.entries()].map(([node, list]) => (
          <section key={node} className="rt-ac-node">
            <div className="rt-ac-node-hdr rt-mono">{node}</div>
            {list.map((r) => {
              const chosen = ac.choice[r.receiverId] || null;
              const extras = ac.extras[r.receiverId] || new Set();
              const group = `ac-${r.receiverId}`;
              return (
                <fieldset key={r.receiverId} className="rt-ac-receiver" data-testid="auto-connect-receiver" data-receiver={r.receiverId}>
                  <legend {...hoverProps(r, null)}>
                    <span className={`rt-ac-kind k-${r.kind}`}>{RECEIVER_LABEL[r.kind] || r.kind}</span>
                    <span className="rt-mono">{r.iface}</span>
                    <span className="rt-ac-meta">{short(r.type)}</span>
                  </legend>
                  {r.candidates.map((c) => (
                    <label key={c.id} className="rt-ac-cand" title={c.evidence} {...hoverProps(r, c)}>
                      <input type="radio" name={group} checked={chosen === c.id} onChange={() => chooseAutoConnect(r.receiverId, c.id)} />
                      <span className="rt-mono rt-ac-emitter">{c.emitterRef}</span>
                      <span className={`rt-ac-tier t-${c.tier}`} title={TIER_LABELS[c.tier] || c.tier}>{c.tier}</span>
                      <span className="rt-ac-evidence">{c.evidence}</span>
                    </label>
                  ))}
                  <label className="rt-ac-cand none">
                    <input type="radio" name={group} checked={chosen === null} onChange={() => chooseAutoConnect(r.receiverId, null)} />
                    <span>leave unconnected</span>
                  </label>
                  {r.multiAllowed && r.candidates.length > 1 && (
                    <div className="rt-ac-extras">
                      <div className="rt-ac-extras-hdr">add another publisher</div>
                      {r.candidates.filter((c) => c.id !== chosen).map((c) => (
                        <label key={c.id} className="rt-ac-cand" title={c.evidence} {...hoverProps(r, c)}>
                          <input type="checkbox" checked={extras.has(c.id)} onChange={() => toggleAutoConnectExtra(r.receiverId, c.id)} />
                          <span className="rt-mono rt-ac-emitter">{c.emitterRef}</span>
                          <span className={`rt-ac-tier t-${c.tier}`}>{c.tier}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              );
            })}
          </section>
        ))}
        {(ac.emitterSummary || []).length > 0 && (
          <div className="rt-ac-fanout">
            <button type="button" className="rt-btn subtle" onClick={() => setShowFanOut(!showFanOut)}>
              {showFanOut ? 'Hide' : 'Show'} emitter fan-out
            </button>
            {showFanOut && (
              <table data-testid="auto-connect-fanout">
                <tbody>
                  {ac.emitterSummary.map((e) => {
                    const added = chosenByEmitter.get(e.emitterRef) || 0;
                    return (
                      <tr key={e.emitterRef} className={added ? '' : 'idle'}>
                        <td className="rt-mono">{e.emitterRef}</td>
                        <td>{short(e.type)}</td>
                        <td title="existing connections + chosen here">{e.existingConnections} + {added} → {e.existingConnections + added}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {ac.skipped.length > 0 && (
          <div className="rt-ac-skipped">
            <button type="button" className="rt-btn subtle" onClick={() => setShowSkipped(!showSkipped)}>
              {showSkipped ? 'Hide' : 'Show'} {ac.skipped.length} skipped
            </button>
            {showSkipped && (
              <ul>
                {ac.skipped.map((s, i) => <li key={i} className="rt-mono">{s}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="rt-ac-ftr">
        <span className="rt-ac-spacer" />
        <button type="button" className="rt-btn" onClick={() => closeAutoConnect()}>Close</button>
        <button type="button" className="rt-btn primary" data-testid="auto-connect-apply" disabled={selected.length === 0 || ac.loading}
          onClick={() => applyAutoConnect()}>
          Add {selected.length} connection{selected.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

function MarkerList({ ids }) {
  const { markers } = useStudio();
  const list = (markers || []).filter((m) => ids.includes(m.elementId));
  if (list.length === 0) return null;
  return (
    <div className="rt-sys-markers">
      {list.map((m, i) => (
        <div key={i} className={`rt-diag-item ${m.kind === 'error' ? 'err' : 'warn'}`}>
          <span className={`rt-badge ${m.kind === 'error' ? 'diag-err' : 'diag-warn'}`}>{m.kind}</span>
          <span>{m.description || m.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Process = composable node container: name, executor threads and member nodes. */
function ProcessInspector({ node, layout, isReadOnly }) {
  const a = node.el.args || {};
  let members = [];
  try {
    members = JSON.parse(String(a.membersJson || '[]')).map((m) => m.name);
  } catch {
    members = [];
  }
  const candidates = layout.nodes.filter((n) => n.type === 'node:ros-node' && n.depth === 0);
  return (
    <aside className="rt-inspector-right rt-panel-pad">
      <div className="rt-section-hdr"><h3>Process (composable container)</h3></div>
      <div className="rt-field">
        <label>Name</label>
        <CommitInput value={String(a.processName || '')} disabled={isReadOnly}
          onCommit={(v) => v.trim() && editProperty(node.id, 'name', v.trim())} />
      </div>
      <div className="rt-field">
        <label>Executor threads</label>
        <CommitInput value={String(a.threads ?? 1)} type="number" disabled={isReadOnly}
          onCommit={(v) => Number(v) > 0 && editProperty(node.id, 'threads', String(Math.round(Number(v))))} />
      </div>
      <div className="rt-section-hdr"><h3>Member nodes ({members.length})</h3></div>
      {candidates.length === 0 ? (
        <small style={{ color: 'var(--rt-dim)' }}>No nodes in this system yet.</small>
      ) : (
        candidates.map((n) => {
          const name = String(n.el.args?.nodeName || n.id);
          const checked = members.includes(name);
          return (
            <label key={n.id} className="rt-checkbox-row">
              <input type="checkbox" disabled={isReadOnly} checked={checked}
                onChange={(e) => editProperty(node.id, e.target.checked ? 'addNode' : 'removeNode', name)} />
              <span>{name}</span>
            </label>
          );
        })
      )}
      <MarkerList ids={[node.id]} />
      {!isReadOnly && (
        <button type="button" className="rt-btn danger" style={{ marginTop: 10 }}
          onClick={() => { deleteElements([node.id]); setUIState({ selectedNodeId: null }); }}>
          <Trash2 size={13} /> Remove process
        </button>
      )}
    </aside>
  );
}

function AttachInput({ placeholder, onAttach }) {
  const [text, setText] = useState('');
  const attach = () => {
    const ref = text.trim();
    if (!ref) return;
    onAttach(ref);
    setText('');
  };
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input className="rt-input" style={{ fontFamily: 'var(--rt-mono)' }} placeholder={placeholder} value={text}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') attach(); }} />
      <button type="button" className="rt-btn" disabled={!text.trim()} onClick={attach}>Attach</button>
    </div>
  );
}

/** Host card section: the node's plugin slots, each with the plugins this system attaches. */
function SlotAttachments({ nodeId, slots, editable }) {
  if (!slots || slots.length === 0) return null;
  const setSlot = (slot, refs) => editProperty(nodeId, 'slot', refs.join(', '), { key: slot });
  return (
    <>
      <div className="rt-section-hdr"><h3><Plug size={13} /> Plugins by slot ({slots.length})</h3></div>
      {slots.map((sl) => (
        <div key={sl.slot} className="rt-slot-card" data-testid={`slot-${sl.slot}`}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12 }}>{sl.slot}</strong>
            <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
              {sl.base}{sl.multiple ? ' · several' : ' · one'}
            </small>
          </div>
          <div className="rt-chip-row">
            {sl.plugins.length === 0 && <small style={{ color: 'var(--rt-dim)' }}>No plugin attached in this system.</small>}
            {sl.plugins.map((ref) => (
              <span key={ref} className="rt-chip">
                <code>{ref}</code>
                {editable && (
                  <button type="button" className="rt-chip-x" title={`Detach ${ref}`}
                    onClick={() => setSlot(sl.slot, sl.plugins.filter((r) => r !== ref))}>
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
          {editable && (
            <AttachInput placeholder={sl.multiple || sl.plugins.length === 0 ? 'attach pkg.Plugin' : 'replace with pkg.Plugin'}
              onAttach={(ref) => setSlot(sl.slot, sl.multiple ? [...sl.plugins.filter((r) => r !== ref), ref] : [ref])} />
          )}
        </div>
      ))}
    </>
  );
}

function SystemInspector({ node, edge, layout }) {
  const { isReadOnly, gGraph } = useStudio();
  const rootView = readViewData(gGraph, 'system');
  const [newParam, setNewParam] = useState({ key: '', value: '' });

  if (edge) {
    const src = layout.ports.get(edge.sourceId);
    const tgt = layout.ports.get(edge.targetId);
    const nodeName = (id) => String(layout.nodes.find((n) => n.id === id)?.el.args?.nodeName || id);
    return (
      <aside className="rt-inspector-right rt-panel-pad">
        <div className="rt-section-hdr"><h3>Connection ({edge.kind})</h3></div>
        <p className="rt-sys-kv"><span>from</span><code>{src ? `${nodeName(src.nodeId)}.${src.name}` : edge.sourceId}</code></p>
        <p className="rt-sys-kv"><span>to</span><code>{tgt ? `${nodeName(tgt.nodeId)}.${tgt.name}` : edge.targetId}</code></p>
        <p style={{ fontSize: 11.5, color: 'var(--rt-muted)' }}>Drag an end handle onto another port to reconnect.</p>
        <MarkerList ids={[edge.id]} />
        {!isReadOnly && (
          <button type="button" className="rt-btn danger" onClick={() => { deleteElements([edge.id]); setUIState({ selectedEdgeId: null }); }}>
            <Trash2 size={13} /> Delete connection
          </button>
        )}
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="rt-inspector-right rt-panel-pad">
        <div className="rt-section-hdr"><h3>Inspector</h3><Contributions items={rootView?.contributions} /></div>
        <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>
          Select a node or wire. Drag from a port to another port to connect; layout is computed by the server (ELK).
          Dragging a node pins it (stored in the optional <code>.layout</code> sidecar).
        </p>
        <BlockInspector elementId="root" blocks={rootView?.blocks} available={rootView?.availableBlocks}
          location="SYSTEM" editable={!isReadOnly} />
      </aside>
    );
  }

  if (node.type === 'node:subsystem') {
    const name = String(node.el.args?.subSystemName || node.id);
    const collapsed = Boolean(node.el.args?.collapsed);
    return (
      <aside className="rt-inspector-right rt-panel-pad">
        <div className="rt-section-hdr"><h3>SubSystem</h3></div>
        <p className="rt-sys-kv"><span>system</span><code>{name}</code></p>
        <MarkerList ids={[node.id]} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {!isReadOnly && (
            <button type="button" className="rt-btn" onClick={() => toggleSubSystem(node.id, !collapsed)}>
              {collapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />} {collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          <button type="button" className="rt-btn" onClick={() => hostBridge.openSubsystemRosSystem({ subRef: name })}>
            <FileCode2 size={13} /> Open
          </button>
          {!isReadOnly && (
            <button type="button" className="rt-btn danger" onClick={() => { deleteElements([node.id]); setUIState({ selectedNodeId: null }); }}>
              <Trash2 size={13} /> Remove
            </button>
          )}
        </div>
      </aside>
    );
  }

  if (node.type === 'node:process') {
    return <ProcessInspector node={node} layout={layout} isReadOnly={isReadOnly} />;
  }

  const a = node.el.args || {};
  const params = parseParams(node);
  const editable = !isReadOnly && node.depth === 0;
  const view = readViewData(node.el, 'rosNode');
  return (
    <aside className="rt-inspector-right rt-panel-pad">
      <div className="rt-section-hdr"><h3>ROS Node</h3><Contributions items={view?.contributions} /></div>
      {node.depth > 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--rt-muted)' }}>Member of a subsystem — open the subsystem model to edit it.</p>
      )}
      <div className="rt-field">
        <label>Name</label>
        <CommitInput value={String(a.nodeName || '')} disabled={!editable} onCommit={(v) => editProperty(node.id, 'name', v)} />
      </div>
      <div className="rt-field">
        <label>Namespace</label>
        <CommitInput value={String(a.namespace || '')} placeholder="/robot1" disabled={!editable} onCommit={(v) => editProperty(node.id, 'namespace', v)} />
      </div>
      <div className="rt-field">
        <label>From (component)</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <code className="rt-sys-code">{String(a.from || '—')}</code>
          <button type="button" className="rt-btn icon-only" title="Open component model"
            onClick={() => hostBridge.openComponentRos2({ from: String(a.from || ''), label: String(a.nodeName || '') })}>
            <FileCode2 size={13} />
          </button>
        </div>
      </div>

      <div className="rt-section-hdr"><h3>Interfaces ({node.ports.length})</h3></div>
      {node.ports.map((p) => (
        <div key={p.id} className="rt-port-row" style={{ alignItems: 'center', gap: 6 }}>
          <span className={`rt-port-kind ${p.kind}`}>{KIND_META[p.kind]?.short || p.kind}</span>
          {editable ? (
            <CommitInput value={p.name} title={p.explicit ? 'Exposed interface name (remap)' : 'Inherited from the component; renaming exposes it'}
              onCommit={(v) => editProperty(node.id, 'interfaceName', v, { key: p.explicit ? p.name : String(layout.ports.get(p.id)?.name || p.name) })} />
          ) : (
            <strong style={{ fontSize: 12 }}>{p.name}</strong>
          )}
          <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>{p.spec.split('/').pop()}</small>
        </div>
      ))}

      <div className="rt-section-hdr"><h3>Parameters ({Object.keys(params).length})</h3></div>
      {Object.entries(params).map(([k, v]) => (
        <div key={k} className="rt-field">
          <label>{k}</label>
          <CommitInput value={String(v ?? '')} disabled={!editable} onCommit={(val) => editProperty(node.id, 'parameter', val, { key: k })} />
        </div>
      ))}
      {editable && (
        <div className="rt-field-row" style={{ display: 'flex', gap: 6 }}>
          <input className="rt-input" placeholder="parameter" value={newParam.key} onChange={(e) => setNewParam({ ...newParam, key: e.target.value })} />
          <input className="rt-input" placeholder="value" value={newParam.value} onChange={(e) => setNewParam({ ...newParam, value: e.target.value })} />
          <button type="button" className="rt-btn" disabled={!newParam.key.trim()}
            onClick={() => { editProperty(node.id, 'parameter', newParam.value, { key: newParam.key.trim() }); setNewParam({ key: '', value: '' }); }}>
            Set
          </button>
        </div>
      )}
      <SlotAttachments nodeId={node.id} slots={view?.slots} editable={editable} />
      <BlockInspector elementId={node.id} blocks={view?.blocks} available={rootView?.availableBlocks}
        location="ROS_NODE" editable={editable} />
      <MarkerList ids={[node.id, ...node.ports.map((p) => p.id)]} />
      {editable && (
        <button type="button" className="rt-btn danger" style={{ marginTop: 10 }}
          onClick={() => { deleteElements([node.id]); setUIState({ selectedNodeId: null }); }}>
          <Trash2 size={13} /> Delete node
        </button>
      )}
    </aside>
  );
}
