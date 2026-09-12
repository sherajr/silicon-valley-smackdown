# Claude Code: integrate the new Hunter references and repair verified combat presentation issues

Continue `silicon-valley-smackdown` from the handoff branch. Codex reviewed `7d8e5facc4d3cd67c618198cd50e67dee4cbb48d`, the documentation-only successor of `2c974bb99953d77965315cfe9f3d465187d22823`. Check current git status and newer changes first; preserve unrelated work.

Read `COMBAT_REVIEW.md`, `ART_NOTES.md`, and `probe-results.json` from this return package. The package contains completed concept art and reproducible review findings. No game source changes were committed or pushed by Codex.

## Files being returned

- `hunter_combat_key_poses_ii.png`: six movement/guard references — DASH, JUMP RISE, JUMP FALL, BLOCK IMPACT, CROUCH, CROUCH BLOCK IMPACT.
- `hunter_combat_key_poses_iii.png`: five recovery references — HITSTUN HOLD, KNOCKDOWN FALL, KNOCKDOWN DOWN, WAKEUP STIR, WAKEUP RISE.
- `ART_NOTES.md`: panel mapping, identity/cleanup notes, intended scope, and generation prompt specifications.
- `COMBAT_REVIEW.md`: evidence-based critique, source anchors, exact numeric before/after proposals, and verification limits.
- `probe.cjs` and `probe-results.json`: portable current-code reproduction harness and the actual results from the reviewed snapshot. The harness mocks Phaser drawing and does not represent a live-browser test.

Place the two PNGs under `art/reference/` with these names. They are new key-pose reference sheets with opaque backgrounds, labels, shadows, and illustrative accents. Do the promised per-panel extraction, cleanup, scale/pivot alignment, and real atlas/manifest integration. Use the original six-pose sheet alongside these eleven new poses. Preserve consistent face/clothes/scale; keep labels and sheet decoration out of gameplay frames. Do not claim that these seventeen key poses comprise complete animation for every move.

Build the actual loader and verify it in the existing Animation Viewer. Retain the procedural fallback only for states not yet converted or development asset failures. Make converted and fallback coverage explicit. Capture at least Hunter's ready/strike, dash, jump phases, both guard impacts, hitstun, and knockdown/wakeup with correct pivots and both facings.

## Fix these two confirmed logic problems before broad tuning

1. **Guard reaction routing:** `FightScene.ts:225` sends no guard-impact notification; `FighterView.ts:82` waits for a damage flash in states that exclude `blockstun`; `FighterView.ts:139` renders `blockstun` as ordinary hitstun. Before → after: capture guard stance before `CombatSim.applyBlockedHit` changes state, carry it in the blocked event, notify the correct view, and select standing/crouching guard-impact frames in a dedicated blockstun path. Guard break must remain distinct. See review section 1 for precise anchors and assertions.
2. **Reaction progression/reset:** `FighterView.ts:75–83` advances through hit-stop and does not reset on a new hit when the state name stays the same. Before → after: use actual advanced simulation ticks for reaction timing and reset the appropriate reaction on every impact event. Respect pause/hit-stop for independent Phaser locomotion animations too. Replace the four-render-update damage flash with an explicit duration; the review proposes an initial 50 ms of unpaused presentation time, to be visually verified.

Add focused regression checks that fail on the current behavior: a real block selects a guard-impact frame, crouch guard keeps the appropriate presentation, nine freeze ticks do not age the snap, and a repeated hit restarts it. Do not consider a guard-meter assertion proof that the visual reaction fired.

## Then A/B test these narrowly scoped proposals

- `src/data/characters/hunter.ts:31`: replace `effect(6, 'mid')` with `effect(6, 'mid', { knockback: { x: 1.5, y: 0 } })`.
- `src/data/characters/hunter.ts:34`: replace `effect(8, 'mid')` with `effect(8, 'mid', { knockback: { x: 1.8, y: 0 } })`.
- Keep Hunter's third hit, global damage/knockback defaults, startup, recovery, and gravity unchanged for that comparison. Codex's simulation probe changed an idle-target string from two connecting hits to three. This is not proof of a gapless combo or final balance. Test both facings, distance variation, walls, and defense, including derived block pushback.
- Separately try `JUMP_APEX_VY` in `FighterView.ts:17` from `0.4` to `1.0`. This changes pose selection only. It has not been visually playtested.

Treat the optional heavy-move freeze proposal in the review as a later experiment, not a required global tuning change.

## Verification and new evidence

Codex reran 68 passing unit tests, but did not rerun e2e/build or conduct live input/audio playtesting. Run your current typecheck, tests, production build, and browser suite after integration. To rerun the source-review probe from the repo root after dependencies are installed:

```bash
node path/to/codex-return/probe.cjs .
```

The existing recorded evidence is mislabeled in places: screenshots 12/13 show standing fighters, screenshot 16 shows the next round, and the KO was forced by a health assignment. Capture from real state/event conditions, not approximate sleeps. Produce a 30–60 second sustained exchange plus correctly labeled throw/wakeup and completed-match results evidence. Keep forced transition fixtures explicitly labeled. State whether audio and physical controllers were actually checked.

Finish with a playable result, screenshots or video, exact test results, and a short `CODEX_NEXT.md` containing only concrete remaining issues or missing assets. Provide accessible source/commit and attach the needed evidence. Do not restart the project or replace implementation work with another general planning pass.
