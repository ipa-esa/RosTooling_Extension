import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Download, RefreshCw, Trash2, FileCode2, ChevronsDownUp, ChevronsUpDown, Loader2, Cable } from 'lucide-react';
import {
  useStudio,
  setUIState,
  editProperty,
  deleteElements,
  toggleSubSystem,
  KIND_META,
} from '../state/studioStore';
import { hostBridge } from '../state/vscodeBridge';
import { CommitInput } from '../components/CommitInput';
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
      </div>
      <SystemInspector node={selectedNode} edge={selectedEdge} layout={layout} />
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

function SystemInspector({ node, edge, layout }) {
  const { isReadOnly } = useStudio();
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
        <div className="rt-section-hdr"><h3>Inspector</h3></div>
        <p style={{ fontSize: 12, color: 'var(--rt-muted)' }}>
          Select a node or wire. Drag from a port to another port to connect; layout is computed by the server (ELK).
          Dragging a node pins it (stored in the optional <code>.layout</code> sidecar).
        </p>
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
  return (
    <aside className="rt-inspector-right rt-panel-pad">
      <div className="rt-section-hdr"><h3>ROS Node</h3></div>
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
