/* Fibre Guardian · visual explanations. React and THREE are local browser globals.
 * These diagrams illustrate the current diagnostic; they do not measure a network. */
(function (root) {
  'use strict';
  const React = root.React;
  if (!React) return;
  const h = React.createElement;
  const palette = { lime: '#dfff79', dark: '#18211e', sage: '#dce5df', muted: '#91a499', white: '#f9fbf7', orange: '#e99647', red: '#d65d50' };
  const rooms = ['Salon', 'Chambre', 'Cuisine', 'Chambre d’enfant', 'Couloir central'];
  const roomIndex = { salon: 0, chambre: 1, cuisine: 2, enfant: 3, centre: 4 };
  const names = { sain: 'Ligne saine', rupture: 'Rupture optique', attenuation: 'Signal optique affaibli', wifi: 'Couverture Wi-Fi faible', amont: 'Incident en amont', congestion: 'Réseau chargé', partage: 'Nombre élevé d’appareils', anomalie: 'Anomalie à confirmer' };
  const bad = cls => cls === 'rupture' || cls === 'amont';
  const faultColor = cls => cls === 'sain' ? palette.lime : bad(cls) ? palette.red : palette.orange;
  const faultSegment = cls => ({ rupture: 1, attenuation: 1, wifi: 3, partage: 3, amont: 0, congestion: 0 })[cls];
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let styleReady = false;
  // One GPU context is sufficient for this application. Additional mounted scenes use SVG.
  let rendererLease = null;

  function installStyle() {
    if (styleReady) return;
    const style = document.createElement('style');
    style.textContent = `.fg-scene{position:relative;isolation:isolate;width:100%;min-height:250px;border-radius:25px;overflow:hidden;background:radial-gradient(ellipse at 55% 42%,#f1f5ec 0%,#e4ebe3 56%,#d9e3dc 100%);color:#25312a}.fg-scene__stage{position:absolute;inset:0 0 43px}.fg-scene__stage canvas,.fg-scene__fallback{display:block;width:100%;height:100%;min-height:180px}.fg-scene__fallback{position:absolute;inset:0 0 43px;height:calc(100% - 43px)}.fg-scene__fallback text{font-family:inherit}.fg-scene[data-kind=path]{min-height:230px}.fg-scene[data-kind=city]{min-height:290px}.fg-scene[data-kind=house]{min-height:290px}.fg-scene__top{position:absolute;top:17px;left:17px;right:17px;display:flex;gap:8px;align-items:center;justify-content:space-between;pointer-events:none}.fg-scene__eyebrow{font:600 10px/1.3 inherit;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#607568}.fg-scene__mode{font-size:10px;padding:5px 8px;border:1px solid #b9c6bc80;border-radius:99px;background:#ffffff6e;color:#5d7063}.fg-scene__legend{position:absolute;left:17px;right:17px;bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:10px;line-height:1.4;color:#64756a}.fg-scene__status{display:flex;align-items:center;gap:6px;color:#2d3a31;font-weight:600}.fg-scene__dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none;box-shadow:0 0 0 3px #ffffff77}.fg-scene__labels{position:absolute;bottom:49px;left:2%;right:2%;display:grid;grid-template-columns:repeat(5,1fr);font-size:10px;line-height:1.3;text-align:center;color:#445448;gap:4px}.fg-scene__labels span{padding:5px 0}.fg-scene__labels [data-fault=true]{color:#99483b;font-weight:700}.fg-scene__note{position:absolute;right:18px;bottom:54px;max-width:140px;text-align:right;font-size:10px;line-height:1.5;color:#607265;pointer-events:none}.fg-scene__note strong{display:block;color:#283e2b;font-size:12px;font-weight:600}.fg-scene__sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:480px){.fg-scene{min-height:245px}.fg-scene__legend{font-size:9px}.fg-scene__note{max-width:105px;font-size:9px}.fg-scene__labels{font-size:9px}}`;
    document.head.appendChild(style);
    styleReady = true;
  }

  function description(kind, cls, room, repeater, affected) {
    const state = names[cls] || names.anomalie;
    if (kind === 'path') {
      const where = { rupture: 'sur le trajet fibre, entre l’armoire et le logement', attenuation: 'sur le trajet fibre, entre l’armoire et le logement', amont: 'en amont de l’armoire de rue', congestion: 'en amont de l’armoire de rue', wifi: 'entre la box et le téléphone', partage: 'du côté des appareils du domicile' }[cls];
      return 'Trajet de connexion : central, armoire de rue, logement, box, téléphone. ' + state + (where ? ' : zone suspectée ' + where + '.' : cls === 'sain' ? ' : aucune zone en défaut détectée.' : ' : localisation à confirmer.');
    }
    if (kind === 'house') return 'Plan de couverture illustratif, sans mesure radio réelle. Emplacement de la box : ' + rooms[room] + '. Les quatre pièces sont le salon, la chambre, la cuisine et la chambre d’enfant. Répéteur ' + (repeater ? 'activé dans la simulation.' : 'désactivé dans la simulation.') + ' Les anneaux montrent la source du signal, pas une couverture calculée.';
    if (kind === 'city') return 'Vue schématique du réseau, sans géolocalisation réelle. ' + affected + ' ligne' + (affected === 1 ? '' : 's') + ' signalée' + (affected === 1 ? '' : 's') + ' comme affectée' + (affected === 1 ? '' : 's') + ' dans la simulation. Les bâtiments représentent des groupes de lignes, pas des abonnés réels.';
    return 'Modèle illustratif de la box. ' + state + '. Voyant PON ' + (cls === 'rupture' ? 'éteint et voyant LOS rouge' : 'vert et voyant LOS éteint') + ', voyant Wi-Fi ' + (cls === 'wifi' || cls === 'partage' ? 'orange' : 'vert') + '. Les voyants sont déduits de la simulation et ne proviennent pas d’une caméra.';
  }

  function svgFallback(kind, cls, room, repeater, affected) {
    const c = faultColor(cls), line = palette.dark;
    const rect = (x, y, width, height, fill, rx, extra) => h('rect', Object.assign({ x, y, width, height, fill, rx: rx || 0 }, extra));
    const text = (x, y, value, extra) => h('text', Object.assign({ x, y, fill: '#53675a', fontSize: 11, textAnchor: 'middle' }, extra), value);
    const path = (d, stroke, width, extra) => h('path', Object.assign({ d, stroke, strokeWidth: width || 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }, extra));
    const circle = (cx, cy, r, fill, extra) => h('circle', Object.assign({ cx, cy, r, fill }, extra));
    let content;
    if (kind === 'path') {
      content = [rect(30, 111, 440, 42, '#cfdbd0', 21), ...[0, 1, 2, 3].map(i => path('M' + (65 + i * 92) + ' 116h70', faultSegment(cls) === i ? c : '#9aba65', faultSegment(cls) === i ? 5 : 3, { key: 'c' + i, strokeDasharray: faultSegment(cls) === i && bad(cls) ? '4 8' : undefined })), ...[0, 1, 2, 3, 4].map(i => h('g', { key: 'n' + i }, rect(42 + i * 92, 75, 44, i === 0 ? 57 : 44, i === 3 ? '#fff' : line, 8), i === 2 && path('M222 79l24-18 24 18', line, 9), i === 4 && rect(416, 81, 28, 34, palette.lime, 3), circle(64 + i * 92, i === 0 ? 89 : 92, 3, i === 4 ? line : palette.lime)))];
    } else if (kind === 'house') {
      const p = [[160, 99], [339, 99], [160, 176], [339, 176], [250, 137]][room];
      content = [rect(57, 45, 390, 163, '#c9d7c9', 14), rect(70, 58, 172, 65, '#eef3e9', 4), rect(258, 58, 175, 65, '#e6edde', 4), rect(70, 138, 172, 57, '#e2ebd7', 4), rect(258, 138, 175, 57, '#edf1e5', 4), ...[31, 54, 76].map(r => circle(p[0], p[1], r, 'none', { key: r, stroke: '#b8cb85', strokeWidth: 2, strokeDasharray: r === 76 ? '4 5' : undefined, opacity: .7 })), rect(p[0] - 16, p[1] - 10, 32, 21, line, 6), circle(p[0] + 9, p[1] + 4, 2, palette.lime), text(158, 77, 'Salon'), text(339, 77, 'Chambre'), text(158, 153, 'Cuisine'), text(339, 153, 'Chambre d’enfant'), repeater && h('g', null, circle(290, 144, 40, 'none', { stroke: '#9cb54e', strokeWidth: 2 }), rect(282, 136, 16, 18, palette.lime, 4)), rect(398, 162, 13, 23, line, 4), rect(401, 166, 7, 13, palette.lime, 1)];
    } else if (kind === 'city') {
      content = [path('M50 165L250 215 447 126 249 76Z', '#b6c7bc', 22), path('M146 189l200-90M150 101l201 70', '#baccc0', 10), ...Array.from({ length: 10 }, (_, i) => {
        const x = 80 + (i % 5) * 78, y = 92 + Math.floor(i / 5) * 66, isAffected = affected > 0 && i < Math.min(5, Math.ceil(affected / 4));
        return h('g', { key: i }, path('M250 208L' + (x + 13) + ' ' + (y + 22), isAffected ? c : '#a2b578', 2, { opacity: .65 }), rect(x, y - 13 - i % 3 * 9, 34, 42 + i % 3 * 9, isAffected ? c : '#f6f8ef', 4), rect(x + 8, y - 5, 5, 7, '#60796a', 1), rect(x + 21, y - 5, 5, 7, '#60796a', 1));
      }), circle(250, 207, 12, line), circle(250, 207, 4, palette.lime)];
    } else {
      content = [h('ellipse', { cx: 247, cy: 195, rx: 151, ry: 28, fill: '#b9c9b8', opacity: .6 }), rect(110, 180, 280, 22, '#c0ceb9', 12), path('M153 115l-13-62M347 115l13-62', line, 9), rect(115, 102, 270, 89, '#fdfef8', 24, { stroke: '#c9d4c7', strokeWidth: 1 }), rect(119, 157, 262, 26, '#e5ecde', 10), ...Array.from({ length: 11 }, (_, i) => rect(187 + i * 12, 120, 5, 15, '#d8e0d2', 2, { key: i })), ...[palette.lime, cls === 'rupture' ? '#647365' : palette.lime, cls === 'rupture' ? palette.red : '#647365', palette.lime, cls === 'wifi' || cls === 'partage' ? palette.orange : palette.lime].map((col, i) => h('g', { key: i }, circle(198 + i * 26, 165, 3, col), text(198 + i * 26, 178, ['PWR', 'PON', 'LOS', 'LAN', 'WLAN'][i], { fontSize: 6 }))), path('M218 79q32-27 64 0M229 88q21-18 42 0M241 96q9-8 18 0', cls === 'wifi' ? palette.orange : '#92aa77', 3), text(251, 146, 'FIBRE GUARDIAN', { fontSize: 7, letterSpacing: 2, fill: '#82927c' })];
    }
    return h('svg', { className: 'fg-scene__fallback', viewBox: '0 0 500 250', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' }, content);
  }

  function makeWorld(THREE, kind, cls, room, repeater, affected) {
    const scene = new THREE.Scene(), moving = [], disposables = [], equipment = {}, floors = [], focus = new THREE.Vector3(0, .3, 0);
    const mat = (color, props) => { const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .66, metalness: .04 }, props)); disposables.push(m); return m; };
    const white = mat(palette.white), dark = mat(palette.dark), sage = mat('#cbd8c9'), lime = mat(palette.lime), muted = mat('#aebfae'), glass = mat('#5b7867', { roughness: .25, metalness: .22 }), warn = mat(faultColor(cls));
    const lightMat = color => mat(color, { emissive: color, emissiveIntensity: .7 });
    const lit = lightMat(palette.lime), errorLight = lightMat(faultColor(cls));
    const add = (geometry, material, x, y, z, parent) => { disposables.push(geometry); const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x || 0, y || 0, z || 0); mesh.castShadow = true; mesh.receiveShadow = true; (parent || scene).add(mesh); return mesh; };
    function rounded(w, height, d, radius, material, x, y, z, parent) {
      const r = Math.min(radius, w / 2, d / 2), s = new THREE.Shape(), a = -w / 2, b = -d / 2;
      s.moveTo(a + r, b); s.lineTo(a + w - r, b); s.quadraticCurveTo(a + w, b, a + w, b + r); s.lineTo(a + w, b + d - r); s.quadraticCurveTo(a + w, b + d, a + w - r, b + d); s.lineTo(a + r, b + d); s.quadraticCurveTo(a, b + d, a, b + d - r); s.lineTo(a, b + r); s.quadraticCurveTo(a, b, a + r, b);
      const geo = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .018, bevelThickness: .018, curveSegments: 8 });
      const mesh = add(geo, material, x, y, z, parent); mesh.rotation.x = -Math.PI / 2; return mesh;
    }
    function box(w, height, d, material, x, y, z, parent) { return add(new THREE.BoxGeometry(w, height, d), material, x, y, z, parent); }
    function sphere(r, material, x, y, z, parent) { return add(new THREE.SphereGeometry(r, 16, 12), material, x, y, z, parent); }
    function wire(a, b, material, thickness) {
      const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), len = start.distanceTo(end), mesh = add(new THREE.CylinderGeometry(thickness || .025, thickness || .025, len, 8), material);
      mesh.position.copy(start.clone().lerp(end, .5)); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize()); return mesh;
    }
    function route(a, b, isFault, cut) {
      if (cut) { const midA = a.map((v, i) => v + (b[i] - v) * .44), midB = a.map((v, i) => v + (b[i] - v) * .56); wire(a, midA, errorLight, .037); wire(midB, b, errorLight, .037); }
      else { wire(a, b, isFault ? warn : muted, .029); const dot = sphere(.065, isFault ? errorLight : lit, ...a); moving.push({ dot, a: new THREE.Vector3(...a), b: new THREE.Vector3(...b), speed: isFault ? .16 : .35, phase: moving.length * .2 }); }
    }
    function home(x, z, scale, damaged) {
      const g = new THREE.Group(); g.position.set(x, .16, z); g.scale.setScalar(scale || 1); scene.add(g);
      rounded(.92, .1, .82, .1, sage, 0, 0, 0, g); box(.7, .55, .6, damaged ? warn : white, 0, .37, 0, g);
      const roof = add(new THREE.ConeGeometry(.59, .4, 4), dark, 0, .83, 0, g); roof.rotation.y = Math.PI / 4;
      box(.15, .26, .016, glass, -.14, .29, .31, g); box(.15, .14, .016, glass, .17, .43, .31, g); return g;
    }
    function phone(x, y, z, scale, warning) {
      const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(scale || 1); scene.add(g);
      box(.36, .7, .07, dark, 0, .35, 0, g); box(.29, .53, .012, warning ? warn : lime, 0, .38, .043, g); sphere(.023, white, 0, .07, .043, g); return g;
    }
    function router(x, y, z, scale, detailed) {
      const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(scale || 1); scene.add(g);
      rounded(3.45, .17, 2.1, .31, muted, 0, .12, 0, g); rounded(3.5, .35, 2.12, .32, white, 0, .28, 0, g); rounded(3.1, .015, 1.72, .22, white, 0, .645, 0, g);
      for (let i = 0; i < 13; i++) rounded(.033, .012, .54, .012, muted, -.66 + i * .11, .669, -.18, g);
      [-1.46, 1.46].forEach((xPos, i) => { const antenna = add(new THREE.CylinderGeometry(.049, .067, 1.78, 12), dark, xPos, 1.38, -.7, g); antenna.rotation.z = i === 0 ? .13 : -.13; sphere(.073, dark, xPos, .52, -.7, g); });
      const states = [lit, cls === 'rupture' ? dark : lit, cls === 'rupture' ? errorLight : dark, lit, cls === 'wifi' || cls === 'partage' ? errorLight : lit];
      states.forEach((m, i) => sphere(.043, m, -.52 + i * .26, .425, 1.071, g));
      if (detailed) {
        // Deliberately only illustrative arcs: they never imply measured radio coverage.
        [1.4, 1.8, 2.2].forEach((r, i) => { const m = mat(cls === 'wifi' ? palette.orange : '#9ab184', { transparent: true, opacity: .45 - i * .08 }); const arc = add(new THREE.TorusGeometry(r, .014, 6, 60, Math.PI * 1.3), m, 0, .18, .1, g); arc.rotation.set(-Math.PI / 2, 0, Math.PI * .85); });
        const badge = rounded(.52, .008, .12, .04, sage, .01, .671, .53, g); badge.userData.decorative = true;
      }
      return g;
    }
    scene.add(new THREE.HemisphereLight('#ffffff', '#82987f', 2.2));
    const key = new THREE.DirectionalLight('#fffbe8', 3.5); key.position.set(-4, 8, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -7; key.shadow.camera.right = 7; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6; key.shadow.normalBias = .045; key.shadow.bias = -.0003; key.shadow.radius = 3; scene.add(key);
    const fill = new THREE.DirectionalLight('#e6f2df', 1.1); fill.position.set(5, 3, -5); scene.add(fill);
    let extent = 3.6, cameraPos = [5.4, 5.1, 7];
    if (kind === 'router') {
      rounded(5.35, .19, 3.65, .6, sage, 0, -.09, 0);
      router(0, .12, 0, 1, true);
      focus.set(0, .6, 0); extent = 3.1;
    } else if (kind === 'path') {
      cameraPos = [0, 5.6, 9]; extent = 5.4; focus.set(0, .35, 0);
      rounded(10.3, .15, 2.3, .4, sage, 0, -.12, 0);
      const xs = [-4.1, -2.05, 0, 2.05, 4.1];
      xs.slice(0, 4).forEach((x, i) => route([x + .45, .12, .25], [xs[i + 1] - .43, .12, .25], faultSegment(cls) === i, cls === 'rupture' && i === 1));
      rounded(1.15, .1, 1, .12, muted, xs[0], .03, 0); box(.82, 1.4, .6, dark, xs[0], .8, 0);
      for (let i = 0; i < 4; i++) { box(.63, .2, .03, glass, xs[0], .37 + i * .29, .32); sphere(.028, faultSegment(cls) === 0 ? errorLight : lit, xs[0] + .22, .37 + i * .29, .346); }
      rounded(.82, .12, .76, .1, muted, xs[1], .02, 0); box(.6, .95, .5, white, xs[1], .58, 0); box(.02, .66, .014, muted, xs[1], .57, .26); sphere(.035, lit, xs[1] + .15, .83, .26);
      home(xs[2], 0, .88, cls === 'rupture'); router(xs[3], .17, 0, .3, false); phone(xs[4], .15, .02, 1.12, cls === 'wifi');
    } else if (kind === 'house') {
      cameraPos = [6.5, 8.5, 9]; extent = 4.1; focus.set(0, 0, 0);
      rounded(6.9, .2, 4.5, .3, sage, 0, -.15, 0);
      [[-1.6,-1.03],[1.6,-1.03],[-1.6,1.03],[1.6,1.03]].forEach(([x,z])=>{const material=mat('#edf1e5');floors.push(material);box(2.82,.04,1.75,material,x,.075,z);});
      // Roofless plan: openings remain visible and the phone is not hidden behind walls.
      box(6.2, .52, .1, white, 0, .35, -2); box(.1, .52, 4, white, -3.15, .35, 0); box(.1, .44, 1.58, white, 0, .3, -1.2); box(.1, .44, 1.58, white, 0, .3, 1.2); box(2.5, .44, .1, white, -1.9, .3, 0); box(2.5, .44, .1, white, 1.9, .3, 0);
      // Sofa, kitchen units and two beds identify the same four rooms as the 2D plan.
      rounded(1.55, .27, .66, .1, muted, -2, .18, -.93); box(1.55, .3, .17, muted, -2, .48, -1.16); rounded(.82, .16, .5, .12, white, -1.8, .17, .19);
      rounded(1.1, .24, 1.35, .1, muted, 1.72, .16, -1.16); rounded(.98, .11, 1.17, .1, white, 1.72, .4, -1.16); rounded(.7, .08, .29, .06, sage, 1.72, .52, -1.56);
      box(.55, .53, 1.34, white, -2.72, .4, 1.15); box(.59, .035, 1.38, dark, -2.72, .68, 1.15); box(.4, .015, .36, glass, -2.72, .71, .81);
      rounded(.93, .25, 1.4, .1, muted, 1.64, .16, 1.02); rounded(.78, .1, 1.21, .1, white, 1.64, .39, 1.02); rounded(.61, .09, .28, .06, sage, 1.64, .5, .59);
      const positions = [[-1.6,-1.03],[1.6,-1.03],[-1.6,1.03],[1.6,1.03],[0,0]], p = positions[room];
      equipment.box = new THREE.Group(); scene.add(equipment.box);
      const device=router(0,.1,0,.25,false); equipment.box.add(device);
      equipment.box.position.set(p[0],0,p[1]);
      phone(2.74, .15, 1.46, .64, cls === 'wifi' && !repeater);
      [.75,1.3,1.85].forEach((r,i)=>{const ring=add(new THREE.TorusGeometry(r,.017,6,72),mat('#91b35c',{transparent:true,opacity:.38-i*.08,depthWrite:false}),0,.12,0,equipment.box);ring.rotation.x=-Math.PI/2;ring.userData.decorative=true;});
      equipment.repeater=new THREE.Group();scene.add(equipment.repeater);
      equipment.repeater.position.set(3.5*3.2/13,0,3.5*2.06/13);equipment.repeater.visible=repeater;
      rounded(.28,.42,.28,.07,lime,0,.16,0,equipment.repeater);sphere(.033,lit,0,.47,.16,equipment.repeater);
      const ring=add(new THREE.TorusGeometry(1.35,.02,6,72),mat('#9db556',{transparent:true,opacity:.65,depthWrite:false}),0,.14,0,equipment.repeater);ring.rotation.x=-Math.PI/2;ring.userData.decorative=true;
    } else {
      cameraPos = [7, 8, 9]; extent = 4.3; focus.set(0, .2, 0);
      rounded(7, .2, 5.25, .35, sage, 0, -.12, 0);
      box(6.8, .018, .37, muted, 0, .101, 0); box(.34, .018, 5.04, muted, -.03, .101, 0);
      const count = affected > 0 ? Math.min(5, Math.max(1, Math.ceil(affected / 4))) : 0;
      for (let i = 0; i < 12; i++) {
        const x = (i % 6 - 2.5) * 1.01, z = i < 6 ? -1.2 : 1.2, height = [.65, 1.25, .8, 1.7, .9, .7][i % 6], damaged = i < count;
        rounded(.79, .08, .85, .1, muted, x, .13, z); box(.57, height, .63, damaged ? warn : white, x, .22 + height / 2, z);
        for (let row = 0; row < Math.floor(height / .25); row++) for (let col = 0; col < 2; col++) box(.095, .105, .012, dark, x - .13 + col * .26, .36 + row * .24, z + .321);
        route([x, .17, z < 0 ? -.75 : .75], [x, .17, z < 0 ? -.2 : .2], damaged, damaged && cls === 'rupture');
      }
      rounded(.64, .28, .68, .12, dark, 0, .13, 0); sphere(.065, lit, 0, .45, 0);
      [-2.8, 2.8].forEach(x => { wire([x, .2, 0], [0, .2, 0], muted, .029); });
    }
    // The broad invisible receiving plane produces soft grounded contact shadows.
    const shadow = new THREE.ShadowMaterial({ color: '#426045', opacity: .12 }); disposables.push(shadow);
    const ground = add(new THREE.PlaneGeometry(40, 40), shadow, 0, -.13, 0); ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
    const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, .1, 100); camera.position.set(...cameraPos); camera.lookAt(focus);
    return { scene, camera, extent, moving, equipment, floors, dispose() { disposables.forEach(item => item.dispose()); scene.clear(); } };
  }

  function FGScene(props) {
    const kind = ['router', 'path', 'house', 'city'].includes(props.kind) ? props.kind : 'router';
    const cls = names[props.cls] ? props.cls : 'sain';
    const room = Object.prototype.hasOwnProperty.call(roomIndex, props.room) ? roomIndex[props.room] : Math.max(0, Math.min(4, Math.round(Number(props.room) || 0))), repeater = !!props.repeater;
    const affected = Math.max(0, Math.round(Number(props.affected) || 0));
    const enabled = props.enabled !== false;
    const host = React.useRef(null), [live, setLive] = React.useState(false), [motionReduced, setMotionReduced] = React.useState(reduced);
    const id = React.useId ? React.useId() : 'fg-scene-' + kind;
    const titleId = id + '-description';
    React.useEffect(() => { installStyle(); const media = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)'); if (!media) return; const change = () => setMotionReduced(media.matches); if (media.addEventListener) media.addEventListener('change', change); return () => { if (media.removeEventListener) media.removeEventListener('change', change); }; }, []);
    React.useEffect(() => {
      setLive(false);
      if (!enabled || motionReduced || !root.THREE || !host.current || rendererLease) return;
      const container = host.current, THREE = root.THREE;
      let renderer, world, observer, intersection, frame = 0, dead = false, inView = true, seconds = 0, previous = 0;
      const lease = {}; rendererLease = lease;
      const release = () => { if (rendererLease === lease) rendererLease = null; };
      function resize() {
        if (!renderer || !world || dead) return;
        const w = container.clientWidth, height = container.clientHeight;
        if (!w || !height) return;
        renderer.setSize(w, height, false);
        const aspect = w / height, halfWidth = world.extent, halfHeight = halfWidth / aspect;
        // Keep the diagram readable in narrow cards rather than clipping its platform.
        const minHeight = kind === 'path' ? 1.8 : kind === 'router' ? 1.75 : 2.6;
        const camHeight = Math.max(minHeight, halfHeight), camWidth = Math.max(halfWidth, minHeight * aspect);
        Object.assign(world.camera, { left: -camWidth, right: camWidth, top: camHeight, bottom: -camHeight }); world.camera.updateProjectionMatrix();
        renderer.render(world.scene, world.camera);
      }
      function tick(stamp) {
        frame = 0;
        if (dead || document.hidden || !inView) { previous = 0; return; }
        if (previous) seconds += Math.min((stamp - previous) / 1000, .1);
        previous = stamp;
        world.moving.forEach(item => { const t = (seconds * item.speed + item.phase) % 1; item.dot.position.copy(item.a).lerp(item.b, t); });
        renderer.render(world.scene, world.camera);
        frame = root.requestAnimationFrame(tick);
      }
      function resume() { if (dead) return; if (document.hidden || !inView) { if (frame) root.cancelAnimationFrame(frame); frame = 0; previous = 0; } else if (!frame) frame = root.requestAnimationFrame(tick); }
      function lost(event) { event.preventDefault(); cleanup(); setLive(false); }
      function cleanup() {
        if (dead) return; dead = true;
        if (frame) root.cancelAnimationFrame(frame);
        if (observer) observer.disconnect(); if (intersection) intersection.disconnect();
        document.removeEventListener('visibilitychange', resume); root.removeEventListener('resize', resize);
        if (renderer) { renderer.domElement.removeEventListener('webglcontextlost', lost); renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss(); renderer.domElement.remove(); }
        if (world) world.dispose(); release();
      }
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 1.65)); renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
        renderer.domElement.setAttribute('aria-hidden', 'true'); renderer.domElement.addEventListener('webglcontextlost', lost);
        container.appendChild(renderer.domElement); world = makeWorld(THREE, kind, cls, room, repeater, affected);
        if (root.ResizeObserver) { observer = new ResizeObserver(resize); observer.observe(container); } else root.addEventListener('resize', resize);
        if (root.IntersectionObserver) { intersection = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; resume(); }, { threshold: .01 }); intersection.observe(container); }
        document.addEventListener('visibilitychange', resume); resize(); setLive(true); resume();
      } catch (error) { cleanup(); setLive(false); }
      return cleanup;
    }, [kind, cls, room, repeater, affected, enabled, motionReduced]);
    const label = { router: 'Votre box, expliquée', path: 'Du réseau à votre téléphone', house: 'La connexion chez vous', city: 'Vue réseau schématique' }[kind];
    const detail = description(kind, cls, room, repeater, affected);
    const status = kind === 'city' ? affected + ' ligne' + (affected === 1 ? '' : 's') + ' affectée' + (affected === 1 ? '' : 's') : kind === 'house' ? 'Box · ' + rooms[room] : names[cls];
    const foot = kind === 'house' ? 'Couverture illustrative' : kind === 'city' ? 'Groupes fictifs · pas une carte GPS' : kind === 'path' ? 'Localisation indicative' : 'Voyants simulés';
    return h('div', { className: 'fg-scene', 'data-kind': kind, role: 'img', 'aria-labelledby': titleId },
      h('span', { className: 'fg-scene__sr', id: titleId }, detail),
      h('div', { className: 'fg-scene__stage', ref: host, 'aria-hidden': 'true' }),
      !live && svgFallback(kind, cls, room, repeater, affected),
      h('div', { className: 'fg-scene__top', 'aria-hidden': 'true' }, h('span', { className: 'fg-scene__eyebrow' }, label), h('span', { className: 'fg-scene__mode' }, live ? 'Vue 3D' : 'Schéma 2D')),
      kind === 'path' && h('div', { className: 'fg-scene__labels', 'aria-hidden': 'true' }, ['Central', 'Armoire', 'Logement', 'Box', 'Téléphone'].map((v, i) => h('span', { key: v, 'data-fault': faultSegment(cls) === i || faultSegment(cls) + 1 === i }, v))),
      kind === 'house' && h('div', { className: 'fg-scene__note', 'aria-hidden': 'true' }, h('strong', null, rooms[room]), 'Répéteur ' + (repeater ? 'activé' : 'désactivé')),
      h('div', { className: 'fg-scene__legend', 'aria-hidden': 'true' }, h('span', { className: 'fg-scene__status' }, h('i', { className: 'fg-scene__dot', style: { background: kind === 'city' && affected === 0 ? '#93ab69' : cls === 'sain' ? '#93ab69' : faultColor(cls) } }), status), h('span', null, foot))
    );
  }
  FGScene.houseWorld = THREE => makeWorld(THREE, 'house', 'sain', 0, false, 0);
  FGScene.acquire = owner => { if(rendererLease)return false;rendererLease=owner;return true; };
  FGScene.release = owner => { if(rendererLease===owner)rendererLease=null; };
  root.FGScene = FGScene;
})(window);
