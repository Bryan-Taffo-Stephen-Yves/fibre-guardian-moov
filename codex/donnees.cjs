'use strict';
// Données personnelles du client (loi ivoirienne n°2013-450 du 19 juin 2013, autorité de contrôle : ARTCI).
// - inventory : ce que l'application garde sur le client, pourquoi et combien de temps (« Mon compte » → « Mes données »).
// - exportData : tout ce qui est rattaché au compte, dans un fichier lisible (droit d'accès), sans mot de passe ni clé.
// - erase : efface le compte et tout ce qui lui est rattaché (droit à l'effacement). Les dossiers de panne du quartier
//   restent pour l'équipe Moov, sans le nom du client. Les comptes de l'équipe Moov et les comptes de démo partagés sont refusés.
// - choix « ia » : le client peut refuser que ses messages, photos et notes vocales passent par les services d'IA
//   (Claude chez Anthropic, Groq), hébergés hors de Côte d'Ivoire. Guardian répond alors avec ses seules règles.
// - purge : effacement automatique des données qui ne servent plus (durées dans DUREES), au démarrage puis toutes les 6 heures.
const {insist} = require('./pilot-model.cjs');
const DAY = 86400000;
const DUREES = {usage: 30, copies: 30, veille: 30, photos: 30, voix: 90, messagesWhatsapp: 7};
const SECRET_COLS = new Set(['password', 'recovery', 'token', 'token_hash', 'secret', 'csrf', 'hash', 'code']);
const PHOTO_COLS = new Set(['photo', 'id_photo', 'home_photo']);
const DEMO_DOMAIN = '@demo.fibre-guardian.ci';

function migrate(s) {
  s.db.exec('CREATE TABLE IF NOT EXISTS donnees_choix(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,ia INTEGER NOT NULL,at INTEGER NOT NULL)');
}

const has = (s, table) => !!s.get("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?", table);
const count = (s, table, where, ...args) => has(s, table) ? s.get(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, ...args).n : 0;
const nb = (n, one, many = one + 's') => n + ' ' + (n > 1 ? many : one);
const masque = phone => {const d = String(phone || '').replace(/\D/g, ''); return d.length < 6 ? '' : d.slice(0, 2) + ' •• •• ' + d.slice(-4, -2) + ' ' + d.slice(-2);};

// Le client a-t-il accepté les services d'IA ? Oui tant qu'il n'a pas dit non (il le voit et le change dans « Mes données »).
function iaAllowed(s, uid) {
  if (!s || !uid) return true;
  try { const r = s.get('SELECT ia FROM donnees_choix WHERE user_id=?', uid); return !r || r.ia === 1; } catch { return true; }
}

function choose(s, uid, d) {
  insist(typeof d.ia === 'boolean', 'Choix inconnu.');
  s.run('INSERT INTO donnees_choix(user_id,ia,at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET ia=excluded.ia,at=excluded.at', uid, d.ia ? 1 : 0, Date.now());
  return inventory(s, uid);
}

// Compte de l'équipe Moov ou compte de démo partagé : on ne l'efface pas depuis l'application.
function protege(s, uid) {
  const u = s.get('SELECT email FROM users WHERE id=?', uid);
  if (!u) return 'Compte introuvable.';
  if (u.email.endsWith(DEMO_DOMAIN)) return 'Ce compte de démonstration est partagé avec le jury : il ne peut pas être effacé. Avec votre propre compte, ce bouton efface tout.';
  if (count(s, 'operator_grants', 'user_id=?', uid) || count(s, 'noc_field_accounts', 'user_id=?', uid)) return 'Les comptes de l’équipe Moov s’effacent par la direction, pas depuis l’application.';
  return null;
}

