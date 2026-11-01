'use strict';
// L'équipe Moov sur WhatsApp : dès qu'une panne est repérée, Guardian écrit au responsable relié par son compte,
// avec un bouton « Valider le plan » propre à cette alerte. Le bouton (ou la commande « Valider ») valide ce plan-là, avec les
// droits du compte : la Régie et le moteur d'incidents vérifient tout, comme dans l'espace Moov.
// Le jury peut aussi donner son numéro WhatsApp : rien ne part avant que ce téléphone réponde « OUI ».
const {test} = require('node:test'), assert = require('node:assert/strict');
const WB = require('./whatsapp-bot.cjs'), W = require('./whatsapp.cjs'), N = require('./noc-store.cjs'), O = require('./operator-store.cjs'), F = require('./sim-flow.js');
const jury = require('./jury-store.cjs'), {createGuardianServer} = require('./pilot-server.cjs');

const BOSS = '2250705050505', AWA = '2250701020304', AGENT = '2250706060606', SECRET = 'secret-green-api-de-test-1234';
const BASE = {GREENAPI_ID_INSTANCE: '7103000001', GREENAPI_API_TOKEN: 'jeton-instance-de-test', GREENAPI_WEBHOOK_TOKEN: SECRET};
const message = (phone, text, extra = {}) => ({typeWebhook: 'incomingMessageReceived', idMessage: 'MSG' + Math.random().toString(36).slice(2), timestamp: Math.floor(Date.now() / 1000), senderData: {chatId: phone + '@c.us'}, messageData: {typeMessage: 'textMessage', textMessageData: {textMessage: text}}, ...extra});

async function setup(links, {refuseButtons = false, env: extra = {}, accounts = null, refuse = null, onSend = null} = {}) {
  const env = {...BASE, WHATSAPP_CLIENTS: links, ...extra};
  const server = createGuardianServer({db: ':memory:', env, onError: () => {}}), s = server.guardianStore;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const chef = (await s.register({email: 'chef@example.test', password: 'chef-password-1234', name: 'Chef Moov'})).user; O.grant(s, 'chef@example.test', 'admin');
  const agent = (await s.register({email: 'agent@example.test', password: 'agent-password-1234', name: 'Agent Support'})).user; O.grant(s, 'agent@example.test', 'agent');
  const awa = (await s.register({email: 'awa@example.test', password: 'awa-password-1234', name: 'Awa Koné'})).user; N.join(s, awa.id, {segment: 'YOP-07', consent: true});
  const sent = [], real = globalThis.fetch;
  // Faux Green API : chaque message envoyé est noté (méthode, destinataire, texte, boutons).
  const fake = async (url, init) => {
    if (String(url).startsWith(base)) return real(url, init);
    const d = JSON.parse(init.body), method = String(url).split('/')[4];
    if (method === 'sendInteractiveButtonsReply' && refuseButtons) return {ok: false, status: 400, json: async () => ({})};
    // « Ce numéro a-t-il WhatsApp ? » : oui pour tous, sauf si le test donne la liste des comptes.
    if (method === 'checkWhatsapp') return {ok: true, status: 200, json: async () => ({existsWhatsapp: !accounts || accounts.includes(String(d.phoneNumber))})};
    const text = d.message ?? ((d.header ? d.header + '\n\n' : '') + d.body);
    if (refuse?.(text)) return {ok: false, status: 466, json: async () => ({})};
    await onSend?.(d.chatId);
    sent.push({method, chatId: d.chatId, text, buttons: (d.buttons || []).map(b => b.buttonId)});
    return {ok: true, status: 200, json: async () => ({idMessage: 'OUT'})};
  };
  globalThis.fetch = fake;
  const post = d => real(base + '/api/whatsapp/entrant', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + SECRET}, body: JSON.stringify(d)});
  const get = route => real(base + route);
  const join = (code, extra = {}) => real(base + '/api/jury/join', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code, consent: true, ...extra})});
  const to = phone => sent.filter(m => m.chatId === phone + '@c.us');
  const wait = async (phone, n) => { for (let k = 0; k < 100 && to(phone).length < n; k++) await new Promise(r => setTimeout(r, 30)); return to(phone)[n - 1]; };
  const reply = async (phone, text) => { const n = to(phone).length + 1; await post(message(phone, text)); return wait(phone, n); };
  // Bouton touché dans WhatsApp (Green API le renvoie avec son identifiant).
  const tap = async (phone, buttonId) => { const n = to(phone).length + 1; await post(message(phone, '', {messageData: {typeMessage: 'interactiveButtonsResponse', interactiveButtonsResponse: {selectedButtonId: buttonId, selectedButtonText: 'Valider le plan'}}})); return wait(phone, n); };
  // Les agents de Guardian ont fini leur travail : les messages prévus partent (sans attendre la minuterie de 3 s).
  const alerts = () => W.tick(s, W.config(env), {fetchImpl: fake, now: Date.now() + F.THINK + 500, wait: async () => {}});
  const find = (segment = 'YOP-07') => N.overview(s, chef.id).incidents.find(i => i.segment_id === segment && !i.terminal);
  const close = () => { globalThis.fetch = real; server.close(); };
  return {server, s, base, chef, agent, awa, sent, to, post, get, join, wait, reply, tap, alerts, find, close};
}

