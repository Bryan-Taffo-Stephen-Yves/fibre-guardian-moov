'use strict';
// Vrais messages WhatsApp pour la démo. Deux services possibles, gratuits et sans carte bancaire :
//   Twilio (bac à sable WhatsApp) : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, et TWILIO_WHATSAPP_FROM si le numéro change
//   Meta (numéro de test)          : WHATSAPP_TOKEN, WHATSAPP_PHONE_ID
// Dans les deux cas : WHATSAPP_NUMEROS = « Grand-Bassam=2250701020304, equipe=2250705060708, technicien=2250709101112 ».
// Ces réglages vivent dans les variables de l'hébergeur ou dans codex/.env, jamais dans git.
// Sans réglage, rien ne part : les messages restent affichés dans le téléphone du simulateur.
// Les textes sont ceux du simulateur (sim-flow.js) : ce que voit le jury à l'écran est ce qui arrive sur le téléphone.
const crypto = require('node:crypto'), G = require('./abidjan-map.js'), F = require('./sim-flow.js'), N = require('./noc-store.cjs');

const RECENT = 120000; // un message vieux de plus de 2 minutes ne part jamais (redémarrage, démo pré-remplie)
const plain = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const ROLES = {equipe: 'team', equipemoov: 'team', moov: 'team', technicien: 'tech', tech: 'tech'};
const HEAD = {client: 'Moov Africa · Fibre Guardian', team: 'Fibre Guardian · Équipe Moov', tech: 'Fibre Guardian · Votre mission'};
// Erreurs des services traduites pour la personne qui fait la démo.
const HINTS = {
  131047: 'Ce téléphone doit d’abord écrire « Bonjour » au numéro WhatsApp de la démo (une fois par 24 h).',
  131030: 'Ce numéro n’est pas dans la liste des téléphones autorisés sur Meta (5 au plus).',
  190: 'La clé WhatsApp de Meta n’est plus valable : créez-en une nouvelle.',
  63015: 'Ce téléphone doit d’abord envoyer le message « join … » au numéro WhatsApp de Twilio (à refaire tous les 3 jours).',
  63016: 'Ce téléphone doit d’abord écrire au numéro WhatsApp de Twilio (une fois par 24 h).',
  20003: 'Twilio refuse la clé : vérifiez TWILIO_ACCOUNT_SID et TWILIO_AUTH_TOKEN.'
};

function numbers(text) {
  return String(text || '').split(/[,;\n]/).map(part => {
    const m = part.match(/^\s*([^=:]+?)\s*[=:]\s*([+\d][\d\s.-]*)\s*$/); if (!m) return null;
    const key = plain(m[1]), phone = m[2].replace(/\D/g, '');
    return key && /^\d{8,15}$/.test(phone) ? {key, phone, role: ROLES[key] || 'client'} : null;
  }).filter(Boolean);
}

const PROVIDERS = {
  twilio: {
    gap: 3100, // le bac à sable de Twilio n'envoie qu'un message toutes les 3 secondes
    async send(cfg, phone, text, fetchImpl) {
      const r = await fetchImpl('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(cfg.sid) + '/Messages.json', {
        method: 'POST', headers: {Authorization: 'Basic ' + Buffer.from(cfg.sid + ':' + cfg.token).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({From: cfg.from, To: 'whatsapp:+' + phone, Body: text}).toString(), signal: AbortSignal.timeout(10000)
      });
      if (r.ok) return;
      const e = await r.json().catch(() => ({}));
      throw failure(e.code, r.status);
    }
  },
  meta: {
    gap: 0,
    async send(cfg, phone, text, fetchImpl) {
      const r = await fetchImpl('https://graph.facebook.com/' + cfg.version + '/' + cfg.phoneId + '/messages', {
        method: 'POST', headers: {Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json'},
        body: JSON.stringify({messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'text', text: {preview_url: true, body: text}}), signal: AbortSignal.timeout(10000)
      });
      if (r.ok) return;
      const e = (await r.json().catch(() => ({}))).error || {};
      throw failure(e.code, r.status);
    }
  }
};
const failure = (code, status) => Object.assign(new Error(HINTS[code] || 'WhatsApp a refusé le message' + (code ? ' (code ' + code + ')' : '') + '.'), {code: code || status});

function config(env = process.env) {
  const list = numbers(env.WHATSAPP_NUMEROS), origin = String(env.GUARDIAN_ORIGIN || '').replace(/\/$/, '');
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) return {provider: 'twilio', sid: env.TWILIO_ACCOUNT_SID.trim(), token: env.TWILIO_AUTH_TOKEN.trim(), from: env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886', list, origin};
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) return {provider: 'meta', token: env.WHATSAPP_TOKEN.trim(), phoneId: String(env.WHATSAPP_PHONE_ID).replace(/\D/g, ''), version: env.WHATSAPP_API_VERSION || 'v23.0', list, origin};
  return null;
}

