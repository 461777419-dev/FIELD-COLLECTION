const sharp = require('sharp');
const TgaLoader = require('tga-js');
const bmp = require('bmp-js');
const { readPsd, initializeCanvas } = require('ag-psd');
initializeCanvas(() => { throw new Error('PSD canvas unavailable'); }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));

const ordinary = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tif', '.tiff']);
const decoded = new Set(['.tga', '.bmp']);
const professional = new Set(['.psd', '.psb', '.clip', '.ai', '.eps', '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2']);
const video = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogv', '.mkv', '.avi']);
const supported = new Set([...ordinary, ...decoded, ...professional, ...video]);

function rasterInputFor(buffer, ext) {
  if (!decoded.has(ext)) return { input: buffer };
  let width, height, pixels;
  if (ext === '.tga') {
    if (buffer.length < 18) throw new Error('TGA 文件头不完整');
    width = buffer.readUInt16LE(12); height = buffer.readUInt16LE(14);
    if (!width || !height || width * height > 80_000_000) throw new Error('图片尺寸无效或过大');
    const tga = new TgaLoader();
    tga.load(new Uint8Array(buffer));
    pixels = Buffer.from(tga.getImageData({ width, height, data: new Uint8ClampedArray(width * height * 4) }).data);
  } else {
    if (buffer.length < 26) throw new Error('BMP 文件头不完整');
    width = Math.abs(buffer.readInt32LE(18)); height = Math.abs(buffer.readInt32LE(22));
    if (!width || !height || width * height > 80_000_000) throw new Error('图片尺寸无效或过大');
    const image = bmp.decode(buffer);
    width = image.width; height = image.height;
    pixels = Buffer.from(image.data);
    const hasAlpha = image.bitPP === 32 && pixels.some((value, index) => index % 4 === 0 && value !== 0);
    for (let i = 0; i < pixels.length; i += 4) {
      const alpha = pixels[i], blue = pixels[i + 1];
      pixels[i] = pixels[i + 3]; pixels[i + 1] = pixels[i + 2];
      pixels[i + 2] = blue; pixels[i + 3] = hasAlpha ? alpha : 255;
    }
  }
  return { input: pixels, options: { raw: { width, height, channels: 4 } } };
}

async function encodeRasterFor(input, options, format) {
  const { data, info } = await sharp(input, { ...options, animated: false })
    .rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (format === 'tga') {
    if (width > 65535 || height > 65535) throw new Error('TGA 图片尺寸不能超过 65535 像素');
    const output = Buffer.alloc(18 + data.length);
    output[2] = 2;
    output.writeUInt16LE(width, 12);
    output.writeUInt16LE(height, 14);
    output[16] = 32;
    output[17] = 0x28;
    for (let i = 0; i < data.length; i += 4) {
      output[18 + i] = data[i + 2];
      output[19 + i] = data[i + 1];
      output[20 + i] = data[i];
      output[21 + i] = data[i + 3];
    }
    return output;
  }
  const flattened = await sharp(data, { raw: { width, height, channels: 4 } })
    .flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer();
  const abgr = Buffer.alloc(width * height * 4);
  for (let i = 0; i < flattened.length; i += 3) {
    const target = i / 3 * 4;
    abgr[target] = 255;
    abgr[target + 1] = flattened[i + 2];
    abgr[target + 2] = flattened[i + 1];
    abgr[target + 3] = flattened[i];
  }
  return bmp.encode({ data: abgr, width, height }).data;
}

function embeddedPreview(buffer) {
  const candidates = [];
  for (let i = 0; i < buffer.length - 8; i++) {
    const jpeg = buffer[i] === 0xff && buffer[i + 1] === 0xd8 && buffer[i + 2] === 0xff;
    const png = buffer[i] === 0x89 && buffer.subarray(i + 1, i + 8).equals(Buffer.from('PNG\r\n\x1a\n'));
    if (!jpeg && !png) continue;
    const end = jpeg ? buffer.indexOf(Buffer.from([0xff, 0xd9]), i + 3) : buffer.indexOf(Buffer.from('IEND'), i + 8);
    if (end < 0) continue;
    const length = end + (jpeg ? 2 : 8) - i;
    if (length > 8192) candidates.push(buffer.subarray(i, i + length));
    i += length - 1;
  }
  return candidates.sort((a, b) => b.length - a.length).slice(0, 8);
}

async function previewFor(buffer, ext, { fullResolution = false } = {}) {
  if (video.has(ext)) return { width: 0, height: 0, preview: null, animated: false };
  let width = 0, height = 0, preview = null, animated = false;
  if (ordinary.has(ext) || decoded.has(ext)) {
    const raster = rasterInputFor(buffer, ext);
    const metadata = await sharp(raster.input, { ...raster.options, animated: false }).metadata();
    width = metadata.width || 0; height = metadata.height || 0;
    animated = (metadata.pages || 1) > 1;
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext) && !animated && width <= 1800 && height <= 1800 && (!metadata.orientation || metadata.orientation === 1)) {
      return { width, height, preview: null, animated, reuseOriginal: true };
    }
    let pipeline = sharp(raster.input, { ...raster.options, animated: false }).rotate();
    if (!fullResolution) pipeline = pipeline.resize(1800, 1800, { fit: 'inside', withoutEnlargement: true });
    preview = await pipeline.png().toBuffer();
  } else if (ext === '.psd' || ext === '.psb') {
    const psd = readPsd(buffer, { useImageData: true, skipLayerImageData: true, skipThumbnail: true });
    width = psd.width; height = psd.height;
    if (psd.imageData) {
      let pipeline = sharp(Buffer.from(psd.imageData.data), { raw: { width, height, channels: 4 } });
      if (!fullResolution) pipeline = pipeline.resize(1800, 1800, { fit: 'inside', withoutEnlargement: true });
      preview = await pipeline.png().toBuffer();
    }
  } else {
    if (ext === '.ai' && buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
      try {
        const canvas = require('@napi-rs/canvas');
        global.DOMMatrix ||= canvas.DOMMatrix;
        global.ImageData ||= canvas.ImageData;
        global.Path2D ||= canvas.Path2D;
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
        const page = await document.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1800 / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const surface = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: surface.getContext('2d'), viewport }).promise;
        width = Math.round(base.width); height = Math.round(base.height);
        preview = await sharp(surface.toBuffer('image/png')).png().toBuffer();
        await document.destroy();
      } catch {}
    }
    if (ext === '.eps' && buffer.subarray(0, 4).equals(Buffer.from([0xc5, 0xd0, 0xd3, 0xc6])) && buffer.length >= 30) {
      const offset = buffer.readUInt32LE(20), length = buffer.readUInt32LE(24);
      if (offset > 0 && length > 0 && offset + length <= buffer.length) {
        try { const raw = buffer.subarray(offset, offset + length); const metadata = await sharp(raw).metadata(); width = metadata.width; height = metadata.height; preview = await sharp(raw).resize(1800, 1800, { fit: 'inside' }).png().toBuffer(); } catch {}
      }
    }
    if (!preview) {
    for (const candidate of embeddedPreview(buffer)) {
      try {
        const metadata = await sharp(candidate).metadata();
        if ((metadata.width || 0) < 180 || (metadata.height || 0) < 180) continue;
        width = metadata.width; height = metadata.height;
        preview = await sharp(candidate).resize(1800, 1800, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
        break;
      } catch {}
    }
    }
  }
  return { width, height, preview, animated };
}

module.exports = { supported, previewFor, rasterInputFor, encodeRasterFor, ordinary, decoded };
