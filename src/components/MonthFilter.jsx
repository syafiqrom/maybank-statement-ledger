import { useApp } from '../context/AppContext';

export default function MonthFilter({ onSelectAll, onSelectLatest }) {
  const { getMonths, selectedMonths, toggleMonth } = useApp();
  const months = getMonths();
  if (!months.length) return null;

  return (
    <div className="filter-bar">
      <span className="filter-label">Months</span>
      <div className="month-chips">
        {months.map(m => {
          const [y, mo] = m.split('-');
          const label = new Date(y, mo - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
          return (
            <div
              key={m}
              className={`month-chip${selectedMonths.includes(m) ? ' active' : ''}`}
              onClick={() => toggleMonth(m)}
            >
              {label}
            </div>
          );
        })}
      </div>
      <div className="filter-actions">
        <button className="btn btn-ghost btn-sm" onClick={onSelectAll}>All</button>
        <button className="btn btn-ghost btn-sm" onClick={onSelectLatest} title="At least one month must stay selected, so this selects only the most recent one">Latest</button>
      </div>
    </div>
  );
}
