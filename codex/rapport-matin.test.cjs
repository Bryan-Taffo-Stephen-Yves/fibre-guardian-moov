'use strict';
// Rapport du matin + agent anti-départ : un seul mail pour la Direction, fidèle au moteur d'incidents,
// réservé au responsable et à la direction, envoyé une fois par jour à l'heure prévue. Aucun mail réel ne part ici.
const {test} = require('node:test'), assert = require('node:assert/strict');
const {Store} = require('./pilot-store.cjs'), {createGuardianServer} = require('./pilot-server.cjs');
const {seedDemo, DEMO} = require('./seed-demo.cjs'), N = require('./noc-store.cjs'), RM = require('./rapport-matin.cjs'), journey = require('./journey-store.cjs');

async function seeded() {
  const store = new Store(':memory:'), server = createGuardianServer({store, env: {}});
  const saved = process.env[DEMO.admin.env]; process.env[DEMO.admin.env] = 'direction-test-2026';
  try { await seedDemo(store); } finally { if (saved === undefined) delete process.env[DEMO.admin.env]; else process.env[DEMO.admin.env] = saved; }
  const uid = email => store.get('SELECT id FROM users WHERE email=?', email).id;
  return {store, server, uid, chef: uid(DEMO.admin.email), awa: uid(DEMO.client.email), close: () => server.close()};
}
const ENV = {BREVO_API_KEY: 'cle-de-test', RAPPORT_MAIL_DE: 'Guardian <rapport@exemple.ci>', RAPPORT_MAIL_A: 'direction@exemple.ci, dg@exemple.ci', RAPPORT_HEURE: '7:00'};
function fakeFetch(status = 201) { const calls = []; const f = async (url, init) => { calls.push({url, init, body: JSON.parse(init.body)}); return {ok: status < 300, status, json: async () => ({message: 'refusé'})}; }; f.calls = calls; return f; }

test('Réglages : rien ne part sans clé, expéditeur et destinataire ; Brevo ou Resend ; heure lisible', () => {
  assert.equal(RM.config({}).ready, false);
  assert.equal(RM.config({BREVO_API_KEY: 'x', RAPPORT_MAIL_A: 'a@b.ci'}).ready, false, 'Brevo demande un expéditeur vérifié');
  const c = RM.config(ENV);
  assert.equal(c.ready, true); assert.equal(c.provider, 'brevo'); assert.deepEqual(c.to, ['direction@exemple.ci', 'dg@exemple.ci']); assert.equal(c.hour, 7);
  const r = RM.config({RESEND_API_KEY: 'x', RAPPORT_MAIL_A: 'moi@gmail.com pas-une-adresse', RAPPORT_HEURE: '6h30'});
  assert.equal(r.provider, 'resend'); assert.equal(r.from, 'onboarding@resend.dev'); assert.deepEqual(r.to, ['moi@gmail.com']); assert.equal(r.hour, 6); assert.equal(r.minute, 30);
  assert.equal(RM.config({...ENV, RAPPORT_MAIL: '0'}).ready, false, 'interrupteur pour couper l’envoi');
});

test('Une coupure se retrouve dans les cinq lignes, et le client qui parle de résilier dans les clients à garder', async () => {
  const t = await seeded();
  try {
    N.operate(t.store, t.chef, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'}); N.scan(t.store);
    const st = journey.get(t.store, t.awa) || journey.seed(); st.messages = [...(st.messages || []), {role: 'user', text: 'Je veux résilier mon abonnement'}]; journey.put(t.store, t.awa, st);
    const r = RM.build(t.store);
    assert.equal(r.morning.lines.length, 5);
    assert.deepEqual(r.morning.lines.map(l => l.label), ['Pannes', 'Clients touchés', 'Appels évités', 'Interventions', 'À décider']);
    assert.ok(r.morning.numbers.pannes >= 1); assert.ok(r.morning.numbers.homes >= 5, 'foyers coupés lus dans la détection');
    assert.match(r.morning.lines[0].text, /détectée/);
    const awa = r.antiDepart.clients.find(c => c.id === t.awa);
    assert.ok(awa, 'Awa remonte'); assert.match(awa.reason, /^A parlé de résilier à Guardian/); assert.match(awa.gesture, /1 mois offert/);
    assert.match(r.subject, /^Fibre Guardian · .+ : \d+ panne/);
    const text = RM.text(r), html = RM.html(r, {link: 'https://exemple.ci/codex/'});
    assert.match(text, /Guardian ne contacte aucun client seul/); assert.match(html, /Clients à garder/); assert.match(html, /Ouvrir le Superviseur/);
    assert.doesNotMatch(html + text, /simulé|fictif|LLM/i, 'aucun avertissement technique');
  } finally { t.close(); }
});

test('Réservé au responsable et à la direction : un conseiller sans mandat et un client reçoivent 403', async () => {
  const t = await seeded();
  try {
    const kader = t.uid('kader.diallo@demo.fibre-guardian.ci'), cfg = RM.config(ENV);
    for (const who of [kader, t.awa]) {
      assert.throws(() => RM.view(t.store, who, cfg), e => e.status === 403);
      await assert.rejects(RM.sendNow(t.store, who, cfg, {fetchImpl: fakeFetch()}), e => e.status === 403);
    }
    assert.equal(RM.view(t.store, t.chef, cfg).morning.lines.length, 5);
    await assert.rejects(RM.sendNow(t.store, t.chef, RM.config({}), {fetchImpl: fakeFetch()}), e => e.status === 409 && /pas encore réglée/.test(e.message));
    // Par le serveur aussi.
    await new Promise(r => t.server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + t.server.address().port;
    const res = await fetch(base + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: 'client-rm@example.test', password: 'rapport-pass-123', name: 'Client Test'})});
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert.equal((await fetch(base + '/api/noc/rapport', {headers: {Cookie: cookie}})).status, 403);
  } finally { t.close(); }
});

