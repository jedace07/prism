const path = require('node:path');
const fs = require('node:fs/promises');
async function main() {
  if (!process.versions.bun) throw new Error('Run packaging with Bun.');
  const { packager } = await import('@electron/packager');
  const directories = await packager({
    dir: path.resolve(__dirname, '..'), name: 'Prism', executableName: 'prism',
    out: 'dist', platform: process.platform, arch: process.arch, overwrite: true,
    electronVersion: require('electron/package.json').version,
    download: { checksums: require('electron/checksums.json') },
    // Keep the Bun decoder runtime and worker scripts directly accessible.
    asar: false, prune: true,
    afterCopy: [async ({ buildPath }) => {
      const runtimeDir = path.join(buildPath, 'runtime');
      await fs.mkdir(runtimeDir, { recursive: true });
      const runtime = path.join(runtimeDir, process.platform === 'win32' ? 'bun.exe' : 'bun');
      await fs.copyFile(process.execPath, runtime);
      await fs.chmod(runtime, 0o755);
      await fs.copyFile(path.resolve(__dirname, '..', 'third_party', 'Bun-LICENSE.md'), path.join(runtimeDir, 'Bun-LICENSE.md'));
    }],
    ignore: /^\/(?:\.tools|\.git|\.github|\.agents|\.codex|\.aws|\.flatpak-builder|\.flatpak-build|\.flatpak-repo|flatpak|test|scripts|artifacts|dist|AGENTS\.md)(?:\/|$)/
  });
  console.log(`Portable application: ${directories.join(', ')}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
