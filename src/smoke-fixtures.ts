// SPDX-License-Identifier: Apache-2.0
// Deterministic fixtures created using Bun built-ins only.
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {png,gif} from './test-images.js';
async function main(){
  const directory=process.argv[2]; if (!directory) throw new Error('Fixture output directory is required.');
  const bytes=png(640,400,(x,y)=>y<200?(x<320?[255,0,0,255]:[0,255,0,255]):(x<320?[0,0,255,255]:[255,255,255,255]));
  const image=path.join(directory,'01-quadrants.png');await fs.writeFile(image,bytes);
  await new Bun.Image(bytes).webp({lossless:true}).write(path.join(directory,'02-photo.webp'));
  await fs.writeFile(path.join(directory,'03-alpha.png'),png(32,16,[240,20,40,128]));
  await fs.writeFile(path.join(directory,'04-animation.gif'),gif());
  await fs.writeFile(path.join(directory,'05-sampling.png'),png(2,2,x=>x?[0,255,0,255]:[255,0,0,255]));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
