import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, CircleX, Copy, Globe, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useSettings } from '../lib/hooks.js';
import { checkDomain } from '../lib/dns.js';
import { dateTime } from '../lib/format.js';
import { isValidEmail } from '@shared/render.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Card, Field, PageHeader, Skeleton, Spinner, Tabs } from '../components/ui.jsx';

const TABS = [
  { value: 'sender', label: 'Sender & footer' },
  { value: 'sending', label: 'Sending' },
  { value: 'domain', label: 'Domain authentication' },
  { value: 'team', label: 'Team' },
];

export default function Settings() {
  const [tab, setTab] = useState('sender');
  const { settings, loading, setSettings } = useSettings();

  return (
    <>
      <PageHeader title="Settings" description="Sender identity, compliance footer, sending limits and deliverability." />
      <Tabs label="Settings sections" value={tab} onChange={setTab} tabs={TABS} />
      <div className="tab-panel">
        {loading ? (
          <Card><Skeleton rows={6} /></Card>
        ) : tab === 'sender' ? (
          <SenderSettings settings={settings} onSaved={setSettings} />
        ) : tab === 'sending' ? (
          <SendingSettings settings={settings} onSaved={setSettings} />
        ) : tab === 'domain' ? (
          <DomainAuth settings={settings} onSaved={setSettings} />
        ) : (
          <Team />
        )}
      </div>
    </>
  );
}

function useSettingsForm(settings, onSaved, fields, validate) {
  const toast = useToast();
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((f) => [f, settings?.[f] ?? ''])));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const save = async (e) => {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('app_settings')
      .update({ ...form, updated_at: new Date().toISOString() })
      .eq('id', true)
      .select()
      .single();
    setSaving(false);
    if (error) return toast.error(error);
    onSaved(data);
    toast.success('Settings saved');
  };

  return { form, set, errors, saving, save };
}

