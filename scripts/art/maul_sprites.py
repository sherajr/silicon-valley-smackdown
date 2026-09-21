"""Regenerates Maul's sprite sheets from the rigged 3D model.

Maul is the only fighter whose art is rendered rather than painted, so his four sheets in
public/sprites/fighters/maul/ are build output, not source: to change a pose, edit POSES below
and re-run this, rather than editing the PNGs.

    blender -b "<dir>/FIGHTER.blend" --python scripts/art/maul_sprites.py -- \
        --out <work-dir> --res 4 --dest public/sprites/fighters/maul [--contact]

    # re-pack the sheets from renders already in <work-dir>, without re-rendering:
    blender -b --python scripts/art/maul_sprites.py -- \
        --sheets-only --out <work-dir> --res 4 --dest public/sprites/fighters/maul

--poses a,b renders a subset (the sheet build still reads all sixteen cells from --out), and
--contact writes a review grid of everything rendered in that run.

Two things about this .blend are load-bearing and cost real time to rediscover; both are handled
below and explained at the point of use: the rig ships with hide_render on, and the render
pipeline's frame update re-evaluates the rig's 194 drivers, which resets any pose set from script.
"""
import bpy, sys, os, math
from mathutils import Vector, Matrix, Euler


def texture_dir():
    """Where the model's textures live. The .blend points at the machine it was authored on, so
    the copies next to the .blend are used instead; --src overrides."""
    return opt("--src", os.path.dirname(bpy.data.filepath))

# Cell geometry mirrored from public/sprites/manifest.json + SpriteFactory.ts.
CELL_W, CELL_H = 96, 120
FOOT_ROW = 115.4          # measured ground-contact row (115) plus a half-pixel so feet land ON it
ORTHO = 16.4              # world units spanned by the cell height: puts the 15.02-unit model at ~110px, matching the shipped roster

CHAR_MESHES = {'BELT', 'BELT.002', 'DRESS DARTH_MAUL', 'EYE2', 'EYE2.001',
               'HORNES', 'WEAPON', 'WEPON polySurface8', 'WEPON polySurface8.001'}


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def opt(name, default=None):
    a = argv()
    return a[a.index(name) + 1] if name in a else default


def flag(name):
    return name in argv()


# --------------------------------------------------------------------------- scene setup
def fix_textures():
    """The .blend points at another machine's Downloads folder; repoint to the local copies."""
    for img in bpy.data.images:
        if not img.filepath:
            continue
        local = os.path.join(texture_dir(), os.path.basename(img.filepath.replace(chr(92), '/')))
        if os.path.exists(local):
            img.filepath = local
            try:
                img.reload()
            except Exception as e:
                print("@@ reload failed", img.name, e)


def isolate():
    """Only the character renders: no environment, no floor, no rig control widgets."""
    for o in bpy.data.objects:
        keep = o.name in CHAR_MESHES
        if o.type == 'MESH':
            o.hide_render = not keep
            o.hide_viewport = not keep
        elif o.type in {'LIGHT', 'CAMERA'}:
            o.hide_render = True
            o.hide_viewport = True
        elif o.type == 'ARMATURE':
            # The .blend ships the rig with hide_render on. An armature excluded from the
            # render depsgraph leaves every Armature modifier with nothing to read, so the
            # meshes render undeformed and every pose comes out identical -- while the
            # viewport depsgraph (what evaluated_get() reads) still deforms correctly.
            # Armatures draw no geometry, so un-hiding costs nothing.
            o.hide_render = False
            o.hide_viewport = False


