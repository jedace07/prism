// SPDX-License-Identifier: Apache-2.0
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const { version } = await Bun.file(path.join(root, 'package.json')).json();
  const directory = path.join(root, 'release-assets');
  const expected = [
    `Prism-${version}-linux-x86_64.flatpak`,
    `Prism-${version}-windows-x64.zip`,
    `Prism-${version}-linux-x86_64-build-info.json`,
    `Prism-${version}-windows-x64-build-info.json`,
  ].sort();
  const actual = (await fs.readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      'Release assets must contain exactly the two distributions and their build information.',
    );
  }
  const checksums: string[] = [];
  for (const name of expected) {
    const file = path.join(directory, name);
    if (name.endsWith('-build-info.json')) {
      const info = await Bun.file(file).json();
      if (
        info.version !== version ||
        info.commit !== process.env.GITHUB_SHA ||
        info.repository !== process.env.GITHUB_REPOSITORY
      ) {
        throw new Error(`Release provenance mismatch: ${name}`);
      }
    }
    if ((await fs.stat(file)).size === 0) {
      throw new Error(`Empty release asset: ${name}`);
    }
    const hash = new Bun.CryptoHasher('sha256');
    for await (const chunk of createReadStream(file)) {
      hash.update(chunk);
    }
    checksums.push(`${hash.digest('hex')}  ${name}`);
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
  const lines = (await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8')).split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## ${version} - `));
  if (start < 0) {
    throw new Error('Current release notes are missing.');
  }
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  await fs.writeFile(
    path.join(root, 'release-notes.md'),
    `${lines
      .slice(start + 1, next < 0 ? undefined : next)
      .join('\n')
      .trim()}\n`,
  );
  console.log(`Verified ${version}: Linux, Windows, provenance, and SHA-256 checksums.`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
