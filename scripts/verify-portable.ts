// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Start the packaged Electron and verify its bundled Bun, never the host runtime. */
async function main(): Promise<void> {
  const argument = process.argv[2];
  if (!argument) {
    throw new Error('Provide the path to the packaged Prism executable.');
  }
  const executable = path.resolve(argument);
  const script = path.join(
    path.dirname(executable),
    'resources',
    'app',
    'test',
    'support',
    'verify-package.js',
  );
  await fs.access(executable);
  await fs.access(script);
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.PRISM_DECODER_RUNTIME;
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, [script], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let text = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Packaged decoder verification timed out.'));
    }, 60000);
    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve(text)
        : reject(new Error(`Packaged decoder verification exited with ${code}.`));
    });
  });
  const report = JSON.parse(output);
  if (report.passed !== true || report.engine !== 'Bun.Image') {
    throw new Error('Packaged decoder verification did not pass.');
  }
  const directory = path.resolve(__dirname, '..', 'artifacts');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'portable-capabilities.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
