# 2D → 3D conversion checklist

Tracks the conversion of Silicon Valley Smackdown's presentation from 2D pixel-art (Phaser) to
real animated 3D (Three.js), per the original brief (`Claude-Code-3D-Game-Conversion.md` if still
present, or the conversation that produced this branch). This spans multiple sessions; update this
file at the end of each one with exactly what changed and what's next, rather than re-deriving
status from scratch.

Branch: `feature/3d-presentation` (based on `feature/darth-maul-fighter`, which is itself ahead of
`main` by the "Add Darth Maul" and "bundled soundtrack" commits — not yet merged as of this pass).

## Orientation notes for picking this back up

- **A separate, uncommitted Unreal Engine 5.8 evaluation exists on disk** (`diagnostics/`,
  gitignored, ~153MB, dated 3 days before this pass — see `diagnostics/unreal-startup-investigation.md`).
  The brief this pass worked from explicitly mandates Three.js unless there is a concrete code
  blocker; none was found (this is a Vite/TS/Electron app with no Unreal dependency), so that
  Unreal spike was left untouched and not built on. Surface this to whoever picks this up next in
  case the intended direction has since changed.
- The Maul source `.blend`/textures live at `downloads/DARTH MAUL/` (gitignored, third-party,
  not redistributable — same handling as the existing sprite pipeline). Blender 5.2.2 LTS is
  installed at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.
- Read the "3D presentation" section of `README.md` first for the architecture map before editing
  `src/render3d/`.

## Phase status (phases as laid out in the original brief)

### Phase 1 — baseline + renderer/viewport integration: **done**

- Baseline captured before any change: `npm run typecheck && npm run test && npm run build` all
  clean on 177 tests (now 182 with new coordinate-conversion tests).
- Three.js (`three@0.186.0` + `@types/three`) added. No existing dependency conflicts.
- Compositing approach: a second `<canvas>` owned by `GameRenderer3D`, absolutely positioned and
  explicitly `z-index`ed *below* Phaser's own canvas (Phaser's `transparent: true`), kept
  pixel-aligned via `ResizeObserver`. Two real bugs were found and fixed only by taking an actual
  screenshot and looking at it, not by the automated checks passing:
  1. An absolutely-positioned element stacks above a statically-positioned one by default
     regardless of DOM order — the first attempt (3D canvas inserted before Phaser's in the DOM,
     no explicit z-index) rendered the 3D scene but completely hid the entire HUD. Fixed with
     explicit z-index on both canvases.
  2. A pure zero-elevation, zero-tilt orthographic camera sees a horizontal ground plane exactly
     edge-on, so the floor was invisible and fighters read as floating against the sky backdrop.
     Fixed with camera elevation + a downward tilt; see the "known approximation" note below.
- Single scheduler preserved: `GameRenderer3D.render()` is called once per Phaser frame, from
  `FightScene.renderFrame()` (itself called once per `update()`), never a second rAF loop.
  `InputManager` was confirmed to use only raw `window` keyboard listeners (no canvas-relative
  pointer coordinates), so the 3D overlay canvas is safely `pointer-events: none`.
- Regression-tested: full Playwright suite (30 specs, including every pre-existing 2D scene) run
  after the `transparent: true` + z-index change — 29 passed directly, 1 (`hit-stop freezes move
  progress...`) hit the pre-existing `networkidle`-under-load flake already documented in project
  memory (confirmed by re-running it alone: passes in 9s). Not a regression.
- Explicit 2D compatibility mode: `SaveData.render3D` (default `true`), toggle in
  **Settings → Display**. Added without breaking old saves — `isValidSave()` deliberately does
  *not* require the new fields, and `loadSaveData()` now spreads parsed data over
  `defaultSaveData()` so any pre-existing save missing them gets backfilled instead of wiped.

### Phase 2 — Maul animated and playable in one finished 3D stage: **done**, with named gaps

Concretely verified (`tests/e2e/render3d-compositing.spec.ts`, plus one-off diagnostic screenshots
kept as evidence in `docs/handoffs/evidence/`, then deleted from the test suite once no longer
needed):

- Real GLB export pipeline (`scripts/art/export_maul_glb.py`) producing a skinned, animated,
  textured `public/models/fighters/maul/maul.glb` (3.8MB, 11,257 triangles, 6 materials, 66
  deform bones keyframed out of 331 total, 8 named animation clips). Validated by decoding the
  GLB's raw glTF JSON + binary keyframe floats directly (see below), not just by the export
  command exiting 0 — doing exactly that caught a real bug (see next bullet).
