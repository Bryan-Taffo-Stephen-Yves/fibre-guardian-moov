'use strict';
// Alertes sur le téléphone, même application fermée (Web Push, voir webpush.cjs).
// Chacun active les alertes sur son propre téléphone : le client dans « Mon compte », le technicien sur « Mes missions ».
// Ce qui part :
//   - client : les messages de la panne de son quartier (les mêmes que sur WhatsApp, sim-flow.js), et les messages
//     de son application (« Mes messages » : Wi-Fi, passage du technicien, forfait…, journey-store.cjs) ;
//   - technicien : les messages de SES missions ;
//   - équipe Moov (agent, superviseur, direction) : les messages de l'équipe (plan à valider, technicien affecté…).
// Rien n'est envoyé deux fois (table push_sent), rien de plus vieux que 2 minutes (redémarrage, démo pré-remplie).
const crypto = require('node:crypto'), W = require('./webpush.cjs'), F = require('./sim-flow.js'), N = require('./noc-store.cjs'), O = require('./operator-store.cjs');
const {insist} = require('./pilot-model.cjs');

const RECENT = 120000, PER_USER = 5;
const TITLE = {client: 'Fibre Guardian', team: 'Fibre Guardian · Équipe Moov', tech: 'Fibre Guardian · Votre mission'};
const URL_OF = {client: './?section=notifications', team: './?portal=moov&section=operations', tech: './?portal=moov'};

let state = null; // {keys, subject, fetchImpl, hosts, onError}

function config(env = process.env, extra = {}) {
  const keys = W.vapidKeys(env.VAPID_PRIVATE_KEY);
  const origin = String(env.GUARDIAN_ORIGIN || '').replace(/\/$/, '');
  // Apple refuse un expéditeur « localhost » : l'adresse publique du site, sinon une adresse de contact.
  const subject = String(env.VAPID_SUBJECT || '').trim() || (/^https:\/\//.test(origin) ? origin : 'mailto:guardian@fibre-guardian.ci');
  return {keys, subject, fetchImpl: extra.fetchImpl || fetch, hosts: extra.hosts || W.HOSTS, onError: extra.onError};
}

function migrate(s) {
  s.db.exec(`CREATE TABLE IF NOT EXISTS push_subs(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,created INTEGER NOT NULL,last_ok INTEGER,failures INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id);
   CREATE TABLE IF NOT EXISTS push_sent(key TEXT PRIMARY KEY,at INTEGER NOT NULL);`);
  s.run('DELETE FROM push_sent WHERE at<?', Date.now() - 86400000);
}
const ready = s => { try { s.get('SELECT 1 AS x FROM push_subs LIMIT 1'); return true; } catch { return false; } };

// ----- Abonnements (routes /api/push) -----
function view(s, uid) {
  return {publicKey: state?.keys.publicKey || null, devices: ready(s) ? s.get('SELECT COUNT(*) AS n FROM push_subs WHERE user_id=?', uid).n : 0};
}
function subscribe(s, uid, d) {
  insist(state, 'Les alertes du téléphone ne sont pas disponibles.', 503);
  const endpoint = String(d?.endpoint || ''), p256dh = String(d?.keys?.p256dh || ''), auth = String(d?.keys?.auth || '');
  insist(endpoint.length <= 1000 && W.endpointOk(endpoint, state.hosts), 'Ce téléphone ne peut pas recevoir les alertes.', 400);
  insist(/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) && /^[A-Za-z0-9_-]{16,40}$/.test(auth), 'Ce téléphone ne peut pas recevoir les alertes.', 400);
  try { W.encrypt({keys: {p256dh, auth}}, 'essai'); } catch { insist(false, 'Ce téléphone ne peut pas recevoir les alertes.', 400); }
  // Un téléphone appartient au dernier compte qui s'y est connecté.
  s.run('INSERT INTO push_subs(endpoint,user_id,p256dh,auth,created) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,failures=0', endpoint, uid, p256dh, auth, Date.now());
  // 5 téléphones au plus par compte : les plus anciens sortent.
  for (const r of s.all('SELECT endpoint FROM push_subs WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT -1 OFFSET ?', uid, PER_USER)) s.run('DELETE FROM push_subs WHERE endpoint=?', r.endpoint);
  return view(s, uid);
}
function unsubscribe(s, uid, d) {
  s.run('DELETE FROM push_subs WHERE endpoint=? AND user_id=?', String(d?.endpoint || ''), uid);
  return view(s, uid);
}

// ----- Envoi -----
async function toUser(s, uid, message) {
  if (!state || !ready(s)) return 0;
  let sent = 0;
  for (const sub of s.all('SELECT endpoint,p256dh,auth FROM push_subs WHERE user_id=?', uid)) {
    try {
      const r = await W.send({endpoint: sub.endpoint, keys: {p256dh: sub.p256dh, auth: sub.auth}}, message, {keys: state.keys, subject: state.subject, fetchImpl: state.fetchImpl});
      if (r.ok) { sent++; s.run('UPDATE push_subs SET last_ok=?,failures=0 WHERE endpoint=?', Date.now(), sub.endpoint); }
      else if (r.gone || r.status === 403) s.run('DELETE FROM push_subs WHERE endpoint=?', sub.endpoint); // désabonné, ou clé du serveur changée
      else s.run('UPDATE push_subs SET failures=failures+1 WHERE endpoint=?', sub.endpoint);
    } catch (e) { try { s.run('UPDATE push_subs SET failures=failures+1 WHERE endpoint=?', sub.endpoint); } catch {} state?.onError?.(e); }
  }
  try { s.run('DELETE FROM push_subs WHERE failures>=10'); } catch {}
  return sent;
}
// Réserve la clé avant l'envoi : un message ne part jamais deux fois, même si deux passages se croisent.
const once = (s, key) => !!s.run('INSERT OR IGNORE INTO push_sent VALUES(?,?)', key, Date.now()).changes;
const short = text => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 10);

