import * as THREE from 'three';

const POI_RADIUS = 13;
const CATEGORY_STYLE = {
  bodega: ['#c46a19', 'B'],
  clinic: ['#2f8f73', '+'],
  services: ['#566b86', 'S'],
  parking: ['#3d6fd1', 'P'],
  shop: ['#6d59b7', 'T'],
  street: ['#0e5a38', 'V'],
  corner: ['#0e5a38', 'X'],
  paradero: ['#1a6b9c', 'P'],
  park: ['#4f8f3c', '*'],
  landmark: ['#9b6a25', '!'],
};

const KIND_LABELS = {
  bodega: 'Bodega o minimarket',
  clinic: 'Salud',
  services: 'Servicios',
  parking: 'Estacionamiento',
  shop: 'Comercio',
  street: 'Calle pública',
  corner: 'Esquina',
  paradero: 'Paradero',
  park: 'Parque',
  landmark: 'Referencia',
};

function finiteNumber(v) {
  return Number.isFinite(v) ? v : Number.NaN;
}

function cleanText(value, fallback, maxLen) {
  const text = String(value || fallback || '').trim().replace(/\s+/g, ' ');
  return text.slice(0, maxLen);
}

function normalizePoi(raw, index) {
  const category = CATEGORY_STYLE[raw.category] ? raw.category : 'landmark';
  const title = cleanText(raw.title || raw.n, 'Lugar del barrio', 64);
  const description = cleanText(raw.description, 'Punto público de Los Sauces.', 140);
  return {
    id: cleanText(raw.id, `poi-${index}`, 72),
    x: finiteNumber(Number(raw.x)),
    z: finiteNumber(Number(raw.z)),
    category,
    title,
    description,
    source: cleanText(raw.source, 'local-public', 24),
  };
}

function zonePoiToPublic(poi, index) {
  const kind = String(poi.k || '').toLowerCase();
  let category = 'shop';
  if (kind.includes('clinic')) category = 'clinic';
  else if (kind.includes('toilet')) category = 'services';
  else if (kind.includes('parking')) category = 'parking';
  else if (kind.includes('minimarket')) category = 'bodega';
  return normalizePoi({
    id: `zone-poi-${index}`,
    x: poi.x,
    z: poi.z,
    category,
    title: poi.n || KIND_LABELS[category] || 'Lugar del barrio',
    description: 'Referencia pública importada desde OpenStreetMap.',
    source: 'osm',
  }, index);
}

