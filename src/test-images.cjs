// Small deterministic fixtures and PNG inspection for tests; no image packages.
const { deflateSync, inflateSync } = require('node:zlib');
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function png(width, height, pixels) {
  const chunk = (type, data) => {
    const name = Buffer.from(type), out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8);
    out.writeUInt32BE(Bun.hash.crc32(Buffer.concat([name, data])) >>> 0, data.length + 8);
    return out;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.set(typeof pixels === 'function' ? pixels(x, y) : pixels, y * (width * 4 + 1) + 1 + x * 4);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function readPNG(input) {
  const data = Buffer.from(input); if (!data.subarray(0, 8).equals(signature)) throw new Error('Expected PNG.');
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20), depth = data[24], color = data[25];
  const channels = {0:1,2:3,4:2,6:4}[color];
  if (depth !== 8 || !channels || data[28]) throw new Error('Fixture inspector expects non-interlaced 8-bit PNG.');
  const chunks = [];
  for (let pos = 8; pos < data.length;) { const size=data.readUInt32BE(pos),type=data.toString('ascii',pos+4,pos+8); if(type==='IDAT')chunks.push(data.subarray(pos+8,pos+8+size)); pos+=size+12; }
  const packed=inflateSync(Buffer.concat(chunks)), stride=width*channels, rows=Buffer.alloc(stride*height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<height;y++){const filter=packed[y*(stride+1)];for(let x=0;x<stride;x++){const a=x>=channels?rows[y*stride+x-channels]:0,b=y?rows[(y-1)*stride+x]:0,c=y&&x>=channels?rows[(y-1)*stride+x-channels]:0; const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter]; if(predictor===undefined)throw new Error('Invalid PNG filter.'); rows[y*stride+x]=(packed[y*(stride+1)+1+x]+predictor)&255;}}
  const rgba=Buffer.alloc(width*height*4);
  for(let i=0;i<width*height;i++){const p=i*channels; rgba.set(color===6?rows.subarray(p,p+4):color===2?[rows[p],rows[p+1],rows[p+2],255]:[rows[p],rows[p],rows[p],color===4?rows[p+1]:255],i*4);}
  return {width,height,bytes:rgba};
}
function bmp(width, height, color=[255,0,0,255]) {
  const stride=(width*3+3)&~3,out=Buffer.alloc(54+stride*height);out.write('BM');out.writeUInt32LE(out.length,2);out.writeUInt32LE(54,10);out.writeUInt32LE(40,14);out.writeInt32LE(width,18);out.writeInt32LE(height,22);out.writeUInt16LE(1,26);out.writeUInt16LE(24,28);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)out.set([color[2],color[1],color[0]],54+y*stride+x*3);
  return out;
}
function gif() {
  const header=Buffer.concat([Buffer.from('GIF89a'),Buffer.from([2,0,2,0,128,0,0,255,0,0,0,255,0]),Buffer.from([33,255,11]),Buffer.from('NETSCAPE2.0'),Buffer.from([3,1,0,0,0])]);
  const frame=pixel=>{const codes=[4,pixel,4,pixel,4,pixel,4,pixel,5],bytes=Buffer.alloc(4);let bit=0;for(const code of codes)for(let i=0;i<3;i++,bit++)bytes[bit>>3]|=((code>>i)&1)<<(bit&7);return Buffer.concat([Buffer.from([33,249,4,4,10,0,0,0,44,0,0,0,0,2,0,2,0,0,2,4]),bytes,Buffer.from([0])]);};
  return Buffer.concat([header,frame(0),frame(1),Buffer.from([59])]);
}
function orientJPEG(input, orientation=6) {
  const exif=Buffer.from([69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,orientation,0,0,0,0,0,0,0]);
  const length=Buffer.alloc(2);length.writeUInt16BE(exif.length+2);
  return Buffer.concat([Buffer.from(input).subarray(0,2),Buffer.from([255,225]),length,exif,Buffer.from(input).subarray(2)]);
}
module.exports={png,readPNG,bmp,gif,orientJPEG};
