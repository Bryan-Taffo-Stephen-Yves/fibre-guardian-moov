'use strict';
// Retention Score (thème 6) : pour chaque client, un risque de départ de 0 à 100 calculé sur les 30 derniers jours
// à partir de ce que l'application voit vraiment : pannes subies dans son quartier, heure de retour non tenue,
// appels à Moov, signalements, note donnée au technicien, mots de départ dits à Guardian, ligne saturée.
// Chaque point du score est expliqué, et une action est conseillée. Guardian ne contacte personne seul :
// c'est un conseiller qui appelle ou propose un geste.
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const crypto=require('node:crypto');
const DAY=86400000,WINDOW=30*DAY;
const LEAVE=/resili|(annuler|arreter|stopper|couper) (mon |l')?abonnement|quitter moov|changer d'operateur|aller chez (orange|mtn)|je (vais|veux) partir/;
const fold=t=>String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’]/g,"'");
const LEVELS=[[60,'eleve','Risque élevé'],[30,'moyen','À surveiller'],[0,'faible','Faible']];

function shortName(name){const p=String(name||'').trim().split(/\s+/).filter(Boolean);return p.length?p[0]+(p[1]?' '+p[1][0].toUpperCase()+'.':''):'Client';}

// Facteurs d'un client. data : lignes déjà lues (voir scores), pour une seule lecture de la base.
function factorsFor(c,data,now){
 const f=[],add=(key,points,text)=>{if(points>0)f.push({key,points,text});};
 const inc=data.incidents.filter(i=>i.segment_id===c.segment&&i.created>=now-WINDOW);
 const long=inc.filter(i=>(['resolved','closed'].includes(i.status)?i.updated:now)-i.created>4*3600000);
 add('pannes',Math.min(45,inc.length*15),inc.length+' panne'+(inc.length>1?'s':'')+' dans son quartier en 30 jours');
 add('longue',long.length?10:0,'Une coupure de plus de 4 heures');
 const late=inc.filter(i=>{const e=data.eta.get(i.id);return e&&(['resolved','closed'].includes(i.status)?i.updated:now)>e.promised+15*60000;});
 add('retard',late.length?15:0,'Heure de retour promise non tenue');
 const calls=data.calls.filter(x=>x.user_id===c.id&&x.at>=now-WINDOW).length;
 add('appels',Math.min(20,calls*10),calls+' appel'+(calls>1?'s':'')+' à Moov');
 const reports=data.reports.filter(x=>x.user_id===c.id&&x.created>=now-WINDOW).length;
 add('signalements',Math.min(15,reports*5),reports+' signalement'+(reports>1?'s':'')+' envoyé'+(reports>1?'s':''));
 const notes=data.feedback.filter(x=>x.user_id===c.id&&x.created>=now-WINDOW),worst=notes.length?Math.min(...notes.map(n=>n.rating)):null;
 add('note',worst!==null&&worst<=2?20:worst===3?5:0,'A noté le technicien '+worst+'/5');
 const said=(c.messages||[]).some(m=>m.role==='user'&&LEAVE.test(fold(m.meaning||m.text)));
 add('depart',said?30:0,'A parlé de résilier à Guardian');
 add('sature',c.saturation>=.1?10:0,'Ligne à fond '+Math.round(c.saturation*100)+' % du temps');
 return f;
}

// L'action conseillée découle du facteur le plus lourd.
function actionFor(f){
 const has=k=>f.some(x=>x.key===k);
 if(has('depart'))return {kind:'appel',text:'Appeler aujourd’hui : un conseiller écoute ce qui ne va pas avant toute résiliation.'};
 if(has('retard')||has('longue')||has('pannes')&&f.find(x=>x.key==='pannes').points>=30)return {kind:'geste',text:'Proposer un geste pour les coupures subies, validé par un responsable.'};
 if(has('note'))return {kind:'excuse',text:'Rappeler le client au sujet de l’intervention mal notée.'};
 if(has('sature'))return {kind:'forfait',text:'Lui proposer le forfait adapté à son usage (bilan du forfait).'};
 if(has('appels')||has('signalements'))return {kind:'suivi',text:'Lui envoyer un point sur ses demandes en cours.'};
 return {kind:'rien',text:'Rien à faire.'};
}

