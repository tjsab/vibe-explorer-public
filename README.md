# Vibe Explorer

A meadow you can walk. Everyone is an Anon number. Tap once for a quiet flute, press Sing for a tune, and Hide if you want the place to fill the phone.

Live: https://tjsab.github.io/vibe-explorer-public/?v=meadow-anon

The playable page at the repo root (`index.html` and `assets/`) is the built site. The source is in `src/`:

- `src/game/world.ts` — the meadow, villagers, crops, animals, flute, and sing tune
- `src/components/vibe-explorer.tsx` — touch controls, Hide, invite, chat
- `src/lib/multiplayer/` — shared positions when a room server is available
- `src/styles.css` — the phone layout

GitHub Pages cannot run the room server, so each visitor still gets their own meadow until that exists.

```bash
npm install
npm run dev
```
