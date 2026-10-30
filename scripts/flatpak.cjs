const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const APP_ID = 'io.github.prismviewer.Prism';
const manifest = path.join(root, 'flatpak', `${APP_ID}.json`);
const buildDir = path.join(root, '.flatpak-build');
const repo = path.join(root, '.flatpak-repo');
function run(command, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (capture) { child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk); }
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${command} exited with ${code}${output ? `: ${output.trim()}` : ''}`)));
  });
}
async function builder() {
  try { await run('flatpak-builder', ['--version'], true); return ['flatpak-builder', []]; } catch { /* Prefer the sandboxed tool when no native tool is present. */ }
  try {
    await run('flatpak', ['info', 'org.flatpak.Builder'], true);
    return ['flatpak', ['run', '--filesystem=' + root, '--command=flatpak-builder', 'org.flatpak.Builder']];
  } catch {
    throw new Error('Flatpak Builder is missing. Install the user Flatpak, without layering host packages:\nflatpak install --user --no-related flathub org.flatpak.Builder org.electronjs.Electron2.BaseApp//26.08');
  }
}
async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This local Flatpak manifest currently targets Linux x64.');
  const action = process.argv[2] || 'build';
  if (!['build', 'check', 'bundle'].includes(action)) throw new Error(`Unknown Flatpak action: ${action}`);
  const [command, prefix] = await builder();
  if (action === 'check') {
    await run(command, [...prefix, '--show-manifest', manifest], true);
    console.log(`Manifest valid: ${APP_ID} (Freedesktop 26.08, Linux x64)`);
    return;
  }
  if (action === 'build') {
    await run(process.execPath, ['run', 'package']);
    // The builder downloads pinned sources before its offline compilation stages.
    // Export locally; installing the resulting application is a separate command.
    await run(command, [...prefix, '--user', '--install-deps-from=flathub', '--force-clean', `--repo=${repo}`, buildDir, manifest]);
    console.log(`Built ${APP_ID}. Install with: flatpak install --user ${repo} ${APP_ID}`);
    return;
  }
  await fs.access(path.join(repo, 'config'));
  const bundle = path.join(root, 'dist', 'Prism-x86_64.flatpak');
  await run('flatpak', ['build-bundle', repo, bundle, APP_ID, 'master']);
  console.log(`Flatpak bundle: ${bundle}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { APP_ID, manifest };
