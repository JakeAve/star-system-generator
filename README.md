# Star System Seeder

A procedural solar system generator and browser-based renderer for a space
colonization game.

## Overview

Two components:

- **Seeder** — a Deno CLI that procedurally generates solar systems and writes
  them as JSON seed files
- **Renderer** — a Deno HTTP server + vanilla JS frontend for viewing, browsing,
  and generating systems in the browser

---

## Seeder

The seeder generates deterministic solar systems from an integer seed. Each
system includes a star, orbital objects (rocky planets, gas giants, ice giants,
asteroids, dwarf planets, moons), resource deposits, and settlement slot counts.

```
deno task seed [seed] [--json [folder]]
```

- Without arguments: generates a random system and prints stats
- With an integer argument: generates the system for that seed (reproducible)
- `--json`: exports the system to JSON (default folder: `seeds/`)
- `--json <folder>`: exports to the specified folder, creating it if it doesn't
  exist

Examples:

```
deno task seed                        # random system, stats only
deno task seed 42                     # fixed seed, stats only
deno task seed --json                 # random system, write to seeds/
deno task seed 42 --json              # fixed seed, write to seeds/
deno task seed 42 --json ./exports    # fixed seed, write to ./exports/
```

### What gets generated

- **Star** — spectral type (F/G/K/M), luminosity, mass, radius, habitable zone
  AU
- **Orbital objects** — type, orbit radius (AU), orbit period, eccentricity,
  radius, mass, settlement cap, resource deposits, orbital phase, rotation
  period, tidal lock status
- **Moons** — same fields as orbital objects, plus parent ID and captured-moon
  flag
- **Migration archetype** — system history affecting planet placement (e.g. Hot
  Jupiter Migration, Grand Tack)
- **Resource deposits** — per-object list of resources with abundance and
  confidence values

### Architecture

| File                  | Role                                                        |
| --------------------- | ----------------------------------------------------------- |
| `seeder/main.ts`      | CLI entry point — parses args, calls generator, writes JSON |
| `seeder/generator.ts` | Core generation logic — star, planets, moons, deposits      |
| `seeder/config.ts`    | Default config, archetype weights, settlement config        |
| `seeder/rng.ts`       | Seeded PRNG, name generator                                 |
| `seeder/types.ts`     | Shared TypeScript types                                     |

---

## Renderer

A local dev server serving a multi-page browser app. Generates and browses solar
systems without touching the CLI.

```
deno task renderer
```

Opens `http://localhost:8080` automatically.

### Pages

| Route          | Page                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| `/`            | Generator — enter a seed or generate random, view system summary                  |
| `/seeds`       | Library — list all saved seed files with star type, object count, and slot totals |
| `/seed/<seed>` | Detail — full orrery view of a specific system with the system panel              |

### API

| Endpoint                 | Description                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `GET /generate?seed=<n>` | Generate a system (random if no seed), save to `seeds/`, return JSON |
| `GET /sse`               | Server-sent events for live reload on renderer file changes          |

### Architecture

| File                  | Role                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `server.ts`           | Deno HTTP server — static file serving, `/generate`, SSE hot reload |
| `renderer/index.html` | Generator page                                                      |
| `renderer/seeds.html` | Seeds library page                                                  |
| `renderer/seed.html`  | Single system detail page                                           |
| `renderer/scene.js`   | Orrery canvas renderer                                              |
| `renderer/panel.js`   | System info panel                                                   |
| `renderer/storage.js` | Client-side seed list fetching and rendering                        |

---

## Requirements

- [Deno](https://deno.com/) v2+

## Seed files

Generated seeds are written to `seeds/` by default and are gitignored
(`seeds/*.json`). The folder itself is tracked via `.gitkeep`. Commit specific
seed files manually if you want to share them.
