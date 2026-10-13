'use client';

import { useEffect, useRef, useState } from 'react';

export function QueryCodeDialog({ code, initialCopied, onClose }: {
  code: string;
  initialCopied: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState(initialCopied
    ? 'Query code copied to clipboard.'
    : 'Automatic copying failed. Use Copy again or select the code and copy it manually.');
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const copyAgain = async () => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(code);
      setStatus('Query code copied again.');
    } catch {
      setStatus('Could not access the clipboard. Select the code and copy it manually.');
    } finally {
      setCopying(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="fdl-query-code-dialog" aria-labelledby="query-code-title" aria-describedby="query-code-help" onCancel={onClose} onClose={onClose}>
      <h2 id="query-code-title">{initialCopied ? 'Query Code Copied' : 'Query Code Ready'}</h2>
      <p id="query-code-help">Paste this code into the AI Query Builder to restore the query conditions and filters.</p>
      <p role="status" aria-live="polite">{status}</p>
      <label htmlFor="query-code-value">Query code</label>
      <textarea id="query-code-value" readOnly value={code} rows={6} autoFocus onFocus={event => event.currentTarget.select()} />
      <div className="fdl-query-code-dialog__actions">
        <button type="button" className="fdl-btn fdl-btn--quiet" onClick={onClose}>Close</button>
        <button type="button" className="fdl-btn fdl-btn--search" onClick={copyAgain} disabled={copying}>{copying ? 'Copying…' : 'Copy again'}</button>
      </div>
    </dialog>
  );
}