test('Panne repérée : le responsable relié reçoit l’alerte de l’équipe avec un bouton « Valider le plan »', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await t.alerts();
    const [m] = t.to(BOSS);
    assert.ok(m, 'le responsable est prévenu dès que Guardian a fini son analyse');
    assert.equal(m.method, 'sendInteractiveButtonsReply'); assert.equal(m.buttons.length, 1); assert.match(m.buttons[0], /^valider:[0-9a-f]{8}$/, 'le bouton porte la référence de cette alerte');
    assert.match(m.text, /^Fibre Guardian · Équipe Moov\n\nPanne à Niangon \(Yopougon\) : fibre coupée.*Plan prêt, votre validation est attendue\.\n\nRépondez « Valider » pour valider ce plan\. Vous pouvez aussi valider dans l’espace Moov\./s);
    assert.equal(t.to(AWA).length, 0, 'aucun client relié : personne d’autre n’est écrit');
  } finally { t.close(); }
  const old = await setup(BOSS + '=chef@example.test', {refuseButtons: true});
  try {
    N.operate(old.s, old.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await old.alerts();
    assert.equal(old.to(BOSS)[0].method, 'sendMessage', 'boutons refusés : le même texte part sans bouton');
    assert.match(old.to(BOSS)[0].text, /Répondez « Valider »/);
  } finally { old.close(); }
});

test('Le responsable répond « Valider » : le plan de cette alerte est validé avec ses droits, une seule fois', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    assert.match((await t.reply(BOSS, 'Valider')).text, /Aucun plan n’attend votre validation/, 'pas encore d’alerte reçue : rien à valider');
    assert.equal(t.find().status, 'proposed');
    await t.alerts();
    const r = await t.reply(BOSS, 'Valider');
    assert.match(r.text, /^Guardian · Moov Africa Fibre\n\nC’est validé : coupure fibre à Niangon/);
    const i = t.find();
    assert.equal(i.status, 'approved'); assert.equal(i.approved_by, t.chef.id);
    assert.ok(i.events.some(e => e.kind === 'plan.approved'));
    assert.match((await t.reply(BOSS, 'je valide')).text, /déjà validé/, 'une seconde réponse ne valide rien de plus');
    await t.alerts();
    assert.ok(t.to(BOSS).some(m => /Plan validé pour Niangon/.test(m.text)), 'la suite de l’alerte arrive comme avant');
  } finally { t.close(); }
});

test('Seul un compte qui a le droit de valider le peut ; un client ou un numéro inconnu ne valide jamais rien', async () => {
  const t = await setup([AGENT + '=agent@example.test', AWA + '=awa@example.test'].join(','));
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await t.alerts();
    assert.ok(t.to(AGENT).some(m => m.buttons.some(b => b.startsWith('valider:'))), 'l’agent support reçoit l’alerte de l’équipe');
    const r = await t.reply(AGENT, 'Valider');
    assert.match(r.text, /Validation réservée au responsable technique/, 'le droit est vérifié par le moteur d’incidents');
    assert.equal(t.find().status, 'proposed');
    await t.reply(AWA, 'valider');
    assert.equal(t.find().status, 'proposed', 'une cliente qui écrit « valider » parle à Guardian, elle ne valide rien');
    await t.post(message('2250799999999', 'Valider')); await new Promise(r => setTimeout(r, 200));
    assert.equal(t.find().status, 'proposed');
  } finally { t.close(); }
});

test('Un même téléphone relié à Awa et au responsable : alerte client et alerte d’équipe, « Valider » valide, « Bonjour » reste la cliente', async () => {
  const t = await setup([BOSS + '=awa@example.test', BOSS + '=chef@example.test'].join(','));
  try {
    N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await t.alerts();
    const got = t.to(BOSS).map(m => m.text);
    assert.ok(got.some(x => /^Moov Africa · Fibre Guardian\n\nUn câble de fibre est coupé/.test(x)), 'l’alerte client');
    assert.ok(got.some(x => /^Fibre Guardian · Équipe Moov\n\n.*votre validation est attendue/s.test(x)), 'l’alerte de l’équipe');
    assert.match((await t.reply(BOSS, 'Bonjour')).text, /Bonjour Awa !/);
    assert.match((await t.reply(BOSS, 'Valider')).text, /C’est validé/);
    assert.equal(t.find().status, 'approved');
  } finally { t.close(); }
});

