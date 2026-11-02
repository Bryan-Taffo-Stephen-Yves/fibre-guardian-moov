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
// Un client qui relie son WhatsApp dans « Mon compte » envoie à Guardian le message tout prêt, avec son code, puis confirme
// ce numéro dans l'application : Guardian lui répond ensuite avec ce compte (whatsapp-compte.cjs). « Stop » défait le lien.
// Un membre du jury qui a donné son numéro en s'inscrivant le confirme en répondant « OUI » ; il parle ensuite avec le compte
// de son inscription (salle ouverte seulement). « Stop » retire son numéro tout de suite.
// Un numéro inconnu ne reçoit aucune réponse : aucun compte n'est lu ni créé. Une personne qui écrit par erreur au numéro
// de Guardian ne reçoit jamais de message du robot, et les 3 discussions gratuites du mois de Green API restent aux numéros
// de la démonstration (une réponse à un inconnu en prenait une).
const C = require('./whatsapp-compte.cjs');
const crypto = require('node:crypto'), W = require('./whatsapp.cjs'), journey = require('./journey-store.cjs'), VT = require('./vrai-test.cjs'), N = require('./noc-store.cjs'), O = require('./operator-store.cjs');

const FRESH = 10 * 60000; // Green API renvoie un message tant que le site dort : au-delà de 10 minutes, on ne répond plus.
const plain = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.+-]+/g, '');
const HEAD = 'Guardian · Moov Africa Fibre';

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
  // Photo de la box : même chose, l'image n'est téléchargée que pour être lue, jamais gardée.
  if (m.typeMessage === 'imageMessage') {
    const url = String(m.fileMessageData?.downloadUrl || ''), mime = String(m.fileMessageData?.mimeType || 'image/jpeg').split(';')[0];
    return /^https:\/\//.test(url) ? {...base, image: {url, mime: /^image\/(jpeg|png|webp)$/.test(mime) ? mime : 'image/jpeg'}} : null;
  }
  const text = m.typeMessage === 'textMessage' ? m.textMessageData?.textMessage : m.typeMessage === 'extendedTextMessage' ? m.extendedTextMessageData?.text : null;
  if (typeof text !== 'string' || !text.trim()) return null;
  return {...base, text: text.trim().slice(0, 1000)};
}

// Le client qui écrit : lien explicite d'abord, sinon le premier client inscrit dans le quartier de ce numéro.
// Comptes reliés à ce numéro dans WHATSAPP_CLIENTS (un client, un responsable, ou les deux sur le même téléphone).
function linked(s, cfg, phone) {
  return cfg.clients.filter(c => c.phone === phone).map(c => s.get('SELECT id,name FROM users WHERE email=?', c.email)).filter(Boolean).map(u => ({...u, role: O.role(s, u.id)}));
}
// Le responsable relié à ce numéro (agent, superviseur ou administrateur), s'il y en a un.
const manager = (s, cfg, phone) => linked(s, cfg, phone).find(u => u.role !== 'subscriber') || null;
function who(s, cfg, phone) {
  // Le client a relié ce WhatsApp à son compte dans l'application (ce téléphone a envoyé son code) : c'est lui qui écrit.
  const own = C.byPhone(s, phone); if (own) return own;
  const users = linked(s, cfg, phone);
  // Un numéro relié seulement à un compte de l'équipe Moov, et inscrit au jury : il parle comme membre du jury.
  const juror = jury(s, 'byWhatsapp', phone);
  if (users.length) { const u = users.find(v => v.role === 'subscriber') || juror || users[0]; return {id: u.id, name: u.name}; }
  if (juror) return juror;
  if (cfg.clients.some(c => c.phone === phone)) return null;
  const keys = cfg.numbers.filter(n => n.phone === phone && n.role === 'client').map(n => n.key);
  if (!keys.length) return null;
  const segments = s.all('SELECT id FROM noc_segments').map(r => r.id).filter(id => keys.some(k => W.livesIn(k, id)));
  if (!segments.length) return null;
  return s.get('SELECT u.id,u.name FROM noc_members m JOIN users u ON u.id=m.user_id WHERE m.segment_id IN (' + segments.map(() => '?').join(',') + ') ORDER BY u.created LIMIT 1', ...segments) || null;
}

