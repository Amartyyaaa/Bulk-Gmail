import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Send, TestTube2 } from 'lucide-react';
import { callFunction, supabase } from '../lib/supabase.js';
import { useSettings } from '../lib/hooks.js';
import { num } from '../lib/format.js';
import { parseRecipients } from '../lib/recipients.js';
import { buildVisualEmail } from '../lib/emailLayout.js';
import { isValidEmail, unknownMergeTags } from '@shared/render.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import VisualEditor from '../components/VisualEditor.jsx';
import { Button, Card, ConfirmDialog, Field, PageHeader, Spinner } from '../components/ui.jsx';

const STARTER = '<p>Hi {{first_name|there}},</p><p></p><p>Thanks,<br>{{company_name}}</p>';
const IMPORT_CHUNK = 1000;

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function bodyIsEmpty(html) {
  return !/<img/i.test(html) && !html.replace(/<[^>]+>|&nbsp;/g, '').replace(/\{\{[^}]+\}\}/g, '').replace(/Hi\s*,|Thanks,/g, '').trim();
}

/** One-screen sender: write the email, paste recipients, send. */
export default function QuickSend() {
  const { isAdmin, user } = useAuth();
  const { settings, loading } = useSettings();
  const toast = useToast();
  const navigate = useNavigate();
  const editorApi = useRef(null);

  const [fromName, setFromName] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(STARTER);
  const [recipientsText, setRecipientsText] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null); // test | send
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [draftId, setDraftId] = useState(null);

  useEffect(() => {
    if (!settings) return;
    setFromName((v) => v || settings.default_from_name || settings.company_name || '');
    setFromEmail((v) => v || settings.default_from_email || '');
  }, [settings]);

  const recipients = useMemo(() => parseRecipients(recipientsText), [recipientsText]);
  const footerMissing = settings && (!settings.company_name?.trim() || !settings.physical_address?.trim());

  const clearError = (k) => setErrors((e) => ({ ...e, [k]: undefined }));

  const validate = ({ forSend }) => {
    const e = {};
    if (!fromName.trim()) e.fromName = 'Enter the name people will see.';
    if (!isValidEmail(fromEmail)) e.fromEmail = 'Enter a valid sender address.';
    else if (/@(gmail|googlemail|yahoo|outlook|hotmail|live|icloud)\./i.test(fromEmail)) {
      e.fromEmail = 'Free email addresses (Gmail, Yahoo, Outlook…) can’t be used as the sender. Use onboarding@resend.dev for testing, or an address on your verified domain.';
    }
    if (!subject.trim()) e.subject = 'Enter a subject.';
    if (bodyIsEmpty(body)) e.body = 'Write your message.';
    const unknown = unknownMergeTags(body + subject);
    if (unknown.length) e.body = `Unknown placeholder: ${unknown.map((t) => `{{${t}}}`).join(', ')}`;
    if (forSend) {
      if (!recipients.valid.length) e.recipients = 'Paste at least one valid email address.';
      if (!consent) e.consent = 'Confirm these people agreed to receive your emails.';
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  /** Create (or update) the campaign record that backs this send. */
  const saveDraft = async (segmentTag) => {
    const payload = {
      name: `Quick send – ${stamp()}`,
      subject: subject.trim(),
      from_name: fromName.trim(),
      from_email: fromEmail.trim(),
      reply_to: settings?.default_reply_to ?? '',
      html: buildVisualEmail(body),
      segment_tags: segmentTag ? [segmentTag] : [],
      batch_size: settings?.default_batch_size ?? 50,
      batch_delay_secs: settings?.default_batch_delay_secs ?? 10,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = draftId
      ? await supabase.from('campaigns').update(payload).eq('id', draftId).select('id').single()
      : await supabase.from('campaigns').insert({ ...payload, created_by: user.id }).select('id').single();
    if (error) throw error;
    setDraftId(data.id);
    return data.id;
  };

  const sendTest = async () => {
    if (!validate({ forSend: false })) return;
    setBusy('test');
    try {
      const id = await saveDraft(null);
      await callFunction('send-campaign', { action: 'test', campaign_id: id, to: user.email });
      toast.success(`Test sent to ${user.email}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const openConfirm = () => {
    if (validate({ forSend: true })) setConfirmOpen(true);
  };

  const send = async () => {
    setBusy('send');
    try {
      // Each quick send gets its own tag so the campaign targets exactly this list.
      const tag = `quick-send-${Date.now().toString(36)}`;
      const rows = recipients.valid.map((email) => ({ email, tags: [tag] }));
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
        const { error } = await supabase.rpc('import_contacts', {
          p_rows: rows.slice(i, i + IMPORT_CHUNK),
          p_opt_in: true,
          p_source: `Quick send ${stamp()}`,
        });
        if (error) throw error;
      }
      const { data: reachable, error: countError } = await supabase.rpc('audience_count', { p_tags: [tag] });
      if (countError) throw countError;
      if (!reachable) {
        throw new Error('None of these addresses can be emailed — they have all unsubscribed or bounced before.');
      }
      const id = await saveDraft(tag);
      await callFunction('send-campaign', { action: 'send', campaign_id: id });
      const skipped = recipients.valid.length - reachable;
      toast.success(`Sending to ${num(reachable)} ${reachable === 1 ? 'person' : 'people'}${skipped ? ` (${num(skipped)} skipped: unsubscribed or bounced)` : ''}.`);
      navigate(`/campaigns/${id}`);
    } catch (err) {
      toast.error(err);
      setConfirmOpen(false);
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Quick send" />
        <div className="alert alert-info">Only admins can send emails. Ask an admin to change your role in Settings → Team.</div>
      </>
    );
  }
  if (loading) return <Spinner />;

  return (
    <div className="quick-send">
      <PageHeader title="Quick send" description="Write your email, paste the recipients, and send." />

      {footerMissing && (
        <div className="alert alert-error" role="alert">
          Add your company name and postal address in <Link to="/settings">Settings</Link> before sending — they’re required at the
          bottom of every email.
        </div>
      )}

      <Card>
        <div className="form-grid">
          <div className="form-row">
            <Field label="Your name" error={errors.fromName} required hint="Who the email appears to be from.">
              <input value={fromName} onChange={(e) => { setFromName(e.target.value); clearError('fromName'); }} />
            </Field>
            <Field label="Send from" error={errors.fromEmail} required hint="Replies go to the reply-to address in Settings.">
              <input type="email" value={fromEmail} onChange={(e) => { setFromEmail(e.target.value); clearError('fromEmail'); }} />
            </Field>
          </div>

          <Field label="Subject" error={errors.subject} required>
            <input value={subject} onChange={(e) => { setSubject(e.target.value); clearError('subject'); }} />
          </Field>

          <div className={`field ${errors.body ? 'has-error' : ''}`}>
            <div className="quick-body-head">
              <span className="field-label">Message <span className="req" aria-hidden="true">*</span></span>
              <button
                type="button"
                className="chip"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editorApi.current?.chain().focus().insertContent('{{first_name|there}}').run()}
              >
                Insert first name
              </button>
            </div>
            <VisualEditor
              initialContent={STARTER}
              onChange={(html) => { setBody(html); clearError('body'); }}
              apiRef={editorApi}
              invalid={!!errors.body}
              describedBy="quick-body-help"
            />
            {errors.body ? (
              <p id="quick-body-help" className="field-error" role="alert">{errors.body}</p>
            ) : (
              <p id="quick-body-help" className="field-hint">An unsubscribe link and your address are added at the bottom automatically.</p>
            )}
          </div>

          <Field
            label={`Recipients${recipients.valid.length ? ` (${num(recipients.valid.length)})` : ''}`}
            error={errors.recipients}
            required
            hint="One email per line. Commas also work."
          >
            <textarea
              rows={8}
              value={recipientsText}
              placeholder={'jane@example.com\nraj@example.com'}
              onChange={(e) => { setRecipientsText(e.target.value); clearError('recipients'); }}
            />
          </Field>
          {recipientsText.trim() && (
            <p className="recipient-summary small" aria-live="polite">
              <span className="good">✓ {num(recipients.valid.length)} valid</span>
              {recipients.invalid.length > 0 && (
                <span className="bad" title={recipients.invalid.slice(0, 20).join('\n')}>
                  ✕ {num(recipients.invalid.length)} invalid (will be skipped)
                </span>
              )}
              {recipients.duplicates > 0 && <span className="muted">{num(recipients.duplicates)} duplicate{recipients.duplicates > 1 ? 's' : ''} removed</span>}
            </p>
          )}

          <div>
            <label className="checkbox">
              <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); clearError('consent'); }} />
              <span>These people have agreed to receive emails from us.</span>
            </label>
            {errors.consent && <p className="field-error" role="alert">{errors.consent}</p>}
          </div>

          <div className="quick-actions">
            <Button icon={TestTube2} loading={busy === 'test'} disabled={!!busy} onClick={sendTest}>
              Send test to me
            </Button>
            <Button variant="primary" icon={Send} loading={busy === 'send'} disabled={!!busy || footerMissing} onClick={openConfirm}>
              Send emails
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={`Send to ${num(recipients.valid.length)} ${recipients.valid.length === 1 ? 'person' : 'people'}?`}
        confirmLabel="Send now"
        loading={busy === 'send'}
        onConfirm={send}
        onClose={() => !busy && setConfirmOpen(false)}
      >
        <p><strong>{subject}</strong></p>
        <p className="muted small">
          Emails go out in batches of {settings?.default_batch_size ?? 50}. Anyone who unsubscribed or bounced before is skipped
          automatically. You’ll see live progress on the next screen.
        </p>
      </ConfirmDialog>
    </div>
  );
}
