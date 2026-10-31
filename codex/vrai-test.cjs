'use strict';
// Vrai test de connexion : il se fait sur l'appareil du client (téléphone ou ordinateur, sur le Wi-Fi de la box
// ou en partage de connexion), entre cet appareil et le serveur de Guardian. Rien n'est simulé ici.
// Le client l'ouvre depuis l'application ou depuis WhatsApp avec un lien personnel valable 30 minutes ;
// le résultat revient dans sa conversation avec Guardian (et sur WhatsApp si le lien est parti de là).
const crypto = require('node:crypto'), journey = require('./journey-store.cjs'), {Problem} = require('./pilot-model.cjs');

const LINK_MS = 30 * 60000, MAX_TESTS = 6;
const POOL = crypto.randomBytes(2 * 1024 * 1024); // 2 Mio, comme l'outil « Tests réels » du laboratoire
const SAMPLE = POOL.subarray(0, 512 * 1024); // mesure en direct : 512 Kio toutes les 10 secondes
const MAX_UPLOAD = 2 * 1024 * 1024 + 4096;
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
  return {downloadMbps: num(m?.downloadMbps, 10000), uploadMbps: num(m?.uploadMbps, 10000), latencyMs: num(m?.latencyMs, 60000), jitterMs: num(m?.jitterMs, 60000), lossPct: num(m?.lossPct, 100) ?? 0, network: NETWORK[m?.network] ? m.network : null};
}

