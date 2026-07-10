// Contract smoke for the Bodega commerce surface. The browser layout is covered
// by the visual smoke suite; this keeps the purchase, sale and equip affordances
// from silently disappearing during DOM refactors.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loot = fs.readFileSync(path.join(root, 'src', 'rpg', 'loot.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');

for (const marker of [
  "context.textContent = 'Equipo y suministros'",
  "open ? 'Compra, vende y equipa'",
  "h.textContent = 'CATÁLOGO DISPONIBLE'",
  "'COMPRAR ' + prod.price + 'g'",
  "use.textContent = item.kind === 'potion' ? 'Beber' : (isEq ? 'Equipada' : 'Equipar')",
  "sell.textContent = 'Vender ' + sellGold + 'g'",
]) assert.ok(loot.includes(marker), `missing Bodega UI contract: ${marker}`);

assert.match(loot, /\.rpg-inv\.is-shop/);
assert.match(loot, /background:linear-gradient\(155deg,rgba\(13,22,31/);
assert.match(loot, /\.rpg-shop-row button\{[^}]*background:linear-gradient\(180deg,#244a5a,#17333f\)/s);

for (const product of ['potion_s', 'potion_l', 'weapon']) {
  assert.ok(app.includes(`id: '${product}'`), `missing shop product ${product}`);
}
assert.ok(app.includes('wallet.spend(prod.price)'), 'purchases must debit the wallet');
assert.ok(app.includes('inventory.onSell ='), 'sales must credit through the app');

console.log('PASS: Bodega exposes cold buy, sell and equip commerce contracts');
