// Street life: wandering citizens with walk cycles + traffic cars
// driving the avenues. Distance-culled mixers keep it cheap.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mulberry32, ROAD_Y } from './citygen.js?v=20260613b';

const CHAR_SCALE = 1.8 / 3.3;

export class StreetLife {
  constructor(scene, city) {
    this.scene = scene;
    this.city = city;
    this.npcs = [];
    this.traffic = [];
  }

  async load(count = 28, seats = []) {
    const loader = new GLTFLoader();
    const files = ['casual.glb', 'suit.glb', 'casual3_male.glb', 'casual_female.glb', 'casual2_female.glb', 'casual_bald.glb'];
    const protos = [];
    for (const f of files) {
      try { protos.push(await loader.loadAsync('./assets/models/' + f)); }
      catch { /* opcional */ }
    }
    const rng = mulberry32(2024);
    let placed = 0, guard = 0;
    const spawnX = -4.2, spawnZ = 47.1;
    while (placed < count && guard++ < count * 10) {
      const s = this.city.segs[Math.floor(rng() * this.city.segs.length)];
      if (placed < 8) {
        // los primeros cerca del spawn para que la calle reciba con vida
        const mx = (s[0] + s[2]) / 2, mz = (s[1] + s[3]) / 2;
        if (Math.hypot(mx - spawnX, mz - spawnZ) > 60) continue;
      }
      const t = rng();
      const ax = s[0] + (s[2] - s[0]) * t, az = s[1] + (s[3] - s[1]) * t;
      const L = Math.hypot(s[2] - s[0], s[3] - s[1]);
      if (L < 1) continue;
      const nx = -(s[3] - s[1]) / L, nz = (s[2] - s[0]) / L;
      const side = rng() < 0.5 ? 1 : -1;
      const px = ax + nx * (s[4] + 1.5) * side, pz = az + nz * (s[4] + 1.5) * side;
      if (this.city.inRealBuilding(px, pz, 0.4) || this.city.inAnyGreen(px, pz)) continue;
      const proto = protos[Math.floor(rng() * protos.length)];
      const ch = cloneSkinned(proto.scene);
      ch.scale.setScalar(CHAR_SCALE);
      ch.traverse(o => { if (o.isMesh) o.castShadow = true; });
      const root = new THREE.Group();
      root.position.set(px, 0, pz);
      root.add(ch);
      this.scene.add(root);
      const mixer = new THREE.AnimationMixer(ch);
      const clip = proto.animations.find(c => c.name === 'Walk') || proto.animations[0];
      const idle = proto.animations.find(c => c.name === 'Idle');
      const walkA = mixer.clipAction(clip);
      const idleA = idle ? mixer.clipAction(idle) : walkA;
      walkA.play();
      const heading0 = rng() * Math.PI * 2;
      this.npcs.push({
        root, mixer, walkA, idleA, walking: true,
        x: px, z: pz, heading: heading0, rot: heading0, wt: 0,
      });
      placed++;
    }
    // trafico: denso o el mundo se siente muerto (feedback playtest)
    const spawnDist = (r) => {
      let dm = 1e9;
      for (const p of r.p) dm = Math.min(dm, Math.hypot(p[0] - spawnX, p[1] - spawnZ));
      return dm;
    };
    const candidates = this.city.data.roads.filter(r => {
      if (r.bridge || (r.w ?? 6) < 6.0) return false;
      let total = 0;
      for (let i = 0; i < r.p.length - 1; i++) total += Math.hypot(r.p[i + 1][0] - r.p[i][0], r.p[i + 1][1] - r.p[i][1]);
      return total > 50;
    });
    // la mitad de la flota garantizada cerca del spawn (primeros minutos del jugador)
    const nearby = candidates.filter(r => spawnDist(r) < 220);
    const carFiles = ['car_sedan.gltf', 'car_taxi.gltf', 'car_hatchback.gltf', 'car_stationwagon.gltf'];
    const carProtos = [];
    for (const f of carFiles) {
      try { carProtos.push(await loader.loadAsync('./assets/models/' + f)); } catch { }
    }
    const trng = mulberry32(555);
    const nCars = Math.min(64, candidates.length * 2);
    for (let k = 0; k < nCars; k++) {
      const pool = (k % 2 === 0 && nearby.length) ? nearby : candidates;
      const r = pool[Math.floor(trng() * pool.length)];
      const proto = carProtos[Math.floor(trng() * carProtos.length)];
      const car = proto.scene.clone(true);
      const box = new THREE.Box3().setFromObject(proto.scene);
      const size = box.getSize(new THREE.Vector3());
      const sc = 1.45 / Math.max(size.y, 0.1);
      car.scale.setScalar(sc);
      const wrap = new THREE.Group();
      wrap.add(car);
      car.position.y = -box.min.y * sc;
      this.scene.add(wrap);
      const collider = { x: 0, z: 0, ang: 0, hw: 1.85, hd: 0.8 };
      this.city.carColliders.push(collider);
      this.traffic.push({
        node: wrap, pts: r.p, hw: (r.w ?? 6) * 0.5,
        seg: Math.floor(trng() * Math.max(1, r.p.length - 1)),
        t: trng(), fwd: trng() < 0.5, spd: 6.5 + trng() * 3.5, collider,
      });
    }
    // vecinos SENTADOS en bancas (la anim de sentarse existia sin usarse)
    for (const sp of seats) {
      if (!protos.length) break;
      const proto = protos[Math.floor(rng() * protos.length)];
      const ch = cloneSkinned(proto.scene);
      ch.scale.setScalar(CHAR_SCALE);
      const root = new THREE.Group();
      root.position.set(sp[0], 0.18, sp[1]);
      root.rotation.y = sp[2];
      root.add(ch);
      this.scene.add(root);
      const mixer = new THREE.AnimationMixer(ch);
      const clip = proto.animations.find(c => /sit/i.test(c.name)) ||
        proto.animations.find(c => c.name === 'Idle') || proto.animations[0];
      const act = mixer.clipAction(clip);
      if (/sit/i.test(clip.name)) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
      act.play();
      this.npcs.push({
        root, mixer, walkA: act, idleA: act, walking: false, seated: true,
        x: sp[0], z: sp[1], heading: sp[2], wt: 1e9,
      });
    }
  }

