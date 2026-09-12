# Prompt for Codex — Silicon Valley Smackdown, next contribution

Paste everything below this line into ChatGPT/Codex.

---

I'm the owner of a private GitHub repo: **https://github.com/sherajr/silicon-valley-smackdown**. It's a browser fighting game (TypeScript + Vite + Phaser 4), Mortal-Kombat/Tekken/Smash-inspired, satirizing Silicon Valley tech culture. Claude Code just finished an implementation pass on it. I need your help with two specific things this round: extending a Hunter art reference sheet, and critiquing a recorded fight for weight/impact. Please read this whole prompt before doing anything — it tells you exactly what's already done, what evidence is attached, and what "done" looks like for your two tasks.

## A. Goal and current state

**The game:** six fighters (Hunter, Kevin, Al, Priya, Chad, Elon-as-boss), three stages (Castro Street, Sand Hill Road, Palo Alto), best-of-three rounds, health bars, enclosed arenas. Arcade ladder + Local Versus as modes; Competitive/Party as rulesets (Party keeps the existing pickups, Competitive turns them off — same core combat either way). Local two-player on one keyboard, remappable, with a numpad and a no-numpad "laptop" preset for P2.

**What received the full treatment this pass, and what didn't:** the brief this session worked from asked for a specific "one excellent fight" quality bar on Hunter vs. Kevin on Castro Street, then to expand. This pass focused on *engine-wide* correctness and depth (bugs, animation, input, resolution) rather than a single-fight art pass, because the highest-value, concrete work available without an image-generation tool was there. Concretely, this session:

- **Fixed a real, confirmed bug** in the music transport (`src/audio/AudioManager.ts`): `setCustomTrackFile()`/`clearCustomTrack()` both called `playMusic()` with the *same* scene track id as before, which tripped `playMusic()`'s own same-track early-return guard — so picking a new local audio file (or clearing back to the built-in score) silently left the *old* backend playing while only the Settings label changed. Fixed by tracking playback backend identity (synth-by-track-id vs. a specific recorded URL) separately from the scene's track id. Added `src/audio/AudioManager.test.ts`, a real regression test (fails on the old code, passes on the fix) that drives `AudioManager` through original score → file A → file B → original score, across paused/stopped states, using lightweight in-file fakes for the Web Audio/`<audio>` surface (this project's Vitest environment is plain `node`, not jsdom).
- **Replaced several frame-zero animation holds with real multi-pose sequences**, all procedurally generated (no new art assets) in `src/render/poses.ts`/`characterRigs.ts`: dash now has its own low, forward-leaning sprint pose (previously it silently reused idle — a specifically-flagged defect from the prior review); jump picks rise/apex/fall frames from the sim's actual `vy` (not a timer); block and crouch show a brief impact-flinch pose while a real hit is landing; hitstun, knockdown, and wakeup each progress through two real poses over time (tracked via a presentation-only "time in this state" counter in `FighterView.ts`, reset whenever the sim's `state` field changes — never fed back into the sim).
- **Added real browser combat-contact coverage** (`tests/e2e/combat-contact.spec.ts`). The prior review's most important finding was that existing browser tests proved an attack *state* started but never that it actually connected. The new tests use only real key holds/presses (walk into range, then attack) and assert on the simulation's own resulting health/guard/state changes: an unblocked P1→P2 hit, a mirrored unblocked P2→P1 hit (opposite facing, numpad input), a blocked hit (chip damage only — asserted to be much smaller than the unblocked case, not just "some damage"), and a grab that forces a real knockdown state. All four pass; `--legacy` wasn't needed.
- **Bumped the presentation canvas to a crisp 960×540 physical resolution** via Phaser's `scale.zoom: Phaser.Scale.ZOOM_2X` (`src/game.ts`). This is a pure backing-resolution multiplier — `BASE_WIDTH`/`BASE_HEIGHT` (still 480×270) and every hitbox/speed/jump-height calculation are untouched; only the canvas got sharper. Verified by re-running the *entire* e2e suite, including the exact-timing combat-contact tests, unchanged and passing at the new resolution.
- **Found and fixed two real UI bugs by reviewing the new higher-resolution screenshots** (see evidence below): `CharacterSelectScene`'s per-player info text was rendered *behind* the standing preview sprite, so e.g. "KEVIN" was visually clipped to "VIN" by the character's own body; and `HUD`'s round-end banner ("K.O. — P1 WINS", "ROUND 2", etc.) shared almost the exact same y-coordinate as `StageView`'s centered background sign text, so they visually collided on every round transition. Both fixed and re-verified via a fresh screenshot capture.
- **Added a dev-only Animation Viewer** (`src/scenes/AnimationViewerScene.ts`, reachable at `?animviewer=1`) that steps through every clip (idle/walk/dash/jump/crouch/block/hitstun/knockdown/wakeup/victory/ko/portrait + all 10 move kinds) for all six fighters, using the exact same textures and hit/hurtbox data gameplay uses — no separate rendering path. Supports frame stepping, character switching, facing flip, and a pivot/hurtbox/hitbox overlay. Verified in a real browser; in the process, found and fixed a real scale-mismatch bug in the overlay math itself (the overlay boxes weren't scaled to match the viewer's enlarged sprite).
- **Saved your two Hunter references** to `art/reference/`: `hunter_combat_key_poses.png` (the six-pose key-pose sheet) and `hunter_original_office_illustration.png` (the original identity illustration). I looked at both directly.

