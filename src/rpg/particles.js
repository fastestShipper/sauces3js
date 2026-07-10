import * as THREE from 'three';

// Lote INSTANCIADO de particulas de gore.
//
// Antes cada gota de sangre era un `THREE.Mesh` con su propio material: hasta 300
// nodos y 300 DRAW CALLS en pleno combate, cuando la escena entera (ciudad, mobs,
// vegetacion) ronda los 60-100. Por eso los fps se caian al pelear y no al
// caminar. Ahora las 300 viven en un solo InstancedMesh = 1 draw call.
//
// Este lote solo DIBUJA. La fisica (gravedad, rebote, vida) sigue en effects.js,
// que le pasa sus registros cada frame.
//
// Las particulas se apagan ENCOGIENDO, no con alpha. Asi el material queda opaco:
// sin blending, sin orden de transparencia y sin parchar el shader.

const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _color = new THREE.Color();

// fraccion final de vida durante la que la particula se encoge hasta desaparecer
const SHRINK_TAIL = 0.45;

export class ParticleBatch {
  constructor(scene, geometry, capacity) {
    this.scene = scene;
    this.capacity = Math.max(1, capacity | 0);
    this.material = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, this.capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // `setColorAt` crea el buffer usando `mesh.count`, que ponemos en 0: hay que
    // reservarlo a mano o solo se colorea la primera instancia.
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 3), 3,
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;   // se mueven cada frame; el bounding miente
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // NO se agrega a la escena hasta que haya sangre: una escena sin gore queda
    // exactamente como estaba.
    this.attached = false;
  }

  // Vuelca los registros vivos al buffer de instancias.
  sync(items) {
    const n = Math.min(items.length, this.capacity);
    if (n > 0 && !this.attached) {
      this.scene.add(this.mesh);
      this.attached = true;
    }
    for (let i = 0; i < n; i++) {
      const e = items[i];
      const t = e.max > 0 ? Math.max(0, Math.min(1, e.life / e.max)) : 0;
      const fade = Math.min(1, t / SHRINK_TAIL);   // 1 casi toda su vida, 0 al morir
      _pos.set(e.x, e.y, e.z);
      _scale.setScalar(Math.max(0, e.scale * fade));
      _matrix.compose(_pos, _quat, _scale);
      this.mesh.setMatrixAt(i, _matrix);
      _color.setHex(e.color);
      this.mesh.setColorAt(i, _color);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.attached = false;
    this.material.dispose();
    // la geometria es COMPARTIDA (PARTICLE_GEO): no se libera aqui.
    this.mesh.dispose?.();
  }
}
