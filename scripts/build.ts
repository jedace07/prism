// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

/** Emit the two runtime targets separately; Electron cannot execute TypeScript. */
export async function build(): Promise<string> {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, '.build', 'app');
  await fs.rm(output, { recursive: true, force: true });
  for (const project of ['tsconfig.app.json', 'tsconfig.renderer.json']) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--project', project],
        { cwd: root, stdio: 'inherit' },
      );
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`TypeScript compilation failed (${project}, ${code}).`)),
      );
    });
  }
  for (const name of ['index.html', 'style.css']) {
    await fs.copyFile(
      path.join(root, 'src', 'renderer', name),
      path.join(output, 'src', 'renderer', name),
    );
  }
  for (const name of ['LICENSE', 'NOTICE']) {
    await fs.copyFile(path.join(root, name), path.join(output, name));
  }
  const source = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const { name, version, description, license, desktopName } = source;
  await fs.writeFile(
    path.join(output, 'package.json'),
    `${JSON.stringify({ name, version, description, license, desktopName, main: 'src/main.js' }, null, 2)}\n`,
  );
  return output;
}
if (require.main === module) {
  build().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
