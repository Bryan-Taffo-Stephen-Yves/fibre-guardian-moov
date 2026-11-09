// Fibre Welcome (thème 1) : le parcours du nouvel abonné (View, côté client) et le suivi des installations (Block, dans le Superviseur).
// Les règles et les droits sont vérifiés par le serveur (welcome.cjs) ; cet écran ne fait qu'afficher et envoyer.
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const LAB = typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'lab';
  const money = n => n.toLocaleString('fr-FR') + ' F';
  const dayName = at => new Date(at).toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long'});
  const slotText = at => dayName(at) + ', ' + (new Date(at).getHours() < 12 ? 'entre 8 h et 12 h' : 'entre 14 h et 18 h');
  const clock = at => new Date(at).toLocaleString('fr-FR', {weekday: 'long', hour: '2-digit', minute: '2-digit'});
  const PLAN_KEY = 'fg-welcome-plan';
  const remembered = () => { try { return sessionStorage.getItem(PLAN_KEY) || ''; } catch (e) { return ''; } };
  const forget = () => { try { sessionStorage.removeItem(PLAN_KEY); } catch (e) {} };

  // Photo réduite sur le téléphone (1000 px, JPEG) avant l'envoi.
  async function shrink(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('Choisissez une photo.');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Cette photo ne s’ouvre pas. Essayez-en une autre.')); i.src = url; });
      for (const [side, q] of [[1000, .72], [800, .6], [640, .5]]) {
        const k = Math.min(1, side / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', q); if (out.length < 470000) return out;
      }
      throw new Error('Photo trop lourde. Reprenez-la de plus près.');
    } finally { URL.revokeObjectURL(url); }
  }
  // Mode laboratoire : une photo d'exemple dessinée, pour répéter la démonstration sans vraie pièce d'identité.
  function specimen(kind) {
    const c = document.createElement('canvas'); c.width = 640; c.height = 400; const g = c.getContext('2d'), css = n => getComputedStyle(document.documentElement).getPropertyValue('--moov-' + n).trim();
    g.fillStyle = css(kind === 'id' ? 'primary-50' : 'neutral-100'); g.fillRect(0, 0, 640, 400);
    g.fillStyle = css('primary'); g.font = 'bold 34px sans-serif'; g.fillText(kind === 'id' ? 'SPÉCIMEN · Pièce d’identité' : 'SPÉCIMEN · Façade', 32, 70);
    g.fillStyle = css('neutral-400'); if (kind === 'id') { g.fillRect(32, 110, 170, 220); [130, 180, 230, 280].forEach(y => g.fillRect(230, y, 360, 18)); } else { g.fillRect(140, 150, 360, 220); g.fillStyle = css('neutral-700'); g.fillRect(290, 260, 60, 110); }
    return c.toDataURL('image/jpeg', .7);
  }

  function Steps({order}) {
    const at = order.steps.findIndex(s => s.id === order.step);
    return h('ol', {className: 'fw-steps', 'aria-label': 'Étapes de votre installation'}, order.steps.map((s, i) =>
      h('li', {key: s.id, className: i < at ? 'is-done' : i === at ? 'is-now' : '', 'aria-current': i === at ? 'step' : undefined}, h('i', {'aria-hidden': true}, i < at ? '✓' : i + 1), h('span', null, s.label))));
  }

  function Order({data, busy, onSend}) {
    const pre = remembered(), [plan, P] = S(data.plans.some(p => p.id === pre) ? pre : 'demo-100'), [commune, C] = S(''), [quartier, Q] = S('');
    return h('form', {className: 'j-card fw-card', onSubmit: e => { e.preventDefault(); onSend({action: 'order', plan, commune, quartier}).then(ok => ok && forget()); }},
      h('h2', null, 'Votre forfait'),
      h('div', {className: 'fw-plans', role: 'radiogroup', 'aria-label': 'Forfait'}, data.plans.map(p => h('label', {key: p.id, className: 'fw-plan' + (p.id === plan ? ' is-picked' : '')},
        h('input', {type: 'radio', name: 'fw-plan', value: p.id, checked: p.id === plan, onChange: () => P(p.id)}), h('b', null, p.mbps + ' Mb/s'), h('small', null, money(p.price) + ' par mois')))),
      h('h2', null, 'Où installer la fibre ?'),
      h('label', {className: 'fw-field'}, h('span', null, 'Commune'), h('select', {value: commune, required: true, onChange: e => C(e.target.value)}, h('option', {value: ''}, 'Choisissez'), data.zone.map(z => h('option', {key: z, value: z}, z)))),
      h('label', {className: 'fw-field'}, h('span', null, 'Quartier ou repère'), h('input', {value: quartier, required: true, minLength: 2, maxLength: 80, placeholder: 'Par exemple : Riviera 3, près de la pharmacie', onChange: e => Q(e.target.value)})),
      h('button', {type: 'submit', className: 'j-button primary fw-go', disabled: busy || !commune || quartier.trim().length < 2}, 'Commander ma fibre'),
      h('p', {className: 'fw-small'}, 'Ensuite : deux photos, la vérification par un conseiller, puis votre rendez-vous.'));
  }

  function Pick({label, hint, value, onPick, kind, onError}) {
    const input = R(null);
    return h('div', {className: 'fw-photo' + (value ? ' is-set' : '')},
      value ? h('img', {src: value, alt: label}) : h('span', {className: 'fw-photo-empty', 'aria-hidden': true}, h('svg', {width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round'}, h('path', {d: kind === 'id' ? 'M3 5h18v14H3zM7 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0M5.5 16a3.5 3.5 0 0 1 7 0M14 9h4M14 13h4' : 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6'}))),
      h('div', null, h('b', null, label), h('small', null, hint),
        h('div', {className: 'fw-row'},
          h('button', {type: 'button', className: 'j-button', onClick: () => input.current.click()}, value ? 'Changer la photo' : 'Prendre la photo'),
          LAB && h('button', {type: 'button', className: 'j-button', onClick: () => onPick(specimen(kind))}, 'Photo d’exemple'))),
      h('input', {ref: input, type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onChange: e => { const f = e.target.files[0]; e.target.value = ''; shrink(f).then(onPick).catch(err => onError(err.message)); }}));
  }

  function Dossier({order, busy, onSend, onError}) {
    const [idp, I] = S(null), [home, H] = S(null);
    return h('section', {className: 'j-card fw-card'},
      order.note && h('p', {className: 'fw-note', role: 'alert'}, h('b', null, 'Votre conseiller vous demande : '), order.note),
      h('h2', null, 'Deux photos, et c’est tout'),
      h('p', {className: 'fw-small'}, 'Elles servent seulement à vérifier votre dossier, et sont effacées une fois la fibre posée.'),
      h(Pick, {label: 'Votre pièce d’identité', hint: 'Recto, bien à plat, sans reflet', value: idp, onPick: I, kind: 'id', onError}),
      h(Pick, {label: 'La façade de votre logement', hint: 'Pour que le technicien vous trouve du premier coup', value: home, onPick: H, kind: 'home', onError}),
      h('button', {type: 'button', className: 'j-button primary fw-go', disabled: busy || !idp || !home, onClick: () => onSend({action: 'photos', idPhoto: idp, homePhoto: home})}, 'Envoyer mon dossier'));
  }

  function Slots({order, busy, onSend}) {
    const days = []; for (const at of order.slots) { const k = new Date(at).toDateString(), d = days.find(x => x.k === k); d ? d.list.push(at) : days.push({k, at, list: [at]}); }
    return h('section', {className: 'j-card fw-card'},
      h('h2', null, 'Choisissez votre rendez-vous'),
      h('p', {className: 'fw-small'}, 'Votre dossier est validé. L’installation dure environ 2 heures ; une personne majeure doit être présente.'),
      days.map(d => h('div', {key: d.k, className: 'fw-day'}, h('b', null, dayName(d.at)), h('div', {className: 'fw-row'}, d.list.map(at => h('button', {key: at, type: 'button', className: 'j-button', disabled: busy, onClick: () => onSend({action: 'slot', at})}, new Date(at).getHours() < 12 ? 'Matin · 8 h à 12 h' : 'Après-midi · 14 h à 18 h'))))));
  }

  function Tech({order}) {
    const t = order.tech, A = window.FGAvatar, road = order.status === 'en_route';
    return h('section', {className: 'j-card fw-card fw-tech' + (road ? ' is-road' : '')},
      h('p', {className: 'fw-kicker'}, road ? 'EN ROUTE' : 'RENDEZ-VOUS CONFIRMÉ'),
      h('h2', null, road ? t.name + ' arrive chez vous' : slotText(order.slot)),
      h('div', {className: 'fw-who'}, A ? h(A.Face, {name: t.name, size: 56, role: 'tech'}) : null,
        h('div', null, h('b', null, t.name), h('small', null, t.team + ' · ' + String(t.rating).replace('.', ',') + ' ★ · ' + t.missions + ' installations'))),
      h('p', {className: 'fw-small'}, road ? 'Préparez un endroit près d’une prise pour la box. Le technicien vous appelle s’il ne trouve pas.' : 'La veille, Guardian vous rappelle le rendez-vous. Préparez un endroit près d’une prise pour la box.'));
  }

  function Welcome({order, busy, onSend, onOpen}) {
    const [stars, St] = S(0), [comment, Co] = S('');
    return h('section', {className: 'j-card fw-card fw-welcome'},
      h('span', {className: 'fw-done', 'aria-hidden': true}, h('svg', {width: 34, height: 34, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round'}, h('path', {d: 'm5 12 5 5 9-10'}))),
      h('h2', null, 'Bienvenue chez Moov !'),
      h('p', null, 'Votre ' + order.plan.name + ' est installée. Guardian veille maintenant sur votre connexion, jour et nuit.'),
      h('ol', {className: 'fw-first'},
        h('li', null, h('b', null, 'Mesurez votre débit'), h('small', null, 'Près de la box, en Wi-Fi : vous devriez voir environ ' + order.plan.mbps + ' Mb/s.'), h('a', {className: 'j-button', href: 'test.html'}, 'Tester ma connexion')),
        h('li', null, h('b', null, 'Gardez le mot de passe Wi-Fi'), h('small', null, 'Il est écrit sous la box. Ne le donnez qu’aux personnes de la maison.')),
        h('li', null, h('b', null, 'Un souci ? Demandez à Guardian'), h('small', null, 'Il regarde votre box et vous dit quoi faire, avant même d’appeler.'))),
      order.rating ? h('p', {className: 'fw-thanks'}, 'Merci pour votre note : ' + '★'.repeat(order.rating)) :
        h('div', {className: 'fw-rate'}, h('b', null, 'Comment s’est passée l’installation ?'),
          h('div', {className: 'fw-stars', role: 'radiogroup', 'aria-label': 'Note'}, [1, 2, 3, 4, 5].map(n => h('button', {key: n, type: 'button', role: 'radio', 'aria-checked': n === stars, 'aria-label': n + ' sur 5', className: n <= stars ? 'is-on' : '', onClick: () => St(n)}, '★'))),
          stars > 0 && h('input', {className: 'fw-input', value: comment, maxLength: 300, placeholder: 'Un mot pour le technicien (facultatif)', onChange: e => Co(e.target.value)}),
          stars > 0 && h('button', {type: 'button', className: 'j-button', disabled: busy, onClick: () => onSend({action: 'rate', stars, comment})}, 'Envoyer ma note')),
      h('button', {type: 'button', className: 'j-button primary fw-go', disabled: busy, onClick: onOpen}, 'Ouvrir mon espace Guardian'));
  }

  function View({api, onOpen}) {
    const [data, D] = S(null), [busy, B] = S(false), [error, X] = S(''), alive = R(true);
    const load = () => api('/welcome').then(x => { if (alive.current) { D(x); X(''); } }).catch(e => alive.current && X(e.message));
    E(() => { alive.current = true; load(); const t = setInterval(() => { if (!document.hidden) load(); }, 6000); return () => { alive.current = false; clearInterval(t); }; }, []);
    async function send(body) { B(true); X(''); try { const r = await api('/welcome', 'POST', body); if (alive.current) D(r); return true; } catch (e) { if (alive.current) X(e.message || 'Envoi impossible. Réessayez.'); return false; } finally { if (alive.current) B(false); } }
    async function open() { B(true); try { await api('/welcome/activate', 'POST', {}); onOpen && onOpen(); } catch (e) { X(e.message); } finally { if (alive.current) B(false); } }
    if (!data) return h('section', {className: 'j-card fw-page'}, h('p', {role: error ? 'alert' : 'status'}, error || 'Chargement…'));
    const o = data.order && data.order.status !== 'annule' ? data.order : null;
    const title = !o ? 'La fibre Moov chez vous' : o.step === 'bienvenue' ? 'Votre fibre est là' : 'Votre installation';
    return h('div', {className: 'fw-page'},
      h('header', {className: 'fw-head'}, h('p', {className: 'fw-kicker'}, 'NOUVEL ABONNEMENT'), h('h1', null, title),
        h('p', null, !o ? 'Commandez en deux minutes. Guardian vous suit jusqu’au premier surf.' : o.plan.name + ' · ' + o.commune + ', ' + o.quartier)),
      o && h(Steps, {order: o}),
      error && h('p', {className: 'fw-error', role: 'alert'}, error),
      !o ? h(Order, {data, busy, onSend: send}) :
        o.step === 'dossier' ? h(Dossier, {order: o, busy, onSend: send, onError: X}) :
        o.step === 'verification' ? h('section', {className: 'j-card fw-card fw-wait'}, h('span', {className: 'fw-pulse', 'aria-hidden': true}), h('h2', null, 'Un conseiller vérifie votre dossier'),
          h('p', null, o.late ? 'Votre dossier prend plus de temps que prévu : un conseiller s’en occupe en priorité.' : 'Réponse au plus tard ' + clock(o.deadline) + '. Vous serez prévenu ici.')) :
        o.step === 'rdv' ? h(Slots, {order: o, busy, onSend: send}) :
        o.step === 'installation' ? h(Tech, {order: o}) :
        h(Welcome, {order: o, busy, onSend: send, onOpen: open}),
      o && o.events.length > 0 && h('section', {className: 'j-card fw-card'}, h('h2', null, 'Ce qui s’est passé'),
        h('ul', {className: 'fw-log'}, o.events.slice().reverse().map((e, i) => h('li', {key: i}, h('time', null, new Date(e.at).toLocaleString('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})), h('span', null, e.what))))),
      o && ['dossier', 'verification', 'rdv', 'installation'].includes(o.step) && o.status !== 'en_route' && h('button', {type: 'button', className: 'fw-cancel', disabled: busy, onClick: () => { if (confirm('Annuler votre commande ?')) send({action: 'cancel'}); }}, 'Annuler ma commande'));
  }

  // Côté équipe Moov : vérifier les dossiers, suivre les rendez-vous et les installations du jour.
  const STATUS = {verification: 'À vérifier', a_corriger: 'Photo redemandée', rdv: 'Rendez-vous à choisir', planifie: 'Rendez-vous fixé', en_route: 'Technicien en route', installe: 'Installée'};
  const ASKS = ['La pièce d’identité est floue : reprenez-la à la lumière, bien à plat.', 'La pièce d’identité est coupée : on doit voir les quatre coins.', 'On ne voit pas l’entrée du logement : reprenez la façade avec la porte.'];
  function Item({it, busy, onAct}) {
    const [ask, A] = S(false), [note, N] = S(ASKS[0]);
    return h('li', {className: 'fw-item'},
      h('div', {className: 'fw-item-head'}, h('div', null, h('b', null, it.client + ' · ' + it.plan.mbps + ' Mb/s'), h('small', null, it.commune + ', ' + it.quartier)), h('span', {className: 'fw-chip is-' + it.status}, STATUS[it.status] || it.status)),
      it.photoUrls && h('div', {className: 'fw-thumbs'}, h('figure', null, h('img', {src: it.photoUrls.id, alt: 'Pièce d’identité de ' + it.client}), h('figcaption', null, 'Pièce d’identité')), h('figure', null, h('img', {src: it.photoUrls.home, alt: 'Façade du logement de ' + it.client}), h('figcaption', null, 'Façade'))),
      it.status === 'verification' && (ask ? h('div', {className: 'fw-ask'}, h('label', {className: 'fw-field'}, h('span', null, 'Ce que le client doit refaire'), h('select', {value: note, onChange: e => N(e.target.value)}, ASKS.map(a => h('option', {key: a, value: a}, a)))),
          h('div', {className: 'fw-row'}, h('button', {type: 'button', className: 'fw-btn is-main', disabled: busy, onClick: () => onAct(it, 'ask', note)}, 'Envoyer la demande'), h('button', {type: 'button', className: 'fw-btn', onClick: () => A(false)}, 'Annuler'))) :
        h('div', {className: 'fw-row'}, h('button', {type: 'button', className: 'fw-btn is-main', disabled: busy, onClick: () => onAct(it, 'validate')}, 'Valider le dossier'), h('button', {type: 'button', className: 'fw-btn', disabled: busy, onClick: () => A(true)}, 'Demander une autre photo'))),
      it.status === 'verification' && h('small', {className: 'fw-due' + (it.late ? ' is-late' : '')}, (it.late ? 'En retard : réponse promise ' : 'Réponse promise ') + clock(it.deadline)),
      (it.status === 'planifie' || it.status === 'en_route') && h('div', {className: 'fw-row'}, h('small', null, it.tech.name + ' · ' + slotText(it.slot)),
        h('button', {type: 'button', className: 'fw-btn is-main', disabled: busy, onClick: () => onAct(it, it.status === 'planifie' ? 'depart' : 'done')}, it.status === 'planifie' ? 'Le technicien part' : 'Installation terminée')),
      it.status === 'installe' && it.rating && h('small', null, 'Note du client : ' + '★'.repeat(it.rating) + (it.comment ? ' · « ' + it.comment + ' »' : '')));
  }

  function Block({api}) {
    const [d, D] = S(null), [busy, B] = S(false), [error, X] = S(''), alive = R(true);
    E(() => { alive.current = true; const load = () => { if (!document.hidden) api('/noc/welcome').then(x => alive.current && D(x)).catch(() => {}); }; load(); const t = setInterval(load, 6000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    async function act(it, action, note) { B(true); X(''); try { const r = await api('/noc/welcome', 'POST', {id: it.id, action, note}); if (alive.current) D(r); } catch (e) { if (alive.current) X(e.message || 'Action impossible.'); } finally { if (alive.current) B(false); } }
    return h('section', {className: 'gs-block fw-block', 'aria-labelledby': 'fw-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'fw-title'}, 'Nouveaux abonnés'), h('span', {className: 'gs-count'}, d.toCheck)),
      h('p', {className: 'gs-note'}, 'Dossiers à vérifier sous 24 h, puis rendez-vous et installation. Un conseiller valide, jamais Guardian seul.'),
      error && h('p', {className: 'gs-error', role: 'alert'}, error),
      d.items.length ? h('ul', {className: 'fw-items'}, d.items.map(it => h(Item, {key: it.id, it, busy, onAct: act})))
        : h('p', {className: 'gs-empty'}, 'Aucune nouvelle installation en cours.'));
  }

  root.FGWelcome = {View, Block, PLAN_KEY};
})(typeof window !== 'undefined' ? window : globalThis);
