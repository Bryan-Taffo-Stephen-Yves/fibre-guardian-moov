'use strict';
// Contrat UI des dossiers terminés et du chargement : tests VM sans navigateur.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'noc-view.js'), 'utf8');
function harness({state = [], search = ''} = {}) {
  const values = state.slice(), refs = [], dependencies = [], pendingEffects = [], intervals = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)}),
    useState(initial) {
      const index = stateIndex++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] || (refs[index] = {current: initial}); },
    useEffect(fn, deps) {
      const index = effectIndex++, previous = dependencies[index];
      if (!previous || deps.some((value, i) => previous[i] !== value)) { dependencies[index] = deps; pendingEffects.push(fn); }
    }
  };
  const context = {
    React, window: {FGMap: {View() {}}, FGCommand: {View: 'command-view'}, addEventListener() {}, removeEventListener() {}, scrollTo() {}},
    location: {search, href: 'http://localhost/codex/' + search}, URLSearchParams, URL,
    document: {getElementById() { return null; }},
    history: {pushState() {}}, FGJourney: {Robot() {}},
    setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {},
    setTimeout, clearTimeout
  };
  vm.runInNewContext(source, context, {filename: 'noc-view.js'});
  const ui = context.window.FGNoc;
  return {
    ui, intervals,
    render(name, props) { stateIndex = 0; refIndex = 0; effectIndex = 0; return ui[name](props); },
    effects() { for (const fn of pendingEffects.splice(0)) fn(); }
  };
}
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []; }
function text(tree) { return tree === null || tree === undefined || tree === false ? '' : typeof tree === 'object' ? (tree.children || []).map(text).join(' ') : String(tree); }
function find(tree, predicate) { const item = nodes(tree).find(predicate); assert.ok(item, 'Élément attendu absent'); return item; }
const button = (tree, label) => find(tree, node => node.type === 'button' && text(node) === label);
const settle = () => new Promise(resolve => setImmediate(resolve));
const incident = (status, extra = {}) => ({id: 'case-' + status, title: 'Dossier ' + status, status, mode: 'demo', terminal: status === 'closed' || status === 'resolved', restorationVerified: status === 'resolved', events: [{id: 'event', at: 1, public_text: 'Décision du support'}], ...extra});

