import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { genId, normalizePayeeKey, autoTagTxn, reapplyAllAutoTags } from '../utils/tags';
import { parseStatementJSON } from '../utils/parseStatement';

// ─── localStorage helpers ────────────────────────────────────────────────────
const STORAGE_KEY = 'ledger_state';
const STORAGE_WARN_BYTES = 4 * 1024 * 1024;

function loadFromStorage() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      return {
        transactions: parsed.transactions || [],
        selectedMonths: parsed.selectedMonths || [],
        importedFiles: (parsed.importedFiles || []).filter(f => f.status !== 'info'),
        tags: parsed.tags || [],
        payeeTags: parsed.payeeTags || {},
      };
    }
  } catch (_) {}
  return { transactions: [], selectedMonths: [], importedFiles: [], tags: [], payeeTags: {} };
}

// ─── Context ─────────────────────────────────────────────────────────────────
const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [transactions, setTransactions] = useState([]);
  const [tags, setTags] = useState([]);
  const [payeeTags, setPayeeTags] = useState({});
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [importedFiles, setImportedFiles] = useState([]);
  const [tagsUnsaved, setTagsUnsaved] = useState(false);
  const [tagsFileName, setTagsFileName] = useState('tags.json');
  const [toasts, setToasts] = useState([]);
  const storageWarnShown = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    const s = loadFromStorage();
    setTransactions(s.transactions);
    setSelectedMonths(s.selectedMonths);
    setImportedFiles(s.importedFiles);
    setTags(s.tags);
    setPayeeTags(s.payeeTags);
  }, []);

  // ── save ──────────────────────────────────────────────────────────────────
  const save = useCallback((overrides = {}) => {
    // We build the object to save from the current state + any overrides
    // because setState is async and we sometimes need to persist immediately
    // after a mutation.
    const toSave = {
      transactions: overrides.transactions ?? transactions,
      selectedMonths: overrides.selectedMonths ?? selectedMonths,
      importedFiles: overrides.importedFiles ?? importedFiles,
      tags: overrides.tags ?? tags,
      payeeTags: overrides.payeeTags ?? payeeTags,
    };
    let json;
    try {
      json = JSON.stringify(toSave);
      localStorage.setItem(STORAGE_KEY, json);
    } catch (_) {
      addToast("Storage is full — export your Tags JSON now, then remove older statements to free space.", 'error');
      storageWarnShown.current = true;
      return;
    }
    const approxBytes = json.length;
    if (approxBytes > STORAGE_WARN_BYTES) {
      if (!storageWarnShown.current) {
        storageWarnShown.current = true;
        const mb = (approxBytes / (1024 * 1024)).toFixed(1);
        addToast(`Transaction data is using ~${mb} MB of browser storage and is getting close to the limit.`, 'warning');
      }
    } else {
      storageWarnShown.current = false;
    }
  }, [transactions, selectedMonths, importedFiles, tags, payeeTags]);

  // ── toast ─────────────────────────────────────────────────────────────────
  const addToast = useCallback((msg, type = 'info') => {
    const id = genId();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3800);
  }, []);

  // ── months helpers ────────────────────────────────────────────────────────
  const getMonths = useCallback((txns = transactions) => {
    const months = new Set();
    txns.forEach(t => {
      const d = new Date(t.date);
      if (!isNaN(d)) months.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    });
    return Array.from(months).sort();
  }, [transactions]);

  const normalizeSelectedMonths = useCallback((months, current) => {
    let sel = current.filter(m => months.includes(m));
    if (!sel.length && months.length) sel = [...months];
    return sel;
  }, []);

  // ── tag operations ────────────────────────────────────────────────────────
  const createTag = useCallback((name, color) => {
    const newTag = { id: genId(), name, color, rules: [] };
    const newTags = [...tags, newTag];
    setTags(newTags);
    setTagsUnsaved(true);
    save({ tags: newTags });
    addToast(`Tag "${name}" created — save Tags JSON to persist`, 'success');
  }, [tags, save, addToast]);

  const deleteTag = useCallback((id) => {
    const newTags = tags.filter(t => t.id !== id);
    const newTxns = transactions.map(t => t.tag === id ? { ...t, tag: null } : t);
    const newPT = { ...payeeTags };
    Object.keys(newPT).forEach(k => { if (newPT[k] === id) delete newPT[k]; });
    setTags(newTags);
    setTransactions(newTxns);
    setPayeeTags(newPT);
    setTagsUnsaved(true);
    save({ tags: newTags, transactions: newTxns, payeeTags: newPT });
    addToast('Tag deleted — save Tags JSON to persist', 'info');
  }, [tags, transactions, payeeTags, save, addToast]);

  const saveTag = useCallback((id, name, color, rules) => {
    const newTags = tags.map(t => t.id === id ? { ...t, name, color, rules } : t);
    // Reapply auto-tags with updated rules
    const newPT = { ...payeeTags };
    const newTxns = transactions.map(t => {
      const updated = { ...t };
      autoTagTxn(updated, newTags, newPT);
      return updated;
    });
    setTags(newTags);
    setTransactions(newTxns);
    setTagsUnsaved(true);
    save({ tags: newTags, transactions: newTxns, payeeTags: newPT });
    addToast('Tag saved — remember to export Tags JSON', 'success');
  }, [tags, transactions, payeeTags, save, addToast]);

  // ── assign tag to payee ───────────────────────────────────────────────────
  const assignTagToPayee = useCallback((txn, tagId) => {
    const payeeKey = normalizePayeeKey(txn.payee);
    const newPT = { ...payeeTags };
    if (tagId) newPT[payeeKey] = tagId;
    else delete newPT[payeeKey];

    let count = 0;
    const newTxns = transactions.map(t => {
      if (normalizePayeeKey(t.payee) === payeeKey) { count++; return { ...t, tag: tagId || null }; }
      return t;
    });
    setPayeeTags(newPT);
    setTransactions(newTxns);
    setTagsUnsaved(true);
    save({ payeeTags: newPT, transactions: newTxns });
    const tag = tags.find(t => t.id === tagId);
    addToast(`Tagged ${count} transaction${count !== 1 ? 's' : ''} as "${tag ? tag.name : 'Untagged'}" — remember to save Tags JSON`, 'success');
  }, [payeeTags, transactions, tags, save, addToast]);

  // ── tags JSON import/export ───────────────────────────────────────────────
  const loadTagsFromJSON = useCallback((arr, fileName) => {
    if (!Array.isArray(arr)) throw new Error('Tags JSON must be an array');
    const newTags = [];
    const newPT = {};
    for (const item of arr) {
      if (!item.name) continue;
      const id = genId();
      newTags.push({ id, name: item.name, color: item.color || '#4f8cff', rules: Array.isArray(item.rules) ? item.rules : [] });
      if (Array.isArray(item.payees)) {
        item.payees.forEach(p => { if (p) newPT[String(p).toLowerCase().trim()] = id; });
      }
    }
    // Reapply tags to all transactions
    const newTxns = transactions.map(t => {
      const updated = { ...t };
      autoTagTxn(updated, newTags, newPT);
      return updated;
    });
    setTags(newTags);
    setPayeeTags(newPT);
    setTransactions(newTxns);
    setTagsUnsaved(false);
    setTagsFileName(fileName || 'tags.json');
    save({ tags: newTags, payeeTags: newPT, transactions: newTxns });
    addToast(`Tags loaded from "${fileName}" — ${newTags.length} tag(s)`, 'success');
  }, [transactions, save, addToast]);

  const buildTagsJSON = useCallback(() => {
    return tags.map(tag => {
      const payees = Object.entries(payeeTags).filter(([, v]) => v === tag.id).map(([k]) => k);
      return { name: tag.name, color: tag.color, payees, rules: tag.rules || [] };
    });
  }, [tags, payeeTags]);

  // ── PDF import ────────────────────────────────────────────────────────────
  async function hashFile(file) {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const processPDF = useCallback(async (file, hash, currentImportedFiles) => {
    const form = new FormData();
    form.append('pdf', file);
    try {
      const res = await fetch('http://127.0.0.1:5000/convert', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        return { status: 'error', message: data.error || 'Conversion failed', verify: null };
      }
      return { status: 'parsed', data };
    } catch (_) {
      return { status: 'error', message: 'Cannot reach local server — is app.py running?', verify: null };
    }
  }, []);

  const handleFiles = useCallback(async (files) => {
    const arr = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (!arr.length) { addToast('Please upload PDF files', 'error'); return; }

    // We process files sequentially; state snapshots inside closures would be
    // stale, so we use a local mutable copy and flush to React state at the end.
    let currentTxns = [...transactions];
    let currentImported = [...importedFiles];
    let currentPT = { ...payeeTags };
    let currentSM = [...selectedMonths];

    for (const file of arr) {
      let hash = null;
      try { hash = await hashFile(file); } catch (_) {}

      if (hash) {
        const existing = currentImported.find(f => f.hash === hash);
        if (existing) {
          const sameName = existing.name === file.name;
          addToast(sameName
            ? `"${file.name}" already imported, skipping.`
            : `"${file.name}" is identical to already-imported "${existing.name}", skipping.`, 'warning');
          continue;
        }
      } else if (currentImported.some(f => f.name === file.name)) {
        addToast(`"${file.name}" already imported, skipping.`, 'warning');
        continue;
      }

      // Show in-progress entry
      currentImported = currentImported.filter(f => f.name !== file.name);
      currentImported.unshift({ name: file.name, status: 'info', message: 'Converting PDF…', verify: null, hash });
      setImportedFiles([...currentImported]);

      const result = await processPDF(file, hash, currentImported);

      if (result.status === 'error') {
        currentImported = currentImported.filter(f => f.name !== file.name);
        currentImported.unshift({ name: file.name, status: 'error', message: result.message, verify: null, hash });
        if (result.message.includes('app.py')) addToast('Start app.py first: python app.py', 'error');
        else addToast('Failed to convert ' + file.name, 'error');
      } else {
        const parsed = parseStatementJSON(result.data, file.name, hash, currentTxns, tags, currentPT);
        if (parsed.yearGuess) {
          addToast(`${file.name}: couldn't find a year — assumed ${parsed.yearGuess}. Check dates on Transactions page.`, 'warning');
        }
        // Merge new transactions
        parsed.newTxns.forEach(t => currentTxns.push(t));
        currentPT = { ...currentPT, ...parsed.newPayeeTags };

        // Update selected months to include new months
        const allMonths = getMonthsFromTxns(currentTxns);
        currentSM = normalizeSelectedMonths(allMonths, currentSM);

        // Remove in-progress, add final entry
        currentImported = currentImported.filter(f => f.name !== file.name);
        currentImported.unshift({ name: file.name, status: parsed.status, message: parsed.message, verify: parsed.verify, hash });
        if (currentImported.length > 50) currentImported = currentImported.slice(0, 50);
        addToast(`${file.name}: ${parsed.added} imported`, 'success');
      }
    }

    setTransactions(currentTxns);
    setPayeeTags(currentPT);
    setImportedFiles(currentImported);
    setSelectedMonths(currentSM);
    save({ transactions: currentTxns, payeeTags: currentPT, importedFiles: currentImported, selectedMonths: currentSM });
  }, [transactions, importedFiles, payeeTags, selectedMonths, tags, processPDF, addToast, save, normalizeSelectedMonths]);

  const deleteStatement = useCallback((idx) => {
    const file = importedFiles[idx];
    if (!confirm(`Remove "${file.name}" and its transactions?`)) return;
    const newTxns = transactions.filter(t => t.source !== file.name);
    const removed = transactions.length - newTxns.length;
    const newImported = importedFiles.filter((_, i) => i !== idx);
    const allMonths = getMonthsFromTxns(newTxns);
    const newSM = normalizeSelectedMonths(allMonths, selectedMonths);
    setTransactions(newTxns);
    setImportedFiles(newImported);
    setSelectedMonths(newSM);
    save({ transactions: newTxns, importedFiles: newImported, selectedMonths: newSM });
    addToast(`Removed ${removed} transactions from "${file.name}"`, 'info');
  }, [importedFiles, transactions, selectedMonths, save, addToast, normalizeSelectedMonths]);

  const clearAllData = useCallback(() => {
    if (!confirm('Clear ALL imported transaction data? Tags are unaffected.')) return;
    setTransactions([]);
    setImportedFiles([]);
    setSelectedMonths([]);
    save({ transactions: [], importedFiles: [], selectedMonths: [] });
    addToast('All transaction data cleared', 'info');
  }, [save, addToast]);

  // ── month toggle ──────────────────────────────────────────────────────────
  const toggleMonth = useCallback((m) => {
    setSelectedMonths(prev => {
      if (prev.includes(m)) {
        if (prev.length === 1) return prev;
        const next = prev.filter(x => x !== m);
        save({ selectedMonths: next });
        return next;
      }
      const next = [...prev, m].sort();
      save({ selectedMonths: next });
      return next;
    });
  }, [save]);

  const selectAllMonths = useCallback(() => {
    const months = getMonths();
    setSelectedMonths(months);
    save({ selectedMonths: months });
  }, [getMonths, save]);

  const selectLatestMonth = useCallback(() => {
    const months = getMonths();
    if (months.length) {
      const latest = [months[months.length - 1]];
      setSelectedMonths(latest);
      save({ selectedMonths: latest });
    }
  }, [getMonths, save]);

  return (
    <AppContext.Provider value={{
      transactions, tags, payeeTags, selectedMonths, importedFiles,
      tagsUnsaved, setTagsUnsaved, tagsFileName, setTagsFileName,
      toasts,
      addToast,
      getMonths,
      toggleMonth, selectAllMonths, selectLatestMonth,
      createTag, deleteTag, saveTag,
      assignTagToPayee,
      loadTagsFromJSON, buildTagsJSON,
      handleFiles, deleteStatement, clearAllData,
      save,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

// Helper used in handleFiles (plain function, not a hook)
function getMonthsFromTxns(txns) {
  const months = new Set();
  txns.forEach(t => {
    const d = new Date(t.date);
    if (!isNaN(d)) months.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  });
  return Array.from(months).sort();
}
