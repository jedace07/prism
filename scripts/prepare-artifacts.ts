// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const { version } = await Bun.file(path.join(root, 'package.json')).json();
  if (process.arch !== 'x64' || !['linux', 'win32'].includes(process.platform)) {
    throw new Error('Distribution currently supports Linux and Windows x64.');
  }
  const platform = process.platform === 'win32' ? 'windows-x64' : 'linux-x86_64';
  const source =
    process.platform === 'win32'
      ? 'dist/installer/Prism-windows-x64-setup.exe'
      : 'Prism-x86_64.flatpak';
  const extension = process.platform === 'win32' ? 'exe' : 'flatpak';
  const output = path.join(root, 'release-assets');
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(
    path.join(root, source),
    path.join(
      output,
      `Prism-${version}-${platform}${process.platform === 'win32' ? '-setup' : ''}.${extension}`,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
