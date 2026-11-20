'use strict';
// Rapport du matin : un seul mail par jour pour la Direction, préparé par deux agents de Guardian.
// 1. Le rapport du matin résume les dernières 24 heures en cinq lignes, à partir du moteur d'incidents
//    (noc-store.cjs) et du compteur d'appels évités (appels.cjs) : pannes, foyers coupés, appels évités,
//    interventions, décisions qui attendent.
// 2. L'agent anti-départ reprend le score de risque de départ (retention.cjs, porté de src/fleet.js) et
//    propose, pour chaque client à risque, la raison principale et un geste. C'est une proposition :
//    un conseiller décide et agit depuis le Superviseur. Guardian ne contacte aucun client seul.
// Le mail part chaque jour à RAPPORT_HEURE (7 h 00 à Abidjan par défaut), et la Direction peut l'envoyer tout
// de suite depuis le Superviseur. Envoi par l'API web de Brevo ou de Resend (offres gratuites, sans carte
// bancaire) : l'hébergeur gratuit Render bloque l'envoi de mails par SMTP (Gmail), seule une API web passe.
// Les adresses et la clé sont des variables d'environnement (Render), jamais dans le code.
const N = require('./noc-store.cjs'), A = require('./appels.cjs'), R = require('./retention.cjs');
const {insist, id, Problem} = require('./pilot-model.cjs');
const DAY = 86400000, HOUR = 3600000;

// Couleurs Moov Africa (moov-theme.css). Un mail ne lit pas les variables CSS du site : on recopie les valeurs ici.
const C = {primary: '#005ca8', primaryDark: '#0a2540', primarySoft: '#eef5fc', accent: '#f28e39', accentSoft: '#fff5ec',
  ink: '#121a26', muted: '#4f5b6c', line: '#cdd7e3', page: '#f0f4f8', white: '#ffffff', danger: '#9b2530', dangerSoft: '#fbe4e5'};

// Réglages lus dans l'environnement. Rien n'est envoyé tant que la clé, l'expéditeur et un destinataire manquent.
function config(env = process.env) {
  const to = String(env.RAPPORT_MAIL_A || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10);
  const brevo = String(env.BREVO_API_KEY || '').trim(), resend = String(env.RESEND_API_KEY || '').trim();
  const provider = brevo ? 'brevo' : resend ? 'resend' : null;
  const from = String(env.RAPPORT_MAIL_DE || '').trim() || (provider === 'resend' ? 'onboarding@resend.dev' : '');
  const m = /^(\d{1,2})(?:[:h ]?(\d{2}))?$/.exec(String(env.RAPPORT_HEURE || '7:00').trim().toLowerCase());
  const hour = m ? Math.min(23, +m[1]) : 7, minute = m && m[2] ? Math.min(59, +m[2]) : 0;
  return {provider, key: brevo || resend, from, to, hour, minute, ready: !!(provider && from && to.length && env.RAPPORT_MAIL !== '0')};
}

function migrate(s) {
  s.db.exec(`CREATE TABLE IF NOT EXISTS rapport_envois(id TEXT PRIMARY KEY,day TEXT NOT NULL,kind TEXT NOT NULL,by_user TEXT,at INTEGER NOT NULL,recipients INTEGER NOT NULL,status TEXT NOT NULL,error TEXT)`);
}

const plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);
const plainZone = zone => { const [commune, area] = String(zone || '').split(' · '); return area && area !== commune ? commune + ' · ' + area : commune; };
const money = n => Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ') + ' F';
function duration(ms) { const m = Math.max(1, Math.round(ms / 60000)); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : ''); }
// Jour et heure à Abidjan, quel que soit le fuseau du serveur.
function abidjan(at) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', {timeZone: 'Africa/Abidjan', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return {day: p.year + '-' + p.month + '-' + p.day, hour: +p.hour, minute: +p.minute};
}
const longDay = at => new Intl.DateTimeFormat('fr-FR', {timeZone: 'Africa/Abidjan', weekday: 'long', day: 'numeric', month: 'long'}).format(new Date(at));

