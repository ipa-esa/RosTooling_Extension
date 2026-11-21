import React from 'react';
import { Puzzle } from 'lucide-react';

// ============================================================================
// GUI contributions from the server's view data: { kind, plugin, data }. Core fills them in
// from the plugin registry; plugins send data, never code. A renderer is picked by `kind`;
// kinds without a renderer are skipped. The only kind is core's `badge`.
// ============================================================================

function BadgeContribution({ item }) {
  const data = item.data || {};
  return (
    <span className="rt-badge plugin" title={`Added by plugin ${data.title || item.plugin}`}>
      <Puzzle size={10} /> {data.label || item.plugin}
    </span>
  );
}

const RENDERERS = {
  badge: BadgeContribution,
};

/** Renders the contributions this client knows; unknown kinds are skipped. */
export function Contributions({ items }) {
  const known = (items || []).filter((c) => c && RENDERERS[c.kind]);
  if (known.length === 0) return null;
  return (
    <span className="rt-contributions">
      {known.map((c, i) => {
        const Renderer = RENDERERS[c.kind];
        return <Renderer key={`${c.kind}:${c.plugin}:${i}`} item={c} />;
      })}
    </span>
  );
}
