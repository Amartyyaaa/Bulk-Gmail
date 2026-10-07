// Receives delivery / engagement events from the ESP and applies them via the
// record_esp_event() SQL function, which updates recipient status, writes the
// events table (driving realtime analytics) and auto-suppresses hard bounces
// and spam complaints.
//
// Resend: point a webhook at  .../functions/v1/esp-webhook?provider=resend
//         and set RESEND_WEBHOOK_SECRET (the "whsec_..." signing secret).
// SES:    configuration set -> SNS topic -> HTTPS subscription to
//         .../functions/v1/esp-webhook?provider=ses&token=<SES_WEBHOOK_TOKEN>

import { adminClient, json } from '../_shared/util.ts';

type Mapped = {
  providerEventId: string;
  messageId: string;
  type: 'delivered' | 'delivery_delayed' | 'open' | 'click' | 'bounce' | 'complaint' | 'failed' | 'unsubscribe';
  occurredAt?: string;
  url?: string;
  hardBounce?: boolean;
  meta?: Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider') ?? Deno.env.get('ESP_PROVIDER') ?? 'resend';
  const raw = await req.text();

  let events: Mapped[];
  try {
    events = provider === 'ses' ? await handleSes(url, req, raw) : await handleResend(req, raw);
  } catch (err) {
    const e = err as Error & { status?: number };
    return json({ error: e.message }, e.status ?? 400);
  }

  const db = adminClient();
  const results: string[] = [];
  for (const ev of events) {
    if (ev.type === 'unsubscribe') {
      // Someone used Resend's hosted unsubscribe link (broadcast emails).
      const { error } = await db.rpc('record_external_unsubscribe', {
        p_email: ev.meta?.email ?? null, p_source: 'resend', p_campaign_id: null,
      });
      if (error) return json({ error: error.message }, 500);
      results.push('unsubscribe');
      continue;
    }
    const { data, error } = await db.rpc('record_esp_event', {
      p_provider_event_id: ev.providerEventId,
      p_provider_message_id: ev.messageId,
      p_type: ev.type,
      p_occurred_at: ev.occurredAt ?? null,
      p_url: ev.url ?? null,
      p_hard_bounce: ev.hardBounce ?? false,
      p_meta: ev.meta ?? {},
    });
    if (error) return json({ error: error.message }, 500); // non-2xx -> provider retries
    results.push(data);
  }
  return json({ ok: true, results });
});

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

// ---------------------------------------------------------------------------
// Resend (Svix-signed)
// ---------------------------------------------------------------------------
async function handleResend(req: Request, raw: string): Promise<Mapped[]> {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!secret) fail('RESEND_WEBHOOK_SECRET not configured', 500);

  const id = req.headers.get('svix-id');
  const ts = req.headers.get('svix-timestamp');
  const sigHeader = req.headers.get('svix-signature');
  if (!id || !ts || !sigHeader) fail('Missing signature headers', 401);
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) fail('Stale webhook timestamp', 401);

  const keyBytes = Uint8Array.from(atob(secret!.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  const valid = sigHeader!.split(' ').some((part) => timingSafeEqual(part.split(',')[1] ?? '', expected));
  if (!valid) fail('Invalid signature', 401);

  const payload = JSON.parse(raw);
  const d = payload.data ?? {};
  // Broadcast emails carry Resend's broadcast id; the address lets us match the recipient.
  const broadcast = d.broadcast_id ? { broadcast_id: d.broadcast_id, to: [d.to].flat()[0] } : {};
  const base = { providerEventId: `resend:${id}`, messageId: d.email_id, occurredAt: payload.created_at, meta: broadcast };

  if (payload.type === 'contact.updated' || payload.type === 'contact.created') {
    return d.unsubscribed === true && d.email
      ? [{ ...base, messageId: '', type: 'unsubscribe', meta: { email: d.email } }]
      : [];
  }

  switch (payload.type) {
    case 'email.delivered':
      return [{ ...base, type: 'delivered' }];
    case 'email.delivery_delayed':
      return [{ ...base, type: 'delivery_delayed' }];
    case 'email.opened':
      return [{ ...base, type: 'open' }];
    case 'email.clicked':
      return [{ ...base, type: 'click', url: d.click?.link }];
    case 'email.bounced': {
      // Resend reports soft bounces as delivery_delayed; treat unknown as hard.
      const kind = String(d.bounce?.type ?? 'Permanent');
      return [{
        ...base, type: 'bounce', hardBounce: !/transient|soft/i.test(kind),
        meta: { ...broadcast, message: d.bounce?.message, bounce_type: kind, sub_type: d.bounce?.subType },
      }];
    }
    case 'email.complained':
      return [{ ...base, type: 'complaint' }];
    case 'email.failed':
      return [{ ...base, type: 'failed', meta: { ...broadcast, message: d.failed?.reason } }];
    default:
      return []; // email.sent etc. — status already recorded at send time
  }
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Amazon SES via SNS
// ---------------------------------------------------------------------------
async function handleSes(url: URL, _req: Request, raw: string): Promise<Mapped[]> {
  const token = Deno.env.get('SES_WEBHOOK_TOKEN');
  if (!token || !timingSafeEqual(url.searchParams.get('token') ?? '', token)) fail('Invalid token', 401);

  const envelope = JSON.parse(raw);
  if (envelope.Type === 'SubscriptionConfirmation') {
    const subscribe = new URL(envelope.SubscribeURL);
    if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(subscribe.hostname)) fail('Unexpected SubscribeURL host');
    await fetch(subscribe);
    return [];
  }
  if (envelope.Type !== 'Notification') return [];

  const msg = JSON.parse(envelope.Message);
  const kind: string = msg.eventType ?? msg.notificationType;
  const messageId: string = msg.mail?.messageId;
  const base = { providerEventId: `ses:${envelope.MessageId}`, messageId };

  switch (kind) {
    case 'Delivery':
      return [{ ...base, type: 'delivered', occurredAt: msg.delivery?.timestamp }];
    case 'DeliveryDelay':
      return [{ ...base, type: 'delivery_delayed', occurredAt: msg.deliveryDelay?.timestamp }];
    case 'Open':
      return [{ ...base, type: 'open', occurredAt: msg.open?.timestamp }];
    case 'Click':
      return [{ ...base, type: 'click', occurredAt: msg.click?.timestamp, url: msg.click?.link }];
    case 'Bounce':
      return [{
        ...base, type: 'bounce', occurredAt: msg.bounce?.timestamp,
        hardBounce: msg.bounce?.bounceType === 'Permanent',
        meta: {
          bounce_type: msg.bounce?.bounceType, sub_type: msg.bounce?.bounceSubType,
          message: msg.bounce?.bouncedRecipients?.[0]?.diagnosticCode,
        },
      }];
    case 'Complaint':
      return [{ ...base, type: 'complaint', occurredAt: msg.complaint?.timestamp }];
    case 'Reject':
    case 'Rendering Failure':
      return [{ ...base, type: 'failed', meta: { message: msg.reject?.reason ?? kind } }];
    default:
      return [];
  }
}
