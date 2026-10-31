'use strict';
// Copie du Wi-Fi : pendant « Tester ma connexion », Guardian enregistre une copie du Wi-Fi du client. Elle est faite de
// ce que l'appareil mesure pendant 20 secondes (débit, temps de réponse, stabilité, courbe) et, quand un PC Windows est
// branché, de ce que Windows lui donne (nom du Wi-Fi, signal, canal, vitesse de liaison, sécurité, appareils connectés).
// Jamais de mot de passe : Windows ne le donne pas et Guardian ne le demande pas. Ni nom d'appareil, ni adresse MAC
// complète, ni adresse IP publique. Les pannes se rejouent sur la copie : le vrai Wi-Fi n'est jamais touché.
// L'équipe Moov retrouve les copies dans son espace (rôle vérifié par le serveur) et peut y rejouer une panne.
const crypto = require('node:crypto'), VT = require('./vrai-test.cjs'), N = require('./noc-store.cjs'), {requireOperator} = require('./operator-store.cjs'), {Problem} = require('./pilot-model.cjs');

// Une copie dure 20 secondes de mesures. Si la page se tait 30 secondes (onglet fermé ou en arrière-plan trop longtemps),
// ou au bout de 10 minutes quoi qu'il arrive, la copie est figée telle quelle. Une copie restée sans aucune mesure ne
// compte pas dans les 5 copies du lien : la suivante la remplace.
const COPY_MS = 20000, MAX_COPIES = 5, KEEP_MS = 7 * 86400000, MAX_ROWS = 300, MAX_POINTS = 40, POINT_MAX = COPY_MS + 5000;
const IDLE_MS = 30000, HARD_MS = 10 * 60000, USER_DAY = 50, TEAM_PER_CLIENT = 5, TEAM_LIST = 60;
const text = (v, n) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null;
const num = (v, max) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), max) : null;

function migrate(s) {
  s.db.exec('CREATE TABLE IF NOT EXISTS wifi_copies(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,token_hash TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);CREATE INDEX IF NOT EXISTS wifi_copies_link ON wifi_copies(token_hash,created)');
}

// Ce que la copie garde de l'appareil et du PC. Les appareils vus pendant les 20 secondes s'ajoutent les uns aux autres.
function merge(c, row, d, net, now) {
  const pc = VT.wifiRead(row);
  if (pc.wifi && !pc.wifi.error && pc.wifi.ssid) {
    const w = pc.wifi;
    c.wifi = {ssid: w.ssid, signal: w.signal, channel: w.channel, band: w.band, radio: w.radio, rxMbps: w.rxMbps, txMbps: w.txMbps, auth: w.auth, from: 'pc'};
  } else if (text(d?.typed, 40) && c.wifi?.from !== 'pc') c.wifi = {ssid: text(d.typed, 40), from: 'tape'};
  if (pc.scan) {
    c.pc = true; c.subnet = pc.scan.subnet || c.subnet || null;
    const known = new Map((c.devices || []).map(x => [x.id, x]));
    for (const x of pc.devices) known.set(x.id, {id: x.id, kind: x.kind, label: x.label, vendor: x.vendor, ip: x.ip, random: x.random});
    c.devices = [...known.values()].slice(0, 64);
  }
  if (VT.NETWORK[d?.network]) c.network = d.network;
  if (net && !net.local) { c.operator = net.operator || c.operator || null; c.city = net.city || c.city || null; }
  const m = VT.clean(d?.metrics || {});
  for (const k of ['downloadMbps', 'uploadMbps', 'latencyMs', 'jitterMs']) if (m[k] != null) c.metrics[k] = Math.round(m[k] * 10) / 10;
  if (d?.metrics && d.metrics.lossPct != null) c.metrics.lossPct = m.lossPct;
  if (Array.isArray(d?.points)) for (const p of d.points.slice(0, 20)) {
    const t = p?.t == null || p.t === '' ? NaN : Number(p.t); // hors des 20 secondes de la copie : point écarté, jamais ramené au bord
    if (!Number.isFinite(t) || t < 0 || t > POINT_MAX || c.points.length >= MAX_POINTS) continue;
    const rtt = p.rtt == null ? null : num(p.rtt, 60000);
    c.points.push({t: Math.round(t), rtt: rtt == null ? null : Math.round(rtt), mbps: num(p.mbps, 10000)});
  }
  c.points.sort((a, b) => a.t - b.t);
  c.updated = now;
}

