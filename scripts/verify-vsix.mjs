import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const vsix = process.argv[2] || "latex-editing-toolkit-2.0.1.vsix";
if (!existsSync(vsix)) throw new Error(`VSIX not found: ${vsix}`);
const listing = execFileSync("npx", ["--no-install", "@vscode/vsce", "ls", vsix], { encoding: "utf8" });
const forbidden = ["/cookie", "cookie-sjtu", "image 2.png", "src/", "test/", "out/", ".map"];
const found = forbidden.filter(item => listing.split(/\r?\n/).some(line => line.includes(item)));
if (found.length) throw new Error(`Forbidden VSIX entries: ${found.join(", ")}`);
if (listing.split(/\r?\n/).some(line => /dist\/vendor\/socket\.io-client\/.*\.(?:as|swf|zip|html)$/i.test(line))) {
  throw new Error("VSIX contains unused legacy Socket.IO/Flash development assets.");
}
const entries = listing.split(/\r?\n/);
const unexpectedNodeModules = entries.filter(line => line.includes("node_modules/") && !line.includes("dist/vendor/socket.io-client/node_modules/"));
if (unexpectedNodeModules.length) throw new Error(`Unexpected VSIX node_modules entries: ${unexpectedNodeModules.join(", ")}`);
for (const expected of [
  "assets/icon.png",
  "assets/activitybar.svg",
  "dist/extension.js",
  "dist/webview.js",
  "dist/monaco/vs/loader.js",
  "dist/vendor/socket.io-client/lib/io.js",
  "dist/vendor/socket.io-client/lib/parser.js",
  "dist/vendor/socket.io-client/node_modules/ws/index.js",
  "dist/vendor/socket.io-client/node_modules/xmlhttprequest/lib/XMLHttpRequest.js"
]) {
  if (!entries.some(line => line.includes(expected))) throw new Error(`Missing VSIX entry: ${expected}`);
}
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
if (manifest.version !== "2.0.1") throw new Error(`Unexpected package version ${manifest.version}`);
console.log(`Verified ${vsix}`);
