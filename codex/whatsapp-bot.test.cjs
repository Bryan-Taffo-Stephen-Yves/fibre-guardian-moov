'use strict';
// Guardian sur WhatsApp (Green API) : le client écrit, Guardian répond comme dans l'application, une seule fois,
// seulement aux numéros reliés, et la porte reste fermée sans le secret de Green API.
const {test} = require('node:test'), assert = require('node:assert/strict');
const WB = require('./whatsapp-bot.cjs'), W = require('./whatsapp.cjs'), N = require('./noc-store.cjs'), O = require('./operator-store.cjs'), {createGuardianServer} = require('./pilot-server.cjs');

const AWA = '2250701020304', OTHER = '2250799999999', SECRET = 'secret-green-api-de-test-1234';
const ENV = {GREENAPI_ID_INSTANCE: '7103000001', GREENAPI_API_TOKEN: 'jeton-instance-de-test', GREENAPI_WEBHOOK_TOKEN: SECRET, WHATSAPP_NUMEROS: 'Yopougon=' + AWA};
const message = (phone, text, extra = {}) => ({typeWebhook: 'incomingMessageReceived', idMessage: 'MSG' + Math.random().toString(36).slice(2), timestamp: Math.floor(Date.now() / 1000), senderData: {chatId: phone + '@c.us', senderName: 'Client'}, messageData: {typeMessage: 'textMessage', textMessageData: {textMessage: text}}, ...extra});

async function setup(env = ENV, {refuseButtons = false} = {}) {
  const server = createGuardianServer({db: ':memory:', env, onError: () => {}}), s = server.guardianStore;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const chef = (await s.register({email: 'chef@example.test', password: 'chef-password-1234', name: 'Chef'})).user; O.grant(s, 'chef@example.test', 'admin');
  const awa = (await s.register({email: 'awa@example.test', password: 'awa-password-1234', name: 'Awa Koné'})).user; N.join(s, awa.id, {segment: 'YOP-07', consent: true});
  const later = (await s.register({email: 'voisin@example.test', password: 'voisin-password-1234', name: 'Voisin'})).user; N.join(s, later.id, {segment: 'YOP-07', consent: true});
  const sent = [], heard = [], transcript = {value: ''}, real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(base)) return real(url, init);
    if (String(url).startsWith('https://media.example.test/')) return {ok: true, status: 200, arrayBuffer: async () => new Uint8Array([79, 103, 103, 83]).buffer};
    if (String(url).startsWith('https://api.groq.com/')) { heard.push({auth: init.headers.Authorization, model: init.body.get('model'), language: init.body.get('language'), file: init.body.get('file')}); return {ok: true, status: 200, json: async () => ({text: transcript.value})}; }
    const d = JSON.parse(init.body), method = String(url).split('/')[4];
    if (method === 'sendInteractiveButtonsReply' && refuseButtons) return {ok: false, status: 400, json: async () => ({})};
    sent.push({url: String(url), method, ...d, message: d.message ?? d.header + '\n\n' + d.body, labels: (d.buttons || []).map(b => b.buttonText)}); return {ok: true, status: 200, json: async () => ({idMessage: 'OUT'})};
  };
  const post = (d, token = 'Bearer ' + SECRET) => real(base + '/api/whatsapp/entrant', {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: token} : {})}, body: JSON.stringify(d)});
  const until = async n => { for (let i = 0; i < 100 && sent.length < n; i++) await new Promise(r => setTimeout(r, 30)); };
  const close = () => { globalThis.fetch = real; server.close(); };
  return {server, s, chef, awa, later, sent, heard, transcript, post, until, close};
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
    assert.equal(t.sent[0].url, 'https://api.green-api.com/waInstance7103000001/sendInteractiveButtonsReply/jeton-instance-de-test');
    assert.deepEqual(t.sent[0].labels, ['Mon Wi-Fi capte mal', 'Redémarrer ma box', 'Parler à un conseiller'], 'des boutons pour la suite, comme chez Wave');
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
    assert.equal(t.sent[0].message, WB.HEAD + '\n\n' + WB.greeting('Awa Koné'));
    assert.deepEqual(t.sent[0].labels, ['Internet est lent', 'Je n’ai plus internet', 'Parler à un conseiller']);
    assert.match(t.sent[0].message, /Bonjour Awa ! Je suis Guardian.*Que se passe-t-il \?/);
    assert.doesNotMatch(t.sent[0].message, /coupé|Niangon/, 'la panne attend la question du client');
  } finally { t.close(); }
});

