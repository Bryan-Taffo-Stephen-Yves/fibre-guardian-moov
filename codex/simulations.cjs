'use strict';
// Page « Simulations » : en un geste, le client rejoue sur SON compte de démonstration les situations que Guardian sait gérer.
// Rien ne touche le vrai réseau ni les autres comptes : tout se passe dans le parcours du client (journey-store.cjs).
// Les messages arrivent comme les vrais : « Mes messages », cloche, bandeau Wi-Fi, et notification du téléphone si le client
// l'a autorisée (push.cjs, déclenché à chaque enregistrement du parcours).
// Les suites d'une scène (messages qui arrivent les uns après les autres, étapes du technicien, blocage automatique) sont
// rangées dans une file datée ; elles s'appliquent quand l'application relit l'état (toutes les 3 secondes), sans changer
// la version du parcours : une action en cours du client n'est jamais refusée à cause d'une simulation.
const crypto = require('node:crypto'), {insist} = require('./pilot-model.cjs');
const J = require('./journey-store.cjs');

const URGENT_MS = 60000; // le client a une minute pour répondre à une alerte urgente, sinon Guardian bloque l'appareil
const BUSY_MS = 3 * 60000; // la saturation du quartier dure trois minutes dans la démonstration
const MAX_QUEUE = 40;
const key = () => 'sim:' + crypto.randomBytes(5).toString('hex');
const hm = t => { const d = new Date(t); return d.getUTCHours() + ' h ' + String(d.getUTCMinutes()).padStart(2, '0'); };

// Le quartier voisin, pour l'alerte « baisse de débit possible » (heure d'Abidjan = heure universelle).
const NEIGHBOURS = {'YOP-07': 'Yopougon Sideci', 'YOP-08': 'Yopougon Niangon', 'COC-03': 'Cocody Riviera 2', 'MAR-02': 'Marcory Zone 4'};
const neighbour = st => NEIGHBOURS[st.segment] && !String(st.zone || '').includes(NEIGHBOURS[st.segment].split(' ').pop()) ? NEIGHBOURS[st.segment] : 'un quartier voisin';
const quarter = st => String(st.zone || 'votre quartier').split('·').pop().trim();

const GUESTS = [['Téléphone de Fatou', 6], ['Tablette Samsung', 9], ['iPhone inconnu', 7], ['PC portable HP', 14]];

const SCENES = {
  foule: 'Plusieurs personnes sur votre Wi-Fi',
  urgent: 'Alerte urgente : appareil inconnu',
  conso: 'Un appareil consomme beaucoup',
  sature: 'La fibre est occupée dans votre quartier',
  panne: 'Panne, puis réparation par le technicien',
  voisin: 'Coupure dans un quartier voisin',
};

function note(st, n, now) {
  st.notifications.unshift({key: key(), home: 'home-1', at: now, read: false, sim: true, ...n});
  st.notifications = st.notifications.slice(0, 100);
}
function say(st, text) { st.messages.push({id: key(), role: 'assistant', text, sim: true}); st.messages = st.messages.slice(-30); }
function later(st, at, step) { st.simQueue = (st.simQueue || []).concat({at, ...step}).sort((a, b) => a.at - b.at).slice(0, MAX_QUEUE); }

// Ce que la page montre : la scène en cours, ses étapes, et le compte à rebours de l'alerte urgente.
function status(st, now = Date.now()) {
  const urgent = (st.devices || []).find(d => d.urgentUntil && !d.recognized && !d.blocked);
  const panne = (st.incidents || []).find(i => i.sim && i.status !== 'resolved');
  return {
    scene: st.simScene || null, at: st.simAt || null, pending: (st.simQueue || []).length,
    urgent: urgent ? {id: urgent.id, name: urgent.name, left: Math.max(0, Math.ceil((urgent.urgentUntil - now) / 1000))} : null,
    blocked: (st.devices || []).filter(d => d.autoBlocked && d.blocked).map(d => ({id: d.id, name: d.name})),
    busy: st.simBusy?.until > now ? {until: st.simBusy.until, left: Math.ceil((st.simBusy.until - now) / 1000)} : null,
    panne: panne ? {reference: panne.reference, status: panne.status, label: J.LABELS[J.STEPS.indexOf(panne.status)], technician: panne.technician?.name || null} : null,
    guests: (st.devices || []).filter(d => d.sim && !d.urgentUntil).length,
    upgrade: st.upgrade && st.upgrade.source === 'simulation' && st.upgrade.expires > now ? st.upgrade : null,
  };
}

