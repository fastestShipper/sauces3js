// Smoke: retarget rotation-only para el gigante (Rig_Large).
//
// Los rigs de KayKit comparten nombres/jerarquia de huesos pero el gigante tiene
// huesos MAS LARGOS. Los clips traen `position` absoluto en cada hueso: aplicarlos
// crudos le pisa las longitudes y lo encoge a proporciones normales.
//
// El test que importa no es "se borraron los tracks", es "el gigante SIGUE siendo
// gigante despues de animarse". Eso es lo que se verifica aqui, con un
// AnimationMixer real de three.js.
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { retargetRotationOnly, plantClip } = await import('../src/animclip.js');

// Rig de juguete: hips -> upperarm. El "heroe" tiene el brazo a 1.0 de altura;
// el "gigante", a 2.5 (huesos mas largos).
function makeRig(armY) {
  const hips = new THREE.Bone();
  hips.name = 'hips';
  const arm = new THREE.Bone();
  arm.name = 'upperarmr';
  arm.position.set(0, armY, 0);
  hips.add(arm);
  const root = new THREE.Object3D();
  root.add(hips);
  return { root, hips, arm };
}

// Clip authored sobre el heroe: rota el brazo Y ADEMAS fija su position en 1.0
// (asi exportan las herramientas: translation absoluta en todos los huesos).
function heroClip() {
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  return new THREE.AnimationClip('Melee_2H_Attack_Chop', 1, [
    new THREE.QuaternionKeyframeTrack('upperarmr.quaternion', [0, 1],
      [q0.x, q0.y, q0.z, q0.w, q1.x, q1.y, q1.z, q1.w]),
    new THREE.VectorKeyframeTrack('upperarmr.position', [0, 1], [0, 1.0, 0, 0, 1.0, 0]),
    new THREE.VectorKeyframeTrack('hips.position', [0, 1], [0, 0, 0, 3, 0, 5]),
    new THREE.VectorKeyframeTrack('upperarmr.scale', [0, 1], [1, 1, 1, 1, 1, 1]),
  ]);
}

const GIANT_ARM_Y = 2.5;

function playOn(rig, clip, t) {
  const mixer = new THREE.AnimationMixer(rig.root);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.update(t);
  rig.root.updateMatrixWorld(true);
}

// 1. SIN retarget: el clip del heroe aplasta al gigante a proporciones de heroe.
{
  const giant = makeRig(GIANT_ARM_Y);
  playOn(giant, heroClip(), 0.5);
  assert.ok(
    Math.abs(giant.arm.position.y - 1.0) < 1e-6,
    `sin retarget el gigante deberia quedar deformado a 1.0, quedo en ${giant.arm.position.y}`,
  );
  console.log(`PASS (control) sin retarget el gigante SE ENCOGE: brazo ${GIANT_ARM_Y} -> ${giant.arm.position.y}`);
}

// 2. CON retarget: el gigante conserva sus huesos y adopta la pose.
{
  const giant = makeRig(GIANT_ARM_Y);
  const clip = retargetRotationOnly(heroClip());
  playOn(giant, clip, 0.5);
  assert.equal(giant.arm.position.y, GIANT_ARM_Y, 'el gigante debe conservar la longitud de su hueso');
  const rotated = Math.abs(giant.arm.quaternion.x) > 1e-3;
  assert.ok(rotated, 'el gigante debe ADOPTAR la rotacion del clip, no solo ignorarlo');
  console.log(`PASS con retarget el gigante conserva el brazo en ${giant.arm.position.y} y SI rota (x=${giant.arm.quaternion.x.toFixed(3)})`);
}

// 3. el retarget deja solo quaternion, y preserva nombre/duracion.
{
  const src = heroClip();
  const out = retargetRotationOnly(src);
  assert.equal(out.tracks.length, 1, 'solo debe sobrevivir el track de quaternion');
  assert.ok(out.tracks[0].name.endsWith('.quaternion'));
  assert.equal(out.name, 'Melee_2H_Attack_Chop');
  assert.equal(out.duration, 1);
  console.log('PASS conserva nombre/duracion y solo tracks de quaternion');
}

// 4. INMUTABILIDAD: no muta el clip original (es compartido entre mobs).
{
  const src = heroClip();
  const before = src.tracks.length;
  retargetRotationOnly(src);
  assert.equal(src.tracks.length, before, 'retargetRotationOnly no debe mutar el clip fuente');
  console.log('PASS no muta el clip compartido');
}

// 5. no colisiona con plantClip: plantClip sigue conservando el detalle de miembros.
{
  const planted = plantClip(heroClip());
  const names = planted.tracks.map((t) => t.name);
  assert.ok(names.includes('upperarmr.position'), 'plantClip NO debe borrar tracks de miembros');
  const hips = planted.tracks.find((t) => t.name === 'hips.position');
  assert.equal(hips.values[3], hips.values[0], 'plantClip planta la X del root');
  assert.equal(hips.values[5], hips.values[2], 'plantClip planta la Z del root');
  console.log('PASS plantClip y retargetRotationOnly resuelven problemas distintos');
}

console.log('ALL PASS');
