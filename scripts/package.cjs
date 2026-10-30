const path = require('node:path');
async function main() {
  const { packager } = await import('@electron/packager');
  const directories = await packager({
    dir: path.resolve(__dirname, '..'), name: 'Prism', executableName: 'prism',
    out: 'dist', platform: process.platform, arch: process.arch, overwrite: true,
    electronVersion: require('electron/package.json').version,
    download: { checksums: require('electron/checksums.json') },
    // Keep Sharp's platform-native bindings and worker files directly accessible.
    asar: false, prune: true,
    ignore: /^\/(?:\.tools|\.git|\.agents|\.codex|\.aws|\.flatpak-builder|\.flatpak-build|\.flatpak-repo|flatpak|test|scripts|artifacts|dist|AGENTS\.md)(?:\/|$)/
  });
  console.log(`Portable application: ${directories.join(', ')}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
