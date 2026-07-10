// Floating name label above a character: a camera-facing sprite drawn from a
// canvas. Reused for the local player and for remote multiplayer players.
import * as THREE from 'three';

export function makeNametag(text, lvl) {
  if (lvl) text = text + '  ·  ' + lvl;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = "600 28px 'Fredoka', system-ui, sans-serif";
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const w = Math.min(248, c.measureText(text).width + 34);
  c.fillStyle = 'rgba(23,20,41,0.82)';
  c.roundRect((256 - w) / 2, 14, w, 36, 18);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.22)';
  c.lineWidth = 2;
  c.roundRect((256 - w) / 2 + 1, 15, w - 2, 34, 17);
  c.stroke();
  c.fillStyle = '#ffe9b3';
  c.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.4, 0.6, 1);
  sp.position.y = 2.35;     // sobre la cabeza del char (~1.9m + holgura)
  sp.renderOrder = 999;
  return sp;
}
