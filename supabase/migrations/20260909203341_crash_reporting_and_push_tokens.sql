
-- Crash reports table: clients report uncaught exceptions here; admins review them in the admin panel.
create table if not exists public.crash_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  platform text not null default 'android',
  app_version text,
  os_version text,
  device_model text,
  error_type text,
  error_message text,
  stack_trace text,
  is_fatal boolean not null default true,
  extra jsonb,
  created_at timestamptz not null default now()
);

comment on table public.crash_reports is 'Client-reported crashes / uncaught exceptions, surfaced in the admin panel.';

create index if not exists crash_reports_created_at_idx on public.crash_reports (created_at desc);
create index if not exists crash_reports_user_id_idx on public.crash_reports (user_id);

alter table public.crash_reports enable row level security;

-- Anyone (logged in or not) can submit a crash report for themselves or anonymously.
create policy "anyone can insert own crash report"
  on public.crash_reports
  for insert
  with check (user_id is null or user_id = auth.uid());

-- Only admins can read crash reports (surfaced in the admin panel).
create policy "admins can view crash reports"
  on public.crash_reports
  for select
  using (is_admin());

-- Device push tokens: one row per (user, token) pair, used by the push-notification Edge Function.
create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token)
);

comment on table public.device_push_tokens is 'FCM registration tokens per user/device, used to send push notifications.';

create index if not exists device_push_tokens_user_id_idx on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

-- Users fully manage their own push tokens (register/unregister on login/logout).
create policy "users manage own push tokens"
  on public.device_push_tokens
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Admins can see how many devices are registered (useful context in the admin panel).
create policy "admins can view push tokens"
  on public.device_push_tokens
  for select
  using (is_admin());
;
