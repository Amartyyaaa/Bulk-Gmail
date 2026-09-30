// Public unsubscribe endpoint (no JWT).
//   POST ?t=<token>&r=<recipient>   RFC 8058 one-click from the mail client
//                                   (body "List-Unsubscribe=One-Click")
//   POST {token, recipient_id}      from the /unsubscribe page in the app
//   GET  ?t=<token>                 page lookup: masked email + current state
// The token is the contact's random unsubscribe_token, so it can't be guessed.

import { adminClient, corsHeaders, json } from '../_shared/util.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mask(email: string) {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const db = adminClient();

  if (req.method === 'GET') {
    const token = url.searchParams.get('t') ?? '';
    if (!UUID.test(token)) return json({ error: 'Invalid link' }, 400);
    const { data } = await db.from('contacts').select('email, opt_in').eq('unsubscribe_token', token).maybeSingle();
    if (!data) return json({ error: 'This unsubscribe link is not valid.' }, 404);
    return json({ email: mask(data.email), subscribed: data.opt_in });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let token = url.searchParams.get('t') ?? '';
  let recipient = url.searchParams.get('r') ?? '';
  if (req.headers.get('content-type')?.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    token = body.token ?? token;
    recipient = body.recipient_id ?? recipient;
  }
  if (!UUID.test(token)) return json({ error: 'Invalid link' }, 400);

  const { data, error } = await db.rpc('unsubscribe_by_token', {
    p_token: token,
    p_recipient_id: UUID.test(recipient) ? recipient : null,
  });
  if (error) return json({ error: error.message }, 500);
  if (!data?.ok) return json({ error: 'This unsubscribe link is not valid.' }, 404);
  return json({ ok: true, email: mask(data.email) });
});