function inventory(s, uid) {
  const u = s.get('SELECT name,email,created FROM users WHERE id=?', uid);
  const wa = has(s, 'wa_accounts') ? s.get('SELECT phone FROM wa_accounts WHERE user_id=?', uid) : null;
  const watch = has(s, 'wifi_watch') ? s.get('SELECT on_at,known,log FROM wifi_watch WHERE user_id=?', uid) : null;
  const len = v => { try { return JSON.parse(v || '[]').length; } catch { return 0; } };
  const items = [
    {key: 'compte', titre: 'Votre compte', detail: u ? 'Votre nom et votre moyen de connexion.' : '', pourquoi: 'Vous reconnaître quand vous vous connectez.', duree: 'Tant que votre compte existe.', actif: true},
    {key: 'whatsapp', titre: 'Votre WhatsApp', detail: wa ? 'Numéro relié : ' + masque(wa.phone) + '.' : 'Aucun numéro relié.', pourquoi: 'Vous prévenir d’une panne et répondre à vos messages.', duree: 'Jusqu’à ce que vous écriviez « Stop » ou touchiez « Délier ».', actif: !!wa},
    {key: 'box', titre: 'Votre box et votre connexion', detail: nb(count(s, 'journey_usage_minutes', 'user_id=?', uid), 'relevé') + ' de débit.', pourquoi: 'Trouver la cause d’une panne et vous conseiller le bon forfait.', duree: DUREES.usage + ' jours, puis effacés.', actif: true},
    {key: 'veille', titre: 'Surveillance de votre Wi-Fi', detail: watch?.on_at ? len(watch.known) + ' appareil' + (len(watch.known) > 1 ? 's' : '') + ' connu' + (len(watch.known) > 1 ? 's' : '') + ', sans leur nom ni leur adresse complète.' : 'Éteinte : rien n’est surveillé.', pourquoi: 'Vous prévenir quand un appareil inconnu se connecte.', duree: 'Tant qu’elle est allumée ; journal effacé après ' + DUREES.veille + ' jours.', actif: !!watch?.on_at},
    {key: 'copies', titre: 'Copies de votre Wi-Fi', detail: nb(count(s, 'wifi_copies', 'user_id=?', uid), 'copie faite', 'copies faites') + ' pendant un test.', pourquoi: 'Rejouer une panne sans toucher votre vrai Wi-Fi.', duree: DUREES.copies + ' jours, puis effacées.', actif: count(s, 'wifi_copies', 'user_id=?', uid) > 0},
    {key: 'photos', titre: 'Vos photos', detail: 'La photo de votre box est lue puis oubliée tout de suite. ' + nb(count(s, 'citizen_reports', "user_id=? AND photo<>''", uid), 'photo de signalement gardée', 'photos de signalement gardées') + '.', pourquoi: 'Lire les voyants de la box, montrer un câble abîmé au technicien.', duree: 'Signalements : ' + DUREES.photos + ' jours. Carte d’étudiant et photos d’abonnement : effacées dès la décision du conseiller.', actif: true},
    {key: 'lieu', titre: 'Votre quartier', detail: 'Votre commune, jamais votre position en continu.', pourquoi: 'Savoir si la panne touche aussi vos voisins.', duree: 'Tant que votre compte existe.', actif: true},
    {key: 'avis', titre: 'Vos avis et vos questions', detail: nb(count(s, 'noc_feedback', 'user_id=?', uid), 'avis', 'avis') + ', ' + nb(count(s, 'voice_requests', 'user_id=?', uid), 'question', 'questions') + ' à la voix (sujet seulement, jamais le son).', pourquoi: 'Améliorer le service et vous rappeler si vous n’êtes pas satisfait.', duree: 'Questions à la voix : ' + DUREES.voix + ' jours.', actif: true}
  ];
  return {items, ia: iaAllowed(s, uid), effacable: !protege(s, uid), refus: protege(s, uid), durees: DUREES};
}

const LABELS = {users: 'compte', journey_state: 'box_et_parcours', journey_usage_minutes: 'releves_de_debit', wa_accounts: 'whatsapp', wifi_watch: 'surveillance_wifi', wifi_copies: 'copies_wifi', citizen_reports: 'signalements', noc_feedback: 'avis', voice_requests: 'questions_a_la_voix', fidelite_factures: 'factures', parrainage_codes: 'parrainage', fibre_welcome: 'abonnement', acces_etudiants: 'tarif_etudiant', donnees_choix: 'vos_choix'};

function clean(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET_COLS.has(k)) continue;
    if (PHOTO_COLS.has(k)) { out[k] = v ? 'photo gardée (non copiée dans ce fichier)' : null; continue; }
    if (typeof v === 'string' && /^[\[{]/.test(v)) { try { out[k] = JSON.parse(v); continue; } catch {} }
    out[k] = typeof v === 'bigint' ? Number(v) : v;
  }
  return out;
}

