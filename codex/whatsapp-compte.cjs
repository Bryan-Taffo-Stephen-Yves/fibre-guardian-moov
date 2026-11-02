'use strict';
// Le client relie son WhatsApp à son compte, depuis l'application (« Mon compte »), en trois gestes :
// 1. il touche « Relier mon WhatsApp » : l'application lui donne un code à usage unique, et WhatsApp s'ouvre avec un
//    message tout prêt pour Guardian (« … Code : 482917 ») ;
// 2. il envoie ce message : Guardian note le numéro qui a écrit, sans rien répondre (il ne dit ni le prénom ni le quartier
//    à un téléphone que le client n'a pas encore reconnu) ;
// 3. de retour dans l'application, il voit « 07 •• •• •• 56 : est-ce bien votre WhatsApp ? » et confirme. Alors seulement
//    le lien est fait, et Guardian lui écrit sur WhatsApp. Un code vu par quelqu'un d'autre (écran projeté, QR scanné)
//    ne relie donc jamais un autre téléphone : le client répond « Non, ce n'est pas moi ».
// Ensuite, les pannes du quartier du compte arrivent sur ce WhatsApp (whatsapp.cjs), et Guardian y répond avec ce compte :
// même dossier, même suivi que dans l'application (whatsapp-bot.cjs). « Stop » sur WhatsApp, ou « Arrêter » dans
// l'application, défait le lien tout de suite ; un numéro aussi réglé dans l'hébergeur ne reçoit alors plus les alertes client.
// Places : les discussions gratuites de Green API (3 par mois) servent d'abord au jury (jury-store.cjs). Un numéro qui en a
// déjà une (réglé dans l'hébergeur, ou inscrit au jury) se relie sans rien prendre. Un nouveau numéro n'en prend une que si
// WHATSAPP_COMPTE_MAX le permet (0 par défaut), et une seule par compte.
// Réservé aux clients : un compte de l'équipe Moov se relie dans l'hébergeur (WHATSAPP_CLIENTS).
// Le lien vit dans la base du site : « Tout remettre à zéro », ou le réveil d'un hébergement gratuit, l'efface avec le compte.
const crypto = require('node:crypto');
const {insist, Problem} = require('./pilot-model.cjs');
const N = require('./noc-store.cjs'), J = require('./jury-store.cjs'), W = require('./noc-workspace.cjs');

const CODE_MS = 15 * 60000; // un code sert une fois, pendant 15 minutes ; puis 15 minutes pour confirmer le numéro
const FULL = 'Il n’y a plus de place pour les alertes WhatsApp ce mois-ci. Vos alertes continuent d’arriver ici, dans l’application.';
const STOPPED = 'C’est noté : ce WhatsApp n’est plus relié à votre compte Fibre Guardian. Vos alertes continuent d’arriver dans l’application.';
// Le message tout prêt que le client envoie à Guardian.
const ready = code => 'Bonjour Guardian ! Je relie mon WhatsApp à mon compte Fibre Guardian. Code : ' + code;

function migrate(s) {
  // Liens confirmés : le numéro tel que WhatsApp l'écrit (celui qui a envoyé le code).
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,phone TEXT NOT NULL,at INTEGER NOT NULL)');
  // Un code par compte. phone : le numéro qui l'a envoyé, en attente de confirmation dans l'application.
  // problem : « full » (offre gratuite en pause ce mois-ci) ou « places » (places gardées pour le jury) au moment de confirmer,
  // « seen » quand le client a lu ce refus.
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_codes(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,code TEXT NOT NULL UNIQUE,expires INTEGER NOT NULL,phone TEXT,problem TEXT)');
  // Comptes qui ont pris une place gratuite pour un nouveau numéro (une seule par compte).
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_places(user_id TEXT PRIMARY KEY,at INTEGER NOT NULL)');
  // Numéros réglés dans l'hébergeur dont le client a dit « Stop » : plus d'alertes client, jusqu'à ce qu'il se relie.
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_optout(phone TEXT PRIMARY KEY,at INTEGER NOT NULL)');
}