def _principled(mat, image=None, base=(0.5, 0.5, 0.5, 1.0), rough=0.55, metal=0.0,
                gamma=None, emit=None, emit_strength=0.0):
    """Replace an imported Maya/Arnold shader with a plain Principled setup. The originals are
    Diffuse+Glossy add-shaders whose colour is throttled by a Hue/Sat node, which renders this
    character as a flat black hole at any size."""
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        src = tex.outputs['Color']
        if gamma is not None:
            g = nt.nodes.new('ShaderNodeGamma')
            g.inputs['Gamma'].default_value = gamma
            nt.links.new(src, g.inputs['Color'])
            src = g.outputs['Color']
        nt.links.new(src, bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = base
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = emit
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


def rebuild_materials():
    img0 = bpy.data.images.get('texture0.PNG')   # face / head
    img1 = bpy.data.images.get('texture1.PNG')   # robes

    cloth = bpy.data.materials.get('CLOTH.001')
    if cloth:
        # gamma < 1 lifts the near-black robe texture into a readable dark grey so folds and
        # limbs separate at 96px instead of merging into one silhouette.
        _principled(cloth, image=img1, gamma=0.45, rough=0.62)
    head = bpy.data.materials.get('HEAD')
    if head:
        _principled(head, image=img0, gamma=0.78, rough=0.5)
    eyes = bpy.data.materials.get('aiStandardSurface6SG')
    if eyes:
        _principled(eyes, base=(1.0, 0.72, 0.05, 1.0), rough=0.25,
                    emit=(1.0, 0.72, 0.05, 1.0), emit_strength=3.0)
    hilt = bpy.data.materials.get('aiStandardSurface4SG')
    if hilt:
        _principled(hilt, base=(0.32, 0.32, 0.34, 1.0), rough=0.28, metal=1.0)
    blade = bpy.data.materials.get('aiStandardSurface7SG')
    if blade:
        # Ships as an Arnold volume shader, which renders as nothing in EEVEE.
        _principled(blade, base=(0.02, 0.0, 0.0, 1.0), rough=0.4,
                    emit=(1.0, 0.09, 0.06, 1.0), emit_strength=7.0)

    # The horns share the robe texture and vanish into the hood; a bone tint makes the crown
    # read as Maul's silhouette at sprite size.
    horn = bpy.data.materials.new('SVS_HORN')
    _principled(horn, base=(0.62, 0.5, 0.36, 1.0), rough=0.55)
    ob = bpy.data.objects.get('HORNES')
    if ob:
        ob.data.materials.clear()
        ob.data.materials.append(horn)


def add_lights():
    """Three-point rig sized for a near-black character: the rims carry the silhouette."""
    for name, loc, power, color in [
        ('key',  (-10.0, -13.0, 15.0), 15000.0, (1.0, 0.94, 0.88)),
        ('fill', (13.0, -8.0, 8.0),    7000.0, (0.6, 0.7, 1.0)),
        ('rim',  (8.0, 10.0, 13.0),    15000.0, (1.0, 0.5, 0.4)),
        ('rim2', (-12.0, 8.0, 11.0),   10000.0, (0.65, 0.8, 1.0)),
        ('up',   (0.0, -9.0, 2.0),     5000.0, (1.0, 0.6, 0.5)),
    ]:
        d = bpy.data.lights.new("svs_" + name, 'POINT')
        d.energy = power
        d.color = color
        d.shadow_soft_size = 3.5
        ob = bpy.data.objects.new("svs_" + name, d)
        ob.location = loc
        bpy.context.scene.collection.objects.link(ob)

    w = bpy.data.worlds.new('svs_world')
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.12, 0.13, 0.19, 1.0)
        bg.inputs['Strength'].default_value = 1.0
    bpy.context.scene.world = w


def add_camera():
    """Orthographic 3/4 view. The model's own forward is -Y, so a camera in the (+X,-Y)
    quadrant sees the saber side of the body; frames are flipped horizontally in post so the
    sprite faces right like the rest of the roster.

    Framing is identical for every pose so feet land on the same cell row at the same scale:
    world z=0 maps to FOOT_ROW and ORTHO world units span the cell height.
    """
    cam_d = Vector((0.82, -0.57, 0.0)).normalized()
    center_z = (FOOT_ROW - CELL_H / 2.0) / CELL_H * ORTHO
    target = Vector((0.0, 0.0, center_z))
    data = bpy.data.cameras.new('svs_cam')
    data.type = 'ORTHO'
    data.ortho_scale = ORTHO
    cam = bpy.data.objects.new('svs_cam', data)
    cam.location = target + cam_d * 60.0
    cam.rotation_euler = (target - cam.location).normalized().to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam


