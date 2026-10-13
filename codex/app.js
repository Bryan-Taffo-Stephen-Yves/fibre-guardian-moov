(function () {
    'use strict';
    const h = React.createElement, { useState, useEffect, useRef } = React;
    const { LABELS, NEXT, canView, rebootGate, readStorage, saveStorage } = FGUI;
    const PAGES = [['pilot', 'shield', 'Mon espace réel'], ['operator', 'shield', 'Espace administrateur'], ['home', 'home', 'Vue d’ensemble'], ['diagnostic', 'pulse', 'Diagnostic'], ['household', 'users', 'Ma maison'], ['incidents', 'bell', 'Incidents'], ['wifi', 'wifi', 'Wi-Fi maison'], ['assistant', 'chat', 'Assistant'], ['supervision', 'network', 'Supervision'], ['retention', 'users', 'Relation client'], ['economics', 'chart', 'Impact Moov'], ['stories', 'book', 'Les 4 histoires']];
    const MODES = [['nominal', 'Tout va bien'], ['rupture', 'Fibre coupée'], ['attenuation', 'Signal en baisse'], ['wifi', 'Wi-Fi faible'], ['amont', 'Panne chez Moov'], ['congestion', 'Réseau chargé'], ['partage', 'Trop d’appareils'], ['sms', 'Sans Internet']];
    const TITLES = { operator: ['Le portail support.', 'Connecté à vos clients.', 'Des dossiers partagés, des accès contrôlés et un suivi traçable.'], pilot: ['Votre foyer.', 'Des tests vérifiables.', 'Inviter des participants, mesurer, conserver les preuves et préparer le raccordement réel.'],  incidents: ['Un problème.', 'Des preuves, une solution.', 'Suivre les incidents, agir avec votre accord et vérifier le résultat sur de nouveaux relevés.'], household: ['Votre maison.', 'Un Wi-Fi partagé.', 'Voir les usages, comprendre les ralentissements et tester les bons réglages.'], home: ['Votre fibre,', 'en clair.', 'Comprendre sa connexion. Trouver la panne. Savoir quoi faire.'], diagnostic: ['Un problème ?', 'On le localise.', 'Choisissez une panne : le moteur observe les mesures et explique ce qui se passe.'], wifi: ['Le bon Wi-Fi,', 'dans chaque pièce.', 'Essayez un meilleur emplacement avant d’acheter du matériel.'], assistant: ['Une question,', 'des mots simples.', 'Un assistant local explique le diagnostic, à partir des mêmes mesures que vous.'], supervision: ['Voir l’incident.', 'Avant les appels.', 'Repérez les pannes communes à plusieurs abonnés d’un même quartier.'], retention: ['Prendre soin', 'de chaque abonné.', 'Priorisez une prise de contact humaine, sans sanction ni action automatique.'], economics: ['Un impact concret.', 'Des chiffres ouverts.', 'Modifiez les hypothèses pour comprendre la valeur potentielle pour Moov.'], stories: ['Quatre histoires.', 'Une fibre plus simple.', 'Découvrez le produit à travers des situations du quotidien à Abidjan.'], data: ['Vos données.', 'Rien de plus.', 'Voyez exactement ce que cette démonstration utilise, et gardez la main.'], help: ['Tout comprendre,', 'simplement.', 'Un petit guide pour utiliser Fibre Guardian sans être spécialiste.'] };
    const PATHS = {
        home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9', pulse: 'M2 12h5l3-8 4 16 3-8h5', wifi: 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0M12 20h.01', chat: 'M21 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 19 0ZM7 10h10M7 14h6', network: 'M12 8V4M4 16v-4h16v4M9 2h6v6H9zM1 16h6v6H1zM9 16h6v6H9zM17 16h6v6h-6z', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87', chart: 'M3 3v18h18M7 16V9M12 16V5M17 16v-5', book: 'M12 6v15M3 3c4 0 7 0 9 3 2-3 5-3 9-3v15c-4 0-7 0-9 3-2-3-5-3-9-3Z', arrow: 'M4 12h16M14 6l6 6-6 6', plus: 'M12 5v14M5 12h14', check: 'm5 12 4 4L19 6', x: 'm6 6 12 12M6 18 18 6', settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2', help: 'M9 8a3 3 0 1 1 5 2.2L12 12v2M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', shield: 'm12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6Zm-5 10 3 3 6-6', play: 'm8 4 13 8-13 8Z', globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M2 12h20M12 2c6 6 6 14 0 20-6-6-6-14 0-20', router: 'M4 11h16v9H4zM7 11V3M17 11V3M8 16h.01M12 16h.01M16 16h.01', clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', phone: 'M7 2h10v20H7zM10 18h4', bulb: 'M9 21h6M8 14a7 7 0 1 1 8 0v3H8z', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', camera: 'M3 6h4l2-3h6l2 3h4v15H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0', send: 'm22 2-7 20-4-9-9-4ZM22 2 11 13', expand: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5', refresh: 'M20 7V2l-3 3A9 9 0 1 0 3 16M20 7h-5', chevron: 'm9 5 7 7-7 7', bell: 'M18 8a6 6 0 0 0-12 0v7l-3 3h18l-3-3ZM10 21h4', pause: 'M8 5v14M16 5v14', leaf: 'M20 3C7 1 2 7 5 15c8 6 17-1 15-12ZM4 21 16 9', spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z'
    };
    function Icon({ name = 'spark', size = 20, ...props }) { return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...props }, h('path', { d: PATHS[name] || PATHS.spark })); }
    const fmt = (n, d = 0) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d });
    function Button({ children, icon, onClick, primary = false, className = '', ...props }) { return h('button', { type: 'button', className: 'btn ' + (primary ? 'primary ' : '') + className, onClick, ...props }, icon && h(Icon, { name: icon, size: 17 }), children); }
    function Capsules({ value = 0, lime = false }) { const n = Math.max(0, Math.min(10, Math.round(value / 10))); return h('div', { className: 'capsules', 'aria-label': fmt(value) + ' sur 100' }, Array.from({ length: 10 }, (_, i) => h('span', { key: i, className: i < n ? 'filled ' + (lime ? 'lime' : '') : '' }))); }
    function Badge({ state = 'ok', children }) { return h('span', { className: 'badge ' + state }, h('i'), children); }
    function PanelTitle({ icon, children, aside }) { return h('div', { className: 'panel-title' }, h('span', { className: 'icon-disc' }, h(Icon, { name: icon })), h('h2', null, children), aside && h('span', { className: 'panel-aside' }, aside)); }
    function Avatar({ index = 0, size = 44 }) { const colors = ['#e4f57e', '#b4c6be', '#e6c5ac', '#c9c8db']; return h('svg', { width: size, height: size, viewBox: '0 0 64 64', className: 'avatar', 'aria-hidden': true }, h('rect', { width: 64, height: 64, rx: 23, fill: colors[index % 4] }), h('path', { d: 'M9 64c1-17 11-23 23-23s22 6 23 23', fill: '#242c28' }), h('ellipse', { cx: 32, cy: 27, rx: 13, ry: 16, fill: '#956a49' }), h('path', { d: index % 2 ? 'M19 25c-7-21 33-23 27 1l-7-8-20 7' : 'M18 30C10 0 51 1 45 31l-6-15-19 7', fill: '#242321' }), h('path', { d: 'M28 33q4 4 8 0', stroke: '#efcfb0', fill: 'none', strokeWidth: 1.5 }), h('circle', { cx: 27, cy: 26, r: 1 }), h('circle', { cx: 37, cy: 26, r: 1 })); }
    function Modal({ title, children, onClose }) {
        const ref = useRef(null);
        useEffect(() => {
            const old = document.activeElement;
            const backgrounds = [...document.getElementById('root').children].filter(el => !el.contains(ref.current));
            const previousInert = backgrounds.map(el => el.inert);
            backgrounds.forEach(el => { el.inert = true; });
            const controls = () => [...ref.current.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
            (controls()[0] || ref.current).focus();
            const key = e => {
                if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
                if (e.key !== 'Tab') return;
                const items = controls(), active = document.activeElement;
                if (!items.length) { e.preventDefault(); ref.current.focus(); return; }
                if (!items.includes(active) || (e.shiftKey ? active === items[0] : active === items[items.length - 1])) {
                    e.preventDefault(); (e.shiftKey ? items[items.length - 1] : items[0]).focus();
                }
            };
            document.addEventListener('keydown', key);
            return () => { document.removeEventListener('keydown', key); backgrounds.forEach((el,i) => { el.inert = previousInert[i]; }); if (old?.isConnected) old.focus(); };
        }, []);
        return h('div', { className: 'modal-backdrop', onClick: e => { if (e.target === e.currentTarget)
                onClose(); } }, h('section', { className: 'modal', role: 'dialog', 'aria-modal': true, 'aria-label': title, tabIndex: -1, ref }, h('div', { className: 'modal-head' }, h('h2', null, title), h(Button, { icon: 'x', onClick: onClose, 'aria-label': 'Fermer' })), children));
    }
    function Chart({ history }) { const samples = history.filter((_, i) => i % Math.max(1, Math.ceil(history.length / 14)) === 0).slice(-14); return h('div', { className: 'chart-wrap' }, h('div', { className: 'chart-legend' }, h('span', null, h('i', { className: 'dot black' }), 'À la box'), h('span', null, h('i', { className: 'dot citron' }), 'Sur le téléphone'), h('span', null, 'Mbps · simulation')), h('svg', { viewBox: '0 0 660 176', role: 'img', 'aria-label': 'Comparaison du débit à la box et sur le téléphone, sur les ' + history.length + ' derniers échantillons' }, [0, 50, 100].map(v => h('g', { key: v }, h('line', { x1: 30, x2: 657, y1: 146 - v * 1.2, y2: 146 - v * 1.2, stroke: '#d5ddd4', strokeDasharray: v === 100 ? '3 5' : null }), h('text', { x: 0, y: 150 - v * 1.2, fill: '#636d64', fontSize: 10 }, v))), samples.map((p, i) => { const x = 42 + i * (602 / Math.max(1, samples.length)); return h('g', { key: i }, h('rect', { x, y: 146 - Math.max(5, p.dl * 1.2), width: 22, height: Math.max(5, p.dl * 1.2), rx: 11, fill: '#20251f' }), h('rect', { x, y: 146 - Math.max(5, p.loc * 1.2), width: 22, height: Math.max(5, p.loc * 1.2), rx: 11, fill: '#d6ed72' }), h('circle', { cx: x + 11, cy: 151 - Math.max(5, p.dl * 1.2), r: 3, fill: 'white' })); })), h('div', { className: 'chart-labels' }, h('span', null, 'Il y a ' + history.length + ' s'), h('span', null, 'Maintenant'))); }
    function LedGuide({ cls }) {
        const rows = [['PWR', 'Alimentation', 'Allumé'], ['PON', 'Connexion à la fibre', cls === 'rupture' ? 'Éteint' : 'Allumé'], ['LOS', 'Perte du signal fibre', cls === 'rupture' ? 'Alerte rouge' : 'Éteint : normal'], ['LAN', 'Connexion par câble', 'Allumé'], ['WLAN', 'Réseau Wi-Fi', cls === 'wifi' ? 'Signal à vérifier' : 'Allumé']];
        return h('details', { className: 'led-guide' }, h('summary', null, h(Icon, { name: 'bulb', size: 16 }), 'Comprendre les voyants de la box'), h('p', null, 'Exemple indicatif : les libellés et couleurs dépendent du modèle de box. La puissance fibre doit être vérifiée avec les mesures.'), h('dl', null, rows.map(([id, name, value]) => h('div', { key: id }, h('dt', null, id, ' · ', name), h('dd', null, value)))));
    }
    function App({onJourney}={}) {
        const [page, setPage] = useState('home'), [role, setRole] = useState('superviseur'), [lang, setLang] = useState('fr'), [mode, setMode] = useState('nominal');
        const [threeD, setThreeD] = useState(() => readStorage('3d', true) !== false), [paused, setPaused] = useState(false), [fine, setFine] = useState(true), [phoneTab, setPhoneTab] = useState('home');
        const [modal, setModal] = useState(null), [tour, setTour] = useState(-1), [tourOffer, setTourOffer] = useState(() => !readStorage('tour', false)), [presentation, setPresentation] = useState(-1), [story, setStory] = useState(null);
        const [toast, setToast] = useState(''), [messages, setMessages] = useState([]), [question, setQuestion] = useState(''), [asking, setAsking] = useState(false), [photo, setPhoto] = useState(null), [photoBusy, setPhotoBusy] = useState(false), [sms, setSms] = useState([]), [smsInput, setSmsInput] = useState('STATUT'), [linked, setLinked] = useState(true), [logs, setLogs] = useState([]), [tickets, setTickets] = useState([]);
        const sessionEpoch = useRef(0);
        const sourceRef = useRef('line'), [source, setSource] = useState('line');
        const incidentRef = useRef(null);
        if (!incidentRef.current) incidentRef.current = FGIncidents.hydrate(readStorage('incidents-v1', null));
        const [, setIncidentVersion] = useState(0), [persistenceAvailable, setPersistenceAvailable] = useState(true);
        const [commonFrame, setCommonFrame] = useState(null);
        const commonRef = useRef(null);
        function commitIncidents(next) {
            incidentRef.current = next;
            try { localStorage.setItem('fg-codex-incidents-v1', JSON.stringify(next)); setPersistenceAvailable(true); }
            catch (_) { setPersistenceAvailable(false); }
            setIncidentVersion(v => v + 1);
        }
        function selectSource(next) {
            if (!['line','household'].includes(next) || sourceRef.current === next) return;
            commitIncidents(FGIncidents.markUnavailable(incidentRef.current, 'Source changée : les relevés ne sont plus comparables.'));
            sourceRef.current = next; setSource(next); commonRef.current = null; setCommonFrame(null);
        }
        function publishFrame(frame) {
            commonRef.current = frame; setCommonFrame(frame);
            const previous = incidentRef.current, next = FGIncidents.ingest(previous, frame);
            const completed = next.incidents.find(item => item.status !== 'verifying' && previous.incidents.some(old => old.id === item.id && old.status === 'verifying'));
            commitIncidents(next);
            if (completed) notify('Vérification terminée : ' + ({resolved:'critère de résolution confirmé',improved:'amélioration mesurée',unchanged:'aucune résolution constatée',unverifiable:'résultat non vérifiable'}[completed.status] || completed.status) + '. Consultez les preuves dans Incidents.');
        }
        const household = useRef(null);
        const [houseRole, setHouseRole] = useState('owner');
        if (!household.current) {
            household.current = FGHouse.createSession();
            const savedUsual = readStorage('house-usual', undefined);
            if (savedUsual === null || (Number.isInteger(savedUsual) && savedUsual >= 0 && savedUsual <= 11)) household.current.connectionBaseline = {usual:savedUsual, samples:0, origin:savedUsual === null ? 'Apprentissage en attente' : 'Référence locale restaurée (simulation)'};
        }
        useEffect(() => { saveStorage('house-usual', household.current.connectionBaseline.usual); }, [household.current.connectionBaseline.usual]);
        const [, setHouseVersion] = useState(0);
        function homeAction(action) { household.current = FGHouse.command(household.current, action, houseRole); selectSource('household'); if (['scenario', 'prepareHeavy', 'join', 'reboot'].includes(action.type)) setPaused(false); setHouseVersion(v => v + 1); }
        const sim = useRef(null), baseline = useRef(null), fleet = useRef(null), collector = useRef(null), elapsed = useRef(0), started = useRef(null), detected = useRef(null), reboots = useRef(readStorage('reboots', [])), rebootUntil = useRef(0), modeRef = useRef('nominal'), runSamples = useRef(0), runMode = useRef('nominal');
        if (!sim.current) {
            sim.current = new FG.LineSim();
            for (let i = 0; i < 9; i++)
                sim.current.step('nominal');
            baseline.current = FG.Baseline.seed();
            fleet.current = new FG.Fleet();
            collector.current = new FG.Collector();
        }
        const [snap, setSnap] = useState(() => ({ w: sim.current.window(), d: FG.detect(sim.current.window(), { baseline: baseline.current }), history: sim.current.win.slice(), samples: 0, elapsed: 0, delay: null }));
        const latest = useRef(snap);
        latest.current = snap;
        function log(text) { setLogs(a => [{ time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text }, ...a].slice(0, 60)); }
        function notify(text) { setToast(text); }
        function navigate(p) { if (!canView(p, role)) {
            notify('Cet écran est réservé aux rôles Conseiller et Superviseur dans la démonstration.');
            return;
        } if (p === 'household') selectSource('household'); setPage(p); window.scrollTo({ top: 0, behavior: 'instant' }); }
        function scenario(m) {
            const current = FGUI.lineTestState({source:sourceRef.current, mode:m, cls:latest.current.d.cls, samples:runSamples.current, started:started.current !== null});
            if (runMode.current === m && modeRef.current === (m === 'sms' ? 'rupture' : m) && current.pending) {
                setPaused(false); notify('Test déjà lancé : les relevés continuent, sans remettre l’analyse à zéro.'); return;
            }
            selectSource('line'); runSamples.current = 0; runMode.current = m; modeRef.current = m === 'sms' ? 'rupture' : m; setMode(m); sim.current = new FG.LineSim(); for (let i = 0; i < 9; i++)
            sim.current.step('nominal'); started.current = performance.now(); detected.current = null; rebootUntil.current = 0; setPhoto(null); setPaused(false); setPhoneTab(m === 'sms' ? 'sms' : 'home'); setSnap(s => ({ ...s, w: sim.current.window(), d: FG.detect(sim.current.window(), { baseline: baseline.current }), delay: null, samples: 0, elapsed: 0, history: sim.current.win.slice() })); log('Scénario lancé : ' + MODES.find(x => x[0] === m)?.[1] + '. Aucun équipement réel n’est modifié.'); if (m !== 'nominal') notify('Test lancé : observation des nouveaux relevés. Aucun équipement réel n’est modifié.'); }
        useEffect(() => { if (paused)
            return; const id = setInterval(() => { household.current = FGHouse.tick(household.current); elapsed.current++; if (rebootUntil.current && Date.now() > rebootUntil.current) {
            rebootUntil.current = 0;
            modeRef.current = 'nominal';
            setMode('nominal');
            log('Fin du redémarrage simulé.');
        } const sample = sim.current.step(rebootUntil.current ? 'reboot' : modeRef.current); if (started.current !== null) runSamples.current++; const w = sim.current.window(), d = FG.detect(w, { baseline: baseline.current, hour: new Date().getHours() }); if (started.current && detected.current === null && d.cls !== 'sain' && d.cls !== 'anomalie')
            detected.current = Math.round((performance.now() - started.current) / 100) / 10; collector.current.tick(elapsed.current, sample, w.link > 0.5, d.cls !== 'sain'); fleet.current.step(); if (elapsed.current % 30 === 0)
            fleet.current.markTrend();
            const frame = sourceRef.current === 'household'
                ? FGIncidents.normalizeHouse(household.current)
                : FGIncidents.normalizeLine({w, d, at:Date.now(), seq:elapsed.current});
            publishFrame(frame);
            setSnap(s => ({ w, d, history: s.history.concat(sample).slice(-60), samples: runSamples.current, delay: detected.current, elapsed: started.current ? Math.floor((performance.now() - started.current) / 1000) : 0 })); }, 1000); return () => clearInterval(id); }, [paused]);
        useEffect(() => { if (!toast)
            return; const t = setTimeout(() => setToast(''), 6000); return () => clearTimeout(t); }, [toast]);
        useEffect(() => { if (!canView(page, role))
            setPage('home'); }, [role, page]);
        useEffect(() => { saveStorage('3d', threeD); }, [threeD]);
        useEffect(() => { if (presentation < 0)
            return; function key(e) { if (e.key === 'ArrowRight') {
            e.preventDefault();
            setPresentation(v => Math.min(4, v + 1));
        } if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setPresentation(v => Math.max(0, v - 1));
        } if (e.key === 'Escape') {
            setPresentation(-1);
            if (document.fullscreenElement)
                document.exitFullscreen().catch(() => { });
        } } document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [presentation]);
        const testState = FGUI.lineTestState({source, mode, cls:snap.d.cls, samples:snap.samples, started:started.current !== null});
        const waitingVerdict = testState.pending && snap.d.cls === 'sain';
        const d = snap.d, w = snap.w, st = FG.CLS[d.cls]?.st || 'warn', pack = FG.LANGS[lang] || FG.LANGS.fr, verdict = pack.verdict[d.cls];
        function perform(action) {
            if (action === 'map') {
                navigate('wifi');
                return;
            }
            if (action === 'channel') {
                setPaused(false);
                modeRef.current = 'wifiFixed';
                setMode('wifiFixed');
                log('Canal Wi-Fi optimisé dans le simulateur. Attente de nouvelles mesures.');
                notify('Canal simulé modifié. Regardez la vitesse sur le téléphone remonter.');
                return;
            }
            if (action === 'track') {
                setModal({ type: 'tracking' });
                return;
            }
            if (action === 'reboot') {
                const g = rebootGate(Array.isArray(reboots.current) ? reboots.current : [], Date.now(), linked);
                if (!g.ok) {
                    notify(g.message);
                    return;
                }
                setModal({ type: 'confirm', action });
                return;
            }
            setModal({ type: action === 'ticket' ? 'ticket' : action === 'secure' ? 'secure' : 'schedule' });
        }
        function confirmReboot() { const g = rebootGate(reboots.current, Date.now(), linked); if (!g.ok) {
            notify(g.message);
            setModal(null);
            return;
        } reboots.current = g.recent.concat(Date.now()); saveStorage('reboots', reboots.current); rebootUntil.current = Date.now() + 6000; setPaused(false); log('Redémarrage confirmé par l’utilisateur (simulation).'); setSms(a => a.concat({ who: 'system', text: 'Redémarrage simulé confirmé. La vraie box reste inchangée.' })); setModal(null); notify('La box virtuelle redémarre pendant 6 secondes.'); }
        async function ask(q) { if (!q.trim() || asking)
            return; const text = q.trim().slice(0, 500), at = latest.current; setMessages(a => a.concat({ who: 'user', text }).slice(-40)); setQuestion(''); setAsking(true); try {
            const frame = commonRef.current;
            const r = sourceRef.current === 'household'
                ? {text:frame?.available ? frame.diagnosis.title + '. ' + frame.diagnosis.explanation + ' ' + frame.diagnosis.actionLabel + '. Retrouvez les preuves dans Incidents. ' + (paused ? 'Attention : les mesures sont en pause.' : '') : 'Les mesures du foyer ne sont pas encore disponibles. Reprenez les relevés avant de conclure.',src:'Source commune · foyer simulé · réponse locale en français'}
                : await FG.ask({ question: text, cls: at.d.cls, conf: at.d.conf, lang, w: at.w, endpoint: null });
            setMessages(a => a.concat({ who: 'assistant', ...r }).slice(-40));
        }
        catch (_) {
            notify('La réponse n’a pas pu être préparée. Réessayez.');
        }
        finally {
            setAsking(false);
        } }
        function smsSend() { const cmd = smsInput.trim().toUpperCase(); if (!cmd)
            return; setSms(a => a.concat({ who: 'user', text: cmd }).slice(-40)); setSmsInput(''); let text; if (!linked)
            text = 'Commande refusée : numéro non lié à cette ligne de démonstration.';
        else if (cmd === 'STATUT')
            text = FG.LANGS.fr.verdict[d.cls] + ' Diagnostic local simulé.';
        else if (cmd === 'AIDE' || cmd === '*101*9#')
            text = 'Menu simulé : STATUT pour le diagnostic ; REBOOT pour demander un redémarrage ; AIDE pour ce menu. Aucun vrai SMS envoyé.';
        else if (cmd === 'REBOOT') {
            const g = rebootGate(reboots.current, Date.now(), linked);
            text = g.ok ? 'Confirmez le redémarrage dans la fenêtre ouverte.' : g.message;
            if (g.ok)
                setModal({ type: 'confirm', action: 'reboot' });
        }
        else
            text = 'Commande inconnue. Essayez STATUT, REBOOT ou AIDE.'; setSms(a => a.concat({ who: 'system', text }).slice(-40)); }
        async function readPhoto(file, example = false) { if (photoBusy)
            return; if (file && (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024)) {
            notify('Choisissez une image de moins de 8 Mo.');
            return;
        } setPhotoBusy(true); setPhoto(null); const epoch = sessionEpoch.current; const telemetry = { opt: w.opt }; try {
            let frame;
            if (example)
                frame = FG.vision.samplePhoto(d.cls);
            else
                frame = (await FG.vision.fileToImage(file)).img;
            const result = FG.vision.analyze([frame], telemetry);
            if (epoch !== sessionEpoch.current)
                return;
            setPhoto({ ...result, example });
            frame = null;
            log('Voyants analysés localement. Image non conservée.');
        }
        catch (_) {
            if (epoch !== sessionEpoch.current)
                return;
            setPhoto({ ok: false, reason: 'Image illisible. Reprenez une photo nette de la face avant de la box.' });
        }
        finally {
            setPhotoBusy(false);
        } }
        function exportReport() { const data = { application: 'Fibre Guardian', version: 'interface-codex-3', sourceCommune:commonRef.current, incidents:incidentRef.current.incidents, foyer: household.current, simulation: true, date: new Date().toISOString(), sourceDiagnostic:sourceRef.current, diagnostic: sourceRef.current === 'household' ? commonRef.current?.diagnosis || null : snap.d, mesures: sourceRef.current === 'household' ? commonRef.current?.metrics || null : snap.w, historique: sourceRef.current === 'household' ? [] : snap.history, noteHistorique: sourceRef.current === 'household' ? 'Volumes horaires dans foyer.hours ; preuves par incident. Aucune mesure de ligne ajoutée au foyer.' : 'Historique de la ligne simulée uniquement.', journal: logs, tickets, limites: ['Télémétrie simulée', 'Pas de passerelle Moov', 'Confiance heuristique, non probabiliste'] }; const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'fibre-guardian-rapport.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Rapport de cette session exporté. Aucune photo ni conversation incluse.'); }
        function resetData() { sessionEpoch.current++; commitIncidents(FGIncidents.create()); sourceRef.current = 'line'; setSource('line'); commonRef.current = null; setCommonFrame(null); household.current = FGHouse.createSession({seed:false}); fleet.current = new FG.Fleet(); elapsed.current = 0; rebootUntil.current = 0; setStory(null); setQuestion(''); setSmsInput('STATUT'); setMessages([]); setSms([]); setLogs([]); setTickets([]); setPhoto(null); sim.current = new FG.LineSim(); for (let i = 0; i < 9; i++)
            sim.current.step('nominal'); collector.current = new FG.Collector(); collector.current.setFine(false); setFine(false); setPaused(true); setSnap({ w: sim.current.window(), d: FG.detect(sim.current.window()), history: [], samples: 0, elapsed: 0, delay: null }); setMode('nominal'); modeRef.current = 'nominal'; runMode.current = 'nominal'; runSamples.current = 0; started.current = null; detected.current = null; setModal(null); notify('Historique, échanges, lectures photo et signalements effacés. Simulation en pause. La limite de redémarrage reste conservée.'); }
        
        function downloadIncident(id) {
            try {
                const report = FGIncidents.report(incidentRef.current, id);
                const url = URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
                const link = document.createElement('a'); link.href = url; link.download = 'fibre-guardian-incident-'+id+'.json'; link.click();
                setTimeout(()=>URL.revokeObjectURL(url),1000);
                notify('Rapport de preuves simulées exporté. Aucun contenu de navigation inclus.');
            } catch (error) { notify(error.message); }
        }
        function verifyIncident(id, apply = false) {
            try {
                if (houseRole !== 'owner') throw Error('Le rôle invité ne peut pas lancer une action ou une vérification.');
                const incident = incidentRef.current.incidents.find(item => item.id === id);
                if (!incident || incident.origin !== sourceRef.current) throw Error('Revenez à la source de cet incident avant de vérifier.');
                const frame = commonRef.current;
                if (!frame?.available) throw Error('Attendez un nouveau relevé de la source choisie.');
                if (frame.origin === 'line' && Date.now() - frame.at > FGIncidents.MAX_GAP) {
                    setPaused(false);
                    throw Error('Le relevé de ligne est trop ancien. Les mesures reprennent ; attendez un nouveau relevé puis relancez la vérification.');
                }
                const next = FGIncidents.beginVerification(incidentRef.current, id, frame, apply ? incident.actionLabel : 'Vérification sans modification');
                if (apply) {
                    if (frame.diagnosis.kind !== incident.kind) throw Error('Le contexte a changé. Vérifiez sans modifier avant d’appliquer une ancienne correction.');
                    if (incident.action === 'limit-console' && sourceRef.current === 'household')
                        household.current = FGHouse.command(household.current,{type:'limit',id:'console',mbps:10},houseRole);
                    else if (incident.action === 'restore-network' && sourceRef.current === 'household')
                        household.current = FGHouse.command(household.current,{type:'scenario',mode:'normal'},houseRole);
                    else if (incident.action === 'optimize-wifi' && sourceRef.current === 'line') {
                        modeRef.current = 'wifiFixed'; setMode('wifiFixed');
                    } else throw Error('Aucune correction automatique disponible pour cet incident.');
                }
                commitIncidents(next); setPaused(false); setModal(null);
                notify('Vérification lancée : cinq nouveaux relevés seront comparés. Aucun résultat n’est présumé.');
            } catch (error) { notify(error.message); }
        }
        function requestIncidentAction(id) {
            const incident = incidentRef.current.incidents.find(item=>item.id===id);
            if (houseRole !== 'owner' || !incident || incident.archived || incident.origin !== sourceRef.current) return notify('Action indisponible pour ce rôle, cette source ou cet historique.');
            setModal({type:'incident-action',id,actionLabel:incident.actionLabel});
        }
        function householdDiagnosis() {
            return h(FGSharedTelemetry.Summary,{frame:commonFrame,paused,onIncidents:()=>navigate('incidents'),onHousehold:()=>navigate('household')});
        }

        function startStory(id) {
            if (id === 'quartier' && !canView('supervision', role)) {
                notify('Choisissez explicitement le rôle Conseiller ou Superviseur dans les réglages pour cette histoire.');
                return;
            }
            setStory({ id, step: 0 }); if (id === 'quartier') {
            setPage('supervision');
            fleet.current.cutSegment('YOP-07', 'amont', 12);
            setPaused(false);
            log('Coupure simulée du segment de Yopougon.');
        }
        else {
            setPage('diagnostic');
            scenario(id === 'awa' ? 'wifi' : id === 'kouassi' ? 'attenuation' : 'rupture');
            if (id === 'mariam')
                setLang('nouchi');
        } }
        function startTour() { setTourOffer(false); setTour(0); setPage('home'); saveStorage('tour', true); }
        function advanceTour() { const n = tour + 1; if (n > 4) {
            setTour(-1);
            return;
        } setTour(n); setPage(['home', 'diagnostic', 'wifi', 'assistant', 'data'][n]); if (n === 1)
            scenario('wifi'); }
        function closePresentation() { setPresentation(-1); if (document.fullscreenElement)
            document.exitFullscreen().catch(() => { }); }
        function openPresentation() { setPresentation(0); document.documentElement.requestFullscreen?.().catch(() => { }); }
        const shared = { embedded: true, Icon, navigate, startScenario: m => { scenario(m); navigate('diagnostic'); }, onStory: startStory, threeD };
        function Phone({ standalone = false }) {
            return h('section', { className: 'phone ' + (standalone ? 'standalone' : ''), 'aria-label': 'Aperçu de l’abonné' }, h('div', { className: 'phone-status' }, h('b', null, '9:41'), h('span', null, 'DÉMO', h(Icon, { name: 'wifi', size: 14 }))), h('div', { className: 'phone-brand' }, h('span', { className: 'mini-logo' }, h(Icon, { name: 'spark', size: 16 })), 'Mon Guardian', h('span', { className: 'mini-tag' }, mode === 'sms' ? 'SMS simulé' : 'Ma ligne')), h('div', { className: 'phone-content' }, phoneTab === 'home' ? h(React.Fragment, null, h('div', { className: 'subscriber' }, h(Avatar, { size: 38 }), h('div', null, h('strong', null, 'Bonjour Awa'), h('small', null, 'Yopougon · Fibre 100'))), h('div', { className: 'phone-verdict ' + (waitingVerdict ? 'warn' : st) }, h(Icon, { name: waitingVerdict ? 'clock' : st === 'ok' ? 'check' : 'pulse', size: 28 }), h('h3', null, waitingVerdict ? 'Analyse des nouveaux relevés…' : verdict), pack.translateTo && h('p', null, waitingVerdict ? 'Analyse des nouveaux relevés…' : FG.LANGS.fr.verdict[d.cls])), h('div', { className: 'phone-speed' }, h('strong', null, fmt(w.loc)), h('span', null, 'Mbps sur votre téléphone')), h(Button, { primary: true, disabled: waitingVerdict, title: waitingVerdict ? 'Attendez la classification du moteur avant de choisir une action.' : undefined, icon: NEXT[d.cls][0] === 'channel' ? 'wifi' : 'arrow', onClick: () => perform(NEXT[d.cls][0]) }, waitingVerdict ? 'Diagnostic en cours…' : NEXT[d.cls][1]), h('p', { className: 'small muted' }, 'Toutes les actions de cet aperçu sont simulées.'), h(Button, { className: 'text-btn', onClick: () => setPhoneTab('sms') }, 'Essayer le mode SMS', h(Icon, { name: 'arrow', size: 15 }))) : phoneTab === 'assistant' ? chatView(true) : phoneTab === 'photo' ? photoView() : phoneTab === 'data' ? h('div', null, h(Icon, { name: 'shield', size: 32 }), h('h3', null, 'Uniquement la qualité de la ligne.'), h('p', null, 'Pas de sites visités, pas de contenu, pas d’historique de navigation.'), h(Button, { onClick: () => navigate('data') }, 'Voir mes données')) : smsView()), h('nav', { className: 'phone-nav', 'aria-label': 'Navigation de l’aperçu abonné' }, [['home', 'home', 'Accueil'], ['assistant', 'chat', 'Assistant'], ['photo', 'camera', 'Voyants'], ['data', 'shield', 'Données']].map(([id, icon, label]) => h('button', { key: id, type: 'button', className: phoneTab === id ? 'active' : '', onClick: () => setPhoneTab(id), 'aria-label': label, 'aria-current': phoneTab === id ? 'page' : undefined }, h(Icon, { name: icon, size: 18 }), h('span', null, label)))));
        }
        function chatView(compact = false) { return h('div', { className: 'chat-view ' + (compact ? 'compact' : '') }, h('div', { className: 'assistant-hello' }, h('span', { className: 'mascot' }, h(Icon, { name: 'chat', size: 27 })), h('div', null, h('strong', null, 'Guardian, à votre écoute.'), h('p', null, 'Je vous explique votre connexion.'))), h('div', { className: 'language-row' }, FG.langList().map(p => h('button', { key: p.id, onClick: () => setLang(p.id), className: lang === p.id ? 'active' : '', 'aria-pressed': lang === p.id }, p.label))), h('div', { className: 'chat-messages', 'aria-live': 'polite' }, messages.length ? messages.map((m, i) => h('div', { key: i, className: 'bubble ' + m.who }, h('p', null, m.text), m.tr && h('p', { className: 'translation' }, 'En français : ' + m.tr), m.src && h('small', null, m.src))) : h('div', { className: 'bubble assistant' }, h('p', null, source === 'household' ? commonFrame?.diagnosis?.explanation || 'Premier relevé du foyer en attente.' : verdict), h('small', null, 'Mesures simulées · réponse locale')), asking && h('p', null, 'Préparation de la réponse…')), h('div', { className: 'quick-questions' }, pack.quick.map(q => h('button', { key: q, onClick: () => ask(q), disabled: asking }, q, h(Icon, { name: 'arrow', size: 14 })))), h('form', { className: 'chat-form', onSubmit: e => { e.preventDefault(); ask(question); } }, h('input', { value: question, onChange: e => setQuestion(e.target.value), placeholder: pack.placeholder, maxLength: 500, 'aria-label': 'Votre question' }), h(Button, { type: 'submit', icon: 'send', primary: true, disabled: asking || !question.trim(), 'aria-label': 'Envoyer la question' })), h('p', { className: 'small muted' }, 'Réponses locales à base de règles, pas un modèle génératif. Nouchi et dioula à valider avec des locuteurs. Les mentions d’équipes prévenues font partie du scénario : aucun envoi réel.')); }
        function photoView() { return h('div', { className: 'photo-view' }, h('div', { className: 'photo-target' }, h(Icon, { name: 'camera', size: 36 }), h('h3', null, 'Montrez-nous les voyants.'), h('p', null, 'Une photo nette, de face. Traitement local uniquement.')), h('label', { className: 'btn primary upload-btn' }, h(Icon, { name: 'camera', size: 17 }), photoBusy ? 'Lecture…' : 'Choisir une photo', h('input', { type: 'file', accept: 'image/*', capture: 'environment', disabled: photoBusy, onChange: async (e) => { const file = e.target.files[0]; e.target.value = ''; if (file)
                await readPhoto(file); } })), h(Button, { onClick: () => readPhoto(null, true), disabled: photoBusy }, 'Utiliser une image d’exemple'), photo && h('div', { className: 'notice ' + (photo.ok ? '' : 'warning'), role: 'status' }, h('strong', null, photo.example ? 'Exemple généré — analyse locale' : 'Photo traitée — non conservée'), h('p', null, photo.ok ? photo.reading : photo.reason), photo.ok && h('p', null, photo.cause), photo.ok && h('small', null, photo.concord ? 'Les couleurs observées et le signal sont compatibles.' : 'Les deux sources divergent : à vérifier.')), h('p', { className: 'small muted' }, 'La photo est comparée aux mesures SIMULÉES, pas à votre vraie ligne. Lecture heuristique des couleurs : ne reconnaît pas tous les modèles de box et ne prouve pas un clignotement sur une seule photo.')); }
        function smsView() { return h('div', { className: 'sms-view' }, h('h3', null, 'Même sans Internet.'), h('p', { className: 'small' }, 'Canal SMS simulé · menu *101*9# · aucun message envoyé'), h('label', { className: 'field' }, 'Expéditeur de test', h('select', { value: linked ? 'linked' : 'other', onChange: e => setLinked(e.target.value === 'linked') }, h('option', { value: 'linked' }, 'Numéro lié à la ligne'), h('option', { value: 'other' }, 'Autre numéro — refus attendu'))), h('div', { className: 'sms-messages', 'aria-live': 'polite' }, sms.length ? sms.map((m, i) => h('div', { className: 'bubble ' + m.who, key: i }, m.text)) : h('div', { className: 'bubble system' }, 'Bienvenue. Envoyez STATUT pour consulter votre diagnostic.')), h('div', { className: 'quick-questions' }, ['STATUT', 'REBOOT', 'AIDE'].map(cmd => h('button', { key: cmd, onClick: () => setSmsInput(cmd) }, cmd))), h('form', { className: 'chat-form', onSubmit: e => { e.preventDefault(); smsSend(); } }, h('input', { value: smsInput, onChange: e => setSmsInput(e.target.value), 'aria-label': 'Commande SMS', maxLength: 30 }), h(Button, { type: 'submit', icon: 'send', primary: true, 'aria-label': 'Envoyer la commande de test' })), h('p', { className: 'small muted' }, '2 redémarrages maximum en 10 minutes, après confirmation. Ce contrôle local n’est pas une authentification de production.')); }
        function metricCard({ icon, title, value, unit, caption, lime = false, children }) { return h('section', { className: 'metric-card ' + (lime ? 'accent-card' : '') }, h(PanelTitle, { icon }, title), h('div', { className: 'metric-value' }, value, h('span', null, unit)), children || h(Capsules, { value: Number(value), lime: false }), h('p', { className: 'small muted' }, caption)); }
        function home() { if (source === 'household') return householdDiagnosis(); return h(React.Fragment, null, h('div', { className: 'home-top' }, metricCard({ icon: 'shield', title: 'État de votre ligne', value: st === 'ok' ? 'Tout va bien' : LABELS[d.cls], unit: '', caption: 'Diagnostic expliqué, sans jargon.', children: h(Badge, { state: st }, st === 'ok' ? 'Aucune panne détectée' : 'Voir le diagnostic'), lime: false }), metricCard({ icon: 'pulse', title: 'Vitesse à la box', value: fmt(w.dl), unit: '/ 100 Mbps', caption: 'Offre de démonstration · débit simulé', lime: true }), h('section', { className: 'dark-card' }, h('span', { className: 'eyebrow' }, 'LE DÉCLIC, EN 2 MINUTES'), h('h2', null, 'Pas besoin d’être expert.'), h('p', null, 'Une panne. Une explication. Le bon geste.'), h('div', { className: 'dark-card-bottom' }, h('div', { className: 'avatar-stack' }, [0, 1, 2].map(i => h(Avatar, { key: i, index: i, size: 42 }))), h(Button, { onClick: startTour, icon: 'arrow' }, 'Me guider')))), h('div', { className: 'home-grid' }, h('section', { className: 'panel connection-panel' }, h(PanelTitle, { icon: 'router', aside: h(Badge, { state: st }, 'Ligne de démonstration') }, 'Votre connexion, simplement'), h('div', { className: 'router-composition' }, h('div', { className: 'router-copy' }, h('span', { className: 'eyebrow' }, 'DE LA FIBRE À VOTRE TÉLÉPHONE'), h('h2', null, st === 'ok' ? 'Une bonne connexion commence ici.' : LABELS[d.cls]), h('p', null, st === 'ok' ? 'La box reçoit Internet par la fibre, puis le partage en Wi-Fi dans votre maison.' : FG.LANGS.fr.verdict[d.cls]), h(Button, { icon: 'arrow', onClick: () => navigate('diagnostic') }, 'Comprendre ma ligne')), h('div', { className: 'router-stage' }, h(FGScene, { kind: 'router', cls: d.cls, enabled: threeD }))), h('div', { className: 'connection-footer' }, h('span', null, h(Icon, { name: 'shield', size: 16 }), 'Aucun contenu personnel collecté'), h('span', null, h(Icon, { name: 'globe', size: 16 }), 'Fonctionne sans Internet')), h(LedGuide, {cls:d.cls})), h('aside', { className: 'guide-stack' }, h('section', { className: 'panel guide-card' }, h(PanelTitle, { icon: 'bulb' }, 'Comment ça marche ?'), [['01', 'On observe', 'Les mesures de la ligne, pas vos contenus.'], ['02', 'On comprend', 'La fibre, la box ou le Wi-Fi : on localise.'], ['03', 'Vous agissez', 'Un conseil adapté, à votre rythme.']].map(([n, a, b]) => h('div', { key: n, className: 'guide-step' }, h('span', null, n), h('div', null, h('strong', null, a), h('p', null, b)))), h('button', { className: 'story-link', onClick: () => startStory('awa') }, h(Avatar, { size: 43 }), h('span', null, h('strong', null, 'L’histoire d’Awa'), h('small', null, 'Et si le problème était le Wi-Fi ?')), h(Icon, { name: 'arrow' }))))), h('section', { className: 'panel history-panel' }, h(PanelTitle, { icon: 'chart', aside: h('span', null, snap.history.length, ' secondes observées') }, 'La connexion au fil des secondes'), h(Chart, { history: snap.history }))); }
        function lineTestProgress() {
            if (!testState.active) return null;
            const label = MODES.find(([id]) => id === mode)?.[1] || mode;
            const status = testState.matched ? 'Diagnostic observé : ' + LABELS[d.cls]
                : paused ? 'Test en pause — aucun nouveau relevé'
                : testState.exhausted ? 'Le diagnostic attendu n’est pas encore observé'
                : mode === 'wifi' ? 'Test Wi-Fi lancé — analyse en cours' : 'Test lancé — analyse en cours';
            return h('section', {className:'panel line-test-progress', 'aria-label':'Progression du test de ligne', 'data-state':testState.matched ? 'detected' : paused ? 'paused' : testState.exhausted ? 'inconclusive' : 'observing', 'data-samples':testState.samples},
                h('div', {className:'line-test-copy'},
                    h('span', {className:'eyebrow'}, 'TEST SIMULÉ · ' + label),
                    h('h2', {role:'status', 'aria-live':'polite'}, status),
                    h('p', null, testState.matched ? 'Le moteur a reconnu le problème à partir des mesures. Essayez maintenant l’action proposée dans l’aperçu abonné.'
                        : paused ? 'Reprenez les mesures pour continuer le même test, sans perdre les relevés déjà observés.'
                        : testState.exhausted ? 'Les mesures restent disponibles : vous pouvez relancer le test ou choisir une autre panne. Aucun résultat n’est forcé.'
                        : mode === 'attenuation' ? 'La baisse progressive demande généralement 24 à 32 relevés. Le verdict initial n’est pas le résultat final de ce test.'
                        : 'Le moteur attend plusieurs relevés concordants. ' + (mode === 'wifi' ? 'Le test Wi-Fi prend généralement 7 à 10 relevés' : 'Ce scénario prend généralement 6 à 10 relevés') + ', à raison d’un par seconde.'),
                    h('strong', {className:'line-test-count'}, testState.samples + ' nouveaux relevés observés'),
                    h('small', null, 'Les relevés de départ et le temps en pause ne sont pas comptés. Aucun routeur réel n’est modifié.')),
                h('div', {className:'line-test-actions'},
                    testState.pending && h(Button, {onClick:()=>setPaused(!paused), icon:paused ? 'play' : 'pause'}, paused ? 'Reprendre ce test' : 'Mettre ce test en pause'),
                    (testState.matched || testState.exhausted) && h(Button, {onClick:()=>scenario(mode), icon:'refresh'}, 'Relancer ce test'),
                    testState.matched && h(Button, {onClick:()=>navigate('incidents'), icon:'bell'}, 'Voir les incidents de ce test'),
                    h(Button, {onClick:()=>scenario('nominal'), icon:'x'}, 'Arrêter ce test')));
        }
        function diagnostic() { if (source === 'household') return h(React.Fragment,null,householdDiagnosis(),h('div',{className:'toolbar'},h(Button,{onClick:()=>{selectSource('line');scenario('nominal');}},'Explorer les pannes de ligne simulées'))); return h(React.Fragment, null, lineTestProgress(), h('section', { className: 'scenario-strip', 'aria-label': 'Pannes de démonstration' }, h('span', { className: 'eyebrow' }, 'ESSAYEZ SANS RISQUE'), h('div', { className: 'scenario-pills' }, MODES.map(([id, label]) => h('button', { key: id, disabled: testState.pending && !paused && mode === id, title: testState.pending && mode === id ? 'Observation en cours : ce scénario ne sera pas remis à zéro.' : undefined, onClick: () => scenario(id), className: mode === id ? 'active' : '', 'aria-pressed': mode === id }, id === 'nominal' && h('i', { className: 'status-dot' }), label))), h('div', { className: 'scenario-note' }, h(Icon, { name: 'bulb', size: 16 }), mode === 'attenuation' ? 'Une baisse progressive se détecte plus lentement : environ 24 à 32 secondes dans les tests du simulateur.' : 'Le moteur reçoit seulement les mesures. Le choix de la panne ne lui est jamais transmis.')), h('div', { className: 'diagnostic-grid' }, Phone({}), h('div', { className: 'diagnosis-main' }, h('section', { className: 'panel path-panel' }, h(PanelTitle, { icon: 'network', aside: h('span', null, 'Du réseau à chez vous') }, 'Où se situe le problème ?'), h(FGScene, { kind: 'path', cls: d.cls, enabled: threeD }), h('div', { className: 'path-verdict ' + (waitingVerdict ? 'warn' : st) }, h(Icon, { name: st === 'ok' ? 'check' : 'pulse' }), h('span', null, waitingVerdict ? 'Test lancé : le verdict se construit sur les nouveaux relevés.' : FG.LANGS.fr.verdict[d.cls]))), h('section', { className: 'panel operator-panel' }, h(PanelTitle, { icon: 'pulse', aside: h('span', { className: 'small' }, 'Lecture opérateur') }, 'Pourquoi ce diagnostic ?'), h('div', { className: 'diagnostic-summary' }, h('div', null, h(Badge, { state: waitingVerdict ? 'warn' : st }, waitingVerdict ? 'Observation en cours' : LABELS[d.cls]), h('p', { className: 'confidence' }, waitingVerdict ? '—' : fmt(d.conf * 100), h('span', null, waitingVerdict ? 'Nouveaux relevés attendus' : '% de concordance des signaux')), h(Capsules, { value: waitingVerdict ? 0 : d.conf * 100 }), h('small', { className: 'muted' }, 'Indice heuristique, pas une probabilité calibrée.')), h('div', { className: 'detection-time' }, h(Icon, { name: 'clock', size: 24 }), h('strong', null, snap.delay !== null ? fmt(snap.delay, 1) + ' s' : mode === 'nominal' ? 'En veille' : fmt(snap.elapsed) + ' s'), h('small', null, snap.delay !== null ? 'Premier signal classé' : 'Observation en cours'))), h('ul', { className: 'evidence' }, d.ev.slice(0, 3).map(([ok, text], i) => h('li', { key: i }, h(Icon, { name: ok ? 'check' : 'clock', size: 15 }), h('span', null, text))))), h('section', { className: 'panel' }, h(PanelTitle, { icon: 'chart' }, 'Box et téléphone : la différence'), h(Chart, { history: snap.history })))), h('details', { className: 'panel detailed-measures' }, h('summary', null, 'Voir les 9 mesures détaillées', h(Icon, { name: 'plus', size: 18 })), h('div', { className: 'measure-grid' }, [['dl', 'Débit à la box', 'Mbps'], ['ul', 'Envoi de données', 'Mbps'], ['lat', 'Temps de réponse', 'ms'], ['jit', 'Variation du délai', 'ms'], ['loss', 'Données perdues', '%'], ['opt', 'Signal de la fibre', 'dBm'], ['snr', 'Signal / bruit', 'dB'], ['wifi', 'Signal Wi-Fi', 'dBm'], ['dev', 'Appareils', '']].map(([key, label, unit]) => h('div', { key }, h('span', null, label), h('strong', null, fmt(w[key], key === 'dev' ? 0 : 1), ' ', h('small', null, unit)))))), h('div', { className: 'toolbar' }, h(Button, { icon: paused ? 'play' : 'pause', onClick: () => setPaused(!paused) }, paused ? 'Reprendre les mesures' : 'Mettre en pause'), h(Button, { icon: 'download', onClick: exportReport }, 'Exporter ce test'), h('span', { className: 'small muted' }, 'Aucune action sur le réseau réel.'))); }
        function supervision() { const stats = fleet.current.segmentStats('YOP-07'); return h(React.Fragment, null, h('div', { className: 'supervision-stats' }, [['Abonnés touchés', stats.degraded, '/ ' + stats.n, 'users'], ['Prévenus (simulation)', stats.notified, 'abonnés', 'bell'], ['Appels simulés', stats.calls, 'appel(s)', 'phone']].map(([title, value, unit, icon], i) => h('section', { key: title, className: 'metric-card ' + (i === 0 ? 'accent-card' : '') }, h(PanelTitle, { icon }, title), h('div', { className: 'metric-value' }, value, h('span', null, unit))))), h('div', { className: 'supervision-grid' }, h('section', { className: 'panel city-panel' }, h(PanelTitle, { icon: 'network', aside: '48 abonnés fictifs · 4 segments' }, 'Le réseau, quartier par quartier'), h(FGScene, { kind: 'city', enabled: threeD, affected: stats.degraded, cls: stats.degraded ? 'amont' : 'sain' }), h('div', { className: 'segment-list' }, FG.SEGMENTS.map(seg => { const s = fleet.current.segmentStats(seg.id); return h('div', { key: seg.id }, h('span', null, seg.commune), h(Badge, { state: s.degraded ? 'ko' : 'ok' }, s.degraded ? s.degraded + ' affectés' : 'Normal')); })), h('p', { className: 'small muted' }, 'Vue schématique, pas une carte géographique exacte. La propagation est accélérée pour la démonstration.')), h('section', { className: 'panel' }, h(PanelTitle, { icon: 'bell' }, 'De la détection à l’information'), h('div', { className: 'incident-state' }, h(Badge, { state: stats.incident ? 'warn' : 'ok' }, stats.incident ? 'Incident regroupé' : 'Surveillance active'), h('h3', null, stats.incident ? 'Une cause commune. Une alerte.' : 'Des lignes individuelles à une vue collective.'), h('p', null, stats.incident ? (stats.incident.beforeFirstCall ? 'Dans ce scénario, l’alerte a précédé le premier appel.' : 'L’alerte a suivi des appels simulés.') : 'L’alerte se déclenche à partir de 5 abonnés dégradés et 25 % du segment, sur une fenêtre de 3 minutes.')), h('ol', { className: 'event-timeline' }, h('li', null, 'Les lignes transmettent leurs mesures simulées.'), h('li', null, stats.degraded ? stats.degraded + ' lignes présentent une anomalie.' : 'Aucune anomalie groupée pour le moment.'), h('li', null, stats.incident ? 'Incident créé au pas ' + stats.incident.at + ' de la simulation.' : 'L’agrégateur attend des signaux concordants.'), h('li', null, stats.notified ? stats.notified + ' notifications simulées. Aucun SMS réel envoyé.' : 'Information des abonnés en attente.')), h(Button, { icon: 'refresh', onClick: () => { fleet.current.restore(); log('Rétablissement du segment demandé dans le simulateur.'); notify('Rétablissement simulé. Les mesures vont progressivement revenir à la normale.'); } }, 'Rétablir le réseau simulé'))), h('section', { className: 'panel' }, h(PanelTitle, { icon: 'clock' }, 'Journal de cette session'), logs.length ? h('ol', { className: 'journal' }, logs.slice(0, 10).map((e, i) => h('li', { key: i }, h('time', null, e.time), e.text))) : h('p', { className: 'muted' }, 'Lancez un incident pour suivre son déroulement.'))); }
        function retention() { const ranking = fleet.current.ranking(8); return h(React.Fragment, null, h('div', { className: 'notice' }, h(Icon, { name: 'bulb' }), h('p', null, 'Les scores sont calculés sur une flotte fictive avec des poids manuels. Ils servent à prioriser une conversation, pas à prédire un départ réel ni à sanctionner.')), h('section', { className: 'panel table-panel' }, h(PanelTitle, { icon: 'users', aside: '8 profils fictifs' }, 'Qui accompagner en priorité ?'), h('div', { className: 'table-scroll' }, h('table', null, h('thead', null, h('tr', null, ['Abonné', 'Commune', 'Priorité / 100', 'Tendance', 'Prochaine étape', ''].map((v, i) => h('th', { key: i, scope: 'col' }, v)))), h('tbody', null, ranking.map((s, i) => h('tr', { key: s.id }, h('td', null, h('div', { className: 'person' }, h(Avatar, { index: i, size: 38 }), h('span', null, h('strong', null, s.name), h('small', null, s.id)))), h('td', null, s.commune), h('td', null, h('div', { className: 'risk-score' }, h('strong', null, s.score), h('div', { className: 'risk-track' }, h('span', { style: { width: s.score + '%' } })))), h('td', null, h('span', { 'aria-label': s.trend === '↑' ? 'En hausse' : s.trend === '↓' ? 'En baisse' : 'Stable' }, s.trend)), h('td', null, s.action), h('td', null, h(Button, { onClick: () => setModal({ type: 'call', sub: s }), icon: 'phone' }, 'Préparer l’appel')))))))), h('p', { className: 'small muted' }, 'Aucun appel n’est effectué automatiquement. Les suggestions du moteur doivent être validées par le conseiller.')); }
        function dataView() { return h('div', { className: 'data-grid' }, h('section', { className: 'panel' }, h(PanelTitle, { icon: 'shield' }, 'Ce qui reste sur cet appareil'), h('h3', null, 'Votre navigation ne nous regarde pas.'), h('p', null, 'Cette interface ne transmet aucune mesure à un serveur. La box et les abonnés sont simulés en mémoire. Les préférences de visite et de 3D, les heures de redémarrage virtuel et le nombre habituel d’appareils sont conservés localement. Les dossiers d’incident et leurs preuves simulées sont également conservés localement, jusqu’à 40 dossiers. Effacer la session supprime ces dossiers et réinitialise la référence.'), h('ul', { className: 'check-list' }, ['9 mesures techniques : débit, délai, pertes, signal et nombre d’appareils.', 'Foyer fictif : volumes par appareil, pièces déclarées, historique horaire et actions. Tout reste en mémoire.', 'Aucune URL, aucun DNS, aucun contenu de navigation.', 'Photos décodées localement puis relâchées après l’analyse.', 'Le plan Wi-Fi reste uniquement sur cet appareil.'].map(t => h('li', { key: t }, h(Icon, { name: 'check', size: 17 }), t))), h('label', { className: 'toggle-row' }, h('span', null, h('strong', null, 'Collecte fine du simulateur'), h('small', null, 'Sinon : un échantillon par minute, dans le modèle.')), h('input', { type: 'checkbox', checked: fine, onChange: e => { setFine(e.target.checked); collector.current.setFine(e.target.checked); if (e.target.checked)
                collector.current.mode = 'diagnostic'; } })), h(Button, { icon: 'x', onClick: () => setModal({ type: 'erase' }) }, 'Effacer mes données de session')), h('section', { className: 'panel accent-card' }, h(PanelTitle, { icon: 'pulse' }, 'Une collecte légère, par conception'), h('div', { className: 'metric-value' }, fmt(FG.Collector.monthlyVeilleMB(), 2), h('span', null, 'Mo / mois')), h('p', null, 'Estimation du modèle de collecte en veille, hors protocoles réseau, chiffrement et retransmissions.'), h('hr'), h('p', null, 'Échantillons en tampon : ', collector.current.buffer.length), h('p', null, 'Échantillons transmis virtuellement : ', collector.current.sent), h('p', null, 'Photos conservées : 0'), h(Button, { onClick: exportReport, icon: 'download' }, 'Télécharger mon rapport'))); }
        const tourSteps = [['Bienvenue chez Guardian', 'Les chiffres viennent d’une ligne simulée. Vous pouvez tout essayer sans couper Internet.'], ['Choisissons un Wi-Fi faible', 'Nous avons lancé le scénario. Observez : le débit reste bon à la box, mais baisse sur le téléphone. Le moteur doit le déduire seul.'], ['Essayez le bon emplacement', 'Cliquez sur une pièce pour y déplacer la box. Comparez la couverture avant d’ajouter un répéteur.'], ['Posez une question', 'L’assistant lit le diagnostic actuel. Choisissez le français, le nouchi ou le dioula.'], ['Vous gardez la main', 'Consultez les données et effacez la session. Vous savez maintenant tester le produit !']];
        const title = TITLES[page] || TITLES.home;
        function primaryAction() { if (page === 'home')
            navigate('diagnostic');
        else if (page === 'diagnostic')
            scenario('wifi');
        else if (page === 'supervision') {
            fleet.current.cutSegment('YOP-07', 'amont', 12);
            setPaused(false);
            log('Coupure de quartier injectée dans le simulateur.');
            notify('Incident lancé. Observez les lignes et l’alerte pendant les prochaines secondes.');
        }
        else if (page === 'data')
            exportReport();
        else
            startTour(); }
        let content = page === 'operator' ? h(FGPilot.View, {key:'operator',space:'operator',onClient:()=>navigate('pilot')}) : page === 'pilot' ? h(FGPilot.View,{key:'client'}) : page === 'incidents' ? h(FGIncidentView, {
            state:{...incidentRef.current,latest:commonFrame}, paused, canAct:houseRole === 'owner', persistenceAvailable, compactSource:true,
            onVerify:id=>verifyIncident(id), onApply:requestIncidentAction, onExport:downloadIncident,
            onNavigate:navigate, onResume:()=>setPaused(false),
            onSource:origin=>{selectSource(origin);setPaused(false);}
        }) : page === 'household' ? h(FGHouseholdView, {state: household.current, onAction: homeAction, role: houseRole, onRoleChange: value => { if (['owner','visitor'].includes(value)) setHouseRole(value); }, threeD, paused, onTogglePause: () => setPaused(!paused)}) : page === 'home' ? home() : page === 'diagnostic' ? diagnostic() : page === 'assistant' ? h('div', { className: 'assistant-grid' }, h('section', { className: 'panel' }, chatView()), source === 'household' ? householdDiagnosis() : h('aside', { className: 'panel assistant-context' }, h(PanelTitle, { icon: 'pulse' }, 'Ce que l’assistant sait'), h(Badge, { state: st }, LABELS[d.cls]), h('div', { className: 'context-number' }, fmt(w.dl), h('small', null, 'Mbps à la box')), h('p', null, fmt(w.loc), ' Mbps sur le téléphone'), h('p', null, fmt(w.opt, 1), ' dBm de signal fibre'), h('div', { className: 'notice' }, 'Une même source de mesures pour tous les écrans.'), h(Button, { onClick: () => navigate('diagnostic'), icon: 'arrow' }, 'Ouvrir le diagnostic'))) : page === 'supervision' ? supervision() : page === 'retention' ? retention() : page === 'wifi' ? h(FGSupportViews.Wifi, shared) : page === 'economics' ? h(FGSupportViews.Economics, shared) : page === 'stories' ? h(FGSupportViews.Stories, shared) : page === 'help' ? h(FGSupportViews.Help, shared) : dataView();
        function modalContent() {
            if (!modal)
                return null;
            let name = '', body = null;
            if (modal.type === 'incident-action') {
                name = 'Appliquer cette correction simulée ?';
                body = h(React.Fragment,null,h('p',null,modal.actionLabel),h('div',{className:'notice'},'Uniquement dans le simulateur. Le résultat sera évalué sur cinq nouveaux relevés. Un accusé de commande ne prouve pas une résolution.'),h('div',{className:'modal-actions'},h(Button,{onClick:()=>setModal(null)},'Annuler'),h(Button,{primary:true,onClick:()=>verifyIncident(modal.id,true)},'Confirmer et vérifier')));
            }
            if (modal.type === 'settings') {
                name = 'À votre rythme';
                body = h('div', { className: 'settings-content' }, h('label', { className: 'field' }, 'Langue du diagnostic et de l’assistant', h('select', { value: lang, onChange: e => setLang(e.target.value) }, FG.langList().map(p => h('option', { key: p.id, value: p.id }, p.name)))), h('label', { className: 'field' }, 'Rôle de démonstration', h('select', { value: role, onChange: e => setRole(e.target.value) }, [['technicien', 'Technicien'], ['conseiller', 'Conseiller'], ['superviseur', 'Superviseur']].map(([id, t]) => h('option', { key: id, value: id }, t)))), h('p', { className: 'small muted' }, 'Le rôle masque des écrans, mais ne constitue pas une sécurité serveur : toutes les données sont fictives.'), h('label', { className: 'toggle-row' }, h('span', null, h('strong', null, 'Illustrations 3D'), h('small', null, 'Un schéma clair reste disponible sans 3D.')), h('input', { type: 'checkbox', checked: threeD, onChange: e => setThreeD(e.target.checked) })), h('p', { className: 'small muted' }, 'Les préférences de mouvement réduit de votre appareil sont respectées.'), h(Button, { primary: true, onClick: () => setModal(null), icon: 'check' }, 'C’est réglé'));
            }
            if (modal.type === 'confirm') {
                name = 'Redémarrer la box virtuelle ?';
                body = h(React.Fragment, null, h('p', null, 'La simulation sera interrompue pendant 6 secondes. Aucun équipement réel ne sera redémarré.'), h('div', { className: 'notice' }, 'Cette action demande votre confirmation. Limite : 2 redémarrages en 10 minutes.'), h('div', { className: 'modal-actions' }, h(Button, { onClick: () => setModal(null) }, 'Annuler'), h(Button, { primary: true, icon: 'refresh', onClick: confirmReboot }, 'Confirmer le redémarrage')));
            }
            if (modal.type === 'ticket') {
                name = 'Un signalement déjà expliqué';
                body = h('form', { onSubmit: e => { e.preventDefault(); const id = 'FG-' + Date.now().toString().slice(-6); setTickets(a => a.concat({ id, cls: d.cls, w: { ...w }, slot: new FormData(e.target).get('slot'), date: new Date().toISOString() })); log('Signalement local ' + id + ' préparé avec diagnostic et mesures.'); notify('Signalement ' + id + ' enregistré dans cette session. Il n’a pas été envoyé à Moov.'); setModal(null); } }, h('p', null, 'Le conseiller disposerait de votre diagnostic et des mesures. Cette demande reste locale à la démonstration.'), h(Badge, { state: st }, LABELS[d.cls]), h('label', { className: 'field' }, 'Créneau souhaité (non réservé)', h('select', { name: 'slot' }, h('option', null, 'Demain · matin'), h('option', null, 'Demain · après-midi'), h('option', null, 'Être rappelé'))), h(Button, { type: 'submit', primary: true, icon: 'check' }, 'Enregistrer le signalement local'));
            }
            if (modal.type === 'erase') {
                name = 'Effacer cette session ?';
                body = h(React.Fragment, null, h('p', null, 'Cela efface l’historique, les incidents enregistrés, les conversations, les signalements et les lectures photo. La simulation sera mise en pause. Les préférences et la limite de redémarrage restent conservées.'), h('div', { className: 'modal-actions' }, h(Button, { onClick: () => setModal(null) }, 'Annuler'), h(Button, { primary: true, onClick: resetData }, 'Effacer la session')));
            }
            if (modal.type === 'tracking') {
                name = 'Suivi du réseau — démonstration';
                body = h(React.Fragment, null, h(Badge, { state: st }, LABELS[d.cls]), h('p', null, 'Le simulateur continue à mesurer le réseau. Aucune équipe réelle n’a été alertée et aucune heure de rétablissement n’est disponible.'), h(Button, { onClick: () => { setPhoneTab('sms'); setModal(null); navigate('diagnostic'); }, primary: true }, 'Ouvrir le suivi SMS simulé'));
            }
            if (modal.type === 'secure') {
                name = 'Vérifier les appareils connectés';
                body = h(React.Fragment, null, h('p', null, fmt(w.dev), ' appareils sont visibles dans le simulateur. Ce nombre seul ne prouve ni fraude ni revente : commencez par vérifier avec les membres du foyer.'), h('ol', null, h('li', null, 'Identifier vos téléphones, télévisions et objets connectés.'), h('li', null, 'Déconnecter les appareils inconnus dans les réglages de la vraie box.'), h('li', null, 'Changer le mot de passe Wi-Fi si nécessaire.')), h(Button, { primary: true, onClick: () => { setModal(null); notify('Conseil consulté. Aucun mot de passe ni équipement réel modifié.'); } }, 'J’ai compris'));
            }
            if (modal.type === 'schedule') {
                name = 'Alléger les heures chargées';
                body = h(React.Fragment, null, h('p', null, 'Planifiez vos gros téléchargements hors des moments où toute la maison utilise Internet. Ce prototype ne peut pas programmer les téléchargements de vos appareils.'), h(Button, { primary: true, onClick: () => { setModal(null); log('Conseil hors pointe consulté.'); } }, 'J’ai compris'));
            }
            if (modal.type === 'call') {
                name = 'Préparer l’appel de ' + modal.sub.name;
                body = h(React.Fragment, null, h('p', null, modal.sub.commune, ' · ', modal.sub.id, ' · profil fictif'), h('h3', null, 'D’abord écouter, puis proposer.'), h('ol', null, h('li', null, 'Demander ce que l’abonné constate et depuis quand.'), h('li', null, 'Reprendre le diagnostic : ', LABELS[modal.sub.cls], '.'), h('li', null, 'Suggestion du moteur à valider : ', modal.sub.action, '.')), h('div', { className: 'notice' }, 'Aucun numéro réel disponible. Aucun appel ni geste commercial automatique.'), h(Button, { primary: true, onClick: () => { log('Fiche d’appel préparée pour ' + modal.sub.name + ' (fictif).'); setModal(null); notify('Préparation notée dans le journal de cette session.'); } }, 'Noter la préparation'));
            }
            return h(Modal, { title: name, onClose: () => setModal(null) }, body);
        }
        if (presentation >= 0) {
            const slides = [['L’abonné ne sait pas où chercher.', 'Moov ne sait pas encore qu’il y a un problème. Un même diagnostic peut rapprocher les deux.', 'router', 'sain'], ['Une panne visible. Une cause comprise.', 'Le moteur classe les mesures, sans connaître le scénario injecté. Sur les tests simulés : coupure détectée en 6 secondes.', 'path', 'rupture'], ['La fibre est bonne. C’est le Wi-Fi.', 'Distinguer les deux évite un déplacement inutile. Un meilleur emplacement peut suffire.', 'house', 'wifi'], ['Un quartier. Une alerte commune.', 'Des anomalies regroupées permettent de prévenir les abonnés. Ici, flotte et notifications sont simulées.', 'city', 'amont'], ['Une valeur mesurable, pas une promesse.', '255,6 M FCFA de coûts annuels évitables + 405 M de revenus préservés sur 18 mois. Hypothèses, avant coût de déploiement.', null, 'sain']];
            const s = slides[presentation];
            return h('div', { className: 'presentation' }, h('div', { className: 'presentation-top' }, h('span', null, 'FIBRE GUARDIAN / CONCOURS MOOV'), h(Button, { icon: 'x', onClick: () => { setPresentation(-1); if (document.fullscreenElement)
                    document.exitFullscreen().catch(() => { }); } }, 'Quitter')), h('main', null, h('span', { className: 'eyebrow' }, '0' + (presentation + 1) + ' / 05 · DÉMONSTRATION'), h('h1', null, s[0]), h('p', null, s[1]), s[2] ? h('div', { className: 'presentation-scene' }, h(FGScene, { kind: s[2], cls: s[3], enabled: threeD, affected: 17 })) : h('div', { className: 'presentation-total' }, '660,6', h('span', null, 'M FCFA · total à horizons mixtes'))), h('div', { className: 'presentation-bottom' }, h(Button, { onClick: () => setPresentation(v => Math.max(0, v - 1)), disabled: presentation === 0 }, 'Précédent'), h('span', null, 'Utilisez aussi les flèches ← → du clavier'), h(Button, { onClick: () => presentation === 4 ? closePresentation() : setPresentation(v => v + 1), primary: true }, presentation === 4 ? 'Terminer' : 'Suivant')));
        }
        return h(React.Fragment, null, h('div', { className: 'app-shell', 'data-tour': tour }, h('aside', { className: 'sidebar' }, h('a', { href: '#main', className: 'brand-mark', onClick: () => navigate('home'), 'aria-label': 'Fibre Guardian, accueil' }, h(Icon, { name: 'spark', size: 27 })), h('nav', { 'aria-label': 'Navigation principale' }, PAGES.filter(([id]) => canView(id, role)).map(([id, icon, label]) => h('button', { key: id, type: 'button', className: 'nav-item ' + (page === id ? 'active' : ''), onClick: () => navigate(id), 'aria-current': page === id ? 'page' : undefined, title: label }, h(Icon, { name: icon, size: 21 }), h('span', null, label)))), h('div', { className: 'sidebar-bottom' }, h('button', { className: 'nav-item ' + (page === 'help' ? 'active' : ''), onClick: () => navigate('help'), title: 'Aide' }, h(Icon, { name: 'help' }), h('span', null, 'Aide')), h('button', { className: 'nav-item', onClick: () => setModal({ type: 'settings' }), title: 'Réglages' }, h(Icon, { name: 'settings' }), h('span', null, 'Réglages')), h('button', { className: 'profile-button', onClick: () => setModal({ type: 'settings' }), 'aria-label': 'Rôle de démonstration : ' + role }, h(Avatar, { index: 3, size: 36 })))), h('div', { className: 'main-wrap' }, h('header', { className: 'topbar' }, h('div', { className: 'wordmark' }, 'fibre', h('b', null, 'guardian'), h('span', { className: 'brand-divider' }), h('span', { className: 'moov-label' }, 'POUR MOOV AFRICA CI')), h('div', { className: 'topbar-actions' }, h('span', { className: 'demo-pill' }, h('i'), 'LABORATOIRE LOCAL'), h(Button, { icon: 'book', onClick: startTour, className: 'tour-button' }, 'Visite guidée'), h(Button, { icon: 'expand', onClick: openPresentation, className: 'presentation-button' }, 'Présentation'))), h('main', { id: 'main', tabIndex: -1 }, h('label', { className: 'mobile-route' }, 'Explorer l’application', h('select', { value: page, onChange: e => navigate(e.target.value), 'aria-label': 'Choisir un écran' }, PAGES.concat([['help','help','Aide'],['data','shield','Mes données']]).filter(([id]) => canView(id,role)).map(([id,icon,label]) => h('option',{key:id,value:id},label)))), h('div', { className: 'page-heading' }, h('div', null, h('div', { className: 'eyebrow page-eyebrow' }, 'FIBRE GUARDIAN / ', PAGES.find(x => x[0] === page)?.[2] || title[0]), h('h1', null, title[0], h('span', { className: 'heading-spark' }, h(Icon, { name: page === 'home' ? 'spark' : 'pulse', size: 28 })), h('br'), title[1]), h('p', null, title[2])), ['home', 'diagnostic', 'supervision'].includes(page) && h(Button, { primary: true, icon: page === 'diagnostic' && mode === 'wifi' && testState.pending ? 'clock' : 'plus', disabled: page === 'diagnostic' && mode === 'wifi' && testState.pending && !paused, title: page === 'diagnostic' && mode === 'wifi' && testState.pending ? 'Test en cours. Suivez les relevés dans le panneau ci-dessous.' : undefined, onClick: primaryAction }, page === 'home' ? 'Essayer une panne' : page === 'supervision' ? 'Simuler une coupure à Yopougon' : mode === 'wifi' && testState.pending ? (paused ? 'Reprendre la démo Wi-Fi' : 'Démo Wi-Fi en cours…') : 'Lancer la démo Wi-Fi')), h('div', { className: 'workspace-bar' }, h('div', { className: 'workspace-pills' }, h('button', { className: page === 'home' ? 'active' : '', onClick: () => navigate('home') }, 'Ma connexion'), h('button', { className: page === 'diagnostic' ? 'active' : '', onClick: () => navigate('diagnostic') }, 'Le laboratoire'), h('button', { className: page === 'stories' ? 'active' : '', onClick: () => navigate('stories') }, 'Comprendre par l’exemple')), h('span', { className: 'workspace-status' }, h('i', { className: 'status-dot' }), ['pilot','operator'].includes(page) ? 'Données locales · accès authentifié' : 'Données simulées', h('span', { className: 'separator' }, '·'), ['pilot','operator'].includes(page) ? 'Actualisation 5 s' : paused ? 'En pause' : 'Mise à jour 1 s')), ['home','diagnostic','household','assistant','incidents'].includes(page) && h(FGSharedTelemetry.Source,{frame:commonFrame,source,paused,onSource:origin=>{selectSource(origin);if(page==='household' && origin==='line')setPage('diagnostic');},onPause:()=>setPaused(!paused),onIncidents:()=>navigate('incidents')}), story && h('div', { className: 'story-banner' }, h(Icon, { name: 'book' }), h('div', null, h('strong', null, { awa: 'Awa · le Wi-Fi accusé à tort', kouassi: 'Kouassi · agir avant la coupure', mariam: 'Mariam · rester accompagnée', quartier: 'Le quartier · une alerte commune' }[story.id]), h('p', null, story.step === 0 ? 'Observez le diagnostic qui se construit à partir des mesures.' : 'Essayez l’action proposée : chaque résultat reste une simulation.')), h(Button, { onClick: () => { if (story.step === 0) {
                setStory({ ...story, step: 1 });
                if (story.id === 'awa')
                    perform('channel');
                if (story.id === 'kouassi')
                    perform('ticket');
                if (story.id === 'mariam') {
                    scenario('sms');
                    setPhoneTab('sms');
                }
            }
            else {
                setStory(null);
                navigate('stories');
            } } }, story.step === 0 ? 'Passer à l’action' : 'Terminer l’histoire'), h(Button, { icon: 'x', 'aria-label': 'Fermer l’histoire', onClick: () => setStory(null) })), content, h('footer', { className: 'app-footer' }, h('span', null, h(Icon, { name: 'leaf', size: 15 }), 'Conçu pour être compris. Même quand Internet ne répond plus.'), onJourney && h('button', {onClick:onJourney}, '← Nouveau parcours Guardian'), h('button', { onClick: () => navigate('data') }, 'Vos données & les limites', h(Icon, { name: 'arrow', size: 14 })))))), toast && h('div', { className: 'toast', role: 'status' }, h(Icon, { name: 'check', size: 19 }), toast, h('button', { 'aria-label': 'Fermer la notification', onClick: () => setToast('') }, h(Icon, { name: 'x', size: 16 }))), tourOffer && tour < 0 && h('aside', { className: 'tour-offer', 'aria-label': 'Proposition de visite' }, h('button', { className: 'close-offer', 'aria-label': 'Ne pas faire la visite', onClick: () => { setTourOffer(false); saveStorage('tour', true); } }, h(Icon, { name: 'x', size: 17 })), h('span', { className: 'icon-disc' }, h(Icon, { name: 'spark' })), h('strong', null, 'Première visite ?'), h('p', null, 'On vous montre l’essentiel en 2 minutes.'), h(Button, { primary: true, onClick: startTour, icon: 'arrow' }, 'Faire la visite')), tour >= 0 && h('aside', { className: 'tour-coach', role: 'dialog', 'aria-label': 'Visite guidée' }, h('span', { className: 'eyebrow' }, 'VOTRE VISITE · ' + (tour + 1) + ' / 5'), h('h2', null, tourSteps[tour][0]), h('p', null, tourSteps[tour][1]), h('div', { className: 'modal-actions' }, h(Button, { onClick: () => setTour(-1) }, 'Quitter la visite'), h(Button, { primary: true, onClick: advanceTour, icon: 'arrow' }, tour === 4 ? 'Terminer' : 'Continuer'))), modalContent());
    }
    ReactDOM.createRoot(document.getElementById('root')).render(h(FGJourney.App,{Legacy:App}));
})();
