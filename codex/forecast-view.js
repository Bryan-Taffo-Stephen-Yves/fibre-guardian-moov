// « Guardian voit venir la panne » : la lumière qui arrive à la box baisse un peu chaque jour.
// La carte montre la courbe, le jour où internet risque de se couper, et propose un passage du technicien avant.
// Les chiffres viennent du serveur (forecast.cjs) ; ici on ne fait que les dessiner.
(function (root) {
  'use strict';
  const h = (...a) => root.React.createElement(...a);
  const DAY = 86400000, TZ = {timeZone: 'Africa/Abidjan'};
  const hour = at => new Date(at).toLocaleTimeString('fr-FR', {...TZ, hour: 'numeric'}).replace(/\D+$/, '') + ' h';
  const longDay = at => new Date(at).toLocaleDateString('fr-FR', {...TZ, weekday: 'long', day: 'numeric', month: 'long'}) + ' à ' + hour(at);
  const shortDay = at => new Date(at).toLocaleDateString('fr-FR', {...TZ, weekday: 'short', day: 'numeric'});
  const dbm = v => String(v).replace('.', ',').replace('-', '−');
  const first = name => (name || 'Le technicien').split(' ')[0];

  // Courbe des 10 derniers jours, prolongée en pointillés jusqu'à la coupure estimée.
  function Chart({optical, prevention}) {
    const W = 560, H = 230, L = 8, R = 8, T = 22, B = 30, top = -17.5, bottom = -28.6;
    const pts = optical.points, start = pts[0].at, last = pts.at(-1);
    const end = Math.max(optical.cutAt || 0, prevention?.slot || 0, last.at + DAY) + DAY * .6;
    const x = at => L + (at - start) / (end - start) * (W - L - R), y = v => T + (top - v) / (top - bottom) * (H - T - B);
    const line = pts.map((p, k) => (k ? 'L' : 'M') + x(p.at).toFixed(1) + ' ' + y(p.dbm).toFixed(1)).join('');
    const area = line + 'L' + x(last.at).toFixed(1) + ' ' + (H - B) + 'L' + x(start).toFixed(1) + ' ' + (H - B) + 'Z';
    const cutX = optical.cutAt ? x(optical.cutAt) : null, visitX = prevention ? x(prevention.slot) : null;
    const label = 'Lumière reçue par votre box : ' + dbm(optical.current) + ' dBm aujourd’hui, baisse de ' + dbm(Math.abs(optical.slope)) + ' dB par jour. Coupure vers ' + dbm(optical.threshold) + ' dBm' + (optical.cutAt ? ', prévue le ' + shortDay(optical.cutAt) : '') + '.';
    return h('svg', {className: 'fc-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': label},
      h('defs', null, h('linearGradient', {id: 'fc-fill', x1: 0, y1: 0, x2: 0, y2: 1}, h('stop', {offset: 0, className: 'fc-stop-top'}), h('stop', {offset: 1, className: 'fc-stop-bottom'}))),
      h('rect', {x: L, y: y(optical.warn), width: W - L - R, height: y(optical.threshold) - y(optical.warn), className: 'fc-zone-warn'}),
      h('rect', {x: L, y: y(optical.threshold), width: W - L - R, height: H - B - y(optical.threshold), className: 'fc-zone-cut'}),
      h('line', {x1: L, x2: W - R, y1: y(optical.threshold), y2: y(optical.threshold), className: 'fc-cut-line'}),
      h('text', {x: L + 6, y: y(optical.threshold) + 15, className: 'fc-cut-label'}, 'Internet coupé en dessous'),
      h('path', {d: area, className: 'fc-area', fill: 'url(#fc-fill)'}),
      h('path', {d: line, className: 'fc-line'}),
      cutX !== null && h('path', {d: 'M' + x(last.at).toFixed(1) + ' ' + y(last.dbm).toFixed(1) + 'L' + cutX.toFixed(1) + ' ' + y(optical.threshold).toFixed(1), className: 'fc-projection' + (prevention ? ' is-avoided' : '')}),
      visitX !== null && h('g', {className: 'fc-visit'}, h('line', {x1: visitX, x2: visitX, y1: T, y2: H - B}), h('text', {x: visitX > W - 110 ? visitX - 8 : visitX, y: T - 6, textAnchor: visitX > W - 110 ? 'end' : 'middle'}, 'Passage de ' + first(prevention.technician?.name))),
      cutX !== null && h('g', {className: 'fc-cut' + (prevention ? ' is-avoided' : '')}, h('circle', {cx: cutX, cy: y(optical.threshold), r: 6}), h('text', {x: Math.min(cutX, W - R), y: y(optical.threshold) + 24, textAnchor: cutX > W - 130 ? 'end' : 'middle'}, prevention ? 'Coupure évitée' : 'Coupure · ' + shortDay(optical.cutAt))),
      h('circle', {cx: x(last.at), cy: y(last.dbm), r: 6, className: 'fc-now'}),
      h('g', {className: 'fc-axis', 'aria-hidden': true},
        h('text', {x: L, y: H - 9}, shortDay(start)),
        h('text', {x: x(last.at), y: H - 9, textAnchor: 'middle'}, 'Aujourd’hui'),
        null));
  }

  function Card({optical, prevention, busy, onBook}) {
    const [choice, setChoice] = root.React.useState(null), [more, setMore] = root.React.useState(false);
    if (!optical || optical.state !== 'fading') return null;
    const tech = prevention?.technician || optical.technician, name = first(tech?.name);
    const days = Math.max(1, Math.round(optical.daysLeft || 1));
    const slot = optical.slots.find(s => s.id === choice) || optical.slots[0];
    const facts = h('p', {className: 'fc-facts'}, h('span', null, 'Lumière reçue ', h('b', null, dbm(optical.current) + ' dBm')), h('span', null, 'Baisse ', h('b', null, dbm(Math.abs(optical.slope)) + ' dB/jour')), h('span', null, 'Coupure vers ', h('b', null, dbm(optical.threshold) + ' dBm')));
    const person = h('div', {className: 'fc-person'}, h('span', {className: 'fc-avatar', 'aria-hidden': true}, name[0]), h('span', null, h('strong', null, tech?.name || 'Technicien Moov'), h('small', null, tech?.team || 'Équipe fibre')));
    if (prevention) return h('section', {className: 'j-card fc-card is-booked', 'aria-labelledby': 'fc-title'},
      h('div', {className: 'fc-text'},
        h('small', {className: 'fc-eyebrow'}, 'Panne évitée'),
        h('h2', {id: 'fc-title'}, 'C’est noté : ' + name + ' passe ' + longDay(prevention.slot)),
        h('p', null, 'Il nettoiera la prise de fibre de votre box. Votre internet ne sera pas coupé, et vous n’avez rien à préparer.'),
        person),
      h('div', {className: 'fc-graph'}, h(Chart, {optical, prevention}), facts));
    return h('section', {className: 'j-card fc-card', 'aria-labelledby': 'fc-title'},
      h('div', {className: 'fc-text'},
        h('small', {className: 'fc-eyebrow'}, 'Guardian a vu venir une panne'),
        h('h2', {id: 'fc-title'}, 'Votre internet risque de se couper d’ici ' + days + ' jour' + (days > 1 ? 's' : '')),
        h('p', null, 'Tout marche encore. Mais la lumière qui arrive par la fibre baisse chaque jour. C’est souvent une prise encrassée, vite nettoyée par un technicien.'),
        h('div', {className: 'fc-offer'},
          person,
          h('p', {className: 'fc-slot'}, name + ' peut passer ', h('strong', null, longDay(slot.at))),
          more && optical.slots.length > 1 && h('div', {className: 'fc-slots', role: 'radiogroup', 'aria-label': 'Choisir un autre moment'}, optical.slots.map(s => h('button', {key: s.id, type: 'button', role: 'radio', 'aria-checked': s.id === slot.id, className: 'fc-chip' + (s.id === slot.id ? ' is-on' : ''), onClick: () => setChoice(s.id)}, shortDay(s.at) + ' · ' + hour(s.at)))),
          h('div', {className: 'fc-actions'},
            h('button', {type: 'button', className: 'j-button primary', disabled: busy, onClick: () => onBook && onBook(slot.id)}, 'Ça me va'),
            optical.slots.length > 1 && !more && h('button', {type: 'button', className: 'j-button', disabled: busy, onClick: () => setMore(true)}, 'Un autre moment')))),
      h('div', {className: 'fc-graph'}, h(Chart, {optical}), facts));
  }

  root.FGForecast = {Card, Chart};
})(typeof window !== 'undefined' ? window : globalThis);