def render_settings(mult):
    s = bpy.context.scene
    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH'):
        try:
            s.render.engine = engine
            break
        except Exception:
            continue
    s.render.resolution_x = CELL_W * mult
    s.render.resolution_y = CELL_H * mult
    s.render.resolution_percentage = 100
    s.render.film_transparent = True
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.render.filter_size = 1.2
    try:
        s.view_settings.view_transform = 'Standard'
        s.view_settings.look = 'None'
    except Exception as e:
        print("@@ view transform", e)
    try:
        s.eevee.taa_render_samples = 24
    except Exception:
        pass
    # Never inherit the source file's compositor / sequencer output.
    s.use_nodes = False
    s.render.use_sequencer = False
    s.render.use_compositing = False


# --------------------------------------------------------------------------- posing
REST = {}


def rig():
    return bpy.data.objects['rig']


def capture_rest():
    for pb in rig().pose.bones:
        REST[pb.name] = pb.matrix.copy()


def clear_pose():
    """Reset only the controls we author. Zeroing all 331 bones would also throw away the
    file's saved finger grip on the saber and drop the rig to a bare T-pose."""
    r = rig()
    for name in POSED_BONES:
        pb = r.pose.bones.get(name)
        if pb is None:
            continue
        pb.location = (0, 0, 0)
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def place(bone, dx=0.0, dy=0.0, dz=0.0, rx=0.0, ry=0.0, rz=0.0):
    """Offset an IK-style control in WORLD space from its rest matrix.
    +x = character's left, -y = the way the character faces, +z = up."""
    pb = rig().pose.bones.get(bone)
    if pb is None:
        print("@@ missing bone", bone)
        return
    rest = REST[bone]
    rot = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_matrix().to_4x4()
    head = rest.to_translation() + Vector((dx, dy, dz))
    pb.matrix = Matrix.Translation(head) @ rot @ rest.to_3x3().to_4x4()
    bpy.context.view_layer.update()


def turn(bone, rx=0.0, ry=0.0, rz=0.0, dx=0.0, dy=0.0, dz=0.0):
    """Rotate an FK/chain control in its OWN local space, so children follow along."""
    pb = rig().pose.bones.get(bone)
    if pb is None:
        print("@@ missing bone", bone)
        return
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz))
    pb.location = (dx, dy, dz)
    bpy.context.view_layer.update()


FK_BONES = {'c_spine_01.x', 'c_neck.x', 'c_head.x', 'c_shoulder.l', 'c_shoulder.r'}


def apply_pose(spec):
    clear_pose()
    # Root first so the IK controls, which are absolute, are not fighting a moving pelvis.
    for bone in ['c_root.x'] + [b for b in spec if b != 'c_root.x']:
        if bone not in spec:
            continue
        kw = dict(spec[bone])
        (turn if bone in FK_BONES else place)(bone, **kw)
    bpy.context.view_layer.update()


def merged(*layers):
    out = {}
    for layer in layers:
        for bone, kw in layer.items():
            out.setdefault(bone, {}).update(kw)
    return out


# Fighting stance everything else is built on: hips dropped, feet split along the facing axis
# (-y is forward) rather than the model's rest A-pose split across x, saber up in a guard.
STANCE = {
    'c_root.x':     dict(dy=0.3, dz=-1.15),
    'c_foot_ik.l':  dict(dx=-1.1, dy=-2.7),
    'c_foot_ik.r':  dict(dx=0.45, dy=2.0, rz=32),
    'c_hand_ik.l':  dict(dx=-0.25, dy=-2.2, dz=2.15, rx=-55),
    'c_hand_ik.r':  dict(dx=1.75, dy=-1.3, dz=2.45),
    'c_spine_01.x': dict(rx=7),
    'c_head.x':     dict(rx=-5),
}

