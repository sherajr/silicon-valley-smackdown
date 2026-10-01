# Arena Edition

Arena Edition makes a complete original 3D platform fighter the default entry point. The previous renderer only supported a Maul mirror match on Castro Street; all other pairings fell back to sprites. That pathway remains available in Classic, but no Arena match depends on it.

The reference was [JRickey/BattleShip](https://github.com/JRickey/BattleShip), a native Smash 64 port. Its platform combat direction informs damage percentages, stocks, double jumps, recovery, shields, directional attacks, and blast zones. Arena is an independent Three.js/TypeScript implementation. It does not include that project's code, ROM-derived assets, or Nintendo characters.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/arena/data.ts` | Reuses the original roster's names, palettes and quips. Defines the platform records (id, top, width, solid or one-way, thickness, ledges) that collision, ledges and the visible stage all read. |
| `moveDefinitions.ts` | Typed move data: hit windows (hit volumes, damage, launch angle/base/growth, hitstun, hitstop, re-hit rules), cancels, projectiles, counters, armor, dives, grabs, throws, and the combo documentation records. No browser imports. |
| `fighterDefinitions.ts` | The six fighters: body, movement, AI profile, and a complete move set each, plus each one's documented and tested combos. The single source of truth for gameplay numbers. |
| `ActionBuffer.ts` | Per-fighter input buffer: fresh-press detection, a 6-frame window that does not age during hitstop, direction captured at press time. Plain data. |
| `collision.ts` | Swept stage collision: solid blocks (top, sides, underside) and one-way platforms, depenetration, ledges, projectile sweeps. Pure functions. |
| `grabs.ts` | Catch, hold, tech, pummel and throw rules and their tuning constants. |
| `Simulation.ts` | Seeded, fixed-step 60 Hz combat: action resolution, hit and contact resolution, holds, projectiles, pickups, stocks, combos, sudden death. No browser/renderer imports. |
| `cpu.ts` | The CPU: produces ordinary controls, so it obeys the same buffer and legality rules as a human. Reads each fighter's move data. |
| `stepper.ts` | Fixed-timestep driver with a documented, bounded stall policy. |
| `moveInfo.ts` | Generates the move list, frame data and combo bands shown in-game from the same definitions. |
| `FighterRig.ts` | Six articulated mesh characters with a pose per move: jab stages, tilts, five aerials, counter stance, dash, slam phases, catch, hold, struggle, pummel, four throws, tech and landing lag. |
| `Stage.ts` | Three arenas built from the same platform records collision uses: one slab per platform with exactly one exposed top face (floor markings are painted into its texture), batched scenery, a sky dome and per-arena skylines. The lit roof slab is the gameplay body; the tower below it is scenery set behind the fighters' plane. See [the graphics notes](arena-graphics.md). |
| `Renderer.ts` | The render loop's owner: lighting from each arena's theme, a stable shadow volume, the HDR post pipeline (or direct render), sizing, one shared interpolated position per fighter for the model, camera, shadow and label, projectile props, the training hitbox overlay, offscreen portraits and GPU cleanup. Companion modules: `quality.ts` (presets and settings migration), `cameraRig.ts`, `interpolation.ts`, `post.ts`, `effects.ts`, `trails.ts`, `sky.ts`, `environment.ts`, `stageThemes.ts`, `stageLayout.ts`, `stageKit.ts`, `staticBatch.ts`, `textures.ts`, `rigParts.ts`. |
| `Input.ts` | Keyboard and two standard gamepads. Direction and shield taps shorter than a tick are not lost. |
| `Audio.ts` | Synthesized combat effects (including catch, tech, counter, impact) and the score. |
| `App.ts` | Selection, modes, pause, results, HUD, combo popup, contextual grab hints, training tools, move list, and the bounded fixed-step loop. |
| `scripts/build-portable.mjs` | Creates a self-contained IIFE with inline CSS in `PLAY.html`. Works via `file://`, no server. |
| `scripts/package-arena.mjs` / `.py` | ZIPs the playable game and editable source; verifies CRCs and writes SHA-256. The launcher finds a working Python 3 on Windows. |

## Combat behavior

**Input.** A fresh press of attack, special, grab or jump becomes a request that stays valid for 6 gameplay frames, so a press just before a fighter can act still executes once. Requests are captured during hitstop and do not age while frozen, but do age through stun and recovery. Held buttons never repeat. Pause, resume, launch, KO and respawn clear requests; a button held through a countdown or a respawn is not a fresh press. Priority for simultaneous presses: special, then grab, then attack, then jump. Shield + grab grabs out of shield; shield + jump jumps; up + special recovers without also jumping. A spent recovery is refused (it never turns into a neutral projectile).

**Moves.** Every fighter has a three-hit jab string (each press during a cancel window advances it; it resets after a short grace or after the finisher), forward/up/down ground attacks, five directional aerials (back air does not turn the fighter around; facing changes only on the ground and on a double jump), a neutral projectile, an up recovery and a down special. The down special is a slam for Hunter, Al, Chad and Elon (hang, dive to the nearest surface, one impact on landing, then endlag), a counter for Kevin, and a dash for Priya. Specific on-hit cancels and jump-cancels exist on designated moves only.

**Contact.** Hit volumes and hurtboxes are boxes. Hits are resolved from a snapshot of both fighters, so trades are symmetric, hitstop is the larger of the impacts, and swapping slots changes nothing. Launch speed is (base + damage x growth) / weight, capped at 1.4 per tick; hitstun is authored per move. Projectiles carry their own launch definition and direction. Stage solids stop or bounce them; upper platforms never do.

**Combos.** A confirmed combo counts hits the defender could not act between; blocked hits, whiffs and pummels do not count. From the fourth hit, damage and hitstun shrink by 10% per hit. Directional influence is bounded per hit.

**Stage.** The main stage is a solid block (top, sides, underside). Upper platforms are one-way; holding down drops through only the platform being stood on, for 18 frames. Ledges are derived from the platform data; regrabs grant less protection each time and respect a cooldown, reset by a genuine landing, a KO or a respawn. Rolls stop at a platform edge and end their own protection. Grounded fighters keep a small symmetric gap; airborne fighters cross over.

**Grabs.** M throws out a short catch. A connected catch links both fighters: the target is drawn to a hold position at the captor's hands, nobody can walk or jump, and there is no damage yet. The held fighter can break it with a fresh grab press in the first 8 frames (including during the catch's hitstop). The captor can pummel (twice) or throw forward, back, up or down; damage and launch happen once, on the throw's release frame. A hold lasts at most 54 frames, then throws forward. Two grabs that connect on each other break; an active strike beats a grab. Anyone thrown, teched or freed is protected from regrabs for 45 frames.

