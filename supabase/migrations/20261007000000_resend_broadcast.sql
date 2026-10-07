-- Optional sending through Resend Broadcasts (see supabase/functions/_shared/resendBroadcast.ts).

alter table public.campaigns
  add column delivery text not null default 'individual'
    check (delivery in ('individual', 'broadcast')),
  add column esp_segment_id   text,   -- Resend segment holding this campaign's recipients
  add column esp_broadcast_id text,   -- set once the broadcast has been sent
  add column broadcast_error  text;   -- last error while preparing / sending the broadcast

create index campaigns_broadcast_idx on public.campaigns (esp_broadcast_id) where esp_broadcast_id is not null;

-- Same as before, plus matching of Resend Broadcast emails.
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
  -- Broadcast emails get their message id from Resend, not from us: match them
  -- by broadcast + address the first time and remember the id.
  if not found and p_meta ? 'broadcast_id' and p_meta ? 'to' then
    select r2.* into r
      from public.campaign_recipients r2
      join public.campaigns c on c.id = r2.campaign_id
     where c.esp_broadcast_id = p_meta ->> 'broadcast_id'
       and r2.email = (p_meta ->> 'to')::citext
     limit 1;
    if found and p_provider_message_id is not null then
      update public.campaign_recipients
         set provider_message_id = p_provider_message_id
       where id = r.id and provider_message_id is null;
    end if;
  end if;
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


-- Unsubscribe that happened outside the app (Resend's hosted unsubscribe page).
create or replace function public.record_external_unsubscribe(p_email text, p_source text, p_campaign_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return false;
  end if;

  insert into public.suppression_list (email, reason, source)
  values (p_email, 'unsubscribed', p_source)
  on conflict (email) do nothing;

  if not exists (select 1 from public.events
                  where type = 'unsubscribe' and email = p_email::citext
                    and campaign_id is not distinct from p_campaign_id) then
    insert into public.events (campaign_id, email, type, meta)
    values (p_campaign_id, p_email, 'unsubscribe', jsonb_build_object('source', p_source));
  end if;
  return true;
end;
$$;

revoke execute on function public.record_external_unsubscribe(text, text, uuid) from public, anon, authenticated;
