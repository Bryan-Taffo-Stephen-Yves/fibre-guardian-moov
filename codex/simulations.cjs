'use strict';
// Carte « Simulations » de la Régie (équipe Moov, administrateur seulement) : en un geste, l'administrateur fait vivre à un
// client les situations que Guardian sait gérer. Rien ne touche le vrai réseau : tout se passe dans le parcours de ce client
// (journey-store.cjs). Le client reçoit les messages sur son téléphone et répond lui-même, comme en vrai.
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

const BOX_MS = 90000; // la box éteinte revient au bout d'une minute et demie (le courant est revenu)
const GUESTS = [['Téléphone de Fatou', 6], ['Tablette Samsung', 9], ['iPhone inconnu', 7], ['PC portable HP', 14]];

const SCENES = {
  foule: 'Plusieurs personnes sur votre Wi-Fi',
  urgent: 'Alerte urgente : appareil inconnu',
  conso: 'Un appareil consomme beaucoup',
  sature: 'La fibre est occupée dans votre quartier',
  panne: 'Panne, puis réparation par le technicien',
  voisin: 'Coupure dans un quartier voisin',
  box: 'Box éteinte chez le client',
  facture: 'Facture pas encore payée',
  suspendue: 'Ligne suspendue pour facture impayée',
  vol: 'Câble volé sur le poteau',
  chambre: 'Wi-Fi faible dans une chambre',
  retard: 'Technicien en retard',
  recurrente: 'Panne qui revient (3e coupure en 30 jours)',
  demenagement: 'Jour du déménagement (installation à la nouvelle adresse)',
  arnaque: 'Message d’arnaque',
};
const OUTAGES = ['panne', 'vol', 'retard']; // scènes qui coupent internet : refusées si une vraie panne est déjà en cours
// « box » est refusée aussi pendant une panne (start) : la box ne répondrait de toute façon pas, ce serait deux causes à la fois.

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
    box: st.simBoxOff?.until > now ? {left: Math.ceil((st.simBoxOff.until - now) / 1000)} : null,
    busy: st.simBusy?.until > now ? {until: st.simBusy.until, left: Math.ceil((st.simBusy.until - now) / 1000)} : null,
    panne: panne ? {reference: panne.reference, status: panne.status, label: J.LABELS[J.STEPS.indexOf(panne.status)], technician: panne.technician?.name || null, late: !!panne.late, swapped: !!panne.swapped} : null,
    boxBack: st.simScene === 'box' && !(st.simBoxOff?.until > now) && !(st.simQueue || []).length,
    guests: (st.devices || []).filter(d => d.sim && !d.urgentUntil).length,
    upgrade: st.upgrade && st.upgrade.source === 'simulation' && st.upgrade.expires > now ? st.upgrade : null,
    paid: st.simScene === 'conso' && st.payment?.at >= st.simAt ? {amount: st.payment.amount, mbps: st.payment.mbps} : null,
  };
}

// Enlève tout ce qu'une simulation a ajouté (appareils, panne, saturation, offre) ; garde les messages déjà reçus.
function clear(st, {keepScenario = false} = {}) {
  st.devices = st.devices.filter(d => !d.sim);
  st.incidents = st.incidents.filter(i => !i.sim);
  st.simQueue = []; st.simBusy = null; st.simBoxOff = null; st.simScene = null; st.simAt = null;
  if (st.upgrade?.source === 'simulation') st.upgrade = null;
  if (keepScenario) return; // le client vient de choisir lui-même un état de la box
  if (['download', 'devices'].includes(st.scenario)) { st.scenario = 'normal'; const ps5 = st.devices.find(d => d.id === 'ps5'); if (ps5) ps5.demand = 6; }
  st.devices = st.devices.filter(d => !d.guest);
}