// Droit d'accès : toutes les lignes rattachées au compte, sans mot de passe, clé ni code.
function exportData(s, uid) {
  const u = s.get('SELECT id,email,name,created FROM users WHERE id=?', uid);
  const data = {};
  for (const {name} of s.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")) {
    const cols = s.all(`PRAGMA table_info(${name})`).map(c => c.name);
    if (!cols.includes('user_id') || name === 'sessions') continue;
    const rows = s.all(`SELECT * FROM ${name} WHERE user_id=?`, uid).map(clean);
    if (rows.length) data[LABELS[name] || name] = rows;
  }
  return {application: 'Fibre Guardian', exporte_le: new Date().toISOString(), loi: 'Loi ivoirienne n°2013-450 relative à la protection des données à caractère personnel', compte: u && clean(u), donnees: data, choix: {ia: iaAllowed(s, uid)}};
}

// Droit à l'effacement : le compte et tout ce qui s'y rattache. Les dossiers de panne restent, sans le nom du client.
function erase(s, uid, d) {
  insist(d?.confirm === true, 'Confirmez l’effacement.');
  const refus = protege(s, uid);
  insist(!refus, refus, 403);
  const phone = has(s, 'wa_accounts') ? s.get('SELECT phone FROM wa_accounts WHERE user_id=?', uid)?.phone : null;
  const tables = s.all("SELECT name FROM sqlite_master WHERE type='table'").map(t => t.name);
  s.transaction(() => {
    // Colonnes qui pointent vers le compte sans effacement automatique : la ligne part, ou perd seulement le nom.
    for (const t of tables) {
      if (t === 'users') continue;
      const info = s.all(`PRAGMA table_info(${t})`);
      for (const fk of s.all(`PRAGMA foreign_key_list(${t})`)) {
        if (fk.table !== 'users' || fk.on_delete === 'CASCADE') continue;
        const col = info.find(c => c.name === fk.from);
        if (col.notnull || col.pk || fk.from === 'user_id') s.run(`DELETE FROM ${t} WHERE ${fk.from}=?`, uid);
        else s.run(`UPDATE ${t} SET ${fk.from}=NULL WHERE ${fk.from}=?`, uid);
      }
      if (info.some(c => c.name === 'user_id')) s.run(`DELETE FROM ${t} WHERE user_id=?`, uid);
    }
    if (phone) for (const t of ['wa_inbox', 'wa_menu', 'wa_asks', 'noc_whatsapp', 'wa_validated']) if (tables.includes(t)) s.run(`DELETE FROM ${t} WHERE phone=?`, phone);
    s.run('DELETE FROM users WHERE id=?', uid);
  });
  return {ok: true};
}

// Effacement automatique de ce qui ne sert plus.
function purge(s, now = Date.now()) {
  const before = days => now - days * DAY, done = {};
  const run = (key, table, sql, ...args) => { if (has(s, table)) done[key] = Number(s.run(sql, ...args).changes || 0); };
  run('usage', 'journey_usage_minutes', 'DELETE FROM journey_usage_minutes WHERE at<?', before(DUREES.usage));
  run('copies', 'wifi_copies', 'DELETE FROM wifi_copies WHERE updated<?', before(DUREES.copies));
  run('liens', 'speed_links', 'DELETE FROM speed_links WHERE expires<?', before(1));
  run('photos', 'citizen_reports', "UPDATE citizen_reports SET photo='' WHERE photo<>'' AND created<?", before(DUREES.photos));
  run('voix', 'voice_requests', 'DELETE FROM voice_requests WHERE at<?', before(DUREES.voix));
  run('whatsapp', 'wa_inbox', 'DELETE FROM wa_inbox WHERE at<?', before(DUREES.messagesWhatsapp));
  if (has(s, 'wifi_watch')) {
    let n = 0;
    for (const r of s.all("SELECT user_id,log FROM wifi_watch WHERE log<>'[]'")) {
      let log; try { log = JSON.parse(r.log); } catch { continue; }
      const kept = log.filter(l => !(l.at < before(DUREES.veille)));
      if (kept.length !== log.length) { s.run('UPDATE wifi_watch SET log=? WHERE user_id=?', JSON.stringify(kept), r.user_id); n += log.length - kept.length; }
    }
    done.veille = n;
  }
  return done;
}

module.exports = {migrate, inventory, choose, iaAllowed, exportData, erase, purge, masque, DUREES};
