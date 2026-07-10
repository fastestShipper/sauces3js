const MELEE_STYLES = new Set(['1h', '2h', 'dual']);
const MAX_BODY_INTENSITY = 0.40;
// El ARMA se EMPAPA: un solo kill ya la deja roja y sigue sucia un buen rato.
// Antes hacian falta ~14 kills para llegar a 0.52 mientras decaia a 0.0052/s, asi
// que matar cada 7s solo empataba el decaimiento: el equilibrio real quedaba en
// ~0.05 y el arma NUNCA se veia sangrienta. El cuerpo si sigue siendo sutil.
const MAX_WEAPON_INTENSITY = 0.94;
const WEAPON_GAIN_PER_KILL = 0.34;
const BODY_DECAY_PER_SECOND = 0.0042;
const WEAPON_DECAY_PER_SECOND = 0.014;
const MANAGED_MATERIAL = Symbol('bloodCoatMaterial');

const VERTEX_DECLARATION = `
varying vec3 vBloodCoatPosition;
`;

const FRAGMENT_DECLARATION = `
uniform float uBloodCoatIntensity;
varying vec3 vBloodCoatPosition;

float bloodCoatHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float bloodCoatPattern(vec3 p) {
  vec2 cellPosition = p.xz * 5.5 + p.y * vec2(0.83, 1.19);
  vec2 cell = floor(cellPosition);
  vec2 local = fract(cellPosition) - 0.5;
  float randomValue = bloodCoatHash(cell);
  vec2 offset = vec2(bloodCoatHash(cell + 3.7), bloodCoatHash(cell + 8.1)) - 0.5;
  float spot = 1.0 - smoothstep(0.08, 0.38, length(local + offset * 0.28));
  spot *= smoothstep(0.48, 0.88, randomValue);
  float residue = smoothstep(0.78, 0.98, sin(p.y * 18.0 + randomValue * 6.2831) * 0.5 + 0.5);
  residue *= smoothstep(0.60, 0.94, bloodCoatHash(cell + 17.0));
  return clamp(spot + residue * 0.32, 0.0, 1.0);
}
`;

const FRAGMENT_APPLICATION = `
float bloodCoatAmount = min(0.50, uBloodCoatIntensity * (0.10 + bloodCoatPattern(vBloodCoatPosition) * 0.90));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.008, 0.012), bloodCoatAmount);
`;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizedName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isHeldMesh(mesh, characterRoot) {
  let node = mesh?.parent || null;
  while (node && node !== characterRoot) {
    const name = normalizedName(node.name);
    if (name === 'handslotr' || name === 'handslotl') return true;
    node = node.parent;
  }
  return false;
}

function addShaderCode(source, marker, code, after = true) {
  if (!source.includes(marker)) return source;
  return source.replace(marker, after ? `${marker}\n${code}` : `${code}\n${marker}`);
}

function patchMaterial(source, intensityUniform) {
  if (!source?.isMaterial || typeof source.clone !== 'function') return null;
  const material = source.clone();
  const previousCompile = source.onBeforeCompile;
  const previousCacheKey = source.customProgramCacheKey;

  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    if (typeof previousCompile === 'function') previousCompile.call(this, shader, renderer);
    shader.uniforms.uBloodCoatIntensity = intensityUniform;
    shader.vertexShader = addShaderCode(shader.vertexShader, '#include <common>', VERTEX_DECLARATION);
    shader.vertexShader = addShaderCode(
      shader.vertexShader,
      '#include <project_vertex>',
      'vBloodCoatPosition = transformed;'
    );
    shader.fragmentShader = addShaderCode(shader.fragmentShader, '#include <common>', FRAGMENT_DECLARATION);
    shader.fragmentShader = addShaderCode(shader.fragmentShader, '#include <map_fragment>', FRAGMENT_APPLICATION);
  };
  material.customProgramCacheKey = function customProgramCacheKey() {
    const previous = typeof previousCacheKey === 'function' ? previousCacheKey.call(this) : '';
    return `${previous}|bloodcoat-v1`;
  };
  material[MANAGED_MATERIAL] = { intensityUniform };
  material.needsUpdate = true;
  return material;
}

