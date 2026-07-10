// Smoke: el gore NUNCA es verde. Un zombie de piel verde sangra ROJO.
// Regresion historica: dismember() pintaba los pedazos con el tinte de piel del
// mob (0x7da364 verde oliva), lo que hacia el kill sentir a plastico pintado.
// Este test fija el invariante: carne/viscera = rojo dominante, hueso = neutro claro.
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.addEventListener = () => {};
globalThis.document = {
  createElement(name) {
    if (name !== 'canvas') return {};
    return {
      width: 0,
      height: 0,
      getContext() {
        const gradient = { addColorStop() {} };
        return {
          clearRect() {}, fillRect() {}, fillText() {}, strokeText() {},
          measureText(text) { return { width: String(text || '').length * 10 }; },
          createLinearGradient() { return gradient; },
          createRadialGradient() { return gradient; },
        };
      },
    };
  },
};

import assert from 'node:assert/strict';
import * as THREE from 'three';

const { Effects } = await import('../src/rpg/effects.js');

const near = () => ({ position: new THREE.Vector3(0, 0, 0) });

function collectChunkColors() {
  const scene = new THREE.Scene();
  const effects = new Effects(scene, near);
  effects.dismember({ x: 0, y: 0.8, z: 0 }, { intensity: 1.4 });
  assert.ok(effects.chunks.length > 0, 'dismember debe generar pedazos');
  return effects.chunks.map((c) => c.mesh.material.color);
}

// 1. Ningun pedazo es verde-dominante. Ni uno.
{
  const colors = collectChunkColors();
  for (const col of colors) {
    assert.ok(
      !(col.g > col.r),
      `pedazo verde detectado (r=${col.r.toFixed(3)} g=${col.g.toFixed(3)} b=${col.b.toFixed(3)})`,
    );
  }
  console.log(`PASS ${colors.length} pedazos, ninguno verde-dominante`);
}

// 2. Cada pedazo es carne roja (r claramente > g y > b) o hueso neutro claro.
{
  const colors = collectChunkColors();
  let meat = 0, bone = 0;
  for (const col of colors) {
    const isBone = col.r > 0.6 && col.g > 0.6 && col.b > 0.5 && Math.abs(col.r - col.g) < 0.15;
    const isMeat = col.r > col.g * 1.8 && col.r > col.b * 1.8;
    assert.ok(isBone || isMeat, `pedazo ni carne ni hueso: #${col.getHexString()}`);
    if (isBone) bone++; else meat++;
  }
  assert.ok(meat > 0, 'debe haber carne');
  console.log(`PASS clasificacion: ${meat} carne/viscera, ${bone} hueso`);
}

// 3. dismember ya NO acepta un tinte de piel: pasar uno verde no pinta verde.
//    (blinda contra que alguien reintroduzca la firma vieja dismember(pos, 0x7da364))
{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, near);
  effects.dismember({ x: 0, y: 0.8, z: 0 }, 0x7da364);
  for (const c of effects.chunks) {
    const col = c.mesh.material.color;
    assert.ok(!(col.g > col.r), 'un tinte verde legacy no debe teñir el gore');
  }
  console.log('PASS un tinte verde legacy es ignorado por el gore');
}

// 4. La viscera es humeda (roughness baja) y el hueso mate. Materiales distintos.
{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, near);
  effects.dismember({ x: 0, y: 0.8, z: 0 }, { intensity: 1 });
  const roughs = effects.chunks.map((c) => c.mesh.material.roughness);
  assert.ok(Math.min(...roughs) < 0.5, 'la viscera debe brillar (roughness < 0.5)');
  assert.ok(Math.max(...roughs) > 0.8, 'el hueso/carne mate debe existir (roughness > 0.8)');
  console.log(`PASS rugosidad variada: ${Math.min(...roughs)} .. ${Math.max(...roughs)}`);
}

console.log('ALL PASS');
