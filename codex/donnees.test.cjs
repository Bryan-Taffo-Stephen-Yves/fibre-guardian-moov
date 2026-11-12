'use strict';
// « Mes données » (loi ivoirienne n°2013-450) : le client voit ce que l'application garde, le télécharge, refuse l'IA,
// et efface son compte. Les comptes de démo partagés et l'équipe Moov ne s'effacent pas. Ce qui ne sert plus part tout seul.
const {test} = require('node:test'), assert = require('node:assert/strict');
const {createGuardianServer} = require('./pilot-server.cjs');
const {seedDemo} = require('./seed-demo.cjs');
const DP = require('./donnees.cjs'), ai = require('./guardian-ai.cjs'), journey = require('./journey-store.cjs');

async function start() {
  const server = createGuardianServer({db: ':memory:', env: {}, onError: () => {}}), s = server.guardianStore;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  return {server, s, base, close: () => new Promise(r => server.close(r))};
}
async function signup(base, email) {
  const r = await fetch(base + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, name: 'Koffi Test', password: 'mot-de-passe-solide-2026'})});
  assert.equal(r.status, 200);
  const d = await r.json(), cookie = r.headers.get('set-cookie').split(';')[0];
  const call = (path, method = 'GET', body) => fetch(base + path, {method, headers: {cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': d.user.csrf}, body: body && JSON.stringify(body)});
  return {user: d.user, call};
}

test('le client voit ce qui est gardé, pourquoi et combien de temps, sans son numéro en clair', async () => {
  const {s, base, close} = await start();
  try {
    const {user, call} = await signup(base, 'koffi@example.test');
    s.run('INSERT INTO wa_accounts VALUES(?,?,?)', user.id, '2250707123456', Date.now());
    const r = await call('/api/donnees'), d = await r.json();
    assert.equal(r.status, 200);
    assert.equal(d.ia, true);
    assert.equal(d.effacable, true);
    const wa = d.items.find(i => i.key === 'whatsapp');
    assert.match(wa.detail, /•• ••/);
    assert.doesNotMatch(JSON.stringify(d), /0707123456/);
    for (const i of d.items) { assert.ok(i.pourquoi, i.key); assert.ok(i.duree, i.key); }
  } finally { await close(); }
});

test('le fichier « Mes données » contient le compte mais jamais le mot de passe ni un code', async () => {
  const {s, base, close} = await start();
  try {
    const {user, call} = await signup(base, 'aya@example.test');
    journey.put(s, user.id, journey.seed());
    s.run("INSERT INTO wa_codes(user_id,code,expires,phone) VALUES(?,?,?,?)", user.id, 'CODE-SECRET-42', Date.now() + 60000, null);
    const r = await call('/api/donnees/export'), text = await r.text();
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="mes-donnees-fibre-guardian.json"/);
    const d = JSON.parse(text);
    assert.equal(d.compte.email, 'aya@example.test');
    assert.ok(d.donnees.box_et_parcours);
    assert.doesNotMatch(text, /password|recovery|CODE-SECRET-42|scrypt/);
  } finally { await close(); }
});

test('refuser l’IA : Guardian n’appelle plus Claude pour ce client, et le choix se rallume', async () => {
  const {s, base, close} = await start();
  const key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'cle-de-test-'.padEnd(40, 'x');
  let calls = 0;
  ai.setTransport(async () => { calls++; return new Response(JSON.stringify({content: [{type: 'text', text: '{"lang":"fr","french":"ma box est éteinte"}'}]}), {status: 200, headers: {'Content-Type': 'application/json'}}); });
  try {
    const {user, call} = await signup(base, 'awa2@example.test');
    assert.equal((await (await call('/api/donnees', 'POST', {ia: false})).json()).ia, false);
    assert.equal(await ai.understand('ma box fait n’importe quoi', {store: s, uid: user.id}), null);
    assert.equal(calls, 0);
    assert.equal((await (await call('/api/donnees', 'POST', {ia: true})).json()).ia, true);
    await ai.understand('ma box fait n’importe quoi', {store: s, uid: user.id});
    assert.equal(calls, 1);
    assert.equal((await call('/api/donnees', 'POST', {ia: 'peut-être'})).status, 400);
  } finally { ai.setTransport(null); if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; await close(); }
});

test('effacer : tout ce qui est rattaché au compte part, la session aussi ; les dossiers de panne restent sans le nom', async () => {
  const {s, close} = await start();
  try {
    await seedDemo(s);
    // Un voisin qui a noté une intervention : on lui donne une adresse personnelle (les comptes de démo sont protégés).
    const u = s.get('SELECT user_id AS id FROM noc_feedback WHERE user_id NOT IN (SELECT user_id FROM operator_grants) LIMIT 1');
    assert.ok(u, 'un client qui a noté une intervention');
    s.run('UPDATE users SET email=? WHERE id=?', 'kouassi@example.test', u.id);
    journey.put(s, u.id, journey.seed());
    s.run('INSERT INTO wa_accounts VALUES(?,?,?)', u.id, '2250101020304', Date.now());
    s.run('INSERT INTO wa_inbox VALUES(?,?,?)', 'MSG1', '2250101020304', Date.now());
    s.run('INSERT INTO wifi_copies(id,user_id,token_hash,created,updated,done,data) VALUES(?,?,?,?,?,1,?)', 'c1', u.id, 'h', Date.now(), Date.now(), '{}');
    const incident = s.get('SELECT id FROM noc_incidents LIMIT 1').id;
    s.run('UPDATE noc_incidents SET reporter=? WHERE id=?', u.id, incident);
    s.session({id: u.id});
    assert.ok(s.get('SELECT count(*) AS n FROM noc_feedback WHERE user_id=?', u.id).n > 0);
    const incidents = s.get('SELECT count(*) AS n FROM noc_incidents').n;
    assert.throws(() => DP.erase(s, u.id, {}), /Confirmez/);
    assert.deepEqual(DP.erase(s, u.id, {confirm: true}), {ok: true});
    for (const {name} of s.all("SELECT name FROM sqlite_master WHERE type='table'")) {
      const cols = s.all(`PRAGMA table_info(${name})`).map(c => c.name);
      for (const col of cols.filter(c => ['user_id', 'reporter', 'actor', 'owner'].includes(c))) assert.equal(s.get(`SELECT count(*) AS n FROM ${name} WHERE ${col}=?`, u.id).n, 0, name + '.' + col);
    }
    assert.equal(s.get('SELECT count(*) AS n FROM wa_inbox WHERE phone=?', '2250101020304').n, 0);
    assert.equal(s.get('SELECT count(*) AS n FROM noc_incidents').n, incidents);
    assert.equal(s.get('SELECT reporter FROM noc_incidents WHERE id=?', incident).reporter, null);
  } finally { await close(); }
});

test('les comptes de démo partagés et l’équipe Moov ne peuvent pas être effacés depuis l’application', async () => {
  const {s, base, close} = await start();
  try {
    await seedDemo(s);
    const awa = s.get("SELECT id FROM users WHERE email='awa.kone@demo.fibre-guardian.ci'").id;
    assert.throws(() => DP.erase(s, awa, {confirm: true}), /démonstration est partagé/);
    assert.equal(DP.inventory(s, awa).effacable, false);
    const {user, call} = await signup(base, 'agent@example.test');
    s.run('INSERT INTO operator_grants VALUES(?,?,?)', user.id, 'agent', Date.now());
    const r = await call('/api/donnees', 'DELETE', {confirm: true});
    assert.equal(r.status, 403);
    assert.ok(s.get('SELECT 1 AS x FROM users WHERE id=?', user.id));
  } finally { await close(); }
});

test('par l’application : « Effacer mes données » déconnecte et le compte n’existe plus', async () => {
  const {s, base, close} = await start();
  try {
    const {user, call} = await signup(base, 'fanta@example.test');
    const r = await call('/api/donnees', 'DELETE', {confirm: true});
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /guardian=;.*Max-Age=0/);
    assert.equal(s.get('SELECT count(*) AS n FROM users WHERE id=?', user.id).n, 0);
    assert.equal((await call('/api/donnees')).status, 401);
  } finally { await close(); }
});

