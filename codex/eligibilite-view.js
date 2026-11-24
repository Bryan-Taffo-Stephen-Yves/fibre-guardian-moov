// « La fibre arrive-t-elle chez moi ? » (eligibilite.cjs) côté Moov : dans le Superviseur (onglet Clients), les communes
// où des clients attendent la fibre, les plus demandées d'abord. Un responsable annonce « La fibre est arrivée » :
// chaque client qui attendait est prévenu et peut commander.
(function (root) {
  'use strict';
  const h = React.createElement, S = React.useState, E = React.useEffect, R = React.useRef;

  function Block({api}) {
    const [d, D] = S(null), [busy, B] = S(false), [sure, U] = S(null), [error, X] = S(''), alive = R(true);
    const load = () => { if (!document.hidden) api('/noc/eligibilite').then(x => alive.current && D(x)).catch(() => {}); };
    E(() => { alive.current = true; load(); const t = setInterval(load, 15000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    async function open(commune) { B(true); X(''); try { D(await api('/noc/eligibilite', 'POST', {commune, confirm: true})); U(null); } catch (e) { X(e.message); } finally { B(false); } }
    const since = t => new Date(t).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'});
    return h('section', {className: 'gs-block el-block', 'aria-labelledby': 'el-block-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'el-block-title'}, 'Ils attendent la fibre'), h('span', {className: 'gs-count'}, d.total)),
      error && h('p', {className: 'fw-error', role: 'alert'}, error),
      d.opened.map(o => h('p', {key: o.commune, className: 'el-opened'}, 'Fibre ouverte à ' + o.commune + ' le ' + since(o.at) + ' : ' + o.told + ' client' + (o.told > 1 ? 's prévenus' : ' prévenu') + '.')),
      d.items.length ? h('ul', {className: 'av-calls'}, d.items.map(c => h('li', {key: c.commune, className: 'av-call'},
        h('div', {className: 'av-call-head'},
          h('div', null, h('b', null, c.commune), h('small', null, c.quartiers.map(q => q.name + (q.n > 1 ? ' (' + q.n + ')' : '')).join(' · '))),
          h('span', {className: 'rc-level' + (c.count >= 3 ? ' is-2' : '')}, c.count + ' client' + (c.count > 1 ? 's' : ''))),
        h('p', {className: 'av-due'}, 'Première demande le ' + since(c.since)),
        c.canOpen && (sure === c.commune
          ? h('div', {className: 'el-actions'},
              h('button', {type: 'button', className: 'av-btn is-main', disabled: busy, onClick: () => open(c.commune)}, busy ? 'Envoi…' : 'Oui, prévenir les ' + c.count + ' client' + (c.count > 1 ? 's' : '')),
              h('button', {type: 'button', className: 'av-link', disabled: busy, onClick: () => U(null)}, 'Annuler'))
          : h('button', {type: 'button', className: 'av-btn', onClick: () => U(c.commune)}, 'La fibre est arrivée à ' + c.commune)))))
        : h('p', {className: 'gs-empty'}, 'Personne n’attend la fibre hors zone. Quand un client demande la fibre dans une commune pas encore couverte, elle apparaît ici, la plus demandée d’abord.'));
  }

  root.FGEligibilite = {Block};
})(typeof window !== 'undefined' ? window : globalThis);
