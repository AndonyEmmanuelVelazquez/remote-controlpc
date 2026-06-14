// Generate build/icon.ico (256x256, PNG-compressed ICO) for the packaged app,
// matching the controller's mark. Zero dependencies.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---- minimal PNG encoder (defined first; used below) ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---- draw the icon ----
const BG = [14, 17, 22];
const GREEN = [63, 185, 80];
const SIZE = 256;

const buf = Buffer.alloc(SIZE * SIZE * 4);
const px = (x, y, c) => {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
};
const rect = (x0, y0, x1, y1, c) => {
  for (let y = Math.round(y0); y < Math.round(y1); y++)
    for (let x = Math.round(x0); x < Math.round(x1); x++) px(x, y, c);
};
const circle = (cx, cy, r, c) => {
  for (let y = Math.round(cy - r); y <= cy + r; y++)
    for (let x = Math.round(cx - r); x <= cx + r; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) px(x, y, c);
};
const s = (f) => f * SIZE;
rect(0, 0, SIZE, SIZE, BG);
rect(s(0.16), s(0.2), s(0.84), s(0.62), GREEN);
rect(s(0.205), s(0.245), s(0.795), s(0.575), BG);
circle(s(0.5), s(0.41), s(0.075), GREEN);
rect(s(0.46), s(0.62), s(0.54), s(0.69), GREEN);
rect(s(0.3), s(0.69), s(0.7), s(0.725), GREEN);

const png = encodePNG(SIZE, SIZE, buf);

// ---- wrap the PNG in an ICO container ----
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "build");
mkdirSync(outDir, { recursive: true });

const ico = Buffer.alloc(6 + 16);
ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // image count
ico.writeUInt8(0, 6); // width 0 => 256
ico.writeUInt8(0, 7); // height 0 => 256
ico.writeUInt8(0, 8); // palette
ico.writeUInt8(0, 9); // reserved
ico.writeUInt16LE(1, 10); // color planes
ico.writeUInt16LE(32, 12); // bits per pixel
ico.writeUInt32LE(png.length, 14); // size of PNG
ico.writeUInt32LE(6 + 16, 18); // offset to PNG
writeFileSync(join(outDir, "icon.ico"), Buffer.concat([ico, png]));
console.log("wrote build/icon.ico");
