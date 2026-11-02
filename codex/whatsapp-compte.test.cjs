'use strict';
// Le client relie son WhatsApp à son compte dans « Mon compte » : l'application lui donne un code à usage unique, WhatsApp
// s'ouvre avec un message tout prêt ; le téléphone l'envoie, puis le client confirme ce numéro dans l'application.
// Guardian n'écrit qu'après cette confirmation. Ensuite, les pannes de son quartier arrivent sur WhatsApp et Guardian lui
// répond avec son compte. « Stop » (WhatsApp) ou « Arrêter » (application) défait le lien.
// Places : les 3 discussions gratuites de Green API restent au jury ; un nouveau numéro n'en prend une que si
// WHATSAPP_COMPTE_MAX le permet, une par compte.
const {test, beforeEach} = require('node:test'), assert = require('node:assert/strict');
const C = require('./whatsapp-compte.cjs'), W = require('./whatsapp.cjs'), N = require('./noc-store.cjs'), O = require('./operator-store.cjs'), F = require('./sim-flow.js');
const jury = require('./jury-store.cjs'), journey = require('./journey-store.cjs'), {createGuardianServer} = require('./pilot-server.cjs');

const GUARDIAN = '2250102030405', BOSS = '2250705050505', AWA = '2250707123456', AWA_OLD = '22507123456', KOFFI = '2250101020304', AYA = '2250505060708', SECRET = 'secret-green-api-de-test-1234';
const GREEN = {GREENAPI_ID_INSTANCE: '7103000001', GREENAPI_API_TOKEN: 'jeton-instance-de-test', GREENAPI_WEBHOOK_TOKEN: SECRET, WHATSAPP_CLIENTS: BOSS + '=chef@example.test'};
// Hébergeur qui laisse des places aux clients de l'application (offre payante, ou choix de l'équipe).
const OPEN = {...GREEN, WHATSAPP_JURY_MAX: '5', WHATSAPP_COMPTE_MAX: '5'};
const BOT = 'Guardian · Moov Africa Fibre\n\n';
const NONE = {available: true, state: 'none', number: null, end: null, zone: 'Niangon (Yopougon)', problem: null};
// L'alerte « client » d'une coupure fibre (sim-flow.js), telle qu'elle arrive sur WhatsApp.
const CUT = /^Moov Africa · Fibre Guardian\n\nUn câble de fibre est coupé dans votre quartier/;
const message = (phone, text) => ({typeWebhook: 'incomingMessageReceived', idMessage: 'MSG' + Math.random().toString(36).slice(2), timestamp: Math.floor(Date.now() / 1000), senderData: {chatId: phone + '@c.us'}, messageData: {typeMessage: 'textMessage', textMessageData: {textMessage: text}}});
beforeEach(() => C.forgetNumbers()); // le numéro de Guardian est gardé en mémoire : chaque test repart de zéro

