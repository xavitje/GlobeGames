# GlobeGames

Vier geografie-mini-games in één Vite-app: GeoHunt, Vorm Raden, GlobeGuess en GeoGuesser (nu met echte
Google Street View en live multiplayer).

## Lokaal draaien

```bash
npm install
npm run dev
```

## GeoGuesser instellen

### 1. Google Street View (verplicht)

GeoGuesser gebruikt echte, interactieve Google Street View-panorama's.

1. Ga naar [Google Cloud Console](https://console.cloud.google.com/) en maak een (gratis) project aan.
2. Zet de **Maps JavaScript API** aan bij "APIs & Services" → "Library".
3. Maak een API-key aan bij "APIs & Services" → "Credentials".
4. **Belangrijk:** beperk de key tot je eigen domein (HTTP referrers), bijv. `https://globegames.vercel.app/*`
   en `http://localhost:*` voor lokaal testen. De key komt namelijk in de browser-bundel terecht, dus zonder
   restrictie kan iedereen 'm overnemen.
5. Zet de key in `.env`:

```
VITE_GOOGLE_MAPS_KEY=jouw-key
```

Google geeft $200 gratis tegoed per maand — voor spelen met een paar vrienden kom je daar nooit overheen.

### 2. Multiplayer (optioneel)

Multiplayer gebruikt een gratis [Supabase](https://supabase.com/)-project voor realtime synchronisatie
(geen database-tabellen nodig, alleen Realtime broadcast/presence).

1. Maak een gratis Supabase-project aan.
2. Kopieer de **Project URL** en **anon/public key** (Settings → API).
3. Zet ze in `.env`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=jouw-anon-key
```

Zonder deze twee variabelen werkt GeoGuesser gewoon solo — de multiplayer-knop verschijnt dan niet.

Zie `.env.example` voor alle variabelen samen.

## Deployen

Dit project is bedoeld om via GitHub aan Vercel gekoppeld te worden (Vercel → Add New Project →
Import Git Repository). Zet dezelfde omgevingsvariabelen (`VITE_GOOGLE_MAPS_KEY`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) in de Vercel Environment Variables (niet-geheim, want Vite bakt ze sowieso in
de browser-bundel — kies "Config" als Vercel vraagt om het type). Elke push naar de main-branch deployt
daarna automatisch.
