# Star System Seeder

A procedural solar system generator and browser-based renderer for a space colonization game. Runs entirely client-side — the deployed site on GitHub Pages is a static bundle.

## Overview

Two components:

- **Seeder** — pure TypeScript that procedurally generates solar systems. Runs in the browser (bundled via esbuild) and as a Deno CLI for writing JSON seed files to disk.
- **Renderer** — vanilla JS + HTML pages for generating, browsing, and viewing systems (2D canvas and 3D Three.js).

---

## Local development

Requires [Deno](https://deno.com/) v2+.

```
deno task renderer
```

This builds the browser bundle (`renderer/generator.bundle.js`), starts a dev server at `http://localhost:8080`, opens your browser, and watches:

- `renderer/` → triggers a browser reload on change.
- `seeder/` → rebuilds the bundle, then triggers a reload.

### CLI seeder (local only)

```
deno task seed [seed] [--json [folder]]
```

- Without arguments: generates a random system and prints stats.
- With an integer: generates that seed deterministically.
- `--json`: exports to `seeds/` (or a folder you name).

Examples:

```
deno task seed
deno task seed 42
deno task seed 42 --json
deno task seed 42 --json ./exports
```

### Tests

```
deno task test
```

### One-shot build

```
deno task build
```

Produces `renderer/generator.bundle.js`. Rarely needed manually — the renderer task handles it.

---

## Deployment (GitHub Pages)

The site is deployed automatically on every push to `main` by `.github/workflows/pages.yml`.

One-time setup on a new repo: in **Settings → Pages**, set **Source: GitHub Actions**.

The deployed site is fully client-side:

- All system generation runs in the browser using the bundled seeder.
- Seeds are persisted to `localStorage` per origin. (The localhost origin and the `github.io` origin maintain separate libraries.)
- Routes are hash-based: `seed.html#<seed>`, `canvas.html#<seed>`. Sharing a seed URL is enough to reproduce the system — generation is deterministic from the seed.
- No server runs in production. The `./sse` hot-reload endpoint fails silently there, which is intentional.

---

## Pages

| Page | Purpose |
| --- | --- |
| `index.html` | Generator — enter a seed or generate random, navigate to the viewer |
| `seeds.html` | Library — list of seeds saved in `localStorage` |
| `seed.html#<seed>` | 3D orrery view |
| `canvas.html#<seed>` | 2D canvas view |

## Architecture

| File | Role |
| --- | --- |
| `seeder/generator.ts` | Core generation logic — star, planets, moons, deposits |
| `seeder/config.ts` | Default config, archetype weights, settlement config |
| `seeder/rng.ts` | Seeded PRNG, name generator |
| `seeder/types.ts` | Shared TypeScript types |
| `seeder/main.ts` | CLI entry point (Deno only) |
| `seeder/browser-entry.ts` | Bundle entry — re-exports pure functions for the browser |
| `build.ts` | esbuild bundler, builds `renderer/generator.bundle.js` |
| `server.ts` | Local dev server (static + SSE + rebuild on seeder changes) |
| `renderer/*.html` | Page views |
| `renderer/scene.js` | 3D orrery (Three.js) |
| `renderer/canvas-scene.js` | 2D canvas orrery |
| `renderer/panel.js`, `canvas-panel.js` | System info panels |
| `renderer/storage.js` | `localStorage` wrapper |
| `.github/workflows/pages.yml` | CI: build + deploy to GitHub Pages |

## Seed files

The CLI writes to `seeds/` by default; `seeds/*.json` is gitignored (the folder itself is tracked via `.gitkeep`). Commit specific files manually if you want to share them. The deployed site does not read these — only localStorage.
