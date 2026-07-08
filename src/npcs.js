// Street life: wandering citizens with walk cycles + traffic cars
// driving the avenues. Distance-culled mixers keep it cheap.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mulberry32, ROAD_Y } from './citygen.js?v=20260707d';
import { sanitizeImported } from './glbutil.js?v=20260707d';
import { equipWeapon } from './weapons.js?v=20260707d';

const ADV_SCALE = 1.9 / 2.54;   // personajes KayKit (rig Medium ~2.54u) a ~1.9m
const ADV_FILES = ['char_knight.glb', 'char_barbarian.glb', 'char_mage.glb', 'char_ranger.glb', 'char_rogue.glb', 'char_rogue_hooded.glb'];
const CAR_H = 1.9;   // autos toon Kenney a ~1.9m de alto (proporcion enterable con el chibi)
// densidad de trafico/peatones por HORA DE LIMA (GMT-5): rush AM/PM lleno, madrugada vacio.
// curva real "horas pico" sin API; interpola suave entre horas.
function limaDensity() {
  const now = new Date();
  const h = ((now.getUTCHours() - 5 + 24) % 24) + now.getUTCMinutes() / 60;
  const t = [0.15, 0.12, 0.10, 0.10, 0.15, 0.30, 0.60, 0.95, 1.00, 0.85, 0.62, 0.60,
            0.70, 0.70, 0.65, 0.66, 0.78, 0.92, 1.00, 0.95, 0.72, 0.52, 0.36, 0.24];
  const i = Math.floor(h) % 24, j = (i + 1) % 24, f = h - Math.floor(h);
  return t[i] * (1 - f) + t[j] * f;
}

export class StreetLife {
  constructor(scene, city) {
    this.scene = scene;
    this.city = city;
    this.npcs = [];
    this.traffic = [];
  }

