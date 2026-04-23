import * as esbuild from "npm:esbuild@0.23.1";

const OUT = "renderer/generator.bundle.js";

export async function build(): Promise<void> {
  await esbuild.build({
    entryPoints: ["seeder/browser-entry.ts"],
    bundle: true,
    format: "esm",
    outfile: OUT,
    target: "es2022",
    platform: "browser",
    logLevel: "info",
  });
  await esbuild.stop();
  console.log(`Built ${OUT}`);
}

if (import.meta.main) {
  await build();
}
