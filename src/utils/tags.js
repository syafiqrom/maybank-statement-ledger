export function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function normalizePayeeKey(name) {
  return (name || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function autoTagTxn(txn, tags, payeeTags) {
  const key = normalizePayeeKey(txn.payee);
  if (payeeTags[key]) { txn.tag = payeeTags[key]; return; }
  for (const tag of tags) {
    if (!tag.rules || !tag.rules.length) continue;
    for (const rule of tag.rules) {
      if (txn.payee.toLowerCase().includes(rule.toLowerCase())) {
        txn.tag = tag.id;
        payeeTags[key] = tag.id;
        return;
      }
    }
  }
  txn.tag = null;
}

export function reapplyAllAutoTags(transactions, tags, payeeTags) {
  return transactions.map(t => {
    const updated = { ...t };
    autoTagTxn(updated, tags, payeeTags);
    return updated;
  });
}
