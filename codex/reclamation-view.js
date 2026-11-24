// Réclamations (reclamation.cjs) : sur chaque dossier du client (« Suivi »), l'heure de réponse promise,
// le bouton « Ce n'est pas réglé » et, après deux réclamations, ses recours (ARTCI).
// Dans le Superviseur (onglet Clients) : le bloc « Réclamations », retards en premier, réponse en un geste.
(function (root) {
  'use strict';
  const h = React.createElement, S = React.useState, E = React.useEffect, R = React.useRef;
  const hour = t => new Date(t).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}).replace(':', ' h ');

  // Côté client : une seule carte sous l'état du dossier.
  function Card({api, incident: i, onSaved}) {
    const r = i.reclamation, [open, O] = S(false), [busy, B] = S(false), [error, X] = S(''), [done, D] = S('');
    if (!r) return null;
    const last = r.items[r.items.length - 1], answered = last && last.status === 'done' ? last : null;
    async function send(e) {
      e.preventDefault(); if (busy) return;
      const text = e.currentTarget.elements.text.value;
      B(true); X('');
      try { const x = await api('/reclamation', 'POST', {id: i.id, text}); D('Réclamation enregistrée. Réponse avant ' + x.dueText + '.'); O(false); if (onSaved) await onSaved(); }
      catch (err) { X(err.message); } finally { B(false); }
    }
    const nothing = !i.promise && !r.open && !answered && !r.canClaim && !r.recours;
    if (nothing && !done) return null;
    return h('section', {className: 'rc-card' + (i.promise && i.promise.late || r.open && r.open.late ? ' is-late' : ''), 'aria-label': 'Réponse de Moov'},
      i.promise && h('p', {className: 'rc-promise'}, h('b', null, i.promise.text)),
      r.open && h('div', {className: 'rc-state'},
        h('b', null, r.open.level === 1 ? 'Votre réclamation est chez un conseiller' : 'Votre dossier est chez un responsable'),
        h('p', null, r.open.late ? 'Réponse promise avant ' + r.open.dueText + '\u00a0: Moov est en retard. Votre dossier reste en tête de liste.' : 'Réponse promise avant ' + r.open.dueText + '. Vous serez prévenu ici.')),
      !r.open && answered && h('div', {className: 'rc-state is-done'},
        h('b', null, 'Réponse de Moov · ' + answered.outcome),
        h('p', null, answered.response)),
      done && h('p', {className: 'rc-ok', role: 'status'}, done),
      error && h('p', {className: 'rc-error', role: 'alert'}, error),
      r.canClaim && !open && !r.items.length && h('p', {className: 'rc-hint'}, 'Internet ne marche toujours pas ? Dites-le à Moov ici, sans rappeler le 111.'),
      r.canClaim && !open && h('button', {type: 'button', className: 'rc-claim', onClick: () => { O(true); D(''); }},
        i.promise && i.promise.late ? 'Toujours pas de réponse ?' : 'Ce n’est pas réglé'),
      r.canClaim && open && h('form', {className: 'rc-form', onSubmit: send},
        h('label', null, 'Dites-nous ce qui ne va pas (facultatif)', h('textarea', {name: 'text', maxLength: 500, rows: 3, disabled: busy, placeholder: 'Exemple : internet coupe encore tous les soirs'})),
        h('div', {className: 'rc-actions'},
          h('button', {type: 'submit', className: 'rc-claim is-main', disabled: busy}, busy ? 'Envoi…' : r.items.length ? 'Faire monter mon dossier' : 'Envoyer ma réclamation'),
          h('button', {type: 'button', className: 'rc-link', disabled: busy, onClick: () => O(false)}, 'Annuler'))),
      r.recours && h('details', {className: 'rc-recours'},
        h('summary', null, 'Vos recours si rien n’est réglé'),
        h('p', null, 'Vous pouvez saisir l’ARTCI, l’autorité qui contrôle les opérateurs. C’est gratuit, sur ', h('a', {href: 'https://www.artci.ci', target: '_blank', rel: 'noopener'}, 'artci.ci'), '.'),
        h('p', null, 'Donnez la référence de votre dossier\u00a0: ', h('b', null, r.ref), '.')));
  }

  // Côté Moov : le bloc du Superviseur (onglet « Clients et offres »).
  function Item({c, outcomes, busy, onDone}) {
    const [open, O] = S(false);
    return h('li', {className: 'av-call' + (c.late ? ' is-late' : '')},
      h('div', {className: 'av-call-head'},
        h('div', null, h('b', null, c.name), h('small', null, 'Dossier ' + c.ref + ' · ' + c.title)),
        h('span', {className: 'rc-level is-' + c.level}, c.who)),
      c.text && h('p', {className: 'av-quote'}, '« ' + c.text + ' »'),
      h('p', {className: 'av-due'}, c.late ? 'En retard\u00a0: réponse promise avant ' + c.dueText : 'Réponse promise avant ' + c.dueText),
      open ? h('div', {className: 'av-outcomes', role: 'group', 'aria-label': 'Ce qui a été fait'},
        outcomes.map(o => h('button', {key: o.key, type: 'button', className: 'av-btn' + (o.key === 'regle' ? ' is-main' : ''), disabled: busy, onClick: () => onDone(c.id, o.key)}, o.label)),
        h('button', {type: 'button', className: 'av-link', onClick: () => O(false)}, 'Annuler'))
        : h('button', {type: 'button', className: 'av-btn is-main', onClick: () => O(true)}, 'Répondre au client'));
  }

  function Block({api}) {
    const [d, D] = S(null), [busy, B] = S(false), [error, X] = S(''), alive = R(true);
    const load = () => { if (!document.hidden) api('/noc/reclamations').then(x => alive.current && D(x)).catch(() => {}); };
    E(() => { alive.current = true; load(); const t = setInterval(load, 10000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    async function onDone(id, outcome) {
      B(true); X('');
      try { await api('/noc/reclamations', 'POST', {id, outcome}); D(await api('/noc/reclamations')); } catch (e) { X(e.message); } finally { B(false); }
    }
    const c = d.counts;
    return h('section', {className: 'gs-block rc-block', 'aria-labelledby': 'rc-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'rc-title'}, 'Réclamations'), h('span', {className: 'gs-count' + (c.late ? ' av-alarm' : '')}, c.open)),
      h('div', {className: 'av-kpis'},
        h('div', null, h('b', null, c.late), h('span', null, 'En retard')),
        h('div', null, h('b', null, c.high), h('span', null, 'Chez un responsable')),
        h('div', null, h('b', null, c.done), h('span', null, 'Réglées en 7 jours'))),
      error && h('p', {className: 'fw-error', role: 'alert'}, error),
      d.open.length ? h('ul', {className: 'av-calls'}, d.open.map(x => h(Item, {key: x.id, c: x, outcomes: d.outcomes, busy, onDone})))
        : h('p', {className: 'gs-empty'}, 'Aucune réclamation en attente. Quand un client touche « Ce n’est pas réglé », elle arrive ici avec l’heure de réponse promise.'));
  }

  root.FGReclamation = {Card, Block, hour};
})(typeof window !== 'undefined' ? window : globalThis);
