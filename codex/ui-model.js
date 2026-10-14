/* UI-only policies. The engine in src/ remains the single source of diagnosis. */
(function (root) {
  'use strict';
  const LABELS = { sain: 'Tout fonctionne', rupture: 'Fibre coupée', attenuation: 'Signal fibre en baisse', wifi: 'Wi-Fi trop faible', amont: 'Incident chez Moov', congestion: 'Réseau très chargé', partage: 'Beaucoup d’appareils', anomalie: 'Analyse en cours' };
  const NEXT = { sain: ['reboot', 'Redémarrer la box'], rupture: ['ticket', 'Préparer un signalement'], attenuation: ['ticket', 'Préparer une intervention'], wifi: ['channel', 'Optimiser le Wi-Fi'], amont: ['track', 'Voir le suivi de l’incident'], congestion: ['schedule', 'Préparer un téléchargement de nuit'], partage: ['secure', 'Vérifier les appareils'], anomalie: ['ticket', 'Préparer un signalement'] };
  const canView = (page, role) => !['supervision', 'retention'].includes(page) || ['conseiller', 'superviseur'].includes(role);
  // Progress counts actual fresh measurements, never time spent paused or seed history.
  function lineTestState({source = 'line', mode = 'nominal', cls = 'sain', samples = 0, started = false} = {}) {
    const count = Number.isFinite(samples) ? Math.max(0, Math.floor(samples)) : 0;
    const expected = mode === 'sms' ? 'rupture' : mode;
    const active = source === 'line' && !!started && ['rupture', 'attenuation', 'wifi', 'amont', 'congestion', 'partage', 'sms'].includes(mode);
    const matched = active && cls === expected;
    return {active, expected, samples:count, matched, pending:active && !matched && count < 45, exhausted:active && !matched && count >= 45};
  }
  function rebootGate(history, now, linked = true) {
    const recent = (Array.isArray(history) ? history : []).filter(t => Number.isFinite(t) && t > now - 600000 && t <= now);
    if (!linked) return { ok: false, recent, message: 'Commande refusée : ce numéro n’est pas lié à la ligne de démonstration.' };
    if (recent.length >= 2) return { ok: false, recent, message: 'Limite atteinte : 2 redémarrages en 10 minutes. Réessayez plus tard.' };
    return { ok: true, recent, message: 'Redémarrage autorisé dans le simulateur.' };
  }
  function readStorage(key, fallback) { try { const raw = localStorage.getItem('fg-codex-' + key); return raw === null ? fallback : JSON.parse(raw); } catch (_) { return fallback; } }
  function saveStorage(key, value) { try { localStorage.setItem('fg-codex-' + key, JSON.stringify(value)); } catch (_) { /* file:// or private mode may deny storage; app remains usable. */ } }
  const api = { LABELS, NEXT, canView, lineTestState, rebootGate, readStorage, saveStorage };
  root.FGUI = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