test('« Envoyer maintenant » : un seul mail vers toutes les adresses, par Brevo ou Resend, noté dans le journal', async () => {
  const t = await seeded();
  try {
    const f = fakeFetch(), v = await RM.sendNow(t.store, t.chef, RM.config(ENV), {fetchImpl: f, origin: 'https://exemple.ci'});
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(f.calls[0].init.headers['api-key'], 'cle-de-test');
    assert.deepEqual(f.calls[0].body.to, [{email: 'direction@exemple.ci'}, {email: 'dg@exemple.ci'}]);
    assert.deepEqual(f.calls[0].body.sender, {name: 'Guardian', email: 'rapport@exemple.ci'});
    assert.match(f.calls[0].body.htmlContent, /Le point en 5 lignes[\s\S]*Clients à garder/);
    assert.match(f.calls[0].body.htmlContent, /https:\/\/exemple\.ci\/codex\/\?portal=moov&amp;section=superviseur/);
    assert.equal(v.mail.last.ok, true); assert.equal(v.mail.last.kind, 'manuel'); assert.deepEqual(v.mail.to, ['di•••@exemple.ci', 'dg•••@exemple.ci']);
    const r = fakeFetch(); await RM.send(t.store, RM.config({RESEND_API_KEY: 'k', RAPPORT_MAIL_A: 'moi@gmail.com'}), {fetchImpl: r});
    assert.equal(r.calls[0].url, 'https://api.resend.com/emails'); assert.equal(r.calls[0].init.headers.Authorization, 'Bearer k');
    assert.equal(r.calls[0].body.from, 'Fibre Guardian <onboarding@resend.dev>'); assert.deepEqual(r.calls[0].body.to, ['moi@gmail.com']);
    // Refus du service : message clair, essai noté en échec.
    await assert.rejects(RM.send(t.store, RM.config(ENV), {fetchImpl: fakeFetch(401)}), e => e.status === 502 && /refusé l’envoi \(401 : refusé\)/.test(e.message));
    assert.equal(RM.view(t.store, t.chef, RM.config(ENV)).mail.last.ok, false);
  } finally { t.close(); }
});

test('Chaque matin à 7 h (Abidjan) : un envoi par jour, rien avant l’heure ni l’après-midi, trois essais au plus', async () => {
  const t = await seeded();
  try {
    const cfg = RM.config(ENV), at = (d, h, m = 0) => Date.UTC(2026, 10, d, h, m);
    let f = fakeFetch();
    assert.equal(await RM.tick(t.store, cfg, {now: at(18, 6, 59), fetchImpl: f}), null);
    assert.equal((await RM.tick(t.store, cfg, {now: at(18, 7, 0), fetchImpl: f})).ok, true);
    assert.equal(await RM.tick(t.store, cfg, {now: at(18, 7, 1), fetchImpl: f}), null, 'déjà envoyé ce jour-là');
    assert.equal(await RM.tick(t.store, cfg, {now: at(18, 9, 0), fetchImpl: f}), null);
    assert.equal(await RM.tick(t.store, cfg, {now: at(19, 14, 0), fetchImpl: f}), null, 'redémarrage l’après-midi : rien');
    assert.equal(f.calls.length, 1);
    f = fakeFetch(500);
    assert.equal((await RM.tick(t.store, cfg, {now: at(19, 7, 0), fetchImpl: f})).ok, false);
    assert.equal(await RM.tick(t.store, cfg, {now: at(19, 7, 5), fetchImpl: f}), null, '15 minutes entre deux essais');
    await RM.tick(t.store, cfg, {now: at(19, 7, 16), fetchImpl: f}); await RM.tick(t.store, cfg, {now: at(19, 7, 32), fetchImpl: f});
    assert.equal(await RM.tick(t.store, cfg, {now: at(19, 7, 48), fetchImpl: f}), null, 'trois essais au plus');
    assert.equal(f.calls.length, 3);
  } finally { t.close(); }
});
