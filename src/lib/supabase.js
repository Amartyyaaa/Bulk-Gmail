import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Call an Edge Function and surface its `{error}` body as a thrown Error. */
export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const detail = await error.context?.json();
      if (detail?.error) message = detail.error;
    } catch {
      /* response had no JSON body */
    }
    throw new Error(message);
  }
  return data;
}

/** Unauthenticated call used by the public unsubscribe page. */
export async function publicFunction(name, { method = 'GET', query = {}, body } = {}) {
  const u = new URL(`${url}/functions/v1/${name}`);
  Object.entries(query).forEach(([k, v]) => v && u.searchParams.set(k, v));
  const res = await fetch(u, {
    method,
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
