'use strict';
// Page « Simulations » : chaque scène se joue sur le compte du client lui-même, ses suites arrivent à leur heure,
// l'alerte urgente bloque l'appareil sans réponse, et la grosse consommation mène à un vrai devis payable (prorata).
const {test} = require('node:test'), assert = require('node:assert/strict');
const J = require('./journey-store.cjs'), SIM = require('./simulations.cjs');
const {Store} = require('./pilot-store.cjs'), {createGuardianServer} = require('./pilot-server.cjs'), {seedDemo, DEMO} = require('./seed-demo.cjs');

const fresh = () => { const st = J.seed(); st.version = 1; return st; };
const titles = st => st.notifications.map(n => n.title);

test('plusieurs personnes : un message par arrivée, puis un point de Guardian', () => {
  const st = fresh(), t0 = Date.UTC(2026, 10, 23, 20, 0);
  SIM.start(st, 'foule', t0);
  assert.equal(st.devices.filter(d => d.sim).length, 1, 'le premier arrive tout de suite');
  assert.equal(st.notifications.length, 1);
  assert.equal(SIM.tick(st, t0 + 30000), true);
  assert.equal(st.devices.filter(d => d.sim && !d.recognized).length, 4);
  assert.equal(titles(st).filter(t => t === 'Nouvel appareil sur votre Wi-Fi').length, 4);
  assert.ok(titles(st).includes('4 nouveaux appareils en une minute'));
  assert.ok(st.messages.at(-1).text.includes('C’est à moi'));
  assert.ok(st.notifications.every(n => n.home === 'home-1' && n.kind === 'wifi' && n.page === 'devices'), 'bandeau Wi-Fi et notification du téléphone');
  assert.equal(SIM.tick(st, t0 + 31000), false, 'rien de plus à faire');
});

test('alerte urgente : sans réponse en une minute, Guardian bloque ; « C’est à moi » l’en empêche', () => {
  const t0 = Date.UTC(2026, 10, 23, 2, 0);
  let st = fresh(); SIM.start(st, 'urgent', t0);
  assert.equal(SIM.status(st, t0 + 20000).urgent.left, 40);
  SIM.tick(st, t0 + SIM.URGENT_MS - 1);
  assert.equal(st.devices.find(d => d.id === 'sim-urgent').blocked, undefined);
  SIM.tick(st, t0 + SIM.URGENT_MS);
  const d = st.devices.find(x => x.id === 'sim-urgent');
  assert.equal(d.blocked, true); assert.equal(d.autoBlocked, true);
  assert.equal(st.notifications[0].title, 'Guardian a bloqué un appareil inconnu');
  assert.deepEqual(SIM.status(st, t0 + SIM.URGENT_MS).blocked.map(x => x.id), ['sim-urgent']);
  assert.equal(SIM.status(st, t0 + SIM.URGENT_MS).urgent, null);

  st = fresh(); SIM.start(st, 'urgent', t0);
  st.devices.find(x => x.id === 'sim-urgent').recognized = true; // le client a touché « C'est à moi »
  SIM.tick(st, t0 + SIM.URGENT_MS + 5000);
  assert.ok(!st.devices.find(x => x.id === 'sim-urgent').blocked);
  assert.ok(!titles(st).includes('Guardian a bloqué un appareil inconnu'));
});

test('grosse consommation : alerte, puis devis au prorata que le paiement Moov Money accepte', () => {
  const t0 = Date.UTC(2026, 10, 21, 10, 0), st = fresh();
  SIM.start(st, 'conso', t0);
  assert.equal(st.scenario, 'download');
  assert.equal(st.notifications[0].title, 'Un appareil consomme beaucoup');
  assert.equal(st.upgrade.source, 'simulation');
  assert.equal(st.upgrade.to.mbps, 200);
  assert.equal(st.upgrade.amount, J.prorata(25000 - 20000, t0).amount, 'même calcul que « Changer de forfait »');
  SIM.tick(st, t0 + 6000);
  assert.ok(titles(st).includes('Guardian vous propose un forfait plus rapide'));
  assert.match(st.messages.at(-1).text, /200 Mb\/s/);
});

