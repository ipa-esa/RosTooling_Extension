import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { editProperty } from '../state/studioStore';
import { CommitInput } from './CommitInput';

// ============================================================================
// Generic inspector for `@` blocks. Fields, their order, labels, help text and suggested
// values come from the block's schema and its hints (server view data); nothing here knows a
// particular plugin. Every edit is a GLSP setExtensionBlock / removeExtensionBlock operation.
// Suggested values are offered, never enforced: any value can be typed.
// ============================================================================

function orderedProperties(schema) {
  const props = schema?.schema?.properties || {};
  // The server already sends features in hint order; x-order breaks remaining ties.
  return Object.entries(props)
    .map(([key, prop], index) => ({ key, prop: prop || {}, index }))
    .sort((a, b) => {
      const oa = a.prop['x-order'];
      const ob = b.prop['x-order'];
      if (oa !== undefined && ob !== undefined && oa !== ob) return oa - ob;
      if (oa !== undefined && ob === undefined) return -1;
      if (oa === undefined && ob !== undefined) return 1;
      return a.index - b.index;
    });
}

function coerceScalar(text, type) {
  const t = String(text).trim();
  if (type === 'integer') {
    const n = Number.parseInt(t, 10);
    return Number.isNaN(n) ? t : n;
  }
  if (type === 'number') {
    const n = Number.parseFloat(t);
    return Number.isNaN(n) ? t : n;
  }
  if (type === 'boolean') return t === 'true';
  return t;
}

const isScalarType = (type) => ['string', 'integer', 'number', 'boolean', undefined].includes(type);

