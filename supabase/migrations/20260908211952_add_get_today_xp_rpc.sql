CREATE OR REPLACE FUNCTION public.get_today_xp()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(xp_earned), 0)::integer
  FROM user_progress
  WHERE user_id = auth.uid()
    AND created_at::date = current_date;
$function$;

GRANT EXECUTE ON FUNCTION public.get_today_xp() TO authenticated;;
