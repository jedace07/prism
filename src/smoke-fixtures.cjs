// Deterministic fixtures created using Bun built-ins only.
const path=require('node:path');
const fs=require('node:fs/promises');
const {png,gif}=require('./test-images.cjs');
async function main(){
  const directory=process.argv[2];
  const bytes=png(640,400,(x,y)=>y<200?(x<320?[255,0,0,255]:[0,255,0,255]):(x<320?[0,0,255,255]:[255,255,255,255]));
  const image=path.join(directory,'01-quadrants.png');await fs.writeFile(image,bytes);
  await new Bun.Image(bytes).webp({lossless:true}).write(path.join(directory,'02-photo.webp'));
  await fs.writeFile(path.join(directory,'04-animation.gif'),gif());
}
main().catch(error=>{console.error(error);process.exitCode=1;});
