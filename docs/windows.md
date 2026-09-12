# Windows packaging and releases

## Build locally

On Windows, install Node.js 22.12 or newer, then run from a checkout:

```powershell
npm ci
npm test
npm run test:desktop:unit
npm run dist:win
```

The output is `release/Silicon-Valley-Smackdown-1.0.0-Windows-x64-Setup.exe`, with the version taken from `package.json`. This is a complete offline NSIS installer, not a downloader. It installs for the current user without requesting administrator access and creates desktop and Start menu shortcuts. Build downloads require internet access; installed play does not.

Use `npm run desktop` to launch an unpackaged desktop build. `npm run build:desktop` always builds with a relative asset base, even if `VITE_BASE` is set for website deployment. The normal web build continues to honor `VITE_BASE`.

## Automated builds

`.github/workflows/windows.yml` runs on pull requests, pushes to `main`, version tags, and manual dispatch. Fork pull requests use `pull_request` with read-only permissions; they do not receive signing or publishing credentials. GitHub may require a maintainer to approve a first-time contributor's workflow run.

The Windows runner installs locked dependencies, runs unit tests, builds the installer, silently installs into a path containing spaces, and uses Playwright's Electron support to test the **installed executable**. The smoke test verifies the game scene boots, all fighter/stage/FX textures load, menus work, a fight advances, F11 toggles fullscreen, Node APIs are absent from the renderer, and settings survive an application restart. It then checks silent uninstall and uploads the installer plus `SHA256SUMS.txt`.

To run the same smoke test yourself against an installed copy:

```powershell
$env:SVS_DESKTOP_EXE = 'C:\path\to\Silicon Valley Smackdown.exe'
npm run test:desktop
```

The test uses a temporary profile; it does not alter your actual saves. Without `SVS_DESKTOP_EXE`, it tests the built `dist/` in the development Electron runtime. Desktop tests require a graphical session.

## Publish a download

1. Merge the installer pull request after its Windows job passes.
2. Update `package.json` and `package-lock.json` together for subsequent releases (`npm version patch --no-git-tag-version`), then commit the version change.
3. Tag that commit with its version, for example `v1.0.0`, and push the tag.
4. The tag triggers both this workflow and the [macOS one](macos.md); each uploads its own assets onto the same **draft** GitHub Release (whichever finishes first creates it). Review the draft, test on a real Windows PC and a real Mac, and publish it when ready.

Players download only the `*-Setup.exe` release asset. They do not need the source ZIP, development tools, or the unpacked build directory. Updates are installed manually by running the next installer; no auto-updater or network service is included.

## Packaging choices

- Electron supplies the runtime, so no separately installed browser or WebView2 is required.
- Only `dist/`, desktop main-process code, and package metadata enter the application archive. Vite has already bundled Phaser; development tooling is excluded.
- `smackdown://game/` serves bundled assets through a constrained local protocol. It provides a stable origin for localStorage without opening a localhost server or changing the web game code.
- The renderer has no Node.js integration or preload bridge. Sandbox, context isolation, and web security remain enabled. A content security policy and network request blocking keep the desktop renderer offline; new windows and page navigation are denied. The existing local music picker continues to use browser File/Blob APIs.
- The app ID, product name, and save directory are stable identifiers. Keep them unchanged in later releases to preserve upgrade and save behavior.
- `desktop/resources/icon.ico` is a multi-size conversion of the existing `public/favicon.svg`, rather than new game art.

## Release checks and limitations

Before publishing, test ordinary interactive installation, launch from both shortcuts, keyboard play, sound, choosing a local music file, alt-tab pause, fullscreen, upgrade over a prior version, and uninstall on an actual Windows PC. CI does not establish GPU/audio quality or upgrade compatibility with an already published installer.

No signing certificate is included or invented. Builds are unsigned until the maintainer configures Windows code signing using electron-builder's supported signing setup. Unsigned downloads may trigger SmartScreen and show an unknown publisher. Keep signing credentials out of source control and fork pull request jobs. Electron increases the download and install size compared with the web build.
