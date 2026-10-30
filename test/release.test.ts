// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const version = '0.1.0-alpha.1';
const commit = 'a'.repeat(40);
async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-release-test-'));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.mkdir(path.join(root, 'release-assets'));
  await fs.mkdir(path.join(root, 'flatpak/desktop'), { recursive: true });
  for (const script of ['check-version.ts', 'verify-release.ts']) {
    await fs.copyFile(
      path.join(__dirname, '..', 'scripts', script),
      path.join(root, 'scripts', script),
    );
  }
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version }));
  await fs.writeFile(
    path.join(root, 'flatpak/desktop/io.github.prismviewer.Prism.metainfo.xml'),
    `<releases><release version="${version}"/></releases>`,
  );
  await fs.writeFile(
    path.join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## ${version} - 2026-10-30\n\nCurrent notes.\n\n## 0.0.1 - 2026-01-01\n\nOld notes.\n`,
  );
  for (const [platform, extension] of [
    ['linux-x86_64', 'flatpak'],
    ['windows-x64', 'exe'],
  ]) {
    await fs.writeFile(
      path.join(
        root,
        'release-assets',
        `Prism-${version}-${platform}${extension === 'exe' ? '-setup' : ''}.${extension}`,
      ),
      `fixture ${platform}`,
    );
    await fs.writeFile(
      path.join(root, 'release-assets', `Prism-${version}-${platform}-build-info.json`),
      JSON.stringify({ version, commit, repository: 'test/prism' }),
    );
  }
  return root;
}
function run(root: string, script: string, tag = `v${version}`) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_SHA: commit,
    GITHUB_REPOSITORY: 'test/prism',
    GITHUB_REF: `refs/tags/${tag}`,
    GITHUB_REF_NAME: tag,
  };
  delete env.GITHUB_OUTPUT;
  return Bun.spawnSync([process.execPath, path.join(root, 'scripts', script)], {
    cwd: root,
    env,
    timeout: 10000,
  });
}
test('release validation hashes both distributions and extracts only current release notes', async () => {
  const root = await fixture();
  try {
    assert.equal(run(root, 'check-version.ts').exitCode, 0);
    const result = run(root, 'verify-release.ts');
    assert.equal(result.exitCode, 0, result.stderr.toString());
    const lines = (await fs.readFile(path.join(root, 'release-assets/SHA256SUMS'), 'utf8'))
      .trim()
      .split('\n');
    assert.equal(lines.length, 4);
    for (const line of lines) {
      const [digest, name] = line.split('  ');
      assert.equal(
        digest,
        createHash('sha256')
          .update(await fs.readFile(path.join(root, 'release-assets', name)))
          .digest('hex'),
      );
    }
    assert.equal(
      await fs.readFile(path.join(root, 'release-notes.md'), 'utf8'),
      'Current notes.\n',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('release validation blocks mismatched tags, commits and incomplete asset sets', async () => {
  const root = await fixture();
  try {
    assert.notEqual(run(root, 'check-version.ts', 'v9.9.9').exitCode, 0);
    const info = path.join(root, 'release-assets', `Prism-${version}-linux-x86_64-build-info.json`);
    await fs.writeFile(
      info,
      JSON.stringify({ version, commit: 'wrong', repository: 'test/prism' }),
    );
    assert.notEqual(run(root, 'verify-release.ts').exitCode, 0);
    await assert.rejects(fs.access(path.join(root, 'release-assets/SHA256SUMS')));
    await fs.unlink(path.join(root, 'release-assets', `Prism-${version}-windows-x64-setup.exe`));
    assert.notEqual(run(root, 'verify-release.ts').exitCode, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
