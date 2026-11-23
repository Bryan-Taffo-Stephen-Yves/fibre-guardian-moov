'use strict';
// « Placer ma box » (écran Appareils) : le client mesure le signal Wi-Fi de chaque appareil là où la box est posée,
// déplace la box, mesure encore, puis Guardian recommande l'endroit où l'appareil le plus mal servi est le mieux servi.
// D'où vient le signal :
// - le PC Windows branché (« Brancher ce PC ») donne SA vraie force de signal à chaque mesure (netsh) ;
// - pour les autres appareils, seule la box connaît la force du signal (TR-069, AssociatedDevice.SignalStrength,
//   lue par Moov). Dans la démo, le simulateur la calcule à partir de la pièce de l'appareil et de la place de la box :
//   distance entre les pièces et nombre de murs traversés (affaiblissement classique du Wi-Fi en intérieur).
const {insist} = require('./pilot-model.cjs');

// Plan simple d'une maison : 3 pièces en haut, 3 en bas, chaque case fait 4 m sur 4 m.
const ROOMS = [
  {id: 'chambre', label: 'Chambre', dans: 'dans la chambre', col: 0, row: 0},
  {id: 'couloir', label: 'Couloir', dans: 'dans le couloir', col: 1, row: 0},
  {id: 'salon', label: 'Salon', dans: 'dans le salon', col: 2, row: 0},
  {id: 'enfants', label: 'Chambre des enfants', dans: 'dans la chambre des enfants', col: 0, row: 1},
  {id: 'bureau', label: 'Bureau', dans: 'dans le bureau', col: 1, row: 1},
  {id: 'cuisine', label: 'Cuisine', dans: 'dans la cuisine', col: 2, row: 1}
];
// Objet sans prototype : « toString », « constructor »… ne passent pas pour des pièces.
const ROOM = Object.assign(Object.create(null), Object.fromEntries(ROOMS.map(r => [r.id, r])));
const isRoom = id => typeof id === 'string' && Object.hasOwn(ROOM, id);
const CLOSE = 5; // sous 5 points d'écart (plus faible et moyenne), pas de vrai gagnant.
const MAX_SPOTS = 4;

function migrate(s) {
  s.db.exec('CREATE TABLE IF NOT EXISTS placement_box(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,at INTEGER NOT NULL)');
}
function load(s, uid) {
  const row = s.get('SELECT body FROM placement_box WHERE user_id=?', uid);
  let p = null;
  try { p = row ? JSON.parse(row.body) : null; } catch {}
  const rooms = Object.create(null);
  for (const [k, v] of Object.entries(p?.rooms || {})) if (isRoom(v)) rooms[k] = v;
  return {rooms, spots: (p?.spots || []).filter(x => isRoom(x?.spot)), boxAt: isRoom(p?.boxAt) ? p.boxAt : null};
}
function save(s, uid, p) {
  s.run('INSERT INTO placement_box VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body,at=excluded.at', uid, JSON.stringify(p), Date.now());
}

// Première idée de la pièce de chaque appareil, d'après son nom. Le client la corrige d'un geste.
function guessRoom(d) {
  const n = String(d.name || '');
  if (/TV|télé/i.test(n)) return 'salon';
  if (/PS5|console|xbox|kevin/i.test(n)) return 'enfants';
  if (/mac|pc|ordinateur|laptop/i.test(n)) return 'bureau';
  if (d.guest) return 'salon';
  return 'chambre';
}
// Les appareils à placer : ceux du Wi-Fi (non bloqués), et le PC branché s'il envoie son signal.
function devicesOf(st, p, pc) {
  const list = (st?.devices || []).filter(d => !d.blocked && d.present !== false)
    .map(d => ({id: d.id, name: d.name, room: Object.hasOwn(p.rooms, d.id) ? p.rooms[d.id] : guessRoom(d), real: false}));
  if (pc) list.push({id: 'pc', name: pc.computer ? 'PC ' + pc.computer : 'Ce PC', room: Object.hasOwn(p.rooms, 'pc') ? p.rooms.pc : 'bureau', real: true});
  return list;
}

