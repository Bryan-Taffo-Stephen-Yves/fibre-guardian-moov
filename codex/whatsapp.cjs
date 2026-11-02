'use strict';
// Vrais messages WhatsApp pour la démo. Trois services possibles, gratuits et sans carte bancaire :
//   Green API (votre propre puce)  : GREENAPI_ID_INSTANCE, GREENAPI_API_TOKEN (Guardian y répond aussi : whatsapp-bot.cjs).
//                                    Prioritaire : les alertes partent du même numéro que celui avec lequel le client discute.
//   Twilio (bac à sable WhatsApp) : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, et TWILIO_WHATSAPP_FROM si le numéro change
//   Meta (numéro de test)          : WHATSAPP_TOKEN, WHATSAPP_PHONE_ID
// Destinataires : WHATSAPP_NUMEROS = « Grand-Bassam=2250701020304, equipe=2250705060708, technicien=2250709101112 »,
// et WHATSAPP_CLIENTS = « 2250701020304=awa.kone@demo.fibre-guardian.ci » (le client reçoit les pannes du quartier de son compte).
// Un numéro relié au compte d'un responsable (« 2250701020304=direction@demo.fibre-guardian.ci ») reçoit les messages de l'équipe
// et peut valider le plan en répondant « Valider » (whatsapp-bot.cjs). Un même numéro peut être relié à un client et à un responsable.
// Membres du jury (Green API seulement) : quelques places pour ceux qui donnent leur numéro WhatsApp en s'inscrivant
// (WHATSAPP_JURY_MAX, sinon les discussions gratuites qui restent sur les 3 de Green API). Ils reçoivent les messages
// « client » de la panne de la salle, au même moment que l'alerte dans l'application (jury-store.cjs).
// Clients qui relient eux-mêmes leur WhatsApp dans « Mon compte » (Green API seulement, en envoyant leur code : whatsapp-compte.cjs) :
// ils reçoivent les pannes du quartier de leur compte, sur les mêmes places WhatsApp que le jury.
// Ces réglages vivent dans les variables de l'hébergeur ou dans codex/.env, jamais dans git.
// Sans réglage, rien ne part : les messages restent affichés dans le téléphone du simulateur.
// Les textes sont ceux du simulateur (sim-flow.js) : ce que voit le jury à l'écran est ce qui arrive sur le téléphone.
const crypto = require('node:crypto'), G = require('./abidjan-map.js'), F = require('./sim-flow.js'), N = require('./noc-store.cjs'), O = require('./operator-store.cjs');

