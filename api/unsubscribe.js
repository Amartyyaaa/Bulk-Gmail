// Vercel Function: forwards one-click unsubscribes (List-Unsubscribe header)
// to the Supabase Edge Function, so the link in the email can use the sender's
// own domain instead of supabase.co. Enabled by the LINK_BASE_URL function secret.

const target = () => `${(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/functions/v1/unsubscribe`;

async function forward(request) {
  const { search } = new URL(request.url);
  const init = { method: request.method, headers: {} };
  if (request.method === 'POST') {
    init.headers['content-type'] = request.headers.get('content-type') || 'application/x-www-form-urlencoded';
    init.body = await request.text();
  }
  const res = await fetch(target() + search, init);
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') || 'application/json' },
  });
}

export const GET = forward;
export const POST = forward;
