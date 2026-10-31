'use strict';
// Vrai test de connexion : il se fait sur l'appareil du client (téléphone ou ordinateur, sur le Wi-Fi de la box
// ou en partage de connexion), entre cet appareil et le serveur de Guardian. Rien n'est simulé ici.
// Le client l'ouvre depuis l'application ou depuis WhatsApp avec un lien personnel valable 30 minutes ;
// le résultat revient dans sa conversation avec Guardian (et sur WhatsApp si le lien est parti de là).
const crypto = require('node:crypto'), journey = require('./journey-store.cjs'), {Problem} = require('./pilot-model.cjs');

const LINK_MS = 30 * 60000, MAX_TESTS = 6;
const POOL = crypto.randomBytes(2 * 1024 * 1024); // 2 Mio, comme l'outil « Tests réels » du laboratoire
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const fmt = (v, d = 0) => Number(v).toLocaleString('fr-FR', {maximumFractionDigits: d, minimumFractionDigits: d});

function migrate(s) {
  s.db.exec('CREATE TABLE IF NOT EXISTS speed_links(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,phone TEXT,created INTEGER NOT NULL,expires INTEGER NOT NULL,tests INTEGER NOT NULL DEFAULT 0)');
}

// Un lien personnel : le jeton n'est jamais gardé en clair, seulement son empreinte.
function link(s, uid, {phone = null, origin = ''} = {}) {
  const token = crypto.randomBytes(18).toString('base64url'), now = Date.now();
  s.run('DELETE FROM speed_links WHERE expires<?', now);
  s.run('INSERT INTO speed_links VALUES(?,?,?,?,?,0)', sha(token), uid, phone, now, now + LINK_MS);
  return {token, url: origin + '/codex/test.html#' + token, expires: now + LINK_MS};
}

function open(s, token) {
  const ok = typeof token === 'string' && /^[A-Za-z0-9_-]{20,40}$/.test(token);
  const row = ok && s.get('SELECT * FROM speed_links WHERE token_hash=? AND expires>?', sha(token), Date.now());
  if (!row) throw new Problem(404, 'Ce lien de test a expiré. Demandez-en un nouveau à Guardian.');
  return row;
}

const NETWORK = {wifi: 'Wi-Fi de la box', hotspot: 'Partage de connexion d’un téléphone', cellular: 'Données mobiles', ethernet: 'Câble de la box', none: 'Aucun'};
function clean(m) {
  const num = (v, max) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), max) : null;
  return {downloadMbps: num(m?.downloadMbps, 10000), latencyMs: num(m?.latencyMs, 60000), jitterMs: num(m?.jitterMs, 60000), lossPct: num(m?.lossPct, 100) ?? 0, network: NETWORK[m?.network] ? m.network : null};
}

// Ce que Guardian conclut, par des règles simples et dites honnêtement : le test passe par le serveur de Guardian,
// hébergé loin d'Abidjan, donc le débit mesuré peut être plus bas que celui de la fibre.
function verdict(m, {fault = null, plan = null} = {}) {
  const speed = m.downloadMbps, wait = m.latencyMs, facts = [
    {label: 'Débit mesuré', value: speed == null ? 'pas de transfert réussi' : fmt(speed, speed < 10 ? 1 : 0) + ' Mbps'},
    {label: 'Temps de réponse', value: wait == null ? 'aucune réponse' : fmt(wait) + ' ms'},
    {label: 'Sondes sans réponse', value: Math.round(m.lossPct / 20) + ' sur 5'},
    {label: 'Réseau utilisé', value: NETWORK[m.network] || 'non indiqué par l’appareil'},
    {label: 'Où', value: 'sur votre appareil, jusqu’au serveur de Guardian'}
  ];
  if (plan) facts.push({label: 'Votre forfait', value: plan.mbps + ' Mbps'});
  const mobile = m.network === 'cellular' ? ' Ce test est passé par les données mobiles, pas par votre box.' : m.network === 'hotspot' ? ' Ce test est passé par le partage de connexion d’un téléphone, pas par votre box.' : '';
  const outage = fault ? 'Une panne est en cours dans votre quartier : Moov s’en occupe déjà. ' : '';
  let level, text;
  if (speed == null && wait == null) { level = 'coupe'; text = 'Je n’ai reçu aucune réponse pendant le test : la connexion de cet appareil ne passe pas en ce moment.'; }
  else if (m.lossPct >= 40) { level = 'instable'; text = 'Votre connexion coupe par moments : ' + Math.round(m.lossPct / 20) + ' sondes sur 5 sont restées sans réponse. Rapprochez-vous de la box et refaites le test.'; }
  else if (speed != null && speed < 1) { level = 'tres-lente'; text = 'Votre connexion est très lente en ce moment : ' + fmt(speed, 1) + ' Mbps. Une page web aura du mal à s’ouvrir. Refaites le test près de la box : si c’est plus rapide, c’est le Wi-Fi.'; }
  else if ((speed != null && speed < 5) || (wait != null && wait > 800)) { level = 'lente'; text = 'Votre connexion est lente en ce moment : ' + (speed == null ? '' : fmt(speed, 1) + ' Mbps, ') + 'réponse en ' + fmt(wait) + ' ms. Les vidéos risquent de couper. Refaites le test près de la box pour savoir si c’est le Wi-Fi.'; }
  else { level = 'bonne'; text = 'Votre connexion marche bien en ce moment : ' + fmt(speed, speed < 10 ? 1 : 0) + ' Mbps, réponse en ' + fmt(wait) + ' ms. Si une application rame, c’est sans doute elle, ou le Wi-Fi de la pièce où vous êtes.'; }
  return {level, text: outage + text + mobile, facts};
}

// Le résultat entre dans la conversation du client, comme une réponse de Guardian.
function record(s, row, metrics) {
  const m = clean(metrics);
  s.run('UPDATE speed_links SET tests=tests+1 WHERE token_hash=?', row.token_hash);
  let st = journey.get(s, row.user_id); if (!st) { st = journey.seed(); journey.put(s, row.user_id, st); }
  const fault = journey.snapshotFor(s, row.user_id, st)?.sharedIncident || null;
  const r = verdict(m, {fault, plan: st.plan});
  const id = () => crypto.randomBytes(8).toString('hex');
  st.messages.push({id: id(), role: 'user', text: 'J’ai testé ma connexion.'}, {id: id(), role: 'assistant', text: r.text, facts: r.facts, verdict: 'test-' + r.level});
  st.messages = st.messages.slice(-30); st.version++; journey.put(s, row.user_id, st);
  return {...r, metrics: m};
}

// Pour la page de test : le prénom du client et d'où vient le lien, rien d'autre.
function info(s, row) {
  const u = s.get('SELECT name FROM users WHERE id=?', row.user_id);
  let st = journey.get(s, row.user_id); if (!st) { st = journey.seed(); journey.put(s, row.user_id, st); }
  return {name: String(u?.name || '').split(' ')[0], whatsapp: !!row.phone, plan: st?.plan?.mbps || null, expires: row.expires, tests: row.tests, maxTests: MAX_TESTS};
}

module.exports = {migrate, link, open, clean, verdict, record, info, NETWORK, POOL, LINK_MS, MAX_TESTS};