// Même numéro sous ses deux formes ivoiriennes : 225 + 10 chiffres, ou l'ancien 225 + 8 chiffres que WhatsApp garde souvent.
// Seulement pour un numéro tapé à la main (hébergeur, jury) : un numéro venu de WhatsApp se compare tel quel.
const old = p => /^225\d{10}$/.test(p) ? '225' + p.slice(5) : p;
const same = (a, b) => !!a && !!b && (a === b || (/^225\d{8}$/.test(a) && old(b) === a) || (/^225\d{8}$/.test(b) && old(a) === b));
// Assez pour que le client reconnaisse son numéro, jamais le numéro entier : « 07 •• •• •• 56 », « •• •• •• 56 ».
function masked(p) {
  p = String(p || '');
  if (/^225\d{10}$/.test(p)) return p.slice(3, 5) + ' •• •• •• ' + p.slice(-2);
  if (/^225\d{8}$/.test(p)) return '•• •• •• ' + p.slice(-2);
  return '+' + p.slice(0, Math.min(3, Math.max(1, p.length - 4))) + ' •• •• ' + p.slice(-2);
}
// « Niangon (Yopougon) », comme dans les alertes.
const zoneOf = (s, uid) => { const z = N.memberZone(s, uid); if (!z) return null; const [commune, area] = String(z.zone || '').split(' · '); return area ? area + ' (' + commune + ')' : commune || null; };
// Un client : ni l'équipe Moov, ni un technicien de terrain (compte sans rôle d'opérateur), ni un membre du jury.
const subscriber = (s, uid) => W.sessionRole(s, uid) === 'subscriber' && !s.get('SELECT 1 AS x FROM jury_members WHERE user_id=?', uid);

// Réglages des alertes (whatsapp.cjs), posés sur la base par le serveur : places et numéros de l'hébergeur.
const alerts = s => s.whatsappAlerts || null;
const configured = (cfg, phone) => [...(cfg?.list || []), ...(cfg?.clients || [])].some(n => same(n.phone, phone));
// Une discussion déjà ouverte (numéro de l'hébergeur, ou qui a déjà reçu un message) ne prend pas de nouvelle place.
const known = (s, cfg, phone) => configured(cfg, phone) || [phone, old(phone)].some(p => J.whatsappUsed(s, p));
const free = (s, cfg) => Math.max(0, (cfg?.jury || 0) - J.whatsappCount(s));
// Un nouveau numéro peut-il avoir une place ? Il en reste une, WHATSAPP_COMPTE_MAX en laisse une aux clients,
// et ce compte n'en a encore jamais pris.
const room = (s, cfg, uid) => free(s, cfg) > 0 && s.get('SELECT count(*) AS n FROM wa_places').n < (cfg?.compte || 0) && !s.get('SELECT 1 AS x FROM wa_places WHERE user_id=?', uid);

// ——— Numéro WhatsApp de Guardian (celui de l'instance Green API) ———
// Green API le donne dans ses réglages (« wid » : « 2250102030405@c.us »). Demandé une fois, puis gardé en mémoire ;
// sans réponse, on redemande au bout de 5 minutes. Sans lui, pas de lien wa.me, donc pas de carte.
const numbers = new Map();
async function guardianNumber(cfg, fetchImpl = fetch, now = Date.now()) {
  if (cfg?.provider !== 'greenapi' || !cfg.id) return null;
  const key = cfg.url + '|' + cfg.id, hit = numbers.get(key);
  if (hit?.phone) return hit.phone;
  if (hit && now - hit.at < 5 * 60000) return hit.wait ? hit.wait : null;
  const wait = (async () => {
    try {
      const r = await fetchImpl(cfg.url + '/waInstance' + cfg.id + '/getSettings/' + encodeURIComponent(cfg.token), {signal: AbortSignal.timeout(5000)});
      const phone = r.ok ? String((await r.json())?.wid || '').split('@')[0] : '';
      return /^\d{8,15}$/.test(phone) ? phone : null;
    } catch { return null; }
  })();
  numbers.set(key, {at: now, wait});
  const phone = await wait;
  numbers.set(key, {at: now, phone});
  return phone;
}

