/* Les messages du client rangés par service, pour l'accueil, la boîte « Messages » et le serveur.
   - « dossier » : Dossier de ma fibre (Fibre Welcome, welcome.cjs, page « bienvenue ») ;
   - « appareils » : la veille du Wi-Fi et les appareils (veille-wifi.cjs, simulations.cjs, page « devices ») ;
   - « guardian » : tout le reste (box, forfait, panne, passage du technicien…).
   Même fichier côté navigateur (window.FGNotifServices) et côté serveur (require). */
(function (root) {
  'use strict';
  const SERVICES = ['dossier', 'appareils', 'guardian'];
  // Service d'un message : d'après la page qu'il ouvre et sa nature.
  function service(n) {
    if (!n || typeof n !== 'object') return 'guardian';
    if (n.page === 'bienvenue') return 'dossier';
    if (n.page === 'devices' || n.kind === 'wifi') return 'appareils';
    return 'guardian';
  }
  // Nombre de messages non lus de ce foyer, par service. Sans foyer donné : tous les foyers.
  function counts(list, home) {
    const out = {dossier: 0, appareils: 0, guardian: 0};
    for (const n of Array.isArray(list) ? list : []) {
      if (!n || n.read) continue;
      if (home && n.home && n.home !== home) continue;
      out[service(n)]++;
    }
    return out;
  }
  const api = {SERVICES, service, counts};
  root.FGNotifServices = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
