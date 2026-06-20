-- Push notification subscriptions: one row per device per user.
-- A user can have multiple devices (phone + tablet).
create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth_key    text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table push_subscriptions enable row level security;

-- Users can only read/write their own subscriptions
create policy "owner" on push_subscriptions
  for all using (auth.uid() = user_id);

-- Service role (edge functions) can read all to send notifications
create policy "service_read" on push_subscriptions
  for select using (true);