const NET_LABEL = {hotspot: 'Partage de connexion', cellular: 'Données mobiles', ethernet: 'Câble de la box', wifi: 'Wi-Fi de la box'};
function view(c, now = Date.now()) {
  const m = c.metrics, recorded = c.points.reduce((a, p) => Math.max(a, p.t), 0);
  return {id: c.id, created: c.created, done: !!c.done, seconds: Math.min(Math.round(COPY_MS / 1000), Math.round(recorded / 1000)),
    total: COPY_MS / 1000, label: c.wifi?.ssid || NET_LABEL[c.network] || 'Wi-Fi de la box', wifi: c.wifi || null, network: c.network || null, networkLabel: VT.NETWORK[c.network] || null,
    operator: c.operator || null, city: c.city || null, pc: !!c.pc, subnet: c.subnet || null,
    metrics: {downloadMbps: m.downloadMbps ?? null, uploadMbps: m.uploadMbps ?? null, latencyMs: m.latencyMs ?? null, jitterMs: m.jitterMs ?? null, lossPct: m.lossPct ?? 0},
    points: c.points, devices: c.devices || [], connected: (c.devices || []).filter(d => d.kind !== 'box' && d.kind !== 'partage').length, measured: c.points.some(p => p.rtt != null) || m.downloadMbps != null};
}
const load = (s, id) => { const r = s.get('SELECT * FROM wifi_copies WHERE id=?', String(id || '')); return r ? {...JSON.parse(r.data), id: r.id, user_id: r.user_id, token_hash: r.token_hash, created: r.created, updated: r.updated, done: r.done} : null; };
const save = (s, c) => s.run('UPDATE wifi_copies SET updated=?,done=?,data=? WHERE id=?', c.updated, c.done ? 1 : 0, JSON.stringify(stored(c)), c.id);
const stale = (c, now) => !c.done && (now - c.updated > IDLE_MS || now - c.created > HARD_MS);
const freeze = (s, c, now) => { if (stale(c, now)) { c.done = 1; save(s, c); } return c; };
const stored = c => ({wifi: c.wifi || null, network: c.network || null, operator: c.operator || null, city: c.city || null, pc: !!c.pc, subnet: c.subnet || null, metrics: c.metrics, points: c.points, devices: c.devices || []});

