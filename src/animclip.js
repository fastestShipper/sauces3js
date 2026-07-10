import * as THREE from 'three';

// Combat clips often include root motion tracks. The gameplay controller already
// owns planar movement, so root/hips X/Z must stay planted while authored vertical
// movement remains available to attack, hit, death and dodge animations.
const ROOT_MOTION_BINDING_TOKENS = new Set(['armature', 'hip', 'hips', 'pelvis', 'root']);
const NON_ROOT_MOTION_TOKENS = new Set(['arm', 'elbow', 'finger', 'foot', 'hand', 'head', 'knee', 'leg', 'neck', 'shoulder', 'spine', 'toe', 'weapon']);

function bindingTokens(raw) {
  return String(raw || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function hasRootMotionBindingName(raw) {
  const tokens = bindingTokens(raw);
  if (!tokens.length) return false;
  if (tokens.some(t => NON_ROOT_MOTION_TOKENS.has(t))) return false;
  return tokens.some(t => ROOT_MOTION_BINDING_TOKENS.has(t) || t.endsWith('hips') || t.endsWith('pelvis'));
}

export function isRootMotionPositionTrack(trackOrName) {
  const name = typeof trackOrName === 'string' ? trackOrName : trackOrName?.name;
  if (!name) return false;
  try {
    const parsed = THREE.PropertyBinding.parseTrackName(name);
    if (parsed.propertyName !== 'position') return false;
    if (parsed.objectName === 'bones' && parsed.objectIndex) return hasRootMotionBindingName(parsed.objectIndex);
    return hasRootMotionBindingName(parsed.nodeName);
  } catch {
    const dot = String(name).lastIndexOf('.');
    if (dot < 0 || String(name).slice(dot + 1).toLowerCase() !== 'position') return false;
    return hasRootMotionBindingName(String(name).slice(0, dot));
  }
}

export function plantClip(clip) {
  const c = clip.clone();
  for (const track of c.tracks || []) {
    if (!isRootMotionPositionTrack(track)) continue;
    const values = track.values;
    const valueSize = track.getValueSize();
    if (!values || valueSize !== 3 || values.length < 3) continue;
    const plantedX = values[0];
    const plantedZ = values[2];
    for (let i = 0; i + 2 < values.length; i += valueSize) {
      values[i] = plantedX;
      values[i + 2] = plantedZ;
    }
  }
  return c;
}