async function setup(env = OPEN, {refuse = null, wid = GUARDIAN + '@c.us'} = {}) {
  const server = createGuardianServer({db: ':memory:', env, onError: () => {}}), s = server.guardianStore;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port, sent = [], asked = [], real = globalThis.fetch;
  // Faux Green API : ses réglages donnent le numéro de Guardian (« wid ») ; chaque message envoyé est noté.
  const fake = async (url, init = {}) => {
    if (String(url).startsWith(base)) return real(url, init);
    const method = String(url).split('/')[4];
    if (method === 'getSettings') { asked.push(method); return wid ? {ok: true, status: 200, json: async () => ({wid, webhookUrl: ''})} : {ok: false, status: 500, json: async () => ({})}; }
    const d = JSON.parse(init.body), text = d.message ?? ((d.header ? d.header + '\n\n' : '') + d.body), no = refuse?.(text);
    if (no) return {ok: false, status: no, json: async () => ({})};
    sent.push({method, chatId: d.chatId, text});
    return {ok: true, status: 200, json: async () => ({idMessage: 'OUT'})};
  };
  globalThis.fetch = fake;
  const chef = (await s.register({email: 'chef@example.test', password: 'chef-password-1234', name: 'Chef Moov'})).user; O.grant(s, 'chef@example.test', 'admin');
  const cookieOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const as = (cookie, csrf) => async (method = 'GET', path = '/api/whatsapp/compte') => { const r = await real(base + path, {method, headers: {Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf}}); return {status: r.status, data: await r.json()}; };
  // Un client de l'application, connecté avec son cookie de session (comme le téléphone du client).
  async function client(email, name, segment = 'YOP-07') {
    const res = await real(base + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'mot-de-passe-1234', name})});
    const {user} = await res.json(), app = as(cookieOf(res), user.csrf);
    if (segment) N.join(s, user.id, {segment, consent: true});
    return {user, app, begin: () => app('POST'), stop: () => app('DELETE'), confirm: () => app('POST', '/api/whatsapp/compte/confirmer')};
  }
  async function login(email, password) { const res = await real(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password})}); const {user} = await res.json(); return as(cookieOf(res), user.csrf); }
  const post = d => real(base + '/api/whatsapp/entrant', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + SECRET}, body: JSON.stringify(d)});
  const to = phone => sent.filter(m => m.chatId === phone + '@c.us');
  const wait = async (phone, n) => { for (let k = 0; k < 100 && to(phone).length < n; k++) await new Promise(r => setTimeout(r, 30)); return to(phone)[n - 1]; };
  const reply = async (phone, text) => { const n = to(phone).length + 1; await post(message(phone, text)); return wait(phone, n); };
  // Message qui ne doit recevoir aucune réponse : on laisse à Guardian le temps de (ne pas) répondre.
  const silent = async (phone, text) => { const n = to(phone).length; await post(message(phone, text)); await new Promise(r => setTimeout(r, 300)); return to(phone).length === n; };
  const ready = code => C.ready(code.replace(' ', ''));
  // Le client touche « Relier mon WhatsApp », son téléphone envoie le message tout prêt (sans réponse), puis il confirme
  // son numéro dans l'application. Retourne la réponse de l'application à la confirmation.
  const send = async (who, phone) => { const r = await who.begin(); assert.equal(r.status, 200, JSON.stringify(r.data)); assert.ok(await silent(phone, ready(r.data.code)), 'Guardian ne répond rien au code'); return r; };
  const link = async (who, phone) => { await send(who, phone); return who.confirm(); };
  const alerts = () => W.tick(s, W.config(env), {fetchImpl: fake, now: Date.now() + F.THINK + 500, wait: async () => {}});
  const close = () => { globalThis.fetch = real; server.close(); };
  return {server, s, base, chef, client, login, sent, asked, to, post, wait, reply, silent, ready, send, link, alerts, close};
}
const fiber = (t, segment) => N.operate(t.s, t.chef.id, {type: 'simulate', segment, scenario: 'fiber'});
const places = async t => (await (await fetch(t.base + '/api/jury/places')).json()).whatsapp;

test('Sans Green API branché, sans réponses de WhatsApp ou sans le numéro de Guardian, la carte n’apparaît pas', async () => {
  for (const [env, opt] of [[{}, {}], [{...OPEN, GREENAPI_WEBHOOK_TOKEN: ''}, {}], [OPEN, {wid: null}]]) {
    C.forgetNumbers();
    const t = await setup(env, opt);
    try {
      const awa = await t.client('awa@example.test', 'Awa Koné');
      assert.deepEqual((await awa.app()).data, {...NONE, available: false});
      const r = await awa.begin();
      assert.equal(r.status, 409); assert.doesNotMatch(r.data.error, /Green|webhook|API/i, 'aucun mot technique pour le client');
      assert.equal(t.sent.length, 0);
    } finally { t.close(); }
  }
});