export class BloodCoat {
  constructor({ player, combatStyle } = {}) {
    this.player = player || null;
    this.combatStyle = String(combatStyle || player?.combatStyle || '');
    this.isMelee = MELEE_STYLES.has(this.combatStyle);
    this.bodyIntensity = 0;
    this.weaponIntensity = 0;
    this._bodyUniform = { value: 0 };
    this._weaponUniform = { value: 0 };
    this._materialCache = new WeakMap();
    this._assignments = new Map();
    this._ownedMaterials = new Set();
    this.syncMaterials();
  }

  syncMaterials() {
    const characterRoot = this.player?.char;
    if (!characterRoot?.traverse) return 0;
    let changed = 0;
    characterRoot.traverse((object) => {
      if (!object?.isMesh || !object.material) return;
      const held = isHeldMesh(object, characterRoot);
      if (held && !this.isMelee) return;
      const kind = held ? 'weapon' : 'body';
      const current = Array.isArray(object.material) ? object.material : [object.material];
      if (current.every((material) => material?.[MANAGED_MATERIAL]?.owner === this)) return;

      const coated = current.map((source) => this._coatedMaterial(source, kind) || source);
      if (coated.every((material, index) => material === current[index])) return;
      this._assignments.set(object, {
        original: object.material,
        coated: Array.isArray(object.material) ? coated : coated[0],
      });
      object.material = Array.isArray(object.material) ? coated : coated[0];
      changed++;
    });
    return changed;
  }

  _coatedMaterial(source, kind) {
    if (!source?.isMaterial) return null;
    const managed = source[MANAGED_MATERIAL];
    if (managed?.owner === this) return source;
    let byKind = this._materialCache.get(source);
    if (!byKind) {
      byKind = new Map();
      this._materialCache.set(source, byKind);
    }
    if (byKind.has(kind)) return byKind.get(kind);
    const intensityUniform = kind === 'weapon' ? this._weaponUniform : this._bodyUniform;
    const coated = patchMaterial(source, intensityUniform);
    if (!coated) return null;
    coated[MANAGED_MATERIAL].owner = this;
    byKind.set(kind, coated);
    this._ownedMaterials.add(coated);
    return coated;
  }

  recordKill(streak = 1) {
    this.syncMaterials();
    const chain = Math.max(1, Number(streak) || 1);
    const highStreakBonus = chain >= 10 ? Math.min(0.055, 0.025 + (chain - 10) * 0.003) : 0;
    this.bodyIntensity = clamp(this.bodyIntensity + 0.026 + highStreakBonus, 0, MAX_BODY_INTENSITY);
    if (this.isMelee) {
      this.weaponIntensity = clamp(
        this.weaponIntensity + WEAPON_GAIN_PER_KILL + highStreakBonus * 1.35,
        0,
        MAX_WEAPON_INTENSITY
      );
    }
    this._applyIntensity();
    return this.intensity;
  }

  update(dt) {
    const step = clamp(Number(dt) || 0, 0, 0.5);
    if (step <= 0) return this.intensity;
    this.bodyIntensity = Math.max(0, this.bodyIntensity - BODY_DECAY_PER_SECOND * step);
    this.weaponIntensity = Math.max(0, this.weaponIntensity - WEAPON_DECAY_PER_SECOND * step);
    this._applyIntensity();
    return this.intensity;
  }

  clear() {
    this.bodyIntensity = 0;
    this.weaponIntensity = 0;
    this._applyIntensity();
  }

  dispose() {
    this.clear();
    for (const [object, assignment] of this._assignments) {
      if (object.material === assignment.coated) object.material = assignment.original;
    }
    for (const material of this._ownedMaterials) material.dispose?.();
    this._assignments.clear();
    this._ownedMaterials.clear();
    this._materialCache = new WeakMap();
  }

  get intensity() {
    return {
      body: this.bodyIntensity,
      weapon: this.weaponIntensity,
    };
  }

  _applyIntensity() {
    this._bodyUniform.value = this.bodyIntensity;
    this._weaponUniform.value = this.weaponIntensity;
  }
}