// Les cinq lignes du rapport, sur les 24 dernières heures.
function morning(s, now) {
  const since = now - DAY;
  const zoneOf = new Map(s.all('SELECT id,zone FROM noc_segments').map(r => [r.id, plainZone(r.zone)]));
  const incidents = s.all("SELECT id,segment_id,status,created FROM noc_incidents WHERE mode='demo' AND source='telemetry' AND status<>'false_alarm' AND created>=? ORDER BY created", since);
  const ev = (iid, kind) => s.get('SELECT detail,at FROM noc_events WHERE incident_id=? AND kind=? ORDER BY at LIMIT 1', iid, kind);
  let homes = 0; const back = [];
  for (const i of incidents) {
    try { const d = JSON.parse(ev(i.id, 'detected')?.detail || '{}'); if (d.total) homes += Math.max(0, d.total - d.online); } catch {}
    const done = ev(i.id, 'resolved') || ev(i.id, 'closed'); if (done) back.push(done.at - i.created);
  }
  const open = incidents.filter(N.isOpen), repaired = incidents.length - open.length;
  const sent = s.get("SELECT COUNT(*) AS n FROM noc_events e JOIN noc_incidents i ON i.id=e.incident_id WHERE i.mode='demo' AND e.kind='dispatched' AND e.at>=?", since).n;
  const verified = s.get("SELECT COUNT(*) AS n FROM noc_events e JOIN noc_incidents i ON i.id=e.incident_id WHERE i.mode='demo' AND e.kind='resolved' AND e.at>=?", since).n;
  const calls = A.stats(s, now);
  const pending = s.get("SELECT COUNT(*) AS n FROM noc_incidents WHERE mode='demo' AND status='proposed'").n;
  const stillOpen = s.all("SELECT segment_id FROM noc_incidents WHERE mode='demo' AND status NOT IN ('resolved','closed','false_alarm')").map(r => zoneOf.get(r.segment_id) || r.segment_id);
  const avg = back.length ? back.reduce((a, b) => a + b, 0) / back.length : null;
  const lines = [
    {key: 'pannes', label: 'Pannes', text: incidents.length ? plural(incidents.length, 'panne détectée', 'pannes détectées') + ' par Guardian, ' + plural(repaired, 'réparée', 'réparées') + (open.length ? ', ' + open.length + ' encore ouverte' + (open.length > 1 ? 's' : '') : '') + '.' : 'Aucune panne détectée : le réseau a tenu toute la journée.'},
    {key: 'clients', label: 'Clients touchés', text: homes ? plural(homes, 'foyer coupé', 'foyers coupés') + (avg !== null ? ', retour du réseau en ' + duration(avg) + ' en moyenne.' : ', réparation en cours.') : 'Aucun foyer coupé.'},
    {key: 'appels', label: 'Appels évités', text: calls.avoided ? plural(calls.avoided, 'appel évité', 'appels évités') + ' au 111 : les clients prévenus par Guardian n’ont pas eu besoin d’appeler.' : calls.informed ? plural(calls.informed, 'client prévenu', 'clients prévenus') + ' avant leur appel.' : 'Aucun client à prévenir.'},
    {key: 'interventions', label: 'Interventions', text: sent || verified ? plural(sent, 'technicien envoyé', 'techniciens envoyés') + ' sur le terrain, ' + plural(verified, 'réparation vérifiée', 'réparations vérifiées') + ' par les mesures.' : 'Aucun technicien n’a eu besoin de sortir.'},
    {key: 'decider', label: 'À décider', text: pending ? plural(pending, 'plan attend', 'plans attendent') + ' la validation d’un responsable' + (stillOpen.length ? ' (' + [...new Set(stillOpen)].slice(0, 3).join(', ') + ').' : '.') : stillOpen.length ? 'Rien à valider. Dossier encore en cours : ' + [...new Set(stillOpen)].slice(0, 3).join(', ') + '.' : 'Rien n’attend de décision ce matin.'}
  ];
  return {since, lines, numbers: {pannes: incidents.length, repaired, open: open.length, homes, avoided: calls.avoided, sent, verified, pending}};
}

