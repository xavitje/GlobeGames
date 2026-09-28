CREATE OR REPLACE FUNCTION public.record_practice(p_gesture_id text, p_score numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today date := current_date;
  v_current_month date := date_trunc('month', v_today)::date;
  v_last_practice date;
  v_current_streak int;
  v_longest_streak int;
  v_xp_earned int;
  v_is_first_today_for_gesture boolean;
  v_freezes_available int;
  v_freezes_reset_at date;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Bepaal XP (15 voor de eerste keer per dag, anders 2)
  SELECT NOT EXISTS (
    SELECT 1 FROM user_progress
    WHERE user_id = v_user_id
      AND gesture_id = p_gesture_id
      AND created_at::date = v_today
  ) INTO v_is_first_today_for_gesture;

  IF v_is_first_today_for_gesture THEN
    v_xp_earned := 15;
  ELSE
    v_xp_earned := 2;
  END IF;

  -- Voeg het progress record toe
  INSERT INTO user_progress (user_id, gesture_id, score, xp_earned)
  VALUES (v_user_id, p_gesture_id, p_score, v_xp_earned);

  -- Haal profiel data op voor streak- en freeze-logica
  SELECT last_practice_date, current_streak, longest_streak,
         streak_freezes_available, streak_freezes_reset_at
  INTO v_last_practice, v_current_streak, v_longest_streak,
       v_freezes_available, v_freezes_reset_at
  FROM profiles WHERE id = v_user_id;

  -- Maandelijkse reset: 1 gratis freeze per kalendermaand
  IF v_freezes_reset_at IS NULL OR v_freezes_reset_at < v_current_month THEN
    v_freezes_available := 1;
    v_freezes_reset_at := v_current_month;
  END IF;

  -- Werk de streak bij
  IF v_last_practice IS NULL THEN
    -- Allereerste keer ooit
    v_current_streak := 1;
  ELSIF v_last_practice = v_today THEN
    -- Al geoefend vandaag, streak blijft hetzelfde
    v_current_streak := v_current_streak;
  ELSIF v_last_practice = v_today - 1 THEN
    -- Opeenvolgende dag, verhoog streak
    v_current_streak := v_current_streak + 1;
  ELSIF v_last_practice = v_today - 2 AND v_freezes_available > 0 THEN
    -- Precies 1 dag gemist en er is een streak-freeze beschikbaar: automatisch inzetten
    v_current_streak := v_current_streak + 1;
    v_freezes_available := v_freezes_available - 1;
  ELSE
    -- Streak gebroken (meer dan 1 dag gemist, of geen freeze meer over)
    v_current_streak := 1;
  END IF;

  -- Update longest streak indien nodig
  IF v_current_streak > v_longest_streak THEN
    v_longest_streak := v_current_streak;
  END IF;

  -- Update profiel met nieuwe XP, streak en freeze-status
  UPDATE profiles
  SET total_xp = total_xp + v_xp_earned,
      current_streak = v_current_streak,
      longest_streak = v_longest_streak,
      last_practice_date = v_today,
      streak_freezes_available = v_freezes_available,
      streak_freezes_reset_at = v_freezes_reset_at
  WHERE id = v_user_id;

END;
$function$;;
