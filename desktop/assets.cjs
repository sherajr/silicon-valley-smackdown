const path = require('node:path');

const GAME_ORIGIN = 'smackdown://game';
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
].join('; ');

// Serve only bundled web assets, never arbitrary files on the player's machine.
function resolveAssetPath(rawUrl, root) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'smackdown:' || url.host !== 'game' || url.username || url.password) {
    throw new Error('Invalid game origin');
  }
  const pathname = decodeURIComponent(url.pathname);
  if (/[\\\u0000:]/.test(pathname) || pathname.split('/').includes('..')) {
    throw new Error('Invalid asset path');
  }
  const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Outside asset root');
  return target;
}

module.exports = { GAME_ORIGIN, CONTENT_SECURITY_POLICY, resolveAssetPath };
