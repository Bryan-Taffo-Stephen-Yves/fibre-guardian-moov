// Copies Wi-Fi (espace équipe Moov) : les Wi-Fi copiés pendant « Tester ma connexion ». Chaque copie garde les vraies
// mesures de l'appareil du client et, avec un PC branché, le nom du Wi-Fi, son signal et les appareils connectés
// (sans nom ni adresse MAC complète, jamais de mot de passe). L'équipe y rejoue une panne pour voir ce que vivrait
// le client et ce qu'il faudrait faire : le vrai Wi-Fi du client n'est jamais touché.
// Données : /api/noc/copies (réservé aux comptes de l'équipe, vérifié par le serveur), toutes les 5 secondes.
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E, useRef: R} = React;
  const P = {
    copy: 'M8 8h11v11H8zM5 16V5h11', box: 'M4 14h16v5H4zM8 16.5h.01M12 16.5h.01M7 14 5 8m12 6 2-6', partage: 'M8 3h8v18H8zM11 18h2M4 9a5 5 0 0 0 0 6M20 9a5 5 0 0 1 0 6',
    pc: 'M5 5h14v10H5zM3 19h18', mobile: 'M8 3h8v18H8zM11 18h2', self: 'M8 3h8v18H8zM11 18h2', tele: 'M3 6h18v11H3zM8 21h8M12 17v4',
    console: 'M6 9h12a3 3 0 0 1 3 3v2a3 3 0 0 1-5.2 2L14 14h-4l-1.8 2A3 3 0 0 1 3 14v-2a3 3 0 0 1 3-3zM8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01',
    appareil: 'M7 7h10v10H7zM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4', team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M16 11a3 3 0 1 0 0-6M2 20a6 6 0 0 1 12 0M14 14a6 6 0 0 1 8 6',
    play: 'M7 5l12 7-12 7z', wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 19.5h.01'
  };
  const Icon = ({name, size = 18}) => h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false}, h('path', {d: P[name] || P.appareil}));
  const fr = (v, d = 0) => Number(v).toLocaleString('fr-FR', {maximumFractionDigits: d, minimumFractionDigits: d});
  const mbps = v => v == null ? '—' : fr(v, v < 10 ? 1 : 0);
  const hour = t => new Date(t).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'});
  const ago = ms => ms < 60000 ? 'il y a ' + Math.max(1, Math.round(ms / 1000)) + ' s' : ms < 3600000 ? 'il y a ' + Math.round(ms / 60000) + ' min' : ms < 86400000 ? 'il y a ' + Math.round(ms / 3600000) + ' h' : 'le ' + new Date(Date.now() - ms).toLocaleDateString('fr-FR');
  const TONE = {ok: 'good', box: 'good', lent: 'warn', faible: 'warn', 'box-charge': 'warn', instable: 'bad', 'sans-internet': 'bad', deconnecte: 'bad', 'box-los': 'bad', 'box-clignote': 'bad', eteinte: 'bad'};
  const plural = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');
  const LEVEL = {bonne: ['good', 'Bonne connexion'], lente: ['warn', 'Connexion lente'], 'tres-lente': ['bad', 'Très lente'], instable: ['bad', 'Connexion instable'], coupe: ['bad', 'Pas de connexion']};

  // La courbe de temps de réponse de la copie (et, pendant une panne rejouée, ce qu'elle deviendrait).
  // Sur téléphone, le dessin est plus étroit pour que les chiffres restent lisibles.
  function Curve({points, sim}) {
    const W = root.innerWidth < 760 ? 360 : 760, H = 150, span = Math.max(20000, ...points.map(p => p.t + 2000));
    const top = Math.max(200, ...points.map(p => p.rtt || 0), ...(sim || []).map(p => p.rtt || 0)) * 1.15;
    const x = t => Math.min(W, t / span * W), y = v => H - 20 - v / top * (H - 34);
    const line = list => { let d = '', pen = false; for (const p of list) { if (p.rtt == null) { pen = false; continue; } d += (pen ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.rtt).toFixed(1) + ' '; pen = true; } return d.trim(); };
    const lost = list => list.filter(p => p.rtt == null).map((p, i) => h('rect', {key: 'l' + i + p.t, x: x(p.t) - 3, y: H - 26, width: 6, height: 8, rx: 2, className: 'cw-lost'}));
    return h('svg', {className: 'cw-curve', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': sim ? 'Temps de réponse de la copie, avant et pendant la panne' : 'Temps de réponse enregistré dans la copie'},
      [0, .5, 1].map(v => h('line', {key: v, x1: 0, x2: W, y1: H - 20 - v * (H - 34), y2: H - 20 - v * (H - 34), className: 'cw-grid'})),
      h('text', {x: 4, y: 12, className: 'cw-tick'}, fr(top) + ' ms'), h('text', {x: 4, y: H - 2, className: 'cw-tick'}, 'début'), h('text', {x: W - 4, y: H - 2, className: 'cw-tick', textAnchor: 'end'}, Math.round(span / 1000) + ' s'),
      line(points) && h('path', {d: line(points), className: sim ? 'cw-line-before' : 'cw-line', fill: 'none'}),
      sim && line(sim) && h('path', {d: line(sim), className: 'cw-line-sim', fill: 'none'}),
      lost(sim || points), !points.length && h('text', {x: W / 2, y: H / 2, className: 'cw-empty', textAnchor: 'middle'}, 'Pas encore de mesure'));
  }

  const Device = ({d}) => h('li', {className: 'cw-dev' + (d.added ? ' is-added' : '')},
    h('span', {className: 'cw-dev-icon is-' + d.kind}, h(Icon, {name: d.kind})),
    h('span', {className: 'cw-dev-text'}, h('b', null, d.label), h('small', null, d.played ? 'jouée à la place du partage de connexion' : d.added ? 'en plus sur la copie · ' + d.usage : d.inferred ? 'déduit du test' : [d.ip, d.random ? 'adresse privée' : null].filter(Boolean).join(' · ') || ' ')),
    d.stateLabel && h('span', {className: 'cw-state is-' + (TONE[d.state] || 'warn')}, d.stateLabel));

  function Detail({api, id, scenarios}) {
    const [c, setC] = S(null), [sim, setSim] = S(null), [pick, setPick] = S(null), [busy, setBusy] = S(false), [error, setError] = S('');
    const live = R(true);
    E(() => { setC(null); setSim(null); setPick(null); setError(''); }, [id]);
    E(() => {
      live.current = true; let timer = null;
      // Toutes les 3 secondes tant que la copie s'enregistre ; une erreur passagère n'arrête pas le suivi (nouvel essai dans 5 s).
      const load = async () => { try { const r = await api('/noc/copies?id=' + encodeURIComponent(id)); if (!live.current) return; setC(r.copy); setError(''); if (!r.copy.done) timer = setTimeout(load, 3000); } catch (e) { if (live.current) { setError(e.message); if (e.status !== 403 && e.status !== 404) timer = setTimeout(load, 5000); } } };
      load(); return () => { live.current = false; clearTimeout(timer); };
    }, [id]);
    async function play(s) {
      if (busy) return; setPick(s.id); setBusy(true); setError('');
      try { setSim(await api('/noc/copies/simulate', 'POST', {id, scenario: s.id})); } catch (e) { setError(e.message); setSim(null); } finally { setBusy(false); }
    }
    if (!c) return h('section', {className: 'cw-detail cw-panel', 'aria-busy': true}, error ? h('p', {className: 'cw-error', role: 'alert'}, error) : h('p', {className: 'cw-muted'}, 'Ouverture de la copie…'));
    const m = c.metrics, w = c.wifi || {}, shown = sim ? sim.metrics : m;
    const facts = [['Client', c.client.name + (c.client.zone ? ' · ' + c.client.zone : '')], ['Réseau utilisé', c.networkLabel], ['Opérateur', [c.operator, c.city].filter(Boolean).join(' · ') || null],
      ['Canal', [w.channel, w.band].filter(v => v != null).join(' · ') || null], ['Norme Wi-Fi', w.radio], ['Vitesse de liaison', w.rxMbps ? fr(w.rxMbps) + ' Mbps en réception' + (w.txMbps ? ' · ' + fr(w.txMbps) + ' en envoi' : '') : null],
      ['Sécurité', w.auth], ['Réseau local', c.subnet], ['Nom du Wi-Fi', w.from === 'pc' ? 'lu par Windows sur le PC du client' : w.from === 'tape' ? 'tapé par le client' : null]].filter(f => f[1]);
    const tile = (label, value, unit, before) => h('div', {className: 'cw-tile'}, h('small', null, label), h('strong', null, value), h('span', null, unit), sim && h('em', null, 'avant : ' + before));
    const [tone, verdict] = sim ? LEVEL[sim.level] || ['warn', ''] : [];
    const devices = sim ? sim.devices : c.devices;
    return h('section', {className: 'cw-detail cw-panel', 'aria-labelledby': 'cw-detail-title'},
      h('header', {className: 'cw-detail-head'},
        h('span', {className: 'cw-detail-icon', 'aria-hidden': true}, h(Icon, {name: 'copy', size: 22})),
        h('div', null, h('p', {className: 'cw-eyebrow'}, c.done ? 'COPIE FAITE À ' + hour(c.created) : 'COPIE EN COURS · ' + c.seconds + ' S SUR ' + c.total), h('h2', {id: 'cw-detail-title'}, c.label),
          h('p', {className: 'cw-muted'}, (c.pc ? 'Mêmes chiffres et mêmes appareils' : 'Mêmes chiffres') + ' que le Wi-Fi du client, sans son mot de passe.')),
        h('span', {className: 'cw-pill ' + (c.pc ? 'is-pc' : '')}, h(Icon, {name: c.pc ? 'pc' : 'mobile', size: 15}), c.pc ? 'PC branché' : 'Mesure du téléphone')),
      h('div', {className: 'cw-tiles'},
        tile('Débit', shown.downloadMbps == null ? (sim ? '0' : '—') : mbps(shown.downloadMbps), 'Mbps', mbps(m.downloadMbps) + ' Mbps'),
        tile('Réponse', shown.latencyMs == null ? (sim ? 'aucune' : '—') : fr(shown.latencyMs), shown.latencyMs == null ? '' : 'ms', m.latencyMs == null ? '—' : fr(m.latencyMs) + ' ms'),
        tile('Stabilité', fr(100 - (shown.lossPct || 0)) + ' %', 'réponses', fr(100 - (m.lossPct || 0)) + ' %'),
        w.signal != null && tile('Signal Wi-Fi', sim ? (sim.signal ? sim.signal + ' %' : 'aucun') : w.signal + ' %', '', w.signal + ' %'),
        tile('Appareils', sim ? sim.summary.online + ' sur ' + sim.summary.devices : c.pc ? String(c.connected) : '—', sim ? 'avec Internet' : 'reliés à la box', sim ? sim.summary.before + ' sur ' + sim.summary.before : '')),
      h('div', {className: 'cw-chart'}, h(Curve, {points: c.points, sim: sim && sim.points})),
      h('section', {className: 'cw-replay', 'aria-labelledby': 'cw-replay-title'},
        h('h3', {id: 'cw-replay-title'}, 'Rejouer une panne sur cette copie'),
        h('p', {className: 'cw-muted'}, c.done ? 'Le Wi-Fi du client n’est jamais touché : la panne se joue seulement sur la copie.' : 'La copie se termine : la panne pourra se jouer dans quelques secondes.'),
        h('div', {className: 'cw-scenarios'}, scenarios.map(s => h('button', {key: s.id, type: 'button', className: 'cw-scenario', 'aria-pressed': pick === s.id, disabled: !c.done || busy && pick !== s.id, onClick: () => play(s)},
          h('b', null, s.label), h('small', null, s.hint)))),
        sim && h('button', {type: 'button', className: 'cw-reset', onClick: () => { setSim(null); setPick(null); }}, 'Revenir à la copie telle quelle')),
      error && h('p', {className: 'cw-error', role: 'alert'}, error),
      sim && h('div', {className: 'cw-outcome', 'aria-live': 'polite'},
        sim.note && h('p', {className: 'cw-note'}, sim.note.replace('votre box', 'la box du client')),
        h('div', {className: 'cw-say'}, h('span', {className: 'cw-verdict is-' + tone}, h('i'), verdict), h('p', null, h('b', null, 'Guardian dirait au client : '), sim.text)),
        h('div', {className: 'cw-team'}, h('span', {className: 'cw-team-icon', 'aria-hidden': true}, h(Icon, {name: 'team'})), h('p', null, h('b', null, 'Pour l’équipe : '), sim.team))),
      h('div', {className: 'cw-columns'},
        h('section', {className: 'cw-devs', 'aria-labelledby': 'cw-devs-title'},
          h('h3', {id: 'cw-devs-title'}, sim ? 'Les appareils pendant la panne' : 'Appareils sur le Wi-Fi'),
          devices.length ? h('ul', {className: 'cw-dev-list'}, devices.map(d => h(Device, {key: d.id, d}))) : h('p', {className: 'cw-muted'}, 'Le client n’avait pas branché de PC : la copie n’a pas la liste des appareils.')),
        h('section', {className: 'cw-facts', 'aria-labelledby': 'cw-facts-title'}, h('h3', {id: 'cw-facts-title'}, 'Ce que la copie a gardé'),
          h('dl', null, facts.map(([k, v]) => h('div', {key: k}, h('dt', null, k), h('dd', null, v)))))));
  }

  function View({api}) {
    const [data, setData] = S(null), [error, setError] = S(''), [sel, setSel] = S(null);
    E(() => {
      let on = true, timer = null;
      const load = async () => { try { const r = await api('/noc/copies'); if (!on) return; setData(r); setError(''); setSel(v => v && r.copies.some(c => c.id === v) ? v : r.copies[0]?.id || null); } catch (e) { if (on) setError(e.message); } if (on) timer = setTimeout(load, 5000); };
      load(); return () => { on = false; clearTimeout(timer); };
    }, []);
    if (!data) return h('div', {className: 'cw'}, error ? h('p', {className: 'cw-error', role: 'alert'}, error) : h('p', {className: 'cw-muted cw-loading'}, 'Chargement des copies…'));
    const list = data.copies, now = data.now, today = list.filter(c => now - c.created < 86400000);
    return h('div', {className: 'cw'},
      h('section', {className: 'cw-hero'},
        h('div', {className: 'cw-hero-text'}, h('h2', null, 'Les Wi-Fi copiés pendant les tests des clients'),
          h('p', null, 'Quand un client teste sa connexion, Guardian garde une copie de son Wi-Fi : ses mesures et, avec un PC branché, ses appareils. On y rejoue une panne sans rien toucher chez lui.')),
        h('dl', {className: 'cw-kpis'},
          h('div', null, h('dt', null, 'Copies aujourd’hui'), h('dd', null, today.length)),
          h('div', null, h('dt', null, 'Avec un PC branché'), h('dd', null, today.filter(c => c.pc).length)),
          h('div', null, h('dt', null, 'Appareils vus'), h('dd', null, today.reduce((a, c) => a + c.devices, 0))))),
      error && h('p', {className: 'cw-error', role: 'alert'}, error),
      !list.length ? h('section', {className: 'cw-panel cw-empty-state'}, h('span', {className: 'cw-detail-icon', 'aria-hidden': true}, h(Icon, {name: 'wifi', size: 24})),
        h('h3', null, 'Aucune copie pour l’instant'), h('p', {className: 'cw-muted'}, 'Une copie se fait toute seule quand un client touche « Tester ma connexion », dans l’application ou sur WhatsApp. Elle apparaît ici en quelques secondes.')) :
      h('div', {className: 'cw-grid'},
        h('nav', {className: 'cw-list cw-panel', 'aria-label': 'Copies Wi-Fi'},
          h('h3', null, list.length + ' copie' + (list.length > 1 ? 's' : '')),
          h('ul', null, list.map(c => h('li', {key: c.id}, h('button', {type: 'button', className: 'cw-item' + (sel === c.id ? ' is-on' : ''), 'aria-current': sel === c.id ? 'true' : undefined, onClick: () => setSel(c.id)},
            h('span', {className: 'cw-item-icon' + (c.done ? '' : ' is-rec'), 'aria-hidden': true}, h(Icon, {name: c.pc ? 'pc' : 'mobile', size: 17})),
            h('span', {className: 'cw-item-text'}, h('b', null, c.label), h('small', null, c.client.name + (c.client.zone ? ' · ' + c.client.zone : '') + ' · ' + (!c.done ? 'copie en cours' : c.measured ? ago(now - c.created) : 'arrêtée sans mesure'))),
            h('span', {className: 'cw-item-nums'}, h('b', null, mbps(c.downloadMbps) + ' Mbps'), c.pc && h('small', null, plural(c.devices, 'appareil')))))))),
        sel && h(Detail, {key: sel, api, id: sel, scenarios: data.scenarios})));
  }
  root.FGCopies = {View};
})(window);
