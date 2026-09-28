alter table public.gestures add column if not exists demo_video_url text;
comment on column public.gestures.demo_video_url is 'Publieke URL naar een referentievideo (bv. Corpus NGT/Global Signbank) die de gebruiker ziet voordat die het gebaar zelf probeert. NULL = nog geen demo beschikbaar voor dit gebaar.';;
