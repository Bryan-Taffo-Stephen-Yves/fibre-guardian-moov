'use strict';
// Régressions unitaires sans navigateur : helpers et gestionnaires du composant React.
// La vérification visuelle des chevauchements reste un contrôle navigateur distinct.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'guardian-map.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'guardian-map.css'), 'utf8');

function harness() {
  const values = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const React = {
    createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)}),
    useState(initial) {
      const index = stateIndex++;
      if (!(index in values)) values[index] = initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useRef(initial) {
      const index = refIndex++;
      return refs[index] || (refs[index] = {current: initial});
    },
    useEffect() {}
  };
  const context = {window: {}, React};
  vm.runInNewContext(source, context, {filename: 'guardian-map.js'});
  const api = context.window.FGMap;
  return {
    api,
    render(props) { stateIndex = 0; refIndex = 0; return api.View(props); }
  };
}
function all(tree) { return [tree, ...(tree.children || []).filter(item => item && typeof item === 'object').flatMap(all)]; }
function find(tree, predicate) {
  const result = all(tree).find(predicate);
  assert.ok(result, 'Élément attendu absent');
  return result;
}
const button = (tree, label) => find(tree, item => item.props['aria-label'] === label);
const canvas = tree => find(tree, item => item.props.className === 'g-map-canvas');
const view = tree => {
  const [x, y, width, height] = canvas(tree).props.viewBox.split(' ').map(Number);
  return {x, y, width, height};
};
function inView(point, box) {
  return point.x >= box.x - 1e-7 && point.x <= box.x + box.width + 1e-7 && point.y >= box.y - 1e-7 && point.y <= box.y + box.height + 1e-7;
}
function check(title, fn) { fn(); console.log('PASS ' + title); }

check('états réels du dossier, sans faux « Sur site » avant départ', () => {
  const states = {dispatched: 'Départ à venir', assigned: 'Départ à venir', on_site: 'Sur place', repairing: 'Réparation', verifying: 'Vérification', resolved: 'Terminée'};
  for (const [status, expected] of Object.entries(states)) {
    const {render} = harness();
    const tree = render({incident: {status, segment_id: 'YOP-07', position: {x: 105, y: 270, fromX: 105, fromY: 270, targetX: 120, targetY: 205, eta: null, technician: 'Awa'}}});
    const arrival = find(tree, item => item.props.className === 'g-map-arrival');
    assert.equal(arrival.children[0].children[0], expected);
    assert.equal(arrival.props['data-numeric'], false);
  }
});

check('ETA arrondie, arrivée non confirmée et ETA indisponible distinguées', () => {
  const {api} = harness();
  assert.equal(api.arrivalDetails('en_route', {eta: 61}).value, '2');
  assert.equal(api.arrivalDetails('en_route', {eta: 1}).value, '1');
  assert.equal(api.arrivalDetails('en_route', {eta: 0}).value, 'À confirmer');
  assert.equal(api.arrivalDetails('en_route', {eta: 0}).caption, 'Arrivée estimée atteinte');
  assert.equal(api.arrivalDetails('en_route', {eta: null}).caption, 'Estimation indisponible');
  assert.equal(api.arrivalDetails('unknown', {}).value, 'À confirmer');
});

check('flèches : le repère reste visible après zoom 2,5×', () => {
  const {api, render} = harness();
  const props = {selectedPoint: {lat: 5.35, lon: -4.06}, onPick(lat, lon) { props.selectedPoint = {lat, lon}; }};
  let tree = render(props);
  for (let i = 0; i < 3; i++) { button(tree, 'Agrandir la carte').props.onClick(); tree = render(props); }
  for (let i = 0; i < 17; i++) {
    canvas(tree).props.onKeyDown({key: 'ArrowRight', preventDefault() {}});
    tree = render(props);
    assert.ok(inView(api.toPoint(props.selectedPoint), view(tree)), 'Le repère est sorti du viewport');
  }
  assert.ok(Math.abs(api.toPoint(props.selectedPoint).x - 440) < 1e-7);
  for (let i = 0; i < 20; i++) {
    canvas(tree).props.onKeyDown({key: 'ArrowUp', shiftKey: true, preventDefault() {}});
    tree = render(props);
    assert.ok(inView(api.toPoint(props.selectedPoint), view(tree)), 'Le repère rapide est sorti du viewport');
  }
  assert.ok(Math.abs(api.toPoint(props.selectedPoint).y) < 1e-7);
});

