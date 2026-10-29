'use strict';
// Guardian sur WhatsApp : le client écrit au numéro WhatsApp de Moov et Guardian lui répond comme dans l'application
// (même moteur, mêmes langues, même état du quartier). Passerelle Green API, gratuite et sans carte (3 conversations).
// Réglages, jamais dans git (variables de l'hébergeur ou codex/.env) :
//   GREENAPI_ID_INSTANCE, GREENAPI_API_TOKEN : l'instance Green API (page « My instances ») ;
//   GREENAPI_WEBHOOK_TOKEN : secret que Green API renvoie avec chaque message (champ « webhookUrlToken ») ;
//   GREENAPI_URL : adresse de l'API si Green API en donne une autre que https://api.green-api.com.
// Qui écrit ? Le numéro est cherché dans WHATSAPP_CLIENTS (« 2250701020304=awa.kone@demo.fibre-guardian.ci »),
// sinon dans WHATSAPP_NUMEROS (« Yopougon=2250701020304 ») : c'est alors le premier client inscrit dans ce quartier.
// Un numéro inconnu reçoit une réponse polie et rien d'autre : aucun compte n'est lu ni créé.
const crypto = require('node:crypto'), W = require('./whatsapp.cjs'), journey = require('./journey-store.cjs');

const FRESH = 10 * 60000; // Green API renvoie un message tant que le site dort : au-delà de 10 minutes, on ne répond plus.
const plain = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.+-]+/g, '');
const HEAD = 'Guardian · Moov Africa Fibre';
const UNKNOWN = 'Bonjour, ici Guardian, l’assistant de Moov Africa Fibre. Ce numéro n’est pas encore relié à un abonnement fibre. Ouvrez l’application Fibre Guardian pour relier votre ligne, ou appelez le 111.';

function links(text) {
  return String(text || '').split(/[,;\n]/).map(part => {
    const m = part.match(/^\s*([+\d][\d\s.-]*)\s*[=:]\s*(\S+@\S+)\s*$/); if (!m) return null;
    const phone = m[1].replace(/\D/g, '');
    return /^\d{8,15}$/.test(phone) ? {phone, email: m[2].toLowerCase()} : null;
  }).filter(Boolean);
}

function config(env = process.env) {
  if (!env.GREENAPI_ID_INSTANCE || !env.GREENAPI_API_TOKEN) return null;
  return {
    id: String(env.GREENAPI_ID_INSTANCE).replace(/\D/g, ''), token: String(env.GREENAPI_API_TOKEN).trim(),
    url: String(env.GREENAPI_URL || 'https://api.green-api.com').replace(/\/$/, ''),
    secret: String(env.GREENAPI_WEBHOOK_TOKEN || '').trim().replace(/^(Bearer|Basic)\s+/i, ''),
    clients: links(env.WHATSAPP_CLIENTS), numbers: W.numbers(env.WHATSAPP_NUMEROS),
    origin: String(env.GUARDIAN_ORIGIN || '').replace(/\/$/, '')
  };
}

function migrate(s) {
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_inbox(id TEXT PRIMARY KEY,phone TEXT NOT NULL,at INTEGER NOT NULL)');
}

// Green API signe chaque envoi avec le secret choisi : sans secret réglé, la porte reste fermée.
function allowed(cfg, header) {
  if (!cfg || cfg.secret.length < 16) return false;
  const got = Buffer.from(String(header || '').replace(/^(Bearer|Basic)\s+/i, '')), want = Buffer.from(cfg.secret);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Un message texte d'une personne (jamais d'un groupe), sinon null.
function incoming(d) {
  if (!d || d.typeWebhook !== 'incomingMessageReceived') return null;
  const chat = String(d.senderData?.chatId || ''), m = d.messageData || {};
  if (!/^\d{8,15}@c\.us$/.test(chat)) return null;
  const text = m.typeMessage === 'textMessage' ? m.textMessageData?.textMessage : m.typeMessage === 'extendedTextMessage' ? m.extendedTextMessageData?.text : null;
  if (typeof text !== 'string' || !text.trim()) return null;
  return {id: String(d.idMessage || '').slice(0, 80), phone: chat.split('@')[0], text: text.trim().slice(0, 1000), at: Number(d.timestamp) * 1000 || 0};
}

