globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const { CLASS_LIST, CERNUNNOS } = await import('../src/rpg/classes.js');
const { SkillSystem } = await import('../src/rpg/skills.js');

const NORMAL_CD_RANGE = { Q: [5.2, 6.0], E: [9.8, 11.4], R: [28, 30], F: [31, 34] };
const GOD_MIN_CD = { Q: 4, E: 8, R: 18, F: 28 };

function assertCooldownRange(spec, ranges) {
  for (const skill of spec.skills || []) {
    const range = ranges[skill.key];
    if (!range) continue;
    const [min, max] = range;
    if ((Number(skill.cd) || 0) < min || (Number(skill.cd) || 0) > max) {
      throw new Error(`${spec.id}.${skill.key} cooldown outside balance range: ${skill.cd} not in ${min}-${max}`);
    }
  }
}

for (const spec of CLASS_LIST) assertCooldownRange(spec, NORMAL_CD_RANGE);
assertCooldownRange(CERNUNNOS, Object.fromEntries(Object.entries(GOD_MIN_CD).map(([key, min]) => [key, [min, min]])));

for (const spec of [...CLASS_LIST, CERNUNNOS]) {
  for (const skill of spec.skills || []) {
    if (skill.dur && skill.cd && skill.dur / skill.cd > 0.38) {
      throw new Error(`${spec.id}.${skill.key} party uptime too high: ${skill.dur}/${skill.cd}`);
    }
    if (skill.type === 'partyheal' && (Number(skill.cd) || 0) < 18) {
      throw new Error(`${spec.id}.${skill.key} party heal cooldown too low: ${skill.cd}`);
    }
  }
}

{
  const fake = {
    res: 0,
    resMax: 100,
    cds: [4.0],
    _autoCastT: 0.36,
    _refreshUI() {},
  };
  const out = SkillSystem.prototype.onKill.call(fake, 40, false);
  if (out.refund > 0.42) throw new Error(`normal kill cooldown refund too high: ${out.refund}`);
  if (Math.abs(fake.cds[0] - 3.58) > 0.0001) throw new Error(`normal refund changed unexpectedly: ${fake.cds[0]}`);
}

{
  const fake = {
    res: 0,
    resMax: 100,
    cds: [4.0],
    _autoCastT: 0.36,
    _refreshUI() {},
  };
  const out = SkillSystem.prototype.onKill.call(fake, 1, true);
  if (out.refund > 0.65) throw new Error(`boss cooldown refund too high: ${out.refund}`);
  if (Math.abs(fake.cds[0] - 3.35) > 0.0001) throw new Error(`boss refund changed unexpectedly: ${fake.cds[0]}`);
}

console.log('PASS: skill cooldown balance floors and refunds');
