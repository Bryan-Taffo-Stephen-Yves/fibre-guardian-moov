// Simulateur de pannes : Abidjan en maquette 3D, un poteau par quartier.
// On clique sur la bulle d'un poteau, on choisit une panne, et le moteur d'incidents de noc-store fait le reste.
// La maquette est dessinée en SVG à partir de la carte « Abidjan en direct » (aucune tuile, aucune bibliothèque 3D).
(function (root) {
  'use strict';
  const G = typeof module === 'object' && module.exports ? require('./abidjan-map.js') : root.FGAbidjan;
  const CX = G.W / 2, CY = 450, TILT = .52, LIFT = 1.5;

  // Vue : rotation autour du centre de la ville, puis inclinaison. depth sert à dessiner de l'arrière vers l'avant.
  function view(rotation) {
    const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const flat = ([x, y]) => { const dx = x - CX, dy = y - CY; return [dx * c - dy * s, dx * s + dy * c]; };
    const at = (p, z = 0) => { const [rx, ry] = flat(p); return [Math.round(rx * 10) / 10, Math.round((ry * TILT - z * LIFT) * 10) / 10]; };
    return {flat, at, depth: p => flat(p)[1]};
  }
  // Contour fermé lissé (Catmull-Rom), comme sur la carte à plat.
  function smooth(q) {
    const n = q.length, f = v => Math.round(v * 10) / 10;
    let d = 'M' + q[0].join(' ');
    for (let k = 0; k < n; k++) {
      const p0 = q[(k - 1 + n) % n], p1 = q[k], p2 = q[(k + 1) % n], p3 = q[(k + 2) % n];
      d += 'C' + [f(p1[0] + (p2[0] - p0[0]) / 6), f(p1[1] + (p2[1] - p0[1]) / 6), f(p2[0] - (p3[0] - p1[0]) / 6), f(p2[1] - (p3[1] - p1[1]) / 6), p2[0], p2[1]].join(' ');
    }
    return d + 'Z';
  }
  const shape = (v, lonlat, z = 0) => smooth(lonlat.map(p => v.at(G.project(p), z)));

  // Bâtiments : toujours les mêmes à chaque ouverture (tirage pseudo-aléatoire fixé par commune).
  const STYLE = {
    plateau: {n: 24, w: [12, 20], h: [30, 70]}, cocody: {n: 60, w: [10, 16], h: [6, 14]}, yopougon: {n: 70, w: [8, 13], h: [4, 9]},
    abobo: {n: 55, w: [8, 12], h: [4, 9]}, adjame: {n: 26, w: [9, 14], h: [8, 18]}, attecoube: {n: 22, w: [8, 12], h: [4, 8]},
    treichville: {n: 26, w: [9, 14], h: [8, 20]}, marcory: {n: 28, w: [9, 14], h: [6, 14]}, koumassi: {n: 30, w: [8, 13], h: [5, 10]}, portbouet: {n: 26, w: [8, 13], h: [4, 8]},
    grandbassam: {n: 12, w: [7, 11], h: [3, 7]}
  };
  function rng(seed) { let t = 0; for (const ch of seed) t = (t * 31 + ch.charCodeAt(0)) >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ t >>> 15, 1 | t); r ^= r + Math.imul(r ^ r >>> 7, 61 | r); return ((r ^ r >>> 14) >>> 0) / 4294967296; }; }
  function inside(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
  let cache = null;
  function buildings() {
    if (cache) return cache;
    const pins = Object.entries(G.SEGMENTS).map(([id, s]) => ({id, p: G.project(s.at)})), out = [];
    for (const c of G.COMMUNES) {
      const st = STYLE[c.id] || STYLE.abobo, r = rng(c.id), lons = c.shape.map(p => p[0]), lats = c.shape.map(p => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
      for (let tries = 0, made = 0; made < st.n && tries < st.n * 30; tries++) {
        const ll = [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)];
        if (!inside(ll, c.shape)) continue;
        const p = G.project(ll), near = pins.reduce((best, pin) => { const d = Math.hypot(pin.p[0] - p[0], pin.p[1] - p[1]); return d < best.d ? {id: pin.id, d} : best; }, {id: null, d: Infinity});
        if (near.d < 16) continue; // on laisse la place au poteau
        const w = st.w[0] + r() * (st.w[1] - st.w[0]), d = w * (.7 + r() * .6), hgt = st.h[0] + r() * (st.h[1] - st.h[0]);
        if (out.some(b => Math.abs(b.p[0] - p[0]) < (b.w + w) / 2 + 2 && Math.abs(b.p[1] - p[1]) < (b.d + d) / 2 + 2)) continue;
        out.push({p, w, d, h: Math.round(hgt), commune: c.id, segment: near.d < 70 ? near.id : null});
        made++;
      }
    }
    return (cache = out);
  }
  // Faces visibles d'un bâtiment : les murs tournés vers le spectateur, puis le toit.
  function faces(v, b) {
    const [x, y] = b.p, hw = b.w / 2, hd = b.d / 2, base = [[x - hw, y - hd], [x + hw, y - hd], [x + hw, y + hd], [x - hw, y + hd]];
    const walls = [];
    for (let k = 0; k < 4; k++) {
      const a = base[k], c = base[(k + 1) % 4], fa = v.flat(a), fc = v.flat(c), nx = fc[1] - fa[1], ny = -(fc[0] - fa[0]);
      if (ny <= 0) continue; // mur tourné vers l'arrière
      walls.push({side: nx > 0 ? 'b' : 'a', d: 'M' + [v.at(a), v.at(c), v.at(c, b.h), v.at(a, b.h)].map(q => q.join(' ')).join('L') + 'Z'});
    }
    return {walls, roof: 'M' + base.map(q => v.at(q, b.h).join(' ')).join('L') + 'Z'};
  }
  // Vue cadrée : centre, zoom et proportions du cadre. Renvoie le viewBox.
  function frame(rotation, zoom, pan, ratio) {
    // Cadrage sur les poteaux (et leurs bulles au-dessus) et l'encart de Grand-Bassam, pas sur toute la terre ferme.
    const v = view(rotation), pts = [...Object.values(G.SEGMENTS).map(s => s.at), ...G.AWAY.land].map(p => v.at(G.project(p)));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), cx = (Math.max(...xs) + Math.min(...xs)) / 2 + pan[0], cy = (Math.min(...ys) - 80 + Math.max(...ys) + 30) / 2 + pan[1];
    const w = 1000 / zoom, hgt = w / ratio;
    return [cx - w / 2, cy - hgt / 2, w, hgt];
  }

  const NAMES = {'YOP-07': 'Yopougon', 'ABO-01': 'Abobo', 'PAL-02': 'Palmeraie', 'COC-03': 'Cocody', 'RIV-04': 'Riviera Golf', 'PLA-01': 'Plateau', 'ADJ-01': 'Adjamé', 'TRE-01': 'Treichville', 'MAR-02': 'Marcory', 'KOU-01': 'Koumassi', 'PBT-01': 'Port-Bouët', 'BAS-01': 'Grand-Bassam'};
  // Pannes proposées sur chaque poteau, branchées sur les scénarios du moteur (noc-store « simulate »).
  const FAULTS = [
    {id: 'pole', title: 'Poteau tombé ou abîmé', text: 'La fibre est arrachée avec le poteau. Un technicien doit se déplacer.', icon: 'M12 3v18M7 7h10M9 21h6'},
    {id: 'fiber', title: 'Fibre coupée', text: 'Le câble est sectionné entre le poteau et les maisons.', icon: 'M3 12h6l2-3 2 6 2-3h6'},
    {id: 'works', title: 'Câble arraché par un chantier', text: 'Des engins de travaux ont arraché le câble. Deux équipes partent.', icon: 'M9.5 4h5l4 16h-13zM7.6 10h8.8M6.4 15h11.2M3 20h18'},
    {id: 'theft', title: 'Vol de câble', text: 'Le boîtier a été forcé et le câble emporté.', icon: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.9 20 18M8.1 16.1 20 6'},
    {id: 'flood', title: 'Armoire inondée', text: 'L’eau est entrée après la pluie. On attend qu’elle se retire.', icon: 'M12 3s-5 6-5 9.5a5 5 0 0 0 10 0C17 9 12 3 12 3zM2 21c2.5 0 2.5-1.5 5-1.5s2.5 1.5 5 1.5 2.5-1.5 5-1.5 2.5 1.5 5 1.5'},
    {id: 'power', title: 'Coupure de courant CIE', text: 'Les box s’éteignent faute de courant. Ce n’est pas une panne Moov.', icon: 'M13 2 4 14h7l-1 8 9-12h-7z'},
    {id: 'congestion', title: 'Baisse de débit', text: 'Trop de monde en même temps : internet ralentit sans couper.', icon: 'M4 18a8 8 0 1 1 16 0M12 18l4-6'},
    {id: 'olt', title: 'Équipement central en panne', text: 'Toute la commune est coupée. Moov redémarre à distance.', icon: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01'}
  ];
  // Câbles de fibre entre poteaux voisins, du central du Plateau vers les quartiers (Grand-Bassam par la route côtière).
  const LINKS = [['PLA-01', 'ADJ-01'], ['ADJ-01', 'ABO-01'], ['ADJ-01', 'YOP-07'], ['PLA-01', 'COC-03'], ['COC-03', 'RIV-04'], ['RIV-04', 'PAL-02'],
    ['PLA-01', 'TRE-01'], ['TRE-01', 'MAR-02'], ['COC-03', 'MAR-02'], ['MAR-02', 'KOU-01'], ['KOU-01', 'PBT-01'], ['PBT-01', 'BAS-01']];
  // État d'un câble : les données passent, ralentissent (réseau saturé) ou s'arrêtent (un des deux poteaux est en panne).
  const linkState = (a, b) => [a, b].includes('down') ? 'cut' : [a, b].includes('warn') ? 'slow' : 'flow';
  const OPEN = ['reported', 'proposed', 'approved', 'rejected', 'dispatched', 'en_route', 'on_site', 'verifying'];
  const STEPS = [['reported', 'Repérée'], ['approved', 'Validée'], ['dispatched', 'Équipe affectée'], ['en_route', 'En route'], ['on_site', 'Sur place'], ['resolved', 'Réparée']];
  const ORDER = {reported: 0, proposed: 0, rejected: 0, approved: 1, dispatched: 2, en_route: 3, on_site: 4, verifying: 4, resolved: 5};
  // État d'un poteau : panne en cours, débit en baisse, réparé récemment ou normal.
  function stateOf(seg, incidents) {
    const open = incidents.find(i => i.segment_id === seg.id && OPEN.includes(i.status));
    if (open) return {tone: seg.alarm === 'UPLINK_HIGH' || open.plan?.cause === 'UPLINK_CONGESTION' ? 'warn' : 'down', incident: open};
    if (seg.alarm === 'UPLINK_HIGH') return {tone: 'warn', incident: null};
    if (seg.online < seg.total) return {tone: 'down', incident: null};
    const done = incidents.find(i => i.segment_id === seg.id && ['resolved', 'closed'].includes(i.status) && Date.now() - (i.updated || 0) < 10 * 60000);
    return {tone: done ? 'ok' : 'calm', incident: done || null};
  }

  // Range les bulles sans chevauchement : les plus proches gardent leur place, les autres se décalent.
  function place(items, vb, px, compact) {
    const k = px / vb[2], gap = 4 / k, out = {}, boxes = [];
    const size = it => it.dot ? [26 / k, 26 / k] : [((compact ? 8.6 : 7.4) * it.name.length + (compact ? 38 : 36)) / k, (compact ? 30 : 32) / k];
    const tries = [[0, 0], [0, -1], [-.55, 0], [.55, 0], [-.55, -1], [.55, -1], [0, -2], [-.6, -2], [.6, -2], [0, -3]];
    // Les points (poteaux calmes sur téléphone) restent sur leur poteau ; les bulles nommées les contournent.
    [...items].sort((a, b) => (b.dot ? 1 : 0) - (a.dot ? 1 : 0) || b.a[1] - a.a[1]).forEach(it => {
      const [w, hh] = size(it), lift = 8 / k; let best = null;
      for (const [fx, fy] of it.dot ? [[0, 0]] : tries) {
        let x = it.a[0] + fx * (w + gap), y = it.a[1] + fy * (hh + gap);
        x = Math.min(vb[0] + vb[2] - w / 2 - gap, Math.max(vb[0] + w / 2 + gap, x));
        const box = [x - w / 2, y - hh - lift, x + w / 2, y];
        if (it.dot || !boxes.some(o => box[0] < o[2] + gap && box[2] + gap > o[0] && box[1] < o[3] + gap && box[3] + gap > o[1])) { best = [x, y, box]; break; }
        if (!best) best = [x, y, box, true];
      }
      boxes.push(best[2]);
      out[it.id] = {...it, at: [best[0], best[1]], moved: Math.hypot(best[0] - it.a[0], best[1] - it.a[1]) > 1};
    });
    return out;
  }

  const api = {view, frame, place, buildings, faces, smooth, inside, stateOf, linkState, FAULTS, NAMES, STEPS, ORDER, LINKS};
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  const h = root.React.createElement, {useState, useEffect, useMemo, useRef} = root.React;

  function useNarrow() { const q = '(max-width: 760px)', [m, setM] = useState(() => root.matchMedia?.(q).matches); useEffect(() => { const mq = root.matchMedia?.(q); if (!mq) return; const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []); return m; }
  // La rotation glisse doucement vers sa nouvelle valeur.
  function useEased(target) {
    const [v, setV] = useState(target), cur = useRef(target);
    useEffect(() => {
      if (root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { cur.current = target; setV(target); return; }
      const a = cur.current, t0 = performance.now(); let f;
      const step = t => { const k = Math.min(1, (t - t0) / 520), e = 1 - Math.pow(1 - k, 3); cur.current = a + (target - a) * e; setV(cur.current); if (k < 1) f = requestAnimationFrame(step); };
      f = requestAnimationFrame(step); return () => cancelAnimationFrame(f);
    }, [target]);
    return v;
  }

  function Scene({segments, incidents, rotation, zoom, pan, ratio, selected, onPick, compact}) {
    const v = view(rotation), vb = frame(rotation, zoom, pan, ratio), stage = useRef(null), [px, setPx] = useState(800);
    useEffect(() => { const el = stage.current; if (!el || !root.ResizeObserver) return; const ro = new ResizeObserver(([e]) => setPx(e.contentRect.width || 800)); ro.observe(el); return () => ro.disconnect(); }, []);
    const states = Object.fromEntries(segments.map(s => [s.id, stateOf(s, incidents)]));
    const dark = new Set(segments.filter(s => states[s.id].tone === 'down').map(s => s.id));
    const blocks = useMemo(() => buildings().map(b => ({...b, depth: v.depth(b.p)})).sort((a, b) => a.depth - b.depth), [rotation]);
    const downCommunes = new Set(segments.filter(s => dark.has(s.id)).map(s => G.SEGMENTS[s.id]?.commune));
    const pins = Object.entries(G.SEGMENTS).map(([id, s]) => { const seg = segments.find(x => x.id === id) || {id, online: 20, total: 20}, p = G.project(s.at), st = states[id] || {tone: 'calm'}, [bx, by] = v.at(p), fallen = st.tone === 'down' && seg.scenario === 'pole'; return {id, seg, p, depth: v.depth(p), st, fallen, top: fallen ? [bx + 26, by - 8] : v.at(p, 40), box: fallen ? [bx + 18, by - 5] : v.at(p, 22)}; });
    // Les câbles partent du boîtier fixé sur le mât, juste sous la bulle du poteau.
    const tops = Object.fromEntries(pins.map(pin => [pin.id, pin]));
    const cables = LINKS.filter(([a, b]) => tops[a] && tops[b]).map(([a, b], k) => {
      const p = tops[a].box, q = tops[b].box, len = Math.hypot(q[0] - p[0], q[1] - p[1]), state = linkState(tops[a].st.tone, tops[b].st.tone);
      // Le câble pend un peu entre deux poteaux ; les paquets mettent plus de temps sur les longues portées.
      const d = 'M' + p.join(' ') + 'Q' + ((p[0] + q[0]) / 2).toFixed(1) + ' ' + ((p[1] + q[1]) / 2 + len * .07).toFixed(1) + ' ' + q.join(' ');
      const dur = (1.4 + len / 260) * (state === 'slow' ? 2.6 : 1);
      return {id: a + b, d, state, dur, delay: (k * .53) % dur};
    });
    const vans = incidents.filter(i => i.technician && ['en_route', 'on_site', 'verifying'].includes(i.status) && G.SEGMENTS[i.segment_id]).map(i => {
      const base = typeof i.technician === 'string' ? i.technician : null, path = base && G.route(base, i.segment_id);
      if (!path) return null; const pos = G.along(path, G.progressOf(i, Date.now())); return {id: i.id, p: [pos.x, pos.y]};
    }).filter(Boolean);
    const labels = place(pins.map(pin => ({id: pin.id, a: v.at(pin.p, 30), dot: compact && pin.st.tone === 'calm' && selected !== pin.id, name: (compact || px < 820 ? '' : 'Poteau ') + NAMES[pin.id]})), vb, px, compact);
    const bubble = id => { const [sx, sy] = labels[id].at; return {left: (sx - vb[0]) / vb[2] * 100 + '%', top: (sy - vb[1]) / vb[3] * 100 + '%'}; };
    return h('div', {className: 'sm-stage', ref: stage, style: {aspectRatio: String(ratio)}},
      h('svg', {className: 'sm-svg', viewBox: vb.join(' '), role: 'img', 'aria-label': 'Maquette d’Abidjan en relief avec un poteau par quartier'},
        h('defs', null, h('linearGradient', {id: 'sm-water', x1: 0, y1: 0, x2: 0, y2: 1}, h('stop', {offset: 0, className: 'sm-water-top'}), h('stop', {offset: 1, className: 'sm-water-bottom'}))),
        h('rect', {x: vb[0] - 400, y: vb[1] - 400, width: vb[2] + 800, height: vb[3] + 800, fill: 'url(#sm-water)'}),
        ['mainland', 'island', 'strip', 'boulay'].map(k => h('path', {key: 'c' + k, d: shape(v, G.LAND[k], -9), className: 'sm-cliff'})),
        ['mainland', 'island', 'strip', 'boulay'].map(k => h('path', {key: 'l' + k, d: shape(v, G.LAND[k]), className: 'sm-land'})),
        // Grand-Bassam en encart : contour pointillé et distance réelle par la route.
        h('path', {d: shape(v, G.AWAY.land, -9), className: 'sm-cliff'}),
        h('path', {d: shape(v, G.AWAY.land), className: 'sm-land sm-away'}),
        h('path', {d: shape(v, G.BIETRI), className: 'sm-lagoon'}),
        G.COMMUNES.map(c => h('path', {key: c.id, d: shape(v, c.shape), className: 'sm-commune' + (downCommunes.has(c.id) ? ' is-down' : '')})),
        h('path', {d: shape(v, G.BANCO), className: 'sm-forest'}),
        G.ROADS.map((r, k) => h('path', {key: 'r' + k, d: 'M' + r.map(p => v.at(G.project(p)).join(' ')).join('L'), className: 'sm-road'})),
        G.BRIDGES.map((b, k) => h('path', {key: 'b' + k, d: 'M' + b.map(p => v.at(G.project(p), 2).join(' ')).join('L'), className: 'sm-bridge'})),
        // Bâtiments et poteaux mêlés, de l'arrière vers l'avant.
        [...blocks.map(b => ({kind: 'b', depth: b.depth, b})), ...pins.map(pin => ({kind: 'p', depth: pin.depth + .1, pin})), ...vans.map(van => ({kind: 'v', depth: v.depth(van.p) + .2, van}))].sort((a, b) => a.depth - b.depth).map((it, k) => {
          if (it.kind === 'b') { const f = faces(v, it.b), off = it.b.segment && dark.has(it.b.segment); return h('g', {key: k, className: 'sm-building' + (off ? ' is-off' : '')}, f.walls.map((w, j) => h('path', {key: j, d: w.d, className: 'sm-wall-' + w.side})), h('path', {d: f.roof, className: 'sm-roof'})); }
          if (it.kind === 'v') { const f = faces(v, {p: it.van.p, w: 12, d: 7, h: 7}); return h('g', {key: k, className: 'sm-van'}, f.walls.map((w, j) => h('path', {key: j, d: w.d, className: 'sm-van-' + w.side})), h('path', {d: f.roof, className: 'sm-van-roof'})); }
          const pin = it.pin, [bx, by] = v.at(pin.p), fallen = pin.fallen, top = pin.top;
          return h('g', {key: k, className: 'sm-pole is-' + pin.st.tone + (selected === pin.id ? ' is-selected' : '')},
            h('ellipse', {cx: bx, cy: by, rx: 15, ry: 15 * TILT, className: 'sm-pole-ground'}),
            pin.st.tone === 'down' ? h('ellipse', {cx: bx, cy: by, rx: 15, ry: 15 * TILT, className: 'sm-pole-pulse'})
              : h('ellipse', {cx: bx, cy: by, rx: 15, ry: 15 * TILT, className: 'sm-pole-ring', style: {animationDelay: -(pin.depth % 2.8).toFixed(2) + 's'}}),
            h('line', {x1: bx, y1: by, x2: top[0], y2: top[1], className: 'sm-pole-mast'}),
            h('line', {x1: top[0] - (fallen ? 3 : 7), y1: top[1] + (fallen ? -6 : 5), x2: top[0] + (fallen ? 3 : 7), y2: top[1] + (fallen ? 6 : 5), className: 'sm-pole-arm'}),
            // Voyant du boîtier fixé sur le poteau : il clignote quand les données passent.
            h('circle', {cx: pin.box[0], cy: pin.box[1], r: 3.6, className: 'sm-pole-led', style: {animationDelay: -(pin.depth % 1.6).toFixed(2) + 's'}}));
        }),
        // Les données circulent sur les câbles, dans les deux sens ; elles s'arrêtent au poteau en panne.
        h('g', {className: 'sm-net', 'aria-hidden': true}, cables.map(c => h('g', {key: c.id, className: 'sm-link is-' + c.state},
          h('path', {d: c.d, className: 'sm-cable'}),
          c.state !== 'cut' && [[0, 0], [0, .5], [1, .25]].map(([back, shift], n) => { const style = {animationDuration: c.dur.toFixed(2) + 's', animationDelay: -(c.delay + shift * c.dur).toFixed(2) + 's'}, cls = back ? ' is-back' : '';
            return [h('path', {key: 'h' + n, d: c.d, pathLength: 1, className: 'sm-packet-halo' + cls, style}), h('path', {key: 'p' + n, d: c.d, pathLength: 1, className: 'sm-packet' + cls, style})]; })))),
        // Fil entre le poteau et sa bulle quand la bulle a dû se pousser.
        pins.filter(pin => labels[pin.id].moved).map(pin => { const a = labels[pin.id].a, b = labels[pin.id].at; return h('line', {key: 'f' + pin.id, x1: a[0], y1: a[1], x2: b[0], y2: b[1], className: 'sm-leader'}); }),
        // À gauche de l'encart : la vraie distance de Grand-Bassam.
        (() => { const [x, y] = v.at(G.project([-3.9385, 5.2392])); return h('text', {x, y, className: 'sm-away-km', style: {fontSize: (12 * vb[2] / px).toFixed(1) + 'px'}}, 'à ' + G.AWAY.km + ' km par la route'); })()),
      pins.map(pin => h('button', {key: pin.id, type: 'button', className: 'sm-bubble is-' + pin.st.tone + (labels[pin.id].dot ? ' is-dot' : '') + (selected === pin.id ? ' is-selected' : ''), style: bubble(pin.id), title: 'Poteau ' + NAMES[pin.id], onClick: () => onPick(pin.id), 'aria-pressed': selected === pin.id, 'aria-label': 'Poteau ' + NAMES[pin.id] + ' : ' + ({down: 'panne en cours', warn: 'débit en baisse', ok: 'réparé', calm: 'tout va bien'})[pin.st.tone]},
        h('i', {'aria-hidden': true}), labels[pin.id].dot ? null : labels[pin.id].name)));
  }

  // Qui recevra les alertes de ce poteau : seulement les clients du quartier (toute la commune si l'équipement central tombe).
  function Reach({incident, segment, segments}) {
    const r = root.FGSimFlow ? root.FGSimFlow.reach(incident, segment, segments) : {count: 0};
    return h('div', {className: 'sm-clients'},
      h('svg', {viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, h('path', {d: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6'})),
      h('p', null, r.count ? ['Alertes envoyées à ', h('b', {key: 'b'}, r.who)] : 'Aucun client rattaché à ce quartier pour l’instant.',
        r.count > 0 && h('small', null, r.wide ? 'Toute la commune de ' + r.commune + ' est prévenue.' : 'Les autres quartiers ne reçoivent rien.')));
  }

  function Panel({segment, incidents, data, busy, error, onSimulate, onRestore, onStep, onClose, onOpenIncident, onPick}) {
    const [fault, setFault] = useState('pole');
    const st = stateOf(segment, incidents), info = G.SEGMENTS[segment.id], commune = G.COMMUNES.find(c => c.id === info?.commune);
    const i = st.incident, step = i ? ORDER[i.status] ?? 0 : -1, skipVisit = i && i.plan && i.plan.dispatch === false, live = i && !['resolved', 'closed'].includes(i.status);
    // Quartier coupé par l'équipement central de sa commune : il revient avec lui, on agit sur le poteau qui porte la panne.
    const central = segment.alarm === 'UPSTREAM' && (data?.segments || []).find(g => g.alarm === 'OLT_DOWN' && G.SEGMENTS[g.id]?.commune === info?.commune);
    const locked = live || segment.alarm === 'UPSTREAM';
    return h('aside', {className: 'sm-panel', 'aria-labelledby': 'sm-panel-title'},
      h('header', {className: 'sm-panel-head'},
        h('div', null, h('small', null, (commune?.name || '') + ' · ' + segment.id), h('h2', {id: 'sm-panel-title'}, 'Poteau ' + NAMES[segment.id])),
        h('button', {type: 'button', className: 'sm-x', onClick: onClose, 'aria-label': 'Fermer le panneau'}, '×')),
      h('div', {className: 'sm-meter is-' + st.tone},
        h('strong', null, segment.online, h('small', null, ' / ' + segment.total)), h('span', null, 'box en ligne'),
        h('em', null, ({down: 'Panne en cours', warn: 'Débit en baisse', ok: 'Réparé', calm: 'Tout va bien'})[st.tone])),
      h(Reach, {incident: i, segment, segments: data?.segments}),
      i && root.FGSimFlowView && h(root.FGSimFlowView.Flow, {key: i.id, incident: i, segment, data, run: onStep, busy: !!busy}),
      i && h('ol', {className: 'sm-steps', 'aria-label': 'Avancement de l’intervention'}, STEPS.filter(([k]) => !(skipVisit && ['dispatched', 'en_route', 'on_site'].includes(k))).map(([k, label]) => h('li', {key: k, className: ORDER[k] < step || (k === 'resolved' && step === 5) ? 'is-done' : ORDER[k] === step ? 'is-now' : ''}, label))),
      i && h('button', {type: 'button', className: 'sm-link', onClick: () => onOpenIncident(i.id)}, 'Ouvrir le dossier de la panne'),
      segment.alarm === 'UPSTREAM' && h('div', {className: 'sm-upstream'},
        h('p', null, 'Ce quartier dépend de l’équipement central de ' + (commune?.name || 'la commune') + ', en panne. Il reviendra en même temps que lui.'),
        central && h('button', {type: 'button', className: 'sm-link', onClick: () => onPick(central.id)}, 'Voir le poteau ' + NAMES[central.id])),
      !locked && h('fieldset', {className: 'sm-faults', disabled: busy},
        h('legend', null, 'Choisir une panne'),
        FAULTS.map(f => h('label', {key: f.id, className: 'sm-fault' + (fault === f.id ? ' is-on' : '')},
          h('input', {type: 'radio', name: 'sm-fault', value: f.id, checked: fault === f.id, onChange: () => setFault(f.id)}),
          h('svg', {viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true}, h('path', {d: f.icon})),
          h('span', null, h('b', null, f.title), h('small', null, f.text))))),
      error && h('p', {className: 'sm-error', role: 'alert'}, error),
      segment.alarm !== 'UPSTREAM' && h('div', {className: 'sm-actions' + (live ? ' is-single' : '')},
        !live && h('button', {type: 'button', className: 'sm-go', disabled: busy, onClick: () => onSimulate(segment.id, fault)}, busy === 'simulate' ? 'Panne en cours de création…' : 'Simuler la panne'),
        h('button', {type: 'button', className: 'sm-restore', disabled: busy || (st.tone === 'calm' && segment.online === segment.total), onClick: () => onRestore(segment.id)}, busy === 'restore' ? 'Rétablissement…' : live ? (segment.alarm === 'OLT_DOWN' ? 'Remettre la commune en état' : 'Remettre le quartier en état') : 'Rétablir')));
  }

  function View({data, api: call, onChanged, onOpenIncident}) {
    const narrow = useNarrow(), [rot, setRot] = useState(-18), rotation = useEased(rot), [zoom, setZoom] = useState(1), [pan, setPan] = useState([0, 0]);
    const [selected, setSelected] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
    const drag = useRef(null), card = useRef(null), segments = data?.segments || [], incidents = data?.incidents || [];
    const ratio = narrow ? 1.2 : 1.62, z = narrow ? zoom * 1.12 : zoom * 1.1;
    const seg = segments.find(s => s.id === selected);
    async function run(kind, segment, scenario) {
      setBusy(kind); setError('');
      try { await call('/noc/action', 'POST', {type: 'simulate', segment, scenario}); await onChanged?.(); if (narrow) card.current?.scrollIntoView({behavior: 'smooth', block: 'start'}); }
      catch (e) { setError(e.message || 'L’action n’a pas abouti.'); }
      finally { setBusy(''); }
    }
    // Étapes du dossier lancées depuis le panneau ; le serveur vérifie les droits à chaque fois.
    async function step(body, opts = {}) {
      setBusy('step'); setError('');
      try {
        if (opts.restore) { await call('/noc/action', 'POST', {type: 'simulate', segment: opts.restore, scenario: 'normal'}); const fresh = (await call('/noc/overview')).incidents.find(x => x.id === body.id); if (fresh) body = {...body, version: fresh.version}; }
        await call('/noc/action', 'POST', body); await onChanged?.();
      } catch (e) { setError(e.message || 'L’action n’a pas abouti.'); await onChanged?.(); }
      finally { setBusy(''); }
    }
    // Glisser pour déplacer la maquette ; les boutons tournent et zooment.
    const down = e => { if (e.target.closest('button')) return; drag.current = {x: e.clientX, y: e.clientY, pan, w: e.currentTarget.getBoundingClientRect().width}; e.currentTarget.setPointerCapture?.(e.pointerId); };
    const move = e => { const d = drag.current; if (!d) return; const k = 1000 / z / d.w; setPan([d.pan[0] - (e.clientX - d.x) * k, d.pan[1] - (e.clientY - d.y) * k]); };
    const up = () => { drag.current = null; };
    const pick = id => { setSelected(id); setError(''); if (narrow) { const p = view(rot).at(G.project(G.SEGMENTS[id].at)), base = frame(rot, z, [0, 0], ratio); setPan([p[0] - (base[0] + base[2] / 2), p[1] - (base[1] + base[3] / 2) + 30]); setTimeout(() => root.document?.querySelector('.sm-panel')?.scrollIntoView({behavior: 'smooth', block: 'start'}), 60); } };
    const touched = segments.filter(s => ['down', 'warn'].includes(stateOf(s, incidents).tone)).length;
    return h('div', {className: 'sm' + (seg ? ' has-panel' : '')},
      h('section', {className: 'sm-card', ref: card},
        h('header', {className: 'sm-head'},
          h('div', null, h('h2', null, 'Abidjan en maquette'), h('p', null, touched ? touched + ' quartier' + (touched > 1 ? 's' : '') + ' en alerte. Touchez un poteau pour agir.' : 'Touchez un poteau pour simuler une panne dans son quartier.')),
          h('div', {className: 'sm-tools', role: 'group', 'aria-label': 'Orientation de la maquette'},
            h('button', {type: 'button', onClick: () => setRot(r => r - 30), 'aria-label': 'Tourner à gauche'}, '↺'),
            h('button', {type: 'button', onClick: () => setRot(r => r + 30), 'aria-label': 'Tourner à droite'}, '↻'),
            h('button', {type: 'button', onClick: () => setZoom(v => Math.min(3, v * 1.25)), 'aria-label': 'Zoomer'}, '+'),
            h('button', {type: 'button', onClick: () => setZoom(v => Math.max(.7, v / 1.25)), 'aria-label': 'Dézoomer'}, '−'),
            h('button', {type: 'button', onClick: () => { setRot(-18); setZoom(1); setPan([0, 0]); }, 'aria-label': 'Revenir à la vue de départ'}, '⌂'))),
        h('div', {className: 'sm-viewport', onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up},
          h(Scene, {segments, incidents, rotation, zoom: z, pan, ratio, selected, onPick: pick, compact: narrow})),
        narrow && h('div', {className: 'sm-chips', role: 'group', 'aria-label': 'Choisir un poteau'}, Object.keys(NAMES).map(id => { const tone = stateOf(segments.find(x => x.id === id) || {}, incidents).tone; return h('button', {key: id, type: 'button', className: 'sm-chip is-' + tone + (selected === id ? ' is-selected' : ''), 'aria-pressed': selected === id, onClick: () => pick(id)}, h('i', {'aria-hidden': true}), NAMES[id]); })),
        h('ul', {className: 'sm-legend'}, [['calm', 'Tout va bien'], ['warn', 'Débit en baisse'], ['down', 'Panne en cours'], ['ok', 'Réparé'], ['data', 'Données qui circulent']].map(([k, t]) => h('li', {key: k}, h('i', {className: 'is-' + k, 'aria-hidden': true}), t)))),
      seg && h(Panel, {segment: seg, incidents, data, busy, error, onStep: step, onSimulate: (id, f) => run('simulate', id, f), onRestore: id => run('restore', id, 'normal'), onClose: () => setSelected(null), onOpenIncident, onPick: setSelected}));
  }

  root.FGSim3D = {...api, View};
})(typeof window !== 'undefined' ? window : globalThis);