const RECENT = 120000; // un message vieux de plus de 2 minutes ne part jamais (redémarrage, démo pré-remplie)
const FREE_CHATS = 3; // offre gratuite « Developer » de Green API : 3 discussions
// Green API répond 466 quand les 3 discussions gratuites du mois sont prises : plus aucun nouveau numéro avant le 1er du mois.
const QUOTA = 'L’offre gratuite de Green API est pleine ce mois-ci (3 discussions) : WhatsApp n’écrit plus à un nouveau numéro avant le 1er du mois prochain.';
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
  greenapi: {
    gap: 1000,
    async send(cfg, phone, text, fetchImpl, ask = null) {
      // Plan à valider : un bouton « Valider le plan » propre à cette alerte (« valider:<ref> »), pour que le bouton touché
      // valide ce plan-là et pas un autre. Boutons Green API encore en essai : s'ils sont refusés, le même texte part sans
      // bouton, et il dit déjà de répondre « Valider ».
      if (ask?.kind === 'approve') {
        const b = await fetchImpl(cfg.url + '/waInstance' + cfg.id + '/sendInteractiveButtonsReply/' + encodeURIComponent(cfg.token), {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({chatId: phone + '@c.us', body: text, buttons: [{buttonId: 'valider:' + ask.ref, buttonText: 'Valider le plan'}]}), signal: AbortSignal.timeout(10000)
        }).catch(() => null);
        if (b?.ok) return;
      }
      const r = await fetchImpl(cfg.url + '/waInstance' + cfg.id + '/sendMessage/' + encodeURIComponent(cfg.token), {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({chatId: phone + '@c.us', message: text}), signal: AbortSignal.timeout(10000)
      });
      if (r.ok) return;
      if (r.status === 466) throw Object.assign(new Error(QUOTA), {code: 466});
      throw failure(null, r.status);
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

// « 2250701020304=awa.kone@demo.fibre-guardian.ci » : ce numéro WhatsApp est celui de ce compte client.
function links(text) {
  return String(text || '').split(/[,;\n]/).map(part => {
    const m = part.match(/^\s*([+\d][\d\s.-]*)\s*[=:]\s*(\S+@\S+)\s*$/); if (!m) return null;
    const phone = m[1].replace(/\D/g, '');
    return /^\d{8,15}$/.test(phone) ? {phone, email: m[2].toLowerCase()} : null;
  }).filter(Boolean);
}

function config(env = process.env) {
  const list = numbers(env.WHATSAPP_NUMEROS), clients = links(env.WHATSAPP_CLIENTS), origin = String(env.GUARDIAN_ORIGIN || '').replace(/\/$/, '');
  if (env.GREENAPI_ID_INSTANCE && env.GREENAPI_API_TOKEN) {
    // Places WhatsApp pour le jury : celles qui restent sur les discussions gratuites, ou le nombre réglé (20 au plus).
    const set = Number.parseInt(env.WHATSAPP_JURY_MAX, 10), used = new Set([...list, ...clients].map(n => n.phone)).size;
    const jury = Number.isFinite(set) ? Math.min(20, Math.max(0, set)) : Math.max(0, FREE_CHATS - used);
    // replies : Green API renvoie les réponses à Guardian (webhook réglé) ; sans lui, personne ne lirait « Valider ».
    const replies = String(env.GREENAPI_WEBHOOK_TOKEN || '').trim().replace(/^(Bearer|Basic)\s+/i, '').length >= 16;
    // Nouveaux numéros que les clients peuvent relier eux-mêmes dans « Mon compte » (whatsapp-compte.cjs), pris sur ces
    // mêmes places : aucun par défaut, pour garder les discussions gratuites au jury.
    const own = Number.parseInt(env.WHATSAPP_COMPTE_MAX, 10), compte = Number.isFinite(own) ? Math.min(20, Math.max(0, own)) : 0;
    return {provider: 'greenapi', clients, id: String(env.GREENAPI_ID_INSTANCE).replace(/\D/g, ''), token: String(env.GREENAPI_API_TOKEN).trim(), url: String(env.GREENAPI_URL || 'https://api.green-api.com').replace(/\/$/, ''), list, origin, jury, compte, replies};
  }
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) return {provider: 'twilio', clients, sid: env.TWILIO_ACCOUNT_SID.trim(), token: env.TWILIO_AUTH_TOKEN.trim(), from: env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886', list, origin};
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) return {provider: 'meta', clients, token: env.WHATSAPP_TOKEN.trim(), phoneId: String(env.WHATSAPP_PHONE_ID).replace(/\D/g, ''), version: env.WHATSAPP_API_VERSION || 'v23.0', list, origin};
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
  // Alertes « plan à valider » vraiment remises à un responsable : le plan tel qu'il était (cause, déplacement) au moment de l'alerte.
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_asks(ref TEXT PRIMARY KEY,phone TEXT NOT NULL,incident_id TEXT NOT NULL,cause TEXT,dispatch INTEGER NOT NULL,at INTEGER NOT NULL)');
  // Mois où l'offre gratuite de cette instance Green API est pleine (« 7103000001|2026-11 ») : rien d'autre que cette marque.
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_full(key TEXT PRIMARY KEY,at INTEGER NOT NULL)');
  // Plans validés depuis WhatsApp, par ce numéro : Guardian lui a déjà répondu « C’est validé… Prochaine étape… ».
  s.db.exec('CREATE TABLE IF NOT EXISTS wa_validated(incident_id TEXT NOT NULL,phone TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(incident_id,phone))');
}
// Validation faite sur WhatsApp par ce numéro (whatsapp-bot.cjs) : le message d’équipe « Plan validé » ne lui est pas renvoyé.
const validated = (s, incidentId, phone) => s.run('INSERT OR IGNORE INTO wa_validated(incident_id,phone,at) VALUES(?,?,?)', incidentId, phone, Date.now());
// Offre gratuite pleine (réponse 466 de Green API) : le formulaire du jury ne propose plus WhatsApp et la Régie le dit,
// jusqu'au 1er du mois suivant, ou jusqu'à ce qu'une autre instance soit réglée (la marque porte le numéro d'instance).
const fullKey = (cfg, now) => cfg.id + '|' + new Date(now).toISOString().slice(0, 7);
function markFull(s, cfg, now = Date.now()) {
  if (!cfg?.id) return; // Green API seulement (les réglages Twilio et Meta n'ont pas de numéro d'instance)
  try { s.run('INSERT OR IGNORE INTO wa_full VALUES(?,?)', fullKey(cfg, now), now); } catch {}
}
function full(s, cfg, now = Date.now()) {
  if (!cfg?.id) return false;
  try { return !!s.get('SELECT 1 AS x FROM wa_full WHERE key=?', fullKey(cfg, now)); } catch { return false; }
}
// Dans la clé d'un envoi, le numéro est remplacé par une empreinte : un numéro effacé ne reste pas dans les clés,
// et la clé empêche toujours de renvoyer le même message au même téléphone.
const tag = phone => crypto.createHash('sha256').update('fibre-guardian-wa|' + phone).digest('hex').slice(0, 16);

// Messages à envoyer maintenant : ceux du simulateur, partis il y a moins de 2 minutes, vers les numéros concernés.
// Un client ne reçoit que les pannes de son quartier (toute sa commune si l'équipement central tombe).
function outbox(s, cfg, now = Date.now()) {
  // Un numéro relié par le client lui-même dans l'application remplace celui de l'hébergeur : il suit le quartier de son compte.
  // Un numéro de l'hébergeur dont le client a dit « Stop » ne reçoit plus les alertes client (whatsapp-compte.cjs).
  const own = ownClients(s, cfg), C = require('./whatsapp-compte.cjs'), off = phone => cfg?.provider === 'greenapi' && C.muted(s, phone);
  const clients = cfg ? (cfg.clients || []).filter(c => !own.some(o => C.same(o.phone, c.phone)) && !off(c.phone)).map(c => ({...c, segment: s.get('SELECT m.segment_id AS id FROM noc_members m JOIN users u ON u.id=m.user_id WHERE u.email=?', c.email)?.id})).filter(c => c.segment).concat(own) : [];
  const team = cfg ? managers(s, cfg) : [], jury = cfg?.jury ? juryAudience(s) : null;
  if (!cfg || (!cfg.list.length && !clients.length && !team.length && !jury)) return [];
  const {segments, incidents, technicians} = N.activity(s, now - 15 * 60000), out = [], keys = new Set();
  // Le bouton « Valider » seulement avec Green API et son webhook (sinon la réponse ne reviendrait jamais à Guardian).
  const asks = cfg?.provider === 'greenapi' && cfg.replies;
  const push = (i, m, phone, reached, at, juror = false) => {
    const key = [i.id, m.to, m.at, tag(phone), crypto.createHash('sha1').update(m.body).digest('hex').slice(0, 10)].join('|');
    if (keys.has(key)) return; keys.add(key);
    const ask = asks && m.ask && i.status === 'proposed' && team.some(c => c.phone === phone) ? m.ask : null;
    out.push({key, incidentId: i.id, segments: reached, role: m.to, phone, text: m.body, at, ask, plan: ask ? {cause: i.plan?.cause || null, dispatch: i.plan?.dispatch !== false} : null, juror});
  };
  for (const i of incidents) {
    const seg = segments.find(g => g.id === i.segment_id); if (!seg) continue;
    const wide = F.reach(i, seg, segments).wide, reached = wide ? segments.filter(g => G.SEGMENTS[g.id]?.commune === G.SEGMENTS[seg.id]?.commune).map(g => g.id) : [seg.id];
    for (const m of F.messages(i, seg, technicians, now)) {
      if (m.channel !== 'whatsapp') continue;
      if (now - m.at <= RECENT) {
        const phones = cfg.list.filter(n => n.role === m.to && (m.to !== 'client' || (reached.some(id => livesIn(n.key, id)) && !off(n.phone)))).map(n => n.phone);
        // Un client relié par son compte reçoit les pannes du quartier de ce compte.
        if (m.to === 'client') phones.push(...clients.filter(c => reached.includes(c.segment)).map(c => c.phone));
        // Un responsable relié par son compte reçoit les messages de l'équipe, pour toutes les pannes.
        if (m.to === 'team') phones.push(...team.map(c => c.phone));
        for (const phone of new Set(phones)) {
          // Le responsable qui a validé sur WhatsApp a déjà la réponse de Guardian, avec la prochaine étape : pas de doublon.
          if (m.step === 'approved' && s.get('SELECT 1 AS x FROM wa_validated WHERE incident_id=? AND phone=?', i.id, phone)) continue;
          push(i, m, phone, reached, m.at);
        }
      }
      // Le jury inscrit avec son numéro : la panne de la salle seulement, pas avant que l'application la montre
      // (réseau de démo : l'alerte d'il y a 12 s part au moment où le responsable valide).
      if (jury && m.to === 'client' && i.id === jury.incident && jury.from !== null) {
        const at = Math.max(m.at, jury.from);
        if (now - at <= RECENT) for (const phone of jury.phones) push(i, m, phone, reached, at, true);
      }
    }
  }
  // Le client d'abord : c'est son téléphone que le jury regarde (le bac à sable Twilio espace les envois de 3 s).
  const order = {client: 0, team: 1, tech: 2};
  return out.sort((a, b) => a.at - b.at || order[a.role] - order[b.role]);
}

// Clients reliés depuis l'application : seulement avec Green API, le service qui a reçu leur code.
function ownClients(s, cfg) {
  if (cfg?.provider !== 'greenapi') return [];
  try { return require('./whatsapp-compte.cjs').audience(s); } catch { return []; }
}
function juryAudience(s) {
  try { return require('./jury-store.cjs').whatsappAudience(s); } catch { return null; } // base sans salle du jury
}
function enrolled(s, phone) {
  try { return require('./jury-store.cjs').enrolled(s, phone); } catch { return false; }
}

// Numéros ivoiriens : beaucoup de comptes WhatsApp gardent l'ancien format à 8 chiffres (225 + 8 chiffres, sans 07, 05 ou 01).
// Green API dit lequel existe (checkWhatsapp) ; sans réponse claire, on garde le format à 10 chiffres.
// Appelé avant l'inscription : le numéro entre dans la salle déjà écrit comme WhatsApp le connaît.
async function reachable(cfg, phone, fetchImpl = fetch) {
  if (cfg?.provider !== 'greenapi' || !/^225\d{10}$/.test(phone)) return phone;
  const exists = async p => {
    try {
      const r = await fetchImpl(cfg.url + '/waInstance' + cfg.id + '/checkWhatsapp/' + encodeURIComponent(cfg.token), {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phoneNumber: Number(p)}), signal: AbortSignal.timeout(5000)});
      const j = r.ok ? await r.json() : null;
      return typeof j?.existsWhatsapp === 'boolean' ? j.existsWhatsapp : null;
    } catch { return null; }
  };
  if (await exists(phone) !== false) return phone;
  const old = '225' + phone.slice(5);
  return await exists(old) === true ? old : phone;
}

