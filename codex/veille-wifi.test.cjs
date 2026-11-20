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

test('Surveillance du Wi-Fi : un nouvel appareil est signalé au tour suivant, 5 secondes après (plus 20 secondes)', async () => {
  VT.setVendorFetch(async () => ({ok: false, status: 404, text: async () => ''}));
  const t = await setup();
  try {
    const l = VT.link(t.store, t.awa);
    await t.page('veille', l.token, {on: true});
    await later(2000, () => t.page('wifi', l.token, {...WIFI, scan: scanOf([])}));
    // Après la minute d'apprentissage : un tour sans nouveauté, puis 5 secondes plus tard l'appareil arrive.
    await later(VW.LEARN_MS + 5000, () => t.page('wifi', l.token, {...WIFI, scan: scanOf([])}));
    await later(VW.LEARN_MS + 10000, () => t.page('wifi', l.token, {...WIFI, scan: scanOf([{ip: '192.168.1.78', mac: 'C6-00-00-00-00-78'}])}));
    await settle();
    let v = (await t.page('veille', l.token)).data;
    assert.equal(v.log.length, 1, 'le tour 5 secondes après le précédent est pris en compte');
    // Un renvoi trop rapproché (moins de 3 secondes) reste ignoré : pas d'emballement du serveur.
    await later(VW.LEARN_MS + 11000, () => t.page('wifi', l.token, {...WIFI, scan: scanOf([{ip: '192.168.1.79', mac: 'C6-00-00-00-00-79'}])}));
    await settle();
    v = (await t.page('veille', l.token)).data;
    assert.equal(v.log.length, 1, 'tour ignoré : moins de 3 secondes après le précédent');
    // Le fichier du PC fait bien un tour toutes les 5 secondes, et mesure Internet toutes les 20 secondes.
    const cmd = VT.agent('https://guardian.test', l.token);
    assert.match(cmd, /\$nextScan = \$clock\.ElapsedMilliseconds \+ 5000/);
    assert.match(cmd, /\$nextNet = \$clock\.ElapsedMilliseconds \+ 20000; \$body\.net = Ping-Host '8\.8\.8\.8' 3/);
  } finally { t.close(); VT.setVendorFetch(null); }
});

