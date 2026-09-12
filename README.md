# Silicon Valley Smackdown

A funny, original, 2D arcade fighting game built with **TypeScript, Vite, and Phaser**. Six fighters, three stages, a full single-player arcade run against a final boss (Elon), local two-player versus, training mode, pickups, and an original synthesized soundtrack — no accounts, no backend.

All shipped art, music, and sound effects are generated procedurally at runtime by this project's own code (see `src/render` and `src/audio`); nothing is a hand-authored bitmap sprite sheet or a licensed recording bundled into the repo. The one exception is opt-in and local to your own session: **Settings → Audio → Choose Music File** lets you point the game at an MP3/WAV on your own machine to play as the soundtrack instead of the built-in score (see [Music](#music) below). That file is never uploaded, bundled, or persisted — it's re-selected each session.

## Requirements

- Node.js 18+ (developed and tested on Node 22)
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

## Move commands (all six fighters share this structure)

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
| Elon | Rocket Reply | Cybertruck Shuffle | Acquisition | To the Moon |

The full move list with current bindings is always available from the pause menu during a match.

## Game modes

- **Single Player** — *The Last Funding Round*: play as any of the five regular fighters through a five-match arcade ladder, finishing against **Elon** as the final boss. Choose Easy/Normal/Hard before your first match. Losing a match offers Retry Opponent (same ladder position and difficulty) or Main Menu. Beating Elon unlocks him as a playable, rebalanced fighter for Versus and Training, and shows an ending specific to whichever fighter you played (Hunter's is the most developed).
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

The built-in soundtrack is a small original synthesizer (`src/audio/tracks.ts`, `src/audio/musicTheory.ts`, played back by `src/audio/AudioManager.ts`): each of the menu theme and three stage tracks is a developed ~45-90 second, multi-section arrangement (verse / chorus / a reprise that layers in a restated melodic hook / bridge / breakdown / final chorus / outro) with a moving bass line and drum fills, not a short repeating loop.

If you'd rather hear your own recording, open **Settings → Audio → Choose Music File** and pick a local MP3/WAV; it plays immediately for the rest of the session through the same Master/Music volume controls, and Settings shows the selected file's name so it's never mislabeled as anything it isn't. Pick **Use Original Score** to go back to the synthesized soundtrack. This selection is intentionally session-only — it is not uploaded anywhere and is not saved to `localStorage`, so it resets on reload. The game also supports pointing at a single pre-configured bundled recording (`BUNDLED_TRACK_URL` in `AudioManager.ts`) if one is ever added to the repository under `public/audio/`; today that constant is left unset, so no such file exists and the game never makes a request for one.

Pausing a match pauses whichever track is playing and resumes it from the same position (not from the top) without touching the shared audio system SFX rely on, so pause-menu sounds keep working. Switching tracks, stopping music, and Crunch Mode's tempo lift all only ever affect the synthesized score's own oscillators — a chosen recording is never sped up, pitch-shifted, or left playing underneath a new track.

## Editing game data

Everything gameplay-relevant lives in data/config files, not scattered through the engine:

- `src/sim/constants.ts` — the global tuning table (health, frame counts, hit-stop, guard, Hype, combo caps, pickup timing).
- `src/data/characters/*.ts` — one file per fighter: stats, palette, and every move's frame data, hitboxes, and effects, authored with the helpers in `src/data/moveHelpers.ts`.
- `src/data/stages/index.ts` — stage palettes, signage text, and music track IDs.
- `src/progression/ArcadeLadder.ts` — the five-match ladder generation (Hunter's is authored; every other fighter's is generated to avoid duplicates/self-matches).
- `src/render/characterRigs.ts` / `src/render/poses.ts` — the procedural rig and pose library (each character's silhouette, props, and attack poses).
- `src/render/characterDetails.ts` — the per-character clothing/accessory detail layer (Hunter's headphones and quilted vest, Kevin's tie and glasses, etc.) painted on top of the base rig for every pose.
- `src/render/moveTimeline.ts` — maps a move's live simulation frame to the right anticipation/contact/recovery pose, keyed to its real hit/release windows.
- `src/audio/tracks.ts` / `src/audio/musicTheory.ts` — the note data and phrase-composition helpers for the menu theme, all three stage tracks, and the victory sting.

The simulation core (`src/sim/CombatSim.ts` and friends) has no rendering dependency and is covered directly by the Vitest suite, so balance changes can be checked with `npm run test` before ever opening a browser.

## Credits

Design, code, character art, stage art, effects, and the built-in music/sound effects were all built for this project and are generated in-engine from this repository's own code — no external art, audio, or font asset is bundled in the repository itself. Engine: TypeScript + Vite + Phaser. See [Music](#music) above for the one opt-in exception: a listener can point the game at their own local audio file for the current session.

Elon and every other character in this game are fictional, exaggerated arcade caricatures created for comic effect. Any resemblance to real people or companies is parody, not depiction.

## QA record

**Automated checks performed and currently passing:**

- `npm run typecheck` — clean.
- `npm run test` (Vitest, 68 tests) — the original suite plus regression coverage for five previously-reproduced baseline bugs (see prior QA history in git log), the move-timeline pose selector, the developed music tracks, and `src/audio/AudioManager.test.ts` — a real transport regression test (original score → file A → file B → original score, across paused/stopped states) that fails on the old same-track-id guard and passes with the fix; see [Music](#music).
- `npm run test:e2e` (Playwright, 11 tests, against the actual production build) — the original navigation/settings/match-rematch/combat-input specs, plus `tests/e2e/combat-contact.spec.ts`: real-keypress coverage that walks P1 and P2 into range and asserts on the simulation's own resulting health/guard/state changes for an unblocked hit (both facings), a blocked hit (chip damage only, verified much smaller than an unblocked hit), and a grab-forced knockdown — not just that an attack *state* started.
- Three ad hoc, non-checked-in Playwright tools live in `tests/e2e/` under names that don't match Playwright's default `*.spec.ts` pattern, so they never run as part of `npm run test:e2e`: `evidence.capture.ts` (rerun via `npx playwright test tests/e2e/evidence.capture.ts` after temporarily renaming it to end in `.spec.ts`) captures a full screenshot set plus a silent gameplay video into `docs/handoffs/evidence/`; `viewer-check.ts` does the same for the dev Animation Viewer's procedural-rig path; `real-sprite-check.ts` checks the real-Hunter-art path added this pass (real art loads with no 404s, the info readout reports "Art: real" for every mapped clip, and the R toggle falls back to the rig) into `docs/handoffs/evidence/real-sprites/`.
- Manual/scripted browser verification: title → main menu → character select (independent, animated P1/P2 previews and per-player info panels) → stage select → versus intro → fight; pause/resume including the Move List overlay and Restart Match; Settings' tab navigation, live key remapping, and the Choose Music File / Use Original Score controls; dash/jump/block/knockdown/wakeup poses inspected both in a real fight and via the dev Animation Viewer (`?animviewer=1` — steps through every clip for every fighter with facing flip and pivot/hurtbox/hitbox overlays drawn from the same data gameplay uses; press `R` to compare the real Hunter art delivered this pass against the procedural rig it falls back to for every other clip/character).

**Known limitations — read before assuming a claim of "done" covers everything:**

- **Real Hunter sprite art now exists in the engine, but only in the dev Animation Viewer, not live gameplay.** Codex delivered 17 individual transparent-background PNGs (round 3 of this handoff); each was verified for genuine alpha (not just a "transparent" folder name — round 2's delivery looked identical but was actually flattened onto solid white, caught via PNG IHDR inspection and fixed with an ffmpeg colorkey pass before this round's real delivery made that unnecessary), trimmed to its opaque bounding box (`art/sprites/hunter/frames/`, manifest in `src/render/realSprites.ts`), and wired into `?animviewer=1` with a per-texture origin (bottom-center of each trim) and a procedural-rig fallback for every clip/character not covered. Verified in a real browser: feet/ground alignment is accurate for every standing/crouching/dash/hitstun/flat-knockdown pose; the mid-fall knockdown transition frame visibly floats above the ground line (its lowest pixel is an airborne foot, not a ground contact — a known, documented imperfection, not hidden); hit/hurtbox overlay scaling for real art is a rough eyeball match, not calibrated against Hunter's actual hurtbox dimensions. **Not done:** wiring this into `FightScene`/`SpriteFactory` for live matches, per-move frames (three attack moves currently share one delivered "strike" pose), any character besides Hunter, and a real in-gameplay pixel scale decision. See `docs/handoffs/CODEX_NEXT.md`.
- **Reference images are now in the repo** at `art/reference/` (`hunter_combat_key_poses.png`, a six-pose AI-generated key-pose sheet, and `hunter_original_office_illustration.png`, the original identity illustration) and were viewed and used as the basis for `docs/handoffs/CODEX_NEXT.md`'s art request.
- **No image-generation tool is available to Claude Code in this environment**, so the real Hunter art above came entirely from Codex's delivery, not from anything generated locally. Every other character, stage, and effect is still the original layered vector rig — a per-character clothing/accessory painter on top of a posed body rig, timeline-synced animation, shaped projectile/pickup icons, authored stage prop layers, and real multi-frame pose sequences for dash/jump/block-impact/hitstun/knockdown/wakeup instead of frame-zero holds — all drawn through Phaser's Graphics/Canvas 2D API at runtime.
- **The presentation canvas is now a crisp 960×540 physical resolution**, via Phaser's `scale.zoom: Phaser.Scale.ZOOM_2X` (`src/game.ts`) — a pure backing-resolution multiplier. `BASE_WIDTH`/`BASE_HEIGHT` and every hitbox, speed, and jump height are untouched and still authored in the original 480×270 sim space; only the physical canvas got sharper. Verified via the full e2e suite (including the real-contact combat tests, which depend on exact speed/reach) passing unchanged at the new resolution.
- **"Ox" by Slàinte Mhath is not bundled.** No such recording was supplied with this task, and it was not downloaded from any source (doing so would be both a copyright violation and against this project's explicit instructions). Instead, the playback infrastructure it would need is fully built and works today with any file you supply locally: see [Music](#music).
- Balance numbers (damage, frame data, AI aggression) follow the brief's target ranges but have not been through extensive human competitive playtesting.
- The production JS bundle is a single ~1.5&nbsp;MB (400&nbsp;KB gzipped) chunk; Vite's build warns about this. It loads fine locally and over a normal connection; code-splitting was not pursued since it wasn't required for correctness.
- The evidence video (`docs/handoffs/evidence/gameplay.webm`) is silent — Playwright's video capture does not record system audio, and no audio-listening tool is available to Claude Code in this environment, so the audio/mix quality called for in the brief has not been critiqued from a real listen. Flagged, not fabricated: see `docs/handoffs/CODEX_NEXT.md`.
