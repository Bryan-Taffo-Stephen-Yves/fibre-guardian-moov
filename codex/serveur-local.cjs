// Démarre Fibre Guardian. Tous les réglages viennent de variables d'environnement (voir DEPLOIEMENT.md).
if (require.main === module) {
  const fs = require('node:fs'), path = require('node:path');
  const env = process.env;
  // Réglages locaux facultatifs (par exemple ANTHROPIC_API_KEY) dans codex/.env, jamais dans git.
  const local = require('./env-file.cjs').load(__dirname, env);
  if (local.file) console.log('Réglages lus dans ' + path.basename(local.file) + ' : ' + (local.applied.join(', ') || 'aucun nouveau'));
  // Hébergé derrière un proxy HTTPS (Railway, Render…) : GUARDIAN_PROXY=1 et GUARDIAN_ORIGIN=https://…
  const proxy = env.GUARDIAN_PROXY === '1';
  const host = env.GUARDIAN_HOST || (proxy ? '0.0.0.0' : '127.0.0.1');
  const port = Number(env.PORT || env.GUARDIAN_PORT || 8186);
  const tls = env.GUARDIAN_TLS_KEY && env.GUARDIAN_TLS_CERT ? { key: fs.readFileSync(env.GUARDIAN_TLS_KEY), cert: fs.readFileSync(env.GUARDIAN_TLS_CERT) } : null;
  if (host !== '127.0.0.1' && !((tls || proxy) && env.GUARDIAN_ORIGIN)) throw new Error('Accès réseau : GUARDIAN_ORIGIN est requis, avec TLS ou GUARDIAN_PROXY=1.');
  // Données : GUARDIAN_DB (fichier), sinon GUARDIAN_DATA_DIR ou le volume Railway, sinon codex/.local/.
  const dataDir = path.resolve(env.GUARDIAN_DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '.local'));
  const dbFile = path.resolve(env.GUARDIAN_DB || path.join(dataDir, 'pilot.sqlite'));
  const pilot = require('./pilot-server.cjs').createGuardianServer({ tls, proxy, origin: env.GUARDIAN_ORIGIN, db: dbFile, liveTelemetry: env.GUARDIAN_LIVE_TELEMETRY !== '0', android: env.GUARDIAN_ANDROID_PACKAGE ? { package: env.GUARDIAN_ANDROID_PACKAGE, fingerprints: String(env.GUARDIAN_ANDROID_SHA256 || '').split(',') } : null, onError: e => console.error('Erreur serveur :', e.message) });
  // Première ouverture : base vide, on installe la démo pré-remplie (une seule fois).
  const demo = require('./seed-demo.cjs');
  const ready = env.GUARDIAN_SEED_DEMO !== '0' && demo.isEmpty(pilot.guardianStore)
    ? demo.seedDemo(pilot.guardianStore, { log: console.log, credentialsFile: path.join(path.dirname(dbFile), 'identifiants-demo.txt') }).then(r => { if (r.seeded) console.log('Démo pré-remplie installée (3 comptes et un client par quartier, voir README).'); })
    : Promise.resolve();
  console.log(require('./guardian-ai.cjs').available() ? 'Guardian : réponses rédigées avec Claude (clé ANTHROPIC_API_KEY trouvée).' : 'Guardian : réponses du moteur à règles (pas de clé ANTHROPIC_API_KEY).');
  const wa = require('./whatsapp.cjs').config(env);
  console.log(wa ? 'WhatsApp : vrais messages par ' + (wa.provider === 'twilio' ? 'Twilio' : 'Meta') + ' vers ' + wa.list.length + ' téléphone(s).' : 'WhatsApp : messages affichés dans le Simulateur seulement (pas de réglage TWILIO_* ni WHATSAPP_*).');
  const prises = require('./branchements.cjs').config(env), ouvertes = ['reseau', 'clients', 'ussd', 'sms'].filter(p => prises[p]);
  console.log('Réseau Moov : ' + (ouvertes.length ? 'prises branchées : ' + ouvertes.join(', ') + '.' : 'simulateur (aucune prise branchée, voir BRANCHEMENTS.md).'));
  pilot.on('error', e => { console.error(e.message); process.exitCode = 1; });
  ready.catch(e => { console.error('Démo pré-remplie impossible :', e.message); })
    .then(() => pilot.listen(port, host, () => console.log('Fibre Guardian : ' + (env.GUARDIAN_ORIGIN || 'http://127.0.0.1:' + port) + '/codex/ (données : ' + path.dirname(dbFile) + ') ; Ctrl+C pour arrêter.')));
  const stop = () => pilot.close(() => process.exit(0));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