  update(dt, playerPos) {
    for (const n of this.npcs) {
      const d = Math.hypot(playerPos.x - n.x, playerPos.z - n.z);
      n.root.visible = d < 120;
      if (d > 80) continue;
      if (n.seated) { if (d < 60) n.mixer.update(dt); continue; }
      n.wt -= dt;
      if (n.wt <= 0) { n.wt = 2.5 + Math.random() * 4; n.heading = Math.random() * Math.PI * 2; }
      const sx = Math.sin(n.heading) * 1.4 * dt, sz = Math.cos(n.heading) * 1.4 * dt;
      if (!this.city.inRealBuilding(n.x + sx, n.z + sz, 0) && !this.city.onAnyRoad(n.x + sx, n.z + sz, -1)) {
        n.x += sx; n.z += sz;
        if (!n.walking) { n.idleA.stop(); n.walkA.play(); n.walking = true; }
      } else {
        n.wt = 0;
        if (n.walking) { n.walkA.stop(); n.idleA.play(); n.walking = false; }
      }
      n.root.position.set(n.x, 0, n.z);
      // giro suave: el snap instantaneo de heading se lee glitchy
      let dr = ((n.heading - n.rot + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      n.rot += dr * Math.min(1, dt * 7);
      n.root.rotation.y = n.rot;
      if (d < 60) n.mixer.update(dt);
    }
    for (const car of this.traffic) {
      const pts = car.pts;
      let i = car.seg;
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) { car.seg = this.advance(car); continue; }
      car.t += (car.spd * dt / L) * (car.fwd ? 1 : -1);
      if (car.t >= 1) { car.t = 0; car.seg = this.advance(car); continue; }
      if (car.t < 0) { car.t = 1; car.seg = this.advance(car); continue; }
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const lane = car.hw * 0.45 * (car.fwd ? 1 : -1);
      const px = ax + ux * L * car.t + (-uz) * lane;
      const pz = az + uz * L * car.t + ux * lane;
      car.node.position.set(px, ROAD_Y, pz);
      const dx = car.fwd ? ux : -ux, dz = car.fwd ? uz : -uz;
      const targetYaw = Math.atan2(dx, dz);
      if (car.yaw === undefined) car.yaw = targetYaw;
      let dy = ((targetYaw - car.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      car.yaw += dy * Math.min(1, dt * 9);
      car.node.rotation.y = car.yaw;
      car.collider.x = px; car.collider.z = pz; car.collider.ang = car.yaw;
    }
  }

  advance(car) {
    const pts = car.pts;
    if (car.fwd) {
      if (car.seg + 2 < pts.length) return car.seg + 1;
      car.fwd = false; car.t = 1; return car.seg;
    }
    if (car.seg > 0) return car.seg - 1;
    car.fwd = true; car.t = 0; return car.seg;
  }
}

// clon de escenas con SkinnedMesh (SkeletonUtils inline minimo)
function cloneSkinned(source) {
  const sourceLookup = new Map();
  const cloneLookup = new Map();
  const clone = source.clone(true);
  parallelTraverse(source, clone, (a, b) => { sourceLookup.set(b, a); cloneLookup.set(a, b); });
  clone.traverse(node => {
    if (!node.isSkinnedMesh) return;
    const sourceMesh = sourceLookup.get(node);
    const sourceBones = sourceMesh.skeleton.bones;
    node.skeleton = sourceMesh.skeleton.clone();
    node.bindMatrix.copy(sourceMesh.bindMatrix);
    node.skeleton.bones = sourceBones.map(b => cloneLookup.get(b));
    node.bind(node.skeleton, node.bindMatrix);
  });
  return clone;
}
function parallelTraverse(a, b, cb) {
  cb(a, b);
  for (let i = 0; i < a.children.length; i++) parallelTraverse(a.children[i], b.children[i], cb);
}