test('Pendant une panne à Niangon : « je n’ai plus internet » → quartier, cause et étape, comme le serveur vocal', async () => {
  const t = await setup();
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await t.post(message(AWA, 'Je n’ai plus internet depuis ce matin')); await t.until(1);
    assert.match(t.sent[0].message, /Niangon/); assert.match(t.sent[0].message, /coup/);
    assert.deepEqual(t.sent[0].labels, ['Où en est la réparation', 'Parler à un conseiller', 'Merci'], 'pendant la panne, les boutons suivent la réparation');
    await t.post(message(AWA, 'merci')); await t.until(2);
    assert.match(t.sent[1].message, /Avec plaisir/); assert.equal(t.sent[1].method, 'sendMessage', 'après « merci », plus de boutons');
  } finally { t.close(); }
});

test('Bouton touché, ou « 2 » tapé : Guardian reçoit la phrase complète ; boutons refusés : choix numérotés en texte', async () => {
  const t = await setup(ENV);
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await t.post(message(AWA, 'Bonjour')); await t.until(1);
    await t.post({...message(AWA, ''), messageData: {typeMessage: 'buttonsResponseMessage', buttonsResponseMessage: {stanzaId: 'X', selectedButtonId: 'coupure', selectedButtonText: 'Je n’ai plus internet'}}}); await t.until(2);
    assert.match(t.sent[1].message, /Niangon/, 'le bouton « Je n’ai plus internet » donne l’état du quartier');
    await t.post(message(AWA, '1')); await t.until(3);
    assert.match(t.sent[2].message, /technicien|équipe|intervention/i, '« 1 » = premier bouton du dernier menu (« Où en est la réparation »)');
    const app = require('./journey-store.cjs').get(t.s, t.awa.id).messages.filter(m => m.role === 'user').map(m => m.text);
    assert.deepEqual(app.slice(-2), ['Je n’ai plus d’internet', 'Où en est la réparation ?']);
  } finally { t.close(); }
  const old = await setup(ENV, {refuseButtons: true});
  try {
    await old.post(message(AWA, 'Bonjour')); await old.until(1);
    assert.equal(old.sent[0].method, 'sendMessage');
    assert.match(old.sent[0].message, /1\. Internet est lent\n2\. Je n’ai plus internet\n3\. Parler à un conseiller\n\nRépondez 1, 2 ou 3\.$/);
  } finally { old.close(); }
});

