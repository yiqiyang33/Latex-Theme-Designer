import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("src/stylePresets.ts", "utf8");
const s0 = src.indexOf('id: "default"'), e0 = src.indexOf("\n  }", s0);
const colors = {};
for (const m of src.slice(s0, e0).matchAll(/"([a-z0-9-]+)":\s*"(#[0-9A-Fa-f]{6})"/g)) colors[m[1]] = m[2];

let theme = readFileSync("assets/template/theme.sty", "utf8");
const lets = new Map();
for (const m of theme.matchAll(/\\colorlet\{([^}]+)\}\{([^}]+)\}/g)) if (!lets.has(m[1])) lets.set(m[1], m[2]);

// token -> the definecolor it ultimately points at
const target = {};
for (const token of Object.keys(colors)) {
  let expr = lets.get(token), guard = 0;
  while (expr && lets.has(expr) && guard++ < 10) expr = lets.get(expr);
  if (expr && /^[A-Za-z0-9-]+$/.test(expr)) target[token] = expr;
}
const owners = {};
for (const [t, d] of Object.entries(target)) (owners[d] ||= []).push(t);
const shared = Object.entries(owners).filter(([, ts]) => new Set(ts.map((t) => colors[t])).size > 1);
if (shared.length) {
  console.log("CONFLICT - one definecolor feeds tokens that now need different values:");
  for (const [d, ts] of shared) console.log(" ", d, "->", ts.map((t) => `${t}=${colors[t]}`).join(", "));
}
let n = 0, unmapped = [];
for (const [token, value] of Object.entries(colors)) {
  const d = target[token];
  if (!d) { unmapped.push(token); continue; }
  const re = new RegExp(`(\\\\definecolor\\{${d}\\}\\{HTML\\}\\{)[0-9A-Fa-f]{6}(\\})`);
  if (!re.test(theme)) { unmapped.push(token); continue; }
  theme = theme.replace(re, (_, a, b) => a + value.slice(1) + b);
  n++;
}
writeFileSync("assets/template/theme.sty", theme);
console.log("synced", n, "| unmapped:", unmapped.length ? unmapped.join(", ") : "(none)");
