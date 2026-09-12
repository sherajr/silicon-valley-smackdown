# Combat review: Hunter versus Kevin

Reviewed 12 September 2026. Source: `codex-handoff-pass-2`, commit `7d8e5facc4d3cd67c618198cd50e67dee4cbb48d`. Its only differences from the requested `2c974bb99953d77965315cfe9f3d465187d22823` are README/handoff documentation; the game code and evidence are the same.

The most useful next pass is to repair the connection between combat events and reaction playback, then try a small Hunter knockback adjustment. Raising every hit-stop value would leave the underlying reaction problems in place.

## What I actually checked

- Viewed both original Hunter references and the new generated sheets.
- Inspected the supplied video through decoded sequential frames, including full-rate sequences around movement and contact, and inspected the named screenshots directly.
- Read the move data, simulation, frame mapping, effects, reaction playback, and evidence-capture source.
- Ran the current unit suite: **68 tests in 8 files passed**.
- Ran a method-level reproduction harness against the actual current `CombatSim` and `FighterView` code. Phaser drawing calls were mocked. Results are in `probe-results.json`; the portable harness is `probe.cjs`.

I did not run a live browser playtest, rerun the browser suite or production build, use a physical controller, or listen to the game. The supplied video has no audio stream. No game source changes were made or pushed. The numeric candidate below was exercised against a cloned character definition in the simulation; it has not been integrated or playtested.

The actual clip is **24.4 seconds, 800 × 450, 25 fps**, according to its media metadata. Each captured frame spans 40 ms. This is enough to inspect broad motion and state transitions, but too coarse to infer precise input latency or reliably distinguish three from four 60 Hz hit-stop frames.

## What the supplied exchange communicates

At approximately 8.5–10 seconds, the displacement makes movement and the jump clear. The dash's short burst is less easy to distinguish as its own action at this capture rate. The jump has a quick, bounded arc; I do not see evidence supporting a blanket increase in gravity. The source gives Hunter approximately 33 simulation steps of airtime, or 0.55 seconds, and a peak near 83.7 simulation pixels. Keep that physics baseline while fixing pose selection and evaluating the new reference poses.

At roughly 12.6–12.8 seconds, the unblocked punch produces a conspicuous white defender flash followed by backward displacement. Contact reads, but the flash communicates more of the hit than the settling reaction does. The source-level clock/reset issues below provide a concrete reason to fix that behavior before lengthening all stun or freeze durations.

Around 13 seconds, the guard and smaller displacement distinguish the blocked exchange to some degree. However, the newly authored guard-impact pose is not actually wired to a successful block. That is a confirmed implementation problem, not a preference about the illustration.

The capture is a scripted sequence with long neutral pauses rather than a sustained fight. It cannot establish whether extended offense, defense, combos, or repeated rematches are enjoyable. It also does not demonstrate the claimed throw/wakeup sequence or a completed match/results transition. Those limits matter when choosing tuning changes.

## 1. Confirmed: successful blocks select the wrong reaction

Relevant locations at this commit:

- `src/scenes/FightScene.ts:225`: `case 'blocked'` creates a spark and sound but does not notify the fighter view of a block impact.
- `src/render/FighterView.ts:82`: the block-impact timer is triggered by `hitFlash`, only when state is `block`, `crouch`, or `guardbreak`.
- `src/sim/CombatSim.ts:773`: a successful ordinary block has already changed the defender's state to `blockstun`.
- `src/render/FighterView.ts:137`: `blockstun` shares the normal `hitstunFrames` branch.

The probe drove an actual Hunter jab into standing guard and crouching guard. Both produced a `blocked` event, 0.72 chip damage, state `blockstun`, selected frame `hitstun0`, and block-impact timer **0**. Increasing `BLOCK_IMPACT_HOLD_MS` will not fix a timer that is never triggered.

**Required before → after:**

1. Before changing the defender's state in `applyBlockedHit`, capture whether the successful guard was standing or crouching.
2. Extend the `blocked` event in `src/sim/events.ts:6` to carry that stance. This is presentation metadata; preserve current damage and defense rules.
3. In `FightScene.handleEvents`, send a typed impact notification to the correct `FighterView`. Keep blocked-impact notification distinct from the white damage flash.
4. Give `blockstun` its own frame-selection branch. Use `blockFrames[1]` for standing impact and `crouchFrames[1]` for crouching impact, with the captured stance retained until the reaction ends. Do not infer stance solely from `f.state`, which is now `blockstun`.
5. Treat guard break as a broken defense/recoil, not as an ordinary successful guard pose.

