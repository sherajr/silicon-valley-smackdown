"""Exports Darth Maul's rigged 3D model as a runtime-animated GLB for the Three.js renderer.

This is a *different* pipeline from maul_sprites.py, which snapshots posed meshes into flat PNGs
for the 2D sprite sheets and explicitly documents that those static snapshots are not a substitute
for an animated runtime asset. This script instead bakes real keyframed animation onto the actual
deform skeleton, so the exported GLB carries a skinned mesh + skeleton + animation clips that play
independently of Blender (no drivers, no Auto-Rig Pro addon, no constraints required at runtime).

Usage:
    blender -b "<dir>/FIGHTER.blend" --python scripts/art/export_maul_glb.py -- \
        --out public/models/fighters/maul/maul.glb --report .scratch/maul_glb_report.json

Reuses scripts/art/maul_sprites.py for the already-solved parts of this .blend: fixing the
repointed texture paths, hiding non-character objects (and un-hiding the armature, which ships
with hide_render=True), rebuilding the imported Maya/Arnold materials as plain Principled BSDFs,
and the pose-authoring API (STANCE/POSES/apply_pose) built for the sprite renders. See that file's
docstring and src/render docs for the two silent-failure traps in this .blend; this script avoids
both by construction:

1. hide_render on the armature: handled by isolate() (reused).
2. Driver reset on frame change: maul_sprites.py discovered that ANY bpy.context.scene.frame_set()
   call (including the one implicit in bpy.ops.render.render()) re-evaluates this rig's 194
   FK/IK-blend drivers and resets every posed control bone back to rest. This script never calls
   frame_set(): poses are applied with the existing pb.matrix-assignment technique (proven safe --
   it's exactly how the sprite renderer already poses control bones), and animation keyframes are
   written with keyframe_insert(..., frame=N), which records the CURRENT (already posed) value at
   an explicit frame number without moving the scene's playhead there.

Deform-vs-control skeleton: Blender's own `bone.use_deform` flag (not name-guessing) identifies the
66 bones actually skinned to the character meshes, out of 331 total (Auto-Rig Pro control/mechanism
bones). Posing sets the CONTROL bones (as POSES already does); after each pose, this script reads
the *evaluated* (post-constraint) matrix of each of the 66 deform bones and bakes that into real
keyframes on the original bones. Deform bones POSES never touches (mainly the finger chain, which
apply_pose() never drives) simply keep whatever grip pose was already authored in the file, since
nothing here alters or clears them -- preserving the saber grip across every clip.

Known scope limit (documented rather than silently shipped): this exports the full 331-bone
armature as the skeleton (with only the 66 deform bones ever keyframed) rather than trimming to a
clean ~70-bone export skeleton. The extra bones are inert (no vertex group references them) and
cost a small, bounded amount of parse/memory overhead, not a correctness or gameplay problem --
trimming them is a worthwhile follow-up, not a blocker. See docs/3d-conversion-checklist.md.
"""
import bpy
import sys
import os
import json
import importlib.util

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_maul_sprites():
    spec = importlib.util.spec_from_file_location('maul_sprites', os.path.join(SCRIPT_DIR, 'maul_sprites.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MS = load_maul_sprites()


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def opt(name, default=None):
    a = argv()
    return a[a.index(name) + 1] if name in a else default


def flag(name):
    return name in argv()


# --------------------------------------------------------------------------- scene prep

def prep_scene():
    MS.fix_textures()
    MS.isolate()  # un-hides the armature (hide_render trap) and hides everything not the character
    MS.rebuild_materials()
    # DRESS DARTH_MAUL ships with an unbaked Cloth modifier; export wants its plain rest mesh,
    # rigidly bone-parented to root.x like the other non-skinned props (weapon/horns/eyes).
    dress = bpy.data.objects.get('DRESS DARTH_MAUL')
    if dress:
        for m in list(dress.modifiers):
            if m.type == 'CLOTH':
                dress.modifiers.remove(m)
    # Promotes SUBSURF to its render level and drops the COLLISION modifier on BELT.002 (reused
    # from the sprite pipeline, which needs this for the same reason: a real evaluated mesh).
    MS.prep_snapshots()


def rig():
    return bpy.data.objects['rig']


# --------------------------------------------------------------------------- deform-bone baking

def deform_bone_names():
    return sorted(b.name for b in rig().data.bones if b.use_deform)


def channel_paths(pose_bone):
    mode = pose_bone.rotation_mode
    if mode == 'QUATERNION':
        rot = 'rotation_quaternion'
    elif mode == 'AXIS_ANGLE':
        rot = 'rotation_axis_angle'
    else:
        rot = 'rotation_euler'
    return ['location', rot, 'scale']


def read_deform_targets(deform_names):
    """Pass 1: with constraints still ACTIVE, read each deform bone's current constrained
    (post-IK/FK-blend) armature-space matrix. Call this right after apply_pose()+the
    view_layer.update() it already does, before any constraint muting happens."""
    r = rig()
    deps = bpy.context.evaluated_depsgraph_get()
    eval_r = r.evaluated_get(deps)
    return {name: eval_r.pose.bones[name].matrix.copy() for name in deform_names}


def mute_deform_constraints(deform_names):
    """Pass 2 setup, done once after every pose has been read.

    PoseBone.matrix assignment computes matrix_basis *ignoring* the bone's constraints -- so for
    an unconstrained bone (the control bones POSES targets) it cleanly sets the intended pose, but
    for a constrained deform bone (hand.l etc. -- driven by Copy Rotation/Location/Scale from the
    FK/IK blend chain) the constraint simply overrides it again on the next evaluation, silently
    discarding the write. First attempt at this script hit exactly that: every baked clip came out
    nearly identical regardless of pose. Muting (not removing) each constraint only for the write
    pass fixes it without disturbing the values Pass 1 already read while they were live.
    """
    r = rig()
    for name in deform_names:
        for c in r.pose.bones[name].constraints:
            c.mute = True


def bake_frame(action, frame, targets):
    """Pass 2: write already-captured (pre-mute) target matrices into real keyframes."""
    r = rig()
    r.animation_data.action = action
    for name, mat in targets.items():
        pb = r.pose.bones[name]
        pb.matrix = mat
        for path in channel_paths(pb):
            pb.keyframe_insert(data_path=path, frame=frame)


def new_clip_action(name):
    r = rig()
    action = bpy.data.actions.new(name=name)
    action.use_fake_user = True
    r.animation_data_create()
    r.animation_data.action = action
    return action


# --------------------------------------------------------------------------- clip authoring
#
# Reuses maul_sprites.POSES verbatim (the same idle/walk/atk/jump/crouch/block/hurt poses
# authored for the sprite sheets) as keyframe sources for real baked clips, instead of the static
# per-pose snapshots that pipeline renders. Deliberately matches -- rather than exceeds -- the
# shipped 2D art's own animation fidelity for the states it does not distinguish today (e.g. every
# painted fighter's hitstun/knockdown/KO cells and jump/crouch/block poses are single un-animated
# cells; see SpriteFactory.buildArtVisuals). Per-move bespoke coverage for all eight of Maul's
# moves (beyond Basic1 getting its own clip) is a follow-up -- see the checklist.
CLIPS = {
    # (clip_name, [(frame, pose_name), ...])
    'Idle': [(1, 'idle0'), (6, 'idle1'), (11, 'idle2'), (16, 'idle3'), (21, 'idle0')],
    'Walk': [(1, 'walk0'), (6, 'walk1'), (11, 'walk2'), (16, 'walk3'), (21, 'walk0')],
    'Jump': [(1, 'jump')],
    'Crouch': [(1, 'crouch')],
    'Block': [(1, 'block')],
    'Hurt': [(1, 'hurt')],
    # Basic1 (Saber Jab I): a quick two-hit-frame jab -- windup, strike, recovery.
    'Basic1': [(1, 'atk0'), (4, 'atk1'), (9, 'atk3')],
    # Shared fuller swing, reused across the rest of the attack-kind moves for now (basic2/basic3/
    # forwardBasic/special/downSpecial/grab/super/crouchBasic/jumpBasic), matching how the shipped
    # 2D art also recombines the same four attack cells across every one of those moves.
    'Attack': [(1, 'atk0'), (5, 'atk1'), (9, 'atk2'), (13, 'atk3')],
}


def build_clips(deform_names):
    # Pass 1: capture every clip's every frame's constrained deform-bone targets while
    # constraints are still live -- constraints get muted (globally, once) before Pass 2 writes.
    captured = []
    for clip_name, keys in CLIPS.items():
        frames = []
        for frame, pose_name in keys:
            MS.apply_pose(MS.POSES[pose_name])
            frames.append((frame, read_deform_targets(deform_names)))
        captured.append((clip_name, frames))
        print(f'@@ captured {clip_name}: {len(frames)} frames')

    mute_deform_constraints(deform_names)

    for clip_name, frames in captured:
        action = new_clip_action(f'Maul_{clip_name}')
        for frame, targets in frames:
            bake_frame(action, frame, targets)
        print(f'@@ clip {clip_name}: {len(frames)} keyframes')


def reset_deform_bones_to_bind(deform_names):
    """Baking leaves every deform bone's live matrix_basis at whatever the last clip's last
    keyframe set it to -- harmless during play (a clip is always driving the mixer), but it would
    make the GLB's default/no-animation-active pose an arbitrary attack frame instead of the bind
    pose, and would throw off a bounding-box measurement taken before any clip plays. Reset (only
    the deform bones the export keys; constraints are already muted so this sticks)."""
    r = rig()
    for name in deform_names:
        pb = r.pose.bones[name]
        pb.location = (0, 0, 0)
        if pb.rotation_mode == 'QUATERNION':
            pb.rotation_quaternion = (1, 0, 0, 0)
        elif pb.rotation_mode == 'AXIS_ANGLE':
            pb.rotation_axis_angle = (0, 0, 1, 0)
        else:
            pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def purge_foreign_actions():
    """Only the Maul_* clips just authored should reach the exporter -- not the file's original
    rigAction or the unrelated leftover mixamo/"GUN. SUPER" actions from other objects."""
    keep = {f'Maul_{name}' for name in CLIPS}
    for action in list(bpy.data.actions):
        if action.name not in keep:
            action.use_fake_user = False
            try:
                bpy.data.actions.remove(action)
            except Exception as e:
                print('@@ could not remove action', action.name, e)


# --------------------------------------------------------------------------- export

def select_export_set():
    # bpy.ops.object.select_all() polls for a window/area context that does not exist under
    # `blender -b` (no UI at all), so deselect by setting select_set() directly instead.
    for ob in bpy.context.scene.objects:
        ob.select_set(False)
    for name in MS.CHAR_MESHES:
        ob = bpy.data.objects.get(name)
        if ob and not ob.hide_render:
            ob.select_set(True)
    rig().select_set(True)
    bpy.context.view_layer.objects.active = rig()


def export_glb(out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    select_export_set()
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kwargs = dict(
        filepath=out_path,
        export_format='GLB',
        use_selection=True,
        export_animations=True,
        export_skins=True,
        export_morph=False,
        export_yup=True,
        export_apply=False,
    )
    # Property names have moved across Blender/io_scene_gltf2 versions; only pass ones this
    # installed version actually exposes, printed for the record either way.
    optional = {
        'export_animation_mode': 'ACTIONS',
        'export_materials': 'EXPORT',
        'export_texcoords': True,
        'export_normals': True,
        'export_tangents': False,
        'export_cameras': False,
        'export_lights': False,
        'export_optimize_animation_size': True,
        'export_current_frame': False,
    }
    for k, v in optional.items():
        if k in props:
            kwargs[k] = v
        else:
            print(f'@@ skipping unsupported export option {k}')
    print('@@ export kwargs', kwargs)
    bpy.ops.export_scene.gltf(**kwargs)


# --------------------------------------------------------------------------- report

def write_report(path, out_path, deform_names):
    tri = 0
    mats = set()
    for name in MS.CHAR_MESHES:
        ob = bpy.data.objects.get(name)
        if not ob or ob.hide_render:
            continue
        for poly in ob.data.polygons:
            tri += max(0, len(poly.vertices) - 2)
        for m in ob.data.materials:
            if m:
                mats.add(m.name)
    images = {img.name for img in bpy.data.images if img.users > 0 and img.name not in ('Render Result', 'Viewer Node')}
    report = {
        'triangles_estimate': tri,
        'materials': sorted(mats),
        'deform_bone_count': len(deform_names),
        'total_bone_count': len(rig().data.bones),
        'clips': {name: len(keys) for name, keys in CLIPS.items()},
        'images': sorted(images),
        'file_size_bytes': os.path.getsize(out_path) if os.path.exists(out_path) else None,
    }
    if path:
        os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
        with open(path, 'w') as f:
            json.dump(report, f, indent=2)
    print('@@ REPORT', json.dumps(report, indent=2))


if __name__ == '__main__':
    out_path = opt('--out', 'public/models/fighters/maul/maul.glb')
    report_path = opt('--report')

    prep_scene()
    MS.capture_rest()
    names = deform_bone_names()
    print(f'@@ deform bones: {len(names)} of {len(rig().data.bones)} total')

    build_clips(names)
    reset_deform_bones_to_bind(names)
    purge_foreign_actions()
    export_glb(out_path)
    write_report(report_path, out_path, names)
    print('@@ DONE', out_path)
