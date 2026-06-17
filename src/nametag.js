// Floating name label above a character: a camera-facing sprite drawn from a
// canvas. Reused for the local player and for remote multiplayer players.
import * as THREE from 'three';

export function makeNametag(text) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = 'bold 30px system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const w = Math.min(248, c.measureText(text).width + 30);
  c.fillStyle = 'rgba(20,22,28,0.78)';
  c.roundRect((256 - w) / 2, 14, w, 36, 11);
  c.fill();
  c.fillStyle = '#fff';
  c.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.4, 0.6, 1);
  sp.position.y = 2.35;     // sobre la cabeza del char (~1.9m + holgura)
  sp.renderOrder = 999;
  return sp;
}