test('Réseau de démo dans la Régie : « Valider » sur WhatsApp fait la même chose que le bouton « Valider » de la Régie', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    const origin = 'http://127.0.0.1:' + t.server.address().port;
    jury.step(t.s, t.chef.id, {type: 'open', ssid: 'MOOV-FIBRE-DEMO'}, origin);
    const code = jury.status(t.s, t.chef.id, origin).room.code;
    const member = await jury.join(t.s, {code, firstName: 'Koffi', consent: true}, '127.0.0.1');
    jury.step(t.s, t.chef.id, {type: 'cut', fault: 'fiber'}, origin);
    assert.equal(jury.status(t.s, t.chef.id, origin).next, 'validate');
    assert.equal(jury.me(t.s, member.id).scene, null, 'avant la validation, le jury ne voit rien');
    await t.alerts();
    const r = await t.reply(BOSS, 'Valider');
    assert.match(r.text, /C’est validé : coupure fibre confirmée sur le réseau MOOV-FIBRE-DEMO\. Les inscrits du jury sont prévenus.*« Envoyer le technicien » dans la Régie\./s);
    assert.equal(jury.status(t.s, t.chef.id, origin).next, 'send', 'la Régie passe à l’étape suivante');
    assert.ok(jury.me(t.s, member.id).scene, 'le téléphone du jury reçoit l’alerte');
  } finally { t.close(); }
});

test('« Valider » : seulement la commande entière, jamais une question, un refus ou une phrase', () => {
  for (const t of ['Valider', 'valider le plan', 'Je valide', 'OK valide !', 'Validé', 'oui, je valide', 'D’accord, je valide.']) assert.ok(WB.wantsValidate(t), t);
  for (const t of ['invalide', 'Bonjour', 'Où en est la réparation ?', 'pas de validation', 'Je valide pas', 'je valide pas ce plan', 'Valider ou pas ?', 'Validé ?', 'Valide ?', 'valider plus tard', 'Valider ? non attends', 'Validez-vous les paiements Wave ?', 'Valide jusqu’à quand mon forfait ?'])
    assert.ok(!WB.wantsValidate(t), t);
  for (const t of ['Stop', 'STOP !', 'Stop svp', 'stop merci', 'Arrêter', 'je veux arrêter', 'Désinscription']) assert.ok(WB.wantsStop(t), t);
  for (const t of ['Arrêt total d’internet chez moi', 'stop ou encore ?', 'Je n’ai plus internet']) assert.ok(!WB.wantsStop(t), t);
  for (const t of ['OUI', 'oui !', 'Ok', 'D’accord']) assert.ok(WB.wantsYes(t), t);
  for (const t of ['oui mais', 'non', 'Je n’ai plus internet']) assert.ok(!WB.wantsYes(t), t);
});

// ——— Le responsable valide le bon plan, et seulement un plan qu'il a vu ———
const button = m => m.buttons.find(b => b.startsWith('valider:'));
const fiber = (t, segment) => N.operate(t.s, t.chef.id, {type: 'simulate', segment, scenario: 'fiber'});

test('Deux pannes en même temps : le bouton touché valide sa panne ; « Valider » écrit demande laquelle', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    fiber(t, 'YOP-07'); fiber(t, 'COC-03');
    await t.alerts();
    const niangon = t.to(BOSS).find(m => /Niangon/.test(m.text)), cocody = t.to(BOSS).find(m => /Cité des Arts/.test(m.text));
    assert.ok(niangon && cocody && button(niangon) !== button(cocody), 'chaque alerte a son propre bouton');
    assert.match((await t.reply(BOSS, 'Valider')).text, /Plusieurs plans attendent votre validation : .*Niangon \(Yopougon\).*Cité des Arts \(Cocody\)|Plusieurs plans attendent votre validation : .*Cité des Arts \(Cocody\).*Niangon \(Yopougon\)/);
    assert.equal(t.find('YOP-07').status, 'proposed'); assert.equal(t.find('COC-03').status, 'proposed');
    assert.match((await t.tap(BOSS, button(niangon))).text, /C’est validé : coupure fibre à Niangon \(Yopougon\)/);
    assert.equal(t.find('YOP-07').status, 'approved'); assert.equal(t.find('COC-03').status, 'proposed', 'l’autre panne attend toujours');
    assert.match((await t.tap(BOSS, button(niangon))).text, /déjà validé/);
    assert.match((await t.reply(BOSS, 'Je valide')).text, /C’est validé : coupure fibre à Cité des Arts \(Cocody\)/, 'un seul plan en attente : la commande écrite suffit');
    assert.match((await t.tap(BOSS, 'valider:00000000')).text, /Aucun plan n’attend/, 'une référence inconnue ne valide rien');
  } finally { t.close(); }
});

