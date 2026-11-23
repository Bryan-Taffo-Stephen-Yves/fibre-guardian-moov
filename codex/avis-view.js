// Fibre Voice, centre des avis (thème 8) : bloc « Avis des clients » du Superviseur.
// Note moyenne, clients à rappeler sous 24 h, sujets qui reviennent dans les commentaires,
// et le suivi semaine après semaine : la note par quartier et par technicien sur 8 semaines.
// Les droits sont vérifiés par le serveur (avis.cjs) ; cet écran affiche et envoie le résultat de l'appel.
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const comma = n => String(n).replace('.', ',');
  const hour = at => new Date(at).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}).replace(':', ' h ');
  const left = (due, now) => {
    const m = Math.round((due - now) / 60000);
    if (m < 0) return 'En retard de ' + (m > -60 ? -m + ' min' : Math.round(-m / 60) + ' h');
    return 'Avant ' + (new Date(due).toDateString() === new Date(now).toDateString() ? '' : 'demain ') + hour(due) + (m < 120 ? ' · ' + m + ' min' : '');
  };
  const Stars = ({n}) => h('span', {className: 'av-stars', 'aria-label': n + ' sur 5'}, '★'.repeat(n), h('i', null, '★'.repeat(5 - n)));
  const OUT = [['regle', 'Réglé au téléphone'], ['intervention', 'Nouvelle intervention'], ['absent', 'Pas de réponse']];
  const day = t => new Date(t).toLocaleDateString('fr-FR', {timeZone: 'UTC', day: 'numeric', month: 'short'});
  const weekName = (i, n) => i === n - 1 ? 'cette semaine' : i === n - 2 ? 'la semaine dernière' : 'il y a ' + (n - 1 - i) + ' semaines';
  // « Yopougon · Niangon » : le quartier en gras, la commune en petit.
  const place = (name, tab) => { const [c, a] = tab === 'zones' ? name.split(' · ') : [null, name]; return a ? [a, c] : [c || name, null]; };

  // Petite courbe des notes moyennes, une valeur par semaine (les semaines sans avis laissent un trou).
  function Spark({weeks, w = 84, hgt = 28, big = false}) {
    const pts = weeks.map((x, i) => x.average == null ? null : [Math.round(4 + i * (w - 8) / (weeks.length - 1)), Math.round(hgt - 4 - (Math.max(2.5, x.average) - 2.5) / 2.5 * (hgt - 8))]);
    const parts = []; let cur = [];
    pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { parts.push(cur); cur = []; } });
    if (cur.length) parts.push(cur);
    const last = pts.map((p, i) => p && {p, i}).filter(Boolean).pop();
    return h('svg', {className: 'av-spark' + (big ? ' is-big' : ''), viewBox: '0 0 ' + w + ' ' + hgt, width: w, height: hgt, 'aria-hidden': true},
      big && h('line', {x1: 0, x2: w, y1: Math.round(hgt - 4 - 1 / 2.5 * (hgt - 8)), y2: Math.round(hgt - 4 - 1 / 2.5 * (hgt - 8)), className: 'av-spark-ref'}),
      parts.map((pp, k) => pp.length > 1 ? h('polyline', {key: k, points: pp.map(p => p.join(',')).join(' ')}) : null),
      pts.map((p, i) => p && h('circle', {key: i, cx: p[0], cy: p[1], r: last && last.i === i ? (big ? 4 : 3) : (big ? 2.5 : 1.6), className: last && last.i === i ? 'is-last' : ''})));
  }

  function Trend({delta}) {
    if (delta == null) return null;
    if (Math.abs(delta) < 0.1) return h('span', {className: 'av-delta is-flat'}, '= stable');
    return h('span', {className: 'av-delta ' + (delta > 0 ? 'is-up' : 'is-down'), 'aria-label': (delta > 0 ? 'en hausse de ' : 'en baisse de ') + comma(Math.abs(delta))}, (delta > 0 ? '▲ +' : '▼ −') + comma(Math.abs(delta).toFixed(1)));
  }

  // Suivi semaine après semaine : la courbe de toute l'équipe, puis les quartiers ou les techniciens,
  // ceux « À surveiller » en premier (note sous 3,5, ou en baisse d'un demi-point ou plus et à 4 ou moins).
  function Suivi({s}) {
    const [tab, T] = S('zones'), list = s[tab], n = s.weeks.length;
    const overall = s.overall.filter(x => x.count), lastAll = overall[overall.length - 1];
    const watch = k => s[k].filter(r => r.watch).length;
    return h('div', {className: 'av-suivi'},
      h('div', {className: 'av-sub'}, h('h4', null, 'Satisfaction semaine après semaine'), h('small', null, n + ' semaines · pointillés : 3,5')),
      lastAll && h('div', {className: 'av-curve'},
        h('div', {className: 'av-curve-now'}, h('b', null, comma(lastAll.average.toFixed(1)), h('small', null, '/5')), h('span', null, 'Note de l’équipe ' + weekName(s.overall.lastIndexOf(lastAll), n))),
        h('div', {className: 'av-curve-chart'}, h(Spark, {weeks: s.overall, w: 220, hgt: 64, big: true}),
          h('div', {className: 'av-curve-axis'}, h('span', null, 'sem. du ' + day(s.weeks[0])), h('span', null, 'cette semaine')))),
      h('div', {className: 'av-tabs', role: 'tablist', 'aria-label': 'Suivre par'},
        [['zones', 'Quartiers'], ['techs', 'Techniciens']].map(([k, label]) => h('button', {key: k, type: 'button', role: 'tab', 'aria-selected': tab === k, className: 'av-tab' + (tab === k ? ' is-on' : ''), onClick: () => T(k)},
          label, watch(k) > 0 && h('em', {'aria-label': watch(k) + ' à surveiller'}, watch(k))))),
      !list.length ? h('p', {className: 'gs-empty', role: 'tabpanel'}, tab === 'zones' ? 'Les avis reçus ne disent pas encore de quel quartier ils viennent.' : 'Les avis reçus ne nomment pas encore de technicien.') :
      h('ul', {className: 'av-trend', role: 'tabpanel'}, list.map(r => h('li', {key: r.name, className: r.watch ? 'is-watch' : ''},
        h('div', {className: 'av-trend-name'}, h('b', null, place(r.name, tab)[0], place(r.name, tab)[1] && h('span', null, place(r.name, tab)[1])),
          h('small', null, (r.watch ? h('span', {className: 'av-watch'}, 'À surveiller') : null), r.weeks[r.week].count + ' avis ' + weekName(r.week, n))),
        h(Spark, {weeks: r.weeks}),
        h('div', {className: 'av-trend-note'}, h('b', null, comma(r.average.toFixed(1)), ' ★'), h(Trend, {delta: r.delta}))))));
  }

  function Callback({c, now, busy, onDone}) {
    const [open, O] = S(false);
    return h('li', {className: 'av-call' + (c.late ? ' is-late' : '')},
      h('div', {className: 'av-call-head'},
        h('div', null, h('b', null, c.name), h('small', null, c.what + (c.tech ? ' · ' + c.tech : ''))),
        h(Stars, {n: c.rating})),
      c.comment && h('p', {className: 'av-quote'}, '« ' + c.comment + ' »'),
      h('p', {className: 'av-due'}, left(c.due, now) + (c.tries ? ' · ' + c.tries + ' essai' + (c.tries > 1 ? 's' : '') + ' sans réponse' : '')),
      open ? h('div', {className: 'av-outcomes', role: 'group', 'aria-label': 'Résultat de l’appel'},
        OUT.map(([k, label]) => h('button', {key: k, type: 'button', className: 'av-btn' + (k === 'regle' ? ' is-main' : ''), disabled: busy, onClick: () => onDone(c.id, k)}, label)),
        h('button', {type: 'button', className: 'av-link', onClick: () => O(false)}, 'Annuler'))
        : h('button', {type: 'button', className: 'av-btn is-main', onClick: () => O(true)}, 'J’ai appelé ce client'));
  }

  function Block({api}) {
    const [d, D] = S(null), [busy, B] = S(false), [error, X] = S(''), alive = R(true);
    const load = () => { if (!document.hidden) api('/noc/avis').then(x => alive.current && D(x)).catch(() => {}); };
    E(() => { alive.current = true; load(); const t = setInterval(load, 10000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    const now = Date.now(), top = Math.max(1, ...d.stars.map(s => s.count)), topic = Math.max(1, ...d.topics.map(t => t.count));
    async function onDone(id, outcome) {
      B(true); X('');
      try { D(await api('/noc/avis', 'POST', {id, outcome})); } catch (e) { X(e.message); } finally { B(false); }
    }
    return h('section', {className: 'gs-block av-block', 'aria-labelledby': 'av-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'av-title'}, 'Avis des clients'), h('span', {className: 'gs-count' + (d.open.some(c => c.late) ? ' av-alarm' : '')}, d.open.length)),
      !d.count ? h('p', {className: 'gs-empty'}, 'Aucun avis pour l’instant. Après chaque intervention et chaque installation, le client peut noter de 1 à 5.') : h(React.Fragment, null,
        h('div', {className: 'av-kpis'},
          h('div', null, h('b', null, comma(d.average), h('small', null, '/5')), h('span', null, 'Note moyenne')),
          h('div', null, h('b', null, d.satisfied, h('small', null, '%')), h('span', null, 'Clients satisfaits')),
          h('div', null, h('b', null, d.count), h('span', null, 'Avis sur 30 jours'))),
        h('ul', {className: 'av-dist', 'aria-label': 'Répartition des notes'}, d.stars.map(s => h('li', {key: s.stars}, h('span', null, s.stars + ' ★'), h('i', {'aria-hidden': true}, h('b', {className: 'is-' + s.stars, style: {width: (s.count ? Math.max(6, Math.round(s.count / top * 100)) : 0) + '%'}})), h('em', null, s.count))))),
      error && h('p', {className: 'fw-error', role: 'alert'}, error),
      h('div', {className: 'av-sub'}, h('h4', null, 'À rappeler sous 24 h'), h('small', null, 'Chaque note de 1 ou 2 sur 5')),
      d.open.length ? h('ul', {className: 'av-calls'}, d.open.map(c => h(Callback, {key: c.id, c, now, busy, onDone})))
        : h('p', {className: 'gs-empty'}, d.count ? 'Personne à rappeler : tous les clients mécontents ont eu leur appel.' : 'Personne à rappeler.'),
      d.done.length > 0 && h('ul', {className: 'av-done'}, d.done.map(c => h('li', {key: c.id}, h('b', null, c.name), ' · ' + c.outcome + ' · ' + hour(c.doneAt)))),
      d.topics.length > 0 && h(React.Fragment, null,
        h('div', {className: 'av-sub'}, h('h4', null, 'Ce qui revient dans les commentaires'), h('small', null, 'Pour orienter les améliorations')),
        h('ul', {className: 'av-topics'}, d.topics.map(t => h('li', {key: t.key, className: t.bad > t.good ? 'is-bad' : t.good > t.bad ? 'is-good' : 'is-mixed'},
          h('span', null, t.label), h('i', {'aria-hidden': true}, h('b', {style: {width: Math.max(8, Math.round(t.count / topic * 100)) + '%'}})),
          h('em', null, t.count), h('small', null, t.bad > t.good ? 'surtout des reproches' : t.good > t.bad ? 'surtout des compliments' : 'avis partagés'))))),
      d.suivi && d.suivi.overall.some(x => x.count) && h(Suivi, {s: d.suivi}));
  }

  root.FGAvis = {Block};
})(typeof window !== 'undefined' ? window : globalThis);