// fault : une vraie panne en cours chez le client (incident du parcours ou panne de zone de l'équipe Moov).
function start(st, scene, now = Date.now(), {fault = null, s = null, uid = null} = {}) {
  insist(Object.hasOwn(SCENES, scene), 'Simulation inconnue.');
  clear(st);
  fault = fault || J.active(st);
  insist(!([...OUTAGES, 'box'].includes(scene) && fault), 'Une panne est déjà en cours chez vous : suivez-la dans « Suivi technicien ».', 409);
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
    note(st, {kind: 'wifi', page: 'devices', title: 'Un appareil consomme beaucoup', body: '« ' + name + ' » télécharge un jeu de 40 Go : déjà 18 Go depuis ce matin, 6 fois plus que d’habitude. Les autres appareils ralentissent.'}, now);
    const to = J.PLANS.find(p => p.price > plan.price && p.mbps >= 200) || null;
    // Mêmes conditions que « Changer de forfait » : pas d'offre pendant une panne (un forfait plus rapide ne la réglerait pas).
    if (to && !fault) {
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
    outage(st, now, {description: 'Câble fibre coupé par un chantier, près de chez vous.', title: 'Panne dans votre quartier : Guardian l’a confirmée'});
  } else if (scene === 'vol') {
    // Vol de câble : une voisine a envoyé la photo du poteau ; Yao sécurise le poteau puis remplace le câble.
    outage(st, now, {description: 'Câble fibre volé sur le poteau de la rue, près de chez vous.', kind: 'pole', tech: 'yao', title: 'Câble volé dans votre rue : Moov intervient',
      say: 'Une voisine a envoyé la photo du poteau de votre rue : le câble fibre a été volé. Ce n’est pas votre box. Yao, de l’équipe fibre, va d’abord sécuriser le poteau, puis remplacer le câble. Je vous préviens à chaque étape.'});
  } else if (scene === 'box') {
    // La box ne répond plus mais le quartier va bien : ce n'est pas une panne Moov. Guardian le dit et guide le client.
    st.simBoxOff = {until: now + BOX_MS};
    note(st, {page: 'home', title: 'Votre box ne répond plus', body: 'Le réseau de votre quartier va bien : ce n’est pas une panne Moov. Vérifiez que la box est branchée et allumée. Une coupure de courant chez vous ?'}, now);
    say(st, 'Votre box ne me répond plus depuis ' + hm(now) + ', alors que les autres box de ' + quarter(st) + ' vont bien. Ce n’est donc pas une panne Moov. Vérifiez la prise, le bouton de la box et le courant chez vous. Je vous préviens dès qu’elle revient.');
    later(st, now + BOX_MS, {type: 'note', n: {page: 'home', title: 'Votre box est revenue', body: 'Le courant est revenu : votre box répond de nouveau et internet marche.'}, boxOn: true});
  } else if (scene === 'facture') {
    // La vraie facture du mois (fidelite.cjs) : Guardian rappelle gentiment, puis propose de payer en 2 ou 3 fois (acces.cjs).
    insist(s && uid, 'Client introuvable.', 404);
    const b = require('./fidelite.cjs').state(s, uid, now).bill;
    insist(!b.paid || b.split, 'La facture de ' + b.label + ' de ce client est déjà payée : rien à lui rappeler.', 409);
    let split = null; try { split = require('./acces.cjs').state(s, uid, now).split; } catch {}
    const fmt = n => n.toLocaleString('fr-FR') + ' FCFA', day = t => new Date(t).getUTCDate() + ' ' + b.label.split(' ')[0];
    if (split) {
      // Le client paie déjà ce mois en plusieurs fois (« Offres solidaires ») : on rappelle la prochaine part, jamais la facture entière.
      const left = split.parts.filter(p => !p.paid), next = left[0];
      insist(next, 'Le mois de ce client est déjà réglé en plusieurs fois : rien à lui rappeler.', 409);
      const rank = split.parts.indexOf(next) + 1, when = next.due > now ? 'avant le ' + day(next.due) : 'dès maintenant';
      note(st, {page: 'acces', title: 'Votre part n°' + rank + ' sur ' + split.parts.length + ' est à payer', body: fmt(next.amount) + ', à payer avec Moov Money ' + when + '. Vous avez choisi de payer ' + split.month + ' en ' + split.parts.length + ' fois.'}, now);
      say(st, 'Petit rappel : vous payez ' + split.month + ' en ' + split.parts.length + ' fois. Votre part n°' + rank + ' (' + fmt(next.amount) + ') est à régler ' + when + ', dans « Offres solidaires ». Il vous restera ' + (left.length - 1) + ' part' + (left.length - 1 > 1 ? 's' : '') + ' ensuite. Ne payez pas la facture entière : ce serait payer deux fois.');
    } else {
      note(st, {page: 'fidelite', title: 'Votre facture de ' + b.label + ' est à payer', body: fmt(b.amount) + ', à payer avec Moov Money avant le ' + day(b.due) + '. Payée à temps, elle vous rapporte des points de fidélité.'}, now);
      say(st, 'Petit rappel : votre facture de ' + b.label + ' (' + fmt(b.amount) + ') n’est pas encore payée. Vous pouvez la régler en deux gestes dans « Ma fidélité », avec Moov Money.');
      later(st, now + 20000, {type: 'note', n: {page: 'acces', title: 'Besoin d’un peu de temps ?', body: 'Vous pouvez payer ' + b.label + ' en 2 ou 3 fois, sans frais. Choisissez dans « Offres solidaires ».'},
        say: 'Si le mois est difficile, vous pouvez payer en 2 ou 3 fois, sans frais : ouvrez « Offres solidaires » dans votre compte. Votre fibre reste allumée.'});
    }
  } else if (scene === 'suspendue') {
    // La facture du mois n'est pas payée : la ligne est suspendue (ligne.cjs). Le client paie, internet revient tout de suite.
    insist(s && uid, 'Client introuvable.', 404);
    const l = require('./ligne.cjs').demoSuspend(s, uid, now, st);
    say(st, 'Votre internet est suspendu car la facture de ' + l.label + ' (' + l.amount.toLocaleString('fr-FR') + ' FCFA) n’est pas payée. Payez-la avec Moov Money, ou en 2 ou 3 fois : internet revient tout de suite.');
  } else if (scene === 'retard') {
    // Le technicien part, prend du retard (route bloquée), puis ne peut plus venir : Guardian prévient et un autre prend le relais.
    outage(st, now, {description: 'Câble fibre coupé par un chantier, près de chez vous.', title: 'Panne dans votre quartier : Guardian l’a confirmée', steps: [
      ['assigned', 6000], ['en_route', 12000], ['', 20000, {type: 'delay'}], ['', 32000, {type: 'swap', tech: 'yao'}],
      ['on_site', 44000], ['repairing', 50000], ['verifying', 56000], ['resolved', 62000]]});
  } else if (scene === 'recurrente') {
    // Deux coupures déjà réparées ce mois-ci dans le quartier du client, puis une 3e : son dossier devient prioritaire
    // et un conseiller doit l'appeler sous 2 h (panne-recurrente.cjs, file « À rappeler »).
    insist(s && uid, 'Client introuvable.', 404);
    const seg = s.get('SELECT segment_id FROM noc_members WHERE user_id=?', uid)?.segment_id;
    insist(seg, 'Ce client n’a pas encore choisi son quartier.', 409);
    const PR = require('./panne-recurrente.cjs');
    // Trois coupures réparées (la dernière il y a 2 h). Elles ne comptent que pour ce client : ses voisins ne sont pas touchés.
    for (const ago of [18 * 86400000, 7 * 86400000, 5 * 3600000]) {
      const id = 'sim-recurrente-' + key();
      s.run("INSERT INTO noc_incidents(id,segment_id,source,mode,status,title,description,created,updated) VALUES(?,?,?,?,?,?,?,?,?)", id, seg, 'telemetry', 'demo', 'resolved', 'Coupure fibre · ' + quarter(st), 'Scène de la Régie : coupure du quartier.', now - ago, now - ago + 3 * 3600000);
    }
    const made = PR.sweep(s, now, {force: true, only: uid});
    st.notifications = J.get(s, uid).notifications;   // la notification posée par sweep, que l'enregistrement de la scène écraserait
    const n = PR.outages(s, seg, now, {sim: true}).length;
    say(st, made
      ? 'Pardon : c’est la ' + n + 'e coupure en 30 jours à ' + quarter(st) + '. Votre dossier est prioritaire. Un conseiller Moov vous appelle dans les 2 heures pour en parler et, si besoin, envoyer un technicien vérifier toute votre ligne.'
      : 'Pardon : c’est la ' + n + 'e coupure en 30 jours à ' + quarter(st) + '. Votre dossier est déjà prioritaire' + (s.get("SELECT 1 FROM sc_demandes WHERE kind='panne' AND user_id=? AND status IN ('recue','prise','appele','recours')", uid) ? ' : suivez l’appel du conseiller dans « Ma réparation ».' : '. Si ça coupe encore, dites-le-moi : j’alerte tout de suite l’équipe Moov.'));
  } else if (scene === 'demenagement') {
    // Le jour du déménagement arrive tout de suite : le technicien a installé la fibre à la nouvelle adresse (demenagement.cjs).
    // Il faut que le client ait demandé son déménagement et qu'un conseiller l'ait confirmé : la scène ne saute que l'attente.
    insist(s && uid, 'Client introuvable.', 404);
    const DM = require('./demenagement.cjs'); DM.migrate(s);
    const r = s.get("SELECT * FROM demenagements WHERE user_id=? AND status='planifie' ORDER BY created DESC LIMIT 1", uid);
    insist(r, 'Ce client n’a pas de déménagement confirmé : il le demande dans Mon compte, puis un conseiller le confirme dans « À rappeler ».', 409);
    DM.finish(s, r, now);
    st.notifications = J.get(s, uid).notifications;   // la notification « Est-ce réglé ? », que l'enregistrement de la scène écraserait
    say(st, 'Bienvenue chez vous ! Votre fibre est installée à votre nouvelle adresse (' + r.quartier + ', ' + r.commune + '). Je surveille maintenant votre nouveau quartier. Dites-moi dans « Ma réparation » si tout va bien.');
  } else if (scene === 'arnaque') {
    // Un faux SMS « Moov » demande le code secret Moov Money : Guardian met en garde, sans jamais lire les SMS du client.
    note(st, {page: 'compte', urgent: true, title: 'Attention : arnaque en cours dans votre quartier', body: 'Un faux message « Moov » demande votre code Moov Money pour « réparer votre fibre ». Moov ne vous demandera jamais votre code. Ne répondez pas.'}, now);
    say(st, 'Attention : des clients de ' + quarter(st) + ' reçoivent un faux SMS « Moov » qui demande leur code secret Moov Money pour « réparer la fibre ». C’est une arnaque. Moov ne demande jamais votre code, ni par SMS, ni par appel, ni sur WhatsApp. Ne répondez pas et supprimez le message. Pour une vraie panne, passez par moi ou par le 111.');
  } else if (scene === 'chambre') {
    // La fibre va bien, mais le Wi-Fi n'arrive pas jusqu'à la chambre des enfants : Guardian explique où mettre la box.
    st.devices.push({id: 'sim-chambre', name: 'Tablette de Kevin (chambre des enfants)', demand: 3, sim: true, recognized: true});
    note(st, {kind: 'wifi', page: 'devices', title: 'Wi-Fi faible dans la chambre des enfants', body: 'La tablette de Kevin capte seulement 1 barre sur 4 : les vidéos coupent. Votre fibre va bien, c’est le Wi-Fi qui n’arrive pas jusque-là.'}, now);
    say(st, 'Votre fibre reçoit bien ses ' + (st.plan || J.PLANS[1]).mbps + ' Mb/s, mais le Wi-Fi arrive mal dans la chambre des enfants : la tablette de Kevin capte 1 barre sur 4. Trois gestes simples : posez la box en hauteur, au centre de la maison (le couloir, par exemple), loin des murs épais et du frigo. Si ça ne suffit pas, un répéteur Wi-Fi dans le couloir règle le problème.');
  } else if (scene === 'voisin') {
    const place = neighbour(st);
    note(st, {page: 'home', title: 'Attention : baisse de débit possible', body: 'Une coupure est en cours à ' + place + ', à côté de chez vous. Pendant la réparation, le débit peut baisser dans votre zone. Votre internet reste allumé.'}, now);
    say(st, 'Une panne touche ' + place + ', juste à côté. Chez vous, internet marche, mais le débit peut baisser un peu pendant la réparation. Je vous préviens dès qu’elle est finie.');
    later(st, now + 45000, {type: 'note', n: {page: 'home', title: 'Coupure voisine réparée', body: 'La panne de ' + place + ' est réparée. Votre débit ne risque plus de baisser.'}});
  }
  return st;
}

