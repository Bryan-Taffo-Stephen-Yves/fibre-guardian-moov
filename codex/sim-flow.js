/* Déroulé d'une panne vu par le simulateur : les quatre agents de Guardian et les messages qui partent.
   Tout est déduit du dossier d'incident et de son journal ; aucune décision n'est prise ici. */
(function (root) {
  'use strict';
  const G = root.FGAbidjan || (typeof require === 'function' ? require('./abidjan-map.js') : null);

  // Les agents travaillent l'un après l'autre : 12,5 s au total avant que les messages partent.
  const AGENTS = [
    {id: 'watch', name: 'Agent Surveillance', doing: 'Je compare les mesures des box du quartier…', ms: 3000},
    {id: 'cause', name: 'Agent Diagnostic', doing: 'Je cherche la cause : courant, fibre, chantier ou saturation ?', ms: 3500},
    {id: 'plan', name: 'Agent Plan', doing: 'Je prépare l’intervention…', ms: 3000},
    {id: 'write', name: 'Agent Messages', doing: 'J’écris aux clients, à l’équipe et au technicien…', ms: 3000}
  ];
  const THINK = AGENTS.reduce((t, a) => t + a.ms, 0);
  const CALM = 'Moov est déjà au courant et prépare l’intervention. Vous n’avez rien à faire.';

  // Ce qui change d'une panne à l'autre : mots employés, matériel, sécurité et messages clés.
  const KIND = {
    pole: {label: 'poteau endommagé', sensor: ' : la lumière ne passe plus.', cause: w => 'Fibre arrachée au poteau de ' + w.area + '. Cause très probable.', kit: 'un poteau, 200 m de fibre, une soudeuse et un réflectomètre', safety: 'Baliser la zone et vérifier qu’aucun câble électrique ne touche le poteau avant de monter.', client: 'Un poteau est endommagé dans votre quartier. ' + CALM, fixed: 'C’est réparé. Votre box se reconnecte. Pendant ce temps, Moov a remplacé le poteau et ressoudé la fibre.'},
    fiber: {label: 'fibre coupée', sensor: ' : la lumière ne passe plus.', cause: w => 'Câble de fibre coupé près de ' + w.area + '. Cause probable.', kit: '200 m de fibre, une soudeuse et un réflectomètre', safety: 'Baliser la zone de travail au bord de la route.', client: 'Un câble de fibre est coupé dans votre quartier. ' + CALM, fixed: 'C’est réparé. Votre box se reconnecte. Pendant ce temps, Moov a ressoudé la fibre coupée.'},
    works: {label: 'câble arraché par un chantier', sensor: ' : la lumière ne passe plus, et un chantier de route est déclaré à 50 m.', cause: w => 'Câble arraché par les engins du chantier près de ' + w.area + '.', kit: '300 m de fibre, une soudeuse, un réflectomètre et l’équipe génie civil', safety: 'Faire arrêter les engins du chantier avant de creuser.', client: 'Des travaux de route ont arraché un câble dans votre quartier. La réparation prend quelques heures : Moov envoie deux équipes.', fixed: 'C’est réparé. Votre box se reconnecte. Pendant ce temps, Moov a remplacé le câble arraché par le chantier.', hours: 3, mail: [['Constat', 'Photographier l’engin et le câble, noter l’heure et le nom de l’entreprise du chantier : Moov pourra se faire rembourser la réparation.']]},
    flood: {label: 'armoire inondée', sensor: ' et le capteur d’eau de l’armoire s’est déclenché.', cause: w => 'Armoire inondée après la pluie à ' + w.area + '.', kit: 'une pompe, des modules de rechange et des bottes', safety: 'Personne n’ouvre l’armoire tant que l’eau n’est pas retirée.', client: 'Une armoire Moov a pris l’eau après la pluie. Nous intervenons dès que l’eau se retire. Vous n’avez rien à faire.', fixed: 'C’est réparé. Votre box se reconnecte. Pendant ce temps, Moov a séché l’armoire et remplacé les pièces abîmées.', hold: true},
    theft: {label: 'vol de câble', sensor: ' : le boîtier a été ouvert de force juste avant la coupure.', cause: w => 'Vol de câble probable à ' + w.area + '.', kit: '200 m de fibre, une soudeuse et un cadenas renforcé', safety: 'Ne pas intervenir seul de nuit. Appeler la police si des personnes sont encore sur place.', client: 'Un câble a été endommagé dans votre quartier. ' + CALM, fixed: 'C’est réparé. Votre box se reconnecte. Pendant ce temps, Moov a remplacé le câble et sécurisé le boîtier.', mail: [['Déclaration à la police', 'Modèle : « Le [date] vers [heure], un câble de fibre Moov a été volé à [lieu]. Le boîtier a été forcé. Clients privés d’internet : [nombre]. » À déposer au commissariat le plus proche.']]},
    olt: {label: 'équipement central en panne', sensor: '', cause: w => 'L’équipement central de ' + w.commune + ' s’est arrêté. Toute la commune est touchée.', kit: 'aucun pour l’instant', safety: 'Redémarrage à distance d’abord. Personne ne se déplace si cela suffit.', client: 'Un équipement central de Moov s’est arrêté : toute la commune est touchée. Moov le redémarre à distance, vous n’avez rien à faire.', fixed: 'Internet est revenu dans toute la commune. Moov a redémarré l’équipement central à distance.', plan: 'Redémarrer l’équipement central à distance. Aucun déplacement si cela suffit.'},
    power: {label: 'coupure de courant CIE', sensor: ' : elles ont signalé une perte de courant.', cause: () => 'Coupure de courant CIE. Ce n’est pas une panne Moov.', kit: 'aucun', safety: 'Ne pas envoyer de technicien fibre.', client: 'C’est une coupure de courant CIE, pas une panne Moov. Votre box repartira seule au retour du courant. Inutile d’appeler le service client.', fixed: 'Le courant est revenu, votre box est reconnectée.', plan: 'Aucun déplacement. Prévenir les clients et attendre le retour du courant.'},
    congestion: {label: 'débit en baisse, réseau saturé', sensor: '', cause: () => 'Réseau saturé, rien n’est cassé.', kit: 'aucun', safety: 'Action à distance, aucun déplacement.', client: 'Internet est plus lent dans votre quartier en ce moment. Moov ajoute de la capacité. Inutile de redémarrer votre box.', fixed: 'Le débit est revenu à la normale. Moov a ajouté de la capacité pendant que vous naviguiez.', plan: 'Ajouter de la capacité à distance. Aucun déplacement.'}
  };
  const CAUSES = {POWER_OUTAGE: 'power', UPLINK_CONGESTION: 'congestion', ROADWORK_CUT: 'works', CABINET_FLOOD: 'flood', CABLE_THEFT: 'theft', OLT_FAILURE: 'olt'};

  function kindOf(incident, segment) {
    const k = CAUSES[incident?.plan?.cause];
    if (k) return k;
    return (incident?.scenario || segment?.scenario) === 'pole' ? 'pole' : 'fiber';
  }
  const at = (incident, kind) => incident.events?.find(e => e.kind === kind)?.at || null;
  const clock = t => new Date(t).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Abidjan'}).replace(':', ' h ');
  const place = id => { const s = G?.SEGMENTS[id], c = s && G.COMMUNES.find(v => v.id === s.commune); return {area: s?.area || id, commune: c?.name || '', quarters: s ? Object.values(G.SEGMENTS).filter(v => v.commune === s.commune).length : 1}; };
  const plural = (n, word) => n + ' ' + word + (n > 1 ? 's' : '');
  const feminine = name => /a$/.test(name) ? 'e' : '';

  // Technicien le plus proche et libre ; Guardian le propose, une personne de Moov décide.
  function nearest(segmentId, technicians) {
    const s = G?.SEGMENTS[segmentId]; if (!s) return null;
    const p = G.project(s.at), free = (technicians || []).filter(t => !t.busy && G.BASES[t.id]);
    return free.map(t => { const b = G.project(G.BASES[t.id].at); return {t, d: Math.hypot(b[0] - p[0], b[1] - p[1])}; }).sort((a, b) => a.d - b.d)[0]?.t || null;
  }

  function detected(incident, segment) {
    const d = incident.events?.find(e => e.kind === 'detected'), x = d?.detail ? (typeof d.detail === 'string' ? JSON.parse(d.detail) : d.detail) : {};
    let total = x.total ?? segment?.total ?? 20, online = x.online ?? segment?.online ?? total;
    // L'équipement central coupe toute la commune : on compte toutes ses box.
    if (kindOf(incident, segment) === 'olt') { const q = place(incident.segment_id).quarters; total *= q; online *= q; }
    return {at: d?.at || incident.created, total, offline: Math.max(0, total - online), alarm: x.alarm || segment?.alarm || 'NONE'};
  }

  function agents(incident, segment, technicians, now) {
    const d = detected(incident, segment), kind = kindOf(incident, segment), k = KIND[kind], where = place(incident.segment_id);
    const tech = incident.technician ? (technicians || []).find(t => t.id === incident.technician) : nearest(incident.segment_id, technicians), first = tech ? tech.name.split(' ')[0] : 'le technicien';
    const results = {
      watch: kind === 'congestion' ? 'Box en ligne, mais le lien du quartier est chargé à plus de 90 %.' : kind === 'olt' ? 'L’équipement central ne répond plus : ' + plural(where.quarters, 'quartier') + ', ' + d.offline + ' box éteintes.' : d.offline + ' box éteintes sur ' + d.total + k.sensor,
      cause: k.cause(where),
      plan: incident.plan?.dispatch ? 'Proposer ' + (tech ? tech.name + ' (' + tech.team + ')' : 'une équipe fibre') + (kind === 'works' ? ' et l’équipe génie civil' : '') + ' avec ' + k.kit + '.' + (k.hold ? ' Départ seulement quand l’eau sera retirée.' : '') : k.plan,
      write: kind === 'congestion' ? 'Messages prêts pour les clients du quartier et l’équipe Moov.' : 'Messages prêts pour ' + plural(d.offline, 'client') + ', l’équipe Moov' + (incident.plan?.dispatch ? ' et ' + first : '') + '.'
    };
    let t = d.at;
    return AGENTS.map(a => { const start = t, end = (t += a.ms), progress = Math.max(0, Math.min(1, (now - start) / a.ms)); return {...a, start, end, progress, state: progress >= 1 ? 'done' : progress > 0 ? 'working' : 'waiting', result: results[a.id]}; });
  }

  // Messages envoyés par le déroulé, du plus ancien au plus récent ; seuls ceux déjà partis à « now » sont renvoyés.
  function messages(incident, segment, technicians, now) {
    if (!incident) return [];
    const d = detected(incident, segment), kind = kindOf(incident, segment), k = KIND[kind], where = place(incident.segment_id), dispatch = incident.plan?.dispatch;
    const tech = incident.technician ? (technicians || []).find(t => t.id === incident.technician) : nearest(incident.segment_id, technicians);
    const first = tech ? tech.name.split(' ')[0] : 'Le technicien', ready = d.at + THINK, out = [];
    const add = (t, to, channel, body, extra = {}) => t && out.push({id: to + channel + out.length, at: t, to, channel, body, ...extra});
    const head = (kind === 'olt' ? 'Panne dans toute la commune de ' + where.commune : 'Panne à ' + where.area + ' (' + where.commune + ')') + ' : ' + k.label + (d.offline ? ', ' + d.offline + ' clients sans internet' : '') + '. ';
    add(ready, 'team', 'whatsapp', head + (kind === 'power' ? 'Ne pas envoyer de technicien.' : k.hold ? 'Équipe prévenue, départ dès que l’eau se retire.' : dispatch ? 'Plan prêt, votre validation est attendue.' : kind === 'olt' ? 'Redémarrage à distance proposé, votre validation est attendue.' : 'Ajout de capacité proposé, votre validation est attendue.'));
    add(ready, 'team', 'mail', null, {subject: 'Recommandations de Guardian · ' + (kind === 'olt' ? where.commune : where.area), lines: [
      ['Cause probable', k.cause(where)],
      ['Clients touchés', kind === 'congestion' ? 'Tout le quartier, connexion lente' : d.offline + ' sur ' + d.total],
      ['Étapes', (incident.plan?.steps || []).join(' ')],
      ['Matériel', k.kit],
      ['Sécurité', k.safety],
      ...(k.mail || [])
    ]});
    if (dispatch) add(ready, 'tech', 'whatsapp', 'Préparez-vous : ' + k.label + ' à ' + where.area + '. ' + (k.hold ? 'Attendez le feu vert : personne ne part tant que l’eau n’est pas retirée.' : 'Départ dès que Moov valide.'));
    add(ready, 'client', 'whatsapp', k.client);
    const approved = at(incident, 'plan.approved'), dispatched = at(incident, 'dispatched'), enRoute = at(incident, 'en_route'), onSite = at(incident, 'on_site'), resolved = at(incident, 'resolved'), closed = !resolved && at(incident, 'closed');
    if (approved) add(approved, 'team', 'whatsapp', dispatch ? 'Plan validé pour ' + where.area + '. Choisissez l’équipe à envoyer.' : ({congestion: 'Ajout de capacité validé pour ' + where.area + '.', olt: 'Redémarrage à distance validé pour ' + where.commune + '.', power: 'Coupure CIE à ' + where.area + ' : clients prévenus, aucun déplacement.'})[kind]);
    if (dispatched) {
      add(dispatched, 'tech', 'whatsapp', (k.hold ? 'Feu vert : l’eau s’est retirée. ' : '') + 'Mission confirmée : ' + k.label + ' à ' + where.area + '. Matériel : ' + k.kit + '. ' + k.safety);
      add(dispatched, 'team', 'whatsapp', first + ' est affecté' + feminine(first) + ' à la panne de ' + where.area + (kind === 'works' ? ', avec l’équipe génie civil.' : '.'));
    }
    if (enRoute) {
      const eta = enRoute + (incident.position?.durationMs || 120000);
      add(enRoute, 'client', 'whatsapp', first + ' est en route, arrivée vers ' + clock(eta) + '.' + (k.hours ? ' Retour d’internet prévu vers ' + clock(enRoute + k.hours * 3600000) + '.' : '') + ' Suivez son trajet dans l’application Fibre Guardian.');
      add(enRoute, 'team', 'whatsapp', first + ' est en route vers ' + where.area + '.');
    }
    if (onSite) { add(onSite, 'client', 'app', first + ' est sur place.'); add(onSite, 'team', 'whatsapp', first + ' est sur place à ' + where.area + '.'); }
    if (resolved) {
      add(resolved, 'client', 'whatsapp', k.fixed);
      add(resolved, 'team', 'whatsapp', 'C’est rétabli ' + (kind === 'olt' ? 'dans toute la commune de ' + where.commune : 'à ' + where.area) + ' : toutes les box sont en ligne.');
      if (dispatch) add(resolved + 1, 'client', 'app', 'Comment s’est passée l’intervention ? Notez-la dans l’application.');
    }
    if (closed) { add(closed, 'client', 'whatsapp', 'Tout est revenu à la normale dans votre quartier. Votre box est reconnectée, vous n’avez rien à faire.'); add(closed, 'team', 'whatsapp', 'Panne levée à ' + where.area + ' avant tout déplacement. Dossier clôturé.'); }
    return out.filter(m => m.at <= now).sort((a, b) => a.at - b.at);
  }

  const api = {AGENTS, THINK, KIND, kindOf, nearest, agents, messages, clock};
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FGSimFlow = api;
})(typeof window !== 'undefined' ? window : globalThis);