test('quartier saturé : débit réduit pendant trois minutes, puis message de retour', () => {
  const now = Date.now(), st = fresh();
  SIM.start(st, 'sature', now);
  assert.equal(J.snapshot(st).metrics.capacity, 30);
  assert.match(st.notifications[0].body, /inutile de la redémarrer/);
  SIM.tick(st, now + SIM.BUSY_MS);
  assert.equal(st.notifications[0].title, 'Le réseau du quartier est redevenu fluide');
});

test('panne : le technicien avance seul jusqu’à la ligne vérifiée', () => {
  const t0 = Date.now(), st = fresh();
  SIM.start(st, 'panne', t0);
  assert.equal(J.snapshot(st).metrics.state, 'panne');
  assert.equal(SIM.status(st, t0).panne.status, 'confirmed');
  SIM.tick(st, t0 + 12000);
  assert.equal(SIM.status(st, t0).panne.status, 'en_route');
  assert.equal(SIM.status(st, t0).panne.technician, 'Koffi');
  SIM.tick(st, t0 + 60000);
  const i = st.incidents.find(x => x.sim);
  assert.equal(i.status, 'resolved'); assert.ok(i.verification.online);
  assert.equal(J.snapshot(st).metrics.state, 'stable');
  assert.ok(titles(st).includes('Internet est revenu : ligne vérifiée'));
});

test('coupure voisine : « baisse de débit possible », sans couper le client', () => {
  const now = Date.now(), st = fresh();
  SIM.start(st, 'voisin', now);
  assert.equal(st.notifications[0].title, 'Attention : baisse de débit possible');
  assert.match(st.notifications[0].body, /Yopougon Sideci/);
  assert.equal(J.snapshot(st).metrics.state, 'stable');
});

test('relancer ou « Tout remettre comme avant » efface la scène précédente', () => {
  const now = Date.now(), st = fresh();
  SIM.start(st, 'panne', now); SIM.start(st, 'foule', now);
  assert.equal(st.incidents.filter(i => i.sim).length, 0);
  SIM.clear(st);
  assert.equal(st.devices.filter(d => d.sim).length, 0);
  assert.deepEqual(st.simQueue, []);
  assert.throws(() => SIM.start(st, 'inconnue', now), /Simulation inconnue/);
});

