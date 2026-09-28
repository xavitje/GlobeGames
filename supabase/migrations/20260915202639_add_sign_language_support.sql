-- Meertalige gebarentaal-ondersteuning: sign_language als eerste-klas dimensie.
-- Elk teken behoudt zijn bestaande korte id (bv. "letter_a"), maar krijgt een sign_language
-- kolom naast zich zodat dezelfde id in meerdere gebarentalen kan bestaan (NGT/ASL/BSL letter_a
-- zijn drie verschillende tekens). Gamification (streak/XP/badges in profiles) blijft globaal
-- per gebruiker, ongeacht gekozen gebarentaal — alleen content wordt taal-gescoped.

-- 1. gesture_samples: FK moet weg vóór we de gestures-PK aanpassen (hij hangt aan die index)
alter table public.gesture_samples drop constraint gesture_samples_gesture_id_fkey;

-- 2. gestures: taalkolom + herziene primary key (sign_language, id)
alter table public.gestures add column sign_language text not null default 'ngt';

alter table public.gestures drop constraint gestures_pkey;
alter table public.gestures add constraint gestures_pkey primary key (sign_language, id);

-- 3. gesture_samples: taalkolom + FK naar de nieuwe composite key
alter table public.gesture_samples add column sign_language text not null default 'ngt';

alter table public.gesture_samples
  add constraint gesture_samples_gesture_id_fkey
  foreign key (sign_language, gesture_id) references public.gestures (sign_language, id);

-- 4. profiles: welke gebarentaal de gebruiker actief leert (wisselbaar in instellingen)
alter table public.profiles add column sign_language text not null default 'ngt';

-- 5. user_progress: per-attempt geschiedenis, geen FK-afhankelijkheid maar wel taal-context
--    voor toekomstige filtering/analyse. RPC's (record_practice e.d.) worden in deze slag niet
--    aangepast — nieuwe rijen krijgen voorlopig de kolomdefault 'ngt'; dit is een bewuste
--    scope-keuze omdat de gamificatielaag zelf taal-onafhankelijk blijft.
alter table public.user_progress add column sign_language text not null default 'ngt';;