test('« Relier mon WhatsApp » : un code, un lien wa.me tout prêt ; le numéro est confirmé dans l’application avant le premier message', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné');
    assert.deepEqual((await awa.app()).data, NONE);
    const r = await awa.begin();
    assert.equal(r.status, 200); assert.equal(r.data.state, 'waiting');
    assert.match(r.data.code, /^\d{3} \d{3}$/);
    const code = r.data.code.replace(' ', '');
    assert.equal(r.data.link, 'https://wa.me/' + GUARDIAN + '?text=' + encodeURIComponent('Bonjour Guardian ! Je relie mon WhatsApp à mon compte Fibre Guardian. Code : ' + code));
    assert.equal(t.sent.length, 0, 'Guardian n’écrit jamais le premier');
    assert.equal(t.asked.length, 1, 'le numéro de Guardian est demandé une fois à Green API');
    await awa.app(); assert.equal(t.asked.length, 1, 'puis gardé en mémoire');
    // Le téléphone envoie le message tout prêt : Guardian ne répond rien, l'application demande « est-ce bien vous ? ».
    assert.ok(await t.silent(AWA, t.ready(r.data.code)));
    const ask = (await awa.app()).data;
    assert.equal(ask.state, 'confirm'); assert.equal(ask.number, '07 •• •• •• 56'); assert.equal(ask.end, '56');
    assert.equal(C.byPhone(t.s, AWA), null, 'rien n’est relié avant la confirmation');
    assert.ok(await t.silent(AWA, 'Bonjour'), 'toujours inconnu : silence');
    // Le client confirme : le lien est fait, et Guardian lui écrit pour la première fois.
    const on = (await awa.confirm()).data;
    assert.deepEqual(on, {...NONE, state: 'on', number: '07 •• •• •• 56', end: '56'});
    assert.ok(!JSON.stringify(on).includes(AWA) && !JSON.stringify(on).includes('12 34'), 'le numéro entier ne revient jamais à l’écran');
    assert.match((await t.wait(AWA, 1)).text, /^Guardian · Moov Africa Fibre\n\nMerci Awa ! Votre WhatsApp est relié à votre compte Fibre Guardian\. Je vous écris ici si une panne touche Niangon \(Yopougon\)\..*Répondez « Stop » pour arrêter\.$/s);
    // Guardian répond maintenant avec le compte d'Awa : son prénom, son dossier.
    assert.match((await t.reply(AWA, 'Bonjour')).text, /Bonjour Awa ! Je suis Guardian/);
    // Un code ne sert qu'une fois : un autre téléphone qui le renvoie n'obtient rien.
    assert.ok(await t.silent(KOFFI, t.ready(r.data.code)));
    assert.ok(!t.s.all('SELECT phone FROM wa_accounts').some(x => x.phone === KOFFI));
    assert.equal((await awa.begin()).status, 409, 'déjà relié : pas de nouveau code');
  } finally { t.close(); }
});

test('Code vu par quelqu’un d’autre (écran projeté, QR scanné) : son téléphone n’est jamais relié sans l’accord du client', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné'), r = await awa.begin();
    // Quelqu'un dans la salle envoie le code avant Awa : il ne reçoit rien, ni prénom ni quartier.
    assert.ok(await t.silent(AYA, t.ready(r.data.code)));
    const ask = (await awa.app()).data;
    assert.equal(ask.state, 'confirm'); assert.equal(ask.number, '05 •• •• •• 08', 'Awa voit que ce n’est pas son numéro');
    assert.ok(await t.silent(AYA, 'Où en est la réparation ?'), 'l’inconnu ne parle pas au nom d’Awa');
    assert.ok(!JSON.stringify(journey.get(t.s, awa.user.id) || {}).includes('réparation ?'), 'ses messages ne vont pas dans le dossier d’Awa');
    // « Non, ce n'est pas moi » : rien n'est relié, le code ne vaut plus rien.
    assert.deepEqual((await awa.stop()).data, NONE);
    assert.ok(await t.silent(AWA, t.ready(r.data.code)), 'le code utilisé ne sert plus, même au vrai téléphone');
    assert.equal((await awa.confirm()).status, 409, 'plus rien à confirmer');
    assert.equal(C.byPhone(t.s, AYA), null); assert.equal(t.sent.length, 0, 'aucun message n’est parti');
    // Awa recommence avec un nouveau code, depuis son téléphone.
    assert.equal((await t.link(awa, AWA)).data.state, 'on');
  } finally { t.close(); }
});

