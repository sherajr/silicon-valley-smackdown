// Minimal PNG decoder and image metrics for the Arena evidence scripts. It reads the 8-bit RGB / RGBA, non-interlaced
// PNGs that Chromium screenshots produce, so the scripts need no image dependency. It is not a general PNG library.
import { inflateSync } from 'node:zlib';

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG');
  let offset = 8, width = 0, height = 0, colorType = 0, depth = 0, interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8), data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error(`Unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${interlace})`);
  const channels = colorType === 6 ? 4 : 3, stride = width * channels, raw = inflateSync(Buffer.concat(idat)), out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride), line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = line[x * channels]; out[o + 1] = line[x * channels + 1]; out[o + 2] = line[x * channels + 2]; out[o + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    [prev, line] = [line, prev];
  }
  return { width, height, data: out };
}

const luma = (d, o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];

/**
 * Surface stability metrics over a whole image (a crop of a flat surface).
 * - speckle: mean absolute difference between each pixel and the average of its four neighbours (0-255 luma).
 *   Smooth shading and soft seams score low; z-fighting, which interleaves two contrasting surfaces, scores high.
 * - outliers: share of pixels that differ from the 3x3 median-ish neighbourhood mean by more than 24 luma levels.
 */
export function speckle(img) {
  const { width: w, height: h, data: d } = img;
  let sum = 0, outliers = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const o = (y * w + x) * 4, c = luma(d, o);
    const avg = (luma(d, o - 4) + luma(d, o + 4) + luma(d, o - w * 4) + luma(d, o + w * 4)) / 4, diff = Math.abs(c - avg);
    sum += diff; if (diff > 24) outliers++; n++;
  }
  return { speckle: n ? sum / n : 0, outliers: n ? outliers / n : 0 };
}

/** Mean absolute luma difference between two same-size images: how much the surface changed between two frames. */
export function frameDifference(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error('Size mismatch');
  let sum = 0; const n = a.width * a.height;
  for (let i = 0; i < n; i++) sum += Math.abs(luma(a.data, i * 4) - luma(b.data, i * 4));
  return sum / n;
}

/** Crop a decoded image. */
export function crop(img, x, y, w, h) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y)); w = Math.min(img.width - x, Math.round(w)); h = Math.min(img.height - y, Math.round(h));
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return { width: w, height: h, data: out };
}
