'use strict';
// Copie du Wi-Fi : le PC branché liste les appareils du Wi-Fi (sans nom ni adresse MAC complète), la page fait une copie
// de 20 secondes pendant le test (sans mot de passe), les pannes se rejouent sur la copie, et l'équipe Moov la retrouve.
const {test, afterEach} = require('node:test'), assert = require('node:assert/strict');
const {Store} = require('./pilot-store.cjs'), {createGuardianServer} = require('./pilot-server.cjs'), {seedDemo, DEMO} = require('./seed-demo.cjs');
const VT = require('./vrai-test.cjs'), CW = require('./copie-wifi.cjs');

afterEach(() => VT.setVendorFetch(null));

async function setup() {
  const store = new Store(':memory:'), server = createGuardianServer({store, onError: () => {}});
  const saved = process.env[DEMO.admin.env]; process.env[DEMO.admin.env] = 'direction-test-2026';
  try { await seedDemo(store); } finally { if (saved === undefined) delete process.env[DEMO.admin.env]; else process.env[DEMO.admin.env] = saved; }
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, uid = email => store.get('SELECT id FROM users WHERE email=?', email).id;
  const page = async (p, token, body) => {
    const r = await fetch(base + '/api/test/' + p, {method: body ? 'POST' : 'GET', headers: {'X-Test-Token': token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
    return {status: r.status, data: await r.json()};
  };
  // Une vraie session de l'espace Moov (cookie), pour vérifier le contrôle du rôle côté serveur.
  const login = async (email, password) => { const r = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password})}); return r.headers.getSetCookie().map(v => v.split(';')[0]).join('; '); };
  const team = async (cookie, p) => { const r = await fetch(base + '/api' + p, {headers: {Cookie: cookie}}); return {status: r.status, data: await r.json()}; };
  return {store, base, page, login, team, chef: uid(DEMO.admin.email), awa: uid(DEMO.client.email), close: () => server.close()};
}
// Ce que le fichier PC envoie : le Wi-Fi lu par Windows et le tour du réseau local (adresse locale + adresse MAC).
const WIFI = {ssid: 'MOOV-FIBRE-2A4F', signal: '70', channel: '36', band: '5 GHz', radio: '802.11ax', rxMbps: '866.7', txMbps: '720', auth: 'WPA2-Personnel', computer: 'PC-SALON'};
const SCAN = {ip: '192.168.1.23', prefix: 24, gateway: '192.168.1.1', mac: '3C-22-FB-11-22-33', devices: [
  {ip: '192.168.1.1', mac: 'A4-5E-60-AA-BB-01'}, {ip: '192.168.1.30', mac: 'DA-11-22-33-44-55'}, {ip: '192.168.1.31', mac: '7E-11-22-33-44-66'},
  {ip: '192.168.1.40', mac: '8C-77-12-00-00-01'}, {ip: '224.0.0.22', mac: '01-00-5E-00-00-16'}, {ip: '192.168.1.255', mac: 'FF-FF-FF-FF-FF-FF'},
  {ip: '8.8.8.8', mac: '00-11-22-33-44-55'}, {ip: '192.168.1.41', mac: 'pas-une-adresse'}]};
const later = async (ms, fn) => { const real = Date.now; Date.now = () => real() + ms; try { return await fn(); } finally { Date.now = real; } };

