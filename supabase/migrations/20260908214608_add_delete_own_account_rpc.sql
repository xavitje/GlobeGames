create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from admins where user_id = v_uid) then
    raise exception 'Het admin-account kan niet via de app worden verwijderd.';
  end if;
  delete from auth.users where id = v_uid;
end;
$function$;

grant execute on function public.delete_own_account() to authenticated;;