test('« Je valide pas » ou « Valider ou pas ? » ne valident rien ; le message part vers Guardian', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    fiber(t, 'YOP-07'); await t.alerts();
    for (const text of ['Je valide pas', 'Valider ou pas ?', 'valider plus tard']) { await t.reply(BOSS, text); assert.equal(t.find().status, 'proposed', text); }
  } finally { t.close(); }
});

test('Une alerte qui n’est pas arrivée (WhatsApp l’a refusée) ne peut pas être validée par « Valider »', async () => {
  const t = await setup(BOSS + '=chef@example.test', {refuse: text => /Cité des Arts/.test(text)});
  try {
    fiber(t, 'YOP-07'); fiber(t, 'COC-03');
    await t.alerts();
    assert.ok(!t.to(BOSS).some(m => /Cité des Arts/.test(m.text)));
    assert.match((await t.reply(BOSS, 'Valider')).text, /C’est validé : coupure fibre à Niangon/, 'la seule alerte reçue est celle de Niangon');
    assert.equal(t.find('COC-03').status, 'proposed');
  } finally { t.close(); }
});

test('Plan revu depuis l’alerte (autre cause) : « Valider » refuse et renvoie vers l’espace Moov', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    fiber(t, 'YOP-07'); await t.alerts();
    const i = t.find(), plan = {...i.plan, cause: 'POWER_OUTAGE', dispatch: false};
    t.s.run('UPDATE noc_incidents SET plan=? WHERE id=?', JSON.stringify(plan), i.id);
    assert.match((await t.reply(BOSS, 'Valider')).text, /Guardian a revu son diagnostic depuis mon alerte : coupure de courant à Niangon \(Yopougon\)/);
    assert.equal(t.find().status, 'proposed');
  } finally { t.close(); }
});

test('Sans réponse possible (Twilio, ou Green API sans webhook), aucun bouton et aucune consigne « Valider »', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    fiber(t, 'YOP-07');
    const now = Date.now() + F.THINK + 500;
    for (const env of [{TWILIO_ACCOUNT_SID: 'AC0', TWILIO_AUTH_TOKEN: 'x', WHATSAPP_CLIENTS: BOSS + '=chef@example.test'}, {...BASE, GREENAPI_WEBHOOK_TOKEN: '', WHATSAPP_CLIENTS: BOSS + '=chef@example.test'}]) {
      const team = W.outbox(t.s, W.config(env), now).filter(m => m.role === 'team' && m.phone === BOSS);
      assert.ok(team.length && team.every(m => !m.ask), env.TWILIO_ACCOUNT_SID ? 'Twilio' : 'Green API sans webhook');
    }
  } finally { t.close(); }
});

// ——— Le jury reçoit l'alerte sur son propre WhatsApp ———
const JURY = '2250707123456', JURY2 = '2250101020304';
async function room(t, {network = true} = {}) {
  const origin = 'http://127.0.0.1:' + t.server.address().port;
  jury.step(t.s, t.chef.id, network ? {type: 'open', ssid: 'MOOV-FIBRE-DEMO'} : {type: 'open'}, origin);
  return {origin, code: jury.status(t.s, t.chef.id, origin).room.code};
}
// Inscription avec un numéro, puis « OUI » depuis ce téléphone.
async function juror(t, code, firstName, whatsapp, phone) {
  const r = await t.join(code, {firstName, whatsapp});
  assert.equal(r.status, 201);
  await t.wait(phone, t.to(phone).length + 1);
  const ok = await t.reply(phone, 'Oui');
  assert.match(ok.text, /C’est activé/);
  return (await r.json()).user;
}