// Le client qui écrit : lien explicite d'abord, sinon le premier client inscrit dans le quartier de ce numéro.
function who(s, cfg, phone) {
  const link = cfg.clients.find(c => c.phone === phone);
  if (link) return s.get('SELECT id,name FROM users WHERE email=?', link.email) || null;
  const keys = cfg.numbers.filter(n => n.phone === phone && n.role === 'client').map(n => n.key);
  if (!keys.length) return null;
  const segments = s.all('SELECT id FROM noc_segments').map(r => r.id).filter(id => keys.some(k => W.livesIn(k, id)));
  if (!segments.length) return null;
  return s.get('SELECT u.id,u.name FROM noc_members m JOIN users u ON u.id=m.user_id WHERE m.segment_id IN (' + segments.map(() => '?').join(',') + ') ORDER BY u.created LIMIT 1', ...segments) || null;
}

// Dans l'application, Guardian parle de boutons ; sur WhatsApp, on renvoie vers l'application ou vers un mot à écrire.
function forWhatsApp(answer, origin, question = '') {
  const app = origin ? 'l’application Fibre Guardian (' + origin + '/codex/)' : 'l’application Fibre Guardian';
  let text = String(answer?.text || '')
    .replace(/Appuyez sur le bouton ci-dessous pour/g, 'Ouvrez ' + app + ' pour')
    .replace(/avec le bouton ci-dessous/g, 'depuis ' + app)
    .replace(/le bouton ci-dessous/g, app)
    .replace(/avec le bouton « Appeler Moov »/g, 'au 111')
    .replace(/le bouton « ([^»]+) »/g, '« $1 » dans ' + app);
  if (answer?.action === 'tracking' && !['suivi', 'merci'].includes(journey.intent(question))) text += ' Écrivez « où en est la réparation ? » quand vous voulez : je vous donne l’étape et l’heure de retour.';
  return HEAD + '\n\n' + text;
}

async function send(cfg, phone, text, fetchImpl = fetch) {
  const r = await fetchImpl(cfg.url + '/waInstance' + cfg.id + '/sendMessage/' + encodeURIComponent(cfg.token), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chatId: phone + '@c.us', message: text}), signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw Object.assign(new Error('Green API a refusé le message (' + r.status + ').'), {code: r.status});
}

// Un message reçu : Guardian répond une seule fois, avec le même chemin que l'application (chat).
async function handle(s, cfg, payload, {chat, fetchImpl = fetch, now = Date.now()} = {}) {
  const m = incoming(payload);
  if (!m || (m.at && now - m.at > FRESH)) return {status: 'ignored'};
  if (m.id && !s.run('INSERT OR IGNORE INTO wa_inbox VALUES(?,?,?)', m.id, m.phone, now).changes) return {status: 'duplicate'};
  try { s.rate('wa:' + m.phone, 20, 600000); } catch { return {status: 'limited'}; }
  const user = who(s, cfg, m.phone);
  if (!user) { await send(cfg, m.phone, UNKNOWN, fetchImpl); return {status: 'unknown'}; }
  if (!journey.get(s, user.id)) journey.put(s, user.id, journey.seed());
  const state = await chat(user, {type: 'chat', text: m.text, version: journey.get(s, user.id).version});
  const answer = state.messages.filter(x => x.role === 'assistant').at(-1);
  const reply = forWhatsApp(answer, cfg.origin, m.text);
  await send(cfg, m.phone, reply, fetchImpl);
  return {status: 'answered', user: user.id, reply};
}

module.exports = {config, migrate, allowed, incoming, who, forWhatsApp, send, handle, links, UNKNOWN, FRESH};