- **Real bug found and fixed**: the first export attempt produced structurally-valid but
  numerically-broken animation — every clip's deform-bone keyframes were nearly identical
  regardless of pose, because `PoseBone.matrix` assignment ignores active constraints when
  computing local channels, so writing a target pose onto a constrained deform bone got silently
  overridden back toward rest. This is a *different* manifestation of the same rig's known
  "every pose looks identical" failure class that `maul_sprites.py` already had to work around
  once (documented in `[[project-maul-3d-sprite-pipeline]]`), hitting a different code path this
  time. Fixed with a two-pass bake (read constrained targets while constraints are live, mute
  constraints once, then write). Confirmed fixed by decoding actual keyframe float values for
  `hand.l`/`root.x` across `Idle` vs `Hurt` and seeing genuinely different numbers, plus
  confirming a never-explicitly-posed finger bone (the saber grip) stays correctly rigid relative
  to the hand.
- Loaded and playing in-engine (`FighterModel3D` + `AnimationController3D`-equivalent logic in
  `ModelRegistry.resolveClip`), verified via real screenshots:
  - Idle standing pose, recognizable (robes, horns, red skin, glowing double-bladed saber).
  - Real gameplay input → real animation change: holding the movement key visibly changes to a
    walking stride; tapping Basic visibly swings the saber into a strike pose distinct from idle
    (`docs/handoffs/evidence/3d-walk-p1.png`, `3d-attack-p1.png`; captured with a one-off spec
    using the same hooks documented in "Reproducing the verification screenshots" below, since
    kept permanently as a spec would mostly duplicate the mirror-match test).
  - **Both facings verified and one was wrong**: the first `baseYRotation` value (assumed from an
    uncertain guess at Blender→glTF Y-up axis conversion) made both fighters face directly *away*
    from each other. Caught from a cropped close-up screenshot, not assumed correct because the
    code "looked right" — fixed by measuring the correct value and documenting why the first
    guess was wrong, in `ModelRegistry.ts`.
  - **Independent mirror match verified**: P1 and P2 are separate `SkeletonUtils.clone()`
    instances with independent `AnimationMixer`s and independently-cloned tinted materials (P2's
    palette-swap tint doesn't affect P1). `tests/e2e/render3d-compositing.spec.ts` asserts both
    load and animate independently; the mirror-match screenshot shows both correctly and
    independently posed.
  - Shadow-casting key light + fill light confirmed working (visible ground shadows under both
    fighters in the screenshot evidence).
- One finished 3D stage: Castro Street — modular ground/sidewalk/building-with-depth/signage/prop
  geometry (not a background image on a plane), built from the existing `StageDef` palette/signs.
  Only this one stage has an entry in `Stage3D.STAGE3D_IDS`.
- Honest fallback confirmed: an unregistered fighter (e.g. Hunter) or `render3D: false` correctly
  falls back to the original 2D renderer end-to-end, asserted in the same spec file.

**Named gaps in this phase (not hidden, tracked here for next session):**

- Only 8 of a possible ~20 animation "roles" are distinct clips (`Idle`, `Walk`, `Jump`, `Crouch`,
  `Block`, `Hurt`, `Basic1`, `Attack`). The other 7 of Maul's 8 named moves (basic2/3, low sweep,
  aerial, dash thrust, Force Shove, Saber Parry, Force Choke, super) all currently play the shared
  `Attack` clip — matching, not exceeding, how `SpriteFactory.buildArtVisuals` already reuses its
  four attack cells across the same moves, but short of the brief's aspirational "distinct
  animations for [every move]" ask. Building bespoke clips is mechanical, not blocked — see
  "Adding another animation clip" below — it's a time tradeoff made explicitly this pass in favor
  of getting the full pipeline (export → load → deform → play → verify) working end-to-end first.
- No white damage-flash cosmetic on a 3D hit yet (2D's `FighterView` has one; `FighterModel3D`
  does not). Gameplay-legible via the hit-reaction pose change alone, but the flash is missing.
