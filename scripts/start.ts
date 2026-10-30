// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import { build } from './build.js';
async function start(): Promise<void> {
  const directory = await build();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.PRISM_DECODER_RUNTIME = process.execPath;
  const child = spawn(require('electron'), [directory, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env,
  });
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('close', (code) => {
    process.exitCode = code ?? 1;
  });
}
start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
