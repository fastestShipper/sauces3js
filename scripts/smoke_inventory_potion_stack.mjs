globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Inventory } = await import('../src/rpg/loot.js');

function potion(id, heal = 25, count = 1) {
  return { id, name: 'Poción menor', kind: 'potion', heal, count };
}

{
  const inv = new Inventory(() => {});
  const used = [];
  inv.onUse = (item) => used.push({ id: item.id, count: item.count || 1 });

  inv.add(potion('p1'));
  inv.add(potion('p2'));
  inv.add(potion('p3'));

  if (inv.items.length !== 1) throw new Error(`same potions should stack into one slot, got ${inv.items.length}`);
  if (inv.items[0].count !== 3) throw new Error(`stacked potion count should be 3, got ${inv.items[0].count}`);
  if (inv._potionGroups()[0]?.count !== 3) throw new Error('quickbar group did not include full stack count');

  inv.useConsumable(0);
  if (used.length !== 1) throw new Error('using a stacked potion should call onUse once');
  if (inv.items.length !== 1 || inv.items[0].count !== 2) throw new Error('using one potion should decrement the stack');

  inv.useConsumable(0);
  inv.useConsumable(0);
  if (used.length !== 3) throw new Error('stack should provide three consumable uses');
  if (inv.items.length !== 0) throw new Error('stack should disappear after final potion use');
  console.log('PASS: stacked potions consume one unit at a time');
{
  const inv = new Inventory(() => {});
  inv.onUse = () => false;
  inv.add(potion('full-health', 45, 2));
  const used = inv.useConsumable(0);
  if (used) throw new Error('a rejected potion use should report false');
  if (inv.items.length !== 1 || inv.items[0].count !== 2) {
    throw new Error('a rejected potion use must not consume inventory');
  }
  console.log('PASS: rejected potion use preserves the stack');
}

}

{
  const inv = new Inventory(() => {});
  let sale = null;
  inv.onSell = (item, gold) => { sale = { item, gold }; };
  inv.add(potion('sale1', 40, 2));
  inv.add(potion('sale2', 40, 1));
  inv.sell(inv.items[0]);
  if (!sale || sale.gold !== 24) throw new Error(`selling a potion stack should pay for every unit, got ${sale?.gold}`);
  if (inv.items.length !== 0) throw new Error('selling a potion stack should remove the whole stack');
  console.log('PASS: stacked potions sell for full stack value');
}

{
  const inv = new Inventory(() => {});
  inv.add(potion('base'));
  for (let i = 0; i < 39; i++) {
    const ok = inv.add({ id: 'w' + i, name: 'Espada', weaponName: 'sword_1handed', tier: 'uncommon', atk: 10 });
    if (!ok) throw new Error(`failed to fill inventory at weapon ${i}`);
  }
  if (inv.items.length !== 40) throw new Error(`inventory setup should be full, got ${inv.items.length}`);
  if (!inv.add(potion('extra'))) throw new Error('full inventory should still accept an existing potion stack');
  if (inv.items.length !== 40 || inv.items[0].count !== 2) throw new Error('stacking in a full inventory should not add a slot');
  const blocked = inv.add({ id: 'blocked', name: 'Daga', weaponName: 'dagger', tier: 'uncommon', atk: 9 });
  if (blocked) throw new Error('full inventory should still reject a new non-stack item');
  console.log('PASS: potion stacking works even when inventory slots are full');
}

console.log('PASS: inventory potion stack smoke');