// Premier message au numéro donné par un membre du jury : rien d'autre ne part tant que le téléphone n'a pas répondu « OUI ».
// Ainsi, un numéro tapé par erreur (ou celui de quelqu'un d'autre) ne reçoit qu'un seul message, sans prénom choisi par autrui.
const WELCOME = 'Bonjour ! Je suis Guardian, l’assistant de Moov Africa Fibre. Ce numéro vient d’être inscrit à la démonstration Fibre Guardian.\n\nRépondez « OUI » pour recevoir ici les alertes de panne pendant la démonstration. Sans réponse, je ne vous écris plus. Votre numéro est effacé à la fin.';
// Offre gratuite pleine : le numéro n'est pas gardé (il ne recevra rien ce mois-ci) et le formulaire ne propose plus WhatsApp.
async function welcome(s, cfg, uid, fetchImpl = fetch) {
  const J = require('./jury-store.cjs'), wa = J.whatsappOf(s, uid); if (!wa) return;
  try { await PROVIDERS[cfg.provider].send(cfg, wa.phone, HEAD.client + '\n\n' + WELCOME, fetchImpl); }
  catch (e) { if (e.code === 466) { markFull(s, cfg); J.stopWhatsapp(s, wa.phone); } throw e; }
}

// Numéros reliés au compte d'un responsable (agent, superviseur ou administrateur) : ils reçoivent les messages de l'équipe.
function managers(s, cfg) {
  return (cfg.clients || []).map(c => ({...c, user: s.get('SELECT id FROM users WHERE email=?', c.email)})).filter(c => c.user && O.role(s, c.user.id) !== 'subscriber');
}
const ASK = {approve: 'Répondez « Valider » pour valider ce plan. Vous pouvez aussi valider dans l’espace Moov.'};