test('Appareils du Wi-Fi : le PC fait le tour du réseau, sans nom ni adresse MAC complète, et voit qui arrive et qui part', async () => {
  const asked = [];
  VT.setVendorFetch(async url => { asked.push(url); return /8C-77-12$/.test(url) ? {ok: true, status: 200, text: async () => 'Samsung Electronics Co.,Ltd'} : {ok: false, status: 404, text: async () => '{"errors":{"detail":"Not Found"}}'}; });
  const t = await setup();
  try {
    const l = VT.link(t.store, t.awa);
    assert.equal((await t.page('wifi', l.token, {...WIFI, scan: SCAN})).status, 200);
    let w = (await t.page('wifi', l.token)).data;
    assert.deepEqual(w.devices.map(d => d.label), ['Box Wi-Fi', 'Ce PC', 'Téléphone ou tablette 1', 'Téléphone ou tablette 2', 'Appareil'], 'adresses de groupe, hors réseau local ou invalides écartées');
    assert.deepEqual(w.devices.map(d => d.kind), ['box', 'pc', 'mobile', 'mobile', 'appareil']);
    assert.equal(w.devices[0].mac, '…:BB:01', 'seulement les 2 derniers octets');
    assert.equal(w.devices[2].random, true, 'adresse privée d’un téléphone reconnue');
    assert.equal(w.scan.subnet, '192.168.1.0/24'); assert.equal(w.scan.medium, 'wifi');
    assert.ok(w.devices.every(d => d.since === null), 'premier tour : Guardian ne sait pas depuis quand ils sont là, il ne l’invente pas');
    const raw = JSON.stringify(w);
    for (const full of ['a4:5e:60', 'A4-5E-60', 'da:11:22', '3c:22:fb']) assert.ok(!raw.includes(full), 'adresse MAC complète jamais renvoyée : ' + full);
    const {wifi: _w, ...rest} = w;
    assert.equal(w.wifi.computer, 'PC-SALON'); assert.ok(!JSON.stringify(rest).includes('PC-SALON'), 'le nom du PC n’apparaît que dans le relevé Wi-Fi');
    // Le numéro anonyme est signé par le serveur : impossible d'en retrouver l'adresse MAC, même en connaissant le lien.
    const crypto = require('node:crypto'), hashOf = v => crypto.createHash('sha256').update(v).digest('hex');
    assert.ok(!w.devices.some(d => d.id === hashOf(hashOf(l.token) + 'a4:5e:60:aa:bb:01').slice(0, d.id.length)));
    // Le fabricant : seulement les 3 premiers octets sont demandés, jamais pour une adresse privée.
    await new Promise(r => setTimeout(r, 1300));
    assert.ok(asked.length >= 1 && asked.every(u => /^https:\/\/api\.macvendors\.com\/[0-9A-F]{2}-[0-9A-F]{2}-[0-9A-F]{2}$/i.test(u)), 'trois octets seulement : ' + asked.join(' '));
    assert.ok(!asked.some(u => /DA-11-22|7E-11-22/.test(u)), 'pas de question pour un téléphone à adresse privée');
    // Un tour envoyé trop tôt (moins de 8 secondes après le précédent) est ignoré.
    await t.page('wifi', l.token, {...WIFI, scan: {...SCAN, devices: SCAN.devices.concat({ip: '192.168.1.60', mac: '2A-00-00-00-00-60'})}});
    assert.ok(!(await t.page('wifi', l.token)).data.devices.some(d => d.ip === '192.168.1.60'), 'tour trop rapproché ignoré');
    await later(20000, async () => { await t.page('wifi', l.token, {...WIFI, scan: SCAN}); w = (await t.page('wifi', l.token)).data; });
    assert.equal(w.devices.find(d => d.ip === '192.168.1.40').label, 'Appareil Samsung');
    assert.equal(w.events.length, 0, 'premier tour : pas d’« arrivée »');
    // Une minute plus tard : un téléphone est parti, une tablette est arrivée.
    await later(80000, async () => {
      const devices = SCAN.devices.filter(d => d.ip !== '192.168.1.31').concat({ip: '192.168.1.50', mac: '2A-00-00-00-00-07'});
      await t.page('wifi', l.token, {...WIFI, scan: {...SCAN, devices}});
      w = (await t.page('wifi', l.token)).data;
    });
    assert.ok(w.devices.find(d => d.ip === '192.168.1.50').since < 5000, 'l’appareil arrivé : depuis quand il est là');
    assert.ok(!w.devices.some(d => d.ip === '192.168.1.31'), 'le téléphone parti n’est plus compté');
    assert.equal(w.gone.length, 1); assert.equal(w.gone[0].label, 'Téléphone ou tablette 2', 'il garde son numéro');
    assert.deepEqual(w.events.map(e => e.type + ':' + e.label), ['parti:Téléphone ou tablette 2', 'arrive:Téléphone ou tablette 3']);
    assert.equal(w.devices.find(d => d.ip === '192.168.1.30').label, 'Téléphone ou tablette 1', 'les numéros restent stables');
  } finally { t.close(); }
});