// Une coupure jouée de bout en bout : panne confirmée, technicien choisi, en route, sur place, réparation, vérification.
const STEPS_MS = [['assigned', 6000], ['en_route', 12000], ['on_site', 24000], ['repairing', 32000], ['verifying', 44000], ['resolved', 52000]];
function outage(st, now, {description, title, say: text = null, kind = 'fibre', tech = 'koffi', steps = STEPS_MS}) {
  const i = J.openIncident(st, now, {zone: st.zone, description, lat: 5.335, lon: -4.087, kind, channel: 'app'});
  i.sim = true; i.status = 'confirmed'; i.events.push({at: now, label: J.LABELS[1]});
  J.notify(st, i, title);
  if (text) say(st, text);
  for (const [to, wait, extra] of steps) later(st, now + wait, {type: 'step', id: i.id, to, tech, ...extra}); // extra.type : un message ou un changement de technicien
  return i;
}
// Les fiches des techniciens (noc-store.cjs), avec le prénom seulement (jamais Awa, le prénom de la cliente de démonstration).
// Les messages disent « le technicien Koffi » : le foyer de démonstration a aussi un « iPhone de Koffi ».
function techOf(id, skip = null) {
  const TECHS = require('./noc-store.cjs').TECHS;
  const t = [id, 'koffi', 'yao', 'amina'].map(x => TECHS.find(v => v.id === x)).find(v => v && v.id !== 'awa' && v.id !== skip);
  return t ? {id: t.id, name: t.name.split(' ')[0], team: 'Équipe ' + t.team.toLowerCase()} : {id: 'koffi', name: 'Koffi', team: 'Équipe fibre ouest'};
}