**What this pass explicitly did *not* do**, so you don't assume it: no new hand-authored or AI-generated sprite art was integrated (Hunter's in-engine rig is still the same procedural rectangle-rig-plus-detail-painter system as before, just with more pose variety); no real sprite-atlas/manifest loader was built (I judged that speculative — there's no art to load yet, so I didn't want to ship untestable loading code; the Animation Viewer above exists specifically so that once real frames exist, wiring them in and verifying alignment is fast). No stage background art was replaced (still procedural rectangles in `StageView.ts`). Audio *content* (the actual mix/SFX layering) was not critiqued by ear — see the limitations below.

## B. Accessible, reproducible snapshot

- Repo: `https://github.com/sherajr/silicon-valley-smackdown` (private).
- Branch: `codex-handoff-pass-2`, commit `2c974bb99953d77965315cfe9f3d465187d22823` — **pushed to origin**, so `git fetch && git checkout codex-handoff-pass-2` from that URL gets you exactly this state. (Base branch `main` is at `6db7e8a01909e3e425f1990afa78dc76e50ebab3`, unchanged.)
- No live preview URL exists (this is a static Vite app with no hosting configured). To run it:
  ```bash
  npm install
  npm run dev          # http://localhost:5173, live dev server
  # or
  npm run build && npm run preview   # production build + local static server
  ```
