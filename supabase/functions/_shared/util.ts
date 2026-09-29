import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { renderEmail } from './render.js';
import { formatFrom, type OutgoingEmail } from './esp.ts';

// Auth is via bearer tokens (never cookies), so a wildcard origin is safe.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolve the calling user from their JWT and return their role. */
export async function getCaller(req: Request, db: SupabaseClient) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await db.from('profiles').select('role').eq('id', data.user.id).single();
  return { user: data.user, role: (profile?.role ?? 'viewer') as 'admin' | 'viewer' };
}

export interface Settings {
  company_name: string;
  physical_address: string;
}

export async function loadSettings(db: SupabaseClient): Promise<Settings> {
  const { data, error } = await db.from('app_settings').select('*').single();
  if (error) throw error;
  return data;
}

/** Public URL of the unsubscribe Edge Function (used for List-Unsubscribe). */
function unsubscribeEndpoint(token: string, recipientId?: string) {
  const u = new URL(`${Deno.env.get('SUPABASE_URL')}/functions/v1/unsubscribe`);
  u.searchParams.set('t', token);
  if (recipientId) u.searchParams.set('r', recipientId);
  return u.toString();
}

/** Human-facing unsubscribe page in the React app. */
function unsubscribePage(token: string, recipientId?: string) {
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  const u = new URL(`${appUrl}/unsubscribe`);
  u.searchParams.set('t', token);
  if (recipientId) u.searchParams.set('r', recipientId);
  return u.toString();
}

export interface CampaignRow {
  id: string;
  subject: string;
  preheader: string;
  html: string;
  from_name: string;
  from_email: string;
  reply_to: string;
}

/** Build the provider-agnostic message for one recipient. */
export function buildMessage(opts: {
  campaign: CampaignRow;
  settings: Settings;
  contact: { email: string; first_name?: string | null; last_name?: string | null; unsubscribe_token: string };
  recipientId?: string;
  subjectPrefix?: string;
}): OutgoingEmail {
  const { campaign, settings, contact, recipientId } = opts;
  const pageUrl = unsubscribePage(contact.unsubscribe_token, recipientId);
  const rendered = renderEmail({ campaign, contact, settings, unsubscribeUrl: pageUrl });
  return {
    from: formatFrom(campaign.from_name, campaign.from_email),
    to: contact.email,
    replyTo: campaign.reply_to || undefined,
    subject: (opts.subjectPrefix ?? '') + rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {
      // RFC 8058 one-click unsubscribe; required by Gmail/Yahoo for bulk senders.
      'List-Unsubscribe': `<${unsubscribeEndpoint(contact.unsubscribe_token, recipientId)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: recipientId ? { campaign_id: campaign.id, recipient_id: recipientId } : { campaign_id: campaign.id, test: 'true' },
    idempotencyKey: recipientId,
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
