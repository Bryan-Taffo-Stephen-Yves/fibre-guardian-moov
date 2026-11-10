/* Classic scripts keep this interface usable via file://, without a build or CDN. */
(function () {
  'use strict';
  const files = FG.LANG_FILES.filter(id => /^[a-z0-9_-]+$/i.test(id)).map(id => '../src/lang/' + id + '.js')
    .concat(['theme.js', '../src/agent.js', '../src/vision.js', 'ui-model.js', 'scenes.js', 'wifi-placement.js', 'wifi-map.js', 'support-views.js', 'household-model.js', 'household-analytics.js', 'household-scenario.js', 'household-view.js', 'incident-model.js', 'incident-view.js', 'shared-telemetry-view.js', 'approval-view.js', 'operator-view.js', 'pilot-lab-view.js', 'pilot-view.js', 'guardian-map.js', 'abidjan-map.js', 'forecast-view.js', 'impact-view.js', 'appel-view.js', 'labo-view.js', 'fair-deal-view.js', 'superviseur-view.js', 'copies-view.js', 'sim-flow.js', 'sim-flow-view.js', 'sim3d.js', 'noc-alert.js', 'demo.js', 'avatars.js', 'ride-map.js', 'live-trip.js', 'noc-command-view.js', 'dossier-chain.js', 'noc-view.js', 'device-usage-view.js', 'guardian-voice.js', 'guardian-pay.js', 'sonnerie.js', 'survie.js', 'ville-view.js', 'landing.js', 'client-home.js','smart-offer.js','plan-view.js', 'tech-view.js', 'mission-ping.js', 'journey.js', 'lib/qrcode.js', 'jury.js', 'app.js']);
  // Un fichier qui ne vient pas (réseau mobile faible, site qui se réveille) est redemandé deux fois avant d'abandonner.
  function next(path, tries) {
    if (!path) { path = files.shift(); tries = 0; } if (!path) return;
    const script = document.createElement('script'); script.src = tries ? path + (path.indexOf('?') < 0 ? '?' : '&') + 'essai=' + tries + '-' + Date.now() : path;
    script.onload = function () { next(); };
    script.onerror = function () {
      script.remove();
      if (tries < 2) { setTimeout(function () { next(path, tries + 1); }, 700 * (tries + 1)); return; }
      console.error('Fichier manquant : ' + path);
      const root = document.getElementById('root'), box = document.createElement('div'), button = document.createElement('button');
      box.className = 'fg-load-error'; box.setAttribute('role', 'alert');
      box.textContent = 'Fibre Guardian n’a pas pu se charger complètement. Vérifiez votre connexion, puis rechargez la page.';
      button.type = 'button'; button.textContent = 'Recharger'; button.onclick = function () { location.reload(); };
      const detail = document.createElement('small'); detail.textContent = 'Fichier : ' + path;
      box.appendChild(button); box.appendChild(detail); root.textContent = ''; root.appendChild(box);
    };
    document.head.appendChild(script);
  }
  // Fibre Loyalty+ (fidelite-view.js) : la page « Ma fidélité », sa carte sur l'accueil et son bloc dans le Superviseur.
  files.splice(files.indexOf('superviseur-view.js'), 0, 'fidelite-view.js');
  // Fibre Welcome (welcome-view.js) se charge juste avant le Superviseur, qui affiche son bloc « Nouveaux abonnés ».
  files.splice(files.indexOf('superviseur-view.js'), 0, 'welcome-view.js');
  // Fibre Voice (fibre-voice-view.js) : la page « Parler à Guardian » et son bloc dans le Superviseur.
  files.splice(files.indexOf('superviseur-view.js'), 0, 'fibre-voice-view.js');
  // Barre des rôles de la démo (role-bar.js) : chargée avant app.js, visible seulement là où la direction l’a activée.
  files.splice(files.indexOf('app.js'), 0, 'role-bar.js');
  next();
  // Application installable : le service worker garde les fichiers chargés pour le mode hors ligne.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { scope: './' }).then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
        setTimeout(function () {
          const urls = performance.getEntriesByType('resource').map(function (e) { return e.name; }).filter(function (u) { return u.indexOf(location.origin + '/') === 0 && u.indexOf('/api/') < 0; });
          if (reg.active) reg.active.postMessage({ type: 'guardian-cache', urls: urls.concat([location.href]) });
        }, 4000);
      }).catch(function () {});
    });
  }
})();
