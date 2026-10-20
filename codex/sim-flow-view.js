/* Panneau du poteau, suite : les agents de Guardian au travail, l'étape à valider et les messages partis
   (téléphone WhatsApp et mail de recommandations). */
(function (root) {
  'use strict';
  const h = root.React.createElement, {useState, useEffect, useRef} = root.React, F = root.FGSimFlow;

  function useNow(ms) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]); return now; }
  const ICONS = {watch: 'M2 12h4l3-8 4 16 3-8h6', cause: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5', plan: 'M9 4h6M8 4H5v17h14V4h-3M8 11h8M8 15h5', write: 'M4 5h16v11H8l-4 4z'};
  const icon = (d, size = 20) => h('svg', {viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, h('path', {d}));
  // Mesures qui défilent pendant que l'agent travaille, pour voir qu'il lit vraiment quelque chose.
  function ticker(agent, now, offline, total) {
    const k = Math.floor(now / 380);
    if (agent.id === 'watch') { const box = k % total + 1; return 'Box ' + String(box).padStart(2, '0') + ' · ' + (box <= offline ? 'hors ligne' : 'en ligne'); }
    if (agent.id === 'cause') return ['Courant CIE ?', 'Lumière de la fibre ?', 'Charge du réseau ?', 'Alarme des box ?'][k % 4];
    if (agent.id === 'plan') return ['Équipe la plus proche…', 'Matériel à prévoir…', 'Consignes de sécurité…'][k % 3];
    return ['Clients du quartier…', 'Équipe Moov…', 'Technicien…'][k % 3];
  }

  function Agents({incident, segment, technicians, now}) {
    const list = F.agents(incident, segment, technicians, now), offline = Math.max(0, (segment.total || 20) - (segment.online ?? 20));
    const busy = list.find(a => a.state !== 'done');
    return h('section', {className: 'sf-agents', 'aria-label': 'Guardian au travail'},
      h('header', null, h('b', null, busy ? 'Guardian analyse la panne' : 'Analyse terminée'), h('span', {className: 'sf-live', 'aria-live': 'polite'}, busy ? busy.name : 'en ' + Math.round(F.THINK / 1000) + ' s')),
      h('ol', null, list.map(a => h('li', {key: a.id, className: 'sf-agent is-' + a.state},
        h('span', {className: 'sf-agent-icon'}, a.state === 'done' ? icon('M5 12l5 5 9-10') : icon(ICONS[a.id])),
        h('div', null,
          h('strong', null, a.name),
          h('p', null, a.state === 'done' ? a.result : a.state === 'working' ? a.doing : 'En attente'),
          a.state === 'working' && h('small', {className: 'sf-tick'}, ticker(a, now, offline, segment.total || 20)),
          a.state === 'working' && h('span', {className: 'sf-bar'}, h('i', {style: {transform: 'scaleX(' + a.progress.toFixed(3) + ')'}})))))));
  }

  // Prochaine décision humaine. Chaque bouton passe par le serveur, qui vérifie les droits.
  function NextStep({incident, segment, data, now, run, busy}) {
    const ready = now >= (F.agents(incident, segment, data.technicians, now).at(-1).end), dispatch = incident.plan?.dispatch;
    const [tech, setTech] = useState(''), [safe, setSafe] = useState(false), suggested = F.nearest(incident.segment_id, data.technicians);
    useEffect(() => { setTech(''); setSafe(false); }, [incident.id, incident.status]);
    const who = (data.technicians || []).find(t => t.id === incident.technician), first = who ? who.name.split(' ')[0] : 'l’équipe';
    const base = {id: incident.id, version: incident.version};
    let body = null;
    if (!ready) body = h('p', {className: 'sf-wait'}, 'Guardian termine son analyse. La validation s’ouvre juste après.');
    else if (incident.status === 'proposed') body = data.canApprove
      ? [h('p', {key: 'p'}, dispatch ? 'Guardian propose une intervention. Rien ne part sans votre accord.' : 'Guardian propose une action à distance. Rien ne part sans votre accord.'), h('button', {key: 'b', type: 'button', className: 'sf-primary', disabled: busy, onClick: () => run({...base, type: 'approve', note: 'Plan validé depuis le simulateur.'})}, 'Valider le plan')]
      : h('p', null, 'Un responsable Moov doit valider le plan.');
    else if (incident.status === 'approved' && dispatch) body = data.canDispatch
      ? [h('label', {key: 't', className: 'sf-field'}, 'Équipe à envoyer', h('select', {value: tech || suggested?.id || '', onChange: e => setTech(e.target.value)}, (data.technicians || []).filter(t => !t.busy).map(t => h('option', {key: t.id, value: t.id}, t.name + ' · ' + (t.id === suggested?.id ? 'la plus proche' : t.team))))),
        h('label', {key: 's', className: 'sf-check'}, h('input', {type: 'checkbox', checked: safe, onChange: e => setSafe(e.target.checked)}), 'Consignes de sécurité vérifiées'),
        h('button', {key: 'b', type: 'button', className: 'sf-primary', disabled: busy || !safe || !(tech || suggested), onClick: () => run({...base, type: 'dispatch', technician: tech || suggested.id, safety: true})}, 'Envoyer l’équipe')]
      : h('p', null, 'Un responsable Moov doit choisir l’équipe.');
    else if (['dispatched', 'en_route', 'on_site'].includes(incident.status)) body = h('button', {type: 'button', className: 'sf-primary', disabled: busy, onClick: () => run({...base, type: 'advance'})}, ({dispatched: 'Confirmer le départ de ' + first, en_route: first + ' est arrivé' + (/a$/.test(first) ? 'e' : '') + ' sur place', on_site: 'Réparation terminée'})[incident.status]);
    else if (incident.status === 'verifying' || (incident.status === 'approved' && !dispatch)) body = [h('p', {key: 'p'}, incident.status === 'verifying' ? 'Guardian vérifie que toutes les box reviennent avant de clôturer.' : 'Quand le quartier est rétabli, Guardian vérifie les box puis clôture.'), h('button', {key: 'b', type: 'button', className: 'sf-primary', disabled: busy, onClick: () => run({...base, type: 'verify'}, {restore: segment.id})}, 'Rétablir et vérifier')];
    if (!body) return null;
    return h('section', {className: 'sf-next', 'aria-label': 'Étape suivante'}, h('b', null, 'À vous de jouer'), body);
  }

  function Phone({incident, segment, data, now}) {
    const [tab, setTab] = useState('client'), list = F.messages(incident, segment, data.technicians, now), seen = useRef({}), body = useRef(null);
    const who = (data.technicians || []).find(t => t.id === incident.technician) || F.nearest(incident.segment_id, data.technicians);
    const area = root.FGAbidjan?.SEGMENTS[segment.id]?.area || segment.id;
    const tabs = [['client', 'Client'], ['team', 'Équipe Moov'], ['tech', 'Technicien']];
    const mine = list.filter(m => m.to === tab);
    useEffect(() => { seen.current[tab] = mine.length; if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [tab, mine.length]);
    const contact = {client: ['Client de ' + area, 'Reçoit les messages de Moov'], team: ['Équipe Moov', 'Chaque membre de l’équipe'], tech: [who ? who.name : 'Technicien de garde', who ? who.team : '']}[tab];
    return h('section', {className: 'sf-phone-wrap', 'aria-label': 'Messages envoyés'},
      h('header', {className: 'sf-phone-head'}, h('b', null, 'Messages envoyés'), h('span', null, list.length ? list.length + ' message' + (list.length > 1 ? 's' : '') : 'Aucun pour l’instant')),
      h('div', {className: 'sf-tabs', role: 'tablist'}, tabs.map(([k, label]) => { const n = list.filter(m => m.to === k).length, fresh = Math.max(0, n - (seen.current[k] || 0)); return h('button', {key: k, type: 'button', role: 'tab', 'aria-selected': tab === k, className: tab === k ? 'is-on' : '', onClick: () => setTab(k)}, label, k !== tab && fresh > 0 && h('em', {'aria-label': fresh + ' nouveau' + (fresh > 1 ? 'x' : '')}, fresh)); })),
      h('div', {className: 'sf-phone'},
        h('div', {className: 'sf-phone-bar'}, h('span', {className: 'sf-avatar', 'aria-hidden': true}, contact[0].slice(0, 1)), h('span', null, h('b', null, contact[0]), h('small', null, contact[1])), h('span', {className: 'sf-wa'}, 'WhatsApp')),
        h('div', {className: 'sf-thread', ref: body, role: 'log', 'aria-live': 'polite'},
          mine.length ? mine.map(m => m.channel === 'mail' ? h(Mail, {key: m.id, m}) : m.channel === 'app'
            ? h('p', {key: m.id, className: 'sf-note'}, icon('M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4', 14), 'Notification : ' + m.body)
            : h('div', {key: m.id, className: 'sf-msg'}, h('p', null, m.body), h('time', null, F.clock(m.at), ' ✓✓')))
            : h('p', {className: 'sf-empty'}, now < F.agents(incident, segment, data.technicians, now).at(-1).end ? 'Guardian rédige les messages…' : 'Rien pour ce destinataire.'))));
  }

  function Mail({m}) {
    const [open, setOpen] = useState(false);
    return h('article', {className: 'sf-mail' + (open ? ' is-open' : '')},
      h('button', {type: 'button', 'aria-expanded': open, onClick: () => setOpen(!open)}, icon('M3 6h18v12H3zM3 7l9 6 9-6', 18), h('span', null, h('small', null, 'Mail à l’équipe · ' + F.clock(m.at)), h('b', null, m.subject))),
      open && h('dl', null, m.lines.map(([k, v]) => h('div', {key: k}, h('dt', null, k), h('dd', null, v)))));
  }

  function Flow({incident, segment, data, run, busy}) {
    const now = useNow(250);
    return h('div', {className: 'sf'},
      h(Agents, {incident, segment, technicians: data.technicians, now}),
      h(NextStep, {incident, segment, data, now, run, busy}),
      h(Phone, {incident, segment, data, now}));
  }

  root.FGSimFlowView = {Flow};
})(typeof window !== 'undefined' ? window : globalThis);
