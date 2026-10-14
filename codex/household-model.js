/* Foyer de démonstration. No router API or network access. Explicit simulated data. */
(function (root) {
    'use strict';
    const DAY = 86400000, ROOMS = ['salon', 'chambre', 'cuisine', 'enfant', 'centre'];
    const NAMES = { salon: 'Salon', chambre: 'Chambre', cuisine: 'Cuisine', enfant: 'Chambre d’enfant', centre: 'Couloir central' };
    const POS = { salon: [2, 2], chambre: [15, 2], cuisine: [2, 15], enfant: [15, 15], centre: [8.5, 8.5] };
    const DATE = t => new Date(t).toISOString().slice(0, 10);
    function signal(room, router) { const p = POS[room], q = POS[router], distance = Math.hypot(p[0] - q[0], p[1] - q[1]); const walls = room === router ? 0 : router === 'centre' ? (room === 'enfant' ? 3 : 1) : room === 'centre' ? 1 : 2 * ((p[0] !== q[0] ? 1 : 0) + (p[1] !== q[1] ? 1 : 0)); const dbm = -30 - 20 * Math.log10(Math.max(1, distance)) - 4 * walls; return { distance: Math.round(distance * 10) / 10, walls, dbm: Math.round(dbm), quality: dbm > -60 ? 'good' : dbm >= -70 ? 'fair' : 'poor' }; }
    // Max-min allocation: redistribute unused shares instead of leaving idle capacity.
    function allocate(demands, capacity) { const result = demands.map(() => 0); let rest = Math.max(0, capacity), pending = demands.map((d, i) => i).filter(i => demands[i] > 0); while (pending.length && rest > 1e-8) {
        const share = rest / pending.length;
        let consumed = 0;
        const next = [];
        for (const i of pending) {
            const add = Math.min(share, demands[i] - result[i]);
            result[i] += add;
            consumed += add;
            if (demands[i] - result[i] > 1e-8)
                next.push(i);
        }
        rest -= consumed;
        if (consumed < 1e-8)
            break;
        pending = next;
    } return result; }
    function hourQuality(h) { return h === 9 ? 'slow' : h === 14 ? 'cut' : h === 20 ? 'slow' : 'good'; }
    function seedHours(devices, elapsed, dayOffset = 0) { return Array.from({ length: 24 }, (_, h) => { const seconds = Math.max(0, Math.min(3600, elapsed - h * 3600)), quality = hourQuality(h), capacity = quality === 'cut' ? 0 : quality === 'slow' ? 12 : 100; const demand = devices.map((d, i) => h < 6 ? (i === 2 ? .3 : i === 0 ? .02 : 0) : (.25 + ((h * 7 + i * 11 + dayOffset * 3) % 16) / 4)); const rates = allocate(demand, capacity); return { hour: h, seconds, quality: seconds ? quality : 'future', capacity: seconds ? capacity : null, connected: seconds ? (h < 6 ? 2 : 5) : 0, bytes: Object.fromEntries(devices.map((d, i) => [d.id, Math.round(rates[i] * 1e6 / 8 * seconds)])) }; }); }
    function createSession(opts = {}) {
        const now = new Date(opts.at ?? Date.now());
        const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 0, 0);
        const devices = [{ id: 'owner', name: 'iPhone de Koffi', kind: 'phone', room: 'salon', demand: 3, protected: true }, { id: 'work', name: 'MacBook de Hady', kind: 'laptop', room: 'chambre', demand: 7 }, { id: 'tv', name: 'LG TV', kind: 'tv', room: 'salon', demand: 9 }, { id: 'tablet', name: 'Smart TV LED 32 pouces', kind: 'tv', room: 'enfant', demand: 4 }, { id: 'console', name: 'PlayStation 5 de Koffi', kind: 'game', room: 'salon', demand: 2 }].map(d => ({ ...d, connected: true, blocked: false, limit: null, mbps: 0 }));
        const hours = seedHours(devices, opts.seed === false ? 0 : 18 * 3600), month = [];
        for (let day = 1; opts.seed !== false && day < now.getUTCDate(); day++) {
            const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day);
            const pastHours = seedHours(devices, 86400, day);
            month.push({ date: DATE(t), hours: pastHours, bytes: Object.fromEntries(devices.map(d => [d.id, pastHours.reduce((sum, hour) => sum + hour.bytes[d.id], 0)])) });
        }
        devices.forEach(d => { d.recognized = true; d.firstSeen = at - DAY; });
        const counts = hours.filter(h => h.seconds && h.hour >= 6).map(h => h.connected).sort((a,b) => a-b);
        return { virtualAt: at, day: DATE(at), devices, hours, month, connectionBaseline: {usual: counts.length ? counts[Math.floor(counts.length/2)] : null, samples:counts.length, origin:counts.length ? 'Historique simulé de la journée' : 'Apprentissage en attente'}, countWindow:[], unusualSeconds:0, lastCountAlert:null, nextDevice:1, lastSample:null, router: 'salon', scenario: 'normal', capacity: 100, total: 0, latency: 12, loss: .1, seconds: 0, alerts: [], events: [], overload: 0, lastAlert: null, rebootUntil: 0, reboots: [], revision: 0 };
    }
    function snapshotClone(s) { return JSON.parse(JSON.stringify(s)); }
    function log(s, text) { s.events.unshift({ at: s.virtualAt, text }); s.events = s.events.slice(0, 80); }
    function dayBytes(s, id) { return s.hours.reduce((n, h) => n + (h.bytes[id] || 0), 0); }
    function monthBytes(s, id) { const month = s.day.slice(0, 7); return dayBytes(s, id) + s.month.filter(d => d.date.startsWith(month)).reduce((n, d) => n + (d.bytes[id] || 0), 0); }
    // Instantaneous view at a timestamp; interval accounting uses the start of each second.
    function measure(s, at) {
        const reboot = at < s.rebootUntil;
        s.capacity = reboot || s.scenario === 'cut' ? 0 : s.scenario === 'slow' ? 12 : 100;
        const demands = s.devices.map((d, i) => { if (!d.connected || d.blocked)
            return 0; const wifi = signal(d.room, s.router), radio = wifi.dbm > -60 ? 100 : wifi.dbm >= -70 ? 28 : 8; const demand = (s.scenario === 'heavy' && d.id === 'console' ? 90 : d.demand) * (1 + .12 * Math.sin(s.seconds * .5 + i)); return Math.min(demand, radio, d.limit === null ? Infinity : d.limit); });
        const rates = allocate(demands, s.capacity);
        s.devices.forEach((d, i) => d.mbps = Math.round(rates[i] * 100) / 100);
        s.total = rates.reduce((a, b) => a + b, 0);
        s.latency = s.capacity === 0 ? 0 : s.total > .95 * s.capacity ? 67 : 12;
        s.loss = s.capacity === 0 ? 100 : s.scenario === 'slow' ? 1.2 : .1;
        return rates;
    }
    function tick(previous) {
        const s = snapshotClone(previous);
        const intervalStart = s.virtualAt;
        s.seconds++;
        s.virtualAt += 1000;
        s.revision++;
        const rates = measure(s, intervalStart);
        s.lastSample = {start: intervalStart, end:s.virtualAt, capacity:s.capacity, total:s.total, bytes:Object.fromEntries(s.devices.map((d,i)=>[d.id,Math.round(rates[i]*1e6/8)]))};
        const hour = new Date(intervalStart).getUTCHours(), h = s.hours[hour];
        h.seconds = Math.min(3600, h.seconds + 1);
        h.quality = s.capacity === 0 ? 'cut' : s.scenario === 'slow' ? 'slow' : 'good';
        h.capacity = s.capacity;
        h.connected = s.devices.filter(d => d.connected && !d.blocked).length;
        s.devices.forEach((d, i) => h.bytes[d.id] = (h.bytes[d.id] || 0) + Math.round(rates[i] * 1e6 / 8));
        const activeDevices = s.devices.filter(d => d.connected && !d.blocked);
        if (s.connectionBaseline.usual === null && activeDevices.length && activeDevices.every(d => d.recognized)) {
            s.countWindow.push(h.connected);
            s.countWindow = s.countWindow.slice(-30);
            s.connectionBaseline.samples = s.countWindow.length;
            if (s.countWindow.length === 30) s.connectionBaseline = {usual:s.countWindow.slice().sort((a,b)=>a-b)[15], samples:30, origin:'Médiane de 30 relevés simulés, appareils reconnus'};
        }
        else if (s.connectionBaseline.usual === null) { s.countWindow = []; s.connectionBaseline.samples = 0; }
        const usual = s.connectionBaseline.usual;
        s.unusualSeconds = usual !== null && h.connected >= usual + 2 ? s.unusualSeconds + 1 : 0;
        if (s.unusualSeconds >= 3 && (s.lastCountAlert === null || s.seconds-s.lastCountAlert >= 120)) {
            const newcomers=s.devices.filter(d=>d.connected&&!d.blocked&&!d.recognized);
            s.alerts.unshift({id:'connections-'+s.seconds,type:'connections',at:s.virtualAt,count:h.connected,usual,deviceIds:newcomers.map(d=>d.id),text:h.connected+' appareils connectés, contre '+usual+' habituellement. '+newcomers.length+' appareil(s) à vérifier. Cela ne prouve pas une intrusion : vérifiez les noms avec vos invités avant de bloquer.'});
            s.alerts=s.alerts.slice(0,12);s.lastCountAlert=s.seconds;log(s,'Nombre inhabituel d’appareils : propriétaire alerté dans l’application, aucun blocage automatique.');
        }
        const top = s.devices.reduce((a, d) => d.mbps > a.mbps ? d : a, s.devices[0]);
        const sustained = s.total >= 25 && top.mbps / s.total > .6;
        s.overload = sustained ? s.overload + 1 : 0;
        if (s.overload >= 10 && (s.lastAlert === null || s.seconds - s.lastAlert >= 120)) {
            s.alerts.unshift({ id: 'alert-' + s.seconds, device: top.id, at: s.virtualAt, share: Math.round(top.mbps / s.total * 100), text: top.name + ' utilise plus de 60 % du débit observé depuis 10 secondes. Vérifiez si cet usage est attendu.' });
            s.alerts = s.alerts.slice(0, 12);
            s.lastAlert = s.seconds;
            if (s.scenario === 'heavy' && top.id === 'console') s.scenarioAlertAt = s.seconds;
            log(s, 'Alerte de consommation, sans action automatique.');
        }
        if (DATE(s.virtualAt) !== s.day) {
            s.month.push({ date: s.day, hours: s.hours, bytes: Object.fromEntries(s.devices.map(d => [d.id, dayBytes(s, d.id)])) });
            s.month = s.month.filter(d => d.date.startsWith(DATE(s.virtualAt).slice(0, 7)));
            s.day = DATE(s.virtualAt);
            s.hours = seedHours(s.devices, 0);
        }
        // At the exact end of a reboot, restore live metrics without inventing traffic in the elapsed second.
        if (intervalStart < s.rebootUntil && s.virtualAt >= s.rebootUntil) { measure(s, s.virtualAt); log(s, 'Redémarrage virtuel terminé après 6 secondes simulées.'); }
        return s;
    }
    function command(previous, action, role) {
        if (role !== 'owner')
            throw Error('Seul le propriétaire du foyer peut appliquer cette action.');
        const s = snapshotClone(previous);
        const device = s.devices.find(d => d.id === action.id);
        const needs = ['limit', 'pause', 'resume', 'block', 'unblock', 'room', 'recognize'];
        if (needs.includes(action.type) && !device)
            throw Error('Appareil introuvable.');
        if (['pause', 'block'].includes(action.type) && device.protected)
            throw Error('L’appareil d’administration est protégé contre une coupure.');
        if (['pause', 'block', 'reboot', 'baseline', 'prepareHeavy'].includes(action.type) && action.confirmed !== true)
            throw Error('Une confirmation explicite est nécessaire.');
        if (action.type === 'prepareHeavy') {
            const consoleDevice = s.devices.find(d => d.id === 'console');
            consoleDevice.connected = true; consoleDevice.blocked = false; consoleDevice.limit = null; consoleDevice.room = s.router;
            log(s, 'Préparation confirmée du test : console virtuelle reconnectée, débloquée, sans limite et placée dans la pièce de la box. Les autres appareils et les historiques sont conservés.');
            return command(s, {type:'scenario', mode:'heavy'}, role);
        }
        else if (action.type === 'join') {
            if (s.devices.length >= 11) throw Error('Maximum de 11 appareils dans cette démonstration.');
            for (let i=0;i<3;i++) { const number=s.nextDevice++;s.devices.push({id:'guest-'+number,name:['Galaxy A54 de Mariam','iPhone invité','PC portable invité'][(number-1)%3]+' · '+number,kind:'phone',room:'salon',demand:2,connected:true,blocked:false,limit:null,mbps:0,recognized:false,firstSeen:s.virtualAt}); }
            log(s,'Trois appareils fictifs viennent de rejoindre le Wi-Fi. Vérification manuelle nécessaire.');
        }
        else if (action.type === 'recognize') {
            device.recognized=true;log(s,device.name+' reconnu par le propriétaire. La référence habituelle n’a pas été modifiée.');
        }
        else if (action.type === 'baseline') {
            const active=s.devices.filter(d=>d.connected&&!d.blocked);
            if (!active.length || active.some(d=>!d.recognized)) throw Error('Vérifiez tous les appareils connectés avant de modifier la référence.');
            s.connectionBaseline={usual:active.length,samples:1,origin:'Référence confirmée par le propriétaire'};s.unusualSeconds=0;
            log(s,'Nouvelle référence confirmée : '+active.length+' appareils habituels.');
        }
        else if (action.type === 'limit') {
            if (action.mbps !== null && (!Number.isFinite(action.mbps) || action.mbps < 1 || action.mbps > 100))
                throw Error('Choisissez une limite de 1 à 100 Mbps.');
            device.limit = action.mbps;
            log(s, device.name + ' : ' + (action.mbps === null ? 'limite retirée' : action.mbps + ' Mbps maximum') + ' (simulation).');
        }
        else if (action.type === 'pause' || action.type === 'block') {
            device.connected = false;
            device.mbps = 0;
            if (action.type === 'block')
                device.blocked = true;
            log(s, device.name + ' : ' + (device.blocked ? 'accès bloqué' : 'connexion suspendue') + ' (simulation).');
        }
        else if (action.type === 'resume') {
            if (device.blocked)
                throw Error('Débloquez cet appareil avant de le reconnecter.');
            device.connected = true;
            log(s, device.name + ' reconnecté (simulation).');
        }
        else if (action.type === 'unblock') {
            device.blocked = false;
            device.connected = true;
            log(s, device.name + ' débloqué et reconnecté (simulation).');
        }
        else if (action.type === 'room') {
            if (!ROOMS.includes(action.room))
                throw Error('Pièce inconnue.');
            device.room = action.room;
            log(s, 'Position déclarée de ' + device.name + ' : ' + NAMES[action.room] + '.');
        }
        else if (action.type === 'router') {
            if (!ROOMS.includes(action.room))
                throw Error('Emplacement inconnu.');
            s.router = action.room;
            log(s, 'Box virtuelle déplacée : ' + NAMES[action.room] + '.');
        }
        else if (action.type === 'scenario') {
            if (!['normal', 'heavy', 'slow', 'cut'].includes(action.mode))
                throw Error('Scénario inconnu.');
            s.scenario = action.mode;
            s.scenarioStarted = s.seconds; s.scenarioRun = (s.scenarioRun || 0) + 1; s.scenarioAlertAt = null;
            s.overload = 0; s.lastAlert = null;
            log(s, 'Scénario ' + { normal: 'réseau rétabli', heavy: 'gros téléchargement', slow: 'débit partagé réduit', cut: 'coupure WAN' }[action.mode] + ' lancé (simulation).');
        }
        else if (action.type === 'reboot') {
            s.reboots = s.reboots.filter(t => s.virtualAt - t < 600000);
            if (s.reboots.length >= 2)
                throw Error('Maximum : 2 redémarrages en 10 minutes simulées.');
            if (s.rebootUntil > s.virtualAt)
                throw Error('Le redémarrage est déjà en cours.');
            s.reboots.push(s.virtualAt);
            s.rebootUntil = s.virtualAt + 6000;
            s.capacity = 0; s.total = 0; s.latency = 0; s.loss = 100; s.devices.forEach(d => { d.mbps = 0; });
            log(s, 'Redémarrage virtuel confirmé. Aucun équipement réel modifié.');
        }
        else if (action.type === 'dismiss') {
            s.alerts = s.alerts.filter(a => a.id !== action.alertId);
        }
        else
            throw Error('Action non reconnue.');
        s.revision++;
        return s;
    }
    function recommend(s) { const active = s.devices.filter(d => d.connected && !d.blocked); if (!active.length)
        return null; return ROOMS.map(room => { const signals = active.map(d => signal(d.room, room).dbm); return { room, worst: Math.min(...signals), mean: signals.reduce((a, b) => a + b, 0) / signals.length }; }).sort((a, b) => b.worst - a.worst || b.mean - a.mean)[0]; }
    // Missing hours stay null: future or erased history must never be drawn as zero consumption.
    function analytics(s, date, deviceId = 'all') {
        const hours = date === s.day ? s.hours : s.month.find(d => d.date === date)?.hours;
        if (deviceId !== 'all' && !s.devices.some(d => d.id === deviceId)) throw Error('Appareil introuvable.');
        let cumulative = 0;
        return Array.from({length:24}, (_, hour) => {
            const record = hours?.[hour];
            if (!record || !record.seconds) return {hour, observed:false, bytes:null, cumulative:null, connected:null, devices:[]};
            const devices = s.devices.map(d => ({id:d.id, name:d.name, bytes:record.bytes[d.id] || 0}));
            const bytes = devices.filter(d => deviceId === 'all' || deviceId === d.id).reduce((sum,d) => sum+d.bytes,0);
            cumulative += bytes;
            return {hour, observed:true, seconds:record.seconds, bytes, cumulative, connected:record.connected, devices};
        });
    }
    function scenarioStatus(s, paused = false) {
        const device = s.devices.find(d => d.id === 'console'), elapsed = Math.max(0, s.seconds-(s.scenarioStarted ?? 0));
        const share = s.total > 0 ? device.mbps/s.total*100 : 0;
        const result = (stage, text) => ({stage, text, elapsed, share, progress:Math.min(10,s.overload)});
        if (paused) return result('paused', 'Mesures en pause. Reprenez les mesures pour poursuivre ce test.');
        if (s.rebootUntil > s.virtualAt) return result('reboot', 'La box virtuelle redémarre. Le test reprendra au retour de la connexion.');
        if (!elapsed) return result('waiting', 'Test lancé. Premier relevé dans une seconde simulée.');
        if (s.scenario === 'cut') return result('cut', 'Coupure simulée : débit Internet nul. Les appareils restent associés au Wi-Fi.');
        if (s.scenario === 'slow') return result('slow', 'Capacité totale réduite à 12 Mbps, partagée entre les appareils. Ce n’est pas une coupure Wi-Fi.');
        if (s.scenario === 'normal') return result('normal', 'Demande normale rétablie. Vos limites, blocages et emplacements restent conservés.');
        if (device.blocked || !device.connected) return result('offline', 'La console est '+(device.blocked?'bloquée':'suspendue')+'. Elle ne peut pas télécharger. Vos réglages ont été conservés.');
        if (s.total >= 25 && share > 60) return result(s.scenarioAlertAt != null ? 'alerted' : 'counting', s.scenarioAlertAt != null ? 'Alerte déclenchée pour ce test. Limitez la console à 10 Mbps pour réduire son usage.' : 'Usage dominant détecté. Alerte après 10 relevés consécutifs ; la progression repart à zéro si le seuil n’est plus atteint.');
        if (device.limit !== null) return result('limited', 'La console est limitée à '+device.limit+' Mbps : elle ne dépasse pas le seuil d’alerte. La limitation fonctionne ; aucune alerte n’est attendue tant que le seuil reste sous contrôle.');
        if (signal(device.room, s.router).dbm <= -60) return result('wifi', 'Le signal Wi-Fi de la console limite son débit. Le téléchargement est actif, mais pas dominant. Préparez le test pour la placer près de la box.');
        return result('below', 'Téléchargement actif, mais seuil non atteint : il faut plus de 60 % du débit total et au moins 25 Mbps dans le foyer. Aucune alerte artificielle ne sera créée.');
    }
    const api = { scenarioStatus, analytics, createSession, tick, command, signal, allocate, dayBytes, monthBytes, recommend, ROOMS, NAMES };
    root.FGHouse = api;
    if (typeof module !== 'undefined')
        module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