test('Appareils du Wi-Fi : un PC qui envoie des centaines d’adresses ne fait pas grossir la mémoire du serveur', async () => {
  VT.setVendorFetch(async () => ({ok: false, status: 404, text: async () => ''}));
  const t = await setup();
  try {
    const l = VT.link(t.store, t.awa), many = k => Array.from({length: 64}, (_, i) => ({ip: '10.0.' + k + '.' + (i + 1), mac: '02-00-00-' + String(k).padStart(2, '0') + '-00-' + (i + 16).toString(16).padStart(2, '0')}));
    for (let k = 0; k < 4; k++) await later(k * 9000, () => t.page('wifi', l.token, {...WIFI, scan: {ip: '10.0.9.9', prefix: 24, gateway: '10.0.0.1', mac: '3C-22-FB-11-22-33', medium: 'cable', devices: many(k)}}));
    const w = await later(27000, async () => (await t.page('wifi', l.token)).data);
    assert.ok(w.devices.length <= VT.MAX_KEPT, w.devices.length + ' appareils gardés au plus');
    assert.ok(w.devices.some(d => d.ip.startsWith('10.0.3.')), 'les plus récents restent');
    assert.equal(w.scan.medium, 'cable', 'PC branché par câble : la page dira « réseau »');
  } finally { t.close(); }
});

test('Copie du Wi-Fi : faite pendant le test avec le PC branché, sans mot de passe, puis figée', async () => {
  VT.setVendorFetch(async () => ({ok: false, status: 404, text: async () => ''}));
  const t = await setup();
  try {
    const l = VT.link(t.store, t.awa);
    assert.equal((await t.page('copy', l.token)).data.copy, null);
    await t.page('wifi', l.token, {...WIFI, scan: SCAN});
    const s = await t.page('copy', l.token, {new: true, network: 'wifi', typed: 'nom tapé ignoré'});
    assert.equal(s.status, 201);
    let c = s.data.copy;
    assert.equal(c.label, 'MOOV-FIBRE-2A4F'); assert.equal(c.wifi.from, 'pc', 'le nom lu par Windows passe avant le nom tapé');
    assert.equal(c.wifi.signal, 70); assert.equal(c.wifi.channel, 36); assert.equal(c.devices.length, 5); assert.equal(c.connected, 4, 'la box n’est pas comptée'); assert.equal(c.pc, true); assert.equal(c.done, false);
    assert.ok(c.devices.every(d => d.mac === undefined), 'la copie ne garde pas la fin des adresses MAC');
    const u = await t.page('copy', l.token, {id: c.id, metrics: {downloadMbps: 48.24, uploadMbps: null, latencyMs: 35.4, jitterMs: 4, lossPct: 0}, points: [{t: 0, rtt: 34}, {t: 2000, rtt: 36, mbps: 48.2}, {t: 4000, rtt: null}, {t: -5, rtt: 9}, {t: 'x'}, {t: 999999, rtt: 12}]});
    c = u.data.copy;
    assert.equal(c.metrics.downloadMbps, 48.2); assert.equal(c.metrics.latencyMs, 35.4);
    assert.deepEqual(c.points, [{t: 0, rtt: 34, mbps: null}, {t: 2000, rtt: 36, mbps: 48.2}, {t: 4000, rtt: null, mbps: null}], 'points absurdes écartés (jamais ramenés au bord), sonde perdue gardée');
    assert.equal(c.seconds, 4, 'durée enregistrée : celle des mesures reçues');
    c = (await t.page('copy', l.token, {id: c.id, final: true, metrics: {downloadMbps: 50}})).data.copy;
    assert.equal(c.done, true); assert.equal(c.metrics.downloadMbps, 50);
    c = (await t.page('copy', l.token, {id: c.id, metrics: {downloadMbps: 1}})).data.copy;
    assert.equal(c.metrics.downloadMbps, 50, 'une copie figée ne change plus');
    assert.equal((await t.page('copy', l.token)).data.copy.id, c.id, 'la page retrouve sa dernière copie');
    const row = JSON.stringify(t.store.all('SELECT * FROM wifi_copies'));
    for (const secret of ['PC-SALON', 'password', 'mot de passe', '127.0.0.1', 'a4:5e:60', 'A4-5E-60']) assert.ok(!row.includes(secret), 'rien de tel dans la copie : ' + secret);
    // Une copie d'un autre lien ne s'ouvre pas avec ce lien.
    const other = VT.link(t.store, t.awa);
    assert.equal((await t.page('copy', other.token, {id: c.id, metrics: {downloadMbps: 2}})).status, 404);
    assert.equal((await t.page('copy/simulate', other.token, {id: c.id, scenario: 'courant'})).status, 404);
    // Page mise de côté : plus de 30 secondes sans nouvelles, la copie est figée et un envoi en retard ne la change plus.
    const late = (await t.page('copy', l.token, {new: true, metrics: {downloadMbps: 20, latencyMs: 30}})).data.copy;
    const frozen = await later(40000, async () => (await t.page('copy', l.token, {id: late.id, metrics: {downloadMbps: 1}, points: [{t: 2000, rtt: 900}]})).data.copy);
    assert.equal(frozen.done, true); assert.equal(frozen.metrics.downloadMbps, 20); assert.equal(frozen.points.length, 0, 'envoi en retard : rien ne change');
    // Une copie restée sans aucune mesure ne compte pas : la suivante la remplace.
    const empty = (await t.page('copy', l.token, {new: true})).data;
    const next = (await t.page('copy', l.token, {new: true})).data;
    assert.equal(next.left, empty.left, 'la copie vide est remplacée, pas comptée');
    assert.equal(t.store.get('SELECT COUNT(*) AS n FROM wifi_copies WHERE id=?', empty.copy.id).n, 0);
    // 5 copies au plus par lien.
    for (let i = 0; i < 2; i++) assert.equal((await t.page('copy', l.token, {new: true, metrics: {downloadMbps: 10}})).status, 201);
    assert.equal((await t.page('copy', l.token, {new: true})).status, 201, 'la dernière copie vide est remplacée');
    await t.page('copy', l.token, {id: (await t.page('copy', l.token)).data.copy.id, metrics: {downloadMbps: 10}});
    assert.equal((await t.page('copy', l.token, {new: true})).status, 429);
    // Sans PC : le nom tapé par le client, et l'appareil de mesure.
    const phone = VT.link(t.store, t.awa), p = (await t.page('copy', phone.token, {new: true, network: 'hotspot', typed: 'Maison'})).data.copy;
    assert.equal(p.wifi.from, 'tape'); assert.equal(p.label, 'Maison'); assert.equal(p.pc, false); assert.equal(p.devices.length, 0);
    assert.equal(p.networkLabel, 'Partage de connexion d’un téléphone');
  } finally { t.close(); }
});

