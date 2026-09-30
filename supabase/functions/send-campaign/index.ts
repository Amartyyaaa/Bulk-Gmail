// Campaign lifecycle actions for signed-in admins:
//   test      – send one rendered copy to an address
//   send      – launch now (scheduled_at omitted) or schedule for later
//   unschedule– scheduled -> draft
//   pause / resume / cancel
// The browser never sees ESP credentials; all sending happens server-side.

import { getEsp } from '../_shared/esp.ts';
import { unknownMergeTags, isValidEmail } from '../_shared/render.js';
import { adminClient, buildMessage, corsHeaders, getCaller, json, loadSettings } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const db = adminClient();
  const caller = await getCaller(req, db);
  if (!caller) return json({ error: 'Not signed in' }, 401);
  if (caller.role !== 'admin') return json({ error: 'Only admins can send campaigns' }, 403);

  const { action, campaign_id, to, scheduled_at } = await req.json().catch(() => ({}));
  if (!campaign_id) return json({ error: 'campaign_id is required' }, 400);

  const { data: campaign, error } = await db.from('campaigns').select('*').eq('id', campaign_id).single();
  if (error || !campaign) return json({ error: 'Campaign not found' }, 404);

  const settings = await loadSettings(db);

  const setStatus = async (from: string[], patch: Record<string, unknown>) => {
    const { data, error } = await db.from('campaigns')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', campaign_id).in('status', from).select().single();
    if (error || !data) return json({ error: `Campaign is ${campaign.status}; cannot ${action}` }, 409);
    return json({ ok: true, campaign: data });
  };

  switch (action) {
    case 'test': {
      if (!isValidEmail(to)) return json({ error: 'Enter a valid test address' }, 400);
      const problems = validate(campaign, settings, { requireAddress: false });
      if (problems.length) return json({ error: problems.join(' ') }, 422);
      const { data: contact } = await db.from('contacts')
        .select('email, first_name, last_name, unsubscribe_token').eq('email', to).maybeSingle();
      const message = buildMessage({
        campaign,
        settings,
        // A real contact's data if we have one, otherwise sample data. The
        // unsubscribe token for a non-contact is random and harmless.
        contact: contact ?? { email: to, first_name: 'Alex', last_name: 'Sample', unsubscribe_token: crypto.randomUUID() },
        subjectPrefix: '[Test] ',
      });
      message.to = to;
      const result = await getEsp().send(message);
      if (!result.ok) return json({ error: result.error }, 502);
      return json({ ok: true, messageId: result.messageId });
    }

    case 'send': {
      const problems = validate(campaign, settings, { requireAddress: true });
      if (problems.length) return json({ error: problems.join(' ') }, 422);

      const when = scheduled_at ? new Date(scheduled_at) : new Date();
      if (Number.isNaN(when.getTime())) return json({ error: 'Invalid schedule time' }, 400);
      if (scheduled_at && when.getTime() < Date.now() - 60_000) {
        return json({ error: 'Scheduled time is in the past' }, 400);
      }
      const { data: audience } = await db.rpc('audience_count', { p_tags: campaign.segment_tags });
      if (!audience) return json({ error: 'No opted-in, unsuppressed contacts match this audience' }, 422);

      const res = await setStatus(['draft'], { status: 'scheduled', scheduled_at: when.toISOString() });
      if (res.ok && !scheduled_at) kickWorker(campaign_id);
      return res;
    }

    case 'unschedule':
      return setStatus(['scheduled'], { status: 'draft', scheduled_at: null });

    case 'pause':
      return setStatus(['sending', 'scheduled'], { status: 'paused' });

    case 'resume': {
      // A campaign paused before its queue was built goes back to scheduled.
      const { count } = await db.from('campaign_recipients')
        .select('id', { count: 'exact', head: true }).eq('campaign_id', campaign_id);
      const res = await setStatus(['paused'], count ? { status: 'sending' } : { status: 'scheduled' });
      if (res.ok) kickWorker(campaign_id);
      return res;
    }

    case 'cancel': {
      const res = await setStatus(['scheduled', 'sending', 'paused'], { status: 'cancelled', completed_at: new Date().toISOString() });
      if (res.ok) {
        await db.from('campaign_recipients')
          .update({ status: 'skipped', last_error: 'Campaign cancelled', updated_at: new Date().toISOString() })
          .eq('campaign_id', campaign_id).eq('status', 'queued');
      }
      return res;
    }

    default:
      return json({ error: `Unknown action "${action}"` }, 400);
  }
});

function validate(
  c: Record<string, string>,
  s: { physical_address: string; company_name: string },
  { requireAddress }: { requireAddress: boolean },
) {
  const problems: string[] = [];
  if (!c.subject?.trim()) problems.push('Subject is required.');
  if (!c.from_name?.trim()) problems.push('From name is required.');
  if (!isValidEmail(c.from_email)) problems.push('A valid from address is required.');
  if (c.reply_to && !isValidEmail(c.reply_to)) problems.push('Reply-to must be a valid address.');
  if (!c.html?.trim()) problems.push('Email content is empty.');
  const unknown = unknownMergeTags(c.html + c.subject + c.preheader);
  if (unknown.length) problems.push(`Unknown merge tags: ${unknown.join(', ')}.`);
  if (requireAddress && (!s.physical_address?.trim() || !s.company_name?.trim())) {
    problems.push('Add your company name and physical mailing address in Settings before sending (required by CAN-SPAM).');
  }
  return problems;
}

/** Start processing right away instead of waiting for the next cron tick. */
function kickWorker(campaignId: string) {
  const task = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-queue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('CRON_SECRET')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign_id: campaignId }),
  }).catch((err) => console.error('kickWorker failed', err));
  // @ts-ignore EdgeRuntime is provided by Supabase
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task);
}