// Le client « en route » reçoit aussi le lien de suivi public du technicien (valable 6 h).
// Le responsable relié par son compte peut valider le plan depuis WhatsApp : le message le lui dit.
function withLink(s, cfg, m) {
  if (m.ask && ASK[m.ask]) return m.text + '\n\n' + ASK[m.ask];
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
    // Membre du jury : on revérifie juste avant l'envoi (« Stop » ou salle fermée pendant les envois précédents).
    if (m.juror && !enrolled(s, m.phone)) continue;
    if (!s.run('INSERT OR IGNORE INTO noc_whatsapp VALUES(?,?,?,?,?,?,?)', m.key, m.incidentId, m.phone, m.role, 'sending', null, now).changes) continue;
    if (done.length && provider.gap) await wait(provider.gap);
    const ask = m.ask ? {kind: m.ask, ref: crypto.randomBytes(4).toString('hex')} : null;
    try {
      await provider.send(cfg, m.phone, HEAD[m.role] + '\n\n' + withLink(s, cfg, m), fetchImpl, ask);
      s.run("UPDATE noc_whatsapp SET status='sent' WHERE key=?", m.key); done.push({...m, status: 'sent'});
      // Seule une alerte vraiment remise peut être validée par « Valider ».
      if (ask) s.run('INSERT INTO wa_asks VALUES(?,?,?,?,?,?)', ask.ref, m.phone, m.incidentId, m.plan.cause, m.plan.dispatch ? 1 : 0, Date.now());
    } catch (e) {
      s.run("UPDATE noc_whatsapp SET status='failed',error=? WHERE key=?", e.message, m.key); done.push({...m, status: 'failed'});
      if (e.code === 466) markFull(s, cfg, now);
      onError?.(e);
    }
  }
  return done;
}

