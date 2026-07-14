import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';

export default function TagDropdown({ txn, anchorEl, onClose }) {
  const { tags, assignTagToPayee } = useApp();
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef(null);
  const ddRef = useRef(null);

  const allItems = [{ id: '', name: 'Untagged', color: 'var(--border2)' }, ...tags];
  const filtered = allItems.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

  // Set initial highlight to current tag
  useEffect(() => {
    const idx = filtered.findIndex(t => txn.tag === t.id || (!txn.tag && !t.id));
    setHighlighted(idx >= 0 ? idx : 0);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Position the dropdown relative to anchor
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 200 });
  useEffect(() => {
    if (!anchorEl || !ddRef.current) return;
    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.left;
    const minWidth = Math.max(200, rect.width);
    const ddRect = ddRef.current.getBoundingClientRect();
    if (left + minWidth > window.innerWidth) left = window.innerWidth - minWidth - 8;
    if (top + ddRect.height > window.innerHeight) top = rect.top - ddRect.height - 4;
    setPos({ top, left, minWidth });
  }, [anchorEl]);

  // Focus search on open
  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ddRef.current && !ddRef.current.contains(e.target) && !anchorEl?.contains(e.target)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorEl]);

  function select(tagId) {
    assignTagToPayee(txn, tagId || null);
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlighted]) select(filtered[highlighted].id); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Tab') { onClose(); }
  }

  // Scroll highlighted item into view
  useEffect(() => {
    const list = ddRef.current?.querySelector('.tag-dropdown-list');
    if (!list) return;
    const items = list.querySelectorAll('.tag-dropdown-item');
    items[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  return createPortal(
    <div
      ref={ddRef}
      className="tag-dropdown open"
      role="listbox"
      style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
    >
      <div className="tag-dropdown-search">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search tags…"
          autoComplete="off"
          aria-label="Search tags"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div className="tag-dropdown-list">
        {filtered.length ? filtered.map((t, i) => (
          <div
            key={t.id || '__none__'}
            role="option"
            aria-selected={txn.tag === t.id || (!txn.tag && !t.id)}
            className={`tag-dropdown-item${txn.tag === t.id || (!txn.tag && !t.id) ? ' selected' : ''}${i === highlighted ? ' highlighted' : ''}`}
            onMouseEnter={() => setHighlighted(i)}
            onMouseDown={e => { e.preventDefault(); select(t.id); }}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color || 'var(--border2)', display: 'inline-block', flexShrink: 0 }} />
            {t.name}
          </div>
        )) : (
          <div style={{ padding: '10px 12px', fontSize: '0.8rem', color: 'var(--text3)' }}>No tags found</div>
        )}
      </div>
    </div>,
    document.body
  );
}
