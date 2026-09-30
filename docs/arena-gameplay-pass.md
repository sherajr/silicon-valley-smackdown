# Arena gameplay pass

This pass fixes the physics and input problems found in the September 30, 2026 gameplay audit, turns grab into a real catch, hold and throw, gives each of the six fighters its own move set, and adds combos, practice tools and a smarter CPU. It changes Arena only (`src/arena/`); Classic's simulation is untouched.

**Baseline.** The audit ran against `main` commit `50a2cf2` (the merge of PR #15). This checkout's tree was identical to it (its second parent `a437e51` is this branch's tip), so every finding was reproduced against the same code. An uncommitted `src/arena/Audio.ts` change that bundles the soundtrack was already in the working tree; it was left alone and the new sound cues were added inside `effect()` only.

## What changed, finding by finding

| ID | Status | What was done | Where |
| --- | --- | --- | --- |
| F01 lost presses | Fixed | Every press is captured on every tick, including hitstop; requests last 6 gameplay frames, do not age while frozen, and run once at the first legal moment. | `ActionBuffer.ts`, `Simulation.ts` |
| F02 shield actions | Fixed | Shield + grab grabs out of shield; shield + jump jumps; direction + shield still rolls. Up + special recovers without also jumping. | `Simulation.ts` (`actions`, `intent`) |
| F03 grab was a hit | Redesigned | M catches first, links both fighters, holds the target at the captor's hands, and damages only on an authored throw release. Tech, pummel, four throws, timeout, fairness rules. | `grabs.ts`, `Simulation.ts`, `FighterRig.ts` |
| F04 rolls off the stage | Fixed | A roll stops at the platform edge and ends its own protection; you cannot start a roll into an edge you are already at; rolls leave a vulnerable gap. | `Simulation.ts` (`rollStep`) |
| F05 roof is one-way | Fixed | The main stage is a solid block: top, sides and underside collide. Swept movement, so fast launches cannot tunnel. The building core is scenery, drawn behind the fighters' plane. | `collision.ts`, `data.ts`, `Stage.ts` |
| F06 jab string | Fixed | Three-hit string with cancel windows, low-growth knockback, forward follow-through and a grace window. Whiffs animate but do not count as a combo. | `fighterDefinitions.ts` |
| F07 identical moves | Fixed | Six distinct move sets built on shared helpers (see the roster below). | `fighterDefinitions.ts` |
| F08 air steering | Fixed | Each move carries an air-control multiplier; aerials steer, committed moves steer less. | `Simulation.ts` (`locomotion`) |
| F09 slam misses | Fixed | Down specials hang briefly, then dive at a fixed speed until they touch a surface. The impact starts on contact and hits once, from any height. | `Simulation.ts` (`advanceAttack`, `land`) |
| F10 projectile direction | Fixed | A shot launches along its own travel direction, stored at impact, not the owner's position. Shots are swept and collide with the solid roof. | `Simulation.ts` (`updateShots`) |
| F11 hitstop by slot | Fixed | Hits resolve from a snapshot; hitstop is the larger of the impacts. Swapping slots changes nothing. | `Simulation.ts` (`resolveContacts`) |
| F12 grab volume | Fixed | The catch reaches forward only, at the captor's own height, and only grounded targets in legal states can be caught. | `grabs.ts` |
| F13 overlapping fighters | Fixed | A small symmetric ground pushbox. Airborne fighters and rollers pass through; pushing is limited at platform edges so nobody is shoved off. | `Simulation.ts` (`resolvePush`) |
| F14 early jump | Fixed | A jump pressed just before landing is buffered and runs as the ground jump, never a third air jump. A coyote window was deliberately not added. | `Simulation.ts` |
| F15 hard-coded ledges | Fixed | Ledges come from the platform data. Each regrab gives less protection and respects a cooldown; a genuine landing, KO or respawn resets it. | `collision.ts`, `Simulation.ts` |

Other things found and fixed along the way:

- Rolling into an edge and holding the direction would have re-rolled every 11 frames with 19 frames of invincibility (near-permanent protection). Found in review, reproduced by a test, fixed.
- A projectile that had just bounced sat on the surface boundary and was destroyed on the next tick. Fixed in the segment test.
- Throw release and tech used to run inside the captor's update, which gave the victim one extra physics tick only when the captor was slot 0. They now resolve after both fighters have updated.

## The six fighters

Every fighter has its own timing, reach, damage, launch, projectile, recovery, down special, grab and throws. These tables are generated from `fighterDefinitions.ts`.

| Fighter | Weight | Walk | Body (w x h) | Jab start (1/2/3) | Jab damage | Jab reach |
| --- | --- | --- | --- | --- | --- | --- |
| Hunter | 1 | 0.145 | 0.76 x 2.3 | 4 / 4 / 6 | 5 / 7 / 9 | 1.25 |
| Kevin | 1.1 | 0.127 | 0.76 x 2.4 | 6 / 6 / 8 | 4 / 5 / 8 | 1.60 |
| Al | 1.23 | 0.117 | 1.00 x 2.25 | 6 / 6 / 9 | 4 / 5 / 10 | 1.50 |
| Priya | 0.88 | 0.171 | 0.64 x 2.15 | 3 / 3 / 5 | 3 / 3 / 6 | 1.05 |
| Chad | 1.12 | 0.124 | 0.84 x 2.3 | 5 / 5 / 8 | 4 / 5 / 8 | 1.30 |
| Elon | 1.06 | 0.147 | 0.96 x 2.45 | 5 / 5 / 8 | 4 / 5 / 9 | 1.30 |

| Fighter | Heavy (start / dmg / reach) | Up attack dmg | Aerial landing lag (n / f / b / u / d) | Projectile (speed / arc / dmg / size) |
| --- | --- | --- | --- | --- |
| Hunter | 12 / 15 / 1.70, advances | 12 | 8 / 12 / 12 / 10 / 16 | 0.25 / flat / 11 / 0.7 x 0.6 |
| Kevin | 13 / 14 / 1.95 | 11 | 9 / 13 / 13 / 11 / 18 | 0.26 / lob / 10 / 0.8 x 0.6 |
| Al | 16 / 18 / 1.95 | 13 | 11 / 16 / 15 / 14 / 22 | 0.23 / lob / 13 / 0.8 x 0.7 |
| Priya | 9 / 11 / 1.45 | 8 | 5 / 7 / 8 / 6 / 10 | 0.32 / flat / 8 / 0.6 x 0.6 |
| Chad | 14 / 16 / 1.95, **armored** | 12 | 9 / 14 / 13 / 12 / 20 | 0.21 / lob / 9 / 1.1 x 1.3 (wide) |
| Elon | 15 / 17 / 1.95 | 13 | 10 / 15 / 14 / 12 / 21 | 0.10, accelerating / flat / 14 / 1.0 x 0.9 |

| Fighter | Recovery (rise / sideways / steering / length) | Landing lag after recovery | Down special | Grab (reach / start / whiff recovery) | Throw damage (f / b / u / d) |
| --- | --- | --- | --- | --- | --- |
| Hunter | 0.43 / 0.12 / 0.006 / 43f | none | slam: Pivot Slam | 1.25 / 8 / 22f | 9 / 10 / 7 / 6 |
| Kevin | 0.40 / 0.08 / 0.004 / 46f (has an attack window) | none | counter: Rebuttal | 1.45 / 9 / 24f | 9 / 10 / 7 / 6 |
| Al | 0.50 / 0.02 / 0.001 / 50f (strong rise, poor drift) | none | slam: Closing Time (broad, close) | 1.90 / 9 / 25f | 12 / 13 / 8 / 7 |
| Priya | 0.39 / 0.17 / 0.012 / 40f (weak hit, most lateral) | none | dash: Headhunt Dash | 1.05 / 6 / 21f | 6 / 7 / 5 / 4 |
| Chad | 0.30 / 0.26 / 0.010 / 48f (far sideways, little height) | none | slam: Down Round | 1.35 / 9 / 24f | 9 / 10 / 7 / 6 |
| Elon | 0.58 / 0.02 / 0.002 / 60f (highest) | **34 frames** | slam: Ground Pound | 1.50 / 9 / 24f | 11 / 12 / 8 / 7 |

Style in one line each:

- **Hunter** is the balanced rusher: quick jabs, an advancing heavy, reliable recovery.
- **Kevin** has the longest pokes, a Rebuttal counter that only works in its window and loses to grabs, and a narrow recovery.
- **Al** is a slow grappler with the longest grab, strong throws, and a recovery that rises high but barely drifts.
- **Priya** is the fastest and lightest: quick short-range strings, the best air control, aerials that chain on hit, and a dash that cancels into attacks.
- **Chad** controls midrange with a wide, slow Cash Burn and a heavy with limited armor that still loses to grabs; his recovery goes far sideways.
- **Elon** is big and slow: a telegraphed rocket that accelerates, a high-power launcher, and To the Moon, which rises highest but leaves him helpless on landing.

## Combos

Every fighter documents, and the tests verify, a jab string and one unique route. A **true combo** leaves the defender no chance to act between hits. Percentages are the highest damage at which the route still connects on an average-weight defender (Hunter, weight 1.0); the route connects at 0% on every defender, in both directions and both slots. "Holds away" means the defender holds directly away while in hitstun (directional influence).

| Fighter | Route | Inputs (P1) | Type | Average weight, no DI | Average weight, holds away |
| --- | --- | --- | --- | --- | --- |
| all | Jab string | V, V, V | true | up to 150% (tested limit) | up to 150% |
| Hunter | Growth Hack route | V, V, W+V, W, →+V | true | 0-40% | 0-10% |
| Kevin | Stay of Execution route | M, W+M, W, →+W+V | true | any % | 0-35% |
| Al | Barstool Slam route | M, S+M, V, V | true | 0-50% | 0-5% |
| Priya | Low Offer route | S+V, W→, W+V, →+V | true | 0-70% | 0-60% |
| Chad | Cash Burn route | V, V, B | true | any % | any % |
| Elon | Stage Separation route | W+V, W, W+V | true | any % | 0-20% |

How defender weight changes the same routes (from the measured matrix; "x" means it never connects):

| Route | Light (Priya 0.88) | Average (Hunter 1.0) | Heavy (Al 1.23) |
| --- | --- | --- | --- |
| Hunter, no DI / holds away | 0-10 / x | 0-40 / 0-10 | 0-90 / 0-70 |
| Kevin, no DI / holds away | 0-50 / x | any / 0-35 | any / any |
| Al, no DI / holds away | 0-30 / x | 0-50 / 0-5 | 0-90 / 0-30 |
| Priya, no DI / holds away | 0-45 / 0-40 | 0-70 / 0-60 | any / any |
| Chad, no DI / holds away | any / any | any / any | any / any |
| Elon, no DI / holds away | 0-70 / x | any / 0-20 | any / any |

Each fighter also lists a pressure or read (a strong but escapable option), for example Hunter's jab into a grab if they shield, or Kevin's Rebuttal as an answer to an approach. These are marked as such in the in-game move list and are not claimed to be true combos.

Limits worth knowing:

- Two-hit throw follow-ups (Kevin) need the grab to land first. Holding away and light defenders break several routes; heavy defenders rarely can.
- From the fourth hit of a combo, damage and hitstun shrink by 10% per hit (down to 50%), so long juggles run out of hitstun. Three-hit strings are never scaled.
- Anyone thrown, teched or freed cannot be caught again for 45 frames, so grab loops cannot lock a defender out. A test repeats grab and down throw as fast as possible and checks the defender keeps acting.

## Grabs in one page

- **M** starts a short, visible catch (8 to 9 frames to connect, 21 to 25 frames of recovery if it whiffs). It works out of shield and only reaches forward, at the grabber's own height. Airborne, invincible, rolling, stunned, protected or already-held targets cannot be caught.
- A connected catch freezes the action briefly, links both fighters and draws the target to the captor's hands. There is no damage yet.
- The held fighter can **tap grab within the first 8 gameplay frames** (presses during the catch's hitstop count; a button already held does not) to break the hold: no damage, both stumble apart for 16 frames.
- The captor can **pummel** with attack (twice, 14 frames apart, a little damage each, not counted as combo hits) and **throw** with grab plus a direction: forward, back, up, down (neutral is forward; W is a throw direction, not a jump). Damage and launch happen once, on the release frame.
- A hold lasts at most 54 gameplay frames, then throws forward. Getting hit, a KO, a reset or a rematch ends it cleanly.
- Two grabs that connect on each other break. An active strike that connects beats a grab.

## Practice tools

Training mode shows a panel: dummy behaviour (stands, shields, jumps, DI left, DI right, breaks grabs), damage presets (0, 50, 100, 150), position reset, heal, a hitbox overlay (hurtboxes aqua and orange, hit volumes red, catch volumes yellow, shots magenta), a state-and-input readout, and frame step (press `.` or **Next frame**). P2's own keys still move the dummy. **Move list + combos** is on the character-select screen and the pause menu; its frame data and combo bands are generated from the same definitions the simulation runs.

## Verification

Run on this Windows 11 machine (Node 22.23, Playwright Chromium, software-rendered WebGL where noted below).

Starting point (before any change), on this machine: `npm test` 212 passed in 15 files, `npm run build` and `npm run build:portable` passed, and the Arena browser suite passed 9 of 9 against the portable file (7 passed and 2 skipped without the environment flags).

After the changes:

| Check | Result |
| --- | --- |
| `npm test` | **814 tests passed in 25 files** (the original 212 plus 602 new). 10 new files cover the audit findings, the input buffer, stage collision, grabs and throws, the six fighters, combos, the CPU and training dummy, ledges and rolls, the fixed-step loop and the move list. The two old tests that encoded the bugs (a grab as a 12% hit, and a trade between two different fighters with different jab timing) were rewritten to assert the intended behaviour. |
| `npm run typecheck` / `npm run build` | Passed. |
| `npm run build:portable` | Passed. `PLAY.html` is 5.6 MB because it also carries the bundled soundtrack from the uncommitted `Audio.ts` change, inlined as a data URL. |
| `SVS_SANDBOX_DEVICES=1 npm run test:arena` (production web build) | **22 passed, 1 skipped** in 3.2 minutes. The skipped test is the portable-file test, which only runs against `PLAY.html`. |
| `SVS_PORTABLE=1 SVS_SANDBOX_DEVICES=1 npm run test:arena` (the standalone file, network blocked for the offline test) | **23 passed** in 3.3 minutes, including the offline test with every http(s) request blocked. |
| `npm run package:zip` | Passed. The launcher found a working Python on this machine (`python3` here is a Microsoft Store shortcut that is not an interpreter). Path: `release/Silicon-Valley-Smackdown-Arena.zip`, 14.88 MiB. |
| ZIP integrity | Recorded SHA-256 matches the recomputed one, every member's CRC is OK, 253 members with no duplicate names (the packager used to write `SOURCE-ORIGIN.txt` twice; fixed), required files present, nothing from `node_modules`, `.git` or scratch folders included. |
| Offline smoke test of the extracted ZIP | The extracted `PLAY.html` is byte-identical to the build. Opened over `file://` with every http(s) request blocked: a real keyboard grab held the target with 0 damage and showed the hint; a directional throw then dealt 9; no remote requests and no page errors. |

The browser suite has two spec files. `arena.spec.ts` is the original nine tests (selection, keyboard movement, projectile and recovery chords, all six models and arenas, pause and rematch, training and arcade, the offline portable file, synthetic controllers, blur pause and GPU cleanup), unchanged. `gameplay.spec.ts` adds 14 real-keyboard tests: P1 grab and directional throw with M, P2 grab and back throw with semicolon, shield + grab and shield + jump, grab-breaking (including a press made during the catch's hitstop), a frame-exact jab string with the combo counter, no auto-repeat when a button is held, a roll toward the stage edge, the solid roof, the training tools, the move list, every fighter grabbing and throwing on every arena, a pause flushing a buffered press, synthetic two-controller grab, throw and tech, and flat GPU resources across many catches.

I also played the game through scripted states and looked at screenshots of the hold, pummel, throws, Kevin's counter stance, Priya's dash, Al's slam dive and impact, a back air, the combo popup, the training panel with hitboxes, and the move list. Tests that depend on an exact frame use real `KeyboardEvent`s fired at chosen simulation ticks, because the eight-frame grab-break window is shorter than a browser round trip. The game was not profiled on the owner's laptop.

During review, an independent code-review pass found two real issues (starting a roll or a ledge grab overwrote longer existing protection such as respawn invincibility). Both were reproduced by tests and fixed. The roll-into-edge invincibility loop described above was found the same way.

**Not tested here, and not claimed:** physical controllers (only synthetic controller state was used), audible sound quality, frame rate on the owner's RTX 4070 laptop, native Windows packaging (`npm run dist:win`) and the Electron wrapper, and human competitive balance. The numbers were tuned for readability and verified for behaviour, not balanced by play.

## Manual test guide

Keep the keyboard on the defaults. Choose **Training** on the select screen, pick Hunter for P1, then:

1. **Catch and throw.** Stand next to the dummy and tap **M**. The dummy should be held at your hands with a green hint along the bottom and no damage. Hold **D** and tap **M** for a forward throw (9%). Try **W+M** (up), **S+M** (down), **A+M** (back). Set the dummy to **Shields** and grab it: the grab still connects.
2. **Break a grab.** Set the dummy to **Breaks grabs** and grab it: it escapes every time. To try it yourself, let P2's **semicolon** grab you and mash **M** at once; you only have about 8 frames (an eighth of a second), so mash rather than wait to see the grab.
3. **Pummel.** Grab, then tap **V** twice, slowly. A third tap does nothing. Wait about a second without throwing: you throw forward on your own.
4. **Jab string.** Tap **V** three times at a steady pace. The third jab launches and a **3 HITS** counter appears by your damage. Wait a second between taps and it stays three separate hits (no counter).
5. **Buffering.** Tap **V**, then tap **M** a split second before the jab finishes. The grab comes out as soon as you can act, instead of the press being dropped. Pressing it far too early does nothing (the window is 6 frames).
6. **Edge roll.** Stand near the edge of the stage, hold **N+D**. You stop at the edge and do not fall. Keep holding: you are not invincible the whole time.
7. **Roof.** Jump off the side and come back from below: the lit roof's underside and sides are solid, so you cannot pass through them. Steer toward the edge to grab the ledge, or jump and up+B to land on top.
8. **Down special.** Switch to Kevin: **S+B** is a counter (hit him with P2's **J** at the right moment); Priya: a dash; Al, Chad, Elon and Hunter: a slam that lands once from any height.
9. **Combo routes.** Open **Move list + combos** (pause menu) for each fighter's route and inputs, then try it on the dummy at 0%: Hunter **V, V, W+V, W, →+V**; Kevin **M, W+M, W, →+W+V**; Al **M, S+M, V, V**; Priya **S+V, W, W+V, →+V**; Chad **V, V, B**; Elon **W+V, W, W+V**. Turn on **Show hitboxes** and **Show state + inputs** to see the frames, and **Frame step** to go a frame at a time.
10. **Two players.** Choose **Local versus**: P2 uses the arrow keys plus **J K L ;** and can do everything above. Connect two controllers and press a button on each: Y grabs, X attacks, B is special.
