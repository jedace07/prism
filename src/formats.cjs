const EXTENSIONS = (`jpg jpeg jpe jfif jps mpo png apng webp gif avif heic heif hif avci avcs jxl
  tif tiff tiff64 ptif bmp dib rle ico cur icn svg svgz psd psb xcf ora kra
  exr hdr pic rgbe pfm phm dpx cin jp2 j2k j2c jpc jpf jpx jpm jpt jng mng
  tga targa vda icb vst pcx dcx pcd pcds pct pict wmf wmz emf
  ppm pgm pbm pnm pam p7 qoi farbfeld ff fits fit fts dcm dicom
  dng cr2 cr3 crw nef nrw arw sr2 srf raf orf rw2 rwl pef ptx
  raw 3fr fff erf iiq k25 kdc dcr mos mrw mef x3f srw cap eip bay
  pdf ai eps epsf epsi ps xps djvu djv
  avs aai art ase aseprite cut dds ftxt hrz ipl jbig jbg bie mat miff
  mtv otb palm pdb pes pix ras sun sct sgi rgb rgba bw int inta
  sf3 six sixel tim tm2 vicar viff xv wbmp wpg xbm xpm xwd uhdr`).split(/\s+/).filter(Boolean);
const EXTENSION_SET = new Set(EXTENSIONS);
const path = require('node:path');
function isImage(file) { return EXTENSION_SET.has(path.extname(file).slice(1).toLowerCase()); }
function parseMagickFormats(output) {
  return output.split('\n').flatMap(line => {
    const match = line.match(/^\s*([A-Z0-9][A-Z0-9-]*)\*?\s+\S+\s+([r-][w-][+-]?)\s+(.+)$/);
    return match && match[2][0] === 'r' ? [{ name: match[1], description: match[3].trim() }] : [];
  }).filter(({ name }) => !['MSL', 'MVG', 'URL', 'HTTP', 'HTTPS', 'FTP', 'FILE', 'INLINE', 'DATA', 'TEXT', 'LABEL', 'CAPTION', 'PANGO', 'X', 'SCREENSHOT'].includes(name));
}
module.exports = { EXTENSIONS, isImage, parseMagickFormats };
