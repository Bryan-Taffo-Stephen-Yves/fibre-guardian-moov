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
    assert.deepEqual(t.sent[0].labels, ['Tester ma connexion', 'Mon Wi-Fi capte mal', 'Parler à un conseiller'], 'des boutons pour la suite, comme chez Wave');
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
    assert.match(r.message, /Mbps|box/i); assert.deepEqual(r.labels, ['Redémarrer ma box', 'Envoyer une photo', 'Parler à un conseiller'], 'pas d’internet sans panne : la box d’abord');
    r = await tap('humain', 2);
    assert.match(r.message, /111/); assert.deepEqual(r.labels, ['Redémarrer ma box', 'Autre question', 'Merci'], 'après le conseiller, plus le même menu');
    r = await tap('menu', 3);
    assert.equal(r.message, WB.HEAD + '\n\n' + WB.greeting('Awa Koné')); assert.deepEqual(r.labels, ['Internet est lent', 'Je n’ai plus internet', 'Parler à un conseiller'], '« Autre question » ramène au début');
    r = await tap('reboot', 4);
    assert.deepEqual(r.labels, ['Tester ma connexion', 'Envoyer une photo', 'Parler à un conseiller'], 'après le redémarrage : vérifier en vrai');
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

test('Numéro inconnu : aucune réponse, aucun compte lu ; même message reçu deux fois ou trop vieux : pas de seconde réponse', async () => {
  const t = await setup();
  try {
    // La puce de Guardian peut être un numéro personnel : ses contacts ne reçoivent rien, et chaque réponse
    // prendrait une des 3 discussions gratuites du mois chez Green API.
    assert.deepEqual(await WB.handle(t.s, WB.config(ENV), message(OTHER, 'Bonjour'), {chat: async () => { throw new Error('aucun compte pour un inconnu'); }}), {status: 'unknown'});
    await t.post(message(OTHER, 'Bonjour')); await new Promise(r => setTimeout(r, 300));
    assert.equal(t.sent.length, 0, 'un numéro inconnu ne reçoit aucun message');
    const twice = message(AWA, 'Bonjour');
    await t.post(twice); await t.post(twice); await t.until(2); await new Promise(r => setTimeout(r, 200));
    assert.equal(t.sent.length, 1, 'Green API qui renvoie le même message ne crée pas deux réponses');
    assert.equal(t.sent[0].chatId, AWA + '@c.us');
    await t.post(message(AWA, 'Bonjour', {timestamp: Math.floor((Date.now() - WB.FRESH - 60000) / 1000)})); await new Promise(r => setTimeout(r, 300));
    assert.equal(t.sent.length, 1, 'un message resté en attente pendant que le site dormait ne reçoit pas de réponse hors sujet');
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

// Le site en ligne a une adresse publique (GUARDIAN_ORIGIN) : c'est elle que portent les liens envoyés sur WhatsApp.
const ORIGIN = 'https://fibre-guardian.example';
const LINK = /\n\nSuivez (le trajet|l’intervention) (de Koffi|d’Awa|de Yao) en direct : https:\/\/fibre-guardian\.example\/codex\/\?suivi=([A-Za-z0-9_-]{20,40})$/;
async function trip(env = {...ENV, GUARDIAN_ORIGIN: ORIGIN}) {
  const t = await setup(env);
  const find = (segment = 'YOP-07') => N.overview(t.s, t.chef.id).incidents.find(i => i.segment_id === segment && !i.terminal);
  const op = (body, segment) => { const i = find(segment); return N.operate(t.s, t.chef.id, {id: i.id, version: i.version, ...body}); };
  // Seules les réponses de Guardian comptent (les alertes automatiques partent aussi, avec un autre en-tête).
  const replies = () => t.sent.filter(x => x.message.startsWith(WB.HEAD + '\n\n'));
  const ask = async (text, phone = AWA) => {
    const n = replies().length + 1; await t.post(message(phone, text));
    for (let k = 0; k < 100 && replies().length < n; k++) await new Promise(r => setTimeout(r, 30));
    assert.equal(replies().length, n, 'Guardian répond à « ' + text + ' »'); return replies()[n - 1].message;
  };
  const open = token => fetch('http://127.0.0.1:' + t.server.address().port + '/api/track/' + token);
  return {...t, find, op, ask, open};
}

test('Technicien affecté, en route puis sur place : la réponse de Guardian se termine par le lien de suivi, qui s’ouvre sans compte', async () => {
  const t = await trip();
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    let r = await t.ask('Qu’est-ce qui se passe sur mon réseau ?');
    assert.match(r, /Niangon/); assert.doesNotMatch(r, /suivi=/, 'plan pas encore validé : aucun technicien, aucun lien');
    t.op({type: 'approve', note: 'ok'}); t.op({type: 'dispatch', technician: 'koffi', safety: true});
    r = await t.ask('Où en est la réparation ?');
    assert.deepEqual(r.match(LINK)?.slice(1, 3), ['le trajet', 'de Koffi'], 'technicien affecté : le lien suit déjà la réponse');
    t.op({type: 'advance'}); assert.equal(t.find().status, 'en_route');
    r = await t.ask('Le technicien arrive quand ?');
    assert.match(r, /en route.*\n\nSuivez le trajet de Koffi en direct : /s, 'la réponse d’abord, le lien à la fin');
    // Le lien ouvre le suivi public : le trajet seulement, ni le nom du client, ni son adresse e-mail.
    const res = await t.open(r.match(LINK)[3]), body = await res.text();
    assert.equal(res.status, 200); const live = JSON.parse(body).incident;
    assert.equal(live.id, t.find().id); assert.equal(live.status, 'en_route'); assert.match(live.technician.name, /^Koffi/); assert.ok(live.position);
    assert.doesNotMatch(body, /Awa Koné|awa@example\.test/);
    r = await t.ask('merci');
    assert.match(r, /Avec plaisir/); assert.doesNotMatch(r, /suivi=/, 'après « merci », pas de lien de plus');
    t.op({type: 'advance'}); assert.equal(t.find().status, 'on_site');
    r = await t.ask('Il est où le technicien ?');
    assert.deepEqual(r.match(LINK)?.slice(1, 3), ['l’intervention', 'de Koffi'], 'technicien sur place : on suit l’intervention');
    t.op({type: 'advance'}); assert.equal(t.find().status, 'verifying');
    r = await t.ask('Et maintenant ?');
    assert.doesNotMatch(r, /suivi=/, 'réparation faite, vérification en cours : plus de lien');
    assert.equal(WB.trackLine(t.s, t.awa, ORIGIN), '');
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'normal'}); t.op({type: 'verify'});
    assert.equal(t.find(), undefined, 'panne réparée et vérifiée');
    r = await t.ask('Internet est revenu ?');
    assert.doesNotMatch(r, /suivi=/, 'intervention terminée : plus de lien');
  } finally { t.close(); }
});