test('Inscription du jury : numéro facultatif, un seul message tant que le téléphone n’a pas répondu « OUI »', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    const {code} = await room(t);
    // Un numéro relié dans l'hébergeur prend une des 3 discussions gratuites : il reste 2 places pour le jury.
    assert.deepEqual(await (await t.get('/api/jury/places')).json(), {whatsapp: 2});
    const a = await t.join(code, {firstName: 'Koffi', whatsapp: '07 07 12 34 56'});
    assert.equal(a.status, 201);
    const hello = await t.wait(JURY, 1);
    assert.equal(hello.text, 'Moov Africa · Fibre Guardian\n\n' + W.WELCOME, 'un seul message, sans le prénom écrit par la personne qui inscrit');
    const body = await a.json();
    assert.ok(!JSON.stringify(body).includes('12 34 56') && !JSON.stringify(body).includes(JURY), 'le numéro ne revient jamais dans les réponses');
    assert.equal(jury.me(t.s, body.user.id).whatsapp, 'pending');
    // Le téléphone n'a pas encore dit « OUI » : ce qu'il écrit ne va à personne (ni au compte de Koffi).
    assert.equal((await t.reply(JURY, 'Je m’appelle Zébulon, je ne suis pas abonné')).text, 'Guardian · Moov Africa Fibre\n\n' + WB.PENDING);
    assert.ok(!JSON.stringify(require('./journey-store.cjs').get(t.s, body.user.id) || {}).includes('Zébulon'), 'le compte de Koffi ne voit pas ce message');
    assert.match((await t.reply(JURY, 'OUI')).text, /Merci Koffi ! C’est activé/);
    assert.equal(jury.me(t.s, body.user.id).whatsapp, 'on');
    // Même réponse pour un numéro déjà là et pour une salle pleine : la réponse ne dit pas qui est inscrit.
    assert.match((await (await t.join(code, {whatsapp: '+225 0707123456'})).json()).error, /ne peut pas être ajouté/);
    for (const v of ['12 34', '+225 07 07 12 34 5', '00225 07071234567']) assert.match((await (await t.join(code, {whatsapp: v})).json()).error, /10 chiffres/, v);
    assert.equal((await t.join(code, {whatsapp: '0101020304'})).status, 201);
    assert.deepEqual(await (await t.get('/api/jury/places')).json(), {whatsapp: 0});
    const full = await t.join(code, {firstName: 'Awa', whatsapp: '0505050505'});
    assert.equal(full.status, 409); assert.match((await full.json()).error, /places WhatsApp .* prises/);
    assert.equal((await t.join(code, {firstName: 'Awa'})).status, 201, 'sans numéro, on s’inscrit toujours');
    const st = jury.status(t.s, t.chef.id, '');
    assert.deepEqual(st.members.map(m => m.whatsapp), [true, false, false], 'la régie voit seulement qui reçoit l’alerte sur WhatsApp (numéro confirmé)');
    assert.ok(!JSON.stringify(st).includes(JURY), 'jamais le numéro');
    // « Stop » ne rend pas la place : WhatsApp compte chaque discussion ouverte.
    await t.reply(JURY2, 'Stop');
    assert.deepEqual(await (await t.get('/api/jury/places')).json(), {whatsapp: 0});
    assert.ok(!t.s.all('SELECT key FROM limits').some(r => r.key.includes(JURY)), 'la limite par numéro garde une empreinte, pas le numéro');
  } finally { t.close(); }
});

test('Réseau de démo : le WhatsApp du jury part au moment de « Valider », pas avant ; « Stop » l’arrête ; la fermeture efface tout', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    const {origin, code} = await room(t);
    const koffi = await juror(t, code, 'Koffi', '0707123456', JURY);
    await juror(t, code, null, '0101020304', JURY2);
    require('./vrai-test.cjs').link(t.s, koffi.id, {phone: JURY});
    const before = [JURY, JURY2].map(p => t.to(p).length);
    jury.step(t.s, t.chef.id, {type: 'cut', fault: 'fiber'}, origin);
    await t.alerts();
    assert.deepEqual([JURY, JURY2].map(p => t.to(p).length), before, 'panne non validée : rien sur le WhatsApp du jury');
    // Un juré qui écrit à Guardian avant la validation n'apprend rien non plus.
    assert.equal(require('./journey-store.cjs').sharedFault(t.s, koffi.id), null);
    assert.ok(t.to(BOSS).some(button), 'le responsable, lui, est prévenu tout de suite');
    await t.tap(BOSS, button(t.to(BOSS).find(button)));
    await t.alerts();
    for (const p of [JURY, JURY2]) assert.match(t.to(p).at(-1).text, /^Moov Africa · Fibre Guardian\n\nUn câble de fibre est coupé dans votre quartier/, 'validé : le jury reçoit l’alerte');
    assert.ok(require('./journey-store.cjs').sharedFault(t.s, koffi.id), 'validée, la panne est connue du juré');
    assert.match((await t.reply(JURY, 'Bonjour')).text, /Koffi/, 'le jury parle à Guardian avec son compte d’inscription');
    assert.match((await t.reply(JURY2, 'Stop svp')).text, /je ne vous écrirai plus sur WhatsApp/);
    assert.equal(jury.status(t.s, t.chef.id, origin).members.filter(m => m.whatsapp).length, 1);
    jury.step(t.s, t.chef.id, {type: 'close'}, origin);
    assert.equal(t.s.get('SELECT count(*) AS n FROM jury_members WHERE whatsapp IS NOT NULL').n, 0, 'salle fermée : plus aucun numéro gardé');
    for (const [table, col] of [['noc_whatsapp', 'phone'], ['wa_menu', 'phone'], ['wa_inbox', 'phone'], ['speed_links', 'phone']])
      assert.equal(t.s.get('SELECT count(*) AS n FROM ' + table + ' WHERE ' + col + ' IN (?,?)', JURY, JURY2).n, 0, table);
    const after = t.to(JURY).length; await t.post(message(JURY, 'Bonjour')); await new Promise(r => setTimeout(r, 300));
    assert.equal(t.to(JURY).length, after, 'après la démonstration, le numéro redevient inconnu : Guardian ne lui écrit plus');
  } finally { t.close(); }
});

