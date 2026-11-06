const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function generateIcons() {
  const root = path.resolve(__dirname, '..');
  const iconDir = path.join(root, 'src-tauri', 'icons');
  const source = path.join(root, 'assets', 'app-icon.png');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  fs.mkdirSync(iconDir, { recursive: true });
  const images = await Promise.all(sizes.map(size => sharp(source)
    .resize(size, size, { fit: 'contain', background: '#00000000' }).ensureAlpha().png().toBuffer()));
  fs.writeFileSync(path.join(iconDir, 'icon.png'), images[images.length - 1]);
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((png, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] === 256 ? 0 : sizes[index];
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(iconDir, 'icon.ico'), Buffer.concat([header, ...images]));
}

module.exports = generateIcons;
if (require.main === module) generateIcons().catch(error => { console.error(error); process.exitCode = 1; });
