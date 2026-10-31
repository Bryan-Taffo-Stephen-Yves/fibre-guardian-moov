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
function verdict(m, {fault = null, plan = null, wifi = null} = {}) {
  const speed = m.downloadMbps, wait = m.latencyMs, facts = [
    {label: 'Débit mesuré', value: speed == null ? 'pas de transfert réussi' : fmt(speed, speed < 10 ? 1 : 0) + ' Mbps'},
    ...(m.uploadMbps == null ? [] : [{label: 'Débit d’envoi', value: fmt(m.uploadMbps, m.uploadMbps < 10 ? 1 : 0) + ' Mbps'}]),
    {label: 'Temps de réponse', value: wait == null ? 'aucune réponse' : fmt(wait) + ' ms'},
    {label: 'Sondes sans réponse', value: Math.round(m.lossPct / 20) + ' sur 5'},
    {label: 'Réseau utilisé', value: NETWORK[m.network] || 'non indiqué par l’appareil'},
    {label: 'Où', value: 'sur votre appareil, jusqu’au serveur de Guardian'}
  ];
  if (plan) facts.push({label: 'Votre forfait', value: plan.mbps + ' Mbps'});
  if (wifi?.ssid) facts.push({label: 'Wi-Fi lu sur le PC', value: wifi.ssid + (wifi.signal == null ? '' : ' · signal ' + wifi.signal + ' %')});
  const mobile = m.network === 'cellular' ? ' Ce test est passé par les données mobiles, pas par votre box.' : m.network === 'hotspot' ? ' Ce test est passé par le partage de connexion d’un téléphone, pas par votre box.' : '';
  const outage = fault ? 'Une panne est en cours dans votre quartier : Moov s’en occupe déjà. ' : '';
  let level, text;
  if (speed == null && wait == null) { level = 'coupe'; text = 'Je n’ai reçu aucune réponse pendant le test : la connexion de cet appareil ne passe pas en ce moment.'; }
  else if (m.lossPct >= 40) { level = 'instable'; text = 'Votre connexion coupe par moments : ' + Math.round(m.lossPct / 20) + ' sondes sur 5 sont restées sans réponse. Rapprochez-vous de la box et refaites le test.'; }
  else if (speed != null && speed < 1) { level = 'tres-lente'; text = 'Votre connexion est très lente en ce moment : ' + fmt(speed, 1) + ' Mbps. Une page web aura du mal à s’ouvrir. Refaites le test près de la box : si c’est plus rapide, c’est le Wi-Fi.'; }
  else if ((speed != null && speed < 5) || (wait != null && wait > 800)) { level = 'lente'; text = 'Votre connexion est lente en ce moment : ' + (speed == null ? '' : fmt(speed, 1) + ' Mbps, ') + 'réponse en ' + fmt(wait) + ' ms. Les vidéos risquent de couper. Refaites le test près de la box pour savoir si c’est le Wi-Fi.'; }
  else { level = 'bonne'; text = 'Votre connexion marche bien en ce moment : ' + fmt(speed, speed < 10 ? 1 : 0) + ' Mbps, réponse en ' + fmt(wait) + ' ms. Si une application rame, c’est sans doute elle, ou le Wi-Fi de la pièce où vous êtes.'; }
  // Le PC branché donne la force du signal Wi-Fi : sous 50 %, Guardian le dit, c'est souvent la vraie cause.
  const weak = wifi?.signal != null && wifi.signal < 50 && level !== 'coupe' ? ' Le signal Wi-Fi de ce PC est faible (' + wifi.signal + ' %) : rapprochez-le de la box.' : '';
  return {level, text: outage + text + mobile + weak, facts};
}

