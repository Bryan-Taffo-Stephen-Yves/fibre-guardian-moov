/* Classic scripts keep this interface usable via file://, without a build or CDN. */
(function () {
  'use strict';
  const files = FG.LANG_FILES.filter(id => /^[a-z0-9_-]+$/i.test(id)).map(id => '../src/lang/' + id + '.js')
    .concat(['../src/agent.js', '../src/vision.js', 'ui-model.js', 'scenes.js', 'wifi-placement.js', 'wifi-map.js', 'support-views.js', 'household-model.js', 'household-analytics.js', 'household-scenario.js', 'household-view.js', 'incident-model.js', 'incident-view.js', 'shared-telemetry-view.js', 'approval-view.js', 'operator-view.js', 'pilot-lab-view.js', 'pilot-view.js', 'guardian-map.js', 'noc-command-view.js', 'noc-view.js', 'device-usage-view.js', 'journey.js', 'app.js']);
  function next() {
    const path = files.shift(); if (!path) return;
    const script = document.createElement('script'); script.src = path; script.onload = next;
    script.onerror = function () { document.getElementById('root').textContent = 'Un fichier local manque : ' + path + '. Conservez le dossier codex avec les dossiers src et vendor, puis rechargez.'; };
    document.head.appendChild(script);
  }
  next();
})();