// L'agent anti-départ : les clients à risque, la raison principale et le geste proposé.
function antiDepart(s, now) {
  const r = R.compute(s, now), risk = r.clients.filter(c => c.level !== 'faible');
  return {total: r.total, high: r.high, watch: r.watch, revenueAtRisk: r.revenueAtRisk,
    clients: risk.slice(0, 5).map(c => {
      // Les deux raisons les plus lourdes ; à égalité, les mots de départ passent devant (c'est eux qui décident de l'appel).
      const top = [...c.factors].sort((a, b) => b.points - a.points || (b.key === 'depart') - (a.key === 'depart')).slice(0, 2);
      return {id: c.id, name: c.name, zone: plainZone(c.zone), score: c.score, level: c.level, label: c.label, reason: top.map(f => f.text).join(' · '), action: c.action.text, gesture: c.offer.label, done: !!(c.suivi && (c.suivi.calledAt || c.suivi.offerAt))};
    })};
}

function build(s, now = Date.now()) {
  const m = morning(s, now), a = antiDepart(s, now);
  const title = 'Rapport du matin · ' + longDay(now);
  const subject = 'Fibre Guardian · ' + longDay(now) + ' : ' + plural(m.numbers.pannes, 'panne', 'pannes') + ', ' + plural(m.numbers.avoided, 'appel évité', 'appels évités') + ', ' + plural(a.high + a.watch, 'client à garder', 'clients à garder');
  return {at: now, title, subject, morning: m, antiDepart: a};
}

// Version texte (lecteurs de mail simples) et version mise en page.
function text(r) {
  const out = [r.title, '', 'LE POINT EN 5 LIGNES (dernières 24 heures)'];
  for (const l of r.morning.lines) out.push('• ' + l.label + ' : ' + l.text);
  out.push('', 'CLIENTS À GARDER (agent anti-départ)');
  const a = r.antiDepart;
  if (!a.clients.length) out.push('Aucun client à risque de départ sur les 30 derniers jours.');
  else {
    out.push(a.high + ' à risque élevé, ' + a.watch + ' à surveiller. Abonnements en jeu : ' + money(a.revenueAtRisk) + ' par an.');
    for (const c of a.clients) out.push('• ' + c.name + (c.zone ? ' (' + c.zone + ')' : '') + ', score ' + c.score + '/100 : ' + c.reason + '. Geste proposé : ' + c.gesture + '.' + (c.done ? ' Déjà suivi par un conseiller.' : ''));
  }
  out.push('', 'Ce sont des propositions : un conseiller décide et agit depuis le Superviseur. Guardian ne contacte aucun client seul.');
  return out.join('\n');
}

