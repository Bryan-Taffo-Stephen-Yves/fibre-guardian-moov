const test = require('node:test');
const assert = require('node:assert');
const { FG, rng } = require('./load');

const FAULTS = ['rupture', 'attenuation', 'wifi', 'amont', 'congestion', 'partage'];

test('chaque panne est reconnue sans connaître le type injecté (critère 3.2)', () => {
  for (const mode of FAULTS) {
    const r = rng(7), N = 30; let ok = 0;
    for (let i = 0; i < N; i++) if (FG.simulate(mode, 1, 0, 60, r).got === FG.EXPECT[mode]) ok++;
    assert.ok(ok / N >= 0.9, `${mode} : ${ok}/${N}`);
  }
});

test('panne franche détectée en moins de 10 s (ENF-2)', () => {
  const r = rng(3);
  for (let i = 0; i < 20; i++) { const s = FG.simulate('rupture', 1, 0, 30, r); assert.ok(s.first !== null && s.first < 10, `détection à ${s.first} s`); }
});

test('ligne nominale : aucune fausse alarme, à toute heure, avec la ligne de base', () => {
  const r = rng(11), baseline = FG.Baseline.seed(r, { pastFault: true });
  for (let h = 0; h < 24; h += 3) for (let i = 0; i < 5; i++) assert.strictEqual(FG.simulate('nominal', 1, 0, 40, r, { baseline, hour: h }).fa, false, `fausse alarme à ${h} h`);
});

test('la ligne de base ignore une panne ancienne dans l\'historique (MAD)', () => {
  const b = FG.Baseline.seed(rng(5), { pastFault: true }), s = b.stat(21, 'dl');
  assert.ok(s.med > 60, `médiane ${s.med}`);
  assert.ok(Math.abs(b.z(21, 'dl', s.med)) < 0.01);
});

test('écart à la ligne de base sans règle franchie : classe anomalie', () => {
  const b = FG.Baseline.seed(rng(5)), w = { ...FG.BASE, link: 1 };
  w.lat = 60; w.loss = 0.8; // en dessous des seuils physiques, très loin de l'habitude à 10 h
  const d = FG.detect(w, { baseline: b, hour: 10 });
  assert.strictEqual(d.cls, 'anomalie');
});

test('collecte : moins de 5 Mo par mois en veille (ENF-8) et tampon rejoué au retour du lien', () => {
  assert.ok(FG.Collector.monthlyVeilleMB() < 5);
  const c = new FG.Collector(); c.mode = 'diagnostic';
  for (let t = 0; t < 5; t++) assert.strictEqual(c.tick(t, FG.BASE, false, true), 'buffer');
  assert.strictEqual(c.tick(5, FG.BASE, true, true), 'replay:5');
});
