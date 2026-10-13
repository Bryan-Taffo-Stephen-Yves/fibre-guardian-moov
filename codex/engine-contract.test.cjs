/* Contrat moteur ↔ interface. Aucun réseau, aucune donnée Moov réelle.
 * Les secondes ci-dessous sont des pas du simulateur, pas du temps mural.
 * L'interface doit amorcer LineSim avant window() et valider les entrées réelles.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { FG, rng } = require('../tests/load.js');
const UI = require('./ui-model.js');

function line(seed = 19) {
  const sim = new FG.LineSim({ rng: rng(seed) });
  for (let n = 0; n < 9; n++) sim.step('nominal');
  return sim;
}

test('contrat UI : fenêtre amorcée, métriques finies et absence de type de panne dans les mesures', () => {
  const sim = line();
  for (const mode of Object.keys(FG.EXPECT)) {
    const sample = sim.step(mode);
    const window = sim.window();
    for (const key of [...FG.KEYS, 'link']) {
      assert.equal(Number.isFinite(sample[key]), true, `${mode}.${key} échantillon`);
      assert.equal(Number.isFinite(window[key]), true, `${mode}.${key} fenêtre`);
    }
    assert.equal('mode' in window, false);
    assert.equal('cls' in window, false);
    assert.equal(sim.win.length, 9);
  }
});

test('contrat UI : detect ne modifie pas les mesures, chaque verdict possède un libellé et des preuves', () => {
  for (const mode of Object.keys(FG.EXPECT)) {
    const sim = line();
    for (let t = 0; t < 90; t++) sim.step(mode);
    const window = Object.freeze(sim.window());
    const before = JSON.stringify(window);
    const diagnosis = FG.detect(window);
    assert.equal(JSON.stringify(window), before);
    assert.equal(diagnosis.cls, FG.EXPECT[mode]);
    assert.equal(typeof FG.CLS[diagnosis.cls].name, 'string');
    assert.ok(diagnosis.conf >= 0 && diagnosis.conf <= 1);
    assert.ok(diagnosis.ev.some(([applicable, text]) => applicable && typeof text === 'string'));
    assert.ok(diagnosis.trace.length >= FG.RULES.length);
    assert.ok(diagnosis.trace.every(r => typeof r.name === 'string' && typeof r.st === 'string'));
  }
});

test('latence simulée : panne franche <10 s ; atténuation autorisée à converger jusqu’à 60 s', t => {
  const report = {};
  for (const mode of Object.keys(FG.EXPECT).filter(mode => mode !== 'nominal')) {
    const times = Array.from({ length: 40 }, (_, seed) => {
      const result = FG.simulate(mode, 1, 0, 90, rng(seed + 1));
      assert.equal(result.got, result.exp, `${mode}, graine ${seed + 1}`);
      assert.notEqual(result.first, null);
      assert.ok(result.first <= 60, `${mode} détectée à ${result.first} s simulées`);
      if (mode === 'rupture') assert.ok(result.first < 10);
      return result.first;
    }).sort((a, b) => a - b);
    report[mode] = { min: times[0], mediane: times[20], max: times.at(-1) };
  }
  t.diagnostic('40 graines par scénario, bruit=1, sévérité=0, horizon90s simulées : ' + JSON.stringify(report));
});

test('contrat UI : la restauration retire le défaut réel du simulateur et retrouve une ligne saine', () => {
  const sim = line();
  for (let t = 0; t < 40; t++) sim.step('rupture');
  assert.equal(FG.detect(sim.window()).cls, 'rupture');
  for (let t = 0; t < 35; t++) sim.step('nominal');
  assert.equal(FG.detect(sim.window()).cls, 'sain');
});

test('contrat langues : une réponse, un verdict et des actions pour toutes les classes affichables', () => {
  assert.deepEqual(FG.langList().map(pack => pack.id), ['fr', 'nouchi', 'dioula']);
  for (const cls of Object.keys(FG.CLS)) {
    for (const pack of FG.langList()) {
      const reply = FG.localReply(cls, pack.id, { ...FG.BASE, link: 1 }, 'Bonjour');
      assert.equal(typeof pack.verdict[cls], 'string', `${pack.id}.${cls}`);
      assert.equal(typeof reply.text, 'string');
      assert.ok(!reply.text.includes('undefined'));
      if (pack.translateTo) assert.equal(typeof reply.tr, 'string');
    }
    assert.ok(FG.ACT[cls].length > 0);
    assert.ok(FG.ACT[cls].every(action => action.length === 2));
  }
});

test('contrat agent local : source de réponse explicite, aucune clé ou dépendance serveur nécessaire', async () => {
  const response = await FG.ask({ question: 'Pourquoi ma connexion est lente ?', cls: 'wifi', conf: 0.94, lang: 'fr', w: FG.PROFILES.wifi, endpoint: '' });
  assert.match(response.src, /locale/);
  assert.match(response.text, /Wi-Fi/);
  assert.equal(FG.guard(response.text, 'wifi', FG.PROFILES.wifi).ok, true);
});

test('contrat vision : exemple 320×200 RGBA, analyse locale, distinction exemple versus photographie réelle laissée à UI', () => {
  const frame = FG.vision.samplePhoto('rupture', 0, 320, 200, rng(1));
  assert.equal(frame.width, 320);
  assert.equal(frame.height, 200);
  assert.equal(frame.data.length, 320 * 200 * 4);
  assert.ok(frame.data instanceof Uint8ClampedArray);
  const result = FG.vision.analyze([frame], { opt: -40 });
  assert.equal(result.ok, true);
  assert.equal(result.concord, true);
  assert.equal(result.visual, 'rupture');
  assert.match(result.reading, /rouge/);
  const conflict = FG.vision.analyze([frame], { opt: -18 });
  assert.equal(conflict.concord, false);
  assert.match(conflict.cause, /Divergence/);
});

test('contrat flotte : 48 abonnés uniques, incident puis résolution, notification uniquement simulée', () => {
  const fleet = new FG.Fleet({ rng: rng(2) });
  assert.equal(fleet.subs.length, 48);
  assert.equal(new Set(fleet.subs.map(sub => sub.id)).size, 48);
  const start = fleet.t;
  fleet.cutSegment('YOP-07');
  for (let t = 0; t < 200 && !fleet.incidents['YOP-07']; t++) fleet.step();
  const incident = fleet.incidents['YOP-07'];
  assert.ok(incident && incident.at > start);
  assert.equal(incident.beforeFirstCall, true);
  assert.equal(fleet.segmentStats('YOP-07').notified, 20);
  assert.equal(fleet.segmentStats('ABO-03').notified, 0);
  fleet.restore('YOP-07');
  for (let t = 0; t < 35; t++) fleet.step();
  assert.equal(fleet.segmentStats('YOP-07').incident, null);
  assert.equal(fleet.segmentStats('YOP-07').degraded, 0);
  assert.equal(fleet.closed.length, 1);
  assert.ok(fleet.closed[0].closedAt >= incident.at);
});

test('contrat collecte : consentement fin désactivé, cadence de veille et reprise après coupure', () => {
  const collector = new FG.Collector();
  collector.setFine(false);
  assert.equal(collector.mode, 'veille');
  assert.equal(collector.tick(1, FG.BASE, false, true), null);
  assert.equal(collector.tick(60, FG.BASE, false, true), 'buffer');
  assert.equal(collector.tick(61, FG.BASE, true, true), null);
  assert.equal(collector.tick(120, FG.BASE, true, true), 'replay:1');
  assert.equal(collector.replayed, 1);
  assert.equal(collector.buffer.length, 0);
});

test('politique UI : supervision et rétention visibles uniquement aux rôles métier prévus', () => {
  for (const page of ['supervision', 'retention']) {
    for (const role of ['conseiller', 'superviseur']) assert.equal(UI.canView(page, role), true);
    for (const role of ['abonne', 'technicien', '', undefined]) assert.equal(UI.canView(page, role), false);
  }
  for (const page of ['dashboard', 'diagnostic', 'assistant', 'photo', 'sms', 'guide']) {
    assert.equal(UI.canView(page, 'abonne'), true);
  }
  // Ce filtrage client ne constitue pas une autorisation de serveur.
});

test('libellés UI : toutes les classes du détecteur ont une explication et une prochaine action', () => {
  for (const cls of Object.keys(FG.CLS)) {
    assert.equal(typeof UI.LABELS[cls], 'string');
    assert.equal(UI.NEXT[cls].length, 2);
    assert.ok(UI.NEXT[cls].every(value => typeof value === 'string' && value.length > 0));
  }
  assert.doesNotMatch(UI.LABELS.partage, /illicite|fraude|illégal/i);
});

test('redémarrage SMS simulé : numéro lié obligatoire et limite de deux commandes en dix minutes', () => {
  const now = 2_000_000;
  assert.equal(UI.rebootGate([], now, false).ok, false);
  assert.equal(UI.rebootGate([], now, true).ok, true);
  assert.equal(UI.rebootGate([now - 1], now, true).ok, true);
  const denied = UI.rebootGate([now - 100, now], now, true);
  assert.equal(denied.ok, false);
  assert.equal(denied.recent.length, 2);
  assert.match(denied.message, /2 redémarrages/);
});

test('redémarrage SMS simulé : frontière exacte dix minutes, dates futures et entrées invalides', () => {
  const now = 2_000_000;
  const history = [now - 600001, now - 600000, now - 599999, now, now + 1, NaN, Infinity, '2000000', null];
  const result = UI.rebootGate(history, now, true);
  assert.deepEqual(result.recent, [now - 599999, now]);
  assert.equal(result.ok, false);
  assert.equal(UI.rebootGate(history, now + 600001, true).ok, true);
});

test('stockage UI : JSON corrompu ou stockage indisponible conserve un repli utilisable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '{invalide', setItem: () => { throw new Error('storage denied'); } } });
    assert.deepEqual(UI.readStorage('test', []), []);
    assert.doesNotThrow(() => UI.saveStorage('test', { draft: true }));
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('storage denied'); } });
    assert.equal(UI.readStorage('test', 'repli'), 'repli');
    assert.doesNotThrow(() => UI.saveStorage('test', { draft: true }));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});
