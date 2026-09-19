import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2019',
  },
  define: {
    // Bakes a fresh id into every production bundle so the geo-JSON fetches
    // (world.json/world_hd.json, fixed filenames not hashed by Vite) always
    // get a new query string per deploy. Prevents browsers/CDN from serving
    // a stale cached copy of that data forever.
    __GEO_BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
});
