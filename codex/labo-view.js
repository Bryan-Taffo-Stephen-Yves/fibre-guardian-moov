// Labo réseau de l'équipe Moov : une immersion dans les écrans des techniciens fibre.
// Salle de contrôle (ports PON, centrales, console), un quartier box par box, réflectomètre, réglages et problèmes du terrain.
// Les chiffres viennent de /api/noc/labo (réservé aux comptes de l'équipe, vérifié par le serveur) toutes les 2 secondes.
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R, useMemo: M} = React;
  const TABS = [['salle', 'Salle de contrôle'], ['quartier', 'Un quartier'], ['otdr', 'Réflectomètre'], ['reglages', 'Réglages'], ['terrain', 'Le terrain']];
  const STATUS = {
    online: ['En ligne', 'ok'], warn: ['Proche du seuil', 'warn'], weak: ['Signal trop faible', 'bad'], los: ['Plus de lumière', 'bad'],
    dying: ['Coupure de courant', 'warn'], olt: ['Centrale en panne', 'bad'], reboot: ['Redémarrage…', 'info']
  };
  const FLAW = {dirty: 'Connecteur sale', bend: 'Câble trop plié'};
  const num = (v, d = 1) => v === null || v === undefined ? '—' : Number(v).toLocaleString('fr-FR', {minimumFractionDigits: d, maximumFractionDigits: d});
  const int = v => Math.round(v || 0).toLocaleString('fr-FR');
  const km = v => v < 1 ? Math.round(v * 1000) + ' m' : num(v, 2) + ' km';
  const clock = t => new Date(t).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? 'depuis ' + s + ' s' : s < 3600 ? 'depuis ' + Math.round(s / 60) + ' min' : 'depuis ' + Math.round(s / 3600) + ' h'; };
  const gbps = mbps => mbps >= 1000 ? num(mbps / 1000, 2) + ' Gbit/s' : int(mbps) + ' Mbit/s';

  // Icônes dessinées (même trait que le menu de l'équipe).
  const ICONS = {
    pulse: 'M3 12h4l2-6 4 12 2-6h6', box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8', bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    play: 'M7 4v16l13-8z', reboot: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', close: 'M6 6l12 12M18 6 6 18', drop: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z',
    scissors: 'M6 6a3 3 0 1 0 0 .01M6 18a3 3 0 1 0 0 .01M8.5 7.5 20 18M8.5 16.5 20 6', plug: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
    server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01', gauge: 'M12 14l4-4M4 18a9 9 0 1 1 16 0', spark: 'M12 3a9 9 0 1 0 9 9M12 3v9l6 3',
    knot: 'M4 16c4 0 4-8 8-8s4 8 8 8M4 8c4 0 4 8 8 8', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3', wave: 'M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0'
  };
  const Icon = ({name, size = 18}) => h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false}, h('path', {d: ICONS[name]}));

  // Courbe simple (données réelles du port, 2 minutes).
  function Trend({values, height = 44, className = '', min, max}) {
    const v = values.map(x => x === null || x === undefined ? NaN : x), ok = v.filter(Number.isFinite);
    if (!ok.length) return h('svg', {className: 'lb-trend ' + className, viewBox: '0 0 120 ' + height, preserveAspectRatio: 'none', 'aria-hidden': true});
    const lo = min ?? Math.min(...ok), hi = max ?? Math.max(...ok), span = hi - lo || 1;
    const pts = v.map((y, i) => [i / (v.length - 1) * 120, Number.isFinite(y) ? height - 3 - (y - lo) / span * (height - 6) : height - 3]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return h('svg', {className: 'lb-trend ' + className, viewBox: '0 0 120 ' + height, preserveAspectRatio: 'none', 'aria-hidden': true},
      h('path', {d: line + ' L120 ' + height + ' L0 ' + height + ' Z', className: 'lb-trend-fill'}),
      h('path', {d: line, className: 'lb-trend-line', vectorEffect: 'non-scaling-stroke'}));
  }

  // Statut d'une box avec les seuils choisis dans Réglages (ils ne changent que cet écran).
  function statusOf(o, th, reboot) {
    if (reboot) return 'reboot';
    if (o.rx === null || !['online', 'warn', 'weak'].includes(o.status)) return o.status;
    return o.rx < th.alarm ? 'weak' : o.rx < th.warn ? 'warn' : 'online';
  }

  function Header({snap, tab, onTab, updated, error}) {
    const ports = snap?.ports || [], online = ports.reduce((n, p) => n + p.online, 0), total = ports.reduce((n, p) => n + p.total, 0);
    const faults = ports.filter(p => p.alarm !== 'NONE').length;
    return h('div', {className: 'lb-head'},
      h('div', {className: 'lb-head-row'},
        h('div', {className: 'lb-live' + (error ? ' is-stale' : ''), role: 'status'}, h('i', {'aria-hidden': true}), error ? 'Connexion perdue · nouvel essai' : 'En direct', h('b', null, snap ? clock(snap.at) : '--:--:--')),
        h('dl', {className: 'lb-head-facts'},
          h('div', null, h('dt', null, 'Centrales'), h('dd', null, snap?.olts.length ?? '—')),
          h('div', null, h('dt', null, 'Ports PON'), h('dd', null, ports.length || '—')),
          h('div', null, h('dt', null, 'Box en ligne'), h('dd', null, snap ? int(online) + ' / ' + int(total) : '—')),
          h('div', {className: faults ? 'is-bad' : ''}, h('dt', null, 'Ports en alarme'), h('dd', null, snap ? faults : '—')))),
      h('div', {className: 'lb-tabs', role: 'tablist', 'aria-label': 'Écrans du labo'},
        TABS.map(([key, label]) => h('button', {key, type: 'button', role: 'tab', id: 'lb-tab-' + key, 'aria-selected': tab === key, 'aria-controls': 'lb-panel', className: 'lb-tab' + (tab === key ? ' is-on' : ''), onClick: () => onTab(key)}, label))));
  }

  // ——— Salle de contrôle ———
  function Salle({snap, th, onOpen, rebooting}) {
    const ports = snap.ports, sum = k => ports.reduce((n, p) => n + (p[k] || 0), 0);
    const downSeries = ports[0].history.map((_, i) => ports.reduce((n, p) => n + (p.history[i].down || 0), 0));
    const onlineSeries = ports[0].history.map((_, i) => ports.reduce((n, p) => n + (p.history[i].online || 0), 0));
    const fecSeries = ports[0].history.map((_, i) => ports.reduce((n, p) => n + (p.history[i].fec || 0), 0));
    const live = ports.filter(p => p.rxAvg !== null), rx = live.length ? live.reduce((n, p) => n + p.rxAvg * p.online, 0) / Math.max(1, sum('online')) : null;
    return h('div', {className: 'lb-salle'},
      h('section', {className: 'lb-meters', 'aria-label': 'Le réseau en ce moment'},
        h(Meter, {label: 'Box en ligne', value: int(sum('online')), unit: '/ ' + int(sum('total')), series: onlineSeries, min: 0, max: sum('total'), tone: sum('online') < sum('total') ? 'bad' : 'ok', hint: 'Chaque box envoie un signe de vie toutes les 2 s.'}),
        h(Meter, {label: 'Lumière reçue en moyenne', value: num(rx, 1), unit: 'dBm', series: ports[0].history.map((_, i) => { const l = ports.filter(p => p.history[i].rx !== null); return l.length ? l.reduce((n, p) => n + p.history[i].rx, 0) / l.length : null; }), hint: 'Idéal entre −15 et −24 dBm. Sous ' + num(th.alarm, 0) + ', la box décroche.'}),
        h(Meter, {label: 'Erreurs corrigées', value: int(sum('fec')), unit: '/ s', series: fecSeries, tone: sum('fec') > 1500 ? 'warn' : 'ok', hint: 'Le réseau répare seul ces petites erreurs. Une hausse annonce une fibre qui faiblit.'}),
        h(Meter, {label: 'Trafic vers les clients', value: gbps(sum('downMbps')).split(' ')[0], unit: gbps(sum('downMbps')).split(' ')[1], series: downSeries, hint: 'Le soir, entre 20 h et 23 h, tout Abidjan regarde des vidéos.'})),
      h('div', {className: 'lb-salle-grid'},
        h('section', {className: 'lb-ports', 'aria-labelledby': 'lb-ports-title'},
          h('div', {className: 'lb-section-head'}, h('h2', {id: 'lb-ports-title'}, 'Ports PON'), h('p', null, 'Un port = une fibre qui part de la centrale et dessert un quartier de 20 box.')),
          h('div', {className: 'lb-port-grid'}, ports.map(p => h(PortCard, {key: p.id, port: p, th, onOpen, rebooting})))),
        h(Console, {lines: snap.console})),
      h(Olts, {olts: snap.olts}));
  }
  function Meter({label, value, unit, series, tone = 'ok', hint, min, max}) {
    return h('article', {className: 'lb-meter is-' + tone},
      h('span', {className: 'lb-meter-label'}, label),
      h('strong', null, value, h('small', null, ' ' + unit)),
      h(Trend, {values: series, height: 38, min, max}),
      h('p', null, hint));
  }
  function PortCard({port: p, th, onOpen, rebooting}) {
    const dots = p.dots.map((s, i) => statusOf({status: s, rx: p.rxs[i]}, th, rebooting[p.id + ':' + (i + 1)]));
    return h('button', {type: 'button', className: 'lb-port is-' + p.tone, onClick: () => onOpen(p.id), 'aria-label': p.zone + ', ' + p.online + ' box sur ' + p.total + ' en ligne' + (p.alarm !== 'NONE' ? ', alarme ' + p.alarmInfo.label : '')},
      h('div', {className: 'lb-port-top'}, h('strong', null, p.zone.split(' · ').pop()), h('span', {className: 'lb-mono'}, p.olt.replace('OLT ', '') + ' ' + p.pon)),
      h('div', {className: 'lb-dots', 'aria-hidden': true}, dots.map((s, i) => h('i', {key: i, className: 'is-' + STATUS[s][1]}))),
      h('div', {className: 'lb-port-figures'},
        h('span', null, h('b', null, p.online), '/' + p.total + ' box'),
        h('span', null, h('b', null, num(p.rxAvg, 1)), ' dBm'),
        h('span', null, h('b', null, gbps(p.downMbps)))),
      h(Trend, {values: p.history.map(x => x.down), height: 30, className: 'is-small'}),
      p.alarm !== 'NONE' ? h('p', {className: 'lb-port-alarm'}, h('span', {className: 'lb-code'}, p.alarmInfo.code), p.alarmInfo.label, p.since ? ' · ' + ago(p.since) : '') :
        p.flagged.length ? h('p', {className: 'lb-port-note'}, p.flagged.length + ' box à surveiller') : h('p', {className: 'lb-port-note is-calm'}, 'Rien à signaler'));
  }
  function Console({lines}) {
    return h('section', {className: 'lb-console', 'aria-labelledby': 'lb-console-title'},
      h('div', {className: 'lb-console-head'}, h('h2', {id: 'lb-console-title'}, 'Console d’alarmes'), h('span', null, h('i', {'aria-hidden': true}), lines.length + ' messages')),
      h('ol', {'aria-live': 'polite'}, lines.map((l, k) => h('li', {key: l.at + ':' + k, className: 'is-' + l.severity},
        h('time', null, clock(l.at)), h('span', {className: 'lb-sev'}, l.severity), h('span', {className: 'lb-code'}, l.code), h('span', {className: 'lb-eq'}, l.equipment), h('p', null, l.text)))));
  }
  function Olts({olts}) {
    return h('section', {className: 'lb-olts', 'aria-labelledby': 'lb-olts-title'},
      h('div', {className: 'lb-section-head'}, h('h2', {id: 'lb-olts-title'}, 'Centrales (OLT)'), h('p', null, 'L’armoire de la commune qui allume toutes les fibres. Sa carte GPON, ses ventilateurs et sa liaison vers internet.')),
      h('div', {className: 'lb-olt-row'}, olts.map(o => h('article', {key: o.name, className: 'lb-olt' + (o.board !== 'En service' ? ' is-bad' : o.uplink > 90 ? ' is-warn' : '')},
        h('div', {className: 'lb-olt-top'}, h(Icon, {name: 'server'}), h('strong', null, o.commune), h('span', null, o.board)),
        h('dl', null,
          h('div', null, h('dt', null, 'Processeur'), h('dd', null, o.cpu + ' %'), h(Bar, {value: o.cpu})),
          h('div', null, h('dt', null, 'Température'), h('dd', null, num(o.temperature, 1) + ' °C'), h(Bar, {value: o.temperature, max: 75})),
          h('div', null, h('dt', null, 'Liaison 10 Gbit/s'), h('dd', null, num(o.uplink, 1) + ' %'), h(Bar, {value: o.uplink})),
          h('div', null, h('dt', null, 'Ventilateurs'), h('dd', null, o.fans ? int(o.fans) + ' tr/min' : 'Arrêtés'))),
        h('small', null, o.ports.length + ' port' + (o.ports.length > 1 ? 's' : '') + ' · alimentation A + B' + (o.bootedAt ? ' · allumée ' + ago(o.bootedAt).replace('depuis ', 'depuis ') : ''))))));
  }
  const Bar = ({value, max = 100, plain}) => h('span', {className: 'lb-bar' + (plain ? '' : value / max > .9 ? ' is-bad' : value / max > .7 ? ' is-warn' : ''), 'aria-hidden': true}, h('i', {style: {width: Math.min(100, value / max * 100) + '%'}}));

  // ——— Un quartier ———
  function Picker({ports, selected, onPick, label = 'Choisir un quartier'}) {
    return h('div', {className: 'lb-picker', role: 'group', 'aria-label': label}, ports.map(p => h('button', {key: p.id, type: 'button', className: 'lb-chip is-' + p.tone + (selected === p.id ? ' is-on' : ''), 'aria-pressed': selected === p.id, onClick: () => onPick(p.id)}, h('i', {'aria-hidden': true}), p.zone.split(' · ').pop())));
  }
  function Quartier({snap, th, onPick, rebooting, onReboot}) {
    const p = snap.ports.find(x => x.id === snap.selected), [open, setOpen] = S(null), onts = p.onts || [];
    const rows = onts.map(o => ({...o, view: statusOf(o, th, rebooting[p.id + ':' + o.n])}));
    const current = rows.find(o => o.n === open);
    return h('div', {className: 'lb-quartier'},
      h(Picker, {ports: snap.ports, selected: p.id, onPick}),
      h('section', {className: 'lb-port-hero is-' + p.tone},
        h('div', null, h('h2', null, p.zone), h('p', {className: 'lb-mono'}, p.olt + ' · port ' + p.pon + ' · fibre de départ ' + km(p.feeder))),
        h('dl', null,
          h('div', null, h('dt', null, 'En ligne'), h('dd', null, p.online + ' / ' + p.total)),
          h('div', null, h('dt', null, 'Lumière moyenne'), h('dd', null, num(p.rxAvg, 2) + ' dBm')),
          h('div', null, h('dt', null, 'Charge du port'), h('dd', null, num(p.utilisation, 1) + ' %')),
          h('div', null, h('dt', null, 'Temps de réponse'), h('dd', null, num(p.latency, 0) + ' ms'))),
        p.alarm !== 'NONE' && h('p', {className: 'lb-port-alarm'}, h('span', {className: 'lb-code'}, p.alarmInfo.code), p.alarmInfo.label, p.since ? ' · ' + ago(p.since) : '')),
      h('div', {className: 'lb-q-grid'},
        h(Topology, {port: p, rows, onOpen: setOpen, open}),
        h(Budget, {budget: snap.budget, th})),
      h('section', {className: 'lb-charts'},
        h(Chart, {title: 'Lumière moyenne reçue', unit: 'dBm', values: p.history.map(x => x.rx), digits: 1}),
        h(Chart, {title: 'Trafic du port', unit: 'Mbit/s', values: p.history.map(x => x.down), digits: 0, min: 0}),
        h(Chart, {title: 'Erreurs corrigées', unit: '/ s', values: p.history.map(x => x.fec), digits: 0, min: 0})),
      h(OntTable, {rows, onOpen: setOpen, open}),
      current && h(OntDrawer, {port: p, o: current, onClose: () => setOpen(null), onReboot}));
  }
  // Schéma du quartier : centrale → armoire 1:4 → 4 poteaux 1:8 → 20 box.
  function Topology({port: p, rows, onOpen, open}) {
    // Sur téléphone, le schéma se resserre pour tenir dans l'écran.
    const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
    const L = narrow ? {W: 372, H: 300, olt: 8, cab: 92, pole: 150, box: 196, step: 40, r: 15} : {W: 640, H: 300, olt: 30, cab: 200, pole: 325, box: 400, step: 48, r: 13};
    const branchY = b => 40 + b * 70, dead = list => list.length && list.every(o => ['los', 'olt'].includes(o.view));
    return h('section', {className: 'lb-topo', 'aria-labelledby': 'lb-topo-title'},
      h('div', {className: 'lb-section-head'}, h('h2', {id: 'lb-topo-title'}, 'Le chemin de la lumière'), h('p', null, 'Une seule fibre part de la centrale, se divise en 4 à l’armoire de rue, puis en 8 sur chaque poteau.')),
      h('svg', {viewBox: '0 0 ' + L.W + ' ' + L.H, role: 'img', 'aria-label': 'Schéma du réseau de ' + p.zone},
        h('line', {x1: L.olt + 40, y1: 145, x2: L.cab, y2: 145, className: 'lb-fibre' + (dead(rows) ? ' is-dead' : '')}),
        [0, 1, 2, 3].map(b => { const mine = rows.filter(o => o.branch === b + 1); return h('g', {key: b},
          h('path', {d: 'M' + L.cab + ' 145 C ' + (L.cab + 40) + ' 145, ' + (L.cab + 30) + ' ' + branchY(b) + ', ' + (L.pole - 9) + ' ' + branchY(b), className: 'lb-fibre' + (dead(mine) ? ' is-dead' : '')}),
          h('rect', {x: L.pole - 9, y: branchY(b) - 9, width: 18, height: 18, rx: 5, className: 'lb-node'}),
          h('text', {x: L.pole, y: branchY(b) - 15, className: 'lb-svg-label', textAnchor: 'middle'}, 'Poteau ' + (b + 1)),
          mine.length > 0 && h('path', {d: 'M' + (L.pole + 9) + ' ' + branchY(b) + ' L' + (L.box + (mine.length - 1) * L.step) + ' ' + branchY(b), className: 'lb-drop'}),
          mine.map((o, k) => { const x = L.box + k * L.step, y = branchY(b); return h('g', {key: o.n, className: 'lb-ont is-' + STATUS[o.view][1] + (open === o.n ? ' is-open' : ''), onClick: () => onOpen(o.n), role: 'button', tabIndex: 0, 'aria-label': 'Box ' + o.n + ' : ' + STATUS[o.view][0], onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(o.n); } }},
            h('rect', {x: x - L.r, y: y - L.r, width: 2 * L.r, height: 2 * L.r, rx: 8}),
            h('text', {x, y: y + 4, textAnchor: 'middle'}, o.n)); })); }),
        h('rect', {x: L.olt, y: 125, width: 40, height: 40, rx: 10, className: 'lb-node is-olt'}),
        h('text', {x: L.olt + 20, y: 185, className: 'lb-svg-label', textAnchor: 'middle'}, 'Centrale'),
        h('circle', {cx: L.cab, cy: 145, r: 11, className: 'lb-node'}),
        h('text', {x: L.cab, y: 175, className: 'lb-svg-label', textAnchor: 'middle'}, 'Armoire'),
        h('text', {x: (L.olt + 40 + L.cab) / 2, y: narrow ? 130 : 136, className: 'lb-svg-label', textAnchor: 'middle'}, km(p.feeder))),
      h('ul', {className: 'lb-legend'}, [['ok', 'En ligne'], ['warn', 'À surveiller'], ['bad', 'Hors service'], ['info', 'Redémarrage']].map(([k, l]) => h('li', {key: k}, h('i', {className: 'is-' + k}), l))));
  }
  function Budget({budget, th}) {
    // Échelle : du départ de la centrale jusqu'au seuil où la box décroche.
    const top = budget.lines[0].value, span = top - th.sensitivity;
    let level = 0;
    return h('section', {className: 'lb-budget', 'aria-labelledby': 'lb-budget-title'},
      h('div', {className: 'lb-section-head'}, h('h2', {id: 'lb-budget-title'}, 'Budget de lumière · box ' + budget.ont), h('p', null, 'La box la plus éloignée du quartier. Chaque étape mange un peu de lumière.')),
      h('ol', null, budget.lines.map((l, k) => { const from = level; level += l.value; return h('li', {key: k, className: l.kind ? 'is-' + l.kind : ''},
        h('span', null, l.label), h('b', {className: 'lb-mono'}, (l.value > 0 ? '+' : '') + num(l.value, 2) + ' dB'),
        h('span', {className: 'lb-budget-bar', 'aria-hidden': true}, h('i', {style: {left: (top - Math.max(from, level)) / span * 100 + '%', width: Math.abs(l.value) / span * 100 + '%'}}))); })),
      h('div', {className: 'lb-budget-total'},
        h('div', null, h('span', null, 'Arrive chez le client'), h('strong', {className: 'lb-mono'}, num(budget.arrival, 2) + ' dBm')),
        h('div', {className: budget.margin < 3 ? 'is-bad' : budget.margin < 6 ? 'is-warn' : 'is-ok'}, h('span', null, 'Marge avant décrochage'), h('strong', {className: 'lb-mono'}, num(budget.margin, 1) + ' dB'))),
      h('p', {className: 'lb-small'}, 'Budget de la classe C+ : ' + budget.lines[0].value + ' dBm au départ, la box décroche sous ' + num(th.sensitivity, 0) + ' dBm.'));
  }
  function Chart({title, unit, values, digits, min}) {
    const ok = values.filter(v => v !== null), last = ok.at(-1), lo = Math.min(...ok), hi = Math.max(...ok);
    return h('article', {className: 'lb-chart'},
      h('div', {className: 'lb-chart-head'}, h('span', null, title), h('strong', {className: 'lb-mono'}, ok.length ? num(last, digits) : '—', h('small', null, ' ' + unit))),
      h(Trend, {values, height: 70, min: min ?? (ok.length ? lo - (hi - lo || 1) * .4 : 0), max: ok.length ? hi + (hi - lo || 1) * .4 : 1}),
      h('div', {className: 'lb-chart-axis'}, h('span', null, 'il y a 2 min'), h('span', null, 'maintenant')));
  }
  function OntTable({rows, onOpen, open}) {
    return h('section', {className: 'lb-onts', 'aria-labelledby': 'lb-onts-title'},
      h('div', {className: 'lb-section-head'}, h('h2', {id: 'lb-onts-title'}, 'Les 20 box du quartier'), h('p', null, 'Touchez une box pour voir toutes ses mesures.')),
      h('div', {className: 'lb-table-wrap'},
        h('table', {className: 'lb-table'},
          h('thead', null, h('tr', null, ['Box', 'N° de série', 'État', 'Lumière reçue', 'Reçue par la centrale', 'Distance', 'Température', 'Débit', 'Erreurs'].map(c => h('th', {key: c, scope: 'col'}, c)))),
          h('tbody', null, rows.map(o => h('tr', {key: o.n, className: 'is-' + STATUS[o.view][1] + (open === o.n ? ' is-open' : ''), onClick: () => onOpen(o.n)},
            h('th', {scope: 'row'}, h('button', {type: 'button', onClick: e => { e.stopPropagation(); onOpen(o.n); }}, 'Box ' + o.n)),
            h('td', {className: 'lb-mono'}, o.serial),
            h('td', null, h('span', {className: 'lb-pill is-' + STATUS[o.view][1]}, STATUS[o.view][0]), o.flaw && o.rx !== null ? h('small', null, FLAW[o.flaw]) : null),
            h('td', null, h(RxBar, {rx: o.view === 'reboot' ? null : o.rx})),
            h('td', {className: 'lb-mono'}, o.view === 'reboot' ? '—' : num(o.rxOlt, 1) + (o.rxOlt === null ? '' : ' dBm')),
            h('td', {className: 'lb-mono'}, km(o.km)),
            h('td', {className: 'lb-mono'}, o.temperature === null || o.view === 'reboot' ? '—' : num(o.temperature, 1) + ' °C'),
            h('td', {className: 'lb-mono'}, o.view === 'reboot' ? '—' : num(o.down, 1) + ' Mbit/s'),
            h('td', {className: 'lb-mono'}, o.view === 'reboot' ? '—' : int(o.fec) + '/s')))))));
  }
  // Lumière reçue sur l'échelle −8 (trop fort) … −30 dBm (plus rien).
  function RxBar({rx}) {
    if (rx === null || rx === undefined) return h('span', {className: 'lb-rx is-none'}, '—');
    const pos = Math.max(0, Math.min(100, (-8 - rx) / 22 * 100));
    return h('span', {className: 'lb-rx'}, h('span', {className: 'lb-rx-track', 'aria-hidden': true}, h('i', {style: {left: pos + '%'}})), h('b', {className: 'lb-mono'}, num(rx, 2) + ' dBm'));
  }
  const EXPLAIN = {
    online: 'La box reçoit assez de lumière et répond normalement.',
    warn: 'La lumière baisse : la box marche encore, mais un connecteur sale ou un câble plié la fera décrocher à la prochaine chaleur.',
    weak: 'Trop peu de lumière : la box décroche et raccroche. Il faut nettoyer le connecteur ou refaire la soudure.',
    los: 'Plus aucune lumière n’arrive. La fibre est coupée entre l’armoire et la box : le réflectomètre dira où.',
    dying: 'La box a envoyé son « dernier souffle » avant de s’éteindre : le courant est coupé chez le client ou dans le quartier.',
    olt: 'La box attend la centrale : c’est la carte GPON de la commune qui ne répond plus.',
    reboot: 'La box redémarre. Elle se reconnecte en une vingtaine de secondes.'
  };
  function OntDrawer({port: p, o, onClose, onReboot}) {
    const ref = R(null);
    E(() => { ref.current?.focus(); const k = e => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [o.n]);
    const live = o.view !== 'reboot' && o.rx !== null;
    const facts = [['Lumière reçue (1490 nm)', live ? num(o.rx, 2) + ' dBm' : '—'], ['Reçue par la centrale (1310 nm)', live ? num(o.rxOlt, 2) + ' dBm' : '—'], ['Lumière émise', live ? num(o.tx, 2) + ' dBm' : '—'],
      ['Distance mesurée', km(o.km)], ['Température du laser', live ? num(o.temperature, 1) + ' °C' : '—'], ['Tension', live ? num(o.voltage, 2) + ' V' : '—'], ['Courant du laser', live ? num(o.bias, 1) + ' mA' : '—'],
      ['Forfait', o.plan + ' Mbit/s'], ['Débit en ce moment', live ? num(o.down, 1) + ' ↓ · ' + num(o.up, 1) + ' ↑ Mbit/s' : '—'], ['Erreurs corrigées', live ? int(o.fec) + ' / s' : '—'], ['Erreurs non corrigées', live ? int(o.bip) + ' / s' : '—'], ['Poteau', 'n° ' + o.branch]];
    return h('div', {className: 'lb-drawer-wrap', onClick: e => { if (e.target === e.currentTarget) onClose(); }},
      h('aside', {className: 'lb-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lb-drawer-title', tabIndex: -1, ref},
        h('div', {className: 'lb-drawer-head'},
          h('div', null, h('h2', {id: 'lb-drawer-title'}, 'Box ' + o.n), h('p', {className: 'lb-mono'}, o.serial + ' · ' + p.pon + ':' + o.n)),
          h('button', {type: 'button', className: 'lb-icon-btn', onClick: onClose, 'aria-label': 'Fermer la fiche'}, h(Icon, {name: 'close'}))),
        h('p', {className: 'lb-explain is-' + STATUS[o.view][1]}, h('b', null, STATUS[o.view][0] + (o.flaw && live ? ' · ' + FLAW[o.flaw] : '')), EXPLAIN[o.view] + (o.flaw === 'dirty' && live ? ' Ici, la perte vient du connecteur chez le client : un nettoyage suffit souvent.' : o.flaw === 'bend' && live ? ' Ici, le câble est trop plié près de la box : la perte grandit à 1550 nm.' : '')),
        h(RxBar, {rx: live ? o.rx : null}),
        h('dl', {className: 'lb-facts'}, facts.map(([k, v]) => h('div', {key: k}, h('dt', null, k), h('dd', {className: 'lb-mono'}, v)))),
        h('div', {className: 'lb-drawer-actions'},
          h('button', {type: 'button', className: 'lb-btn is-primary', disabled: !['online', 'warn', 'weak'].includes(o.view), onClick: () => onReboot(p, o)}, h(Icon, {name: 'reboot'}), 'Redémarrer la box à distance'),
          h('small', null, 'Le client est coupé une vingtaine de secondes.'))));
  }

  // ——— Réflectomètre ———
  function Otdr({snap, api, onPick}) {
    const p = snap.ports.find(x => x.id === snap.selected), [nm, setNm] = S(1310), [trace, setTrace] = S(null), [phase, setPhase] = S('idle'), [error, setError] = S('');
    // Chaque mesure porte un numéro : une mesure lancée sur un autre quartier ou une autre longueur d'onde est ignorée.
    const runId = R(0);
    E(() => { runId.current++; setTrace(null); setPhase('idle'); }, [p.id]);
    async function run() {
      const id = ++runId.current;
      setPhase('run'); setError('');
      try {
        const [r] = await Promise.all([api('/noc/labo?segment=' + encodeURIComponent(p.id) + '&otdr=1&nm=' + nm), new Promise(ok => setTimeout(ok, 2600))]);
        if (id === runId.current) { setTrace(r.otdr); setPhase('done'); }
      } catch (e) { if (id === runId.current) { setError(e.message || 'La mesure n’a pas abouti.'); setPhase('idle'); } }
    }
    const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 600px)').matches;
    const W = narrow ? 400 : 760, H = narrow ? 280 : 300, pad = {l: 40, r: narrow ? 26 : 34, t: 16, b: 30};
    const x = v => pad.l + v / (trace?.end || 5) * (W - pad.l - pad.r), y = v => pad.t + Math.min(30, -v) / 30 * (H - pad.t - pad.b);
    const path = trace ? trace.points.map((pt, i) => (i ? 'L' : 'M') + x(pt[0]).toFixed(1) + ' ' + y(pt[1]).toFixed(1)).join(' ') : '';
    return h('div', {className: 'lb-otdr'},
      h(Picker, {ports: snap.ports, selected: p.id, onPick, label: 'Quartier à mesurer'}),
      h('section', {className: 'lb-otdr-screen', 'aria-labelledby': 'lb-otdr-title'},
        h('div', {className: 'lb-otdr-bar'},
          h('div', null, h('h2', {id: 'lb-otdr-title'}, 'Réflectomètre · ' + p.zone), h('p', null, 'On envoie un éclair de lumière dans la fibre et on écoute ce qui revient. Chaque défaut laisse une trace à sa distance exacte.')),
          h('div', {className: 'lb-otdr-tools'},
            h('div', {className: 'lb-seg', role: 'group', 'aria-label': 'Longueur d’onde'}, [1310, 1550].map(v => h('button', {key: v, type: 'button', 'aria-pressed': nm === v, className: nm === v ? 'is-on' : '', onClick: () => { runId.current++; setNm(v); setPhase('idle'); setTrace(null); }}, v + ' nm'))),
            h('button', {type: 'button', className: 'lb-btn is-primary', onClick: run, disabled: phase === 'run'}, h(Icon, {name: 'play'}), phase === 'run' ? 'Mesure en cours…' : trace ? 'Mesurer à nouveau' : 'Lancer la mesure'))),
        h('div', {className: 'lb-otdr-plot' + (phase === 'run' ? ' is-running' : '')},
          h('svg', {viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': trace ? 'Courbe du réflectomètre : ' + trace.verdict : 'Courbe du réflectomètre, aucune mesure'},
            [0, 5, 10, 15, 20, 25, 30].map(d => h('g', {key: d}, h('line', {x1: pad.l, x2: W - pad.r, y1: y(-d), y2: y(-d), className: 'lb-grid'}), h('text', {x: pad.l - 8, y: y(-d) + 4, textAnchor: 'end', className: 'lb-axis'}, '−' + d))),
            trace && Array.from({length: narrow ? 4 : 6}, (_, i) => trace.end * i / (narrow ? 3 : 5)).map(v => h('text', {key: v, x: x(v), y: H - 12, textAnchor: 'middle', className: 'lb-axis'}, km(v))),
            h('text', {x: 10, y: pad.t + 2, className: 'lb-axis', transform: 'rotate(-90 10 ' + (pad.t + 2) + ')', textAnchor: 'end'}, 'dB'),
            trace && phase === 'done' && trace.events.map((e, k) => h('g', {key: k, className: 'lb-ev is-' + e.kind}, h('line', {x1: x(e.km), x2: x(e.km), y1: pad.t, y2: H - pad.b}), h('circle', {cx: x(e.km), cy: pad.t + 6, r: 4}))),
            trace && h('path', {key: trace.nm + ':' + p.id, d: path, className: 'lb-otdr-line', pathLength: 1})),
          phase === 'run' && h('div', {className: 'lb-otdr-wait', role: 'status'}, h('i', {'aria-hidden': true}), 'Impulsions de 100 ns · moyenne en cours'),
          phase === 'idle' && !trace && h('div', {className: 'lb-otdr-wait is-idle'}, 'Choisissez la longueur d’onde, puis lancez la mesure.')),
        error && h('p', {className: 'lb-error', role: 'alert'}, error),
        trace && phase === 'done' && h('div', {className: 'lb-otdr-result'},
          h('div', {className: 'lb-verdict' + (trace.fault ? ' is-bad' : '')}, h(Icon, {name: trace.fault?.kind === 'water' ? 'drop' : trace.fault ? 'scissors' : 'wave', size: 22}), h('div', null, h('strong', null, trace.fault ? trace.fault.label + ' à ' + km(trace.fault.km) : 'Fibre intacte'), h('p', null, trace.verdict))),
          h('div', {className: 'lb-table-wrap'}, h('table', {className: 'lb-table lb-events'},
            h('thead', null, h('tr', null, ['Distance', 'Événement', 'Perte', 'Réflexion'].map(c => h('th', {key: c, scope: 'col'}, c)))),
            h('tbody', null, trace.events.map((e, k) => h('tr', {key: k, className: e.kind === 'break' || e.kind === 'water' ? 'is-bad' : e.kind === 'bend' ? 'is-warn' : ''},
              h('td', {className: 'lb-mono'}, km(e.km)), h('td', null, e.label), h('td', {className: 'lb-mono'}, e.loss === null ? 'fin' : num(e.loss, 2) + ' dB'), h('td', {className: 'lb-mono'}, e.reflect === null ? '—' : e.reflect + ' dB')))))),
          h('dl', {className: 'lb-otdr-facts'},
            h('div', null, h('dt', null, 'Perte totale mesurée'), h('dd', {className: 'lb-mono'}, num(trace.total, 2) + ' dB')),
            h('div', null, h('dt', null, 'Budget disponible'), h('dd', {className: 'lb-mono'}, trace.budget + ' dB')),
            h('div', null, h('dt', null, 'Impulsion · portée · moyenne'), h('dd', {className: 'lb-mono'}, trace.pulse + ' · ' + trace.range + ' · ' + trace.averaging)),
            h('div', null, h('dt', null, 'Branche mesurée'), h('dd', null, 'Poteau ' + trace.branch))))));
  }

  // ——— Réglages ———
  function Reglages({snap, th, setTh}) {
    const pr = snap.profiles, port = pr.port;
    return h('div', {className: 'lb-reglages'},
      h('section', {className: 'lb-card'},
        h('div', {className: 'lb-section-head'}, h('h2', null, 'Seuils d’alarme'), h('p', null, 'À partir de quelle lumière une box passe en orange, puis en rouge. Ces seuils s’appliquent à votre écran du labo.')),
        h(Slider, {label: 'À surveiller sous', value: th.warn, min: -27, max: -20, onChange: v => setTh({...th, warn: v, alarm: Math.min(th.alarm, v - .5)})}),
        h(Slider, {label: 'Alarme sous', value: th.alarm, min: -29, max: -22, onChange: v => setTh({...th, alarm: v, warn: Math.max(th.warn, v + .5)})}),
        h('p', {className: 'lb-small'}, 'Sensibilité des box : ' + th.sensitivity + ' dBm. En dessous, plus rien ne passe.'),
        h('button', {type: 'button', className: 'lb-btn', onClick: () => setTh({...th, warn: snap.thresholds.warn, alarm: snap.thresholds.alarm})}, 'Revenir aux valeurs Moov')),
      port && h('section', {className: 'lb-card'},
        h('div', {className: 'lb-section-head'}, h('h2', null, 'Port ' + port.pon + ' · ' + port.zone), h('p', null, port.olt)),
        h('dl', {className: 'lb-facts'}, [['Laser', port.laser], ['Couleurs de lumière', port.wavelengths], ['Partage', port.split], ['Box raccordées', port.onts]].map(([k, v]) => h('div', {key: k}, h('dt', null, k), h('dd', null, v))))),
      h('section', {className: 'lb-card'},
        h('div', {className: 'lb-section-head'}, h('h2', null, 'Profil de ligne'), h('p', null, 'Comment la centrale partage la fibre entre les 20 box.')),
        h('dl', {className: 'lb-facts'}, pr.line.map(([k, v]) => h('div', {key: k}, h('dt', null, k), h('dd', null, v))))),
      h('section', {className: 'lb-card lb-wide'},
        h('div', {className: 'lb-section-head'}, h('h2', null, 'Services sur la fibre'), h('p', null, 'Chaque service voyage dans son propre couloir (VLAN), avec sa priorité.')),
        h('div', {className: 'lb-table-wrap'}, h('table', {className: 'lb-table'},
          h('thead', null, h('tr', null, ['Couloir', 'Service', 'Priorité', 'Réglage'].map(c => h('th', {key: c, scope: 'col'}, c)))),
          h('tbody', null, pr.services.map(s => h('tr', {key: s.vlan}, h('td', {className: 'lb-mono'}, 'VLAN ' + s.vlan), h('td', null, s.name), h('td', null, h(Bar, {value: s.priority, max: 7, plain: true}), ' ' + s.priority + ' / 7'), h('td', null, s.profile))))))));
  }
  function Slider({label, value, min, max, onChange}) {
    const id = 'lb-s-' + label.replace(/\W/g, '');
    return h('div', {className: 'lb-slider'}, h('label', {htmlFor: id}, label, h('output', {className: 'lb-mono'}, num(value, 1) + ' dBm')),
      h('input', {id, type: 'range', min, max, step: .5, value, onChange: e => onChange(Number(e.target.value))}));
  }

  // ——— Le terrain : les vrais problèmes des techniciens ———
  const PROBLEMS = [
    {id: 'works', icon: 'scissors', title: 'Fibre coupée par un chantier', scenario: 'works', alarm: ['LOS_WORKS'], sees: 'Plusieurs box passent d’un coup en « plus de lumière » (LOS), toutes derrière le même poteau.', cause: 'Une pelleteuse ou une tranchée de voirie arrache le câble enterré.', fix: 'Le réflectomètre donne la distance de la coupure. L’équipe soude un nouveau morceau de fibre.', when: 'Fréquent pendant les travaux de routes.'},
    {id: 'theft', icon: 'lock', title: 'Câble volé ou boîtier ouvert', scenario: 'theft', alarm: ['INTRUSION'], sees: 'Coupure brutale, souvent la nuit, avec l’alarme d’ouverture du boîtier.', cause: 'Le câble est arraché pour le revendre, ou un boîtier est forcé.', fix: 'Remplacer le tronçon, refermer et sécuriser le boîtier, prévenir la sécurité.', when: 'Surtout la nuit, dans les zones peu éclairées.'},
    {id: 'flood', icon: 'drop', title: 'Eau dans le boîtier', scenario: 'flood', alarm: ['WATER'], sees: 'La lumière baisse de 8 à 11 dB sur tout un quartier, puis les box décrochent une à une.', cause: 'Les pluies remplissent la chambre de tirage et le boîtier d’épissure.', fix: 'Pomper, sécher, refaire les soudures et changer le joint du boîtier.', when: 'Pendant la saison des pluies, de mai à juillet.'},
    {id: 'power', icon: 'plug', title: 'Coupure de courant', scenario: 'power', alarm: ['DYING_GASP'], sees: 'Toutes les box envoient leur « dernier souffle » (dying gasp) au même moment. La fibre, elle, est intacte.', cause: 'Délestage ou panne électrique dans le quartier.', fix: 'Ne pas envoyer d’équipe fibre. Prévenir les clients et attendre le retour du courant.', when: 'Lors des délestages.'},
    {id: 'olt', icon: 'server', title: 'Carte de la centrale en panne', scenario: 'olt', alarm: ['OLT_DOWN', 'UPSTREAM'], sees: 'Tous les quartiers de la commune tombent ensemble. La centrale signale sa carte GPON hors service.', cause: 'Carte grillée, surchauffe de la salle ou coupure d’alimentation de l’armoire.', fix: 'Basculer sur la carte de secours ou la remplacer. Vérifier la climatisation.', when: 'Rare, mais touche des milliers de clients.'},
    {id: 'congestion', icon: 'gauge', title: 'Liaison saturée le soir', scenario: 'congestion', alarm: ['UPLINK_HIGH'], sees: 'Toutes les box sont en ligne, la lumière est bonne, mais le temps de réponse dépasse 100 ms.', cause: 'Trop de trafic pour la liaison qui relie la centrale à internet.', fix: 'Ouvrir de la capacité sur la liaison de collecte ou équilibrer les ports.', when: 'Entre 20 h et 23 h, les soirs de match.'},
    {id: 'dirty', icon: 'spark', title: 'Connecteur sale', flaw: 'dirty', sees: 'Une seule box perd 7 à 9 dB. Elle marche, puis décroche quand il fait chaud.', cause: 'Poussière ou trace de doigt sur l’embout de la fibre, chez le client.', fix: 'Nettoyer l’embout au stylo de nettoyage et vérifier au microscope. Cinq minutes.', when: 'La panne la plus courante chez le client.'},
    {id: 'bend', icon: 'knot', title: 'Câble trop plié', flaw: 'bend', sees: 'Une box perd 3 à 4 dB, et la perte grandit à 1550 nm sur le réflectomètre.', cause: 'Câble pincé sous une porte, agrafé trop serré ou enroulé trop court.', fix: 'Reprendre le passage du câble avec un rayon plus large.', when: 'Après un déménagement de meubles ou des travaux chez le client.'},
    {id: 'rogue', icon: 'wave', title: 'Box « bavarde »', sees: 'Toutes les box d’un port ont des erreurs en même temps, sans coupure de fibre.', cause: 'Une box défectueuse émet sa lumière en continu et brouille les autres.', fix: 'Éteindre les box une par une pour trouver la coupable, puis la remplacer.', when: 'Rare, mais redoutée : elle se cache bien.'}
  ];
  function Terrain({snap, api, onShow, onChanged, canSimulate}) {
    const [target, setTarget] = S(snap.selected), [busy, setBusy] = S(''), [error, setError] = S('');
    async function simulate(scenario, segment) {
      setBusy(scenario + segment); setError('');
      try { await api('/noc/action', 'POST', {type: 'simulate', segment, scenario}); await onChanged(); onShow(segment); }
      catch (e) { setError(e.message || 'Impossible de lancer ce cas.'); } finally { setBusy(''); }
    }
    return h('div', {className: 'lb-terrain'},
      h('div', {className: 'lb-terrain-bar'},
        h('p', null, 'Les pannes que les techniciens fibre rencontrent vraiment à Abidjan, et ce qu’elles laissent dans les chiffres.'),
        h('label', null, 'Reproduire à', h('select', {value: target, onChange: e => setTarget(e.target.value)}, snap.ports.map(p => h('option', {key: p.id, value: p.id}, p.zone))))),
      error && h('p', {className: 'lb-error', role: 'alert'}, error),
      h('div', {className: 'lb-problems'}, PROBLEMS.map(pb => {
        const live = pb.alarm ? snap.ports.filter(p => pb.alarm.includes(p.alarm)) : [], spots = pb.flaw ? snap.field.filter(f => f.flaw === pb.flaw) : [];
        return h('article', {key: pb.id, className: 'lb-problem' + (live.length ? ' is-live' : '')},
          h('div', {className: 'lb-problem-top'}, h('span', {className: 'lb-problem-icon'}, h(Icon, {name: pb.icon, size: 20})), h('h3', null, pb.title)),
          h('dl', null, h('div', null, h('dt', null, 'Ce que voit le technicien'), h('dd', null, pb.sees)), h('div', null, h('dt', null, 'La cause'), h('dd', null, pb.cause)), h('div', null, h('dt', null, 'Ce qu’il fait'), h('dd', null, pb.fix))),
          h('p', {className: 'lb-small'}, pb.when),
          live.length ? h('div', {className: 'lb-problem-live'}, h('span', {className: 'lb-pill is-bad'}, 'En cours · ' + live.map(p => p.zone.split(' · ').pop()).slice(0, 3).join(', ')),
            h('button', {type: 'button', className: 'lb-btn', onClick: () => onShow(live[0].id)}, 'Voir le quartier'),
            canSimulate && pb.scenario && h('button', {type: 'button', className: 'lb-btn', disabled: !!busy, onClick: () => simulate('normal', pb.scenario === 'olt' ? (live.find(p => p.alarm === 'OLT_DOWN') || live[0]).id : live[0].id)}, 'Réparer')) :
            spots.length ? h('div', {className: 'lb-problem-live'}, h('span', {className: 'lb-pill is-warn'}, 'Visible en ce moment · ' + spots.length + ' box'), h('button', {type: 'button', className: 'lb-btn', onClick: () => onShow(spots[0].segment)}, 'Box ' + spots[0].n + ' · ' + spots[0].zone.split(' · ').pop())) :
            pb.scenario && canSimulate ? h('div', {className: 'lb-problem-live'}, h('button', {type: 'button', className: 'lb-btn is-primary', disabled: !!busy, onClick: () => simulate(pb.scenario, target)}, h(Icon, {name: 'bolt'}), busy === pb.scenario + target ? 'Lancement…' : 'Reproduire')) : null);
      })));
  }

  function View({api, user, data, onChanged}) {
    const [tab, setTab] = S(() => { try { return sessionStorage.getItem('fg-labo-tab') || 'salle'; } catch (_) { return 'salle'; } });
    const [segment, setSegment] = S(null), [snap, setSnap] = S(null), [error, setError] = S(''), [th, setTh] = S(null), [rebooting, setRebooting] = S({}), [local, setLocal] = S([]);
    const flight = R(false), seg = R(null); seg.current = segment;
    async function load() {
      if (flight.current || document.hidden) return; flight.current = true;
      try { const r = await api('/noc/labo' + (seg.current ? '?segment=' + encodeURIComponent(seg.current) : '')); setSnap(r); setError(''); setTh(t => t || {warn: r.thresholds.warn, alarm: r.thresholds.alarm, sensitivity: r.thresholds.sensitivity}); if (!seg.current) setSegment(r.selected); }
      catch (e) { setError(e.message || 'Le labo ne répond pas.'); } finally { flight.current = false; }
    }
    E(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, []);
    E(() => { if (segment && snap && snap.selected !== segment) load(); }, [segment]);
    E(() => { try { sessionStorage.setItem('fg-labo-tab', tab); } catch (_) {} }, [tab]);
    E(() => { const t = setInterval(() => setRebooting(r => { const now = Date.now(), next = Object.fromEntries(Object.entries(r).filter(([, until]) => until > now)); return Object.keys(next).length === Object.keys(r).length ? r : next; }), 1000); return () => clearInterval(t); }, []);
    function reboot(p, o) {
      setRebooting(r => ({...r, [p.id + ':' + o.n]: Date.now() + 22000}));
      const at = Date.now();
      setLocal(l => [{at: at + 22000, severity: 'info', code: 'UP', equipment: p.olt + ' ' + p.pon + ':' + o.n, text: 'Box ' + o.n + ' reconnectée, lumière ' + num(o.rx, 2) + ' dBm.'}, {at, severity: 'info', code: 'RBT', equipment: p.olt + ' ' + p.pon + ':' + o.n, text: 'Redémarrage de la box ' + o.n + ' demandé par ' + (user?.name || 'l’équipe') + '.'}, ...l].slice(0, 12));
    }
    if (!snap) return h('div', {className: 'lb lb-loading', role: 'status'}, error ? h('p', {className: 'lb-error', role: 'alert'}, error) : h('p', null, 'Connexion aux centrales…'));
    const view = {...snap, selected: segment || snap.selected, console: [...local.filter(l => l.at <= snap.at), ...snap.console].sort((a, b) => b.at - a.at).slice(0, 40)};
    const pick = id => { setSegment(id); };
    const show = id => { setSegment(id); setTab('quartier'); };
    const ready = view.ports.find(p => p.id === view.selected)?.onts;
    return h('div', {className: 'lb'},
      h(Header, {snap, tab, onTab: setTab, error}),
      h('div', {id: 'lb-panel', role: 'tabpanel', 'aria-labelledby': 'lb-tab-' + tab, className: 'lb-panel'},
        tab === 'salle' && h(Salle, {snap: view, th, onOpen: show, rebooting}),
        tab === 'quartier' && (ready ? h(Quartier, {snap: view, th, onPick: pick, rebooting, onReboot: reboot}) : h('p', {className: 'lb-small', role: 'status'}, 'Lecture des box du quartier…')),
        tab === 'otdr' && h(Otdr, {snap: view, api, onPick: pick}),
        tab === 'reglages' && h(Reglages, {snap: view, th, setTh}),
        tab === 'terrain' && h(Terrain, {snap: view, api, onShow: show, onChanged: async () => { await onChanged?.(); await load(); }, canSimulate: !data?.settings?.paused})));
  }

  root.FGLabo = {View, statusOf, PROBLEMS};
})(typeof window !== 'undefined' ? window : globalThis);
