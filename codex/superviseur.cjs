'use strict';
// Guardian Superviseur : l'agent qui regarde tout le réseau pour l'équipe Moov.
// Il lit ce que voient déjà les autres agents (détection des pannes, plans d'intervention, Labo réseau,
// équipes terrain, serveur vocal, WhatsApp, prévisions) et en fait un bulletin, une liste de problèmes
// classés avec la cause probable et un conseil, et un journal. Il ne déclenche jamais rien :
// chaque conseil mène à l'écran où un responsable valide, comme avant (rôles vérifiés par le serveur).
// Les questions de l'équipe sont répondues par des règles ; avec la clé ANTHROPIC_API_KEY, Claude rédige
// la réponse à partir du même état, sans pouvoir ajouter de chiffre (garde-fous de guardian-ai.cjs).
const O=require('./operator-store.cjs'),N=require('./noc-store.cjs'),L=require('./labo.cjs'),A=require('./appels.cjs'),AI=require('./guardian-ai.cjs');
const {id,insist,paragraph}=require('./pilot-model.cjs');

const LEVELS=['critique','majeure','attention','info'];
const STATUS={reported:'détecté, analyse en cours',proposed:'plan prêt, il attend la validation d’un responsable',approved:'plan validé, équipe à affecter',dispatched:'équipe affectée, départ à confirmer',en_route:'technicien en route',on_site:'technicien sur place',verifying:'réparation déclarée, retour des mesures à vérifier',rejected:'plan refusé, nouvelle analyse à faire'};
// Cause probable et conseil, pour chaque alarme du réseau (mêmes causes que l'analyse des pannes de noc-store.cjs).
const CAUSES={
 LOS:['Fibre coupée entre l’armoire de rue et les poteaux','Envoyer une équipe fibre avec un réflectomètre pour trouver l’endroit exact de la coupure.'],
 LOS_WORKS:['Câble arraché par un chantier','Envoyer une équipe fibre et faire un constat avec l’entreprise du chantier pour se faire rembourser.'],
 DYING_GASP:['Coupure de courant dans le quartier, la fibre est intacte','Prévenir les clients et attendre le retour du courant : inutile d’envoyer un technicien.'],
 UPLINK_HIGH:['Liaison saturée par le trafic, ce n’est pas une coupure','Transmettre au responsable capacité et surveiller le retour de la latence.'],
 WATER:['Eau dans une armoire de rue','Attendre le retrait de l’eau avant d’envoyer l’équipe : personne n’ouvre une armoire sous l’eau.'],
 INTRUSION:['Vol de câble probable, le boîtier a été ouvert','Envoyer l’équipe avec une consigne de sécurité et déclarer le vol au commissariat.'],
 OLT_DOWN:['Carte de la centrale en panne : toute la commune est coupée','Redémarrer la centrale à distance après validation d’un responsable.']
};
const FLAWS={dirty:['Connecteur sale chez le client','Prévoir un passage pour nettoyer le connecteur (environ 10 minutes) avant que la box décroche.'],bend:['Câble trop plié près de la box','Prévoir un passage pour reposer le câble avant que la box décroche.']};
const SCENARIO_WORDS={fiber:'une coupure de fibre',pole:'un poteau abattu',power:'une coupure de courant',congestion:'une saturation',works:'un chantier',flood:'une inondation',theft:'un vol de câble',olt:'une panne de la centrale'};

const plainZone=zone=>{const [commune,area]=String(zone||'').split(' · ');return area&&area!==commune?commune+' · '+area:commune;};
const minutes=ms=>{const m=Math.max(0,Math.round(ms/60000));return m<1?'moins d’une minute':m===1?'1 minute':m<120?m+' minutes':Math.round(m/60)+' heures';};
const dbm=v=>v===null||v===undefined?'—':String(v).replace('.',',')+' dBm';
const clock=at=>A.clock(at);

