// « Le jury met ses vrais chiffres » : l'écran Impact de l'équipe Moov.
// Le manager règle ses propres chiffres (abonnés, appels, déplacements, clients perdus) et voit en direct
// ce que Guardian rapporte à Moov chaque année, en francs CFA. Les parts évitées sont des estimations, dites comme telles.
(function (root) {
  'use strict';
  // Chiffres de Moov : le manager les remplace par les siens.
  const FIELDS = [
    {key: 'subscribers', label: 'Abonnés fibre', min: 5000, max: 500000, step: 1, unit: 'abonnés', source: 'Internet fixe Moov : ARTCI, 1er trimestre 2026'},
    {key: 'calls', label: 'Appels au service client par mois', hint: 'pour la fibre', min: 0, max: 60000, step: 500, unit: 'appels', source: 'Chiffre interne de Moov : mettez le vôtre'},
    {key: 'visits', label: 'Déplacements de technicien par mois', min: 0, max: 15000, step: 100, unit: 'déplacements', source: 'Chiffre interne de Moov : mettez le vôtre'},
    {key: 'visitCost', label: 'Prix d’un déplacement', min: 0, max: 60000, step: 500, unit: 'FCFA', source: 'Coût moyen constaté d’une intervention'},
    {key: 'lost', label: 'Clients perdus après une panne, par an', min: 0, max: 30000, step: 100, unit: 'clients', source: 'Chiffre interne de Moov : mettez le vôtre'},
    {key: 'arpu', label: 'Abonnement moyen par mois', min: 5000, max: 100000, step: 1000, unit: 'FCFA', source: 'Fibre 100 Mb/s : grille publique Moov'}
  ];
  // Ce que Guardian évite. Une seule part a été mesurée ailleurs (les appels) ; les deux autres se mesurent pendant l'essai.
  const RATES = [
    {key: 'callCost', label: 'Coût d’un appel traité', min: 0, max: 10000, step: 100, unit: 'FCFA', source: 'Chiffre interne de Moov : mettez le vôtre'},
    {key: 'callRate', label: 'Appels évités', min: 0, max: .8, step: .01, percent: true, why: 'Le client est prévenu avant d’appeler : panne de quartier, coupure de courant, redémarrage à distance.', source: 'Mesuré : −18 % d’appels pendant les pannes quand les clients sont prévenus (KUBRA)'},
    {key: 'visitRate', label: 'Déplacements évités', min: 0, max: .8, step: .01, percent: true, why: 'Diagnostic à distance, et un seul passage préventif au lieu d’une panne puis d’une réparation.', source: 'À mesurer pendant l’essai dans un quartier'},
    {key: 'keepRate', label: 'Clients gardés après une panne', min: 0, max: .6, step: .01, percent: true, why: 'Un client prévenu et suivi en direct part moins souvent après une panne.', source: 'À mesurer pendant l’essai dans un quartier'}
  ];
  const DEFAULTS = {subscribers: 66723, calls: 12000, visits: 2500, visitCost: 10000, lost: 6000, arpu: 20000, callCost: 1500, callRate: .18, visitRate: .4, keepRate: .15};

  // Gains sur 12 mois. Les clients gardés comptent pour une année d'abonnement.
  function compute(input) {
    const v = {...DEFAULTS};
    for (const k of Object.keys(DEFAULTS)) { const n = Number(input?.[k]); if (Number.isFinite(n)) v[k] = Math.max(0, n); }
    for (const k of ['callRate', 'visitRate', 'keepRate']) v[k] = Math.min(1, v[k]);
    const calls = 12 * v.calls * v.callRate * v.callCost, visits = 12 * v.visits * v.visitRate * v.visitCost;
    const kept = Math.round(v.lost * v.keepRate), revenue = kept * v.arpu * 12, total = calls + visits + revenue;
    return {calls, visits, revenue, total, kept, callsAvoided: Math.round(12 * v.calls * v.callRate), visitsAvoided: Math.round(12 * v.visits * v.visitRate), perSubscriber: v.subscribers ? total / v.subscribers : 0};
  }
  // 1 234 567 890 → « 1,23 milliard » ; 525 600 000 → « 526 millions ».
  function money(n) {
    const a = Math.abs(n);
    if (a >= 1e9) return {value: (n / 1e9).toLocaleString('fr-FR', {maximumFractionDigits: 2}), unit: 'milliard' + (a >= 2e9 ? 's' : '') + ' FCFA'};
    if (a >= 1e6) return {value: Math.round(n / 1e6).toLocaleString('fr-FR'), unit: 'million' + (a >= 2e6 ? 's' : '') + ' FCFA'};
    return {value: Math.round(n).toLocaleString('fr-FR'), unit: 'FCFA'};
  }
  const text = n => { const m = money(n); return m.value + ' ' + m.unit; };
  const count = n => Math.round(n).toLocaleString('fr-FR');

  if (typeof module !== 'undefined' && module.exports) module.exports = {compute, money, DEFAULTS, FIELDS, RATES};
  if (!root.React) return;
  const h = root.React.createElement, {useState, useEffect, useRef} = root.React;

  // Le total « roule » jusqu'à sa nouvelle valeur quand un curseur bouge.
  function useTween(target) {
    const [shown, setShown] = useState(target), from = useRef(target);
    useEffect(() => {
      if (root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { from.current = target; setShown(target); return; }
      const start = performance.now(), a = from.current; let frame;
      const step = t => { const k = Math.min(1, (t - start) / 450), e = 1 - Math.pow(1 - k, 3), v = a + (target - a) * e; from.current = v; setShown(v); if (k < 1) frame = requestAnimationFrame(step); };
      frame = requestAnimationFrame(step); return () => cancelAnimationFrame(frame);
    }, [target]);
    return shown;
  }

  function Slider({field, value, onChange}) {
    const id = 'im-' + field.key, shown = field.percent ? Math.round(value * 100) + ' %' : count(value) + ' ' + field.unit;
    const fill = (value - field.min) / (field.max - field.min) * 100;
    return h('div', {className: 'im-field'},
      h('label', {htmlFor: id}, h('span', null, field.label, field.hint && h('small', null, ' ' + field.hint)), h('output', {htmlFor: id}, shown)),
      h('input', {id, type: 'range', min: field.min, max: field.max, step: field.step, value, style: {'--im-fill': Math.max(0, Math.min(100, fill)) + '%'}, onChange: e => onChange(field.key, Number(e.target.value)), 'aria-valuetext': shown}),
      field.why && h('p', {className: 'im-why'}, field.why),
      field.source && h('p', {className: 'im-source'}, field.source));
  }

  function View({data}) {
    const [values, setValues] = useState({...DEFAULTS}), [open, setOpen] = useState(false);
    const r = compute(values), total = useTween(r.total), big = money(total);
    const change = (k, v) => setValues(old => ({...old, [k]: v}));
    const touched = Object.keys(DEFAULTS).some(k => values[k] !== DEFAULTS[k]);
    const parts = [
      {key: 'calls', label: 'Appels évités', value: r.calls, detail: count(r.callsAvoided) + ' appels en moins par an'},
      {key: 'visits', label: 'Déplacements évités', value: r.visits, detail: count(r.visitsAvoided) + ' déplacements en moins par an'},
      {key: 'revenue', label: 'Clients gardés', value: r.revenue, detail: count(r.kept) + ' clients qui restent chez Moov'}
    ];
    const incidents = data?.incidents || [], forecasts = data?.forecasts || [];
    const measured = [
      {label: 'Pannes suivies en direct', value: incidents.length},
      {label: 'Réparations vérifiées', value: incidents.filter(i => i.status === 'resolved').length},
      {label: 'Pannes évitées à l’avance', value: forecasts.filter(f => f.prevention).length}
    ];
    return h('div', {className: 'im'},
      h('section', {className: 'im-hero', 'aria-labelledby': 'im-total-title'},
        h('div', {className: 'im-hero-head'},
          h('h2', {id: 'im-total-title'}, 'Guardian rapporte à Moov'),
          h('span', {className: 'im-period'}, 'par an')),
        h('p', {className: 'im-total', 'aria-live': 'polite'}, h('strong', null, big.value), h('span', null, big.unit)),
        h('p', {className: 'im-sub'}, 'Soit ' + text(r.perSubscriber) + ' par abonné et par an, calculés avec ', touched ? 'vos chiffres.' : 'nos valeurs de départ. Mettez les vôtres.'),
        h('div', {className: 'im-bar', role: 'img', 'aria-label': parts.map(p => p.label + ' : ' + text(p.value)).join(', ')},
          parts.map(p => h('span', {key: p.key, className: 'im-bar-' + p.key, style: {flexGrow: r.total ? p.value / r.total : 1 / 3}}))),
        h('ul', {className: 'im-parts'}, parts.map(p => { const m = money(p.value); return h('li', {key: p.key, className: 'im-part-' + p.key},
          h('i', {'aria-hidden': true}), h('span', null, h('b', null, p.label), h('small', null, p.detail)), h('strong', null, m.value, h('small', null, ' ' + m.unit.replace(' FCFA', '')))); }))),
      h('section', {className: 'im-card im-inputs', 'aria-labelledby': 'im-inputs-title'},
        h('div', {className: 'im-card-head'}, h('div', null, h('h2', {id: 'im-inputs-title'}, 'Vos chiffres'), h('p', null, 'Glissez chaque curseur. Le total change aussitôt.')),
          touched && h('button', {type: 'button', className: 'n-button', onClick: () => setValues({...DEFAULTS})}, 'Valeurs de départ')),
        h('div', {className: 'im-fields'}, FIELDS.map(f => h(Slider, {key: f.key, field: f, value: values[f.key], onChange: change}))),
        h('button', {type: 'button', className: 'im-more', 'aria-expanded': open, 'aria-controls': 'im-rates', onClick: () => setOpen(!open)}, open ? 'Masquer ce que Guardian évite' : 'Ce que Guardian évite, et d’où viennent les chiffres'),
        open && h('div', {id: 'im-rates', className: 'im-fields im-rates'}, RATES.map(f => h(Slider, {key: f.key, field: f, value: values[f.key], onChange: change})))),
      h('section', {className: 'im-card im-measured', 'aria-labelledby': 'im-measured-title'},
        h('h2', {id: 'im-measured-title'}, 'Mesuré dans cette démo'),
        h('ul', null, measured.map(m => h('li', {key: m.label}, h('strong', null, m.value), h('span', null, m.label)))),
        h('p', null, 'Chaque curseur dit d’où vient son chiffre. Les déplacements évités et les clients gardés se mesureront pendant un essai dans un quartier.')));
  }

  root.FGImpact = {View, compute, money, DEFAULTS};
})(typeof window !== 'undefined' ? window : globalThis);