The original V/B/N/M controls remain P1's attack/special/shield/grab. P2 uses J/K/L/semicolon, with the old numeric aliases retained. This is a new platform-fighter ruleset, not a modification of Classic's health/round engine.

CPU recovery takes priority offstage and respects the fighter's recovery. Three difficulty levels change timing, aggression, shielding, follow-ups and how often it breaks grabs. The arcade ladder advances after a human win and ends with Elon. Training disables the clock and stock limit and offers dummy behaviours (stand, shield, jump, DI left/right, tech), damage presets, position reset, hitbox and state/input displays, and a frame-step mode (press `.`); P2's own keys still move the dummy.

## Rendering and portability

Arena never falls back to a 2D fighter. The meshes and procedural animation are authored in code; no separate model download or external animation license is needed. Character portraits are rendered from those same meshes. The dynamic camera fits both active fighters. Key lighting, shadows, face details, warm/cool contrast and player tags distinguish the combat plane from the environment.

Gameplay targets a 60 Hz fixed simulation; catch-up is capped after a stall. Display interpolation supports other refresh rates. Graphics are chosen from three presets (High, Balanced, Performance; see [the graphics notes](arena-graphics.md) for exactly what each does and what it costs on the reference laptop). Performance renders straight to the canvas with no real shadows or post effects and keeps soft contact shadows. Arenas are built once and kept (at most three), match teardown disposes fighters, projectiles and pickups, and the renderer's own shared resources are disposed when it is.

`PLAY.html` is a portable browser build. It is not a signed native executable. Its content security policy disallows network connections and external scripts. No models, fonts, images, scripts or music need to be fetched at play time. The separate source archive preserves the existing Electron packaging configuration for native builds by a maintainer.

## Testing and practical limits

Run `npm test`, `npm run build`, `npm run build:portable` and `npm run test:arena` (see `docs/arena-gameplay-pass.md` for the latest results). The browser suite can target the portable file with `SVS_PORTABLE=1`. The `SVS_CHROMIUM` environment variable selects an existing Chromium executable. `SVS_SANDBOX_DEVICES=1` replaces unavailable audio/controller devices in sandboxed CI; production code remains unchanged. Physical controller routing, audible output and native Windows execution still require a hardware check.

This release uses original stylized mesh characters and procedural animation, not motion capture or BattleShip's original character assets. It is intended to be playable and editable, with a complete new ruleset. Competitive balance, full controller menu navigation, mobile touch controls, online play, rollback, and commercial-quality authored model/animation assets are outside this release. The legacy Maul guest remains only in the existing source/Classic mode.
