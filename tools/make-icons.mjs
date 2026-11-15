#!/usr/bin/env node
/**
 * Generates the PWA icons as PNG (no dependencies): a white floor-plan glyph on blue.
 * Usage: node tools/make-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x / size, y / size), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Icon artwork in unit coordinates; `inset` shrinks the glyph for maskable safe zone. */
function art(inset) {
  const BG = [31, 42, 54, 255], FG = [255, 255, 255, 255], ACC = [255, 214, 0, 255];
  const g = (v) => (v - 0.5) / (1 - 2 * inset) + 0.5; // map into glyph space
  const t = 0.045;
  return (u, v) => {
    const x = g(u), y = g(v);
    const inBox = (x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    const outer = inBox(0.2, 0.2, 0.8, 0.8) && !inBox(0.2 + t, 0.2 + t, 0.8 - t, 0.8 - t);
    const wall = inBox(0.5 - t / 2, 0.2, 0.5 + t / 2, 0.62);
    const door = inBox(0.2, 0.42, 0.2 + t, 0.56);
    const demo = inBox(0.5 + t / 2 + 0.02, 0.62, 0.8 - t - 0.02, 0.8 - t - 0.02);
    if (demo) return ACC;
    if ((outer && !door) || wall) return FG;
    return BG;
  };
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
const out = (name, size, inset) => writeFileSync(new URL(`../icons/${name}`, import.meta.url), png(size, art(inset)));
out('icon-192.png', 192, 0);
out('icon-512.png', 512, 0);
out('icon-512-maskable.png', 512, 0.12);
out('apple-touch-icon-180.png', 180, 0.04);
console.log('icons written');
