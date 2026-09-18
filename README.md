# GlobeGames

Vier geografie-mini-games in één Vite-app: GeoHunt, Vorm Raden, GlobeGuess en GeoGuesser.

## Lokaal draaien

```bash
npm install
npm run dev
```

## GeoGuesser instellen

GeoGuesser gebruikt gratis straatfoto's van [Mapillary](https://www.mapillary.com/developer).
Maak een gratis account + app aan, kopieer je Access Token en zet die in `.env`:

```
VITE_MAPILLARY_TOKEN=MLY|jouw-token
```

Zie `.env.example`.

## Deployen

Dit project is bedoeld om via GitHub aan Vercel gekoppeld te worden (Vercel → Add New Project →
Import Git Repository). Zet `VITE_MAPILLARY_TOKEN` in de Vercel Environment Variables
(niet-geheim, want Vite bakt 'm sowieso in de browser-bundel). Elke push naar de main-branch
deployt daarna automatisch.
