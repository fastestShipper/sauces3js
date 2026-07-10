import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.location = { hostname: '127.0.0.1', search: '' };
globalThis.window = { __SAUCES_MOBILE__: false, __SAUCES_LOW_END__: false };

const { applyMobFlagPalette } = await import('../src/rpg/mobs.js?smoke=flag-palette');

const geometry = new THREE.BoxGeometry(1, 2, 1);
const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
const originalPosition = geometry.getAttribute('position');

assert.equal(applyMobFlagPalette(material, geometry, 2), true);
assert.deepEqual(material.userData.mobFlagColors, [0xf8bd18, 0x102a72, 0xc8102e]);
assert.equal(geometry.getAttribute('position'), originalPosition, 'palette must preserve shared geometry');
assert.equal(applyMobFlagPalette(material, geometry, 2), false, 'palette must not wrap a material twice');

const shader = {
  uniforms: {},
  vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
  fragmentShader: '#include <common>\nvoid main(){\nvec4 diffuseColor=vec4(1.0);\n#include <color_fragment>\n}',
};
material.onBeforeCompile(shader, null);

assert.match(shader.vertexShader, /varying float vMobFlagY/);
assert.match(shader.fragmentShader, /uMobFlagYellow/);
assert.match(shader.fragmentShader, /mobFlagStar/);
assert.ok(shader.uniforms.uMobFlagYellow.value.isColor);
assert.match(material.customProgramCacheKey(), /^mob-flag-v1:/);

console.log('PASS: mob palette adds Venezuelan bands and a star motif without duplicating geometry');