test('Pannes rejouées sur la copie : le vrai Wi-Fi n’est pas touché, chaque appareil prend son état pendant la panne', async () => {
  VT.setVendorFetch(async () => ({ok: false, status: 404, text: async () => ''}));
  const t = await setup();
  try {
    const l = VT.link(t.store, t.awa);
    await t.page('wifi', l.token, {...WIFI, scan: SCAN});
    const id = (await t.page('copy', l.token, {new: true, network: 'wifi'})).data.copy.id;
    await t.page('copy', l.token, {id, final: true, metrics: {downloadMbps: 48, latencyMs: 35, jitterMs: 4, lossPct: 0}, points: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => ({t: i * 2000, rtt: 34 + i, mbps: i % 5 ? null : 48}))});
    const sim = async scenario => (await t.page('copy/simulate', l.token, {id, scenario})).data;
    const dark = await sim('courant');
    assert.equal(dark.team, undefined, 'la consigne interne de l’équipe Moov ne part pas chez le client'); assert.equal(dark.note, null);
    assert.equal(dark.level, 'coupe'); assert.match(dark.text, /courant/);
    assert.equal(dark.devices.find(d => d.kind === 'box').state, 'eteinte');
    assert.ok(dark.devices.filter(d => d.kind !== 'box').every(d => d.state === 'deconnecte')); assert.equal(dark.summary.online, 0);
    assert.ok(dark.points.every(p => p.rtt == null), 'plus aucune réponse sur la courbe de la copie');
    const cut = await sim('fibre-coupee');
    assert.ok(cut.devices.filter(d => d.kind !== 'box').every(d => d.state === 'sans-internet'), 'le Wi-Fi marche encore, Internet non');
    assert.equal(cut.devices.find(d => d.kind === 'box').stateLabel, 'Voyant fibre rouge');
    const busy = await sim('wifi-sature');
    assert.equal(busy.summary.devices, 12); assert.equal(busy.summary.added, 8, 'la copie avait 4 appareils : 8 de plus pour en avoir 12');
    assert.equal(busy.metrics.downloadMbps, 7.2); assert.equal(busy.base.downloadMbps, 48, 'la copie d’origine reste à côté');
    assert.ok(busy.devices.filter(d => d.added).every(d => d.usage && d.state === 'lent'));
    const far = await sim('loin-box');
    assert.equal(far.signal, 28); assert.equal(far.baseSignal, 70); assert.equal(far.devices.find(d => d.kind === 'pc').state, 'faible');
    assert.equal(far.devices.find(d => d.kind === 'mobile').state, 'ok', 'les autres appareils, près de la box, vont bien');
    const shaky = await sim('fibre-abimee');
    assert.equal(shaky.level, 'instable'); assert.ok(shaky.points.filter(p => p.rtt == null).length >= 5, 'des sondes perdues sur la courbe');
    assert.equal((await t.page('copy/simulate', l.token, {id, scenario: 'formater'})).status, 404);
    // Rien n'a bougé : ni la copie, ni la conversation du client.
    const again = (await t.page('copy', l.token)).data.copy;
    assert.equal(again.metrics.downloadMbps, 48); assert.equal(again.devices.length, 5);
    // Sans PC : la box (ou le téléphone qui partage) et l'appareil de mesure.
    const phone = VT.link(t.store, t.awa), pid = (await t.page('copy', phone.token, {new: true, network: 'hotspot'})).data.copy.id;
    const ps = (await t.page('copy/simulate', phone.token, {id: pid, scenario: 'loin-box'})).data;
    assert.deepEqual(ps.devices.map(d => d.label + ':' + d.state), ['Box Wi-Fi:box', 'Cet appareil:faible'], 'un partage de connexion se joue comme le Wi-Fi d’une box');
    assert.match(ps.note, /partage de connexion.*comme si c’était le Wi-Fi de votre box/);
    assert.equal((await t.page('copy/simulate', phone.token, {id: pid, scenario: 'fibre-coupee'})).data.devices[0].stateLabel, 'Voyant fibre rouge');
  } finally { t.close(); }
});

