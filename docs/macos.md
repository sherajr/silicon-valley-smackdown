# macOS packaging and releases

## Build locally

On a Mac, install Node.js 22.12 or newer, then run from a checkout:

```bash
npm ci
npm test
npm run test:desktop:unit
npm run dist:mac
```

The output is two disk images in `release/`: `Silicon-Valley-Smackdown-1.0.0-macOS-arm64.dmg` (Apple Silicon) and `Silicon-Valley-Smackdown-1.0.0-macOS-x64.dmg` (Intel), with the version taken from `package.json`. Building both from either kind of Mac works — electron-builder downloads the matching prebuilt Electron per architecture rather than cross-compiling anything. Build downloads require internet access; installed play does not.

Use `npm run desktop` to launch an unpackaged desktop build. `npm run build:desktop` always builds with a relative asset base, even if `VITE_BASE` is set for website deployment. The normal web build continues to honor `VITE_BASE`.

## Automated builds

`.github/workflows/macos.yml` runs on pull requests, pushes to `main`, version tags, and manual dispatch, mirroring `windows.yml`. Fork pull requests use `pull_request` with read-only permissions; they do not receive signing or publishing credentials.

The `macos-latest` runner is Apple Silicon, so the arm64 build is tested natively with Playwright's Electron support, driving the **built `.app` bundle** exactly as the Windows workflow drives the installed `.exe`: the game scene boots, all fighter/stage/FX textures load, menus work, a fight advances, fullscreen toggles, Node APIs are absent from the renderer, and settings survive an application restart. The x64 build only gets the boot + asset-loading half of that (`SVS_DESKTOP_SMOKE_ONLY=1`, see `launch.spec.ts`): running the full multi-minute gameplay/relaunch flow over an x64 process translated through Rosetta was observed leaving Playwright's CDP session unresponsive well before finishing, even though the app itself demonstrably booted and ran correctly first — a translated-process testing limitation, not a defect the smoke check would need to catch twice given the arm64 job already runs the deep flow natively. If Rosetta is ever missing (GitHub's arm64 runner images ship it preinstalled today), that step logs a warning and skips the launch test entirely rather than failing the job, since only the app's own structure is this project's concern, not the runner's Rosetta install. Both disk images are also mounted with `hdiutil` to confirm they actually contain the app, then uploaded along with a checksum file.

To run the same smoke test yourself against a built app:

```bash
export SVS_DESKTOP_EXE="/Applications/Silicon Valley Smackdown.app/Contents/MacOS/Silicon Valley Smackdown"
npm run test:desktop
```

The test uses a temporary profile; it does not alter your actual saves. Without `SVS_DESKTOP_EXE`, it tests the built `dist/` in the development Electron runtime.

## Publish a download

Releases are cut once, covering both platforms — see [Windows: Publish a download](windows.md#publish-a-download). Tagging `vX.Y.Z` triggers this workflow alongside the Windows one; each uploads its own assets onto the same draft release.

Players download the `.dmg` matching their Mac (Apple menu → About This Mac tells you Apple Silicon vs Intel), open it, and drag the app to Applications. They do not need the source ZIP, development tools, or the unpacked build directory. Updates are installed manually by running the next release's installer over the old one; no auto-updater or network service is included.

## Packaging choices

- Electron supplies the runtime, so no separately installed browser is required.
- Only `dist/`, desktop main-process code, and package metadata enter the application archive. Vite has already bundled Phaser; development tooling is excluded.
- `smackdown://game/` serves bundled assets through a constrained local protocol, identical to the Windows build. It provides a stable origin for localStorage without opening a localhost server or changing the web game code.
- The renderer has no Node.js integration or preload bridge. Sandbox, context isolation, and web security remain enabled. A content security policy and network request blocking keep the desktop renderer offline; new windows and page navigation are denied. The existing local music picker continues to use browser File/Blob APIs.
- macOS drops all standard app-menu accelerators (including Cmd+Q) if the application menu is set to `null`, unlike Windows/Linux where no menu is simply no menu — so the main process installs a minimal `{ role: 'appMenu' }` menu on macOS only, giving players the standard Quit/Hide/About items without adding File/Edit/View clutter for a single-window game.
- The app ID, product name, and save directory are stable identifiers, shared with the Windows build. Keep them unchanged in later releases to preserve upgrade and save behavior.
- `desktop/resources/icon.icns` is a multi-size conversion of the existing `public/favicon.svg`, rather than new game art — the same source the Windows `.ico` comes from.

## Release checks and limitations

Before publishing, test ordinary drag-to-Applications installation on both an Apple Silicon and an Intel Mac (or Rosetta on Apple Silicon), launch, keyboard play, sound, choosing a local music file, fullscreen, upgrade over a prior version, and moving the app to Trash. CI does not establish audio quality, nor upgrade compatibility with an already published build.

**No Apple Developer ID certificate is configured, so these builds are unsigned and not notarized.** This is a materially bigger hurdle than the Windows build's SmartScreen prompt: after downloading, Gatekeeper will refuse to open the app at all from a normal double-click ("app is damaged and can't be opened" or "cannot be opened because the developer cannot be verified"), and the player must right-click (or Control-click) the app in Applications and choose **Open**, then confirm in the dialog that appears — or clear it in System Settings → Privacy & Security. Signing and notarizing with a paid Apple Developer Program membership is a separate step a maintainer can add later via electron-builder's supported `mac.identity`/notarize configuration; until then, verify the source and the included SHA-256 checksum, and expect to walk less technical players through the right-click-Open step.
