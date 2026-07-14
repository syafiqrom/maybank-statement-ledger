export function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtRM(v) {
  return 'RM ' + Math.abs(v).toLocaleString('en-MY', { minimumFractionDigits: 2 });
}