test('Espace Moov : seuls les comptes de l’équipe voient les copies et y rejouent une panne', async () => {
  VT.setVendorFetch(async () => ({ok: false, status: 404, text: async () => ''}));
  const t = await setup();
  try {
    const l = VT.link(t.store, t.awa);
    await t.page('wifi', l.token, {...WIFI, scan: SCAN});
    const id = (await t.page('copy', l.token, {new: true, network: 'wifi', metrics: {downloadMbps: 48, latencyMs: 35}})).data.copy.id;
    assert.throws(() => CW.list(t.store, t.awa), e => e.status === 403, 'un client ne voit pas les copies');
    assert.throws(() => CW.teamSimulate(t.store, t.awa, {id, scenario: 'courant'}), e => e.status === 403);
    const all = CW.list(t.store, t.chef);
    assert.equal(all.copies.length, 1); assert.equal(all.scenarios.length, 6);
    const c = all.copies[0];
    assert.equal(c.label, 'MOOV-FIBRE-2A4F'); assert.equal(c.pc, true); assert.equal(c.done, false, 'la copie s’enregistre encore');
    assert.ok(c.client.name && !c.client.name.includes(' '), 'seulement le prénom du client');
    assert.equal(c.devices, 4, 'même compte que la page du client : la box n’est pas comptée');
    const d = CW.detail(t.store, t.chef, id);
    assert.equal(d.copy.devices.length, 5); assert.equal(d.copy.wifi.auth, 'WPA2-Personnel');
    assert.ok(d.copy.devices.some(x => x.label === 'PC du client') && !d.copy.devices.some(x => x.label === 'Ce PC'), 'pour l’équipe : « PC du client »');
    const r = CW.teamSimulate(t.store, t.chef, {id, scenario: 'fibre-abimee'});
    assert.match(r.team, /réflectomètre/); assert.equal(r.level, 'instable'); assert.ok(r.devices.some(x => x.label === 'PC du client'));
    // Par le serveur, avec une vraie session : le rôle est vérifié côté serveur.
    const awa = await t.login(DEMO.client.email, DEMO.client.fallback), chef = await t.login(DEMO.admin.email, 'direction-test-2026');
    assert.equal((await t.team(awa, '/noc/copies')).status, 403, 'un client n’ouvre pas la liste des copies');
    assert.equal((await t.team(awa, '/noc/copies?id=' + id)).status, 403);
    const http = await t.team(chef, '/noc/copies');
    assert.equal(http.status, 200); assert.equal(http.data.copies[0].id, id);
    // Un seul compte ne peut pas remplir la liste de l'équipe : 5 copies au plus par client.
    for (let i = 0; i < 3; i++) { const k = VT.link(t.store, t.awa); for (let j = 0; j < 2; j++) await t.page('copy', k.token, {new: true, metrics: {downloadMbps: 10 + j}}); }
    assert.equal(CW.list(t.store, t.chef).copies.filter(x => x.client.name === c.client.name).length, 5);
    assert.throws(() => CW.detail(t.store, t.chef, 'inconnue'), e => e.status === 404);
    // Plus de 35 secondes après le début, la copie est figée toute seule.
    await later(40000, async () => { assert.equal(CW.list(t.store, t.chef).copies[0].done, true); });
  } finally { t.close(); }
});
