// GrassSystem — pasto 3D instanciado alrededor de la camara.
//
// Tecnica: hojas curvas instanciadas (InstancedMesh) en tiles de 8 m que se
// crean/reciclan segun la posicion del jugador, con densidad por anillos de
// distancia. El material es MeshStandardMaterial + onBeforeCompile: conserva
// sombras/fog/ACES del pipeline y agrega viento coherente en world-space,
// gradiente raiz->punta, hojas secas y fade de altura en el borde del campo
// (las hojas se funden con la textura foto del suelo, sin linea dura).
//
// Cero atributos custom: la variacion por hoja (fase, sequedad, luminancia)
// se deriva en el shader de un hash de la posicion de instancia.
import * as THREE from 'three';

const TILE = 8;                      // metros por tile
const MAXN = 700;                    // hojas max por tile (ring 0 a tope)
const BUILDS_PER_FRAME = 2;          // tiles construidos por frame (evita hitch)
const RING_HYSTERESIS = 1.8;         // metros extra antes de rebuild por cambio de anillo

// [distancia max, hojas/m2] — desktop y mobile
const RINGS_DESKTOP = [[20, 12], [34, 5], [50, 1.7]];
const RINGS_MOBILE = [[13, 5], [22, 2.2], [32, 0.9]];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// una hoja: tira de 3 segmentos + punta, curvada hacia +Z, altura 1, base en y=0
function buildBladeGeometry() {
  const ROWS = [0, 0.42, 0.76, 1.0];
  const W0 = 0.055;                  // semi-ancho en la base
  const CURVE = 0.28;                // inclinacion baked hacia +Z
  const pos = [], nor = [], uv = [], idx = [];
  for (let r = 0; r < ROWS.length; r++) {
    const t = ROWS[r];
    const w = r === ROWS.length - 1 ? 0 : W0 * (1 - 0.68 * t);
    const z = CURVE * t * t;
    if (w === 0) {
      pos.push(0, t, z); nor.push(0, 0.35, 1); uv.push(0.5, t);
    } else {
      pos.push(-w, t, z, w, t, z);
      nor.push(0, 0.35, 1, 0, 0.35, 1);
      uv.push(0, t, 1, t);
    }
  }
  // filas 0..2 tienen 2 verts (indices 0..5), la punta es el vert 6
  idx.push(0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class GrassSystem {
  constructor(scene, { rects = [], strips = [], lawnY = 0.015, mobile = false, seed = 1337 } = {}) {
    this.scene = scene;
    this.rings = mobile ? RINGS_MOBILE : RINGS_DESKTOP;
    this.maxDist = this.rings[this.rings.length - 1][0];
    this.seed = seed;

    this.uniforms = {
      uTime: { value: 0 },
      uPlayer: { value: new THREE.Vector3(0, 0, 1e6) },
      uWindDir: { value: new THREE.Vector2(0.78, 0.62) },
      uWindAmp: { value: 0.16 },
      uFadeStart: { value: this.maxDist * 0.62 },
      uFadeEnd: { value: this.maxDist * 0.96 },
      uRoot: { value: new THREE.Color(0x2a4d16) },
      uTip: { value: new THREE.Color(0x8cc04b) },
      uDry: { value: new THREE.Color(0xa8a050) },
    };

    this.blade = buildBladeGeometry();
    this.material = this._buildMaterial();

    // indice espacial tile -> fuentes de area donde puede crecer pasto
    this.index = new Map();
    for (const r of rects) this._insertRect(r[0], r[1], r[2], r[3], lawnY);
    for (const s of strips) this._insertStrip(s);

    this.tiles = new Map();          // key -> { mesh, ring, dist }
    this.pool = [];
    this.queue = [];                 // keys pendientes de build
    this._mgrClock = 0;
    this._lastPX = 1e9; this._lastPZ = 1e9;
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  // ---------- indice espacial ----------
  _tileKey(tx, tz) { return tx + ',' + tz; }

  _bucket(tx, tz) {
    const k = this._tileKey(tx, tz);
    let b = this.index.get(k);
    if (!b) { b = { rects: [], strips: [], area: 0 }; this.index.set(k, b); }
    return b;
  }

  _insertRect(x0, z0, x1, z1, y) {
    const tx0 = Math.floor(x0 / TILE), tx1 = Math.floor(x1 / TILE);
    const tz0 = Math.floor(z0 / TILE), tz1 = Math.floor(z1 / TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let tz = tz0; tz <= tz1; tz++) {
        // clip del rect al tile: el area queda exacta y el sampleo es directo
        const cx0 = Math.max(x0, tx * TILE), cx1 = Math.min(x1, (tx + 1) * TILE);
        const cz0 = Math.max(z0, tz * TILE), cz1 = Math.min(z1, (tz + 1) * TILE);
        if (cx1 - cx0 < 0.05 || cz1 - cz0 < 0.05) continue;
        const b = this._bucket(tx, tz);
        const area = (cx1 - cx0) * (cz1 - cz0);
        b.rects.push([cx0, cz0, cx1, cz1, y, area]);
        b.area += area;
      }
    }
  }

  _insertStrip([ax, az, bx, bz, y]) {
    const HALF = 0.5;
    const minx = Math.min(ax, bx) - HALF, maxx = Math.max(ax, bx) + HALF;
    const minz = Math.min(az, bz) - HALF, maxz = Math.max(az, bz) + HALF;
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) return;
    const area = L * HALF * 2;
    // el strip (3 m) suele caer en 1-2 tiles; se registra entero en cada uno y
    // el sampleo rechaza puntos fuera del tile (perdida de area negligible)
    for (let tx = Math.floor(minx / TILE); tx <= Math.floor(maxx / TILE); tx++) {
      for (let tz = Math.floor(minz / TILE); tz <= Math.floor(maxz / TILE); tz++) {
        const b = this._bucket(tx, tz);
        b.strips.push([ax, az, bx, bz, y, L, area]);
        b.area += area;
      }
    }
  }

  // ---------- material ----------
  _buildMaterial() {
    const u = this.uniforms;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform vec3 uPlayer;
uniform vec2 uWindDir;
uniform float uWindAmp;
uniform float uFadeStart;
uniform float uFadeEnd;
varying float vT;
varying float vRnd;`)
        .replace('#include <beginnormal_vertex>', `
// normal casi vertical: el campo se ilumina como cesped, no como cartas sueltas
vec3 objectNormal = normalize( mix( vec3( normal ), vec3( 0.0, 1.0, 0.0 ), 0.78 ) );`)
        .replace('#include <begin_vertex>', `
vec3 transformed = vec3( position );
vec3 iPos = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
vT = uv.y;
vRnd = fract( sin( dot( iPos.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
// fade de altura hacia el borde del campo (se funde con la textura del suelo)
float dCam = distance( iPos.xz, cameraPosition.xz );
float fade = 1.0 - smoothstep( uFadeStart, uFadeEnd, dCam );
transformed *= fade;`)
        .replace('#include <project_vertex>', `
vec4 wpos4 = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );
float tBend = vT * vT;
// viento: direccion coherente + dos armonicos + rafaga lenta que viaja
float ph = dot( wpos4.xz, vec2( 0.35, 0.22 ) );
float gust = 0.55 + 0.45 * sin( uTime * 0.6 + dot( wpos4.xz, vec2( 0.05, 0.033 ) ) );
float sway = ( sin( uTime * 2.1 + ph + vRnd * 3.1 ) * 0.6 + sin( uTime * 3.9 + ph * 1.7 ) * 0.4 ) * gust;
wpos4.xz += uWindDir * sway * uWindAmp * tBend;
// el jugador aplasta/aparta el pasto al caminar
vec2 dp = wpos4.xz - uPlayer.xz;
float dd = length( dp );
float push = 1.0 - smoothstep( 0.1, 1.05, dd );
if ( push > 0.001 && dd > 1e-4 ) {
  wpos4.xz += ( dp / dd ) * push * 0.42 * tBend;
  wpos4.y -= push * 0.12 * tBend;
}
vec4 mvPosition = viewMatrix * wpos4;
gl_Position = projectionMatrix * mvPosition;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uRoot;
uniform vec3 uTip;
uniform vec3 uDry;
varying float vT;
varying float vRnd;`)
        // DoubleSide invierte la normal en backfaces -> hojas negras por detras.
        // Follaje clasico: misma normal (casi vertical) para ambas caras.
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
normal = normalize( vNormal );`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 gcol = mix( uRoot, uTip, pow( vT, 0.72 ) );
gcol = mix( gcol, uDry, step( 0.82, vRnd ) * 0.55 );
gcol *= 0.82 + 0.36 * fract( vRnd * 7.13 );
diffuseColor.rgb *= gcol;`);
    };
    // clave estable: un solo programa para todos los tiles
    mat.customProgramCacheKey = () => 'sauces-grass-v1';
    return mat;
  }

  // ---------- pool ----------
  _acquireMesh() {
    let mesh = this.pool.pop();
    if (!mesh) {
      // geometria propia por mesh (comparte los buffers de vertices de la hoja)
      const g = new THREE.BufferGeometry();
      g.setIndex(this.blade.getIndex());
      g.setAttribute('position', this.blade.getAttribute('position'));
      g.setAttribute('normal', this.blade.getAttribute('normal'));
      g.setAttribute('uv', this.blade.getAttribute('uv'));
      mesh = new THREE.InstancedMesh(g, this.material, MAXN);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // culling por esfera propia del InstancedMesh (three >= r151); si esta
      // build no la soporta, se desactiva el culling para no cortar tiles mal
      if (mesh.boundingSphere === undefined) mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
    mesh.visible = true;
    return mesh;
  }

  _releaseMesh(mesh) {
    mesh.visible = false;
    mesh.count = 0;
    this.pool.push(mesh);
  }

  // ---------- tiles ----------
  _ringOf(d) {
    for (let i = 0; i < this.rings.length; i++) if (d <= this.rings[i][0]) return i;
    return -1;
  }

  _buildTile(key, ring) {
    const bucket = this.index.get(key);
    if (!bucket) return null;
    const [txs, tzs] = key.split(',');
    const tx = +txs, tz = +tzs;
    const density = this.rings[ring][1];
    let n = Math.min(MAXN, Math.round(bucket.area * density));
    if (n <= 0) return null;
    const rng = mulberry32((tx * 73856093) ^ (tz * 19349663) ^ this.seed);
    const mesh = this._acquireMesh();
    const m4 = this._m4, q = this._q, up = this._up;
    let placed = 0;
    const totalArea = bucket.area;
    for (let i = 0; i < n; i++) {
      // elige fuente ponderada por area
      let pick = rng() * totalArea;
      let px = 0, pz = 0, py = 0, ok = false;
      for (const r of bucket.rects) {
        if (pick < r[5]) {
          px = r[0] + rng() * (r[2] - r[0]);
          pz = r[1] + rng() * (r[3] - r[1]);
          py = r[4]; ok = true; break;
        }
        pick -= r[5];
      }
      if (!ok) {
        for (const s of bucket.strips) {
          if (pick < s[6]) {
            const t = rng();
            const jx = (rng() - 0.5), jz = (rng() - 0.5);
            // punto a lo largo del strip + jitter lateral (semi-ancho 0.5)
            const dx = (s[2] - s[0]) / s[5], dz = (s[3] - s[1]) / s[5];
            px = s[0] + dx * s[5] * t + (-dz) * jx;
            pz = s[1] + dz * s[5] * t + dx * jz;
            py = s[4]; ok = true;
            // rechaza si cayo fuera de este tile (el strip vive en 2 tiles)
            if (px < tx * TILE || px >= (tx + 1) * TILE || pz < tz * TILE || pz >= (tz + 1) * TILE) ok = false;
            break;
          }
          pick -= s[6];
        }
      }
      if (!ok) continue;
      const h = 0.16 + rng() * 0.22;             // altura real de la hoja (m)
      const wScale = 0.8 + rng() * 0.5;
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      m4.compose(
        new THREE.Vector3(px, py - 0.015, pz),
        q,
        new THREE.Vector3(h * wScale, h, h * wScale),
      );
      mesh.setMatrixAt(placed++, m4);
    }
    if (placed === 0) { this._releaseMesh(mesh); return null; }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.boundingSphere !== undefined) {
      mesh.boundingSphere = mesh.boundingSphere || new THREE.Sphere();
      mesh.boundingSphere.center.set((tx + 0.5) * TILE, 0.3, (tz + 0.5) * TILE);
      mesh.boundingSphere.radius = TILE * 0.75 + 0.9;
    }
    return { mesh, ring };
  }

  _manage(px, pz) {
    const rings = this.rings;
    const maxD = this.maxDist;
    const t0x = Math.floor((px - maxD) / TILE), t1x = Math.floor((px + maxD) / TILE);
    const t0z = Math.floor((pz - maxD) / TILE), t1z = Math.floor((pz + maxD) / TILE);
    const wanted = new Map();
    for (let tx = t0x; tx <= t1x; tx++) {
      for (let tz = t0z; tz <= t1z; tz++) {
        const key = this._tileKey(tx, tz);
        if (!this.index.has(key)) continue;
        const cx = (tx + 0.5) * TILE, cz = (tz + 0.5) * TILE;
        const d = Math.hypot(cx - px, cz - pz) - TILE * 0.5;
        const ring = this._ringOf(Math.max(0, d));
        if (ring >= 0) wanted.set(key, { ring, d });
      }
    }
    // retira tiles fuera de rango o con anillo cambiado (con histeresis)
    for (const [key, tile] of this.tiles) {
      const w = wanted.get(key);
      if (!w) {
        this._releaseMesh(tile.mesh);
        this.tiles.delete(key);
        continue;
      }
      if (w.ring !== tile.ring) {
        const edge = rings[Math.min(w.ring, tile.ring)][0];
        if (Math.abs(w.d - edge) > RING_HYSTERESIS) {
          this._releaseMesh(tile.mesh);
          this.tiles.delete(key);
        }
      }
    }
    // encola lo que falta, cercano primero
    this.queue.length = 0;
    for (const [key, w] of wanted) {
      if (!this.tiles.has(key)) this.queue.push([key, w.ring, w.d]);
    }
    this.queue.sort((a, b) => a[2] - b[2]);
  }

  update(dt, playerPos) {
    this.uniforms.uTime.value += dt;
    if (playerPos) this.uniforms.uPlayer.value.copy(playerPos);
    this._mgrClock -= dt;
    const px = playerPos ? playerPos.x : 0, pz = playerPos ? playerPos.z : 0;
    const moved = Math.hypot(px - this._lastPX, pz - this._lastPZ);
    if (this._mgrClock <= 0 || moved > 3) {
      this._mgrClock = 0.25;
      this._lastPX = px; this._lastPZ = pz;
      this._manage(px, pz);
    }
    for (let i = 0; i < BUILDS_PER_FRAME && this.queue.length; i++) {
      const [key, ring] = this.queue.shift();
      if (this.tiles.has(key)) continue;
      const tile = this._buildTile(key, ring);
      if (tile) this.tiles.set(key, tile);
    }
  }
}
