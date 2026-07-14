import { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import EditTagModal from '../components/EditTagModal';

export default function Tags() {
  const {
    tags, transactions, payeeTags,
    createTag, deleteTag,
    loadTagsFromJSON, buildTagsJSON,
    tagsUnsaved, setTagsUnsaved, tagsFileName, setTagsFileName,
    addToast,
  } = useApp();

  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState('#4f8cff');
  const [editingId, setEditingId] = useState(null);
  const fileInputRef = useRef(null);

  // Tags file status
  const statusCls = tagsUnsaved ? 'unsaved' : (tagsFileName !== 'tags.json' ? 'loaded' : '');
  const statusMsg = tagsUnsaved
    ? 'Unsaved changes — click "Save Tags JSON"'
    : (tagsFileName !== 'tags.json' ? `Loaded: ${tagsFileName}` : 'No tags file loaded');

  function handleCreate() {
    if (!newName.trim()) { addToast('Enter a tag name', 'error'); return; }
    createTag(newName.trim(), newColor);
    setNewName('');
    setNewColor('#4f8cff');
  }

  function handleImport() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      loadTagsFromJSON(data, file.name);
    } catch (err) {
      addToast('Failed to load tags: ' + err.message, 'error');
    }
  }

  function handleExport() {
    if (!tags.length) { addToast('No tags to save', 'warning'); return; }
    const data = buildTagsJSON();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = tagsFileName;
    a.click();
    setTagsUnsaved(false);
    setTagsFileName(tagsFileName);
    addToast(`Tags saved to "${tagsFileName}"`, 'success');
  }

  return (
    <div className="page active">
      <div className="page-header">
        <div>
          <div className="page-title">Tag Manager</div>
          <div className="page-sub">Tags auto-apply by payee name. Tags are stored in a portable JSON file — import and export to keep them across sessions.</div>
        </div>
        <div className="tags-toolbar">
          <div className={`tags-file-status ${statusCls}`}>
            {statusCls === 'loaded' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            )}
            {statusMsg}
          </div>
          <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="btn btn-ghost btn-sm" onClick={handleImport}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Load Tags JSON
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleExport}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Save Tags JSON
          </button>
        </div>
      </div>

      <div className="tags-grid">
        {tags.map(tag => {
          const count = transactions.filter(t => t.tag === tag.id).length;
          const taggedPayees = Object.entries(payeeTags).filter(([, v]) => v === tag.id).map(([k]) => k).slice(0, 5);
          return (
            <div key={tag.id} className="tag-card">
              <div className="tag-card-actions">
                <button className="icon-btn" onClick={() => setEditingId(tag.id)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button className="icon-btn danger" onClick={() => { if (confirm('Delete this tag?')) deleteTag(tag.id); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                </button>
              </div>
              <div className="tag-card-header">
                <div className="tag-color-swatch" style={{ background: tag.color }} />
                <div className="tag-card-name">{tag.name}</div>
              </div>
              <div className="tag-card-count">
                {count} transaction{count !== 1 ? 's' : ''} · <span style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem' }}>{tag.color}</span>
              </div>
              {taggedPayees.length ? (
                <div className="tag-payees">
                  {taggedPayees.map(p => <span key={p} className="payee-chip">{p}</span>)}
                </div>
              ) : (
                <div style={{ fontSize: '0.73rem', color: 'var(--text3)', marginTop: 6 }}>No payees assigned yet</div>
              )}
              {tag.rules && tag.rules.length > 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 6 }}>
                  Rules: {tag.rules.slice(0, 3).map((r, i) => <span key={i} style={{ fontFamily: 'var(--mono)' }}>{r}{i < Math.min(tag.rules.length, 3) - 1 ? ', ' : ''}</span>)}
                  {tag.rules.length > 3 && `…+${tag.rules.length - 3}`}
                </div>
              )}
            </div>
          );
        })}

        {/* New tag card */}
        <div className="new-tag-card">
          <h3>+ New Tag</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Food & Dining"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>
            <div className="form-group" style={{ maxWidth: 80 }}>
              <label>Color</label>
              <input type="color" className="form-input" value={newColor} onChange={e => setNewColor(e.target.value)} />
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleCreate}>Create Tag</button>
        </div>
      </div>

      {editingId && (
        <EditTagModal tagId={editingId} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}