function displayValue(value, prop) {
  if (value === undefined || value === null) return '';
  if (prop.type === 'array' && Array.isArray(value) && isScalarType(prop.items?.type)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Parses an edited field; returns { ok, value } (value undefined removes the entry). */
function parseValue(text, prop) {
  const t = String(text).trim();
  if (t === '') return { ok: true, value: undefined };
  if (prop.type === 'array' && isScalarType(prop.items?.type)) {
    return { ok: true, value: t.split(',').map((s) => s.trim()).filter(Boolean).map((s) => coerceScalar(s, prop.items?.type)) };
  }
  if (prop.type === 'array' || prop.type === 'object') {
    try {
      return { ok: true, value: JSON.parse(t) };
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, value: coerceScalar(t, prop.type) };
}

function FieldInput({ id, prop, value, disabled, onCommit }) {
  const choices = prop.enum || prop['x-choices'] || [];
  if (prop.type === 'boolean') {
    return (
      <select className="rt-select" disabled={disabled} value={value === undefined ? '' : String(Boolean(value))}
        onChange={(e) => onCommit(e.target.value)}>
        <option value="">— not set —</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (prop.enum) {
    return (
      <select className="rt-select" disabled={disabled} value={value === undefined ? '' : String(value)}
        onChange={(e) => onCommit(e.target.value)}>
        <option value="">— not set —</option>
        {prop.enum.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    );
  }
  return (
    <>
      <CommitInput value={displayValue(value, prop)} disabled={disabled} list={choices.length ? id : undefined}
        placeholder={prop.type === 'array' && isScalarType(prop.items?.type) ? 'a, b, c' : prop.type === 'object' || prop.type === 'array' ? 'JSON' : ''}
        style={{ fontFamily: 'var(--rt-mono)' }} onCommit={onCommit} />
      {choices.length > 0 && (
        <datalist id={id}>{choices.map((c) => <option key={c} value={c} />)}</datalist>
      )}
    </>
  );
}

function BlockCard({ elementId, block, editable }) {
  const [error, setError] = useState(null);
  const entries = block.entries || {};
  const props = orderedProperties(block.schema);
  const known = new Set(props.map((p) => p.key));
  const extra = Object.keys(entries).filter((k) => !known.has(k));

  const commit = (next) => {
    setError(null);
    editProperty(elementId, 'setExtensionBlock', JSON.stringify(next), { key: block.name });
  };
  const commitField = (key, prop, text) => {
    const parsed = parseValue(text, prop);
    if (!parsed.ok) {
      setError(`${key}: not valid JSON`);
      return;
    }
    const next = { ...entries };
    if (parsed.value === undefined) delete next[key];
    else next[key] = parsed.value;
    commit(next);
  };

  return (
    <div className="rt-block-card" data-testid={`block-${block.name}`}>
      <div className="rt-section-hdr">
        <div>
          <code className="rt-block-name">@{block.name}</code>
          {block.schema?.schema?.title && <small className="rt-block-title"> {block.schema.schema.title}</small>}
        </div>
        {block.plugin && <small className="rt-block-key" title="Plugin that registers this block">{block.plugin}</small>}
        {editable && (
          <button type="button" className="rt-btn danger icon-only" title={`Remove @${block.name}`}
            onClick={() => editProperty(elementId, 'removeExtensionBlock', '', { key: block.name })}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {(block.schema?.schema?.description || block.schema?.description) && (
        <p className="rt-block-help">{block.schema.schema?.description || block.schema.description}</p>
      )}
      {!block.schema && (
        <p className="rt-block-help">No active plugin registers this block; its entries are edited as JSON.</p>
      )}
      {props.map(({ key, prop }) => (
        <div key={key} className="rt-field">
          <label title={prop.description || key}>
            {prop.title || key}
            {block.schema?.schema?.required?.includes(key) ? ' *' : ''}
            {prop.title && <small className="rt-block-key"> {key}</small>}
          </label>
          <FieldInput id={`rt-choices-${elementId}-${block.name}-${key}`} prop={prop} value={entries[key]} disabled={!editable}
            onCommit={(text) => commitField(key, prop, text)} />
          {prop.description && <small className="rt-block-help">{prop.description}</small>}
        </div>
      ))}
      {(extra.length > 0 || !block.schema) && (
        <div className="rt-field">
          <label>{block.schema ? 'Other entries (JSON)' : 'Entries (JSON)'}</label>
          <CommitInput value={JSON.stringify(Object.fromEntries((block.schema ? extra : Object.keys(entries)).map((k) => [k, entries[k]])))}
            disabled={!editable} style={{ fontFamily: 'var(--rt-mono)' }}
            onCommit={(text) => {
              try {
                const parsed = text.trim() ? JSON.parse(text) : {};
                const base = block.schema ? Object.fromEntries([...known].filter((k) => k in entries).map((k) => [k, entries[k]])) : {};
                commit({ ...base, ...parsed });
              } catch {
                setError('Entries: not valid JSON');
              }
            }} />
        </div>
      )}
      {error && <div className="rt-diag-item err" style={{ fontSize: 11.5 }}>{error}</div>}
    </div>
  );
}

/**
 * The `@` blocks of one element, plus "add block" for the blocks the active plugins offer at
 * `location` (System, RosNode, Node, Plugin; HookLocation names).
 */
export function BlockInspector({ elementId, blocks, available, location, editable, className = '' }) {
  const [choice, setChoice] = useState('');
  const present = new Set((blocks || []).map((b) => b.name));
  const addable = (available || []).filter((a) =>
    !present.has(a.name) && (!a.allowedLocations || a.allowedLocations.length === 0 || a.allowedLocations.includes(location)));
  if ((blocks || []).length === 0 && (!editable || addable.length === 0)) return null;
  return (
    <div className={`rt-blocks ${className}`}>
      <div className="rt-section-hdr"><h3>Plugin blocks ({(blocks || []).length})</h3></div>
      {(blocks || []).map((b) => <BlockCard key={b.name} elementId={elementId} block={b} editable={editable} />)}
      {editable && addable.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="rt-select" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">— add a block —</option>
            {addable.map((a) => <option key={a.name} value={a.name}>@{a.name} ({a.plugin})</option>)}
          </select>
          <button type="button" className="rt-btn" disabled={!choice}
            onClick={() => { editProperty(elementId, 'setExtensionBlock', '{}', { key: choice }); setChoice(''); }}>
            <Plus size={12} /> Add
          </button>
        </div>
      )}
    </div>
  );
}
