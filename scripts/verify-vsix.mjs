import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const vsix = process.argv[2] || "latex-editing-toolkit-2.0.0.vsix";
if (!existsSync(vsix)) throw new Error(`VSIX not found: ${vsix}`);
const listing = execFileSync("npx", ["--no-install", "@vscode/vsce", "ls", vsix], { encoding: "utf8" });
const forbidden = ["/cookie", "cookie-sjtu", "image 2.png", "src/", "test/", "node_modules/", "out/", ".map"];
const found = forbidden.filter(item => listing.split(/\r?\n/).some(line => line.includes(item)));
if (found.length) throw new Error(`Forbidden VSIX entries: ${found.join(", ")}`);
for (const expected of ["assets/icon.png", "assets/activitybar.svg", "dist/extension.js", "dist/webview.js", "dist/monaco/vs/loader.js"]) {
  if (!listing.split(/\r?\n/).some(line => line.includes(expected))) throw new Error(`Missing VSIX entry: ${expected}`);
}
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
if (manifest.version !== "2.0.0") throw new Error(`Unexpected package version ${manifest.version}`);
console.log(`Verified ${vsix}`);