function agents(s,{settings,ports,incidents,pending,technicians,calls,whatsapp,forecasts,now}){
 const total=ports.reduce((n,p)=>n+p.total,0),weak=ports.reduce((n,p)=>n+p.flagged.length,0);
 const free=technicians.filter(t=>!t.busy).length,busy=technicians.length-free;
 const scanAge=settings.last_scan?now-settings.last_scan:null;
 const errors=(whatsapp?.sent||[]).filter(m=>m.status==='failed'&&m.at>now-3600000).length;
 return [
  {key:'detection',name:'Détection des pannes',icon:'radar',tone:settings.paused?'warn':scanAge!==null&&scanAge>60000?'warn':'ok',
   text:settings.paused?'Suspendue par un administrateur : rien de nouveau n’est détecté.':'Regarde les '+ports.length+' quartiers toutes les 5 secondes.'+(scanAge!==null&&scanAge>60000?' Dernier passage il y a '+minutes(scanAge)+'.':'')},
  {key:'analyse',name:'Analyse et plans',icon:'brain',tone:pending.length?'warn':'ok',
   text:pending.length?pending.length+(pending.length>1?' plans attendent':' plan attend')+' la validation d’un responsable.':incidents.length?'Plans prêts pour les '+incidents.length+' dossiers ouverts.':'Aucun dossier à analyser.'},
  {key:'labo',name:'Mesures du Labo',icon:'pulse',tone:weak?'warn':'ok',
   text:total+' box mesurées toutes les 2 secondes'+(weak?' · '+weak+(weak>1?' signaux faibles.':' signal faible.'):', aucune box faible.')},
  {key:'terrain',name:'Équipes terrain',icon:'truck',tone:!free&&incidents.some(i=>i.status==='approved')?'bad':busy?'info':'ok',
   text:busy+(busy>1?' techniciens en mission':' technicien en mission')+', '+free+(free>1?' disponibles.':' disponible.')},
  {key:'appels',name:'Serveur vocal 111',icon:'phone',tone:'ok',
   text:calls.reassured?calls.reassured+(calls.reassured>1?' clients rassurés':' client rassuré')+' par le message de panne en 24 h.':'Prêt à annoncer les pannes et l’heure de retour.'},
  {key:'whatsapp',name:'Messages WhatsApp',icon:'chat',tone:errors?'warn':whatsapp?.on?'ok':'info',
   text:errors?errors+(errors>1?' messages refusés':' message refusé')+' dans l’heure.':whatsapp?.on?'Branché sur '+whatsapp.phones+(whatsapp.phones>1?' téléphones':' téléphone')+'.':'Les messages s’affichent dans le téléphone de l’application.'},
  {key:'prevision',name:'Prévisions',icon:'trend',tone:forecasts.length?'warn':'ok',
   text:forecasts.length?forecasts.length+(forecasts.length>1?' lignes perdent':' ligne perd')+' de la lumière : coupure à prévenir.':'Aucune ligne qui faiblit.'},
  {key:'clients',name:'Guardian des clients',icon:'spark',tone:'ok',text:'Répond aux clients en français, en nouchi et en dioula.'}
 ];
}

