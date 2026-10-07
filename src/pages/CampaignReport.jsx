import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, CalendarX, Eye, Inbox, Pause, Pencil, Play, Radio } from 'lucide-react';
import { callFunction, supabase } from '../lib/supabase.js';
import { useCampaignStats, useRealtime, useSettings } from '../lib/hooks.js';
import { dateTime, fmtRate, num, rates, relative } from '../lib/format.js';
import { renderEmail } from '@shared/render.js';
import { SAMPLE_CONTACT } from '../lib/templates.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Button, Card, ConfirmDialog, EmptyState, Modal, PageHeader, Pager, Skeleton, Spinner, StatCard, StatusBadge, Tabs,
} from '../components/ui.jsx';

const PAGE = 50;
const RECIPIENT_FILTERS = ['all', 'queued', 'sent', 'delivered', 'bounced', 'failed', 'skipped'];

export default function CampaignReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { settings } = useSettings();
  const [campaign, setCampaign] = useState(undefined);
  const { stats, loading: statsLoading } = useCampaignStats(id);
  const [busy, setBusy] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('campaigns').select('*').eq('id', id).maybeSingle();
    if (error) toast.error(error);
    setCampaign(data ?? null);
  }, [id, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime('campaign', ['campaigns'], load, { filter: `id=eq.${id}`, delay: 300 });

  if (campaign === undefined) return <Spinner />;
  if (campaign === null) {
    return (
      <EmptyState icon={Inbox} title="Campaign not found" action={<Link to="/campaigns" className="btn btn-primary">Back to campaigns</Link>}>
        It may have been deleted.
      </EmptyState>
    );
  }
  // Drafts live in the editor.
  if (campaign.status === 'draft' && isAdmin) return <Navigate to={`/campaigns/${id}/edit`} replace />;

  const s = stats[id] ?? {};
  const r = rates(s);
  const processed = (s.total ?? 0) - (s.pending ?? 0);
  const live = ['sending', 'scheduled', 'paused'].includes(campaign.status);

  const act = async (action) => {
    setBusy(action);
    try {
      await callFunction('send-campaign', { action, campaign_id: id });
      toast.success({ pause: 'Campaign paused', resume: 'Sending resumed', cancel: 'Campaign cancelled', unschedule: 'Moved back to drafts' }[action]);
      if (action === 'unschedule') navigate(`/campaigns/${id}/edit`);
      else load();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  };

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={
          <Link to="/campaigns" className="back-link">
            <ArrowLeft size={14} aria-hidden="true" /> All campaigns
          </Link>
        }
        actions={
          <>
            <Button icon={Eye} onClick={() => setPreviewOpen(true)}>View email</Button>
            {isAdmin && campaign.status === 'scheduled' && (
              <Button icon={CalendarX} loading={busy === 'unschedule'} onClick={() => act('unschedule')}>Unschedule &amp; edit</Button>
            )}
            {isAdmin && campaign.status === 'sending' && (
              <Button icon={Pause} loading={busy === 'pause'} onClick={() => act('pause')}>Pause</Button>
            )}
            {isAdmin && campaign.status === 'paused' && (
              <Button variant="primary" icon={Play} loading={busy === 'resume'} onClick={() => act('resume')}>Resume</Button>
            )}
            {isAdmin && live && (
              <Button variant="danger" icon={Ban} onClick={() => setConfirmCancel(true)}>Cancel</Button>
            )}
          </>
        }
      />

      <div className="report-meta card card-body">
        <StatusBadge status={campaign.status} />
        {campaign.status === 'sending' && (
          <span className="live-pill"><Radio size={14} aria-hidden="true" /> Live</span>
        )}
        <span><span className="muted">Subject</span> {campaign.subject}</span>
        <span><span className="muted">From</span> {campaign.from_name} &lt;{campaign.from_email}&gt;</span>
        <span>
          <span className="muted">Audience</span> {campaign.segment_tags.length ? campaign.segment_tags.join(', ') : 'All opted-in'}
        </span>
        <span>
          <span className="muted">{campaign.status === 'scheduled' ? 'Scheduled' : 'Started'}</span>{' '}
          {dateTime(campaign.status === 'scheduled' ? campaign.scheduled_at : campaign.started_at)}
        </span>
        {campaign.completed_at && <span><span className="muted">Finished</span> {dateTime(campaign.completed_at)}</span>}
        {campaign.delivery === 'broadcast' && <span><span className="muted">Sent as</span> Resend Broadcast</span>}
      </div>

      {campaign.broadcast_error && (
        <div className="alert alert-error" role="alert">
          <strong>Broadcast problem:</strong> {campaign.broadcast_error}
          {campaign.status === 'paused' && ' Fix it, then press Resume.'}
        </div>
      )}
      {campaign.delivery === 'broadcast' && campaign.esp_broadcast_id && (
        <div className="alert alert-info">
          Sent as a Resend Broadcast. Opens, clicks and unsubscribes are also shown in Resend → Broadcasts.
        </div>
      )}

      {campaign.status !== 'scheduled' && s.total > 0 && (
        <Card>
          <div className="progress-head">
            <span><strong>{num(processed)}</strong> of {num(s.total)} processed</span>
            <span className="muted small">
              {campaign.delivery === 'broadcast'
                ? (campaign.esp_broadcast_id ? 'Broadcast sent' : 'Adding recipients to Resend, then sending one Broadcast')
                : <>
                  {campaign.batch_size} per batch · {campaign.batch_delay_secs}s delay
                  {campaign.last_batch_at && ` · last batch ${relative(campaign.last_batch_at)}`}
                </>}
            </span>
          </div>
          <div className="progress progress-lg" role="progressbar" aria-label="Send progress"
            aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={processed}>
            <span style={{ width: `${(processed / s.total) * 100}%` }} />
          </div>
        </Card>
      )}

      <div className="stat-grid">
        <StatCard loading={statsLoading} label="Sent" value={num(s.sent)} sub={`${num(s.pending)} queued`} />
        <StatCard loading={statsLoading} label="Delivered" value={num(s.delivered)} sub={s.sent ? `${fmtRate(r.deliveryRate)} of sent` : null} />
        <StatCard loading={statsLoading} label="Open rate" value={s.sent ? fmtRate(r.openRate) : '—'} sub={`${num(s.opened)} unique opens`} />
        <StatCard loading={statsLoading} label="Click rate" value={s.sent ? fmtRate(r.clickRate) : '—'} sub={`${num(s.clicked)} unique clicks`} />
        <StatCard loading={statsLoading} label="Bounce rate" value={s.sent ? fmtRate(r.bounceRate) : '—'} sub={`${num(s.bounced)} bounced · ${num(s.failed)} failed`} />
        <StatCard loading={statsLoading} label="Unsubscribes" value={num(s.unsubscribed)} sub={`${num(s.complaints)} spam complaints`} />
      </div>

      <div className="report-grid">
        <RecipientsTable campaignId={id} />
        <ActivityFeed campaignId={id} />
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this campaign?"
        danger
        confirmLabel="Cancel campaign"
        loading={busy === 'cancel'}
        onConfirm={() => act('cancel')}
        onClose={() => setConfirmCancel(false)}
      >
        <p>Emails already sent can’t be recalled. Everyone still queued will be skipped. This can’t be undone.</p>
      </ConfirmDialog>

      <Modal open={previewOpen} title="Email preview" onClose={() => setPreviewOpen(false)} size="lg">
        {previewOpen && (
          <div className="preview-frame desktop tall">
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={renderEmail({ campaign, contact: SAMPLE_CONTACT, settings: settings ?? {}, unsubscribeUrl: '#' }).html}
            />
          </div>
        )}
      </Modal>
    </>
  );
}