  async load(count = 28, seats = [], advSpots = []) {
    const loader = new GLTFLoader();
    const dens = limaDensity();              // escala peatones + autos por hora de Lima
    count = Math.max(6, Math.round(count * dens));
    // TODOS los NPCs son personajes KayKit (anim en archivos compartidos, rig Medium)
    const protos = [];
    for (const f of ADV_FILES) {
      try { const gl = await loader.loadAsync('./assets/models/' + f); gl._file = f; protos.push(gl); }
      catch { /* opcional */ }
    }
    for (const p of protos) sanitizeImported(p.scene);
    const clips = [];
    for (const af of ['char_anims_general.glb', 'char_anims.glb']) {
      try { clips.push(...(await loader.loadAsync('./assets/models/' + af)).animations); } catch { /* opcional */ }
    }
    const walkClip = clips.find(c => c.name === 'Walking_A') || clips.find(c => /walk/i.test(c.name));
    const idleClip = clips.find(c => c.name === 'Idle_A') || clips.find(c => /idle/i.test(c.name)) || walkClip;
    const rng = mulberry32(2024);
    // un NPC KayKit en (px,pz): deambula (stationary=false) o queda quieto en idle
    const spawnNPC = (px, pz, heading, stationary) => {
      if (!protos.length || !walkClip) return;
      const proto = protos[Math.floor(rng() * protos.length)];
      const ch = cloneSkinned(proto.scene);
      ch.scale.setScalar(ADV_SCALE);
      ch.traverse(o => { if (o.isMesh) o.castShadow = true; });
      const root = new THREE.Group();
      root.position.set(px, 0, pz);
      root.rotation.y = heading;
      root.add(ch);
      equipWeapon(loader, ch, proto._file).catch(() => {});   // arma de clase (cosmetico)
      this.scene.add(root);
      const mixer = new THREE.AnimationMixer(ch);
      const walkA = mixer.clipAction(walkClip);
      const idleA = idleClip ? mixer.clipAction(idleClip) : walkA;
      (stationary ? idleA : walkA).play();
      this.npcs.push({
        root, mixer, walkA, idleA, walking: !stationary, seated: stationary,
        x: px, z: pz, heading, rot: heading, wt: stationary ? 1e9 : 0,
      });
    };
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
      spawnNPC(px, pz, rng() * Math.PI * 2, false);
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
    const carFiles = ['k_sedan.glb', 'k_suv.glb', 'k_van.glb', 'k_taxi.glb', 'k_hatchback-sports.glb', 'k_delivery.glb'];
    const carProtos = [];
    for (const f of carFiles) {
      try { carProtos.push(await loader.loadAsync('./assets/models/' + f)); } catch { }
    }
    for (const p of carProtos) sanitizeImported(p.scene);
    const trng = mulberry32(555);
    const nCars = Math.max(3, Math.round(Math.min(38, candidates.length * 1.3) * dens));
    for (let k = 0; k < nCars; k++) {
      const pool = (k % 2 === 0 && nearby.length) ? nearby : candidates;
      const r = pool[Math.floor(trng() * pool.length)];
      const proto = carProtos[Math.floor(trng() * carProtos.length)];
      const car = proto.scene.clone(true);
      const box = new THREE.Box3().setFromObject(proto.scene);
      const size = box.getSize(new THREE.Vector3());
      const sc = CAR_H / Math.max(size.y, 0.1);
      car.scale.setScalar(sc);
      const wrap = new THREE.Group();
      wrap.add(car);
      car.position.y = -box.min.y * sc;
      this.scene.add(wrap);
      const collider = { x: 0, z: 0, ang: 0, hw: 1.9, hd: 1.05, roofY: CAR_H - 0.15 };
      this.city.carColliders.push(collider);
      this.traffic.push({
        node: wrap, pts: r.p, hw: (r.w ?? 6) * 0.5, idx: k,
        seg: Math.floor(trng() * Math.max(1, r.p.length - 1)),
        t: trng(), fwd: trng() < 0.5, spd: 6.5 + trng() * 3.5, collider,
      });
    }
    // KayKit no trae anim de sentarse -> vecinos QUIETOS (idle) junto a las bancas
    for (const sp of seats) spawnNPC(sp[0], sp[1], sp[2], true);
    // poblar tambien el parque con NPCs que deambulan
    if (advSpots.length) {
      const arng = mulberry32(8080);
      const nAdv = Math.min(10, advSpots.length);
      for (let k = 0; k < nAdv; k++) {
        const sp = advSpots[Math.floor(arng() * advSpots.length)];
        spawnNPC(sp[0], sp[1], arng() * Math.PI * 2, false);
      }
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
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const lane = car.hw * 0.45 * (car.fwd ? 1 : -1);
      // FRENO: si el jugador (a nivel de piso, no encima de un auto) esta ~3.5m
      // adelante, el auto no avanza (no lo atropella). car-vs-car omitido para
      // no generar deadlocks de trafico en cruces.
      const px0 = ax + ux * L * car.t + (-uz) * lane;
      const pz0 = az + uz * L * car.t + ux * lane;
      const fdx = car.fwd ? ux : -ux, fdz = car.fwd ? uz : -uz;
      const lookX = px0 + fdx * 3.5, lookZ = pz0 + fdz * 3.5;
      let blocked = playerPos.y < 1.0 &&
        Math.hypot(playerPos.x - lookX, playerPos.z - lookZ) < 2.3;
      // freno anti-solape: otro auto ~3.5m adelante. Mismo sentido = following
      // normal; en CRUCES cede solo el de indice mayor (orden total de
      // prioridad -> imposible el deadlock mutuo de esquina).
      if (!blocked) {
        for (const o of this.traffic) {
          if (o === car || o.yaw === undefined) continue;
          if (Math.hypot(o.collider.x - lookX, o.collider.z - lookZ) > 2.6) continue;
          const sameDir = fdx * Math.sin(o.yaw) + fdz * Math.cos(o.yaw) > 0.25;
          if (sameDir || o.idx < car.idx) { blocked = true; break; }
        }
      }
      if (!blocked) {
        car.t += (car.spd * dt / L) * (car.fwd ? 1 : -1);
        if (car.t >= 1) { car.t = 0; car.seg = this.advance(car); continue; }
        if (car.t < 0) { car.t = 1; car.seg = this.advance(car); continue; }
      }
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
export function cloneSkinned(source) {
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