// ——— Côté application (« Mon compte ») ———
// available : Guardian peut lire les messages WhatsApp (Green API et son webhook), connaît son propre numéro,
// et l'offre gratuite n'est pas en pause ce mois-ci.
// state : « none » (rien), « waiting » (code affiché, message pas encore reçu), « confirm » (un numéro a envoyé le code :
// au client de dire si c'est le sien), « on » (relié).
function state(s, uid, {bot = null, number = null, full = false} = {}) {
  const now = Date.now(), cfg = alerts(s);
  s.run('DELETE FROM wa_codes WHERE expires<=? AND problem IS NULL', now);
  const link = s.get('SELECT phone FROM wa_accounts WHERE user_id=?', uid), code = s.get('SELECT * FROM wa_codes WHERE user_id=?', uid);
  const ok = subscriber(s, uid) && cfg?.provider === 'greenapi' && !!cfg.replies && !!bot && !!number && !full;
  const out = {available: ok, state: 'none', number: null, end: null, zone: zoneOf(s, uid), problem: null};
  if (link) Object.assign(out, {state: 'on', number: masked(link.phone), end: String(link.phone).slice(-2)});
  // Pas de place pour le numéro confirmé : dit jusqu'à « Compris » (même si la carte n'est plus proposée) ; ensuite, la carte
  // dit seulement que les alertes arrivent dans l'application (« refused »), avec « Essayer avec un autre téléphone ».
  else if (code?.problem === 'seen') out.refused = true;
  else if (code?.problem) out.problem = code.problem;
  else if (code?.phone) Object.assign(out, {state: 'confirm', number: masked(code.phone), end: String(code.phone).slice(-2), expires: code.expires});
  else if (code && ok) Object.assign(out, {state: 'waiting', code: code.code.slice(0, 3) + ' ' + code.code.slice(3), link: 'https://wa.me/' + number + '?text=' + encodeURIComponent(ready(code.code)), expires: code.expires});
  return out;
}

const tooMany = (s, key, max, period, message) => { try { s.rate(key, max, period); } catch (e) { if (e.status === 429) throw new Problem(429, message); throw e; } };
// « Relier mon WhatsApp » : un code à usage unique pour ce compte (le précédent ne vaut plus).
function begin(s, uid, ctx = {}) {
  insist(subscriber(s, uid), 'Les alertes de l’équipe Moov se règlent avec l’administrateur.', 403);
  const now = state(s, uid, ctx);
  insist(now.available, 'Les alertes WhatsApp ne sont pas disponibles pour le moment. Vos alertes arrivent ici, dans l’application.', 409);
  insist(now.state !== 'on', 'Votre WhatsApp est déjà relié à votre compte.', 409);
  tooMany(s, 'wa-code:' + uid, 10, 3600000, 'Vous avez demandé beaucoup de codes. Réessayez dans une heure.');
  let code;
  do code = String(crypto.randomInt(100000, 1000000)); while (s.get('SELECT 1 AS x FROM wa_codes WHERE code=?', code));
  s.run('INSERT INTO wa_codes(user_id,code,expires,phone,problem) VALUES(?,?,?,NULL,NULL) ON CONFLICT(user_id) DO UPDATE SET code=excluded.code,expires=excluded.expires,phone=NULL,problem=NULL', uid, code, Date.now() + CODE_MS);
  return state(s, uid, ctx);
}

// Ce que le site gardait sur un numéro (menus, messages reçus, lien de test), effacé quand plus personne ne l'utilise :
// ni un autre compte, ni l'hébergeur, ni un membre du jury.
function forget(s, phone) {
  if (configured(alerts(s), phone)) return;
  if (s.get('SELECT 1 AS x FROM wa_accounts WHERE phone=?', phone)) return;
  if (s.all('SELECT whatsapp FROM jury_members WHERE whatsapp IS NOT NULL').some(r => same(r.whatsapp, phone))) return;
  J.wipeWhatsapp(s, [phone]);
}
// Numéro réglé dans l'hébergeur comme client : après « Stop », il ne reçoit plus les alertes client.
function optOut(s, phone) {
  const cfg = alerts(s);
  if ([...(cfg?.clients || []), ...(cfg?.list || []).filter(n => n.role === 'client')].some(n => same(n.phone, phone))) s.run('INSERT OR REPLACE INTO wa_optout(phone,at) VALUES(?,?)', phone, Date.now());
}
const optedOut = s => { try { return s.all('SELECT phone FROM wa_optout').map(r => r.phone); } catch { return []; } };
const unmute = (s, phone) => { for (const p of optedOut(s)) if (same(p, phone)) s.run('DELETE FROM wa_optout WHERE phone=?', p); };
// « Arrêter », « Annuler », « Non, ce n'est pas moi » ou « Compris » : le lien et le code disparaissent tout de suite.
// « Compris » après « places » est gardé (« seen ») : la carte ne repropose pas aussitôt le même chemin sans issue.
function stop(s, uid, ctx = {}) {
  const r = s.get('SELECT phone FROM wa_accounts WHERE user_id=?', uid);
  if (s.get("SELECT 1 AS x FROM wa_codes WHERE user_id=? AND problem='places'", uid)) s.run("UPDATE wa_codes SET problem='seen',phone=NULL WHERE user_id=?", uid);
  else s.run('DELETE FROM wa_codes WHERE user_id=?', uid);
  if (r) { s.run('DELETE FROM wa_accounts WHERE user_id=?', uid); optOut(s, r.phone); forget(s, r.phone); }
  return state(s, uid, ctx);
}

