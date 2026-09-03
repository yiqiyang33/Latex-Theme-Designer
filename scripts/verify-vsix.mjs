import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const vsix = process.argv[2] || `latex-editing-toolkit-${manifest.version}.vsix`;
const targetMatch = /-darwin-(x64|arm64)\.vsix$/i.exec(vsix);
const keytarTarget = process.env.KEYTAR_TARGET || (targetMatch ? `darwin-${targetMatch[1].toLowerCase()}` : undefined);
if (!existsSync(vsix)) throw new Error(`VSIX not found: ${vsix}`);
const listing = execFileSync("npx", ["--no-install", "@vscode/vsce", "ls", vsix], { encoding: "utf8" });
const forbidden = ["/cookie", "cookie-sjtu", "image 2.png", "src/", "test/", "out/", ".map"];
const found = forbidden.filter(item => listing.split(/\r?\n/).some(line => line.includes(item)));
if (found.length) throw new Error(`Forbidden VSIX entries: ${found.join(", ")}`);
if (listing.split(/\r?\n/).some(line => /dist\/vendor\/socket\.io-client\/.*\.(?:as|swf|zip|html)$/i.test(line))) {
  throw new Error("VSIX contains unused legacy Socket.IO/Flash development assets.");
}
const entries = listing.split(/\r?\n/);
const unexpectedNodeModules = entries.filter(line => line.includes("node_modules/")
  && !line.includes("dist/vendor/socket.io-client/node_modules/"));
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
  if (!entries.some(line => line.includes(expected))) throw new Error(`Missing VSIX entry: ${expected}`);
}
if (entries.some(line => line.includes("dist/cli-vendor/"))) {
  throw new Error("VSIX contains the duplicate CLI Socket.IO runtime.");
}
const keytarEntries = entries.filter(line => line.includes("dist/vendor/keytar/"));
if (keytarTarget) {
  const keytarRoot = `dist/vendor/keytar/${keytarTarget}/`;
  for (const expected of [`${keytarRoot}lib/keytar.js`, `${keytarRoot}build/Release/keytar.node`]) {
    if (!entries.some(line => line.includes(expected))) throw new Error(`Missing VSIX entry: ${expected}`);
  }
  const unexpected = keytarEntries.filter(line => !line.includes(keytarRoot));
  if (unexpected.length) throw new Error(`VSIX contains keytar runtimes for another target: ${unexpected.join(", ")}`);
} else if (keytarEntries.length) {
  throw new Error(`Generic VSIX unexpectedly contains a native keytar runtime: ${keytarEntries.join(", ")}`);
}
if ((statSync('dist/cli.js').mode & 0o111) === 0) {
  throw new Error('dist/cli.js is not executable.');
}
if (!readFileSync('dist/cli.js', 'utf8').startsWith('#!/usr/bin/env node\n')) {
  throw new Error('dist/cli.js is missing its Node shebang.');
}
const zipDetails = execFileSync('unzip', ['-Z', '-v', vsix], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
if (!/extension\/dist\/cli\.js[\s\S]{0,1200}Unix file attributes \(100[1357][0-7][0-7] octal\)/.test(zipDetails)) {
  throw new Error('VSIX did not preserve executable permission for dist/cli.js.');
}
if (keytarTarget) {
  const nativePath = `dist/vendor/keytar/${keytarTarget}/build/Release/keytar.node`;
  const fileDescription = execFileSync('file', [nativePath], { encoding: 'utf8' });
  const expectedArchitecture = keytarTarget.endsWith('x64') ? /x86[_-]64|x86-64/ : /arm64|aarch64/;
  if (!expectedArchitecture.test(fileDescription)) {
    throw new Error(`Bundled keytar.node architecture does not match ${keytarTarget}: ${fileDescription.trim()}`);
  }
}
console.log(`Verified ${vsix}`);
