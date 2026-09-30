-- =============================================================================
-- Bulk mail platform: core schema
-- Tables: profiles, app_settings, contacts, suppression_list, campaigns,
--         campaign_recipients, events
-- =============================================================================

create extension if not exists citext;
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Roles / profiles
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'viewer');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.app_role not null default 'viewer',
  created_at  timestamptz not null default now()
);

-- The first user to sign up becomes an admin; everyone after is a viewer
-- until an admin promotes them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    case when exists (select 1 from public.profiles) then 'viewer'::public.app_role
         else 'admin'::public.app_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- Organisation settings (single row)
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id                        boolean primary key default true check (id),
  company_name              text not null default '',
  physical_address          text not null default '',
  default_from_name         text not null default '',
  default_from_email        text not null default '',
  default_reply_to          text not null default '',
  sending_domain            text not null default '',
  dkim_selector             text not null default 'resend',
  default_batch_size        int  not null default 50  check (default_batch_size between 1 and 1000),
  default_batch_delay_secs  int  not null default 10  check (default_batch_delay_secs between 0 and 3600),
  updated_at                timestamptz not null default now()
);
insert into public.app_settings (id) values (true);

-- -----------------------------------------------------------------------------
-- Contacts
-- -----------------------------------------------------------------------------
create table public.contacts (
  id                 uuid primary key default gen_random_uuid(),
  email              citext not null unique
                       check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  first_name         text,
  last_name          text,
  tags               text[] not null default '{}',
  opt_in             boolean not null default false,
  opt_in_source      text,
  opted_in_at        timestamptz,
  unsubscribed_at    timestamptz,
  unsubscribe_token  uuid not null default gen_random_uuid() unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index contacts_tags_idx     on public.contacts using gin (tags);
create index contacts_opt_in_idx   on public.contacts (opt_in);
create index contacts_created_idx  on public.contacts (created_at desc);

-- -----------------------------------------------------------------------------
-- Suppression list: never send to these addresses
-- -----------------------------------------------------------------------------
create type public.suppression_reason as enum ('unsubscribed', 'hard_bounce', 'complaint', 'manual');

create table public.suppression_list (
  email        citext primary key,
  reason       public.suppression_reason not null,
  source       text,               -- e.g. campaign id, 'import', 'admin'
  created_at   timestamptz not null default now()
);

-- Keep contacts' opt-in state consistent with suppression.
create or replace function public.sync_contact_on_suppression()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.contacts
     set opt_in = false,
         unsubscribed_at = coalesce(unsubscribed_at, now()),
         updated_at = now()
   where email = new.email and opt_in;
  return new;
end;
$$;

create trigger suppression_sync_contact
  after insert on public.suppression_list
  for each row execute function public.sync_contact_on_suppression();

-- A suppressed address can never be (re-)opted-in, whether via the UI or import.
create or replace function public.guard_contact_opt_in()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.opt_in and exists (select 1 from public.suppression_list s where s.email = new.email) then
    new.opt_in := false;
  end if;
  if new.opt_in and (tg_op = 'INSERT' or not old.opt_in) then
    new.opted_in_at := coalesce(new.opted_in_at, now());
    new.unsubscribed_at := null;
  end if;
  if not new.opt_in and tg_op = 'UPDATE' and old.opt_in then
    new.unsubscribed_at := coalesce(new.unsubscribed_at, now());
  end if;
  return new;
end;
$$;

create trigger contacts_guard_opt_in
  before insert or update on public.contacts
  for each row execute function public.guard_contact_opt_in();

-- -----------------------------------------------------------------------------
-- Campaigns
-- -----------------------------------------------------------------------------
create type public.campaign_status as enum
  ('draft', 'scheduled', 'sending', 'paused', 'sent', 'cancelled');

create table public.campaigns (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  subject               text not null default '',
  preheader             text not null default '',
  from_name             text not null default '',
  from_email            text not null default '',
  reply_to              text not null default '',
  html                  text not null default '',
  segment_tags          text[] not null default '{}',   -- empty = all opted-in contacts
  status                public.campaign_status not null default 'draft',
  scheduled_at          timestamptz,
  batch_size            int not null default 50 check (batch_size between 1 and 1000),
  batch_delay_secs      int not null default 10 check (batch_delay_secs between 0 and 3600),
  started_at            timestamptz,
  completed_at          timestamptz,
  last_batch_at         timestamptz,
  lease_until           timestamptz,       -- worker lease so only one worker drives a campaign
  created_by            uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index campaigns_status_idx on public.campaigns (status, scheduled_at);

-- -----------------------------------------------------------------------------
-- Campaign recipients (the send queue + per-recipient delivery status)
-- -----------------------------------------------------------------------------
create type public.recipient_status as enum
  ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'skipped');

create table public.campaign_recipients (
  id                   uuid primary key default gen_random_uuid(),
  campaign_id          uuid not null references public.campaigns (id) on delete cascade,
  contact_id           uuid references public.contacts (id) on delete set null,
  email                citext not null,
  status               public.recipient_status not null default 'queued',
  attempts             int not null default 0,
  next_attempt_at      timestamptz not null default now(),
  claimed_at           timestamptz,
  provider_message_id  text,
  last_error           text,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  bounced_at           timestamptz,
  opened_at            timestamptz,
  clicked_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (campaign_id, email)
);
create index recipients_queue_idx    on public.campaign_recipients (campaign_id, status, next_attempt_at);
create index recipients_provider_idx on public.campaign_recipients (provider_message_id);

-- -----------------------------------------------------------------------------
-- Events (ESP webhooks + unsubscribes)
-- -----------------------------------------------------------------------------
create type public.event_type as enum
  ('sent', 'delivered', 'delivery_delayed', 'open', 'click', 'bounce', 'complaint', 'unsubscribe', 'failed');

create table public.events (
  id                 bigint generated always as identity primary key,
  provider_event_id  text unique,          -- dedupes webhook retries
  campaign_id        uuid references public.campaigns (id) on delete cascade,
  recipient_id       uuid references public.campaign_recipients (id) on delete cascade,
  email              citext,
  type               public.event_type not null,
  url                text,
  meta               jsonb not null default '{}',
  occurred_at        timestamptz not null default now()
);
create index events_campaign_idx on public.events (campaign_id, type);
create index events_time_idx     on public.events (occurred_at desc);

-- -----------------------------------------------------------------------------
-- Stats view
-- -----------------------------------------------------------------------------
create view public.campaign_stats
with (security_invoker = on) as
select
  c.id as campaign_id,
  count(r.id)                                                             as total,
  count(r.id) filter (where r.status in ('queued', 'sending'))            as pending,
  count(r.id) filter (where r.status in ('sent', 'delivered', 'bounced')) as sent,
  count(r.id) filter (where r.status = 'delivered')                       as delivered,
  count(r.id) filter (where r.status = 'bounced')                         as bounced,
  count(r.id) filter (where r.status = 'failed')                          as failed,
  count(r.id) filter (where r.status = 'skipped')                         as skipped,
  count(r.opened_at)                                                      as opened,
  count(r.clicked_at)                                                     as clicked,
  (select count(distinct e.email) from public.events e
    where e.campaign_id = c.id and e.type = 'unsubscribe')                as unsubscribed,
  (select count(distinct e.email) from public.events e
    where e.campaign_id = c.id and e.type = 'complaint')                  as complaints
from public.campaigns c
left join public.campaign_recipients r on r.campaign_id = c.id
group by c.id;

-- -----------------------------------------------------------------------------
-- Functions used by the app and the Edge Functions
-- -----------------------------------------------------------------------------

-- Number of contacts a campaign with these tags would reach right now.
create or replace function public.audience_count(p_tags text[])
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)
    from public.contacts c
   where c.opt_in
     and (coalesce(cardinality(p_tags), 0) = 0 or c.tags && p_tags)
     and not exists (select 1 from public.suppression_list s where s.email = c.email);
