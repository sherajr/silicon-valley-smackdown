# Arena Edition

Arena Edition makes a complete original 3D platform fighter the default entry point. The previous renderer only supported a Maul mirror match on Castro Street; all other pairings fell back to sprites. That pathway remains available in Classic, but no Arena match depends on it.

The reference was [JRickey/BattleShip](https://github.com/JRickey/BattleShip), a native Smash 64 port. Its platform combat direction informs damage percentages, stocks, double jumps, recovery, shields, directional attacks, and blast zones. Arena is an independent Three.js/TypeScript implementation. It does not include that project's code, ROM-derived assets, or Nintendo characters.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/arena/data.ts` | Reuses the original roster's names, palettes, quips, and signature move names. Defines weights, speed and the collision/rendering platform coordinates. |
| `Simulation.ts` | Seeded, fixed-step 60 Hz combat, AI, projectiles, pickups, stocks, invulnerability, sudden death, and timers. No browser/renderer imports. |
| `FighterRig.ts` | Six original articulated mesh characters with tailored clothing, faces, hands, accessories, and distinct action poses. Shared primitives and per-instance materials. |
| `Stage.ts` | Three original geometric arenas, skyline, shops, bridge, foliage, signage, and collision-aligned platforms. Instanced background windows. |
| `Renderer.ts` | Three.js lighting, shadows, camera tracking/zoom, hit particles, real-time character portraits, interpolation, and GPU resource disposal. |
| `Input.ts` | Keyboard edge inputs and simultaneous two-player standard Gamepad API input. |
| `Audio.ts` | Original synthesized score and combat effects. No downloads. |
| `App.ts` | Selection, quick matches, local versus, arcade ladder, training, pause, results, HUD, settings, and bounded fixed-step loop. |
| `scripts/build-portable.mjs` | Creates a self-contained IIFE with inline CSS in `PLAY.html`. Works via `file://`, no server. |
| `scripts/package-arena.py` | ZIPs the playable game and editable source; verifies CRCs and writes SHA-256. |

## Combat behavior

Attacks have startup, active, and recovery ticks, and hit once per move. Equal-frame attacks can trade. Hitstop freezes movement and move timelines, while the match timer continues. Knockback grows with damage and is reduced by fighter weight. Airborne steering changes launch direction. A player gets a ground jump, one air jump, and one rising recovery per airborne sequence. Moving toward a close ledge grants a short pull-up; walking away does not snap the character back.

The original V/B/N/M controls remain P1's attack/special/shield/grab. P2 uses J/K/L/semicolon, with the old numeric aliases retained. Grounded direction+attack is a stronger attack. All fighters have different signature projectile meshes, trajectories, movement speeds and weights. This is a new platform-fighter ruleset, not a modification of Classic's health/round engine.

CPU recovery takes priority offstage. Three difficulty levels change timing, aggression and shielding. The arcade ladder advances after a human win and ends with Elon. Training freezes neither movement nor combat, but disables the clock/stock limit and leaves the dummy under P2 control.

## Rendering and portability

Arena never falls back to a 2D fighter. The meshes and procedural animation are authored in code; no separate model download or external animation license is needed. Character portraits are rendered from those same meshes. The dynamic camera fits both active fighters. Key lighting, shadows, face details, warm/cool contrast and player tags distinguish the combat plane from the environment.

Gameplay targets a 60 Hz fixed simulation; catch-up is capped after a stall. Display interpolation supports other refresh rates. High quality caps device pixel ratio at 1.75 and uses a 2048 shadow map. Performance mode disables shadow maps and renders at 1x pixel ratio while retaining contact shadows. Match teardown disposes owned stage, character, projectile, pickup and particle resources.

`PLAY.html` is a portable browser build. It is not a signed native executable. Its content security policy disallows network connections and external scripts. No models, fonts, images, scripts or music need to be fetched at play time. The separate source archive preserves the existing Electron packaging configuration for native builds by a maintainer.

## Testing and practical limits

Run `npm test`, `npm run build`, `npm run build:portable` and `npm run test:arena`. The browser suite can target the portable file with `SVS_PORTABLE=1`. The `SVS_CHROMIUM` environment variable selects an existing Chromium executable. `SVS_SANDBOX_DEVICES=1` replaces unavailable audio/controller devices in sandboxed CI; production code remains unchanged. Physical controller routing, audible output and native Windows execution still require a hardware check.

This release uses original stylized mesh characters and procedural animation, not motion capture or BattleShip's original character assets. It is intended to be playable and editable, with a complete new ruleset. Competitive balance, full controller menu navigation, mobile touch controls, online play, rollback, and commercial-quality authored model/animation assets are outside this release. The legacy Maul guest remains only in the existing source/Classic mode.