POSES = {
    # --- idle loop: a slow breathing sway on the guard ---
    'idle0': merged(STANCE, {}),
    'idle1': merged(STANCE, {'c_root.x': dict(dy=0.3, dz=-0.95), 'c_hand_ik.l': dict(dz=2.35),
                             'c_spine_01.x': dict(rx=5)}),
    'idle2': merged(STANCE, {'c_root.x': dict(dy=0.3, dz=-0.8), 'c_hand_ik.l': dict(dz=2.5, rx=-60),
                             'c_hand_ik.r': dict(dz=2.65), 'c_spine_01.x': dict(rx=3)}),
    'idle3': merged(STANCE, {'c_root.x': dict(dy=0.3, dz=-0.98), 'c_hand_ik.l': dict(dz=2.35),
                             'c_spine_01.x': dict(rx=5)}),

    # --- walk: a stalking shuffle. A fighter never crosses its feet, so this is a step-and-
    # -follow cycle -- lead foot reaches, rear foot closes -- with the guard held throughout.
    'walk0': merged(STANCE, {'c_foot_ik.l': dict(dx=-1.1, dy=-4.2), 'c_foot_ik.r': dict(dx=0.45, dy=2.6, rz=32),
                             'c_root.x': dict(dy=0.3, dz=-1.75), 'c_hand_ik.l': dict(dz=2.0)}),
    'walk1': merged(STANCE, {'c_foot_ik.l': dict(dx=-1.1, dy=-4.2), 'c_foot_ik.r': dict(dx=0.5, dy=0.9, dz=1.0, rz=32),
                             'c_root.x': dict(dy=0.3, dz=-1.2), 'c_hand_ik.l': dict(dz=2.3)}),
    'walk2': merged(STANCE, {'c_foot_ik.l': dict(dx=-1.1, dy=-3.0), 'c_foot_ik.r': dict(dx=0.45, dy=1.3, rz=32),
                             'c_root.x': dict(dy=0.3, dz=-1.1), 'c_hand_ik.l': dict(dz=2.35)}),
    'walk3': merged(STANCE, {'c_foot_ik.l': dict(dx=-1.2, dy=-4.8, dz=1.0), 'c_foot_ik.r': dict(dx=0.45, dy=1.3, rz=32),
                             'c_root.x': dict(dy=0.3, dz=-1.2), 'c_hand_ik.l': dict(dz=2.1)}),

    # --- attack: a saber swing. 0 wind-up, 1 strike, 2 full extension, 3 recovery ---
    'atk0': merged(STANCE, {'c_hand_ik.l': dict(dx=0.1, dy=1.7, dz=3.6, rx=-118),
                            'c_hand_ik.r': dict(dx=1.6, dy=0.7, dz=2.8),
                            'c_spine_01.x': dict(rx=1, ry=-18),
                            'c_foot_ik.l': dict(dx=-1.1, dy=-2.2),
                            'c_root.x': dict(dy=0.8, dz=-1.05)}),
    'atk1': merged(STANCE, {'c_hand_ik.l': dict(dx=-0.3, dy=-2.4, dz=3.2, rx=-25),
                            'c_hand_ik.r': dict(dx=1.7, dy=-1.0, dz=2.6),
                            'c_spine_01.x': dict(rx=9),
                            'c_foot_ik.l': dict(dx=-1.1, dy=-3.4),
                            'c_root.x': dict(dy=-0.2, dz=-1.35)}),
    'atk2': merged(STANCE, {'c_hand_ik.l': dict(dx=-0.5, dy=-4.3, dz=2.0, rx=32),
                            'c_hand_ik.r': dict(dx=1.5, dy=-2.4, dz=1.9),
                            'c_spine_01.x': dict(rx=19),
                            'c_foot_ik.l': dict(dx=-1.1, dy=-4.6),
                            'c_foot_ik.r': dict(dx=0.45, dy=1.8, rz=32),
                            'c_root.x': dict(dy=-0.9, dz=-1.75)}),
    'atk3': merged(STANCE, {'c_hand_ik.l': dict(dx=-0.3, dy=-2.7, dz=2.5, rx=-34),
                            'c_hand_ik.r': dict(dx=1.7, dy=-1.5, dz=2.3),
                            'c_spine_01.x': dict(rx=12),
                            'c_foot_ik.l': dict(dx=-1.1, dy=-3.2),
                            'c_root.x': dict(dy=-0.1, dz=-1.35)}),

    # --- poses sheet: 0 jump, 1 crouch, 2 block, 3 hurt ---
    # Knees tuck up to the hips rather than the whole body rising: the cell has no headroom,
    # and the sprite's own y is driven by the sim, not by the art.
    'jump': merged(STANCE, {'c_root.x': dict(dy=0.3, dz=0.15),
                            'c_foot_ik.l': dict(dx=-1.2, dy=-2.0, dz=4.6),
                            'c_foot_ik.r': dict(dx=0.5, dy=0.4, dz=3.6, rz=20),
                            'c_hand_ik.l': dict(dx=0.1, dy=-1.2, dz=1.6, rx=-55),
                            'c_hand_ik.r': dict(dx=1.6, dy=-1.8, dz=3.4),
                            'c_spine_01.x': dict(rx=-12)}),
    # Feet also come closer together: with IK legs, a wide stance stops the knees folding and
    # the crouch bottoms out well short of a real one.
    'crouch': merged(STANCE, {'c_root.x': dict(dy=0.8, dz=-4.8),
                              'c_foot_ik.l': dict(dx=-1.2, dy=-1.9),
                              'c_foot_ik.r': dict(dx=0.6, dy=1.1, rz=38),
                              'c_hand_ik.l': dict(dx=-0.3, dy=-2.3, dz=-1.4, rx=-42),
                              'c_hand_ik.r': dict(dx=1.6, dy=-1.4, dz=-1.1),
                              'c_spine_01.x': dict(rx=26)}),
    'block': merged(STANCE, {'c_root.x': dict(dy=0.9, dz=-1.5),
                             'c_foot_ik.l': dict(dx=-1.1, dy=-2.0),
                             'c_foot_ik.r': dict(dx=0.45, dy=2.2, rz=38),
                             'c_hand_ik.l': dict(dx=-0.9, dy=-2.8, dz=1.7, rx=-76),
                             'c_hand_ik.r': dict(dx=1.4, dy=-2.0, dz=2.5),
                             'c_spine_01.x': dict(rx=11, ry=14),
                             'c_head.x':     dict(rx=9)}),
    'hurt': merged(STANCE, {'c_root.x': dict(dy=1.9, dz=-0.9),
                            'c_foot_ik.l': dict(dx=-1.1, dy=-1.8),
                            'c_foot_ik.r': dict(dx=0.45, dy=2.9, rz=30),
                            'c_hand_ik.l': dict(dx=0.5, dy=0.9, dz=1.4, rx=-125),
                            'c_hand_ik.r': dict(dx=2.2, dy=1.2, dz=3.1),
                            'c_spine_01.x': dict(rx=-20),
                            'c_head.x':     dict(rx=-18)}),
}

