'use strict';
// Guardian sur WhatsApp (Green API) : le client écrit, Guardian répond comme dans l'application, une seule fois,
// seulement aux numéros reliés, et la porte reste fermée sans le secret de Green API.
const {test} = require('node:test'), assert = require('node:assert/strict');
const WB = require('./whatsapp-bot.cjs'), W = require('./whatsapp.cjs'), N = require('./noc-store.cjs'), O = require('./operator-store.cjs'), {createGuardianServer} = require('./pilot-server.cjs');

const AWA = '2250701020304', OTHER = '2250799999999', SECRET = 'secret-green-api-de-test-1234';
const ENV = {GREENAPI_ID_INSTANCE: '7103000001', GREENAPI_API_TOKEN: 'jeton-instance-de-test', GREENAPI_WEBHOOK_TOKEN: SECRET, WHATSAPP_NUMEROS: 'Yopougon=' + AWA};
const message = (phone, text, extra = {}) => ({typeWebhook: 'incomingMessageReceived', idMessage: 'MSG' + Math.random().toString(36).slice(2), timestamp: Math.floor(Date.now() / 1000), senderData: {chatId: phone + '@c.us', senderName: 'Client'}, messageData: {typeMessage: 'textMessage', textMessageData: {textMessage: text}}, ...extra});

async function setup(env = ENV) {
  const server = createGuardianServer({db: ':memory:', env, onError: () => {}}), s = server.guardianStore;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const chef = (await s.register({email: 'chef@example.test', password: 'chef-password-1234', name: 'Chef'})).user; O.grant(s, 'chef@example.test', 'admin');
  const awa = (await s.register({email: 'awa@example.test', password: 'awa-password-1234', name: 'Awa Koné'})).user; N.join(s, awa.id, {segment: 'YOP-07', consent: true});
  const later = (await s.register({email: 'voisin@example.test', password: 'voisin-password-1234', name: 'Voisin'})).user; N.join(s, later.id, {segment: 'YOP-07', consent: true});
  const sent = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return real(url, init);
    sent.push({url: String(url), ...JSON.parse(init.body)}); return {ok: true, status: 200, json: async () => ({idMessage: 'OUT'})};
  };
  const post = (d, token = 'Bearer ' + SECRET) => real(base + '/api/whatsapp/entrant', {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: token} : {})}, body: JSON.stringify(d)});
  const until = async n => { for (let i = 0; i < 100 && sent.length < n; i++) await new Promise(r => setTimeout(r, 30)); };
  const close = () => { globalThis.fetch = real; server.close(); };
  return {server, s, chef, awa, later, sent, post, until, close};
}

test('Réglages : Green API seulement avec l’instance et son jeton ; la porte exige le secret', () => {
  assert.equal(WB.config({}), null);
  const cfg = WB.config({...ENV, GREENAPI_WEBHOOK_TOKEN: 'Bearer ' + SECRET, WHATSAPP_CLIENTS: '+225 07 01 02 03 04 = Awa@Example.test'});
  assert.equal(cfg.id, '7103000001'); assert.equal(cfg.secret, SECRET); assert.equal(cfg.url, 'https://api.green-api.com');
  assert.deepEqual(cfg.clients, [{phone: AWA, email: 'awa@example.test'}]);
  assert.ok(WB.allowed(cfg, 'Bearer ' + SECRET) && WB.allowed(cfg, SECRET));
  assert.ok(!WB.allowed(cfg, 'Bearer mauvais') && !WB.allowed(cfg, '') && !WB.allowed(null, SECRET));
  assert.ok(!WB.allowed(WB.config({...ENV, GREENAPI_WEBHOOK_TOKEN: 'court'}), 'court'), 'un secret trop court laisse la porte fermée');
  assert.equal(W.config(ENV).provider, 'greenapi', 'les alertes de panne partent aussi par Green API');
});

test('Seuls les messages texte d’une personne sont lus (pas les groupes, ni les photos, ni les accusés)', () => {
  assert.equal(WB.incoming(message(AWA, ' Bonjour ')).text, 'Bonjour');
  assert.equal(WB.incoming({...message(AWA, ''), messageData: {typeMessage: 'extendedTextMessage', extendedTextMessageData: {text: 'Voir le lien'}}}).text, 'Voir le lien');
  assert.equal(WB.incoming({...message(AWA, 'x'), senderData: {chatId: '120363000000@g.us'}}), null, 'groupe ignoré');
  assert.equal(WB.incoming({...message(AWA, 'x'), messageData: {typeMessage: 'imageMessage'}}), null);
  assert.equal(WB.incoming({...message(AWA, 'x'), typeWebhook: 'outgoingMessageStatus'}), null);
});

