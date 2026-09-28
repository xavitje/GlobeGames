-- Gebaren (metadata, spiegelt de ids die de app al gebruikt in templates.json)
create table if not exists gestures (
  id text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Eén bijdrage: een opgenomen pose (landmarks) + de bijbehorende video zodat een
-- menselijke reviewer (jij, later een dove NGT-expert) kan zien of het gebaar klopt
-- voordat de landmarks onderdeel worden van de referentieset die de app synct.
create table if not exists gesture_samples (
  id uuid primary key default gen_random_uuid(),
  gesture_id text not null references gestures(id),
  landmarks jsonb not null,
  handedness text not null default 'UNKNOWN',
  video_path text,
  contributor_id text,
  device_info jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists gesture_samples_gesture_status_idx on gesture_samples (gesture_id, status);

alter table gestures enable row level security;
alter table gesture_samples enable row level security;

create policy "gestures are publicly readable" on gestures
  for select using (active = true);

-- Bijdragers mogen alleen invoegen, en altijd als 'pending' (zie trigger hieronder,
-- die dit ook server-side afdwingt ongeacht wat de client meestuurt).
create policy "anyone can submit a pending sample" on gesture_samples
  for insert with check (status = 'pending');

-- De app (sync-on-launch) mag alleen goedgekeurde samples lezen — nooit pending/rejected.
create policy "approved samples are publicly readable" on gesture_samples
  for select using (status = 'approved');

-- Geen update/delete policy voor anon/authenticated: status wijzigen (goedkeuren/afwijzen)
-- kan alleen via de service role, dus via Supabase Studio (het reviewdashboard) totdat er
-- een eigen reviewtool is.
create or replace function force_pending_on_insert()
returns trigger as $$
begin
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists gesture_samples_force_pending on gesture_samples;
create trigger gesture_samples_force_pending
  before insert on gesture_samples
  for each row execute function force_pending_on_insert();

insert into gestures (id, name) values
  ('letter_a', 'A'),
  ('letter_b', 'B'),
  ('letter_l', 'L')
on conflict (id) do nothing;

-- Privé bucket voor de review-video's. Geen publieke leestoegang: alleen zichtbaar via
-- Supabase Studio (service role/dashboard-login), niet via de anon-key van de app.
insert into storage.buckets (id, name, public)
values ('gesture-videos', 'gesture-videos', false)
on conflict (id) do nothing;

create policy "anyone can upload a review video"
  on storage.objects for insert
  with check (bucket_id = 'gesture-videos');
;
