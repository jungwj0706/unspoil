import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const common = { bundle: true, target: 'chrome120' };

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, 'src/background.ts')],
  format: 'esm',
  outfile: path.join(dist, 'background.js'),
});
await esbuild.build({
  ...common,
  entryPoints: [path.join(root, 'src/content.ts')],
  format: 'iife',
  outfile: path.join(dist, 'content.js'),
});
await esbuild.build({
  ...common,
  entryPoints: [path.join(root, 'src/popup.ts')],
  format: 'iife',
  outfile: path.join(dist, 'popup.js'),
});

for (const file of ['manifest.json', 'isolate.css', 'popup.html', 'popup.css']) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}
for (const size of [16, 48, 128]) fs.writeFileSync(path.join(dist, `icon${size}.png`), png(size));

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const shield = nx * nx / 0.55 + (ny + 0.08) * (ny + 0.08) / 0.72 < 1 && ny < 0.78;
      const eye = nx * nx + (ny + 0.08) * (ny + 0.08) < 0.035;
      const index = row + 1 + x * 4;
      const on = shield && !eye;
      raw[index] = on ? 109 : 255;
      raw[index + 1] = on ? 74 : 255;
      raw[index + 2] = on ? 255 : 255;
      raw[index + 3] = shield ? 255 : 0;
    }
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
