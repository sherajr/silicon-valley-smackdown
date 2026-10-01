# Arena Edition validation

> This note records the original Arena Edition release. The gameplay pass that followed (physics, grabs and throws, six distinct move sets, combos, practice tools, CPU) has its own validation results in [arena-gameplay-pass.md](arena-gameplay-pass.md). The graphics pass after that (the surface-flicker fix, lighting, arenas, fighters, effects, menu and HUD, quality presets) is documented, with its measurements and test results, in [arena-graphics.md](arena-graphics.md).

Built from upstream `595f6d4`, validated September 25, 2026.

| Check | Result |
| --- | --- |
| `npm test` | 212 tests passed across 15 files, including 30 new Arena simulation cases. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. The bundle-size warning concerns the existing Classic bundle and Three.js. |
| `npm run build:portable` | Passed. Self-contained HTML with inline IIFE/CSS, no runtime imports. |
| Arena browser checks | All nine scenarios passed across production-web and direct-file runs. |
| Offline launch | Passed with HTTP/HTTPS blocked; no remote requests were made. |
| Resource lifecycle | Passed: repeated stage/roster changes return to the same geometry/texture budget. |
| Classic browser regression | Four checks passed: startup, fresh-input title navigation, menu/help/credits/settings navigation, and full versus match/rematch. |

The browser checks exercise selection, keyboard movement and double jump, melee from both player bindings, projectile creation, rising recovery, animated meshes for all six fighters, all three arenas, pause/help/resume, a final stock and rematch, training, arcade progression, synthetic standard controller routing, automatic pause on blur, and GPU resource disposal.

Visual review covered the home screen, roster selection, and each arena. Raising the lower platforms fixed character-head occlusion. A failed recovery assertion originally sampled vertical velocity after the jump apex on a software-rendered browser; the final check captures the recovery impulse at the moment the real keyboard input starts the move.

Tests ran on Linux Chromium with software WebGL rendering. Native audio device output was muted during browser automation. Controller state was supplied synthetically because this sandbox cannot open the hardware device monitor. A real controller, native Windows executable, audible speaker output, and frame rate on Sheraj's RTX 4070 laptop were not tested. The delivered artifact is the direct-file browser build.

The original Classic mode is retained separately and its unit suite is included in the 212 tests. Its extensive historical QA notes live in `classic-guide.md` and should not be confused with validation of this release.