const esc = v => String(v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function html(r, {link = ''} = {}) {
  const a = r.antiDepart, font = "font-family:Arial,Helvetica,sans-serif;";
  const row = l => `<tr><td style="${font}padding:10px 0;border-bottom:1px solid ${C.line};vertical-align:top;width:104px;font-size:13px;font-weight:bold;color:${C.primary}">${esc(l.label)}</td><td style="${font}padding:10px 0 10px 12px;border-bottom:1px solid ${C.line};font-size:15px;line-height:1.45;color:${C.ink}">${esc(l.text)}</td></tr>`;
  const client = c => `<tr><td style="${font}padding:12px;border-radius:10px;background:${c.level === 'eleve' ? C.dangerSoft : C.accentSoft}">
    <div style="font-size:15px;color:${C.ink}"><b>${esc(c.name)}</b>${c.zone ? ' · ' + esc(c.zone) : ''} <span style="float:right;font-weight:bold;color:${c.level === 'eleve' ? C.danger : C.accent}">${c.score}/100</span></div>
    <div style="font-size:13.5px;color:${C.muted};margin-top:4px">${esc(c.reason)}</div>
    <div style="font-size:14px;color:${C.ink};margin-top:6px"><b>Geste proposé :</b> ${esc(c.gesture)}${c.done ? ' <span style="color:' + C.muted + '">(déjà suivi par un conseiller)</span>' : ''}</div></td></tr><tr><td style="height:8px"></td></tr>`;
  const clients = a.clients.length
    ? `<p style="${font}margin:0 0 12px;font-size:14px;color:${C.muted}"><b style="color:${C.ink}">${a.high}</b> à risque élevé, <b style="color:${C.ink}">${a.watch}</b> à surveiller. Abonnements en jeu : <b style="color:${C.ink}">${esc(money(a.revenueAtRisk))} par an</b>.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${a.clients.map(client).join('')}</table>`
    : `<p style="${font}margin:0;font-size:14px;color:${C.muted}">Aucun client à risque de départ sur les 30 derniers jours.</p>`;
  const button = link ? `<p style="margin:20px 0 0"><a href="${esc(link)}" style="${font}display:inline-block;padding:12px 18px;border-radius:10px;background:${C.primary};color:${C.white};font-weight:bold;font-size:14px;text-decoration:none">Ouvrir le Superviseur</a></p>` : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(r.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.white};border-radius:16px;overflow:hidden">
<tr><td style="${font}padding:22px 24px;background:${C.primary};color:${C.white}"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">Fibre Guardian · Moov Africa</div><div style="font-size:22px;font-weight:bold;margin-top:6px">${esc(r.title)}</div></td></tr>
<tr><td style="padding:20px 24px 4px"><div style="${font}font-size:16px;font-weight:bold;color:${C.ink};margin-bottom:4px">Le point en 5 lignes</div><div style="${font}font-size:13px;color:${C.muted}">Dernières 24 heures, préparé par l’agent Rapport du matin.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${r.morning.lines.map(row).join('')}</table></td></tr>
<tr><td style="padding:20px 24px 8px"><div style="${font}font-size:16px;font-weight:bold;color:${C.ink};margin-bottom:10px">Clients à garder</div>${clients}</td></tr>
<tr><td style="padding:8px 24px 24px"><p style="${font}margin:0;padding:12px;border-radius:10px;background:${C.primarySoft};font-size:13.5px;line-height:1.45;color:${C.ink}">Ce sont des propositions : un conseiller décide et agit depuis le Superviseur. Guardian ne contacte aucun client seul.</p>${button}</td></tr>
</table></td></tr></table></body></html>`;
}

// Envoi par l'API web du service choisi. fetchImpl est remplacé dans les tests : aucun mail réel n'y part.
async function deliver(cfg, mail, fetchImpl = fetch) {
  const sender = /</.test(cfg.from) ? cfg.from : 'Fibre Guardian <' + cfg.from + '>';
  const [, name = 'Fibre Guardian', email = cfg.from] = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(sender) || [];
  const req = cfg.provider === 'brevo'
    ? ['https://api.brevo.com/v3/smtp/email', {'api-key': cfg.key}, {sender: {name, email}, to: cfg.to.map(email => ({email})), subject: mail.subject, htmlContent: mail.html, textContent: mail.text}]
    : ['https://api.resend.com/emails', {Authorization: 'Bearer ' + cfg.key}, {from: name + ' <' + email + '>', to: cfg.to, subject: mail.subject, html: mail.html, text: mail.text}];
  const res = await fetchImpl(req[0], {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json', ...req[1]}, body: JSON.stringify(req[2]), signal: AbortSignal.timeout(20000)});
  if (!res.ok) { let why = ''; try { const j = await res.json(); why = j.message || j.code || ''; } catch {} throw new Problem(502, 'Le service de mail a refusé l’envoi (' + res.status + (why ? ' : ' + String(why).slice(0, 160) : '') + ').'); }
}

// Envoie le rapport et le note dans le journal des envois. kind : 'auto' (chaque matin) ou 'manuel' (bouton).
async function send(s, cfg, {kind = 'manuel', by = null, now = Date.now(), origin = '', fetchImpl = fetch} = {}) {
  insist(cfg && cfg.ready, 'L’adresse mail de la Direction n’est pas encore réglée.', 409);
  const r = build(s, now), link = origin ? new URL('/codex/?portal=moov&section=superviseur', origin).href : '';
  const row = {id: id(), day: abidjan(now).day};
  try {
    await deliver(cfg, {subject: r.subject, html: html(r, {link}), text: text(r)}, fetchImpl);
    s.run('INSERT INTO rapport_envois VALUES(?,?,?,?,?,?,?,?)', row.id, row.day, kind, by, now, cfg.to.length, 'ok', null);
    return {ok: true, at: now, recipients: cfg.to.length};
  } catch (e) {
    s.run('INSERT INTO rapport_envois VALUES(?,?,?,?,?,?,?,?)', row.id, row.day, kind, by, now, cfg.to.length, 'echec', String(e.message || e).slice(0, 300));
    throw e instanceof Problem ? e : new Problem(502, 'Le mail n’est pas parti : le service de mail ne répond pas. Réessayez dans un instant.');
  }
}

// Chaque minute : à l'heure prévue, un envoi automatique par jour. En cas d'échec, nouvel essai 15 minutes plus tard,
// trois fois au plus, et seulement dans les 3 heures qui suivent l'heure prévue (un redémarrage l'après-midi n'envoie rien).
async function tick(s, cfg, {now = Date.now(), origin = '', fetchImpl = fetch} = {}) {
  if (!cfg || !cfg.ready) return null;
  const t = abidjan(now), minutes = t.hour * 60 + t.minute, start = cfg.hour * 60 + cfg.minute;
  if (minutes < start || minutes >= start + 180) return null;
  const rows = s.all("SELECT status,at FROM rapport_envois WHERE day=? AND kind='auto'", t.day);
  if (rows.some(r => r.status === 'ok') || rows.length >= 3 || rows.some(r => now - r.at < 15 * 60000)) return null;
  return send(s, cfg, {kind: 'auto', now, origin, fetchImpl}).catch(e => ({ok: false, error: e.message}));
}

const mask = email => { const [u, d] = email.split('@'); return u.slice(0, 2) + '•••@' + d; };
// Pour l'écran du Superviseur : le rapport, et où en est l'envoi. Réservé au responsable et à la direction.
function view(s, uid, cfg, now = Date.now()) {
  insist(N.rights(s, uid).canApprove, 'Le rapport du matin est réservé au responsable de supervision et à la direction.', 403);
  const last = s.get('SELECT kind,at,status,recipients,error FROM rapport_envois ORDER BY at DESC LIMIT 1');
  return {...build(s, now), mail: {ready: !!cfg?.ready, to: (cfg?.to || []).map(mask), hour: cfg ? String(cfg.hour).padStart(2, '0') + ' h ' + String(cfg.minute).padStart(2, '0') : '07 h 00',
    last: last ? {kind: last.kind, at: last.at, ok: last.status === 'ok', recipients: last.recipients} : null}};
}
async function sendNow(s, uid, cfg, options = {}) {
  insist(N.rights(s, uid).canApprove, 'Le rapport du matin est réservé au responsable de supervision et à la direction.', 403);
  insist(cfg && cfg.ready, 'L’adresse mail de la Direction n’est pas encore réglée.', 409);
  s.rate('rapport-envoi:' + uid, 6, HOUR);
  await send(s, cfg, {...options, kind: 'manuel', by: uid});
  return view(s, uid, cfg);
}

function start(s, cfg, {origin = '', onError = () => {}, every = 60000} = {}) {
  if (!cfg || !cfg.ready) return null;
  const timer = setInterval(() => { tick(s, cfg, {origin}).then(r => { if (r && r.ok === false) onError(new Error('Rapport du matin : ' + r.error)); }).catch(onError); }, every);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

module.exports = {config, migrate, build, text, html, deliver, send, tick, view, sendNow, start, abidjan};
