'use strict';
// « Le client n'appelle plus » : trois pièces qui s'appuient sur le moteur d'incidents existant (noc-store.cjs).
// 1. Heure de retour : calculée à partir des étapes du dossier, promise une fois, et annoncée de nouveau en cas de retard.
// 2. Serveur vocal : quand le client appelle Moov, il entend d'abord ce que Moov sait déjà de son quartier.
// 3. Compteur : clients prévenus, clients qui ont quand même appelé, appels évités. Vu seulement par l'équipe Moov.
// Les durées sont celles du parcours de démonstration (trajet de 2 minutes, comme position() dans noc-store.cjs).
const {insist}=require('./pilot-model.cjs');
const MIN=60000;
const STEP={approval:3*MIN,dispatch:2*MIN,travel:2*MIN,repair:5*MIN,check:MIN,remote:3*MIN};
const SLOT=5*MIN,NOTICE_GAP=3*MIN;
const N=()=>require('./noc-store.cjs');
const OPEN=i=>!['resolved','closed'].includes(i.status);

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS noc_calls(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,incident_key TEXT NOT NULL,incident_id TEXT,outcome TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(user_id,incident_key));
 CREATE TABLE IF NOT EXISTS noc_eta(incident_id TEXT PRIMARY KEY REFERENCES noc_incidents(id) ON DELETE CASCADE,promised INTEGER NOT NULL,announced INTEGER NOT NULL,notified INTEGER NOT NULL);
 `);}

// « 19 h 45 », à l'heure d'Abidjan quel que soit le serveur.
function clock(at){const p=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Abidjan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at));return p.find(x=>x.type==='hour').value+' h '+p.find(x=>x.type==='minute').value;}
const slot=at=>Math.ceil(at/SLOT)*SLOT;

// Heure de fin prévue : chaque étape déjà faite garde son heure réelle ; une étape en retard repart de maintenant.
// Pas d'heure avant que le plan soit validé : Moov ne promet que ce qu'il a décidé de faire.
// Coupure de courant : rien à réparer côté Moov, pas d'heure à promettre.
function estimate(i,events,now=Date.now()){
 if(!OPEN(i)||i.mode!=='demo')return null;
 const plan=i.plan||null;if(plan?.cause==='POWER_OUTAGE')return {power:true};
 const at=kind=>events.find(e=>e.kind===kind)?.at||null,approved=at('plan.approved');
 if(!approved||['reported','proposed','rejected'].includes(i.status))return {pending:true};
 if(plan&&!plan.dispatch)return {at:Math.max(approved+STEP.remote,now+STEP.check)};
 const dispatched=at('dispatched')||Math.max(approved+STEP.dispatch,now);
 const departed=i.departed||Math.max(dispatched+STEP.dispatch,now);
 const arrived=at('on_site')||Math.max(departed+STEP.travel,now);
 const repaired=i.repair_at||Math.max(arrived+STEP.repair,now);
 return {at:Math.max(repaired+STEP.check,now+STEP.check)};
}
function eventsOf(s,id){return s.all('SELECT kind,at FROM noc_events WHERE incident_id=? ORDER BY at,rowid',id);}
function incident(s,id){const row=s.get('SELECT * FROM noc_incidents WHERE id=?',id);return row?{...row,plan:row.plan?JSON.parse(row.plan):null}:null;}

// La promesse faite au client : la première heure annoncée, gardée pour savoir si Moov tient parole.
function promise(s,i,now=Date.now()){
 const e=estimate(i,eventsOf(s,i.id),now);if(!e||e.power||e.pending)return e;
 const current=slot(e.at);let row=s.get('SELECT * FROM noc_eta WHERE incident_id=?',i.id);
 // Pendant le remplissage de la démo l'horloge est reculée : rien n'est promis avec une heure fausse.
 if(!row&&s.demoSeeding)return {at:current,label:clock(current),promised:current,late:false};
 if(!row){s.run('INSERT INTO noc_eta VALUES(?,?,?,?)',i.id,current,current,now);row={promised:current,announced:current,notified:now};}
 return {at:current,label:clock(current),promised:row.promised,late:current>row.promised};
}
// Ajoute l'heure de retour aux dossiers que voit le client (noc-store.client).
function decorate(s,item){if(!item||item.mode!=='demo'||!OPEN(item))return item;const i=incident(s,item.id);const r=i?promise(s,i):null;return r?{...item,restore:r}:item;}

// Toutes les 5 secondes (avec scan) : si l'heure glisse, le client est prévenu avant de s'inquiéter.
function tick(s,now=Date.now()){
 for(const {id} of s.all("SELECT id FROM noc_incidents WHERE mode='demo' AND status NOT IN ('resolved','closed','reported')")){
  if(s.demoSeeding)return;const i=incident(s,id),r=promise(s,i,now);if(!r||r.power||r.pending)continue;
  const row=s.get('SELECT * FROM noc_eta WHERE incident_id=?',id);
  if(r.at>row.announced&&now-row.notified>=NOTICE_GAP){
   s.run('UPDATE noc_eta SET announced=?,notified=? WHERE incident_id=?',r.at,now,id);
   N().event(s,id,null,'eta.updated','Petit retard : votre internet devrait revenir vers '+r.label+'. Nous vous prévenons à chaque étape. Vous n’avez pas à vous inquiéter.',{at:r.at,promised:row.promised});
  }
 }
}

// Ce que dit le serveur vocal quand le client appelle Moov depuis l'application.
const CAUSE={FIBER_CUT_DISTRIBUTION:'un câble de fibre est coupé',ROADWORK_CUT:'un chantier a arraché un câble',CABINET_FLOOD:'une armoire de rue a pris l’eau',CABLE_THEFT:'un câble a été volé',OLT_FAILURE:'un équipement central est en panne',UPLINK_CONGESTION:'le réseau est très chargé',POWER_OUTAGE:'le courant est coupé (CIE)'};
const STAGE={proposed:'Une équipe Moov prépare l’intervention.',approved:'L’intervention est validée.',dispatched:'Un technicien est affecté.',en_route:'Le technicien est en route.',on_site:'Le technicien est sur place.',verifying:'La réparation est faite, nous vérifions.'};
// « Grand-Bassam · Quartier France » se dit « dans votre quartier (Quartier France, Grand-Bassam) ».
function where(zone){const [commune,area]=String(zone||'').split(' · ');if(!commune)return 'dans votre quartier';if(area==='toute la commune')return 'dans toute la commune de '+commune;return 'dans votre quartier ('+(area?area+', ':'')+commune+')';}
function call(s,uid,d){
 insist(d&&['start','end'].includes(d.type),'Action inconnue.');s.rate('call:'+uid,40);
 const me=s.get('SELECT name FROM users WHERE id=?',uid),first=String(me?.name||'').split(' ')[0];
 const list=N().client(s,uid).incidents.filter(x=>x.mode==='demo'&&!x.terminal),item=list[0]||null;
 if(d.type==='start'){
  if(!item)return {known:false,lines:['Bonjour'+(first?' '+first:'')+', ici Moov.','Aucune panne n’est signalée dans votre quartier en ce moment.','Guardian peut vérifier votre box tout de suite, sans attendre.'],choices:['guardian','called']};
  const r=item.restore,cause=CAUSE[item.cause]||'une panne touche le quartier';
  return {known:true,incident:item.id,zone:item.zone,restore:r||null,lines:['Bonjour'+(first?' '+first:'')+', ici Moov.','Nous savons déjà qu’internet est coupé '+where(item.zone)+' : '+cause+'.',STAGE[item.status]||'Une équipe Moov s’en occupe.',r?.power?'Votre box repartira toute seule au retour du courant.':r?.label?'Internet devrait revenir vers '+r.label+'.':'Vous aurez l’heure de retour dès que le plan est validé. Nous vous prévenons à chaque étape.','Vous n’avez rien à faire. Vous n’avez pas à vous inquiéter.'],choices:['reassured','called']};
 }
 insist(['reassured','called','guardian'].includes(d.outcome),'Choix inconnu.');
 const id=item&&d.incident===item.id?item.id:null,key=id||'none:'+new Date().toISOString().slice(0,10);
 s.run('INSERT INTO noc_calls VALUES(?,?,?,?,?) ON CONFLICT(user_id,incident_key) DO UPDATE SET outcome=excluded.outcome,at=excluded.at',uid,key,id,d.outcome,Date.now());
 return {ok:true,outcome:d.outcome};
}

// Pour l'équipe Moov : sur 24 heures, combien de clients prévenus, combien ont quand même appelé.
// « Appelé » = a choisi un conseiller au serveur vocal, ou a fait son propre signalement dans le même quartier.
function stats(s,now=Date.now()){
 const since=now-24*3600000;
 const rows=s.all("SELECT i.id,i.segment_id,i.status,i.created,g.zone FROM noc_incidents i LEFT JOIN noc_segments g ON g.id=i.segment_id WHERE i.mode='demo' AND i.source='telemetry' AND i.created>=? ORDER BY i.created DESC",since).map(i=>{
  const end=s.get("SELECT MAX(at) AS at FROM noc_events WHERE incident_id=? AND kind IN ('resolved','closed')",i.id)?.at||now;
  const informed=s.get('SELECT COUNT(DISTINCT n.user_id) AS n FROM noc_notifications n JOIN noc_events e ON e.id=n.event_id JOIN noc_members m ON m.user_id=n.user_id WHERE e.incident_id=?',i.id).n;
  const opened=s.get('SELECT COUNT(DISTINCT n.user_id) AS n FROM noc_notifications n JOIN noc_events e ON e.id=n.event_id JOIN noc_members m ON m.user_id=n.user_id WHERE e.incident_id=? AND n.read_at IS NOT NULL',i.id).n;
  const callers=new Set(s.all("SELECT user_id FROM noc_calls WHERE incident_id=? AND outcome='called'",i.id).map(r=>r.user_id));
  for(const r of s.all("SELECT reporter FROM noc_incidents WHERE segment_id=? AND source<>'telemetry' AND reporter IS NOT NULL AND created>=? AND created<=?",i.segment_id,i.created,end))callers.add(r.reporter);
  const reassured=s.get("SELECT COUNT(*) AS n FROM noc_calls WHERE incident_id=? AND outcome<>'called'",i.id).n;
  const zone=String(i.zone||i.segment_id||'').split(' · ');
  return {id:i.id,segment:i.segment_id,zone:zone[1]&&zone[1]!==zone[0]?zone[1]:zone[0],status:i.status,open:OPEN(i),informed,opened,reassured,called:callers.size,avoided:Math.max(0,informed-callers.size)};
 });
 const sum=k=>rows.reduce((a,r)=>a+r[k],0);
 return {since,incidents:rows.length,informed:sum('informed'),opened:sum('opened'),reassured:sum('reassured'),called:sum('called'),avoided:sum('avoided'),rows:rows.slice(0,5)};
}

module.exports={migrate,estimate,promise,decorate,tick,call,stats,clock,STEP};