// Un numéro client habite un quartier : on le reconnaît à son code (BAS-01), son nom (Palmeraie) ou sa commune (Cocody).
function livesIn(key, segmentId) {
  const s = G.SEGMENTS[segmentId]; if (!s) return false;
  const c = G.COMMUNES.find(v => v.id === s.commune);
  return [segmentId, s.area, c?.name].some(n => plain(n) === key);
}

function migrate(s) {
  s.db.exec('CREATE TABLE IF NOT EXISTS noc_whatsapp(key TEXT PRIMARY KEY,incident_id TEXT NOT NULL,phone TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL,error TEXT,at INTEGER NOT NULL)');
}

// Messages à envoyer maintenant : ceux du simulateur, partis il y a moins de 2 minutes, vers les numéros concernés.
// Un client ne reçoit que les pannes de son quartier (toute sa commune si l'équipement central tombe).
function outbox(s, cfg, now = Date.now()) {
  if (!cfg || !cfg.list.length) return [];
  const {segments, incidents, technicians} = N.activity(s, now - 15 * 60000), out = [];
  for (const i of incidents) {
    const seg = segments.find(g => g.id === i.segment_id); if (!seg) continue;
    const wide = F.reach(i, seg, segments).wide, reached = wide ? segments.filter(g => G.SEGMENTS[g.id]?.commune === G.SEGMENTS[seg.id]?.commune).map(g => g.id) : [seg.id];
    for (const m of F.messages(i, seg, technicians, now)) {
      if (m.channel !== 'whatsapp' || now - m.at > RECENT) continue;
      for (const n of cfg.list.filter(n => n.role === m.to && (m.to !== 'client' || reached.some(id => livesIn(n.key, id)))))
        out.push({key: [i.id, m.to, m.at, n.phone, crypto.createHash('sha1').update(m.body).digest('hex').slice(0, 10)].join('|'), incidentId: i.id, segments: reached, role: m.to, phone: n.phone, text: m.body, at: m.at});
    }
  }
  // Le client d'abord : c'est son téléphone que le jury regarde (le bac à sable Twilio espace les envois de 3 s).
  const order = {client: 0, team: 1, tech: 2};
  return out.sort((a, b) => a.at - b.at || order[a.role] - order[b.role]);
}

// Le client « en route » reçoit aussi le lien de suivi public du technicien (valable 6 h).
function withLink(s, cfg, m) {
  if (m.role !== 'client' || !cfg.origin || !/est en route/.test(m.text)) return m.text;
  try {
    const member = s.get('SELECT user_id FROM noc_members WHERE segment_id IN (' + m.segments.map(() => '?').join(',') + ') LIMIT 1', ...m.segments);
    if (!member) return m.text;
    return m.text.replace('Suivez son trajet dans l’application Fibre Guardian.', 'Suivez son trajet en direct : ' + cfg.origin + N.trackLink(s, member.user_id, {id: m.incidentId}).url);
  } catch { return m.text; }
}

// Un passage : chaque message n'est tenté qu'une fois (la ligne est réservée avant l'envoi), jamais renvoyé en boucle.
async function tick(s, cfg, {fetchImpl = fetch, now = Date.now(), wait = ms => new Promise(r => setTimeout(r, ms)), onError} = {}) {
  if (!cfg || s.demoSeeding) return [];
  const provider = PROVIDERS[cfg.provider], done = [];
  for (const m of outbox(s, cfg, now)) {
    if (!s.run('INSERT OR IGNORE INTO noc_whatsapp VALUES(?,?,?,?,?,?,?)', m.key, m.incidentId, m.phone, m.role, 'sending', null, now).changes) continue;
    if (done.length && provider.gap) await wait(provider.gap);
    try { await provider.send(cfg, m.phone, HEAD[m.role] + '\n\n' + withLink(s, cfg, m), fetchImpl); s.run("UPDATE noc_whatsapp SET status='sent' WHERE key=?", m.key); done.push({...m, status: 'sent'}); }
    catch (e) { s.run("UPDATE noc_whatsapp SET status='failed',error=? WHERE key=?", e.message, m.key); done.push({...m, status: 'failed'}); onError?.(e); }
  }
  return done;
}

// Ce que l'équipe voit dans le simulateur : quels messages sont vraiment partis, sans jamais montrer les numéros ni la clé.
function status(s, cfg) {
  return {on: !!cfg, phones: cfg ? cfg.list.length : 0, sent: cfg ? s.all('SELECT incident_id AS incidentId,role AS "to",status,error,at FROM noc_whatsapp ORDER BY at DESC LIMIT 200') : []};
}

function start(s, {env = process.env, onError} = {}) {
  migrate(s);
  const cfg = config(env); if (!cfg) return {cfg: null, stop() {}};
  let busy = false;
  const timer = setInterval(() => { if (busy) return; busy = true; tick(s, cfg, {onError}).catch(e => onError?.(e)).finally(() => { busy = false; }); }, 3000);
  timer.unref();
  return {cfg, stop: () => clearInterval(timer)};
}

module.exports = {numbers, config, livesIn, migrate, outbox, tick, status, start, PROVIDERS, RECENT};
