// Service client (service-client.cjs) : le parcours complet d'une demande, vu des deux côtés.
//  - Client (« Ma réparation ») : « Mes demandes au service client », avec les étapes, l'heure de rappel promise,
//    le prénom du conseiller, puis « C'est réglé ? » (oui / non) et la note du service.
//  - Conseiller et responsable (Centre d'opérations) : la file « À rappeler », la plus urgente d'abord,
//    « Je m'en occupe », le numéro à appeler, puis le résultat de l'appel en un geste.
(function (root) {
  'use strict';
  const h = React.createElement, S = React.useState, E = React.useEffect, R = React.useRef;

  function useLoad(api, path, every) {
    const [d, D] = S(null), alive = R(true);
    const load = () => { if (!document.hidden) return api(path).then(x => { if (alive.current) D(x); }).catch(() => {}); };
    E(() => { alive.current = true; load(); const t = setInterval(load, every); return () => { alive.current = false; clearInterval(t); }; }, []);
    return [d, D, load];
  }

  function Steps({steps}) {
    return h('ol', {className: 'sc-steps'}, steps.map((s, k) => h('li', {key: k, className: s.done ? 'is-done' : ''}, h('span', {'aria-hidden': true}, s.done ? '✓' : k + 1), s.label)));
  }

  // Côté client.
  function Card({api}) {
    const [d, D] = useLoad(api, '/service-client', 8000), [busy, B] = S(false), [error, X] = S(''), [no, N] = S(null);
    if (!d || !d.items.length) return null;
    async function send(body) { B(true); X(''); try { D(await api('/service-client', 'POST', body)); N(null); } catch (e) { X(e.message); } finally { B(false); } }
    return h('section', {className: 'sc-card', 'aria-labelledby': 'sc-title'},
      h('h2', {id: 'sc-title'}, 'Mes demandes au service client'),
      d.items.map(i => h('article', {key: i.id, className: 'sc-item' + (i.late ? ' is-late' : '') + (i.status === 'confirmee' ? ' is-done' : '')},
        h('div', {className: 'sc-head'}, h('b', null, i.what), i.level > 1 && h('span', {className: 'sc-tag'}, 'Responsable')),
        h('small', null, i.title),
        h(Steps, {steps: i.steps}),
        h('p', {className: 'sc-text'}, i.text),
        i.canAnswer && no !== i.id && h('div', {className: 'sc-ask'},
          h('b', null, 'Est-ce réglé pour vous ?'),
          h('div', {className: 'sc-actions'},
            h('button', {type: 'button', className: 'sc-main', disabled: busy, onClick: () => send({id: i.id, answer: 'oui'})}, 'Oui, c’est réglé'),
            h('button', {type: 'button', className: 'sc-second', disabled: busy, onClick: () => N(i.id)}, 'Non, toujours pas'))),
        i.canAnswer && no === i.id && h('form', {className: 'sc-ask', onSubmit: e => { e.preventDefault(); send({id: i.id, answer: 'non', text: e.currentTarget.elements.text.value}); }},
          h('label', null, 'Qu’est-ce qui ne va pas ? (facultatif)', h('textarea', {name: 'text', rows: 2, maxLength: 300, disabled: busy, placeholder: 'Exemple : internet coupe encore le soir'})),
          h('div', {className: 'sc-actions'},
            h('button', {type: 'submit', className: 'sc-main', disabled: busy}, busy ? 'Envoi…' : i.level > 1 ? 'Envoyer' : 'Faire rappeler par un responsable'),
            h('button', {type: 'button', className: 'sc-link', disabled: busy, onClick: () => N(null)}, 'Annuler'))),
        i.canRate && h('div', {className: 'sc-ask'},
          h('b', null, 'Comment s’est passé le service ?'),
          h('div', {className: 'sc-stars', role: 'group', 'aria-label': 'Note de 1 à 5'},
            [1, 2, 3, 4, 5].map(n => h('button', {key: n, type: 'button', disabled: busy, 'aria-label': n + ' sur 5', onClick: () => send({id: i.id, rating: n})}, '★')))),
        i.rating && h('p', {className: 'sc-thanks'}, 'Merci pour votre note : ' + i.rating + ' / 5.'),
        i.status === 'recours' && h('p', {className: 'sc-text'}, 'Recours gratuit : ', h('a', {href: 'https://www.artci.ci', target: '_blank', rel: 'noopener'}, 'artci.ci'), '.'))),
      error && h('p', {className: 'sc-error', role: 'alert'}, error));
  }

  // Côté Moov : une demande de la file.
  function Item({r, outcomes, busy, act}) {
    const [open, O] = S(false), [note, N] = S('');
    const list = outcomes.filter(o => o.key !== 'echange' || r.kind === 'echange');
    return h('li', {className: 'av-call sc-call' + (r.late ? ' is-late' : '')},
      h('div', {className: 'av-call-head'},
        h('div', null, h('b', null, r.name), h('small', null, r.what + ' · ' + r.title)),
        h('span', {className: 'rc-level' + (r.level > 1 ? ' is-2' : '')}, r.level > 1 ? 'Responsable' : r.status === 'recue' ? 'À prendre' : r.status === 'appele' ? 'En attente de la suite' : 'En cours')),
      r.detail && h('p', {className: 'av-quote'}, '« ' + r.detail + ' »'),
      h('p', {className: 'av-due'}, (r.late ? 'En retard : rappel promis avant ' : 'Rappel promis avant ') + r.dueText + (r.agent ? ' · ' + r.agent : '') + (r.tries ? ' · ' + r.tries + ' appel' + (r.tries > 1 ? 's' : '') + ' sans réponse' : '')),
      r.status !== 'recue' && h('p', {className: 'sc-phone'}, r.phone ? h('a', {href: 'tel:' + r.phone.replace(/\s/g, '')}, 'Appeler ' + r.phone) : 'Numéro absent de l’application : le client suit sa demande dans « Ma réparation ».'),
      r.outcome && h('p', {className: 'av-due'}, 'Dernier appel : ' + r.outcome),
      !r.canAct ? h('p', {className: 'av-due'}, r.level > 1 ? 'Un responsable doit traiter cette demande.' : 'Un autre conseiller s’en occupe.')
        : r.status === 'recue' || (!r.mine && r.agent) ? h('button', {type: 'button', className: 'av-btn is-main', disabled: busy, onClick: () => act({id: r.id, action: 'take'})}, r.agent ? 'Reprendre la demande' : 'Je m’en occupe')
        : r.status === 'appele' ? h('p', {className: 'av-due'}, 'Le client est prévenu. On lui demandera si c’est réglé dès que c’est fait.')
        : open ? h('div', {className: 'sc-result'},
            h('label', null, 'Ce que vous avez dit au client (facultatif)', h('textarea', {rows: 2, maxLength: 500, value: note, onChange: e => N(e.target.value), disabled: busy})),
            h('div', {className: 'av-outcomes', role: 'group', 'aria-label': 'Résultat de l’appel'},
              list.map(o => h('button', {key: o.key, type: 'button', className: 'av-btn' + (o.key === 'regle' ? ' is-main' : ''), disabled: busy, onClick: () => act({id: r.id, action: 'result', outcome: o.key, note})}, o.label)),
              h('button', {type: 'button', className: 'av-link', onClick: () => O(false)}, 'Annuler')))
        : h('button', {type: 'button', className: 'av-btn is-main', onClick: () => O(true)}, 'J’ai appelé le client'));
  }

  function Queue({api}) {
    const [d, D] = useLoad(api, '/noc/service-client', 8000), [busy, B] = S(false), [error, X] = S('');
    if (!d) return null;
    async function act(body) { B(true); X(''); try { D(await api('/noc/service-client', 'POST', body)); } catch (e) { X(e.message); } finally { B(false); } }
    const st = d.stats;
    return h('section', {className: 'gs-block sc-queue', 'aria-labelledby': 'sc-queue-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'sc-queue-title'}, 'À rappeler · service client'), h('span', {className: 'gs-count' + (d.counts.late ? ' av-alarm' : '')}, d.counts.open)),
      h('div', {className: 'av-kpis'},
        h('div', null, h('b', null, d.counts.late), h('small', null, 'En retard')),
        h('div', null, h('b', null, st.taken === null ? '—' : st.taken + ' min'), h('small', null, 'Prise en charge moyenne')),
        h('div', null, h('b', null, st.rating === null ? '—' : String(st.rating).replace('.', ',') + ' / 5'), h('small', null, 'Note du service · 7 j'))),
      error && h('p', {className: 'fw-error', role: 'alert'}, error),
      d.items.length ? h('ul', {className: 'av-calls'}, d.items.map(r => h(Item, {key: r.id, r, outcomes: d.outcomes, busy, act})))
        : h('p', {className: 'gs-empty'}, 'Personne à rappeler. ' + (st.solved ? st.solved + ' client' + (st.solved > 1 ? 's ont' : ' a') + ' confirmé que c’était réglé cette semaine.' : 'Quand un client se plaint, sa demande arrive ici avec l’heure de rappel promise.')));
  }

  root.FGService = {Card, Queue};
})(typeof window !== 'undefined' ? window : globalThis);