test('API : seule la Régie (administrateur) lance une scène, chez le client choisi ; le client reçoit les suites', async () => {
  const store = new Store(':memory:'), server = createGuardianServer({store, env: {}, onError: () => {}});
  const saved = process.env[DEMO.admin.env]; process.env[DEMO.admin.env] = 'direction-test-2026';
  try { await seedDemo(store); } finally { if (saved === undefined) delete process.env[DEMO.admin.env]; else process.env[DEMO.admin.env] = saved; }
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const login = async (email, password) => { const r = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password})}); return {cookie: r.headers.getSetCookie().map(v => v.split(';')[0]).join('; '), csrf: (await r.json()).user?.csrf}; };
    const call = async (who, p, body) => { const x = await fetch(base + '/api' + p, {method: body ? 'POST' : 'GET', headers: {Cookie: who.cookie, ...(body ? {'Content-Type': 'application/json', 'X-CSRF-Token': who.csrf} : {})}, body: body ? JSON.stringify(body) : undefined}); return {status: x.status, data: await x.json()}; };
    const awa = await login(DEMO.client.email, DEMO.client.fallback), chef = await login(DEMO.admin.email, 'direction-test-2026');
    const uid = store.get('SELECT id FROM users WHERE email=?', DEMO.client.email).id;
    // Le client ne peut ni lancer ni voir les simulations : c'est l'équipe Moov qui les fait vivre.
    assert.equal((await call(awa, '/regie/simulation', {scene: 'panne', client: uid})).status, 403);
    assert.equal((await call(awa, '/regie/simulation')).status, 403);
    assert.equal((await call(awa, '/journey/simulation', {scene: 'panne'})).status, 404, 'plus de lancement côté client');
    const list = await call(chef, '/regie/simulation');
    assert.equal(list.status, 200);
    assert.equal(list.data.client, uid, 'Awa, cliente de démonstration, choisie par défaut');
    assert.ok(list.data.clients.length > 1, 'un client par quartier au choix');
    const chefId = store.get('SELECT id FROM users WHERE email=?', DEMO.admin.email).id;
    assert.ok(!list.data.clients.some(c => c.id === chefId), 'pas de compte de l’équipe Moov dans la liste');
    assert.equal((await call(chef, '/regie/simulation', {scene: 'panne', client: chefId})).status, 404);
    const run = await call(chef, '/regie/simulation', {scene: 'urgent', client: uid});
    assert.equal(run.status, 200);
    assert.equal(run.data.status.scene, 'urgent');
    assert.ok(run.data.status.urgent.left > 50);
    await call(awa, '/journey/start', {});
    const before = await call(awa, '/journey/state');
    assert.equal(before.data.state.notifications[0].title, 'Urgent : appareil inconnu sur votre Wi-Fi', 'le téléphone du client reçoit l’alerte');
    const st = J.get(store, uid); st.simQueue[0].at = Date.now() - 1; J.put(store, uid, st); // la minute est passée
    const read = await call(awa, '/journey/state');
    assert.equal(read.data.state.version, before.data.state.version, 'la version ne change pas : aucune action du client refusée');
    assert.deepEqual(read.data.state.simulation.blocked.map(d => d.id), ['sim-urgent']);
    assert.equal((await call(chef, '/regie/simulation', {scene: 'stop', client: uid})).data.status.scene, null);
    assert.equal((await call(chef, '/regie/simulation', {scene: 'nimporte', client: uid})).status, 400);
  } finally { server.close(); }
});

test('relecture jury : pas de devis ni de 2e panne pendant une panne, pas de retour en arrière', () => {
  const now = Date.now(), st = fresh();
  J.openIncident(st, now, {zone: st.zone, description: 'Vraie panne', lat: 5.3, lon: -4, kind: 'fibre'});
  assert.throws(() => SIM.start(st, 'panne', now), /déjà en cours/);
  SIM.start(st, 'conso', now);
  assert.ok(!st.upgrade, 'un forfait plus rapide ne réglerait pas la panne');
  const b = fresh(); SIM.start(b, 'conso', now, {fault: {id: 'zone'}});
  assert.ok(!b.upgrade, 'panne de zone de l’équipe Moov : pas de devis non plus');
  const c = fresh(); c.declinedUntil = now + 86400000; SIM.start(c, 'conso', now);
  assert.ok(c.upgrade, 'un refus d’offre ne bloque pas la simulation');
  const d = fresh(); SIM.start(d, 'panne', now);
  const i = d.incidents.find(x => x.sim); i.status = 'on_site';
  SIM.tick(d, now + 13000);
  assert.equal(i.status, 'on_site', 'l’étape « en route » programmée ne réécrit pas « sur place »');
});

test('relecture jury : « C’est à moi » après le blocage automatique débloque ; un état de box choisi arrête la scène', () => {
  const store = new Store(':memory:');
  return seedDemo(store).then(() => {
    const uid = store.get('SELECT id FROM users WHERE email=?', DEMO.client.email).id;
    const t0 = Date.now() - SIM.URGENT_MS - 1000; let st = J.seed(); J.put(store, uid, st);
    st = J.get(store, uid); SIM.start(st, 'urgent', t0); J.put(store, uid, st);
    SIM.sweep(store); // même application fermée, le serveur applique la suite
    st = J.get(store, uid);
    assert.equal(st.devices.find(x => x.id === 'sim-urgent').blocked, true);
    J.act(store, uid, {type: 'device', id: 'sim-urgent', action: 'recognize', version: st.version});
    st = J.get(store, uid);
    assert.equal(st.devices.find(x => x.id === 'sim-urgent').blocked, false);
    SIM.start(st, 'foule', Date.now()); J.put(store, uid, st);
    J.act(store, uid, {type: 'scenario', value: 'slow', version: st.version});
    st = J.get(store, uid);
    assert.deepEqual(st.simQueue, []); assert.equal(st.simScene, null); assert.equal(st.scenario, 'slow');
  });
});