test('Données de chaque appareil : le PC qui partage sa connexion envoie ses compteurs, Guardian en tire total et débit', async () => {
  VT.setVendorFetch(async () => ({ok: false, status: 404, text: async () => ''}));
  const t = await setup();
  try {
    const l = VT.link(t.store, t.awa);
    const hot = {ip: '192.168.137.1', prefix: 24, gateway: '192.168.137.1', mac: '3E-22-FB-11-22-33', medium: 'hotspot', devices: [
      {ip: '192.168.137.20', mac: 'DA-11-22-33-44-55'}, {ip: '192.168.137.21', mac: '7E-11-22-33-44-66'}]};
    // Avant le compteur : pas de chiffres, et Guardian sait que le PC partage sa connexion.
    await t.page('wifi', l.token, {...WIFI, scan: hot, count: 'admin'});
    let w = (await t.page('wifi', l.token)).data;
    assert.equal(w.scan.medium, 'hotspot'); assert.equal(w.scan.counting, 'admin');
    assert.equal(w.devices.find(d => d.ip === '192.168.137.20').down, null, 'rien de compté sans compteur');
    // Compteur lancé : premiers chiffres, puis 10 secondes plus tard 12,5 Mo de plus reçus par le premier téléphone.
    await later(5000, () => t.page('wifi', l.token, {...WIFI, scan: hot, count: 'on', usage: [{ip: '192.168.137.20', down: 2000000, up: 300000}, {ip: '8.8.8.8', down: 5, up: 5}]}));
    await later(15000, () => t.page('wifi', l.token, {...WIFI, scan: hot, count: 'on', usage: [{ip: '192.168.137.20', down: 14500000, up: 300000}, {ip: '192.168.137.21', down: 1000, up: 500}]}));
    w = await later(15000, async () => (await t.page('wifi', l.token)).data);
    const a = w.devices.find(d => d.ip === '192.168.137.20'), b = w.devices.find(d => d.ip === '192.168.137.21');
    assert.equal(a.down, 14500000); assert.equal(a.up, 300000);
    assert.equal(a.mbps, 10, '12,5 Mo en 10 secondes = 10 Mb/s');
    assert.equal(b.down, 1000); assert.equal(b.mbps, 0);
    assert.equal(w.scan.counting, 'on');
    assert.ok(!w.devices.some(d => d.ip === '8.8.8.8'), 'une adresse hors du partage n’est jamais un appareil');
    // Fichier PC relancé : compteurs remis à zéro, les totaux sont gardés.
    await later(20000, () => t.page('wifi', l.token, {...WIFI, scan: hot, count: 'on', usage: [{ip: '192.168.137.20', down: 100, up: 0}]}));
    await later(25000, () => t.page('wifi', l.token, {...WIFI, scan: hot, count: 'on', usage: [{ip: '192.168.137.20', down: 1000100, up: 0}]}));
    const pc = await later(25000, () => VT.pcDevices(t.store, t.awa));
    assert.equal(pc.medium, 'hotspot'); assert.equal(pc.counting, 'on');
    assert.equal(pc.devices.find(d => d.label && d.down === 15500000)?.up, 300000, 'totaux gardés après la remise à zéro');
    assert.ok(pc.devices.every(d => !('ip' in d) && !('mac' in d)), 'l’application ne reçoit ni adresse ni MAC');
    // L'écran Appareils de l'application reçoit ces chiffres.
    const awa = await t.login(DEMO.client.email, DEMO.client.fallback);
    const v = await later(25000, async () => (await t.call(awa, '/veille')).data);
    assert.equal(v.pcDevices.devices.length, 2);
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

test('Surveillance du Wi-Fi : chaque alerte arrive aussi dans l’application (cloche, Mes messages), sans changer la version du parcours', async () => {
  const t = await setup();
  try {
    const J = require('./journey-store.cjs');
    J.put(t.store, t.awa, J.seed());
    const before = J.get(t.store, t.awa), version = before.version, count = before.notifications.length;
    VW.toggle(t.store, t.awa, true, {now: Date.now() - VW.LEARN_MS - 1000});
    const [alert] = VW.scan(t.store, t.awa, [{mac: 'c6:00:00:00:00:02', kind: 'mobile', label: 'Téléphone ou tablette 4'}]);
    assert.equal((await VW.deliver(t.store, null, t.awa, alert)).channel, 'app');
    let st = J.get(t.store, t.awa);
    assert.equal(st.notifications.length, count + 1);
    const n = st.notifications[0];
    assert.equal(n.kind, 'wifi'); assert.equal(n.home, 'home-1'); assert.equal(n.read, false); assert.equal(n.page, 'devices');
    assert.equal(n.title, 'Nouvel appareil sur votre Wi-Fi');
    assert.match(n.body, /^Un nouvel appareil vient de se connecter à votre Wi-Fi à .*« Téléphone ou tablette 4 »\.$/, 'la première phrase seulement');
    assert.equal(st.version, version, 'une action en cours du client n’est pas refusée à cause d’une alerte');
    // Coupure et retour : aussi dans l'application, avec leur propre titre.
    await VW.deliver(t.store, null, t.awa, {kind: 'coupure', text: VW.textDown(Date.now() - 60000), at: Date.now()});
    await VW.deliver(t.store, null, t.awa, {kind: 'retour', text: VW.textBack(Date.now() - 120000, Date.now()), at: Date.now()});
    st = J.get(t.store, t.awa);
    assert.deepEqual(st.notifications.slice(0, 2).map(x => x.title), ['Votre connexion est revenue', 'Votre connexion semble coupée']);
    assert.equal(new Set(st.notifications.map(x => x.key)).size, st.notifications.length, 'chaque alerte a sa propre clé');
    // Sans parcours (compte jamais ouvert) : rien n'est créé, l'alerte reste dans l'écran Appareils.
    await VW.deliver(t.store, null, t.chef, {kind: 'conso', text: 'x', at: Date.now()});
    assert.equal(J.get(t.store, t.chef), null);
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

test('Chutes de connexion : une minute de silence du PC = coupure, puis « connexion revenue », et connexion instable', async () => {
  VT.setVendorFetch(async () => ({ok: false, status: 404, text: async () => ''}));
  const t = await setup();
  try {
    const l = VT.link(t.store, t.awa), sent = [];
    const cfg = {provider: 'greenapi', id: '1', token: 't', url: 'https://wa.test', clients: [], list: []};
    const fetchImpl = async (url, o) => { sent.push(JSON.parse(o.body).message); return {ok: true, status: 200, json: async () => ({})}; };
    t.store.run('INSERT INTO wa_accounts VALUES(?,?,?)', t.awa, '2250701020304', Date.now());
    // Sans surveillance : rien n'est suivi.
    await t.page('wifi', l.token, {...WIFI});
    assert.ok(!VW.BEATS.has(t.awa));
    await t.page('veille', l.token, {on: true});
    await t.page('wifi', l.token, {...WIFI});
    assert.ok(VW.BEATS.has(t.awa), 'le PC est suivi');
    const last = VW.BEATS.get(t.awa).at;
    // 40 secondes de silence : rien. 70 secondes : coupure, une seule fois.
    await VW.check(t.store, () => cfg, {now: last + 40000, fetchImpl});
    assert.equal(sent.length, 0);
    await VW.check(t.store, () => cfg, {now: last + 70000, fetchImpl});
    await VW.check(t.store, () => cfg, {now: last + 90000, fetchImpl});
    assert.equal(sent.length, 1, 'une seule alerte de coupure');
    assert.match(sent[0], /ne reçoit plus rien de votre Wi-Fi depuis \d+ h \d\d/);
    assert.match(sent[0], /PC qui surveille est éteint/, 'le message dit honnêtement qu’un PC éteint se tait aussi');
    // Le PC réécrit : « connexion revenue », avec la durée.
    const back = VW.beat(t.store, t.awa, {}, last + 4 * 60000);
    assert.equal(back.length, 1); assert.equal(back[0].kind, 'retour');
    assert.match(back[0].text, /Votre connexion est revenue à \d+ h \d\d\. Elle a été coupée 4 minutes/);
    assert.equal(VW.beat(t.store, t.awa, {}, last + 4 * 60000 + 2000).length, 0, 'pas de deuxième « revenue »');
    // Pertes trois tours de suite : connexion instable, une fois par demi-heure au plus.
    let got = [];
    for (let i = 0; i < 3; i++) got = got.concat(VW.beat(t.store, t.awa, {net: {ms: 80, lost: 1, n: 3}}, last + 5 * 60000 + i * 20000));
    assert.equal(got.length, 1); assert.equal(got[0].kind, 'instable'); assert.match(got[0].text, /33 % des signaux se perdent/);
    for (let i = 0; i < 3; i++) got = got.concat(VW.beat(t.store, t.awa, {net: {ms: 900, lost: 0, n: 3}}, last + 7 * 60000 + i * 20000));
    assert.equal(got.length, 1, 'pas de nouvelle alerte avant une demi-heure');
    // Une bonne mesure remet le compte à zéro.
    VW.beat(t.store, t.awa, {net: {ms: 900, lost: 0, n: 3}}, last + 40 * 60000);
    VW.beat(t.store, t.awa, {net: {ms: 30, lost: 0, n: 3}}, last + 40 * 60000 + 20000);
    assert.equal(VW.beat(t.store, t.awa, {net: {ms: 900, lost: 0, n: 3}}, last + 40 * 60000 + 40000).length, 0);
    // Le PC envoie sa mesure d'Internet avec le tour du réseau : elle arrive bien à Guardian.
    const real = VW.beat; let seen = null;
    VT.setOnBeat((row, d) => { seen = d; });
    await later(30000, () => t.page('wifi', l.token, {...WIFI, scan: scanOf([]), net: {ms: 42, lost: 0, n: 3}}));
    assert.deepEqual(seen.net, {ms: 42, lost: 0, n: 3});
    // Arrêter la surveillance : plus rien n'est suivi.
    await t.page('veille', l.token, {on: false});
    assert.ok(!VW.BEATS.has(t.awa));
    assert.equal(real, VW.beat);
  } finally { t.close(); VT.setVendorFetch(null); VT.setOnBeat(null); }
});

test('Wi-Fi : un nom accentué mal lu par Windows (« RÃ‰SEAU ») est remis d’aplomb, un vrai nom n’est pas touché', () => {
  assert.equal(VT.unmangle('RÃ‰SEAU PIRATÃ‰'), 'RÉSEAU PIRATÉ');
  assert.equal(VT.unmangle('CafÃ© de la gare'), 'Café de la gare');
  assert.equal(VT.unmangle('Ã la maison'), 'Ã la maison');
  assert.equal(VT.unmangle('Moov Box 5G'), 'Moov Box 5G');
  assert.equal(VT.unmangle('Été'), 'Été');
  assert.equal(VT.unmangle(null), null);
});