// Les suites arrivées à leur heure. Renvoie true si l'état a changé.
function tick(st, now = Date.now()) {
  if (!st || !Array.isArray(st.simQueue) || !st.simQueue.length) return false;
  let changed = false;
  while (st.simQueue.length && st.simQueue[0].at <= now) {
    const step = st.simQueue.shift(); changed = true;
    if (step.type === 'note') { if (step.boxOn) st.simBoxOff = null; if (step.device && !st.devices.some(x => x.id === step.device.id)) st.devices.push(step.device); note(st, step.n, step.at); if (step.say) say(st, step.say); }
    else if (step.type === 'autoblock') {
      const d = st.devices.find(x => x.id === step.id);
      if (d && !d.recognized && !d.blocked) {
        d.blocked = true; d.autoBlocked = true; d.urgentUntil = null;
        note(st, {kind: 'wifi', page: 'devices', title: 'Guardian a bloqué un appareil inconnu', body: 'Vous n’avez pas répondu : « ' + d.name + ' » n’a plus accès à votre Wi-Fi. Si c’est à vous, débloquez-le dans Appareils.'}, step.at);
        say(st, 'Vous n’avez pas répondu à mon alerte urgente : par sécurité, j’ai bloqué « ' + d.name + ' ». S’il est à vous ou à un proche, débloquez-le dans Appareils en un geste.');
      } else if (d) d.urgentUntil = null;
    } else if (step.type === 'delay') {
      // Seulement si le technicien est encore en route (l'équipe a pu faire avancer la mission à la main).
      const i = st.incidents.find(x => x.id === step.id && x.sim);
      if (!i || i.status !== 'en_route') continue;
      const who = i.technician?.name || 'Le technicien';
      i.events.push({at: step.at, label: 'Retard du technicien'}); i.late = step.at;
      note(st, {page: 'notifications', title: 'Le technicien ' + who + ' a du retard', body: 'La route est bloquée par un accident à ' + quarter(st) + '. ' + who + ' arrivera plus tard que prévu. Désolé pour l’attente.'}, step.at);
      say(st, 'Le technicien ' + who + ' est bloqué sur la route par un accident : il arrivera plus tard que prévu. Je surveille : si un autre technicien peut venir plus vite, je vous le dis tout de suite.');
    } else if (step.type === 'swap') {
      // Le premier technicien ne peut plus venir : un autre prend le relais.
      const i = st.incidents.find(x => x.id === step.id && x.sim);
      if (!i || i.status !== 'en_route') continue;
      const before = i.technician?.name || 'Le technicien';
      i.technician = techOf(step.tech, i.technician?.id); i.departed = step.at; i.swapped = step.at;
      i.events.push({at: step.at, label: 'Changement de technicien'});
      note(st, {page: 'notifications', title: 'Le technicien ' + i.technician.name + ' prend le relais', body: before + ' ne peut plus venir à temps. ' + i.technician.name + ' est déjà en route et arrive dans quelques minutes.'}, step.at);
      say(st, before + ' ne pourra pas venir à temps. ' + i.technician.name + ' était libre : il est déjà en route et arrive dans quelques minutes. Vous n’avez rien à faire.');
    } else if (step.type === 'step') {
      const i = st.incidents.find(x => x.id === step.id && x.sim);
      if (!i || J.STEPS.indexOf(step.to) <= J.STEPS.indexOf(i.status)) continue; // jamais de retour en arrière
      i.status = step.to;
      // Koffi par défaut (équipe fibre de Yopougon).
      if (step.to === 'assigned') i.technician = techOf(step.tech || 'koffi');
      if (step.to === 'en_route') i.departed = step.at;
      if (step.to === 'on_site') i.arrived = step.at;
      if (step.to === 'resolved') { i.resolved = step.at; i.verification = {source: 'simulateur', at: step.at, online: true, mbps: (st.plan || J.PLANS[1]).mbps}; }
      i.events.push({at: step.at, label: J.LABELS[J.STEPS.indexOf(step.to)]});
      const who = i.technician?.name || 'Le technicien';
      J.notify(st, i, ({assigned: 'Le technicien ' + who + ' s’occupe de réparer votre ligne', en_route: who + ' est en route vers la panne', on_site: who + ' est sur place', repairing: 'Réparation en cours', verifying: 'Réparation finie : Guardian vérifie votre ligne', resolved: 'Internet est revenu : ligne vérifiée'})[step.to] || J.LABELS[J.STEPS.indexOf(step.to)]);
      if (step.to === 'resolved') say(st, 'Bonne nouvelle : ' + who + ' a ' + (i.kind === 'pole' ? 'remplacé le câble volé' : 'réparé le câble') + ' et j’ai vérifié votre ligne. Internet est revenu chez vous.');
    }
  }
  return changed;
}

