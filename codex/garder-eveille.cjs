'use strict';
// Garde Fibre Guardian éveillé sur Render (offre gratuite).
// Render endort le service après 15 minutes sans visite venue d'Internet. Au réveil, il faut
// 30 à 60 secondes pour relancer le serveur et réinstaller la démo : un message WhatsApp
// envoyé pendant ce temps attend, et Guardian répond en retard.
// Le robot GitHub (.github/workflows/garder-eveille.yml) ne passe en réalité que quelques fois
// par jour. Ici, le serveur ouvre lui-même son adresse publique toutes les 10 minutes :
// la visite repasse par Internet, Render la compte, et le service ne s'endort plus.
// Actif seulement sur Render (variable RENDER posée par Render), ou avec GUARDIAN_KEEPALIVE_URL.
// GUARDIAN_KEEPALIVE=0 l'arrête. Aucune clé, aucun secret.
const EVERY_MS = 10 * 60 * 1000;

function target(env) {
  if (env.GUARDIAN_KEEPALIVE === '0') return '';
  const raw = env.GUARDIAN_KEEPALIVE_URL || (env.RENDER ? env.GUARDIAN_ORIGIN || env.RENDER_EXTERNAL_URL : '');
  if (!raw) return '';
  try {
    const url = new URL('/api/health', raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

// Lance la visite régulière. Renvoie une fonction pour l'arrêter (ou null si rien n'est lancé).
function start(env, {fetchImpl = fetch, log = () => {}, every = EVERY_MS, setTimer = setInterval, clearTimer = clearInterval} = {}) {
  const url = target(env);
  if (!url) return null;
  let failed = false;
  const visit = async () => {
    try {
      const r = await fetchImpl(url, {headers: {'User-Agent': 'FibreGuardian-eveil'}, signal: AbortSignal.timeout(30000)});
      if (!r.ok) throw new Error('réponse ' + r.status);
      if (failed) log('Toujours éveillé : le site répond de nouveau.');
      failed = false;
    } catch (e) {
      if (!failed) log('Toujours éveillé : visite manquée (' + (e.name === 'TimeoutError' ? 'délai dépassé' : e.message) + '), nouvel essai dans 10 minutes.');
      failed = true;
    }
  };
  const timer = setTimer(visit, every);
  if (timer && typeof timer.unref === 'function') timer.unref();
  log('Toujours éveillé : visite de ' + url + ' toutes les ' + Math.round(every / 60000) + ' minutes (Guardian répond tout de suite sur WhatsApp).');
  return () => clearTimer(timer);
}

module.exports = {start, target, EVERY_MS};