// Enlève tout ce qu'une simulation a ajouté (appareils, panne, saturation, offre) ; garde les messages déjà reçus.
function clear(st) {
  st.devices = st.devices.filter(d => !d.sim);
  st.incidents = st.incidents.filter(i => !i.sim);
  st.simQueue = []; st.simBusy = null; st.simScene = null; st.simAt = null;
  if (st.upgrade?.source === 'simulation') st.upgrade = null;
  if (['download', 'devices'].includes(st.scenario)) { st.scenario = 'normal'; const ps5 = st.devices.find(d => d.id === 'ps5'); if (ps5) ps5.demand = 6; }
  st.devices = st.devices.filter(d => !d.guest);
}

function start(st, scene, now = Date.now()) {
  insist(Object.hasOwn(SCENES, scene), 'Simulation inconnue.');
  clear(st);
  st.simScene = scene; st.simAt = now;
  const plan = st.plan || J.PLANS[1];

  if (scene === 'foule') {
    // Quatre personnes se connectent en une minute : Guardian écrit à chaque arrivée, puis fait le point.
    GUESTS.forEach(([name, demand], n) => {
      const device = {id: 'sim-guest-' + (n + 1), name, demand, guest: true, sim: true, recognized: false};
      const step = {type: 'note', device, n: {kind: 'wifi', page: 'devices', title: 'Nouvel appareil sur votre Wi-Fi', body: '« ' + name + ' » vient de se connecter. C’est à vous ou à un proche ?'}};
      if (n === 0) { st.devices.push(device); note(st, step.n, now); } else later(st, now + n * 6000, step);
    });
    later(st, now + GUESTS.length * 6000, {type: 'note', n: {kind: 'wifi', page: 'devices', title: GUESTS.length + ' nouveaux appareils en une minute', body: 'Votre Wi-Fi a beaucoup de visiteurs. Si vous ne les connaissez pas, changez le mot de passe du Wi-Fi.'},
      say: 'Quatre appareils se sont connectés à votre Wi-Fi en une minute. Ce n’est pas forcément un intrus : peut-être des invités. Dans Appareils, touchez « C’est à moi » pour ceux que vous connaissez et bloquez les autres.'});
  } else if (scene === 'urgent') {
    const id = 'sim-urgent';
    st.devices.push({id, name: 'Appareil inconnu « android-7f3a »', demand: 11, guest: true, sim: true, recognized: false, urgentUntil: now + URGENT_MS});
    note(st, {kind: 'wifi', page: 'devices', urgent: true, title: 'Urgent : appareil inconnu sur votre Wi-Fi', body: 'Un appareil que vous n’avez jamais vu s’est connecté à ' + hm(now) + '. Répondez dans la minute, sinon Guardian le bloque pour vous protéger.'}, now);
    later(st, now + URGENT_MS, {type: 'autoblock', id});
  } else if (scene === 'conso') {
    // La console télécharge 40 Go : la ligne sature. Guardian prévient, puis propose un forfait plus rapide payable avec Moov Money.
    st.scenario = 'download';
    const ps5 = st.devices.find(d => d.id === 'ps5'); if (ps5) ps5.demand = 110;
    const name = ps5?.name || 'Console de jeux';
    note(st, {kind: 'wifi', page: 'devices', title: 'Un appareil consomme beaucoup', body: '« ' + name + ' » a utilisé 18 Go depuis ce matin, 6 fois plus que d’habitude. Les autres appareils ralentissent.'}, now);
    const to = J.PLANS.find(p => p.price > plan.price && p.mbps >= 200) || null;
    if (to && !(st.declinedUntil > now)) {
      st.upgrade = J.upgradeQuote(plan, to, now, {source: 'simulation'});
      later(st, now + 5000, {type: 'note', n: {page: 'forfait', title: 'Guardian vous propose un forfait plus rapide', body: 'Passez de ' + plan.mbps + ' à ' + to.mbps + ' Mb/s : ' + st.upgrade.amount.toLocaleString('fr-FR') + ' FCFA pour la fin du mois, payés avec Moov Money.'},
        say: '« ' + name + ' » télécharge beaucoup : votre ligne de ' + plan.mbps + ' Mb/s est pleine et les autres appareils ralentissent. Vous pouvez limiter son débit dans Appareils, ou passer à ' + to.mbps + ' Mb/s. Ce mois-ci, vous payez seulement la différence pour les jours restants : ' + st.upgrade.amount.toLocaleString('fr-FR') + ' FCFA.'});
    } else {
      later(st, now + 5000, {type: 'note', n: {kind: 'wifi', page: 'devices', title: 'Guardian vous conseille', body: 'Limitez le débit de « ' + name + ' » dans Appareils : les autres appareils retrouvent de la place.'},
        say: '« ' + name + ' » télécharge beaucoup. Votre forfait est déjà rapide : limitez plutôt son débit dans Appareils pendant le téléchargement.'});
    }
  } else if (scene === 'sature') {
    st.simBusy = {until: now + BUSY_MS};
    note(st, {page: 'home', title: 'Réseau très chargé à ' + quarter(st), body: 'Beaucoup de foyers sont connectés en même temps. Votre débit baisse pendant quelques minutes. Ce n’est pas votre box : inutile de la redémarrer.'}, now);
    say(st, 'Ce soir, beaucoup de foyers de ' + quarter(st) + ' utilisent la fibre en même temps : votre débit baisse pour quelques minutes. Votre box va bien, ne la redémarrez pas. L’équipe Moov répartit déjà la charge. Je vous préviens quand c’est fluide.');
    later(st, now + BUSY_MS, {type: 'note', n: {page: 'home', title: 'Le réseau du quartier est redevenu fluide', body: 'Votre débit habituel est revenu.'}});
  } else if (scene === 'panne') {
    // Une panne dans le quartier : Guardian la confirme, un technicien est envoyé, répare, et la ligne est vérifiée.
    const i = J.openIncident(st, now, {zone: st.zone, description: 'Câble fibre coupé par un chantier, près de chez vous.', lat: 5.335, lon: -4.087, kind: 'fibre', channel: 'app'});
    i.sim = true; i.status = 'confirmed'; i.events.push({at: now, label: J.LABELS[1]});
    J.notify(st, i, 'Panne dans votre quartier : Guardian l’a confirmée');
    const steps = [['assigned', 6000], ['en_route', 12000], ['on_site', 24000], ['repairing', 32000], ['verifying', 44000], ['resolved', 52000]];
    for (const [to, wait] of steps) later(st, now + wait, {type: 'step', id: i.id, to});
  } else if (scene === 'voisin') {
    const place = neighbour(st);
    note(st, {page: 'home', title: 'Attention : baisse de débit possible', body: 'Une coupure est en cours à ' + place + ', à côté de chez vous. Pendant la réparation, le débit peut baisser dans votre zone. Votre internet reste allumé.'}, now);
    say(st, 'Une panne touche ' + place + ', juste à côté. Chez vous, internet marche, mais le débit peut baisser un peu pendant la réparation. Je vous préviens dès qu’elle est finie.');
    later(st, now + 45000, {type: 'note', n: {page: 'home', title: 'Coupure voisine réparée', body: 'La panne de ' + place + ' est réparée. Votre débit ne risque plus de baisser.'}});
  }
  return st;
}

