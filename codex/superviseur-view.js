// Guardian Superviseur : l'agent qui regarde tout le réseau pour l'équipe Moov.
// Bulletin, quartiers en un coup d'œil, problèmes classés avec cause et conseil, agents surveillés, journal, questions.
// Les données viennent de /api/noc/superviseur (réservé aux comptes de l'équipe, vérifié par le serveur) toutes les 3 secondes.
// L'agent ne déclenche rien : ses boutons ouvrent l'écran où un responsable valide, ou transmettent le problème au journal.
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const ICONS = {
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    radar: 'M12 12 19 5M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5', brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
    pulse: 'M3 12h4l2-6 4 12 2-6h6', truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4M17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
    phone: 'M5 3h4l2 5-3 2a11 11 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2', chat: 'M4 5h16v11H9l-5 4zM8 10h8M8 13h5',
    trend: 'M3 17l6-6 4 4 8-8M15 7h6v6', spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z', send: 'M4 12 20 4l-6 16-3-7zM11 13l9-9', arrow: 'M5 12h14M13 6l6 6-6 6', flag: 'M5 21V4h11l-2 4 2 4H5'
  };
  const Icon = ({name, size = 18}) => h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false}, h('path', {d: ICONS[name] || ICONS.spark}));
  const clock = t => new Date(t).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'});
  const seconds = t => new Date(t).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  const LEVEL = {critique: 'Grave', majeure: 'À traiter', attention: 'À surveiller', info: 'Pour info'};
  const TONE_WORD = {ok: 'En forme', warn: 'À regarder', bad: 'Problème', info: 'En veille'};
  const SUGGESTIONS = ['Quel quartier va le plus mal ?', 'Fais-moi le point pour le directeur', 'Où sont les techniciens ?', 'Combien d’appels évités ?'];
  const short = zone => String(zone).split(' · ').pop();

  function Bulletin({b, error, onAsk}) {
    const n = b.numbers;
    return h('section', {className: 'gs-bulletin is-' + b.headline.tone, 'aria-labelledby': 'gs-title'},
      h('div', {className: 'gs-who'},
        h('span', {className: 'gs-avatar', 'aria-hidden': true}, h(Icon, {name: 'eye', size: 22})),
        h('div', null, h('h2', {id: 'gs-title'}, 'Guardian Superviseur'), h('p', null, 'Je regarde tout le réseau et toutes les équipes pour vous.')),
        h('span', {className: 'gs-live' + (error ? ' is-stale' : ''), role: 'status'}, h('i', {'aria-hidden': true}), error ? 'Nouvel essai…' : 'En direct', h('b', null, seconds(b.at)))),
      h('p', {className: 'gs-headline', 'aria-live': 'polite'}, b.headline.text),
      h('ul', {className: 'gs-quartiers', 'aria-label': 'Les quartiers en un coup d’œil'},
        b.quartiers.map(q => h('li', {key: q.id}, h('button', {type: 'button', className: 'gs-q is-' + q.tone, onClick: () => onAsk('Comment va ' + short(q.zone) + ' ?'), title: q.zone + ' : ' + q.online + ' box sur ' + q.total + ' en ligne'},
          h('span', null, short(q.zone)), h('small', null, q.online + '/' + q.total),
          h('i', {'aria-hidden': true, style: {'--gs-fill': (q.online / q.total * 100) + '%'}}))))),
      h('dl', {className: 'gs-numbers'},
        [['Box en ligne', n.online + ' / ' + n.total], ['Dossiers ouverts', n.open], ['À valider', n.pending, n.pending > 0], ['Techniciens libres', n.free + ' / ' + n.technicians, n.free === 0], ['Appels évités · 24 h', n.avoided]]
          .map(([label, value, hot]) => h('div', {key: label, className: hot ? 'is-hot' : ''}, h('dt', null, label), h('dd', null, value)))));
  }

  function Ask({api, onBilan, request}) {
    const [text, setText] = S(''), [busy, setBusy] = S(false), [items, setItems] = S([]), [error, setError] = S('');
    const box = R(null);
    async function ask(question) {
      const q = String(question || '').trim(); if (!q || busy) return;
      setBusy(true); setError(''); setText('');
      try { const r = await api('/noc/superviseur/ask', 'POST', {question: q}); setItems(list => [{q, a: r.answer, at: r.at}, ...list].slice(0, 3)); onBilan(r.bilan); }
      catch (e) { setError(e.message || 'Je n’ai pas pu répondre. Réessayez.'); }
      finally { setBusy(false); }
    }
    E(() => { if (request) { ask(request.text); box.current?.scrollIntoView({block: 'nearest', behavior: 'smooth'}); } }, [request]);
    return h('section', {className: 'gs-ask', ref: box, 'aria-labelledby': 'gs-ask-title'},
      h('h3', {id: 'gs-ask-title'}, 'Posez-moi une question'),
      h('form', {className: 'gs-form', onSubmit: e => { e.preventDefault(); ask(text); }},
        h('label', {className: 'gs-visually-hidden', htmlFor: 'gs-question'}, 'Votre question au superviseur'),
        h('input', {id: 'gs-question', value: text, maxLength: 400, placeholder: 'Par exemple : et Yopougon ?', onChange: e => setText(e.target.value), disabled: busy, autoComplete: 'off'}),
        h('button', {type: 'submit', className: 'gs-send', disabled: busy || !text.trim(), 'aria-label': 'Envoyer la question'}, h(Icon, {name: 'send'}))),
      h('div', {className: 'gs-chips'}, SUGGESTIONS.map(s => h('button', {key: s, type: 'button', className: 'gs-chip', onClick: () => ask(s), disabled: busy}, s))),
      busy && h('p', {className: 'gs-thinking', role: 'status'}, h('i', {'aria-hidden': true}), h('i', {'aria-hidden': true}), h('i', {'aria-hidden': true}), 'Je regarde les quartiers, les dossiers et les équipes…'),
      error && h('p', {className: 'gs-error', role: 'alert'}, error),
      items.map((it, i) => h('div', {key: it.at + ':' + i, className: 'gs-answer' + (i ? ' is-old' : '')},
        h('p', {className: 'gs-q-text'}, it.q),
        h('p', {className: 'gs-a-text'}, h('span', {className: 'gs-mini', 'aria-hidden': true}, h(Icon, {name: 'eye', size: 14})), it.a),
        h('small', null, 'Guardian Superviseur · ' + clock(it.at)))));
  }

  function Finding({f, open, onToggle, onGo, onSignal, busy}) {
    return h('li', {className: 'gs-f is-' + f.level + (open ? ' is-open' : '')},
      h('button', {type: 'button', className: 'gs-f-head', onClick: onToggle, 'aria-expanded': open},
        h('span', {className: 'gs-level'}, LEVEL[f.level]),
        h('span', {className: 'gs-f-title'}, f.title),
        h('small', null, f.zone)),
      open && h('div', {className: 'gs-f-body'},
        h('p', {className: 'gs-cause'}, h('b', null, 'Cause probable · '), f.cause),
        h('dl', {className: 'gs-facts'}, f.facts.map(x => h('div', {key: x.label}, h('dt', null, x.label), h('dd', null, x.value)))),
        h('p', {className: 'gs-advice'}, h('b', null, 'Mon conseil'), f.advice),
        h('div', {className: 'gs-f-actions'},
          h('button', {type: 'button', className: 'gs-btn is-primary', onClick: () => onGo(f)}, f.go.label, h(Icon, {name: 'arrow', size: 16})),
          f.signaled ? h('span', {className: 'gs-signaled'}, h(Icon, {name: 'flag', size: 15}), 'Transmis par ' + f.signaled.by + ' à ' + clock(f.signaled.at))
            : h('button', {type: 'button', className: 'gs-btn', onClick: () => onSignal(f), disabled: busy}, h(Icon, {name: 'flag', size: 16}), 'Transmettre au responsable'))));
  }

  function Findings({b, api, onBilan, onNavigate}) {
    const [opened, setOpened] = S(null), [busy, setBusy] = S(false), [error, setError] = S('');
    const list = b.findings, first = list[0]?.key;
    const isOpen = f => opened === null ? f.key === first : opened === f.key;
    async function signal(f) {
      setBusy(true); setError('');
      try { onBilan(await api('/noc/superviseur/signal', 'POST', {key: f.key})); }
      catch (e) { setError(e.message || 'Transmission impossible.'); }
      finally { setBusy(false); }
    }
    return h('section', {className: 'gs-block', 'aria-labelledby': 'gs-f-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'gs-f-title'}, 'Ce que j’ai repéré'), h('span', {className: 'gs-count'}, list.length)),
      h('p', {className: 'gs-note'}, 'Classé du plus urgent au moins urgent. Je propose, un responsable décide.'),
      error && h('p', {className: 'gs-error', role: 'alert'}, error),
      list.length ? h('ul', {className: 'gs-findings'}, list.map(f => h(Finding, {key: f.key, f, open: isOpen(f), busy, onToggle: () => setOpened(isOpen(f) ? '' : f.key), onGo: f => onNavigate(f.go.page, f.go.incidentId), onSignal: signal})))
        : h('p', {className: 'gs-empty'}, 'Rien à signaler : toutes les box ont une bonne lumière et aucun dossier n’est ouvert.'));
  }

  function Agents({b}) {
    return h('section', {className: 'gs-block', 'aria-labelledby': 'gs-a-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'gs-a-title'}, 'Les agents que je supervise'), h('span', {className: 'gs-count'}, b.agents.length)),
      h('ul', {className: 'gs-agents'}, b.agents.map(a => h('li', {key: a.key, className: 'is-' + a.tone},
        h('span', {className: 'gs-agent-icon', 'aria-hidden': true}, h(Icon, {name: a.icon})),
        h('div', null, h('strong', null, a.name), h('p', null, a.text)),
        h('span', {className: 'gs-dot'}, TONE_WORD[a.tone])))));
  }

  function Journal({b}) {
    return h('section', {className: 'gs-block', 'aria-labelledby': 'gs-j-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'gs-j-title'}, 'Mon journal')),
      b.journal.length ? h('ol', {className: 'gs-journal'}, b.journal.map((j, i) => h('li', {key: j.at + ':' + i, className: 'is-' + j.tone}, h('time', {dateTime: new Date(j.at).toISOString()}, clock(j.at)), h('p', null, j.text))))
        : h('p', {className: 'gs-empty'}, 'Rien de nouveau depuis six heures.'));
  }

  function View({api, onNavigate}) {
    const [b, setB] = S(null), [error, setError] = S(''), [request, setRequest] = S(null);
    const flight = R(false);
    async function load() {
      if (flight.current || document.hidden) return; flight.current = true;
      try { setB(await api('/noc/superviseur')); setError(''); }
      catch (e) { setError(e.message || 'Le superviseur ne répond pas.'); }
      finally { flight.current = false; }
    }
    E(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);
    if (!b) return h('div', {className: 'gs gs-loading', role: 'status'}, error ? h('p', {className: 'gs-error', role: 'alert'}, error) : h('p', null, 'Je fais le tour du réseau…'));
    const askAbout = text => setRequest({text, at: Date.now()});
    return h('div', {className: 'gs'},
      h(Bulletin, {b, error, onAsk: askAbout}),
      h('div', {className: 'gs-grid'},
        h('div', {className: 'gs-main'}, h(Ask, {api, onBilan: setB, request}), h(Findings, {b, api, onBilan: setB, onNavigate})),
        h('div', {className: 'gs-side'}, h(Agents, {b}), h(Journal, {b}))));
  }

  root.FGSuperviseur = {View};
})(typeof window !== 'undefined' ? window : globalThis);
