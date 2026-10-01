import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const vsix = process.argv[2] || `latex-editing-toolkit-${manifest.version}.vsix`;
const targetMatch = /-darwin-(x64|arm64)\.vsix$/i.exec(vsix);
const keytarTarget = process.env.KEYTAR_TARGET || (targetMatch ? `darwin-${targetMatch[1].toLowerCase()}` : undefined);
if (!existsSync(vsix)) throw new Error(`VSIX not found: ${vsix}`);

// Inspect the archive itself. `vsce ls` ignores a VSIX argument and lists what the current
// checkout would package, so it cannot catch a VSIX built from a different tree.
const EXTENSION_PREFIX = "extension/";
const entries = execFileSync("unzip", ["-Z1", vsix], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split(/\r?\n/)
  .filter(line => line.startsWith(EXTENSION_PREFIX) && !line.endsWith("/"))
  .map(line => line.slice(EXTENSION_PREFIX.length));
const files = new Set(entries);

const forbiddenNames = new Set(["cookie", "cookie-sjtu", "cookie.txt", "image 2.png"]);
const found = entries.filter(entry => /^(?:src|test|out)\//.test(entry)
  || entry.endsWith(".map")
  || forbiddenNames.has(entry.split("/").pop()));
if (found.length) throw new Error(`Forbidden VSIX entries: ${found.join(", ")}`);
if (entries.some(entry => /^dist\/vendor\/socket\.io-client\/.*\.(?:as|swf|zip|html)$/i.test(entry))) {
  throw new Error("VSIX contains unused legacy Socket.IO/Flash development assets.");
}
const unexpectedNodeModules = entries.filter(entry => entry.includes("node_modules/")
  && !entry.startsWith("dist/vendor/socket.io-client/node_modules/"));
if (unexpectedNodeModules.length) throw new Error(`Unexpected VSIX node_modules entries: ${unexpectedNodeModules.join(", ")}`);
for (const expected of [
  "assets/icon.png",
  "assets/activitybar.svg",
  "dist/extension.js",
  "dist/cli.js",
  "dist/webview.js",
  "dist/monaco/vs/loader.js",
  "dist/vendor/socket.io-client/lib/io.js",
  "dist/vendor/socket.io-client/lib/parser.js",
  "dist/vendor/socket.io-client/node_modules/ws/index.js",
  "dist/vendor/socket.io-client/node_modules/ws/lib/websocket.js",
  "dist/vendor/socket.io-client/node_modules/xmlhttprequest/lib/XMLHttpRequest.js",
  "assets/template/templates/beamer-uchicago.tex",
  "assets/template/templates/beamer-blei.tex",
  "assets/template/templates/beamer-gotham.tex",
  "assets/template/beamer/uchicago/Ritsumeikan.sty",
  "assets/template/beamer/uchicago/pic/uchicago.png",
  "assets/template/beamer/blei/beamerthemeblei.sty",
  "assets/template/beamer/gotham/beamerthemegotham.sty",
  "assets/template/third-party/NOTICE",
  "assets/template/third-party/LICENSES/beamerthemeblei-MIT.txt",
  "assets/template/third-party/LICENSES/beamertheme-gotham-LPPL-1.3c.txt"
]) {
  if (!files.has(expected)) throw new Error(`Missing VSIX entry: ${expected}`);
}
if (entries.some(entry => entry.startsWith("dist/cli-vendor/"))) {
  throw new Error("VSIX contains the duplicate CLI Socket.IO runtime.");
}
const keytarEntries = entries.filter(entry => entry.startsWith("dist/vendor/keytar/"));
if (keytarTarget) {
  const keytarRoot = `dist/vendor/keytar/${keytarTarget}/`;
  for (const expected of [`${keytarRoot}lib/keytar.js`, `${keytarRoot}build/Release/keytar.node`]) {
    if (!files.has(expected)) throw new Error(`Missing VSIX entry: ${expected}`);
  }
  const unexpected = keytarEntries.filter(entry => !entry.startsWith(keytarRoot));
  if (unexpected.length) throw new Error(`VSIX contains keytar runtimes for another target: ${unexpected.join(", ")}`);
} else if (keytarEntries.length) {
  // The generic VSIX is the one Linux, Windows and Remote-SSH hosts install; a macOS binary there
  // is dead weight and would also be copied into the CLI install.
  throw new Error(`Generic VSIX unexpectedly contains a native keytar runtime: ${keytarEntries.join(", ")}`);
}
const zipDetails = execFileSync("unzip", ["-Z", "-v", vsix], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
if (!/extension\/dist\/cli\.js[\s\S]{0,1200}Unix file attributes \(100[1357][0-7][0-7] octal\)/.test(zipDetails)) {
  throw new Error("VSIX did not preserve executable permission for dist/cli.js.");
}

// Load the packaged runtimes from a scratch extraction with no node_modules above it, so a missing
// vendored file fails here instead of resolving to the build tree's copy.
const extracted = mkdtempSync(join(tmpdir(), "verify-vsix-"));
try {
  execFileSync("unzip", ["-q", vsix, "extension/dist/cli.js", "extension/dist/vendor/*", "-d", extracted]);
  const dist = join(extracted, "extension", "dist");
  if (!readFileSync(join(dist, "cli.js"), "utf8").startsWith("#!/usr/bin/env node\n")) {
    throw new Error("dist/cli.js is missing its Node shebang.");
  }
  const runtimeRequire = createRequire(join(dist, "vendor", "socket.io-client", "lib", "io.js"));
  const runtime = runtimeRequire("./io.js");
  if (!runtime || runtime.version !== "0.9.17-overleaf-5" || typeof runtime.connect !== "function") {
    throw new Error("Packaged Overleaf Socket.IO runtime failed to load.");
  }
  const WebSocket = runtimeRequire("ws");
  if (typeof WebSocket !== "function" || typeof WebSocket.Server !== "function") {
    throw new Error("Packaged ws runtime is incomplete.");
  }
  if (typeof runtimeRequire("xmlhttprequest").XMLHttpRequest !== "function") {
    throw new Error("Packaged xmlhttprequest runtime is incomplete.");
  }
  if (keytarTarget) {
    const nativePath = join(dist, "vendor", "keytar", keytarTarget, "build", "Release", "keytar.node");
    const fileDescription = execFileSync("file", [nativePath], { encoding: "utf8" });
    const expectedArchitecture = keytarTarget.endsWith("x64") ? /x86[_-]64|x86-64/ : /arm64|aarch64/;
    if (!expectedArchitecture.test(fileDescription)) {
      throw new Error(`Bundled keytar.node architecture does not match ${keytarTarget}: ${fileDescription.trim()}`);
    }
  }
} finally {
  rmSync(extracted, { recursive: true, force: true });
}
console.log(`Verified ${vsix}`);
