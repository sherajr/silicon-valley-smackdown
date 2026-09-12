const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveAssetPath } = require('../../desktop/assets.cjs');

const root = path.resolve('dist');
test('resolves entry point, spaces and sprite assets under the bundle', () => {
  assert.equal(resolveAssetPath('smackdown://game/?e2e=1', root), path.join(root, 'index.html'));
  assert.equal(resolveAssetPath('smackdown://game/sprites/fighters/hunter/idle.png', root), path.join(root, 'sprites/fighters/hunter/idle.png'));
  assert.equal(resolveAssetPath('smackdown://game/music/a%20song.mp3', root), path.join(root, 'music/a song.mp3'));
});
test('rejects other origins, encoded traversal and Windows path escapes', () => {
  for (const url of [
    'https://game/index.html', 'file:///etc/passwd', 'smackdown://other/index.html',
    'smackdown://user@game/index.html', 'smackdown://game:123/index.html',
    'smackdown://game/%2e%2e%2fsecret', 'smackdown://game/..%5csecret',
    'smackdown://game/C%3a/Windows/system.ini', 'smackdown://game/file%00',
  ]) assert.throws(() => resolveAssetPath(url, root), url);
});