- Node 22.23.1, npm 12; Playwright `@playwright/test` 1.63.0 (`npx playwright install chromium` once, if browsers aren't already installed).
- Verify: `npm run typecheck && npm run test && npm run build && npm run test:e2e` — all pass as of this commit (68 unit tests, 11 e2e tests).
- If your workspace can't reach GitHub or check out a branch: the repo has no other distribution mechanism prepared (no zip/patch bundle was created, since the branch is pushed and reachable). Ask the owner to attach a `git archive` or `git bundle` of `codex-handoff-pass-2` if you need the source without git access. The two files under `art/reference/` and everything under `docs/handoffs/evidence/` are the only large binary assets — small enough (a few MB total) to attach directly if needed.

## C. Evidence

All paths below are relative to the repo root, on `codex-handoff-pass-2`.

- **`art/reference/hunter_combat_key_poses.png`** — the six-pose key-pose sheet (READY, STRIKE, IPAD TOSS, BLOCK, HIT REACTION, VICTORY). This is your own prior output, being handed back to you as the starting point for task 1 below.
- **`art/reference/hunter_original_office_illustration.png`** — the original identity illustration.
- **`docs/handoffs/evidence/01-title.png` through `16-results.png`** — a full menu-to-results screenshot sequence at 960×540 (title, main menu, character select, stage select, versus intro, neutral idle, dash, jump, projectile, an unblocked attack landing, a blocked-attack impact flinch, a grab-forced knockdown, wakeup, a pickup collected, K.O., results). Captured via real input (`tests/e2e/evidence.capture.ts` — not part of the normal test run; see the README's QA record for how to rerun it).
- **`docs/handoffs/evidence/gameplay.webm`** — ~29 seconds of the same real-input session as one clip: menu navigation, character select, a dash, a jump, a special (projectile), an attack landing, a blocked attack, a grab into knockdown/wakeup, a pickup, and a K.O./results screen. **This video has no audio track** — Playwright's video capture doesn't record system audio, and I (Claude Code) have no audio-listening tool in this environment, so I could not evaluate sound/mix quality myself. If you can watch video but not listen (or vice versa), please say so explicitly rather than guessing at what wasn't checked.
- **`docs/handoffs/evidence/viewer-01-idle.png` through `viewer-07-overlay-off.png`** — the new Animation Viewer in action: idle, walk, jump (two different frames selected by vy), a move (basic2) with facing flipped and the hit/hurtbox overlay visible and correctly aligned, switching to a second character (Kevin), and overlay toggled off.
- **What this evidence demonstrates:** attacks visibly connect and reduce health (screenshots 10, 15; the HUD health bar and chip-damage trail both move); blocking visibly differs from taking a hit (screenshot 11 vs. 10 — smaller health change, guard bar drops); a grab produces a real knockdown→wakeup cycle (12–13); the K.O./results flow completes and text is now legible against the stage background (15–16, post-fix); the character-select info panel is now fully legible (03, post-fix); the animation viewer's overlays track the enlarged sprite correctly (viewer-05, post-fix).
- **What still needs live human inspection, which I could not do:** whether the fight *feels* weighty/responsive to actually play (I can prove contact and state transitions programmatically, but "does this feel good" needs a human or your review of the video — see task 2); audio mix/levels (no audio in the captured evidence, no listening tool available to me); controller/gamepad behavior (no physical controller available in this environment — untested, not just "should work").
- **No open reproducible defects are being reported this round** — the concrete bugs I found (audio transport, the two UI z-order/collision issues) were fixed and re-verified within this same pass, not left open.

## D. Two tasks for you

### Task 1 — Extend the Hunter key-pose reference sheet with the poses the engine now actually needs

**Why it matters:** the engine-side animation work this pass (dash, jump rise/fall, block/crouch impact flinch, hitstun hold, knockdown fall, wakeup stir) is currently expressed only through the existing *procedural rectangle rig* — real pose variety, but still primitive-shape art, not the illustrated style of your reference sheet. Before I (Claude Code) can build a real sprite loader and replace the rig with actual illustrated frames, I need reference art for the *specific new poses* the engine now uses, in the same successful style/format as your original six-pose sheet — which is exactly the kind of image-generation work suited to you, not me.

**Inputs:**
- `art/reference/hunter_combat_key_poses.png` — match this art style, palette, and Hunter's established silhouette exactly.
- `art/reference/hunter_original_office_illustration.png` — Hunter's ground-truth identity.
- Hunter's locked identity checklist (do not deviate): spiky, swept-up chestnut hair; warm expressive face; short brown stubble; large charcoal over-ear headphones; gray hoodie with **long** gray sleeves, cuffs, hood, and drawstrings; dark navy quilted puffer vest over the hoodie; blue fitted jeans; white-gray sneakers. Side-view fighting stance, readable three-quarter face, same body proportions/scale as the existing sheet in every new panel.
- Palette (exact hex, from `src/data/characters/hunter.ts`): skin `#e8b48a`, hair `#4a3324` (chestnut brown), hoodie `#9098a3`, puffer vest `#262a33`, jeans `#3b5a86`, cyan accent (rim light/sneaker/prop glow) `#59c1d6`, outline `#151018`.

**Requested poses** (new panels, same sheet style/labeling as the original — a second "Hunter Combat Key Poses II" sheet, or an extension of the first if you'd rather regenerate it as one larger sheet):
1. **DASH** — a low, forward-leaning sprint burst. Distinctly different silhouette from READY: weight forward, legs in a running stride, not just a mirrored idle stance.
2. **JUMP RISE** — legs tucking up under the body mid-launch, arms driving upward.
3. **JUMP FALL** — legs extending back down toward landing, slight forward lean. (READY or a neutral tuck already covers the apex — no new panel needed there.)
4. **BLOCK IMPACT** — like the existing BLOCK pose, but a sharper flinch/recoil, showing an attack is landing on the guard right now.
5. **HITSTUN HOLD** — a settled, dazed hold — less extreme than the existing HIT REACTION panel (which reads as the sharp initial snap), representing the moment after that snap while stun continues.
6. **KNOCKDOWN FALL** — mid-fall, tilting backward/down, not yet flat on the ground.
7. **KNOCKDOWN DOWN** — flat on the ground.
8. **WAKEUP STIR** — propped up on one arm, just starting to rise.
9. **WAKEUP RISE** — rising into a low crouch stance, about to stand.
10. **CROUCH** — a basic low fighting stance.
11. **CROUCH BLOCK IMPACT** — crouch stance + guard flinch.

**Format:** match the original sheet's presentation exactly — same canvas approach, flat gray background, each pose labeled underneath in the same title style. This is explicitly a **concept/key-pose reference deliverable**, not a production-ready transparent sprite atlas — I know the difference and will do the crop/rescale/pivot-alignment/transparency work myself when integrating. Save as a new PNG (any filename you like) — I'll place it under `art/reference/` and take it from there. Do not attempt to match my engine's literal 128×92px/pivot-at-(52,86) internal texture grid; draw at whatever resolution reads clean, consistent proportions across panels matter far more than exact pixel dimensions.

**What I'll do with it (so you know the integration isn't on you):** inspect every panel for consistency with the existing sheet and Hunter's identity checklist, then personally crop/align/build the actual game-ready frames and wire them into a real sprite loader (which doesn't exist yet — see "what this pass did not do" above) with a procedural-rig fallback, verified through the Animation Viewer and a fresh gameplay capture.

### Task 2 — Critique the recorded fight for weight and responsiveness, from the evidence, not a live session

**Why it matters:** I can prove attacks connect and states transition correctly (that's what the new e2e tests do), but "does this fight feel good" is a judgment call I can't fully make without a human playing it — and the brief this session worked from explicitly calls this out as something to test, not conclude from passing automated checks.

**Inputs:**
- `docs/handoffs/evidence/gameplay.webm` (silent — see the note in section C) and the numbered screenshots, especially `06` (neutral idle), `07` (dash), `10`–`13` (attack/block/knockdown/wakeup sequence).
- Relevant source for you to read alongside the video (all under `src/`): `sim/constants.ts` (hit-stop frames, knockback values, combo scaling), `data/moveHelpers.ts` (`effect()` — where per-move damage/knockback/hitstun/blockstun/hitstop defaults are derived), `data/characters/hunter.ts` and `kevin.ts` (their actual move data), `render/poses.ts` and `characterRigs.ts` (the pose work described above), `render/moveTimeline.ts` (how a move's sim frame maps to a pose index), `render/EffectsView.ts` (hit sparks/screen shake).

**What to return:** a written critique of what currently reads as weak/floaty/unclear in the Hunter-vs-Kevin exchange shown in the video and screenshots — startup/recovery pacing, hit-stop duration, knockback magnitude, whether the block-impact/hitstun poses added this pass actually read clearly at a glance, whether the dash and jump changes look distinct enough from idle. Where you can point to a **specific, narrowly-scoped numeric or logic change** in the files above (e.g. "`HITSTOP_LIGHT` in `constants.ts` is too short for a hit this size, try X" or "`hunter_basic3`'s knockback in `hunter.ts` is inconsistent with its damage relative to `basic2`"), propose it directly — I can apply and verify numeric/logic tweaks like that against the existing test suite and a fresh evidence capture without needing you to have run the code yourself. Don't propose visual/art changes here — that's task 1's job.

## E. Instructions for you (the receiving Codex session)

1. Check your actual capabilities honestly before starting: can you view the two reference PNGs and the video/screenshots? Can you generate/return image files? Say so plainly, and note anything you can't do (e.g. if you can't process video, say that rather than guessing at what's in it from the filenames).
2. Do both tasks to the extent your capabilities allow. If you have a coding workspace and want to attempt any narrowly-scoped numeric change from task 2 directly in the repo, you may do so on a new branch — but only if you can actually verify it (run `npm run test`, ideally `npm run test:e2e`) before handing it back; otherwise, propose the change as a diff/description instead of committing unverified code.
3. Return: (a) the new reference art file(s) for task 1, (b) your written critique and any proposed specific changes for task 2, and (c) a short `CLAUDE_FOLLOWUP.md` (or just a clearly-marked section in your reply) telling me exactly which files you're returning, what each one is for, and — for any proposed code change — the exact file/line and the specific before→after, so I can apply, run the verification commands above, and capture fresh evidence rather than re-deriving your intent.
4. Don't assume you can see my filesystem, browser, or a running copy of the game beyond what's described and attached here. Don't assume file paths on your machine are accessible to me — attach deliverables directly, or give me a commit/branch on the repo above if your workspace lets you push there.
