import * as esbuild from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  sourcemap: false,
  logLevel: "info"
};

const builds = [
  esbuild.context({
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"]
  }),
  esbuild.context({
    ...common,
    entryPoints: ["src/webview/index.ts"],
    outfile: "dist/webview.js",
    platform: "browser",
    format: "iife"
  })
];

mkdirSync("dist", { recursive: true });
mkdirSync(dirname("dist/webview.css"), { recursive: true });
copyFileSync("src/webview/styles.css", "dist/webview.css");
copyFileSync("node_modules/@vscode/codicons/dist/codicon.css", "dist/codicon.css");
copyFileSync("node_modules/@vscode/codicons/dist/codicon.ttf", "dist/codicon.ttf");

if (watch) {
  for (const ctxPromise of builds) {
    const ctx = await ctxPromise;
    await ctx.watch();
  }
  console.log("Watching extension and webview builds.");
} else {
  for (const ctxPromise of builds) {
    const ctx = await ctxPromise;
    await ctx.rebuild();
    await ctx.dispose();
  }
}