ORDER = ['idle0', 'idle1', 'idle2', 'idle3', 'walk0', 'walk1', 'walk2', 'walk3',
         'atk0', 'atk1', 'atk2', 'atk3', 'jump', 'crouch', 'block', 'hurt']

POSED_BONES = sorted({b for spec in POSES.values() for b in spec})


def setup(mult):
    fix_textures()
    isolate()
    rebuild_materials()
    add_lights()
    render_settings(mult)
    add_camera()
    capture_rest()
    prep_snapshots()
    w = bpy.data.objects.get('WEAPON')
    if w:
        print("@@ WEAPON parent", w.parent.name if w.parent else None, "parent_bone", repr(w.parent_bone),
              "mods", [m.type for m in w.modifiers], "vgroups", [g.name for g in w.vertex_groups][:6])


def prep_snapshots():
    """Subdivision ships viewport-off / render-on, but snapshots are taken from the viewport
    depsgraph -- so promote it there and drop the physics modifier we never simulate."""
    for name in CHAR_MESHES:
        ob = bpy.data.objects.get(name)
        if not ob:
            continue
        for m in list(ob.modifiers):
            if m.type == 'COLLISION':
                ob.modifiers.remove(m)
            elif m.type == 'SUBSURF':
                m.show_viewport = True
                m.levels = m.render_levels