Verify the actual selected frame and stance after real blocked contacts, not just a decrease in guard gauge. Cover both players and both guard heights. The existing contact tests are useful, but their health/guard assertions cannot catch this rendering error.

## 2. Confirmed: reaction time continues through hit-stop and does not reset on every hit

Relevant locations:

- `FighterView.ts:75–83`: the elapsed reaction clock resets only when the state name changes and otherwise accumulates render `deltaMs`.
- `FightScene.ts:275–278`: full render delta is passed to both fighter views even when the simulation is frozen.
- `CombatSim.ts:141–149`: hit-stop returns without advancing the simulation frame or state timers.

In the probe, nine freeze steps left the simulation frame at 0 and the defender's stun timer at 20. Nevertheless, the view accumulated **150 ms** and changed from `hitstun0` to `hitstun1`. Thus the sharp impact pose can finish while combat itself is still frozen.

A separate probe supplied another hit while the fighter was already in `hitstun`. The view stayed in `hitstun1` because the state name had not changed; its elapsed clock reached 196.7 ms instead of restarting the snap.

**Required before → after:**

- Before: reaction progress follows wall-clock render delta. After: reaction progress follows actual advanced simulation ticks. `sim.frameCount` already excludes freeze steps. Track its delta centrally, convert ticks with `1000 / SIM_FPS`, and reset that tracking on round changes. Both fighter views must receive the same progression value.
- Before: a new hit only starts a fresh snap if the state name changes. After: every new applicable hit/throw/guard-break event resets the appropriate reaction, even if the state remains `hitstun` or `knockdown`. Route the existing hit event into that reset; do not rely on the boolean damage flash as the entire reaction model.
- Ensure Phaser's independently playing locomotion animations also respect gameplay hit-stop and pause. Simply passing zero delta to this custom view method does not stop an animation managed by Phaser itself. Keep non-gameplay selection previews independent.

Retain the current 120 ms hitstun snap, 180 ms knockdown fall, and 140 ms wakeup stir initially. Judge their durations only after their clocks and reset signals work correctly.

Also make white-flash duration independent of refresh rate. `FighterView.ts:95–97` currently uses four render updates: nominally 66.7 ms at 60 Hz but 27.8 ms at 144 Hz. Replace that counter with an explicit elapsed-time duration; start at **50 ms of active, unpaused presentation time**. Reset on each real damaging hit, and do not advance it while the player has paused the game. This 50 ms choice is a tuning proposal, not a tested visual improvement. Keep it separate from the simulation-driven pose clock so long hit-stop does not force an all-white silhouette throughout the freeze.

Verify identical reaction progress for equivalent simulation steps at different render rates, a frozen snap during hit-stop, a fresh snap on repeated hits, and pause/resume without jumping to the end of an animation.

## 3. Simulation-tested candidate: reduce pushback on Hunter's two opening jabs

The current defaults in `src/data/moveHelpers.ts:32` give Hunter's first two basics horizontal knockback of **3.28** and **3.64**. The third basic explicitly uses **6**.

I placed Hunter at x=200 and Kevin at x=239 on open ground, with Kevin idle. I requested basic1, basic2, and basic3 at the first neutral opportunity after each move. This uses normal simulation move processing and collision, not injected damage.

| Result | Current data | Candidate below |
| --- | ---: | ---: |
| First jab knockback x | 3.28 | 1.5 |
| Second jab knockback x | 3.64 | 1.8 |
| Third basic knockback x | 6 | 6 |
| Distance when third basic starts | 77.96 | 57.57 |
| Hits that connect | 2 | 3 |
| Kevin's total health loss | 14 | 24.2 |

In the baseline, early pushback moves Kevin beyond the third attack's reach. In the candidate, all three attacks contact; the third applies 10.2 damage after the existing combo scaling.

This is a practical candidate for making the basic string more coherent. It does **not** prove an inescapable true combo, balance against a defending player, or compatibility with every starting distance. It was tested against an idle opponent without walls. The current combo counter can span gaps; do not treat its number as proof of continuous hitstun.

Apply only these two explicit overrides in `src/data/characters/hunter.ts:31,34` for an A/B playtest:

```diff
-      hits: [window(4, 3, box(18, -44, 24, 16), effect(6, 'mid'))],
+      hits: [window(4, 3, box(18, -44, 24, 16), effect(6, 'mid', { knockback: { x: 1.5, y: 0 } }))],

-      hits: [window(5, 3, box(18, -42, 26, 16), effect(8, 'mid'))],
+      hits: [window(5, 3, box(18, -42, 26, 16), effect(8, 'mid', { knockback: { x: 1.8, y: 0 } }))],
```

