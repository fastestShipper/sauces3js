import { FrontSide } from 'three';

// Sanitiza materiales de GLB importados. three.js + GLTFLoader dejan los modelos
// con dos defaults que se leen como "ai slop" en el mundo:
//   1) DoubleSide -> z-fighting en caras coplanares + doble overdraw.
//   2) anisotropia 1 -> shimmer rasante en texturas vistas en angulo.
//
// FrontSide se aplica SOLO a materiales opacos. El follaje de los arboles usa
// alphaMode MASK + doubleSided a proposito (cartas de hoja visibles de ambos
// lados); forzarlas a FrontSide las deja huecas vistas por detras. Por eso el
// guard: solo opacos pierden la cara trasera.
export function sanitizeImported(root, maxAniso = 8) {
  root.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (!m.transparent && !(m.alphaTest > 0)) m.side = FrontSide;
      if (m.map) m.map.anisotropy = maxAniso;
    }
  });
}