def snapshot():
    """Freeze the posed character into plain static meshes and render those instead.

    Rendering the rig directly does not work here: bpy.ops.render.render() runs a frame update,
    that re-evaluates the rig's 194 drivers, and the drivers reset every control bone back to
    rest -- so every pose renders identically. The viewport depsgraph does deform correctly, so
    we copy the evaluated meshes out of it and render those, with the armature out of the loop.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    temps = []
    for name in CHAR_MESHES:
        src = bpy.data.objects.get(name)
        if not src:
            continue
        ev = src.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
        ob = bpy.data.objects.new('SNAP_' + name, me)
        ob.matrix_world = ev.matrix_world
        bpy.context.scene.collection.objects.link(ob)
        temps.append(ob)
        src.hide_render = True
    bpy.context.view_layer.update()
    return temps


def drop_snapshots(temps):
    for ob in temps:
        me = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(me)
    for name in CHAR_MESHES:
        ob = bpy.data.objects.get(name)
        if ob:
            ob.hide_render = False


def render_to(path):
    temps = snapshot()
    try:
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
    finally:
        drop_snapshots(temps)


# --------------------------------------------------------------------------- contact sheet
def contact_sheet(paths, out_path, cols=4):
    """Tile rendered cells into one reviewable image using Blender's own image API."""
    import numpy as np
    imgs = []
    for p in paths:
        im = bpy.data.images.load(p)
        w, h = im.size
        buf = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        imgs.append(buf)
        bpy.data.images.remove(im)
    h, w = imgs[0].shape[:2]
    rows = (len(imgs) + cols - 1) // cols
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    # checker backdrop so transparent areas are obvious under review
    for r in range(rows * h):
        for c in range(0, cols * w, 1):
            pass
    for i, buf in enumerate(imgs):
        r, c = divmod(i, cols)
        # Blender image rows run bottom-up; keep that convention throughout.
        rr = rows - 1 - r
        sheet[rr * h:(rr + 1) * h, c * w:(c + 1) * w] = buf
    out = bpy.data.images.new('contact', width=cols * w, height=rows * h, alpha=True)
    out.pixels = sheet.reshape(-1)
    out.file_format = 'PNG'
    out.filepath_raw = out_path
    out.save()
    print("@@ contact", out_path)


# --------------------------------------------------------------------------- sheet build
SHEETS = {
    'idle':   ['idle0', 'idle1', 'idle2', 'idle3'],
    'walk':   ['walk0', 'walk1', 'walk2', 'walk3'],
    'attack': ['atk0', 'atk1', 'atk2', 'atk3'],
    'poses':  ['jump', 'crouch', 'block', 'hurt'],
}


def load_rgba(path):
    """Returns float RGBA, rows bottom-up (Blender's own convention), in linear space."""
    import numpy as np
    im = bpy.data.images.load(path)
    w, h = im.size
    buf = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(im)
    return buf


