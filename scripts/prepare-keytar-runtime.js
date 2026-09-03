const { copyFileSync, existsSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const target = process.env.KEYTAR_TARGET;
const root = join('dist', 'vendor', 'keytar');
rmSync(root, { recursive: true, force: true });

if (!target) {
  console.log('No macOS keytar target requested; removed bundled keytar runtime.');
  process.exit(0);
}

if (!/^darwin-(x64|arm64)$/.test(target)) {
  throw new Error(`Unsupported KEYTAR_TARGET ${target}; expected darwin-x64 or darwin-arm64.`);
}

const expectedArch = target.slice('darwin-'.length);
if (process.platform !== 'darwin' || process.arch !== expectedArch) {
  throw new Error(`KEYTAR_TARGET=${target} must be prepared on macOS ${expectedArch}; current host is ${process.platform}-${process.arch}.`);
}

const sourceLib = join('node_modules', 'keytar', 'lib', 'keytar.js');
const sourceNative = join('node_modules', 'keytar', 'build', 'Release', 'keytar.node');
if (!existsSync(sourceLib) || !existsSync(sourceNative)) {
  throw new Error('keytar is not built. Run npm ci on the target macOS runner before packaging.');
}

const targetRoot = join(root, target);
mkdirSync(join(targetRoot, 'lib'), { recursive: true });
mkdirSync(join(targetRoot, 'build', 'Release'), { recursive: true });
copyFileSync(sourceLib, join(targetRoot, 'lib', 'keytar.js'));
copyFileSync(sourceNative, join(targetRoot, 'build', 'Release', 'keytar.node'));
console.log(`Prepared macOS keytar runtime for ${target}.`);
