import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { useApp } from '../context/AppContext';
import MonthFilter from '../components/MonthFilter';
import { fmtRM } from '../utils/format';

export default function Dashboard({ theme }) {
  const { transactions, tags, selectedMonths, getMonths, selectAllMonths, selectLatestMonth } = useApp();
  const pieRef = useRef(null);
  const barRef = useRef(null);
  const pieChart = useRef(null);
  const barChart = useRef(null);

  const months = getMonths();
  const txns = transactions.filter(t => {
    const d = new Date(t.date);
    if (isNaN(d)) return false;
    const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return selectedMonths.includes(m);
  });

  const credits = txns.filter(t => t.amount > 0);
  const debits  = txns.filter(t => t.amount < 0);
  const totalIncome    = credits.reduce((s, t) => s + t.amount, 0);
  const totalExpenses  = Math.abs(debits.reduce((s, t) => s + t.amount, 0));
  const net = totalIncome - totalExpenses;

  const tagSpend = {};
  debits.forEach(t => { const k = t.tag || '__untagged__'; tagSpend[k] = (tagSpend[k] || 0) + Math.abs(t.amount); });
  const sortedTagSpend = Object.entries(tagSpend).sort((a, b) => b[1] - a[1]);
  const topTag = sortedTagSpend[0];

  const periodLabel = !txns.length
    ? (months.length ? 'No data for selected months' : 'No data imported yet')
    : (selectedMonths.length === months.length ? `All ${months.length} month(s)` : `${selectedMonths.length} month(s) selected`);

  function getChartColors() {
    return theme === 'dark'
      ? { text: '#9aa0b8', grid: '#2a2f3d', bg: '#111318' }
      : { text: '#4a5070', grid: '#d0d5e8', bg: '#ffffff' };
  }

  // Pie chart
  useEffect(() => {
    if (!pieRef.current) return;
    if (pieChart.current) { pieChart.current.destroy(); pieChart.current = null; }
    if (!sortedTagSpend.length) return;

    const COLORS = ['#4f8cff','#7b5cff','#3dd68c','#ffc043','#ff5c6a','#38c9d4','#f97316','#a78bfa','#fb7185','#34d399'];
    const labels = [], data = [], colors = [];
    sortedTagSpend.forEach(([k, v], i) => {
      const tag = tags.find(t => t.id === k);
      labels.push(k === '__untagged__' ? 'Untagged' : (tag ? tag.name : k));
      data.push(v);
      colors.push(k === '__untagged__' ? '#5c6380' : (tag ? tag.color : COLORS[i % COLORS.length]));
    });
    const c = getChartColors();
    pieChart.current = new Chart(pieRef.current, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: c.bg, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { color: c.text, font: { family: 'Syne', size: 11 }, padding: 12, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ` RM ${ctx.parsed.toLocaleString('en-MY', { minimumFractionDigits: 2 })}` } }
        }
      }
    });
    return () => { if (pieChart.current) { pieChart.current.destroy(); pieChart.current = null; } };
  }, [sortedTagSpend.map(([k,v])=>k+v).join('|'), theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bar chart
  useEffect(() => {
    if (!barRef.current) return;
    if (barChart.current) { barChart.current.destroy(); barChart.current = null; }
    if (!txns.length) return;

    const monthly = {};
    txns.forEach(t => {
      const d = new Date(t.date); if (isNaN(d)) return;
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      if (!monthly[k]) monthly[k] = { expense: 0, income: 0 };
      if (t.amount < 0) monthly[k].expense += Math.abs(t.amount); else monthly[k].income += t.amount;
    });
    const keys = Object.keys(monthly).sort();
    const labels = keys.map(k => { const [y, m] = k.split('-'); return new Date(y, m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' }); });
    const c = getChartColors();
    barChart.current = new Chart(barRef.current, {
      type: 'bar',
      data: {
        labels, datasets: [
          { label: 'Expenses', data: keys.map(k => monthly[k].expense), backgroundColor: 'rgba(255,92,106,0.75)', borderRadius: 5, borderSkipped: false },
          { label: 'Income',   data: keys.map(k => monthly[k].income),  backgroundColor: 'rgba(61,214,140,0.65)',  borderRadius: 5, borderSkipped: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: c.text, font: { family: 'Syne', size: 11 }, boxWidth: 12 } } },
        scales: {
          x: { grid: { color: c.grid }, ticks: { color: c.text, font: { family: 'JetBrains Mono', size: 10 } } },
          y: { grid: { color: c.grid }, ticks: { color: c.text, font: { family: 'JetBrains Mono', size: 10 }, callback: v => 'RM' + v.toLocaleString() } }
        }
      }
    });
    return () => { if (barChart.current) { barChart.current.destroy(); barChart.current = null; } };
  }, [txns.map(t=>t.id+t.amount).join('|'), theme]); // eslint-disable-line react-hooks/exhaustive-deps

  let topTagName = '—', topTagAmount = '—';
  if (topTag) {
    const [topKey, topVal] = topTag;
    const tg = tags.find(t => t.id === topKey);
    topTagName = topKey === '__untagged__' ? 'Untagged' : (tg ? tg.name : topKey);
    topTagAmount = fmtRM(topVal);
  }

  return (
    <div className="page active">
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">{periodLabel}</div>
        </div>
      </div>

      <MonthFilter onSelectAll={selectAllMonths} onSelectLatest={selectLatestMonth} />

      <div className="cards-row">
        <div className="card">
          <div className="card-accent-bar" style={{ background: 'linear-gradient(90deg,var(--green),#1aad70)' }} />
          <div className="card-label">Total Income</div>
          <div className="card-value green">{txns.length ? fmtRM(totalIncome) : '—'}</div>
          <div className="card-sub">{credits.length} transactions</div>
        </div>
        <div className="card">
          <div className="card-accent-bar" style={{ background: 'linear-gradient(90deg,var(--red),#cc3a46)' }} />
          <div className="card-label">Total Expenses</div>
          <div className="card-value red">{txns.length ? fmtRM(totalExpenses) : '—'}</div>
          <div className="card-sub">{debits.length} transactions</div>
        </div>
        <div className="card">
          <div className="card-accent-bar" style={{ background: 'linear-gradient(90deg,var(--accent),var(--accent2))' }} />
          <div className="card-label">Net Balance</div>
          <div className={`card-value ${txns.length ? (net >= 0 ? 'green' : 'red') : 'blue'}`}>
            {txns.length ? `${net >= 0 ? '+' : '-'}RM ${Math.abs(net).toLocaleString('en-MY', { minimumFractionDigits: 2 })}` : '—'}
          </div>
          <div className="card-sub">income - expenses</div>
        </div>
        <div className="card">
          <div className="card-accent-bar" style={{ background: 'linear-gradient(90deg,var(--yellow),#e6a800)' }} />
          <div className="card-label">Top Category</div>
          <div className="card-value" style={{ fontSize: '1.1rem' }}>{topTagName}</div>
          <div className="card-sub">{txns.length && topTag ? topTagAmount : '—'}</div>
        </div>
      </div>

      <div className="charts-row">
        <div className="chart-card">
          <div className="chart-title">Spending by Category</div>
          <div className="chart-wrap"><canvas ref={pieRef} /></div>
        </div>
        <div className="chart-card">
          <div className="chart-title">Monthly Spending Trend</div>
          <div className="chart-wrap"><canvas ref={barRef} /></div>
        </div>
      </div>
    </div>
  );
}
