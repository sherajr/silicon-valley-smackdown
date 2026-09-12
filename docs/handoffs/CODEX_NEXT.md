# Prompt for Codex — Silicon Valley Smackdown, round 2

Paste everything below this line into ChatGPT/Codex. Thank you for the first round — both confirmed bugs are fixed and verified, both tuning proposals are applied, and I've saved your reference sheets. This is a short, focused ask for what's actually left.

---

Same repo as before: **https://github.com/sherajr/silicon-valley-smackdown**, branch `codex-handoff-pass-2`, now at commit `20863cb3fa81435ba14dc607532546c13fa15f3e` (pushed). Your last review (of `7d8e5facc4d3cd67c618198cd50e67dee4cbb48d`) is fully addressed:

- **Both confirmed bugs fixed**: block events now carry stance and route to a real `blockstun` render branch (`guardbreak` renders as a stagger, not a guard pose); reaction timing now runs off `CombatSim.frameCount` (frozen during hit-stop) instead of wall-clock delta, and resets on every new hit regardless of state-name churn. `src/render/FighterView.test.ts` (5 tests) reproduces both bugs against the old code first, then verifies the fix; `tests/e2e/combat-contact.spec.ts`'s block test now also polls the actual on-screen sprite texture (`kevin_block_1`) in a real browser, not just health/guard deltas.
- **Both tuning proposals applied**: Hunter's basic1/basic2 knockback (3.28/3.64 → 1.5/1.8) and `JUMP_APEX_VY` (0.4 → 1.0). New test `src/data/characters/hunter.combo.test.ts` covers the 3-hit string against an idle target (as your probe did), plus an actively-blocking defender and the mirrored facing (neither of which your probe checked) — all pass, and fail against the pre-tuning values.
- **Evidence corrected**: `tests/e2e/evidence.capture.ts` now polls for the real condition (health delta, sim state, on-screen texture) before every screenshot instead of fixed sleeps; the knockdown/wakeup shots re-establish grab range properly; the match now genuinely ends (two real round losses, real wait for each transition) so `16-results.png` shows an actual "P1 WINS THE MATCH" screen. Every screenshot's exact sim state is in `docs/handoffs/evidence/capture-log.json` next to it, including one honest "not confirmed" entry (`07-dash.png` — the scripted double-tap didn't register as the `dash` state within the poll window; flagged, not silently mislabeled).
- Full suite passes: 76 unit tests, 11 e2e tests, clean typecheck/build.

Not applied: your optional heavy-move hitstop experiment (`hunter_forwardBasic` → `hitstopFrames: 6`) — per your own note, that's a later experiment gated on whether the move still lacks impact in new footage, and I haven't specifically captured that move yet. Leaving it as your suggestion, not mine to second-guess.

## What's actually left: art integration

Your `hunter_combat_key_poses_ii.png` / `_iii.png` (11 poses) are saved under `art/reference/` alongside the original two. **I have not cropped, aligned, or integrated them, and I'm not going to attempt it** — this environment has no image-editing tool (no crop/transparency/precision-pixel manipulation), only the ability to view images and run shell commands. `ART_NOTES.md`'s own instructions (remove the gray background/labels/shadows, align on foot pivots not panel boxes, don't stretch crops) describe exactly the kind of visual, iterative work I can't do reliably here. Attempting it with a blunt tool like a scripted crop would risk shipping subtly-misaligned sprites that look integrated but aren't — worse than leaving it explicit.

**The ask:** for the next round, can you output each pose as its own **individual transparent-background PNG** (17 files total: the original 6 + these 11) instead of labeled sheets? If your image tool supports "isolate on transparent background" / "no background" as a generation mode, that removes the cropping step entirely and I can go straight to building the real sprite loader (still not built — no real per-frame assets existed to build it against until now) and wiring it into the existing dev Animation Viewer (`?animviewer=1`, `src/scenes/AnimationViewerScene.ts`) with a procedural-rig fallback for anything not yet converted. If transparent individual frames aren't feasible for your tool, say so plainly and I'll ask the owner to run the crop/cleanup pass with real image-editing software instead — either is fine, I just need to know which before planning further.

No other code changes are being requested this round.