// Une nouvelle copie : celle qui s'enregistrait encore pour ce lien est figée telle quelle.
function start(s, row, d = {}, {net = null, now = Date.now()} = {}) {
  s.run('DELETE FROM wifi_copies WHERE created<?', now - KEEP_MS);
  // Les copies de ce lien qui s'enregistraient encore sont figées ; celles restées sans aucune mesure sont remplacées.
  s.run('UPDATE wifi_copies SET done=1 WHERE token_hash=? AND done=0', row.token_hash);
  for (const r of s.all('SELECT id FROM wifi_copies WHERE token_hash=?', row.token_hash)) if (!view(load(s, r.id), now).measured) s.run('DELETE FROM wifi_copies WHERE id=?', r.id);
  const n = s.get('SELECT COUNT(*) AS n FROM wifi_copies WHERE token_hash=?', row.token_hash).n;
  if (n >= MAX_COPIES) throw new Problem(429, 'Vous avez fait ' + MAX_COPIES + ' copies avec ce lien. Demandez un nouveau lien à Guardian.');
  if (s.get('SELECT COUNT(*) AS n FROM wifi_copies WHERE user_id=? AND created>?', row.user_id, now - 86400000).n >= USER_DAY) throw new Problem(429, 'Vous avez fait beaucoup de copies aujourd’hui. Guardian garde les dernières ; réessayez demain.');
  const c = {id: crypto.randomBytes(9).toString('base64url'), user_id: row.user_id, token_hash: row.token_hash, created: now, updated: now, done: 0, metrics: {}, points: [], devices: []};
  merge(c, row, d, net, now);
  s.run('INSERT INTO wifi_copies VALUES(?,?,?,?,?,0,?)', c.id, c.user_id, c.token_hash, now, now, JSON.stringify(stored(c)));
  const extra = s.get('SELECT COUNT(*) AS n FROM wifi_copies').n - MAX_ROWS;
  if (extra > 0) s.run('DELETE FROM wifi_copies WHERE id IN (SELECT id FROM wifi_copies ORDER BY created LIMIT ?)', extra);
  return {copy: view(c, now), left: MAX_COPIES - n - 1};
}
// Pendant les 20 secondes, la page envoie ses mesures ; ensuite la copie est figée et ne change plus.
// Un envoi qui arrive après qu'elle a été figée (page silencieuse trop longtemps) ne change rien.
function update(s, row, d = {}, {net = null, now = Date.now()} = {}) {
  const c = load(s, d.id);
  if (!c || c.token_hash !== row.token_hash) throw new Problem(404, 'Copie introuvable.');
  freeze(s, c, now);
  if (!c.done) {
    merge(c, row, d, net, now);
    if (d.final === true) c.done = 1;
    save(s, c);
  }
  return {copy: view(c, now), left: MAX_COPIES - s.get('SELECT COUNT(*) AS n FROM wifi_copies WHERE token_hash=?', row.token_hash).n};
}
function latest(s, row, now = Date.now()) {
  const r = s.get('SELECT id FROM wifi_copies WHERE token_hash=? ORDER BY created DESC LIMIT 1', row.token_hash), c = r && load(s, r.id);
  if (c) freeze(s, c, now);
  return {copy: c ? view(c, now) : null, left: MAX_COPIES - s.get('SELECT COUNT(*) AS n FROM wifi_copies WHERE token_hash=?', row.token_hash).n};
}

