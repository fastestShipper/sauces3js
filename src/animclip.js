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

function trackProperty(name) {
  try {
    return THREE.PropertyBinding.parseTrackName(name).propertyName;
  } catch {
    const dot = String(name || '').lastIndexOf('.');
    return dot < 0 ? '' : String(name).slice(dot + 1);
  }
}

// RETARGET a un rig de otras PROPORCIONES (el gigante: Rig_Large).
//
// Los rigs de KayKit comparten nombres y jerarquia de huesos, pero el gigante
// tiene huesos mas largos. Los clips traen tracks de `position` ABSOLUTOS en los
// 41 huesos: reproducirlos tal cual le pisa las longitudes y lo colapsa a las
// proporciones del heroe normal a mitad del golpe.
//
// Una rotacion es independiente de la proporcion; una traslacion no. Nos
// quedamos solo con las rotaciones: el gigante conserva su cuerpo y adopta la
// pose. `scale` tambien se descarta (los clips no la usan de verdad).
//
// OJO: esto NO reemplaza a plantClip. plantClip quita el DESPLAZAMIENTO del root
// (el controller mueve al personaje) y conserva el salto vertical y el detalle
// de miembros. Esta funcion quita la PROPORCION. Un gigante necesita las dos.
export function retargetRotationOnly(clip) {
  const tracks = [];
  for (const track of clip.tracks || []) {
    if (trackProperty(track.name) !== 'quaternion') continue;
    tracks.push(track.clone());
  }
  if (!tracks.length) return clip.clone();
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
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
