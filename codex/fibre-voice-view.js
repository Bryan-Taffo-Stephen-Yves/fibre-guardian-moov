// Fibre Voice (thème 8) : parler à Guardian au lieu d'écrire. Pensé pour qui lit peu ou n'aime pas taper :
// un grand micro, quatre phrases en images, la réponse lue à voix haute, et un « oui » suffit pour agir.
// View : page client « Parler à Guardian ». Entry : grande carte sur l'accueil. Block : ce que les clients demandent, côté Moov.
// Guardian répond avec le même moteur que la conversation écrite (/journey/action, type chat) ; rien ne se fait sans un « oui ».
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const LANG_KEY = 'fg-voix-langue', MIC_KEY = 'fg-micro';
  const store = {get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }};
  const LANGS = [['fr', 'Français'], ['nouchi', 'Nouchi'], ['dioula', 'Dioula']];
  // Les quatre demandes les plus fréquentes, dites comme un client les dirait dans chaque langue.
  const PHRASES = [
    {id: 'coupure', label: 'Internet ne marche plus', icon: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18', say: {fr: 'Internet ne marche plus chez moi', nouchi: 'Ma connexion est gâtée deh, y a fohi', dioula: 'A tɛ taa, n ka connexion tigɛra'}},
    {id: 'lent', label: 'Internet est lent', icon: 'M4.5 17a8.5 8.5 0 1 1 15 0M12 13l-3-4', say: {fr: 'Internet est très lent', nouchi: 'La connexion traîne trop deh', dioula: 'N ka connexion man nyi'}},
    {id: 'suivi', label: 'Où est le technicien ?', icon: 'M4 5h11v12H4zM15 9h4l3 4v4h-7M8 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4M18 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4', say: {fr: 'Le technicien arrive quand ?', nouchi: 'Moov arrive quand deh ?', dioula: 'Moov bɛ na tuma jumɛn ?'}},
    {id: 'reboot', label: 'Redémarrer ma box', icon: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', say: {fr: 'Redémarre ma box', nouchi: 'Redémarre ma box deh', dioula: 'I ka n ka box redémarrer'}}
  ];
  const YES = /^(oui|ouais|ouai|d'accord|dac|vas-y|vas y|ok|okay|c'est bon|bien sûr|exactement|awɔ|awo|owo|on fait ça)(?=$|[\s,.!?])/i;
  const NO = /^(non|nan|pas maintenant|laisse|ayi|attends|stop|arrête)(?=$|[\s,.!?])/i;
  const Speech = () => root.SpeechRecognition || root.webkitSpeechRecognition || null;
  const Svg = ({d, size = 26}) => h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, h('path', {d}));
  const MIC = 'M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 18v3';
  // Ce que Guardian propose après sa réponse, selon l'action de son message.
  const NEXT = {reboot: {ask: 'Voulez-vous que je redémarre votre box ? Dites oui, ou touchez le bouton.', yes: 'Oui, redémarre ma box'},
    tracking: {go: 'tracking', label: 'Voir le technicien'}, report: {go: 'report', label: 'Signaler la panne'}, devices: {go: 'devices', label: 'Voir mes appareils'}};

  function View({api, state, onState, onNavigate}) {
    const [lang, L] = S(() => store.get(LANG_KEY) || 'fr'), [heard, HE] = S(''), [listening, LI] = S(false), [busy, B] = S(false), [error, X] = S(''), [confirm, CF] = S(null), [done, DN] = S('');
    const rec = R(null), stateRef = R(state), mode = R('ask'), v = root.FGVoice ? FGVoice.useVoice() : {speakingId: null}, wasSpeaking = R(false);
    stateRef.current = state;
    const answerRef = R(null), seen = R(null);
    const can = !!Speech(), last = [...state.messages].reverse().find(m => m.role === 'assistant'), question = last && state.messages[state.messages.indexOf(last) - 1];
    E(() => () => { try { rec.current && rec.current.abort(); } catch (e) {} root.FGVoice && FGVoice.stop(); }, []);
    // Après une question, Guardian écoute tout seul la réponse « oui » ou « non » dès qu'il a fini de parler.
    E(() => { const speaking = !!v.speakingId; if (wasSpeaking.current && !speaking && confirm && can && store.get(MIC_KEY) === '1') listen('auto'); wasSpeaking.current = speaking; }, [v.speakingId]);
    // Une nouvelle réponse arrive : elle se place sous les yeux du client (la page s'ouvre sans bouger).
    E(() => { const id = last && last.id; if (seen.current !== null && id && id !== seen.current && answerRef.current && answerRef.current.scrollIntoView) answerRef.current.scrollIntoView({behavior: 'smooth', block: 'start'}); seen.current = id || ''; }, [last && last.id]);
    function say(text, id) { if (root.FGVoice) FGVoice.speak({id: id || 'fv-' + Date.now(), text}); }
    function setLang(k) { L(k); store.set(LANG_KEY, k); }
    async function ask(text) {
      text = String(text || '').trim(); if (!text || busy) return;
      B(true); X(''); DN(''); CF(null); HE(text);
      try {
        const r = await api('/journey/action', 'POST', {type: 'chat', text, channel: 'voix', version: stateRef.current.version});
        onState(r.state); const m = [...r.state.messages].reverse().find(x => x.role === 'assistant'), next = m && NEXT[m.action];
        const allowed = next && next.ask && !r.state.sharedIncident && r.state.metrics.state !== 'redémarrage';
        if (allowed) CF({type: m.action}); say(m ? m.text + (allowed ? ' ' + next.ask : '') : 'Je n’ai pas compris. Redites-le autrement.', m && m.id);
      } catch (e) { X(e.message || 'Guardian ne répond pas. Réessayez.'); say(e.message || 'Guardian ne répond pas. Réessayez.'); }
      finally { B(false); HE(''); }
    }
    async function yes() {
      if (!confirm || busy) return; B(true); X('');
      try {
        const r = await api('/journey/action', 'POST', {type: confirm.type, confirm: true, version: stateRef.current.version});
        onState(r.state); CF(null); const text = 'C’est fait. Votre box redémarre\u00a0: internet revient dans quelques secondes.'; DN(text); say(text);
      } catch (e) { CF(null); X(e.message); say(e.message); } finally { B(false); }
    }
    function no() { CF(null); const text = 'D’accord, je ne touche à rien.'; DN(text); say(text); }
    function listen(why) {
      const Rec = Speech(); if (!Rec) { X('Ce navigateur ne sait pas écouter la voix. Touchez une phrase ci-dessous, Guardian vous répond.'); return; }
      if (listening) { try { rec.current.stop(); } catch (e) {} return; }
      store.set(MIC_KEY, '1'); root.FGVoice && FGVoice.stop(); mode.current = why || 'ask';
      const r = new Rec(); rec.current = r; r.lang = 'fr-FR'; r.interimResults = true; r.maxAlternatives = 1;
      r.onstart = () => { LI(true); X(''); HE(''); };
      r.onend = () => LI(false);
      r.onerror = e => { LI(false); if (mode.current === 'auto' || (e && e.error === 'aborted')) return; X(e && e.error === 'no-speech' ? 'Je n’ai rien entendu. Touchez le micro et parlez près du téléphone.' : e && e.error === 'not-allowed' ? 'Le micro est bloqué. Autorisez le micro pour ce site, ou touchez une phrase ci-dessous.' : 'Le micro n’a pas pu démarrer. Touchez une phrase ci-dessous.'); };
      r.onresult = e => {
        let said = '', final = false; for (const x of e.results) { said += x[0].transcript; final = final || x.isFinal; }
        HE(said); if (!final) return; try { r.stop(); } catch (er) {}
        const t = said.trim().replace(/’/g, "'"), wait = mode.current !== 'ask'; if (wait && YES.test(t)) yes(); else if (wait && NO.test(t)) no(); else ask(t);
      };
      try { r.start(); } catch (e) { LI(false); X('Le micro n’a pas pu démarrer. Touchez une phrase ci-dessous.'); }
    }
    const next = last && NEXT[last.action];
    return h('div', {className: 'fv-page'},
      h('header', {className: 'fv-head'}, h('h1', null, 'Parler à Guardian'), h('p', null, 'Dites ce qui ne va pas, comme à un voisin. Guardian vous répond à voix haute.')),
      h('div', {className: 'fv-langs', role: 'radiogroup', 'aria-label': 'Langue des phrases'}, LANGS.map(([k, label]) => h('button', {key: k, type: 'button', role: 'radio', 'aria-checked': lang === k, className: lang === k ? 'is-on' : '', onClick: () => setLang(k)}, label))),
      h('section', {className: 'fv-stage' + (listening ? ' is-listening' : busy ? ' is-busy' : '')},
        h('button', {type: 'button', className: 'fv-mic', disabled: !can || busy, onClick: () => listen(confirm ? 'confirm' : 'ask'), 'aria-pressed': listening, 'aria-label': listening ? 'Arrêter d’écouter' : 'Parler à Guardian'},
          h('span', {className: 'fv-ring', 'aria-hidden': true}), h('span', {className: 'fv-ring two', 'aria-hidden': true}), h(Svg, {d: MIC, size: 44})),
        h('p', {className: 'fv-status', 'aria-live': 'polite'}, listening ? (heard || 'Je vous écoute…') : busy ? (heard ? '« ' + heard + ' »' : 'Je regarde votre ligne…') : !can ? 'Sur ce téléphone, touchez une phrase ci-dessous.' : confirm ? 'Dites « oui » ou « non »' : 'Touchez le micro et parlez'),
        lang === 'dioula' && h('small', {className: 'fv-hint'}, 'Le micro comprend surtout le français. En dioula, touchez une phrase : Guardian la comprend.')),
      error && h('p', {className: 'fv-error', role: 'alert'}, error),
      (last || done) && !busy && h('section', {ref: answerRef, className: 'fv-answer', 'aria-live': 'polite'},
        question && h('p', {className: 'fv-asked'}, 'Vous : « ' + question.text + ' »'),
        last && h('p', {className: 'fv-said'}, last.text),
        last && last.voice && last.voice.text && h('p', {className: 'fv-dioula', lang: 'dyu'}, last.voice.text),
        done && h('p', {className: 'fv-done'}, done),
        h('div', {className: 'fv-actions'},
          confirm ? [h('button', {key: 'y', type: 'button', className: 'fv-btn is-yes', disabled: busy, onClick: yes}, NEXT[confirm.type].yes), h('button', {key: 'n', type: 'button', className: 'fv-btn', disabled: busy, onClick: no}, 'Non merci')]
            : next && next.go && h('button', {type: 'button', className: 'fv-btn is-yes', onClick: () => onNavigate(next.go)}, next.label),
          last && h('button', {type: 'button', className: 'fv-btn', onClick: () => say(last.text, last.id)}, h(Svg, {d: 'M4 9h3l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6', size: 18}), 'Réécouter'))),
      h('h2', {className: 'fv-sub'}, 'Ou touchez ce qui vous arrive'),
      h('div', {className: 'fv-phrases'}, PHRASES.map(p => h('button', {key: p.id, type: 'button', className: 'fv-phrase', disabled: busy, onClick: () => ask(p.say[lang] || p.say.fr)},
        h('span', {className: 'fv-phrase-icon'}, h(Svg, {d: p.icon})), h('b', null, p.label), lang !== 'fr' && h('small', {lang: lang === 'dioula' ? 'dyu' : 'fr'}, '« ' + p.say[lang] + ' »')))),
      h('p', {className: 'fv-privacy'}, 'Le micro de votre téléphone transforme votre voix en texte. Moov n’enregistre jamais le son.'));
  }

  // Sur l'accueil : l'entrée la plus visible pour qui préfère parler.
  function Entry({onOpen}) {
    return h('button', {type: 'button', className: 'fv-entry', onClick: onOpen},
      h('span', {className: 'fv-entry-mic'}, h(Svg, {d: MIC, size: 28})),
      h('span', null, h('strong', null, 'Parler à Guardian'), h('small', null, 'Dites ce qui ne va pas, il vous répond à voix haute.')));
  }

  // Côté Moov (Superviseur) : ce que les clients demandent quand ils parlent, sur 7 jours. Ni son ni phrase : le sujet et la langue.
  const LANG_NAME = {fr: 'Français', nouchi: 'Nouchi', dioula: 'Dioula', autre: 'Autre'};
  function Block({api}) {
    const [d, D] = S(null), alive = R(true);
    E(() => { alive.current = true; const load = () => { if (!document.hidden) api('/noc/voix').then(x => alive.current && D(x)).catch(() => {}); }; load(); const t = setInterval(load, 10000); return () => { alive.current = false; clearInterval(t); }; }, []);
    if (!d) return null;
    const top = d.subjects[0] ? d.subjects[0].count : 1;
    return h('section', {className: 'gs-block fv-block', 'aria-labelledby': 'fv-title'},
      h('div', {className: 'gs-block-head'}, h('h3', {id: 'fv-title'}, 'Ce que les clients demandent à la voix'), h('span', {className: 'gs-count'}, d.today)),
      d.total ? h(React.Fragment, null,
        h('p', {className: 'gs-note'}, d.total + ' question' + (d.total > 1 ? 's' : '') + ' posée' + (d.total > 1 ? 's' : '') + ' à la voix par ' + d.clients + ' client' + (d.clients > 1 ? 's' : '') + ' en 7 jours.'),
        d.subjects.length > 0 && h('ul', {className: 'fv-bars'}, d.subjects.map(s => h('li', {key: s.subject}, h('span', null, s.subject), h('i', {'aria-hidden': true}, h('b', {style: {width: Math.max(8, Math.round(s.count / top * 100)) + '%'}})), h('em', null, s.count)))),
        h('p', {className: 'fv-langline'}, d.langs.map(l => LANG_NAME[l.lang] + ' ' + l.count).join(' · ')))
        : h('p', {className: 'gs-empty'}, 'Aucune question à la voix pour l’instant. Les clients trouvent « Parler à Guardian » sur leur accueil.'));
  }

  root.FGFibreVoice = {View, Entry, Block, PHRASES, YES, NO};
})(typeof window !== 'undefined' ? window : globalThis);