// ---------- Une panne rejouée sur la copie ----------
// Les mesures changent avec les mêmes règles que les pannes de la page de test (vrai-test.cjs), et chaque appareil de la
// copie prend l'état qu'il aurait pendant la panne. Pour « Wi-Fi saturé », des appareils gourmands sont ajoutés à la copie.
const STATES = {ok: 'Internet marche', lent: 'Lent', faible: 'Signal faible', instable: 'Coupe par moments', 'sans-internet': 'Wi-Fi sans Internet', deconnecte: 'Déconnecté', box: 'Allumée', 'box-charge': 'Allumée, très chargée', 'box-los': 'Voyant fibre rouge', 'box-clignote': 'Voyant fibre qui clignote', eteinte: 'Éteinte'};
const EFFECTS = {
  'wifi-sature': {all: 'lent', box: 'box-charge', crowd: 12},
  'loin-box': {mine: 'faible', box: 'box'},
  'quartier-charge': {all: 'lent', box: 'box'},
  'fibre-abimee': {all: 'instable', box: 'box-clignote'},
  'fibre-coupee': {all: 'sans-internet', box: 'box-los'},
  courant: {all: 'deconnecte', box: 'eteinte'}
};
const CROWD = [['tele', 'Télévision', 'vidéo en HD'], ['mobile', 'Téléphone', 'vidéos courtes'], ['console', 'Console de jeux', 'mise à jour de 40 Go'], ['mobile', 'Tablette', 'dessins animés'], ['pc', 'PC portable', 'téléchargement'], ['mobile', 'Téléphone', 'appel vidéo'], ['tele', 'Décodeur TV', 'match en direct'], ['mobile', 'Téléphone', 'sauvegarde des photos'], ['pc', 'PC portable', 'visioconférence'], ['mobile', 'Téléphone', 'musique'], ['mobile', 'Tablette', 'jeu en ligne'], ['tele', 'Télévision', 'film']];
const TEAM = {
  'wifi-sature': 'Rien à réparer sur le réseau : proposer au client de limiter les appareils gourmands aux heures chargées, ou une box Wi-Fi plus récente.',
  'loin-box': 'Pas de technicien fibre à envoyer : proposer un répéteur Wi-Fi Moov, ou de placer la box au centre du logement.',
  'quartier-charge': 'Transmettre au responsable capacité : la liaison du quartier sature aux heures de pointe. Aucune visite chez le client.',
  'fibre-abimee': 'Programmer une visite : vérifier le câble fibre chez le client et mesurer la ligne au réflectomètre.',
  'fibre-coupee': 'Regarder si les voisins sont touchés : si oui, dossier de zone et équipe fibre ; sinon, technicien chez le client.',
  courant: 'Ne pas envoyer de technicien : prévenir le client que la box repartira toute seule au retour du courant.'
};
// Sans PC branché, la copie connaît au moins deux appareils : celui qui a fait la mesure et ce qui lui donne Internet.
// Une copie faite en partage de connexion ou en données mobiles se joue comme si c'était le Wi-Fi d'une box :
// les pannes rejouées (fibre, courant, box) sont des pannes de box.
const BOX = {id: 'la-box', kind: 'box', label: 'Box Wi-Fi'};
function inferred(base, played) {
  return [{...BOX, inferred: true, played}, {id: 'cet-appareil', kind: 'self', label: 'Cet appareil', inferred: true}];
}
const SHARED_NOTE = {hotspot: 'Cette copie vient d’un partage de connexion : Guardian la joue comme si c’était le Wi-Fi de votre box.', cellular: 'Cette copie vient des données mobiles : Guardian la joue comme si c’était le Wi-Fi de votre box.'};
function twin(copy, id) {
  const f = VT.SCENARIOS[id], e = EFFECTS[id];
  if (!f || !e) throw new Problem(404, 'Panne inconnue.');
  const p = VT.preview({...copy.metrics, network: copy.network}, id);
  const signal = copy.wifi?.signal == null ? null : Math.round(copy.wifi.signal * (f.signal ?? 1));
  const gateway = d => d.kind === 'box' || d.kind === 'partage';
  const shared = copy.network === 'hotspot' || copy.network === 'cellular' || copy.devices.some(d => d.kind === 'partage');
  const note = shared ? SHARED_NOTE[copy.network === 'cellular' ? 'cellular' : 'hotspot'] : null;
  const devices = (copy.devices.length ? copy.devices : inferred(copy, shared)).map(d => {
    const g = gateway(d) ? (d.kind === 'partage' ? {...d, ...BOX, id: d.id, played: true} : d) : d;
    const state = gateway(d) ? e.box : e.all || (e.mine && (d.kind === 'pc' || d.kind === 'self') ? e.mine : 'ok');
    return {...g, state, stateLabel: STATES[state]};
  });
  if (e.crowd) for (let i = 0; devices.filter(d => !gateway(d)).length < e.crowd && i < CROWD.length; i++) {
    const [kind, label, usage] = CROWD[i];
    devices.push({id: 'en-plus-' + i, kind, label, usage, added: true, state: 'lent', stateLabel: STATES.lent});
  }
  // La courbe de la copie, pendant la panne : même rythme, avec les ajouts et les pertes de la panne.
  // L'irrégularité est tirée d'une suite fixe (la même copie donne toujours la même courbe), jamais sous 1 ms.
  const wobble = i => { const v = Math.sin((i + 1) * 12.9898) * 43758.5453; return v - Math.floor(v) - .5; };
  const points = copy.points.map((pt, i) => ({t: pt.t, rtt: f.cut || pt.rtt == null || (i % 5) < Math.round((f.loss || 0) / 20) ? null : Math.max(1, Math.round(pt.rtt + (f.add || 0) + wobble(i) * (f.jitter || 0))), mbps: f.cut || pt.mbps == null ? null : Math.round(pt.mbps * f.down * 10) / 10}));
  const online = devices.filter(d => !gateway(d) && ['ok', 'lent', 'faible', 'instable'].includes(d.state)).length;
  return {copy: copy.id, scenario: id, label: f.label, hint: f.hint, level: p.level, text: p.text, facts: p.facts, metrics: p.metrics, base: copy.metrics, note,
    signal, baseSignal: copy.wifi?.signal ?? null, devices, points, team: TEAM[id], summary: {devices: devices.filter(d => !gateway(d)).length, online, added: devices.filter(d => d.added).length, before: devices.filter(d => !gateway(d) && !d.added).length}};
}
// Côté client : la consigne interne de l'équipe Moov n'est pas envoyée.
function simulate(s, row, d = {}) {
  const c = load(s, d.id);
  if (!c || c.token_hash !== row.token_hash) throw new Problem(404, 'Copie introuvable.');
  const {team, ...forClient} = twin(view(c), String(d.scenario || ''));
  return forClient;
}

