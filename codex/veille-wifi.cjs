'use strict';
// Surveillance du Wi-Fi : Guardian prévient le propriétaire de la box sur WhatsApp
//   1. quand un appareil qu'il ne connaît pas se connecte à son Wi-Fi (vrai : vu par le PC Windows branché, « Guardian-Wi-Fi.cmd ») ;
//   2. quand la connexion tombe, revient, ou devient instable (vrai : le PC branché se tait, puis réécrit ; il mesure Internet) ;
//   3. quand un appareil consomme beaucoup plus que d'habitude (joué dans la Régie : seule la box connaît la consommation de
//      chaque appareil, et seul Moov peut la lire à distance, par son système de gestion des box).
// C'est le propriétaire qui l'active. Guardian apprend d'abord les appareils habituels (ceux là pendant la première minute),
// puis il écrit dès qu'un nouveau arrive. Le propriétaire répond « C'est à moi » dans l'application : l'appareil devient habituel.
// Guardian ne lit jamais ce que font les appareils (ni sites, ni messages) : seulement leur arrivée et leur quantité de données.
// Il ne garde ni nom d'appareil ni adresse MAC : un numéro anonyme signé avec une clé propre au site.
// Pas de nouveau numéro WhatsApp : le message part vers le WhatsApp déjà relié au compte (Mon compte, hébergeur ou jury).
const crypto = require('node:crypto'), {insist} = require('./pilot-model.cjs');

const LEARN_MS = 60000; // la première minute : les appareils vus deviennent les appareils habituels
const MAX_KNOWN = 64, MAX_PENDING = 8, MAX_LOG = 12;
const HOUR_MAX = 6; // au plus 6 messages WhatsApp par heure et par compte : au-delà, l'alerte reste dans l'application
const NIGHT = [0, 5]; // de minuit à 5 h 59 (heure d'Abidjan = heure universelle), une arrivée est signalée comme inhabituelle

function migrate(s) {
  s.db.exec('CREATE TABLE IF NOT EXISTS wifi_watch(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,on_at INTEGER,known TEXT NOT NULL DEFAULT \'[]\',pending TEXT NOT NULL DEFAULT \'[]\',log TEXT NOT NULL DEFAULT \'[]\')');
  s.db.exec('CREATE TABLE IF NOT EXISTS wifi_watch_key(k TEXT NOT NULL)');
}
// La clé qui rend les numéros d'appareil anonymes : tirée une fois, gardée dans la base (jamais dans git).
let KEY = null;
function key(s) {
  if (KEY && KEY.s === s) return KEY.k;
  let r = s.get('SELECT k FROM wifi_watch_key LIMIT 1');
  if (!r) { r = {k: crypto.randomBytes(32).toString('hex')}; s.run('INSERT INTO wifi_watch_key VALUES(?)', r.k); }
  KEY = {s, k: r.k};
  return r.k;
}
const wid = (s, uid, mac) => crypto.createHmac('sha256', key(s)).update(uid + '|' + String(mac).toLowerCase()).digest('hex').slice(0, 12);

const row = (s, uid) => {
  const r = s.get('SELECT * FROM wifi_watch WHERE user_id=?', uid);
  return r ? {on: r.on_at, known: JSON.parse(r.known), pending: JSON.parse(r.pending), log: JSON.parse(r.log)} : {on: null, known: [], pending: [], log: []};
};
const save = (s, uid, w) => s.run('INSERT INTO wifi_watch(user_id,on_at,known,pending,log) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET on_at=excluded.on_at,known=excluded.known,pending=excluded.pending,log=excluded.log',
  uid, w.on, JSON.stringify(w.known.slice(-MAX_KNOWN)), JSON.stringify(w.pending.slice(-MAX_PENDING)), JSON.stringify(w.log.slice(-MAX_LOG)));
const isOn = (s, uid) => { try { return !!s.get('SELECT on_at FROM wifi_watch WHERE user_id=? AND on_at IS NOT NULL', uid); } catch { return false; } };

const hhmm = t => { const d = new Date(t); return d.getUTCHours() + ' h ' + String(d.getUTCMinutes()).padStart(2, '0'); };
const night = t => { const h = new Date(t).getUTCHours(); return h >= NIGHT[0] && h <= NIGHT[1]; };

