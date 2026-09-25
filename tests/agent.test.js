const test = require('node:test');
const assert = require('node:assert');
const { FG } = require('./load');

const W = { ...FG.PROFILES.wifi, link: 1 };

test('chaque langue a un verdict pour chaque classe (ENF-23)', () => {
  const classes = Object.keys(FG.CLS);
  FG.langList().forEach(p => classes.forEach(c => assert.ok(p.verdict[c], `${p.id} · ${c}`)));
});

test('réponse locale : cite une mesure réelle et passe le garde-fou, pour chaque classe et langue', () => {
  Object.keys(FG.CLS).forEach(cls => {
    const w = { ...(FG.PROFILES[cls] || FG.BASE), link: 1 };
    FG.langList().forEach(p => {
      const r = FG.localReply(cls, p.id, w, 'ça marche pas');
      assert.ok(/\d/.test(r.text), `${p.id} · ${cls} sans chiffre`);
      const g = FG.guard(r.text + ' ' + (r.tr || ''), cls, w);
      assert.ok(g.ok, `${p.id} · ${cls} : ${g.why}`);
    });
  });
});

test('le garde-fou rejette un chiffre inventé', () => {
  assert.strictEqual(FG.guard('Votre débit est de 437 Mbps.', 'wifi', W).ok, false);
});

test('intention reconnue en français et en nouchi', () => {
  assert.strictEqual(FG.intentOf('Je dois appeler le 101 ?', 'fr'), 'appel');
  assert.strictEqual(FG.intentOf("mon wifi là il gère pas dèh", 'nouchi'), 'wifi');
  assert.strictEqual(FG.intentOf('ya fohi depuis ce matin', 'nouchi'), 'coupure');
});

test('sans serveur : réponse locale, hors ligne', async () => {
  const r = await FG.ask({ question: 'pourquoi ça rame ?', cls: 'wifi', conf: 0.9, lang: 'fr', w: W, endpoint: null });
  assert.match(r.src, /hors ligne/);
  assert.ok(r.text.length > 20);
});

test('serveur injoignable : repli local', async () => {
  const r = await FG.ask({ question: 'bonjour', cls: 'sain', conf: 0.9, lang: 'fr', w: { ...FG.BASE, link: 1 }, endpoint: 'http://127.0.0.1:9/api/agent' });
  assert.match(r.src, /injoignable/);
});
