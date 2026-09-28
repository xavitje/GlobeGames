-- Eén simpel admin-mechanisme: een losse 'admins'-tabel die koppelt aan auth.users(id).
-- Geen rollen/permissies-systeem nodig voor 1 beheerder; makkelijk uit te breiden met een
-- tweede rij als er later meer reviewers bijkomen.
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- Bewust GEEN policies op admins zelf: niemand (ook een ingelogde admin niet) kan deze tabel
-- direct lezen/schrijven via de API. is_admin() hieronder is SECURITY DEFINER en omzeilt dat
-- bewust alleen voor de eigen interne check.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where user_id = auth.uid()
  );
$$;

-- Admin mag ALLE gesture_samples zien (niet alleen 'approved', zoals de publieke policy).
-- Postgres OR't permissive policies voor dezelfde command, dus dit voegt toe aan de bestaande
-- "iedereen ziet approved" policy in plaats van die te vervangen.
create policy "admins can view all samples"
on public.gesture_samples for select
to public
using (public.is_admin());

-- Admin mag status/reviewer_note/reviewed_by/reviewed_at bijwerken (goed-/afkeuren).
create policy "admins can update samples"
on public.gesture_samples for update
to public
using (public.is_admin())
with check (public.is_admin());

-- Admin mag de review-beelden in de privé bucket daadwerkelijk bekijken (er was tot nu toe
-- alleen een insert-only policy — zelfs de admin kon via de API niets lezen).
create policy "admins can view review videos"
on storage.objects for select
to public
using (bucket_id = 'gesture-videos' and public.is_admin());;
