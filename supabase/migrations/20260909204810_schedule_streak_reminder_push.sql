
-- Nodig om de streak-reminder Edge Function elke dag automatisch aan te roepen.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Dagelijks om 18:00 UTC: roept de "send-streak-reminders" Edge Function aan (zie
-- supabase/functions/send-streak-reminders/index.ts), die zelf uitzoekt wie er nog niet
-- geoefend heeft vandaag en die gebruikers een pushbericht stuurt via FCM. De Edge Function doet
-- zelf niets (skipped-response, geen fout) zolang het secret FCM_SERVICE_ACCOUNT_JSON niet gezet
-- is — deze planning is dus veilig om nu al te activeren, ook vóórdat Firebase is opgezet.
select
  cron.schedule(
    'send-streak-reminders-daily',
    '0 18 * * *',
    $$
    select net.http_post(
      url := 'https://zjedxlvdeedpkbxzqkpo.supabase.co/functions/v1/send-streak-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqZWR4bHZkZWVkcGtieHpxa3BvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzYzNDIsImV4cCI6MjEwNDQ1MjM0Mn0.qAs07pzMWGuQsqY1SFV2VGvs_UT0h0m6-1ftj14Lcp4'
      ),
      body := '{}'::jsonb
    );
    $$
  );
;
