// Boîte à idées (idees.cjs). Côté client, dans Mon compte : « Vos idées pour Moov », proposer, voter « Moi aussi »,
// suivre l'état (Reçue, À l'étude, Prévue, Faite). Côté Moov, dans le Superviseur (onglet Clients) : les idées les plus
// demandées d'abord, et la réponse du responsable, envoyée à l'auteur et à tous les votants.
(function (root) {
  'use strict';
  const h = React.createElement, S = React.useState, E = React.useEffect, R = React.useRef;
  const plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);

  function Idea({i, busy, onVote}) {
    return h('li', {className: 'id-item is-' + i.status},
      h('p', null, i.text),
      i.answer && h('p', {className: 'id-answer'}, h('b', null, 'Moov : '), i.answer),
      h('div', {className: 'id-foot'},
        h('span', {className: 'id-status is-' + i.status}, i.label),
        i.mine && i.status === 'recue' && h('small', null, 'Moov la lit avant de la publier'),
        h('small', null, plural(i.votes, 'voix', 'voix')),
        ['recue', 'etude', 'prevue'].includes(i.status) && !i.mine && h('button', {type: 'button', className: 'id-vote' + (i.voted ? ' is-on' : ''), 'aria-pressed': i.voted, disabled: busy, onClick: () => onVote(i)}, i.voted ? '✓ Moi aussi' : 'Moi aussi')));
  }

  // Côté client.
  function Card({api}) {
    const [d, D] = S(null), [open, O] = S(false), [busy, B] = S(false), [error, X] = S(''), [text, T] = S(''), [similar, M] = S(null), [thanks, K] = S('');
    E(() => { api('/idees').then(D).catch(() => {}); }, []);
    if (!d) return null;
    async function post(body, after) { B(true); X(''); try { const r = await api('/idees', 'POST', body); D(r); after && after(r); } catch (e) { X(e.message); } finally { B(false); } }
    const sent = r => { if (r.similar) { M(r.similar); return; } M(null); T(''); O(false); K('Merci ! Moov lit votre idée, puis la publie pour que d’autres clients la soutiennent. Vous serez prévenu à chaque étape.'); };
    const vote = i => post({action: 'vote', id: i.id, off: i.voted}, () => K(''));
    return h('section', {className: 'ch-group id-card', 'aria-labelledby': 'id-title'},
      h('h2', {id: 'id-title'}, 'Vos idées pour Moov'),
      h('p', {className: 'id-intro'}, 'Une idée pour améliorer la fibre ou l’application ? Proposez-la, ou soutenez celle d’un autre client. Moov vous répond ici.'),
      thanks && h('p', {className: 'id-thanks', role: 'status'}, thanks),
      d.done.length > 0 && h('div', {className: 'id-done'}, h('b', null, 'Déjà fait grâce à vous'), h('ul', null, d.done.map(i => h('li', {key: i.id}, '✓ ' + i.text)))),
      d.open.length > 0 && h('ul', {className: 'id-list', 'aria-label': 'Idées des clients'}, d.open.map(i => h(Idea, {key: i.id, i, busy, onVote: vote}))),
      similar && h('div', {className: 'id-similar', role: 'status'},
        h('b', null, similar.status === 'faite' ? 'C’est déjà fait !' : 'Une idée proche existe déjà'), h('p', null, '« ' + similar.text + ' » · ' + (similar.status === 'faite' ? 'Moov l’a déjà mise en place.' : plural(similar.votes, 'voix', 'voix'))),
        h('div', {className: 'id-actions'},
          similar.status !== 'faite' && !similar.voted && !similar.mine && h('button', {type: 'button', className: 'id-main', disabled: busy, onClick: () => post({action: 'vote', id: similar.id}, () => { M(null); T(''); O(false); K('Merci ! Votre voix compte pour cette idée.'); })}, 'Voter pour elle'),
          h('button', {type: 'button', className: 'id-link', disabled: busy, onClick: () => post({action: 'propose', text, force: true}, sent)}, 'Envoyer quand même la mienne'))),
      open ? h('form', {className: 'id-form', onSubmit: e => { e.preventDefault(); post({action: 'propose', text}, sent); }},
          h('label', null, 'Votre idée', h('textarea', {rows: 3, maxLength: 280, value: text, disabled: busy, onChange: e => { T(e.target.value); M(null); }, placeholder: 'Exemple : pouvoir choisir l’heure exacte du passage du technicien'})),
          error && h('p', {className: 'id-error', role: 'alert'}, error),
          h('div', {className: 'id-actions'},
            h('button', {type: 'submit', className: 'id-main', disabled: busy || text.trim().length < 10}, busy ? 'Envoi…' : 'Envoyer mon idée'),
            h('button', {type: 'button', className: 'id-link', disabled: busy, onClick: () => { O(false); M(null); X(''); }}, 'Annuler')))
        : h('button', {type: 'button', className: 'id-main', onClick: () => { O(true); K(''); }}, 'Proposer une idée'),
      !open && error && h('p', {className: 'id-error', role: 'alert'}, error));
  }

  // Côté Moov : les idées des clients, les plus demandées d'abord.
  function Block({api}) {
    const [d, D] = S(null), [busy, B] = S(false), [error, X] = S(''), [pick, P] = S(null), [answer, A] = S(''), alive = R(true);
    const load = () => { if (!document.hidden) api('/noc/idees').then(x => alive.current && D(x)).catch(() => {}); };
    E(() => { alive.current = true; load(); const t = setInterval(load, 15000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    async function decide(i, status) { B(true); X(''); try { D(await api('/noc/idees', 'POST', {id: i.id, status, answer})); P(null); A(''); } catch (e) { X(e.message); } finally { B(false); } }
    return h('section', {className: 'gs-block id-block', 'aria-labelledby': 'id-block-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'id-block-title'}, 'Idées des clients'), h('span', {className: 'gs-count'}, d.counts.open)),
      h('p', {className: 'av-due'}, plural(d.counts.week, 'idée reçue', 'idées reçues') + ' cette semaine · ' + plural(d.counts.done, 'faite', 'faites') + ' ce mois-ci'),
      error && h('p', {className: 'fw-error', role: 'alert'}, error),
      d.items.length ? h('ul', {className: 'av-calls'}, d.items.slice(0, 10).map(i => h('li', {key: i.id, className: 'av-call'},
        h('div', {className: 'av-call-head'},
          h('div', null, h('b', null, i.text), h('small', null, i.author + ' · ' + (i.hidden ? 'pas encore publiée' : plural(i.votes, 'voix', 'voix')))),
          h('span', {className: 'id-status is-' + i.status}, i.label)),
        i.answer && h('p', {className: 'av-due'}, 'Réponse : ' + i.answer),
        i.next.length > 0 && (pick && pick.id === i.id
          ? h('div', {className: 'id-decide'},
              h('label', null, pick.status === 'non' ? 'Pourquoi pas pour l’instant ? (le client le lira)' : 'Un mot pour les clients (facultatif)',
                h('textarea', {rows: 2, maxLength: 300, value: answer, disabled: busy, onChange: e => A(e.target.value)})),
              h('div', {className: 'id-actions'},
                h('button', {type: 'button', className: 'av-btn is-main', disabled: busy || (pick.status === 'non' && !answer.trim()), onClick: () => decide(i, pick.status)}, busy ? 'Envoi…' : 'Passer à « ' + i.next.find(n => n.key === pick.status).status + ' » et prévenir ' + plural(i.votes, 'client', 'clients')),
                h('button', {type: 'button', className: 'av-link', disabled: busy, onClick: () => P(null)}, 'Annuler')))
          : h('div', {className: 'av-outcomes'}, i.next.map(n => h('button', {key: n.key, type: 'button', className: 'av-btn' + (n.key === 'non' ? '' : ' is-main'), onClick: () => { P({id: i.id, status: n.key}); A(''); }}, n.label)))))))
        : h('p', {className: 'gs-empty'}, 'Aucune idée pour l’instant. Les clients proposent leurs idées dans Mon compte, et votent pour celles des autres.'));
  }

  root.FGIdees = {Card, Block};
})(typeof window !== 'undefined' ? window : globalThis);
