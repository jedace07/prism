// SPDX-License-Identifier: Apache-2.0
import { build } from './build.js';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-smoke-profile-'));
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  const hardware = process.env.PRISM_SMOKE_HARDWARE === '1';
  const binary = process.env.PRISM_SMOKE_EXECUTABLE;
  const report = path.join(root, 'artifacts', binary ? 'smoke-packaged.json' : hardware ? 'smoke-hardware.json' : 'smoke.json');
  const args = [...(binary ? [] : [await build()]), '--smoke', report, `--user-data-dir=${profile}`];
  if (!hardware) {
    args.push('--allow-software-rendering', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader');
    // Linux must share one Vulkan backend between the canvas compositor and Dawn.
    if (process.platform === 'linux') args.push('--enable-features=Vulkan', '--use-angle=vulkan', '--use-vulkan=swiftshader', '--disable-vulkan-surface');
    else args.push('--use-angle=swiftshader');
  }
  // Only the disposable root CI test bypasses Chromium's root-user check.
  if (process.env.CI === 'true' && process.getuid?.() === 0) args.push('--no-sandbox');
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_ENABLE_LOGGING: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  if (!binary) env.PRISM_DECODER_RUNTIME = process.execPath;
  const child = spawn(binary || require('electron'), args, { stdio: 'inherit', env });
  const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 120000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('close', async code => {
    clearTimeout(timeout); process.exitCode = code ?? 1;
    try { const result = JSON.parse(await fs.readFile(report, 'utf8')); console.log(JSON.stringify(result, null, 2)); } catch { /* startup failure already logged */ }
    await fs.rm(profile, { recursive: true, force: true });
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
