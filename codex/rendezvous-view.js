// Créneau de dépannage (rendezvous.cjs) : sur le dossier du client (« Ma réparation »), quand le technicien passe,
// le choix du créneau et, si le créneau est passé sans technicien, des excuses et un nouveau créneau.
// Dans le Superviseur (onglet Clients) : le bloc « Rendez-vous chez les clients », retards en premier.
(function (root) {
  'use strict';
  const h = React.createElement, S = React.useState, E = React.useEffect, R = React.useRef;
  const short = label => label.replace(/^\w/, c => c.toUpperCase());

  // Côté client : une carte sous l'état du dossier.
  function Card({api, incident: i, onSaved}) {
    const r = i.rendezvous, [open, O] = S(false), [day, D] = S(null), [slot, L] = S(null), [busy, B] = S(false), [error, X] = S('');
    if (!r) return null;
    const c = r.current, choosing = open || (!c && r.canChange), picked = r.choices.find(x => x.day === day) || r.choices[0];
    async function save() {
      const s = slot && picked.slots.some(x => x.id === slot) ? slot : picked.slots[0].id;
      B(true); X('');
      try { await api('/rendezvous', 'POST', {incident: i.id, day: picked.day, slot: s}); O(false); if (onSaved) await onSaved(); }
      catch (err) { X(err.message); } finally { B(false); }
    }
    return h('section', {className: 'rv-card' + (c && c.late ? ' is-late' : ''), 'aria-label': 'Rendez-vous avec le technicien'},
      c && !choosing && h('div', {className: 'rv-now'},
        h('b', null, c.late ? 'Pardon : le technicien n’est pas venu à l’heure' : 'Le technicien passe chez vous'),
        h('p', null, c.late ? 'Il devait passer ' + c.label + '. Choisissez un nouveau créneau : il passe en priorité.' : short(c.label) + '. Vous le suivrez ici dès son départ.')),
      !c && !choosing && h('p', {className: 'rv-hint'}, 'Le technicien vous appellera avant de passer.'),
      choosing && r.choices.length > 0 && h('div', {className: 'rv-pick'},
        h('b', null, c ? 'Choisir un autre créneau' : 'Quand êtes-vous chez vous ?'),
        h('div', {className: 'rv-days', role: 'radiogroup', 'aria-label': 'Jour'},
          r.choices.map(x => h('button', {key: x.day, type: 'button', role: 'radio', 'aria-checked': picked.day === x.day, className: 'rv-day' + (picked.day === x.day ? ' is-on' : ''), disabled: busy, onClick: () => D(x.day)},
            h('b', null, x.label.split(' ')[0].replace(/^\w/, ch => ch.toUpperCase())), h('small', null, x.today ? 'aujourd’hui' : x.label.split(' ').slice(1).join(' '))))),
        h('div', {className: 'rv-slots', role: 'radiogroup', 'aria-label': 'Moment de la journée'},
          picked.slots.map((x, k) => { const on = (slot && picked.slots.some(y => y.id === slot) ? slot : picked.slots[0].id) === x.id;
            return h('button', {key: x.id, type: 'button', role: 'radio', 'aria-checked': on, className: 'rv-slot' + (on ? ' is-on' : ''), disabled: busy, onClick: () => L(x.id)}, x.id === 'matin' ? 'Le matin' : 'L’après-midi', h('small', null, x.label)); })),
        h('div', {className: 'rv-actions'},
          h('button', {type: 'button', className: 'rv-main', disabled: busy, onClick: save}, busy ? 'Enregistrement…' : 'Valider ce créneau'),
          c && h('button', {type: 'button', className: 'rv-link', disabled: busy, onClick: () => O(false)}, 'Annuler'))),
      error && h('p', {className: 'rv-error', role: 'alert'}, error),
      c && !choosing && r.canChange && h('button', {type: 'button', className: c.late ? 'rv-main' : 'rv-link', onClick: () => { O(true); D(null); L(null); }}, c.late ? 'Choisir un nouveau créneau' : 'Changer de créneau'));
  }

  // Côté Moov : rendez-vous à venir, les retards d'abord.
  function Block({api}) {
    const [d, D] = S(null), alive = R(true);
    const load = () => { if (!document.hidden) api('/noc/rendezvous').then(x => alive.current && D(x)).catch(() => {}); };
    E(() => { alive.current = true; load(); const t = setInterval(load, 10000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    return h('section', {className: 'gs-block rv-block', 'aria-labelledby': 'rv-block-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'rv-block-title'}, 'Rendez-vous chez les clients'), h('span', {className: 'gs-count' + (d.late ? ' av-alarm' : '')}, d.items.length)),
      d.items.length ? h('ul', {className: 'av-calls'}, d.items.slice(0, 8).map(r => h('li', {key: r.id, className: 'av-call' + (r.late ? ' is-late' : '')},
        h('div', {className: 'av-call-head'}, h('div', null, h('b', null, r.name), h('small', null, r.title)), h('span', {className: 'rc-level' + (r.late ? ' is-2' : '')}, r.late ? 'En retard' : r.today ? 'Aujourd’hui' : 'À venir')),
        h('p', {className: 'av-due'}, short(r.when) + (r.assigned ? '' : ' · aucune équipe affectée') + (r.changes ? ' · changé ' + r.changes + ' fois' : '')))))
        : h('p', {className: 'gs-empty'}, 'Aucun rendez-vous à venir. Quand un client signale une panne chez lui, il choisit ici quand le technicien peut passer.'));
  }

  root.FGRendezvous = {Card, Block};
})(typeof window !== 'undefined' ? window : globalThis);