- The exported skeleton keeps all 331 source bones; only 66 are ever keyframed. Functionally
  harmless (glTF's `skin.joints` still only lists the deform-relevant ones for skinning; the extra
  bones are inert transform nodes) but not the "clean trimmed export skeleton" the brief describes
  as ideal. Trimming is a bounded, well-understood follow-up (see the "Known scope limit" comment
  at the top of `export_maul_glb.py`).
- **Camera/HUD vertical alignment is an approximation, not exact.** The coordinate system
  (`coordinates.ts`) and the *un-tilted* camera math were derived to make world y=0 land at
  exactly the same screen fraction as `GROUND_Y` does in the 2D canvas. That math was then
  invalidated by the camera-tilt fix (any camera rotation breaks the simple linear frustum↔world
  mapping an axis-aligned ortho camera has). The current tilt values were chosen by eye against a
  screenshot, not re-derived exactly for the tilted case. Practical effect: 2D-space effects
  (`EffectsView` hit sparks, projectiles) have **not been re-verified** to land exactly on a 3D
  fighter's on-screen position during an actual hit — only static idle/walk/attack framing was
  checked. A calibration pass (either exact tilted-camera math, or an empirical
  screenshot-diff-based tuning step) is needed before trusting hit-spark placement in 3D mode.
- Graphics settings exist (`GraphicsSettings.ts`: Low/Medium/High presets, pixel-ratio cap,
  shadow toggle) and are wired to a Settings-menu control, but have not been profiled against any
  real triangle/draw-call budget beyond Maul's own export report — there's only one stage and one
  fighter to measure yet.
- No dev diagnostics overlay (active renderer / frame time / draw calls / triangle count) is
  visible in-game yet. `Fight3DPresentation.diagnostics` already exposes draw calls, triangle
  count, and per-fighter load state (used by the e2e tests) — only the on-screen surface is
  missing.
- Performance has only been measured via a normal (non-GPU-forced) local browser session on this
  machine, not the target Windows laptop's RTX 4070, and not via the packaged Electron build. No
  frame-time distribution or resource-count measurement has been taken. Do not treat anything in
  this pass as a performance claim — only a functional one.

### Phase 3 — remaining roster, remaining stages, effects/previews in 3D, resource management: **not started**

Concrete next steps, roughly in the order the brief itself suggests:

1. **Sand Hill Road and Palo Alto** as real 3D stages (`Stage3D.STAGE3D_IDS` currently only has
   `castro_street`). Same modular-geometry approach, different palette/props per `StageDef`.
2. **The other six fighters** (Hunter, Kevin, Al, Priya, Chad, Elon). None have a source 3D model
   like Maul's — the brief allows "recognizable stylized 3D characters through a reproducible
   Blender or mesh-generation workflow, using current portraits/characterDetails.ts/
   characterRigs.ts/character data as references." This is a materially different (and larger)
   task than Maul's conversion, which started from an existing rigged model — it means *building*
   six rigged characters from scratch, not just exporting them. Budget accordingly; do not assume
   it is the same size of task as this pass.
3. Once more than one fighter exists, extend `ModelRegistry`/`Stage3D` and re-run
   `tests/e2e/render3d-compositing.spec.ts`-style checks per new fighter/stage combination.
4. **2D `EffectsView` (hit sparks, projectiles, pickups) still renders in 2D screen space** even
   in 3D matches. This mostly works because of the coordinate alignment `coordinates.ts` +
   `GameRenderer3D`'s camera were designed for, but see the camera/HUD alignment gap above — this
   needs the calibration pass first, then real verification that a projectile (Force Shove) and a
   hit spark land visually correctly on a 3D fighter during an actual match, not just at idle.