test('Réseau de démo : le juré qui écrit à Guardian n’apprend la panne qu’après « Valider », puis reçoit le lien de suivi du technicien', async () => {
  const t = await setup(BOSS + '=chef@example.test', {env: {GUARDIAN_ORIGIN: 'https://fibre-guardian.example'}});
  try {
    const {origin, code} = await room(t);
    await juror(t, code, 'Koffi', '0707123456', JURY);
    jury.step(t.s, t.chef.id, {type: 'cut', fault: 'fiber'}, origin);
    await t.alerts();
    const before = (await t.reply(JURY, 'Le technicien arrive quand ?')).text;
    assert.match(before, /Aucune intervention n’est en cours/, 'panne pas encore validée : Guardian n’en parle pas au juré');
    assert.doesNotMatch(before, /suivi=/);
    await t.tap(BOSS, button(t.to(BOSS).find(button)));
    await t.alerts();
    const validated = (await t.reply(JURY, 'Le technicien arrive quand ?')).text;
    assert.match(validated, /un câble de fibre est coupé/); assert.doesNotMatch(validated, /suivi=/, 'pas encore de technicien : pas de lien');
    jury.step(t.s, t.chef.id, {type: 'send'}, origin);
    await t.alerts();
    assert.match((await t.reply(JURY, 'Le technicien arrive quand ?')).text, /en route.*\n\nSuivez le trajet de \S+ en direct : https:\/\/fibre-guardian\.example\/codex\/\?suivi=[\w-]+$/s);
    jury.step(t.s, t.chef.id, {type: 'arrive'}, origin);
    assert.match((await t.reply(JURY, 'Qu’est-ce qui se passe ?')).text, /sur place.*\n\nSuivez l’intervention de \S+ en direct : https:\/\/fibre-guardian\.example\/codex\/\?suivi=/s);
  } finally { t.close(); }
});

test('Salle sans réseau de démo : le jury reçoit l’alerte WhatsApp dès que Guardian a fini, comme dans l’application', async () => {
  const t = await setup('');
  try {
    const {origin, code} = await room(t, {network: false});
    assert.deepEqual(await (await t.get('/api/jury/places')).json(), {whatsapp: 3});
    await juror(t, code, 'Aya', '0707123456', JURY);
    jury.step(t.s, t.chef.id, {type: 'cut'}, origin);
    await t.alerts();
    assert.ok(t.to(JURY).some(m => /Un câble de fibre est coupé/.test(m.text)));
  } finally { t.close(); }
});

test('Numéro donné mais jamais confirmé : aucune alerte, même pendant une panne', async () => {
  const t = await setup('');
  try {
    const {origin, code} = await room(t, {network: false});
    assert.equal((await t.join(code, {whatsapp: '0707123456'})).status, 201);
    await t.wait(JURY, 1);
    jury.step(t.s, t.chef.id, {type: 'cut'}, origin);
    await t.alerts();
    assert.equal(t.to(JURY).length, 1, 'seulement le premier message');
  } finally { t.close(); }
});

test('Un numéro aussi réglé comme client : « Stop » ou la fermeture ne lui renvoient pas l’alerte', async () => {
  const t = await setup(AWA + '=awa@example.test');
  try {
    const {origin, code} = await room(t, {network: false});
    await juror(t, code, 'Awa', '0701020304', AWA);
    jury.step(t.s, t.chef.id, {type: 'cut'}, origin);
    await t.alerts();
    const alerts = () => t.to(AWA).filter(m => /Un câble de fibre est coupé/.test(m.text)).length;
    assert.equal(alerts(), 1, 'une seule alerte pour ce téléphone');
    await t.reply(AWA, 'Stop');
    await t.alerts();
    jury.step(t.s, t.chef.id, {type: 'close'}, origin);
    await t.alerts();
    assert.equal(alerts(), 1);
  } finally { t.close(); }
});

test('Salle fermée pendant les envois : le message suivant du jury ne part pas', async () => {
  let closeNow = null;
  const t = await setup('', {onSend: async chatId => { if (chatId === JURY + '@c.us' && closeNow) { const c = closeNow; closeNow = null; c(); } }});
  try {
    const {origin, code} = await room(t, {network: false});
    await juror(t, code, 'Aya', '0707123456', JURY);
    await juror(t, code, 'Yao', '0101020304', JURY2);
    jury.step(t.s, t.chef.id, {type: 'cut'}, origin);
    closeNow = () => jury.step(t.s, t.chef.id, {type: 'close'}, origin);
    const n2 = t.to(JURY2).length;
    await t.alerts();
    assert.equal(t.to(JURY2).length, n2, 'Yao n’est plus inscrit quand vient son tour');
    assert.equal(t.s.get('SELECT count(*) AS n FROM noc_whatsapp WHERE phone=?', JURY2).n, 0);
  } finally { t.close(); }
});

