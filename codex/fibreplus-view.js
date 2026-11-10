// Fibre+ (thème 10) : les contenus inclus dans l'abonnement, sur la page « Changer de forfait » (Section),
// et le bloc du Superviseur (Block). Les règles sont vérifiées par le serveur (fibreplus.cjs).
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const money = n => Number(n || 0).toLocaleString('fr-FR') + ' F';
  const day = at => new Date(at).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'});
  const Svg = ({d, size = 22}) => h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, h('path', {d}));
  const ICON = {films: 'M3 5h18v14H3zM10 9l5 3-5 3z', cours: 'M4 5h7a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4zM20 5h-4a2 2 0 0 0-2 2', gaming: 'M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-1a4 4 0 0 1 4-4zM8 11v4M6 13h4M16 12h.01M18 14h.01'};

  function Section({api, mbps}) {
    const [d, D] = S(null), [busy, B] = S(false), [error, X] = S(''), [ask, A] = S(false);
    E(() => { api('/fibreplus').then(D).catch(e => X(e.message)); }, [mbps]);
    if (!d) return error ? h('p', {className: 'fv-error', role: 'alert'}, error) : null;
    async function send(body) { B(true); X(''); try { D(await api('/fibreplus', 'POST', body)); A(false); } catch (e) { X(e.message); } finally { B(false); } }
    const g = d.gaming;
    return h('section', {className: 'fp', 'aria-labelledby': 'fp-title'},
      h('div', {className: 'fp-head'}, h('span', {className: 'fp-badge'}, 'Fibre+'), h('h2', {id: 'fp-title'}, d.included ? 'Inclus dans votre abonnement' : 'Plus qu’internet, dès ' + d.includedFrom + ' Mb/s'),
        h('p', null, d.included ? 'Votre fibre ' + d.plan.mbps + ' Mb/s vient avec un service de contenus, sans rien payer en plus.' : 'À partir du forfait ' + d.includedFrom + ' Mb/s, votre abonnement inclut un service de contenus au choix, avec 3 mois offerts.')),
      error && h('p', {className: 'fv-error', role: 'alert'}, error),
      h('ul', {className: 'fp-contents', role: d.included ? 'radiogroup' : undefined, 'aria-label': 'Contenu inclus'}, d.contents.map(c => {
        const mine = d.content && d.content.id === c.id;
        return h('li', {key: c.id, className: (mine ? 'is-mine' : '') + (d.included ? '' : ' is-locked')},
          h('span', {className: 'fp-ico'}, h(Svg, {d: ICON[c.id]})),
          h('div', null, h('b', null, c.name), h('small', null, c.detail),
            mine && h('em', {className: 'fp-gift'}, 'Inclus · offert jusqu’au ' + day(d.content.giftUntil) + ' (valeur ' + money(c.value) + ' par mois)')),
          d.included ? (mine ? h('span', {className: 'fp-tag'}, 'Votre choix')
            : h('button', {type: 'button', className: 'fp-btn', disabled: busy || (d.content && !d.content.canSwitch), title: d.content && !d.content.canSwitch ? 'Changement possible à partir du ' + day(d.content.switchAt) : undefined, onClick: () => send({action: 'content', content: c.id})}, d.content && !d.content.canSwitch ? 'Dès le ' + day(d.content.switchAt) : 'Choisir'))
            : h('span', {className: 'fp-tag is-lock'}, 'Dès ' + d.includedFrom + ' Mb/s'));
      })),
      h('div', {className: 'fp-gaming' + (g.on ? ' is-on' : '')},
        h('span', {className: 'fp-ico'}, h(Svg, {d: ICON.gaming})),
        h('div', null, h('b', null, 'Pack jeux en ligne'), h('small', null, 'Jeux dans le cloud et latence réduite : votre console passe en priorité sur la box.'),
          h('em', null, g.free ? 'Inclus avec ' + g.freeFrom + ' Mb/s' : g.on ? 'Actif · ' + money(g.price) + ' par mois sur votre facture' : money(g.price) + ' par mois · inclus dès ' + g.freeFrom + ' Mb/s')),
        g.free ? h('span', {className: 'fp-tag'}, 'Inclus')
          : ask ? h('div', {className: 'fp-confirm'}, h('button', {type: 'button', className: 'fp-btn is-main', disabled: busy, onClick: () => send({action: 'gaming', on: !g.on, confirm: true})}, g.on ? 'Oui, arrêter' : 'Activer pour ' + money(g.price)), h('button', {type: 'button', className: 'fp-link', onClick: () => A(false)}, 'Annuler'))
          : h('button', {type: 'button', className: 'fp-btn' + (g.on ? '' : ' is-main'), disabled: busy || (!g.on && !g.allowed), onClick: () => A(true)}, g.on ? 'Arrêter' : 'Activer')));
  }

  // Superviseur : contenus choisis, joueurs, revenu du pack jeux, clients à qui proposer 300 Mb/s.
  function Block({api}) {
    const [d, D] = S(null), alive = R(true);
    E(() => { alive.current = true; const load = () => { if (!document.hidden) api('/noc/fibreplus').then(x => alive.current && D(x)).catch(() => {}); }; load(); const t = setInterval(load, 15000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    return h('section', {className: 'gs-block fp-block', 'aria-labelledby': 'fp-b-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'fp-b-title'}, 'Fibre+ · contenus inclus'), h('span', {className: 'gs-count'}, d.eligible + d.gamingPaying)),
      h('dl', {className: 'fp-kpis'}, d.contents.map(c => [c.count, c.name]).concat([[d.gaming, 'joueurs (pack jeux)'], [money(d.revenue), 'par mois avec le pack jeux']]).map(([v, l]) => h('div', {key: l}, h('dt', null, v), h('dd', null, l)))),
      h('p', {className: 'gs-note'}, d.eligible + ' client' + (d.eligible > 1 ? 's' : '') + ' à 300 Mb/s ou plus ont un contenu inclus. ' + (d.upsell ? d.upsell + ' client' + (d.upsell > 1 ? 's' : '') + ' à 200 Mb/s : leur proposer 300 Mb/s avec Fibre+.' : '')));
  }

  root.FGFibrePlus = {Section, Block};
})(typeof window !== 'undefined' ? window : globalThis);
