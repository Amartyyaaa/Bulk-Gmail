# Mailroom — bulk email marketing

A bulk email platform for a marketing team. It uses React + Vite on the front end and Supabase for auth, Postgres, Realtime and Edge Functions. Mail goes out through an API-based provider: **Resend** (the default) or **Amazon SES**.

ESP API keys exist only as Edge Function secrets. The browser never sees them, and nothing is sent over SMTP.

## Features

| Area | What's included |
|---|---|
| **Auth** | Email/password sign-in with Supabase Auth and protected routes. `admin` / `viewer` roles: the first account is an admin, later accounts start as viewers, and admins promote teammates in Settings → Team. Row-level security enforces the roles in Postgres, not just in the UI. |
| **Contacts** | CSV import (name, email, tags) with a preview step. Email format is validated and duplicates are removed both in the browser and in SQL. Each contact stores opt-in status plus its consent source. Search, filter by tag or status, and add/edit/delete. A re-import can never re-subscribe someone who unsubscribed. |
| **Campaign builder** | Name, subject, preview text, from name/email, and reply-to. HTML editor with a live desktop/mobile preview. Merge tags (`{{first_name\|fallback}}`, etc.). Tag-based segments with a live audience count. Save drafts (Ctrl/⌘+S), send test emails, and duplicate campaigns. |
| **Sending engine** | Recipients are queued in Postgres and sent through the ESP API in throttled batches: configurable batch size and delay, plus a global requests-per-second cap. Each recipient has a status: queued → sent → delivered / bounced / failed / skipped. Transient errors (429/5xx/network) retry with exponential backoff; permanent errors fail right away. Hard bounces and complaints are suppressed automatically. Campaigns can be scheduled, paused, resumed, or cancelled. |
| **Compliance** | Every email gets a sender-identity footer with the physical address and an unsubscribe link, plus RFC 8058 `List-Unsubscribe` one-click headers. There is a public one-click unsubscribe page. The suppression list is checked when recipients are queued **and again right before each send**. Sending is blocked until a company name and postal address are set. |
| **Deliverability** | Settings includes SPF / DKIM / DMARC setup guidance and a live DNS checker (DNS-over-HTTPS), plus a warm-up and list-hygiene checklist. |
| **Analytics** | Per campaign: sent, delivered, open rate, click rate, bounce rate, unsubscribes and complaints, a recipient table, and a live activity feed. There's also an overview across all campaigns. Everything updates in real time from ESP webhooks via Supabase Realtime. |

## Architecture

```
React app ──(anon key + user JWT, RLS)──▶ Supabase Postgres
   │                                          ▲
   └─▶ send-campaign (Edge Fn, admin only) ───┤ validates → status 'scheduled'
                                              │
pg_cron (every minute) ─▶ process-queue ──────┤ queue audience → claim batch
                               │              │ (FOR UPDATE SKIP LOCKED) → send
                               └─▶ Resend / SES API
ESP webhooks ─▶ esp-webhook (signature-verified) ─▶ record_esp_event()
Email footer / List-Unsubscribe ─▶ unsubscribe (Edge Fn) ─▶ suppression_list
```

- `supabase/migrations/…_init.sql`: tables (`contacts`, `campaigns`, `campaign_recipients`, `suppression_list`, `events`, `profiles`, `app_settings`), the `campaign_stats` view, queue functions, and RLS policies.
- `supabase/functions/_shared/render.js`: merge tags and the compliance footer. The React preview imports this same file, so **the preview is exactly what gets sent**.
- `supabase/functions/process-queue`: the worker. It holds a per-campaign lease, runs within a time budget, and continues on the next cron tick.
- Worker-crash safety: stale claims go back to the queue after 5 minutes, and the ESP idempotency key (the recipient id) stops duplicate sends.

## Setup

1. **Create a Supabase project** and link it:
   ```bash
   npm i -g supabase
   supabase link --project-ref <PROJECT_REF>
   supabase db push                      # applies supabase/migrations
   ```
2. **Configure your ESP.**
   - *Resend:* add and verify your sending domain, create an API key, then add a webhook to `https://<PROJECT_REF>.supabase.co/functions/v1/esp-webhook?provider=resend` for the delivered, bounced, complained, opened and clicked events. Turn on open/click tracking for the domain.
   - *SES:* verify the domain (Easy DKIM), request production access, and create a configuration set that sends events to an SNS topic. Subscribe `…/esp-webhook?provider=ses&token=<SES_WEBHOOK_TOKEN>` over HTTPS; the subscription is confirmed automatically.
3. **Set the function secrets** (see `supabase/functions/.env.example`):
   ```bash
   cp supabase/functions/.env.example supabase/functions/.env   # fill in
   supabase secrets set --env-file supabase/functions/.env
   supabase functions deploy send-campaign process-queue esp-webhook unsubscribe
   ```
4. **Schedule the worker:** edit the placeholders in `supabase/cron.sql`, then run it in the SQL editor. It uses the same `CRON_SECRET` as the function secret.
5. **Run the app:**
   ```bash
   cp .env.example .env.local            # VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
   npm install
   npm run dev
   ```
6. Create your first user in Supabase → Authentication → Users. That user becomes the admin. Then, in the app, fill in **Settings → Sender & footer** before sending.

Deploy the front end to any static host, and set `APP_URL` to its URL so unsubscribe links point at it.

**Links on your own domain (recommended for inbox placement).** By default the List-Unsubscribe header points at `<project>.supabase.co` and the footer link at your app's host. Gmail treats links on a different domain from the From address as a marketing/spam signal. To put every link on your domain:

1. In Vercel → Project → Settings → Domains, add a subdomain such as `app.yourdomain.com` and create the CNAME record it shows at your DNS provider.
2. `supabase secrets set LINK_BASE_URL=https://app.yourdomain.com` (no redeploy needed; secrets apply on the next run).

`api/unsubscribe.js` (a Vercel Function) forwards one-click unsubscribes to the Edge Function, using the `VITE_SUPABASE_URL` already set in Vercel.

## Throttling guidance

- `ESP_MAX_PER_SECOND` must stay within the provider's rate limit: Resend defaults to 2/s, and SES uses your account's max send rate.
- Batch size and delay are set per campaign, with defaults in Settings. On a new domain, start small (for example 50 every 30s, a few hundred per day) and ramp up.
- A 50 s time budget per run with a one-minute cron gives continuous sending. Each batch is capped to what fits in the remaining budget.

## Development

```bash
npm test          # unit tests: merge tags, footer, CSV parsing/dedupe
npm run build
```