test('Code faux, déjà utilisé ou expiré : le message ne relie rien et Guardian reste muet', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné'), r = await awa.begin();
    const wrong = String((Number(r.data.code.replace(' ', '')) + 1) % 1000000).padStart(6, '0');
    assert.ok(await t.silent(AWA, t.ready(wrong)), 'mauvais code : silence (numéro inconnu)');
    assert.equal((await awa.app()).data.state, 'waiting');
    t.s.run('UPDATE wa_codes SET expires=?', Date.now() - 1);
    assert.ok(await t.silent(AWA, t.ready(r.data.code)), 'code expiré : silence');
    assert.deepEqual((await awa.app()).data, NONE, 'la carte revient au début');
    // Numéro reçu mais jamais confirmé : au bout de 15 minutes, il ne reste rien.
    const again = await t.send(awa, AWA);
    assert.ok(again);
    t.s.run('UPDATE wa_codes SET expires=?', Date.now() - 1);
    assert.equal((await awa.confirm()).status, 409);
    assert.deepEqual((await awa.app()).data, NONE);
  } finally { t.close(); }
});

test('Personne ne peut prendre le WhatsApp d’un autre : les réponses d’un téléphone relié ne déplacent jamais le lien', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné'), intrus = await t.client('intrus@example.test', 'Intrus');
    await t.link(awa, AWA);
    // L'intrus demande un code : rien ne part vers Awa, et ses réponses polies ne déplacent rien.
    const r = await intrus.begin(); assert.equal(r.data.state, 'waiting');
    assert.equal(t.to(AWA).length, 1, 'aucun message de plus vers Awa');
    for (const text of ['ok merci', 'OUI', 'Bonjour']) assert.ok(!(await t.reply(AWA, text)).text.includes('Intrus'), text);
    assert.equal((await awa.app()).data.state, 'on');
    assert.equal((await intrus.app()).data.state, 'waiting');
    assert.equal((await intrus.confirm()).status, 409, 'aucun numéro à confirmer');
    assert.ok(!JSON.stringify(journey.get(t.s, intrus.user.id) || {}).includes('ok merci'), 'les messages d’Awa ne vont jamais au compte de l’intrus');
    // Awa crée un second compte : son téléphone déjà relié ne change pas de compte tant qu'il n'a pas dit « Stop ».
    const awa2 = await t.client('awa2@example.test', 'Awa Bis'), c2 = await awa2.begin();
    assert.equal((await t.reply(AWA, t.ready(c2.data.code))).text, BOT + C.TAKEN);
    assert.equal((await awa2.app()).data.state, 'waiting'); assert.equal((await awa.app()).data.state, 'on');
    await t.reply(AWA, 'Stop');
    assert.equal((await t.link(awa2, AWA)).data.state, 'on');
    assert.match(t.to(AWA).at(-1).text, /Merci Awa !/);
    assert.equal((await awa.app()).data.state, 'none'); assert.equal((await awa2.app()).data.state, 'on');
  } finally { t.close(); }
});

test('Seul le message tout prêt relie : un code glissé dans une phrase, ou envoyé par un téléphone déjà relié, ne déplace rien', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné'), intrus = await t.client('intrus@example.test', 'Intrus Malin');
    await t.link(awa, AWA);
    const r = await intrus.begin(), code = r.data.code;
    // Awa écrit à Guardian une phrase qui contient, par hasard ou par ruse, le code de l'intrus : réponse habituelle.
    const answer = await t.reply(AWA, 'mon numéro de ticket est le ' + code);
    assert.doesNotMatch(answer.text, /relié|Intrus/);
    assert.equal((await intrus.app()).data.state, 'waiting', 'le code n’est pas utilisé');
    // Même avec le message tout prêt : ce WhatsApp est à Awa, il ne passe pas au compte de l'intrus.
    assert.equal((await t.reply(AWA, t.ready(code))).text, BOT + C.TAKEN);
    assert.equal((await intrus.confirm()).status, 409);
    assert.equal(C.byPhone(t.s, AWA).name, 'Awa Koné');
    assert.match((await t.reply(AWA, 'Bonjour')).text, /Bonjour Awa !/);
  } finally { t.close(); }
});

