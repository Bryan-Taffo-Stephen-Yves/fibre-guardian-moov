'use strict';
// Surveillance du Wi-Fi : le propriétaire l'active, Guardian apprend les appareils habituels pendant une minute, puis le prévient
// (dans l'application, et sur son WhatsApp déjà relié) quand un nouvel appareil se connecte. « C'est à moi » le rend habituel.
// Grosse consommation : jouée dans la Régie, réservée à l'administrateur.
const {test} = require('node:test'), assert = require('node:assert/strict');
const {Store} = require('./pilot-store.cjs'), {createGuardianServer} = require('./pilot-server.cjs'), {seedDemo, DEMO} = require('./seed-demo.cjs');
const VT = require('./vrai-test.cjs'), VW = require('./veille-wifi.cjs');

async function setup(env = {}) {
  const store = new Store(':memory:'), server = createGuardianServer({store, env, onError: () => {}});
  const saved = process.env[DEMO.admin.env]; process.env[DEMO.admin.env] = 'direction-test-2026';
  try { await seedDemo(store); } finally { if (saved === undefined) delete process.env[DEMO.admin.env]; else process.env[DEMO.admin.env] = saved; }
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, uid = email => store.get('SELECT id FROM users WHERE email=?', email).id;
  const page = async (p, token, body) => {
    const r = await fetch(base + '/api/test/' + p, {method: body ? 'POST' : 'GET', headers: {'X-Test-Token': token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status: r.status, data: await r.json()};
  };
  const login = async (email, password) => {
    const r = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password})});
    const data = await r.json();
    return {cookie: r.headers.getSetCookie().map(v => v.split(';')[0]).join('; '), csrf: data.user?.csrf};
  };
  const call = async (who, p, body) => {
    const r = await fetch(base + '/api' + p, {method: body ? 'POST' : 'GET', headers: {Cookie: who.cookie, ...(body ? {'Content-Type': 'application/json', 'X-CSRF-Token': who.csrf} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status: r.status, data: await r.json()};
  };
  return {store, base, page, login, call, chef: uid(DEMO.admin.email), awa: uid(DEMO.client.email), close: () => server.close()};
}
const WIFI = {ssid: 'MOOV-FIBRE-2A4F', signal: '70', computer: 'PC-SALON'};
const scanOf = extra => ({ip: '192.168.1.23', prefix: 24, gateway: '192.168.1.1', mac: '3C-22-FB-11-22-33', devices: [
  {ip: '192.168.1.1', mac: 'A4-5E-60-AA-BB-01'}, {ip: '192.168.1.30', mac: 'DA-11-22-33-44-55'}, {ip: '192.168.1.31', mac: '7E-11-22-33-44-66'}, ...extra]});
const later = async (ms, fn) => { const real = Date.now; Date.now = () => real() + ms; try { return await fn(); } finally { Date.now = real; } };
const settle = () => new Promise(r => setTimeout(r, 50));

test('Surveillance du Wi-Fi : apprend les appareils habituels, signale le nouveau, « C’est à moi » le rend habituel', async () => {
  VT.setVendorFetch(async () => ({ok: false, status: 404, text: async () => ''}));
  const t = await setup();
  try {
    const l = VT.link(t.store, t.awa);
    // Sans surveillance : un nouvel appareil ne déclenche rien.
    await t.page('wifi', l.token, {...WIFI, scan: scanOf([])});
    let v = (await t.page('veille', l.token)).data;
    assert.equal(v.on, false); assert.equal(v.usual, 0);
    // Activée : la première minute, les appareils vus deviennent habituels (ni la box, ni le PC lui-même).
    v = (await t.page('veille', l.token, {on: true})).data;
    assert.equal(v.on, true); assert.equal(v.learning, true);
    await later(9000, () => t.page('wifi', l.token, {...WIFI, scan: scanOf([])}));
    v = (await t.page('veille', l.token)).data;
    assert.equal(v.usual, 2, 'deux téléphones habituels, ni la box ni le PC');
    assert.equal(v.pending.length, 0);
    // Après la minute : un téléphone inconnu arrive → alerte, dans l'application.
    await later(VW.LEARN_MS + 20000, () => t.page('wifi', l.token, {...WIFI, scan: scanOf([{ip: '192.168.1.77', mac: 'C6-00-00-00-00-77'}])}));
    await settle();
    v = (await t.page('veille', l.token)).data;
    assert.equal(v.pending.length, 1, 'un nouvel appareil à reconnaître');
    assert.equal(v.log.length, 1); assert.equal(v.log[0].kind, 'nouveau'); assert.equal(v.log[0].whatsapp, false, 'aucun WhatsApp réglé : alerte dans l’application seulement');
    assert.match(v.log[0].text, /nouvel appareil vient de se connecter/);
    assert.ok(!/C6-00|c6:00/i.test(JSON.stringify(v)), 'jamais l’adresse MAC');
    // Le même appareil au tour suivant : pas de deuxième alerte.
    await later(VW.LEARN_MS + 45000, () => t.page('wifi', l.token, {...WIFI, scan: scanOf([{ip: '192.168.1.77', mac: 'C6-00-00-00-00-77'}])}));
    await settle();
    assert.equal((await t.page('veille', l.token)).data.log.length, 1, 'une seule alerte par appareil');
    // « C'est à moi » : il devient habituel.
    v = (await t.page('veille', l.token, {mine: v.pending[0].id})).data;
    assert.equal(v.pending.length, 0); assert.equal(v.usual, 3);
    assert.equal((await t.page('veille', l.token, {mine: 'abcdefabcdef'})).status, 404);
    // Le lien du PC reste valable tant que la surveillance est active.
    const before = t.store.get('SELECT expires FROM speed_links').expires;
    await later(20 * 60000, () => t.page('wifi', l.token, {...WIFI}));
    assert.ok(t.store.get('SELECT expires FROM speed_links').expires > before, 'lien prolongé');
    // Arrêter : Guardian oublie tout.
    v = (await t.page('veille', l.token, {on: false})).data;
    assert.equal(v.on, false); assert.equal(v.usual, 0); assert.equal(v.log.length, 0);
    assert.equal((await t.page('veille', l.token, {on: 'oui'})).status, 400);
  } finally { t.close(); VT.setVendorFetch(null); }
});

test('Surveillance du Wi-Fi : le message part sur le WhatsApp déjà relié au compte, 6 par heure au plus', async () => {
  const t = await setup();
  try {
    t.store.run('INSERT INTO wa_accounts VALUES(?,?,?)', t.awa, '2250701020304', Date.now());
    VW.toggle(t.store, t.awa, true, {now: Date.now() - VW.LEARN_MS - 1000});
    const sent = [], cfg = {provider: 'greenapi', id: '1', token: 't', url: 'https://wa.test', clients: [], list: []};
    const fetchImpl = async (url, o) => { sent.push(JSON.parse(o.body)); return {ok: true, status: 200, json: async () => ({})}; };
    const alerts = VW.scan(t.store, t.awa, [{mac: 'c6:00:00:00:00:01', kind: 'mobile', label: 'Téléphone ou tablette 3'}, {mac: 'a4:00:00:00:00:01', kind: 'box', label: 'Box Wi-Fi'}]);
    assert.equal(alerts.length, 1, 'la box n’est jamais signalée');
    assert.equal((await VW.deliver(t.store, cfg, t.awa, alerts[0], {fetchImpl})).channel, 'whatsapp');
    assert.equal(sent[0].chatId, '2250701020304@c.us');
    assert.match(sent[0].message, /^Moov Africa · Fibre Guardian\n\nUn nouvel appareil vient de se connecter à votre Wi-Fi à \d+ h \d\d.*« Téléphone ou tablette 3 »/s);
    assert.match(sent[0].message, /C’est à moi/);
    for (let i = 0; i < 8; i++) await VW.deliver(t.store, cfg, t.awa, {kind: 'nouveau', text: 'x', at: Date.now()}, {fetchImpl});
    assert.equal(sent.length, VW.HOUR_MAX, 'au-delà de 6 par heure, l’alerte reste dans l’application');
    // Un compte sans WhatsApp : rien ne part.
    assert.equal((await VW.deliver(t.store, cfg, t.chef, alerts[0], {fetchImpl})).channel, 'app');
  } finally { t.close(); }
});

test('Surveillance du Wi-Fi : depuis l’écran Appareils (session), et « grosse consommation » réservée à l’administrateur dans la Régie', async () => {
  const t = await setup();
  try {
    const awa = await t.login(DEMO.client.email, DEMO.client.fallback), chef = await t.login(DEMO.admin.email, 'direction-test-2026');
    assert.equal((await t.call(awa, '/veille')).data.on, false);
    assert.equal((await t.call(awa, '/veille', {on: true})).data.on, true);
    assert.equal((await t.call(chef, '/veille')).data.on, false, 'chacun sa surveillance');
    assert.equal((await t.call(awa, '/regie', {type: 'heavy'})).status, 403, 'un client ne joue pas la Régie');
    assert.equal((await t.call(chef, '/regie', {type: 'heavy'})).status, 409, 'salle fermée');
    assert.equal((await t.call(chef, '/regie', {type: 'open', ssid: 'MOOV-FIBRE-DEMO'})).status, 200);
    const r = await t.call(chef, '/regie', {type: 'heavy'});
    assert.equal(r.status, 200); assert.equal(r.data.heavy.whatsapp, 0);
    assert.match(r.data.heavy.text, /utilise beaucoup de données : 18 Go depuis \d+ h, 6 fois plus que d’habitude/);
    const v = (await t.call(chef, '/veille')).data;
    assert.equal(v.log[0].kind, 'conso', 'l’alerte arrive aussi dans l’application de l’administrateur');
  } finally { t.close(); }
});
