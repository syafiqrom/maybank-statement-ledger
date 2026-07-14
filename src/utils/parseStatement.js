import { genId, autoTagTxn, normalizePayeeKey } from './tags';

function parseAmountStr(amtStr) {
  if (!amtStr) return null;
  const s = String(amtStr).trim();
  const neg = s.endsWith('-');
  const num = parseFloat(s.replace(/,/g, '').replace(/[-+]$/, ''));
  if (isNaN(num)) return null;
  return neg ? -num : num;
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b(\w)/g, c => c.toUpperCase());
}

function stripTrailingRefCodes(str) {
  let s = str;
  while (true) {
    const stripped = s.replace(/\s+\d{2,}$/, '').trim();
    if (stripped === s || !stripped) break;
    s = stripped;
  }
  return s;
}

function round2(n) { return Math.round(n * 100) / 100; }

const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

/**
 * Parse a statement JSON payload (as returned by the Flask /convert endpoint).
 * Returns { newTxns, newPayeeTags, added, status, message, verify, yearGuess }.
 */
export function parseStatementJSON(data, fileName, hash, existingTxns, tags, payeeTags) {
  const txList = Array.isArray(data) ? data : (data.transactions || []);
  const stmtMeta = Array.isArray(data) ? null : (data.statement || null);

  if (!txList.length) {
    return { newTxns: [], newPayeeTags: {}, added: 0, status: 'error', message: 'No transactions found in JSON.', verify: null, yearGuess: null };
  }

  let baseYear;
  let yearSource;
  if (stmtMeta && stmtMeta.statement_year) {
    baseYear = parseInt(stmtMeta.statement_year);
    yearSource = 'statement';
  } else {
    const yearMatch = fileName.match(/20\d{2}/);
    if (yearMatch) {
      baseYear = parseInt(yearMatch[0]);
      yearSource = 'filename';
    } else {
      baseYear = new Date().getFullYear();
      yearSource = 'guess';
    }
  }

  function parseDateStr(dateStr) {
    if (!dateStr) return null;
    if (dateStr.includes('/')) {
      const [dd, mm] = dateStr.split('/').map(Number);
      if (!dd || !mm || dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
      return `${baseYear}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    }
    const m = dateStr.match(/^(\d{2})([A-Za-z]{3})$/);
    if (m) {
      const dd = parseInt(m[1]);
      const mm = MONTHS[m[2].toLowerCase()];
      if (!dd || !mm) return null;
      return `${baseYear}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    }
    return null;
  }

  function parseAmount(item) {
    if (item.amount !== undefined) return parseAmountStr(item.amount);
    if (item.debit != null) return parseAmountStr('-' + item.debit);
    if (item.credit != null) return parseAmountStr(item.credit);
    return null;
  }

  const parsed = [];
  for (const item of txList) {
    const dateStr = item.date || item.Date || '';
    const dateISO = parseDateStr(dateStr);
    if (!dateISO) continue;
    const amount = parseAmount(item);
    if (amount === null) continue;
    const rawBal = item.balance || item.Balance || null;
    const balance = rawBal ? parseFloat(String(rawBal).replace(/,/g, '')) : null;
    let payee = '';
    if (item.details) payee = item.details.name || item.details.payee || '';
    if (!payee) payee = item.payee || item.name || item.description || item.Payee || 'Unknown';
    payee = payee.replace(/\*+$/, '').trim();
    payee = stripTrailingRefCodes(payee);
    if (payee === payee.toUpperCase() && payee.length > 3) payee = toTitleCase(payee);
    const txType = item.type || item.Type || item.txType || item.description || '';
    parsed.push({ dateISO, payee, txType, amount, balance });
  }

  if (!parsed.length) {
    return { newTxns: [], newPayeeTags: {}, added: 0, status: 'error', message: 'Could not parse any transactions from JSON.', verify: null, yearGuess: null };
  }

  // Balance verification
  let verifyResult = null;
  if (stmtMeta) {
    const stmtDebit = stmtMeta.total_debit ? parseFloat(String(stmtMeta.total_debit).replace(/,/g,'')) : null;
    const stmtCredit = stmtMeta.total_credit ? parseFloat(String(stmtMeta.total_credit).replace(/,/g,'')) : null;
    if (stmtDebit !== null && stmtCredit !== null) {
      const parsedDebit = round2(parsed.filter(t=>t.amount<0).reduce((s,t)=>s+Math.abs(t.amount),0));
      const parsedCredit = round2(parsed.filter(t=>t.amount>0).reduce((s,t)=>s+t.amount,0));
      const pass = Math.abs(parsedDebit - stmtDebit) < 0.02 && Math.abs(parsedCredit - stmtCredit) < 0.02;
      verifyResult = { pass, msg: pass
        ? `✓ Verified: Debit RM${stmtDebit.toFixed(2)}, Credit RM${stmtCredit.toFixed(2)}`
        : `⚠ Mismatch — Statement: D${stmtDebit.toFixed(2)} C${stmtCredit.toFixed(2)} | Parsed: D${parsedDebit.toFixed(2)} C${parsedCredit.toFixed(2)}` };
    }
  }

  const newPayeeTags = {};
  const newTxns = parsed.map((tx, i) => {
    const txn = {
      id: genId(),
      date: tx.dateISO,
      payee: tx.payee,
      txType: tx.txType,
      amount: tx.amount,
      balance: tx.balance,
      order: existingTxns.length + i,
      tag: null,
      source: fileName,
    };
    autoTagTxn(txn, tags, { ...payeeTags, ...newPayeeTags });
    // If autoTagTxn assigned a new payee→tag mapping, capture it
    const key = normalizePayeeKey(txn.payee);
    if (txn.tag && !payeeTags[key]) newPayeeTags[key] = txn.tag;
    return txn;
  });

  const yearNote = yearSource === 'guess' ? ` (year assumed: ${baseYear})` : '';
  const status = (verifyResult && !verifyResult.pass) || yearSource === 'guess' ? 'warning' : 'success';
  const message = `${newTxns.length} imported${yearNote}`;

  return {
    newTxns,
    newPayeeTags,
    added: newTxns.length,
    status,
    message,
    verify: verifyResult,
    yearGuess: yearSource === 'guess' ? baseYear : null,
  };
}