// Appelé à chaque lecture de l'état par l'application : applique les suites, enregistre sans changer la version.
function refresh(s, uid, now = Date.now()) {
  const st = J.get(s, uid);
  if (st && tick(st, now)) J.put(s, uid, st);
}

// Lance une scène (ou « stop ») sur le compte d'un client.
function run(s, uid, d, now = Date.now()) {
  return s.transaction(() => {
    const st = J.get(s, uid);
    insist(st, 'Démarrez votre démonstration.', 409);
    const type = String(d?.scene || '');
    if (type === 'stop') clear(st);
    else { let fault = null; try { fault = J.sharedFault(s, uid); } catch {} start(st, type, now, {fault, s, uid}); }
    st.version++;
    J.put(s, uid, st);
    return J.snapshotFor(s, uid, st);
  });
}

// Les clients que la Régie peut choisir : les comptes sans rôle Moov, Awa (cliente de démonstration) en premier.
function clients(s) {
  const awa = require('./seed-demo.cjs').DEMO.client.email;
  return s.all("SELECT u.id, u.name FROM users u LEFT JOIN operator_grants g ON g.user_id=u.id WHERE (g.role IS NULL OR g.role='subscriber') AND u.email NOT LIKE 'demo-%@guardian.invalid' ORDER BY (u.email=?) DESC, u.name LIMIT 40", awa);
}
const pick = (s, id) => { const list = clients(s); return {list, target: list.find(c => c.id === id) || (id ? null : list[0]) || null}; };
// Ce que montre la Régie : la liste des clients et la scène en cours chez le client choisi.
function regie(s, id, now = Date.now()) {
  const {list, target} = pick(s, id);
  insist(!id || target, 'Client introuvable.', 404);
  if (target) refresh(s, target.id, now);
  const st = target ? J.get(s, target.id) : null;
  return {clients: list, client: target?.id || null, status: st ? status(st, now) : {scene: null, blocked: []}};
}
// Lancement depuis la Régie : le parcours du client est créé s'il n'existe pas encore.
function launch(s, id, d, now = Date.now()) {
  const {target} = pick(s, id);
  insist(id && target, 'Choisissez un client.', 404);
  if (!J.get(s, target.id)) J.put(s, target.id, J.seed());
  return run(s, target.id, d, now);
}

// Toutes les 3 secondes (pilot-server.cjs) : les suites arrivent même application fermée (notification du téléphone).
function sweep(s, now = Date.now()) {
  for (const r of s.all('SELECT user_id FROM journey_state WHERE body LIKE ?', '%"simQueue":[{%')) refresh(s, r.user_id, now);
}

module.exports = {clients, regie, launch, sweep, SCENES, URGENT_MS, BUSY_MS, start, tick, refresh, run, status, clear, neighbour};
