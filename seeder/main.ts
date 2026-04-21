// system-seeder-2/main.ts

import { allObjects, generateSolarSystem, knownObjects } from "./generator.ts";
import { DEFAULT_CONFIG } from "./config.ts";

const args = Deno.args;

const jsonFlagIdx = args.indexOf("--json");
const exportJson = jsonFlagIdx !== -1;

const folderArg = exportJson && jsonFlagIdx + 1 < args.length &&
    !args[jsonFlagIdx + 1].startsWith("--")
  ? args[jsonFlagIdx + 1]
  : null;
const outputDir = folderArg ?? "./seeds";

const seedArg = args.find((a, i) =>
  !a.startsWith("--") && !(folderArg !== null && i === jsonFlagIdx + 1)
);
const rawSeed = parseInt(seedArg ?? "");
const seed = !isNaN(rawSeed) ? rawSeed : undefined;

const system = generateSolarSystem({ seed });

const frostLineAU = system.star.habitableZoneAU *
  DEFAULT_CONFIG.frostLineAUFactor;
const all = allObjects(system);
const known = knownObjects(system);

console.log(`Generated system seed: ${system.seed}`);
console.log(
  `  Star:     ${system.star.spectralType}-type  luminosity:${system.star.luminosity}x Sol`,
);
console.log(
  `  Hz:       ${system.star.habitableZoneAU} AU  |  Frost line: ${
    frostLineAU.toFixed(2)
  } AU`,
);
console.log(`  History:  ${system.migrationHistory}`);
console.log(
  `  Objects:  ${all.length} total (${system.objects.length} top-level, ${
    all.length - system.objects.length
  } moons)`,
);
console.log(`  Known:    ${known.length}`);
console.log(
  `  Slots:    ${
    all.reduce((s, o) => s + o.settlementCap, 0)
  } settlement slots`,
);

if (exportJson) {
  await Deno.mkdir(outputDir, { recursive: true });
  const filename = `${outputDir}/system-${system.seed}.json`;
  await Deno.writeTextFile(filename, JSON.stringify(system, null, 2));
  console.log(`Exported:  ${filename}`);
}
