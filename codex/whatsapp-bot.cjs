'use strict';
// Guardian sur WhatsApp : le client écrit au numéro WhatsApp de Moov et Guardian lui répond comme dans l'application
// (même moteur, mêmes langues, même état du quartier). Passerelle Green API, gratuite et sans carte (3 conversations).
// Réglages, jamais dans git (variables de l'hébergeur ou codex/.env) :
//   GREENAPI_ID_INSTANCE, GREENAPI_API_TOKEN : l'instance Green API (page « My instances ») ;
//   GREENAPI_WEBHOOK_TOKEN : secret que Green API renvoie avec chaque message (champ « webhookUrlToken ») ;
//   GREENAPI_URL : adresse de l'API si Green API en donne une autre que https://api.green-api.com.
//   GROQ_API_KEY (facultatif) : Guardian comprend aussi les notes vocales (transcription Whisper chez Groq, gratuite, sans carte).
// Qui écrit ? Le numéro est cherché dans WHATSAPP_CLIENTS (« 2250701020304=awa.kone@demo.fibre-guardian.ci »),
// sinon dans WHATSAPP_NUMEROS (« Yopougon=2250701020304 ») : c'est alors le premier client inscrit dans ce quartier.
// Un numéro inconnu reçoit une réponse polie et rien d'autre : aucun compte n'est lu ni créé.
const crypto = require('node:crypto'), W = require('./whatsapp.cjs'), journey = require('./journey-store.cjs');

const FRESH = 10 * 60000; // Green API renvoie un message tant que le site dort : au-delà de 10 minutes, on ne répond plus.
const plain = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.+-]+/g, '');
const HEAD = 'Guardian · Moov Africa Fibre';
const UNKNOWN = 'Bonjour ! Ce numéro n’est pas encore relié à un abonnement fibre. Ouvrez l’application Fibre Guardian pour relier votre ligne, ou appelez le 111.';

const links = W.links;

function config(env = process.env) {
  if (!env.GREENAPI_ID_INSTANCE || !env.GREENAPI_API_TOKEN) return null;
  return {
    id: String(env.GREENAPI_ID_INSTANCE).replace(/\D/g, ''), token: String(env.GREENAPI_API_TOKEN).trim(),
    url: String(env.GREENAPI_URL || 'https://api.green-api.com').replace(/\/$/, ''),
    secret: String(env.GREENAPI_WEBHOOK_TOKEN || '').trim().replace(/^(Bearer|Basic)\s+/i, ''),
    clients: links(env.WHATSAPP_CLIENTS), numbers: W.numbers(env.WHATSAPP_NUMEROS),
    groq: /^\S{20,}$/.test(env.GROQ_API_KEY || '') ? {key: env.GROQ_API_KEY.trim(), model: env.GROQ_STT_MODEL || 'whisper-large-v3-turbo'} : null,
    origin: String(env.GUARDIAN_ORIGIN || '').replace(/\/$/, '')
  };
}

