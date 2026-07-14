import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';

export default function EditTagModal({ tagId, onClose }) {
  const { tags, saveTag, addToast } = useApp();
  const tag = tags.find(t => t.id === tagId);
  const [name, setName] = useState(tag?.name || '');
  const [color, setColor] = useState(tag?.color || '#4f8cff');
  const [rules, setRules] = useState(tag?.rules ? [...tag.rules] : []);
  const [newRule, setNewRule] = useState('');
  const nameRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    requestAnimationFrame(() => nameRef.current?.focus());
  }, []);

  // Focus trap + Escape
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'Tab') {
        const modal = overlayRef.current?.querySelector('.modal');
        if (!modal) return;
        const focusable = modal.querySelectorAll('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function addRule() {
    if (!newRule.trim()) return;
    const vals = newRule.split(',').map(v => v.trim()).filter(Boolean);
    setRules(prev => {
      const next = [...prev];
      vals.forEach(v => { if (!next.includes(v)) next.push(v); });
      return next;
    });
    setNewRule('');
  }

  function removeRule(idx) {
    setRules(prev => prev.filter((_, i) => i !== idx));
  }

  function handleSave() {
    if (!name.trim()) { addToast('Tag name required', 'error'); return; }
    saveTag(tagId, name.trim(), color, rules);
    onClose();
  }

  if (!tag) return null;

  return (
    <div ref={overlayRef} className="modal-overlay open" role="dialog" aria-modal="true" aria-labelledby="editTagTitle">
      <div className="modal">
        <div className="modal-title" id="editTagTitle">Edit: {tag.name}</div>
        <div className="modal-sub">Payee keywords auto-tag all matching transactions. Case-insensitive partial match.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-row">
            <div className="form-group">
              <label>Tag Name</label>
              <input ref={nameRef} type="text" className="form-input" placeholder="e.g. Food & Dining" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="form-group" style={{ maxWidth: 80 }}>
              <label>Color</label>
              <input type="color" className="form-input" value={color} onChange={e => setColor(e.target.value)} />
            </div>
          </div>
          <div>
            <div className="form-group">
              <label>Payee Keywords (match against payee name)</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Restoran Hakim, KK Super, 7-Eleven"
                  style={{ flex: 1 }}
                  value={newRule}
                  onChange={e => setNewRule(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addRule(); }}
                />
                <button className="btn btn-ghost btn-sm" onClick={addRule}>Add</button>
              </div>
            </div>
            <div className="rule-list">
              {rules.map((r, i) => (
                <div key={i} className="rule-item">
                  <span className="rule-item-text">{r}</span>
                  <button className="rule-remove" onClick={() => removeRule(i)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>Save Tag</button>
          </div>
        </div>
      </div>
    </div>
  );
}