// Ce que voit le propriétaire : surveillance active ou non, appareils habituels, nouveaux appareils à reconnaître, dernières alertes.
function view(s, uid, now = Date.now()) {
  const w = row(s, uid), learning = !!w.on && now - w.on < LEARN_MS;
  return {on: !!w.on, since: w.on || null, learning, learnLeft: learning ? Math.ceil((LEARN_MS - (now - w.on)) / 1000) : 0, usual: w.known.length,
    pending: w.pending.map(p => ({id: p.id, label: p.label, at: p.at, night: !!p.night})).reverse(),
    log: w.log.map(l => ({kind: l.kind, text: l.text, at: l.at, whatsapp: l.channel === 'whatsapp'})).reverse()};
}

// Activer : pendant la première minute, les appareils vus par le PC deviennent les appareils habituels.
// Arrêter : Guardian oublie tout (appareils habituels, nouveaux, alertes).
function toggle(s, uid, on, {now = Date.now()} = {}) {
  insist(typeof on === 'boolean', 'Choix invalide.');
  if (!on) { s.run('DELETE FROM wifi_watch WHERE user_id=?', uid); BEATS.delete(uid); return view(s, uid, now); }
  const w = row(s, uid);
  if (!w.on) { w.on = now; w.known = []; w.pending = []; w.log = []; save(s, uid, w); }
  return view(s, uid, now);
}

// « C'est à moi » : l'appareil devient habituel ; Guardian ne le signale plus.
function mine(s, uid, id) {
  insist(typeof id === 'string' && /^[0-9a-f]{12}$/.test(id), 'Appareil inconnu.');
  const w = row(s, uid), p = w.pending.find(x => x.id === id);
  insist(p, 'Appareil inconnu.', 404);
  w.pending = w.pending.filter(x => x.id !== id);
  if (!w.known.includes(id)) w.known.push(id);
  save(s, uid, w);
  return view(s, uid);
}

// Les textes : courts, en mots simples, avec ce qu'il faut faire.
function textNew(label, at) {
  return 'Un nouvel appareil vient de se connecter à votre Wi-Fi à ' + hhmm(at) + (night(at) ? ', en pleine nuit' : '') + ' : « ' + label + ' ».\n\n'
    + 'Si c’est à vous ou à un proche, touchez « C’est à moi » dans l’application Fibre Guardian, écran Appareils.\n'
    + 'Si vous ne le connaissez pas, changez le mot de passe du Wi-Fi : le 111 de Moov peut le faire avec vous.';
}
function textHeavy(d) {
  return 'L’appareil « ' + d.label + ' » utilise beaucoup de données : ' + d.gb + ' Go depuis ' + d.since + ', ' + d.times + ' fois plus que d’habitude.\n\n'
    + (d.usage ? 'Ce que Guardian voit : ' + d.usage + '. ' : '') + 'Si c’est normal, ne faites rien. Sinon, dans l’application, écran Appareils, touchez « Gérer » pour limiter son débit.';
}

// Le PC branché vient de faire le tour du Wi-Fi. Renvoie les alertes à envoyer (nouveaux appareils).
// devices : les appareils présents, avec leur adresse MAC (gardée seulement le temps de ce calcul), hors box et hors PC.
function scan(s, uid, devices, now = Date.now()) {
  const w = row(s, uid); if (!w.on) return [];
  const learning = now - w.on < LEARN_MS, out = [];
  for (const d of devices.slice(0, 64)) {
    if (!d?.mac || d.kind === 'box' || d.kind === 'partage' || d.kind === 'pc') continue;
    const id = wid(s, uid, d.mac);
    if (w.known.includes(id) || w.pending.some(p => p.id === id)) continue;
    if (learning) { w.known.push(id); continue; }
    const label = String(d.label || 'Appareil').slice(0, 60), alert = {kind: 'nouveau', id, text: textNew(label, now), at: now};
    w.pending.push({id, label, at: now, night: night(now)});
    out.push(alert);
  }
  if (out.length || learning) save(s, uid, w);
  return out;
}

// Grosse consommation (jouée dans la Régie) : l'alerte à envoyer.
const heavy = (d, now = Date.now()) => ({kind: 'conso', text: textHeavy(d), at: now});

// Le WhatsApp du propriétaire : celui relié dans « Mon compte », sinon celui de l'hébergeur (WHATSAPP_CLIENTS), sinon
// celui confirmé par un membre du jury. Jamais un nouveau numéro : les places gratuites de Green API sont comptées.
function phoneOf(s, cfg, uid) {
  try { const r = s.get('SELECT phone FROM wa_accounts WHERE user_id=?', uid); if (r?.phone) return r.phone; } catch {}
  const email = s.get('SELECT email FROM users WHERE id=?', uid)?.email;
  const c = (cfg?.clients || []).find(n => email && n.email === String(email).toLowerCase());
  if (c) { try { if (require('./whatsapp-compte.cjs').muted(s, c.phone)) return null; } catch {} return c.phone; }
  try { const j = s.get('SELECT whatsapp FROM jury_members WHERE user_id=? AND wa_ok IS NOT NULL', uid); if (j?.whatsapp) return j.whatsapp; } catch {}
  return null;
}

