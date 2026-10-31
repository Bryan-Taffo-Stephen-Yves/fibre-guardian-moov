'use strict';
// Vrais WhatsApp : les bons messages, aux bons téléphones, une seule fois, jamais de numéro ni de clé à l'écran.
const {test} = require('node:test'), assert = require('node:assert/strict');
const W = require('./whatsapp.cjs'), F = require('./sim-flow.js'), N = require('./noc-store.cjs'), O = require('./operator-store.cjs'), {createGuardianServer} = require('./pilot-server.cjs');

const PHONES = {bassam: '2250701020304', abobo: '2250702020202', palmeraie: '2250703030303', equipe: '2250705060708', tech: '2250709101112'};
const NUMEROS = `Grand-Bassam=+225 07 01 02 03 04, Abobo=${PHONES.abobo}, Palmeraie=${PHONES.palmeraie}, équipe=${PHONES.equipe}, technicien=${PHONES.tech}`;

async function setup(env = {}) {
  const server = createGuardianServer({db: ':memory:', env: {}, onError: () => {}}), s = server.guardianStore;
  const chef = (await s.register({email: 'chef@example.test', password: 'chef-password-1234', name: 'Chef'})).user; O.grant(s, 'chef@example.test', 'admin');
  const rose = (await s.register({email: 'rose@example.test', password: 'rose-password-1234', name: 'Rose Ehui'})).user; N.join(s, rose.id, {segment: 'BAS-01', consent: true});
  const cfg = W.config({TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 'secret-de-test', WHATSAPP_NUMEROS: NUMEROS, GUARDIAN_ORIGIN: 'https://fibre-guardian-moov.onrender.com', ...env});
  const calls = [], reply = {ok: true, json: async () => ({})};
  const fetchImpl = async (url, init) => { calls.push({url, init, form: init.headers['Content-Type'].includes('form') ? Object.fromEntries(new URLSearchParams(init.body)) : JSON.parse(init.body)}); return typeof reply === 'function' ? reply() : reply; };
  const find = seg => N.overview(s, chef.id).incidents.find(i => i.segment_id === seg && !i.terminal);
  const act = (seg, body) => { const i = find(seg); return N.operate(s, chef.id, {id: i.id, version: i.version, ...body}); };
  const tick = (now, f = fetchImpl) => W.tick(s, cfg, {fetchImpl: f, now, wait: async () => {}});
  return {server, s, chef, rose, cfg, calls, find, act, tick, sim: (segment, scenario) => N.operate(s, chef.id, {type: 'simulate', segment, scenario})};
}
const after = ms => Date.now() + F.THINK + ms;
const to = c => c.form.To || c.form.to;

test('Réglages : Twilio ou Meta selon les clés présentes, numéros lus tels qu’on les écrit', () => {
  assert.equal(W.config({}), null, 'sans clé, rien ne part');
  assert.equal(W.config({TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't'}).provider, 'twilio');
  assert.equal(W.config({WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_ID: '123 456'}).phoneId, '123456');
  assert.deepEqual(W.numbers(NUMEROS).map(n => [n.key, n.phone, n.role]), [['grandbassam', PHONES.bassam, 'client'], ['abobo', PHONES.abobo, 'client'], ['palmeraie', PHONES.palmeraie, 'client'], ['equipe', PHONES.equipe, 'team'], ['technicien', PHONES.tech, 'tech']]);
  assert.deepEqual(W.numbers('Cocody=12, =2250701020304, Yopougon'), [], 'les lignes incomplètes sont ignorées');
  assert.ok(W.livesIn('cocody', 'PAL-02') && W.livesIn('palmeraie', 'PAL-02') && W.livesIn('bas01', 'BAS-01') && !W.livesIn('palmeraie', 'COC-03'));
});