test('Un autre numéro à 10 chiffres qui finit comme l’ancien format d’Awa n’est jamais pris pour elle', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné');
    await t.link(awa, AWA_OLD); // 225 + 8 chiffres : 07 12 34 56
    const other = '2250507123456'; // 05 07 12 34 56 : une autre personne
    assert.equal(C.byPhone(t.s, other), null);
    assert.ok(await t.silent(other, 'Bonjour'), 'pas de « Bonjour Awa » pour un autre téléphone');
    assert.ok(await t.silent(other, 'Stop'), 'son « Stop » ne touche pas au lien d’Awa');
    assert.equal((await awa.app()).data.state, 'on');
  } finally { t.close(); }
});

test('Panne dans le quartier du compte : le WhatsApp relié reçoit l’alerte, pas celui d’un autre quartier', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné'), koffi = await t.client('koffi@example.test', 'Koffi', 'COC-03'), aya = await t.client('aya@example.test', 'Aya');
    await t.link(awa, AWA); await t.link(koffi, KOFFI);
    await t.send(aya, AYA); // message envoyé, numéro jamais confirmé
    fiber(t, 'YOP-07'); await t.alerts();
    assert.ok(t.to(AWA).some(m => CUT.test(m.text)), 'Awa reçoit l’alerte de son quartier sur son WhatsApp');
    assert.ok(!t.to(KOFFI).some(m => CUT.test(m.text)), 'Koffi habite Cocody : rien');
    assert.equal(t.to(AYA).length, 0, 'numéro pas confirmé : rien ne part vers Aya');
    assert.equal(W.status(t.s, W.config(OPEN)).phones, 3, 'le chef réglé dans l’hébergeur, Awa et Koffi');
  } finally { t.close(); }
});

test('« Stop » sur WhatsApp défait le lien ; « Arrêter » dans l’application aussi, et plus rien ne part', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné');
    await t.link(awa, AWA);
    assert.equal((await t.reply(AWA, 'Stop')).text, BOT + C.STOPPED);
    assert.equal((await awa.app()).data.state, 'none');
    assert.ok(await t.silent(AWA, 'Bonjour'), 'numéro délié : Guardian ne répond plus');
    // On relie de nouveau (discussion déjà ouverte : pas de nouvelle place), puis « Arrêter » dans l'application.
    assert.equal((await t.link(awa, AWA)).data.state, 'on');
    await t.reply(AWA, 'Bonjour');
    const r = await awa.stop();
    assert.equal(r.status, 200); assert.equal(r.data.state, 'none');
    assert.ok(await t.silent(AWA, 'Bonjour'));
    fiber(t, 'YOP-07'); await t.alerts();
    assert.ok(!t.to(AWA).some(m => CUT.test(m.text)), 'aucune alerte après « Arrêter »');
    assert.ok(!t.s.all('SELECT phone FROM wa_menu').some(x => x.phone === AWA), 'ce que le site gardait sur ce numéro est effacé');
  } finally { t.close(); }
});

test('Numéro aussi réglé dans l’hébergeur : après « Stop » ou « Arrêter », les alertes client s’arrêtent vraiment', async () => {
  const env = {...GREEN, WHATSAPP_CLIENTS: BOSS + '=chef@example.test,' + AWA + '=awa@example.test'};
  for (const how of ['whatsapp', 'app']) {
    const t = await setup(env);
    try {
      const awa = await t.client('awa@example.test', 'Awa Koné');
      // Numéro déjà réglé : il se relie sans prendre de place, même sans WHATSAPP_COMPTE_MAX.
      assert.equal((await t.link(awa, AWA)).data.state, 'on');
      if (how === 'whatsapp') assert.equal((await t.reply(AWA, 'Stop')).text, BOT + C.STOPPED); else assert.equal((await awa.stop()).data.state, 'none');
      fiber(t, 'YOP-07'); await t.alerts();
      assert.ok(!t.to(AWA).some(m => CUT.test(m.text)), how + ' : plus d’alerte client sur ce numéro');
      assert.ok(t.to(BOSS).some(m => /Panne à Niangon/.test(m.text)), how + ' : l’équipe reçoit toujours ses alertes');
      // Relié de nouveau : les alertes reviennent.
      assert.equal((await t.link(awa, AWA)).data.state, 'on');
      N.operate(t.s, t.chef.id, {type: 'simulate', segment: 'YOP-07', scenario: 'normal', close: true});
      fiber(t, 'YOP-07'); await t.alerts();
      assert.ok(t.to(AWA).some(m => CUT.test(m.text)), how + ' : alertes revenues après le nouveau lien');
    } finally { t.close(); }
  }
});

