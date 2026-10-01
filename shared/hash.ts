/** Stable text and a 64-bit FNV-1a hash. Same logical value, same text, on every supported engine. */

function normNumber(n: number): string {
  if (!Number.isFinite(n)) return 'null';
  if (Object.is(n, -0)) return '0';
  return JSON.stringify(n);
}

/** Canonical text for plain JSON-like data. Object keys are sorted. Functions and undefined are omitted. */
export function canon(value: unknown): string {
  if (typeof value === 'number') return normNumber(value);
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(item => canon(item)).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter(key => obj[key] !== undefined && typeof obj[key] !== 'function').sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canon(obj[key])}`).join(',')}}`;
  }
  return 'null';
}

/** 16 hex characters. Not a cryptographic hash; it detects divergent gameplay state. */
export function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export function hashData(value: unknown): string {
  return fnv1a64(canon(value));
}