// Ce que Guardian conclut, par des règles simples et dites honnêtement : le test passe par le serveur de Guardian,
// hébergé loin d'Abidjan, donc le débit mesuré peut être plus bas que celui de la fibre.
function verdict(m, {fault = null, plan = null} = {}) {
  const speed = m.downloadMbps, wait = m.latencyMs, facts = [
    {label: 'Débit mesuré', value: speed == null ? 'pas de transfert réussi' : fmt(speed, speed < 10 ? 1 : 0) + ' Mbps'},
    ...(m.uploadMbps == null ? [] : [{label: 'Débit d’envoi', value: fmt(m.uploadMbps, m.uploadMbps < 10 ? 1 : 0) + ' Mbps'}]),
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

// Pannes simulées (bouton « Démo » de la page de test) : on part des VRAIES mesures de l'appareil et on montre
// comment elles changeraient pendant la panne, et ce que Guardian ferait. Rien n'est touché sur le réseau.
// down : part du débit gardée ; add : millisecondes ajoutées ; loss : sondes perdues (%) ; cut : plus rien ne passe.
const SCENARIOS = {
  'wifi-sature': {label: 'Wi-Fi saturé', hint: '12 appareils en même temps', down: 0.15, add: 180, jitter: 90, loss: 0,
    guardian: 'Beaucoup d’appareils se partagent votre Wi-Fi en ce moment. Avec votre accord, je limite les appareils les plus gourmands pendant 30 minutes, puis je refais la mesure.'},
  'loin-box': {label: 'Loin de la box', hint: 'derrière deux murs', down: 0.3, add: 60, jitter: 40, loss: 20,
    guardian: 'Le signal Wi-Fi est faible là où vous êtes : la fibre, elle, va bien. Rapprochez-vous de la box, ou demandez un répéteur Wi-Fi Moov pour cette pièce.'},
  'quartier-charge': {label: 'Quartier chargé', hint: 'heure de pointe', down: 0.4, add: 120, jitter: 30, loss: 0,
    guardian: 'Votre box et votre Wi-Fi vont bien : c’est le réseau du quartier qui est chargé à cette heure. L’équipe Moov est prévenue et suit la charge du quartier.'},
  'fibre-abimee': {label: 'Fibre abîmée', hint: 'coupures par moments', down: 0.6, add: 40, jitter: 250, loss: 60,
    guardian: 'La ligne coupe par moments : le câble fibre est peut-être plié ou abîmé chez vous. Je prépare une visite de technicien et je vous envoie le suivi sur WhatsApp.'},
  'fibre-coupee': {label: 'Fibre coupée', hint: 'panne dans le quartier', cut: true,
    guardian: 'Plus rien ne passe. Moov voit aussi la coupure chez vos voisins : un dossier est ouvert, un technicien est envoyé, et vous recevez son suivi en direct sur WhatsApp.'},
  courant: {label: 'Coupure de courant', hint: 'la box s’éteint', cut: true,
    guardian: 'Votre box ne répond plus et vos voisins aussi sont coupés : c’est une coupure de courant. Votre box repartira toute seule au retour du courant. Vous n’avez rien à faire.'}
};
function simulate(m, id) {
  const f = SCENARIOS[id], x = clean(m);
  if (!f) return x;
  if (f.cut) return {...x, downloadMbps: null, uploadMbps: null, latencyMs: null, jitterMs: null, lossPct: 100};
  const keep = v => v == null ? null : Math.round(v * f.down * 10) / 10;
  return {...x, downloadMbps: keep(x.downloadMbps), uploadMbps: keep(x.uploadMbps), latencyMs: x.latencyMs == null ? null : Math.round(x.latencyMs + f.add), jitterMs: Math.round((x.jitterMs || 0) + f.jitter), lossPct: Math.max(x.lossPct, f.loss)};
}
// Ce que la page affiche pendant une panne simulée : les mesures changées, le verdict et la réaction de Guardian.
function preview(m, id) {
  const f = SCENARIOS[id]; if (!f) throw new Problem(404, 'Panne inconnue.');
  const sim = simulate(m, id), v = verdict(sim);
  return {scenario: id, label: f.label, metrics: sim, level: v.level, text: f.guardian, facts: v.facts};
}

// L'opérateur du réseau d'où vient la mesure (Orange, MTN, Moov…), d'après l'adresse IP publique. Rien n'est gardé
// en base ; une réponse est mise de côté une heure en mémoire. Service gratuit, sans clé ; s'il ne répond pas, on n'affiche que l'adresse.
const OPERATORS = new Map();
const isPublic = ip => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(ip) || /^[0-9a-f:]+$/i.test(ip) && ip.includes(':') && !/^(::1|fe80:|fc|fd)/i.test(ip);
async function network(rawIp, {fetchImpl = fetch} = {}) {
  const ip = String(rawIp || '').replace(/^::ffff:/, '');
  if (!isPublic(ip)) return {ip: ip || null, operator: null, city: null, country: null, local: true};
  const hit = OPERATORS.get(ip); if (hit && Date.now() - hit.at < 3600000) return hit.data;
  let data = {ip, operator: null, city: null, country: null};
  try {
    const r = await fetchImpl('http://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=status,country,city,isp,org&lang=fr', {signal: AbortSignal.timeout(2500)});
    const d = r.ok ? await r.json() : null;
    if (d?.status === 'success') data = {ip, operator: String(d.isp || d.org || '').slice(0, 60) || null, city: String(d.city || '').slice(0, 40) || null, country: String(d.country || '').slice(0, 40) || null};
  } catch {}
  if (OPERATORS.size > 500) OPERATORS.clear();
  OPERATORS.set(ip, {at: Date.now(), data});
  return data;
}

// Pour la page de test : le prénom du client et d'où vient le lien, rien d'autre.
function info(s, row) {
  const u = s.get('SELECT name FROM users WHERE id=?', row.user_id);
  let st = journey.get(s, row.user_id); if (!st) { st = journey.seed(); journey.put(s, row.user_id, st); }
  return {name: String(u?.name || '').split(' ')[0], whatsapp: !!row.phone, plan: st?.plan?.mbps || null, expires: row.expires, tests: row.tests, maxTests: MAX_TESTS,
    scenarios: Object.entries(SCENARIOS).map(([id, f]) => ({id, label: f.label, hint: f.hint, down: f.down ?? 0, add: f.add ?? 0, jitter: f.jitter ?? 0, loss: f.loss ?? 100, cut: !!f.cut}))};
}

module.exports = {migrate, link, open, clean, verdict, record, info, simulate, preview, network, SCENARIOS, NETWORK, POOL, SAMPLE, MAX_UPLOAD, LINK_MS, MAX_TESTS};
