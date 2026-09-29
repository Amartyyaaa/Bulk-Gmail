import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Mail, Plus, Search, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useCampaignStats, useDebounced, useRealtime } from '../lib/hooks.js';
import { dateTime, fmtRate, num, rates } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, ConfirmDialog, EmptyState, PageHeader, Skeleton, StatusBadge, Tabs } from '../components/ui.jsx';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'active', label: 'Sending' },
  { value: 'sent', label: 'Sent' },
];

export default function Campaigns() {
  const { isAdmin, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const q = useDebounced(search);
  const { stats } = useCampaignStats();

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, name, subject, status, scheduled_at, started_at, completed_at, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) toast.error(error);
    setCampaigns(data ?? []);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);
  useRealtime('campaigns', ['campaigns'], load);

  const visible = useMemo(() => {
    if (!campaigns) return null;
    return campaigns.filter((c) => {
      if (filter === 'active' && !['sending', 'paused'].includes(c.status)) return false;
      if (!['all', 'active'].includes(filter) && c.status !== filter) return false;
      if (q && !`${c.name} ${c.subject}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [campaigns, filter, q]);

  const counts = useMemo(() => {
    const c = { all: campaigns?.length ?? 0 };
    for (const x of campaigns ?? []) {
      const k = ['sending', 'paused'].includes(x.status) ? 'active' : x.status;
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [campaigns]);

  const duplicate = async (id) => {
    const { data: src, error } = await supabase.from('campaigns').select('*').eq('id', id).single();
    if (error) return toast.error(error);
    const { data, error: err } = await supabase
      .from('campaigns')
      .insert({
        name: `${src.name} (copy)`,
        subject: src.subject,
        preheader: src.preheader,
        from_name: src.from_name,
        from_email: src.from_email,
        reply_to: src.reply_to,
        html: src.html,
        segment_tags: src.segment_tags,
        batch_size: src.batch_size,
        batch_delay_secs: src.batch_delay_secs,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (err) return toast.error(err);
    toast.success('Campaign duplicated');
    navigate(`/campaigns/${data.id}/edit`);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    const { error } = await supabase.from('campaigns').delete().eq('id', toDelete.id);
    setDeleting(false);
    if (error) return toast.error(error);
    toast.success('Campaign deleted');
    setToDelete(null);
    load();
  };

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Create, schedule and track your email campaigns."
        actions={
          isAdmin && (
            <Link to="/campaigns/new" className="btn btn-primary">
              <Plus size={16} aria-hidden="true" /> New campaign
            </Link>
          )
        }
      />

      <div className="toolbar">
        <Tabs
          label="Filter campaigns"
          value={filter}
          onChange={setFilter}
          tabs={FILTERS.map((f) => ({ ...f, count: counts[f.value] ?? 0 }))}
        />
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search campaigns</span>
          <input type="search" placeholder="Search campaigns…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {visible === null ? (
        <div className="card card-body"><Skeleton rows={5} /></div>
      ) : campaigns.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Mail}
            title="No campaigns yet"
            action={isAdmin && <Link to="/campaigns/new" className="btn btn-primary"><Plus size={16} /> Create your first campaign</Link>}
          >
            Campaigns you create will show up here with live delivery and engagement stats.
          </EmptyState>
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState icon={Search} title="No matching campaigns">Try a different filter or search term.</EmptyState>
        </div>
      ) : (
        <div className="campaign-grid">
          {visible.map((c) => {
            const s = stats[c.id] ?? {};
            const r = rates(s);
            const editable = c.status === 'draft';
            const to = editable && isAdmin ? `/campaigns/${c.id}/edit` : `/campaigns/${c.id}`;
            return (
              <article key={c.id} className="card campaign-card">
                <div className="campaign-card-top">
                  <StatusBadge status={c.status} />
                  <span className="muted small">
                    {c.status === 'scheduled' ? `Sends ${dateTime(c.scheduled_at)}`
                      : c.completed_at ? `Sent ${dateTime(c.completed_at)}`
                      : c.started_at ? `Started ${dateTime(c.started_at)}`
                      : `Edited ${dateTime(c.updated_at)}`}
                  </span>
                </div>
                <h3 className="campaign-name">
                  <Link to={to} className="stretched">{c.name}</Link>
                </h3>
                <p className="muted small truncate">{c.subject || 'No subject yet'}</p>
                {c.status !== 'draft' && (
                  <dl className="mini-stats">
                    <div><dt>Sent</dt><dd>{num(s.sent)}</dd></div>
                    <div><dt>Opens</dt><dd>{s.sent ? fmtRate(r.openRate) : '—'}</dd></div>
                    <div><dt>Clicks</dt><dd>{s.sent ? fmtRate(r.clickRate) : '—'}</dd></div>
                    <div><dt>Bounces</dt><dd>{s.sent ? fmtRate(r.bounceRate) : '—'}</dd></div>
                  </dl>
                )}
                {c.status === 'sending' && s.total > 0 && (
                  <div className="progress" role="progressbar" aria-label="Send progress"
                    aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={s.total - s.pending}>
                    <span style={{ width: `${((s.total - s.pending) / s.total) * 100}%` }} />
                  </div>
                )}
                {isAdmin && (
                  <div className="campaign-card-actions">
                    <Button size="sm" variant="ghost" icon={Copy} onClick={() => duplicate(c.id)} aria-label={`Duplicate ${c.name}`}>
                      Duplicate
                    </Button>
                    {['draft', 'sent', 'cancelled'].includes(c.status) && (
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setToDelete(c)} aria-label={`Delete ${c.name}`}>
                        Delete
                      </Button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="Delete campaign?"
        danger
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      >
        <p>
          <strong>{toDelete?.name}</strong> and its recipient history and analytics will be permanently deleted.
        </p>
      </ConfirmDialog>
    </>
  );
}
