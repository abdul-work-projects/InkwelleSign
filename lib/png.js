import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes an RGBA byte array (width * height * 4) as a PNG buffer. */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draws a plausible handwritten stroke — used to seed demo signatures. */
export function drawSignaturePng({ width = 460, height = 150, seed = 1, strokes = 2 } = {}) {
  const rgba = new Uint8Array(width * height * 4);
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  const plot = (x, y, alpha) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
    const i = (yi * width + xi) * 4;
    const a = Math.min(255, rgba[i + 3] + alpha);
    rgba[i] = 18; rgba[i + 1] = 32; rgba[i + 2] = 58; rgba[i + 3] = a;
  };

  for (let stroke = 0; stroke < strokes; stroke++) {
    const baseline = height * (0.62 + stroke * 0.06);
    const amp = height * (0.24 - stroke * 0.05);
    const freq = 2.4 + rand() * 1.8 + stroke;
    const x0 = width * (0.06 + stroke * 0.24);
    const x1 = width * (stroke === 0 ? 0.92 : 0.62);
    const phase = rand() * Math.PI * 2;
    for (let x = x0; x < x1; x += 0.35) {
      const t = (x - x0) / (x1 - x0);
      const y = baseline
        - Math.sin(t * Math.PI * freq + phase) * amp * (0.45 + 0.55 * Math.sin(t * Math.PI))
        - t * height * 0.08;
      const w = 1.6 + Math.sin(t * Math.PI) * 1.5;
      for (let dy = -w; dy <= w; dy += 0.5) {
        plot(x, y + dy, Math.round(235 * Math.max(0, 1 - Math.abs(dy) / (w + 0.4))));
      }
    }
  }
  return encodePng(width, height, rgba);
}
