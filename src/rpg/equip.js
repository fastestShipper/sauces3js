// Reglas de equipo estilo MU/WoW: ranuras (slots), restriccion por clase y nivel.
// Logica pura, sin three.js ni DOM. La UI del inventario vive en otro modulo (loot.js).
//
// Forma de item esperada:
//   {
//     id,                 // string unico (para serialize / volver al inventario)
//     slot,               // una de SLOTS; las armas usan slot 'weapon'
//     classReq,           // clase que lo usa, o null/'any' = cualquiera
//     lvlReq,             // nivel minimo (default 1 si falta)
//     weaponName,         // solo armas: 'sword_1handed' | 'staff' | 'bow' | ...
//     tier,               // 'common' | 'uncommon' | ... (decorativo aqui)
//     atk,                // armas: ataque que suma a totalAtk()
//     def,                // armaduras: defensa que suma a totalDef()
//   }
//
// Clases del juego (ver classes.js): guerrero, mago, arquero, encapuchado, cernunnos (god).

// Ranuras de equipo (como MU): no puedes equipar TODO, cada cosa va en su ranura.
export const SLOTS = ['weapon', 'shield', 'helmet', 'armor', 'gloves', 'boots', 'amulet'];

// Compatibilidad arma-clase (sabor MU): cada clase usa ciertas armas.
//  guerrero: espada 1 mano, hacha 2 manos (ademas usa escudo)
//  mago: baston
//  arquero: arco, ballesta
//  encapuchado: daga (ademas puede sanar)
//  cernunnos/god: todas
export const WEAPON_BY_CLASS = {
  guerrero:    ['sword_1handed', 'axe_2handed'],
  mago:        ['staff'],
  arquero:     ['bow', 'crossbow_1handed'],
  encapuchado: ['dagger'],
  cernunnos:   ['sword_1handed', 'axe_2handed', 'staff', 'bow', 'crossbow_1handed', 'dagger'],
};

// Nombre legible de clase para razones en espanol.
const CLASS_NAME = {
  guerrero: 'Guerrero',
  mago: 'Mago',
  arquero: 'Arquero',
  encapuchado: 'Encapuchado',
  cernunnos: 'Diosito',
};

// Set rapido de slots validos.
const SLOT_SET = new Set(SLOTS);

// classReq vacio/null/'any' (sin importar mayusculas) = sin restriccion de clase.
function isAnyClass(classReq) {
  if (classReq == null) return true;
  return String(classReq).trim().toLowerCase() === 'any';
}

// Valida si un personaje puede equipar un item.
// item: { slot, classReq, lvlReq, weaponName?, tier, ... }
// Devuelve { ok:bool, reason:string }. god=true (Diosito) equipa CUALQUIER cosa.
export function canEquip(item, charClass, charLevel, god = false) {
  // Diosito (Cernunnos) pasa por encima de toda regla.
  if (god === true) return { ok: true, reason: '' };

  // Item ausente o no-objeto: nada que equipar.
  if (!item || typeof item !== 'object') {
    return { ok: false, reason: 'Item invalido' };
  }

  // Slot: debe existir y ser uno de los conocidos.
  const slot = item.slot;
  if (typeof slot !== 'string' || !SLOT_SET.has(slot)) {
    return { ok: false, reason: 'Ranura invalida' };
  }

  // Nivel requerido: default 1, se sanea a entero >= 1.
  const lvlReq = Number.isFinite(item.lvlReq) ? Math.max(1, Math.floor(item.lvlReq)) : 1;
  const lvl = Number.isFinite(charLevel) ? Math.floor(charLevel) : 1;
  if (lvl < lvlReq) {
    return { ok: false, reason: `Requiere nivel ${lvlReq}` };
  }

  // Restriccion de clase: si el item pide una clase concreta, debe coincidir.
  if (!isAnyClass(item.classReq)) {
    const req = String(item.classReq).trim().toLowerCase();
    const cls = String(charClass || '').trim().toLowerCase();
    if (req !== cls) {
      const nice = CLASS_NAME[req] || item.classReq;
      return { ok: false, reason: `Solo para ${nice}` };
    }
  }

  // Compatibilidad de arma con la clase (solo aplica a la ranura 'weapon').
  if (slot === 'weapon' && item.weaponName) {
    const cls = String(charClass || '').trim().toLowerCase();
    const allowed = WEAPON_BY_CLASS[cls];
    if (!allowed || !allowed.includes(item.weaponName)) {
      const nice = CLASS_NAME[cls] || charClass || 'tu clase';
      return { ok: false, reason: `${nice} no puede usar esta arma` };
    }
  }

  return { ok: true, reason: '' };
}

// Maneja el set equipado por SLOT (un item por ranura).
export class Equipment {
  constructor(onChange) {
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
    // slots: { weapon:item|null, shield:item|null, ... } una entrada por cada SLOT.
    this.slots = {};
    for (const s of SLOTS) this.slots[s] = null;
  }

  // Notifica el cambio pasando una copia superficial del mapa de slots.
  _emit() {
    this.onChange({ ...this.slots });
  }

  // Valida con canEquip; si ok pone el item en su slot y devuelve el item que estaba
  // (o null), para que el caller lo devuelva al inventario. Si no, { ok:false, reason }.
  equip(item, charClass, charLevel, god = false) {
    const check = canEquip(item, charClass, charLevel, god);
    if (!check.ok) return { ok: false, reason: check.reason };
    const slot = item.slot;
    const prev = this.slots[slot] || null;
    this.slots = { ...this.slots, [slot]: item };
    this._emit();
    return { ok: true, reason: '', previous: prev };
  }

  // Saca el item de un slot y lo devuelve (null si la ranura estaba vacia o es invalida).
  unequip(slot) {
    if (!SLOT_SET.has(slot)) return null;
    const item = this.slots[slot] || null;
    if (!item) return null;
    this.slots = { ...this.slots, [slot]: null };
    this._emit();
    return item;
  }

  // Suma atk de las piezas con atk (tipicamente el arma).
  totalAtk() {
    let sum = 0;
    for (const s of SLOTS) {
      const it = this.slots[s];
      if (it && Number.isFinite(it.atk)) sum += it.atk;
    }
    return sum;
  }

  // Suma def de las piezas con def (armaduras, escudo, casco, etc).
  totalDef() {
    let sum = 0;
    for (const s of SLOTS) {
      const it = this.slots[s];
      if (it && Number.isFinite(it.def)) sum += it.def;
    }
    return sum;
  }

  // Bonus agregado para el HUD.
  bonusSummary() {
    return { atk: this.totalAtk(), def: this.totalDef() };
  }

  // Snapshot serializable: { weapon:id, shield:id, ... } (null donde no hay item).
  serialize() {
    const out = {};
    for (const s of SLOTS) {
      const it = this.slots[s];
      out[s] = it && it.id != null ? it.id : null;
    }
    return out;
  }
}
