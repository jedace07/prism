// Runs only in the bundled Bun decoder, without external image libraries/tools.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { capabilities, decode } = require('./decoder.cjs');
const { png, readPNG, bmp, gif, orientJPEG } = require('./test-images.cjs');
async function verify() {
  const report=await capabilities();
  assert.equal(report.engine,'Bun.Image');
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'prism-package-')),checks=[];
  try {
    const input=png(48,32,[255,0,0,255]);let first;
    const samples=[['png',input,48,32],['jpeg',await new Bun.Image(input).jpeg({quality:95}).buffer(),48,32],['webp',await new Bun.Image(input).webp({lossless:true}).buffer(),48,32],['bmp',bmp(48,32),48,32],['gif',gif(),2,2],['oriented.jpeg',orientJPEG(await new Bun.Image(input).jpeg({quality:95}).buffer()),32,48]];
    for(const [name,bytes,width,height] of samples){
      console.error(`[verify] Bun.Image ${name}`);
      const file=path.join(temp,name);await fs.writeFile(file,bytes);
      const result=await decode(file),decoded=readPNG(result.bytes);
      assert.equal(decoded.width,width);assert.equal(decoded.height,height);
      assert.ok(decoded.bytes[0]>245&&decoded.bytes[1]<10&&decoded.bytes[2]<10,`Incorrect ${name} pixels`);
      first ||= result;
      checks.push(`${name}: dimensions and pixel colors`);
    }
    const alpha=path.join(temp,'alpha.png');await fs.writeFile(alpha,png(4,2,[240,20,40,128]));
    assert.deepEqual([...readPNG((await decode(alpha)).bytes).bytes.subarray(0,4)],[240,20,40,128]);checks.push('PNG alpha preservation');
    return {passed:true,checks,...report,runtime:process.versions.bun,bytes:first.bytes};
  } finally {await fs.rm(temp,{recursive:true,force:true});}
}
module.exports={verify};
