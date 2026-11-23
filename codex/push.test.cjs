'use strict';
// Alertes sur le téléphone, application fermée (Web Push) : message chiffré que seul le téléphone lit, expéditeur signé,
// bonnes personnes, une seule fois, aucune adresse inventée appelée par le serveur.
const {test} = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const W = require('./webpush.cjs'), PU = require('./push.cjs'), F = require('./sim-flow.js'), N = require('./noc-store.cjs'), O = require('./operator-store.cjs'), J = require('./journey-store.cjs');
const {createGuardianServer} = require('./pilot-server.cjs');

// Un faux téléphone : sa clé, son secret, et le déchiffrement côté téléphone (RFC 8291), écrit indépendamment.
function phone(endpoint) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = {endpoint, keys: {p256dh: W.b64u(ecdh.getPublicKey()), auth: W.b64u(auth)}};
  const read = body => {
    const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
    assert.equal(rs, 4096);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', ecdh.computeSecret(asPublic), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2, 'dernier bloc marqué');
    return JSON.parse(plain.subarray(0, plain.length - 1).toString());
  };
  return {sub, read};
}
function checkVapid(header, keys, endpoint) {
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header); assert.ok(m, 'en-tête VAPID');
  assert.equal(m[4], keys.publicKey);
  const pub = W.unb64u(keys.publicKey), jwk = {kty: 'EC', crv: 'P-256', x: W.b64u(pub.subarray(1, 33)), y: W.b64u(pub.subarray(33))};
  assert.ok(crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), {key: crypto.createPublicKey({key: jwk, format: 'jwk'}), dsaEncoding: 'ieee-p1363'}, W.unb64u(m[3])), 'signature valide');
  const claims = JSON.parse(W.unb64u(m[2]).toString());
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, 'valable moins de 24 h');
  return claims;
}

test('Chiffrement : seul le téléphone peut lire le message, et l’expéditeur est signé', () => {
  const p = phone('https://fcm.googleapis.com/fcm/send/abc'), keys = W.vapidKeys('un-long-secret-de-test-pour-render');
  const body = W.encrypt(p.sub, JSON.stringify({title: 'Panne', body: 'Câble coupé à Niangon.'}));
  assert.deepEqual(p.read(body), {title: 'Panne', body: 'Câble coupé à Niangon.'});
  assert.notDeepEqual(W.encrypt(p.sub, 'x'), W.encrypt(p.sub, 'x'), 'chaque envoi a son propre sel');
  const claims = checkVapid(W.vapidHeader(p.sub.endpoint, keys, 'https://fibre-guardian-moov.onrender.com'), keys, p.sub.endpoint);
  assert.equal(claims.sub, 'https://fibre-guardian-moov.onrender.com');
  assert.throws(() => W.encrypt({keys: {p256dh: 'abc', auth: 'x'}}, 'x'), /invalide/);
});

test('Clé de l’expéditeur : la même à chaque démarrage avec VAPID_PRIVATE_KEY (texte ou vraie clé), temporaire sans', () => {
  const a = W.vapidKeys('texte-genere-par-render-123456'), b = W.vapidKeys('texte-genere-par-render-123456');
  assert.equal(a.publicKey, b.publicKey); assert.equal(a.generated, false);
  assert.equal(W.unb64u(a.publicKey).length, 65);
  const real = crypto.createECDH('prime256v1'); real.generateKeys();
  const k = W.vapidKeys(W.b64u(real.getPrivateKey()));
  assert.equal(k.publicKey, W.b64u(real.getPublicKey()), 'une vraie clé VAPID est prise telle quelle');
  const t1 = W.vapidKeys(''), t2 = W.vapidKeys(undefined);
  assert.ok(t1.generated && t2.generated && t1.publicKey !== t2.publicKey);
  assert.equal(PU.config({VAPID_PRIVATE_KEY: 'x'.repeat(20)}).subject, 'mailto:guardian@fibre-guardian.ci');
  assert.equal(PU.config({VAPID_PRIVATE_KEY: 'x'.repeat(20), GUARDIAN_ORIGIN: 'https://fibre-guardian-moov.onrender.com/'}).subject, 'https://fibre-guardian-moov.onrender.com');
});

