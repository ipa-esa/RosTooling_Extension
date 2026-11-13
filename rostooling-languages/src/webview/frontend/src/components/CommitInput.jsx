import React, { useEffect, useState } from 'react';

/**
 * Text input that keeps a local draft and commits once (blur / Enter) instead of per keystroke.
 * Every commit becomes exactly one GLSP operation; Escape reverts to the server value.
 */
export function CommitInput({ value, onCommit, disabled, placeholder, className = 'rt-input', list, type = 'text', style, title }) {
  const serverValue = value === undefined || value === null ? '' : String(value);
  const [draft, setDraft] = useState(serverValue);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(serverValue);
  }, [serverValue, focused]);

  const commit = () => {
    if (draft !== serverValue) onCommit(draft);
  };

  return (
    <input
      className={className}
      type={type}
      list={list}
      style={style}
      title={title}
      disabled={disabled}
      placeholder={placeholder}
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(serverValue);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
