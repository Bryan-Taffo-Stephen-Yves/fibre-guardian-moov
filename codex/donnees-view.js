// « Mes données » (Mon compte) : ce que Fibre Guardian garde sur le client, pourquoi, combien de temps,
// son choix pour l'IA, le fichier à télécharger et l'effacement du compte. Le serveur décide (donnees.cjs) ; cet écran affiche et envoie.
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const Svg = ({d, size = 22}) => h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false}, h('path', {d}));
  const SHIELD = 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6zM9 12l2 2 4-4';
  const ICONS = {compte: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0', whatsapp: 'M4 20l1.4-4A8 8 0 1 1 8 18.6zM9 10c0 3 2 5 5 5l1-1.5-2-1-1 1c-1 0-2-1-2-2l1-1-1-2z', box: 'M3 14h18v5H3zM7 17h.01M11 17h.01M8 14l-2-6M16 14l2-6', veille: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01', copies: 'M8 8h11v12H8zM5 16V4h11', photos: 'M4 7h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', lieu: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0', avis: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'};
  const SAFE = [
    ['Mot de passe protégé', 'Il est transformé avant d’être gardé : personne chez Moov ne peut le lire.'],
    ['Connexion chiffrée', 'Tout passe en HTTPS, comme une banque en ligne. Un code à usage unique sert à se connecter par SMS.'],
    ['Chacun voit sa part', 'Un technicien ne voit que sa mission, un conseiller que ses dossiers. Le serveur le vérifie à chaque geste.'],
    ['Rien sans vous', 'La surveillance du Wi-Fi et les alertes WhatsApp ne s’allument que si vous le demandez.']
  ];

  function View({api, user, onBack, onErased}) {
    const [d, D] = S(null), [busy, B] = S(false), [err, X] = S(''), [say, Y] = S(''), [sure, U] = S(false);
    const alive = R(true), yes = R(null);
    E(() => { alive.current = true; api('/donnees').then(r => alive.current && D(r)).catch(e => alive.current && X(e.message)); return () => { alive.current = false; }; }, []);
    E(() => { if (sure) yes.current?.focus(); }, [sure]);
    async function ia(on) { B(true); X(''); try { const r = await api('/donnees', 'POST', {ia: on}); D(r); Y(on ? 'Guardian peut de nouveau utiliser l’IA pour vous répondre.' : 'C’est noté : vos messages ne passent plus par l’IA.'); } catch (e) { X(e.message); } B(false); }
    async function erase() { B(true); X(''); try { await api('/donnees', 'DELETE', {confirm: true}); onErased?.(); } catch (e) { X(e.message); B(false); U(false); } }
    return h('div', {className: 'dp-page'},
      h('button', {type: 'button', className: 'dp-back', onClick: onBack}, h(Svg, {d: 'M15 18l-6-6 6-6', size: 18}), 'Mon compte'),
      h('header', {className: 'dp-top'}, h('span', {className: 'dp-shield'}, h(Svg, {d: SHIELD, size: 26})), h('div', null, h('h1', null, 'Mes données'), h('p', null, 'Ce que Fibre Guardian garde sur vous, pourquoi, et pendant combien de temps. Vous pouvez tout télécharger ou tout effacer.'))),
      say && h('p', {className: 'dp-ok', role: 'status'}, say),
      err && h('p', {className: 'dp-error', role: 'alert'}, err),
      !d && !err && h('p', {className: 'dp-muted'}, 'Chargement…'),
      d && h('section', {className: 'dp-card', 'aria-labelledby': 'dp-kept'},
        h('h2', {id: 'dp-kept'}, 'Ce que nous gardons'),
        h('ul', {className: 'dp-list'}, d.items.map(i => h('li', {key: i.key, className: i.actif ? '' : 'is-off'},
          h('span', {className: 'dp-ico'}, h(Svg, {d: ICONS[i.key] || SHIELD, size: 19})),
          h('div', null, h('b', null, i.titre), h('p', null, i.detail), h('p', {className: 'dp-why'}, h('span', null, 'Pourquoi : '), i.pourquoi), h('p', {className: 'dp-time'}, h('span', null, 'Combien de temps : '), i.duree)))))),
      d && h('section', {className: 'dp-card'},
        h('h2', null, 'Votre choix'),
        h('div', {className: 'dp-switch-row'},
          h('div', null, h('b', {id: 'dp-ia'}, 'Réponses rédigées par l’IA'), h('p', null, 'Pour mieux comprendre vos messages, vos photos de box et vos notes vocales, Guardian peut utiliser Claude (Anthropic) et Groq. Ces services sont hors de Côte d’Ivoire. Sans eux, Guardian vous répond quand même, plus simplement.')),
          h('button', {type: 'button', role: 'switch', 'aria-checked': d.ia, 'aria-labelledby': 'dp-ia', className: 'dp-switch', disabled: busy, onClick: () => ia(!d.ia)}, h('i', {'aria-hidden': true})))),
      h('section', {className: 'dp-card'},
        h('h2', null, 'Comment vos données sont protégées'),
        h('ul', {className: 'dp-safe'}, SAFE.map(([t, x]) => h('li', {key: t}, h(Svg, {d: 'm5 12 5 5 9-10', size: 18}), h('div', null, h('b', null, t), h('p', null, x)))))),
      d && h('section', {className: 'dp-card'},
        h('h2', null, 'Vos droits'),
        h('a', {className: 'dp-btn', href: '/api/donnees/export', download: 'mes-donnees-fibre-guardian.json'}, h(Svg, {d: 'M12 4v11M7 10l5 5 5-5M5 20h14', size: 19}), 'Télécharger mes données'),
        d.effacable ? (sure
          ? h('div', {className: 'dp-confirm', role: 'alertdialog', 'aria-labelledby': 'dp-sure'},
              h('p', {id: 'dp-sure'}, h('b', null, 'Tout effacer ?'), ' Votre compte, votre WhatsApp relié, vos relevés et vos photos partent pour de bon. Les dossiers de panne de votre quartier restent, sans votre nom.'),
              h('div', {className: 'dp-row'}, h('button', {ref: yes, type: 'button', className: 'dp-danger', disabled: busy, onClick: erase}, busy ? 'Effacement…' : 'Oui, tout effacer'), h('button', {type: 'button', className: 'dp-ghost', disabled: busy, onClick: () => U(false)}, 'Annuler')))
          : h('button', {type: 'button', className: 'dp-btn is-danger', onClick: () => U(true)}, h(Svg, {d: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', size: 19}), 'Effacer mes données'))
          : h('p', {className: 'dp-muted'}, d.refus),
        h('p', {className: 'dp-law'}, 'Vos droits viennent de la loi ivoirienne n°2013-450 sur les données personnelles. En cas de désaccord, vous pouvez saisir l’ARTCI, l’autorité qui la fait respecter.')));
  }

  // Ligne de « Mon compte ».
  function Entry({onOpen}) {
    return h('section', {className: 'ch-group'}, h('h2', null, 'Mes données'),
      h('button', {type: 'button', className: 'ch-row', onClick: onOpen},
        h('span', {className: 'ch-row-icon'}, h(Svg, {d: SHIELD, size: 19})),
        h('span', null, h('b', null, 'Mes données et ma vie privée'), h('small', null, 'Voir, télécharger ou effacer')),
        h(Svg, {d: 'm9 6 6 6-6 6', size: 18})));
  }

  root.FGDonnees = {View, Entry};
})(window);