test('Salle expirée sans fermeture : les numéros sont effacés par le ménage du site', async () => {
  const t = await setup('');
  try {
    const {code} = await room(t, {network: false});
    await juror(t, code, 'Aya', '0707123456', JURY);
    t.s.run('UPDATE jury_rooms SET expires=?', Date.now() - 1000);
    jury.forgetWhatsapp(t.s);
    assert.equal(t.s.get('SELECT count(*) AS n FROM jury_members WHERE whatsapp IS NOT NULL').n, 0);
  } finally { t.close(); }
});

test('Un numéro relié seulement au compte d’un responsable, inscrit au jury : il parle comme membre du jury', async () => {
  const t = await setup(BOSS + '=chef@example.test');
  try {
    const {code} = await room(t, {network: false});
    await juror(t, code, 'Koffi', '0705050505', BOSS);
    assert.match((await t.reply(BOSS, 'Bonjour')).text, /Bonjour Koffi/);
    assert.match((await t.reply(BOSS, 'Stop')).text, /Les alertes de l’équipe Moov continuent/);
  } finally { t.close(); }
});

test('Sans Green API (ou WHATSAPP_JURY_MAX=0), aucun champ WhatsApp : un numéro envoyé quand même est ignoré', async () => {
  assert.equal(W.config({...BASE, WHATSAPP_JURY_MAX: '0'}).jury, 0);
  assert.equal(W.config({...BASE, WHATSAPP_JURY_MAX: '50'}).jury, 20);
  assert.equal(W.config({...BASE, WHATSAPP_CLIENTS: '2250701020304=a@b.c,2250701020305=d@e.f,2250701020306=g@h.i,2250701020307=j@k.l'}).jury, 0);
  assert.equal(W.config({TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'x'}).jury, undefined, 'Twilio n’écrit qu’aux numéros du bac à sable');
  const t = await setup(BOSS + '=chef@example.test', {env: {WHATSAPP_JURY_MAX: '0'}});
  try {
    const {code} = await room(t);
    assert.deepEqual(await (await t.get('/api/jury/places')).json(), {whatsapp: 0});
    assert.equal((await t.join(code, {whatsapp: '0707123456'})).status, 201);
    assert.equal(t.s.get('SELECT count(*) AS n FROM jury_members WHERE whatsapp IS NOT NULL').n, 0);
  } finally { t.close(); }
  for (const [v, want] of [['07 07 12 34 56', '2250707123456'], ['+225 07-07-12-34-56', '2250707123456'], ['00225 0707123456', '2250707123456'], ['+33 6 12 34 56 78', '33612345678'], ['', null]]) assert.equal(jury.cleanWhatsapp(v), want, v);
  for (const v of ['0707', '7071234567', '+0 123', 'abc', '+225 0707123', '+225070712345678']) assert.throws(() => jury.cleanWhatsapp(v), /10 chiffres/, v);
});

test('Ancien format ivoirien : le compte WhatsApp du juré est à 8 chiffres, Guardian l’écrit comme WhatsApp le connaît', async () => {
  const OLD = '22507123456';
  const t = await setup('', {accounts: [OLD]});
  try {
    const {origin, code} = await room(t, {network: false});
    assert.equal((await t.join(code, {firstName: 'Aya', whatsapp: '07 07 12 34 56'})).status, 201);
    assert.equal((await t.wait(OLD, 1))?.text, 'Moov Africa · Fibre Guardian\n\n' + W.WELCOME, 'le premier message part vers 225 + 8 chiffres');
    assert.match((await t.reply(OLD, 'oui')).text, /Merci Aya/);
    assert.equal(t.to(JURY).length, 0, 'rien vers un numéro sans WhatsApp');
    jury.step(t.s, t.chef.id, {type: 'cut'}, origin);
    await t.alerts();
    assert.ok(t.to(OLD).some(m => /Un câble de fibre est coupé/.test(m.text)), 'l’alerte aussi');
    assert.match((await t.reply(OLD, 'Bonjour')).text, /Aya/, 'et Guardian la reconnaît quand elle répond');
  } finally { t.close(); }
  const cfg = {provider: 'greenapi', url: 'http://green.example', id: '1', token: 't'};
  const answer = v => async () => ({ok: true, json: async () => v});
  assert.equal(await W.reachable(cfg, JURY, answer({})), JURY, 'réponse incomplète : on garde le format à 10 chiffres');
  assert.equal(await W.reachable(cfg, JURY, async () => { throw new Error('réseau'); }), JURY);
  assert.equal(await W.reachable(cfg, '33612345678', answer({existsWhatsapp: false})), '33612345678', 'hors Côte d’Ivoire : rien à essayer');
});