test('Green API d’abord : les alertes partent du numéro de Guardian, et un client relié par son compte reçoit les pannes de son quartier avec le lien de suivi', async () => {
  const ROSE = '22501010101';
  const t = await setup({GREENAPI_ID_INSTANCE: '7107000001', GREENAPI_API_TOKEN: 'jeton-de-test', GREENAPI_URL: 'https://7107.api.greenapi.com', WHATSAPP_NUMEROS: '', WHATSAPP_CLIENTS: ROSE + '=Rose@Example.test'});
  try {
    assert.equal(t.cfg.provider, 'greenapi', 'Green API passe avant Twilio quand les deux sont réglés');
    assert.equal(W.status(t.s, t.cfg).phones, 1);
    t.sim('ABO-01', 'fiber'); await t.tick(after(500));
    assert.equal(t.calls.length, 0, 'une panne à Abobo ne concerne pas Rose');
    t.sim('BAS-01', 'fiber'); await t.tick(after(500));
    assert.equal(t.calls.length, 1); assert.equal(t.calls[0].url, 'https://7107.api.greenapi.com/waInstance7107000001/sendMessage/jeton-de-test');
    assert.equal(t.calls[0].form.chatId, ROSE + '@c.us'); assert.match(t.calls[0].form.message, /^Moov Africa · Fibre Guardian\n\nUn câble de fibre est coupé dans votre quartier/);
    t.calls.length = 0;
    t.act('BAS-01', {type: 'approve', note: 'ok'}); t.act('BAS-01', {type: 'dispatch', technician: 'amina', safety: true}); t.act('BAS-01', {type: 'advance'});
    await t.tick(Date.now() + 500);
    assert.ok(t.calls.some(c => c.form.chatId === ROSE + '@c.us' && /Suivez son trajet en direct : https:\/\/fibre-guardian-moov\.onrender\.com\/codex\/\?suivi=/.test(c.form.message)), 'le lien de suivi du technicien arrive sur WhatsApp');
  } finally { t.server.close(); }
});

test('Panne à Grand-Bassam : la cliente de Grand-Bassam, l’équipe et le technicien reçoivent, pas Abobo ; une seule fois', async () => {
  const t = await setup();
  try {
    t.sim('BAS-01', 'fiber');
    assert.equal((await t.tick(Date.now() + 1000)).length, 0, 'rien pendant que les agents analysent');
    const now = after(500), sent = await t.tick(now);
    assert.deepEqual(t.calls.map(to).sort(), ['whatsapp:+' + PHONES.bassam, 'whatsapp:+' + PHONES.equipe, 'whatsapp:+' + PHONES.tech].sort());
    const client = t.calls.find(c => to(c).endsWith(PHONES.bassam));
    assert.match(client.url, /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC_test\/Messages\.json$/);
    assert.equal(client.init.headers.Authorization, 'Basic ' + Buffer.from('AC_test:secret-de-test').toString('base64'));
    assert.equal(client.form.From, 'whatsapp:+14155238886');
    assert.match(client.form.Body, /^Moov Africa · Fibre Guardian\n\nUn câble de fibre est coupé dans votre quartier/);
    assert.ok(sent.every(m => m.status === 'sent'));
    assert.equal((await t.tick(now + 2000)).length, 0, 'jamais deux fois le même message');
    assert.ok(!t.calls.some(c => to(c).endsWith(PHONES.abobo)), 'Abobo ne reçoit rien');
  } finally { t.server.close(); }
});

test('En route : le client reçoit le lien de suivi ; réparé : il reçoit « c’est réparé »', async () => {
  const t = await setup();
  try {
    t.sim('BAS-01', 'fiber'); await t.tick(after(500)); t.calls.length = 0;
    t.act('BAS-01', {type: 'approve', note: 'ok'}); t.act('BAS-01', {type: 'dispatch', technician: 'amina', safety: true}); t.act('BAS-01', {type: 'advance'});
    await t.tick(Date.now() + 500);
    const road = t.calls.find(c => to(c).endsWith(PHONES.bassam));
    assert.match(road.form.Body, /est en route, arrivée vers .* Suivez son trajet en direct : https:\/\/fibre-guardian-moov\.onrender\.com\/codex\/\?suivi=[\w-]{20,}/);
    t.act('BAS-01', {type: 'advance'}); t.act('BAS-01', {type: 'advance'}); t.sim('BAS-01', 'normal'); t.act('BAS-01', {type: 'verify'});
    t.calls.length = 0; await t.tick(Date.now() + 500);
    assert.ok(t.calls.some(c => to(c).endsWith(PHONES.bassam) && /C’est réparé/.test(c.form.Body)), 'la cliente apprend que c’est réparé');
    assert.ok(!t.calls.some(c => to(c).endsWith(PHONES.abobo)));
  } finally { t.server.close(); }
});

