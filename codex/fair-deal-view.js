// Fair Deal (thème 4) côté équipe Moov, affiché dans le Superviseur : après une coupure réparée, Guardian propose un geste
// pour chaque client du quartier (jours offerts au prorata du forfait). Un responsable l'accorde ou le refuse d'un coup ;
// les clients sont alors prévenus dans l'application. Les règles et les droits sont vérifiés par le serveur (fair-deal.cjs).
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const money = n => n.toLocaleString('fr-FR') + ' F';
  const length = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''); };

  function Group({g, canDecide, busy, onDecide}) {
    const [open, setOpen] = S(false), [confirm, setConfirm] = S(false);
    return h('li', {className: 'fd-group'},
      h('div', {className: 'fd-head'},
        h('div', null, h('strong', null, g.zone || g.title), h('small', null, g.title + ' · coupure de ' + length(g.ended - g.started))),
        h('div', {className: 'fd-total'}, h('b', null, money(g.amount)), h('small', null, g.clients.length + ' client' + (g.clients.length > 1 ? 's' : '') + ' · ' + g.days + ' jour' + (g.days > 1 ? 's' : '')))),
      h('button', {type: 'button', className: 'fd-more', 'aria-expanded': open, onClick: () => setOpen(!open)}, open ? 'Masquer le détail' : 'Voir le détail par client'),
      open && h('ul', {className: 'fd-clients'}, g.clients.map((c, i) => h('li', {key: i}, h('span', null, h('b', null, c.name), h('small', null, c.reasons.join(' · '))), h('b', null, c.days + ' j · ' + money(c.amount))))),
      g.status !== 'proposed' ? h('p', {className: 'fd-done is-' + g.status}, g.status === 'validated' ? 'Geste accordé, clients prévenus.' : 'Geste refusé.') :
        !canDecide ? h('p', {className: 'fd-wait'}, 'En attente d’un responsable.') :
        confirm ? h('div', {className: 'fd-actions'}, h('p', null, 'Accorder ' + money(g.amount) + ' à ' + g.clients.length + ' client' + (g.clients.length > 1 ? 's' : '') + ' ? Ils seront prévenus dans l’application.'),
          h('button', {type: 'button', className: 'fd-yes', disabled: busy, onClick: () => onDecide(g, 'validate')}, 'Oui, accorder le geste'), h('button', {type: 'button', className: 'fd-no', disabled: busy, onClick: () => setConfirm(false)}, 'Annuler')) :
        h('div', {className: 'fd-actions'}, h('button', {type: 'button', className: 'fd-yes', disabled: busy, onClick: () => setConfirm(true)}, 'Accorder le geste'), h('button', {type: 'button', className: 'fd-no', disabled: busy, onClick: () => onDecide(g, 'refuse')}, 'Refuser')));
  }

  function Block({api}) {
    const [d, setD] = S(null), [busy, setBusy] = S(false), [error, setError] = S(''), alive = R(true);
    E(() => { alive.current = true; const load = () => { if (!document.hidden) api('/noc/fairdeal').then(x => alive.current && setD(x)).catch(() => {}); }; load(); const t = setInterval(load, 8000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    async function decide(g, decision) {
      setBusy(true); setError('');
      try { const r = await api('/noc/fairdeal', 'POST', {incidentId: g.incidentId, decision, confirm: decision === 'validate'}); if (alive.current) setD(r); }
      catch (e) { if (alive.current) setError(e.message || 'La décision n’a pas pu être enregistrée.'); }
      finally { if (alive.current) setBusy(false); }
    }
    const groups = d.pending.concat(d.decided);
    return h('section', {className: 'gs-block fd', 'aria-labelledby': 'fd-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'fd-title'}, 'Gestes après une coupure'), h('span', {className: 'gs-count'}, d.pending.length)),
      h('p', {className: 'gs-note'}, '1 jour offert pour toute coupure confirmée, plus 1 jour par 24 h commencées et 1 jour si l’heure de retour promise n’a pas été tenue. Je calcule, un responsable accorde.'),
      error && h('p', {className: 'gs-error', role: 'alert'}, error),
      groups.length ? h('ul', {className: 'fd-list'}, groups.map(g => h(Group, {key: g.incidentId, g, canDecide: d.canDecide, busy, onDecide: decide})))
        : h('p', {className: 'gs-empty'}, 'Aucune coupure réparée ces 30 derniers jours : aucun geste à proposer.'));
  }

  root.FGFairDeal = {Block};
})(typeof window !== 'undefined' ? window : globalThis);
