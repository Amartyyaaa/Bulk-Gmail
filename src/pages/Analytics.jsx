import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import { useCampaignStats, useRealtime } from '../lib/hooks.js';
import { dateTime, fmtRate, num, rates } from '../lib/format.js';
import { Card, EmptyState, PageHeader, Skeleton, StatCard, StatusBadge } from '../components/ui.jsx';

export default function Analytics() {
  const { stats, loading } = useCampaignStats();
  const [campaigns, setCampaigns] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('campaigns')
      .select('id, name, status, started_at, completed_at')
      .not('status', 'in', '(draft,scheduled)')
      .order('started_at', { ascending: false, nullsFirst: false });
    setCampaigns(data ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useRealtime('analytics-campaigns', ['campaigns'], load);

  const totals = useMemo(() => {
    const t = { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, failed: 0, unsubscribed: 0, complaints: 0 };
    for (const c of campaigns ?? []) {
      const s = stats[c.id];
      if (!s) continue;
      for (const k of Object.keys(t)) t[k] += Number(s[k]) || 0;
    }
    return t;
  }, [campaigns, stats]);

  const r = rates(totals);
  const busy = loading || campaigns === null;

  const chart = (campaigns ?? [])
    .filter((c) => (stats[c.id]?.sent ?? 0) > 0)
    .slice(0, 10)
    .map((c) => ({ ...c, s: stats[c.id], r: rates(stats[c.id]) }));
  const maxRate = Math.max(0.05, ...chart.map((c) => c.r.openRate));

  return (
    <>
      <PageHeader title="Analytics" description="Performance across every campaign, updated live from your email provider’s webhooks." />

      <div className="stat-grid">
        <StatCard loading={busy} label="Emails sent" value={num(totals.sent)} sub={`${num(campaigns?.length ?? 0)} campaigns`} />
        <StatCard loading={busy} label="Delivered" value={num(totals.delivered)} sub={totals.sent ? `${fmtRate(r.deliveryRate)} delivery rate` : null} />
        <StatCard loading={busy} label="Open rate" value={totals.sent ? fmtRate(r.openRate) : '—'} sub={`${num(totals.opened)} unique opens`} />
        <StatCard loading={busy} label="Click rate" value={totals.sent ? fmtRate(r.clickRate) : '—'} sub={`${num(totals.clicked)} unique clicks`} />
        <StatCard loading={busy} label="Bounce rate" value={totals.sent ? fmtRate(r.bounceRate) : '—'} sub={`${num(totals.bounced)} bounced`} />
        <StatCard loading={busy} label="Unsubscribes" value={num(totals.unsubscribed)} sub={`${num(totals.complaints)} complaints`} />
      </div>

      {!busy && totals.sent > 0 && (r.bounceRate > 0.02 || totals.complaints / totals.sent > 0.001) && (
        <div className="alert alert-warn" role="status">
          {r.bounceRate > 0.02 && <>Bounce rate is above 2% — clean your list and only import addresses that opted in recently. </>}
          {totals.complaints / totals.sent > 0.001 && <>Spam complaint rate is above 0.1%, the level where Gmail and Yahoo start filtering.</>}
        </div>
      )}

      {busy ? (
        <Card><Skeleton rows={6} /></Card>
      ) : campaigns.length === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="No data yet" action={<Link to="/campaigns/new" className="btn btn-primary">Create a campaign</Link>}>
            Once you send a campaign, delivery and engagement stats will show up here.
          </EmptyState>
        </Card>
      ) : (
        <>
          {chart.length > 0 && (
            <Card title="Open rate — recent campaigns">
              <ul className="bar-chart" aria-label="Open rate by campaign">
                {chart.map((c) => (
                  <li key={c.id} className="bar-row" tabIndex={0}>
                    <span className="bar-label truncate">{c.name}</span>
                    <span className="bar-track">
                      <span className="bar" style={{ width: `${(c.r.openRate / maxRate) * 100}%` }} />
                    </span>
                    <span className="bar-value">{fmtRate(c.r.openRate)}</span>
                    <span className="bar-tip" role="tooltip">
                      <strong>{c.name}</strong>
                      <span>Opens {num(c.s.opened)} · {fmtRate(c.r.openRate)}</span>
                      <span>Clicks {num(c.s.clicked)} · {fmtRate(c.r.clickRate)}</span>
                      <span>Sent {num(c.s.sent)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="All campaigns" padded={false}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Campaign</th>
                    <th scope="col" className="num">Sent</th>
                    <th scope="col" className="num">Delivered</th>
                    <th scope="col" className="num">Open rate</th>
                    <th scope="col" className="num">Click rate</th>
                    <th scope="col" className="num">Bounce rate</th>
                    <th scope="col" className="num">Unsubs</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const s = stats[c.id] ?? {};
                    const cr = rates(s);
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link to={`/campaigns/${c.id}`} className="strong">{c.name}</Link>
                          <div className="small muted"><StatusBadge status={c.status} /> {dateTime(c.completed_at ?? c.started_at)}</div>
                        </td>
                        <td className="num">{num(s.sent)}</td>
                        <td className="num">{num(s.delivered)}</td>
                        <td className="num">{s.sent ? fmtRate(cr.openRate) : '—'}</td>
                        <td className="num">{s.sent ? fmtRate(cr.clickRate) : '—'}</td>
                        <td className={`num ${cr.bounceRate > 0.02 ? 'bad' : ''}`}>{s.sent ? fmtRate(cr.bounceRate) : '—'}</td>
                        <td className="num">{num(s.unsubscribed)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="muted small">
            Open and click rates are unique opens/clicks divided by delivered emails. Apple Mail Privacy Protection pre-loads images,
            so open rates are inflated — treat clicks as the more reliable engagement signal.
          </p>
        </>
      )}
    </>
  );
}
