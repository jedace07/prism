// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const { version } = await Bun.file(path.join(root, 'package.json')).json();
  if (process.arch !== 'x64' || !['linux', 'win32'].includes(process.platform)) {
    throw new Error('Distribution currently supports Linux and Windows x64.');
  }
  const smoke = await Bun.file(path.join(root, 'artifacts/smoke-packaged.json')).json();
  if (smoke.passed !== true || smoke.gpu.prismVersion !== version) {
    throw new Error('The packaged app must pass smoke tests with the current version.');
  }
  const platform = process.platform === 'win32' ? 'windows-x64' : 'linux-x86_64';
  const source = process.platform === 'win32' ? 'Prism-windows-x64.zip' : 'Prism-x86_64.flatpak';
  const extension = process.platform === 'win32' ? 'zip' : 'flatpak';
  const output = path.join(root, 'release-assets');
  await fs.mkdir(output, { recursive: true });
  await fs.copyFile(
    path.join(root, source),
    path.join(output, `Prism-${version}-${platform}.${extension}`),
  );
  const info = {
    version,
    commit: process.env.GITHUB_SHA,
    repository: process.env.GITHUB_REPOSITORY,
    run: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    bun: process.versions.bun,
    electron: require('electron/package.json').version,
    platform,
    architecture: process.arch,
    runtime: process.platform === 'linux' ? '26.08' : undefined,
    runnerImage: process.env.ImageOS,
    runnerImageVersion: process.env.ImageVersion,
  };
  await fs.writeFile(
    path.join(output, `Prism-${version}-${platform}-build-info.json`),
    `${JSON.stringify(info, null, 2)}\n`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