Keep the third hit, global knockback formula, damage, startup, recovery, and gravity unchanged in this comparison. Verify both facings, several distances, walls, and a defender holding block after the first hit. Reduced knockback also reduces block pushback because the current simulation derives it from the same vector, so check guard pressure and ensure the change does not introduce a lockout.

## 4. Small presentation-only candidate: give jump apex a readable window

`src/render/FighterView.ts:17` currently sets `JUMP_APEX_VY = 0.4`. With Hunter's -10.5 initial velocity and +0.62 gravity increments, only one ascending/descending sample is inside that band. At a 25 fps capture rate, the apex pose can be missed entirely.

Try this separately:

```diff
-const JUMP_APEX_VY = 0.4;
+const JUMP_APEX_VY = 1.0;
```

For Hunter, that widens the pose window from approximately one simulation tick to three (about 50 ms), while leaving the actual arc, airtime, input response, and jump height unchanged. This is a source-derived proposal, not an integrated or playtested change. Check Kevin as well and verify that no frame-selection bounds are violated.

Dash speed is 4.6 versus walking speed 1.7, with a ten-count dash duration. There is already a substantial movement distinction. I would keep those values for the next comparison and assess the state/animation mapping with the new references before making the dash longer or faster.

## 5. Keep hit-stop tuning local and postpone broad changes

Current constants are light=3, heavy=6, super=9 simulation freeze frames (50/100/150 ms at 60 Hz). The helper gives attacks of 10–17 damage four freeze frames, and blocks use half rounded upward. Hunter's first and second jab currently get three; his third gets four. These values are not inherently evidence of excessive floatiness or inadequate weight.

Fix sections 1–2 before changing these constants. For a later comparison, Hunter's 16-damage forward attack currently triggers the scene's heavy audiovisual branch (`damage > 14`) while receiving only four freeze frames from the helper. If that particular move still lacks impact in new footage, try a local `hitstopFrames: 6` override in its `effect(16, ...)` options at `hunter.ts:46`, keeping its other values unchanged. That is an untested, source-based experiment; the supplied clip does not demonstrate this move and cannot justify applying it globally.

## Evidence corrections required for the next handoff

These observations concern what the files prove, not whether the separate e2e tests are useful:

- `10-attack-contact.png` shows neutral-looking fighters and no visible contact moment. The script captures only 20 ms after pressing Basic, before Hunter's four-tick startup can ordinarily finish. Kevin has already received a projectile earlier in the recording, so missing health here cannot by itself prove that this new basic just hit.
- `11-block-impact.png` shows a held guard. It does not prove the new impact frame ran; the event/view probe establishes that it does not.
- `12-knockdown.png` and `13-wakeup.png` both show standing fighters. The corresponding full-rate video interval does not show a successful throw-to-ground sequence. The capture attempts the grab after earlier pushback without first ensuring grab range. This is a plausible reason for the miss, not a measured input trace.
- `16-results.png` shows the arena in the next round, and the video visibly proceeds through ROUND 2. This is not a results screen.
- The capture source explicitly sets `p2.health = 0` at `evidence.capture.ts:144`. That is acceptable for a clearly labeled round-transition fixture, but the resulting KO must not be described as a naturally earned finishing hit or proof of a completed match.

For new evidence, approach a known valid range through real movement, wait for the actual event/state, and capture the corresponding rendered frame rather than relying on fixed sleeps. Record event time, sim tick, move ID, health/guard changes, and selected animation frame next to each evidence filename. Capture throw connection, grounded knockdown, wakeup, and an actual completed-match results state separately. Do not silently save a different state under the requested label when a condition fails.

Provide a working dedicated capture configuration for the `.capture.ts` file and enough timeout for a 30–60 second combat clip. Include ordinary sustained exchanges, a complete basic string, a blocked string, a close-range throw, and a heavier move. Record at 60 fps if available for timing review. Keep the audio limitation explicit or provide a separate synchronized recording with sound.

## Suggested order

1. Integrate the supplied key-pose references through the real sprite workflow described in `ART_NOTES.md`.
2. Repair block-event routing and simulation-driven reaction clocks/reset behavior.
3. A/B test the two Hunter knockback overrides and the apex-window change separately.
4. Rerun focused tests, the production build, and browser checks; produce correctly labeled new evidence.
5. Ask for the next review using that evidence. Further global balance changes need a sustained exchange or live playtest.