const hasTable=s=>!!s.get("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='retention_suivis'");
function scores(s,uid,now=Date.now()){
 O.requireOperator(s,uid);
 const staff=new Set([...s.all('SELECT user_id FROM operator_grants'),...s.all('SELECT user_id FROM noc_field_accounts')].map(r=>r.user_id));
 const members=s.all('SELECT m.user_id AS id,m.segment_id AS segment,u.name,g.zone FROM noc_members m JOIN users u ON u.id=m.user_id LEFT JOIN noc_segments g ON g.id=m.segment_id').filter(c=>!staff.has(c.id));
 const data={incidents:s.all("SELECT id,segment_id,status,created,updated FROM noc_incidents WHERE mode='demo' AND created>=? AND status NOT IN ('false_alarm','rejected')",now-WINDOW),
  eta:new Map(s.all('SELECT * FROM noc_eta').map(e=>[e.incident_id,e])),calls:s.all('SELECT user_id,at FROM noc_calls WHERE at>=?',now-WINDOW),
  reports:s.all('SELECT user_id,created FROM citizen_reports WHERE created>=?',now-WINDOW),feedback:s.all('SELECT user_id,rating,created FROM noc_feedback WHERE created>=?',now-WINDOW)};
 const usage=new Map(s.all('SELECT user_id,SUM(covered_ms) AS c,SUM(saturated_ms) AS sat FROM journey_usage_minutes WHERE at>=? GROUP BY user_id',now-7*DAY).map(r=>[r.user_id,r.c?r.sat/r.c:0]));
 const states=new Map(s.all('SELECT user_id,body FROM journey_state').map(r=>{try{return [r.user_id,JSON.parse(r.body)];}catch{return [r.user_id,{}];}}));
 const follow=new Map((hasTable(s)?s.all('SELECT * FROM retention_suivis'):[]).map(r=>[r.user_id,r]));
 const clients=members.map(m=>{
  const st=states.get(m.id)||{},plan=st.plan||{mbps:100,price:20000};
  const c={id:m.id,segment:m.segment,messages:st.messages,saturation:usage.get(m.id)||0};
  const factors=factorsFor(c,data,now),score=Math.min(100,factors.reduce((a,x)=>a+x.points,0)),[,level,label]=LEVELS.find(([min])=>score>=min);
  const sv=follow.get(m.id),suivi=sv?{calledAt:sv.called_at||null,outcome:sv.outcome||null,outcomeText:OUTCOMES[sv.outcome]||null,offerAt:sv.offer_at||null,offerLabel:sv.offer_label||null}:null;
  return {id:m.id,name:shortName(m.name),zone:m.zone||'',score,level,label,factors,action:actionFor(factors),offer:offerFor(factors,plan),suivi,plan:{mbps:plan.mbps,price:plan.price},yearly:(plan.price||0)*12};
 }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
 const atRisk=clients.filter(c=>c.level!=='faible');
 return {at:now,windowDays:30,total:clients.length,high:clients.filter(c=>c.level==='eleve').length,watch:clients.filter(c=>c.level==='moyen').length,
  revenueAtRisk:atRisk.reduce((a,c)=>a+c.yearly,0),clients:clients.slice(0,50)};
}

// Ce que fait le conseiller (thème 6 : appel proactif et offre de rétention). Guardian prépare l'offre selon la cause,
// le conseiller l'envoie : le client la reçoit en tête de ses notifications. Dans la démonstration, aucune facture n'est modifiée.
const OUTCOMES={reste:'Rassuré, il reste',hesite:'Hésite encore',absent:'Pas de réponse'};
const money=n=>Math.round(n).toLocaleString('fr-FR').replace(/\s/g,' ')+' F';
function offerFor(f,plan){
 const has=k=>f.some(x=>x.key===k),price=plan.price||20000;
 if(has('depart'))return {kind:'mois',label:'1 mois offert ('+money(price)+')',text:'Pour vous remercier de rester avec Moov, votre prochain mois est offert, soit '+money(price)+' en moins sur votre facture.'};
 if(has('sature'))return {kind:'monter',label:'3 mois au débit supérieur, au même prix',text:'Pendant 3 mois, vous passez au débit supérieur sans payer plus. Votre maison ne sera plus à l’étroit le soir.'};
 if(has('note'))return {kind:'visite',label:'Visite de contrôle offerte',text:'Un technicien repasse chez vous, sans frais, pour vérifier l’installation à l’heure qui vous arrange.'};
 return {kind:'boost',label:'Débit doublé pendant 1 mois',text:'Pour les désagréments de ce mois, votre débit est doublé pendant 1 mois, sans rien payer en plus.'};
}
function migrate(s){s.db.exec(`CREATE TABLE IF NOT EXISTS retention_suivis(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 called_at INTEGER,outcome TEXT,called_by TEXT,offer_kind TEXT,offer_label TEXT,offer_at INTEGER,offer_by TEXT)`);}
function act(s,uid,d,now=Date.now()){
 return s.transaction(()=>{
  O.requireOperator(s,uid);
  insist(d&&typeof d.client==='string'&&['appel','offre'].includes(d.action),'Action inconnue.');
  const c=scores(s,uid,now).clients.find(x=>x.id===d.client);insist(c,'Client introuvable.',404);
  s.run('INSERT OR IGNORE INTO retention_suivis(user_id) VALUES(?)',c.id);
  if(d.action==='appel'){
   insist(Object.hasOwn(OUTCOMES,d.outcome),'Choisissez le résultat de l’appel.');
   s.run('UPDATE retention_suivis SET called_at=?,outcome=?,called_by=? WHERE user_id=?',now,d.outcome,uid,c.id);
   s.event(null,uid,'retention.appel',OUTCOMES[d.outcome]);
  }else{
   const prev=s.get('SELECT offer_at FROM retention_suivis WHERE user_id=?',c.id);
   insist(!prev.offer_at||now-prev.offer_at>WINDOW,'Une offre a déjà été envoyée à ce client ce mois-ci.',409);
   const o=c.offer;
   s.run('UPDATE retention_suivis SET offer_kind=?,offer_label=?,offer_at=?,offer_by=? WHERE user_id=?',o.kind,o.label,now,uid,c.id);
   const J=require('./journey-store.cjs'),st=J.get(s,c.id);
   if(st){st.notifications=st.notifications||[];st.notifications.unshift({key:'retention:'+crypto.randomUUID(),home:'home-1',at:now,title:'Une attention de Moov pour vous',body:o.text+' Rien à faire de votre côté.',read:false});st.notifications=st.notifications.slice(0,100);J.put(s,c.id,st);}
   s.event(null,uid,'retention.offre',o.label);
  }
  return scores(s,uid,now);
 });
}
module.exports={migrate,scores,factorsFor,actionFor,offerFor,act,OUTCOMES,LEAVE,fold,WINDOW};