function RecipientsTable({ campaignId }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState(null);
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    let q = supabase
      .from('campaign_recipients')
      .select('id, email, status, attempts, sent_at, delivered_at, opened_at, clicked_at, last_error', { count: 'exact' })
      .eq('campaign_id', campaignId)
      .order('updated_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (filter === 'queued') q = q.in('status', ['queued', 'sending']);
    else if (filter !== 'all') q = q.eq('status', filter);
    const { data, count: c } = await q;
    setRows(data ?? []);
    setCount(c ?? 0);
  }, [campaignId, filter, page]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime('recipients', ['campaign_recipients'], load, { filter: `campaign_id=eq.${campaignId}`, delay: 1500 });

  const pages = Math.max(1, Math.ceil(count / PAGE));

  return (
    <Card title="Recipients" padded={false} className="recipients-card">
      <div className="card-toolbar">
        <Tabs
          label="Filter recipients by status"
          value={filter}
          onChange={(v) => { setFilter(v); setPage(0); }}
          tabs={RECIPIENT_FILTERS.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))}
        />
      </div>
      {rows === null ? (
        <div className="card-body"><Skeleton rows={6} /></div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title="No recipients here">
          {filter === 'all' ? 'Recipients are queued when the campaign starts sending.' : `No recipients are ${filter}.`}
        </EmptyState>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Sent</th><th scope="col">Opened</th><th scope="col">Clicked</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="truncate">{r.email}</div>
                      {r.last_error && ['failed', 'bounced', 'queued', 'skipped'].includes(r.status) && (
                        <div className="small bad truncate" title={r.last_error}>
                          {r.status === 'queued' ? `Retry ${r.attempts}: ` : ''}{r.last_error}
                        </div>
                      )}
                    </td>
                    <td><StatusBadge status={r.status === 'sending' ? 'queued' : r.status} /></td>
                    <td className="nowrap small">{r.sent_at ? dateTime(r.sent_at) : '—'}</td>
                    <td className="nowrap small">{r.opened_at ? relative(r.opened_at) : '—'}</td>
                    <td className="nowrap small">{r.clicked_at ? relative(r.clicked_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} count={count} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

const EVENT_LABEL = {
  delivered: 'Delivered to', delivery_delayed: 'Delivery delayed for', open: 'Opened by', click: 'Clicked by',
  bounce: 'Bounced', complaint: 'Spam complaint from', unsubscribe: 'Unsubscribed', failed: 'Failed for',
};

function ActivityFeed({ campaignId }) {
  const [events, setEvents] = useState(null);
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('events')
      .select('id, type, email, url, occurred_at')
      .eq('campaign_id', campaignId)
      .order('occurred_at', { ascending: false })
      .limit(30);
    setEvents(data ?? []);
  }, [campaignId]);
  useEffect(() => {
    load();
  }, [load]);
  useRealtime('events', ['events'], load, { filter: `campaign_id=eq.${campaignId}`, delay: 500 });

  return (
    <Card title="Live activity" className="activity-card">
      {events === null ? (
        <Skeleton rows={6} />
      ) : events.length === 0 ? (
        <p className="muted small">Opens, clicks, bounces and unsubscribes appear here in real time as your provider reports them.</p>
      ) : (
        <ul className="activity" aria-live="polite">
          {events.map((e) => (
            <li key={e.id}>
              <span className={`dot dot-${e.type}`} aria-hidden="true" />
              <div>
                <div className="small">
                  {EVENT_LABEL[e.type]} <strong>{e.email}</strong>
                </div>
                {e.url && <div className="small muted truncate" title={e.url}>{e.url}</div>}
                <div className="small muted">{relative(e.occurred_at)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