def save_rgba(arr, path):
    import numpy as np
    h, w = arr.shape[:2]
    im = bpy.data.images.new('svs_out', width=w, height=h, alpha=True)
    im.alpha_mode = 'STRAIGHT'
    im.pixels = np.clip(arr, 0.0, 1.0).reshape(-1)
    im.file_format = 'PNG'
    im.filepath_raw = path
    im.save()
    bpy.data.images.remove(im)


def downsample(buf, factor):
    """Box-filter in premultiplied alpha, so transparent pixels cannot bleed black into the
    character's edges the way a naive average over straight alpha does."""
    import numpy as np
    h, w = buf.shape[:2]
    a = buf[..., 3:4]
    pm = np.concatenate([buf[..., :3] * a, a], axis=-1)
    pm = pm.reshape(h // factor, factor, w // factor, factor, 4).mean(axis=(1, 3))
    out_a = pm[..., 3:4]
    rgb = np.divide(pm[..., :3], out_a, out=np.zeros_like(pm[..., :3]), where=out_a > 1e-5)
    return np.concatenate([rgb, out_a], axis=-1)


# Maul's own `visual.outline` (#0b090d), converted to the linear space these buffers hold.
OUTLINE_RGB = (0.0034, 0.0027, 0.0040)


def add_outline(cell, thresh=0.35):
    """Ring the silhouette in near-black, one pixel wide.

    Every painted fighter in this game is drawn with a dark keyline, and without one a rendered
    3D character reads as a soft grey smudge against the warm stages instead of a fighter. This
    is what makes Maul sit next to the hand-painted cast rather than beside it.
    """
    import numpy as np
    a = cell[..., 3]
    solid = a > thresh
    pad = np.pad(solid, 1, constant_values=False)
    grown = np.zeros_like(solid)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            grown |= pad[dy:dy + solid.shape[0], dx:dx + solid.shape[1]]
    ring = grown & ~solid
    out = cell.copy()
    out[ring, 0] = OUTLINE_RGB[0]
    out[ring, 1] = OUTLINE_RGB[1]
    out[ring, 2] = OUTLINE_RGB[2]
    out[ring, 3] = 1.0
    return out


def build_sheets(src_dir, dest_dir, factor):
    """Assemble the 16 rendered cells into the four 192x240 sheets the loader slices, flipping
    each cell so the sprite faces right like the rest of the roster."""
    import numpy as np
    os.makedirs(dest_dir, exist_ok=True)
    for sheet, names in SHEETS.items():
        cells = []
        for n in names:
            cell = downsample(load_rgba(os.path.join(src_dir, n + '.png')), factor)
            cells.append(add_outline(cell)[:, ::-1, :])
        out = np.zeros((CELL_H * 2, CELL_W * 2, 4), dtype=np.float32)
        for i, cell in enumerate(cells):
            row, col = divmod(i, 2)          # frame order is left-to-right, top-to-bottom
            rr = 1 - row                     # ...but Blender's rows run bottom-up
            out[rr * CELL_H:(rr + 1) * CELL_H, col * CELL_W:(col + 1) * CELL_W] = cell
        path = os.path.join(dest_dir, sheet + '.png')
        save_rgba(out, path)
        print("@@ sheet", path)


if __name__ == '__main__':
    mult = int(opt('--res', '4'))
    out = opt('--out', '.')
    os.makedirs(out, exist_ok=True)
    if flag('--sheets-only'):
        # Re-pack the sheets from renders already on disk; no .blend or scene setup needed.
        build_sheets(out, opt('--dest', out), mult)
        sys.exit(0)
    setup(mult)
    names = opt('--poses')
    names = ORDER if not names else names.split(',')
    paths = []
    for name in names:
        apply_pose(POSES[name])
        p = os.path.join(out, name + '.png')
        render_to(p)
        paths.append(p)
        print("@@ posed", name)
    if flag('--contact'):
        contact_sheet(paths, os.path.join(out, 'contact.png'))
    dest = opt('--dest')
    if dest:
        build_sheets(out, dest, mult)
