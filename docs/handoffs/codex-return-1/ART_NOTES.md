# Hunter key poses II and III

Generated with the built-in image-generation tool using both actual repository references: `art/reference/hunter_combat_key_poses.png` for presentation/style and `art/reference/hunter_original_office_illustration.png` for character identity. Sheet III also used the completed sheet II to maintain consistency.

These are the eleven requested **concept/key-pose references**. They are not transparent sprite atlases and are not integrated game assets. Each delivered PNG is 1536 × 1024. Both were visually inspected for pose coverage, readable labels, full-body framing, clothing, and character identity.

## Panel map

| File | Position | Label | Intended use |
| --- | --- | --- | --- |
| hunter_combat_key_poses_ii.png | Top left | DASH | Low forward sprint |
| hunter_combat_key_poses_ii.png | Top center | JUMP RISE | Tucked rising pose |
| hunter_combat_key_poses_ii.png | Top right | JUMP FALL | Descending toward landing |
| hunter_combat_key_poses_ii.png | Bottom left | BLOCK IMPACT | Standing guard recoil |
| hunter_combat_key_poses_ii.png | Bottom center | CROUCH | Neutral low fighting stance |
| hunter_combat_key_poses_ii.png | Bottom right | CROUCH BLOCK IMPACT | Low guard recoil |
| hunter_combat_key_poses_iii.png | Top left | HITSTUN HOLD | Settled dazed recovery |
| hunter_combat_key_poses_iii.png | Top center | KNOCKDOWN FALL | Backward fall |
| hunter_combat_key_poses_iii.png | Top right | KNOCKDOWN DOWN | Fully grounded supine pose |
| hunter_combat_key_poses_iii.png | Bottom left | WAKEUP STIR | Supporting torso on an arm |
| hunter_combat_key_poses_iii.png | Bottom right | WAKEUP RISE | Rising through a low stance |

## Integration notes

- Copy the files to `art/reference/` as new siblings; preserve the original two references.
- Treat the sheet positions as presentation, not an evenly packed atlas grid. The five-pose sheet has three upper panels and two lower panels; its horizontal poses occupy more width. Inspect individual crop bounds.
- Remove the gray background, ground shadows, labels, and title before creating gameplay frames. Decorative stars and impact marks belong in a separate optional effect layer, not the base fighter silhouette.
- Retain the long gray sleeves, navy vest, headphones, chestnut hair, stubble, jeans, and sneaker details during cleanup. Palette anchors guided generation; exact pixel-color compliance has not been machine-quantized or certified.
- Align anatomy and foot/ground pivots, not panel boxes or image bottoms. Keep the same underlying character scale when crouched, airborne, or lying down. Do not stretch each crop to fill a standard rectangle.
- Preserve head-left/feet-right continuity across knockdown fall, down, and stir for the illustrated right-facing fighter; validate how facing reversal should affect the sequence in-game.
- Supply intermediate frames where motion needs them. A key pose alone does not create smooth locomotion, a complete throw, or a full wakeup animation.
- No 128 × 92 grid/pivot assumptions were applied to these illustrations, as requested. Claude owns final sizing, atlas metadata, loader integration, and gameplay verification.

## Generation prompt specifications

The two prompts used the following full creative specifications. Reference paths were passed explicitly to the built-in tool; no CLI/API fallback was used.

### Sheet II

Create Hunter Combat Key Poses II as a new companion concept sheet, not a production atlas. Match the existing combat sheet's character proportions, confident crisp pixel clusters, sculpted shading, flat neutral gray presentation, dark navy uppercase pixel title and small labels. Use the original office image for identity only. Landscape, three columns by two rows, six full-body illustrations. Title HUNTER / COMBAT KEY POSES II.

Preserve swept-up spiky chestnut hair, warm expressive face and short brown stubble, charcoal over-ear headphones, long gray hoodie sleeves with cuffs/hood/drawstrings, dark navy horizontally quilted puffer vest, fitted blue jeans, and white-gray sneakers. Palette anchors: skin #e8b48a; hair base #4a3324 with chestnut highlights; hoodie #9098a3; vest #262a33; jeans #3b5a86; subtle cyan rim #59c1d6; outline #151018. No props. Consistent anatomical scale; side-view action facing screen right with a readable three-quarter face.

Exact row-major panels: DASH, a low forward sprint with bent elbows pumping and a clear running stride; JUMP RISE, airborne knees tucked and arms driving upward; JUMP FALL, legs extending toward landing and arms balancing; BLOCK IMPACT, planted feet and shielding forearms with torso recoiling under a blow from the right; CROUCH, a balanced low fighting stance with fists ready; CROUCH BLOCK IMPACT, a low compressed stance with forearms shielding the head. Each must differ visibly from its neutral counterpart.

Leave generous margins around every limb. No overlaps, additional characters/panels, laptop, tablet, environment, or enlarged crouching figures. Use an opaque gray background and restrained contact shadows. Prioritize convincing distinct key poses over reusing the original six.

### Sheet III

Create Hunter Combat Key Poses III as a companion to the original combat sheet and new sheet II, using the original office illustration for identity. Match character, pixel-art style, gray background, typography, and presentation. Landscape, five panels: three across the top and two centered across the bottom. Title HUNTER / COMBAT KEY POSES III. Use consistent anatomical scale and enough width for full horizontal bodies.

Preserve the same hair, face/stubble, headphones, long hoodie sleeves/cuffs, hood/drawstrings, quilted vest, jeans, sneakers, and palette anchors listed for sheet II. Crisp pixel clusters, sculpted shading, no props.

Exact row-major poses: HITSTUN HOLD, a restrained standing daze with soft knees and slumped shoulders, facing right; KNOCKDOWN FALL, falling backward toward the left with feet lifting toward the right, body diagonal and airborne near the floor; KNOCKDOWN DOWN, fully supine along the ground with head at left and shoes at right; WAKEUP STIR, same continuity, torso supported on one forearm and hips still low; WAKEUP RISE, turning toward the right through a low crouch with a planted foot and a supporting hand, preparing to stand.

Use exactly those labels. No sixth or filler panel. Do not shrink horizontal figures relative to standing anatomy: keep head, limb, and shoe sizes consistent through layout/padding. Flat opaque gray presentation with contact shadows; no scene or transparency checkerboard. These remain references for future animation integration.
