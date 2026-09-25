const test = require('node:test');
const assert = require('node:assert');
const { FG, rng } = require('./load');

const tel = { rupture: { opt: -40 }, sain: { opt: -18 }, wifi: { opt: -18 }, attenuation: { opt: -29 } };

test('photo d\'exemple : lecture des voyants cohérente avec la panne', () => {
  const expected = { rupture: 'rupture', sain: 'normal', wifi: 'wifi', attenuation: 'normal' };
  for (const [cls, vis] of Object.entries(expected)) {
    const a = FG.vision.analyze([FG.vision.samplePhoto(cls, 0, 320, 200, rng(1))], tel[cls]);
    assert.ok(a.ok, cls + ' : ' + a.reason);
    assert.strictEqual(a.visual, vis, cls);
    assert.strictEqual(a.concord, true, cls);
  }
});

test('deux photos à 1 s : clignotement détecté', () => {
  const a = FG.vision.analyze([FG.vision.samplePhoto('attenuation', 0, 320, 200, rng(1)), FG.vision.samplePhoto('attenuation', 1, 320, 200, rng(2))], tel.attenuation);
  assert.ok(a.blink.length >= 1);
});

test('divergence photo / télémétrie signalée', () => {
  const a = FG.vision.analyze([FG.vision.samplePhoto('sain', 0, 320, 200, rng(1))], { opt: -40 });
  assert.strictEqual(a.concord, false);
});

test('photo sombre : reprise demandée', () => {
  const W = 200, H = 120, data = new Uint8ClampedArray(W * H * 4).fill(8);
  const a = FG.vision.analyze([{ data, width: W, height: H }], tel.sain);
  assert.strictEqual(a.ok, false);
  assert.match(a.reason, /sombre/);
});