// « Oui, c'est mon numéro » : le lien est fait, si ce numéro peut avoir une place. Retourne ce qu'il faut pour écrire
// au client sur WhatsApp, et pour tout remettre comme avant si Green API refuse ce message.
function confirm(s, uid, ctx = {}) {
  insist(subscriber(s, uid), 'Les alertes de l’équipe Moov se règlent avec l’administrateur.', 403);
  const now = Date.now(), cfg = alerts(s), row = s.get('SELECT * FROM wa_codes WHERE user_id=? AND phone IS NOT NULL AND problem IS NULL AND expires>?', uid, now);
  insist(row, 'Ce code n’est plus valable. Touchez de nouveau « Relier mon WhatsApp ».', 409);
  insist(state(s, uid, ctx).available, 'Les alertes WhatsApp ne sont pas disponibles pour le moment. Vos alertes arrivent ici, dans l’application.', 409);
  const phone = row.phone, fresh = !known(s, cfg, phone);
  // Pas de place : « full » si l'offre gratuite est en pause ce mois-ci, « places » si elles sont gardées pour le jury.
  if (fresh && (require('./whatsapp.cjs').full(s, cfg) || !room(s, cfg, uid))) {
    s.run('UPDATE wa_codes SET phone=NULL,problem=? WHERE user_id=?', require('./whatsapp.cjs').full(s, cfg) ? 'full' : 'places', uid);
    return {full: true, state: state(s, uid, ctx)};
  }
  const before = s.get('SELECT * FROM wa_accounts WHERE user_id=?', uid), others = s.all('SELECT * FROM wa_accounts WHERE user_id<>? AND phone=?', uid, phone);
  const muted = optedOut(s).filter(p => same(p, phone)); // « Stop » d'avant, remis si Guardian ne peut pas écrire
  s.transaction(() => {
    // Un téléphone n'est relié qu'à un compte : le dernier qui l'a confirmé.
    s.run('DELETE FROM wa_accounts WHERE user_id<>? AND phone=?', uid, phone);
    s.run('INSERT INTO wa_accounts(user_id,phone,at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,at=excluded.at', uid, phone, now);
    s.run('DELETE FROM wa_codes WHERE user_id=?', uid);
    unmute(s, phone);
    // Guardian va écrire à ce numéro : la discussion prend une place gratuite (sauf numéro réglé dans l'hébergeur).
    if (fresh) { J.useWhatsapp(s, phone); s.run('INSERT OR IGNORE INTO wa_places(user_id,at) VALUES(?,?)', uid, now); }
  });
  const u = s.get('SELECT name FROM users WHERE id=?', uid);
  return {user: uid, phone, code: row, before, others, muted, fresh, first: String(u?.name || '').split(' ')[0] || null, zone: zoneOf(s, uid)};
}
// Message de Guardian refusé (offre gratuite pleine) : tout revient comme avant, et l'application le dit au client.
function undo(s, got) {
  s.transaction(() => {
    s.run('DELETE FROM wa_accounts WHERE user_id=?', got.user);
    for (const r of [got.before, ...got.others].filter(Boolean)) s.run('INSERT OR REPLACE INTO wa_accounts(user_id,phone,at) VALUES(?,?,?)', r.user_id, r.phone, r.at);
    if (got.fresh) s.run('DELETE FROM wa_places WHERE user_id=?', got.user);
    for (const p of got.muted || []) s.run('INSERT OR REPLACE INTO wa_optout(phone,at) VALUES(?,?)', p, Date.now());
    s.run("INSERT OR REPLACE INTO wa_codes(user_id,code,expires,phone,problem) VALUES(?,?,?,NULL,'full')", got.user, got.code.code, got.code.expires);
  });
}
const linked = ({first, zone} = {}) => 'Merci' + (first ? ' ' + first : '') + ' ! Votre WhatsApp est relié à votre compte Fibre Guardian. ' +
  (zone ? 'Je vous écris ici si une panne touche ' + zone + '.' : 'Choisissez votre quartier dans l’application : je vous écrirai ici si une panne le touche.') +
  ' Vous pouvez aussi m’écrire ici, comme dans l’application. Répondez « Stop » pour arrêter.';