test('Le serveur n’écrit qu’aux services de notification des téléphones', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/QAB', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.ok(W.endpointOk(ok), ok);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/x', 'https://user:pw@web.push.apple.com/x', 'https://web.push.apple.com:8443/x', 'javascript:alert(1)']) assert.ok(!W.endpointOk(bad), bad);
});

async function setup() {
  const calls = [], phones = new Map();
  let status = 201;
  const pushFetch = async (url, init) => { calls.push({url, init, message: phones.get(url)?.read(init.body)}); return {status}; };
  const server = createGuardianServer({db: ':memory:', env: {VAPID_PRIVATE_KEY: 'secret-de-test-pour-les-alertes'}, onError: () => {}, pushFetch, pushHosts: [/^push\.example\.test$/]}), s = server.guardianStore;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const account = async (email, extra) => {
    const {user} = await s.register({email, password: 'mot-de-passe-1234', name: email.split('@')[0]}); extra?.(user);
    const r = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'mot-de-passe-1234'})});
    const data = await r.json();
    return {id: user.id, cookie: r.headers.getSetCookie().map(v => v.split(';')[0]).join('; '), csrf: data.user.csrf};
  };
  const call = async (who, p, method = 'GET', body) => {
    const r = await fetch(base + '/api' + p, {method, headers: {Cookie: who.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': who.csrf}, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: r.status, data: await r.json()};
  };
  const device = async (who, name) => { const p = phone('https://push.example.test/' + name); phones.set(p.sub.endpoint, p); assert.equal((await call(who, '/push', 'POST', p.sub)).status, 200); return p; };
  return {server, s, calls, account, call, device, setStatus: v => { status = v; }, close: () => server.close()};
}
const settle = () => new Promise(r => setTimeout(r, 30));

test('Abonnement : chacun inscrit son téléphone, jamais une adresse inventée, 5 téléphones au plus', async () => {
  const t = await setup();
  try {
    const awa = await t.account('awa@example.test');
    const v = await t.call(awa, '/push');
    assert.equal(v.status, 200); assert.equal(W.unb64u(v.data.publicKey).length, 65); assert.equal(v.data.devices, 0);
    const p = phone('https://127.0.0.1/interne');
    assert.equal((await t.call(awa, '/push', 'POST', p.sub)).status, 400, 'adresse interne refusée');
    assert.equal((await t.call(awa, '/push', 'POST', {endpoint: 'https://push.example.test/x', keys: {p256dh: 'a'.repeat(87), auth: 'b'.repeat(22)}})).status, 400, 'clé du téléphone invalide');
    for (let n = 0; n < 7; n++) await t.device(awa, 'awa-' + n);
    assert.equal((await t.call(awa, '/push')).data.devices, 5);
    const r = await fetch('http://127.0.0.1:' + t.server.address().port + '/api/push');
    assert.equal(r.status, 401, 'connexion requise');
    const last = 'https://push.example.test/awa-6';
    assert.equal((await t.call(awa, '/push', 'DELETE', {endpoint: last})).data.devices, 4);
    // Le message d'essai part tout de suite au téléphone de la personne, et à lui seul.
    const koffi = await t.account('koffi@example.test'); await t.device(koffi, 'koffi');
    t.calls.length = 0;
    assert.equal((await t.call(koffi, '/push/essai', 'POST', {})).data.sent, 1);
    assert.equal(t.calls.length, 1); assert.equal(t.calls[0].url, 'https://push.example.test/koffi');
    assert.equal(t.calls[0].message.title, 'Alertes activées');
    assert.equal(t.calls[0].init.headers['Content-Encoding'], 'aes128gcm');
    checkVapid(t.calls[0].init.headers.Authorization, PU._state().keys, t.calls[0].url);
    // Téléphone désabonné (410) : il est oublié.
    t.setStatus(410); await t.call(koffi, '/push/essai', 'POST', {});
    assert.equal((await t.call(koffi, '/push')).data.devices, 0);
  } finally { t.close(); }
});

test('Panne du quartier : la cliente, l’équipe Moov et le technicien de la mission sont prévenus une seule fois, pas le quartier voisin', async () => {
  const t = await setup();
  try {
    const chef = await t.account('chef@example.test', u => O.grant(t.s, 'chef@example.test', 'admin'));
    const rose = await t.account('rose@example.test', u => N.join(t.s, u.id, {segment: 'BAS-01', consent: true}));
    const abo = await t.account('abo@example.test', u => N.join(t.s, u.id, {segment: 'ABO-01', consent: true}));
    const amina = await t.account('amina@example.test');
    assert.equal((await t.call(chef, '/noc/workspace/action', 'POST', {type: 'field-account', email: 'amina@example.test', technicianId: 'amina', enabled: true, confirm: true})).status, 200);
    for (const [who, n] of [[chef, 'chef'], [rose, 'rose'], [abo, 'abo'], [amina, 'amina']]) await t.device(who, n);
    t.calls.length = 0;
    N.operate(t.s, chef.id, {type: 'simulate', segment: 'BAS-01', scenario: 'fiber'});
    assert.equal(await PU.tick(t.s, Date.now() + 1000), 0, 'rien pendant que les agents analysent');
    const now = Date.now() + F.THINK + 500;
    await PU.tick(t.s, now);
    const got = to => t.calls.filter(c => c.url.endsWith('/' + to));
    assert.equal(got('rose').length, 1); assert.match(got('rose')[0].message.body, /câble de fibre est coupé/i);
    assert.equal(got('rose')[0].message.title, 'Fibre Guardian');
    assert.equal(got('chef').length, 1); assert.match(got('chef')[0].message.body, /validation est attendue/);
    assert.equal(got('chef')[0].message.url, './?portal=moov&section=operations');
    assert.equal(got('abo').length, 0, 'Abobo n’est pas concerné');
    assert.equal(got('amina').length, 0, 'pas encore de technicien affecté');
    t.calls.length = 0;
    assert.equal(await PU.tick(t.s, now + 1000), 0, 'jamais deux fois');
    const i = N.overview(t.s, chef.id).incidents.find(x => x.segment_id === 'BAS-01' && !x.terminal);
    N.operate(t.s, chef.id, {id: i.id, version: i.version, type: 'approve', note: 'ok'});
    const j = N.overview(t.s, chef.id).incidents.find(x => x.id === i.id);
    N.operate(t.s, chef.id, {id: j.id, version: j.version, type: 'dispatch', technician: 'amina', safety: true});
    await PU.tick(t.s, Date.now() + 500);
    assert.ok(got('amina').some(c => /Mission confirmée/.test(c.message.body)), 'Amina reçoit sa mission');
    assert.equal(got('amina')[0].message.title, 'Fibre Guardian · Votre mission');
  } finally { t.close(); }
});

test('« Mes messages » du client partent aussi sur son téléphone, une fois, sans les voisins de la démonstration', async () => {
  const t = await setup();
  try {
    const awa = await t.account('awa@example.test');
    const st = J.seed(); J.put(t.s, awa.id, st);
    await t.device(awa, 'awa'); t.calls.length = 0;
    const s2 = J.get(t.s, awa.id), now = Date.now();
    s2.notifications.unshift({key: 'k1', home: 'home-1', at: now, title: 'Nouvel appareil sur votre Wi-Fi', body: 'Un iPhone vient de se connecter.', read: false, page: 'devices'},
      {key: 'k2', home: 'home-3', at: now, title: 'Voisin', body: 'pour un autre foyer', read: false});
    J.put(t.s, awa.id, s2); await settle();
    assert.equal(t.calls.length, 1);
    assert.deepEqual(t.calls[0].message, {title: 'Nouvel appareil sur votre Wi-Fi', body: 'Un iPhone vient de se connecter.', tag: 'k1', url: './?section=devices'});
    J.put(t.s, awa.id, J.get(t.s, awa.id)); await settle();
    assert.equal(t.calls.length, 1, 'déjà envoyé');
    // Un vieux message (avant l'abonnement, ou de plus de 2 minutes) ne part pas.
    const s3 = J.get(t.s, awa.id); s3.notifications.unshift({key: 'old', home: 'home-1', at: now - 10 * 60000, title: 'Ancien', body: '', read: false}); s3.pushMark = 0;
    J.put(t.s, awa.id, s3); await settle();
    assert.equal(t.calls.length, 1);
  } finally { t.close(); }
});
