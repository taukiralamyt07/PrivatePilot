import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CRC32 table calculation
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crcVal = crc32(typeAndData);
  chunk.writeUInt32BE(crcVal, 8 + len);
  return chunk;
}

function createPng(size) {
  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth: 8
  ihdr.writeUInt8(6, 9); // color type: 6 (RGBA)
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Raw Scanlines: (1 byte filter (0) + width * 4 bytes RGBA) per row
  const rowBytes = 1 + size * 4;
  const rawData = Buffer.alloc(rowBytes * size);

  const radius = size * 0.46;
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < size; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded container / shield background
      if (dist <= radius) {
        // Background gradient from dark indigo to deep slate
        const t = (y / size);
        let r = Math.round(15 * (1 - t) + 10 * t);
        let g = Math.round(23 * (1 - t) + 18 * t);
        let b = Math.round(42 * (1 - t) + 40 * t);
        let a = 255;

        // Anti-aliased outer ring / glow
        if (dist > radius - 2) {
          const edgeAlpha = Math.max(0, Math.min(1, radius - dist));
          // Cyan / indigo edge accent
          r = Math.round(56 * edgeAlpha);
          g = Math.round(189 * edgeAlpha);
          b = Math.round(248 * edgeAlpha);
          a = Math.round(edgeAlpha * 255);
        } else if (dist > radius - 4) {
          // Ring border
          r = 56;
          g = 189;
          b = 248;
        }

        // Sleek Pilot / Wing symbol in center
        // Normalized coordinates in [-1, 1]
        const nx = dx / (size * 0.35);
        const ny = dy / (size * 0.35);

        // Delta-wing / Paper glider shape:
        // Top vertex at (0, -0.65), bottom wings at (-0.75, 0.65), (0.75, 0.65), center notch at (0, 0.35)
        const inWing =
          ny >= -0.7 &&
          ny <= 0.7 &&
          Math.abs(nx) <= (ny + 0.7) * 0.65 &&
          !(Math.abs(nx) <= 0.25 && ny > 0.3 && (ny - 0.3) > Math.abs(nx) * 1.5);

        if (inWing && dist <= radius - 4) {
          // Wing colors: vibrant cyan to violet gradient
          const wingGrad = (nx + 1) / 2;
          r = Math.round(56 * (1 - wingGrad) + 129 * wingGrad);
          g = Math.round(189 * (1 - wingGrad) + 140 * wingGrad);
          b = Math.round(248 * (1 - wingGrad) + 248 * wingGrad);
        }

        rawData[pixelOffset] = r;
        rawData[pixelOffset + 1] = g;
        rawData[pixelOffset + 2] = b;
        rawData[pixelOffset + 3] = a;
      } else {
        // Transparent outside circle
        rawData[pixelOffset] = 0;
        rawData[pixelOffset + 1] = 0;
        rawData[pixelOffset + 2] = 0;
        rawData[pixelOffset + 3] = 0;
      }
    }
  }

  const deflated = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const outDir = path.resolve(__dirname, '../public/icons');
fs.mkdirSync(outDir, { recursive: true });

[16, 48, 128].forEach((size) => {
  const pngBuf = createPng(size);
  const filePath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, pngBuf);
  console.log(`Generated: ${filePath} (${size}x${size}, ${pngBuf.length} bytes)`);
});
