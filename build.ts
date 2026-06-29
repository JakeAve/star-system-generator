import * as esbuild from "esbuild";

const BUNDLES: Array<{ entry: string; out: string; external: string[] }> = [
  { entry: "mod.ts", out: "app/star-seeder.bundle.js", external: [] },
  {
    entry: "src/orrery-3d/engine.ts",
    out: "app/orrery-3d.bundle.js",
    external: ["three", "three/addons/*"],
  },
  {
    entry: "src/orrery-2d/engine.ts",
    out: "app/orrery-2d.bundle.js",
    external: [],
  },
];

export async function build(): Promise<void> {
  for (const b of BUNDLES) {
    await esbuild.build({
      entryPoints: [b.entry],
      bundle: true,
      format: "esm",
      outfile: b.out,
      target: "es2022",
      platform: "browser",
      external: b.external,
      logLevel: "info",
    });
  }
  await esbuild.stop();
  console.log(`Built ${BUNDLES.length} bundles into app/`);
}

if (import.meta.main) {
  await build();
}