export async function loadPublicPois(version, zonePois = []) {
  try {
    const response = await fetch(`./assets/pois-local.json?v=${encodeURIComponent(version)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const pois = (Array.isArray(data.pois) ? data.pois : [])
      .map(normalizePoi)
      .filter(poi => Number.isFinite(poi.x) && Number.isFinite(poi.z));
    if (pois.length) return pois;
  } catch (error) {
    console.warn('Public POI load failed, using zone POIs', error);
  }
  return (zonePois || []).map(zonePoiToPublic)
    .filter(poi => Number.isFinite(poi.x) && Number.isFinite(poi.z));
}

function createPoiTexture(poi) {
  const [color, icon] = CATEGORY_STYLE[poi.category] || CATEGORY_STYLE.landmark;
  const cv = document.createElement('canvas');
  cv.width = 160;
  cv.height = 160;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(14, 14, 132, 132, 24);
  ctx.fill();
  ctx.strokeStyle = '#f5f3ea';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#f5f3ea';
  ctx.font = '900 68px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, 80, 82);
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildPoiSigns(scene, pois) {
  const group = new THREE.Group();
  group.name = 'PublicPois';
  const poleGeo = new THREE.CylinderGeometry(0.045, 0.055, 1.55, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.72, metalness: 0.2 });
  for (const poi of pois) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(poi.x, 0.78, poi.z);
    pole.castShadow = true;
    group.add(pole);

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: createPoiTexture(poi), sizeAttenuation: true }));
    sprite.position.set(poi.x, 1.68, poi.z);
    sprite.scale.set(1.0, 1.0, 1.0);
    sprite.userData.poiId = poi.id;
    group.add(sprite);
  }
  scene.add(group);
  return group;
}

export function nearestPoi(pois, x, z, radius = POI_RADIUS) {
  let best = null;
  let bestD2 = radius * radius;
  for (const poi of pois) {
    const dx = poi.x - x;
    const dz = poi.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      best = poi;
      bestD2 = d2;
    }
  }
  return best;
}

function nearestStreetName(city, x, z) {
  let best = 1e18;
  let name = '';
  for (const idx of city.segsNear(x, z)) {
    const s = city.segs[idx];
    if (!s[5]) continue;
    const dx = s[2] - s[0];
    const dz = s[3] - s[1];
    const l2 = dx * dx + dz * dz;
    if (l2 < 0.01) continue;
    const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2));
    const qx = s[0] + dx * t;
    const qz = s[1] + dz * t;
    const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
    if (d2 < best) {
      best = d2;
      name = s[5];
    }
  }
  return name;
}

function ensurePoiStyles() {
  if (document.getElementById('poi-ui-style')) return;
  const style = document.createElement('style');
  style.id = 'poi-ui-style';
  style.textContent = `
    .poi-ui { position:fixed; left:50%; bottom:172px; transform:translateX(-50%); z-index:38; display:flex; flex-direction:column; align-items:center; font-family:'Fredoka',system-ui,sans-serif; pointer-events:none; color:#f7f4eb; text-shadow:0 1px 3px rgba(0,0,0,.7); }
    .poi-prompt { display:none; width:max-content; max-width:min(360px,72vw); padding:8px 14px; border:1px solid rgba(255,207,92,.8); border-radius:12px; background:rgba(23,20,41,.86); font-size:13px; font-weight:600; box-shadow:0 10px 26px rgba(10,8,24,.4); }
    .poi-card { display:none; width:min(280px,64vw); margin-top:8px; padding:9px 13px; opacity:.94; border:1px solid rgba(255,255,255,.16); border-radius:16px; background:rgba(23,20,41,.92); box-shadow:0 16px 44px rgba(10,8,24,.5), inset 0 1px 0 rgba(255,255,255,.1); text-align:center; }
    .poi-card h3 { margin:0 0 4px; font-size:16px; line-height:1.15; font-weight:700; }
    .poi-card .kind { color:#ffcf5c; font-size:11px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; }
    .poi-card p { margin:8px 0 0; color:#d9d5ec; font-size:12px; line-height:1.4; font-weight:500; }
    .poi-card .street { margin-top:7px; color:#a9a4c4; font-size:11px; font-weight:500; }
  `;
  document.head.appendChild(style);
}

export function installPoiInteractions({ pois, city, player, rootEl = document.body }) {
  ensurePoiStyles();
  const root = document.createElement('div');
  root.className = 'poi-ui';
  const prompt = document.createElement('div');
  prompt.className = 'poi-prompt';
  const card = document.createElement('div');
  card.className = 'poi-card';
  const kind = document.createElement('div');
  kind.className = 'kind';
  const title = document.createElement('h3');
  const desc = document.createElement('p');
  const street = document.createElement('div');
  street.className = 'street';
  card.append(kind, title, desc, street);
  root.append(prompt, card);
  rootEl.appendChild(root);

  // SIN tecla: la E ahora es una skill (bloqueaba en plena pelea y la tarjeta
  // no se iba). El lugar se muestra como tooltip informativo auto-visible al
  // acercarse y desaparece solo al alejarse. Cero bloqueo, cero interaccion.
  let active = null;
  return {
    update(x, z) {
      active = nearestPoi(pois, x, z);
      if (!active || player.locked) {
        card.style.display = 'none';
        prompt.style.display = 'none';
        return;
      }
      kind.textContent = KIND_LABELS[active.category] || 'Referencia';
      title.textContent = active.title;
      desc.textContent = active.description;
      street.textContent = '';
      card.style.display = 'block';
      prompt.style.display = 'none';
    },
    dispose() {
      root.remove();
    },
  };
}
