# Art restoration — captured evidence

Screenshots taken from the running production build by the two e2e specs that assert the same
claims programmatically. Regenerate the full set (26 images, into `test-results/evidence/`) with:

```
npx playwright test tests/e2e/art-restoration.spec.ts tests/e2e/scene-layout.spec.ts
```

| File | What it shows |
| --- | --- |
| `stage-castro_street.png` | Painted Castro Street background in a live fight, with Hunter and Kevin in their own painted art, feet on `GROUND_Y`, 8:00 clock, and the round banner clear of stage signage. |
| `stage-sand_hill_road.png` | Painted Sand Hill Road background in a live fight. |
| `stage-palo_alto.png` | Painted Palo Alto rooftop background in a live fight. |
| `03-character-select.png` | Roster portraits inside their tiles with names readable, animated P1/P2 previews flanking the grid, and both info panels unobstructed. |
| `04-hit-reaction.png` | An unblocked hit: the defender renders the painted hurt cell (`kevin_poses_sheet` frame 3). |
| `05-block-impact.png` | A blocked hit: the defender renders the painted guard cell (frame 2), not the hurt cell. This is the routing bug that used to send `blockstun` through the hurt frames. |
| `06-guard-break.png` | A guard break: the defender renders the recoil cell (frame 3), not another guard pose. |
| `15-versus-intro.png` | Versus intro with both painted fighters sized to fit between the intro line and the name plates. |
| `11-move-list-p1.png` | Pause move list for P1: full move names and commands, every hit window, projectile release frame, grab window, aligned columns, and Block/Grab bindings. |
| `13-move-list-p2.png` | The same list switched to P2's move set in versus mode. |

The specs assert the underlying facts (decoded texture geometry, which texture and frame is bound
to each sprite at render time, sprite/text bounding-box overlap, sim frame counters) rather than
comparing images, so these are illustrations of checks that run headlessly — not the checks
themselves.