test('Deux pannes autour du client : Guardian parle de celle où le technicien arrive, et le lien suit la même', async () => {
  const COCO = '2250788888888';
  const t = await trip({...ENV, GUARDIAN_ORIGIN: ORIGIN, WHATSAPP_CLIENTS: COCO + '=coco@example.test'});
  try {
    const coco = (await t.s.register({email: 'coco@example.test', password: 'coco-password-1234', name: 'Aya Kouadio'})).user; N.join(t.s, coco.id, {segment: 'COC-03', consent: true});
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'COC-03', scenario: 'fiber'});
    t.op({type: 'approve', note: 'ok'}, 'COC-03'); t.op({type: 'dispatch', technician: 'yao', safety: true}, 'COC-03'); t.op({type: 'advance'}, 'COC-03');
    // Plus tard, un équipement central de Cocody tombe : panne plus récente, toute la commune, sans technicien.
    await new Promise(r => setTimeout(r, 20));
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'PAL-02', scenario: 'olt'});
    assert.ok(N.client(t.s, coco.id).incidents.filter(N.isOpen).length >= 2, 'Aya voit bien deux pannes ouvertes');
    const r = await t.ask('Le technicien arrive quand ?', COCO);
    assert.match(r, /en route/, 'Guardian parle de l’intervention en cours chez Aya');
    assert.deepEqual(r.match(LINK)?.slice(1, 3), ['le trajet', 'de Yao'], 'élision seulement devant une voyelle : « de Yao »');
    const live = (await (await t.open(r.match(LINK)[3])).json()).incident;
    assert.equal(live.id, t.find('COC-03').id, 'le lien ouvre la panne dont parle la réponse');
  } finally { t.close(); }
});

test('Pas de lien sans technicien (coupure de courant) ni sans adresse du site ; « d’Awa » devant une voyelle ; la photo de la box reçoit le lien', async () => {
  assert.deepEqual(['Awa', 'Ibrahim', 'Amina', 'Koffi', 'Yao'].map(WB.de), ['d’Awa', 'd’Ibrahim', 'd’Amina', 'de Koffi', 'de Yao']);
  const t = await trip();
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'power'});
    t.op({type: 'approve', note: 'CIE.'});
    const r = await t.ask('Qu’est-ce qui se passe ?');
    assert.match(r, /courant/); assert.doesNotMatch(r, /suivi=/, 'coupure de courant : personne ne se déplace');
  } finally { t.close(); }
  const u = await trip(ENV);
  try {
    N.operate(u.s, u.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    u.op({type: 'approve', note: 'ok'}); u.op({type: 'dispatch', technician: 'awa', safety: true}); u.op({type: 'advance'});
    const r = await u.ask('Le technicien arrive quand ?');
    assert.match(r, /en route/); assert.doesNotMatch(r, /suivi=/, 'sans GUARDIAN_ORIGIN, un lien local serait inutilisable sur WhatsApp : pas de lien');
    assert.match(WB.trackLine(u.s, u.awa, ORIGIN), LINK); assert.match(WB.trackLine(u.s, u.awa, ORIGIN), /Suivez le trajet d’Awa en direct/);
    // Photo de la box pendant le trajet : la lecture des voyants est suivie du même lien.
    const sent = [], photo = async () => ({messages: [{role: 'assistant', text: 'Votre box n’est pas en cause : le câble du quartier est coupé.', action: 'tracking'}]});
    const fetchImpl = async (url, init) => { if (String(url).startsWith('https://media.example.test/')) return {ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer}; sent.push(JSON.parse(init.body)); return {ok: true}; };
    const shot = {...message(AWA, ''), messageData: {typeMessage: 'imageMessage', fileMessageData: {downloadUrl: 'https://media.example.test/box.jpg', mimeType: 'image/jpeg'}}};
    await WB.handle(u.s, WB.config({...ENV, GUARDIAN_ORIGIN: ORIGIN}), shot, {chat: async () => { throw new Error('pas de chat pour une photo'); }, photo, fetchImpl});
    assert.match(sent[0].body, /câble du quartier est coupé\.\n\nSuivez le trajet d’Awa en direct : https:\/\/fibre-guardian\.example\/codex\/\?suivi=/);
  } finally { u.close(); }
});
