-- ============================================================================
-- 0036 — Schedule the daily low-stock digest
-- ============================================================================
-- Enables pg_cron + pg_net and schedules a daily HTTP POST to the
-- `daily-low-stock` edge function (added in this PR; deploy it before the first
-- cron fire). The function reads get_low_stock_digest() (0035) and pushes to
-- every admin/manager.
--
-- SECURITY: the service-role key and project URL are NOT hardcoded here — that
-- would leak a secret into git. They live in Supabase Vault and the cron reads
-- them at run time. The two Vault secrets must exist before this runs:
--   * project_url        = https://<ref>.supabase.co
--   * service_role_key   = the project's service role key
-- These are inserted via a separate, non-committed step (see session notes), so
-- this migration is safe to commit and review.
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any prior copy so re-running is idempotent.
select cron.unschedule('daily-low-stock-digest')
where exists (select 1 from cron.job where jobname = 'daily-low-stock-digest');

-- 02:00 UTC daily = 07:00 Maldives (MVT, UTC+5). A morning digest lands before
-- the team starts ordering for the day. Adjust the cron expr to retime.
select cron.schedule(
  'daily-low-stock-digest',
  '0 2 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/daily-low-stock',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
