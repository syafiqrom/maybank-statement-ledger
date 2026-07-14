import { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';

export default function Import() {
  const { importedFiles, handleFiles, deleteStatement, clearAllData } = useApp();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="page active">
      <div className="page-header">
        <div>
          <div className="page-title">Import Statements</div>
          <div className="page-sub">Upload PDF bank statement files. Multiple files supported.</div>
        </div>
        <button className="btn btn-danger btn-sm" onClick={clearAllData}>Clear All Data</button>
      </div>

      <div
        className={`drop-zone${dragOver ? ' drag-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <path d="M10 13l2 2 4-4"/>
        </svg>
        <h3>Drop PDF statement files here</h3>
        <p>Multiple files supported · Balance verification included</p>
        <button className="btn btn-primary" style={{ marginTop: 16, pointerEvents: 'none' }}>Browse Files</button>
      </div>

      <div className="imported-files">
        {importedFiles.map((f, i) => {
          const iconColor = f.status === 'success' ? 'var(--green)' : f.status === 'warning' ? 'var(--yellow)' : f.status === 'info' ? 'var(--accent)' : 'var(--red)';
          const statusCls  = f.status === 'success' ? 'ok' : f.status === 'warning' ? 'warn' : f.status === 'info' ? '' : 'err';
          return (
            <div key={f.name + i} className={`imported-file ${f.status}`}>
              <div className="file-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" width="18" height="18">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div className="file-info">
                <div className="file-name">{f.name}</div>
                <div className={`file-status ${statusCls}`}>{f.message}</div>
                {f.verify && (
                  <div className={`file-verify ${f.verify.pass ? 'pass' : 'fail'}`}>{f.verify.msg}</div>
                )}
              </div>
              {f.status !== 'info' && (
                <button
                  className="btn btn-ghost btn-sm"
                  title="Remove this statement"
                  style={{ flexShrink: 0 }}
                  onClick={() => deleteStatement(i)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                  </svg>
                  Delete
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