function findings(s,{ports,incidents,technicians,forecasts,olts,now,signals}){
 const out=[],open=seg=>incidents.find(i=>i.segment_id===seg);
 const freeTechs=technicians.filter(t=>!t.busy);
 for(const p of ports){
  if(p.alarm==='NONE'||p.alarm==='UPSTREAM')continue;
  const i=open(p.id),[cause,advice]=CAUSES[p.alarm]||['Cause à confirmer sur place','Envoyer une équipe pour vérifier.'];
  const siblings=p.alarm==='OLT_DOWN'?ports.filter(x=>x.alarm==='UPSTREAM'&&x.commune===p.commune):[];
  const off=p.total-p.online+siblings.reduce((n,x)=>n+x.total-x.online,0),all=p.total+siblings.reduce((n,x)=>n+x.total,0);
  const title=p.alarm==='UPLINK_HIGH'?'Liaison saturée à '+plainZone(p.zone):p.alarm==='OLT_DOWN'?'Toute la commune de '+p.commune+' est coupée':off+' box sur '+all+' éteintes à '+plainZone(p.zone);
  const facts=[{label:'Box en ligne',value:(all-off)+' sur '+all},{label:'Depuis',value:p.since?minutes(now-p.since):'à l’instant'}];
  if(p.alarm==='UPLINK_HIGH')facts.push({label:'Charge de la liaison',value:String(p.utilisation).replace('.',',')+' %'},{label:'Temps de réponse',value:Math.round(p.latency)+' ms'});
  else if(p.rxAvg!==null)facts.push({label:'Lumière moyenne des box restantes',value:dbm(p.rxAvg)});
  let next=advice,go={page:'incidents',label:'Ouvrir le dossier'};
  if(i){
   facts.push({label:'Dossier',value:STATUS[i.status]||i.status});
   if(i.status==='proposed'){next='Validez le plan préparé : il attend depuis '+minutes(now-i.updated)+'. '+advice;go={page:'approvals',label:'Examiner le plan à valider'};}
   else if(i.status==='approved'){next=freeTechs.length?'Affectez un technicien : '+freeTechs[0].name+' est disponible.':'Aucun technicien libre : rappelez une équipe ou libérez une mission.';go={page:'missions',label:'Affecter une équipe'};}
   else if(['dispatched','en_route','on_site'].includes(i.status)){const t=technicians.find(t=>t.id===i.technician);next=(t?t.name+' ':'L’équipe ')+(i.status==='on_site'?'est sur place.':i.status==='en_route'?'est en route.':'doit confirmer son départ.')+' Je préviens les clients à chaque étape.';go={page:'missions',label:'Suivre l’équipe'};}
   else if(i.status==='verifying'){next='Vérifiez le retour des mesures avant de clore le dossier.';go={page:'incidents',label:'Vérifier le rétablissement'};}
  }else facts.push({label:'Dossier',value:'ouverture au prochain passage de la détection'});
  out.push({key:'panne:'+p.id,level:p.tone==='down'?'critique':'majeure',segment:p.id,zone:plainZone(p.zone),title,cause,facts,advice:next,go:{...go,incidentId:i?.id||null,segment:p.id},since:p.since||now,incidentId:i?.id||null});
 }
 // Plan qui attend trop longtemps : on le fait remonter, même si la panne est « seulement » majeure.
 for(const f of out)if(f.go.page==='approvals'){const i=incidents.find(x=>x.id===f.incidentId);if(i&&now-i.updated>180000)f.level='critique';}
 for(const o of olts){
  if(o.board!=='En service')continue;
  if(o.cpu>=80||o.uplink>=90)out.push({key:'centrale:'+o.commune,level:'majeure',segment:null,zone:o.commune,title:'Centrale de '+o.commune+' très chargée',cause:o.uplink>=90?'Trafic de la commune au maximum de la liaison':'Processeur de la centrale très sollicité',facts:[{label:'Processeur',value:o.cpu+' %'},{label:'Liaison',value:String(o.uplink).replace('.',',')+' %'},{label:'Température',value:String(o.temperature).replace('.',',')+' °C'}],advice:'Surveiller la centrale et prévenir le responsable capacité si la charge reste haute.',go:{page:'labo',label:'Voir la centrale dans le Labo',segment:ports.find(p=>p.commune===o.commune)?.id||null},since:now});
 }
 for(const p of ports)for(const o of p.flagged){
  const [cause,advice]=FLAWS[o.flaw]||['Fibre fatiguée ou soudure abîmée','Prévoir une mesure au réflectomètre sur cette branche.'];
  const weak=o.status==='weak';
  out.push({key:'signal:'+p.id+':'+o.n,level:weak?'attention':'info',segment:p.id,zone:plainZone(p.zone),title:(weak?'Signal trop faible':'Signal proche du seuil')+' sur la box '+o.n+' à '+plainZone(p.zone),cause:cause+' (probable)',
   facts:[{label:'Lumière reçue',value:dbm(o.rx)},{label:'Seuil d’alarme',value:dbm(L.THRESHOLDS.RX_ALARM)},{label:'Erreurs corrigées',value:o.fec+' par seconde'}],
   advice:weak?advice:'Rien d’urgent. '+advice,go:{page:'labo',label:'Voir la box dans le Labo',segment:p.id},since:now});
 }
 for(const f of forecasts)out.push({key:'prevision:'+f.segment+':'+f.name,level:f.daysLeft<=3?'majeure':'attention',segment:f.segment,zone:f.zone,title:'Ligne de '+f.name+' : coupure prévue dans '+f.daysLeft+(f.daysLeft>1?' jours':' jour'),cause:'La lumière reçue baisse un peu chaque jour',facts:[{label:'Lumière aujourd’hui',value:dbm(f.current)}],advice:f.prevention?'Passage préventif déjà proposé au client.':'Proposer un passage au client avant la coupure.',go:{page:'operations',label:'Voir dans le Centre d’opérations'},since:now});
 const assigned=incidents.filter(i=>i.status==='approved');
 if(assigned.length&&!freeTechs.length)out.push({key:'equipe:aucune',level:'critique',segment:null,zone:'Équipes',title:'Aucun technicien libre pour '+assigned.length+(assigned.length>1?' plans validés':' plan validé'),cause:'Toutes les équipes sont déjà en mission',facts:[{label:'Techniciens',value:technicians.length+' en mission'}],advice:'Rappeler une équipe d’astreinte ou attendre la fin d’une mission.',go:{page:'missions',label:'Voir les équipes'},since:now});
 // Une transmission vaut pour ce dossier-là : une nouvelle panne au même endroit repart de zéro.
 for(const f of out){const sig=signals[f.key];if(sig&&sig.incidentId===(f.incidentId||null))f.signaled={by:sig.by,at:sig.at};}
 return out.sort((a,b)=>LEVELS.indexOf(a.level)-LEVELS.indexOf(b.level)||a.since-b.since);
}