$$;

-- Distinct tags in use (for filters / segment pickers).
create or replace function public.all_tags()
returns table (tag text, contacts bigint)
language sql
stable
set search_path = public
as $$
  select t.tag, count(*) from public.contacts c, unnest(c.tags) as t(tag)
   group by t.tag order by t.tag;
$$;

-- Bulk import. Validates, dedupes, merges tags, and never re-opts-in anyone who
-- unsubscribed or is suppressed. Returns inserted / updated / skipped counts.
create or replace function public.import_contacts(p_rows jsonb, p_opt_in boolean, p_source text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_updated  int := 0;
  v_invalid  int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can import contacts' using errcode = '42501';
  end if;

  create temp table _import (
    email citext, first_name text, last_name text, tags text[], opt_in boolean
  ) on commit drop;

  -- One row per email: first non-blank name wins, tags are unioned, and a
  -- duplicate only counts as opted in if every occurrence is.
  insert into _import
  select e.email,
         (array_agg(e.first_name order by e.ord) filter (where e.first_name is not null))[1],
         (array_agg(e.last_name  order by e.ord) filter (where e.last_name  is not null))[1],
         coalesce(array(select distinct t from unnest(array_agg(e.tag)) t where t is not null), '{}'),
         bool_and(e.opt_in)
    from (
      select lower(trim(r ->> 'email')) as email,
             nullif(trim(r ->> 'first_name'), '') as first_name,
             nullif(trim(r ->> 'last_name'), '')  as last_name,
             nullif(lower(trim(tag)), '')         as tag,
             coalesce((r ->> 'opt_in')::boolean, p_opt_in) as opt_in,
             ord
        from jsonb_array_elements(p_rows) with ordinality as x(r, ord)
        left join lateral jsonb_array_elements_text(coalesce(r -> 'tags', '[]'::jsonb)) as tag on true
       where coalesce(trim(r ->> 'email'), '') <> ''
    ) e
   group by e.email;

  delete from _import where email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  get diagnostics v_invalid = row_count;

  -- Updates: fill blank names, union tags. Opt-in may only move true→false here,
  -- or false→true for contacts who never unsubscribed (the guard trigger also
  -- blocks suppressed addresses).
  with upd as (
    update public.contacts c
       set first_name = coalesce(i.first_name, c.first_name),
           last_name  = coalesce(i.last_name, c.last_name),
           tags       = array(select distinct unnest(c.tags || i.tags)),
           opt_in     = case when c.unsubscribed_at is not null then false
                             else c.opt_in or i.opt_in end,
           opt_in_source = case when not c.opt_in and i.opt_in and c.unsubscribed_at is null
                                then p_source else c.opt_in_source end
      from _import i
     where c.email = i.email
    returning c.id
  )
  select count(*) into v_updated from upd;

  with ins as (
    insert into public.contacts (email, first_name, last_name, tags, opt_in, opt_in_source)
    select i.email, i.first_name, i.last_name, i.tags, i.opt_in, p_source
      from _import i
     where not exists (select 1 from public.contacts c where c.email = i.email)
    returning id
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'invalid', v_invalid);
end;
$$;

-- Snapshot the audience into the recipient queue and flip the campaign to sending.
create or replace function public.queue_campaign(p_campaign_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tags  text[];
  v_count int;
begin
  select segment_tags into v_tags
    from public.campaigns
   where id = p_campaign_id and status = 'scheduled'
   for update;
  if not found then
    return 0;
  end if;

  insert into public.campaign_recipients (campaign_id, contact_id, email)
  select p_campaign_id, c.id, c.email
    from public.contacts c
   where c.opt_in
     and (coalesce(cardinality(v_tags), 0) = 0 or c.tags && v_tags)
     and not exists (select 1 from public.suppression_list s where s.email = c.email)
  on conflict (campaign_id, email) do nothing;
  get diagnostics v_count = row_count;

  update public.campaigns
     set status = 'sending', started_at = coalesce(started_at, now()), updated_at = now()
   where id = p_campaign_id;

  return v_count;
end;
$$;

-- Worker lease: returns true if the caller now owns the campaign for p_seconds.
create or replace function public.acquire_campaign_lease(p_campaign_id uuid, p_seconds int)
returns boolean
language sql
security definer
set search_path = public
as $$
  with l as (
    update public.campaigns
       set lease_until = now() + make_interval(secs => p_seconds)
     where id = p_campaign_id
       and status = 'sending'
       and (lease_until is null or lease_until < now())
    returning 1
  )
  select exists (select 1 from l);
$$;

-- Atomically claim the next batch of due recipients. Suppressed/opted-out
-- recipients are skipped here, at send time, not just at queue time.
create or replace function public.claim_recipients(p_campaign_id uuid, p_limit int)
returns table (
  id uuid, email text, attempts int, contact_id uuid,
  first_name text, last_name text, unsubscribe_token uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.campaign_recipients r
     set status = 'skipped', last_error = 'Suppressed or unsubscribed before send', updated_at = now()
   where r.campaign_id = p_campaign_id
     and r.status = 'queued'
     and (exists (select 1 from public.suppression_list s where s.email = r.email)
          or exists (select 1 from public.contacts c where c.id = r.contact_id and not c.opt_in)
          or r.contact_id is null);

  return query
  with next as (
    select r.id
      from public.campaign_recipients r
     where r.campaign_id = p_campaign_id
       and r.status = 'queued'
       and r.next_attempt_at <= now()
     order by r.next_attempt_at, r.id
     limit p_limit
     for update skip locked
  ), claimed as (
    update public.campaign_recipients r
       set status = 'sending', claimed_at = now(), attempts = r.attempts + 1, updated_at = now()
      from next
     where r.id = next.id
    returning r.id, r.email::text, r.attempts, r.contact_id
  )
  select cl.id, cl.email, cl.attempts, cl.contact_id, c.first_name, c.last_name, c.unsubscribe_token
    from claimed cl
    join public.contacts c on c.id = cl.contact_id;
end;
$$;

-- Put claims from crashed workers back in the queue.
create or replace function public.release_stale_claims(p_older_than_secs int default 300)
returns int
language sql
security definer
set search_path = public
as $$
  with r as (
    update public.campaign_recipients
       set status = 'queued', claimed_at = null, updated_at = now()
     where status = 'sending'
       and claimed_at < now() - make_interval(secs => p_older_than_secs)
    returning 1
  )
  select count(*)::int from r;
$$;

-- Mark a campaign sent once nothing is left in the queue.
create or replace function public.finalize_campaign_if_done(p_campaign_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.campaign_recipients
              where campaign_id = p_campaign_id and status in ('queued', 'sending')) then
    return false;
  end if;
  update public.campaigns
     set status = 'sent', completed_at = now(), lease_until = null, updated_at = now()
   where id = p_campaign_id and status = 'sending';
  return true;
end;
$$;

-- Apply one ESP event (called by the esp-webhook Edge Function).
create or replace function public.record_esp_event(
  p_provider_event_id text,
  p_provider_message_id text,
  p_type public.event_type,
  p_occurred_at timestamptz,
  p_url text,
  p_hard_bounce boolean,
  p_meta jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.campaign_recipients%rowtype;
  v_ts timestamptz := coalesce(p_occurred_at, now());
begin
  select * into r from public.campaign_recipients
   where provider_message_id = p_provider_message_id
   limit 1;
  if not found then
    return 'unknown_message';
  end if;

  begin
    insert into public.events (provider_event_id, campaign_id, recipient_id, email, type, url, meta, occurred_at)
    values (p_provider_event_id, r.campaign_id, r.id, r.email, p_type, p_url, coalesce(p_meta, '{}'), v_ts);
  exception when unique_violation then
    return 'duplicate';
  end;

  if p_type = 'delivered' then
    update public.campaign_recipients
       set status = case when status in ('sent', 'sending') then 'delivered'::public.recipient_status else status end,
           delivered_at = coalesce(delivered_at, v_ts), updated_at = now()
     where id = r.id;
  elsif p_type in ('open', 'click') then
    update public.campaign_recipients
       set status = case when status in ('sent', 'sending') then 'delivered'::public.recipient_status else status end,
           delivered_at = coalesce(delivered_at, v_ts),
           opened_at    = coalesce(opened_at, v_ts),   -- a click implies an open
           clicked_at   = case when p_type = 'click' then coalesce(clicked_at, v_ts) else clicked_at end,
           updated_at   = now()
     where id = r.id;
  elsif p_type = 'bounce' then
    if p_hard_bounce then
      update public.campaign_recipients
         set status = 'bounced', bounced_at = v_ts, last_error = p_meta ->> 'message', updated_at = now()
       where id = r.id;
      insert into public.suppression_list (email, reason, source)
      values (r.email, 'hard_bounce', r.campaign_id::text)
      on conflict (email) do nothing;
    end if;
  elsif p_type = 'complaint' then
    insert into public.suppression_list (email, reason, source)
    values (r.email, 'complaint', r.campaign_id::text)
    on conflict (email) do nothing;
  elsif p_type = 'failed' then
    update public.campaign_recipients
       set status = 'failed', last_error = coalesce(p_meta ->> 'message', 'Rejected by provider'), updated_at = now()
     where id = r.id and status in ('sent', 'sending');
  end if;

  return 'ok';
end;
$$;

-- One-click unsubscribe (called by the unsubscribe Edge Function).
create or replace function public.unsubscribe_by_token(p_token uuid, p_recipient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.contacts%rowtype;
  v_campaign uuid;
begin
  select * into c from public.contacts where unsubscribe_token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  insert into public.suppression_list (email, reason, source)
  values (c.email, 'unsubscribed', 'unsubscribe_link')
  on conflict (email) do nothing;

  update public.contacts
     set opt_in = false, unsubscribed_at = coalesce(unsubscribed_at, now())
   where id = c.id;

  if p_recipient_id is not null then
    select campaign_id into v_campaign from public.campaign_recipients
     where id = p_recipient_id and contact_id = c.id;
  end if;

  if not exists (select 1 from public.events
                  where type = 'unsubscribe' and email = c.email
                    and campaign_id is not distinct from v_campaign) then
    insert into public.events (campaign_id, recipient_id, email, type)
    values (v_campaign, case when v_campaign is null then null else p_recipient_id end, c.email, 'unsubscribe');
  end if;

  return jsonb_build_object('ok', true, 'email', c.email::text);
end;
$$;

revoke execute on function public.queue_campaign(uuid)                   from public, anon, authenticated;
revoke execute on function public.acquire_campaign_lease(uuid, int)      from public, anon, authenticated;
revoke execute on function public.claim_recipients(uuid, int)            from public, anon, authenticated;
revoke execute on function public.release_stale_claims(int)              from public, anon, authenticated;
revoke execute on function public.finalize_campaign_if_done(uuid)        from public, anon, authenticated;
revoke execute on function public.record_esp_event(text, text, public.event_type, timestamptz, text, boolean, jsonb)
                                                                          from public, anon, authenticated;
revoke execute on function public.unsubscribe_by_token(uuid, uuid)       from public, anon, authenticated;
revoke execute on function public.import_contacts(jsonb, boolean, text)  from public, anon;
revoke execute on function public.audience_count(text[])                 from public, anon;
revoke execute on function public.all_tags()                             from public, anon;

-- -----------------------------------------------------------------------------
-- Row level security
--   * every signed-in teammate can read
--   * only admins can write contacts / campaigns / settings / suppression
--   * recipients and events are written only by Edge Functions (service role)
-- -----------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.app_settings        enable row level security;
alter table public.contacts            enable row level security;
alter table public.suppression_list    enable row level security;
alter table public.campaigns           enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.events              enable row level security;

create policy "team can read profiles"   on public.profiles for select to authenticated using (true);
create policy "admins update profiles"   on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "team can read settings"   on public.app_settings for select to authenticated using (true);
create policy "admins update settings"   on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "team can read contacts"   on public.contacts for select to authenticated using (true);
create policy "admins insert contacts"   on public.contacts for insert to authenticated with check (public.is_admin());
create policy "admins update contacts"   on public.contacts for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admins delete contacts"   on public.contacts for delete to authenticated using (public.is_admin());

create policy "team can read suppression" on public.suppression_list for select to authenticated using (true);
create policy "admins insert suppression" on public.suppression_list for insert to authenticated with check (public.is_admin());
create policy "admins delete suppression" on public.suppression_list for delete to authenticated using (public.is_admin());

create policy "team can read campaigns"  on public.campaigns for select to authenticated using (true);
create policy "admins insert campaigns"  on public.campaigns for insert to authenticated
  with check (public.is_admin() and status = 'draft');
-- Admins edit content of drafts from the client; status transitions go through
-- the send-campaign Edge Function.
create policy "admins update drafts"     on public.campaigns for update to authenticated
  using (public.is_admin() and status = 'draft') with check (public.is_admin() and status = 'draft');
create policy "admins delete campaigns"  on public.campaigns for delete to authenticated
  using (public.is_admin() and status in ('draft', 'sent', 'cancelled'));

create policy "team can read recipients" on public.campaign_recipients for select to authenticated using (true);
create policy "team can read events"     on public.events for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Realtime: dashboards update live as webhooks land
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.campaigns;
alter publication supabase_realtime add table public.campaign_recipients;
alter publication supabase_realtime add table public.events;
