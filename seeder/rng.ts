// system-seeder-2/rng.ts

import { ObjectType } from "./types.ts";

// ── Seeded RNG (Mulberry32) ───────────────────────────────────────────────────

export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns a float in [0, 1) */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let z = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    z = (z ^ (z + Math.imul(z ^ (z >>> 7), 61 | z))) >>> 0;
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  pick<T>(arr: T[]): T {
    const i = Math.min(Math.floor(this.next() * arr.length), arr.length - 1);
    return arr[i];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  weightedPick<T>(options: { value: T; weight: number }[]): T {
    const total = options.reduce((s, o) => s + o.weight, 0);
    let r = this.next() * total;
    for (const o of options) {
      r -= o.weight;
      if (r <= 0) return o.value;
    }
    return options[options.length - 1].value;
  }
}

// ── Name generator ────────────────────────────────────────────────────────────

const PREFIXES = [
  // Original
  "Astra",
  "Ceres",
  "Helios",
  "Lyra",
  "Nyx",
  "Orion",
  "Selene",
  "Vega",
  "Zephyr",
  "Kalos",

  // Greco-Roman gods & titans
  "Ares",
  "Apollo",
  "Athena",
  "Artemis",
  "Kronos",
  "Hermes",
  "Hera",
  "Hades",
  "Iris",
  "Juno",
  "Luna",
  "Mars",
  "Minerva",
  "Neptune",
  "Pluto",
  "Saturn",
  "Sol",
  "Venus",
  "Vulcan",
  "Aurora",

  // Stars & constellations
  "Altair",
  "Antares",
  "Arcturus",
  "Betelgeuse",
  "Canopus",
  "Capella",
  "Castor",
  "Deneb",
  "Electra",
  "Fomalhaut",
  "Mira",
  "Pollux",
  "Procyon",
  "Rigel",
  "Sirius",
  "Spica",
  "Tauri",
  "Vela",
  "Vindemia",
  "Zuben",

  // Space & cosmic
  "Aeon",
  "Astro",
  "Axiom",
  "Celeste",
  "Corona",
  "Cosmo",
  "Drift",
  "Eclipse",
  "Ember",
  "Flux",
  "Helix",
  "Lumen",
  "Nebula",
  "Nova",
  "Pulsar",
  "Quasar",
  "Radia",
  "Solara",
  "Stellar",
  "Umbra",
  "Void",
  "Warp",
  "Xenon",
  "Zenith",
  "Zypher",

  // Mythological / poetic
  "Aether",
  "Alara",
  "Caelum",
  "Calyx",
  "Dusk",
  "Elara",
  "Eris",
  "Ethos",
  "Gaia",
  "Halcyon",
  "Icarus",
  "Kael",
  "Lior",
  "Mira",
  "Nox",
  "Oberon",
  "Phaedra",
  "Remus",
  "Romulus",
  "Theron",
];

const SUFFIXES = [
  "Prime",
  "Minor",
  "Major",
  "II",
  "III",
  "IV",
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Epsilon",
  "Zeta",
  "Eta",
  "Theta",
  "Iota",
  "Kappa",
  "Lambda",
  "Mu",
  "Nu",
  "Xi",
  "Omicron",
  "Pi",
  "Rho",
  "Sigma",
  "Tau",
  "Upsilon",
  "Phi",
  "Chi",
  "Psi",
  "Omega",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "Apex",
  "Ascendant",
  "Central",
  "Distant",
  "Dominant",
  "Elder",
  "Eternal",
  "Far",
  "First",
  "Final",
  "Forgotten",
  "Hidden",
  "Last",
  "Lost",
  "Near",
  "Outer",
  "Rising",
  "Second",
  "Sovereign",
  "Supreme",
  "Terminal",
  "Third",
  "Ultra",
  "Wandering",
  "Zero",
  "Bright",
  "Dark",
  "Dawn",
  "Deep",
  "Dim",
  "Dusk",
  "Fell",
  "Glow",
  "Pale",
  "Radiant",
  "Shadow",
  "Stark",
  "Swift",
  "True",
  "Vast",
  "Veiled",
  "Void",
  "Wild",
  "Worn",
  "Ancient",
];
const MOON_NAMES = [
  "Io",
  "Callisto",
  "Titan",
  "Enceladus",
  "Triton",
  "Oberon",
  "Charon",
  "Phobos",
  "Deimos",
  "Rhea",
  "Europa",
  "Ganymede",
  "Himalia",
  "Amalthea",
  "Thebe",
  "Mimas",
  "Dione",
  "Tethys",
  "Hyperion",
  "Iapetus",
  "Phoebe",
  "Helene",
  "Pandora",
  "Prometheus",
  "Ariel",
  "Umbriel",
  "Titania",
  "Miranda",
  "Puck",
  "Caliban",
  "Nereid",
  "Proteus",
  "Larissa",
  "Dysnomia",
  "Nix",
  "Hydra",
  "Styx",
  "Kerberos",
];

let _nameCounter = 0;
let _moonQueue: string[] = [];

export function resetNameCounter(): void {
  _nameCounter = 0;
  _moonQueue = [];
}

export function generateName(
  rng: RNG,
  type: ObjectType,
  _index: number,
): string {
  _nameCounter++;
  if (type === ObjectType.Asteroid || type === ObjectType.DwarfPlanet) {
    const prefix = rng.pick(PREFIXES).slice(0, 3).toUpperCase();
    return `${_nameCounter}-${prefix}`;
  }
  if (type === ObjectType.Moon) {
    // Shuffle on first use per system; pop guarantees no duplicates until all 38 names exhausted
    if (_moonQueue.length === 0) _moonQueue = rng.shuffle([...MOON_NAMES]);
    return _moonQueue.pop()!;
  }
  const prefix = rng.pick(PREFIXES);
  const suffix = rng.pick(SUFFIXES);
  return `${prefix} ${suffix}`;
}