test('« Stop » d’un numéro de l’hébergeur : gardé par « Tout remettre à zéro », et remis si le nouveau lien échoue (466)', async () => {
  const env = {...GREEN, WHATSAPP_CLIENTS: BOSS + '=chef@example.test,' + AWA + '=awa@example.test'};
  const t = await setup(env, {refuse: text => /Merci Aminata/.test(text) ? 466 : 0});
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné');
    await t.link(awa, AWA); await t.reply(AWA, 'Stop');
    assert.ok(C.muted(t.s, AWA));
    // Relié de nouveau à un autre compte, mais Green API refuse le message : le « Stop » d'avant tient toujours.
    const bis = await t.client('aminata@example.test', 'Aminata Koné');
    assert.equal((await t.link(bis, AWA)).data.problem, 'full');
    assert.ok(C.muted(t.s, AWA), 'le « Stop » est remis');
    fiber(t, 'YOP-07'); await t.alerts();
    assert.ok(!t.to(AWA).some(m => CUT.test(m.text)));
  } finally { t.close(); }
  // « Tout remettre à zéro » (démo complète) : le « Stop » reste.
  const {Store} = require('./pilot-store.cjs'), demo = require('./seed-demo.cjs'), store = new Store(':memory:');
  const server = createGuardianServer({store, env, onError: () => {}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    await demo.seedDemo(store);
    store.run('INSERT INTO wa_optout(phone,at) VALUES(?,?)', AWA, Date.now());
    assert.equal((await demo.resetDemo(store)).seeded, true);
    assert.ok(C.muted(store, AWA), 'la remise à zéro de la démo ne réabonne personne');
  } finally { server.close(); }
});

test('Places du jury gardées : par défaut, seul un numéro qui a déjà sa discussion peut être relié depuis l’application', async () => {
  const t = await setup(GREEN); // offre gratuite : 3 discussions, dont une pour le chef ; WHATSAPP_COMPTE_MAX absent
  try {
    jury.step(t.s, t.chef.id, {type: 'open'}, t.base);
    assert.equal(await places(t), 2);
    const awa = await t.client('awa@example.test', 'Awa Koné'), fils = await t.client('fils@example.test', 'Fils du chef');
    // Nouveau numéro : confirmé, mais pas de place ; Guardian n'écrit rien, l'application le dit une fois.
    const r = await t.link(awa, AWA);
    assert.deepEqual(r.data, {...NONE, problem: 'places'});
    assert.equal(t.to(AWA).length, 0); assert.equal(C.byPhone(t.s, AWA), null);
    assert.deepEqual((await awa.stop()).data, {...NONE, refused: true}, '« Compris » : la carte ne repropose pas aussitôt le même chemin');
    assert.equal((await awa.begin()).data.state, 'waiting', '« Essayer avec un autre téléphone » reste possible');
    await awa.stop();
    assert.equal(await places(t), 2, 'les deux places du jury sont intactes');
    // Le numéro réglé dans l'hébergeur a déjà sa discussion : il peut être relié à un compte client.
    assert.equal((await t.link(fils, BOSS)).data.state, 'on');
    assert.match((await t.wait(BOSS, 1)).text, /Merci Fils/);
    assert.equal(await places(t), 2);
  } finally { t.close(); }
});

