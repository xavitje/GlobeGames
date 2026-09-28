# GlobeGames

Five geography mini-games in one Vite app: GeoHunt, Shape Guess, GlobeGuess, GeoGuesser (with real
Google Street View and live multiplayer), and WikiSpeedrun. English is the default interface language;
players can switch to Dutch from the header or account settings.

## Run locally

```bash
npm install
npm run dev
```

## Configure GeoGuesser

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

### 3. Email and Google sign-in

The account page uses the same Supabase project. In the Supabase dashboard:

1. Enable **Email** and **Google** under Authentication → Providers.
2. Add your Google OAuth client ID and secret to the Google provider.
3. Under Authentication → URL Configuration set the **Site URL** to
   `https://games.drissi.store`.
4. Add these **Redirect URLs**:
   - `https://games.drissi.store/account`
   - `http://localhost:5173/account`
   - optionally `http://localhost:5174/account` when Vite selects its fallback port

No extra frontend environment variables are required beyond the Supabase URL and anon key above.

## Deployen

Dit project is bedoeld om via GitHub aan Vercel gekoppeld te worden (Vercel → Add New Project →
Import Git Repository). Zet dezelfde omgevingsvariabelen (`VITE_GOOGLE_MAPS_KEY`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`) in de Vercel Environment Variables (niet-geheim, want Vite bakt ze sowieso in
de browser-bundel — kies "Config" als Vercel vraagt om het type). Elke push naar de main-branch deployt
daarna automatisch.