// Les suites arrivées à leur heure. Renvoie true si l'état a changé.
function tick(st, now = Date.now()) {
  if (!st || !Array.isArray(st.simQueue) || !st.simQueue.length) return false;
  let changed = false;
  while (st.simQueue.length && st.simQueue[0].at <= now) {
    const step = st.simQueue.shift(); changed = true;
    if (step.type === 'note') { if (step.device && !st.devices.some(x => x.id === step.device.id)) st.devices.push(step.device); note(st, step.n, step.at); if (step.say) say(st, step.say); }
    else if (step.type === 'autoblock') {
      const d = st.devices.find(x => x.id === step.id);
      if (d && !d.recognized && !d.blocked) {
        d.blocked = true; d.autoBlocked = true; d.urgentUntil = null;
        note(st, {kind: 'wifi', page: 'devices', title: 'Guardian a bloqué un appareil inconnu', body: 'Vous n’avez pas répondu : « ' + d.name + ' » n’a plus accès à votre Wi-Fi. Si c’est à vous, débloquez-le dans Appareils.'}, step.at);
        say(st, 'Vous n’avez pas répondu à mon alerte urgente : par sécurité, j’ai bloqué « ' + d.name + ' ». S’il est à vous ou à un proche, débloquez-le dans Appareils en un geste.');
      } else if (d) d.urgentUntil = null;
    } else if (step.type === 'step') {
      const i = st.incidents.find(x => x.id === step.id && x.sim);
      if (!i || i.status === 'resolved') continue;
      i.status = step.to;
      if (step.to === 'assigned') i.technician = st.technicians?.[0] || {id: 'awa', name: 'Awa', team: 'Équipe fibre Ouest'};
      if (step.to === 'en_route') i.departed = step.at;
      if (step.to === 'on_site') i.arrived = step.at;
      if (step.to === 'resolved') { i.resolved = step.at; i.verification = {source: 'simulateur', at: step.at, online: true, mbps: (st.plan || J.PLANS[1]).mbps}; }
      i.events.push({at: step.at, label: J.LABELS[J.STEPS.indexOf(step.to)]});
      const who = i.technician?.name || 'Le technicien';
      J.notify(st, i, ({assigned: who + ' s’occupe de réparer votre ligne', en_route: who + ' est en route vers la panne', on_site: who + ' est sur place', repairing: 'Réparation en cours', verifying: 'Réparation finie : Guardian vérifie votre ligne', resolved: 'Internet est revenu : ligne vérifiée'})[step.to] || J.LABELS[J.STEPS.indexOf(step.to)]);
      if (step.to === 'resolved') say(st, 'Bonne nouvelle : ' + who + ' a réparé le câble et j’ai vérifié votre ligne. Internet est revenu chez vous.');
    }
  }
  return changed;
}

// Appelé à chaque lecture de l'état par l'application : applique les suites, enregistre sans changer la version.
function refresh(s, uid, now = Date.now()) {
  const st = J.get(s, uid);
  if (st && tick(st, now)) J.put(s, uid, st);
}

// Lance une scène (ou « stop ») sur le compte du client lui-même.
function run(s, uid, d, now = Date.now()) {
  return s.transaction(() => {
    const st = J.get(s, uid);
    insist(st, 'Démarrez votre démonstration.', 409);
    const type = String(d?.scene || '');
    if (type === 'stop') clear(st);
    else start(st, type, now);
    st.version++;
    J.put(s, uid, st);
    return J.snapshotFor(s, uid, st);
  });
}

module.exports = {SCENES, URGENT_MS, BUSY_MS, start, tick, refresh, run, status, clear, neighbour};
