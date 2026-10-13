(function () {
  'use strict';
  var h = React.createElement, useState = React.useState;
  var STATUSES = {
    open: { label: 'À traiter', tone: 'attention' },
    verifying: { label: 'Vérification en cours', tone: 'checking' },
    resolved: { label: 'Résolu · vérifié', tone: 'success' },
    improved: { label: 'Amélioré', tone: 'attention' },
    unchanged: { label: 'Inchangé', tone: 'attention' },
    unverifiable: { label: 'Non vérifiable', tone: 'neutral' }
  };
  var METRICS = [
    ['capacityMbps', 'Capacité disponible', 'Mbps', 1],
    ['usageMbps', 'Trafic utilisé', 'Mbps', 1],
    ['latencyMs', 'Latence', 'ms', 0],
    ['lossPct', 'Pertes de paquets', '%', 1],
    ['connected', 'Appareils connectés', '', 0],
    ['topSharePct', 'Part du plus gros utilisateur', '%', 1]
  ];
  var OPTIONAL_METRICS = [
    ['localMbps', 'Débit sur l’appareil', 'Mbps', 1],
    ['wifiDbm', 'Signal Wi-Fi', 'dBm', 1],
    ['opticalDbm', 'Signal optique', 'dBm', 1],
    ['usualConnected', 'Nombre habituel d’appareils', '', 0],
    ['unknownCount', 'Appareils non reconnus', '', 0]
  ];
  function originLabel(origin) { return origin === 'household' ? 'Ma maison' : origin === 'line' ? 'Ligne simulée' : 'Source non disponible'; }
  function statusOf(incident) { return STATUSES[incident.status] || STATUSES.open; }
  function dateLabel(at, full) {
    var date = new Date(at);
    if (at == null || !Number.isFinite(date.getTime())) return 'Heure non disponible';
    var options = { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' };
    if (full) { options.day = '2-digit'; options.month = 'short'; }
    return new Intl.DateTimeFormat('fr-FR', options).format(date);
  }
  function iso(at) { var date = new Date(at); return at != null && Number.isFinite(date.getTime()) ? date.toISOString() : undefined; }
  function metricValue(frame, metric, missing) {
    if (!frame) return missing;
    var value = frame.metrics && frame.metrics[metric[0]];
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Indisponible';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: metric[3] }).format(value) + (metric[2] ? ' ' + metric[2] : '');
  }
  function icon(name, size) {
    var paths = {
      pulse: 'M3 12h4l3-8 4 16 3-8h4',
      arrow: 'M5 12h14m-6-6 6 6-6 6',
      check: 'm5 12 4 4L19 6',
      clock: 'M12 7v5l3 2',
      shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3',
      download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
      file: 'M6 3h8l4 4v14H6V3m8 0v5h4M9 12h6m-6 4h6'
    };
    return h('svg', { width: size || 20, height: size || 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, name === 'clock' && h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: paths[name] || paths.pulse }));
  }
  function button(label, onClick, options) {
    return h('button', Object.assign({ type: 'button', className: 'ic-button', onClick: onClick }, options || {}), label);
  }
  function Badge(props) {
    var status = statusOf(props.incident);
    return h('span', { className: 'ic-badge ic-badge-' + status.tone, 'data-testid': props.selected ? 'incident-status' : undefined, 'data-status': props.incident.status, 'aria-live': props.selected ? 'polite' : undefined }, h('span', { className: 'ic-status-dot', 'aria-hidden': true }), status.label);
  }
  function SourceStrip(props) {
    var frame = props.latest, simulation = !frame || frame.mode === 'simulation';
    if (props.compact) return h('section', { className: 'ic-source-compact', 'aria-label': 'Modes du laboratoire', 'data-testid': 'incident-active-source' },
      h('span', { className: 'ic-mode-current' }, icon('shield', 14), simulation ? 'Simulation · aucune box connectée' : 'Collecte réelle indisponible'),
      h('span', null, 'Réseau réel · à connecter'), h('span', null, 'Relecture · à venir'));
    return h('section', { className: 'ic-source', 'aria-label': 'Origine des mesures', 'data-testid': 'incident-active-source' },
      h('div', { className: 'ic-source-main' }, h('span', { className: 'ic-icon-disc' }, icon('shield')), h('div', null, h('strong', null, simulation ? 'Simulation · aucune box connectée' : 'Collecte réelle indisponible'), h('p', null, simulation ? 'Les mesures et corrections de ce laboratoire sont simulées.' : 'Aucune connexion à une box réelle n’est activée dans cette version.'))),
      h('div', { className: 'ic-source-reading' }, h('span', null, 'Source active'), h('strong', null, frame ? originLabel(frame.origin) : 'En attente de mesures'), h('small', null, frame && frame.available !== false ? h(React.Fragment, null, props.paused ? 'En pause · ' : 'Dernier relevé · ', h('time', { dateTime: iso(frame.at) }, dateLabel(frame.at)), ' UTC') : 'Aucun relevé disponible')),
      h('div', { className: 'ic-modes', 'aria-label': 'Modes disponibles' }, h('span', { className: 'ic-mode-current' }, 'Simulation'), h('span', { title: 'Nécessite un connecteur compatible et autorisé.' }, 'Réseau réel · à connecter'), h('span', { title: 'La consultation des incidents archivés est disponible ; la relecture de mesures sera ajoutée ultérieurement.' }, 'Relecture · à venir')));
  }
  function Comparison(props) {
    var rows = METRICS.concat(OPTIONAL_METRICS.filter(function (metric) {
      return [props.incident.before, props.incident.after].some(function (frame) { return frame && frame.metrics && Number.isFinite(frame.metrics[metric[0]]); });
    }));
    return h('section', { className: 'ic-comparison', 'aria-labelledby': 'ic-comparison-heading', 'data-testid': 'incident-comparison' },
      h('div', { className: 'ic-section-heading' }, h('div', null, h('span', { className: 'ic-kicker' }, 'LA PREUVE'), h('h3', { id: 'ic-comparison-heading' }, 'Avant / après')), props.incident.after && h('span', { className: 'ic-microcopy' }, 'Résultat observé, pas une garantie')),
      h('div', { className: 'ic-table-wrap' }, h('table', null,
        h('caption', { className: 'ic-sr-only' }, 'Comparaison des mesures de l’incident ', props.incident.title, '. Les valeurs indisponibles ne valent pas zéro.'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Mesure'), h('th', { scope: 'col' }, 'Avant', h('small', null, dateLabel(props.incident.before && props.incident.before.at))), h('th', { scope: 'col' }, 'Après', h('small', null, props.incident.after ? dateLabel(props.incident.after.at) : 'En attente')))),
        h('tbody', null, rows.map(function (metric) { return h('tr', { key: metric[0] }, h('th', { scope: 'row' }, metric[0] === 'capacityMbps' && props.incident.origin === 'line' ? 'Débit à la box' : metric[1]), h('td', { 'data-testid': 'incident-before', 'data-metric': metric[0] }, metricValue(props.incident.before, metric, 'Indisponible')), h('td', { 'data-testid': 'incident-after', 'data-metric': metric[0] }, metricValue(props.incident.after, metric, 'En attente'))); })))),
      h('p', { className: 'ic-microcopy' }, 'Horloge de simulation, en UTC. Le tableau compare le relevé initial au dernier relevé du test ; le verdict s’appuie sur les cinq nouveaux relevés. « Indisponible » ne signifie pas zéro. Un trafic plus faible, à lui seul, ne prouve pas une réparation.'));
  }
  function Detail(props) {
    var incident = props.incident, latest = props.latest;
    var verifying = incident.status === 'verifying', resolved = incident.status === 'resolved', archived = !!incident.archived;
    var sameSource = !!latest && latest.origin === incident.origin && latest.mode === incident.mode;
    var available = sameSource && latest.available !== false;
    var locked = !props.canAct || archived || verifying || resolved || !available;
    var frames = incident.verification && incident.verification.frames;
    var count = Number.isFinite(incident.sampleCount) ? incident.sampleCount : frames ? frames.length : 0;
    var target = Number.isFinite(incident.targetSamples) && incident.targetSamples > 0 ? incident.targetSamples : 5;
    var reason = incident.resultReason || incident.reason;
    var action = incident.action || incident.before && incident.before.diagnosis && incident.before.diagnosis.action;
    var actionIsReview = action === 'review-devices';
    var actionIsCorrection = !!action && action !== 'observe' && !actionIsReview;
    function returnToSource() {
      if (props.onSource) props.onSource(incident.origin);
      else props.onNavigate(incident.origin === 'household' ? 'household' : 'diagnostic');
    }
    return h('article', { className: 'ic-detail', 'data-testid': 'incident-active', 'data-incident-id': incident.id, 'data-archived': String(archived), 'aria-label': 'Détail de l’incident' },
      h('header', { className: 'ic-detail-heading' }, h('div', null, h('span', { className: 'ic-kicker' }, originLabel(incident.origin), ' · ', archived ? 'ARCHIVE LOCALE' : 'INCIDENT SIMULÉ'), h('h2', null, incident.title), h('p', { className: 'ic-microcopy' }, 'Détecté le ', h('time', { dateTime: iso(incident.openedAt) }, dateLabel(incident.openedAt, true)), ' UTC')), h(Badge, { incident: incident, selected: true })),
      h('ol', { className: 'ic-steps', 'aria-label': 'Parcours de résolution' }, ['Détecter', 'Comprendre', 'Agir', 'Vérifier'].map(function (label, index) { var done = index < 2 || (index === 2 && (verifying || !!incident.after)) || (index === 3 && resolved); return h('li', { key: label, className: done ? 'ic-step-done' : '' }, h('span', { className: 'ic-step-number', 'aria-hidden': true }, done ? icon('check', 13) : index + 1), label); })),
      h('section', { className: 'ic-explanation' }, h('span', { className: 'ic-kicker' }, 'CE QUE LES MESURES INDIQUENT'), h('p', null, incident.explanation || 'Les relevés disponibles nécessitent une vérification complémentaire.'), incident.evidence && incident.evidence.length > 0 && h('ul', null, incident.evidence.map(function (evidence, index) { return h('li', { key: index }, evidence); }))),
      archived && h('p', { className: 'ic-notice' }, 'Cet incident provient d’une session précédente. Il reste consultable et exportable ; aucune action n’est exécutée depuis une archive.'),
      !props.canAct && h('p', { className: 'ic-notice', 'data-testid': 'incident-role-notice' }, 'Mode invité : vous pouvez consulter et exporter ce rapport. Les actions et les vérifications sont réservées au propriétaire de la démonstration. Ce rôle local n’est pas une authentification réelle.'),
      !sameSource && !archived && h('div', { className: 'ic-notice ic-notice-action' }, h('p', null, 'Cet incident concerne une autre source. Revenez à ', originLabel(incident.origin), ' pour obtenir de nouveaux relevés avant d’agir.'), button('Revenir à la source de cet incident', returnToSource, { disabled: !props.canAct })),
      sameSource && !available && !archived && h('p', { className: 'ic-notice' }, 'La source ne fournit plus de mesures. Aucune résolution ne peut être confirmée pour le moment.'),
      h('section', { className: 'ic-action-card', 'aria-labelledby': 'ic-action-heading' },
        h('div', { className: 'ic-section-heading' }, h('div', null, h('span', { className: 'ic-kicker' }, 'PROCHAINE ÉTAPE'), h('h3', { id: 'ic-action-heading' }, verifying ? 'Mesurer avant de conclure' : resolved ? 'Une amélioration confirmée par les relevés' : 'Une action, puis une vérification'))),
        h('p', null, resolved ? 'Le critère de résolution a été atteint sur les relevés de cette vérification. La surveillance peut révéler un nouvel incident.' : incident.actionLabel || 'Observer de nouveaux relevés pour vérifier si la situation évolue.'),
        !verifying && !resolved && !archived && h('p', { className: 'ic-microcopy' }, actionIsCorrection ? 'L’action demande votre confirmation. Son acceptation ne signifie pas que le problème est résolu.' : 'Aucune réparation automatique n’est proposée pour ce problème. Les mesures permettent de vérifier son évolution.'),
        verifying && h('div', { className: 'ic-progress', 'data-testid': 'incident-verification' }, h('div', null, h('strong', null, 'Relevés frais'), h('span', { 'aria-live': 'polite', 'data-testid': 'incident-progress', 'data-count': Math.min(count, target) }, Math.min(count, target), ' / ', target)), h('progress', { value: Math.min(count, target), max: target, 'aria-label': 'Progression de la vérification' }), h('p', { className: 'ic-microcopy' }, props.paused ? 'La vérification attend la reprise des mesures.' : 'Nous attendons des mesures postérieures au début du test, provenant de la même source.')),
        props.paused && !archived && !resolved && h('div', { className: 'ic-pause', 'data-testid': 'incident-pause' }, h('p', null, icon('clock', 17), 'Les mesures sont en pause.'), button('Reprendre les mesures', props.onResume, { disabled: !props.canAct, 'data-testid': 'incident-resume' })),
        reason && h('div', { className: 'ic-result ic-result-' + statusOf(incident).tone, role: 'status' }, h('strong', null, statusOf(incident).label), h('p', null, reason)),
        h('div', { className: 'ic-actions' },
          actionIsCorrection && button(h(React.Fragment, null, 'Appliquer et vérifier', icon('arrow', 17)), function () { props.onApply(incident.id); }, { className: 'ic-button ic-button-primary', disabled: locked, 'data-testid': 'incident-apply' }),
          actionIsReview && button('Examiner les appareils', function () { props.onNavigate('household'); }, { disabled: !props.canAct || archived, 'data-testid': 'incident-review-devices' }),
          button('Vérifier sans modifier', function () { props.onVerify(incident.id); }, { disabled: locked, 'data-testid': 'incident-verify' }))),
      h(Comparison, { incident: incident }),
      h('section', { className: 'ic-history', 'aria-labelledby': 'ic-history-heading' }, h('div', { className: 'ic-section-heading' }, h('div', null, h('span', { className: 'ic-kicker' }, 'TRAÇABILITÉ'), h('h3', { id: 'ic-history-heading' }, 'Le fil de cet incident')), icon('clock')),
        incident.timeline && incident.timeline.length ? h('ol', { className: 'ic-timeline' }, incident.timeline.map(function (entry, index) { return h('li', { key: index }, h('time', { dateTime: iso(entry.at) }, dateLabel(entry.at)), h('p', null, entry.text)); })) : h('p', { className: 'ic-microcopy' }, 'Aucun événement enregistré.')),
      h('footer', { className: 'ic-detail-footer' }, h('p', null, 'Un rapport de démonstration, avec sa source et ses limites. Aucune donnée de box réelle.'), button(h(React.Fragment, null, icon('download', 17), 'Exporter cet incident'), function () { props.onExport(incident.id); }, { 'data-testid': 'incident-export' })));
  }
  function IncidentView(props) {
    var state = props.state || {}, incidents = Array.isArray(state.incidents) ? state.incidents : [];
    var selectedState = useState(null), selectedId = selectedState[0], setSelectedId = selectedState[1];
    var filterState = useState('all'), filter = filterState[0], setFilter = filterState[1];
    var sorted = incidents.slice().sort(function (a, b) { return Number(!!a.archived) - Number(!!b.archived) || Number(new Date(b.openedAt)) - Number(new Date(a.openedAt)); });
    var filtered = sorted.filter(function (incident) { return filter === 'all' || (filter === 'archived' ? !!incident.archived : filter === 'resolved' ? incident.status === 'resolved' : !incident.archived && incident.status !== 'resolved'); });
    var selected = filtered.find(function (incident) { return incident.id === selectedId; }) || filtered[0];
    var activeCount = incidents.filter(function (incident) { return !incident.archived && incident.status !== 'resolved'; }).length;
    var resolvedCount = incidents.filter(function (incident) { return incident.status === 'resolved'; }).length;
    return h('div', { className: 'ic-center' },
      h(SourceStrip, { latest: state.latest, paused: props.paused, compact: props.compactSource }),
      props.persistenceAvailable === false && h('p', { className: 'ic-notice', role: 'status' }, 'Le stockage local est indisponible. Les incidents de cette session ne seront pas conservés après fermeture. Vous pouvez exporter chaque rapport.'),
      h('div', { className: 'ic-overview' }, h('div', null, h('span', { className: 'ic-kicker' }, 'NE PAS SE CONTENTER D’UN BOUTON « RÉSOLU »'), h('h2', null, 'Du problème à la preuve.'), h('p', null, 'Une cause expliquée, une action encadrée, puis des mesures pour vérifier le résultat.')), h('dl', { className: 'ic-counts' }, h('div', null, h('dt', null, 'À suivre'), h('dd', null, activeCount)), h('div', null, h('dt', null, 'Résolus et vérifiés'), h('dd', null, resolvedCount)))),
      !incidents.length ? h('section', { className: 'ic-empty' }, h('span', { className: 'ic-empty-icon' }, icon('pulse', 34)), h('h2', null, 'Aucun incident enregistré pour le moment'), h('p', null, 'Lancez une situation dans Ma maison : un gros téléchargement, une capacité réduite ou une coupure Internet. Le centre suivra le problème et conservera les preuves de sa vérification.'), button(h(React.Fragment, null, 'Essayer une situation dans Ma maison', icon('arrow', 18)), function () { props.onNavigate('household'); }, { className: 'ic-button ic-button-primary' }), h('small', null, 'Simulation uniquement. Aucun appareil réel ne sera perturbé.')) :
        h('div', { className: 'ic-layout' }, h('aside', { className: 'ic-list-panel', 'aria-label': 'Liste des incidents' },
          h('div', { className: 'ic-list-title' }, h('h2', null, 'Vos incidents'), h('span', null, incidents.length)),
          h('label', { className: 'ic-filter' }, 'Afficher', h('select', { value: filter, onChange: function (event) { setFilter(event.target.value); }, 'aria-label': 'Filtrer les incidents' }, h('option', { value: 'all' }, 'Tous les incidents'), h('option', { value: 'active' }, 'À suivre dans cette session'), h('option', { value: 'resolved' }, 'Résolus et vérifiés'), h('option', { value: 'archived' }, 'Archives'))),
          filtered.length ? h('ul', { className: 'ic-list' }, filtered.map(function (incident) { var current = selected && selected.id === incident.id; return h('li', { key: incident.id }, h('button', { type: 'button', className: 'ic-list-item' + (current ? ' ic-list-selected' : ''), onClick: function () { setSelectedId(incident.id); }, 'aria-pressed': current, 'aria-label': 'Ouvrir l’incident : ' + incident.title + ' · ' + statusOf(incident).label }, h('span', { className: 'ic-list-meta' }, h('span', null, originLabel(incident.origin)), h('time', { dateTime: iso(incident.openedAt) }, dateLabel(incident.openedAt))), h('strong', null, incident.title), h('span', { className: 'ic-list-bottom' }, h(Badge, { incident: incident }), incident.archived && h('small', null, 'Archive')))); })) : h('p', { className: 'ic-list-empty' }, 'Aucun incident dans cette catégorie.'),
          h('p', { className: 'ic-list-note' }, icon('file', 16), 'Les anciens dossiers restent consultables. Un nouveau test utilise de nouveaux relevés.')),
          selected ? h(Detail, Object.assign({}, props, { incident: selected, latest: state.latest })) : h('div', { className: 'ic-filter-empty' }, h('h2', null, 'Aucun dossier à afficher'), h('p', null, 'Choisissez une autre catégorie pour retrouver vos incidents.'), button('Afficher tous les incidents', function () { setFilter('all'); }))));
  }
  window.FGIncidentView = IncidentView;
}());
