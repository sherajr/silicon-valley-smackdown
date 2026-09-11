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
- `npm run test` (Vitest, 63 tests) — the original 27-test combat/progression suite, plus regression coverage for five previously-reproduced baseline bugs (a projectile launching from the correct height and only at its real release frame, and being preventable by interrupting startup; a Basic+Special chord recognized across the full 0/1/2-frame window in both button orders for both players while an insufficient-meter chord still falls back to an ordinary action; a dash requiring a genuine press-release-press instead of firing from a held direction; an attack requested mid-hit-stop surviving to execute once the freeze ends, without the freeze itself expiring the buffer; and a full keyboard tap that both begins and ends between two input samples still producing exactly one press edge) — each exercised through the real input/command/combat path, not hand-constructed results; plus new coverage for the move-timeline pose selector and the developed music tracks' duration/structure.
- `npm run test:e2e` (Playwright, 7 tests, against the actual production build) — the original 6, plus the combat-input regression test, all still passing after every change in this pass; separately verified via ad hoc Playwright scripts during this work (not checked-in specs) that: the production build loads and plays with zero console errors both at the site root and at a nested deployment base path (`VITE_BASE=/games/smackdown/`); a real Hunter-vs-Al fight shows the iPad releasing from and traveling at chest height instead of over the opponent's head; and character select, the fight HUD, and the pause menu render without errors.
- Manual/scripted browser verification: title → main menu → character select (now with independent, animated P1/P2 previews and per-player info panels) → stage select → versus intro → fight; pause/resume including the Move List overlay and Restart Match; Settings' tab navigation, live key remapping, and the new Choose Music File / Use Original Score controls; and the deployment-subpath build described above.

**Known limitations — read before assuming a claim of "done" covers everything:**

- **No reference photo was available to inspect.** A prompt describing Hunter's appearance referenced an attached reference image, but no image file was actually present in the project or conversation for this pass. Hunter's headphones, hoodie, quilted vest, jeans, sneakers, and laptop were implemented from the prompt's detailed *written* identity checklist, not pixel-matched against the photo itself. If a real reference image is supplied later, his rig and detail-painter layer (`src/render/characterDetails.ts`) should be revisited against it directly.
- **No image-generation tool was available in this environment.** Character, stage, and effect art is genuinely layered and detailed — a per-character clothing/accessory painter on top of a posed body rig, timeline-synced animation, shaped projectile/pickup icons, authored stage prop layers — but it is all vector shapes drawn through Phaser's Graphics/Canvas 2D API, not hand-authored or AI-generated raster pixel-art sprite sheets. That is a genuine ceiling on facial/material fidelity compared to real illustrated sprite art, though it does mean detail is never lost to canvas downscaling the way a rasterized sprite sheet would be.
- **The presentation canvas is still the original 480×270 simulation resolution** (upscaled by Phaser's Scale.FIT), not the 960×540-over-480×270 two-tier scheme suggested as one acceptable direction. Given the rig renders as vector shapes rather than fixed-resolution bitmaps, doubling the base canvas would have meant redrawing every part at higher fixed pixel dimensions for a real but incremental sharpness gain, at real risk of regressing hit/hurtbox-to-visual alignment, HUD layout, and every scene's coordinate math across the whole game -- a bad trade given the time available. Text and shapes are already crisp at the current scale (see the screenshots taken during this pass).
- **"Ox" by Slàinte Mhath is not bundled.** No such recording was supplied with this task, and it was not downloaded from any source (doing so would be both a copyright violation and against this project's explicit instructions). Instead, the playback infrastructure it would need is fully built and works today with any file you supply locally: see [Music](#music).
- Balance numbers (damage, frame data, AI aggression) follow the brief's target ranges but have not been through extensive human competitive playtesting.
- The production JS bundle is a single ~1.5&nbsp;MB (400&nbsp;KB gzipped) chunk; Vite's build warns about this. It loads fine locally and over a normal connection; code-splitting was not pursued since it wasn't required for correctness.
