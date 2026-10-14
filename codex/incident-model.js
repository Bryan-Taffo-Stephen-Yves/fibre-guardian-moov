/* Unified evidence model. Pure, bounded and explicitly simulated; no router commands. */
(function (root) {
    'use strict';
    const VERSION = 1, REQUIRED = 5, MAX_CASES = 40, MAX_EVENTS = 40, MAX_GAP = 15000;
    const KINDS = ['healthy', 'saturation', 'wan', 'slow', 'connections', 'wifi', 'unknown'];
    const STATUSES = ['open', 'verifying', 'resolved', 'improved', 'unchanged', 'unverifiable'];
    const ACTIONS = ['observe', 'limit-console', 'restore-network', 'review-devices', 'optimize-wifi'];
    const METRICS = ['capacityMbps', 'usageMbps', 'latencyMs', 'lossPct', 'connected', 'topSharePct', 'unknownCount', 'usualConnected', 'opticalDbm', 'wifiDbm', 'localMbps', 'linkUp'];
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const num = value => finite(value) ? value : null;
    const text = (value, max = 500) => typeof value === 'string' ? value.slice(0, max) : '';
    const clone = value => JSON.parse(JSON.stringify(value));
    function diagnosis(kind, title, explanation, action = 'observe', actionLabel = 'Vérifier avec de nouvelles mesures') {
        return { kind, title, explanation, action, actionLabel };
    }
    function normalizeHouse(house) {
        const s = house || {}, devices = Array.isArray(s.devices) ? s.devices : [];
        const active = devices.filter(d => d && d.connected && !d.blocked);
        const top = active.reduce((a, d) => !a || (num(d.mbps) || 0) > (num(a.mbps) || 0) ? d : a, null);
        const share = finite(s.total) && s.total > 0 && top && finite(top.mbps) ? top.mbps / s.total * 100 : 0;
        const usual = s.connectionBaseline ? num(s.connectionBaseline.usual) : null;
        const ready = finite(s.virtualAt) && finite(s.seconds) && s.seconds > 0 && finite(s.capacity) && finite(s.total) && finite(s.latency) && finite(s.loss);
        const metrics = {
            capacityMbps: ready ? s.capacity : null, usageMbps: ready ? s.total : null,
            latencyMs: ready ? s.latency : null, lossPct: ready ? s.loss : null,
            connected: Array.isArray(s.devices) ? active.length : null,
            topDeviceId: top ? text(top.id, 80) : null, topDeviceName: top ? text(top.name, 120) : null,
            topSharePct: ready ? share : null, unknownCount: active.filter(d => !d.recognized).length,
            usualConnected: usual, opticalDbm: null, wifiDbm: null, localMbps: null,
            linkUp: ready ? s.capacity > 0 : null
        };
        let d = diagnosis('healthy', 'Le foyer fonctionne normalement', 'Les mesures simulées ne franchissent aucun des seuils surveillés.');
        if (!ready) d = diagnosis('unknown', 'Premier relevé en attente', 'Aucune mesure récente disponible. Un débit absent n’est pas un débit nul.');
        else if (finite(s.rebootUntil) && s.rebootUntil > s.virtualAt) d = diagnosis('unknown', 'Redémarrage simulé en cours', 'Interruption planifiée. La vérification attend le retour des mesures après le redémarrage.');
        else if (s.capacity === 0) d = diagnosis('wan', 'Accès Internet indisponible', 'Les appareils peuvent rester associés au Wi-Fi. Aucune mesure optique n’est disponible : cela ne prouve pas une rupture de fibre.', 'restore-network', 'Rétablir le réseau simulé et vérifier');
        else if (s.capacity < 25) d = diagnosis('slow', 'Capacité Internet réduite', 'La capacité disponible est partagée entre les appareils. Cette observation ne localise pas une panne optique.', 'restore-network', 'Rétablir la capacité simulée et vérifier');
        else if (s.total >= 25 && share > 60) d = diagnosis('saturation', 'Un appareil domine le trafic', (top ? top.name : 'Un appareil') + ' utilise plus de 60 % du trafic observé. Vérifiez si cet usage est attendu ; ce seuil seul ne prouve pas une saturation.', top && top.id === 'console' ? 'limit-console' : 'review-devices', top && top.id === 'console' ? 'Limiter la console à 10 Mbps et vérifier' : 'Examiner les appareils');
        else if (usual !== null && active.length >= usual + 2) d = diagnosis('connections', 'Nombre inhabituel d’appareils', active.length + ' appareils sont connectés, contre ' + usual + ' habituellement. Ce nombre ne prouve pas une intrusion.', 'review-devices', 'Vérifier les appareils du foyer');
        return { id: 'household:' + s.virtualAt + ':' + s.seconds + ':' + s.revision, at: num(s.virtualAt), sampledAt: num(s.virtualAt), mode: 'simulation', origin: 'household', available: ready, transientUntil: finite(s.rebootUntil) && s.rebootUntil > s.virtualAt ? s.rebootUntil : null, metrics, diagnosis: d };
    }
    function normalizeLine(input) {
        const { w = {}, d = {}, at, seq } = input || {};
        const ready = finite(at) && ['dl', 'lat', 'loss', 'dev'].every(key => finite(w[key]));
        const metrics = { capacityMbps: num(w.dl), usageMbps: null, latencyMs: num(w.lat), lossPct: num(w.loss), connected: num(w.dev), topDeviceId: null, topDeviceName: null, topSharePct: null, unknownCount: null, usualConnected: null, opticalDbm: num(w.opt), wifiDbm: num(w.wifi), localMbps: num(w.loc), linkUp: finite(w.link) ? w.link >= 0.5 : null };
        let result;
        if (!ready) result = diagnosis('unknown', 'Mesures de ligne indisponibles', 'Attendez un relevé complet. Aucune conclusion n’est possible avec des valeurs absentes.');
        else if (d.cls === 'sain') result = diagnosis('healthy', 'La ligne fonctionne normalement', 'Le diagnostic de ligne ne détecte pas de dégradation sur ce relevé simulé.');
        else if (d.cls === 'rupture') result = diagnosis('wan', finite(w.opt) && w.opt < -36 ? 'Perte du signal optique simulée' : 'Accès Internet indisponible', finite(w.opt) && w.opt < -36 ? 'La télémétrie optique simulée indique un signal inférieur à −36 dBm. Une intervention peut être nécessaire ; aucun redémarrage ne répare une fibre endommagée.' : 'La liaison est indisponible mais les mesures ne prouvent pas une rupture optique.');
        else if (d.cls === 'attenuation') result = diagnosis('slow', 'Signal de ligne dégradé', 'Les mesures simulées suggèrent une atténuation. Aucun changement de scénario n’est présenté comme une réparation physique.');
        else if (d.cls === 'amont') result = diagnosis('wan', 'Dégradation au-delà du foyer', 'Pertes et délai sont élevés. Conserver les mesures pour le support ; ne pas promettre une réparation locale.');
        else if (d.cls === 'wifi') result = diagnosis('wifi', 'Liaison Wi-Fi dégradée', 'Le débit à la box reste disponible, mais la liaison locale et le signal Wi-Fi sont dégradés.', 'optimize-wifi', 'Essayer l’optimisation Wi-Fi simulée et vérifier');
        else if (d.cls === 'congestion') result = diagnosis('slow', 'Débit de ligne réduit', 'Le débit et le délai simulés sont dégradés. Il faut vérifier le retour à la normale avec de nouvelles mesures.');
        else if (d.cls === 'partage') result = diagnosis('connections', 'Beaucoup d’appareils sur la ligne', 'Le seuil du démonstrateur de ligne est dépassé. Ce seul nombre ne prouve pas un partage illicite ni une intrusion.', 'observe', 'Vérifier avec de nouvelles mesures');
        else result = diagnosis('unknown', 'Diagnostic à confirmer', 'Les observations sont insuffisantes pour localiser la cause.');
        return { id: 'line:' + at + ':' + seq, at: num(at), sampledAt: num(at), mode: 'simulation', origin: 'line', available: ready, transientUntil: null, metrics, diagnosis: { ...result, sourceClass: text(d.cls, 30) } };
    }
    function create() { return { version: VERSION, incidents: [], latest: null, nextId: 1, pending: null, seen: [] }; }
    function cleanFrame(raw) {
        if (!raw || !['household', 'line'].includes(raw.origin) || !['simulation', 'real', 'replay'].includes(raw.mode) || !finite(raw.at) || raw.at < 0 || raw.at > 8640000000000000 || !text(raw.id, 160) || !raw.metrics || !raw.diagnosis || !KINDS.includes(raw.diagnosis.kind)) return null;
        const metrics = {};
        METRICS.forEach(key => metrics[key] = key === 'linkUp' ? (typeof raw.metrics[key] === 'boolean' ? raw.metrics[key] : null) : num(raw.metrics[key]));
        METRICS.forEach(key => {
            const value = metrics[key];
            if (!finite(value)) return;
            const invalid = ['opticalDbm', 'wifiDbm'].includes(key) ? value < -200 || value > 50 : value < 0 || (['lossPct', 'topSharePct'].includes(key) && value > 100);
            if (invalid) metrics[key] = null;
        });
        metrics.topDeviceId = raw.metrics.topDeviceId == null ? null : text(raw.metrics.topDeviceId, 80);
        metrics.topDeviceName = raw.metrics.topDeviceName == null ? null : text(raw.metrics.topDeviceName, 120);
        return { id: text(raw.id, 160), at: raw.at, sampledAt: raw.at, origin: raw.origin, mode: raw.mode, available: raw.available === true, transientUntil: num(raw.transientUntil), metrics, diagnosis: { kind: raw.diagnosis.kind, title: text(raw.diagnosis.title, 160), explanation: text(raw.diagnosis.explanation, 1000), action: ACTIONS.includes(raw.diagnosis.action) ? raw.diagnosis.action : 'observe', actionLabel: text(raw.diagnosis.actionLabel, 160), sourceClass: text(raw.diagnosis.sourceClass, 30) } };
    }
    function addEvent(incident, at, type, message) {
        incident.timeline.push({ at, type, text: message });
        incident.timeline = incident.timeline.slice(-MAX_EVENTS);
        incident.updatedAt = at;
    }
    function finish(incident, status, frame, reason, evidence) {
        incident.status = status;
        incident.after = frame ? clone(frame) : null;
        incident.reason = incident.resultReason = reason;
        incident.evidence = evidence || [];
        addEvent(incident, frame ? frame.at : incident.updatedAt, 'result', reason);
        incident.verification = null;
    }
    function comparable(incident, frame) {
        const m = frame.metrics;
        if (!frame.available || frame.origin !== incident.origin || frame.mode !== incident.mode || frame.diagnosis.kind === 'unknown') return false;
        const keys = incident.kind === 'saturation' ? ['usageMbps', 'topSharePct', 'capacityMbps', 'lossPct'] : incident.kind === 'connections' ? ['connected'] : incident.kind === 'wifi' ? ['wifiDbm', 'localMbps', 'capacityMbps'] : ['capacityMbps', 'lossPct', 'latencyMs'];
        return keys.every(key => finite(m[key]));
    }
    function recovered(incident, frame) {
        const m = frame.metrics, cls = frame.diagnosis.sourceClass;
        if (m.linkUp === false) return false;
        if (incident.kind === 'saturation') return m.capacityMbps > 0 && m.lossPct < 5 && (m.usageMbps < 25 || m.topSharePct <= 60);
        if (incident.kind === 'connections') return incident.origin === 'household' ? finite(m.usualConnected) && m.connected < m.usualConnected + 2 : m.connected <= 18;
        if (incident.kind === 'wifi') return m.wifiDbm >= -72 && m.localMbps >= 45 && m.capacityMbps > 80;
        if (incident.origin === 'household') return m.capacityMbps >= 25 && m.lossPct < 3;
        if (incident.sourceClass === 'rupture' && !(m.opticalDbm !== null && m.opticalDbm > -26)) return false;
        return cls === 'sain' && m.capacityMbps >= 80 && m.lossPct < 3 && m.latencyMs < 45;
    }
    function improved(incident, frame) {
        const b = incident.before.metrics, a = frame.metrics;
        if (incident.kind === 'saturation') return a.capacityMbps > 0 && a.lossPct < 5 && a.topSharePct <= b.topSharePct - 10;
        if (incident.kind === 'connections') return a.connected < b.connected;
        if (incident.kind === 'wifi') return a.wifiDbm >= b.wifiDbm + 5 && a.localMbps >= b.localMbps + 10;
        if (b.capacityMbps === 0) return a.capacityMbps > 0 && a.lossPct < b.lossPct;
        return a.capacityMbps >= b.capacityMbps * 1.2 && a.lossPct <= b.lossPct && a.latencyMs <= b.latencyMs;
    }
    function outcome(incident, frames) {
        if (frames.every(frame => recovered(incident, frame))) return 'resolved';
        if (frames.every(frame => recovered(incident, frame) || improved(incident, frame))) return 'improved';
        return 'unchanged';
    }
    function summarize(incident, frames) {
        const last = frames[frames.length - 1], before = incident.before.metrics, after = last.metrics;
        const evidence = [frames.length + ' relevés distincts, postérieurs à l’action et issus de la même source.'];
        const fields = incident.kind === 'saturation' ? [['topSharePct', 'Part du premier appareil', '%'], ['usageMbps', 'Trafic total', 'Mbps']] : incident.kind === 'connections' ? [['connected', 'Appareils connectés', '']] : incident.kind === 'wifi' ? [['wifiDbm', 'Signal Wi-Fi', 'dBm'], ['localMbps', 'Débit local', 'Mbps']] : [['capacityMbps', 'Débit/capacité', 'Mbps'], ['lossPct', 'Pertes', '%'], ['latencyMs', 'Délai', 'ms']];
        fields.forEach(([key, label, unit]) => evidence.push(label + ' : ' + (before[key] === null ? 'indisponible' : Math.round(before[key] * 100) / 100) + ' → ' + (after[key] === null ? 'indisponible' : Math.round(after[key] * 100) / 100) + ' ' + unit));
        const status = outcome(incident, frames);
        const reason = status === 'resolved' ? 'Retour à l’état attendu confirmé sur 5 nouveaux relevés. Cela ne garantit pas l’absence d’autres problèmes.' : status === 'improved' ? 'Amélioration mesurée, mais les critères de résolution ne sont pas confirmés sur tous les relevés.' : 'La résolution n’est pas démontrée sur les 5 nouveaux relevés. Le problème reste à examiner.';
        finish(incident, status, last, reason, evidence);
    }
    function ingest(previous, raw) {
        const frame = cleanFrame(raw);
        if (!frame) return markUnavailable(previous, 'Relevé invalide : impossible de conclure.');
        if (previous.seen.includes(frame.id)) return previous;
        const state = clone(previous);
        // Discard delayed/out-of-order samples instead of treating historical observations as live.
        if (state.latest && state.latest.origin === frame.origin && state.latest.mode === frame.mode && frame.at <= state.latest.at) return previous;
        state.seen = state.seen.concat(frame.id).slice(-160);
        state.latest = frame;
        state.incidents.forEach(incident => {
            if (incident.status !== 'verifying' || !incident.verification || incident.archived) return;
            const v = incident.verification;
            if (frame.origin !== incident.origin || frame.mode !== incident.mode) return finish(incident, 'unverifiable', null, 'Source de mesures modifiée : les relevés ne sont pas comparables.');
            if (!frame.available) return finish(incident, 'unverifiable', null, 'Mesures indisponibles : la commande ne constitue pas une preuve de résolution.');
            if (frame.at <= v.startedAt) return;
            if (frame.at - v.lastAt > MAX_GAP || frame.at - v.startedAt > 60000) return finish(incident, 'unverifiable', null, 'Relevés trop espacés ou délai de vérification dépassé. Relancez un test avec des mesures récentes.');
            if (frame.transientUntil !== null && frame.transientUntil > frame.at) return;
            if (!comparable(incident, frame)) return finish(incident, 'unverifiable', null, 'Les nouveaux relevés ne contiennent pas toutes les mesures nécessaires à cette vérification.');
            v.frames.push(clone(frame)); v.lastAt = frame.at;
            incident.sampleCount = v.frames.length;
            incident.updatedAt = frame.at;
            incident.measurements = clone(v.frames);
            if (v.frames.length === REQUIRED) summarize(incident, v.frames);
        });
        if (!frame.available || frame.diagnosis.kind === 'healthy' || frame.diagnosis.kind === 'unknown' || (frame.transientUntil !== null && frame.transientUntil > frame.at)) { state.pending = null; return state; }
        const key = frame.mode + ':' + frame.origin + ':' + frame.diagnosis.kind;
        const active = state.incidents.find(i => !i.archived && i.origin === frame.origin && i.mode === frame.mode && i.kind === frame.diagnosis.kind && i.status !== 'resolved');
        if (active) { active.updatedAt = frame.at; state.pending = null; return state; }
        const old = state.pending;
        state.pending = old && old.key === key && frame.at - old.lastAt <= MAX_GAP ? { ...old, count: old.count + 1, lastAt: frame.at } : { key, count: 1, firstAt: frame.at, lastAt: frame.at };
        if (state.pending.count >= 3) {
            const d = frame.diagnosis;
            state.incidents.unshift({ id: 'FGI-' + state.nextId++, origin: frame.origin, mode: frame.mode, kind: d.kind, sourceClass: d.sourceClass || '', title: d.title, explanation: d.explanation, action: d.action, actionLabel: d.actionLabel, status: 'open', archived: false, openedAt: frame.at, updatedAt: frame.at, before: clone(frame), after: null, reason: '', resultReason: '', evidence: [], measurements: [], sampleCount: 0, targetSamples: REQUIRED, timeline: [{ at: frame.at, type: 'detected', text: 'Anomalie observée sur 3 relevés consécutifs. Aucune action appliquée automatiquement.' }], verification: null });
            state.incidents = state.incidents.slice(0, MAX_CASES);
            state.pending = null;
        }
        return state;
    }
    function beginVerification(previous, id, raw, actionLabel) {
        const frame = cleanFrame(raw || previous.latest), original = previous.incidents.find(i => i.id === id);
        if (!original || original.archived || original.status === 'resolved' || original.status === 'verifying') throw Error('Cet incident ne peut pas être vérifié dans cette session.');
        if (!frame || !previous.latest || !frame.available || frame.origin !== original.origin || frame.mode !== original.mode || previous.latest.origin !== frame.origin || previous.latest.mode !== frame.mode || frame.at !== previous.latest.at || frame.id !== previous.latest.id) throw Error('Une mesure récente issue de la même source est nécessaire.');
        if (!comparable(original, frame)) throw Error('Les mesures nécessaires à cette vérification sont indisponibles.');
        const state = clone(previous), incident = state.incidents.find(i => i.id === id);
        incident.status = 'verifying'; incident.before = clone(frame); incident.after = null; incident.reason = incident.resultReason = ''; incident.evidence = []; incident.measurements = []; incident.sampleCount = 0;
        incident.verification = { startedAt: frame.at, lastAt: frame.at, actionLabel: text(actionLabel, 200) || 'Vérification demandée', baseline: clone(frame), frames: [] };
        addEvent(incident, frame.at, 'verification', incident.verification.actionLabel + ' — attente de 5 nouveaux relevés. Une commande acceptée ne signifie pas que le problème est résolu.');
        return state;
    }
    function markUnavailable(previous, reason = 'Mesures indisponibles.', at) {
        const state = clone(previous);
        state.pending = null;
        if (state.latest) state.latest = { ...state.latest, available: false };
        state.incidents.forEach(incident => {
            if (incident.status !== 'verifying') return;
            if (finite(at)) incident.updatedAt = at;
            finish(incident, 'unverifiable', null, text(reason, 1000));
        });
        return state;
    }
    function hydrate(raw) {
        const state = create();
        if (!raw || raw.version !== VERSION || !Array.isArray(raw.incidents)) return state;
        const ids = new Set();
        raw.incidents.slice(0, MAX_CASES).forEach(item => {
            if (!item || !/^FGI-\d{1,9}$/.test(item.id || '') || ids.has(item.id) || !STATUSES.includes(item.status) || !KINDS.includes(item.kind) || ['healthy', 'unknown'].includes(item.kind) || !finite(item.openedAt) || !finite(item.updatedAt)) return;
            const before = cleanFrame(item.before), after = cleanFrame(item.after);
            if (!before || before.origin !== item.origin || before.mode !== item.mode) return;
            ids.add(item.id);
            const timeline = (Array.isArray(item.timeline) ? item.timeline : []).filter(e => e && finite(e.at) && typeof e.text === 'string').slice(-MAX_EVENTS).map(e => ({ at: e.at, type: text(e.type, 40), text: text(e.text, 1000) }));
            const measurements = (Array.isArray(item.measurements) ? item.measurements : []).slice(0, REQUIRED).map(cleanFrame).filter(f => f && f.origin === before.origin && f.mode === before.mode);
            const incident = { id: item.id, origin: before.origin, mode: before.mode, kind: item.kind, sourceClass: text(item.sourceClass, 30), title: text(item.title, 160), explanation: text(item.explanation, 1000), action: ACTIONS.includes(item.action) ? item.action : 'observe', actionLabel: text(item.actionLabel, 160), status: item.status, archived: true, openedAt: item.openedAt, updatedAt: item.updatedAt, before, after: after && after.origin === before.origin && after.mode === before.mode ? after : null, reason: text(item.reason || item.resultReason, 1000), resultReason: text(item.resultReason || item.reason, 1000), evidence: (Array.isArray(item.evidence) ? item.evidence : []).filter(e => typeof e === 'string').slice(0, 12).map(e => text(e, 1000)), measurements, timeline, verification: null, sampleCount: measurements.length, targetSamples: REQUIRED };
            if (['resolved', 'improved', 'unchanged'].includes(incident.status)) {
                const invalid = !incident.after || measurements.length !== REQUIRED || new Set(measurements.map(f => f.id)).size !== REQUIRED || measurements.some((f, index) => !comparable(incident, f) || f.at <= (index ? measurements[index - 1].at : before.at) || f.at - (index ? measurements[index - 1].at : before.at) > MAX_GAP || f.at - before.at > 60000) || outcome(incident, measurements) !== incident.status;
                if (invalid) finish(incident, 'unverifiable', null, 'Preuves enregistrées incomplètes ou invalides : résultat non vérifiable.');
                else incident.after = clone(measurements[measurements.length - 1]);
            }
            if (incident.status === 'open' || incident.status === 'verifying') finish(incident, 'unverifiable', null, 'Session interrompue : anciennes observations archivées, aucune résolution confirmée.');
            state.incidents.push(incident);
            state.nextId = Math.max(state.nextId, Number(item.id.slice(4)) + 1);
        });
        return state;
    }
    function report(state, id) {
        const incidents = id ? state.incidents.filter(i => i.id === id) : state.incidents;
        if (id && incidents.length === 0) throw Error('Incident introuvable : aucun rapport exporté.');
        const sourceModes = Array.from(new Set(incidents.map(i => i.mode).concat(state.latest ? [state.latest.mode] : [])));
        const simulation = sourceModes.every(mode => mode === 'simulation');
        const notice = simulation ? 'Prototype local : données simulées. Aucune commande sur une box réelle. Une résolution désigne les critères vérifiés, pas une garantie globale.' : 'Provenance conservée dans chaque relevé : ' + sourceModes.join(', ') + '. Les sources réelles, simulées et relues ne sont pas interchangeables. Une résolution désigne les critères vérifiés, pas une garantie globale ni une preuve d’action matérielle.';
        return clone({ schema: 'fibre-guardian.incidents.v1', capturedAt: state.latest ? state.latest.at : null, simulation, mode: sourceModes.length === 1 ? sourceModes[0] : sourceModes.length ? 'mixed' : 'unknown', sourceModes, notice, latest: state.latest, incidents });
    }
    const api = { create, normalizeHouse, normalizeLine, ingest, beginVerification, markUnavailable, hydrate, report, REQUIRED, MAX_GAP };
    root.FGIncidents = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
