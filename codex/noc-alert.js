// Alerte de l'équipe Moov : dès que Guardian repère une panne sur les mesures, un bandeau apparaît
// sur toutes les pages du portail, avec un son court, le quartier, le nombre de clients touchés
// et l'avance prise sur le premier client qui se plaint.
(function (root) {
  'use strict';
  const h = (...a) => root.React.createElement(...a), {useState, useEffect, useRef} = root.React || {};
  const KEY = 'fg-noc-alerts-seen', FRESH = 15 * 60000;
  const readSeen = () => { try { return new Set(JSON.parse(root.sessionStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
  const writeSeen = set => { try { root.sessionStorage.setItem(KEY, JSON.stringify([...set].slice(-50))); } catch { /* navigation privée : on garde en mémoire */ } };

  // Durée lisible : « 8 s », « 2 min 10 s », « 1 h 05 ».
  function span(ms) {
    const t = Math.max(0, Math.round(ms / 1000)), m = Math.floor(t / 60), s = t % 60;
    if (t < 60) return t + ' s';
    if (m < 60) return m + ' min' + (s ? ' ' + String(s).padStart(2, '0') + ' s' : '');
    return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  }
  // Deux notes brèves, sans fichier son. Le navigateur peut refuser avant le premier geste : on n'insiste pas.
  function chime() {
    try {
      const Ctx = root.AudioContext || root.webkitAudioContext; if (!Ctx) return;
      const ctx = new Ctx(), now = ctx.currentTime;
      [[880, 0], [660, .18]].forEach(([f, d]) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; o.type = 'sine'; g.gain.setValueAtTime(0, now + d); g.gain.linearRampToValueAtTime(.18, now + d + .02); g.gain.exponentialRampToValueAtTime(.001, now + d + .32); o.connect(g).connect(ctx.destination); o.start(now + d); o.stop(now + d + .34); });
      setTimeout(() => ctx.close?.(), 800);
    } catch { /* pas de son possible */ }
    try { root.navigator?.vibrate?.([120, 60, 120]); } catch { /* pas de vibration */ }
  }
  function place(segment) {
    const info = root.FGAbidjan?.SEGMENTS?.[segment], commune = info && root.FGAbidjan.COMMUNES.find(c => c.id === info.commune);
    return info ? info.area + ', ' + (commune?.name || '') : segment;
  }

  function Banner({alerts = [], onOpen}) {
    const [seen, setSeen] = useState(readSeen), [now, setNow] = useState(Date.now()), rung = useRef(new Set());
    const live = alerts.filter(a => !seen.has(a.id) && Date.now() - a.detectedAt < FRESH);
    useEffect(() => { if (!live.length) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [live.length]);
    // Son et titre d'onglet seulement pour une panne repérée pendant que la page est ouverte.
    useEffect(() => {
      const fresh = live.filter(a => !rung.current.has(a.id) && Date.now() - a.detectedAt < 60000);
      live.forEach(a => rung.current.add(a.id));
      if (fresh.length) chime();
      const base = document.title.replace(/^\(\d+\) /, '');
      document.title = live.length ? '(' + live.length + ') ' + base : base;
    }, [live.map(a => a.id).join()]);
    if (!live.length) return null;
    const close = id => { const next = new Set(seen); next.add(id); writeSeen(next); setSeen(next); };
    const others = live.length - 1;
    return h('div', {className: 'na-stack', role: 'alert', 'aria-live': 'assertive'}, live.slice(0, 1).map(a => {
      const lead = a.firstReport ? a.firstReport - a.detectedAt : now - a.detectedAt;
      return h('section', {key: a.id, className: 'na-banner'},
        h('span', {className: 'na-beacon', 'aria-hidden': true}, h('i'), h('i')),
        h('div', {className: 'na-text'},
          h('small', null, 'Guardian a repéré une panne · il y a ' + span(now - a.detectedAt)),
          h('strong', null, place(a.segment) + ' : ' + a.offline + ' client' + (a.offline > 1 ? 's' : '') + ' sans fibre'),
          h('p', {className: 'na-lead' + (a.firstReport ? '' : ' is-ahead')}, a.firstReport
            ? 'Repérée ' + span(lead) + ' avant le premier client qui s’est plaint.'
            : 'Aucun client ne s’est encore plaint : Moov a ' + span(lead) + ' d’avance.'),
          others > 0 && h('p', {className: 'na-more'}, '+ ' + others + ' autre' + (others > 1 ? 's pannes' : ' panne') + ' en cours')),
        h('div', {className: 'na-actions'},
          h('button', {type: 'button', className: 'na-open', onClick: () => { close(a.id); onOpen && onOpen(a.id); }}, 'Voir le dossier'),
          h('button', {type: 'button', className: 'na-close', onClick: () => close(a.id), 'aria-label': 'Fermer l’alerte de ' + place(a.segment)}, 'Compris')));
    }));
  }

  root.FGNocAlert = {Banner, span};
  if (typeof module !== 'undefined' && module.exports) module.exports = {span};
})(typeof window !== 'undefined' ? window : globalThis);
