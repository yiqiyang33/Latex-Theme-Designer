const { copyFileSync, mkdirSync, rmSync } = require("node:fs");
const { dirname, join } = require("node:path");

const targetRoot = join("dist", "vendor", "socket.io-client");
rmSync(targetRoot, { recursive: true, force: true });
rmSync(join("dist", "cli-vendor"), { recursive: true, force: true });

function copy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

copy("node_modules/socket.io-client/package.json", join(targetRoot, "package.json"));
const socketIoFiles = [
  "events.js", "io.js", "json.js", "namespace.js", "parser.js", "socket.js", "transport.js", "util.js"
];
for (const file of socketIoFiles) copy(join("node_modules/socket.io-client/lib", file), join(targetRoot, "lib", file));
for (const file of ["websocket.js", "xhr-polling.js", "xhr.js"]) {
  copy(join("node_modules/socket.io-client/lib/transports", file), join(targetRoot, "lib", "transports", file));
}

const dependenciesRoot = join(targetRoot, "node_modules");
copy("node_modules/ws/package.json", join(dependenciesRoot, "ws", "package.json"));
copy("node_modules/ws/index.js", join(dependenciesRoot, "ws", "index.js"));
for (const file of [
  "BufferPool.js", "BufferUtil.fallback.js", "BufferUtil.js", "ErrorCodes.js", "Extensions.js",
  "PerMessageDeflate.js", "Receiver.hixie.js", "Receiver.js", "Sender.hixie.js", "Sender.js",
  "Validation.fallback.js", "Validation.js", "WebSocket.js", "WebSocketServer.js"
]) copy(join("node_modules/ws/lib", file), join(dependenciesRoot, "ws", "lib", file));

copy("node_modules/xmlhttprequest/package.json", join(dependenciesRoot, "xmlhttprequest", "package.json"));
copy("node_modules/xmlhttprequest/lib/XMLHttpRequest.js", join(dependenciesRoot, "xmlhttprequest", "lib", "XMLHttpRequest.js"));

copy("node_modules/options/package.json", join(dependenciesRoot, "options", "package.json"));
copy("node_modules/options/lib/options.js", join(dependenciesRoot, "options", "lib", "options.js"));

copy("node_modules/ultron/package.json", join(dependenciesRoot, "ultron", "package.json"));
copy("node_modules/ultron/index.js", join(dependenciesRoot, "ultron", "index.js"));

const runtime = require(`../${join(targetRoot, "lib", "io.js")}`);
if (!runtime || runtime.version !== "0.9.17-overleaf-5" || typeof runtime.connect !== "function") {
  throw new Error("Prepared Overleaf Socket.IO runtime failed its CommonJS smoke test.");
}
if (!runtime.parser || !runtime.Transport || typeof runtime.parser.encodePacket !== "function") {
  throw new Error("Prepared Overleaf Socket.IO runtime is missing parser/transport exports.");
}
const packet = runtime.parser.decodePacket(runtime.parser.encodePacket({ type: "message", data: "ok" }));
if (packet.type !== "message" || packet.data !== "ok") {
  throw new Error("Prepared Overleaf Socket.IO parser failed its round-trip smoke test.");
}

console.log("Prepared Overleaf Socket.IO runtime.");
