import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Box, Activity, Sliders, AlertCircle, AlertTriangle } from 'lucide-react';
import { KIND_META, SRC_SIDE } from '../state/studioStore';

export function RosNodeCard({ data, selected }) {
  const node = data.node;
  const diags = data.diagnostics || [];
  const interfaceFilter = data.interfaceFilter || 'all';

  const errCount = diags.filter((d) => d.severity === 'error').length;
  const warnCount = diags.filter((d) => d.severity === 'warning').length;

  const exposedIfaces = (node.ifaces || []).filter((f) => {
    if (f.exposed === false) return false;
    if (interfaceFilter !== 'all' && f.kind !== interfaceFilter) return false;
    return true;
  });

  const targetPorts = exposedIfaces.filter((f) => SRC_SIDE[f.kind] === false);
  const sourcePorts = exposedIfaces.filter((f) => SRC_SIDE[f.kind] === true);

  const totalParams = (node.params || []).length;
  const activeParams = (node.params || []).filter(
    (p) => p.exposed !== false && ((p.sysValue !== undefined && p.sysValue !== '') || (p.value !== undefined && p.value !== ''))
  ).length;

  const subtitle = node.from || (node.pkg ? `${node.pkg}.${node.artifact || node.label}` : node.artifact || '');

  return (
    <div
      className={`rt-node-card ${selected ? 'selected' : ''} ${errCount > 0 ? 'has-error' : ''} ${warnCount > 0 ? 'has-warning' : ''}`}
    >
      <div className="rt-node-hdr">
        <Box size={16} className="rt-node-hdr-icon" />
        <div className="rt-node-hdr-titles">
          <strong title={node.label}>{node.label}</strong>
          {subtitle && <small title={subtitle}>{subtitle}</small>}
        </div>
      </div>

      {(node.isLifecycle || node.namespace || totalParams > 0 || errCount > 0 || warnCount > 0 || node.subRef) && (
        <div className="rt-node-badges">
          {node.isLifecycle && (
            <span className="rt-badge lifecycle" title="ROS 2 Managed LifecycleNode">
              <Activity size={10} /> LifecycleNode
            </span>
          )}
          {node.namespace && (
            <span className="rt-badge ns" title={`Namespace: ${node.namespace}`}>
              ns: {node.namespace}
            </span>
          )}
          {totalParams > 0 && (
            <span className="rt-badge params" title={`${activeParams} configured of ${totalParams} parameters`}>
              <Sliders size={10} /> {activeParams}/{totalParams}
            </span>
          )}
          {node.subRef && (
            <span className="rt-badge ns" title={`Member of subsystem ${node.subRef}`}>
              sub: {node.subRef}
            </span>
          )}
          {errCount > 0 && (
            <span className="rt-badge diag-err" title={diags.map((d) => d.message).join('\n')}>
              <AlertCircle size={10} /> {errCount}
            </span>
          )}
          {warnCount > 0 && (
            <span className="rt-badge diag-warn" title={diags.map((d) => d.message).join('\n')}>
              <AlertTriangle size={10} /> {warnCount}
            </span>
          )}
        </div>
      )}

      <div className="rt-ports-container">
        {targetPorts.length === 0 && sourcePorts.length === 0 ? (
          <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--rt-muted)', textAlign: 'center' }}>
            No exposed interfaces{interfaceFilter !== 'all' ? ` (${interfaceFilter})` : ''}
          </div>
        ) : (
          <>
            {targetPorts.map((iface) => {
              const displayLabel = iface.label || iface.name;
              const shortType = iface.type ? iface.type.split('/').pop() : 'untyped';
              const meta = KIND_META[iface.kind] || { short: iface.kind, label: iface.kind };
              const hasActiveStates = node.isLifecycle && iface.activeStates && iface.activeStates.length > 0;
              return (
                <div
                  key={iface.id}
                  className={`rt-port-row target ${iface.kind}`}
                  title={`${meta.label}: ${displayLabel}${displayLabel !== iface.name ? ` (ref: ${iface.name})` : ''}\nType: ${iface.type || 'Unspecified'}${hasActiveStates ? `\nActive in: ${iface.activeStates.join(', ')}` : ''}`}
                >
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={iface.id}
                    className={`rt-handle ${iface.kind}`}
                  />
                  <span className={`rt-port-kind ${iface.kind}`}>{meta.short}</span>
                  <div className="rt-port-info">
                    <span className="rt-port-name">
                      {displayLabel}
                      {hasActiveStates && (
                        <span style={{ marginLeft: 4, color: 'var(--rt-lifecycle)', fontSize: 9.5 }}>
                          [{iface.activeStates.join(',')}]
                        </span>
                      )}
                    </span>
                    <span className="rt-port-type">{shortType}</span>
                  </div>
                </div>
              );
            })}

            {sourcePorts.map((iface) => {
              const displayLabel = iface.label || iface.name;
              const shortType = iface.type ? iface.type.split('/').pop() : 'untyped';
              const meta = KIND_META[iface.kind] || { short: iface.kind, label: iface.kind };
              const hasActiveStates = node.isLifecycle && iface.activeStates && iface.activeStates.length > 0;
              return (
                <div
                  key={iface.id}
                  className={`rt-port-row source ${iface.kind}`}
                  title={`${meta.label}: ${displayLabel}${displayLabel !== iface.name ? ` (ref: ${iface.name})` : ''}\nType: ${iface.type || 'Unspecified'}${hasActiveStates ? `\nActive in: ${iface.activeStates.join(', ')}` : ''}`}
                >
                  <div className="rt-port-info">
                    <span className="rt-port-name">
                      {hasActiveStates && (
                        <span style={{ marginRight: 4, color: 'var(--rt-lifecycle)', fontSize: 9.5 }}>
                          [{iface.activeStates.join(',')}]
                        </span>
                      )}
                      {displayLabel}
                    </span>
                    <span className="rt-port-type">{shortType}</span>
                  </div>
                  <span className={`rt-port-kind ${iface.kind}`}>{meta.short}</span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={iface.id}
                    className={`rt-handle ${iface.kind}`}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
