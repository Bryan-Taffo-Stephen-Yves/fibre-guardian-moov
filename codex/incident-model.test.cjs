const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./incident-model.js');
const H = require('./household-model.js');
const E = require('../src/engine.js');
const AT = Date.UTC(2026, 9, 6, 18);
function line(cls, tick, values = {}) { return M.normalizeLine({ w: { ...E.PROFILES[cls === 'sain' ? 'nominal' : cls], link: cls === 'rupture' ? 0 : 1, ...values }, d: { cls }, at: AT + tick * 1000, seq: tick }); }
function houseFixture(mode = 'heavy') {
    let house = H.createSession({ at: AT });
    house = H.command(house, { type: 'scenario', mode }, 'owner');
    let state = M.create();
    for (let n = 0; n < 3; n++) { house = H.tick(house); state = M.ingest(state, M.normalizeHouse(house)); }
    return { house, state };
}
function nextHouse(state, house, count = 1) {
    for (let n = 0; n < count; n++) { house = H.tick(house); state = M.ingest(state, M.normalizeHouse(house)); }
    return { state, house };
}
test('fresh household never pretends the initial zero is an observed traffic rate', () => {
    const f = M.normalizeHouse(H.createSession({ at: AT }));
    assert.equal(f.available, false); assert.equal(f.metrics.usageMbps, null); assert.equal(f.diagnosis.kind, 'unknown');
    assert.equal(M.ingest(M.create(), f).incidents.length, 0);
});
test('households expose real source measurements and no fabricated optical reading', () => {
    const { house } = houseFixture(); const f = M.normalizeHouse(house);
    assert.equal(f.mode, 'simulation'); assert.equal(f.origin, 'household'); assert.equal(f.metrics.usageMbps, house.total);
    assert.equal(f.metrics.opticalDbm, null); assert.equal(f.metrics.topDeviceId, 'console'); assert.equal(f.diagnosis.action, 'limit-console');
    assert.equal(f.sampledAt, house.virtualAt);
});
test('household cut is not mislabelled as optical rupture and line evidence makes distinction', () => {
    const { house } = houseFixture('cut'), f = M.normalizeHouse(house);
    assert.equal(f.diagnosis.kind, 'wan'); assert.match(f.diagnosis.explanation, /ne prouve pas/);
    assert.equal(f.metrics.connected, 5); assert.equal(f.metrics.capacityMbps, 0);
    const optical = line('rupture', 1), unsupported = line('rupture', 1, { opt: undefined });
    assert.match(optical.diagnosis.title, /optique/); assert.doesNotMatch(unsupported.diagnosis.title, /optique/);
    assert.equal(optical.diagnosis.action, 'observe'); assert.equal(optical.metrics.usageMbps, null);
});
test('invalid/missing line measures remain unavailable rather than zero', () => {
    const f = M.normalizeLine({ w: {}, d: { cls: 'sain' }, at: AT, seq: 1 });
    assert.equal(f.available, false); assert.equal(f.metrics.capacityMbps, null); assert.equal(f.diagnosis.kind, 'unknown');
});
test('healthy streams create no incident and all transitions are immutable', () => {
    const initial = M.create(); let state = initial;
    for (let tick = 1; tick <= 30; tick++) state = M.ingest(state, line('sain', tick));
    assert.equal(state.incidents.length, 0); assert.equal(initial.latest, null); assert.equal(initial.seen.length, 0);
});
test('three distinct consecutive unhealthy frames are required, duplicates do not advance', () => {
    let state = M.create(); const f = line('wifi', 1);
    state = M.ingest(state, f); assert.strictEqual(M.ingest(state, f), state);
    state = M.ingest(state, line('wifi', 2)); assert.equal(state.incidents.length, 0);
    state = M.ingest(state, line('wifi', 3)); assert.equal(state.incidents.length, 1);
    for (let tick = 4; tick < 50; tick++) state = M.ingest(state, line('wifi', tick));
    assert.equal(state.incidents.length, 1);
});
test('healthy or distant frames interrupt consecutive detection evidence', () => {
    let state = M.ingest(M.create(), line('wifi', 1));
    state = M.ingest(state, line('wifi', 2)); state = M.ingest(state, line('sain', 3));
    state = M.ingest(state, line('wifi', 4)); state = M.ingest(state, line('wifi', 50));
    assert.equal(state.pending.count, 1); assert.equal(state.incidents.length, 0);
});
test('accepting a command or four fresh frames never marks the incident resolved', () => {
    let { state, house } = houseFixture(); const old = state;
    state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Limiter la console');
    assert.equal(state.incidents[0].status, 'verifying'); assert.equal(state.incidents[0].sampleCount, 0); assert.equal(old.incidents[0].status, 'open');
    house = H.command(house, { type: 'limit', id: 'console', mbps: 10 }, 'owner');
    ({ state, house } = nextHouse(state, house, 4));
    assert.equal(state.incidents[0].status, 'verifying'); assert.equal(state.incidents[0].sampleCount, 4);
    ({ state, house } = nextHouse(state, house));
    assert.equal(state.incidents[0].status, 'resolved'); assert.equal(state.incidents[0].measurements.length, 5);
    assert.ok(state.incidents[0].before.metrics.topSharePct > state.incidents[0].after.metrics.topSharePct);
    assert.equal(state.incidents[0].timeline.at(-1).type, 'result');
});
test('five frames with unchanged dominant traffic show unchanged not a fake success', () => {
    let { state, house } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Vérifier sans action');
    ({ state } = nextHouse(state, house, 5)); assert.equal(state.incidents[0].status, 'unchanged');
});
test('partial measurable improvement is separated from resolved', () => {
    let state = M.create();
    for (let t = 1; t <= 3; t++) state = M.ingest(state, line('wifi', t));
    state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Déplacer le téléphone');
    for (let t = 4; t <= 8; t++) state = M.ingest(state, line('wifi', t, { wifi: -73, loc: 35 }));
    assert.equal(state.incidents[0].status, 'improved'); assert.equal(state.incidents[0].measurements.length, 5);
});
test('a known Wi-Fi recovery resolves only after measured signal AND local rate improve', () => {
    let state = M.create();
    for (let t = 1; t <= 3; t++) state = M.ingest(state, line('wifi', t));
    state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Optimiser le Wi-Fi simulé');
    for (let t = 4; t <= 8; t++) state = M.ingest(state, line('sain', t, E.PROFILES.wifiFixed));
    assert.equal(state.incidents[0].status, 'resolved');
});
test('classification healthy alone does not prove that an optical fault recovered', () => {
    let state = M.create();
    for (let t = 1; t <= 3; t++) state = M.ingest(state, line('rupture', t));
    state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Observer');
    for (let t = 4; t <= 8; t++) state = M.ingest(state, line('sain', t, { opt: -40 }));
    assert.notEqual(state.incidents[0].status, 'resolved');
});
test('household restored capacity proves WAN restoration with before/after', () => {
    let { state, house } = houseFixture('cut'); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Rétablir le réseau simulé');
    house = H.command(house, { type: 'scenario', mode: 'normal' }, 'owner');
    ({ state } = nextHouse(state, house, 5));
    assert.equal(state.incidents[0].status, 'resolved'); assert.equal(state.incidents[0].before.metrics.capacityMbps, 0); assert.equal(state.incidents[0].after.metrics.capacityMbps, 100);
});
test('unusual device count has an explicit comparison with habitual count', () => {
    let house = H.createSession({ at: AT }); house = H.command(house, { type: 'join' }, 'owner'); let state = M.create();
    ({ state, house } = nextHouse(state, house, 3)); assert.equal(state.incidents[0].kind, 'connections');
    state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Suspendre deux appareils vérifiés');
    for (const id of ['guest-1', 'guest-2']) house = H.command(house, { type: 'pause', id, confirmed: true }, 'owner');
    ({ state } = nextHouse(state, house, 5)); assert.equal(state.incidents[0].status, 'resolved');
    assert.equal(state.incidents[0].before.metrics.connected, 8); assert.equal(state.incidents[0].after.metrics.connected, 6);
});
test('source change terminates verification as incomparable and never mixes measurements', () => {
    let { state } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Limiter');
    state = M.ingest(state, line('sain', 4));
    assert.equal(state.incidents[0].status, 'unverifiable'); assert.equal(state.incidents[0].after, null); assert.match(state.incidents[0].reason, /Source/);
});
test('missing metrics and unavailable collector terminate verification honestly', () => {
    let { state, house } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Limiter');
    const f = M.normalizeHouse(H.tick(house)); f.metrics.topSharePct = null;
    const missing = M.ingest(state, f); assert.equal(missing.incidents[0].status, 'unverifiable');
    const unavailable = M.markUnavailable(state, 'Collecteur arrêté'); assert.equal(unavailable.incidents[0].status, 'unverifiable'); assert.equal(unavailable.latest.available, false);
    assert.equal(state.incidents[0].status, 'verifying');
});
test('old, out-of-order and duplicate measurements cannot inflate proof', () => {
    let { state, house } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Observer');
    assert.strictEqual(M.ingest(state, state.latest), state);
    const delayed = { ...state.latest, id: 'delayed', at: state.latest.at - 1000 };
    assert.strictEqual(M.ingest(state, delayed), state);
    ({ state, house } = nextHouse(state, house)); assert.equal(state.incidents[0].sampleCount, 1);
    assert.strictEqual(M.ingest(state, state.latest), state);
});
test('stale baseline and wrong source are rejected before verification', () => {
    let { state, house } = houseFixture(); const old = state.latest;
    ({ state, house } = nextHouse(state, house));
    assert.throws(() => M.beginVerification(state, state.incidents[0].id, old, 'Observer'), /récente/);
    assert.throws(() => M.beginVerification(state, state.incidents[0].id, line('sain', 4), 'Observer'), /même source/);
});
test('a long sample gap cannot be interpreted as continuous verification', () => {
    let { state } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Observer');
    const later = { ...state.latest, id: 'after-gap', at: state.latest.at + 16000 };
    state = M.ingest(state, later); assert.equal(state.incidents[0].status, 'unverifiable'); assert.match(state.incidents[0].reason, /espacés/);
});
test('physically invalid measurements cannot prove recovery', () => {
    let { state, house } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Observer');
    const frame = M.normalizeHouse(H.tick(house)); frame.metrics.lossPct = -1;
    state = M.ingest(state, frame); assert.equal(state.incidents[0].status, 'unverifiable');
    assert.equal(state.latest.metrics.lossPct, null);
});
test('planned reboot is not detected as a fresh unexpected WAN incident', () => {
    let house = H.tick(H.createSession({ at: AT })); house = H.command(house, { type: 'reboot', confirmed: true }, 'owner');
    let state = M.create(); ({ state } = nextHouse(state, house, 6)); assert.equal(state.incidents.length, 0);
});
test('healthy samples never auto-close an unresolved incident without manual verification', () => {
    let { state, house } = houseFixture(); house = H.command(house, { type: 'scenario', mode: 'normal' }, 'owner');
    ({ state } = nextHouse(state, house, 8)); assert.equal(state.incidents[0].status, 'open');
});
test('recurrence creates a new incident only after resolved evidence and 3 fresh fault samples', () => {
    let { state, house } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Limiter');
    house = H.command(house, { type: 'limit', id: 'console', mbps: 10 }, 'owner'); ({ state, house } = nextHouse(state, house, 5));
    const resolvedId = state.incidents[0].id; house = H.command(house, { type: 'limit', id: 'console', mbps: null }, 'owner');
    ({ state } = nextHouse(state, house, 3)); assert.equal(state.incidents.length, 2); assert.notEqual(state.incidents[0].id, resolvedId); assert.equal(state.incidents[1].status, 'resolved');
});
test('hydrate rejects corrupt roots, malformed incidents and duplicate identifiers', () => {
    for (const invalid of [null, false, 'bad', {}, { version: 99, incidents: [] }, { version: 1, incidents: null }]) assert.deepEqual(M.hydrate(invalid), M.create());
    const { state } = houseFixture(); state.incidents.push({ ...state.incidents[0] }, { id: 'FGI-123', status: 'resolved', kind: 'wan', openedAt: AT, updatedAt: AT });
    const restored = M.hydrate(state); assert.equal(restored.incidents.length, 1); assert.equal(restored.latest, null); assert.equal(restored.seen.length, 0); assert.equal(restored.pending, null);
});
test('reload archives unfinished verification, refuses action and does not merge new session', () => {
    let { state, house } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Limiter');
    const restored = M.hydrate(JSON.parse(JSON.stringify(state)));
    assert.equal(restored.incidents[0].status, 'unverifiable'); assert.equal(restored.incidents[0].archived, true);
    assert.match(restored.incidents[0].reason, /Session interrompue/); assert.throws(() => M.beginVerification(restored, restored.incidents[0].id, state.latest, 'Observer'));
    ({ state } = nextHouse(restored, house, 3)); assert.equal(state.incidents.length, 2); assert.equal(state.incidents[0].archived, false);
});
test('resolved proof survives reload as historical only, corrupted proof becomes unverifiable', () => {
    let { state, house } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Limiter');
    house = H.command(house, { type: 'limit', id: 'console', mbps: 10 }, 'owner'); ({ state } = nextHouse(state, house, 5));
    const restored = M.hydrate(state); assert.equal(restored.incidents[0].status, 'resolved'); assert.equal(restored.incidents[0].archived, true);
    state.incidents[0].measurements = []; assert.equal(M.hydrate(state).incidents[0].status, 'unverifiable');
});
test('a forged resolved status cannot survive hydration when measurements prove unchanged', () => {
    let { state, house } = houseFixture(); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Observer');
    ({ state } = nextHouse(state, house, 5)); assert.equal(state.incidents[0].status, 'unchanged');
    state.incidents[0].status = 'resolved'; assert.equal(M.hydrate(state).incidents[0].status, 'unverifiable');
});
test('reports have traceable simulation provenance, before/after and five measured samples', () => {
    let { state, house } = houseFixture('cut'); state = M.beginVerification(state, state.incidents[0].id, state.latest, 'Rétablir');
    house = H.command(house, { type: 'scenario', mode: 'normal' }, 'owner'); ({ state } = nextHouse(state, house, 5));
    const report = M.report(state, state.incidents[0].id); assert.equal(report.schema, 'fibre-guardian.incidents.v1');
    assert.equal(report.simulation, true); assert.equal(report.mode, 'simulation');
    assert.match(report.notice, /simulées/); assert.match(report.notice, /Aucune commande/); assert.equal(report.incidents[0].measurements.length, 5);
    report.incidents[0].title = 'changed'; assert.notEqual(state.incidents[0].title, 'changed');
});
test('reports reject missing incidents and never label mixed real/replayed data as simulation', () => {
    const { state } = houseFixture(); assert.throws(() => M.report(state, 'FGI-999999'), /introuvable/);
    state.latest.mode = 'real'; const mixed = M.report(state);
    assert.equal(mixed.simulation, false); assert.equal(mixed.mode, 'mixed'); assert.deepEqual(mixed.sourceModes, ['simulation', 'real']);
    state.latest.mode = 'replay'; assert.equal(M.report(state).simulation, false);
});
test('bounded model keeps no more than40 incidents/40events/160dedupIDs', () => {
    let state = M.create(), tick = 0;
    for (let n = 0; n < 45; n++) {
        for (let j = 0; j < 3; j++) state = M.ingest(state, line('wifi', ++tick));
        const id = state.incidents[0].id; state = M.beginVerification(state, id, state.latest, 'Optimiser');
        for (let j = 0; j < 5; j++) state = M.ingest(state, line('sain', ++tick));
    }
    assert.equal(state.incidents.length, 40); assert.equal(state.seen.length, 160); assert.ok(state.incidents.every(i => i.timeline.length <= 40));
});