function headline(list,{online,total,ports}){
 const top=list[0],count=level=>list.filter(f=>f.level===level).length;
 const crit=count('critique'),maj=count('majeure'),att=count('attention');
 if(crit)return {tone:'bad',text:'Attention : '+(crit>1?crit+' problèmes graves en cours':'un problème grave en cours')+'. Le plus urgent : '+top.title.charAt(0).toLowerCase()+top.title.slice(1)+'.'};
 if(maj)return {tone:'warn',text:(maj>1?maj+' problèmes à traiter':'Un problème à traiter')+' : '+top.title.charAt(0).toLowerCase()+top.title.slice(1)+'. Le reste du réseau va bien.'};
 if(att)return {tone:'watch',text:'Le réseau va bien : '+online+' box sur '+total+' en ligne. '+(att>1?att+' points à surveiller':'Un point à surveiller')+', rien d’urgent.'};
 return {tone:'ok',text:'Tout va bien sur les '+ports.length+' quartiers : '+online+' box sur '+total+' en ligne.'};
}

// Le journal de l'agent : ce qu'il a vu et ce qui a été décidé, à la première personne.
function journal(s,ports,now){
 const zoneOf=seg=>plainZone(ports.find(p=>p.id===seg)?.zone||seg);
 const rows=s.all("SELECT e.kind,e.public_text,e.detail,e.at,i.segment_id,u.name AS actor FROM noc_events e LEFT JOIN noc_incidents i ON i.id=e.incident_id LEFT JOIN users u ON u.id=e.actor WHERE e.at>? AND (e.incident_id IS NULL OR i.mode='demo') AND e.kind IN ('simulation','telemetry.recovered','detected','plan.proposed','approved','dispatched','resolved','closed','superviseur.signal') ORDER BY e.at DESC,e.rowid DESC LIMIT 30",now-6*3600000);
 return rows.map(r=>{
  let d={};try{d=JSON.parse(r.detail||'{}');}catch{}
  const zone=zoneOf(r.segment_id||d.segment);
  const text={
   simulation:()=>d.scenario==='normal'?'J’ai vu les box de '+zone+' se reconnecter.':d.scenario==='congestion'?'J’ai vu la liaison de '+zone+' saturer.':'J’ai vu des box s’éteindre à '+zone+' : sans doute '+(SCENARIO_WORDS[d.scenario]||'une panne')+'.',
   'telemetry.recovered':()=>'Les mesures sont revenues à la normale.',
   detected:()=>'J’ai ouvert un dossier pour '+zone+', avant tout appel de client.',
   'plan.proposed':()=>'J’ai préparé le plan « '+(d.plan?.title||'intervention')+' » et je l’ai envoyé pour validation.',
   approved:()=>(r.actor||'Un responsable')+' a validé le plan pour '+zone+'.',
   dispatched:()=>'Équipe affectée à '+zone+'.',
   resolved:()=>'Retour du réseau vérifié à '+zone+'.',
   closed:()=>'Dossier de '+zone+' clos.',
   'superviseur.signal':()=>(r.actor||'Un membre de l’équipe')+' a transmis au responsable : '+(d.title||'un problème')+'.'
  }[r.kind];
  return text?{at:r.at,kind:r.kind,tone:r.kind==='simulation'&&d.scenario!=='normal'?'bad':['resolved','telemetry.recovered'].includes(r.kind)||d.scenario==='normal'?'ok':'info',text:text()}:null;
 }).filter(Boolean).slice(0,20);
}