// L'alerte est toujours notée dans l'application ; elle part aussi sur WhatsApp si le compte en a un (6 par heure au plus).
async function deliver(s, cfg, uid, alert, {fetchImpl = fetch, now = Date.now()} = {}) {
  const w = row(s, uid), WA = require('./whatsapp.cjs');
  const recent = w.log.filter(l => l.channel === 'whatsapp' && now - l.at < 3600000).length;
  const phone = cfg && recent < HOUR_MAX && !WA.full(s, cfg, now) ? phoneOf(s, cfg, uid) : null;
  let channel = 'app';
  if (phone) {
    try { await WA.PROVIDERS[cfg.provider].send(cfg, phone, 'Moov Africa · Fibre Guardian\n\n' + alert.text, fetchImpl); channel = 'whatsapp'; }
    catch (e) { if (e.code === 466) WA.markFull(s, cfg, now); }
  }
  const fresh = row(s, uid); // relu : la surveillance a pu changer pendant l'envoi
  if (alert.kind === 'nouveau' && !fresh.on) return {channel};
  fresh.log.push({kind: alert.kind, text: alert.text, at: alert.at || now, channel});
  save(s, uid, fresh);
  return {channel};
}

// Branché sur le tour du Wi-Fi du PC (vrai-test.cjs) : nouveaux appareils → alertes, envoyées sans bloquer le PC.
function hook(s, getCfg, {onError} = {}) {
  return (linkRow, devices) => {
    let alerts = [];
    try { alerts = scan(s, linkRow.user_id, devices); } catch (e) { onError?.(e); return; }
    (async () => { for (const a of alerts) await deliver(s, getCfg(), linkRow.user_id, a); })().catch(e => onError?.(e));
  };
}

// ---------- Chutes de connexion ----------
// Le PC branché écrit à Guardian toutes les 2 secondes, et toutes les 20 secondes il mesure Internet (3 sondes vers 8.8.8.8).
// Si Internet tombe chez le client, le PC ne peut plus écrire : au bout d'une minute de silence, Guardian prévient le
// propriétaire sur WhatsApp (son téléphone le reçoit par les données mobiles). Quand le PC réécrit, Guardian dit que la
// connexion est revenue et combien de temps elle a été coupée. Si les mesures montrent des pertes ou des temps de réponse
// très longs trois fois de suite (une minute), il prévient que la connexion est instable (une fois par demi-heure au plus).
// Un PC éteint ou fermé se tait aussi : le message le dit honnêtement. Tout reste en mémoire (rien en base).
const SILENT_MS = 60000, FORGET_MS = 30 * 60000, BAD_ROUNDS = 3, BAD_MS = 300, UNSTABLE_GAP = 30 * 60000;
const BEATS = new Map();
const minutes = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m + ' minute' + (m > 1 ? 's' : ''); };
function textDown(from) {
  return 'Guardian ne reçoit plus rien de votre Wi-Fi depuis ' + hhmm(from) + '. Votre connexion Internet est sans doute coupée (ou le PC qui surveille est éteint).\n\n'
    + 'Regardez le voyant de la box : s’il est rouge, la fibre est coupée. Ouvrez l’application Fibre Guardian avec vos données mobiles : elle vous dit si c’est une panne du quartier.';
}
function textBack(from, at) {
  return 'Votre connexion est revenue à ' + hhmm(at) + '. Elle a été coupée ' + minutes(at - from) + ', depuis ' + hhmm(from) + '.';
}
function textUnstable(net) {
  const lost = net.n ? Math.round(100 * net.lost / net.n) : 0;
  return 'Votre connexion est instable depuis une minute : ' + (lost > 0 ? lost + ' % des signaux se perdent' : 'Internet met ' + net.ms + ' ms à répondre') + '. Les appels vidéo et les jeux peuvent couper.\n\n'
    + 'Redémarrez la box (débranchez-la 10 secondes). Si ça continue, écrivez « lent » à Guardian.';
}
// Chaque envoi du PC : renvoie les alertes à envoyer tout de suite (retour de la connexion, connexion instable).
function beat(s, uid, d = {}, now = Date.now()) {
  if (!isOn(s, uid)) { BEATS.delete(uid); return []; }
  const b = BEATS.get(uid) || {at: now, down: null, bad: 0, unstable: 0}, out = [];
  if (b.down?.alerted) out.push({kind: 'retour', text: textBack(b.down.from, now), at: now});
  b.down = null; b.at = now;
  const net = d?.net;
  if (net && typeof net === 'object') {
    const n = Math.min(10, Math.max(1, Number(net.n) || 3)), lost = Math.min(n, Math.max(0, Number(net.lost) || 0)), ms = Number.isFinite(Number(net.ms)) && net.ms !== null ? Math.round(Number(net.ms)) : null;
    b.bad = lost > 0 || (ms != null && ms > BAD_MS) ? b.bad + 1 : 0;
    if (b.bad >= BAD_ROUNDS && now - b.unstable > UNSTABLE_GAP) { b.unstable = now; b.bad = 0; out.push({kind: 'instable', text: textUnstable({n, lost, ms}), at: now}); }
  }
  BEATS.set(uid, b);
  return out;
}
// Toutes les 15 secondes : un PC qui se tait depuis une minute = coupure probable.
async function check(s, getCfg, {now = Date.now(), fetchImpl = fetch} = {}) {
  for (const [uid, b] of BEATS) {
    let on = false; try { on = isOn(s, uid); } catch {}
    if (!on || now - b.at > FORGET_MS) { BEATS.delete(uid); continue; }
    if (b.down || now - b.at < SILENT_MS) continue;
    b.down = {from: b.at, alerted: false};
    await deliver(s, getCfg(), uid, {kind: 'coupure', text: textDown(b.at), at: now}, {fetchImpl, now});
    b.down.alerted = true;
  }
}
function beatHook(s, getCfg, {onError} = {}) {
  return (linkRow, d) => {
    let alerts = [];
    try { alerts = beat(s, linkRow.user_id, d); } catch (e) { onError?.(e); return; }
    (async () => { for (const a of alerts) await deliver(s, getCfg(), linkRow.user_id, a); })().catch(e => onError?.(e));
  };
}