// Ce que l'équipe voit dans le simulateur : quels messages sont vraiment partis, sans jamais montrer les numéros ni la clé.
function status(s, cfg) {
  if (!cfg) return {on: false, phones: 0, sent: []};
  // Un téléphone compte une fois, même relié dans l'hébergeur et dans l'application sous ses deux formes ivoiriennes.
  const set = [...cfg.list, ...(cfg.clients || [])], same = require('./whatsapp-compte.cjs').same;
  const own = ownClients(s, cfg).filter(o => !set.some(n => same(n.phone, o.phone)));
  // full : offre gratuite de Green API pleine ce mois-ci (carte « Messages WhatsApp » du Superviseur).
  return {on: true, ...(full(s, cfg) ? {full: true} : {}), phones: new Set([...set, ...own].map(n => n.phone)).size, sent: s.all('SELECT incident_id AS incidentId,role AS "to",status,error,at FROM noc_whatsapp ORDER BY at DESC LIMIT 200')};
}

function start(s, {env = process.env, onError} = {}) {
  migrate(s);
  const cfg = config(env); if (!cfg) return {cfg: null, stop() {}};
  let busy = false;
  const timer = setInterval(() => { if (busy) return; busy = true; tick(s, cfg, {onError}).catch(e => onError?.(e)).finally(() => { busy = false; }); }, 3000);
  timer.unref();
  return {cfg, stop: () => clearInterval(timer)};
}

module.exports = {numbers, links, config, livesIn, migrate, outbox, validated, managers, reachable, welcome, WELCOME, tag, tick, status, start, full, markFull, PROVIDERS, RECENT, ASK, FREE_CHATS, QUOTA};
