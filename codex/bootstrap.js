/* Classic scripts keep this interface usable via file://, without a build or CDN. */
(function () {
  'use strict';
  const files = FG.LANG_FILES.filter(id => /^[a-z0-9_-]+$/i.test(id)).map(id => '../src/lang/' + id + '.js')
    .concat(['theme.js', '../src/agent.js', '../src/vision.js', 'ui-model.js', 'scenes.js', 'wifi-placement.js', 'wifi-map.js', 'support-views.js', 'household-model.js', 'household-analytics.js', 'household-scenario.js', 'household-view.js', 'incident-model.js', 'incident-view.js', 'shared-telemetry-view.js', 'approval-view.js', 'operator-view.js', 'pilot-lab-view.js', 'pilot-view.js', 'guardian-map.js', 'abidjan-map.js', 'forecast-view.js', 'impact-view.js', 'appel-view.js', 'labo-view.js', 'superviseur-view.js', 'sim-flow.js', 'sim-flow-view.js', 'sim3d.js', 'noc-alert.js', 'demo.js', 'ride-map.js', 'live-trip.js', 'noc-command-view.js', 'noc-view.js', 'device-usage-view.js', 'guardian-voice.js', 'guardian-pay.js', 'sonnerie.js', 'survie.js', 'ville-view.js', 'landing.js', 'client-home.js', 'tech-view.js', 'journey.js', 'lib/qrcode.js', 'jury.js', 'app.js']);
  function next() {
    const path = files.shift(); if (!path) return;
    const script = document.createElement('script'); script.src = path; script.onload = next;
    script.onerror = function () { document.getElementById('root').textContent = 'Fibre Guardian n’a pas pu se charger complètement. Rechargez la page.'; console.error('Fichier manquant : ' + path); };
    document.head.appendChild(script);
  }
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