function migrate(s) {
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_inbox(id TEXT PRIMARY KEY,phone TEXT NOT NULL,at INTEGER NOT NULL)');
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_menu(phone TEXT PRIMARY KEY,ids TEXT NOT NULL,at INTEGER NOT NULL)');
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
  const base = {id: String(d.idMessage || '').slice(0, 80), phone: chat.split('@')[0], at: Number(d.timestamp) * 1000 || 0};
  // Bouton touché : selon la version de WhatsApp, Green API le range sous l'un ou l'autre nom.
  const reply = m[m.typeMessage] || m.buttonsResponseMessage || m.interactiveButtonsResponse || m.templateButtonReplyMessage;
  const button = /button|interactive/i.test(String(m.typeMessage)) && reply ? String(reply.selectedButtonId || reply.selectedId || reply.selectedIndex || '') : '';
  if (button) return {...base, button: button.slice(0, 40), text: String(reply.selectedButtonText || reply.selectedDisplayText || '').slice(0, 100)};
  // Note vocale : Green API donne l'adresse du fichier, qu'on télécharge seulement pour la transcrire.
  if (m.typeMessage === 'audioMessage') {
    const url = String(m.fileMessageData?.downloadUrl || '');
    return /^https:\/\//.test(url) ? {...base, audio: {url, mime: String(m.fileMessageData?.mimeType || 'audio/ogg').split(';')[0]}} : null;
  }
  const text = m.typeMessage === 'textMessage' ? m.textMessageData?.textMessage : m.typeMessage === 'extendedTextMessage' ? m.extendedTextMessageData?.text : null;
  if (typeof text !== 'string' || !text.trim()) return null;
  return {...base, text: text.trim().slice(0, 1000)};
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

// Boutons cliquables, comme les assistants WhatsApp de Wave : 3 au plus, 25 caractères au plus.
// Un bouton envoie à Guardian la phrase complète ; si le téléphone n'affiche pas les boutons, « 1 », « 2 » ou « 3 » marchent aussi.
const CHOICES = {
  lent: ['Internet est lent', 'Internet est lent'],
  coupure: ['Je n’ai plus internet', 'Je n’ai plus d’internet'],
  wifi: ['Mon Wi-Fi capte mal', 'Mon Wi-Fi capte mal dans une pièce'],
  humain: ['Parler à un conseiller', 'Je veux parler à un conseiller'],
  suivi: ['Où en est la réparation', 'Où en est la réparation ?'],
  reboot: ['Redémarrer ma box', 'Comment redémarrer ma box ?'],
  voyants: ['Voyant rouge sur la box', 'Un voyant de ma box est rouge'],
  forfait: ['Un forfait plus rapide', 'Je veux un forfait plus rapide'],
  prix: ['Mon forfait et son prix', 'Combien coûte mon forfait ?'],
  menu: ['Autre question', 'Bonjour'],
  merci: ['Merci', 'Merci']
};
// Les boutons suivent la conversation : ce qu'on vient de demander, et la panne du quartier s'il y en a une.
const MENUS = {
  accueil: ['lent', 'coupure', 'humain'],
  panne: ['suivi', 'humain', 'merci'],
  suivi: ['humain', 'menu', 'merci'],
  lent: ['wifi', 'reboot', 'humain'],
  wifi: ['reboot', 'humain', 'merci'],
  coupure: ['reboot', 'voyants', 'humain'],
  reboot: ['voyants', 'humain', 'merci'],
  voyants: ['reboot', 'humain', 'merci'],
  humain: ['reboot', 'menu', 'merci'],
  humainPanne: ['suivi', 'menu', 'merci'],
  forfait: ['prix', 'humain', 'merci'],
  prix: ['forfait', 'humain', 'merci']
};
const FOOT = 'Touchez un bouton, ou répondez 1, 2 ou 3.';

function menuFor(answer, question) {
  const ask = journey.intent(question);
  if (answer?.action === 'tracking') return ask === 'humain' ? MENUS.humainPanne : ask === 'suivi' ? MENUS.suivi : MENUS.panne;
  const by = {lent: 'lent', usage: 'lent', wifi: 'wifi', coupure: 'coupure', reboot: 'reboot', voyants: 'voyants', humain: 'humain', upgrade: 'forfait', prix: 'prix', resiliation: 'humain', suivi: 'humain'};
  return MENUS[by[ask]] || MENUS.accueil;
}

// Dans l'application, Guardian parle de boutons de l'écran ; sur WhatsApp, on renvoie vers l'application ou le 111.
function forWhatsApp(answer, origin) {
  const app = origin ? 'l’application Fibre Guardian (' + origin + '/codex/)' : 'l’application Fibre Guardian';
  return String(answer?.text || '')
    .replace(/Appuyez sur le bouton ci-dessous pour/g, 'Ouvrez ' + app + ' pour')
    .replace(/avec le bouton ci-dessous/g, 'depuis ' + app)
    .replace(/le bouton ci-dessous/g, app)
    .replace(/avec le bouton « Appeler Moov »/g, 'au 111')
    .replace(/le bouton « ([^»]+) »/g, '« $1 » dans ' + app);
}

function greeting(name, said = '') {
  const first = String(name || '').split(' ')[0];
  return (/bonsoir/i.test(said) ? 'Bonsoir' : 'Bonjour') + (first ? ' ' + first : '') + ' ! Je suis Guardian, l’assistant de Moov Africa Fibre. Que se passe-t-il ?';
}

const endpoint = (cfg, method) => cfg.url + '/waInstance' + cfg.id + '/' + method + '/' + encodeURIComponent(cfg.token);
async function post(cfg, method, body, fetchImpl) {
  const r = await fetchImpl(endpoint(cfg, method), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)});
  if (!r.ok) throw Object.assign(new Error('Green API a refusé le message (' + r.status + ').'), {code: r.status});
}

// Un texte, avec ses boutons s'il en a. Les boutons de Green API sont encore en essai : s'ils sont refusés,
// le même message part en texte, avec les choix numérotés.
async function send(cfg, phone, text, fetchImpl = fetch, buttons = null) {
  const chatId = phone + '@c.us';
  if (buttons?.length) {
    try { return await post(cfg, 'sendInteractiveButtonsReply', {chatId, header: HEAD, body: text, footer: FOOT, buttons: buttons.map(id => ({buttonId: id, buttonText: CHOICES[id][0]}))}, fetchImpl); }
    catch { text += '\n\n' + buttons.map((id, n) => (n + 1) + '. ' + CHOICES[id][0]).join('\n') + '\n\nRépondez 1, 2 ou 3.'; }
  }
  await post(cfg, 'sendMessage', {chatId, message: HEAD + '\n\n' + text}, fetchImpl);
}