5. Character-select/versus-intro 3D previews ("Integrate 3D character previews into
   selection/versus screens where practical") — not attempted this pass; those scenes still show
   2D art for every fighter, including Maul.
6. Resource management audit once there's more than one fighter/stage to actually stress: bounded
   cache eviction, dispose-on-failed-load, dispose-on-scene-close-mid-load, no duplicate
   renderer/context per rematch. `FighterModel3D.dispose()`/`Stage3D.dispose()`/
   `GameRenderer3D.dispose()` exist and are called from `FightScene.cleanup()`, but have only been
   exercised by normal test teardown, not deliberately stress-tested (rapid rematch spam, load
   cancellation mid-flight, etc.).

### Phase 4 — regressions, real-hardware profiling, final build: **not started**

- Full 30/60/120/144Hz schedule + full input-scenario matrix (blocking high/low, guard breaks,
  grabs, projectiles, knockdown/get-up, supers, KO, rematch, pause/resume/alt-tab, fullscreen,
  training overlays) has only been exercised for the *pre-existing 2D path* (via the untouched
  existing e2e suite) — not specifically re-verified against the 3D path for Maul beyond the
  smoke-level walk/attack checks in this pass.
- No measurement has been taken on the actual Windows laptop with the RTX 4070; everything so far
  is a functional check in a normal local browser session, which the brief itself is explicit is
  not a performance claim.
- Desktop packaging (`npm run build:desktop`, `dist:win`, installer smoke test) has **not** been
  re-run against the 3D changes this pass. The GLB is under `public/`, which the existing
  `smackdown://` asset resolution already serves generically (same mechanism as the sprite PNGs),
  and the CSP (`desktop/assets.cjs`) was not touched — `connect-src 'self' blob:` should already
  cover a same-origin GLB fetch, but this is an inference, not a verified fact. Verify before
  shipping a desktop build with 3D enabled.

## Reproducing the verification screenshots

```sh
npx playwright test tests/e2e/render3d-compositing.spec.ts
```

writes `docs/handoffs/evidence/3d-maul-mirror-match.png` (kept in the repo as evidence, same
convention as the rest of `docs/handoffs/evidence/`; overwrite it by re-running the test rather
than assuming it's still current after a rendering change). For a closer look at one fighter, or
mid-animation, add a temporary spec
using the same `__e2eContext`/`__e2eGame` hooks (see `src/game.ts`, gated behind `?e2e=1`) the
existing spec uses: set `session.mode/p1Fighter/p2Fighter/stage` and `save.render3D`, stop every
other active scene (starting `'Fight'` from outside a scene does not implicitly stop whatever
else is running — this cost a debugging round-trip once already, see the compositing spec's
comment), then `game.scene.start('Fight')`.

## Validating a GLB without opening Blender

```js
// Node, no deps: parse the GLB container's JSON chunk directly.
const fs = require('fs');
const data = fs.readFileSync('public/models/fighters/maul/maul.glb');
let offset = 12, gltf, bin;
while (offset < data.length) {
  const len = data.readUInt32LE(offset), type = data.toString('ascii', offset + 4, offset + 8);
  const chunk = data.slice(offset + 8, offset + 8 + len);
  if (type === 'JSON') gltf = JSON.parse(chunk.toString('utf8'));
  else if (type.startsWith('BIN')) bin = chunk;
  offset += 8 + len;
}
// gltf.animations, gltf.skins[0].joints.length, gltf.meshes, etc.
```

Counts alone are not enough — decode a sampler's actual output accessor floats for a bone you
expect to move a lot (e.g. a hand) across two very different poses (e.g. `Idle` vs `Hurt`) and
confirm the numbers are actually different, and for a bone you expect to stay rigid relative to
its parent (e.g. a finger) confirm it moves only because its parent moved. This is what caught the
real bug in this pass; bone/bounding-box/material counts alone did not.

## Adding another 3D fighter (once a source model exists)

1. Export a GLB following `scripts/art/export_maul_glb.py`'s pattern (it's Maul-specific by name,
   not yet generalized to take an arbitrary character's mesh/bone names as arguments — that
   generalization is itself a small follow-up worth doing before the second fighter, rather than
   copy-pasting the whole script).
2. Add one entry to `MODEL_REGISTRY` in `src/render3d/ModelRegistry.ts`: GLB path, `modelScale`
   (compare a screenshot against the existing roster's on-screen height, don't assume), a measured
   `baseYRotation` (verify both facings with a close-up screenshot — do not assume the same value
   as Maul; different export tools/rigs may have different forward-axis conventions), and the
   clip-name mapping.
3. `FightScene` and everything else picks it up automatically once both fighters in a match have a
   registry entry (`has3DModel`) and the stage does too (`has3DStage`) — no other code changes.

## Adding another animation clip to an existing fighter's GLB

Add an entry to `CLIPS` in `export_maul_glb.py` (a list of `(frame, pose_name)` pairs, reusing an
existing `POSES` entry from `maul_sprites.py` or a new one added there), re-run the export, then
add the clip name to the relevant `AnimRole` in that fighter's `ModelRegistry` entry.