// Messages « Mes messages » de l'application du client (journey-store.cjs les écrit ; appelé juste avant l'enregistrement).
// pushMark : la date du dernier message déjà passé par ici, gardée dans l'état du client.
function fromJourney(s, uid, st, now = Date.now()) {
  if (!st || !Array.isArray(st.notifications)) return;
  const mark = Number.isFinite(st.pushMark) ? st.pushMark : now - 60000;
  // home-1 = le foyer du client (les autres foyers sont les voisins du quartier dans la démonstration).
  const fresh = st.notifications.filter(n => n && !n.read && n.at > mark && now - n.at <= RECENT && (!n.home || n.home === 'home-1'));
  st.pushMark = Math.max(mark, ...st.notifications.map(n => n?.at || 0).filter(at => at <= now));
  if (!fresh.length || !state || !ready(s) || !s.get('SELECT 1 AS x FROM push_subs WHERE user_id=? LIMIT 1', uid)) return;
  for (const n of fresh.reverse()) {
    if (!once(s, 'j|' + uid + '|' + (n.key || n.at + short(n.title)))) continue;
    toUser(s, uid, {title: n.title || TITLE.client, body: n.body || '', tag: n.key || undefined, url: './?section=' + (n.page || 'notifications')}).catch(e => state?.onError?.(e));
  }
}

// Qui reçoit les messages de la panne : clients du quartier touché, technicien de la mission, équipe Moov.
function audience(s, role, incident, reached) {
  if (role === 'client') {
    const marks = reached.map(() => '?').join(',');
    return s.all('SELECT DISTINCT m.user_id AS id FROM noc_members m JOIN push_subs p ON p.user_id=m.user_id WHERE m.segment_id IN (' + marks + ')', ...reached)
      .map(r => r.id).filter(id => O.role(s, id) === 'subscriber' && !isField(s, id));
  }
  if (role === 'tech') return incident.technician ? s.all('SELECT DISTINCT f.user_id AS id FROM noc_field_accounts f JOIN push_subs p ON p.user_id=f.user_id WHERE f.technician_id=?', incident.technician).map(r => r.id) : [];
  if (role === 'team') return s.all('SELECT DISTINCT g.user_id AS id FROM operator_grants g JOIN push_subs p ON p.user_id=g.user_id').map(r => r.id);
  return [];
}
function isField(s, uid) { try { return !!s.get('SELECT 1 AS x FROM noc_field_accounts WHERE user_id=?', uid); } catch { return false; } }

// Un passage (toutes les 3 secondes) sur les pannes du réseau de démonstration.
async function tick(s, now = Date.now()) {
  if (!state || s.demoSeeding || !ready(s) || !s.get('SELECT 1 AS x FROM push_subs LIMIT 1')) return 0;
  const {segments, incidents, technicians} = N.activity(s, now - 15 * 60000), jobs = [];
  for (const i of incidents) {
    const seg = segments.find(g => g.id === i.segment_id); if (!seg) continue;
    const G = require('./abidjan-map.js'), wide = F.reach(i, seg, segments).wide;
    const reached = wide ? segments.filter(g => G.SEGMENTS[g.id]?.commune === G.SEGMENTS[seg.id]?.commune).map(g => g.id) : [seg.id];
    for (const m of F.messages(i, seg, technicians, now)) {
      if (m.channel !== 'whatsapp' && m.channel !== 'app') continue;
      if (now - m.at > RECENT || m.at > now) continue;
      for (const uid of audience(s, m.to, i, reached)) {
        if (!once(s, ['n', i.id, m.to, m.at, uid, short(m.body)].join('|'))) continue;
        const url = m.to === 'client' && /en route|sur place/.test(m.body) ? './?section=tracking' : URL_OF[m.to];
        jobs.push(toUser(s, uid, {title: TITLE[m.to], body: m.body, tag: 'fg-' + i.id + '-' + m.to, url}));
      }
    }
  }
  return (await Promise.all(jobs)).reduce((a, b) => a + b, 0);
}

function start(s, {env = process.env, fetchImpl, hosts, onError} = {}) {
  migrate(s);
  state = config(env, {fetchImpl, hosts, onError});
  if (state.keys.generated && !process.env.NODE_TEST_CONTEXT) console.warn('Alertes du téléphone : VAPID_PRIVATE_KEY absente, clé temporaire créée (les téléphones se réabonnent à la réouverture de l’application).');
  let busy = false;
  const timer = setInterval(() => { if (busy) return; busy = true; tick(s).catch(e => onError?.(e)).finally(() => { busy = false; }); }, 3000);
  timer.unref();
  return {stop() { clearInterval(timer); }, get publicKey() { return state?.keys.publicKey; }};
}

module.exports = {config, migrate, view, subscribe, unsubscribe, toUser, fromJourney, tick, start, audience, RECENT,
  _state: () => state, _set: v => { state = v; }};