function SenderSettings({ settings, onSaved }) {
  const { isAdmin } = useAuth();
  const { form, set, errors, saving, save } = useSettingsForm(
    settings,
    onSaved,
    ['company_name', 'physical_address', 'default_from_name', 'default_from_email', 'default_reply_to'],
    (f) => ({
      company_name: !f.company_name.trim() && 'Company name is required in every email footer.',
      physical_address: !f.physical_address.trim() && 'A physical postal address is legally required (CAN-SPAM, CASL, GDPR).',
      default_from_email: f.default_from_email && !isValidEmail(f.default_from_email) && 'Enter a valid email address.',
      default_reply_to: f.default_reply_to && !isValidEmail(f.default_reply_to) && 'Enter a valid email address.',
    }),
  );

  return (
    <form onSubmit={save} noValidate>
      <fieldset disabled={!isAdmin} className="stack">
        <Card title="Sender identity (email footer)">
          <p className="muted small">
            Every email automatically ends with this identity and an unsubscribe link. Campaigns can’t be sent until both fields are
            filled in.
          </p>
          <div className="form-grid">
            <Field label="Company / sender name" error={errors.company_name} required>
              <input value={form.company_name} onChange={set('company_name')} placeholder="Acme Inc." />
            </Field>
            <Field label="Physical mailing address" error={errors.physical_address} required hint="A street address or registered PO box.">
              <textarea rows={3} value={form.physical_address} onChange={set('physical_address')} placeholder={'123 Market St, Suite 400\nSan Francisco, CA 94103, USA'} />
            </Field>
          </div>
        </Card>
        <Card title="Campaign defaults">
          <div className="form-grid">
            <div className="form-row">
              <Field label="Default from name"><input value={form.default_from_name} onChange={set('default_from_name')} /></Field>
              <Field label="Default from email" error={errors.default_from_email} hint="Must be on your verified sending domain.">
                <input type="email" value={form.default_from_email} onChange={set('default_from_email')} />
              </Field>
            </div>
            <Field label="Default reply-to" error={errors.default_reply_to}>
              <input type="email" value={form.default_reply_to} onChange={set('default_reply_to')} />
            </Field>
          </div>
        </Card>
        {isAdmin && (
          <div className="form-actions">
            <Button type="submit" variant="primary" icon={Save} loading={saving}>Save changes</Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}

function SendingSettings({ settings, onSaved }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { form, set, errors, saving, save } = useSettingsForm(
    settings,
    onSaved,
    ['default_batch_size', 'default_batch_delay_secs'],
    (f) => ({
      default_batch_size: !(Number.isInteger(+f.default_batch_size) && +f.default_batch_size >= 1 && +f.default_batch_size <= 1000) && 'Enter 1–1000.',
      default_batch_delay_secs: !(Number.isInteger(+f.default_batch_delay_secs) && +f.default_batch_delay_secs >= 0 && +f.default_batch_delay_secs <= 3600) && 'Enter 0–3600.',
    }),
  );
  const base = import.meta.env.VITE_SUPABASE_URL;
  const copy = (text) => navigator.clipboard.writeText(text).then(() => toast.success('Copied'));
  const urls = [
    { label: 'Resend webhook', value: `${base}/functions/v1/esp-webhook?provider=resend` },
    { label: 'Amazon SES (SNS subscription)', value: `${base}/functions/v1/esp-webhook?provider=ses&token=<SES_WEBHOOK_TOKEN>` },
  ];

  return (
    <div className="stack">
      <form onSubmit={save} noValidate>
        <fieldset disabled={!isAdmin}>
          <Card title="Default throttling for new campaigns">
            <div className="form-row">
              <Field label="Batch size" error={errors.default_batch_size} hint="Emails per batch.">
                <input type="number" min={1} max={1000} value={form.default_batch_size} onChange={set('default_batch_size')} />
              </Field>
              <Field label="Delay between batches (seconds)" error={errors.default_batch_delay_secs}>
                <input type="number" min={0} max={3600} value={form.default_batch_delay_secs} onChange={set('default_batch_delay_secs')} />
              </Field>
            </div>
            <p className="muted small">
              The sending engine also enforces your provider’s per-second limit (<code>ESP_MAX_PER_SECOND</code> secret), retries
              rate-limit and server errors with exponential backoff, and never retries permanent rejections.
            </p>
            {isAdmin && <Button type="submit" variant="primary" icon={Save} loading={saving}>Save</Button>}
          </Card>
        </fieldset>
      </form>

      <Card title="Delivery webhooks">
        <p className="muted small">
          Real-time analytics come from your provider’s event webhooks. Point them at the URL below. Enable delivered, bounced,
          complained, opened and clicked events.
        </p>
        <ul className="copy-list">
          {urls.map((u) => (
            <li key={u.label}>
              <span className="small strong">{u.label}</span>
              <code className="truncate">{u.value}</code>
              <button type="button" className="icon-btn" onClick={() => copy(u.value)} aria-label={`Copy ${u.label} URL`}><Copy size={16} /></button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const STATUS_ICON = {
  pass: { Icon: CheckCircle2, cls: 'good', label: 'Configured' },
  warn: { Icon: CircleAlert, cls: 'warn', label: 'Needs attention' },
  missing: { Icon: CircleX, cls: 'bad', label: 'Not found' },
  fail: { Icon: CircleX, cls: 'bad', label: 'Problem' },
};

function DomainAuth({ settings, onSaved }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [domain, setDomain] = useState(settings.sending_domain || settings.default_from_email.split('@')[1] || '');
  const [selector, setSelector] = useState(settings.dkim_selector || 'resend');
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const check = async (e) => {
    e.preventDefault();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain.trim())) return toast.error('Enter a domain like mail.example.com');
    setChecking(true);
    try {
      setResult(await checkDomain(domain, { dkimSelector: selector.trim() }));
      if (isAdmin && (domain !== settings.sending_domain || selector !== settings.dkim_selector)) {
        const { data } = await supabase.from('app_settings')
          .update({ sending_domain: domain.trim(), dkim_selector: selector.trim() }).eq('id', true).select().single();
        if (data) onSaved(data);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setChecking(false);
    }
  };

  const d = domain.trim() || 'example.com';

  return (
    <div className="stack">
      <Card title="Check your sending domain">
        <form className="inline-form" onSubmit={check} noValidate>
          <Field label="Sending domain" hint="The domain in your from address.">
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="mail.example.com" />
          </Field>
          <Field label="DKIM selector" hint="Resend: “resend”. SES: one of the three CNAME tokens.">
            <input value={selector} onChange={(e) => setSelector(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" icon={Globe} loading={checking}>Check DNS</Button>
        </form>
        {checking && <Spinner label="Looking up DNS records…" />}
        {result && !checking && (
          <ul className="dns-results" aria-live="polite">
            {[['SPF', result.spf], ['DKIM', result.dkim], ['DMARC', result.dmarc]].map(([name, r]) => {
              const { Icon, cls, label } = STATUS_ICON[r.status];
              return (
                <li key={name}>
                  <Icon size={20} className={cls} aria-hidden="true" />
                  <div>
                    <div><strong>{name}</strong> <span className={`small ${cls}`}>{label}</span></div>
                    {r.records.map((rec) => <code key={rec} className="dns-record">{rec}</code>)}
                    {r.note && <p className="small muted">{r.note}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Why this matters">
        <p className="small">
          Since 2024 Gmail and Yahoo require bulk senders to authenticate with <strong>SPF</strong> and <strong>DKIM</strong>, publish a{' '}
          <strong>DMARC</strong> policy, support one-click unsubscribe (built in here), and keep spam complaints under 0.3%. Without these,
          your campaigns will land in spam or be rejected outright.
        </p>
      </Card>

      <div className="guide-grid">
        <Card title={<><ShieldCheck size={18} aria-hidden="true" /> 1. SPF</>}>
          <p className="small">Lists the servers allowed to send for your domain. Your provider sends from a return-path subdomain it gives you:</p>
          <pre className="dns-snippet">{`Type:  TXT\nHost:  send.${d}   (Resend) / your custom MAIL FROM (SES)\nValue: v=spf1 include:amazonses.com ~all`}</pre>
          <p className="small muted">Only one SPF record per hostname. If one exists, add the <code>include:</code> to it rather than creating a second.</p>
        </Card>
        <Card title={<><ShieldCheck size={18} aria-hidden="true" /> 2. DKIM</>}>
          <p className="small">Cryptographically signs each email. Copy the records exactly from your provider:</p>
          <pre className="dns-snippet">{`Resend: Domains → ${d} → TXT record\n  resend._domainkey.${d}\n\nSES: Verified identities → ${d} → 3 CNAMEs\n  <token>._domainkey.${d} → <token>.dkim.amazonses.com`}</pre>
          <p className="small muted">Your domain shows “Verified” in the provider dashboard once DNS has propagated (minutes to 48h).</p>
        </Card>
        <Card title={<><ShieldCheck size={18} aria-hidden="true" /> 3. DMARC</>}>
          <p className="small">Tells receivers what to do when SPF/DKIM fail, and sends you reports. Start by monitoring:</p>
          <pre className="dns-snippet">{`Type:  TXT\nHost:  _dmarc.${d}\nValue: v=DMARC1; p=none; rua=mailto:dmarc@${d}`}</pre>
          <p className="small muted">After a few weeks of clean reports, tighten to <code>p=quarantine</code>, then <code>p=reject</code>.</p>
        </Card>
      </div>
      <Card title="Deliverability checklist">
        <ul className="checklist small">
          <li>Send from a subdomain (e.g. <code>news.{d}</code>) so marketing reputation is isolated from your transactional mail.</li>
          <li>Warm up a new domain: start with your most engaged contacts and a few hundred emails a day, then roughly double daily.</li>
          <li>Only import contacts who opted in. Never buy lists — hard bounces and spam traps are auto-suppressed, but damage reputation first.</li>
          <li>Keep bounce rate under 2% and complaint rate under 0.1% (see Analytics).</li>
          <li>Always send a test to Gmail and Outlook before a big send.</li>
        </ul>
      </Card>
    </div>
  );
}

function Team() {
  const { isAdmin, user } = useAuth();
  const toast = useToast();
  const [members, setMembers] = useState(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at');
    if (error) toast.error(error);
    setMembers(data ?? []);
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const setRole = async (id, role) => {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
    if (error) return toast.error(error);
    toast.success('Role updated');
    load();
  };

  return (
    <Card title="Team members" padded={false}>
      <p className="card-body muted small">
        <strong>Admins</strong> can manage contacts, edit and send campaigns, and change settings. <strong>Viewers</strong> have read-only
        access to campaigns, contacts and analytics. Invite teammates from Supabase → Authentication → Users; the first account created is
        an admin and new accounts start as viewers.
      </p>
      {members === null ? (
        <div className="card-body"><Skeleton rows={3} /></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Member</th><th scope="col">Joined</th><th scope="col">Role</th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="strong">{m.full_name || m.email}</div>
                    {m.full_name && <div className="small muted">{m.email}</div>}
                  </td>
                  <td className="small">{dateTime(m.created_at)}</td>
                  <td>
                    {isAdmin && m.id !== user.id ? (
                      <label>
                        <span className="sr-only">Role for {m.email}</span>
                        <select value={m.role} onChange={(e) => setRole(m.id, e.target.value)}>
                          <option value="admin">Admin</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </label>
                    ) : (
                      <span className="badge badge-neutral">{m.role}{m.id === user.id ? ' (you)' : ''}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
