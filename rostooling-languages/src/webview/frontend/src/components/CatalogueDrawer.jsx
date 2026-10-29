import React, { useState, useMemo } from 'react';
import {
  X,
  Search,
  Box,
  Layers,
  Braces,
  FolderOpen,
  RefreshCw,
  Plus,
  Copy,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import {
  useStudio,
  setUIState,
  importCatalogueNode,
  importCatalogueSubsystem,
  normalizeCatalogueInterfaces,
  KIND_META,
  showToast,
} from '../state/studioStore';
import { hostBridge } from '../state/vscodeBridge';

export function filterCatalogueSystems(rawSystems, currentSysName, docBaseName, searchQuery = '') {
  const q = String(searchQuery || '').trim().toLowerCase();
  const filtered = [];
  (rawSystems || []).forEach((sys) => {
    const sysName = sys?.system || '';
    if (!sysName) return;
    if (currentSysName && (sysName === currentSysName || sysName === docBaseName)) return;
    if (
      q &&
      !sysName.toLowerCase().includes(q) &&
      !(sys.file || '').toLowerCase().includes(q) &&
      !Object.keys(sys.nodes || {}).some((n) => n.toLowerCase().includes(q))
    ) {
      return;
    }
    filtered.push(sys);
  });
  return filtered;
}

export function CatalogueDrawer() {
  const studio = useStudio();
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [catTypeFilter, setCatTypeFilter] = useState('all');

  const isOpen = studio.catalogueOpen;
  const activeCatTab = studio.catalogueTab || 'nodes';
  const isReadOnly = studio.isReadOnly;
  const mode = studio.mode;

  const currentSysName = studio.project?.system?.name || '';
  const docBaseName = studio.docFileName
    ? studio.docFileName.replace(/^.*[\\/]/, '').replace(/\.rossystem$/, '')
    : '';

  const nodeEntries = useMemo(() => {
    const rawMap = studio.nodeIndex?.nodes || {};
    const list = Object.entries(rawMap).map(([key, entry]) => {
      const ifaces = normalizeCatalogueInterfaces(entry?.interfaces);
      return {
        key,
        entry,
        name: entry?.node || entry?.artifact || key.split('.').pop() || key,
        pkg: entry?.pkg || key.split('.')[0] || 'ros_pkg',
        source: entry?.source || 'catalogue',
        ifaces,
      };
    });
    const q = search.trim().toLowerCase();
    return list
      .filter((item) => {
        if (kindFilter !== 'all' && !item.ifaces.some((f) => f.kind === kindFilter)) return false;
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          item.pkg.toLowerCase().includes(q) ||
          item.source.toLowerCase().includes(q) ||
          item.ifaces.some(
            (f) => f.name.toLowerCase().includes(q) || (f.type || '').toLowerCase().includes(q)
          )
        );
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [studio.nodeIndex, search, kindFilter]);

  const systemEntries = useMemo(() => {
    const rawSystems = studio.nodeIndex?._systems || studio.nodeIndex?.systems || [];
    return filterCatalogueSystems(rawSystems, currentSysName, docBaseName, search);
  }, [studio.nodeIndex, search, currentSysName, docBaseName]);

  const typeEntries = useMemo(() => {
    const rawTypes = studio.typeIndex?.types || {};
    const q = search.trim().toLowerCase();
    return Object.entries(rawTypes)
      .map(([typeKey, info]) => ({
        key: typeKey,
        category: info?.category || info?.kind || (typeKey.includes('/srv/') ? 'srv' : typeKey.includes('/action/') ? 'action' : 'msg'),
        pkg: info?.pkg || typeKey.split('/')[0] || '',
        source: info?.source || '',
      }))
      .filter((t) => {
        if (catTypeFilter !== 'all' && t.category !== catTypeFilter) return false;
        if (!q) return true;
        return t.key.toLowerCase().includes(q) || t.pkg.toLowerCase().includes(q);
      })
      .slice(0, 250);
  }, [studio.typeIndex, search, catTypeFilter]);

  if (!isOpen) return null;

  const sources = studio.nodeIndex?.sources || studio.typeIndex?.sources || [];
  const customFolders = studio.nodeIndex?.customFolders || [];

  return (
    <div
      className="rt-drawer-backdrop"
      onClick={() => setUIState({ catalogueOpen: false })}
    >
      <aside className="rt-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="rt-drawer-hdr">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Box size={17} style={{ color: '#60a5fa' }} />
            <strong style={{ fontSize: 14 }}>RosTooling Model Catalogue</strong>
          </div>
          <button
            type="button"
            className="rt-btn icon-only subtle"
            onClick={() => setUIState({ catalogueOpen: false })}
            title="Close Catalogue"
          >
            <X size={16} />
          </button>
        </div>

        <div className="rt-drawer-tabs">
          {mode === 'system' && (
            <>
              <button
                type="button"
                className={`rt-btn ${activeCatTab === 'nodes' ? 'primary' : ''}`}
                onClick={() => setUIState({ catalogueTab: 'nodes' })}
              >
                <Box size={13} /> Nodes ({nodeEntries.length})
              </button>
              <button
                type="button"
                className={`rt-btn ${activeCatTab === 'systems' ? 'primary' : ''}`}
                onClick={() => setUIState({ catalogueTab: 'systems' })}
              >
                <Layers size={13} /> Subsystems ({systemEntries.length})
              </button>
            </>
          )}
          <button
            type="button"
            className={`rt-btn ${activeCatTab === 'types' ? 'primary' : ''}`}
            onClick={() => setUIState({ catalogueTab: 'types' })}
          >
            <Braces size={13} /> Types
          </button>
          <button
            type="button"
            className={`rt-btn ${activeCatTab === 'sources' ? 'primary' : ''}`}
            onClick={() => setUIState({ catalogueTab: 'sources' })}
          >
            <FolderOpen size={13} /> Sources
          </button>
        </div>

        {activeCatTab !== 'sources' && (
          <div style={{ padding: '10px 14px 4px', display: 'flex', gap: 8 }}>
            <div className="rt-search-box" style={{ flex: 1 }}>
              <Search size={14} />
              <input
                autoFocus
                placeholder={
                  activeCatTab === 'nodes'
                    ? 'Search nodes, packages, topics...'
                    : activeCatTab === 'systems'
                    ? 'Search .rossystem subsystems...'
                    : 'Search ROS 2 msg / srv / action types...'
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {activeCatTab === 'nodes' && (
              <select
                className="rt-select"
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
              >
                <option value="all">All Ports</option>
                {Object.entries(KIND_META).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            )}
            {activeCatTab === 'types' && (
              <select
                className="rt-select"
                value={catTypeFilter}
                onChange={(e) => setCatTypeFilter(e.target.value)}
              >
                <option value="all">All Categories</option>
                <option value="msg">Messages (msg)</option>
                <option value="srv">Services (srv)</option>
                <option value="action">Actions (action)</option>
              </select>
            )}
          </div>
        )}

        <div className="rt-drawer-body">
          {activeCatTab === 'nodes' && (
            <>
              {nodeEntries.length === 0 ? (
                <div className="rt-empty-state">
                  No matching component nodes found. Try syncing GitHub repositories or adding a custom folder in Sources.
                </div>
              ) : (
                nodeEntries.map(({ key, entry, name, pkg, source, ifaces }) => (
                  <div
                    key={key}
                    className="rt-cat-item"
                    draggable={!isReadOnly && mode === 'system'}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        'application/rostooling-node',
                        JSON.stringify({ key, entry })
                      );
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 12.5 }}>{name}</div>
                      <div style={{ fontSize: 11, color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
                        {pkg} · {source} · {ifaces.length} interfaces
                      </div>
                    </div>
                    {!isReadOnly && mode === 'system' && (
                      <button
                        type="button"
                        className="rt-btn primary"
                        onClick={() => importCatalogueNode(key, entry)}
                      >
                        <Plus size={13} /> Import
                      </button>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {activeCatTab === 'systems' && (
            <>
              {systemEntries.length === 0 ? (
                <div className="rt-empty-state">
                  No external `.rossystem` models discovered in workspace or catalogue.
                </div>
              ) : (
                systemEntries.map((sys) => {
                  const nodeCount = Object.keys(sys.nodes || {}).length;
                  return (
                    <div key={sys.system} className="rt-cat-item">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 12.5 }}>{sys.system}</div>
                        <div style={{ fontSize: 11, color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
                          {sys.file || `${sys.system}.rossystem`} · {nodeCount} nodes
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="rt-btn"
                          title="Open Subsystem in Visual Studio"
                          onClick={() =>
                            hostBridge.openSubsystemRosSystem({
                              subRef: sys.system,
                              fromFile: sys.file,
                            })
                          }
                        >
                          <ExternalLink size={13} />
                        </button>
                        {!isReadOnly && mode === 'system' && (
                          <button
                            type="button"
                            className="rt-btn primary"
                            onClick={() => importCatalogueSubsystem(sys)}
                          >
                            <Plus size={13} /> Import
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {activeCatTab === 'types' && (
            <>
              {typeEntries.length === 0 ? (
                <div className="rt-empty-state">No matching ROS communication types found.</div>
              ) : (
                typeEntries.map((t) => (
                  <div key={t.key} className="rt-cat-item">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, fontFamily: 'var(--rt-mono)' }}>
                        {t.key}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--rt-muted)' }}>
                        {t.category.toUpperCase()} · {t.pkg}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rt-btn"
                      onClick={() => {
                        if (navigator?.clipboard?.writeText) {
                          navigator.clipboard.writeText(t.key);
                        }
                        showToast(`Copied "${t.key}" to clipboard`);
                      }}
                    >
                      <Copy size={12} /> Copy
                    </button>
                  </div>
                ))
              )}
            </>
          )}

          {activeCatTab === 'sources' && (
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="rt-btn primary"
                  onClick={() => {
                    hostBridge.pullCatalogue();
                    showToast('Syncing RosModelsCatalog & RosCommonObjects from GitHub...');
                  }}
                >
                  <RefreshCw size={13} /> Sync GitHub Catalogue
                </button>
                <button
                  type="button"
                  className="rt-btn"
                  onClick={() => hostBridge.browseCatalogueFolder()}
                >
                  <FolderOpen size={13} /> Add Custom Folder...
                </button>
              </div>

              <div className="rt-section-hdr">
                <h3>Indexed Catalogue Sources ({sources.length})</h3>
              </div>
              {sources.length === 0 ? (
                <p style={{ color: 'var(--rt-muted)', fontSize: 12 }}>
                  Using bundled offline index. Click Sync GitHub Catalogue or Add Custom Folder to expand.
                </p>
              ) : (
                sources.map((src) => (
                  <div key={src} className="rt-cat-item">
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{src}</span>
                    <span className="rt-badge ns">Indexed</span>
                  </div>
                ))
              )}

              {customFolders.length > 0 && (
                <>
                  <div className="rt-section-hdr">
                    <h3>Custom Folders</h3>
                  </div>
                  {customFolders.map((cf) => (
                    <div key={cf.id} className="rt-cat-item">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ display: 'block', fontSize: 12 }}>{cf.name}</strong>
                        <small style={{ color: 'var(--rt-muted)', fontFamily: 'var(--rt-mono)' }}>
                          {cf.path}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="rt-btn danger icon-only"
                        title="Remove folder from Catalogue"
                        onClick={() => hostBridge.removeCatalogueFolder(cf.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
