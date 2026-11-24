// Échange de box (echange-box.cjs) : la demande et son suivi dans « Ma réparation » (client),
// le bloc « Échanges de box » dans le Superviseur (onglet Clients et offres).
(function (root) {
  'use strict';
  const h = React.createElement, S = React.useState, E = React.useEffect, R = React.useRef;
  const STEPS = {agence: [['demandee', 'Demande reçue'], ['prete', 'Box prête en agence'], ['echangee', 'Box échangée']], technicien: [['demandee', 'Demande reçue'], ['envoye', 'Technicien prévu'], ['echangee', 'Box échangée']]};

  // Côté client. Le formulaire s'ouvre quand Guardian l'a proposé (bouton « Échanger ma box ») ou via « Ma box ne s'allume plus ».
  function Card({api}) {
    const [d, D] = S(null), [form, F] = S(false), [mode, M] = S('technicien'), [busy, B] = S(false), [error, X] = S('');
    E(() => {
      let alive = true; const load = () => { if (!document.hidden) api('/echange-box').then(x => alive && D(x)).catch(() => {}); };
      load(); const t = setInterval(load, 10000);
      try { if (sessionStorage.getItem('fg-echange') === '1') { sessionStorage.removeItem('fg-echange'); F(true); } } catch (e) {}
      return () => { alive = false; clearInterval(t); };
    }, []);
    if (!d) return null;
    async function send(e) {
      e.preventDefault(); if (busy) return;
      const f = Object.fromEntries(new FormData(e.currentTarget));
      B(true); X('');
      try { D(await api('/echange-box', 'POST', {mode, agence: f.agence, slot: f.slot, tried: f.tried === 'on', reason: f.reason || ''})); F(false); }
      catch (err) { X(err.message); } finally { B(false); }
    }
    async function cancel() { B(true); X(''); try { D(await api('/echange-box', 'POST', {action: 'cancel'})); } catch (err) { X(err.message); } finally { B(false); } }
    const c = d.current;
    if (c) {
      const steps = STEPS[c.mode], at = steps.findIndex(s => s[0] === c.status);
      return h('section', {className: 'eb-card' + (c.status === 'echangee' ? ' is-done' : ''), 'aria-labelledby': 'eb-title'},
        h('h2', {id: 'eb-title'}, c.status === 'echangee' ? 'Votre box est échangée' : 'Échange de votre box'),
        h('ol', {className: 'eb-steps'}, steps.map(([k, label], i) => h('li', {key: k, className: i <= at ? 'is-done' : '', 'aria-current': i === at ? 'step' : undefined}, h('span', {'aria-hidden': true}, i < at || c.status === 'echangee' ? '✓' : i + 1), label))),
        c.mode === 'agence' && c.status !== 'echangee' && h('p', null, (c.status === 'prete' ? 'Votre box neuve vous attend à l’' : 'Nous préparons votre box neuve à l’') + c.agence.replace(/^Agence/, 'agence') + '. Code de retrait : ', h('b', {className: 'eb-code'}, c.code), '.'),
        c.mode === 'technicien' && c.status !== 'echangee' && h('p', null, 'Un technicien apporte votre box neuve ', h('b', null, c.when), '. Préparez l’ancienne box et son chargeur.'),
        error && h('p', {className: 'eb-error', role: 'alert'}, error),
        c.status === 'demandee' && h('button', {type: 'button', className: 'eb-link', disabled: busy, onClick: cancel}, 'Annuler la demande'));
    }
    if (!form) return h('button', {type: 'button', className: 'eb-open', onClick: () => F(true)}, 'Ma box ne s’allume plus');
    return h('form', {className: 'eb-card', onSubmit: send, 'aria-labelledby': 'eb-title'},
      h('h2', {id: 'eb-title'}, 'Échanger ma box'),
      h('p', null, 'Une box qui ne s’allume plus se remplace, gratuitement sous garantie.'),
      h('label', {className: 'eb-check'}, h('input', {type: 'checkbox', name: 'tried', required: true, disabled: busy}), 'J’ai branché la box sur une autre prise qui marche : elle reste éteinte.'),
      h('div', {className: 'eb-modes', role: 'radiogroup', 'aria-label': 'Comment recevoir la box neuve'},
        [['technicien', 'Un technicien chez moi', 'Il apporte la box et branche tout'], ['agence', 'Je passe en agence', 'Avec un code de retrait']].map(([k, t, sub]) =>
          h('button', {type: 'button', key: k, role: 'radio', 'aria-checked': mode === k, className: 'eb-mode' + (mode === k ? ' is-on' : ''), onClick: () => M(k), disabled: busy}, h('b', null, t), h('small', null, sub)))),
      mode === 'technicien'
        ? h('label', null, 'Quand ? ' + d.day, h('select', {name: 'slot', defaultValue: 'matin', disabled: busy}, d.slots.map(s => h('option', {key: s.id, value: s.id}, s.label.replace(/^entre /, 'Entre ')))))
        : h('label', null, 'Votre agence', h('select', {name: 'agence', defaultValue: d.agences[0].id, disabled: busy}, d.agences.map(a => h('option', {key: a.id, value: a.id}, a.name)))),
      h('label', null, 'Ce qui s’est passé (facultatif)', h('textarea', {name: 'reason', rows: 2, maxLength: 300, disabled: busy, placeholder: 'Exemple : après la coupure de courant d’hier soir'})),
      error && h('p', {className: 'eb-error', role: 'alert'}, error),
      h('div', {className: 'eb-actions'},
        h('button', {type: 'submit', className: 'eb-main', disabled: busy}, busy ? 'Envoi…' : 'Demander l’échange'),
        h('button', {type: 'button', className: 'eb-link', disabled: busy, onClick: () => F(false)}, 'Annuler')));
  }

  // Côté Moov : demandes à traiter, la plus ancienne d'abord.
  function Block({api}) {
    const [d, D] = S(null), [busy, B] = S(false), [error, X] = S(''), alive = R(true);
    const load = () => { if (!document.hidden) api('/noc/echanges').then(x => alive.current && D(x)).catch(() => {}); };
    E(() => { alive.current = true; load(); const t = setInterval(load, 10000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    async function go(id, to) { B(true); X(''); try { D(await api('/noc/echanges', 'POST', {id, to})); } catch (e) { X(e.message); } finally { B(false); } }
    const next = r => ({demandee: r.mode === 'agence' ? ['prete', 'Box prête en agence'] : ['envoye', 'Technicien envoyé'], prete: ['echangee', 'Box remise au client'], envoye: ['echangee', 'Box échangée chez le client']})[r.status];
    return h('section', {className: 'gs-block eb-block', 'aria-labelledby': 'eb-block-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'eb-block-title'}, 'Échanges de box'), h('span', {className: 'gs-count' + (d.open.some(r => r.late) ? ' av-alarm' : '')}, d.open.length)),
      error && h('p', {className: 'fw-error', role: 'alert'}, error),
      d.open.length ? h('ul', {className: 'av-calls'}, d.open.map(r => h('li', {key: r.id, className: 'av-call' + (r.late ? ' is-late' : '')},
        h('div', {className: 'av-call-head'}, h('div', null, h('b', null, r.name), h('small', null, r.mode === 'agence' ? r.agence + ' · code ' + r.code : 'Chez le client · ' + r.when)), h('span', {className: 'rc-level'}, r.step)),
        r.reason && h('p', {className: 'av-quote'}, '« ' + r.reason + ' »'),
        h('button', {type: 'button', className: 'av-btn is-main', disabled: busy, onClick: () => go(r.id, next(r)[0])}, next(r)[1]))))
        : h('p', {className: 'gs-empty'}, 'Aucune box à échanger. ' + (d.done ? d.done + ' échangée' + (d.done > 1 ? 's' : '') + ' cette semaine.' : 'Quand Guardian voit une box qui ne s’allume plus, le client peut demander l’échange en un geste.')));
  }

  root.FGEchange = {Card, Block};
})(typeof window !== 'undefined' ? window : globalThis);