// Offre gratuite « Developer » de Green API : 3 discussions par mois. Les places prises, Green API répond 466 à tout nouveau numéro.
const login = async (t, email, password) => { const r = await fetch(t.base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password})}); assert.equal(r.status, 200); return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); };
const regie = async (t, cookie) => (await fetch(t.base + '/api/regie', {headers: {Cookie: cookie}})).json();

test('Offre gratuite de Green API pleine (466) : l’alerte échoue avec une explication claire ; la Régie, le Superviseur et le formulaire du jury le disent', async () => {
  const env = {...BASE, WHATSAPP_CLIENTS: BOSS + '=chef@example.test'}, cfg = W.config(env);
  const t = await setup(BOSS + '=chef@example.test', {refuse: () => true});
  try {
    const cookie = await login(t, 'chef@example.test', 'chef-password-1234');
    assert.equal((await regie(t, cookie)).whatsapp, 'on');
    const {code} = await room(t);
    assert.deepEqual(await (await t.get('/api/jury/places')).json(), {whatsapp: 2});
    fiber(t, 'COC-03'); const done = await t.alerts();
    assert.ok(done.length && done.every(m => m.status === 'failed'), 'Green API a tout refusé');
    assert.equal(t.s.get("SELECT error FROM noc_whatsapp WHERE status='failed' LIMIT 1").error, W.QUOTA);
    assert.match(W.QUOTA, /pleine ce mois-ci .* avant le 1er du mois prochain/);
    assert.ok(W.full(t.s, cfg));
    // Régie : « en pause » ; formulaire du jury : plus de place WhatsApp, un numéro envoyé quand même est ignoré.
    assert.equal((await regie(t, cookie)).whatsapp, 'full');
    assert.deepEqual(await (await t.get('/api/jury/places')).json(), {whatsapp: 0});
    const before = t.sent.length, r = await t.join(code, {firstName: 'Koffi', whatsapp: '0707123456'});
    assert.equal(r.status, 201, 'l’inscription marche toujours, sans WhatsApp');
    assert.equal(jury.me(t.s, (await r.json()).user.id).whatsapp, null);
    await new Promise(res => setTimeout(res, 200)); assert.equal(t.sent.length, before, 'aucun message de bienvenue');
    // Superviseur : la carte « Messages WhatsApp » dit pourquoi.
    const card = require('./superviseur.cjs').bilan(t.s, t.chef.id, {whatsapp: W.status(t.s, cfg)}).agents.find(a => a.key === 'whatsapp');
    assert.equal(card.tone, 'warn'); assert.match(card.text, /^Offre gratuite de Green API pleine ce mois-ci/);
    // Le 1er du mois suivant, ou avec une autre instance Green API, WhatsApp revient.
    const next = new Date(); next.setUTCMonth(next.getUTCMonth() + 1, 1);
    assert.ok(!W.full(t.s, cfg, next.getTime()), 'le mois suivant, les places reviennent');
    assert.ok(!W.full(t.s, W.config({...env, GREENAPI_ID_INSTANCE: '7103000002'})), 'une nouvelle instance a ses propres places');
    assert.ok(!t.s.all('SELECT key FROM wa_full').some(r => r.key.includes(BOSS)), 'la marque ne garde aucun numéro');
  } finally { t.close(); }
});

test('Offre pleine découverte au message de bienvenue du jury : le numéro n’est pas gardé et le formulaire ne propose plus WhatsApp', async () => {
  const t = await setup(BOSS + '=chef@example.test', {refuse: text => text.includes(W.WELCOME)});
  try {
    const {code} = await room(t);
    const r = await t.join(code, {firstName: 'Koffi', whatsapp: '0707123456'}), id = (await r.json()).user.id;
    assert.equal(r.status, 201);
    for (let k = 0; k < 100 && jury.me(t.s, id).whatsapp; k++) await new Promise(res => setTimeout(res, 30));
    assert.equal(jury.me(t.s, id).whatsapp, null, 'le numéro qui ne peut rien recevoir ce mois-ci est effacé');
    assert.equal(t.s.get('SELECT count(*) AS n FROM jury_members WHERE whatsapp IS NOT NULL').n, 0);
    assert.deepEqual(await (await t.get('/api/jury/places')).json(), {whatsapp: 0});
  } finally { t.close(); }
});

test('Réponse de Guardian refusée par Green API (466) : l’offre est marquée pleine pour le reste du mois', async () => {
  const t = await setup(AWA + '=awa@example.test', {refuse: () => true});
  try {
    const cfg = W.config({...BASE, WHATSAPP_CLIENTS: AWA + '=awa@example.test'});
    assert.ok(!W.full(t.s, cfg));
    await t.post(message(AWA, 'Bonjour'));
    for (let k = 0; k < 100 && !W.full(t.s, cfg); k++) await new Promise(res => setTimeout(res, 30));
    assert.ok(W.full(t.s, cfg));
  } finally { t.close(); }
});
