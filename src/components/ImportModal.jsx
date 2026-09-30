import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, FileUp } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { parseContactsCsv, SAMPLE_CSV } from '../lib/csv.js';
import { num } from '../lib/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Field, Modal, TagInput } from './ui.jsx';

const CHUNK = 1000;

export default function ImportModal({ open, onClose, onImported, knownTags }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [consent, setConsent] = useState(false);
  const [source, setSource] = useState('');
  const [extraTags, setExtraTags] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setParsed(null);
    setConsent(false);
    setSource('');
    setExtraTags([]);
    setProgress(null);
    setError('');
  }, [open]);

  const choose = async (f) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') {
      setError('Choose a .csv file.');
      return;
    }
    setError('');
    setFile(f);
    setSource(`CSV import: ${f.name}`);
    const result = await parseContactsCsv(f);
    if (result.error) {
      setError(result.error);
      setParsed(null);
    } else {
      setParsed(result);
    }
  };

  const perRowOptIn = parsed?.contacts.some((c) => c.opt_in !== undefined);

  const submit = async () => {
    if (!parsed?.contacts.length) return;
    if (!source.trim()) {
      setError('Describe where these contacts came from.');
      return;
    }
    const rows = parsed.contacts.map((c) => ({
      ...c,
      tags: [...new Set([...c.tags, ...extraTags])],
    }));
    const totals = { inserted: 0, updated: 0, invalid: 0 };
    setProgress(0);
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { data, error: err } = await supabase.rpc('import_contacts', {
          p_rows: rows.slice(i, i + CHUNK),
          p_opt_in: consent,
          p_source: source.trim(),
        });
        if (err) throw err;
        totals.inserted += data.inserted;
        totals.updated += data.updated;
        totals.invalid += data.invalid;
        setProgress(Math.min(rows.length, i + CHUNK));
      }
      toast.success(`Imported ${num(totals.inserted)} new and updated ${num(totals.updated)} existing contacts.`);
      onImported();
      onClose();
    } catch (err) {
      toast.error(`Import stopped: ${err.message}`);
      setProgress(null);
      onImported();
    }
  };

  const sampleHref = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`;
  const busy = progress !== null;

  return (
    <Modal
      open={open}
      title="Import contacts from CSV"
      onClose={busy ? () => {} : onClose}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!parsed?.contacts.length}>
            {busy
              ? `Importing ${num(progress)} / ${num(parsed.contacts.length)}`
              : parsed ? `Import ${num(parsed.contacts.length)} contacts` : 'Import contacts'}
          </Button>
        </>
      }
    >
      {!parsed ? (
        <>
          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files[0]); }}
          >
            <FileUp size={28} aria-hidden="true" />
            <p><strong>Drop a CSV here</strong> or</p>
            <Button onClick={() => inputRef.current?.click()}>Choose file</Button>
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => choose(e.target.files[0])} aria-label="CSV file" />
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
          <p className="muted small">
            Columns: <code>name</code> (or <code>first_name</code>/<code>last_name</code>), <code>email</code>, <code>tags</code> (separate
            multiple with <code>;</code>). Optional <code>opt_in</code> column (yes/no) overrides the consent setting per row.{' '}
            <a href={sampleHref} download="contacts-sample.csv" className="inline-link">
              <Download size={14} aria-hidden="true" /> Sample CSV
            </a>
          </p>
        </>
      ) : (
        <div className="form-grid">
          <div className="import-summary">
            <div><strong>{num(parsed.contacts.length)}</strong><span>valid contacts</span></div>
            <div><strong>{num(parsed.duplicates)}</strong><span>duplicates merged</span></div>
            <div className={parsed.invalid.length ? 'bad' : ''}><strong>{num(parsed.invalid.length)}</strong><span>invalid emails skipped</span></div>
          </div>
          <p className="muted small">
            From <strong>{file?.name}</strong>. Contacts that already exist are updated (tags merged); people who unsubscribed stay
            unsubscribed. <button type="button" className="link-btn" onClick={() => setParsed(null)}>Choose a different file</button>
          </p>

          {parsed.invalid.length > 0 && (
            <details className="invalid-list">
              <summary><AlertTriangle size={14} aria-hidden="true" /> Show skipped rows</summary>
              <ul>
                {parsed.invalid.slice(0, 50).map((r) => (
                  <li key={r.line}>Line {r.line}: {r.email}</li>
                ))}
                {parsed.invalid.length > 50 && <li>…and {num(parsed.invalid.length - 50)} more</li>}
              </ul>
            </details>
          )}

          <div className="table-wrap">
            <table className="table compact">
              <caption className="sr-only">Preview of the first rows</caption>
              <thead><tr><th scope="col">Email</th><th scope="col">First</th><th scope="col">Last</th><th scope="col">Tags</th></tr></thead>
              <tbody>
                {parsed.contacts.slice(0, 5).map((c) => (
                  <tr key={c.email}><td>{c.email}</td><td>{c.first_name}</td><td>{c.last_name}</td><td>{c.tags.join(', ')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <Field label="Add tags to every imported contact" hint="Handy for segmenting this list later.">
            <TagInput value={extraTags} onChange={setExtraTags} suggestions={knownTags} />
          </Field>
          <Field label="Consent source" required error={error} hint="Stored with each contact as a record of where consent came from.">
            <input value={source} onChange={(e) => { setSource(e.target.value); setError(''); }} />
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              Everyone in this file has <strong>explicitly opted in</strong> to receive marketing email from us.
              {perRowOptIn && ' (Rows with an opt_in value use that instead.)'}
            </span>
          </label>
          {!consent && (
            <p className="alert alert-warn small">
              Without confirmed consent, contacts are imported as <strong>not opted in</strong> and won’t receive campaigns.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
