'use strict';
// Contrôle bout en bout HTTP, base en mémoire et comptes fictifs uniquement.
const assert = require('node:assert/strict');
const {createGuardianServer} = require('./pilot-server.cjs');
const O = require('./operator-store.cjs');

(async () => {
  const errors = [], server = createGuardianServer({db: ':memory:', onError: error => errors.push(error.message)});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, store = server.guardianStore;
  let groups = 0;
  const check = title => { groups++; console.log('PASS ' + title); };
  async function request(account, route, body, expected = 200) {
    const response = await fetch(base + '/api' + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {'Content-Type': 'application/json', Cookie: account?.cookie || '', 'X-CSRF-Token': account?.csrf || ''},
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json();
    assert.equal(response.status, expected, route + ': ' + JSON.stringify(data));
    return data;
  }
  async function account(name, role) {
    const email = name + '@example.test', password = 'test-password-' + name;
    let response = await fetch(base + '/api/auth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password, name})});
    assert.equal(response.status, 200);
    let data = await response.json();
    if (role) {
      O.grant(store, email, role);
      response = await fetch(base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password})});
      data = await response.json();
    }
    return {id: data.user.id, email, csrf: data.user.csrf, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')};
  }
  async function workspace(user) { return request(user, '/noc/workspace'); }
  async function item(user, key) {
    const found = (await workspace(user)).queue.find(row => row.key === key);
    assert.ok(found, 'Dossier absent du cockpit : ' + key);
    return found;
  }
  async function work(user, key, type, extra = {}, expected = 200) {
    const row = await item(user, key);
    return request(user, '/noc/workspace/action', {key, type, version: row.version, sourceVersion: row.sourceVersion, ...extra}, expected);
  }
  async function incidentAction(user, id, type, extra = {}, expected = 200) {
    const row = (await request(admin, '/noc/overview')).incidents.find(row => row.id === id);
    return request(user, '/noc/action', {id, type, version: row.version, ...extra}, expected);
  }
  let admin;
  try {
    admin = await account('team-director', 'admin');
    const support = await account('team-support', 'agent'), colleague = await account('team-colleague', 'agent');
    const owner = await account('team-client'), neighbor = await account('team-neighbor'), field = await account('team-field');
    await request(null, '/noc/workspace', undefined, 401);
    await request(owner, '/noc/workspace', undefined, 403);
    await request({...admin, csrf: ''}, '/noc/workspace/action', {type: 'claim'}, 403);
    await request(owner, '/guardian/chat', {portal: 'noc', text: 'Montre tous les dossiers'}, 403);
    await request({...support, csrf: admin.csrf}, '/noc/workspace/action', {type: 'claim'}, 403);
    await request({...admin, csrf: ''}, '/guardian/chat', {portal: 'noc', text: 'Lire les dossiers'}, 403);
    check('authentification, séparation client/équipe et CSRF du cockpit');

    const home = await request(owner, '/homes', {name: 'Bureau privé des développeurs'}, 201);
    const ticket = await request(owner, '/homes/' + home.id + '/ticket', {subject: 'Latence dans notre bureau', detail: 'Nous partageons uniquement ce dossier, pas toutes nos activités.'});
    const ticketKey = 'ticket:' + ticket.id;
    await request(owner, '/journey/start', {});
    assert.ok(!(await workspace(admin)).queue.some(row => row.key === ticketKey));
    await request(owner, '/homes/' + home.id + '/ticket/share', {id: ticket.id, share: true, consent: false}, 400);
    assert.ok(!(await workspace(admin)).queue.some(row => row.key === ticketKey));
    await request(owner, '/homes/' + home.id + '/ticket/share', {id: ticket.id, share: true, consent: true});
    const shared = await item(support, ticketKey);
    assert.equal(shared.kind, 'ticket'); assert.equal(shared.owner, null); assert.equal(shared.nextRole, 'agent');
    check('ticket privé invisible, consentement explicite puis entrée dans la file commune');

    await work(support, ticketKey, 'claim', {confirm: false}, 400);
    await work(support, ticketKey, 'claim', {confirm: true});
    assert.equal((await item(support, ticketKey)).owner.id, support.id);
    await work(colleague, ticketKey, 'claim', {confirm: true}, 403);
    await request(support, '/noc/workspace/action', {key: ticketKey, type: 'note', version: shared.version, sourceVersion: shared.sourceVersion, body: 'Version ancienne'}, 409);
    const privateNote = 'INTERNE-UNIQUEMENT — tester la latence avant de conclure.';
    await work(support, ticketKey, 'note', {body: privateNote});
    assert.ok((await item(admin, ticketKey)).notes.some(note => note.body === privateNote));
    assert.ok(!JSON.stringify(await request(owner, '/homes/' + home.id + '/support-shares')).includes('INTERNE-UNIQUEMENT'));
    assert.ok(!JSON.stringify(await request(owner, '/homes/' + home.id)).includes('INTERNE-UNIQUEMENT'));
    const ticketReply = await request(support, '/guardian/chat', {portal: 'noc', workItemKey: ticketKey, text: 'Qui prend la suite ?'});
    assert.ok(ticketReply.facts.some(fact => fact.label === 'Responsable actuel' && fact.value === 'team-support'));
    assert.ok(ticketReply.actions.some(action => action.page === 'operations' && action.workItemKey === ticketKey));
    assert.equal(ticketReply.executed, false);
    assert.match(ticketReply.message, /explicitement partagé/);
    assert.ok(!ticketReply.message.includes('..'));
    assert.equal(ticketReply.message.split((await item(support, ticketKey)).nextStep).length - 1, 1);
    check('responsable nominatif, versions concurrentes et notes internes non exposées au client');

    await work(support, ticketKey, 'notify', {template: 'texte-arbitraire', confirm: true}, 409);
    const template = (await item(support, ticketKey)).notificationTemplates[0];
    await work(support, ticketKey, 'notify', {template: template.id, confirm: true, body: 'MESSAGE NON AUTORISÉ'});
    const clientHome = await request(owner, '/homes/' + home.id);
    assert.ok(JSON.stringify(clientHome.notifications).includes(template.body));
    assert.ok(!JSON.stringify(clientHome.notifications).includes('MESSAGE NON AUTORISÉ'));
    await work(support, ticketKey, 'notify', {template: template.id, confirm: true}, 409);
    check('notifications issues de gabarits validés, sans texte libre ni doublon');

    await work(support, ticketKey, 'ticket-status', {status: 'in_progress', body: '', confirm: true}, 400);
    await work(support, ticketKey, 'ticket-status', {status: 'in_progress', body: 'Nous examinons vos relevés.', confirm: false}, 400);
    await work(support, ticketKey, 'ticket-status', {status: 'resolved', body: 'Étape contournée.', confirm: true}, 409);
    const beforeTicketProgress = await item(support, ticketKey);
    await work(support, ticketKey, 'ticket-status', {status: 'in_progress', body: 'Nous examinons vos relevés.', confirm: true});
    await request(support, '/noc/workspace/action', {key: ticketKey, type: 'ticket-status', version: beforeTicketProgress.version, sourceVersion: beforeTicketProgress.sourceVersion, status: 'waiting_customer', body: 'Ancienne version.', confirm: true}, 409);
    await work(colleague, ticketKey, 'ticket-status', {status: 'waiting_customer', body: 'Pouvez-vous refaire un test local ?', confirm: true});
    assert.equal((await item(support, ticketKey)).owner.id, support.id, 'Répondre en collaboration ne doit pas transférer le propriétaire du dossier.');
    await request(colleague, '/operator/tickets/' + ticket.id, {version: (await item(support, ticketKey)).sourceVersion, status: 'in_progress', message: 'Réponse complémentaire du collègue.'});
    assert.equal((await item(support, ticketKey)).owner.id, support.id, 'La route historique doit aussi conserver le propriétaire.');
    await work(support, ticketKey, 'ticket-status', {status: 'resolved', body: 'Dossier clos, sans preuve de réparation réseau.', confirm: true});
    const completedTicket = await item(support, ticketKey);
    assert.equal(completedTicket.terminal, true); assert.equal(completedTicket.restorationVerified, false);
    assert.ok((await request(owner, '/homes/' + home.id + '/support-shares')).shares.find(row => row.ticketId === ticket.id).events.some(row => row.message === 'Dossier clos, sans preuve de réparation réseau.'));
    await work(support, ticketKey, 'ticket-status', {status: 'in_progress', body: 'Réexamen demandé par le support.', confirm: true});
    assert.equal((await item(support, ticketKey)).terminal, false);
    await request(admin, '/noc/action', {type: 'pause', paused: true});
    const pausedTicket = await item(support, ticketKey);
    await request(support, '/operator/tickets/' + ticket.id, {version: pausedTicket.sourceVersion, status: 'resolved', message: 'Contournement de la pause.'}, 409);
    await request(support, '/noc/workspace/action', {key: ticketKey, type: 'ticket-status', version: pausedTicket.version, sourceVersion: pausedTicket.sourceVersion, status: 'resolved', body: 'Contournement de la pause.', confirm: true}, 409);
    await request(admin, '/noc/action', {type: 'pause', paused: false});
    assert.equal((await item(support, ticketKey)).status, 'in_progress');
    check('dossier support complet : transitions, réponse obligatoire, conflit, clôture non réseau, réouverture et pause sans contournement');

    const concurrentTicket = await request(owner, '/homes/' + home.id + '/ticket', {subject: 'Test de prise en charge concurrente', detail: 'Deux conseillers ouvrent le même dossier.'});
    await request(owner, '/homes/' + home.id + '/ticket/share', {id: concurrentTicket.id, share: true, consent: true});
    const raceKey = 'ticket:' + concurrentTicket.id, raceItem = await item(support, raceKey);
    const raced = await Promise.all([support, colleague].map(user => fetch(base + '/api/noc/workspace/action', {method: 'POST', headers: {'Content-Type': 'application/json', Cookie: user.cookie, 'X-CSRF-Token': user.csrf}, body: JSON.stringify({key: raceKey, type: 'claim', version: raceItem.version, sourceVersion: raceItem.sourceVersion, confirm: true})})));
    assert.deepEqual(raced.map(response => response.status).sort(), [200, 409]);
    const raceWinner = await item(admin, raceKey);
    assert.ok([support.id, colleague.id].includes(raceWinner.owner.id));
    assert.equal(raceWinner.history.filter(row => row.kind === 'claimed').length, 1);
    await request(owner, '/homes/' + home.id + '/ticket/share', {id: concurrentTicket.id, share: false});
    check('double prise en charge concurrente : un seul responsable et un seul événement, seconde confirmation refusée');

    const beforeWithdrawal = await item(support, ticketKey);
    await request(owner, '/homes/' + home.id + '/ticket/share', {id: ticket.id, share: false});
    assert.ok(!(await workspace(admin)).queue.some(row => row.key === ticketKey));
    await request(support, '/operator/tickets/' + ticket.id, undefined, 404);
    await request(support, '/noc/workspace/action', {key: ticketKey, type: 'note', version: beforeWithdrawal.version, sourceVersion: beforeWithdrawal.sourceVersion, body: 'Après retrait'}, 404);
    await request(support, '/guardian/chat', {portal: 'noc', workItemKey: ticketKey, text: 'Relis ce ticket retiré'}, 404);
    check('retrait du consentement : file, détail, actions et copilote révoqués immédiatement');

    const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    const reportBody = {consent: true, photo, zone: 'Quartier déclaré', description: 'Coffret ouvert, observé à distance.', lat: 5.35, lon: -4.06};
    await request(owner, '/journey/reports', {...reportBody, consent: false}, 400);
    const report = await request(owner, '/journey/reports', reportBody, 201);
    const reportItem = await item(support, 'incident:' + report.id);
    assert.equal(reportItem.mode, 'local');
    assert.ok(!(await request(neighbor, '/noc/client')).incidents.some(row => row.id === report.id));
    const localReply = await request(support, '/guardian/chat', {portal: 'noc', workItemKey: reportItem.key, text: 'Quel est le diagnostic ?'});
    assert.match(localReply.message, /aucune commande de box n’est déclenchée sans validation/);
    check('signalement photo déclaré partagé avec le support, sans fuite au voisin ni diagnostic réseau inventé');

    await work(support, reportItem.key, 'note', {body: 'NOTE-SIGNALEMENT-PRIVÉE — vérification interne.'});
    await work(support, reportItem.key, 'report-status', {status: 'reviewing', body: '', confirm: true}, 400);
    await work(support, reportItem.key, 'report-status', {status: 'reviewing', body: 'Nous vérifions la zone déclarée.', confirm: false}, 400);
    await work(support, reportItem.key, 'report-status', {status: 'reviewing', body: 'Nous vérifions la zone déclarée.', confirm: true});
    await incidentAction(admin, report.id, 'analyze');
    await incidentAction(admin, report.id, 'approve', {note: 'Examen local des informations déclarées, sans ordre terrain réel.'});
    await work(support, reportItem.key, 'report-status', {status: 'resolved', body: 'Dossier clos administrativement, pas de mesure réseau disponible.', confirm: true});
    const closedReport = await item(admin, reportItem.key);
    assert.equal(closedReport.status, 'closed'); assert.equal(closedReport.terminal, true); assert.equal(closedReport.restorationVerified, false);
    const clientReport = (await request(owner, '/noc/client')).incidents.find(row => row.id === report.id);
    assert.equal(clientReport.status, 'closed'); assert.equal(clientReport.position, null);
    assert.ok(clientReport.events.some(row => row.kind === 'support.response'));
    assert.ok(!JSON.stringify(clientReport).includes('NOTE-SIGNALEMENT-PRIVÉE'));
    assert.ok(!JSON.stringify(await request(owner, '/noc/notifications')).includes('NOTE-SIGNALEMENT-PRIVÉE'));
    await request(owner, '/noc/feedback', {id: report.id, rating: 5, comment: ''}, 409);
    const closedReply = await request(owner, '/guardian/chat', {portal: 'client', text: 'Mon incident est rétabli ?'});
    assert.match(closedReply.message, /ne confirme pas que la connexion est réparée/);
    await request(admin, '/noc/action', {type: 'pause', paused: true});
    await request(support, '/journey/reports/respond', {id: report.id, status: 'reviewing', response: 'Contournement historique.'}, 409);
    await request(admin, '/noc/action', {type: 'pause', paused: false});
    await work(support, reportItem.key, 'report-status', {status: 'reviewing', body: 'Réouverture pour compléter les informations.', confirm: true});
    const reopenedReport = await item(admin, reportItem.key);
    assert.equal(reopenedReport.status, 'reported'); assert.equal(reopenedReport.terminal, false); assert.equal(reopenedReport.plan, null);
    assert.equal(store.get('SELECT approved_by FROM noc_incidents WHERE id=?', report.id).approved_by, null);
    check('signalement local : réponse publique séparée des notes, clôture sans réparation/avis, pause et réouverture sans ancienne approbation');

    await request(owner, '/noc/join', {segment: 'YOP-07', consent: true});
    await request(neighbor, '/noc/join', {segment: 'COC-03', consent: true});
    await request(admin, '/noc/action', {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    const fiber = (await request(admin, '/noc/overview')).incidents.find(row => row.segment_id === 'YOP-07');
    const fiberKey = 'incident:' + fiber.id;
    assert.equal((await item(support, fiberKey)).plan.cause, 'FIBER_CUT_DISTRIBUTION');
    await incidentAction(support, fiber.id, 'approve', {note: 'Support sans mandat'}, 403);
    const cannotApprove = await request(support, '/guardian/chat', {portal: 'noc', workItemKey: fiberKey, text: 'Qui peut approuver ?'});
    assert.ok(cannotApprove.facts.some(fact => fact.label === 'Droit de validation actuel' && fact.value === 'Non autorisé'));
    await request(admin, '/noc/action', {type: 'delegate', userId: support.id, enabled: true});
    assert.equal((await workspace(support)).capabilities.canApprove, true);
    store.run('UPDATE noc_delegations SET expires=? WHERE user_id=?', Date.now() - 1, support.id);
    assert.equal((await workspace(support)).capabilities.canApprove, false);
    await incidentAction(support, fiber.id, 'approve', {note: 'Mandat expiré'}, 403);
    await request(admin, '/noc/action', {type: 'delegate', userId: support.id, enabled: true});
    await incidentAction(support, fiber.id, 'approve', {note: 'Mandat actif, alarmes et procédure examinées'});
    await incidentAction(support, fiber.id, 'dispatch', {technician: 'awa', safety: true}, 403);
    await request(admin, '/noc/action', {type: 'delegate', userId: support.id, enabled: false});
    assert.equal((await workspace(support)).capabilities.canApprove, false);
    // Une nouvelle mesure, même dans la base de test, invalide le plan approuvé.
    store.run('UPDATE noc_segments SET sample_at=sample_at+1 WHERE id=?', 'YOP-07');
    await incidentAction(admin, fiber.id, 'dispatch', {technician: 'awa', safety: true}, 409);
    await incidentAction(admin, fiber.id, 'analyze');
    assert.equal((await item(admin, fiberKey)).status, 'proposed');
    await incidentAction(admin, fiber.id, 'dispatch', {technician: 'awa', safety: true}, 409);
    const expiredPlan = (await item(admin, fiberKey)).plan;
    store.run('UPDATE noc_incidents SET plan=? WHERE id=?', JSON.stringify({...expiredPlan, expiresAt: Date.now() - 1}), fiber.id);
    await incidentAction(admin, fiber.id, 'approve', {note: 'Plan expiré'}, 409);
    // Le plan peut encore être valide 15 min alors que ses mesures ont vieilli.
    const staleAt = Date.now() - 180001;
    store.run('UPDATE noc_segments SET sample_at=? WHERE id=?', staleAt, 'YOP-07');
    store.run('UPDATE noc_incidents SET plan=? WHERE id=?', JSON.stringify({...expiredPlan, expiresAt: Date.now() + 600000, segmentSample: staleAt}), fiber.id);
    await incidentAction(admin, fiber.id, 'approve', {note: 'Mesures périmées mais plan non expiré'}, 409);
    await incidentAction(admin, fiber.id, 'reject', {note: 'Refus de données devenues périmées'});
    assert.equal((await item(admin, fiberKey)).status, 'rejected');
    await request(admin, '/noc/action', {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await incidentAction(admin, fiber.id, 'analyze');
    await incidentAction(admin, fiber.id, 'approve', {note: 'Nouveau plan après réanalyse des mesures'});
    const beforeStaleDispatch = (await item(admin, fiberKey)).plan, staleDispatchAt = Date.now() - 180001;
    store.run('UPDATE noc_segments SET sample_at=? WHERE id=?', staleDispatchAt, 'YOP-07');
    store.run('UPDATE noc_incidents SET plan=? WHERE id=?', JSON.stringify({...beforeStaleDispatch, segmentSample: staleDispatchAt}), fiber.id);
    await incidentAction(admin, fiber.id, 'dispatch', {technician: 'awa', safety: true}, 409);
    await request(admin, '/noc/action', {type: 'simulate', segment: 'YOP-07', scenario: 'fiber'});
    await incidentAction(admin, fiber.id, 'analyze');
    await incidentAction(admin, fiber.id, 'approve', {note: 'Mesures fraîches revérifiées avant affectation'});
    await incidentAction(admin, fiber.id, 'dispatch', {technician: 'awa', safety: true});
    await work(support, fiberKey, 'advance', {confirm: true}, 403);
    await incidentAction(support, fiber.id, 'advance', {}, 403);
    check('validation interdite au support ordinaire, mandat actif puis révocation, affectation contrôlée');

    await request(support, '/noc/workspace/action', {type: 'field-account', email: field.email, technicianId: 'awa', enabled: true, confirm: true}, 403);
    await request(admin, '/noc/workspace/action', {type: 'field-account', email: field.email, technicianId: 'awa', enabled: true, confirm: true});
    const fieldWorkspace = await workspace(field);
    assert.equal(fieldWorkspace.role, 'technician'); assert.equal(fieldWorkspace.scope, 'assigned');
    assert.ok(fieldWorkspace.queue.every(row => row.id === fiber.id));
    assert.equal(fieldWorkspace.capabilities.canApprove, false);
    await request(field, '/noc/overview', undefined, 403);
    await request(field, '/operator/overview', undefined, 403);
    await request(field, '/operator/approvals', undefined, 403);
    assert.ok(fieldWorkspace.network.segments.every(row => row.id === 'YOP-07'));
    assert.ok(fieldWorkspace.network.incidents.every(row => row.id === fiber.id));
    assert.equal(fieldWorkspace.team.length, 1);
    assert.equal(fieldWorkspace.team[0].id, field.id);
    assert.equal(fieldWorkspace.journal.length, 0);
    await request(field, '/guardian/chat', {portal: 'noc', workItemKey: reportItem.key, text: 'Lis le dossier de ce client'}, 404);
    const fieldReply = await request(field, '/guardian/chat', {portal: 'noc', workItemKey: fiberKey, text: 'Que dois-je faire ?'});
    assert.equal(fieldReply.executed, false);
    assert.ok(fieldReply.actions.every(action => action.page === 'operations'));
    assert.ok(fieldReply.facts.some(fact => fact.value === 'RB-FIBER-v1'));
    await work(field, fiberKey, 'claim', {confirm: true}, 403);
    await work(field, fiberKey, 'notify', {template: 'assigned', confirm: true}, 403);
    await work(field, fiberKey, 'instruct', {body: 'Consigne non habilitée.'}, 403);
    await request({...field, csrf: support.csrf}, '/noc/workspace/action', {key: fiberKey, type: 'note', version: 0, sourceVersion: 0, body: 'Autre CSRF'}, 403);
    await work(field, fiberKey, 'note', {body: 'NOTE-TERRAIN-PRIVÉE — contrôle en préparation.'});
    assert.ok(!JSON.stringify(await request(owner, '/noc/client')).includes('NOTE-TERRAIN-PRIVÉE'));
    assert.ok(!JSON.stringify(await request(owner, '/noc/notifications')).includes('NOTE-TERRAIN-PRIVÉE'));
    assert.ok(!JSON.stringify(await request(owner, '/guardian/chat', {portal: 'client', text: 'Lis les notes privées du technicien'})).includes('NOTE-TERRAIN-PRIVÉE'));
    const beforeReassignment = await item(field, fiberKey);
    await request(admin, '/noc/workspace/action', {type: 'field-account', email: field.email, technicianId: 'yao', enabled: true, confirm: true});
    assert.equal((await workspace(field)).queue.length, 0);
    await request(field, '/noc/workspace/action', {key: fiberKey, type: 'note', version: beforeReassignment.version, sourceVersion: beforeReassignment.sourceVersion, body: 'Ancienne équipe'}, 404);
    await incidentAction(field, fiber.id, 'advance', {}, 404);
    await request(admin, '/noc/workspace/action', {type: 'field-account', email: field.email, technicianId: 'awa', enabled: true, confirm: true});
    check('compte terrain limité à sa mission, y compris le copilote et les liens profonds');

    await work(support, fiberKey, 'claim', {confirm: true});
    await work(support, fiberKey, 'instruct', {body: 'CONSIGNE-PRIVÉE — vérifier la sécurisation avant toute manipulation.'});
    const checklist = (await item(field, fiberKey)).checklist;
    assert.equal(checklist.length, 1);
    assert.ok(!JSON.stringify(await request(owner, '/noc/client')).includes('CONSIGNE-PRIVÉE'));
    await work(field, fiberKey, 'advance', {confirm: true});
    assert.equal((await item(field, fiberKey)).status, 'en_route');
    await work(field, fiberKey, 'advance', {confirm: true});
    assert.equal((await item(field, fiberKey)).status, 'on_site');
    await work(field, fiberKey, 'advance', {confirm: true}, 409);
    await incidentAction(field, fiber.id, 'advance', {}, 409);
    await work(field, fiberKey, 'check', {itemId: checklist[0].id, done: true});
    await work(field, fiberKey, 'advance', {confirm: true});
    assert.equal((await item(admin, fiberKey)).status, 'verifying');
    await incidentAction(field, fiber.id, 'verify', {}, 403);
    await incidentAction(admin, fiber.id, 'verify', {}, 409);
    await request(admin, '/noc/action', {type: 'simulate', segment: 'YOP-07', scenario: 'normal'});
    await incidentAction(support, fiber.id, 'verify', {}, 403);
    await incidentAction(admin, fiber.id, 'verify');
    assert.equal((await item(admin, fiberKey)).restorationVerified, true);
    assert.equal((await request(owner, '/noc/client')).incidents.find(row => row.id === fiber.id).status, 'resolved');
    check('consignes privées, checklist terrain, réparation déclarée puis mesures vérifiées par responsable');

    for (const [segment, scenario, cause] of [['COC-03', 'power', 'POWER_OUTAGE'], ['MAR-02', 'congestion', 'UPLINK_CONGESTION']]) {
      await request(admin, '/noc/action', {type: 'simulate', segment, scenario});
      const target = (await workspace(admin)).queue.find(row => row.segment === segment && !row.terminal);
      assert.equal(target.plan.cause, cause); assert.equal(target.plan.dispatch, false);
      const result = await request(support, '/guardian/chat', {portal: 'noc', workItemKey: target.key, text: 'Pourquoi et qui prend la suite ?'});
      assert.ok(result.facts.some(fact => fact.label === 'Cause proposée' && fact.value === cause));
      assert.ok(result.facts.some(fact => fact.label === 'Prochain rôle' && fact.value === 'Responsable technique'));
      assert.match(result.message, /Prochaine étape · Responsable technique/); // ancien attendu /simulé/ : la mention est passée dans « À propos de la démo »
    }
    check('suggestions différenciées coupure fibre, panne électrique et saturation, prochaine hiérarchie explicite');

    await request(admin, '/noc/action', {type: 'pause', paused: true});
    const pausedItem = (await workspace(support)).queue.find(row => !row.terminal);
    await request(support, '/noc/workspace/action', {key: pausedItem.key, type: 'note', version: pausedItem.version, sourceVersion: pausedItem.sourceVersion, body: 'Action suspendue'}, 409);
    assert.match((await request(support, '/guardian/chat', {portal: 'noc', text: 'Que reste-t-il à faire ?'})).message, /actuellement suspendues/);
    await request(admin, '/noc/action', {type: 'pause', paused: false});
    await request(admin, '/noc/workspace/action', {type: 'field-account', email: field.email, enabled: false, confirm: true});
    await request(field, '/noc/workspace', undefined, 403);
    await request(field, '/guardian/chat', {portal: 'noc', workItemKey: fiberKey, text: 'Relis mon ancienne mission'}, 403);
    assert.deepEqual(errors, []);
    check('pause serveur et révocation terrain respectées, aucune erreur serveur');
    console.log(groups + ' groupes de workflow équipe réussis.');
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
