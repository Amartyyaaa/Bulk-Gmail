// Email service provider adapters. Only API-based providers (no SMTP).
// Select with ESP_PROVIDER=resend|ses. Keys live only in Edge Function secrets.

export interface OutgoingEmail {
  from: string; // "Name <addr@domain>"
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: Record<string, string>;
  idempotencyKey?: string;
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; transient: boolean; error: string; status?: number };

export interface EspAdapter {
  name: 'resend' | 'ses';
  /** Provider's sustained send rate we should stay under (requests / second). */
  maxPerSecond: number;
  send(email: OutgoingEmail): Promise<SendResult>;
}

const env = (k: string, fallback = '') => Deno.env.get(k) ?? fallback;

/** 429 and 5xx are worth retrying; other 4xx are permanent (bad address, etc). */
function isTransient(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------
function resendAdapter(): EspAdapter {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  return {
    name: 'resend',
    maxPerSecond: Number(env('ESP_MAX_PER_SECOND', '2')),
    async send(email) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(email.idempotencyKey ? { 'Idempotency-Key': email.idempotencyKey } : {}),
          },
          body: JSON.stringify({
            from: email.from,
            to: [email.to],
            reply_to: email.replyTo || undefined,
            subject: email.subject,
            html: email.html,
            text: email.text,
            headers: email.headers,
            tags: Object.entries(email.tags ?? {}).map(([name, value]) => ({ name, value })),
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.id) return { ok: true, messageId: body.id };
        return {
          ok: false,
          transient: isTransient(res.status),
          status: res.status,
          error: body.message || body.name || `Resend HTTP ${res.status}`,
        };
      } catch (err) {
        return { ok: false, transient: true, error: `Network error: ${(err as Error).message}` };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Amazon SES (v2 API, SigV4-signed fetch; no SDK needed)
// ---------------------------------------------------------------------------
const enc = new TextEncoder();

async function hmac(key: BufferSource, data: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

async function sha256Hex(data: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signedSesFetch(path: string, payload: unknown) {
  const region = env('AWS_REGION', 'us-east-1');
  const accessKey = env('AWS_ACCESS_KEY_ID');
  const secretKey = env('AWS_SECRET_ACCESS_KEY');
  if (!accessKey || !secretKey) throw new Error('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set');

  const host = `email.${region}.amazonaws.com`;
  const body = JSON.stringify(payload);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/ses/aws4_request`;

  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, await sha256Hex(body)].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

  let key = await hmac(enc.encode(`AWS4${secretKey}`), dateStamp);
  key = await hmac(key, region);
  key = await hmac(key, 'ses');
  key = await hmac(key, 'aws4_request');
  const signature = toHex(await hmac(key, stringToSign));

  return fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
}

function sesAdapter(): EspAdapter {
  const configurationSet = env('SES_CONFIGURATION_SET');
  return {
    name: 'ses',
    maxPerSecond: Number(env('ESP_MAX_PER_SECOND', '10')),
    async send(email) {
      try {
        const res = await signedSesFetch('/v2/email/outbound-emails', {
          FromEmailAddress: email.from,
          Destination: { ToAddresses: [email.to] },
          ReplyToAddresses: email.replyTo ? [email.replyTo] : undefined,
          ConfigurationSetName: configurationSet || undefined,
          EmailTags: Object.entries(email.tags ?? {}).map(([Name, Value]) => ({ Name, Value })),
          Content: {
            Simple: {
              Subject: { Data: email.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: email.html, Charset: 'UTF-8' },
                Text: { Data: email.text, Charset: 'UTF-8' },
              },
              Headers: Object.entries(email.headers ?? {}).map(([Name, Value]) => ({ Name, Value })),
            },
          },
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.MessageId) return { ok: true, messageId: body.MessageId };
        const throttled = /Throttl|TooManyRequests|LimitExceeded/i.test(body.__type ?? body.message ?? '');
        return {
          ok: false,
          transient: throttled || isTransient(res.status),
          status: res.status,
          error: body.message || body.Message || `SES HTTP ${res.status}`,
        };
      } catch (err) {
        return { ok: false, transient: true, error: `Network error: ${(err as Error).message}` };
      }
    },
  };
}

export function getEsp(): EspAdapter {
  const provider = env('ESP_PROVIDER', 'resend').toLowerCase();
  if (provider === 'ses') return sesAdapter();
  return resendAdapter();
}

/** Spaces calls so we never exceed `perSecond` requests per second. */
export function createRateLimiter(perSecond: number) {
  const interval = 1000 / Math.max(0.1, perSecond);
  let next = 0;
  return async function wait() {
    const now = Date.now();
    const slot = Math.max(now, next);
    next = slot + interval;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  };
}

export function formatFrom(name: string, email: string) {
  const clean = (name || '').replace(/["<>\r\n]/g, '').trim();
  return clean ? `"${clean}" <${email}>` : email;
}
