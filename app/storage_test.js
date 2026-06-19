import { listSeeds, loadSystem, removeSystem, saveSystem } from "./storage.js";

const store = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i) => Object.keys(store)[i] ?? null,
  },
  writable: true,
  configurable: true,
});

Deno.test("saveSystem stores full JSON at sc:seed:<id>", () => {
  const data = { seed: 123, star: { spectralType: "G" }, objects: [] };
  saveSystem(data);
  const raw = store["sc:seed:123"];
  if (!raw) throw new Error("key sc:seed:123 not found in storage");
  if (JSON.parse(raw).seed !== 123) throw new Error("seed value mismatch");
});

Deno.test("loadSystem returns parsed object for known id", () => {
  store["sc:seed:456"] = JSON.stringify({
    seed: 456,
    star: { spectralType: "K" },
    objects: [],
  });
  const result = loadSystem(456);
  if (!result || result.seed !== 456) throw new Error("expected seed 456");
});

Deno.test("loadSystem returns null for unknown id", () => {
  const result = loadSystem(99999);
  if (result !== null) {
    throw new Error(`expected null, got ${JSON.stringify(result)}`);
  }
});

Deno.test("listSeeds returns only sc:seed:* entries", () => {
  localStorage.clear();
  store["sc:seed:1"] = JSON.stringify({
    seed: 1,
    star: { spectralType: "M" },
    objects: [],
  });
  store["sc:seed:2"] = JSON.stringify({
    seed: 2,
    star: { spectralType: "F" },
    objects: [{}],
  });
  store["other:key"] = "ignored";
  const list = listSeeds();
  if (list.length !== 2) {
    throw new Error(`expected 2 seeds, got ${list.length}`);
  }
});

Deno.test("removeSystem deletes the key", () => {
  store["sc:seed:789"] = JSON.stringify({ seed: 789 });
  removeSystem(789);
  if ("sc:seed:789" in store) throw new Error("expected key to be deleted");
});

// Phase 3 — retrograde is a plain boolean and must survive save→load on both
// top-level bodies and nested moons (loadSystem is the primary path for any
// previously-viewed seed).
Deno.test("saveSystem/loadSystem preserves retrograde flags including nested moons", () => {
  const data = {
    seed: 321,
    star: { spectralType: "G", retrograde: false },
    objects: [
      { id: "p1", retrograde: false, moons: [{ id: "m1", retrograde: true }] },
      { id: "c1", retrograde: true, moons: [] },
    ],
  };
  saveSystem(data);
  const loaded = loadSystem(321);
  if (loaded.objects[0].retrograde !== false) {
    throw new Error("prograde planet flag not preserved");
  }
  if (loaded.objects[0].moons[0].retrograde !== true) {
    throw new Error("retrograde nested moon flag not preserved");
  }
  if (loaded.objects[1].retrograde !== true) {
    throw new Error("retrograde comet flag not preserved");
  }
});
