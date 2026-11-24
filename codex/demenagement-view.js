// Déménagement (demenagement.cjs), dans Mon compte : « Je déménage », la nouvelle adresse et le jour de l'installation,
// puis le suivi (appel du conseiller, installation, fibre active). L'avis du client passe par « Ma réparation » (service client).
(function (root) {
  'use strict';
  const h = React.createElement, S = React.useState, E = React.useEffect;
  const up = t => t.replace(/^\w/, c => c.toUpperCase());

  function Card({api}) {
    const [d, D] = S(null), [open, O] = S(false), [busy, B] = S(false), [error, X] = S(''), [sure, U] = S(false);
    const [commune, C] = S(''), [day, Y] = S(null), [slot, L] = S('matin');
    const load = () => api('/demenagement').then(D).catch(() => {});
    E(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 15000); return () => clearInterval(t); }, []);
    if (!d) return null;
    const Icon = root.FGClientHome?.Icon || (() => null);
    async function send(body) { B(true); X(''); try { D(await api('/demenagement', 'POST', body)); O(false); U(false); } catch (e) { X(e.message); } finally { B(false); } }
    const c = d.current;

    if (c) return h('section', {className: 'ch-group dm-card' + (c.late ? ' is-late' : '') + (c.status === 'fait' ? ' is-done' : ''), 'aria-labelledby': 'dm-title'},
      h('h2', {id: 'dm-title'}, c.status === 'fait' ? 'Déménagement terminé' : 'Mon déménagement'),
      h('p', {className: 'dm-address'}, h('b', null, c.quartier + ', ' + c.commune), c.repere && h('small', null, c.repere), c.when && h('small', null, c.when)),
      h('ol', {className: 'sc-steps dm-steps', style: {gridTemplateColumns: 'repeat(' + c.steps.length + ',1fr)'}}, c.steps.map((s, k) => h('li', {key: k, className: s.done ? 'is-done' : ''}, h('span', {'aria-hidden': true}, s.done ? '✓' : k + 1), s.label))),
      h('p', {className: 'dm-text'}, c.text),
      c.status === 'fait' && h('p', {className: 'dm-hint'}, 'Dites-nous si tout va bien dans « Ma réparation ».'),
      error && h('p', {className: 'dm-error', role: 'alert'}, error),
      c.canCancel && (sure
        ? h('div', {className: 'dm-actions'}, h('button', {type: 'button', className: 'dm-main', disabled: busy, onClick: () => send({action: 'cancel'})}, busy ? 'Annulation…' : 'Oui, annuler'), h('button', {type: 'button', className: 'dm-link', disabled: busy, onClick: () => U(false)}, 'Non, garder ma demande'))
        : h('button', {type: 'button', className: 'dm-link', onClick: () => U(true)}, 'Annuler mon déménagement')));

    if (!open) return h('section', {className: 'ch-group'},
      h('button', {type: 'button', className: 'ch-row', onClick: () => { O(true); X(''); }},
        h('span', {className: 'ch-row-icon'}, h(Icon, {name: 'truck', size: 19})),
        h('span', null, h('b', null, 'Je déménage'), h('small', null, 'Votre fibre vous suit à votre nouvelle adresse')),
        h(Icon, {name: 'chevron', size: 18})));

    const covered = d.zone.includes(commune), picked = d.choices.find(x => x.day === day) || d.choices[0];
    function submit(e) {
      e.preventDefault(); const f = e.currentTarget.elements;
      send({action: 'ask', commune, quartier: f.quartier.value, repere: f.repere.value, day: covered ? picked.day : undefined, slot: covered ? slot : undefined});
    }
    return h('form', {className: 'ch-group dm-card', 'aria-labelledby': 'dm-title', onSubmit: submit},
      h('h2', {id: 'dm-title'}, 'Je déménage'),
      h('p', {className: 'dm-text'}, 'Donnez votre nouvelle adresse. Un conseiller vous appelle pour tout confirmer, puis le technicien installe la fibre chez vous.'),
      h('label', {className: 'dm-field'}, 'Nouvelle commune',
        h('select', {value: commune, onChange: e => C(e.target.value), required: true, disabled: busy},
          h('option', {value: ''}, 'Choisissez…'),
          h('optgroup', {label: 'Fibre Moov disponible'}, d.zone.map(z => h('option', {key: z, value: z}, z))),
          h('optgroup', {label: 'Autres communes'}, d.other.map(z => h('option', {key: z, value: z}, z))))),
      h('label', {className: 'dm-field'}, 'Quartier', h('input', {name: 'quartier', required: true, minLength: 2, maxLength: 60, disabled: busy, placeholder: 'Exemple : Riviera Palmeraie'})),
      h('label', {className: 'dm-field'}, 'Un repère (facultatif)', h('input', {name: 'repere', maxLength: 120, disabled: busy, placeholder: 'Exemple : derrière la pharmacie'})),
      commune && !covered && h('p', {className: 'dm-warn', role: 'status'}, 'La fibre Moov n’arrive pas encore à ' + commune + '. Envoyez quand même : un conseiller vous appelle pour chercher une solution avec vous.'),
      covered && h('div', {className: 'dm-when'},
        h('b', null, 'Quand voulez-vous la fibre là-bas ?'),
        h('div', {className: 'dm-days', role: 'radiogroup', 'aria-label': 'Jour de l’installation'},
          d.choices.map(x => h('button', {key: x.day, type: 'button', role: 'radio', 'aria-checked': picked.day === x.day, className: 'rv-day' + (picked.day === x.day ? ' is-on' : ''), disabled: busy, onClick: () => Y(x.day)},
            h('b', null, up(x.label.split(' ')[0])), h('small', null, x.label.split(' ').slice(1).join(' '))))),
        h('div', {className: 'rv-slots', role: 'radiogroup', 'aria-label': 'Moment de la journée'},
          d.slots.map(x => h('button', {key: x.id, type: 'button', role: 'radio', 'aria-checked': slot === x.id, className: 'rv-slot' + (slot === x.id ? ' is-on' : ''), disabled: busy, onClick: () => L(x.id)}, x.id === 'matin' ? 'Le matin' : 'L’après-midi', h('small', null, x.label)))),
        h('small', {className: 'dm-hint'}, 'Votre adresse actuelle garde internet jusqu’à ce jour-là.')),
      error && h('p', {className: 'dm-error', role: 'alert'}, error),
      h('div', {className: 'dm-actions'},
        h('button', {type: 'submit', className: 'dm-main', disabled: busy || !commune}, busy ? 'Envoi…' : 'Envoyer ma demande'),
        h('button', {type: 'button', className: 'dm-link', disabled: busy, onClick: () => O(false)}, 'Annuler')));
  }

  root.FGDemenagement = {Card};
})(typeof window !== 'undefined' ? window : globalThis);
