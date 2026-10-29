import React from 'react';
import { Lock } from 'lucide-react';

export function ReadOnlyBanner({ isReadOnly, docFileName }) {
  if (!isReadOnly) return null;
  const shortName = docFileName ? docFileName.split(/[\\/]/).slice(-2).join('/') : 'Catalogue Model';
  return (
    <div id="readOnlyBadge" className="rt-readonly-banner" role="status">
      <div className="rt-ro-left">
        <Lock size={14} />
        <span>🔒 Core Catalogue Model (Read-Only)</span>
        <span className="rt-ro-sub">— Core Catalogue (Read-Only): {shortName}</span>
      </div>
      <span className="rt-ro-sub">Inspection, search & navigation enabled · Editing disabled</span>
    </div>
  );
}