test('box éteinte : pas une panne Moov, pas de redémarrage à distance, retour au bout de 90 s', () => {
  const now = Date.now(), st = fresh();
  SIM.start(st, 'box', now);
  const m = J.snapshot(st).metrics;
  assert.equal(m.capacity, 0); assert.equal(m.latency, null); assert.equal(m.state, 'éteinte');
  assert.match(st.notifications[0].body, /ce n’est pas une panne Moov/);
  assert.ok(SIM.status(st, now).box.left > 80);
  SIM.tick(st, now + 90000);
  assert.equal(st.simBoxOff, null);
  assert.equal(st.notifications[0].title, 'Votre box est revenue');
  assert.equal(J.snapshot(st).metrics.state, 'stable');
  const busy = fresh(); J.openIncident(busy, now, {zone: busy.zone, description: 'Vraie panne', lat: 5.3, lon: -4, kind: 'fibre'});
  assert.throws(() => SIM.start(busy, 'box', now), /déjà en cours/);
});

test('facture : rappel de la vraie facture du mois, puis paiement en plusieurs fois ; rien si elle est payée', async () => {
  const store = new Store(':memory:'); await seedDemo(store);
  const uid = store.get('SELECT id FROM users WHERE email=?', DEMO.client.email).id, now = Date.now();
  if (!J.get(store, uid)) J.put(store, uid, J.seed());
  const F = require('./fidelite.cjs'), bill = F.state(store, uid, now).bill;
  if (bill.paid) store.run('UPDATE fidelite_factures SET paid_at=NULL WHERE user_id=? AND month=?', uid, bill.month);
  const snap = SIM.run(store, uid, {scene: 'facture'}, now);
  assert.match(snap.notifications[0].title, /Votre facture de .+ est à payer/);
  assert.equal(snap.notifications[0].page, 'fidelite');
  SIM.refresh(store, uid, now + 20000);
  const st = J.get(store, uid);
  assert.equal(st.notifications[0].title, 'Besoin d’un peu de temps ?');
  assert.equal(st.notifications[0].page, 'acces');
  F.pay(store, uid, {confirm: true, month: bill.month}, now);
  assert.throws(() => SIM.run(store, uid, {scene: 'facture'}, now), /déjà payée/);
});

test('câble volé : poteau, Yao, mêmes étapes que la panne ; refusé pendant une vraie panne', () => {
  const now = Date.now(), st = fresh();
  SIM.start(st, 'vol', now);
  const i = st.incidents.find(x => x.sim);
  assert.equal(i.kind, 'pole'); assert.equal(i.electrical, true);
  assert.match(st.messages.at(-1).text, /photo du poteau/);
  SIM.tick(st, now + 60000);
  assert.equal(i.technician.name, 'Yao'); assert.equal(i.status, 'resolved');
  assert.match(st.messages.at(-1).text, /remplacé le câble volé/);
  const busy = fresh(); J.openIncident(busy, now, {zone: busy.zone, description: 'Vraie panne', lat: 5.3, lon: -4, kind: 'fibre'});
  assert.throws(() => SIM.start(busy, 'vol', now), /déjà en cours/);
});

test('Wi-Fi faible dans une chambre : la fibre va bien, conseil de placement', () => {
  const now = Date.now(), st = fresh();
  SIM.start(st, 'chambre', now);
  assert.equal(J.snapshot(st).metrics.state, 'stable');
  assert.equal(st.notifications[0].page, 'devices');
  assert.match(st.messages.at(-1).text, /répéteur/);
  SIM.clear(st);
  assert.ok(!st.devices.some(d => d.id === 'sim-chambre'));
});
