const { app, BrowserWindow, dialog, Menu, net, protocol, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { GAME_ORIGIN, CONTENT_SECURITY_POLICY, resolveAssetPath } = require('./assets.cjs');

// Stable across installer upgrades; independent of browser saves and install path.
app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir') ||
  path.join(app.getPath('appData'), 'Silicon Valley Smackdown'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'smackdown', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let window;
async function createWindow() {
  window = new BrowserWindow({
    title: 'Silicon Valley Smackdown',
    width: 1280,
    height: 760,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: '#0a0a12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F11') {
      event.preventDefault();
      if (input.type === 'keyDown' && !input.isAutoRepeat) window.setFullScreen(!window.isFullScreen());
    }
  });
  window.on('closed', () => { window = null; });
  // SVS_E2E lets the desktop smoke test enable the same test-only hook the web e2e suite uses
  // (see src/game.ts), without ever re-navigating this window after the initial load.
  const query = process.env.SVS_E2E === '1' ? '?e2e=1' : '';
  await window.loadURL(`${GAME_ORIGIN}/${query}`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }));
    protocol.handle('smackdown', async (request) => {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
      let file;
      try {
        file = resolveAssetPath(request.url, path.join(app.getAppPath(), 'dist'));
      } catch {
        return new Response(null, { status: 403 });
      }
      try {
        const response = await net.fetch(pathToFileURL(file).toString());
        const headers = new Headers(response.headers);
        headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
        headers.set('X-Content-Type-Options', 'nosniff');
        return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    await createWindow();
  }).catch((error) => {
    dialog.showErrorBox('Unable to start Silicon Valley Smackdown', error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
}