function bilan(s,uid,{whatsapp=null,now=Date.now()}={}){
 O.requireOperator(s,uid);
 const labo=L.snapshot(s,uid,{},now),ports=labo.ports,settings=s.get('SELECT * FROM noc_settings WHERE id=1');
 const incidents=s.all("SELECT * FROM noc_incidents WHERE mode='demo' AND status NOT IN ('resolved','closed') ORDER BY created");
 const pending=incidents.filter(i=>i.status==='proposed');
 const technicians=N.teamView(s);
 const forecasts=N.forecasts(s,now),calls=A.stats(s,now);
 const signals={};for(const r of s.all("SELECT e.detail,e.at,u.name FROM noc_events e LEFT JOIN users u ON u.id=e.actor WHERE e.kind='superviseur.signal' AND e.at>? ORDER BY e.at",now-3600000)){try{const d=JSON.parse(r.detail);signals[d.key]={by:r.name||'Équipe',at:r.at,incidentId:d.incidentId||null};}catch{}}
 const list=findings(s,{ports,incidents,technicians,forecasts,olts:labo.olts,now,signals});
 const online=ports.reduce((n,p)=>n+p.online,0),total=ports.reduce((n,p)=>n+p.total,0);
 const touched=ports.filter(p=>p.alarm!=='NONE').length;
 return {at:now,headline:headline(list,{online,total,ports}),
  numbers:{online,total,touched,quartiers:ports.length,open:incidents.length,pending:pending.length,free:technicians.filter(t=>!t.busy).length,technicians:technicians.length,avoided:calls.avoided,reassured:calls.reassured},
  quartiers:ports.map(p=>({id:p.id,zone:plainZone(p.zone),commune:p.commune,tone:p.tone,online:p.online,total:p.total})),
  agents:agents(s,{settings,ports,incidents,pending,technicians,calls,whatsapp,forecasts,now}),
  findings:list.slice(0,12),journal:journal(s,ports,now)};
}

// Transmettre un problème au responsable : une ligne datée dans le journal, visible par toute l'équipe.
// Aucune commande réseau, aucune notification aux clients (l'événement n'est rattaché à aucun dossier).
function signal(s,uid,d,options={}){
 O.requireOperator(s,uid);
 const key=String(d?.key||'');insist(key&&key.length<=120,'Problème inconnu.');
 const b=bilan(s,uid,options),f=b.findings.find(x=>x.key===key);insist(f,'Ce problème n’est plus d’actualité.',404);
 insist(!f.signaled,'Déjà transmis au responsable.',409);
 s.rate('superviseur-signal:'+uid,20,600000);
 s.run('INSERT INTO noc_events VALUES(?,?,?,?,?,?,?)',id(),null,uid,'superviseur.signal','Transmis au responsable : '+f.title,JSON.stringify({key,title:f.title,segment:f.segment,incidentId:f.incidentId||null}),Date.now());
 return bilan(s,uid,options);
}