// Le choix du client : un bouton touché, ou « 1 », « 2 », « 3 » d'après le dernier menu envoyé à ce numéro.
function choice(s, m) {
  if (m.button && CHOICES[m.button]) return m.button;
  const n = /^[1-3]$/.test(m.text || '') ? Number(m.text) : 0, last = n && s.get('SELECT ids FROM wa_menu WHERE phone=?', m.phone);
  return last ? JSON.parse(last.ids)[n - 1] || null : null;
}

async function answer(s, cfg, m, text, buttons, fetchImpl) {
  await send(cfg, m.phone, text, fetchImpl, buttons);
  s.run('INSERT INTO wa_menu VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET ids=excluded.ids,at=excluded.at', m.phone, JSON.stringify(buttons || []), Date.now());
  return {status: 'answered', reply: text, buttons};
}

const HUMAN = 'Un conseiller Moov vous répond au 111, à tout moment. Il voit le même dossier que moi :\n\n';
const DEAF = 'Je ne peux pas encore écouter les notes vocales. Écrivez-moi en quelques mots ce qui se passe, ou touchez un bouton.';
const UNHEARD = 'Je n’ai pas bien compris votre note vocale. Pouvez-vous la refaire dans un endroit calme, ou m’écrire en quelques mots ?';
const MAX_AUDIO = 5 * 1024 * 1024; // environ 5 minutes de note vocale
// Note vocale → texte (Whisper chez Groq). Le son n'est gardé que le temps de la transcription, jamais enregistré.
async function transcribe(cfg, audio, fetchImpl) {
  const file = await fetchImpl(audio.url, {signal: AbortSignal.timeout(15000)});
  if (!file.ok) throw new Error('Note vocale introuvable (' + file.status + ').');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AUDIO) throw new Error('Note vocale vide ou trop longue.');
  const form = new FormData();
  form.append('file', new Blob([bytes], {type: audio.mime}), 'note.' + (audio.mime.split('/')[1] || 'ogg'));
  form.append('model', cfg.groq.model); form.append('language', 'fr'); form.append('response_format', 'json');
  const r = await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', {method: 'POST', headers: {Authorization: 'Bearer ' + cfg.groq.key}, body: form, signal: AbortSignal.timeout(20000)});
  if (!r.ok) throw new Error('Transcription refusée (' + r.status + ').');
  return String((await r.json()).text || '').trim().slice(0, 1000);
}

// Un message reçu : Guardian répond une seule fois, avec le même chemin que l'application (chat).
async function handle(s, cfg, payload, {chat, fetchImpl = fetch, now = Date.now()} = {}) {
  const m = incoming(payload);
  if (!m || (m.at && now - m.at > FRESH)) return {status: 'ignored'};
  if (m.id && !s.run('INSERT OR IGNORE INTO wa_inbox VALUES(?,?,?)', m.id, m.phone, now).changes) return {status: 'duplicate'};
  try { s.rate('wa:' + m.phone, 20, 600000); } catch { return {status: 'limited'}; }
  const user = who(s, cfg, m.phone);
  if (!user) { await send(cfg, m.phone, UNKNOWN, fetchImpl); return {status: 'unknown'}; }
  // Note vocale : Guardian répète ce qu'il a compris, puis répond comme à un message écrit.
  let heard = '';
  if (m.audio) {
    if (!cfg.groq) return answer(s, cfg, m, DEAF, MENUS.accueil, fetchImpl);
    try { heard = await transcribe(cfg, m.audio, fetchImpl); } catch { heard = ''; }
    if (heard.length < 2) return answer(s, cfg, m, UNHEARD, MENUS.accueil, fetchImpl);
    m.text = heard;
  }
  const picked = !heard && choice(s, m), text = picked ? CHOICES[picked][1] : m.text;
  const echo = heard ? 'Vous avez dit : « ' + heard + ' »\n\n' : '';
  // « Bonjour » seul, ou « Autre question » : Guardian salue et propose les choix, sans tout déballer d'un coup.
  if (picked === 'menu' || (!picked && journey.intent(text) === 'salut' && text.length <= 40)) return answer(s, cfg, m, echo + greeting(user.name, picked ? '' : text), MENUS.accueil, fetchImpl);
  if (!journey.get(s, user.id)) journey.put(s, user.id, journey.seed());
  const state = await chat(user, {type: 'chat', text, version: journey.get(s, user.id).version});
  const said = state.messages.filter(x => x.role === 'assistant').at(-1);
  // Pendant une panne, l'application répond d'abord par l'état du quartier ; sur WhatsApp, on dit aussi comment joindre un conseiller.
  const human = said?.action === 'tracking' && journey.intent(text) === 'humain' ? HUMAN : '';
  return answer(s, cfg, m, echo + human + forWhatsApp(said, cfg.origin), journey.intent(text) === 'merci' ? null : menuFor(said, text), fetchImpl);
}

module.exports = {config, migrate, allowed, incoming, who, forWhatsApp, greeting, send, handle, transcribe, menuFor, DEAF, UNHEARD, links, CHOICES, MENUS, UNKNOWN, FRESH, HEAD};
