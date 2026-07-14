export default function Sidebar({ activePage, onNavigate, theme, onToggleTheme }) {
  return (
    <nav id="sidebar">
      <div className="logo">
        <div className="logo-icon">M</div>
        Ledger
      </div>

      <div className="nav-section">
        <div className="nav-label">Overview</div>
        <button className={`nav-item${activePage === 'dashboard' ? ' active' : ''}`} onClick={() => onNavigate('dashboard')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Dashboard
        </button>
        <button className={`nav-item${activePage === 'transactions' ? ' active' : ''}`} onClick={() => onNavigate('transactions')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          Transactions
        </button>
      </div>

      <div className="nav-section" style={{ marginTop: 8 }}>
        <div className="nav-label">Manage</div>
        <button className={`nav-item${activePage === 'reports' ? ' active' : ''}`} onClick={() => onNavigate('reports')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Reports
        </button>
        <button className={`nav-item${activePage === 'import' ? ' active' : ''}`} onClick={() => onNavigate('import')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Import
        </button>
        <button className={`nav-item${activePage === 'tags' ? ' active' : ''}`} onClick={() => onNavigate('tags')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>
          Tag Manager
        </button>
      </div>

      <div className="sidebar-footer">
        <button className="theme-toggle" onClick={onToggleTheme}>
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
            </svg>
          )}
          {theme === 'dark' ? ' Light Mode' : ' Dark Mode'}
        </button>
      </div>
    </nav>
  );
}
