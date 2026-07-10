import json
import os
import sys

import bpy


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
MODEL_DIR = os.path.join(ROOT, 'assets', 'models')
FILES = [
    'char_anims.glb',
    'char_anims_general.glb',
    'char_anims_melee.glb',
    'char_anims_ranged.glb',
    'char_anims_dodge.glb',
    'kaykit_skeletons.glb',
]


def reset_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def action_seconds(action):
    start, end = action.frame_range
    fps = bpy.context.scene.render.fps or 24
    return max(0.0, (end - start) / fps)


def main():
    out = []
    for name in FILES:
        path = os.path.join(MODEL_DIR, name)
        if not os.path.exists(path):
            out.append({'file': name, 'missing': True, 'clips': []})
            continue
        reset_scene()
        bpy.ops.import_scene.gltf(filepath=path)
        clips = []
        for action in bpy.data.actions:
            clips.append({
                'name': action.name,
                'seconds': round(action_seconds(action), 4),
                'frames': [round(float(action.frame_range[0]), 2), round(float(action.frame_range[1]), 2)],
            })
        clips.sort(key=lambda item: item['name'])
        out.append({'file': name, 'missing': False, 'clips': clips})
    print('BLENDER_CLIP_AUDIT ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    main()