test('effacement automatique : relevés, copies, journal du Wi-Fi et photos de signalement anciens partent', async () => {
  const {s, base, close} = await start();
  try {
    const {user} = await signup(base, 'rose@example.test'), now = Date.now(), old = now - 31 * 86400000;
    s.run('INSERT INTO journey_usage_minutes VALUES(?,?,?,?,?)', user.id, old, 1, 0, '{}');
    s.run('INSERT INTO journey_usage_minutes VALUES(?,?,?,?,?)', user.id, now, 1, 0, '{}');
    s.run('INSERT INTO wifi_copies(id,user_id,token_hash,created,updated,done,data) VALUES(?,?,?,?,?,1,?)', 'vieille', user.id, 'h', old, old, '{}');
    s.run('INSERT INTO wifi_watch(user_id,on_at,known,pending,log) VALUES(?,?,?,?,?)', user.id, old, '[]', '[]', JSON.stringify([{kind: 'nouvel', text: 'ancien', at: old}, {kind: 'nouvel', text: 'récent', at: now}]));
    s.run("INSERT INTO citizen_reports(id,user_id,created,zone,description,photo,lat,lon,status) VALUES(?,?,?,?,?,?,?,?,'open')", 'r1', user.id, old, 'Niangon', 'Câble à terre', 'data:image/jpeg;base64,AAAA', 5.3, -4.0);
    const done = DP.purge(s, now);
    assert.equal(done.usage, 1);
    assert.equal(done.copies, 1);
    assert.equal(done.veille, 1);
    assert.equal(done.photos, 1);
    assert.equal(s.get('SELECT count(*) AS n FROM journey_usage_minutes WHERE user_id=?', user.id).n, 1);
    assert.deepEqual(JSON.parse(s.get('SELECT log FROM wifi_watch WHERE user_id=?', user.id).log).map(l => l.text), ['récent']);
    assert.equal(s.get("SELECT photo FROM citizen_reports WHERE id='r1'").photo, '');
  } finally { await close(); }
});
