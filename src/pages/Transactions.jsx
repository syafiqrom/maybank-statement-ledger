import { useState } from 'react';
import { useApp } from '../context/AppContext';
import MonthFilter from '../components/MonthFilter';
import TagDropdown from '../components/TagDropdown';
import { formatDate } from '../utils/format';

const PAGE_SIZE = 20;

// ── Main Transactions Page ───────────────────────────────────────────────────
export default function Transactions() {
  const { transactions, tags, selectedMonths, selectAllMonths, selectLatestMonth } = useApp();
  const [search, setSearch]       = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [tagFilter, setTagFilter]   = useState('all');
  const [sortCol, setSortCol]       = useState('date');
  const [sortDir, setSortDir]       = useState(-1);
  const [currentPage, setCurrentPage] = useState(1);
  const [dropdown, setDropdown]     = useState(null);

  // ── filter pipeline ──────────────────────────────────────────────────────
  let txns = transactions.filter(t => {
    const d = new Date(t.date);
    if (isNaN(d)) return false;
    const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return selectedMonths.includes(m);
  });

  const q = search.toLowerCase();
  if (q) txns = txns.filter(t => t.payee.toLowerCase().includes(q) || (t.txType || '').toLowerCase().includes(q));
  if (typeFilter === 'debit')    txns = txns.filter(t => t.amount < 0);
  if (typeFilter === 'credit')   txns = txns.filter(t => t.amount > 0);
  if (tagFilter === 'untagged')  txns = txns.filter(t => !t.tag);
  else if (tagFilter !== 'all')  txns = txns.filter(t => t.tag === tagFilter);

  txns = [...txns].sort((a, b) => {
    if (sortCol === 'date') {
      const diff = new Date(a.date) - new Date(b.date);
      if (diff !== 0) return diff * sortDir;
      return (a.order - b.order) * sortDir;
    }
    if (sortCol === 'amount')  return (a.amount  - b.amount)  * sortDir;
    if (sortCol === 'balance') return ((a.balance || 0) - (b.balance || 0)) * sortDir;
    const va = a.payee.toLowerCase(), vb = b.payee.toLowerCase();
    return va < vb ? -sortDir : va > vb ? sortDir : 0;
  });

  const total = txns.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page  = Math.min(currentPage, pages);
  const slice = txns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => -d);
    else { setSortCol(col); setSortDir(-1); }
    setCurrentPage(1);
  }

  function handleFilterChange(setter) {
    return (e) => { setter(e.target.value); setCurrentPage(1); };
  }

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportCSV() {
    const rows = [['Date', 'Payee', 'Type', 'Amount', 'Balance', 'Tag']].concat(
      txns.map(t => {
        const tag = tags.find(g => g.id === t.tag);
        return [t.date, `"${t.payee.replace(/"/g, '""')}"`, t.txType, t.amount, t.balance || '', tag ? tag.name : ''];
      })
    );
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ledger_transactions.csv';
    a.click();
  }

  function openDropdown(e, txn) {
    e.stopPropagation();
    setDropdown({ txn, anchorEl: e.currentTarget });
  }

  // ── pagination ────────────────────────────────────────────────────────────
  function renderPagination() {
    if (pages <= 1) return <div className="page-info">{total} transactions</div>;
    const from = (page - 1) * PAGE_SIZE + 1;
    const to   = Math.min(page * PAGE_SIZE, total);
    const start = Math.max(1, page - 2), end = Math.min(pages, page + 2);
    const btns = [];
    if (start > 1) {
      btns.push(<button key="1" className="page-btn" onClick={() => setCurrentPage(1)}>1</button>);
      if (start > 2) btns.push(<span key="e1" style={{ color: 'var(--text3)', padding: '0 4px' }}>…</span>);
    }
    for (let i = start; i <= end; i++) btns.push(
      <button key={i} className={`page-btn${i === page ? ' active' : ''}`} onClick={() => setCurrentPage(i)}>{i}</button>
    );
    if (end < pages) {
      if (end < pages - 1) btns.push(<span key="e2" style={{ color: 'var(--text3)', padding: '0 4px' }}>…</span>);
      btns.push(<button key={pages} className="page-btn" onClick={() => setCurrentPage(pages)}>{pages}</button>);
    }
    return (
      <div className="pagination">
        <div className="page-info">Showing {from}–{to} of {total}</div>
        <div className="page-btns">
          <button className="page-btn" disabled={page === 1} onClick={() => setCurrentPage(p => p - 1)}>‹</button>
          {btns}
          <button className="page-btn" disabled={page === pages} onClick={() => setCurrentPage(p => p + 1)}>›</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page active">
      <div className="page-header">
        <div>
          <div className="page-title">Transactions</div>
          <div className="page-sub">{total} transaction{total !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <MonthFilter onSelectAll={selectAllMonths} onSelectLatest={selectLatestMonth} />

      <div className="table-controls">
        <div className="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" className="search-input" placeholder="Search transactions…" value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} />
        </div>
        <select className="filter-select" value={typeFilter} onChange={handleFilterChange(setTypeFilter)}>
          <option value="all">All types</option>
          <option value="debit">Expenses</option>
          <option value="credit">Income</option>
        </select>
        <select className="filter-select" value={tagFilter} onChange={handleFilterChange(setTagFilter)}>
          <option value="all">All tags</option>
          <option value="untagged">Untagged</option>
          {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export CSV
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th data-sort="date"    className={sortCol === 'date'    ? 'sorted' : ''} onClick={() => handleSort('date')}>Date <span>↕</span></th>
              <th data-sort="desc"    className={sortCol === 'desc'    ? 'sorted' : ''} onClick={() => handleSort('desc')}>Payee <span>↕</span></th>
              <th>Type</th>
              <th data-sort="amount"  className={sortCol === 'amount'  ? 'sorted' : ''} onClick={() => handleSort('amount')}>Amount <span>↕</span></th>
              <th data-sort="balance" className={sortCol === 'balance' ? 'sorted' : ''} onClick={() => handleSort('balance')}>Balance <span>↕</span></th>
              <th>Tag</th>
            </tr>
          </thead>
          <tbody>
            {slice.length ? slice.map(t => {
              const tag = tags.find(g => g.id === t.tag);
              return (
                <tr key={t.id}>
                  <td className="td-date">{formatDate(t.date)}</td>
                  <td className="td-desc" title={t.payee}>{t.payee}</td>
                  <td className="td-type">{t.txType || ''}</td>
                  <td className={`td-amount ${t.amount < 0 ? 'debit' : 'credit'}`}>
                    {t.amount < 0 ? '-' : '+'}RM {Math.abs(t.amount).toLocaleString('en-MY', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="td-balance">
                    {t.balance != null ? `RM ${t.balance.toLocaleString('en-MY', { minimumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td>
                    {tag ? (
                      <div
                        className="tag-badge"
                        tabIndex={0}
                        role="button"
                        aria-haspopup="listbox"
                        aria-label={`Tag: ${tag.name}, click to change`}
                        style={{ background: `${tag.color}22`, borderColor: `${tag.color}55`, color: tag.color, cursor: 'pointer' }}
                        onClick={e => openDropdown(e, t)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(e, t); } }}
                      >
                        <span className="tag-dot" style={{ background: tag.color }} />{tag.name}
                      </div>
                    ) : (
                      <div
                        className="tag-badge tag-untagged"
                        tabIndex={0}
                        role="button"
                        aria-haspopup="listbox"
                        aria-label="Untagged, click to assign a tag"
                        style={{ cursor: 'pointer' }}
                        onClick={e => openDropdown(e, t)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(e, t); } }}
                      >
                        + Tag
                      </div>
                    )}
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
                    <h3>No transactions</h3>
                    <p>Import PDF statements or adjust filters</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {total > 0 && renderPagination()}
      </div>

      {dropdown && (
        <TagDropdown
          txn={dropdown.txn}
          anchorEl={dropdown.anchorEl}
          onClose={() => setDropdown(null)}
        />
      )}
    </div>
  );
}