test('Les boutons changent selon la situation : conseiller, box, forfait, panne en cours', async () => {
  const t = await setup();
  const tap = async (id, n) => { await t.post({...message(AWA, ''), messageData: {typeMessage: 'buttonsResponseMessage', buttonsResponseMessage: {selectedButtonId: id}}}); await t.until(n); return t.sent[n - 1]; };
  try {
    // Jour normal : chaque réponse propose une suite différente.
    let r = await tap('coupure', 1);
    assert.match(r.message, /Mbps|box/i); assert.deepEqual(r.labels, ['Redémarrer ma box', 'Voyant rouge sur la box', 'Parler à un conseiller'], 'pas d’internet sans panne : la box d’abord');
    r = await tap('humain', 2);
    assert.match(r.message, /111/); assert.deepEqual(r.labels, ['Redémarrer ma box', 'Autre question', 'Merci'], 'après le conseiller, plus le même menu');
    r = await tap('menu', 3);
    assert.equal(r.message, WB.HEAD + '\n\n' + WB.greeting('Awa Koné')); assert.deepEqual(r.labels, ['Internet est lent', 'Je n’ai plus internet', 'Parler à un conseiller'], '« Autre question » ramène au début');
    r = await tap('reboot', 4);
    assert.deepEqual(r.labels, ['Voyant rouge sur la box', 'Parler à un conseiller', 'Merci']);
    await t.post(message(AWA, 'Je veux un forfait plus rapide')); await t.until(5);
    assert.deepEqual(t.sent[4].labels, ['Mon forfait et son prix', 'Parler à un conseiller', 'Merci']);
    // Panne à Niangon : conseiller et suivi gardent la réparation sous la main.
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    r = await tap('humain', 6);
    assert.match(r.message, /111.*\n\nNous savons déjà/s, 'pendant une panne, Guardian dit comment joindre un conseiller, puis l’état du quartier');
    assert.deepEqual(r.labels, ['Où en est la réparation', 'Autre question', 'Merci'], 'pendant une panne, le conseiller ne fait pas oublier la réparation');
    r = await tap('suivi', 7);
    assert.match(r.message, /technicien|équipe|intervention|Niangon/i); assert.deepEqual(r.labels, ['Parler à un conseiller', 'Autre question', 'Merci']);
    for (const ids of Object.values(WB.MENUS)) { assert.ok(ids.length <= 3); for (const id of ids) assert.ok(WB.CHOICES[id][0].length <= 25, id); }
  } finally { t.close(); }
});

test('Note vocale : Guardian la transcrit (Groq), répète ce qu’il a compris et répond ; sans clé Groq, il demande d’écrire', async () => {
  const voice = (phone, url = 'https://media.example.test/note.ogg') => ({...message(phone, ''), messageData: {typeMessage: 'audioMessage', fileMessageData: {downloadUrl: url, mimeType: 'audio/ogg; codecs=opus'}}});
  const deaf = await setup();
  try {
    await deaf.post(voice(AWA)); await deaf.until(1);
    assert.match(deaf.sent[0].message, /Je ne peux pas encore écouter les notes vocales/); assert.equal(deaf.heard.length, 0);
  } finally { deaf.close(); }
  const t = await setup({...ENV, GROQ_API_KEY: 'gsk_cle-de-test-groq-1234567890'});
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    t.transcript.value = 'Bonsoir, depuis ce matin je n’ai plus internet à la maison';
    await t.post(voice(AWA)); await t.until(1);
    assert.equal(t.heard.length, 1);
    assert.equal(t.heard[0].auth, 'Bearer gsk_cle-de-test-groq-1234567890'); assert.equal(t.heard[0].model, 'whisper-large-v3-turbo'); assert.equal(t.heard[0].language, 'fr');
    assert.equal(t.heard[0].file.type, 'audio/ogg');
    assert.match(t.sent[0].message, /Vous avez dit : « Bonsoir, depuis ce matin je n’ai plus internet à la maison »\n\nNous savons déjà/);
    assert.match(t.sent[0].message, /Niangon/);
    t.transcript.value = '';
    await t.post(voice(AWA)); await t.until(2);
    assert.match(t.sent[1].message, /pas bien compris votre note vocale/);
    await t.post(voice(AWA, 'http://media.example.test/note.ogg')); await new Promise(r => setTimeout(r, 300));
    assert.equal(t.sent.length, 2, 'une adresse de fichier non chiffrée est ignorée');
  } finally { t.close(); }
});

test('Numéro inconnu : réponse polie, aucun compte lu ; même message reçu deux fois ou trop vieux : pas de seconde réponse', async () => {
  const t = await setup();
  try {
    await t.post(message(OTHER, 'Bonjour')); await t.until(1);
    assert.equal(t.sent[0].message, WB.HEAD + '\n\n' + WB.UNKNOWN); assert.equal(t.sent[0].chatId, OTHER + '@c.us');
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