test('Sans le bon secret, Green API (ou n’importe qui) est refusé et rien ne part', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post(message(AWA, 'bonjour'), null)).status, 401);
    assert.equal((await t.post(message(AWA, 'bonjour'), 'Bearer mauvais-secret-de-test-0000')).status, 401);
    await new Promise(r => setTimeout(r, 200)); assert.equal(t.sent.length, 0);
  } finally { t.close(); }
  const closed = await setup({...ENV, GREENAPI_WEBHOOK_TOKEN: ''});
  try { assert.equal((await closed.post(message(AWA, 'bonjour'))).status, 401, 'sans secret réglé, la porte reste fermée'); } finally { closed.close(); }
});

test('Un jour normal : Awa écrit « internet est lent », Guardian lui répond sur WhatsApp comme dans l’application', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post(message(AWA, 'Bonjour, internet est lent chez moi'))).status, 200);
    await t.until(1);
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].url, 'https://api.green-api.com/waInstance7103000001/sendMessage/jeton-instance-de-test');
    assert.equal(t.sent[0].chatId, AWA + '@c.us');
    assert.match(t.sent[0].message, /^Guardian · Moov Africa Fibre\n\n/);
    assert.match(t.sent[0].message, /Mbps/, 'Guardian donne la mesure réelle de la ligne');
    assert.doesNotMatch(t.sent[0].message, /bouton ci-dessous/, 'pas de bouton sur WhatsApp');
    const app = require('./journey-store.cjs').get(t.s, t.awa.id).messages.map(m => m.text);
    assert.ok(app.includes('Bonjour, internet est lent chez moi'), 'la conversation WhatsApp se retrouve dans l’application d’Awa');
    assert.equal(require('./journey-store.cjs').get(t.s, t.later.id), null, 'le voisin inscrit après Awa n’est pas touché');
  } finally { t.close(); }
});

test('« Bonjour » : Guardian salue et demande comment aider, sans annoncer la panne d’un coup', async () => {
  const t = await setup();
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await t.post(message(AWA, 'Bonjour')); await t.until(1);
    assert.equal(t.sent[0].message, WB.greeting('Awa Koné'));
    assert.match(t.sent[0].message, /Bonjour Awa ! Je suis Guardian.*Comment puis-je vous aider \?/);
    assert.doesNotMatch(t.sent[0].message, /coupé|Niangon/, 'la panne attend la question du client');
  } finally { t.close(); }
});

test('Pendant une panne à Niangon : « je n’ai plus internet » → quartier, cause et étape, comme le serveur vocal', async () => {
  const t = await setup();
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await t.post(message(AWA, 'Je n’ai plus internet depuis ce matin')); await t.until(1);
    assert.match(t.sent[0].message, /Niangon/); assert.match(t.sent[0].message, /coup/);
    await t.post(message(AWA, 'merci')); await t.until(2);
    assert.match(t.sent[1].message, /Avec plaisir/);
  } finally { t.close(); }
});

test('Numéro inconnu : réponse polie, aucun compte lu ; même message reçu deux fois ou trop vieux : pas de seconde réponse', async () => {
  const t = await setup();
  try {
    await t.post(message(OTHER, 'Bonjour')); await t.until(1);
    assert.equal(t.sent[0].message, WB.UNKNOWN); assert.equal(t.sent[0].chatId, OTHER + '@c.us');
    const twice = message(AWA, 'Bonjour');
    await t.post(twice); await t.post(twice); await t.until(3); await new Promise(r => setTimeout(r, 200));
    assert.equal(t.sent.length, 2, 'Green API qui renvoie le même message ne crée pas deux réponses');
    await t.post(message(AWA, 'Bonjour', {timestamp: Math.floor((Date.now() - WB.FRESH - 60000) / 1000)})); await new Promise(r => setTimeout(r, 300));
    assert.equal(t.sent.length, 2, 'un message resté en attente pendant que le site dormait ne reçoit pas de réponse hors sujet');
  } finally { t.close(); }
});

test('Panne détectée : l’alerte du quartier part aussi par Green API vers le numéro d’Awa', async () => {
  const t = await setup();
  try {
    const cfg = W.config(ENV), calls = [];
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await W.tick(t.s, cfg, {fetchImpl: async (url, init) => { calls.push({url, ...JSON.parse(init.body)}); return {ok: true}; }, now: Date.now() + require('./sim-flow.js').THINK + 500, wait: async () => {}});
    assert.ok(calls.some(c => c.chatId === AWA + '@c.us' && /coupé dans votre quartier/.test(c.message)));
    assert.ok(calls.every(c => c.url.endsWith('/waInstance7103000001/sendMessage/jeton-instance-de-test')));
  } finally { t.close(); }
});