test('Équipement central de Cocody : le client de Palmeraie est prévenu, Grand-Bassam non', async () => {
  const t = await setup();
  try {
    t.sim('COC-03', 'olt'); await t.tick(after(500));
    const clients = t.calls.map(to).filter(n => ![PHONES.equipe, PHONES.tech].some(p => n.endsWith(p)));
    assert.deepEqual(clients, ['whatsapp:+' + PHONES.palmeraie]);
    assert.ok(!t.calls.some(c => to(c).endsWith(PHONES.tech)), 'personne ne se déplace : pas de message au technicien');
  } finally { t.server.close(); }
});

test('Après un redémarrage, les vieux messages ne repartent pas', async () => {
  const t = await setup();
  try {
    t.sim('BAS-01', 'fiber');
    assert.equal((await t.tick(after(W.RECENT + 5000))).length, 0);
    assert.equal(t.calls.length, 0);
  } finally { t.server.close(); }
});

test('Un refus du service est expliqué simplement, sans jamais montrer un numéro ni la clé', async () => {
  const t = await setup();
  try {
    t.sim('BAS-01', 'fiber');
    const refused = async () => ({ok: false, status: 400, json: async () => ({code: 63015, message: 'not joined'})});
    const done = await t.tick(after(500), async (url, init) => { t.calls.push({url, init}); return refused(); });
    assert.ok(done.length && done.every(m => m.status === 'failed'));
    const st = JSON.stringify(W.status(t.s, t.cfg));
    assert.match(st, /join/);
    for (const secret of [...Object.values(PHONES), 'secret-de-test', 'AC_test']) assert.ok(!st.includes(secret), 'rien de sensible : ' + secret);
    assert.equal((await t.tick(after(1500))).length, 0, 'un échec n’est pas renvoyé en boucle');
    assert.deepEqual(W.status(t.s, null), {on: false, phones: 0, sent: []});
  } finally { t.server.close(); }
});

test('Avec Meta : même message, envoyé à l’API WhatsApp Cloud', async () => {
  const t = await setup({TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', WHATSAPP_TOKEN: 'meta-token', WHATSAPP_PHONE_ID: '1098765'});
  try {
    assert.equal(t.cfg.provider, 'meta');
    t.sim('BAS-01', 'fiber'); await t.tick(after(500));
    const c = t.calls.find(c => c.form.to === PHONES.bassam);
    assert.equal(c.url, 'https://graph.facebook.com/v23.0/1098765/messages');
    assert.equal(c.init.headers.Authorization, 'Bearer meta-token');
    assert.equal(c.form.type, 'text'); assert.match(c.form.text.body, /^Moov Africa · Fibre Guardian/);
  } finally { t.server.close(); }
});

test('Le simulateur montre ce qui est vraiment parti, et la page « À propos » le dit', () => {
  const fs = require('node:fs'), path = require('node:path'), read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  assert.match(read('sim-flow-view.js'), /data\.whatsapp\?\.sent/);
  assert.match(read('sim-flow.css'), /\.sf-real\{[^}]*var\(--moov-success-50\)/);
  assert.match(read('demo.js'), /bac à sable WhatsApp de Twilio/);
  assert.match(read('pilot-server.cjs'), /whatsapp:WA\.status\(store,whatsapp\.cfg\)/);
});
