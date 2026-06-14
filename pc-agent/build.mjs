// Bundles the three Electron entry points with esbuild and copies static assets.
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const common = { bundle: true, sourcemap: true, logLevel: "info", target: "es2022" };

await build({
  ...common,
  entryPoints: ["src/main/main.ts"],
  outfile: "dist/main.js",
  platform: "node",
  format: "cjs",
  // Native + electron stay external; bundling them would break native bindings.
  external: ["electron", "@nut-tree-fork/nut-js"],
});

await build({
  ...common,
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.js",
  platform: "node",
  format: "cjs",
  external: ["electron"],
});

await build({
  ...common,
  entryPoints: ["src/renderer/host.ts"],
  outfile: "dist/renderer/host.js",
  platform: "browser",
  format: "iife",
});

mkdirSync("dist/renderer", { recursive: true });
cpSync("src/renderer/host.html", "dist/renderer/host.html");

console.log("pc-agent build complete -> dist/");
