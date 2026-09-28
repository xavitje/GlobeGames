-- Badges (Fase D): eenvoudige badge-tabel + per-gebruiker behaalde badges, plus een
-- SECURITY DEFINER functie die na elke actie controleert of er nieuwe badges verdiend zijn.
-- Iconen worden NIET als bestand opgeslagen (geen asset-pad) maar als een `icon_key` die de
-- client naar een eigen Compose-tekening mapt (BadgeIcon.kt) — geen externe asset-pipeline nodig.

create table if not exists public.badges (
  id text primary key,
  name text not null,
  description text not null,
  icon_key text not null,
  sort_order integer not null default 0
);

alter table public.badges enable row level security;

drop policy if exists "badges readable by everyone" on public.badges;
create policy "badges readable by everyone" on public.badges
  for select using (true);

create table if not exists public.user_badges (
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null references public.badges(id) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

alter table public.user_badges enable row level security;

drop policy if exists "users can view their own badges" on public.user_badges;
create policy "users can view their own badges" on public.user_badges
  for select using (auth.uid() = user_id);

insert into public.badges (id, name, description, icon_key, sort_order) values
  ('eerste_stap', 'Eerste stap', 'Je eerste gebaar afgerond', 'eerste_stap', 1),
  ('streak_7', '7-daagse vlam', '7 dagen op rij geoefend', 'streak_7', 2),
  ('streak_30', '30-daagse vlam', '30 dagen op rij geoefend', 'streak_30', 3),
  ('alfabet_compleet', 'Alfabet compleet', 'Alle 26 letters geoefend', 'alfabet_compleet', 4),
  ('cijfers_compleet', 'Cijfers compleet', 'Alle 10 cijfers geoefend', 'cijfers_compleet', 5),
  ('vroege_vogel', 'Vroege vogel', 'Geoefend voor 8:00 uur', 'vroege_vogel', 6),
  ('perfecte_les', 'Perfecte les', 'Een gebaar met topscore afgerond', 'perfecte_les', 7),
  ('bijdrager', 'Bijdrager', 'Een eigen opname is goedgekeurd', 'bijdrager', 8)
on conflict (id) do nothing;

create or replace function public.check_and_award_badges()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_profile record;
  v_letters_total int;
  v_letters_done int;
  v_numbers_total int;
  v_numbers_done int;
begin
  if v_uid is null then
    return;
  end if;

  select * into v_profile from profiles where id = v_uid;
  if not found then
    return;
  end if;

  if exists (select 1 from user_progress where user_id = v_uid) then
    insert into user_badges(user_id, badge_id) values (v_uid, 'eerste_stap') on conflict do nothing;
  end if;

  if v_profile.longest_streak >= 7 then
    insert into user_badges(user_id, badge_id) values (v_uid, 'streak_7') on conflict do nothing;
  end if;
  if v_profile.longest_streak >= 30 then
    insert into user_badges(user_id, badge_id) values (v_uid, 'streak_30') on conflict do nothing;
  end if;

  select count(*) into v_letters_total from gestures where category = 'letter';
  select count(distinct up.gesture_id) into v_letters_done
    from user_progress up join gestures g on g.id = up.gesture_id
    where up.user_id = v_uid and g.category = 'letter';
  if v_letters_total > 0 and v_letters_done >= v_letters_total then
    insert into user_badges(user_id, badge_id) values (v_uid, 'alfabet_compleet') on conflict do nothing;
  end if;

  select count(*) into v_numbers_total from gestures where category = 'number';
  select count(distinct up.gesture_id) into v_numbers_done
    from user_progress up join gestures g on g.id = up.gesture_id
    where up.user_id = v_uid and g.category = 'number';
  if v_numbers_total > 0 and v_numbers_done >= v_numbers_total then
    insert into user_badges(user_id, badge_id) values (v_uid, 'cijfers_compleet') on conflict do nothing;
  end if;

  if exists (
    select 1 from user_progress
    where user_id = v_uid
      and extract(hour from (created_at at time zone 'Europe/Amsterdam')) < 8
  ) then
    insert into user_badges(user_id, badge_id) values (v_uid, 'vroege_vogel') on conflict do nothing;
  end if;

  if exists (select 1 from user_progress where user_id = v_uid and score >= 0.98) then
    insert into user_badges(user_id, badge_id) values (v_uid, 'perfecte_les') on conflict do nothing;
  end if;

  if exists (
    select 1 from gesture_samples
    where contributor_id = v_uid::text and status = 'approved'
  ) then
    insert into user_badges(user_id, badge_id) values (v_uid, 'bijdrager') on conflict do nothing;
  end if;
end;
$function$;

grant execute on function public.check_and_award_badges() to authenticated;;
