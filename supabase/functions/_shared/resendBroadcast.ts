// Resend Broadcasts: the alternative to sending one API email per recipient.
// A campaign's recipients are added as Resend contacts in a per-campaign
// segment, then one broadcast is sent to that segment. Needs a Resend API key
// with "Full access" (a "Sending access" key can't manage contacts).
//
// Resend keeps one global record per contact, so an address that unsubscribed
// through any broadcast stays unsubscribed. We never set unsubscribed=false.

const API = 'https://api.resend.com';

export type ApiResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; transient: boolean };

let throttle: () => Promise<void> = async () => {};

/** Share the caller's requests/second limiter (Resend counts every API call). */
export function setThrottle(fn: () => Promise<void>) {
  throttle = fn;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  await throttle();
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return { ok: false, status: 500, error: 'RESEND_API_KEY is not set', transient: false };
  try {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data };
    let error = data.message || data.name || `Resend HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      error += ' (Broadcasts need a Resend API key with Full access)';
    }
    return { ok: false, status: res.status, error, transient: res.status === 429 || res.status >= 500 };
  } catch (err) {
    return { ok: false, status: 0, error: `Network error: ${(err as Error).message}`, transient: true };
  }
}

export function createSegment(name: string) {
  return call<{ id: string }>('POST', '/segments', { name });
}

/**
 * Put one address in the segment. Returns `unsubscribed: true` when Resend
 * already has the contact marked unsubscribed, so the caller can suppress it.
 */
export async function addToSegment(
  segmentId: string,
  contact: { email: string; first_name?: string | null; last_name?: string | null },
): Promise<ApiResult<{ unsubscribed: boolean }>> {
  const created = await call('POST', '/contacts', {
    email: contact.email,
    first_name: contact.first_name || undefined,
    last_name: contact.last_name || undefined,
    segments: [{ id: segmentId }],
  });
  if (created.ok) return { ok: true, data: { unsubscribed: false } };
  if (created.transient) return created;

  // Most likely the contact already exists: add it to the segment instead,
  // then read its current state (never overwrite an unsubscribe).
  const email = encodeURIComponent(contact.email);
  const added = await call('POST', `/contacts/${email}/segments/${segmentId}`);
  if (!added.ok) return { ...added, error: `${created.error}; ${added.error}` };
  const existing = await call<{ unsubscribed?: boolean }>('GET', `/contacts/${email}`);
  if (!existing.ok) return existing;
  return { ok: true, data: { unsubscribed: !!existing.data.unsubscribed } };
}

export function sendBroadcast(opts: {
  segmentId: string;
  name: string;
  from: string;
  replyTo?: string;
  subject: string;
  previewText?: string;
  html: string;
  text: string;
}) {
  return call<{ id: string }>('POST', '/broadcasts', {
    segment_id: opts.segmentId,
    name: opts.name,
    from: opts.from,
    reply_to: opts.replyTo || undefined,
    subject: opts.subject,
    preview_text: opts.previewText || undefined,
    html: opts.html,
    text: opts.text,
    send: true,
  });
}
