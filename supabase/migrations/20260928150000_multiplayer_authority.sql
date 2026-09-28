create extension if not exists pgcrypto;

create table if not exists public.multiplayer_matches (
  id uuid primary key default gen_random_uuid(),
  game text not null check (game in ('geoguesser')),
  code text not null check (code ~ '^[A-Z2-9]{4,6}$'),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'active', 'finished')),
  settings jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  round_number integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game, code)
);

create table if not exists public.multiplayer_players (
  match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null,
  name text not null check (char_length(name) between 1 and 18),
  team text check (team in ('A', 'B')),
  powerup text check (powerup in ('hint', 'shield', '5050')),
  sabotage text check (sabotage in ('fakehint', 'ink', 'spin')),
  powerup_used boolean not null default false,
  sabotage_used boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id),
  unique (match_id, player_id)
);

create table if not exists public.multiplayer_rounds (
  match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  pano_id text not null,
  answer_lat double precision not null check (answer_lat between -90 and 90),
  answer_lng double precision not null check (answer_lng between -180 and 180),
  country_hint text not null,
  status text not null default 'active' check (status in ('active', 'finished')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (match_id, round_number)
);

create table if not exists public.multiplayer_guesses (
  match_id uuid not null,
  round_number integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_id text not null,
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  distance_km double precision not null check (distance_km >= 0),
  points integer not null check (points between 0 and 6000),
  shield boolean not null default false,
  submitted_at timestamptz not null default now(),
  primary key (match_id, round_number, user_id),
  foreign key (match_id, round_number) references public.multiplayer_rounds(match_id, round_number) on delete cascade
);

create table if not exists public.multiplayer_wagers (
  match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
  round_number integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  choice text not null check (choice in ('bank', 'red', 'black', 'green')),
  number integer check (number between 0 and 36),
  payout integer not null check (payout >= 0),
  created_at timestamptz not null default now(),
  primary key (match_id, round_number, user_id)
);

alter table public.multiplayer_matches enable row level security;
alter table public.multiplayer_players enable row level security;
alter table public.multiplayer_rounds enable row level security;
alter table public.multiplayer_guesses enable row level security;
alter table public.multiplayer_wagers enable row level security;

revoke all on public.multiplayer_matches from anon, authenticated;
revoke all on public.multiplayer_players from anon, authenticated;
revoke all on public.multiplayer_rounds from anon, authenticated;
revoke all on public.multiplayer_guesses from anon, authenticated;
revoke all on public.multiplayer_wagers from anon, authenticated;
