-- Run once in the Supabase SQL editor AFTER deploying the Edge Functions.
-- Calls process-queue every minute: promotes scheduled campaigns and continues
-- throttled sending. Replace the two placeholders first.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
select vault.create_secret('<SAME VALUE AS THE CRON_SECRET FUNCTION SECRET>', 'cron_secret');

select cron.schedule(
  'process-email-queue',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/process-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- To stop: select cron.unschedule('process-email-queue');