// ——— Côté WhatsApp (whatsapp-bot.cjs) ———
// Le code, seulement dans le message tout prêt (« … Je relie mon WhatsApp à mon compte Fibre Guardian. Code : 482917 ») :
// six chiffres glissés dans une autre phrase (un montant, un numéro de ticket) ne relient jamais rien.
const codeIn = text => { const m = /je relie mon whatsapp à mon compte fibre guardian\W*code\s*:?\s*(\d{3}) ?(\d{3})\s*$/i.exec(String(text || '').normalize('NFC')); return m ? m[1] + m[2] : null; };
// Le message tout prêt, avec un code valable pas encore utilisé : le numéro qui l'a envoyé attend la confirmation du client
// dans l'application, et Guardian ne répond rien. Retourne « claimed », « taken » (ce WhatsApp est déjà relié à un autre
// compte : rien ne change tant qu'il n'a pas dit « Stop »), ou null (message ordinaire).
function claim(s, phone, text, now = Date.now()) {
  const code = codeIn(text); if (!code) return null;
  const row = s.get('SELECT * FROM wa_codes WHERE code=? AND expires>? AND phone IS NULL AND problem IS NULL', code, now);
  if (!row || !subscriber(s, row.user_id)) return null;
  const owner = s.get('SELECT user_id FROM wa_accounts WHERE phone=?', phone);
  if (owner && owner.user_id !== row.user_id) return 'taken';
  s.run('UPDATE wa_codes SET phone=?,expires=? WHERE user_id=?', phone, now + CODE_MS, row.user_id);
  return 'claimed';
}
const TAKEN = 'Ce WhatsApp est déjà relié à un compte Fibre Guardian. Pour le relier à un autre compte, répondez d’abord « Stop », puis renvoyez le message.';
// Le client relié à ce numéro, sinon null. Le numéro est comparé tel que WhatsApp l'a donné.
function byPhone(s, phone) {
  const r = s.get('SELECT user_id FROM wa_accounts WHERE phone=? ORDER BY at DESC', phone);
  return r ? s.get('SELECT id,name FROM users WHERE id=?', r.user_id) || null : null;
}
// « Stop » envoyé sur WhatsApp : le lien est défait.
function stopPhone(s, phone) {
  if (!s.get('SELECT 1 AS x FROM wa_accounts WHERE phone=?', phone)) return false;
  s.run('DELETE FROM wa_accounts WHERE phone=?', phone);
  optOut(s, phone); forget(s, phone);
  return true;
}

// ——— Alertes (whatsapp.cjs) ———
// Clients reliés, avec le quartier de leur compte : ils reçoivent les pannes de ce quartier.
function audience(s) {
  try { return s.all('SELECT a.phone,m.segment_id AS segment FROM wa_accounts a JOIN noc_members m ON m.user_id=a.user_id'); }
  catch { return []; } // base sans cette table
}
const phones = s => { try { return s.all('SELECT phone FROM wa_accounts').map(r => r.phone); } catch { return []; } };
const muted = (s, phone) => optedOut(s).some(p => same(p, phone));

module.exports = {migrate, state, begin, stop, confirm, claim, undo, linked, byPhone, stopPhone, audience, phones, muted, guardianNumber, forgetNumbers: () => numbers.clear(), codeIn, same, masked, ready, FULL, STOPPED, TAKEN, CODE_MS};