// Le résultat entre dans la conversation du client, comme une réponse de Guardian.
function record(s, row, metrics, {wifi = null} = {}) {
  const m = clean(metrics);
  s.run('UPDATE speed_links SET tests=tests+1 WHERE token_hash=?', row.token_hash);
  let st = journey.get(s, row.user_id); if (!st) { st = journey.seed(); journey.put(s, row.user_id, st); }
  const fault = journey.snapshotFor(s, row.user_id, st)?.sharedIncident || null;
  const r = verdict(m, {fault, plan: st.plan, wifi});
  const id = () => crypto.randomBytes(8).toString('hex');
  st.messages.push({id: id(), role: 'user', text: 'J’ai testé ma connexion.'}, {id: id(), role: 'assistant', text: r.text, facts: r.facts, verdict: 'test-' + r.level});
  st.messages = st.messages.slice(-30); st.version++; journey.put(s, row.user_id, st);
  return {...r, metrics: m};
}

// Pannes simulées (bouton « Démo » de la page de test) : on part des VRAIES mesures de l'appareil et on montre
// comment elles changeraient pendant la panne, et ce que Guardian ferait. Rien n'est touché sur le réseau.
// down : part du débit gardée ; add : millisecondes ajoutées ; loss : sondes perdues (%) ; cut : plus rien ne passe.
const SCENARIOS = {
  'wifi-sature': {label: 'Wi-Fi saturé', hint: '12 appareils en même temps', signal: 1, down: 0.15, add: 180, jitter: 90, loss: 0,
    guardian: 'Beaucoup d’appareils se partagent votre Wi-Fi en ce moment. Avec votre accord, je limite les appareils les plus gourmands pendant 30 minutes, puis je refais la mesure.'},
  'loin-box': {label: 'Loin de la box', hint: 'derrière deux murs', signal: 0.4, down: 0.3, add: 60, jitter: 40, loss: 20,
    guardian: 'Le signal Wi-Fi est faible là où vous êtes : la fibre, elle, va bien. Rapprochez-vous de la box, ou demandez un répéteur Wi-Fi Moov pour cette pièce.'},
  'quartier-charge': {label: 'Quartier chargé', hint: 'heure de pointe', signal: 1, down: 0.4, add: 120, jitter: 30, loss: 0,
    guardian: 'Votre box et votre Wi-Fi vont bien : c’est le réseau du quartier qui est chargé à cette heure. L’équipe Moov est prévenue et suit la charge du quartier.'},
  'fibre-abimee': {label: 'Fibre abîmée', hint: 'coupures par moments', signal: 1, down: 0.6, add: 40, jitter: 250, loss: 60,
    guardian: 'La ligne coupe par moments : le câble fibre est peut-être plié ou abîmé chez vous. Je prépare une visite de technicien et je vous envoie le suivi sur WhatsApp.'},
  'fibre-coupee': {label: 'Fibre coupée', hint: 'panne dans le quartier', cut: true, signal: 1,
    guardian: 'Plus rien ne passe, alors que votre box et votre Wi-Fi marchent encore : c’est la fibre. Moov voit aussi la coupure chez vos voisins : un dossier est ouvert, un technicien est envoyé, et vous recevez son suivi en direct sur WhatsApp.'},
  courant: {label: 'Coupure de courant', hint: 'la box s’éteint', cut: true, signal: 0,
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
  // L'étiquette suit la panne choisie, jamais plus douce qu'elle (sur une ligne très rapide, 30 % du débit reste « bon ») ;
  // et sans vraie mesure encore, une panne qui ne coupe pas ne devient pas « pas de connexion ».
  const rank = {bonne: 0, lente: 1, 'tres-lente': 2, instable: 2, coupe: 3}, least = f.cut ? 'coupe' : f.loss >= 40 ? 'instable' : 'lente';
  const level = v.level === 'coupe' && !f.cut ? least : rank[v.level] < rank[least] ? least : v.level;
  return {scenario: id, label: f.label, metrics: sim, level, text: f.guardian, facts: v.facts};
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

// « Brancher ce PC » : sous Windows, un petit fichier lit le Wi-Fi auprès de Windows (netsh wlan show interfaces)
// toutes les 2 secondes et l'envoie à la page de test. Une page web, elle, n'a pas le droit de le demander.
// Il fait aussi, à la demande du client sur la page, quelques opérations FIXES (jamais une commande libre) :
// tester la box, tester Internet, réparer le DNS, reconnecter le Wi-Fi. Tout reste en mémoire, jamais en base.
const PC = new Map();
const OPS = {
  box: {label: 'Tester la box', hint: 'Le PC joint-il la box ?'},
  internet: {label: 'Tester Internet', hint: 'Au-delà de la box'},
  dns: {label: 'Réparer le DNS', hint: '« Connecté, mais pas d’internet »'},
  wifi: {label: 'Reconnecter le Wi-Fi', hint: 'Coupe environ 10 secondes', confirm: 'Le Wi-Fi de ce PC va se couper environ 10 secondes, puis se reconnecter tout seul. On y va ?'}
};
const text = (v, n) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null;
const int = (v, min, max) => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : null;
const LIVE_MS = 30000; // « Reconnecter le Wi-Fi » peut suspendre le PC une vingtaine de secondes
function pc(row) {
  const now = Date.now();
  for (const [k, v] of PC) if (now - v.at > LINK_MS) PC.delete(k);
  if (PC.size > 300) PC.clear();
  let p = PC.get(row.token_hash);
  if (!p) { p = {at: 0, w: null, ops: []}; PC.set(row.token_hash, p); }
  return p;
}
// Ce que Guardian dit d'une opération, en mots simples, à partir de ce que le PC a mesuré.
function opText(op, r, before = []) {
  const ms = r.ms == null ? '' : ' en ' + fmt(r.ms) + ' ms', got = r.lost == null ? '' : ', ' + (4 - r.lost) + ' réponse' + (4 - r.lost > 1 ? 's' : '') + ' sur 4';
  if (op === 'box') {
    if (!r.ok) return r.detail === 'no-gateway' ? 'Ce PC n’a pas trouvé de box sur son réseau : il n’est pas vraiment connecté. Reconnectez le Wi-Fi.' : 'Votre PC ne joint plus la box (' + (r.gateway || 'adresse inconnue') + ') : le souci est entre le PC et la box, donc le Wi-Fi. Rapprochez-vous de la box, ou redémarrez-la.';
    return 'Votre PC joint la box (' + r.gateway + ')' + ms + got + '. ' + (r.lost > 0 || r.ms > 60 ? 'Le Wi-Fi entre le PC et la box est faible ou encombré : rapprochez-vous de la box.' : 'Le Wi-Fi entre le PC et la box va bien.');
  }
  if (op === 'internet') {
    const box = before.find(o => o.op === 'box' && o.ok === true);
    if (!r.ok) return box ? 'La box répond, mais Internet ne répond pas au-delà : c’est la fibre ou le réseau Moov, pas votre Wi-Fi. Guardian peut prévenir Moov.' : 'Internet ne répond pas depuis ce PC. Testez la box pour savoir si c’est le Wi-Fi ou la fibre.';
    return 'Internet répond au-delà de la box' + ms + got + (r.dnsMs == null ? '' : ', et les adresses des sites se trouvent en ' + fmt(r.dnsMs) + ' ms') + '. La ligne fibre marche.';
  }
  if (op === 'dns') return r.ok ? 'J’ai vidé la mémoire des adresses de sites (DNS) de ce PC. Les sites se trouvent de nouveau' + (r.dnsMs == null ? '' : ' en ' + fmt(r.dnsMs) + ' ms') + '.' : 'J’ai vidé la mémoire des adresses de sites (DNS), mais les sites ne se trouvent toujours pas. Testez Internet, ou appelez le 111.';
  if (op === 'wifi') return r.ok ? 'Wi-Fi reconnecté à « ' + (r.ssid || 'votre réseau') + ' ».' : 'Le PC n’a pas réussi à se reconnecter tout seul. Choisissez votre Wi-Fi dans la liste de Windows.';
  return '';
}
function wifiSave(row, d) {
  const p = pc(row), now = Date.now();
  // Le PC rend le résultat d'une opération demandée sur la page.
  if (d?.result && typeof d.result === 'object') {
    const r = d.result, o = p.ops.find(x => x.id === r.id && x.state === 'en cours');
    if (o) {
      const res = {ok: r.ok === true, gateway: /^[0-9a-f.:]{3,45}$/i.test(String(r.gateway || '')) ? String(r.gateway) : null, ms: int(r.ms, 0, 60000), lost: int(r.lost, 0, 4), dnsMs: int(r.dnsMs, 0, 60000), ssid: text(r.ssid, 64), detail: text(r.detail, 30)};
      Object.assign(o, {state: 'fait', ok: res.ok, done: now, text: opText(o.op, res, p.ops.filter(x => x !== o && x.state === 'fait'))});
    }
    p.at = now;
    return {ok: true};
  }
  const error = ['location', 'no-wifi', 'netsh'].includes(d?.error) ? d.error : null;
  p.w = error ? {error} : {ssid: text(d?.ssid, 64), signal: int(d?.signal, 0, 100), channel: int(d?.channel, 0, 200), band: text(d?.band, 20), radio: text(d?.radio, 30), rxMbps: int(d?.rxMbps, 0, 100000), txMbps: int(d?.txMbps, 0, 100000), auth: text(d?.auth, 40), computer: text(d?.computer, 40)};
  p.at = now;
  // Une opération en attente part avec la réponse ; le PC ne sait faire que celles de la liste.
  const next = p.ops.find(x => x.state === 'attente');
  if (next) { next.state = 'en cours'; next.sent = now; }
  for (const x of p.ops) if (x.state === 'en cours' && now - x.sent > 60000) Object.assign(x, {state: 'fait', ok: false, text: 'Le PC n’a pas répondu à temps. Vérifiez que la fenêtre noire est toujours ouverte.'});
  return {ok: true, action: next ? {id: next.id, op: next.op} : null};
}
function wifiRead(row) {
  const p = PC.get(row.token_hash), on = p && Date.now() - p.at < LIVE_MS;
  return {wifi: on && p.w ? {...p.w, at: p.at, age: Date.now() - p.at} : null, connected: !!on,
    ops: (p?.ops || []).map(({id, op, state, ok, text: t}) => ({id, op, label: OPS[op].label, state, ok: ok ?? null, text: t || null})),
    available: Object.entries(OPS).map(([id, o]) => ({id, label: o.label, hint: o.hint, confirm: o.confirm || null}))};
}
function queueOp(row, op) {
  if (!OPS[op]) throw new Problem(404, 'Opération inconnue.');
  const p = pc(row);
  if (!(Date.now() - p.at < LIVE_MS)) throw new Problem(409, 'Branchez d’abord ce PC : lancez le fichier « Guardian-Wi-Fi.cmd ».');
  if (p.ops.filter(x => x.state !== 'fait').length >= 3) throw new Problem(429, 'Attendez la fin des opérations en cours.');
  const o = {id: crypto.randomBytes(6).toString('hex'), op, state: 'attente', at: Date.now()};
  p.ops.push(o); p.ops = p.ops.slice(-8);
  return {id: o.id, op, state: o.state, label: OPS[op].label};
}

// Le fichier à double-cliquer : un .cmd qui lance PowerShell (présent sur tout Windows 10 et 11), rien à installer.
// Il ne contient que l'adresse du site et le jeton du lien (valable 30 minutes) ; il s'arrête dès qu'on ferme la fenêtre.
function agent(origin, token) {
  if (!/^https?:\/\/[A-Za-z0-9.:\[\]-]+$/.test(origin) || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw new Problem(400, 'Lien de test invalide.');
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
    "$Host.UI.RawUI.WindowTitle = 'Guardian - Wi-Fi de ce PC'",
    "$url = '" + origin + "/api/test/wifi'; $token = '" + token + "'",
    "Write-Host ''",
    "Write-Host '  Guardian lit le Wi-Fi de ce PC et l''envoie à votre page de test.' -ForegroundColor Cyan",
    "Write-Host '  Il ne fait que 4 opérations, quand vous les demandez sur la page :'",
    "Write-Host '  tester la box, tester Internet, réparer le DNS, reconnecter le Wi-Fi.'",
    "Write-Host '  Laissez cette fenêtre ouverte. Fermez-la pour arrêter.'",
    "Write-Host ''",
    "function Field($text, $pattern) { $m = [regex]::Match($text, '(?mi)^\\s*(' + $pattern + ')[^:\\r\\n]*:\\s*(.+?)\\s*$'); if ($m.Success) { $m.Groups[2].Value } else { $null } }",
    "function Send($body) { $json = $body | ConvertTo-Json -Compress -Depth 4; Invoke-RestMethod -Uri $url -Method Post -Headers @{ 'X-Test-Token' = $token } -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 10 -ErrorAction Stop }",
    "function Ping-Host($target, $n) { $p = New-Object Net.NetworkInformation.Ping; $times = @(); $lost = 0; for ($i = 0; $i -lt $n; $i++) { try { $r = $p.Send($target, 1500); if ($r.Status -eq 'Success') { $times += $r.RoundtripTime } else { $lost++ } } catch { $lost++ }; Start-Sleep -Milliseconds 200 }; $avg = $null; if ($times.Count) { $avg = [math]::Round(($times | Measure-Object -Average).Average) }; @{ ms = $avg; lost = $lost } }",
    "function Resolve-Time($name) { try { $sw = [Diagnostics.Stopwatch]::StartNew(); [Net.Dns]::GetHostAddresses($name) | Out-Null; $sw.ElapsedMilliseconds } catch { $null } }",
    "function Run-Op($op) {",
    "  if ($op -eq 'box') { $gw = $null; try { $gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object RouteMetric | Select-Object -First 1).NextHop } catch {}; if (-not $gw) { return @{ ok = $false; detail = 'no-gateway' } }; $r = Ping-Host $gw 4; return @{ ok = ($r.lost -lt 4); gateway = $gw; ms = $r.ms; lost = $r.lost } }",
    "  if ($op -eq 'internet') { $r = Ping-Host '8.8.8.8' 4; return @{ ok = ($r.lost -lt 4); ms = $r.ms; lost = $r.lost; dnsMs = (Resolve-Time 'www.google.com') } }",
    "  if ($op -eq 'dns') { ipconfig /flushdns | Out-Null; $t = Resolve-Time 'www.moov-africa.ci'; return @{ ok = ($t -ne $null); dnsMs = $t } }",
    "  if ($op -eq 'wifi') { $name = Field ((netsh wlan show interfaces) | Out-String) 'Profile|Profil'; if (-not $name) { return @{ ok = $false; detail = 'no-profile' } }; netsh wlan disconnect | Out-Null; Start-Sleep -Seconds 3; netsh wlan connect \"name=$name\" | Out-Null; for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 1; $s = Field ((netsh wlan show interfaces) | Out-String) 'SSID'; if ($s -and (Test-Connection -ComputerName 8.8.8.8 -Count 1 -Quiet)) { return @{ ok = $true; ssid = $s } } }; return @{ ok = $false; detail = 'timeout' } }",
    "  return $null",
    "}",
    "$labels = @{ box = 'Tester la box'; internet = 'Tester Internet'; dns = 'Réparer le DNS'; wifi = 'Reconnecter le Wi-Fi' }",
    "while ($true) {",
    "  $out = (netsh wlan show interfaces) | Out-String",
    "  $ssid = Field $out 'SSID'",
    "  if ($ssid) {",
    "    $body = @{ ssid = $ssid; signal = ((Field $out 'Signal') -replace '[^0-9]', ''); channel = (Field $out 'Channel|Canal'); band = (Field $out 'Band'); radio = (Field $out 'Radio type|Type de radio'); rxMbps = ((Field $out 'Receive rate|.*ception') -replace '[^0-9.]', ''); txMbps = ((Field $out 'Transmit rate|.*ransmission') -replace '[^0-9.]', ''); auth = (Field $out 'Authentication|Authentification'); computer = $env:COMPUTERNAME }",
    "  } elseif ($out -match 'location|localisation|emplacement') { $body = @{ error = 'location' } }",
    "  elseif ($out -match 'wlansvc|not running|pas en cours') { $body = @{ error = 'netsh' } }",
    "  else { $body = @{ error = 'no-wifi' } }",
    "  try {",
    "    $resp = Send $body",
    "    if ($ssid) { Write-Host ('  ' + (Get-Date -Format 'HH:mm:ss') + '  ' + $ssid + '  signal ' + $body.signal + ' %') }",
    "    elseif ($body.error -eq 'location') { Write-Host '  Windows cache le nom du Wi-Fi : activez la Localisation (Paramètres > Confidentialité et sécurité > Localisation).' -ForegroundColor Yellow }",
    "    else { Write-Host '  Ce PC n''est pas connecté en Wi-Fi.' -ForegroundColor Yellow }",
    "    $a = $resp.action",
    "    if ($a -and $labels.ContainsKey([string]$a.op)) {",
    "      Write-Host ('  Guardian : ' + $labels[[string]$a.op] + '...') -ForegroundColor Cyan",
    "      $res = Run-Op ([string]$a.op); $res.id = [string]$a.id",
    "      for ($k = 0; $k -lt 10; $k++) { try { Send @{ result = $res } | Out-Null; break } catch { Start-Sleep -Seconds 2 } }",
    "      Write-Host '  Résultat envoyé à la page.' -ForegroundColor Cyan",
    "    }",
    "  } catch {",
    "    $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch {}",
    "    if ($code -eq 404) { Write-Host ''; Write-Host '  Ce lien de test a expiré. Rouvrez « Tester ma connexion » et rebranchez ce PC.' -ForegroundColor Yellow; Read-Host '  Appuyez sur Entrée pour fermer'; exit }",
    "    Write-Host '  Pas de réponse de Guardian, nouvel essai dans 2 secondes.' -ForegroundColor DarkGray",
    "  }",
    "  Start-Sleep -Seconds 2",
    "}"
  ].join('\r\n');
  // Partie 1 (cmd) : relance ce même fichier dans PowerShell, à partir de la ligne repère. Partie 2 : le script ci-dessus.
  return ['@echo off', 'title Guardian - Wi-Fi de ce PC',
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$t = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; $i = $t.IndexOf('#GUARDIAN' + '-PS#'); Invoke-Expression $t.Substring($i)\"",
    'exit /b', '#GUARDIAN-PS#', ps, ''].join('\r\n');
}

// Pour la page de test : le prénom du client et d'où vient le lien, rien d'autre.
function info(s, row) {
  const u = s.get('SELECT name FROM users WHERE id=?', row.user_id);
  let st = journey.get(s, row.user_id); if (!st) { st = journey.seed(); journey.put(s, row.user_id, st); }
  return {name: String(u?.name || '').split(' ')[0], whatsapp: !!row.phone, plan: st?.plan?.mbps || null, expires: row.expires, tests: row.tests, maxTests: MAX_TESTS,
    scenarios: Object.entries(SCENARIOS).map(([id, f]) => ({id, label: f.label, hint: f.hint, down: f.down ?? 0, add: f.add ?? 0, jitter: f.jitter ?? 0, loss: f.loss ?? 100, cut: !!f.cut, signal: f.signal ?? 1}))};
}

module.exports = {migrate, link, open, clean, verdict, record, info, wifiSave, wifiRead, queueOp, opText, OPS, agent, simulate, preview, network, SCENARIOS, NETWORK, POOL, SAMPLE, MAX_UPLOAD, LINK_MS, MAX_TESTS};
