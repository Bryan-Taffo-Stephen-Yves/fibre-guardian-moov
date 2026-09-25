const test = require('node:test');
const assert = require('node:assert');
const { FG, rng } = require('./load');

test('coupure d\'un segment : incident de zone déclaré avant le premier appel (EF-M10)', () => {
  const fleet = new FG.Fleet({ rng: rng(2) });
  fleet.cutSegment('YOP-07');
  for (let i = 0; i < 200 && !fleet.incidents['YOP-07']; i++) fleet.step();
  const inc = fleet.incidents['YOP-07'];
  assert.ok(inc, 'incident non déclaré');
  assert.ok(inc.count >= 5 && inc.count / 20 >= 0.25);
  assert.strictEqual(inc.beforeFirstCall, true);
  assert.strictEqual(fleet.segmentStats('YOP-07').notified, 20);
});

test('sans coupure : aucun incident de zone', () => {
  const fleet = new FG.Fleet({ rng: rng(4) });
  for (let i = 0; i < 300; i++) fleet.step();
  assert.deepStrictEqual(Object.keys(fleet.incidents), []);
});

test('les autres segments ne sont pas touchés', () => {
  const fleet = new FG.Fleet({ rng: rng(6) });
  fleet.cutSegment('ABO-03');
  for (let i = 0; i < 250; i++) fleet.step();
  assert.ok(fleet.incidents['ABO-03']);
  assert.ok(!fleet.incidents['YOP-07'] && !fleet.incidents['COC-12']);
});

test('score de résiliation : classement trié, borné, avec action proposée', () => {
  const fleet = new FG.Fleet({ rng: rng(8) }), r = fleet.ranking(8);
  assert.strictEqual(r.length, 8);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  r.forEach(x => { assert.ok(x.score >= 0 && x.score <= 100); assert.ok(x.action); });
  const names = new Set(fleet.subs.map(s => s.name)); assert.strictEqual(names.size, fleet.subs.length, 'noms en double');
});