// ---------- Espace équipe Moov ----------
const SCENARIO_LIST = () => Object.entries(VT.SCENARIOS).map(([id, f]) => ({id, label: f.label, hint: f.hint}));
function client(s, uid) {
  const u = s.get('SELECT name FROM users WHERE id=?', uid);
  return {name: String(u?.name || 'Client').split(' ')[0], zone: N.memberZone(s, uid)?.zone || null};
}
// Pour l'équipe, les appareils du client se nomment depuis son point de vue à elle.
const TEAM_LABEL = {'Ce PC': 'PC du client', 'Cet appareil': 'Appareil du test'};
const forTeam = list => list.map(d => TEAM_LABEL[d.label] ? {...d, label: TEAM_LABEL[d.label]} : d);
// La liste : les copies les plus récentes, 5 au plus par client pour qu'un seul compte ne cache pas les autres.
function list(s, uid, now = Date.now()) {
  requireOperator(s, uid);
  s.run('DELETE FROM wifi_copies WHERE created<?', now - KEEP_MS);
  const per = new Map(), rows = s.all('SELECT id,user_id FROM wifi_copies ORDER BY created DESC LIMIT ?', MAX_ROWS).filter(r => { const n = (per.get(r.user_id) || 0) + 1; per.set(r.user_id, n); return n <= TEAM_PER_CLIENT; }).slice(0, TEAM_LIST);
  const copies = rows.map(r => {
    const c = freeze(s, load(s, r.id), now), v = view(c, now);
    return {id: v.id, created: v.created, done: v.done, seconds: v.seconds, total: v.total, label: v.label, client: client(s, c.user_id), pc: v.pc,
      devices: v.connected, downloadMbps: v.metrics.downloadMbps, latencyMs: v.metrics.latencyMs, signal: v.wifi?.signal ?? null, networkLabel: v.networkLabel, measured: v.measured};
  });
  return {copies, scenarios: SCENARIO_LIST(), now};
}
function detail(s, uid, id, now = Date.now()) {
  requireOperator(s, uid);
  const c = load(s, id); if (!c) throw new Problem(404, 'Copie introuvable.');
  const v = view(freeze(s, c, now), now);
  return {copy: {...v, devices: forTeam(v.devices), client: client(s, c.user_id)}, scenarios: SCENARIO_LIST()};
}
function teamSimulate(s, uid, d = {}) {
  requireOperator(s, uid);
  const c = load(s, d.id); if (!c) throw new Problem(404, 'Copie introuvable.');
  const t = twin(view(c), String(d.scenario || ''));
  return {...t, devices: forTeam(t.devices)};
}

module.exports = {migrate, start, update, latest, simulate, twin, list, detail, teamSimulate, STATES, EFFECTS, TEAM, COPY_MS, MAX_COPIES, IDLE_MS, USER_DAY};