async function main() {
  let groups = 0;
  async function check(label, fn) { await fn(); groups++; console.log('PASS ' + label); }

  await check('closed exclu des ouverts/missions, distinct des rétablissements vérifiés', () => {
    const {ui} = harness();
    const rows = [incident('reported'), incident('closed', {technician: 'awa'}), incident('resolved', {technician: 'yao'}), incident('en_route', {technician: 'amina'})];
    assert.equal(ui.selectIncidents(rows, {screen: 'incidents', status: 'open'}).length, 2);
    assert.equal(ui.selectIncidents(rows, {screen: 'missions'}).length, 1);
    assert.equal(ui.selectIncidents(rows, {screen: 'incidents', status: 'closed'})[0].status, 'closed');
    assert.equal(ui.selectIncidents(rows, {screen: 'incidents', status: 'resolved'})[0].status, 'resolved');
    assert.equal(ui.selectIncidents(rows, {screen: 'incidents', query: 'reported'}).length, 1);
    assert.equal(ui.isTerminal(incident('closed')), true);
  });

  await check('compteur NOC et filtre administratif utilisent le statut terminal', () => {
    const data = {role: 'admin', settings: {paused: false, last_scan: 1}, segments: [], incidents: [incident('closed'), incident('resolved'), incident('reported')], technicians: [], delegates: [], source: 'Test'};
    const overview = harness({state: [data], search:'?section=overview'});
    const tree = overview.render('App', {api: async () => data, user: {name: 'NOC'}, onClient() {}});
    const kpi = find(tree, n => n.type === 'section' && n.props.className === 'n-panel' && text(n).includes('Incidents ouverts'));
    assert.equal(find(kpi, n => n.type === 'strong').children[0], 1);
    const cases = harness({state: [data], search: '?section=incidents'});
    const caseTree = cases.render('App', {api: async () => data, user: {name: 'NOC'}, onClient() {}});
    assert.ok(nodes(caseTree).some(n => n.type === 'option' && n.props.value === 'closed'));
    assert.ok(!nodes(caseTree).some(n => n.props.className === 'n-process'));
    assert.ok(text(caseTree).includes('aucune réparation ni remise en service n’est confirmée'));
  });

  await check('clôture administrative : ni parcours de réparation, ni carte, ni évaluation', () => {
    const h = harness();
    const closed = incident('closed', {mode: 'local', restorationVerified: false, position: {eta: 0}, technician: {name: 'Awa', team: 'Ouest'}});
    const tree = h.render('ClientIncident', {api: async () => ({}), incident: closed, onSaved() {}});
    assert.ok(text(tree).includes('pas d’une confirmation de réparation'));
    assert.ok(!nodes(tree).some(n => [h.ui.TrackingSteps, h.ui.Feedback, h.ui.NetworkMap].includes(n.type)));
    assert.equal(h.render('Feedback', {incident: closed}), null);
    const steps = h.render('TrackingSteps', {incident: closed});
    assert.ok(text(steps).includes('n’a pas été vérifié'));
    assert.ok(!nodes(steps).some(n => n.type === 'ol'));
    assert.equal(h.render('NetworkMap', {incident: closed}).props.incident.position, null);
  });

  await check('prise en charge avant affectation et avis après preuve réseau seulement', () => {
    const h = harness();
    assert.equal(h.render('TrackingSteps', {incident: incident('reported')}), null);
    const resolved = h.render('ClientIncident', {incident: incident('resolved'), onSaved() {}});
    assert.ok(nodes(resolved).some(n => n.type === h.ui.Feedback));
    const unverified = h.render('ClientIncident', {incident: incident('resolved', {restorationVerified: false}), onSaved() {}});
    assert.ok(!nodes(unverified).some(n => n.type === h.ui.Feedback));
    assert.ok(text(unverified).includes('Aucune preuve de rétablissement'));
    const unverifiedSteps = h.render('TrackingSteps', {incident: incident('resolved', {restorationVerified: false})});
    assert.ok(!nodes(unverifiedSteps).some(n => n.type === 'ol'));
  });

  await check('chargement, erreur, bouton réessayer et disparition de l’erreur au succès', async () => {
    const h = harness(); let calls = 0;
    const props = {api: async () => { if (++calls === 1) throw new Error('Réseau indisponible'); return {incidents: [], segment: null}; }};
    let tree = h.render('ClientFeed', props);
    assert.ok(text(tree).includes('Nous recherchons votre dossier'));
    assert.equal(tree.props['aria-busy'], true);
    h.effects(); await settle();
    tree = h.render('ClientFeed', props);
    assert.ok(text(tree).includes('Réseau indisponible'));
    await button(tree, 'Réessayer le chargement').props.onClick();
    tree = h.render('ClientFeed', props);
    assert.ok(!nodes(tree).some(n => n.props.role === 'alert'));
    assert.equal(tree.props['aria-busy'], false);
    assert.ok(text(tree).includes('Aucune intervention en cours'));
    assert.equal(calls, 2);
  });

  await check('état vide actionnable : signaler ou ouvrir le formulaire de démonstration', async () => {
    const h = harness(); let reports = 0;
    const props = {api: async () => ({incidents: [], segment: null}), onReport() { reports++; }};
    h.render('ClientFeed', props); h.effects(); await settle();
    let tree = h.render('ClientFeed', props);
    button(tree, 'Signaler un problème').props.onClick(); assert.equal(reports, 1);
    button(tree, 'Tester un suivi de quartier').props.onClick();
    tree = h.render('ClientFeed', props);
    assert.equal(find(tree, n => n.type === 'details').props.open, true);
  });

  await check('données périmées signalées, données retirées si accès refusé', async () => {
    const h = harness(); let failure = 0;
    const props = {api: async () => { if (failure) { const e = new Error('Refus'); e.status = failure; throw e; } return {incidents: [incident('reported')], segment: null}; }};
    h.render('ClientFeed', props); h.effects(); await settle();
    failure = 503; await h.intervals[0]();
    let tree = h.render('ClientFeed', props);
    assert.ok(text(tree).includes('elles peuvent ne plus être à jour'));
    assert.ok(nodes(tree).some(n => n.type === h.ui.ClientIncident));
    failure = 403; await button(tree, 'Réessayer le chargement').props.onClick();
    tree = h.render('ClientFeed', props);
    assert.ok(!nodes(tree).some(n => n.type === h.ui.ClientIncident));
  });

  await check('le lien du copilote transmet la référence du dossier jusqu’au cockpit', () => {
    const links = [], action = {page: 'operations', incidentId: 'I2', workItemKey: 'incident:I2', label: 'Ouvrir ce dossier'};
    const copilot = harness({state: [true, [{role: 'assistant', message: 'Analyse', actions: [action]}]]});
    const tree = copilot.render('Copilot', {api: async () => ({}), onNavigate: (...args) => links.push(args)});
    button(tree, action.label).props.onClick();
    assert.deepEqual(links, [['operations', 'I2', 'incident:I2']]);
    const data = {role: 'admin', settings: {paused: false}, segments: [], incidents: [incident('reported')], technicians: [], delegates: []};
    const app = harness({state: [data], search: '?section=incidents'}), props = {api: async () => data, user: {id: 'A', name: 'Admin', role: 'admin'}};
    let appTree = app.render('App', props);
    find(appTree, node => node.type === app.ui.Copilot).props.onNavigate('operations', undefined, 'ticket:T2');
    appTree = app.render('App', props);
    const command = find(appTree, node => node.type === 'command-view');
    assert.equal(command.props.selectionRequest.key, 'ticket:T2');
    command.props.onSelectionChange('ticket:T2');
    appTree = app.render('App', props);
    assert.equal(find(appTree, node => node.type === app.ui.Copilot).props.workItemKey, 'ticket:T2');
    assert.equal(find(appTree, node => node.type === 'command-view').props.selectionRequest, null, 'Le callback consomme la demande pour ne pas la rejouer lors d’une prochaine visite.');
  });

  console.log(groups + ' groupes de régression UI réussis.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