test('WHATSAPP_COMPTE_MAX : les clients prennent au plus ce nombre de places, une seule par compte', async () => {
  const env = {...GREEN, WHATSAPP_COMPTE_MAX: '1'}, t = await setup(env);
  try {
    jury.step(t.s, t.chef.id, {type: 'open'}, t.base);
    const awa = await t.client('awa@example.test', 'Awa Koné'), koffi = await t.client('koffi@example.test', 'Koffi');
    // Des codes demandés puis abandonnés ne prennent aucune place.
    for (let i = 0; i < 3; i++) { await awa.begin(); await awa.stop(); }
    assert.equal((await t.link(awa, AWA)).data.state, 'on');
    assert.equal(await places(t), 1, 'une place prise sur celles du jury');
    // Awa arrête puis essaie un autre téléphone : son compte a déjà eu sa place.
    await awa.stop();
    assert.equal((await t.link(awa, AYA)).data.problem, 'places');
    // Son premier téléphone a toujours sa discussion : il se relie sans rien prendre.
    await awa.stop();
    assert.equal((await t.link(awa, AWA)).data.state, 'on');
    // Koffi : la place des clients est prise.
    assert.equal((await t.link(koffi, KOFFI)).data.problem, 'places');
    assert.equal(await places(t), 1, 'il en reste une pour le jury');
  } finally { t.close(); }
});

test('Membre du jury inscrit avec son WhatsApp : il peut aussi relier ce numéro à un compte client, sans nouvelle place', async () => {
  const t = await setup(GREEN);
  try {
    jury.step(t.s, t.chef.id, {type: 'open'}, t.base);
    const code = jury.status(t.s, t.chef.id, t.base).room.code;
    const join = await fetch(t.base + '/api/jury/join', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code, consent: true, firstName: 'Aya', whatsapp: '0505060708'})});
    assert.equal(join.status, 201);
    await t.wait(AYA, 1); assert.match((await t.reply(AYA, 'Oui')).text, /C’est activé/);
    assert.equal(await places(t), 1);
    const aya = await t.client('aya@example.test', 'Aya Kouassi');
    assert.equal((await t.link(aya, AYA)).data.state, 'on');
    assert.equal(await places(t), 1, 'même discussion : aucune place de plus');
  } finally { t.close(); }
});

test('Ancien format ivoirien : le téléphone écrit en 225 + 8 chiffres, l’alerte part au même numéro', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné');
    assert.equal((await t.link(awa, AWA_OLD)).data.number, '•• •• •• 56');
    assert.match((await t.wait(AWA_OLD, 1)).text, /Merci Awa/);
    fiber(t, 'YOP-07'); await t.alerts();
    assert.ok(t.to(AWA_OLD).some(m => CUT.test(m.text)));
  } finally { t.close(); }
});

test('Réservé aux clients : l’équipe Moov et le jury n’ont pas cette carte', async () => {
  const t = await setup();
  try {
    const chef = await t.login('chef@example.test', 'chef-password-1234');
    assert.equal((await chef()).data.available, false);
    assert.equal((await chef('POST')).status, 403, 'un compte de l’équipe se relie dans l’hébergeur');
    assert.equal((await chef('POST', '/api/whatsapp/compte/confirmer')).status, 403);
    // Technicien de terrain : un compte sans rôle d'opérateur, mais pas un client.
    const tech = await t.client('tech@example.test', 'Ibrahim Traoré', null);
    t.s.run('INSERT INTO noc_field_accounts(user_id,technician_id,granted_by,granted_at) VALUES(?,?,?,?)', tech.user.id, 'tech-test', t.chef.id, Date.now());
    assert.equal((await tech.app()).data.available, false);
    assert.equal((await tech.begin()).status, 403); assert.equal((await tech.confirm()).status, 403);
    jury.step(t.s, t.chef.id, {type: 'open'}, t.base);
    const code = jury.status(t.s, t.chef.id, t.base).room.code;
    const res = await fetch(t.base + '/api/jury/join', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code, consent: true, firstName: 'Aya'})});
    const {user} = await res.json(), cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    for (const path of ['/api/whatsapp/compte', '/api/whatsapp/compte/confirmer']) {
      const r = await fetch(t.base + path, {method: 'POST', headers: {Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': user.csrf}});
      assert.equal(r.status, 403, 'le jury donne son numéro dans son formulaire');
    }
  } finally { t.close(); }
});

