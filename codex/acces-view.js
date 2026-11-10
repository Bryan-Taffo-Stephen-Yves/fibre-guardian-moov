// Fibre Access (thème 9) : la page « Offres solidaires » du client, son entrée dans « Mon compte » et le bloc du Superviseur.
// Les prix, les droits et les règles sont vérifiés par le serveur (acces.cjs) ; cet écran affiche et envoie.
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const money = n => Number(n || 0).toLocaleString('fr-FR') + ' F';
  const day = at => new Date(at).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long'});
  const fullDay = at => new Date(at).toLocaleDateString('fr-FR', {day: 'numeric', month: 'long', year: 'numeric'});
  const Svg = ({d, size = 22}) => h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, h('path', {d}));
  const CAP = 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5', HOMES = 'M3 11l5-4 5 4v8H3zM13 11l4-3 4 3v8h-8M7 19v-4h2v4', SPLIT = 'M4 6h16v12H4zM4 10h16M9 14h2M13 14h2';

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

  function Student({d, busy, send}) {
    const st = d.student, [school, SC] = S(''), [until, U] = S(''), [pic, P] = S(null), [err, X] = S('');
    const head = h('div', {className: 'ac-head'}, h('span', {className: 'ac-ico'}, h(Svg, {d: CAP})), h('div', null, h('h2', null, 'Tarif étudiant'), h('p', null, '−' + d.studentDiscount + ' % : votre forfait ' + d.plan.mbps + ' Mb/s passe de ' + money(d.plan.price) + ' à ' + money(d.studentPrice) + ' par mois.')));
    if (st && st.status === 'valide') return h('section', {className: 'ac-card is-on'}, head, h('p', {className: 'ac-ok'}, 'Tarif étudiant actif jusqu’au ' + fullDay(st.until) + ' · ' + st.school));
    if (st && st.status === 'verification') return h('section', {className: 'ac-card'}, head, h('p', {className: 'ac-wait'}, h('i', {className: 'ac-pulse', 'aria-hidden': true}), 'Un conseiller Moov vérifie votre carte avant le ' + day(st.deadline) + '. Vous serez prévenu.'));
    async function pick(e) { X(''); try { P(await shrink(e.target.files[0])); } catch (er) { X(er.message); } }
    return h('section', {className: 'ac-card'}, head,
      st && st.status === 'refuse' && h('p', {className: 'ac-note', role: 'alert'}, h('b', null, 'Votre conseiller vous demande : '), st.note),
      st && st.status === 'expire' && h('p', {className: 'ac-note'}, 'Votre carte a expiré : envoyez la nouvelle pour garder le tarif.'),
      h('form', {className: 'ac-form', onSubmit: e => { e.preventDefault(); if (!pic) { X('Ajoutez la photo de votre carte.'); return; } send({action: 'student', school, until: new Date(until + 'T23:59:00').getTime(), photo: pic}); }},
        h('label', {className: 'ac-field'}, h('span', null, 'Votre école ou université'), h('input', {value: school, onChange: e => SC(e.target.value), maxLength: 80, required: true, placeholder: 'Exemple : IUGB, Grand-Bassam'})),
        h('label', {className: 'ac-field'}, h('span', null, 'Carte valable jusqu’au'), h('input', {type: 'date', value: until, onChange: e => U(e.target.value), required: true})),
        h('label', {className: 'ac-photo' + (pic ? ' is-set' : '')}, pic ? h('img', {src: pic, alt: 'Votre carte étudiante'}) : h('span', {className: 'ac-photo-empty'}, h(Svg, {d: 'M4 7h3l2-3h6l2 3h3v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', size: 26})),
          h('span', null, h('b', null, pic ? 'Photo ajoutée' : 'Photo de la carte étudiante'), h('small', null, 'Effacée dès que le conseiller a vérifié.')),
          h('input', {type: 'file', accept: 'image/*', capture: 'environment', onChange: pick, className: 'ac-file'})),
        err && h('p', {className: 'fv-error', role: 'alert'}, err),
        h('button', {className: 'ac-go', disabled: busy}, 'Envoyer ma carte')));
  }

  function Pack({d, busy, send}) {
    const p = d.pack, [code, C] = S(''), [pick, PK] = S('');
    const head = h('div', {className: 'ac-head'}, h('span', {className: 'ac-ico'}, h(Svg, {d: HOMES})), h('div', null, h('h2', null, 'Pack voisins'), h('p', null, 'Jusqu’à 4 foyers de ' + d.commune + ' partagent un forfait puissant et son prix.')));
    if (p) {
      const msg = 'Rejoins mon Pack voisins Moov (' + p.mbps + ' Mb/s partagés) : ouvre l’appli Fibre Guardian, « Offres solidaires », et entre le code ' + p.code + '.';
      return h('section', {className: 'ac-card is-on'}, head,
        h('div', {className: 'ac-pack'}, h('div', null, h('small', null, 'Code à partager'), h('strong', null, p.code)), h('div', null, h('small', null, 'Vous payez'), h('strong', null, money(p.share)))),
        h('p', {className: 'ac-small'}, p.homes.length + ' foyer' + (p.homes.length > 1 ? 's' : '') + ' sur ' + p.max + ' · environ ' + p.mbpsEach + ' Mb/s garantis chacun, plus quand les voisins n’utilisent pas internet.' + (p.homes.length < p.max ? ' À ' + p.max + ' foyers : ' + money(Math.round(p.price / p.max / 50) * 50) + ' chacun.' : '')),
        h('ul', {className: 'ac-homes'}, p.homes.map((x, k) => h('li', {key: k, className: x.me ? 'is-me' : ''}, x.name + (x.me ? ' (vous)' : ''))), Array.from({length: p.max - p.homes.length}, (_, k) => h('li', {key: 'f' + k, className: 'is-free'}, 'Place libre'))),
        h('div', {className: 'ac-row'}, p.homes.length < p.max && h('a', {className: 'ac-btn is-main', href: 'https://wa.me/?text=' + encodeURIComponent(msg), target: '_blank', rel: 'noopener'}, 'Inviter sur WhatsApp'),
          h('button', {type: 'button', className: 'ac-link', disabled: busy, onClick: () => send({action: 'pack-leave'})}, 'Quitter le pack')));
    }
    return h('section', {className: 'ac-card'}, head,
      h('ul', {className: 'ac-offers'}, d.packs.map(o => h('li', {key: o.id, className: pick === o.id ? 'is-picked' : ''},
        h('div', null, h('b', null, o.name), h('small', null, money(o.price) + ' par mois pour ' + o.homes + ' foyers')),
        h('div', {className: 'ac-share'}, h('strong', null, money(o.share)), h('small', null, 'par foyer · ' + o.mbpsEach + ' Mb/s')),
        pick === o.id ? h('button', {type: 'button', className: 'ac-btn is-main', disabled: busy, onClick: () => send({action: 'pack-open', pack: o.id, confirm: true})}, 'Confirmer l’ouverture')
          : h('button', {type: 'button', className: 'ac-btn', onClick: () => PK(o.id)}, 'Ouvrir ce pack')))),
      h('form', {className: 'ac-join', onSubmit: e => { e.preventDefault(); send({action: 'pack-join', code}); }},
        h('label', {htmlFor: 'ac-code'}, 'Un voisin vous a donné un code ?'),
        h('div', null, h('input', {id: 'ac-code', value: code, onChange: e => C(e.target.value), placeholder: 'FAM-XXXX', maxLength: 10, autoCapitalize: 'characters', autoComplete: 'off', required: true}), h('button', {className: 'ac-btn', disabled: busy || !code.trim()}, 'Rejoindre'))));
  }

  function Split({d, busy, send, onPay}) {
    const e = d.split, [ask, A] = S(0);
    const head = h('div', {className: 'ac-head'}, h('span', {className: 'ac-ico'}, h(Svg, {d: SPLIT})), h('div', null, h('h2', null, 'Payer en plusieurs fois'), h('p', null, 'Un mois difficile ? Payez ' + d.splitMonth + ' en 2 ou 3 fois, sans frais, plutôt que de résilier.')));
    if (e) {
      const next = e.parts.findIndex(p => !p.paid);
      return h('section', {className: 'ac-card is-on'}, head,
        h('ol', {className: 'ac-parts'}, e.parts.map((p, k) => h('li', {key: k, className: p.paid ? 'is-paid' : k === next ? 'is-next' : ''},
          h('span', null, 'Part ' + (k + 1)), h('b', null, money(p.amount)), h('small', null, p.paid ? 'Payée le ' + day(p.paid) : k === 0 ? 'Aujourd’hui' : 'Le ' + day(p.due))))),
        next >= 0 ? h('button', {type: 'button', className: 'ac-go', disabled: busy, onClick: () => onPay(next, e.parts[next].amount)}, 'Payer la part ' + (next + 1) + ' avec Moov Money') : h('p', {className: 'ac-ok'}, 'Votre mois de ' + e.month + ' est entièrement payé. Merci !'));
    }
    const parts = n => { const one = Math.round(d.splitAmount / n / 50) * 50; return [d.splitAmount - one * (n - 1)].concat(Array(n - 1).fill(one)); };
    return h('section', {className: 'ac-card'}, head,
      h('div', {className: 'ac-row'}, [2, 3].map(n => h('button', {key: n, type: 'button', className: 'ac-choice' + (ask === n ? ' is-picked' : ''), onClick: () => A(n)}, h('b', null, n + ' fois'), h('small', null, parts(n).map(money).join(' + '))))),
      ask > 0 && h('button', {type: 'button', className: 'ac-go', disabled: busy, onClick: () => send({action: 'split', parts: ask, confirm: true})}, 'Payer ' + d.splitMonth + ' en ' + ask + ' fois'),
      h('p', {className: 'ac-small'}, 'Votre connexion reste active pendant tout le mois. Les dates de chaque part restent affichées ici.'));
  }

  function View({api, user}) {
    const [d, D] = S(null), [busy, B] = S(false), [error, X] = S(''), [pay, P] = S(null);
    E(() => { api('/acces').then(D).catch(e => X(e.message)); }, []);
    async function send(body) { B(true); X(''); try { D(await api('/acces', 'POST', body)); } catch (e) { X(e.message); } finally { B(false); } }
    if (!d) return h('div', {className: 'ac-page'}, error ? h('p', {className: 'fv-error', role: 'alert'}, error) : h('p', {className: 'ac-small'}, 'Un instant…'));
    const account = 'FIBRE-' + String(user?.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
    return h('div', {className: 'ac-page'},
      h('header', {className: 'ac-top'}, h('h1', null, 'Offres solidaires'), h('p', null, 'La fibre pour tous les budgets : étudiants, voisins qui partagent, mois difficiles.')),
      error && h('p', {className: 'fv-error', role: 'alert'}, error),
      h(Student, {d, busy, send}), h(Pack, {d, busy, send}), h(Split, {d, busy, send, onPay: (part, amount) => P({part, amount})}),
      pay && root.FGPay && h(root.FGPay.Checkout, {quote: {amount: pay.amount, label: 'Part ' + (pay.part + 1) + ' de votre facture de ' + d.splitMonth, period: d.splitMonth + ' · part ' + (pay.part + 1)}, customer: {name: user?.name, phone: user?.phone || ''}, account, backLabel: 'Retour aux offres',
        onPay: async () => { D(await api('/acces', 'POST', {action: 'split-pay', part: pay.part})); }, onDone: () => P(null), onClose: () => P(null)}));
  }

  // Dans « Mon compte » : l'entrée vers les offres solidaires.
  function Entry({onOpen}) {
    return h('button', {type: 'button', className: 'ac-entry', onClick: onOpen},
      h('span', {className: 'ac-ico'}, h(Svg, {d: HOMES})),
      h('span', null, h('strong', null, 'Offres solidaires'), h('small', null, 'Tarif étudiant, pack voisins, payer en plusieurs fois')),
      h(Svg, {d: 'm9 6 6 6-6 6', size: 20}));
  }

  // Superviseur : cartes étudiantes à vérifier (photo effacée après la décision), packs et paiements en plusieurs fois.
  function Block({api}) {
    const [d, D] = S(null), [busy, B] = S(false), [error, X] = S(''), [refusing, RF] = S(''), alive = R(true);
    const REASONS = ['La photo est floue', 'La date de validité est illisible', 'Le nom ne correspond pas au compte'];
    const [reason, RE] = S(REASONS[0]);
    E(() => { alive.current = true; const load = () => { if (!document.hidden) api('/noc/acces').then(x => alive.current && D(x)).catch(() => {}); }; load(); const t = setInterval(load, 10000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    async function decide(id, decision) { B(true); X(''); try { D(await api('/noc/acces', 'POST', {id, decision, note: decision === 'refuse' ? reason : undefined})); RF(''); } catch (e) { X(e.message); } finally { B(false); } }
    return h('section', {className: 'gs-block ac-block', 'aria-labelledby': 'ac-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'ac-title'}, 'Offres solidaires'), h('span', {className: 'gs-count'}, d.cards.length)),
      h('dl', {className: 'ac-kpis'}, [[d.students, 'étudiants au tarif réduit'], [d.homes, 'foyers en pack voisins'], [d.splits, 'mois payés en plusieurs fois']].map(([v, l]) => h('div', {key: l}, h('dt', null, v), h('dd', null, l)))),
      error && h('p', {className: 'fv-error', role: 'alert'}, error),
      d.cards.length ? h('ul', {className: 'ac-cards'}, d.cards.map(c => h('li', {key: c.id},
        h('div', {className: 'ac-card-head'}, h('div', null, h('b', null, c.name), h('small', null, c.school + ' · valable jusqu’au ' + fullDay(c.until))), h('span', {className: 'ac-due' + (c.late ? ' is-late' : '')}, c.late ? 'En retard' : 'Avant ' + day(c.deadline))),
        c.photo && h('img', {className: 'ac-thumb', src: c.photo, alt: 'Carte étudiante de ' + c.name}),
        refusing === c.id ? h('div', {className: 'ac-row'}, h('select', {className: 'ac-select', value: reason, onChange: e => RE(e.target.value), 'aria-label': 'Motif'}, REASONS.map(r => h('option', {key: r}, r))), h('button', {type: 'button', className: 'ac-btn', disabled: busy, onClick: () => decide(c.id, 'refuse')}, 'Envoyer'), h('button', {type: 'button', className: 'ac-link', onClick: () => RF('')}, 'Annuler'))
          : h('div', {className: 'ac-row'}, h('button', {type: 'button', className: 'ac-btn is-main', disabled: busy, onClick: () => decide(c.id, 'valide')}, 'Valider la carte'), h('button', {type: 'button', className: 'ac-btn', disabled: busy, onClick: () => RF(c.id)}, 'Demander une autre photo')))))
        : h('p', {className: 'gs-empty'}, 'Aucune carte étudiante à vérifier.'),
      d.left > 0 && h('p', {className: 'gs-note'}, money(d.left) + ' encore attendus sur les paiements en plusieurs fois de ce mois.'));
  }

  root.FGAcces = {View, Entry, Block};
})(typeof window !== 'undefined' ? window : globalThis);
