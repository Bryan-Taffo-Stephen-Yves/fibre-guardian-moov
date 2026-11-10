// Fibre Loyalty+ (thème 2) : la page « Ma fidélité » du client, sa carte dans « Mon compte » et le bloc du Superviseur.
// Les points, les niveaux et les montants sont calculés par le serveur (fidelite.cjs) ; cet écran affiche et envoie.
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const money = n => Number(n || 0).toLocaleString('fr-FR') + ' F';
  const pts = n => Number(n || 0).toLocaleString('fr-FR');
  const day = at => new Date(at).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'});
  const Svg = ({d, size = 22}) => h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, h('path', {d}));
  const MEDAL = 'M8 3h8l-2 6h-4zM12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 12.5l1 2 2 .3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1L9 14.8l2-.3z';
  const BOLT = 'M13 2 4 14h7l-1 8 9-12h-7z';
  const ICONS = {boost: BOLT, wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01', mois: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4'};
  const nextText = d => d.next ? 'Plus que ' + pts(d.next.missing) + ' points avant le niveau ' + d.next.name : 'Vous êtes au plus haut niveau. Merci !';

  function Gauge({d}) {
    return h('div', {className: 'fl-gauge'},
      h('div', {className: 'fl-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': d.progress, 'aria-label': nextText(d)}, h('b', {style: {width: Math.max(4, d.progress) + '%'}})),
      h('p', null, nextText(d)));
  }

  function View({api, user, onNavigate}) {
    const [d, D] = S(null), [pay, P] = S(false), [busy, B] = S(false), [error, X] = S(''), [won, W] = S(null), [ask, A] = S('');
    const load = () => api('/fidelite').then(D).catch(e => X(e.message));
    E(() => { load(); }, []);
    if (!d) return h('div', {className: 'fl-page'}, error ? h('p', {className: 'fv-error', role: 'alert'}, error) : h('p', {className: 'fl-wait'}, 'Un instant…'));
    async function redeem(id) {
      B(true); X('');
      try { const r = await api('/fidelite', 'POST', {action: 'redeem', reward: id, confirm: true}); D(r); A(''); W({text: 'C’est fait : ' + d.rewards.find(x => x.id === id).name.toLowerCase() + '.'}); } catch (e) { X(e.message); } finally { B(false); }
    }
    const account = 'FIBRE-' + String(user?.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
    const dots = Array.from({length: d.streakGoal}, (_, k) => k < d.streak);
    return h('div', {className: 'fl-page'},
      h('header', {className: 'fl-head'}, h('h1', null, 'Ma fidélité'), h('p', null, 'Payez à temps, payez en ligne, parrainez : vos points se transforment en avantages.')),
      h('section', {className: 'fl-card fl-tier is-' + d.tier.id, 'aria-label': 'Mon niveau'},
        h('div', {className: 'fl-tier-top'},
          h('span', {className: 'fl-medal'}, h(Svg, {d: MEDAL, size: 30})),
          h('div', null, h('small', null, 'Niveau'), h('strong', null, d.tier.name)),
          h('div', {className: 'fl-points'}, h('strong', null, pts(d.points)), h('small', null, 'points'))),
        h(Gauge, {d})),
      won && h('p', {className: 'fl-won', role: 'status'}, won.text),
      error && h('p', {className: 'fv-error', role: 'alert'}, error),
      d.boost && h('section', {className: 'fl-card fl-boost'}, h('span', {className: 'fl-ico'}, h(Svg, {d: BOLT})), h('div', null, h('strong', null, 'Débit boosté : ' + d.boost.mbps + ' Mb/s'), h('small', null, d.boost.why + ' · jusqu’au ' + day(d.boost.until)))),
      h('section', {className: 'fl-card fl-bill'},
        h('div', {className: 'fl-bill-top'}, h('div', null, h('small', null, 'Facture de ' + d.bill.label), h('strong', null, money(d.bill.amount))),
          d.bill.paid ? h('span', {className: 'fl-chip is-ok'}, 'Payée') : h('span', {className: 'fl-chip' + (d.bill.late ? ' is-late' : '')}, d.bill.late ? 'En retard' : 'Avant le ' + day(d.bill.due))),
        d.bill.paid ? h('p', {className: 'fl-small'}, 'Payée le ' + day(d.bill.paidAt) + (d.bill.channel === 'moov_money' ? ' avec Moov Money.' : '.'))
          : h('button', {type: 'button', className: 'fl-pay', disabled: busy, onClick: () => P(true)}, 'Payer avec Moov Money', h('small', null, '+' + (d.rules.online + (d.bill.late ? 0 : d.rules.onTime)) + ' points'))),
      h('section', {className: 'fl-card'},
        h('h2', null, 'Factures payées à temps'),
        h('ol', {className: 'fl-dots', 'aria-label': d.streak + ' sur ' + d.streakGoal}, dots.map((on, k) => h('li', {key: k, className: on ? 'is-on' : ''}))),
        h('p', {className: 'fl-small'}, d.streak >= d.streakGoal ? d.streak + ' mois de suite sans retard. Bravo !' : d.streak + ' sur ' + d.streakGoal + ' : à ' + d.streakGoal + ' mois de suite, vous passez Argent et votre débit est boosté gratuitement pendant un mois.')),
      h('section', {className: 'fl-card'},
        h('h2', null, 'Échanger mes points'),
        h('ul', {className: 'fl-rewards'}, d.rewards.map(r => h('li', {key: r.id},
          h('span', {className: 'fl-ico'}, h(Svg, {d: ICONS[r.id]})),
          h('div', null, h('b', null, r.name), h('small', null, r.detail)),
          ask === r.id ? h('div', {className: 'fl-confirm'}, h('button', {type: 'button', className: 'fl-btn is-main', disabled: busy, onClick: () => redeem(r.id)}, 'Échanger ' + pts(r.points) + ' points'), h('button', {type: 'button', className: 'fl-link', onClick: () => A('')}, 'Annuler'))
            : h('button', {type: 'button', className: 'fl-btn', disabled: !r.canAfford || busy, onClick: () => { W(null); A(r.id); }}, r.canAfford ? pts(r.points) + ' pts' : 'Encore ' + pts(r.points - d.points)))))),
      h('section', {className: 'fl-card'},
        h('h2', null, 'Comment gagner des points'),
        h('ul', {className: 'fl-rules'},
          h('li', null, h('b', null, '+' + d.rules.online), h('span', null, 'chaque facture payée avec Moov Money')),
          h('li', null, h('b', null, '+' + d.rules.onTime), h('span', null, 'chaque facture payée avant la fin du mois')),
          h('li', null, h('b', null, '+' + d.rules.quarter), h('span', null, 'tous les 3 mois sans impayé')),
          h('li', null, h('b', null, '+' + d.rules.filleul), h('span', null, 'chaque proche parrainé', onNavigate && h('button', {type: 'button', className: 'fl-link', onClick: () => onNavigate('compte')}, 'Mon code'))))),
      d.history.length > 0 && h('section', {className: 'fl-card'},
        h('h2', null, 'Mes dernières factures'),
        h('ul', {className: 'fl-history'}, d.history.map(b => h('li', {key: b.month},
          h('span', null, b.label), h('small', {className: b.late ? 'is-late' : ''}, b.late ? 'En retard' : b.channel === 'moov_money' ? 'Moov Money' : 'En agence'), h('b', null, b.points ? '+' + b.points : '0'))))),
      pay && root.FGPay && h(root.FGPay.Checkout, {quote: {amount: d.bill.amount, label: 'Facture fibre de ' + d.bill.label, period: d.bill.label}, customer: {name: user?.name, phone: user?.phone || ''}, account, backLabel: 'Retour à ma fidélité',
        onPay: async () => { const r = await api('/fidelite', 'POST', {action: 'pay', month: d.bill.month, confirm: true}); D(r); W({text: (r.promoted ? 'Bravo, vous passez au niveau ' + r.promoted.name + ' ! ' : 'Facture payée. ') + '+' + r.won + ' points.'}); },
        onDone: () => P(false), onClose: () => P(false)}));
  }

  // Dans « Mon compte » : son niveau et ce qui lui manque, en un coup d'œil.
  function Entry({api, onOpen}) {
    const [d, D] = S(null);
    E(() => { api('/fidelite').then(D).catch(() => {}); }, []);
    if (!d) return null;
    return h('button', {type: 'button', className: 'fl-entry is-' + d.tier.id, onClick: onOpen},
      h('span', {className: 'fl-medal'}, h(Svg, {d: MEDAL, size: 26})),
      h('span', {className: 'fl-entry-main'}, h('strong', null, 'Fidélité ' + d.tier.name + ' · ' + pts(d.points) + ' points'), h('small', null, d.bill.paid ? nextText(d) : 'Facture de ' + d.bill.label.split(' ')[0] + ' à payer : +' + (d.rules.online + d.rules.onTime) + ' points'),
        h('i', {className: 'fl-track', 'aria-hidden': true}, h('b', {style: {width: Math.max(4, d.progress) + '%'}}))));
  }

  // Superviseur : clients par niveau, paiements en ligne du mois, derniers échanges.
  function Block({api}) {
    const [d, D] = S(null), alive = R(true);
    E(() => { alive.current = true; const load = () => { if (!document.hidden) api('/noc/fidelite').then(x => alive.current && D(x)).catch(() => {}); }; load(); const t = setInterval(load, 15000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    const top = Math.max(1, ...d.tiers.map(t => t.count));
    return h('section', {className: 'gs-block fl-block', 'aria-labelledby': 'fl-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'fl-title'}, 'Fidélité des clients'), h('span', {className: 'gs-count'}, d.clients)),
      !d.clients ? h('p', {className: 'gs-empty'}, 'Aucun client inscrit au programme pour l’instant.') : h(React.Fragment, null,
        h('ul', {className: 'fl-tiers'}, d.tiers.map(t => h('li', {key: t.id, className: 'is-' + t.id}, h('span', null, t.name), h('i', {'aria-hidden': true}, h('b', {style: {width: (t.count ? Math.max(8, Math.round(t.count / top * 100)) : 0) + '%'}})), h('em', null, t.count)))),
        h('p', {className: 'gs-note'}, d.paidThisMonth + ' facture' + (d.paidThisMonth > 1 ? 's' : '') + ' payée' + (d.paidThisMonth > 1 ? 's' : '') + ' ce mois-ci, dont ' + d.onlineThisMonth + ' avec Moov Money. ' + pts(d.points) + ' points à échanger.'),
        d.exchanges.length > 0 && h('ul', {className: 'fl-ex'}, d.exchanges.map((e, k) => h('li', {key: k}, h('b', null, e.name), ' · ' + e.what)))));
  }

  root.FGFidelite = {View, Entry, Block};
})(typeof window !== 'undefined' ? window : globalThis);