check('focus clavier : un segment hors champ est amené dans la zone visible', () => {
  const {render} = harness();
  let selected;
  const props = {segments: [{id: 'YOP-07', zone: 'Yopougon', online: 20, total: 20}, {id: 'COC-03', zone: 'Cocody', online: 20, total: 20}], onSelect(id) { selected = id; }};
  let tree = render(props);
  for (let i = 0; i < 3; i++) { button(tree, 'Agrandir la carte').props.onClick(); tree = render(props); }
  for (const [id, zone, x, y] of [['YOP-07', 'Yopougon', 120, 205], ['COC-03', 'Cocody', 410, 100]]) {
    assert.ok(!inView({x, y}, view(tree)), 'Le scénario doit commencer hors champ');
    const label = `${id} · ${zone} · 20 sur 20 box en ligne`;
    button(tree, label).props.onFocus();
    tree = render(props);
    assert.ok(inView({x, y}, view(tree)));
    button(tree, label).props.onKeyDown({key: 'Enter', preventDefault() {}});
    assert.equal(selected, id);
  }
});

check('vue complète et couche réseau restent opérationnelles', () => {
  const {render} = harness();
  let tree = render({});
  button(tree, 'Agrandir la carte').props.onClick();
  tree = render({});
  find(tree, item => item.props.className === 'g-map-reset').props.onClick();
  tree = render({});
  assert.equal(canvas(tree).props.viewBox, '0 0 540 430');
  button(tree, 'Afficher le réseau').props.onClick();
  tree = render({});
  assert.equal(button(tree, 'Afficher le réseau').props['aria-pressed'], false);
});

check('coordonnées, bornes et recentrage sans mutation des données GPS', () => {
  const {api} = harness();
  for (const [x, y] of [[0, 0], [540, 430], [270, 215], [120, 205], [410, 100]]) {
    const roundTrip = api.toPoint(api.toCoordinates(x, y));
    assert.ok(Math.abs(roundTrip.x - x) < 1e-7 && Math.abs(roundTrip.y - y) < 1e-7);
  }
  assert.equal(api.toPoint({lat: '', lon: ''}), null);
  assert.equal(api.toPoint({lat: 5.45, lon: -4.05}), null);
  for (const zoom of [1, 1.5, 2, 2.5]) for (const center of [{x: 0, y: 0}, {x: 540, y: 430}]) {
    const box = api.viewportAt(zoom, center);
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 540 + 1e-7 && box.y + box.height <= 430 + 1e-7);
  }
});

check('indications essentielles : contraste ≥ 4,5 et taille non réduite à 8–9 px', () => {
  function luminance(hex) {
    const channels = hex.match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  }
  const color = css.match(/\.g-map-footer>small\{font:11px\/1\.5 Arial,sans-serif!important;color:#([a-f0-9]{6})!important/)[1];
  for (const background of ['fafbf7', 'ffffff', 'edf0e9']) assert.ok((luminance(background) + .05) / (luminance(color) + .05) >= 4.5);
  assert.ok(css.includes('.g-map-trip small,.g-map-location small{font-size:12px}'));
  assert.ok(!css.includes('.g-map-footer>small{font-size:8px!important}'));
  assert.ok(css.includes('.g-map .g-map-trip .g-map-arrival[data-numeric=false] strong{font-size:12px;'));
});
