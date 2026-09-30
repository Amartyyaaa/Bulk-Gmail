// Sending engine. Invoked every minute by pg_cron (see supabase/cron.sql) and
// kicked immediately by send-campaign when a campaign is launched.
//
// Each run:
//   1. returns stale claims from crashed runs to the queue
//   2. promotes due scheduled campaigns (snapshots the audience into the queue)
//   3. for every sending campaign it can lease, sends throttled batches:
//        batch_size recipients, then waits batch_delay_secs, under a global
//        requests/second cap for the provider
//   4. retries transient failures with exponential backoff, fails permanent ones
//   5. marks campaigns sent when their queue drains
// Work that doesn't fit in the time budget is picked up by the next run.

import { createRateLimiter, getEsp } from '../_shared/esp.ts';
import { adminClient, buildMessage, json, loadSettings, sleep, type CampaignRow } from '../_shared/util.ts';

const TIME_BUDGET_MS = Number(Deno.env.get('PROCESS_TIME_BUDGET_MS') ?? 50_000);
const MAX_ATTEMPTS = Number(Deno.env.get('MAX_SEND_ATTEMPTS') ?? 4);
const LEASE_SECONDS = Math.ceil(TIME_BUDGET_MS / 1000) + 30;

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  const auth = req.headers.get('Authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const started = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - started);
  const body = await req.json().catch(() => ({}));
  const onlyCampaign: string | undefined = body.campaign_id;

  const db = adminClient();
  const esp = getEsp();
  const limit = createRateLimiter(esp.maxPerSecond);
  const settings = await loadSettings(db);
  const summary: Record<string, unknown> = {};

  await db.rpc('release_stale_claims', { p_older_than_secs: 300 });

  // Promote due scheduled campaigns.
  const { data: due } = await db
    .from('campaigns')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString());
  for (const c of due ?? []) {
    const { data: queued } = await db.rpc('queue_campaign', { p_campaign_id: c.id });
    summary[`queued:${c.id}`] = queued;
  }

  let q = db.from('campaigns').select('*').eq('status', 'sending').order('started_at');
  if (onlyCampaign) q = q.eq('id', onlyCampaign);
  const { data: campaigns, error } = await q;
  if (error) return json({ error: error.message }, 500);

  for (const campaign of campaigns ?? []) {
    if (timeLeft() < 5_000) break;
    const { data: leased } = await db.rpc('acquire_campaign_lease', {
      p_campaign_id: campaign.id,
      p_seconds: LEASE_SECONDS,
    });
    if (!leased) continue;

    try {
      summary[campaign.id] = await runCampaign(campaign);
    } finally {
      await db.from('campaigns').update({ lease_until: null }).eq('id', campaign.id);
    }
  }

  return json({ ok: true, provider: esp.name, ms: Date.now() - started, summary });

  async function runCampaign(campaign: CampaignRow & {
    batch_size: number;
    batch_delay_secs: number;
    last_batch_at: string | null;
  }) {
    let sent = 0, failed = 0, retried = 0, batches = 0;
    let lastBatchAt = campaign.last_batch_at ? Date.parse(campaign.last_batch_at) : 0;
    const delayMs = campaign.batch_delay_secs * 1000;

    while (timeLeft() > 5_000) {
      // Honour the inter-batch delay, including across separate runs.
      const wait = lastBatchAt + delayMs - Date.now();
      if (wait > 0) {
        if (wait > timeLeft() - 5_000) break; // next cron run will continue
        await sleep(wait);
      }

      // Stop if an admin paused or cancelled mid-flight.
      const { data: fresh } = await db.from('campaigns').select('status').eq('id', campaign.id).single();
      if (fresh?.status !== 'sending') break;

      // Never claim more than we can send before the time budget runs out;
      // the rest of a large batch continues on the next loop or run.
      const fits = Math.floor((esp.maxPerSecond * (timeLeft() - 5_000)) / 1000);
      if (fits < 1) break;
      const { data: batch, error } = await db.rpc('claim_recipients', {
        p_campaign_id: campaign.id,
        p_limit: Math.min(campaign.batch_size, fits),
      });
      if (error) throw error;
      if (!batch?.length) {
        await db.rpc('finalize_campaign_if_done', { p_campaign_id: campaign.id });
        break;
      }

      batches++;
      await Promise.all(
        batch.map(async (r: {
          id: string; email: string; attempts: number;
          first_name: string | null; last_name: string | null; unsubscribe_token: string;
        }) => {
          await limit();
          const message = buildMessage({ campaign, settings, contact: r, recipientId: r.id });
          const result = await esp.send(message);
          const now = new Date().toISOString();

          if (result.ok) {
            sent++;
            await db.from('campaign_recipients').update({
              status: 'sent', provider_message_id: result.messageId, sent_at: now,
              last_error: null, claimed_at: null, updated_at: now,
            }).eq('id', r.id);
          } else if (result.transient && r.attempts < MAX_ATTEMPTS) {
            retried++;
            const backoffSecs = 30 * 2 ** (r.attempts - 1); // 30s, 60s, 120s...
            await db.from('campaign_recipients').update({
              status: 'queued', last_error: result.error, claimed_at: null, updated_at: now,
              next_attempt_at: new Date(Date.now() + backoffSecs * 1000).toISOString(),
            }).eq('id', r.id);
          } else {
            failed++;
            await db.from('campaign_recipients').update({
              status: 'failed', last_error: result.error, claimed_at: null, updated_at: now,
            }).eq('id', r.id);
            await db.from('events').insert({
              campaign_id: campaign.id, recipient_id: r.id, email: r.email, type: 'failed',
              meta: { message: result.error, status: result.status ?? null },
            });
          }
        }),
      );

      lastBatchAt = Date.now();
      await db.from('campaigns')
        .update({ last_batch_at: new Date(lastBatchAt).toISOString(), lease_until: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString() })
        .eq('id', campaign.id);
    }

    return { batches, sent, failed, retried };
  }
});
