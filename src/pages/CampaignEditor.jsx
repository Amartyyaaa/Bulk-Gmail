import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, Monitor, Save, Send, Smartphone, TestTube2, Users } from 'lucide-react';
import { callFunction, supabase } from '../lib/supabase.js';
import { useSettings, useTags } from '../lib/hooks.js';
import { num, toLocalInput } from '../lib/format.js';
import { SAMPLE_CONTACT, STARTER_TEMPLATE } from '../lib/templates.js';
import { MERGE_TAGS, isValidEmail, renderEmail, unknownMergeTags } from '@shared/render.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, Modal, PageHeader, Spinner, TagInput } from '../components/ui.jsx';

const EMPTY = {
  name: '',
  subject: '',
  preheader: '',
  from_name: '',
  from_email: '',
  reply_to: '',
  html: STARTER_TEMPLATE,
  segment_tags: [],
  batch_size: 50,
  batch_delay_secs: 10,
};

const EDITABLE = Object.keys(EMPTY);

function validate(c, { forSend = false } = {}) {
  const e = {};
  if (!c.name.trim()) e.name = 'Give the campaign a name so your team can find it.';
  if (forSend || c.subject) {
    if (!c.subject.trim()) e.subject = 'Subject line is required to send.';
    else if (c.subject.length > 150) e.subject = 'Keep the subject under 150 characters.';
  }
  if (forSend && !c.from_name.trim()) e.from_name = 'From name is required to send.';
  if ((forSend || c.from_email) && !isValidEmail(c.from_email)) {
    e.from_email = 'Enter a valid address on your verified sending domain.';
  }
  if (c.reply_to && !isValidEmail(c.reply_to)) e.reply_to = 'Enter a valid reply-to address, or leave blank.';
  const bs = Number(c.batch_size);
  if (!Number.isInteger(bs) || bs < 1 || bs > 1000) e.batch_size = 'Batch size must be a whole number from 1 to 1000.';
  const bd = Number(c.batch_delay_secs);
  if (!Number.isInteger(bd) || bd < 0 || bd > 3600) e.batch_delay_secs = 'Delay must be 0 to 3600 seconds.';
  const unknown = unknownMergeTags(c.html + c.subject + c.preheader);
  if (unknown.length) e.html = `Unknown merge tag${unknown.length > 1 ? 's' : ''}: ${unknown.map((t) => `{{${t}}}`).join(', ')}`;
  else if (forSend && !c.html.trim()) e.html = 'Email content is empty.';
  return e;
}