// Signal en % (comme Windows : -50 dBm = 100 %, -100 dBm = 0 %).
function hash(t) { let x = 0; for (const c of String(t)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; }
function signal(boxRoom, deviceRoom, deviceId) {
  const a = ROOM[boxRoom], b = ROOM[deviceRoom];
  const walls = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
  const metres = walls ? 4 * Math.hypot(a.col - b.col, a.row - b.row) : 2;
  const dbm = -38 - 22 * Math.log10(metres) - 7 * walls - (hash(deviceId) % 5);
  return Math.max(5, Math.min(97, Math.round(2 * (dbm + 100))));
}
function level(v) { return v >= 70 ? 'tres-bon' : v >= 50 ? 'bon' : v >= 35 ? 'moyen' : 'faible'; }
const LEVEL = {'tres-bon': 'Très bon', bon: 'Bon', moyen: 'Moyen', faible: 'Faible'};

// Le meilleur endroit : celui où l'appareil le plus mal servi reçoit le plus ; à égalité, la meilleure moyenne.
function best(spots) {
  return [...spots].sort((a, b) => b.min - a.min || b.avg - a.avg)[0] || null;
}
function advice(spots) {
  const b = best(spots);
  if (!b) return {title: 'Où est votre box en ce moment ?', text: 'Touchez sur le plan la pièce où elle est posée, puis « Mesurer avec la box ici ». Guardian lit le signal de chaque appareil.'};
  const weak = b.devices.reduce((w, d) => d.signal < w.signal ? d : w, b.devices[0]);
  if (spots.length === 1) return {title: 'Première mesure faite', text: weak ? 'Ici, « ' + weak.name + ' » est le moins bien servi (' + weak.signal + ' %). Posez la box dans une autre pièce, attendez que le voyant soit vert, touchez cette pièce sur le plan, puis mesurez encore.' : 'Aucun appareil connecté pour le moment.'};
  // Le PC lit son vrai signal : s'il n'a pas bougé d'un endroit à l'autre, la box n'a sans doute pas changé de place.
  const pcVals = spots.map(x => x.devices.find(d => d.real)?.signal).filter(v => v != null);
  const pcSame = pcVals.length === spots.length && Math.max(...pcVals) - Math.min(...pcVals) <= 2;
  const second = [...spots].sort((x, y) => y.min - x.min || y.avg - x.avg)[1];
  if (b.min - second.min < CLOSE && b.avg - second.avg < CLOSE)
    return {title: 'Pas de différence nette', tie: true, text: ROOM[b.spot].label + ' et ' + ROOM[second.spot].label.toLowerCase() + ' se valent à quelques points près. Gardez l’endroit le plus pratique, en hauteur et à découvert.' + (pcSame ? ' Le signal du PC n’a pas bougé : la box a-t-elle vraiment changé de place ?' : '')};
  const worst = [...spots].sort((x, y) => x.min - y.min)[0];
  const gain = b.min - worst.min;
  const text = 'Posez la box ' + ROOM[b.spot].dans + ' : même « ' + weak.name + ' » y reçoit ' + weak.signal + ' %' + (gain > 0 && worst.spot !== b.spot ? ', soit ' + gain + ' points de plus que ' + ROOM[worst.spot].dans : '') + '.';
  const extra = b.min < 35 ? ' Même là, « ' + weak.name + ' » reste faible : un répéteur Wi-Fi ' + ROOM[weak.room].dans + ' réglera le problème.'
    : ' Posez-la en hauteur, à découvert, loin du micro-ondes et des murs épais.';
  return {title: 'Le meilleur endroit : ' + ROOM[b.spot].label, text: text + extra + (pcSame ? ' Le signal du PC n’a pas bougé : vérifiez que la box a bien changé de place.' : '')};
}

function view(s, uid, st, {pc = null} = {}) {
  const p = load(s, uid), devices = devicesOf(st, p, pc), a = advice(p.spots), b = p.spots.length > 1 && !a.tie ? best(p.spots) : null;
  return {rooms: ROOMS.map(({id, label, dans, col, row}) => ({id, label, dans, col, row})), devices, spots: p.spots.map(x => ({...x, best: !!b && x.spot === b.spot})),
    boxAt: p.boxAt || null, best: b ? b.spot : null, advice: a, pc: !!pc, max: MAX_SPOTS, levels: LEVEL};
}

function act(s, uid, st, d, {pc = null, now = Date.now()} = {}) {
  insist(st, 'Démarrez votre démonstration.', 409);
  const p = load(s, uid);
  if (d?.action === 'room') {
    insist(typeof d.id === 'string' && d.id.length <= 60 && isRoom(d.room), 'Pièce inconnue.');
    insist(devicesOf(st, p, pc).some(x => x.id === d.id) || Object.hasOwn(p.rooms, d.id), 'Appareil inconnu.');
    p.rooms[d.id] = d.room;
    // Les mesures déjà faites restent : elles disent ce que la box voyait à ce moment-là.
  } else if (d?.action === 'measure') {
    insist(isRoom(d.spot), 'Choisissez la pièce où se trouve la box.');
    const devices = devicesOf(st, p, pc);
    insist(devices.length, 'Aucun appareil connecté à mesurer.');
    const measured = devices.map(x => {
      const v = x.real ? pc.signal : signal(d.spot, x.room, x.id);
      return {id: x.id, name: x.name, room: x.room, signal: v, level: level(v), real: x.real};
    });
    const vals = measured.map(x => x.signal);
    const spot = {spot: d.spot, at: now, devices: measured, min: Math.min(...vals), avg: Math.round(vals.reduce((a, v) => a + v, 0) / vals.length)};
    const others = p.spots.filter(x => x.spot !== d.spot);
    insist(others.length < MAX_SPOTS, 'Vous avez déjà essayé ' + MAX_SPOTS + ' endroits. Recommencez pour en essayer d’autres.');
    p.spots = [...others, spot];
    p.boxAt = d.spot;
  } else if (d?.action === 'reset') {
    p.spots = []; p.boxAt = null;
  } else insist(false, 'Action inconnue.');
  save(s, uid, p);
  return view(s, uid, st, {pc});
}

module.exports = {ROOMS, MAX_SPOTS, migrate, view, act, signal, best, advice, guessRoom, level, isRoom};