test('Offre gratuite pleine au moment d’écrire (466) : rien n’est relié, la pause est notée, l’application le dit', async () => {
  const t = await setup(OPEN, {refuse: text => /Votre WhatsApp est relié/.test(text) ? 466 : 0});
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné');
    const r = await t.link(awa, AWA);
    assert.equal(r.status, 200);
    assert.equal(W.full(t.s, W.config(OPEN)), true, 'la pause du mois est notée, comme pour le jury');
    assert.deepEqual(r.data, {...NONE, available: false, problem: 'full'});
    assert.equal(C.byPhone(t.s, AWA), null, 'le téléphone n’est pas relié');
    assert.equal(t.s.get('SELECT count(*) AS n FROM wa_places').n, 0, 'la place du compte n’est pas comptée');
    assert.deepEqual((await awa.stop()).data, {...NONE, available: false});
    assert.equal((await awa.begin()).status, 409, 'plus de nouveau code jusqu’au mois prochain');
  } finally { t.close(); }
});

test('Trop de codes demandés : une phrase simple, pas « une minute »', async () => {
  const t = await setup();
  try {
    const awa = await t.client('awa@example.test', 'Awa Koné');
    for (let i = 0; i < 10; i++) assert.equal((await awa.begin()).status, 200);
    const r = await awa.begin();
    assert.equal(r.status, 429); assert.match(r.data.error, /Réessayez dans une heure/);
  } finally { t.close(); }
});

test('Numéros masqués, formes ivoiriennes et code lu dans le message', () => {
  assert.equal(C.masked('2250707123456'), '07 •• •• •• 56');
  assert.equal(C.masked('22507123456'), '•• •• •• 56');
  assert.equal(C.masked('33612345678'), '+336 •• •• 78');
  assert.ok(C.same('22507123456', '2250707123456') && C.same('2250707123456', '22507123456') && C.same(AWA, AWA));
  assert.ok(!C.same('2250707123456', '2250507123456'), 'deux numéros à 10 chiffres différents ne sont jamais confondus');
  assert.equal(C.codeIn(C.ready('482917')), '482917');
  assert.equal(C.codeIn('Bonjour Guardian ! Je relie mon WhatsApp à mon compte Fibre Guardian. Code : 482 917'), '482917');
  assert.equal(C.codeIn('je relie mon whatsapp à mon compte fibre guardian code: 482917 '), '482917');
  for (const text of ['mon code 482 917 merci', 'Je paie 150 000 F', C.ready('4829171'), '07 07 12 34 56', '0707123456', 'Bonjour', '12345']) assert.equal(C.codeIn(text), null, text);
});

test('La carte « Vos alertes sur WhatsApp » est dans « Mon compte », aux couleurs Moov, sans mot technique', () => {
  const fs = require('node:fs'), path = require('node:path'), read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const js = read('client-home.js'), css = read('client-home.css').split('/* Vos alertes sur WhatsApp')[1] || '';
  assert.match(js, /function WhatsAppCard\(\{api,go\}\)/); assert.match(js, /api&&h\(WhatsAppCard,\{api,go\}\)/);
  assert.match(read('journey.js'), /h\(FGClientHome\.Account,\{api,user,/, 'la page Compte reçoit l’accès au serveur');
  assert.ok(css.includes('.ch-wa{'), 'styles de la carte');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'couleurs seulement par les variables --moov-*');
  const card = js.slice(js.indexOf('function WhatsAppCard'), js.indexOf('function Account'));
  assert.match(card, /Oui, c’est mon numéro/); assert.match(card, /Non, ce n’est pas moi/);
  // Les textes entre apostrophes, commentaires de code mis à part.
  const texts = (card.replace(/^\s*\/\/.*$/gm, '').match(/'[^']*'/g) || []).join(' ');
  assert.doesNotMatch(texts, /Green|webhook|\bAPI\b|simul|fictif/i, 'aucun avertissement technique à l’écran');
  assert.match(read('demo.js'), /relier son propre WhatsApp/, 'la page « À propos » dit ce qui est limité');
});
