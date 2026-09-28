alter table public.profiles alter column daily_goal_xp set default 35;
update public.profiles set daily_goal_xp = 35 where daily_goal_xp = 20;;
