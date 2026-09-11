# Silicon Valley Smackdown

A funny, original, 8-bit-style 2D arcade fighting game built with **TypeScript, Vite, and Phaser**. Six fighters, three stages, a full single-player arcade run against a final boss (Elon), local two-player versus, training mode, pickups, and an original synthesized soundtrack — no accounts, no backend, no external assets.

All pixel art, music, and sound effects are generated procedurally at runtime by this project's own code (see `src/render` and `src/audio`). There are no image, audio, or font files to download; everything renders from data.

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

## Editing game data

Everything gameplay-relevant lives in data/config files, not scattered through the engine:

- `src/sim/constants.ts` — the global tuning table (health, frame counts, hit-stop, guard, Hype, combo caps, pickup timing).
- `src/data/characters/*.ts` — one file per fighter: stats, palette, and every move's frame data, hitboxes, and effects, authored with the helpers in `src/data/moveHelpers.ts`.
- `src/data/stages/index.ts` — stage palettes, signage text, and music track IDs.
- `src/progression/ArcadeLadder.ts` — the five-match ladder generation (Hunter's is authored; every other fighter's is generated to avoid duplicates/self-matches).
- `src/render/characterRigs.ts` / `src/render/poses.ts` — the procedural pixel-art rig and pose library (this is where each character's silhouette, props, and attack poses are defined).
- `src/audio/tracks.ts` — the chiptune note data for the menu theme, all three stage tracks, and the victory sting.

The simulation core (`src/sim/CombatSim.ts` and friends) has no rendering dependency and is covered directly by the Vitest suite, so balance changes can be checked with `npm run test` before ever opening a browser.

## Credits

Design, code, pixel art, music, and sound effects were all built for this project and are generated in-engine — there is no external art, audio, or font asset anywhere in the repository. Engine: TypeScript + Vite + Phaser.

Elon and every other character in this game are fictional, exaggerated arcade caricatures created for comic effect. Any resemblance to real people or companies is parody, not depiction.

## QA record

**Automated checks performed and currently passing:**

- `npm run typecheck` — clean.
- `npm run test` (Vitest, 27 tests) — covers: a move only deals damage during its declared active frames, and only once per activation unless it explicitly re-hits; left/right hitbox and projectile mirroring; standing vs. crouch block rules, an evaded high strike, guard break; grabs beating a block, a successful grab escape, and held-grab-does-not-auto-escape; special/super cooldowns and meter spend, and a chord without full meter resolving as an ordinary action; simultaneous strikes resolving as a trade rather than favoring P1; KO, timeout, and exact-tie-draw resolution, each firing exactly once; combo hit/damage cap forcing a knockdown; the Elon boss entering Crunch Mode exactly once at its health threshold without healing or re-triggering; pickups refreshing instead of stacking and never touching base max health; round/match reset clearing all transient state; and a determinism check that two independent sims given the same seed and scripted input produce identical results.
- `npm run test:e2e` (Playwright, 6 tests, against the actual production build) — production build loads with zero console errors or failed requests; Title requires a real input before advancing; menu navigation across How to Play / Settings / Credits and back; independent Player 1 / Player 2 character selection in Two Players mode reaching a live fight; a complete two-round match followed by Rematch, verified to reset health and the session score; and volume/key-binding changes surviving a full page reload via localStorage.
- Manual browser verification (via automated browser scripts during development, not just a compile check): title → main menu → character select → stage select → versus intro → fight, for both Single Player and Two Players; a full Hunter arcade run forced through all five ladder opponents to the Ending screen; pause/resume, the Move List overlay, and Restart Match; the Settings screen's tab navigation, live key remapping (including a conflict-free rebind that took effect immediately), and the Key Test panel; and a deployment-subpath build (`VITE_BASE`) served from a non-root path.

**Known limitations:**

- Balance numbers (damage, frame data, AI aggression) follow the brief's target ranges but have not been through extensive human competitive playtesting — they're a solid, tested starting point rather than a tournament-tuned final pass.
- The production JS bundle is a single ~1.5&nbsp;MB (392&nbsp;KB gzipped) chunk; Vite's build warns about this. It loads fine locally and over a normal connection, but code-splitting was not pursued since it wasn't required for correctness.
- Pixel art, backgrounds, and music are original but deliberately procedural/parametric (an in-engine rig and pose library, and a small note-sequence music engine) rather than hand-painted frame-by-frame sprite sheets, given the scope of six fighters × many animation states.
