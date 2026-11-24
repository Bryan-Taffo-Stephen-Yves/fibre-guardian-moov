'use strict';
// Messages du client rangés par service (Dossier de ma fibre, Appareils, Guardian) : comptage des non lus,
// « marquer comme lu » service par service, et chiffre sur l'icône de l'application (sw.js).
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const S = require('./notif-services.js'), J = require('./journey-store.cjs');
const {createGuardianServer} = require('./pilot-server.cjs');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

test('service() : dossier pour Fibre Welcome, appareils pour le Wi-Fi, guardian pour le reste', () => {
  assert.equal(S.service({page: 'bienvenue'}), 'dossier');
  assert.equal(S.service({page: 'devices'}), 'appareils');
  assert.equal(S.service({kind: 'wifi'}), 'appareils');
  assert.equal(S.service({kind: 'wifi', page: 'devices'}), 'appareils');
  assert.equal(S.service({page: 'tracking'}), 'guardian');
  assert.equal(S.service({title: 'Redémarrage de votre box'}), 'guardian');
  assert.equal(S.service(null), 'guardian');
  assert.deepEqual(S.SERVICES, ['dossier', 'appareils', 'guardian']);
});

test('counts() : non lus de ce foyer seulement, par service', () => {
  const list = [
    {home: 'home-1', page: 'bienvenue', read: false}, {home: 'home-1', page: 'bienvenue', read: true},
    {home: 'home-1', kind: 'wifi', page: 'devices', read: false}, {home: 'home-1', page: 'devices', read: false},
    {home: 'home-1', read: false}, {home: 'home-3', read: false}, {home: 'home-3', page: 'bienvenue', read: false}, null];
  assert.deepEqual(S.counts(list, 'home-1'), {dossier: 1, appareils: 2, guardian: 1});
  assert.deepEqual(S.counts(list, 'home-3'), {dossier: 1, appareils: 0, guardian: 1});
  assert.deepEqual(S.counts(undefined, 'home-1'), {dossier: 0, appareils: 0, guardian: 0});
});

test('Le module se charge dans le navigateur avant journey.js et reste disponible hors ligne', () => {
  const ctx = {window: {}};
  vm.runInNewContext(read('notif-services.js'), ctx);
  assert.equal(ctx.window.FGNotifServices.service({page: 'bienvenue'}), 'dossier');
  const boot = read('bootstrap.js');
  assert.ok(boot.indexOf("'notif-services.js'") > 0 && boot.indexOf("'notif-services.js'") < boot.indexOf("'journey.js'"));
  assert.match(read('sw.js'), /'\.\/notif-services\.js'/);
});

test('« Marquer comme lu » par service : seuls les messages de ce service et de ce foyer passent à lus', async () => {
  const server = createGuardianServer({db: ':memory:', onError: () => {}}), s = server.guardianStore;
  try {
    const {user} = await s.register({email: 'awa@example.test', password: 'mot-de-passe-1234', name: 'Awa'});
    const st = J.seed(), now = Date.now();
    st.notifications = [
      {key: 'd1', home: 'home-1', at: now, title: 'Dossier', body: '', page: 'bienvenue', read: false},
      {key: 'a1', home: 'home-1', at: now, title: 'Wi-Fi', body: '', kind: 'wifi', page: 'devices', read: false},
      {key: 'g1', home: 'home-1', at: now, title: 'Box', body: '', read: false},
      {key: 'd3', home: 'home-3', at: now, title: 'Voisin', body: '', page: 'bienvenue', read: false}];
    J.put(s, user.id, st);
    const state = () => Object.fromEntries(J.get(s, user.id).notifications.map(n => [n.key, n.read]));
    // Marquer comme lu ne dépend pas de la version et n'en crée pas : une autre action du client lancée en même temps n’échoue pas.
    const v0 = J.get(s, user.id).version;
    J.act(s, user.id, {type: 'read', home: 'home-1', service: 'dossier', version: v0 - 5});
    assert.equal(J.get(s, user.id).version, v0);
    assert.deepEqual(state(), {d1: true, a1: false, g1: false, d3: false});
    J.act(s, user.id, {type: 'read', home: 'home-1', service: 'appareils', version: J.get(s, user.id).version});
    assert.deepEqual(state(), {d1: true, a1: true, g1: false, d3: false});
    for (const bad of ['tout', 'Dossier', 1, true, {}]) {
      assert.throws(() => J.act(s, user.id, {type: 'read', home: 'home-1', service: bad, version: J.get(s, user.id).version}), /Service inconnu/);
    }
    assert.deepEqual(state(), {d1: true, a1: true, g1: false, d3: false}, 'valeur refusée : rien ne change');
    // Sans service : comme avant, tout le foyer.
    J.act(s, user.id, {type: 'read', home: 'home-1', version: J.get(s, user.id).version});
    assert.deepEqual(state(), {d1: true, a1: true, g1: true, d3: false});
  } finally { server.close(); }
});

// Le service worker, joué hors navigateur : l'alerte s'affiche toujours, le chiffre suit le message.
function worker(nav) {
  const handlers = {}, shown = [];
  const self = {addEventListener: (k, f) => { handlers[k] = f; }, navigator: nav, location: {href: 'https://x.test/codex/sw.js'},
    registration: {showNotification: (t, o) => { shown.push({t, o}); return Promise.resolve(); }}};
  vm.runInNewContext(read('sw.js'), {self, caches: {}, URL, Response: {}, Promise, Number, String});
  const push = async m => { let wait; handlers.push({data: {json: () => m, text: () => ''}, waitUntil: p => { wait = p; }}); await wait; };
  return {push, shown};
}
test('sw.js : chiffre sur l’icône (setAppBadge, effacé à 0), sans jamais empêcher l’alerte', async () => {
  const calls = [], nav = {setAppBadge: n => { calls.push(['set', n]); return Promise.resolve(); }, clearAppBadge: () => { calls.push(['clear']); return Promise.resolve(); }};
  const w = worker(nav);
  await w.push({title: 'A', body: 'b', badge: 3});
  await w.push({title: 'B', body: 'b', badge: 0});
  await w.push({title: 'C', body: 'b', badge: -1});
  await w.push({title: 'D', body: 'b', badge: 2.5});
  await w.push({title: 'E', body: 'b'});
  assert.deepEqual(calls, [['set', 3], ['clear']]);
  assert.equal(w.shown.length, 5);
  // Badging API absente ou en échec : l'alerte s'affiche quand même.
  const none = worker({});
  await none.push({title: 'F', badge: 4}); assert.equal(none.shown.length, 1);
  const broken = worker({setAppBadge: () => Promise.reject(new Error('refusé'))});
  await broken.push({title: 'G', badge: 4}); assert.equal(broken.shown.length, 1);
  const throwing = worker({setAppBadge: () => { throw new Error('refusé'); }});
  await throwing.push({title: 'H', badge: 4}); assert.equal(throwing.shown.length, 1);
});
