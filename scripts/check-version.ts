// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const { version } = await Bun.file(path.join(root, 'package.json')).json();
  if (
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) ||
    !Bun.semver.satisfies(version, version)
  ) {
    throw new Error('package.json must contain a complete semantic version.');
  }
  const metadata = await fs.readFile(
    path.join(root, 'flatpak/desktop/io.github.prismviewer.Prism.metainfo.xml'),
    'utf8',
  );
  if (metadata.match(/<release\b[^>]*\bversion="([^"]+)"/)?.[1] !== version) {
    throw new Error('The newest AppStream release must match package.json.');
  }
  const changelog = await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  if (!changelog.split('\n').some((line) => line.startsWith(`## ${version} - `))) {
    throw new Error('Add the current version to CHANGELOG.md.');
  }
  const tag = `v${version}`;
  if (process.env.GITHUB_REF?.startsWith('refs/tags/') && process.env.GITHUB_REF_NAME !== tag) {
    throw new Error(`Release tag must be ${tag}, not ${process.env.GITHUB_REF_NAME}.`);
  }
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
  }
  console.log(`Prism ${version}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
