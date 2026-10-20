/* Déroulé d'une panne vu par le simulateur : les quatre agents de Guardian et les messages qui partent.
   Tout est déduit du dossier d'incident et de son journal ; aucune décision n'est prise ici. */
(function (root) {
  'use strict';
  const G = root.FGAbidjan || (typeof require === 'function' ? require('./abidjan-map.js') : null);

  // Les agents travaillent l'un après l'autre : 12,5 s au total avant que les messages partent.
  const AGENTS = [
    {id: 'watch', name: 'Agent Surveillance', doing: 'Je compare les mesures des box du quartier…', ms: 3000},
    {id: 'cause', name: 'Agent Diagnostic', doing: 'Je cherche la cause : courant, fibre ou saturation ?', ms: 3500},
    {id: 'plan', name: 'Agent Plan', doing: 'Je prépare l’intervention…', ms: 3000},
    {id: 'write', name: 'Agent Messages', doing: 'J’écris aux clients, à l’équipe et au technicien…', ms: 3000}
  ];
  const THINK = AGENTS.reduce((t, a) => t + a.ms, 0);

  const KIND = {
    pole: {label: 'poteau endommagé', team: 'poteau endommagé', client: 'Un poteau est endommagé dans votre quartier.', kit: 'un poteau, 200 m de fibre, une soudeuse et un réflectomètre', safety: 'Baliser la zone et vérifier qu’aucun câble électrique ne touche le poteau avant de monter.'},
    fiber: {label: 'fibre coupée', team: 'fibre coupée', client: 'Un câble de fibre est coupé dans votre quartier.', kit: '200 m de fibre, une soudeuse et un réflectomètre', safety: 'Baliser la zone de travail au bord de la route.'},
    power: {label: 'coupure de courant CIE', team: 'coupure électrique', client: 'C’est une coupure de courant CIE, pas une panne Moov.', kit: 'aucun', safety: 'Ne pas envoyer de technicien fibre.'},
    congestion: {label: 'réseau saturé', team: 'débit en baisse, réseau saturé', client: 'Internet est plus lent dans votre quartier en ce moment.', kit: 'aucun', safety: 'Action à distance, aucun déplacement.'}
  };

  function kindOf(incident, segment) {
    const cause = incident?.plan?.cause || '';
    if (cause === 'POWER_OUTAGE') return 'power';
    if (cause === 'UPLINK_CONGESTION') return 'congestion';
    return (incident?.scenario || segment?.scenario) === 'pole' ? 'pole' : 'fiber';
  }
  const at = (incident, kind) => incident.events?.find(e => e.kind === kind)?.at || null;
  const clock = t => new Date(t).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Abidjan'}).replace(':', ' h ');
  const place = id => { const s = G?.SEGMENTS[id], c = s && G.COMMUNES.find(v => v.id === s.commune); return {area: s?.area || id, commune: c?.name || ''}; };

  // Technicien le plus proche et libre ; Guardian le propose, une personne de Moov décide.
  function nearest(segmentId, technicians) {
    const s = G?.SEGMENTS[segmentId]; if (!s) return null;
    const p = G.project(s.at), free = (technicians || []).filter(t => !t.busy && G.BASES[t.id]);
    return free.map(t => { const b = G.project(G.BASES[t.id].at); return {t, d: Math.hypot(b[0] - p[0], b[1] - p[1])}; }).sort((a, b) => a.d - b.d)[0]?.t || null;
  }

  function detected(incident, segment) {
    const d = incident.events?.find(e => e.kind === 'detected'), x = d?.detail ? (typeof d.detail === 'string' ? JSON.parse(d.detail) : d.detail) : {};
    const total = x.total ?? segment?.total ?? 20, online = x.online ?? segment?.online ?? total;
    return {at: d?.at || incident.created, total, offline: Math.max(0, total - online), alarm: x.alarm || segment?.alarm || 'NONE'};
  }

  function agents(incident, segment, technicians, now) {
    const d = detected(incident, segment), kind = kindOf(incident, segment), tech = incident.technician ? (technicians || []).find(t => t.id === incident.technician) : nearest(incident.segment_id, technicians);
    const where = place(incident.segment_id), first = tech ? tech.name.split(' ')[0] : 'le technicien';
    const results = {
      watch: kind === 'congestion' ? 'Box en ligne, mais le lien du quartier est chargé à plus de 90 %.' : d.offline + ' box éteintes sur ' + d.total + (d.alarm === 'LOS' ? ' : la lumière ne passe plus.' : d.alarm === 'DYING_GASP' ? ' : elles ont signalé une perte de courant.' : '.'),
      cause: ({pole: 'Fibre arrachée au poteau de ' + where.area + '. Cause très probable.', fiber: 'Câble de fibre coupé près de ' + where.area + '. Cause probable.', power: 'Coupure de courant CIE. Ce n’est pas une panne Moov.', congestion: 'Réseau saturé, rien n’est cassé.'})[kind],
      plan: incident.plan?.dispatch ? 'Proposer ' + (tech ? tech.name + ' (' + tech.team + ')' : 'une équipe fibre') + ' avec ' + KIND[kind].kit + '.' : kind === 'power' ? 'Aucun déplacement. Prévenir les clients et attendre le retour du courant.' : 'Ajouter de la capacité à distance. Aucun déplacement.',
      write: 'Messages prêts pour ' + d.offline + ' client' + (d.offline > 1 ? 's' : '') + ', l’équipe Moov' + (incident.plan?.dispatch ? ' et ' + first : '') + '.'
    };
    if (kind === 'congestion') results.write = 'Messages prêts pour les clients du quartier et l’équipe Moov.';
    let t = d.at;
    return AGENTS.map(a => { const start = t, end = (t += a.ms), progress = Math.max(0, Math.min(1, (now - start) / a.ms)); return {...a, start, end, progress, state: progress >= 1 ? 'done' : progress > 0 ? 'working' : 'waiting', result: results[a.id]}; });
  }

  // Messages envoyés par le déroulé, du plus ancien au plus récent ; seuls ceux déjà partis à « now » sont renvoyés.
  function messages(incident, segment, technicians, now) {
    if (!incident) return [];
    const d = detected(incident, segment), kind = kindOf(incident, segment), k = KIND[kind], where = place(incident.segment_id);
    const tech = incident.technician ? (technicians || []).find(t => t.id === incident.technician) : nearest(incident.segment_id, technicians);
    const first = tech ? tech.name.split(' ')[0] : 'Le technicien', ready = d.at + THINK, out = [];
    const add = (t, to, channel, body, extra = {}) => t && out.push({id: to + channel + out.length, at: t, to, channel, body, ...extra});
    const team = 'Panne à ' + where.area + ' (' + where.commune + ') : ' + k.team + (d.offline ? ', ' + d.offline + ' clients sans internet' : '') + '. ';
    add(ready, 'team', 'whatsapp', team + (incident.plan?.dispatch ? 'Plan prêt, votre validation est attendue.' : kind === 'power' ? 'Ne pas envoyer de technicien.' : 'Ajout de capacité proposé, votre validation est attendue.'));
    add(ready, 'team', 'mail', null, {subject: 'Recommandations de Guardian · ' + where.area, lines: [
      ['Cause probable', agents(incident, segment, technicians, ready).find(a => a.id === 'cause').result],
      ['Clients touchés', kind === 'congestion' ? 'Tout le quartier, connexion lente' : d.offline + ' sur ' + d.total],
      ['Étapes', (incident.plan?.steps || []).join(' ')],
      ['Matériel', k.kit],
      ['Sécurité', k.safety]
    ]});
    if (incident.plan?.dispatch) add(ready, 'tech', 'whatsapp', 'Préparez-vous : ' + k.label + ' à ' + where.area + '. Départ dès que Moov valide.');
    add(ready, 'client', 'whatsapp', k.client + ' ' + ({pole: 'Moov est déjà au courant et prépare l’intervention. Vous n’avez rien à faire.', fiber: 'Moov est déjà au courant et prépare l’intervention. Vous n’avez rien à faire.', power: 'Votre box repartira seule au retour du courant. Inutile d’appeler le service client.', congestion: 'Moov ajoute de la capacité. Inutile de redémarrer votre box.'})[kind]);
    const approved = at(incident, 'plan.approved'), dispatched = at(incident, 'dispatched'), enRoute = at(incident, 'en_route'), onSite = at(incident, 'on_site'), resolved = at(incident, 'resolved'), closed = !resolved && at(incident, 'closed');
    if (approved) add(approved, 'team', 'whatsapp', incident.plan?.dispatch ? 'Plan validé pour ' + where.area + '. Choisissez l’équipe à envoyer.' : kind === 'congestion' ? 'Ajout de capacité validé pour ' + where.area + '.' : 'Coupure CIE à ' + where.area + ' : clients prévenus, aucun déplacement.');
    if (dispatched) { add(dispatched, 'tech', 'whatsapp', 'Mission confirmée : ' + k.label + ' à ' + where.area + '. Matériel : ' + k.kit + '. ' + k.safety); add(dispatched, 'team', 'whatsapp', first + ' est affecté' + (/a$/.test(first) ? 'e' : '') + ' à la panne de ' + where.area + '.'); }
    if (enRoute) { const eta = enRoute + (incident.position?.durationMs || 120000); add(enRoute, 'client', 'whatsapp', first + ' est en route, arrivée vers ' + clock(eta) + '. Suivez son trajet dans l’application Fibre Guardian.'); add(enRoute, 'team', 'whatsapp', first + ' est en route vers ' + where.area + '.'); }
    if (onSite) { add(onSite, 'client', 'app', first + ' est sur place.'); add(onSite, 'team', 'whatsapp', first + ' est sur place à ' + where.area + '.'); }
    if (resolved) {
      add(resolved, 'client', 'whatsapp', ({pole: 'C’est réparé. Votre box se reconnecte. Pendant ce temps, Moov a remplacé le poteau et ressoudé la fibre.', fiber: 'C’est réparé. Votre box se reconnecte. Pendant ce temps, Moov a ressoudé la fibre coupée.', power: 'Le courant est revenu, votre box est reconnectée.', congestion: 'Le débit est revenu à la normale. Moov a ajouté de la capacité pendant que vous naviguiez.'})[kind]);
      add(resolved, 'team', 'whatsapp', 'C’est rétabli à ' + where.area + ' : toutes les box sont en ligne.');
      if (kind === 'pole' || kind === 'fiber') add(resolved + 1, 'client', 'app', 'Comment s’est passée l’intervention ? Notez-la dans l’application.');
    }
    if (closed) { add(closed, 'client', 'whatsapp', 'Tout est revenu à la normale dans votre quartier. Votre box est reconnectée, vous n’avez rien à faire.'); add(closed, 'team', 'whatsapp', 'Panne levée à ' + where.area + ' avant tout déplacement. Dossier clôturé.'); }
    return out.filter(m => m.at <= now).sort((a, b) => a.at - b.at);
  }

  const api = {AGENTS, THINK, KIND, kindOf, nearest, agents, messages, clock};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FGSimFlow = api;
})(typeof window !== 'undefined' ? window : globalThis);
