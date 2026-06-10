import { assertEquals } from "@std/assert";
import { generateSolarSystem } from "../core/generator.ts";
import { buildViewModel } from "./view-model.ts";

Deno.test("buildViewModel returns a star body first", () => {
  const sys = generateSolarSystem({ seed: 42 });
  const vm = buildViewModel(sys, 0);
  assertEquals(vm[0].type, "star");
  assertEquals(vm[0].parentId, null);
  assertEquals(vm[0].position, { x: 0, y: 0 });
});

Deno.test("buildViewModel includes every object and moon exactly once", () => {
  const sys = generateSolarSystem({ seed: 42 });
  const moonCount = sys.objects.reduce((n, o) => n + (o.moons?.length ?? 0), 0);
  const vm = buildViewModel(sys, 0);
  assertEquals(vm.length, 1 + sys.objects.length + moonCount);
});

Deno.test("buildViewModel is deterministic for the same system + time", () => {
  const sys = generateSolarSystem({ seed: 7 });
  assertEquals(buildViewModel(sys, 123), buildViewModel(sys, 123));
});

Deno.test("buildViewModel: moon world position is relative to its parent", () => {
  const sys = generateSolarSystem({ seed: 42 });
  const vm = buildViewModel(sys, 50);
  const moon = vm.find((b) => b.parentId !== null && b.type === "moon");
  if (moon) {
    const parent = vm.find((b) => b.id === moon.parentId)!;
    assertEquals(typeof moon.position.x, "number");
    assertEquals(moon.position.x !== parent.position.x || moon.position.y !== parent.position.y, true);
  }
});

Deno.test("buildViewModel: star body id matches system.star.id", () => {
  const system = generateSolarSystem({ seed: 42 });
  const vm = buildViewModel(system, 0);
  const starBody = vm.find((b) => b.type === "star");
  assertEquals(starBody?.id, system.star.id);
});
