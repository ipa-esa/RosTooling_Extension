import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Layers, ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import { KIND_META, SRC_SIDE } from '../state/studioStore';
import { hostBridge } from '../state/vscodeBridge';

export function SubsystemNodeCard({ data, selected }) {
  const sub = data.subsystem;
  const isFramed = data.isFramed;
  const ports = data.ports || [];
  const memberCount = data.memberCount || 0;
  const onToggleExpand = data.onToggleExpand;
  const interfaceFilter = data.interfaceFilter || 'all';

  const visiblePorts = ports.filter((p) => interfaceFilter === 'all' || p.iface.kind === interfaceFilter);
  const targetPorts = visiblePorts.filter((p) => SRC_SIDE[p.iface.kind] === false);
  const sourcePorts = visiblePorts.filter((p) => SRC_SIDE[p.iface.kind] === true);

  return (
    <div className={`rt-subsystem-card ${isFramed ? 'framed' : ''} ${selected ? 'selected' : ''}`}>
      <div className="rt-subsystem-hdr">
        <Layers size={16} style={{ color: '#fbbf24', flexShrink: 0 }} />
        <div className="rt-subsystem-hdr-title">
          <strong>{sub.ref}</strong>
          <small>{sub.fromFile || `${sub.ref}.rossystem`} · {memberCount} nodes</small>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {onToggleExpand && (
            <button
              type="button"
              className="rt-btn icon-only subtle"
              title={isFramed ? 'Collapse subsystem' : 'Expand subsystem frame'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(sub.ref);
              }}
            >
              {isFramed ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
          <button
            type="button"
            className="rt-btn icon-only subtle btn-open-sub"
            data-open-sub={sub.ref}
            title="Edit Subsystem in .rossystem View"
            onClick={(e) => {
              e.stopPropagation();
              hostBridge.openSubsystemRosSystem({ subRef: sub.ref, fromFile: sub.fromFile });
            }}
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>

      {!isFramed && (
        <div className="rt-ports-container">
          {targetPorts.length === 0 && sourcePorts.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--rt-muted)', textAlign: 'center' }}>
              Subsystem collapsed ({memberCount} internal nodes)
            </div>
          ) : (
            <>
              {targetPorts.map(({ handleId, nodeLabel, iface }) => {
                const meta = KIND_META[iface.kind] || { short: iface.kind, label: iface.kind };
                const displayName = iface.label || iface.name;
                return (
                  <div
                    key={handleId}
                    className={`rt-port-row target ${iface.kind}`}
                    title={`${nodeLabel} :: ${displayName}\nType: ${iface.type || 'Unspecified'}`}
                  >
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={handleId}
                      className={`rt-handle ${iface.kind}`}
                    />
                    <span className={`rt-port-kind ${iface.kind}`}>{meta.short}</span>
                    <div className="rt-port-info">
                      <span className="rt-port-name">{displayName}</span>
                      <span className="rt-port-type">
                        {nodeLabel} · {iface.type ? iface.type.split('/').pop() : 'untyped'}
                      </span>
                    </div>
                  </div>
                );
              })}

              {sourcePorts.map(({ handleId, nodeLabel, iface }) => {
                const meta = KIND_META[iface.kind] || { short: iface.kind, label: iface.kind };
                const displayName = iface.label || iface.name;
                return (
                  <div
                    key={handleId}
                    className={`rt-port-row source ${iface.kind}`}
                    title={`${nodeLabel} :: ${displayName}\nType: ${iface.type || 'Unspecified'}`}
                  >
                    <div className="rt-port-info">
                      <span className="rt-port-name">{displayName}</span>
                      <span className="rt-port-type">
                        {nodeLabel} · {iface.type ? iface.type.split('/').pop() : 'untyped'}
                      </span>
                    </div>
                    <span className={`rt-port-kind ${iface.kind}`}>{meta.short}</span>
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={handleId}
                      className={`rt-handle ${iface.kind}`}
                    />
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