// Tant que la surveillance est active et que le PC envoie ses relevés, son lien de test reste valable (30 minutes glissantes).
function keepLink(s, linkRow, now = Date.now()) {
  if (!isOn(s, linkRow.user_id)) return;
  s.run('UPDATE speed_links SET expires=max(expires,?) WHERE token_hash=?', now + 30 * 60000, linkRow.token_hash);
}

// Régie : « Un appareil consomme beaucoup », joué sur le réseau de démo. Le propriétaire de chaque téléphone du jury
// (et l'administrateur) reçoit l'alerte, sur WhatsApp s'il l'a confirmé. L'appareil vient de la copie du Wi-Fi si elle existe.
const HEAVY = [['Télévision', 'un film en 4K'], ['Console de jeux', 'une mise à jour de 40 Go'], ['PC portable', 'un gros téléchargement']];
function heavyDevice(copy, now = Date.now()) {
  const own = (copy?.devices || []).find(d => !['box', 'partage', 'pc', 'self'].includes(d.kind) && !/^Appareil du test|^PC du client/.test(d.label || ''));
  const [label, usage] = own ? [own.label, null] : HEAVY[0];
  const from = new Date(now - 3 * 3600000);
  return {label, usage: usage || 'de la vidéo en continu depuis plusieurs heures', gb: 18, times: 6, since: from.getUTCHours() + ' h'};
}

// Les téléphones de la salle du jury ouverte (et l'administrateur qui joue la scène) : chacun reçoit l'alerte « grosse consommation ».
async function regieHeavy(s, cfg, adminUid, copy, {fetchImpl = fetch, now = Date.now()} = {}) {
  let users = [];
  try { users = s.all('SELECT m.user_id FROM jury_members m JOIN jury_rooms r ON r.id=m.room AND r.closed=0 AND r.expires>? ORDER BY m.number LIMIT 60', now).map(r => r.user_id); } catch {}
  const device = heavyDevice(copy, now), alert = heavy(device, now);
  let whatsapp = 0;
  for (const uid of [adminUid, ...users.filter(u => u !== adminUid)]) if ((await deliver(s, cfg, uid, alert, {fetchImpl, now})).channel === 'whatsapp') whatsapp++;
  return {device: device.label, text: alert.text, phones: users.length, whatsapp};
}

module.exports = {beat, check, beatHook, textDown, textBack, textUnstable, SILENT_MS, BEATS, regieHeavy, migrate, view, toggle, mine, scan, heavy, heavyDevice, deliver, hook, keepLink, isOn, phoneOf, textNew, textHeavy, wid, LEARN_MS, HOUR_MAX};
