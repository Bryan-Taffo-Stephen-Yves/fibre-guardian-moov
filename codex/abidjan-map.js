// « Abidjan en direct » : la ville dessinée d'après sa géographie réelle (communes, lagune Ébrié, ponts),
// avec les quartiers en panne, les clients touchés et les camionnettes Moov qui roulent.
// Le dessin est embarqué (aucune tuile à télécharger) : la carte marche sans internet.
// Les tracés sont simplifiés à la main à partir des coordonnées des communes ; ce n'est pas un plan cadastral.
(function (root) {
  'use strict';
  // Cadre géographique (degrés) et taille du dessin. 1° ≈ 110 km à Abidjan, la déformation est négligeable.
  const LON0 = -4.135, LON1 = -3.875, LAT0 = 5.225, LAT1 = 5.455, W = 1000, H = Math.round(W * (LAT1 - LAT0) / (LON1 - LON0));
  const project = ([lon, lat]) => [Math.round((lon - LON0) / (LON1 - LON0) * W * 10) / 10, Math.round((LAT1 - lat) / (LAT1 - LAT0) * H * 10) / 10];
  const path = points => {
    // Courbe fermée lissée (Catmull-Rom) : des contours souples plutôt que des polygones anguleux.
    const q = points.map(project), n = q.length, f = v => Math.round(v * 10) / 10;
    let d = 'M' + q[0].join(' ');
    for (let k = 0; k < n; k++) {
      const p0 = q[(k - 1 + n) % n], p1 = q[k], p2 = q[(k + 1) % n], p3 = q[(k + 2) % n];
      d += 'C' + [f(p1[0] + (p2[0] - p0[0]) / 6), f(p1[1] + (p2[1] - p0[1]) / 6), f(p2[0] - (p3[0] - p1[0]) / 6), f(p2[1] - (p3[1] - p1[1]) / 6), p2[0], p2[1]].join(' ');
    }
    return d + 'Z';
  };
  // Cadre de la vue complète : on retire le haut, peu habité, pour donner la place à la lagune.
  // Sur téléphone, le cadre va jusqu'à l'encart de Grand-Bassam, au sud-est.
  const FULL = [0, 60, W, 805], NARROW = [60, 250, 870, 610];

  // Rive nord de la lagune, d'est en ouest : Riviera, baie de Cocody, Plateau, baie du Banco, Yopougon.
  const NORTH_SHORE = [[-3.875, 5.335], [-3.89, 5.338], [-3.91, 5.345], [-3.925, 5.343], [-3.94, 5.338], [-3.955, 5.333], [-3.97, 5.33], [-3.985, 5.327], [-3.995, 5.325], [-3.998, 5.335], [-4.002, 5.345], [-4.006, 5.338], [-4.008, 5.328], [-4.012, 5.312], [-4.02, 5.311], [-4.027, 5.318], [-4.028, 5.33], [-4.03, 5.338], [-4.033, 5.345], [-4.037, 5.338], [-4.04, 5.326], [-4.045, 5.318], [-4.055, 5.315], [-4.065, 5.31], [-4.075, 5.315], [-4.085, 5.31], [-4.095, 5.305], [-4.105, 5.312], [-4.115, 5.318], [-4.125, 5.315], [-4.135, 5.312]];
  const LAND = {
    mainland: [[-4.135, 5.455], [-3.875, 5.455], ...NORTH_SHORE],
    // Île de Petit-Bassam (Treichville, Marcory, Koumassi, Port-Bouët), du canal de Vridi à l'est.
    island: [[-4.03, 5.29], [-4.03, 5.296], [-4.022, 5.306], [-4.012, 5.305], [-4.0, 5.307], [-3.99, 5.31], [-3.98, 5.315], [-3.97, 5.313], [-3.955, 5.31], [-3.94, 5.306], [-3.928, 5.3], [-3.925, 5.29], [-3.91, 5.282], [-3.89, 5.28], [-3.875, 5.28], [-3.875, 5.258], [-3.9, 5.256], [-3.93, 5.254], [-3.96, 5.252], [-3.985, 5.25], [-4.002, 5.249], [-4.002, 5.268], [-4.015, 5.278], [-4.025, 5.285]],
    strip: [[-4.135, 5.262], [-4.08, 5.266], [-4.04, 5.268], [-4.012, 5.266], [-4.008, 5.25], [-4.04, 5.244], [-4.08, 5.238], [-4.135, 5.232]],
    boulay: [[-4.1, 5.29], [-4.09, 5.296], [-4.075, 5.295], [-4.068, 5.289], [-4.078, 5.283], [-4.093, 5.284]]
  };
  const SEA = [[-4.135, 5.232], [-4.08, 5.238], [-4.04, 5.244], [-4.008, 5.25], [-4.002, 5.249], [-3.985, 5.25], [-3.96, 5.252], [-3.93, 5.254], [-3.9, 5.256], [-3.875, 5.258], [-3.875, 5.225], [-4.135, 5.225]];
  const BIETRI = [[-3.99, 5.28], [-3.975, 5.285], [-3.958, 5.284], [-3.95, 5.276], [-3.965, 5.27], [-3.985, 5.272]];
  const BANCO = [[-4.07, 5.36], [-4.06, 5.355], [-4.045, 5.365], [-4.042, 5.39], [-4.06, 5.398], [-4.073, 5.385]];
  // Grand-Bassam est à 30 km à l'est par la route côtière : on le dessine en encart (contour pointillé)
  // au large de Port-Bouët, avec sa distance. Ce n'est pas sa vraie place sur la carte.
  const AWAY = {km: 30, land: [[-3.931, 5.2494], [-3.903, 5.2496], [-3.8985, 5.243], [-3.903, 5.2362], [-3.931, 5.236], [-3.936, 5.2427]]};

  // Les dix communes d'Abidjan, puis Grand-Bassam en encart (away). label : position du nom.
  const COMMUNES = [
    {id: 'yopougon', name: 'Yopougon', label: [-4.095, 5.355], shape: [[-4.135, 5.312], [-4.125, 5.315], [-4.115, 5.318], [-4.105, 5.312], [-4.095, 5.305], [-4.085, 5.31], [-4.075, 5.315], [-4.065, 5.31], [-4.055, 5.315], [-4.052, 5.33], [-4.06, 5.345], [-4.07, 5.36], [-4.075, 5.385], [-4.1, 5.39], [-4.135, 5.385]]},
    {id: 'attecoube', name: 'Attécoubé', label: [-4.046, 5.334], shape: [[-4.055, 5.315], [-4.045, 5.318], [-4.04, 5.326], [-4.037, 5.338], [-4.033, 5.345], [-4.03, 5.36], [-4.035, 5.375], [-4.045, 5.395], [-4.06, 5.4], [-4.075, 5.385], [-4.07, 5.36], [-4.06, 5.345], [-4.052, 5.33]]},
    {id: 'adjame', name: 'Adjamé', label: [-4.02, 5.366], shape: [[-4.033, 5.345], [-4.027, 5.339], [-4.007, 5.34], [-4.004, 5.35], [-4.008, 5.365], [-4.015, 5.375], [-4.035, 5.375], [-4.03, 5.36]]},
    {id: 'plateau', name: 'Plateau', label: [-4.018, 5.326], shape: [[-4.006, 5.338], [-4.008, 5.328], [-4.012, 5.312], [-4.02, 5.311], [-4.027, 5.318], [-4.028, 5.33], [-4.027, 5.339], [-4.007, 5.34]]},
    {id: 'abobo', name: 'Abobo', label: [-4.022, 5.415], shape: [[-4.035, 5.375], [-4.015, 5.375], [-3.99, 5.385], [-3.985, 5.41], [-3.99, 5.44], [-4.02, 5.448], [-4.05, 5.44], [-4.06, 5.4], [-4.045, 5.395]]},
    {id: 'cocody', name: 'Cocody', label: [-3.95, 5.368], shape: [[-4.002, 5.345], [-3.998, 5.335], [-3.995, 5.325], [-3.985, 5.327], [-3.97, 5.33], [-3.955, 5.333], [-3.94, 5.338], [-3.925, 5.343], [-3.91, 5.345], [-3.89, 5.338], [-3.895, 5.37], [-3.92, 5.39], [-3.95, 5.4], [-3.985, 5.41], [-3.99, 5.385], [-4.008, 5.365], [-4.004, 5.35]]},
    {id: 'treichville', name: 'Treichville', label: [-4.017, 5.288], shape: [[-4.03, 5.29], [-4.03, 5.296], [-4.022, 5.306], [-4.012, 5.305], [-4.0, 5.307], [-3.997, 5.295], [-4.0, 5.283], [-4.015, 5.278], [-4.025, 5.285]]},
    {id: 'marcory', name: 'Marcory', label: [-3.986, 5.307], shape: [[-4.0, 5.307], [-3.99, 5.31], [-3.98, 5.315], [-3.97, 5.313], [-3.968, 5.298], [-3.975, 5.285], [-3.99, 5.28], [-4.0, 5.283], [-3.997, 5.295]]},
    {id: 'koumassi', name: 'Koumassi', label: [-3.948, 5.297], shape: [[-3.97, 5.313], [-3.955, 5.31], [-3.94, 5.306], [-3.928, 5.3], [-3.925, 5.29], [-3.94, 5.284], [-3.95, 5.276], [-3.958, 5.284], [-3.968, 5.298]]},
    {id: 'portbouet', name: 'Port-Bouët', label: [-3.955, 5.262], shape: [[-4.002, 5.268], [-4.015, 5.278], [-4.0, 5.283], [-3.99, 5.28], [-3.985, 5.272], [-3.965, 5.27], [-3.95, 5.276], [-3.94, 5.284], [-3.925, 5.29], [-3.91, 5.282], [-3.89, 5.28], [-3.875, 5.28], [-3.875, 5.258], [-3.9, 5.256], [-3.93, 5.254], [-3.96, 5.252], [-3.985, 5.25], [-4.002, 5.249]]},
    {id: 'grandbassam', name: 'Grand-Bassam', away: true, label: [-3.962, 5.2445], shape: [[-3.929, 5.2487], [-3.904, 5.2489], [-3.9005, 5.243], [-3.904, 5.2369], [-3.929, 5.2367], [-3.933, 5.2427]]}
  ];
  // Ponts : Houphouët-Boigny et De Gaulle (Plateau ↔ Treichville), Henri-Konan-Bédié (Riviera ↔ Marcory).
  const BRIDGES = [[[-4.023, 5.3125], [-4.0235, 5.3045]], [[-4.0135, 5.3135], [-4.013, 5.3045]], [[-3.9855, 5.3285], [-3.9835, 5.3125]]];
  const ROADS = [[[-4.02, 5.34], [-4.02, 5.37], [-4.025, 5.44]], [[-4.03, 5.355], [-4.06, 5.35], [-4.1, 5.345], [-4.135, 5.345]], [[-4.0, 5.34], [-3.99, 5.37], [-3.985, 5.405]], [[-3.995, 5.332], [-3.95, 5.345], [-3.9, 5.35]], [[-4.02, 5.3], [-3.98, 5.3], [-3.93, 5.293]], [[-3.97, 5.285], [-3.95, 5.265], [-3.9, 5.262]]];
  const RUNWAY = [[-3.948, 5.257], [-3.915, 5.263]];

  // Les quartiers suivis par Guardian et la base de chaque équipe (identifiants de noc-store.cjs).
  const SEGMENTS = {
    'YOP-07': {commune: 'yopougon', area: 'Niangon', at: [-4.106, 5.331], side: 'north'},
    'COC-03': {commune: 'cocody', area: 'Cité des Arts', at: [-3.99, 5.352], side: 'north'},
    'MAR-02': {commune: 'marcory', area: 'Résidentiel', at: [-3.984, 5.296], side: 'island'},
    // Quartiers ajoutés pour la régie des pannes : un poteau par quartier.
    'ABO-01': {commune: 'abobo', area: 'Abobo Gare', at: [-4.02, 5.42], side: 'north'},
    'PAL-02': {commune: 'cocody', area: 'Palmeraie', at: [-3.94, 5.372], side: 'north'},
    'RIV-04': {commune: 'cocody', area: 'Riviera Golf', at: [-3.955, 5.343], side: 'north'},
    'PLA-01': {commune: 'plateau', area: 'Plateau', at: [-4.018, 5.322], side: 'north'},
    'ADJ-01': {commune: 'adjame', area: 'Adjamé Liberté', at: [-4.02, 5.36], side: 'north'},
    'TRE-01': {commune: 'treichville', area: 'Treichville', at: [-4.014, 5.293], side: 'island'},
    'KOU-01': {commune: 'koumassi', area: 'Koumassi', at: [-3.948, 5.297], side: 'island'},
    'PBT-01': {commune: 'portbouet', area: 'Port-Bouët', at: [-3.94, 5.272], side: 'island'},
    'BAS-01': {commune: 'grandbassam', area: 'Quartier France', at: [-3.917, 5.2428], side: 'island'}
  };
  const BASES = {
    awa: {at: [-4.015, 5.349], side: 'north'}, yao: {at: [-3.972, 5.392], side: 'north'}, amina: {at: [-4.007, 5.299], side: 'island'},
    ibrahim: {at: [-3.938, 5.356], side: 'north'}, koffi: {at: [-4.083, 5.352], side: 'north'}
  };
  // Côté client, le technicien arrive par son nom : « Koffi N’Guessan » → base « koffi ».
  const baseOf = name => { const key = String(name || '').split(' ')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); return BASES[key] ? key : null; };
  const DE_GAULLE = [[-4.0135, 5.316], [-4.013, 5.3015]], HKB = [[-3.9855, 5.331], [-3.9835, 5.309]], ADJAME = [-4.022, 5.348];

  // Itinéraire plausible : on passe par un pont pour changer de rive, et par Adjamé pour contourner la baie du Banco.
  function route(fromId, segmentId) {
    const from = BASES[fromId], to = SEGMENTS[segmentId];
    if (!from || !to) return null;
    const points = [from.at];
    if (from.side !== to.side) {
      const bridge = (from.at[0] + to.at[0]) / 2 > -4.0 ? HKB : DE_GAULLE;
      if (from.at[0] < -4.04 || to.at[0] < -4.04) points.push(ADJAME);
      points.push(...(from.side === 'north' ? bridge : [...bridge].reverse()));
    } else if (from.side === 'north' && (from.at[0] < -4.04) !== (to.at[0] < -4.04)) points.push(ADJAME);
    points.push(to.at);
    return points.map(project);
  }
  function along(points, progress) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0)), lengths = points.slice(1).map((pt, k) => Math.hypot(pt[0] - points[k][0], pt[1] - points[k][1])), total = lengths.reduce((a, b) => a + b, 0);
    let left = p * total;
    for (let k = 0; k < lengths.length; k++) {
      if (left <= lengths[k] || k === lengths.length - 1) { const t = lengths[k] ? Math.min(1, left / lengths[k]) : 1, a = points[k], b = points[k + 1]; return {x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0])}; }
      left -= lengths[k];
    }
    return {x: points[0][0], y: points[0][1], angle: 0};
  }
  // Les box du quartier, disposées en tournesol autour du point du segment (toujours la même disposition).
  function homes(segmentId, total) {
    const c = SEGMENTS[segmentId]; if (!c) return [];
    const [cx, cy] = project(c.at), golden = Math.PI * (3 - Math.sqrt(5));
    return Array.from({length: Math.max(0, Math.min(60, total || 0))}, (_, k) => { const r = 9 + 4.2 * Math.sqrt(k + 1), a = k * golden; return {x: Math.round((cx + r * Math.cos(a)) * 10) / 10, y: Math.round((cy + r * Math.sin(a) * .82) * 10) / 10}; });
  }
  // Voisins touchés : box hors ligne du quartier, sans compter la vôtre.
  function neighbors(area) { if (!area || !Number.isFinite(area.total) || !Number.isFinite(area.online)) return null; return Math.max(0, area.total - area.online - 1); }
  const OPEN = ['reported', 'proposed', 'approved', 'rejected', 'dispatched', 'en_route', 'on_site', 'verifying'];
  const MOVING = ['dispatched', 'en_route', 'on_site', 'verifying'];
  function progressOf(incident, now) {
    if (!incident) return 0;
    if (incident.status === 'dispatched') return 0;
    if (['on_site', 'verifying'].includes(incident.status)) return 1;
    const p = incident.position;
    if (!p) return 0;
    if (p.departedAt && p.durationMs) return Math.max(0, Math.min(1, (now - p.departedAt) / p.durationMs));
    return Math.max(0, Math.min(1, Number(p.progress) || 0));
  }
  const geo = {W, H, project, path, route, along, homes, neighbors, progressOf, SEGMENTS, BASES, COMMUNES, LAND, SEA, BIETRI, BANCO, AWAY, BRIDGES, ROADS, RUNWAY};
  if (typeof module === 'object' && module.exports) { module.exports = geo; return; }

  const h = root.React.createElement, {useState, useEffect, useMemo} = root.React;
  // Date courte, à l'heure d'Abidjan : « mar. 20 oct. à 10 h ».
  const when = at => { const d = new Date(at), o = {timeZone: 'Africa/Abidjan'}; return d.toLocaleDateString('fr-FR', {...o, weekday: 'short', day: 'numeric', month: 'short'}) + ' à ' + d.toLocaleTimeString('fr-FR', {...o, hour: 'numeric'}).replace(/\D+$/, '') + ' h'; };
  const STATUS = {reported: 'Panne repérée', proposed: 'Analyse prête', approved: 'Intervention validée', rejected: 'Analyse à revoir', dispatched: 'Équipe affectée', en_route: 'Équipe en route', on_site: 'Équipe sur place', verifying: 'Vérification', resolved: 'Rétablie'};
  const segmentOf = i => i && (i.segment_id || i.segment);
  // Sur téléphone, la vue complète se resserre sur le centre de la ville pour garder des noms lisibles.
  function useNarrow() {
    const query = root.matchMedia ? root.matchMedia('(max-width: 640px)') : null, [narrow, setNarrow] = useState(!!query?.matches);
    useEffect(() => { if (!query) return; const on = () => setNarrow(query.matches); query.addEventListener('change', on); return () => query.removeEventListener('change', on); }, []);
    return narrow;
  }
  function useClock(active) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
    return now;
  }
  function Van({x, y, angle, label}) {
    const flip = Math.cos(angle) < 0;
    return h('g', {className: 'ab-van', transform: 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')'},
      h('title', null, label),
      h('circle', {r: 17, className: 'ab-van-halo'}),
      h('g', {transform: flip ? 'scale(-1 1)' : undefined},
        h('rect', {x: -11, y: -7, width: 15, height: 11, rx: 2.5, className: 'ab-van-body'}),
        h('path', {d: 'M4 -4h4.5l3.5 4v4H4Z', className: 'ab-van-cab'}),
        h('path', {d: 'M6 -2.5h2.2l2 2.3H6Z', className: 'ab-van-glass'}),
        h('circle', {cx: -6.5, cy: 4.5, r: 2.4, className: 'ab-van-wheel'}), h('circle', {cx: 7, cy: 4.5, r: 2.4, className: 'ab-van-wheel'})));
  }
  // props : segments [{id,online,total,zone}], incidents [{segment_id|segment,status,technician,position}],
  // technicians [{id,name,busy}], focus (id de segment : carte cadrée sur ce quartier), selected, onSelect.
  function Map({segments = [], incidents = [], technicians = [], forecasts = [], focus, selected, onSelect, label}) {
    const open = incidents.filter(i => OPEN.includes(i.status) && segmentOf(i));
    const moving = open.filter(i => MOVING.includes(i.status) && i.technician);
    const now = useClock(moving.some(i => i.status === 'en_route'));
    const narrow = useNarrow();
    const downCommunes = new Set(open.map(i => SEGMENTS[segmentOf(i)]?.commune).filter(Boolean));
    const box = useMemo(() => {
      if (!focus || !SEGMENTS[focus]) return narrow ? NARROW : FULL;
      const [cx, cy] = project(SEGMENTS[focus].at), w = 560, hh = 360;
      return [Math.max(0, Math.min(W - w, cx - w / 2)), Math.max(0, Math.min(H - hh, cy - hh / 2)), w, hh];
    }, [focus, narrow]);
    const segRows = Object.keys(SEGMENTS).filter(id => !focus || id === focus).map(id => ({id, ...(segments.find(s => s.id === id) || {})}));
    const busyIds = new Set(moving.map(i => typeof i.technician === 'string' ? i.technician : null).filter(Boolean));
    const choose = id => onSelect && onSelect(id);
    return h('svg', {className: 'ab-map' + (focus ? ' is-focused' : ''), viewBox: box.join(' '), preserveAspectRatio: focus ? 'xMidYMid slice' : 'xMidYMid meet', role: 'img', 'aria-label': label || 'Carte d’Abidjan : quartiers, clients et équipes Moov'},
      h('defs', null,
        h('linearGradient', {id: 'ab-water', x1: 0, y1: 0, x2: 0, y2: 1}, h('stop', {offset: 0, className: 'ab-stop-lagoon-top'}), h('stop', {offset: 1, className: 'ab-stop-lagoon-bottom'})),
        h('radialGradient', {id: 'ab-alert'}, h('stop', {offset: 0, className: 'ab-stop-alert'}), h('stop', {offset: 1, className: 'ab-stop-alert-fade'}))),
      h('rect', {x: 0, y: 0, width: W, height: H, className: 'ab-lagoon', fill: 'url(#ab-water)'}),
      h('path', {d: path(SEA), className: 'ab-sea'}),
      ['mainland', 'island', 'strip', 'boulay'].map(k => h('path', {key: k, d: path(LAND[k]), className: 'ab-land'})),
      h('path', {d: path(AWAY.land), className: 'ab-land ab-away'}),
      h('path', {d: path(BIETRI), className: 'ab-water-inner'}),
      COMMUNES.map(c => h('path', {key: c.id, d: path(c.shape), className: 'ab-commune' + (downCommunes.has(c.id) ? ' is-down' : '')})),
      h('path', {d: path(BANCO), className: 'ab-forest'}),
      ROADS.map((r, k) => h('path', {key: k, d: 'M' + r.map(p => project(p).join(' ')).join('L'), className: 'ab-road'})),
      h('path', {d: 'M' + RUNWAY.map(p => project(p).join(' ')).join('L'), className: 'ab-runway'}),
      BRIDGES.map((b, k) => h('path', {key: k, d: 'M' + b.map(p => project(p).join(' ')).join('L'), className: 'ab-bridge'})),
      !focus && h('g', {className: 'ab-water-labels', 'aria-hidden': true},
        h('text', {x: project([-3.945, 5.319])[0], y: project([-3.945, 5.319])[1]}, 'Lagune Ébrié'),
        h('text', {x: project([-4.03, 5.24])[0], y: project([-4.03, 5.24])[1]}, 'Océan Atlantique'),
        h('text', {className: 'ab-forest-label', x: project([-4.058, 5.381])[0], y: project([-4.058, 5.381])[1]}, 'Banco')),
      h('g', {className: 'ab-labels', 'aria-hidden': true}, COMMUNES.map(c => { const [x, y] = project(c.label); return h('text', {key: c.id, x, y, className: downCommunes.has(c.id) ? 'is-down' : undefined}, c.name, c.away && h('tspan', {x, dy: '1.15em', className: 'ab-away-km'}, 'à ' + AWAY.km + ' km')); })),
      segRows.map(seg => {
        const s = SEGMENTS[seg.id], [x, y] = project(s.at), incident = open.find(i => segmentOf(i) === seg.id), total = seg.total || 20, offline = Number.isFinite(seg.online) ? Math.max(0, total - seg.online) : incident ? total : 0;
        const foreseen = !incident && forecasts.some(f => f.segment === seg.id);
        return h('g', {key: seg.id, className: 'ab-segment' + (incident ? ' is-down' : '') + (foreseen ? ' is-foreseen' : '') + (selected === seg.id ? ' is-selected' : '')},
          foreseen && h('circle', {cx: x, cy: y, r: 30, className: 'ab-foreseen-ring'}),
          incident && h('circle', {cx: x, cy: y, r: 44, className: 'ab-pulse', fill: 'url(#ab-alert)'}),
          incident && h('circle', {cx: x, cy: y, r: 44, className: 'ab-pulse ab-pulse--late', fill: 'url(#ab-alert)'}),
          homes(seg.id, total).map((p, k) => h('circle', {key: k, cx: p.x, cy: p.y, r: 2.6, className: 'ab-home' + (k < offline ? ' is-off' : '')})),
          h('g', {className: 'ab-pin', transform: 'translate(' + x + ' ' + y + ')', role: onSelect ? 'button' : undefined, tabIndex: onSelect ? 0 : undefined, 'aria-label': s.area + ' (' + seg.id + ') : ' + (incident ? offline + ' box sur ' + total + ' sans fibre, ' + (STATUS[incident.status] || 'incident ouvert').toLowerCase() : 'fibre normale'), onClick: () => choose(seg.id), onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(seg.id); } }},
            h('circle', {r: 9, className: 'ab-pin-dot'}),
            incident ? h('path', {d: 'M0 -4V1M0 3.6v.2', className: 'ab-pin-mark'}) : h('path', {d: 'm-3.2 0 2.2 2.2 4.2-4.4', className: 'ab-pin-mark'}),
            !focus && h('text', {y: 27, className: 'ab-pin-label'}, s.area)));
      }),
      moving.map(i => {
        const techId = typeof i.technician === 'string' ? i.technician : baseOf(i.technician?.name || i.position?.technician);
        const points = route(techId, segmentOf(i)); if (!points) return null;
        const p = progressOf(i, now), at = along(points, p), d = 'M' + points.map(pt => pt.join(' ')).join('L');
        return h('g', {key: i.id, className: 'ab-trip'},
          h('path', {d, className: 'ab-route-bed'}), h('path', {d, className: 'ab-route', pathLength: 1, strokeDasharray: '1', strokeDashoffset: -p}),
          h(Van, {x: at.x, y: at.y, angle: at.angle, label: (i.position?.technician || 'Équipe Moov') + ' · ' + (STATUS[i.status] || '')}));
      }),
      technicians.filter(t => !busyIds.has(t.id) && BASES[t.id] && !t.busy).map(t => { const [x, y] = project(BASES[t.id].at); return h('g', {key: t.id, className: 'ab-base', transform: 'translate(' + x + ' ' + y + ')'}, h('title', null, t.name + ' · disponible'), h('circle', {r: 9}), h('text', {y: 3.6}, t.name[0])); })
    );
  }

  function Legend({forecast} = {}) {
    const item = (cls, text) => h('li', null, h('i', {className: 'ab-key ' + cls, 'aria-hidden': true}), text);
    return h('ul', {className: 'ab-legend'}, item('is-off', 'Client sans fibre'), item('is-on', 'Client connecté'), forecast && item('is-foreseen', 'Panne prévue'), item('is-van', 'Équipe Moov'), item('is-base', 'Équipe disponible'));
  }

  // Panneau « Abidjan en direct » pour l'équipe Moov.
  function LivePanel({segments = [], incidents = [], technicians = [], forecasts = [], selected, onSelect, compact}) {
    const now = useClock(true);
    const open = incidents.filter(i => OPEN.includes(i.status) && segmentOf(i));
    const touched = segments.map(s => ({...s, incident: open.find(i => segmentOf(i) === s.id)})).filter(s => s.incident || s.online < s.total);
    const offline = touched.reduce((n, s) => n + Math.max(0, s.total - s.online), 0);
    const trips = open.filter(i => i.status === 'en_route' && i.position);
    const minutes = i => { const left = Math.max(0, (i.position.durationMs || 120000) - (now - (i.position.departedAt || now))); return Math.max(1, Math.ceil(left / 60000)); };
    return h('section', {className: 'ab-panel' + (compact ? ' is-compact' : ''), 'aria-labelledby': 'ab-title'},
      h('header', {className: 'ab-head'},
        h('div', null, h('h2', {id: 'ab-title'}, 'Abidjan en direct'), h('p', null, touched.length ? offline + ' client' + (offline > 1 ? 's' : '') + ' sans fibre dans ' + touched.length + ' quartier' + (touched.length > 1 ? 's' : '') + '.' : 'Tous les quartiers suivis ont la fibre.')),
        h('span', {className: 'ab-live'}, h('i', {'aria-hidden': true}), 'En direct · ' + new Date(now).toLocaleTimeString('fr-FR', {hour: '2-digit', minute: '2-digit'}))),
      h('div', {className: 'ab-body'},
        h('div', {className: 'ab-stage'}, h(Map, {segments, incidents, technicians, forecasts, selected, onSelect}), h(Legend, {forecast: forecasts.length > 0})),
        !compact && h('aside', {className: 'ab-side'},
          h('h3', null, 'Quartiers touchés'),
          touched.length ? h('ul', {className: 'ab-list'}, touched.map(s => { const info = SEGMENTS[s.id] || {area: s.zone}, off = Math.max(0, s.total - s.online);
            return h('li', {key: s.id}, h('button', {type: 'button', className: 'ab-row' + (selected === s.id ? ' is-selected' : ''), onClick: () => onSelect && onSelect(s.id), 'aria-pressed': selected === s.id},
              h('span', {className: 'ab-row-dot', 'aria-hidden': true}),
              h('span', {className: 'ab-row-text'}, h('strong', null, info.area + ' · ' + (COMMUNES.find(c => c.id === info.commune)?.name || '')), h('small', null, s.incident ? STATUS[s.incident.status] : 'Mesures en baisse')),
              h('span', {className: 'ab-row-count'}, h('b', null, off), h('small', null, ' / ' + s.total)))); }))
            : h('p', {className: 'ab-empty'}, 'Aucune panne en cours. Guardian surveille les box toutes les 5 secondes.'),
          forecasts.length > 0 && h(root.React.Fragment, null, h('h3', null, 'Pannes évitées à l’avance'), h('ul', {className: 'ab-list'}, forecasts.map((f, k) => { const info = SEGMENTS[f.segment] || {area: f.zone}, days = Math.max(1, Math.round(f.daysLeft || 1));
            return h('li', {key: k}, h('div', {className: 'ab-row ab-forecast-row'}, h('span', {className: 'ab-row-dot', 'aria-hidden': true}),
              h('span', {className: 'ab-row-text'}, h('strong', null, f.name.split(' ')[0] + ' · ' + info.area), h('small', null, f.prevention ? (f.technician?.name.split(' ')[0] || 'Technicien') + ' passe ' + when(f.prevention.slot) : 'Rendez-vous proposé au client')),
              f.prevention ? h('span', {className: 'ab-row-count is-avoided'}, h('small', null, 'Évitée')) : h('span', {className: 'ab-row-count'}, h('small', null, 'coupure dans '), h('b', null, days), h('small', null, ' j')))); }))),
          technicians.length > 0 && h(root.React.Fragment, null, h('h3', null, 'Équipes'), h('ul', {className: 'ab-teams'}, technicians.map(t => { const on = open.find(i => i.technician === t.id); return h('li', {key: t.id, className: on ? 'is-busy' : undefined}, h('span', {className: 'ab-avatar', 'aria-hidden': true}, t.name[0]), h('span', null, t.name.split(' ')[0]), h('small', null, on ? (STATUS[on.status] || 'En mission') : 'Disponible')); }))),
          trips.length > 0 && h(root.React.Fragment, null, h('h3', null, 'Sur la route'), h('ul', {className: 'ab-list'}, trips.map(i => h('li', {key: i.id, className: 'ab-trip-row'}, h('span', {className: 'ab-trip-icon', 'aria-hidden': true}, h('svg', {viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round'}, h('path', {d: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4M17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4'}))), h('span', {className: 'ab-row-text'}, h('strong', null, i.position.technician), h('small', null, 'Vers ' + (SEGMENTS[segmentOf(i)]?.area || segmentOf(i)))), h('span', {className: 'ab-row-count'}, h('b', null, minutes(i)), h('small', null, ' min'))))))))
    );
  }

  // Carte « vos voisins » côté client : son quartier, les box éteintes autour de lui, l'équipe qui arrive.
  function NeighborsCard({incident, onTrack, call}) {
    if (!incident || !OPEN.includes(incident.status)) return null;
    const seg = segmentOf(incident), info = SEGMENTS[seg], n = neighbors(incident.area);
    const area = incident.area ? [{id: seg, online: incident.area.online, total: incident.area.total}] : [];
    const tech = incident.technician?.name || incident.position?.technician;
    const first = tech ? tech.split(' ')[0] : null;
    const line = {
      dispatched: 'Une équipe Moov est affectée' + (first ? ' : ' + first + ' va partir.' : '.'),
      en_route: (first || 'Votre technicien') + ' est en route vers votre quartier.',
      on_site: (first || 'L’équipe') + ' est sur place et répare la fibre.',
      verifying: 'La réparation est faite. Moov vérifie que tout revient.'
    }[incident.status] || 'Moov a repéré la panne et prépare l’intervention.';
    // Coupure de courant (CIE) : Moov n'a rien à réparer, la box repart seule au retour du courant.
    const power = incident.cause === 'POWER_OUTAGE';
    if (power) return h('section', {className: 'j-card ab-neighbors is-power', role: 'status'},
      h('div', {className: 'ab-neighbors-map'}, h(Map, {segments: area, incidents: [incident], focus: seg, label: 'Votre quartier sur la carte d’Abidjan'})),
      h('div', {className: 'ab-neighbors-text'},
        h('small', null, (info ? info.area + ', ' + COMMUNES.find(c => c.id === info.commune).name : 'Votre quartier')),
        h('h2', null, 'Coupure de courant dans votre quartier'),
        h('p', null, 'Ce n’est pas une panne Moov : le courant est coupé' + (n ? ' chez vous et chez ' + n + ' voisin' + (n > 1 ? 's' : '') : ' dans le quartier') + ' (CIE). Votre box repartira toute seule dès le retour du courant.'),
        h('p', {className: 'ab-neighbors-hint'}, 'Inutile d’appeler le service client ni de redémarrer la box. Guardian vous prévient quand tout revient.'),
        call && h('div', {className: 'ab-neighbors-actions'}, call)));
    return h('section', {className: 'j-card ab-neighbors', role: 'status'},
      h('div', {className: 'ab-neighbors-map'}, h(Map, {segments: area, incidents: [incident], focus: seg, label: 'Votre quartier sur la carte d’Abidjan'})),
      h('div', {className: 'ab-neighbors-text'},
        h('small', null, (info ? info.area + ', ' + COMMUNES.find(c => c.id === info.commune).name : 'Votre quartier')),
        h('h2', null, n === null ? 'Votre quartier est touché par une panne' : n === 0 ? 'Votre signalement est chez Moov' : n + ' voisin' + (n > 1 ? 's ont' : ' a') + ' le même souci'),
        // Un seul signalement (les box des voisins marchent) : on ne parle pas de panne de quartier.
        h('p', null, (n === 0 ? 'Les box de vos voisins fonctionnent : Moov a bien reçu votre signalement et vérifie votre ligne. ' + (MOVING.includes(incident.status) ? line + ' ' : '') : 'Ce n’est pas votre box : c’est la fibre du quartier. ' + line + ' ') + 'Vous n’avez pas à vous inquiéter.'),
        root.FGAppel && h(root.FGAppel.Restore, {restore: incident.restore}),
        (onTrack || call) && h('div', {className: 'ab-neighbors-actions'},
          onTrack && h('button', {type: 'button', className: 'j-button primary', onClick: onTrack}, 'Suivre l’intervention'), call)));
  }

  root.FGAbidjan = {...geo, Map, LivePanel, NeighborsCard, Legend};
})(typeof window !== 'undefined' ? window : globalThis);
