// Estilizado visual de los autos KayKit (k_*.glb). Todo por codigo: cero
// assets nuevos, cero PointLights. Los 6 GLB comparten UN material 'colormap'
// (atlas paletado, filtro NEAREST) donde la pintura de fabrica es la banda
// SATURADA (rojo sedan, azul van, verde suv...) y el vidrio es la banda
// azul-gris desaturada firma de KayKit. Eso permite enmascarar por color en
// el shader: repintar carroceria y oscurecer/pulir vidrios sin tocar texturas.
import * as THREE from 'three';

// paleta curada de pinturas realistas (flota limena: nada chillon)
export const CAR_PAINTS = [
  0xf2f4f5, // blanco perla
  0xb9bec4, // gris plata
  0x14161a, // negro
  0x8a1e1e, // rojo oscuro
  0x1c3f6e, // azul marino
  0x1d5c33, // verde bosque
];

// una llanta mate por material original (compartida por las 4 ruedas y por
// todos los clones de trafico del mismo GLB)
const wheelMatCache = new WeakMap();

const upgradeWheel = (mesh) => {
  let wm = wheelMatCache.get(mesh.material);
  if (!wm) {
    wm = mesh.material.clone();
    wm.metalness = 0.0;
    wm.roughness = 0.92;
    wm.envMapIntensity = 0.4;
    wheelMatCache.set(mesh.material, wm);
  }
  mesh.material = wm;
};

// carroceria: clon del material con look PBR + chunk que repinta los texeles
// saturados (pintura) y oscurece el vidrio. Mascaras estables porque el
// colormap se muestrea NEAREST (swatches limpios, sin texeles mezclados).
// GOTCHA: Material.clone() NO copia onBeforeCompile -> el chunk se instala
// aca, en cada clon fresco, nunca se hereda.
const upgradeBody = (mesh, paint) => {
  const m = mesh.material.clone();
  m.metalness = 0.75;
  m.roughness = 0.35;
  if ('clearcoat' in m) { m.clearcoat = 0.6; m.clearcoatRoughness = 0.25; }
  m.envMapIntensity = 1.2;
  const uPaint = { value: new THREE.Color(paint ?? 0xffffff) };
  const uPaintMix = { value: paint == null ? 0 : 1 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPaint = uPaint;
    shader.uniforms.uPaintMix = uPaintMix;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPaint;\nuniform float uPaintMix;')
      .replace('#include <map_fragment>', `#include <map_fragment>
// mascaras por color (espacio lineal): vidrio = azul-gris medio desaturado;
// pintura = banda saturada. Umbrales verificados contra el atlas real:
// vidrio sat 0.35-0.45 / pintura sat >= 0.8 -> smoothstep(0.55, 0.75) separa.
float carMx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
float carSat = (carMx - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))) / max(carMx, 1e-4);
float carGlass = step(diffuseColor.r * 1.15, diffuseColor.b) * step(diffuseColor.g * 1.05, diffuseColor.b)
  * step(0.25, carSat) * step(carSat, 0.55) * step(0.05, carMx) * step(carMx, 0.45);
float carPaint = smoothstep(0.55, 0.75, carSat) * (1.0 - carGlass) * uPaintMix;
diffuseColor.rgb = mix(diffuseColor.rgb, uPaint, carPaint);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, carGlass);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.1, carGlass);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.9, carGlass);`);
  };
  // cache key compartido: 1 solo programa para todos los autos (parked +
  // trafico); los uniforms uPaint/uPaintMix son por-material
  m.customProgramCacheKey = () => 'sauces-car-shell';
  mesh.material = m;
};

// Mejora los materiales de un auto (proto para instanciados o clon de
// trafico): carroceria PBR con pintura opcional de CAR_PAINTS (null = color
// de fabrica, p.ej. taxi amarillo o estacionados), vidrio oscuro reflectivo
// y llantas mate. En trafico clona el material por auto -> tinte individual.
export function styleCarShell(root, paint = null) {
  root.traverse(o => {
    if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
    if (/^wheel/.test(o.name)) upgradeWheel(o);
    else upgradeBody(o, paint);
  });
}

// faros: dos quads emissive en UN solo mesh (1 draw call por auto) al frente
// (+Z en los KayKit). MeshBasicMaterial sin tone mapping = "luz encendida"
// sutil sin PointLight real. Geometria cacheada por silueta de modelo.
const headlightGeoCache = new Map();
let headlightMat = null;

export function addHeadlights(car, box) {
  const key = box.max.x.toFixed(2) + ':' + box.max.z.toFixed(2);
  let geo = headlightGeoCache.get(key);
  if (!geo) {
    const hw = 0.075, hh = 0.05;
    const x = box.max.x * 0.55, y = 0.52, z = box.max.z + 0.015;
    const pos = [];
    for (const s of [-1, 1]) {
      pos.push(
        s * x - hw, y - hh, z, s * x + hw, y - hh, z,
        s * x + hw, y + hh, z, s * x - hw, y + hh, z);
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    headlightGeoCache.set(key, geo);
  }
  if (!headlightMat) headlightMat = new THREE.MeshBasicMaterial({ color: 0xffe9b8, toneMapped: false });
  const hl = new THREE.Mesh(geo, headlightMat);
  car.add(hl);
  return hl;
}
