import React from 'react';
import { Cpu, AlertTriangle } from 'lucide-react';

export function ProcessGroupNode({ data, selected }) {
  const proc = data.process || { name: 'process', nodes: [], threads: 1 };
  const diags = data.diagnostics || [];
  const hasWarn = diags.length > 0;
  const threads = proc.threads != null ? proc.threads : 1;
  const memberCount = (proc.nodes || []).length;

  return (
    <div className={`rt-process-group ${selected ? 'selected' : ''}`}>
      <div className="rt-process-hdr">
        <div className="rt-process-title">
          <Cpu size={14} />
          <span>{proc.name}</span>
          <small style={{ opacity: 0.78, fontWeight: 500 }}>ComposableNodeContainer</small>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="rt-process-pill" title="Assigned member nodes">
            {memberCount} {memberCount === 1 ? 'node' : 'nodes'}
          </span>
          <span className="rt-process-pill" title="Executor thread count">
            {threads} {threads === 1 ? 'thread' : 'threads'}
          </span>
          {hasWarn && (
            <span className="rt-badge diag-warn" title={diags.map((d) => d.message).join('\n')}>
              <AlertTriangle size={11} /> {diags.length}
            </span>
          )}
        </div>
      </div>
      {memberCount === 0 && (
        <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--rt-muted)', fontSize: 11.5 }}>
          No nodes assigned yet — select this process to assign system nodes.
        </div>
      )}
    </div>
  );
}
