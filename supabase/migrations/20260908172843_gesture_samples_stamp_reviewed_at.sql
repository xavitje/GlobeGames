-- Zet reviewed_at automatisch zodra een admin de status wijzigt (approved/rejected), zodat de
-- client zelf geen timestamp hoeft mee te sturen bij het goed-/afkeuren.
create or replace function public.stamp_reviewed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    new.reviewed_at = now();
  end if;
  return new;
end;
$$;

create trigger gesture_samples_stamp_reviewed_at
before update on public.gesture_samples
for each row execute function public.stamp_reviewed_at();;
