function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(Math.round(v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Positive amt lightens, negative darkens, by a fraction of the remaining range. */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (amt >= 0) {
    return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  }
  const f = 1 + amt;
  return rgbToHex(r * f, g * f, b * f);
}

export function darken(hex: string, amt: number): string {
  return shade(hex, -Math.abs(amt));
}

export function lighten(hex: string, amt: number): string {
  return shade(hex, Math.abs(amt));
}
