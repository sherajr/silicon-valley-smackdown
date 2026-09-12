# Prompt for Codex — Silicon Valley Smackdown, round 3

Paste everything below this line into ChatGPT/Codex. The 17 individual transparent PNGs from this round are genuinely transparent (verified) and are now integrated into the dev Animation Viewer with a real per-pose loader. Short status + a concrete next ask.

---

Same repo: **https://github.com/sherajr/silicon-valley-smackdown**, branch `codex-handoff-pass-2`. Round 2's fixes (block/hitstun render bugs, knockback/jump-apex tuning, corrected evidence) are unchanged and still verified; this round is additive.

## What happened with the art delivery

Your first attempt at "individual transparent PNGs" (in a folder literally named "Transparent Background Image") was not actually transparent — checked via the PNG IHDR color-type byte, all 17 files were `02` (RGB, no alpha), i.e. flattened onto solid white. I built an ffmpeg colorkey workaround for that set, but you then resent a second delivery ("Sorry, here are the sprites with a transparent background") that IS genuinely transparent — IHDR color-type `06` (RGBA) on all 17, and I additionally verified real alpha data (not just a declared-but-unused channel) by compositing every file over a magenta test background and inspecting the result: clean cutouts, no holes in white sneakers/iPad/laptop screen, no leftover background. That second delivery is what's integrated below; the colorkey workaround was discarded.

## What's integrated now

- Each of the 17 poses trimmed to its tight opaque bounding box (mechanical, via ffmpeg's alpha-channel + cropdetect, not eyeballed) — `art/sprites/hunter/frames/*.png`, copied to `public/sprites/hunter/` for runtime loading. Untrimmed 500x500 originals kept at `art/sprites/hunter/raw/` for provenance.
- A real sprite manifest + Phaser loader (`src/render/realSprites.ts`): each pose records its trimmed (w, h) and a pivot origin (bottom-center of the trim, i.e. `(0.5, 1.0)` — the correct convention for any pose whose lowest opaque pixel is its ground contact, which held for every pose checked).
- Wired into `?animviewer=1` (`src/scenes/AnimationViewerScene.ts`) with a new `R` key: toggles "prefer real art" on/off per fighter. When on (default), Hunter shows real art for every clip that has a mapped pose; everything else (every other clip for Hunter, every clip for every other character) automatically falls back to the existing procedural rig — no partial/broken state, the info readout always says which one is showing and why (e.g. `rig (real art available, toggled off)` vs `rig (no real frame for this clip)`).
- Clip → pose mapping (`HUNTER_CLIP_FRAMES` in `realSprites.ts`): idle→ready, dash→dash, crouch→crouch, victory→victory, block→[block, block_2], hitstun→[hit_reaction, hit_stun_hold], knockdown→[knockdown_fall, knockdown_down], wakeup→[wakeup_stir, wakeup_rise], jump→[jump, jump, jump_fall] (rising frame reused for the apex slot — only rise/fall were delivered), special→ipad_toss, basic1 and forwardBasic→strike (one delivered punch pose stands in for both; their actual reach/damage still differ in the sim, the art doesn't yet show it).
- Verified in a real browser (Chromium via Playwright, screenshots in `docs/handoffs/evidence/real-sprites/`, script at `tests/e2e/real-sprite-check.ts`): all 17 poses render with the correct texture and no failed asset loads; foot/ground-line alignment is accurate for every standing, crouching, dashing, and reacting pose, and for the fully-flat knockdown pose; the `R` toggle correctly swaps to the rig and back; a character with no real art (Kevin) is unaffected.
- Full suite still green: `npm run typecheck` clean, 76 unit tests, 11 e2e tests, production build succeeds (real PNGs confirmed present in `dist/sprites/`).

## What's honestly not done / known imperfect

- **Not wired into live gameplay.** This is Animation Viewer only. `FightScene`/`SpriteFactory` still render Hunter with the procedural rig in an actual match. Wiring it in requires a real decision on in-game pixel scale (these are high-res source art, ~250-470px per pose; the rig renders at native ~92px-tall canvas at scale 1) that hasn't been made — `REAL_SPRITE_SCALE = 0.5` in the viewer is a rough eyeball match for side-by-side comparison, not a gameplay value.
- **Hit/hurtbox overlay alignment for real art is unverified**, not just uncalibrated-and-noted: watching `basic1`'s hitbox overlay in the viewer, the red hit box sits near the torso, not at the extended fist where the real art's punch actually reaches. The box positions come from the same sim-unit data as the rig (which does line up, since the rig canvas is drawn at sim-unit scale) — real art was never at that scale to begin with, so this needs an actual calibration pass once a gameplay scale is chosen, not just a bigger/smaller multiplier.
- **One found art imperfection, not a code bug:** the knockdown clip's mid-fall frame (`knockdown_fall`) floats visibly above the ground reference line in the viewer — its lowest drawn pixel is the character's kicked-up foot, not a ground contact, unlike every other pose checked (including the fully-down `knockdown_down`, which sits right on the line, and `jump_fall`'s landing frame, which also lands right on the line). Cosmetic, only visible mid-transition, but real.
- **Three attack moves (basic1, basic2, basic3, forwardBasic) still share one or zero real poses** — only "strike" was delivered, reused for two of them; basic2/basic3/crouchBasic/jumpBasic/downSpecial/grab/super have no real art and fall back to the rig.
- **No real art for any character besides Hunter.**

## The ask, if you want to keep going

No code changes needed from you. If there's another art round in you: **Kevin's matching 17-pose set**, same contract as this round (individually transparent PNGs, same pose names) — that would put real art on both sides of the one fight the brief asked to polish first (Hunter vs Kevin, Castro Street), before spreading to the other four characters. Not urgent, not blocking anything on my end — the procedural rig is a genuine, working fallback, not a placeholder that looks broken.
