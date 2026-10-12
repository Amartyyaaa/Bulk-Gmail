import { useRef, useState } from 'react';
import { Send, Square } from 'lucide-react';
import { Button, Field } from '../components/ui.jsx';
import { parseRecipients } from '../lib/recipients.js';

const CHUNK = 10; // must not exceed MAX_PER_REQUEST in api/send-gmail.js

/**
 * Public, standalone bulk sender that mails through the person's own Gmail
 * account with an App Password (via api/send-gmail.js). Nothing is stored:
 * the credentials live only in this form and in each request.
 */
export default function GmailSender() {
  const [form, setForm] = useState({ senderName: '', gmail: '', appPassword: '', subject: '', text: '', recipients: '' });
  const [run, setRun] = useState(null); // { total, results: [], error, busy }
  const stopRef = useRef(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const parsed = parseRecipients(form.recipients);

  const send = async (e) => {
    e.preventDefault();
    const list = parsed.valid;
    if (!list.length) return setRun({ total: 0, results: [], error: 'Add at least one valid recipient.' });

    stopRef.current = false;
    setRun({ total: list.length, results: [], busy: true });
    const { recipients: _, ...fields } = form;

    for (let i = 0; i < list.length && !stopRef.current; i += CHUNK) {
      try {
        const res = await fetch('/api/send-gmail', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...fields, recipients: list.slice(i, i + CHUNK) }),
        });
        const data = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
        if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
        setRun((r) => ({ ...r, results: [...r.results, ...data.results] }));
      } catch (err) {
        return setRun((r) => ({ ...r, busy: false, error: err.message }));
      }
    }
    setRun((r) => ({ ...r, busy: false, stopped: stopRef.current }));
  };

  const sent = run?.results.filter((r) => r.ok).length ?? 0;
  const failed = run?.results.filter((r) => !r.ok) ?? [];

  return (
    <div className="auth-screen">
      <form className="card card-body gmail-card" onSubmit={send}>
        <h1 className="center">Bulk Mail Sender</h1>
        <p className="muted center small">
          Sends from your own Gmail using an{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">App Password</a>.
          Nothing is saved. Gmail allows about 500 emails a day.
        </p>

        <fieldset className="stack" disabled={run?.busy}>
          <Field label="Sender name">
            <input value={form.senderName} onChange={set('senderName')} autoComplete="name" />
          </Field>
          <Field label="Your Gmail" required>
            <input type="email" required value={form.gmail} onChange={set('gmail')} autoComplete="email" />
          </Field>
          <Field label="16-digit App Password" required hint="Google Account → Security → 2-Step Verification → App passwords.">
            <input
              type="password" required minLength={16} value={form.appPassword}
              onChange={set('appPassword')} autoComplete="off"
            />
          </Field>
          <Field label="Email subject" required>
            <input required value={form.subject} onChange={set('subject')} />
          </Field>
          <Field label="Message body (plain text)" required>
            <textarea required rows={6} value={form.text} onChange={set('text')} />
          </Field>
          <Field
            label="Recipients (one per line)" required
            hint={`${parsed.valid.length} valid${parsed.duplicates ? `, ${parsed.duplicates} duplicate` : ''}${parsed.invalid.length ? `, ${parsed.invalid.length} invalid` : ''}`}
          >
            <textarea required rows={6} value={form.recipients} onChange={set('recipients')} className="mono" />
          </Field>
        </fieldset>

        <div className="gmail-actions">
          {run?.busy ? (
            <Button icon={Square} onClick={() => { stopRef.current = true; }}>Stop</Button>
          ) : (
            <Button type="submit" variant="primary" icon={Send}>Send all</Button>
          )}
        </div>

        {run && (
          <div aria-live="polite" className="stack">
            {run.total > 0 && (
              <>
                <progress max={run.total} value={run.results.length} className="gmail-progress" />
                <p className="center small">
                  {run.results.length} / {run.total} processed · <span className="good">{sent} sent</span>
                  {failed.length > 0 && <> · <span className="bad">{failed.length} failed</span></>}
                  {!run.busy && run.stopped && ' · stopped'}
                </p>
              </>
            )}
            {run.error && <p className="alert alert-error">{run.error}</p>}
            {failed.length > 0 && (
              <ul className="small bad">
                {failed.map((f) => <li key={f.email}>{f.email}: {f.error}</li>)}
              </ul>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