export default function CampaignEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const { isAdmin, user } = useAuth();
  const { settings } = useSettings();
  const { tags } = useTags();

  const [campaign, setCampaign] = useState(isNew ? null : undefined);
  const [form, setForm] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [audience, setAudience] = useState(null);
  const [device, setDevice] = useState('desktop');
  const [testOpen, setTestOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const editorRef = useRef(null);

  // Seed a new campaign from org defaults.
  useEffect(() => {
    if (!isNew || !settings) return;
    setForm((f) => ({
      ...f,
      from_name: f.from_name || settings.default_from_name,
      from_email: f.from_email || settings.default_from_email,
      reply_to: f.reply_to || settings.default_reply_to,
      batch_size: settings.default_batch_size,
      batch_delay_secs: settings.default_batch_delay_secs,
    }));
  }, [isNew, settings]);

  // Load an existing campaign.
  useEffect(() => {
    if (isNew) return;
    supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error(error);
        setCampaign(data ?? null);
        if (data) setForm(Object.fromEntries(EDITABLE.map((k) => [k, data[k] ?? EMPTY[k]])));
      });
  }, [id, isNew, toast]);

  // Live audience estimate.
  const tagKey = form.segment_tags.join(',');
  useEffect(() => {
    let active = true;
    supabase.rpc('audience_count', { p_tags: tagKey ? tagKey.split(',') : [] }).then(({ data }) => {
      if (active) setAudience(data ?? 0);
    });
    return () => {
      active = false;
    };
  }, [tagKey]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const errors = useMemo(() => validate(form), [form]);
  const sendErrors = useMemo(() => validate(form, { forSend: true }), [form]);
  const visibleErrors = showAllErrors ? sendErrors : Object.fromEntries(Object.entries(errors).filter(([k]) => touched[k]));

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };
  const touch = (key) => () => setTouched((t) => ({ ...t, [key]: true }));

  const preview = useMemo(
    () =>
      renderEmail({
        campaign: form,
        contact: SAMPLE_CONTACT,
        settings: settings ?? {},
        unsubscribeUrl: `${window.location.origin}/unsubscribe?t=preview`,
      }),
    [form, settings],
  );

  const insertTag = (tag) => {
    const el = editorRef.current;
    const token = `{{${tag}}}`;
    const start = el?.selectionStart ?? form.html.length;
    const end = el?.selectionEnd ?? form.html.length;
    const next = form.html.slice(0, start) + token + form.html.slice(end);
    setForm((f) => ({ ...f, html: next }));
    setDirty(true);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = useCallback(
    async ({ quiet = false } = {}) => {
      if (Object.keys(errors).length) {
        setTouched(Object.fromEntries(Object.keys(errors).map((k) => [k, true])));
        toast.error('Fix the highlighted fields before saving.');
        return null;
      }
      setSaving(true);
      const payload = {
        ...form,
        batch_size: Number(form.batch_size),
        batch_delay_secs: Number(form.batch_delay_secs),
        updated_at: new Date().toISOString(),
      };
      const query = isNew
        ? supabase.from('campaigns').insert({ ...payload, created_by: user.id }).select().single()
        : supabase.from('campaigns').update(payload).eq('id', id).select().single();
      const { data, error } = await query;
      setSaving(false);
      if (error) {
        toast.error(error.code === 'PGRST116' ? 'This campaign is no longer a draft and can’t be edited.' : error);
        return null;
      }
      setDirty(false);
      setCampaign(data);
      if (!quiet) toast.success('Draft saved');
      if (isNew) navigate(`/campaigns/${data.id}/edit`, { replace: true });
      return data;
    },
    [errors, form, id, isNew, navigate, toast, user],
  );

  // Ctrl/Cmd+S saves.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  if (!isAdmin) return <Navigate to={id ? `/campaigns/${id}` : '/campaigns'} replace />;
  if (campaign === undefined) return <Spinner />;
  if (!isNew && campaign === null) return <Navigate to="/campaigns" replace />;
  if (campaign && campaign.status !== 'draft') return <Navigate to={`/campaigns/${campaign.id}`} replace />;

  const openSend = () => {
    setShowAllErrors(true);
    if (Object.keys(sendErrors).length) {
      toast.error('Complete the highlighted fields before sending.');
      return;
    }
    setSendOpen(true);
  };

  return (
    <>
      <PageHeader
        title={isNew ? 'New campaign' : form.name || 'Edit campaign'}
        description={
          <Link to="/campaigns" className="back-link">
            <ArrowLeft size={14} aria-hidden="true" /> All campaigns
          </Link>
        }
        actions={
          <>
            {dirty && <span className="muted small" aria-live="polite">Unsaved changes</span>}
            <Button icon={Save} loading={saving} onClick={() => save()}>Save draft</Button>
            <Button icon={TestTube2} onClick={() => setTestOpen(true)}>Send test</Button>
            <Button variant="primary" icon={Send} onClick={openSend}>Review &amp; send</Button>
          </>
        }
      />

      <div className="editor-layout">
        <div className="editor-form">
          <Card title="Details">
            <div className="form-grid">
              <Field label="Campaign name" error={visibleErrors.name} required hint="Internal only — recipients won’t see it.">
                <input value={form.name} onChange={set('name')} onBlur={touch('name')} placeholder="October newsletter" />
              </Field>
              <Field label="Subject line" error={visibleErrors.subject} required hint={`${form.subject.length}/150 · merge tags allowed`}>
                <input value={form.subject} onChange={set('subject')} onBlur={touch('subject')} placeholder="{{first_name|Hey}}, your October update" />
              </Field>
              <Field label="Preview text" hint="Shown after the subject in most inboxes.">
                <input value={form.preheader} onChange={set('preheader')} placeholder="A quick summary of what’s inside" />
              </Field>
              <div className="form-row">
                <Field label="From name" error={visibleErrors.from_name} required>
                  <input value={form.from_name} onChange={set('from_name')} onBlur={touch('from_name')} placeholder="Acme Marketing" />
                </Field>
                <Field label="From email" error={visibleErrors.from_email} required>
                  <input type="email" value={form.from_email} onChange={set('from_email')} onBlur={touch('from_email')} placeholder="news@mail.acme.com" />
                </Field>
              </div>
              <Field label="Reply-to" error={visibleErrors.reply_to} hint="Where replies go. Leave blank to use the from address.">
                <input type="email" value={form.reply_to} onChange={set('reply_to')} onBlur={touch('reply_to')} placeholder="team@acme.com" />
              </Field>
            </div>
          </Card>

          <Card title="Audience">
            <Field label="Send to contacts tagged" hint="Matches contacts with any of these tags. Leave empty to send to everyone opted in.">
              <TagInput value={form.segment_tags} onChange={set('segment_tags')} suggestions={tags.map((t) => t.tag)} placeholder="All opted-in contacts" />
            </Field>
            <p className="audience-count">
              <Users size={16} aria-hidden="true" />
              {audience === null ? 'Counting…' : <><strong>{num(audience)}</strong> opted-in, unsuppressed recipients</>}
            </p>
          </Card>

          <Card title="Throttling">
            <div className="form-row">
              <Field label="Batch size" error={visibleErrors.batch_size} hint="Emails per batch.">
                <input type="number" min={1} max={1000} value={form.batch_size} onChange={set('batch_size')} onBlur={touch('batch_size')} />
              </Field>
              <Field label="Delay between batches (s)" error={visibleErrors.batch_delay_secs} hint="Pause after each batch.">
                <input type="number" min={0} max={3600} value={form.batch_delay_secs} onChange={set('batch_delay_secs')} onBlur={touch('batch_delay_secs')} />
              </Field>
            </div>
            <p className="muted small">
              Sends are also capped at your provider’s per-second rate limit. New domains should start small (e.g. 50 every 30s) and ramp up
              to build sender reputation.
            </p>
          </Card>
        </div>

        <div className="editor-content">
          <Card
            title="Content"
            className="editor-card"
            actions={
              <div className="seg" role="group" aria-label="Preview device">
                <button type="button" className={device === 'desktop' ? 'active' : ''} aria-pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>
                  <Monitor size={16} aria-hidden="true" /><span className="sr-only">Desktop preview</span>
                </button>
                <button type="button" className={device === 'mobile' ? 'active' : ''} aria-pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>
                  <Smartphone size={16} aria-hidden="true" /><span className="sr-only">Mobile preview</span>
                </button>
              </div>
            }
          >
            <div className="merge-bar" role="toolbar" aria-label="Insert merge tag">
              <span className="muted small">Insert:</span>
              {MERGE_TAGS.map((t) => (
                <button key={t.tag} type="button" className="chip" onClick={() => insertTag(t.tag)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="split">
              <Field label="HTML" error={visibleErrors.html} className="code-field"
                hint="Use {{tag|fallback}} for defaults. An unsubscribe link and your address footer are added automatically.">
                <textarea ref={editorRef} className="code" spellCheck={false} value={form.html} onChange={set('html')} onBlur={touch('html')} />
              </Field>
              <div className="preview-pane">
                <div className="inbox-preview" aria-label="Inbox preview">
                  <strong className="truncate">{form.from_name || 'From name'}</strong>
                  <span className="truncate">{preview.subject || 'Subject line'}</span>
                  <span className="muted truncate small">{form.preheader}</span>
                </div>
                <div className={`preview-frame ${device}`}>
                  <iframe title="Email preview" sandbox="" srcDoc={preview.html} />
                </div>
                <p className="muted small">Previewing as {SAMPLE_CONTACT.first_name} {SAMPLE_CONTACT.last_name} &lt;{SAMPLE_CONTACT.email}&gt;</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <TestSendModal open={testOpen} onClose={() => setTestOpen(false)} save={save} dirty={dirty} campaignId={campaign?.id} defaultTo={user?.email} />
      <SendModal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        save={save}
        dirty={dirty}
        campaignId={campaign?.id}
        audience={audience}
        form={form}
        settings={settings}
        onSent={(cid) => navigate(`/campaigns/${cid}`)}
      />
    </>
  );
}

function TestSendModal({ open, onClose, save, dirty, campaignId, defaultTo }) {
  const toast = useToast();
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTo(defaultTo ?? '');
      setError('');
    }
  }, [open, defaultTo]);

  const submit = async (e) => {
    e.preventDefault();
    if (!isValidEmail(to)) return setError('Enter a valid email address.');
    setBusy(true);
    try {
      let cid = campaignId;
      if (!cid || dirty) cid = (await save({ quiet: true }))?.id;
      if (!cid) return;
      await callFunction('send-campaign', { action: 'test', campaign_id: cid, to: to.trim() });
      toast.success(`Test sent to ${to}`);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Send a test email" onClose={onClose} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="test-form" loading={busy}>Send test</Button></>}>
      <form id="test-form" onSubmit={submit} noValidate>
        <Field label="Send to" error={error} required hint="Merge tags use this contact’s data if they exist, otherwise sample data.">
          <input type="email" value={to} onChange={(e) => { setTo(e.target.value); setError(''); }} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}

function SendModal({ open, onClose, save, dirty, campaignId, audience, form, settings, onSent }) {
  const toast = useToast();
  const [mode, setMode] = useState('now');
  const [when, setWhen] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('now');
      setWhen(toLocalInput(Date.now() + 60 * 60 * 1000));
      setError('');
    }
  }, [open]);

  const missingFooter = settings && (!settings.company_name?.trim() || !settings.physical_address?.trim());
  const estimateMins = audience
    ? Math.ceil(((Math.ceil(audience / form.batch_size) - 1) * form.batch_delay_secs) / 60)
    : 0;

  const submit = async (e) => {
    e.preventDefault();
    let scheduled_at;
    if (mode === 'later') {
      const d = new Date(when);
      if (!when || Number.isNaN(d.getTime())) return setError('Pick a date and time.');
      if (d.getTime() < Date.now() + 60_000) return setError('Pick a time at least a minute in the future.');
      scheduled_at = d.toISOString();
    }
    setBusy(true);
    try {
      let cid = campaignId;
      if (!cid || dirty) cid = (await save({ quiet: true }))?.id;
      if (!cid) return;
      await callFunction('send-campaign', { action: 'send', campaign_id: cid, scheduled_at });
      toast.success(mode === 'later' ? 'Campaign scheduled' : 'Sending started');
      onSent(cid);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Review and send" onClose={onClose}
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" form="send-form" loading={busy} disabled={missingFooter || !audience}
          icon={mode === 'later' ? CalendarClock : Send}>
          {mode === 'later' ? 'Schedule' : `Send to ${num(audience)}`}
        </Button>
      </>}>
      <form id="send-form" onSubmit={submit} noValidate>
        <dl className="review-list">
          <div><dt>Subject</dt><dd>{form.subject}</dd></div>
          <div><dt>From</dt><dd>{form.from_name} &lt;{form.from_email}&gt;</dd></div>
          <div><dt>Audience</dt><dd>{form.segment_tags.length ? `Tagged ${form.segment_tags.join(', ')}` : 'All opted-in contacts'} · {num(audience)} recipients</dd></div>
          <div><dt>Throttle</dt><dd>{form.batch_size} per batch, {form.batch_delay_secs}s apart{estimateMins > 0 && ` · about ${estimateMins} min total`}</dd></div>
        </dl>
        {missingFooter && (
          <div className="alert alert-error" role="alert">
            Add your company name and physical mailing address in <Link to="/settings">Settings</Link> first — it’s required in every
            marketing email.
          </div>
        )}
        {!audience && <div className="alert alert-error" role="alert">No opted-in contacts match this audience.</div>}

        <fieldset className="radio-group">
          <legend>When</legend>
          <label><input type="radio" name="when" checked={mode === 'now'} onChange={() => setMode('now')} /> Send now</label>
          <label><input type="radio" name="when" checked={mode === 'later'} onChange={() => setMode('later')} /> Schedule for later</label>
        </fieldset>
        {mode === 'later' && (
          <Field label="Send at (your local time)" error={error} required>
            <input type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setError(''); }} />
          </Field>
        )}
      </form>
    </Modal>
  );
}
