import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { formatDate } from '../utils/format';
import TagDropdown from '../components/TagDropdown';

const PAGE_SIZE = 50;

export default function Reports() {
  const { transactions, tags } = useApp();

  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [dropdown, setDropdown] = useState(null);

  // ── filter ────────────────────────────────────────────────────────────────
  const hasRange = from || to;
  const fromDate = from ? new Date(from) : null;
  const toDate   = to   ? new Date(to + 'T23:59:59') : null;

  const filtered = !hasRange ? [] : transactions.filter(t => {
    const d = new Date(t.date);
    if (isNaN(d)) return false;
    if (fromDate && d < fromDate) return false;
    if (toDate   && d > toDate)   return false;
    return true;
  }).sort((a, b) => new Date(a.date) - new Date(b.date));

  const credits = filtered.filter(t => t.amount > 0);
  const debits  = filtered.filter(t => t.amount < 0);
  const totalIncome   =  credits.reduce((s, t) => s + t.amount, 0);
  const totalExpenses = -debits.reduce((s, t)  => s + t.amount, 0);
  const net = totalIncome - totalExpenses;

  // ── pagination ────────────────────────────────────────────────────────────
  const total  = filtered.length;
  const pages  = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page   = Math.min(currentPage, pages);
  const slice  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleFrom(e) { setFrom(e.target.value); setCurrentPage(1); }
  function handleTo(e)   { setTo(e.target.value);   setCurrentPage(1); }

  function clearRange() { setFrom(''); setTo(''); setCurrentPage(1); }

  // ── CSV export ────────────────────────────────────────────────────────────
  function exportCSV() {
    const rows = [['Date','Payee','Type','Amount','Balance','Tag']].concat(
      filtered.map(t => {
        const tag = tags.find(g => g.id === t.tag);
        return [t.date, `"${t.payee.replace(/"/g,'""')}"`, t.txType, t.amount, t.balance ?? '', tag?.name ?? ''];
      })
    );
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    const label = [from, to].filter(Boolean).join('_to_') || 'all';
    a.download = `ledger_report_${label}.csv`; a.click();
  }

  function fmtAmt(v) {
    return 'RM ' + Math.abs(v).toLocaleString('en-MY', { minimumFractionDigits: 2 });
  }

  function openDropdown(e, txn) {
    e.stopPropagation();
    setDropdown({ txn, anchorEl: e.currentTarget });
  }

  // ── range label ───────────────────────────────────────────────────────────
  let rangeLabel = '';
  if (from && to)  rangeLabel = `${formatDate(from)} — ${formatDate(to)}`;
  else if (from)   rangeLabel = `From ${formatDate(from)}`;
  else if (to)     rangeLabel = `Up to ${formatDate(to)}`;

  return (
    <div className="page active">
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-sub">Summarise transactions between two dates</div>
        </div>
        {hasRange && total > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={exportCSV}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export CSV
          </button>
        )}
      </div>

      {/* ── date pickers ── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ minWidth: 180 }}>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>From</label>
            <input type="date" className="form-input" value={from} onChange={handleFrom} max={to || undefined} />
          </div>
          <div className="form-group" style={{ minWidth: 180 }}>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>To</label>
            <input type="date" className="form-input" value={to} onChange={handleTo} min={from || undefined} />
          </div>
          {hasRange && (
            <button className="btn btn-ghost btn-sm" style={{ marginBottom: 1 }} onClick={clearRange}>Clear</button>
          )}
        </div>
      </div>

      {/* ── summary cards ── */}
      {hasRange && (
        <>
          <div className="cards-row" style={{ marginBottom: 24 }}>
            <div className="card">
              <div className="card-accent-bar" style={{ background: 'linear-gradient(90deg,var(--green),#1aad70)' }} />
              <div className="card-label">Income</div>
              <div className="card-value green">{total ? fmtAmt(totalIncome) : '—'}</div>
              <div className="card-sub">{credits.length} transaction{credits.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="card">
              <div className="card-accent-bar" style={{ background: 'linear-gradient(90deg,var(--red),#cc3a46)' }} />
              <div className="card-label">Expenses</div>
              <div className="card-value red">{total ? fmtAmt(totalExpenses) : '—'}</div>
              <div className="card-sub">{debits.length} transaction{debits.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="card">
              <div className="card-accent-bar" style={{ background: 'linear-gradient(90deg,var(--accent),var(--accent2))' }} />
              <div className="card-label">Net</div>
              <div className={`card-value ${!total ? 'blue' : net >= 0 ? 'green' : 'red'}`}>
                {total ? `${net >= 0 ? '+' : '−'}${fmtAmt(Math.abs(net))}` : '—'}
              </div>
              <div className="card-sub">income − expenses</div>
            </div>
            <div className="card">
              <div className="card-accent-bar" style={{ background: 'linear-gradient(90deg,var(--yellow),#e6a800)' }} />
              <div className="card-label">Transactions</div>
              <div className="card-value blue">{total}</div>
              <div className="card-sub">{rangeLabel}</div>
            </div>
          </div>

          {/* ── transaction list ── */}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Payee</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Balance</th>
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
                        {t.amount < 0 ? '−' : '+'}RM {Math.abs(t.amount).toLocaleString('en-MY', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="td-balance">
                        {t.balance != null ? `RM ${t.balance.toLocaleString('en-MY', { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td>
                        {tag ? (
                          <div
                            className="tag-badge"
                            tabIndex={0} role="button"
                            style={{ background: `${tag.color}22`, borderColor: `${tag.color}55`, color: tag.color, cursor: 'pointer' }}
                            onClick={e => openDropdown(e, t)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDropdown(e, t); } }}
                          >
                            <span className="tag-dot" style={{ background: tag.color }} />
                            {tag.name}
                          </div>
                        ) : (
                          <div
                            className="tag-badge tag-untagged"
                            tabIndex={0} role="button"
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
                        <h3>No transactions in this range</h3>
                        <p>Try adjusting the dates</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* pagination */}
            {pages > 1 && (
              <div className="pagination">
                <div className="page-info">
                  Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} of {total}
                </div>
                <div className="page-btns">
                  <button className="page-btn" disabled={page === 1} onClick={() => setCurrentPage(p => p-1)}>‹</button>
                  {Array.from({ length: pages }, (_, i) => i+1)
                    .filter(i => i === 1 || i === pages || Math.abs(i - page) <= 2)
                    .reduce((acc, i, idx, arr) => {
                      if (idx > 0 && i - arr[idx-1] > 1) acc.push('…');
                      acc.push(i); return acc;
                    }, [])
                    .map((i, idx) => typeof i === 'string'
                      ? <span key={`e${idx}`} style={{ color: 'var(--text3)', padding: '0 4px' }}>…</span>
                      : <button key={i} className={`page-btn${i === page ? ' active' : ''}`} onClick={() => setCurrentPage(i)}>{i}</button>
                    )
                  }
                  <button className="page-btn" disabled={page === pages} onClick={() => setCurrentPage(p => p+1)}>›</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── empty prompt ── */}
      {!hasRange && (
        <div className="empty-state" style={{ marginTop: 48 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <h3>Pick a date range above</h3>
          <p>You can set just From, just To, or both</p>
        </div>
      )}

      {dropdown && (
        <TagDropdown txn={dropdown.txn} anchorEl={dropdown.anchorEl} onClose={() => setDropdown(null)} />
      )}
    </div>
  );
}