// Ce que l'agent sait, en lignes de texte : la même chose sert aux règles et à Claude.
function etat(b){
 const n=b.numbers;
 return [
  'Heure à Abidjan : '+clock(b.at),
  'Box en ligne : '+n.online+' sur '+n.total+' ; quartiers surveillés : '+n.quartiers+' ; quartiers touchés : '+n.touched,
  'Dossiers ouverts : '+n.open+' ; plans à valider : '+n.pending,
  'Techniciens disponibles : '+n.free+' sur '+n.technicians,
  'Appels évités sur 24 heures : '+n.avoided+' ; clients rassurés par le serveur vocal : '+n.reassured,
  'Bulletin : '+b.headline.text,
  'Quartiers : '+b.quartiers.map(q=>q.zone+' ('+q.online+'/'+q.total+(q.tone==='ok'?'':q.tone==='down'?', en panne':', à surveiller')+')').join(' ; '),
  ...b.findings.map((f,i)=>'Problème '+(i+1)+' ['+f.level+'] '+f.title+'. Cause probable : '+f.cause+'. '+f.facts.map(x=>x.label+' : '+x.value).join(', ')+'. Conseil : '+f.advice),
  ...b.agents.map(a=>'Agent « '+a.name+' » : '+a.text),
  ...b.journal.slice(0,8).map(j=>'Journal '+clock(j.at)+' : '+j.text)
 ];
}

// Réponse par règles : toujours disponible, et brouillon que Claude peut reformuler.
const lower=text=>text.charAt(0).toLowerCase()+text.slice(1);
const bare=cause=>{const c=cause.replace(/ \(probable\)$/,'');return c.charAt(0).toLowerCase()+c.slice(1);};
function regles(b,question){
 const q=question.toLowerCase(),n=b.numbers,top=b.findings[0];
 const quartier=b.quartiers.find(x=>q.includes(x.zone.split(' · ').pop().toLowerCase())||q.includes(x.commune.toLowerCase()));
 if(quartier){
  const f=b.findings.filter(x=>x.segment===quartier.id);
  return f.length?quartier.zone+' : '+f[0].title.charAt(0).toLowerCase()+f[0].title.slice(1)+'. Cause probable : '+bare(f[0].cause)+'. Mon conseil : '+lower(f[0].advice)
   :quartier.zone+' va bien : '+quartier.online+' box sur '+quartier.total+' en ligne, aucun problème repéré.';
 }
 if(/technicien|équipe|equipe|qui est libre|dispo/.test(q))return n.free+' technicien'+(n.free>1?'s':'')+' sur '+n.technicians+(n.free>1?' sont disponibles':' est disponible')+'. '+(n.open?n.open+' dossier'+(n.open>1?'s sont ouverts':' est ouvert')+' en ce moment.':'Aucun dossier ouvert en ce moment.');
 if(/appel|111|vocal|centre d.appel/.test(q))return 'Sur 24 heures, '+n.avoided+' appel'+(n.avoided>1?'s':'')+' au centre d’appels ont été évités, et '+n.reassured+' client'+(n.reassured>1?'s ont été rassurés':' a été rassuré')+' par le message de panne du 111.';
 if(/valid|plan|attend/.test(q))return n.pending?n.pending+' plan'+(n.pending>1?'s attendent':' attend')+' la validation d’un responsable. '+(b.findings.find(f=>f.go.page==='approvals')?.advice||''):'Aucun plan n’attend de validation.';
 if(/directeur|résum|resum|bilan|point|situation|comment va|état|etat/.test(q)||!top)return b.headline.text+' '+n.open+' dossier'+(n.open>1?'s':'')+' ouvert'+(n.open>1?'s':'')+', '+n.free+' technicien'+(n.free>1?'s':'')+' disponible'+(n.free>1?'s':'')+', '+n.avoided+' appel'+(n.avoided>1?'s':'')+' évité'+(n.avoided>1?'s':'')+' sur 24 heures.';
 return 'Le plus urgent : '+top.title.charAt(0).toLowerCase()+top.title.slice(1)+'. Cause probable : '+bare(top.cause)+'. Mon conseil : '+lower(top.advice);
}

async function ask(s,uid,d,options={}){
 O.requireOperator(s,uid);
 const question=paragraph(d?.question,'Question',400);
 s.rate('superviseur-ask:'+uid,40,600000);
 const b=bilan(s,uid,options),draft=regles(b,question);
 const written=await AI.supervise({question,draft,etat:etat(b)},{store:s,uid,log:options.log});
 return {at:b.at,question,answer:written||draft,writer:written?'claude':'regles',bilan:b};
}

module.exports={bilan,signal,ask,etat,regles};