// Salle du jury (la table peut manquer sur une base sans salle du jury : rien n'est trouvé).
function jury(s, fn, phone) { try { return require('./jury-store.cjs')[fn](s, phone); } catch { return null; } }
const STOPPED = 'C’est noté : je ne vous écrirai plus sur WhatsApp, et votre numéro est effacé. L’alerte arrivera toujours sur la page du jury.';
const PENDING = 'Répondez « OUI » pour recevoir ici les alertes de la démonstration Fibre Guardian, ou « Stop » pour ne rien recevoir.';
const confirmed = first => 'Merci' + (first ? ' ' + first : '') + ' ! C’est activé : pendant la démonstration, je vous écris ici si une panne touche Niangon (Yopougon). Répondez « Stop » pour arrêter.';
// « Stop » seul, ou suivi d'une formule de politesse ; jamais un mot pris dans une phrase (« Arrêt total d'internet »).
const wantsStop = text => /^(stop|arret|arreter|arretez|desinscrire|desinscription|je veux arreter|je veux me desinscrire)( (svp|stp|s il vous plait|s il te plait|merci))*$/.test(words(text));
const wantsYes = text => /^(oui|yes|ok|d accord|oui merci|ok merci)$/.test(words(text));

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
  test: ['Tester ma connexion', 'Je veux tester ma connexion'],
  photo: ['Envoyer une photo', 'Je vous envoie une photo de ma box'],
  menu: ['Autre question', 'Bonjour'],
  merci: ['Merci', 'Merci'],
  valider: ['Valider le plan', 'Je valide le plan'] // bouton de l'alerte d'équipe : son identifiant est « valider:<ref> »
};
// Les boutons suivent la conversation : ce qu'on vient de demander, et la panne du quartier s'il y en a une.
const MENUS = {
  accueil: ['lent', 'coupure', 'humain'],
  panne: ['suivi', 'humain', 'merci'],
  suivi: ['humain', 'menu', 'merci'],
  lent: ['test', 'wifi', 'humain'],
  wifi: ['test', 'reboot', 'humain'],
  coupure: ['reboot', 'photo', 'humain'],
  reboot: ['test', 'photo', 'humain'],
  voyants: ['photo', 'reboot', 'humain'],
  test: ['reboot', 'humain', 'menu'],
  photo: ['reboot', 'humain', 'menu'],
  apresPhoto: ['reboot', 'test', 'humain'],
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
    .replace(/avec le bouton « Photo de ma box »/g, 'ici, dans cette conversation')
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
  if (!r.ok) throw Object.assign(new Error(r.status === 466 ? W.QUOTA : 'Green API a refusé le message (' + r.status + ').'), {code: r.status});
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

// « Valider » d'un responsable sur WhatsApp : il valide le plan d'une alerte d'équipe qui lui a vraiment été remise,
// jamais une autre panne, avec les droits de son propre compte (vérifiés par la Régie ou par le moteur d'incidents).
// Le bouton porte la référence de son alerte ; « Valider » écrit à la main ne vaut que s'il n'y a qu'un plan en attente.
const NOTHING = 'Aucun plan n’attend votre validation en ce moment. Je vous écris dès que Guardian en prépare un.';
const words = text => fold(text).replace(/[^a-z0-9?]+/g, ' ').trim();
// Seulement la commande entière : « Valider », « Je valide », « OK valide », « Valider le plan »… Jamais une question
// ni une phrase (« Je valide pas », « Valider plus tard », « Validez-vous les paiements ? »).
const wantsValidate = text => /^(ok |oui |d accord )?(je )?valid(e|er|ez)( le plan)?$/.test(words(text));
const CAUSE = {FIBER_CUT_DISTRIBUTION: 'coupure fibre', POWER_OUTAGE: 'coupure de courant'};
const causeOf = plan => CAUSE[plan?.cause] || 'la panne « ' + (plan?.title || 'à vérifier') + ' »';
// « Niangon (Yopougon) », comme dans l'alerte.
const zoneOf = (s, i) => { const [commune, area] = String(N.zoneName(s, i.segment_id) || '').split(' · '); return area ? area + ' (' + commune + ')' : commune; };
function validatePlan(s, boss, phone, origin, {ref = null, at = Date.now()} = {}) {
  // Alertes remises à ce numéro (un écart de 30 s est toléré entre l'horloge de WhatsApp et celle du site).
  const asks = ref ? s.all('SELECT * FROM wa_asks WHERE ref=? AND phone=?', ref, phone) : s.all('SELECT * FROM wa_asks WHERE phone=? AND at<=? ORDER BY at DESC, rowid DESC', phone, at + 30000);
  let view;
  try { view = N.overview(s, boss.id).incidents; } catch (e) { return e.message; }
  const seen = new Set(), list = asks.filter(a => !seen.has(a.incident_id) && seen.add(a.incident_id)).map(a => ({a, i: view.find(x => x.id === a.incident_id)})).filter(x => x.i);
  const waiting = list.filter(x => x.i.status === 'proposed');
  if (!ref && waiting.length > 1) return 'Plusieurs plans attendent votre validation : ' + waiting.map(x => zoneOf(s, x.i)).join(', ') + '. Touchez « Valider le plan » sous l’alerte voulue, ou validez dans l’espace Moov.';
  const pick = ref ? list[0] : waiting[0] || list[0];
  if (!pick || ['resolved', 'closed'].includes(pick.i.status)) return NOTHING;
  const {a, i} = pick, zone = zoneOf(s, i), cause = causeOf(i.plan);
  if (i.status === 'rejected') return 'Ce plan a été refusé dans l’espace Moov : il n’y a plus rien à valider.';
  if (i.status !== 'proposed') return 'Ce plan est déjà validé. La suite se passe dans la Régie ou l’espace Moov.';
  // Le plan a changé depuis l'alerte (refusé puis revu, ou autre cause) : on ne valide pas à l'aveugle.
  if ((i.events || []).some(e => e.kind === 'plan.rejected' && e.at > a.at)) return 'Ce plan a été refusé puis revu dans l’espace Moov depuis mon alerte. Relisez le nouveau plan et validez-le dans l’espace Moov.';
  if ((i.plan?.cause || null) !== a.cause || (i.plan?.dispatch !== false) !== !!a.dispatch) return 'Guardian a revu son diagnostic depuis mon alerte : ' + cause + ' à ' + zone + '. Relisez ce nouveau plan et validez-le dans l’espace Moov.';
  try {
    // Réseau de démo ouvert dans la Régie : même validation que le bouton « Valider » de la Régie (administrateur seulement).
    const jury = require('./jury-store.cjs');
    let room = null; try { room = jury.status(s, boss.id, origin); } catch { room = null; }
    if (room?.room?.network && room.scene?.id === i.id && room.next === 'validate') {
      jury.step(s, boss.id, {type: 'validate'}, origin);
      return 'C’est validé : ' + cause + ' confirmée sur le réseau ' + room.room.network + '. Les inscrits du jury sont prévenus sur leur téléphone. Prochaine étape : ' + (i.plan?.dispatch === false ? '« Réparer » dans la Régie, au retour du courant.' : '« Envoyer le technicien » dans la Régie.');
    }
    N.operate(s, boss.id, {type: 'approve', id: i.id, version: i.version, note: 'Validé sur WhatsApp par ' + boss.name + '.'});
    return 'C’est validé : ' + cause + ' à ' + zone + '. Les clients du quartier sont prévenus. ' + (i.plan?.dispatch === false ? 'Personne ne se déplace.' : 'Prochaine étape : choisir l’équipe à envoyer dans l’espace Moov.');
  } catch (e) { return e.message || 'La validation n’a pas abouti. Validez dans l’espace Moov.'; }
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

// Vrai test de connexion : un lien personnel, à ouvrir sur l'appareil branché au Wi-Fi de la box.
const fold = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const wantsTest = text => /\b(tester|teste|test|speed ?test|mesurer)\b/.test(fold(text));
function testLink(s, cfg, m, user, origin) {
  const l = VT.link(s, user.id, {phone: m.phone, origin: cfg.origin || origin || ''});
  return 'Voici votre lien de test, valable 30 minutes :\n' + l.url + '\n\nOuvrez-le sur le téléphone ou l’ordinateur connecté au Wi-Fi de votre box, puis touchez « Lancer le test ». En 15 secondes, je mesure votre connexion et je vous envoie le résultat ici.';
}
// Le résultat du test revient sur WhatsApp, avec les boutons qui vont avec.
const AFTER_TEST = {bonne: ['wifi', 'test', 'merci'], lente: ['wifi', 'reboot', 'humain'], 'tres-lente': ['wifi', 'reboot', 'humain'], instable: ['wifi', 'test', 'humain'], coupe: ['reboot', 'photo', 'humain']};
async function testResult(s, cfg, phone, r, fetchImpl = fetch) {
  const lines = r.facts.filter(f => f.label !== 'Où').map(f => f.label + ' : ' + f.value).join('\n');
  return answer(s, cfg, {phone}, 'Résultat de votre test de connexion :\n\n' + r.text + '\n\n' + lines, AFTER_TEST[r.level] || MENUS.accueil, fetchImpl);
}
// Technicien affecté, en route ou sur place : la réponse de Guardian se termine par le lien de suivi en direct,
// le même que celui de l'alerte « en route » (sans compte, valable 6 h, sans le nom du client).
// Le lien suit la panne dont parle la réponse (journey.sharedFault), jamais une autre.
// Il n'utilise que l'adresse publique du site (GUARDIAN_ORIGIN) : sans elle, pas de lien, comme pour l'alerte.
const de = first => (/^[aeiouàâäéèêëîïôöùûü]/i.test(first) ? 'd’' : 'de ') + first; // « d’Awa », « d’Ibrahim », mais « de Yao »
function trackLine(s, user, origin) {
  if (!origin) return '';
  try {
    const i = journey.sharedFault(s, user.id);
    if (!i || !i.technician || !journey.TRIP.includes(i.status)) return '';
    const first = String(i.technician.name || '').split(' ')[0];
    return '\n\n' + (i.status === 'on_site' ? 'Suivez l’intervention ' : 'Suivez le trajet ') + (first ? de(first) : 'du technicien') + ' en direct : ' + origin + N.trackLink(s, user.id, {id: i.id}).url;
  } catch { return ''; }
}
const PHOTO_ASK = 'Prenez votre box en photo, de face, les voyants bien visibles, à environ 30 cm. Envoyez-la ici : je vous dis ce que veulent dire les voyants.';
const PHOTO_LATER = 'Je n’arrive pas à lire cette photo pour le moment. Reprenez-la de face, les voyants bien visibles, à environ 30 cm, ou ouvrez « Photo de ma box » dans l’application Fibre Guardian.';
const MAX_IMAGE = 3.5 * 1024 * 1024;
async function readPhoto(m, user, photo, fetchImpl) {
  if (!photo) return null;
  try {
    const file = await fetchImpl(m.image.url, {signal: AbortSignal.timeout(15000)});
    if (!file.ok) return null;
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE) return null;
    return await photo(user, 'data:' + m.image.mime + ';base64,' + bytes.toString('base64'));
  } catch { return null; }
}

// Un message reçu : Guardian répond une seule fois, avec le même chemin que l'application (chat).
async function handle(s, cfg, payload, {chat, photo = null, origin = '', fetchImpl = fetch, now = Date.now()} = {}) {
  const m = incoming(payload);
  if (!m || (m.at && now - m.at > FRESH)) return {status: 'ignored'};
  // Les messages reçus ne servent qu'à éviter les doublons : au-delà de 20 minutes, ils sont effacés (numéro compris).
  s.run('DELETE FROM wa_inbox WHERE at<?', now - 2 * FRESH);
  if (m.id && !s.run('INSERT OR IGNORE INTO wa_inbox VALUES(?,?,?)', m.id, m.phone, now).changes) return {status: 'duplicate'};
  // Limite par numéro, gardée sous forme d'empreinte (jamais le numéro lui-même).
  try { s.rate('wa:' + crypto.createHash('sha256').update(m.phone).digest('hex').slice(0, 24), 20, 600000); } catch { return {status: 'limited'}; }
  const plainText = !m.image && !m.audio && !m.button;
  // « Stop » d'un membre du jury ou d'un client relié dans l'application : plus aucun message sur ce numéro.
  if (plainText && wantsStop(m.text)) {
    const juror = jury(s, 'stopWhatsapp', m.phone), own = C.stopPhone(s, m.phone);
    if (juror || own) { await send(cfg, m.phone, (own ? C.STOPPED : STOPPED) + (manager(s, cfg, m.phone) ? ' Les alertes de l’équipe Moov continuent sur ce numéro.' : ''), fetchImpl); return {status: 'stopped'}; }
  }
  // Message tout prêt de « Relier mon WhatsApp » (code de 6 chiffres donné par l'application) : le client confirme ce numéro
  // dans l'application, et c'est seulement alors que Guardian lui écrit. Rien ne part vers ce téléphone ici.
  const claim = plainText ? C.claim(s, m.phone, m.text, now) : null;
  if (claim === 'claimed') return {status: 'claimed'};
  // Ce WhatsApp est déjà relié à un autre compte (il a donc déjà sa discussion) : Guardian le dit, rien ne change.
  if (claim === 'taken') { await send(cfg, m.phone, C.TAKEN, fetchImpl); return {status: 'taken'}; }
  // Numéro donné par un membre du jury : « OUI » l'active ; tant qu'il n'est pas activé, ses messages ne vont à personne.
  if (jury(s, 'pendingWhatsapp', m.phone)) {
    if (plainText && wantsYes(m.text)) { const ok = jury(s, 'confirmWhatsapp', m.phone); await send(cfg, m.phone, confirmed(ok?.first), fetchImpl); return {status: 'confirmed'}; }
    if (!linked(s, cfg, m.phone).length && !C.byPhone(s, m.phone)) { await send(cfg, m.phone, PENDING, fetchImpl); return {status: 'pending'}; }
  }
  // Un responsable relié qui répond « Valider » (bouton de l'alerte, ou la commande écrite) : le plan de cette alerte est validé.
  const boss = manager(s, cfg, m.phone), tapped = /^valider(?::([0-9a-f]{8}))?$/.exec(m.button || '');
  if (boss && (tapped || (plainText && wantsValidate(m.text)))) return answer(s, cfg, m, validatePlan(s, boss, m.phone, cfg.origin || origin, {ref: tapped?.[1] || null, at: m.at || now}), null, fetchImpl);
  const user = who(s, cfg, m.phone);
  if (!user) return {status: 'unknown'};
  // Photo : Guardian lit les voyants, comme « Photo de ma box » dans l'application.
  if (m.image) {
    const state = await readPhoto(m, user, photo, fetchImpl), said = state?.messages?.filter(x => x.role === 'assistant').at(-1);
    if (!said) return answer(s, cfg, m, PHOTO_LATER, MENUS.photo, fetchImpl);
    return answer(s, cfg, m, forWhatsApp(said, cfg.origin) + (said.action === 'tracking' ? trackLine(s, user, cfg.origin) : ''), said.action === 'tracking' ? MENUS.panne : MENUS.apresPhoto, fetchImpl);
  }
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
  if (picked === 'photo') return answer(s, cfg, m, PHOTO_ASK, MENUS.photo, fetchImpl);
  if (picked === 'test' || (!picked && wantsTest(text))) return answer(s, cfg, m, echo + testLink(s, cfg, m, user, origin), MENUS.test, fetchImpl);
  if (!journey.get(s, user.id)) journey.put(s, user.id, journey.seed());
  const state = await chat(user, {type: 'chat', text, version: journey.get(s, user.id).version});
  const said = state.messages.filter(x => x.role === 'assistant').at(-1);
  // Pendant une panne, l'application répond d'abord par l'état du quartier ; sur WhatsApp, on dit aussi comment joindre un conseiller.
  const human = said?.action === 'tracking' && journey.intent(text) === 'humain' ? HUMAN : '';
  // Pendant l'intervention, le lien de suivi suit la réponse (sauf après « merci », qui clôt la conversation).
  const track = said?.action === 'tracking' && journey.intent(text) !== 'merci' ? trackLine(s, user, cfg.origin) : '';
  return answer(s, cfg, m, echo + human + forWhatsApp(said, cfg.origin) + track, journey.intent(text) === 'merci' ? null : menuFor(said, text), fetchImpl);
}

module.exports = {config, migrate, allowed, incoming, who, manager, wantsValidate, wantsStop, wantsYes, validatePlan, NOTHING, STOPPED, PENDING, forWhatsApp, greeting, send, handle, transcribe, menuFor, testResult, wantsTest, trackLine, de, PHOTO_ASK, PHOTO_LATER, DEAF, UNHEARD, links, CHOICES, MENUS, FRESH, HEAD};
