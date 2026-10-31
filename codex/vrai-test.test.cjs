'use strict';
// Vrai test de connexion : lien personnel de 30 minutes, mesure faite par l'appareil du client, résultat dans
// la conversation Guardian et sur WhatsApp. Photo de box envoyée sur WhatsApp : lue comme dans l'application.
const {test, afterEach} = require('node:test'), assert = require('node:assert/strict');
const VT = require('./vrai-test.cjs'), WB = require('./whatsapp-bot.cjs'), N = require('./noc-store.cjs'), journey = require('./journey-store.cjs'), ai = require('./guardian-ai.cjs');
const {createGuardianServer} = require('./pilot-server.cjs');

const AWA = '2250701020304', SECRET = 'secret-green-api-de-test-1234';
const ENV = {GREENAPI_ID_INSTANCE: '7103000001', GREENAPI_API_TOKEN: 'jeton-instance-de-test', GREENAPI_WEBHOOK_TOKEN: SECRET, WHATSAPP_CLIENTS: AWA + '=awa@example.test', GUARDIAN_ORIGIN: 'https://guardian.example.test'};
const KEY = 'sk-ant-test-0000000000000000000000';
afterEach(() => { ai.setTransport(null); delete process.env.ANTHROPIC_API_KEY; });

async function setup(env = {}) {
  const server = createGuardianServer({db: ':memory:', env, onError: () => {}}), s = server.guardianStore;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const res = await fetch(base + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: 'awa@example.test', password: 'awa-password-1234', name: 'Awa Koné'})});
  const {user} = await res.json(), cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  N.join(s, user.id, {segment: 'YOP-07', consent: true});
  const app = async (p, body) => { const r = await fetch(base + '/api' + p, {method: body ? 'POST' : 'GET', headers: {Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': user.csrf}, body: body ? JSON.stringify(body) : undefined}); return {status: r.status, data: await r.json()}; };
  const page = async (p, token, body) => fetch(base + '/api/test/' + p, {method: body ? 'POST' : 'GET', headers: {'X-Test-Token': token, ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
  return {server, s, base, user, app, page, close: () => server.close()};
}

test('Verdict : des règles simples, des chiffres réels, et l’honnêteté sur ce qui est mesuré', () => {
  const v = m => VT.verdict(VT.clean(m));
  assert.equal(v({downloadMbps: 85, latencyMs: 210, lossPct: 0, network: 'wifi'}).level, 'bonne');
  assert.equal(v({downloadMbps: 3.2, latencyMs: 300, lossPct: 0}).level, 'lente');
  assert.equal(v({downloadMbps: 40, latencyMs: 1200, lossPct: 0}).level, 'lente', 'un temps de réponse très long rend la connexion lente');
  assert.equal(v({downloadMbps: 0.4, latencyMs: 400, lossPct: 0}).level, 'tres-lente');
  assert.equal(v({downloadMbps: 20, latencyMs: 300, lossPct: 60}).level, 'instable');
  assert.equal(v({downloadMbps: null, latencyMs: null, lossPct: 100}).level, 'coupe');
  const good = v({downloadMbps: 85.4, latencyMs: 210, lossPct: 0, network: 'hotspot'});
  assert.match(good.text, /85 Mbps/); assert.match(good.text, /partage de connexion/, 'le client sait que le test n’est pas passé par la box');
  assert.ok(good.facts.some(f => f.label === 'Débit mesuré' && f.value === '85 Mbps'));
  assert.ok(good.facts.some(f => f.label === 'Où' && /serveur de Guardian/.test(f.value)), 'Guardian dit où le test a été fait');
  assert.deepEqual(VT.clean({downloadMbps: -4, latencyMs: 'x', lossPct: 400, network: 'satellite'}), {downloadMbps: null, uploadMbps: null, latencyMs: null, jitterMs: null, lossPct: 100, network: null}, 'valeurs absurdes écartées');
  assert.match(VT.verdict(VT.clean({downloadMbps: 50, latencyMs: 200}), {fault: {zone: 'Niangon'}}).text, /^Une panne est en cours/);
});

test('Depuis l’application : lien personnel, sondes, 2 Mo réels, résultat dans la conversation Guardian', async () => {
  const t = await setup();
  try {
    assert.equal((await t.app('/test/link', {})).status, 200);
    const {data: l} = await t.app('/test/link', {});
    assert.match(l.url, /\/codex\/test\.html#[A-Za-z0-9_-]{24}$/); const token = l.url.split('#')[1];
    assert.ok(!t.s.get('SELECT 1 AS x FROM speed_links WHERE token_hash=?', token), 'le jeton n’est jamais gardé en clair');
    const info = await (await t.page('info', token)).json();
    assert.equal(info.name, 'Awa'); assert.equal(info.whatsapp, false); assert.equal(info.plan, 100);
    assert.equal((await t.page('ping', token)).status, 200);
    const dl = await t.page('download', token), bytes = (await dl.arrayBuffer()).byteLength;
    assert.equal(dl.headers.get('content-type'), 'application/octet-stream'); assert.equal(bytes, 2 * 1024 * 1024, 'un vrai transfert de 2 Mo');
    const r = await t.page('result', token, {metrics: {downloadMbps: 64.2, latencyMs: 180, jitterMs: 12, lossPct: 0, network: 'wifi'}});
    const d = await r.json();
    assert.equal(r.status, 200); assert.equal(d.level, 'bonne'); assert.equal(d.whatsapp, false);
    const st = journey.get(t.s, t.user.id), said = st.messages.at(-1);
    assert.equal(st.messages.at(-2).text, 'J’ai testé ma connexion.'); assert.equal(said.verdict, 'test-bonne'); assert.match(said.text, /64 Mbps/);
    assert.ok(said.facts.some(f => f.label === 'Votre forfait' && f.value === '100 Mbps'));
  } finally { t.close(); }
});

test('Le lien protège : sans jeton, faux jeton, lien expiré ou trop de tests → refusé', async () => {
  const t = await setup();
  try {
    for (const bad of ['', 'abc', 'x'.repeat(24)]) assert.equal((await t.page('ping', bad)).status, 404);
    assert.equal((await fetch(t.base + '/api/test/link', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 401, 'créer un lien demande d’être connecté');
    const old = VT.link(t.s, t.user.id); t.s.run('UPDATE speed_links SET expires=?', Date.now() - 1);
    assert.equal((await t.page('info', old.token)).status, 404, 'lien expiré');
    const l = VT.link(t.s, t.user.id), m = {metrics: {downloadMbps: 10, latencyMs: 200, lossPct: 0}};
    for (let i = 0; i < VT.MAX_TESTS; i++) assert.equal((await t.page('result', l.token, m)).status, 200);
    assert.equal((await t.page('result', l.token, m)).status, 429, 'pas plus de ' + VT.MAX_TESTS + ' tests par lien');
  } finally { t.close(); }
});

// WhatsApp : faux Green API qui garde chaque message envoyé.
async function whatsapp() {
  const t = await setup(ENV), sent = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(t.base)) return real(url, init);
    if (String(url).startsWith('https://media.example.test/')) return {ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('photo de box').buffer};
    if (String(url).startsWith('https://api.anthropic.com/')) return real(url, init);
    const d = JSON.parse(init.body);
    sent.push({method: String(url).split('/')[4], message: d.message ?? d.header + '\n\n' + d.body, labels: (d.buttons || []).map(b => b.buttonText)});
    return {ok: true, status: 200, json: async () => ({idMessage: 'OUT'})};
  };
  const post = d => real(t.base + '/api/whatsapp/entrant', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + SECRET}, body: JSON.stringify(d)});
  const msg = data => ({typeWebhook: 'incomingMessageReceived', idMessage: 'MSG' + Math.random().toString(36).slice(2), timestamp: Math.floor(Date.now() / 1000), senderData: {chatId: AWA + '@c.us'}, messageData: data});
  const until = async n => { for (let i = 0; i < 100 && sent.length < n; i++) await new Promise(r => setTimeout(r, 30)); };
  return {...t, sent, post, msg, until, close: () => { globalThis.fetch = real; t.close(); }};
}

test('Sur WhatsApp : « Tester ma connexion » donne le lien, et le résultat revient sur WhatsApp avec les bons boutons', async () => {
  const t = await whatsapp();
  try {
    await t.post(t.msg({typeMessage: 'buttonsResponseMessage', buttonsResponseMessage: {selectedButtonId: 'test'}})); await t.until(1);
    const link = /https:\/\/guardian\.example\.test\/codex\/test\.html#([A-Za-z0-9_-]+)/.exec(t.sent[0].message);
    assert.ok(link, 'le lien complet part sur WhatsApp'); assert.match(t.sent[0].message, /Wi-Fi de votre box/);
    const info = await (await t.page('info', link[1])).json(); assert.equal(info.whatsapp, true);
    const d = await (await t.page('result', link[1], {metrics: {downloadMbps: 2.1, latencyMs: 450, lossPct: 0, network: 'wifi'}})).json();
    assert.equal(d.level, 'lente'); assert.equal(d.whatsapp, true); await t.until(2);
    assert.match(t.sent[1].message, /Résultat de votre test de connexion/); assert.match(t.sent[1].message, /Débit mesuré : 2,1 Mbps/);
    assert.deepEqual(t.sent[1].labels, ['Mon Wi-Fi capte mal', 'Redémarrer ma box', 'Parler à un conseiller']);
    await t.post(t.msg({typeMessage: 'textMessage', textMessageData: {textMessage: '3'}})); await t.until(3);
    assert.match(t.sent[2].message, /111|conseiller/, '« 3 » après le résultat : le conseiller');
    // Écrit en toutes lettres, ça marche aussi.
    await t.post(t.msg({typeMessage: 'textMessage', textMessageData: {textMessage: 'Je veux tester ma connexion'}})); await t.until(4);
    assert.match(t.sent[3].message, /test\.html#/);
  } finally { t.close(); }
});

test('Sur WhatsApp : une photo de la box est lue par Guardian ; s’il ne peut pas la lire, il le dit simplement', async () => {
  const t = await whatsapp(), photo = {typeMessage: 'imageMessage', fileMessageData: {downloadUrl: 'https://media.example.test/box.jpg', mimeType: 'image/jpeg'}};
  try {
    assert.deepEqual(WB.incoming(t.msg(photo)).image, {url: 'https://media.example.test/box.jpg', mime: 'image/jpeg'});
    await t.post(t.msg(photo)); await t.until(1);
    assert.match(t.sent[0].message, /Je n’arrive pas à lire cette photo/, 'sans lecteur de photo : message simple, sans erreur');
    process.env.ANTHROPIC_API_KEY = KEY; let seen = null;
    ai.setTransport(async (url, init) => { seen = JSON.parse(init.body).messages[0].content[0].source; return {ok: true, json: async () => ({stop_reason: 'end_turn', content: [{type: 'text', text: JSON.stringify({is_box: true, quality: 'bonne', model: 'Huawei HG8145', leds: [{name: 'power', state: 'allume', color: 'vert'}, {name: 'pon', state: 'allume', color: 'vert'}, {name: 'los', state: 'eteint', color: 'aucune'}]})}]})}; });
    await t.post(t.msg(photo)); await t.until(2);
    assert.equal(seen.media_type, 'image/jpeg'); assert.equal(Buffer.from(seen.data, 'base64').toString(), 'photo de box', 'la vraie photo est lue');
    assert.doesNotMatch(t.sent[1].message, /Je n’arrive pas/); assert.match(t.sent[1].message, /voyant|box|fibre/i);
    assert.equal(journey.get(t.s, t.user.id).messages.at(-2).photo, true, 'la photo entre dans la conversation, comme dans l’application');
    assert.deepEqual(t.sent[1].labels, ['Redémarrer ma box', 'Tester ma connexion', 'Parler à un conseiller']);
    await t.post(t.msg({typeMessage: 'buttonsResponseMessage', buttonsResponseMessage: {selectedButtonId: 'photo'}})); await t.until(3);
    assert.equal(t.sent[2].message, WB.HEAD + '\n\n' + WB.PHOTO_ASK);
  } finally { t.close(); }
});

test('Pannes simulées : on part des vraies mesures, on ne touche à rien, et Guardian dit ce qu’il ferait', async () => {
  const real = {downloadMbps: 40, uploadMbps: 12, latencyMs: 120, jitterMs: 10, lossPct: 0, network: 'hotspot'};
  const sat = VT.simulate(real, 'wifi-sature');
  assert.equal(sat.downloadMbps, 6); assert.equal(sat.uploadMbps, 1.8); assert.equal(sat.latencyMs, 300); assert.equal(sat.network, 'hotspot');
  assert.deepEqual(VT.simulate(real, 'inconnue'), VT.clean(real), 'panne inconnue : mesures inchangées');
  assert.equal(VT.preview(real, 'fibre-coupee').level, 'coupe'); assert.match(VT.preview(real, 'fibre-coupee').text, /technicien/);
  assert.equal(VT.preview(real, 'fibre-abimee').level, 'instable');
  assert.equal(VT.preview(real, 'courant').level, 'coupe'); assert.match(VT.preview(real, 'courant').text, /courant/);
  for (const id of Object.keys(VT.SCENARIOS)) assert.ok(VT.preview(real, id).text.length > 40, id);
  const t = await setup();
  try {
    const l = VT.link(t.s, t.user.id), info = await (await t.page('info', l.token)).json();
    assert.ok(info.scenarios.length >= 5 && info.scenarios.every(f => f.label && f.hint), 'la page reçoit la liste des pannes');
    const r = await t.page('preview', l.token, {scenario: 'loin-box', metrics: real}), d = await r.json();
    assert.equal(r.status, 200); assert.equal(d.metrics.downloadMbps, 12); assert.match(d.text, /répéteur|Rapprochez/);
    const before = journey.get(t.s, t.user.id).messages.length;
    assert.equal(journey.get(t.s, t.user.id).messages.length, before, 'une panne simulée n’entre pas dans la conversation');
    assert.equal((await t.page('preview', l.token, {scenario: 'rien', metrics: real})).status, 404);
  } finally { t.close(); }
});

test('En direct : petits échantillons, débit d’envoi compté puis oublié, et infos du réseau sans rien garder', async () => {
  const t = await setup();
  try {
    const l = VT.link(t.s, t.user.id);
    assert.equal((await (await t.page('sample', l.token)).arrayBuffer()).byteLength, 512 * 1024);
    const up = await fetch(t.base + '/api/test/upload', {method: 'POST', headers: {'X-Test-Token': l.token, 'Content-Type': 'application/octet-stream'}, body: new Uint8Array(1024 * 1024)});
    assert.equal(up.status, 200); assert.equal((await up.json()).bytes, 1024 * 1024);
    const big = await fetch(t.base + '/api/test/upload', {method: 'POST', headers: {'X-Test-Token': l.token, 'Content-Type': 'application/octet-stream'}, body: new Uint8Array(3 * 1024 * 1024)}).catch(() => ({status: 413}));
    assert.equal(big.status, 413, 'pas plus de 2 Mo par envoi');
    for (let i = 0; i < 100; i++) assert.equal((await t.page('ping', l.token)).status, 200, 'le direct peut sonder toutes les 2 secondes');
    const net = await (await t.page('network', l.token)).json();
    assert.equal(net.local, true, 'adresse locale : aucun service extérieur appelé');
    const calls = [], fake = async url => { calls.push(url); return {ok: true, json: async () => ({status: 'success', isp: 'Orange Cote d\'Ivoire', city: 'Abidjan', country: 'Côte d’Ivoire'})}; };
    const o = await VT.network('::ffff:102.67.12.34', {fetchImpl: fake});
    assert.deepEqual(o, {ip: '102.67.12.34', operator: 'Orange Cote d\'Ivoire', city: 'Abidjan', country: 'Côte d’Ivoire'});
    await VT.network('102.67.12.34', {fetchImpl: fake}); assert.equal(calls.length, 1, 'réponse gardée une heure en mémoire');
    const down = await VT.network('41.66.1.2', {fetchImpl: async () => { throw new Error('hors ligne'); }});
    assert.equal(down.ip, '41.66.1.2'); assert.equal(down.operator, null, 'service indisponible : l’adresse seule');
    const r = await t.page('result', l.token, {metrics: {downloadMbps: 30, uploadMbps: 8.4, latencyMs: 150, lossPct: 0}});
    assert.ok((await r.json()).facts.some(f => f.label === 'Débit d’envoi' && f.value === '8,4 Mbps'));
  } finally { t.close(); }
});
