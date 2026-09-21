# Silicon Valley Smackdown

A funny, original, 2D arcade fighting game built with **TypeScript, Vite, and Phaser**. Seven fighters, three stages, a full single-player arcade run against a final boss (Elon), local two-player versus, training mode, pickups, and an original soundtrack — no accounts, no backend.

Six of the seven fighters use hand-painted pixel-art sprite sheets (idle, walk, attack, and jump/crouch/block/hurt poses) and all three stages use painted backgrounds, shipped under `public/sprites/`. Each fighter keeps their own clothing and accessories — Hunter's grey hoodie and quilted vest, Kevin's navy suit and tie, Priya's blazer and headset — and the cyan/magenta/yellow arcade theme is applied through the UI, menus, HUD and effects rather than by recolouring the characters. A procedural drawing rig ships alongside as a genuine fallback, used only if a sheet is missing or fails to decode. Music remains the original synthesized score, with an optional local music file in Settings.

**Darth Maul is the exception, and is a guest fighter rather than original content.** His sheets are rendered from a third-party rigged 3D model, not painted, so they are build output — see `scripts/art/maul_sprites.py` and the [Art pipeline](#art-pipeline-darth-maul) section. The model is not redistributed with this repo, and the character is Lucasfilm/Disney's; he is fine for a private build but should come out before this is published anywhere.

## Combat clock and move frames

Combat advances at 60 fixed simulation ticks per second (one tick is about 16.67 ms), independent of display refresh rate. Rendering may run at the device's refresh rate; it does not change move frame lengths.

Each round starts at **8:00** (28,800 ticks). The clock continues during impact hit-stop, pauses when gameplay is paused, and stops when the round ends. At 0:00, the fighter with the higher remaining health percentage wins; equal percentages draw and replay the round. Knockouts still end rounds early, and the first player to win two rounds wins the match.

Moves define startup, active hitbox windows, recovery, and total duration in simulation frames. A hit window beginning at frame 4 for 3 frames is active on frames 4, 5, and 6 only. Multiple windows can have different boxes and damage. Hit-stop freezes these move timelines. The pause menu's **Move List** shows frame data; Training settings can show active hitboxes.


## Install and play on desktop

Once a release has been published, grab the file for your OS from [Releases](https://github.com/sherajr/silicon-valley-smackdown/releases):

- **Windows:** download **Silicon-Valley-Smackdown-1.0.0-Windows-x64-Setup.exe** (or the newer version). Double-click it to install and launch the game, then use the desktop or Start menu shortcut afterward. Windows 10/11 on an Intel/AMD 64-bit PC; ARM64 and 32-bit installers are not provided.
- **macOS:** download **Silicon-Valley-Smackdown-1.0.0-macOS-arm64.dmg** (Apple Silicon) or the **-x64.dmg** (Intel), open it, and drag the app to Applications. **These builds are unsigned and not notarized** — a normal double-click will be refused by Gatekeeper, so right-click (or Control-click) the app and choose **Open**, then confirm in the dialog that appears once. See [macOS notes](docs/macos.md#release-checks-and-limitations) for why, and for the System Settings alternative.

Either way: no Node.js, terminal, browser installation, account, or internet connection is needed to play — all game art, code, and the soundtrack are included. Press **F11** to toggle fullscreen; **Escape** pauses the game. Settings and unlocks are stored per-OS (`%APPDATA%\Silicon Valley Smackdown` on Windows, `~/Library/Application Support/Silicon Valley Smackdown` on macOS), separately from browser saves, and survive installing a newer version. Uninstall through Windows Settings → Apps, or by moving the app to the Trash on macOS; saved data is retained either way.

Windows builds may still show an unknown-publisher/SmartScreen warning even though they're less locked-down than the unsigned macOS build above — verify the source and the included SHA-256 checksum either way; signing for public distribution is a separate release step neither platform has yet.

If no release is available yet, a maintainer can build one using the [Windows](docs/windows.md) or [macOS](docs/macos.md) packaging instructions. Successful **Windows installer**/**macOS installer** workflow runs also include the installer as a downloadable artifact (GitHub wraps artifacts in a ZIP; extract it first).

## Development requirements

- Node.js 22.12+ (Node 22 LTS recommended)
- A modern desktop browser (Chrome, Edge, Firefox) for actual play
- A keyboard. Two players share one keyboard for local versus play.

## Running it

```bash
npm install
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`). No account, API key, or network access is required to play.

## Other scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run typecheck` | TypeScript project check, no emit |
| `npm run test` | Run the simulation unit test suite (Vitest) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build` | Type-check, then produce a static production build in `dist/` |
| `npm run preview` | Serve the built `dist/` output locally, exactly as it will run in production |
| `npm run test:e2e` | Playwright end-to-end browser suite (builds and previews the app automatically) |
| `npm run desktop` | Build and launch the desktop game locally |
| `npm run dist:win` | Build a Windows x64 installer in `release/` (run on Windows) |
| `npm run dist:mac` | Build macOS arm64 + x64 disk images in `release/` (run on a Mac) |
| `npm run test:desktop:unit` | Check desktop asset path isolation |
| `npm run test:desktop` | Desktop smoke test; requires `npm run build:desktop` first |

### Deploying to a subpath

The build reads a `VITE_BASE` environment variable for the deployment base path (defaults to `./`, which works from any folder depth):

```bash
VITE_BASE=/my-subpath/ npm run build
```

This has been verified to work correctly both from the site root and from a nested subpath (asset URLs and the favicon resolve either way).

## Controls

Both players play on the same keyboard. Bindings are fully remappable in **Settings → Controls P1 / Controls P2**, including a one-key-press capture flow, conflict detection, a Laptop Preset for Player 2, and a live Key Test panel.

| Action | Player 1 (default) | Player 2 (default) |
| --- | --- | --- |
| Move left / right | A / D | Left / Right arrows |
| Jump | W | Up arrow |
| Crouch | S | Down arrow |
| Basic attack | V | Numpad 4 (also top-row 4) |
| Special attack | B | Numpad 5 (also top-row 5) |
| Block (hold) | N | Numpad 6 (also top-row 6) |
| Grab | M | Numpad + (also the physical =/+ key, no Shift needed) |
| Super (full Hype meter) | V + B together | Numpad 4 + 5 together |
| Confirm in menus | V | Numpad 4 |
| Cancel / back in menus | N | Numpad 6 |
| Pause | Escape | Escape |

Player 2's default is a numeric keypad. If your keyboard has no numpad, switch to the **Laptop Preset** in Settings, which rebinds Player 2 to arrows + **J / K / L / ;**. Bindings use physical key codes (e.g. `Numpad4` vs `Digit4`), so remapping is unambiguous regardless of Num Lock state — the in-game Key Test panel is the fastest way to confirm what your hardware actually sends. Escape always stays reserved for pause/back and cannot be reassigned.

## Move commands (all seven fighters share this structure)

- **Basic** (tap repeatedly): a 3-hit chain. Timing matters — mash too early and it just repeats the first hit.
- **Forward + Basic**: a heavy, slower attack with more knockback.
- **Down + Basic**: a low attack that must be blocked crouching.
- **Basic while airborne**: an overhead jump-in attack.
- **Special** / **Down + Special**: each fighter's two signature moves (see below).
- **Grab**: close-range throw that beats blocking; escape it by pressing Grab again within a few frames of being caught.
- **Basic + Special together, with a full Hype meter**: your Super.

| Fighter | Special | Down + Special | Grab | Super |
| --- | --- | --- | --- | --- |
| Hunter | iPad Yeet | Pivot | Mandatory Networking | Series A |
| Kevin | Briefcase Briefing | Objection! (counter stance) | You've Been Served | Class Action |
| Al | Bottle Service | Happy Hour (low sweep) | You're My Best Friend | Open Bar |
| Priya | Resume Blast | Let's Connect | Talent Acquisition | Seven-Round Interview |
| Chad | Cash Burn | Down Round (delayed strike) | Hostile Takeover | Exit Strategy |
| Darth Maul | Force Shove | Saber Parry (counter stance) | Force Choke | Both Ends of the Blade |
| Elon | Rocket Reply | Cybertruck Shuffle | Acquisition | To the Moon |

The full move list with current bindings is always available from the pause menu during a match.

## Game modes

- **Single Player** — *The Last Funding Round*: play as any of the six regular fighters through a five-match arcade ladder, finishing against **Elon** as the final boss. Choose Easy/Normal/Hard before your first match. Losing a match offers Retry Opponent (same ladder position and difficulty) or Main Menu. Beating Elon unlocks him as a playable, rebalanced fighter for Versus and Training, and shows an ending specific to whichever fighter you played (Hunter's is the most developed).
- **Two Players** — both players pick a fighter (mirror matches allowed, with a palette swap so P2 is always visually distinct), then choose a stage and whether pickups are on (default) or off. Session win tallies carry across rematches.
- **Training** — pick a fighter and any stage; set the dummy to Idle, Block, or Fight Back; reset health/meter, refill meter, and toggle a hitbox/hurtbox overlay to study spacing.
- **How to Play** and **Settings** (audio, screen shake, reduced effects, and full control remapping) are reachable from the main menu at any time.

## Combat notes

- Fixed 60 Hz combat simulation, decoupled from rendering, so frame data is identical regardless of display refresh rate.
- Standing block stops mid/high/overhead; crouch-block stops mid/low but loses to overhead; crouching alone ducks under high strikes for free.
- Combos are capped (5 hits or ~35% max health) and end in a forced knockdown with a brief wake-up invulnerability window, so there are no infinites.
- GPU (+damage), Coffee (+speed), and Signing Bonus (heals) pickups can be toggled off before a Versus match; they never persist across a round reset.
- Losing window focus (alt-tab, etc.) automatically pauses the match and clears held input.

## Music

**The default soundtrack in this build is “Celtic Arcade Run” by peaceantz** (`src/audio/tracks/celtic_arcade.mp3`, generated with Suno), bundled into the app and played on the menus and all three stages. Choose **Settings → Audio → Use Original Score** to switch to the synthesized score described next, which remains fully implemented and shipped.

The synthesized score is a small original synthesizer (`src/audio/tracks.ts`, `src/audio/musicTheory.ts`, played back by `src/audio/AudioManager.ts`): each of the menu theme and three stage tracks is a developed ~45-90 second, multi-section arrangement (verse / chorus / a reprise that layers in a restated melodic hook / bridge / breakdown / final chorus / outro) with a moving bass line and drum fills, not a short repeating loop.

If you'd rather hear your own recording, open **Settings → Audio → Choose Music File** and pick a local MP3/WAV; it plays immediately for the rest of the session through the same Master/Music volume controls, and Settings shows the selected file's name so it's never mislabeled as anything it isn't. Pick **Use Original Score** to go back to the synthesized soundtrack. This selection is intentionally session-only — it is not uploaded anywhere and is not saved to `localStorage`, so it resets on reload. A bundled recording can also ship as the default soundtrack, which is what this build does: `BUNDLED_TRACK_URL` in `src/audio/AudioManager.ts` points at `src/audio/tracks/celtic_arcade.mp3`, imported as a module asset so Vite fingerprints it and rewrites the URL for each build base (`/` for the web, `./` for the packaged desktop app, or a `VITE_BASE` subpath). Set that constant back to `null` to ship with the synthesized score as the default again. Note that a bundled track replaces the music everywhere rather than per stage — `playMusic()` routes to the recorded backend whenever one is set — so the same recording plays on the menus and all three stages.

Pausing a match pauses whichever track is playing and resumes it from the same position (not from the top) without touching the shared audio system SFX rely on, so pause-menu sounds keep working. Switching tracks, stopping music, and Crunch Mode's tempo lift all only ever affect the synthesized score's own oscillators — a chosen recording is never sped up, pitch-shifted, or left playing underneath a new track.

## Editing game data

Everything gameplay-relevant lives in data/config files, not scattered through the engine:

- `src/sim/constants.ts` — the global tuning table (health, frame counts, hit-stop, guard, Hype, combo caps, pickup timing).
- `src/data/characters/*.ts` — one file per fighter: stats, palette, and every move's frame data, hitboxes, and effects, authored with the helpers in `src/data/moveHelpers.ts`.
- `src/data/stages/index.ts` — stage palettes, signage text, and music track IDs.
- `src/progression/ArcadeLadder.ts` — the five-match ladder generation (Hunter's is authored; every other fighter's is generated to avoid duplicates/self-matches, rotating the opponent pool by roster index so every regular gets a turn now that there are more regulars than ladder slots).
- `src/render/SpriteFactory.ts` — loads the pixel-art sheets from `public/sprites/fighters/` and maps sim states to idle/walk/attack/pose frames.
- `public/sprites/` — 2×2 sheets per fighter action, stage backgrounds, and FX.
- `src/render/characterRigs.ts` / `src/render/poses.ts` — the original procedural vector rig (kept as a fallback if a sheet is missing).
- `src/render/characterDetails.ts` — the per-character clothing/accessory detail layer (Hunter's headphones and quilted vest, Kevin's tie and glasses, etc.) painted on top of the base rig for every pose.
- `src/render/moveTimeline.ts` — maps a move's live simulation frame to the right anticipation/contact/recovery pose, keyed to its real hit/release windows.
- `src/audio/tracks.ts` / `src/audio/musicTheory.ts` — the note data and phrase-composition helpers for the menu theme, all three stage tracks, and the victory sting.

The simulation core (`src/sim/CombatSim.ts` and friends) has no rendering dependency and is covered directly by the Vitest suite, so balance changes can be checked with `npm run test` before ever opening a browser.

## Art pipeline (Darth Maul)

Maul's four sheets are the only fighter art in the project that is generated rather than drawn, so treat `public/sprites/fighters/maul/*.png` as build output: to change a pose, edit `POSES` in `scripts/art/maul_sprites.py` and re-run it, rather than editing the PNGs.

```sh
blender -b "<path>/FIGHTER.blend" --python scripts/art/maul_sprites.py -- \
    --out .scratch/maul --res 4 --dest public/sprites/fighters/maul --contact
```

The script isolates the character meshes, rebuilds the model's imported Maya/Arnold materials as plain Principled shaders, lights it for a near-black character, poses the rig's Auto-Rig Pro IK controls into the 16 cells the loader expects, renders each at 4× through a fixed orthographic 3/4 camera, then box-filters to 96×120, adds the house keyline, and packs the 2×2 sheets. `--contact` writes a review grid; `--sheets-only` re-packs from renders already in `--out` without re-rendering. The camera framing is fixed for every pose, which is what keeps the feet on row 115 and the scale consistent with the painted cast.

The source model is **not** in this repo — point `blender` at your own copy of the `.blend`, with its `texture0.PNG`/`texture1.PNG` alongside it. Two properties of that file cost real time to rediscover and are handled in the script with comments at the point of use: the rig ships with `hide_render` on (which silently renders every pose undeformed), and the render pipeline's frame update re-evaluates the rig's 194 drivers, resetting any pose set from a script — so the posed meshes are snapshotted out of the viewport depsgraph and those copies are what get rendered.

## Credits

Design, code, character art, stage art, effects, the synthesized score, and the sound effects were all built for this project. The bundled default soundtrack, “Celtic Arcade Run” by peaceantz, was generated with Suno for this project and ships under `src/audio/tracks/`. Fighter and stage art ships as pixel-art sheets under `public/sprites/`. Engine: TypeScript + Vite + Phaser. See [Music](#music) above for the one opt-in exception: a listener can point the game at their own local audio file for the current session.

Elon and every other character in this game are fictional, exaggerated arcade caricatures created for comic effect. Any resemblance to real people or companies is parody, not depiction.

Darth Maul is the one exception to "everything here was built for this project": he is a guest fighter built from a third-party rigged 3D model, and the character is the property of Lucasfilm/Disney. Neither the model nor its textures are redistributed here — only the rendered sprite sheets — and nothing about him is original to this project apart from his move data and the render pipeline. He is fine in a private build; remove him before publishing or distributing this game.

## QA record

**Automated checks performed and currently passing:**

- `npm run typecheck` — clean.
- `npm run test` (Vitest, **161 tests**) — the 133 tests already on `main`, plus new regression coverage added in the art-restoration pass: `src/render/SpriteFactory.test.ts` (painted-sheet validation, art-vs-rig source selection, and the guarantee that a procedural fallback can never occupy a production texture key), `src/render/FighterView.test.ts` (block-impact / guard-break / hitstun / knockdown / wakeup frame routing, hit-stop not ageing a reaction, dash and jump-phase selection, wall-clock damage flash, and reaction reset on a round reset), `src/audio/AudioManager.test.ts` (synth → file A → file B → synth transport switching with real teardown), and `src/data/characters/hunter.combo.test.ts` (the three-hit basic string connecting from both facings, with the mirrored case placing Hunter genuinely on the right).
- `npm run test:e2e` (Playwright, **24 tests**, against the actual production build) — the 8 pre-existing specs plus `tests/e2e/art-restoration.spec.ts` (9), `tests/e2e/scene-layout.spec.ts` (4) and `tests/e2e/render-pacing.spec.ts` (3, driving the real `FightScene.update()` loop with 30/60/120/144 Hz frame deltas over equal simulated elapsed time, plus the bounded catch-up policy and pause/resume). These read live Phaser/CombatSim state in a real browser: every production sheet decoding at 192×240 with four cells and every stage at 480×270, the sprite bound at render time being a real sheet rather than a rig canvas, feet landing on `GROUND_Y`, both facings, the reaction frames actually selected during live combat, hit-stop holding `frameCount` while the round clock keeps counting down, and the pause move list's contents, column alignment and overlay lifecycle.
- `npm run test:desktop:unit` (node:test, 2 tests) and `npm run test:desktop` (Playwright + Electron, 1 test) — the desktop test now asserts every packaged art asset decodes at its authored geometry and that **no** `rig_*` texture exists, so a procedural stand-in registered under an expected name fails instead of passing.
- `npm run build` / `npm run build:desktop` / `npm run dist:win` — all clean; the Windows smoke test was additionally run against the packaged `release/win-unpacked` executable (isolated temp user-data profile, existing installs untouched).
- Screenshot evidence for the art, layout, combat and move-list claims is written to `test-results/evidence/` by the two new e2e specs.

**Known limitations — read before assuming a claim of "done" covers everything:**

- **Pixel-art sheets are used in live matches** for all seven fighters (Hunter, Kevin, Al, Priya, Chad, Darth Maul, Elon) plus the three stages. Maul's are rendered rather than painted (see [Art pipeline](#art-pipeline-darth-maul)) but obey the same cell geometry, ground line and 16-cell budget as the rest. Sheets are 96×120 2×2 grids under `public/sprites/fighters/{id}/{idle,walk,attack,poses}.png`. Pose coverage is deliberately compact and is **not** a full fighting-game atlas: each fighter authors 16 cells (4 idle, 4 walk, 4 attack, and one each of jump/crouch/block/hurt). Every fighter has their own painted art, but moves are distinguished by combining those four attack cells rather than by bespoke per-move frames, and the two-phase reaction sequencing (snap→settle, fall→grounded, stir→rise, jump rise/apex/fall) only has distinct frames to play on the procedural fallback rig — with painted art those states hold their single authored cell. The frame *routing* fixes (a blocked hit showing the guard cell, a guard break showing the recoil cell) apply to both sources.
- **Extra Hunter reference art is not shipped as sprites.** `art/work/` in the working tree holds 16 transparent 96×120 PNGs that are pixel-identical to cells already in the shipped sheets, plus 15 full-resolution 912×1136 JPEG references (dash, knockdown, wakeup, victory, grab and similar). The JPEGs have no alpha channel and are drawn in a smoother, higher-resolution style than the 96×120 pixel-art sheets, so folding them in would make Hunter visually inconsistent with himself and with the other five fighters. They remain references, not production assets.
- **The presentation canvas is still the original 480×270 simulation resolution** (upscaled by Phaser's Scale.FIT).
- **A bundled recording replaces the whole soundtrack, not one stage.** The default track plays on the menus and all three stages; there is no per-stage recorded music. The synthesized score still has distinct menu and per-stage arrangements, reachable via **Settings → Audio → Use Original Score**.
- **The bundled track adds ~3.5 MB to every installer.** It is committed to the repository and packaged into the `.exe` and both `.dmg`s.
- Balance numbers (damage, frame data, AI aggression) follow the brief's target ranges but have not been through extensive human competitive playtesting.
- The production JS bundle is a single ~1.5&nbsp;MB (400&nbsp;KB gzipped) chunk; Vite's build warns about this. It loads fine locally and over a normal connection; code-splitting was not pursued since it wasn't required for correctness.
