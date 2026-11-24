'use strict';
// Service client : chaque plainte du client devient un parcours complet, pas un simple bouton.
//  1. Le client se plaint (réclamation, échange de box, technicien pas venu…) : la demande est enregistrée
//     et il voit tout de suite l'heure limite de rappel (« Un conseiller vous appelle avant 15 h 20 »).
//  2. La demande arrive dans la file « À rappeler » des conseillers (Centre d'opérations), la plus urgente d'abord.
//     Un conseiller la prend : le client voit son prénom (« Kader, du service client, s'occupe de votre demande »).
//  3. Le conseiller appelle le client, puis note le résultat : réglé au téléphone, technicien envoyé, échange confirmé,
//     ou pas de réponse (on rappelle, le client est prévenu).
//  4. Le client répond « Oui, c'est réglé » (et note le service) ou « Non, toujours pas » : la demande monte
//     chez un responsable, avec un délai plus court. Sans réponse du client sous 48 h, la demande est close.
//  5. Le Superviseur voit le temps de prise en charge, les retards et la note du service.
// Les modules d'origine (reclamation.cjs, echange-box.cjs, rendezvous.cjs) ouvrent la demande ; ce module mène le parcours.
// Les droits sont vérifiés ici : un conseiller traite le niveau 1, seul un responsable (superviseur, admin) le niveau 2.
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const HOUR=3600000,DAY=24*HOUR,MIN=60000;
const DUE={1:4*HOUR,2:2*HOUR},RETRY=2*HOUR,CONFIRM=48*HOUR,MAX_TRIES=3;
const KINDS={reclamation:'Réclamation',echange:'Échange de box',retard:'Technicien pas venu',demenagement:'Déménagement',panne:'Panne qui revient',eligibilite:'Fibre à mon adresse'};
// Ce que le conseiller peut noter après l'appel. « wait » : la demande attend une suite (technicien, box) avant d'être réglée.
const OUTCOMES={
 regle:{label:'Réglé au téléphone',client:'Votre problème est réglé.'},
 technicien:{label:'Technicien envoyé',client:'Un technicien passe chez vous. Vous le suivez dans « Ma réparation ».',wait:true},
 echange:{label:'Échange confirmé',client:'Votre échange de box est confirmé. Vous suivez chaque étape ici.',wait:true},
 absent:{label:'Pas de réponse',client:null}
};
const STEPS=['Demande reçue','Conseiller','Appel','Réglé','Votre avis'];
const OPEN=['recue','prise','appele'];

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS sc_demandes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,ref TEXT NOT NULL,incident_id TEXT,title TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',level INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'recue',created INTEGER NOT NULL,due INTEGER NOT NULL,agent_id TEXT REFERENCES users(id) ON DELETE SET NULL,agent_name TEXT,taken_at INTEGER,called_at INTEGER,tries INTEGER NOT NULL DEFAULT 0,outcome TEXT,note TEXT,resolved_at INTEGER,answer TEXT,answered_at INTEGER,rating INTEGER,updated INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS sc_user ON sc_demandes(user_id,status);
 CREATE INDEX IF NOT EXISTS sc_ref ON sc_demandes(kind,ref);
 CREATE INDEX IF NOT EXISTS sc_status ON sc_demandes(status,due);
 `);}

const J=()=>require('./journey-store.cjs');
// Les modules d'origine peuvent ouvrir une demande sur une base qui n'a pas encore la table (tests, outils) : on la crée au besoin.
const ready=new WeakSet();
function ensure(s){if(!ready.has(s)){migrate(s);ready.add(s);}}
const hour=t=>new Date(t).toLocaleTimeString('fr-FR',{timeZone:'Africa/Abidjan',hour:'2-digit',minute:'2-digit'}).replace(':','\u00a0h\u00a0');
const sameDay=(a,b)=>new Date(a).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan'})===new Date(b).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan'});
const when=(t,now)=>sameDay(t,now)?hour(t):(sameDay(t,now+DAY)?'demain à ':'le '+new Date(t).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan',day:'numeric',month:'short'})+' à ')+hour(t);
const first=name=>String(name||'').trim().split(/\s+/)[0]||'Un conseiller';
const short=name=>String(name||'Client').split(' ').slice(0,2).join(' ');
const boss=role=>['admin','supervisor'].includes(role);
const has=(s,t)=>!!s.get('SELECT 1 FROM sqlite_master WHERE name=?',t);

function notify(s,uid,title,body,now){
 const st=J().get(s,uid);if(!st)return;st.notifications=st.notifications||[];
 st.notifications.unshift({key:'sc:'+crypto.randomUUID(),home:'home-1',at:now,title,body,read:false,page:'tracking'});
 st.notifications=st.notifications.slice(0,100);J().put(s,uid,st);
}

// Ouvre une demande (une seule ouverte par sujet). silent : le module d'origine a déjà prévenu le client.
function open(s,{uid,kind,ref,incident=null,title,detail='',level=1,due=null,silent=false},now=Date.now()){
 ensure(s);insist(Object.hasOwn(KINDS,kind),'Type de demande inconnu.');
 const cur=s.get("SELECT * FROM sc_demandes WHERE kind=? AND ref=? AND status IN ('recue','prise','appele') ORDER BY created DESC LIMIT 1",kind,String(ref));
 if(cur)return cur.id;
 const id=crypto.randomUUID(),limit=due||now+DUE[level];
 s.run('INSERT INTO sc_demandes(id,user_id,kind,ref,incident_id,title,detail,level,created,due,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,uid,kind,String(ref),incident,String(title).slice(0,120),String(detail||'').slice(0,500),level,now,limit,now);
 if(!silent)notify(s,uid,level>1?'Votre demande monte chez un responsable':'Votre demande est enregistrée',(level>1?'Un responsable':'Un conseiller')+' Moov vous appelle avant '+when(limit,now)+'.',now);
 return id;
}
// Le sujet n'existe plus (le client a annulé sa demande d'échange, par exemple).
function cancelRef(s,kind,ref,now=Date.now()){ensure(s);s.run("UPDATE sc_demandes SET status='annulee',updated=? WHERE kind=? AND ref=? AND status IN ('recue','prise','appele')",now,kind,String(ref));}
// Le module d'origine dit que c'est réglé (réponse à la réclamation, box échangée) : on demande au client s'il est d'accord.
function settle(s,kind,ref,{outcome='regle',message=null,by=null}={},now=Date.now()){ensure(s);
 const d=s.get("SELECT * FROM sc_demandes WHERE kind=? AND ref=? AND status IN ('recue','prise','appele') ORDER BY created DESC LIMIT 1",kind,String(ref));
 if(!d)return null;
 const agent=by?s.get('SELECT name FROM users WHERE id=?',by):null;
 s.run("UPDATE sc_demandes SET status='reglee',outcome=COALESCE(outcome,?),note=COALESCE(?,note),resolved_at=?,agent_id=COALESCE(agent_id,?),agent_name=COALESCE(agent_name,?),taken_at=COALESCE(taken_at,?),updated=? WHERE id=?",outcome,message,now,by,agent?.name||null,now,now,d.id);
 notify(s,d.user_id,'Est-ce réglé pour vous ?',(message||OUTCOMES[outcome]?.client||'Moov a traité votre demande.')+' Dites-nous si c’est bon dans « Ma réparation ».',now);
 return d.id;
}

// Ce qui avance tout seul à la lecture : une suite terminée (dossier réparé, box échangée), un client qui ne répond pas.
function tick(s,now){
 for(const d of s.all("SELECT * FROM sc_demandes WHERE status='appele'")){
  // Une réparation terminée APRÈS l'appel (pas celle d'avant la réclamation) ; sans nouvelle sous 24 h, on demande au client.
  let done=now-d.called_at>DAY;
  if(d.incident_id&&has(s,'noc_events'))done=done||!!s.get("SELECT 1 FROM noc_events WHERE incident_id=? AND kind IN ('resolved','closed') AND at>?",d.incident_id,d.called_at);
  if(d.kind==='echange'&&has(s,'box_echanges'))done=s.get('SELECT status FROM box_echanges WHERE id=?',d.ref)?.status==='echangee';
  if(done)settle(s,d.kind,d.ref,{},now);
 }
 s.run("UPDATE sc_demandes SET status='confirmee',answer='sans_reponse',answered_at=?,updated=? WHERE status='reglee' AND resolved_at<?",now,now,now-CONFIRM);
}

function steps(d){
 const at={recue:0,prise:1,appele:2,reglee:3,confirmee:4,recours:3,annulee:0}[d.status];
 return STEPS.map((label,k)=>({label:k===1&&d.agent_name?first(d.agent_name):label,done:k<=at||d.status==='confirmee'}));
}
function clientView(d,now){
 const late=OPEN.includes(d.status)&&now>d.due;
 const text={
  recue:late?'Moov est en retard pour vous rappeler. Votre demande est en tête de liste.':(d.level>1?'Un responsable':'Un conseiller')+' Moov vous appelle avant '+when(d.due,now)+'.',
  prise:d.tries&&!d.called_at?'Nous avons essayé de vous appeler, sans réponse. '+first(d.agent_name)+' vous rappelle avant '+when(d.due,now)+'.':first(d.agent_name)+', du service client, s’occupe de votre demande. Il vous appelle avant '+when(d.due,now)+'.',
  appele:first(d.agent_name)+' vous a appelé. '+(OUTCOMES[d.outcome]?.client||''),
  reglee:(d.note||OUTCOMES[d.outcome]?.client||'Moov a traité votre demande.'),
  confirmee:d.answer==='oui'?'Merci : votre demande est close.':'Demande close.',
  recours:'Votre dossier reste ouvert chez Moov. Vous pouvez aussi saisir l’ARTCI.'
 }[d.status]||'';
 return {id:d.id,kind:d.kind,what:KINDS[d.kind],title:d.title,level:d.level,status:d.status,late,text,steps:steps(d),
  agent:d.agent_name?first(d.agent_name):null,canAnswer:d.status==='reglee',canRate:d.status==='confirmee'&&d.answer==='oui'&&!d.rating,rating:d.rating,updated:d.updated};
}

// Ce que voit le client : ses demandes en cours, et celles closes depuis moins de 3 jours.
function mine(s,uid,now=Date.now()){
 tick(s,now);
 return {items:s.all("SELECT * FROM sc_demandes WHERE user_id=? AND status!='annulee' AND (status IN ('recue','prise','appele','reglee') OR updated>?) ORDER BY created DESC LIMIT 10",uid,now-3*DAY).map(d=>clientView(d,now))};
}

// Le client répond : « Oui, c'est réglé » (puis une note), ou « Non, toujours pas » (la demande monte d'un niveau).
function answer(s,uid,d,now=Date.now()){return s.transaction(()=>{
 const r=s.get('SELECT * FROM sc_demandes WHERE id=? AND user_id=?',String(d?.id||''),uid);insist(r,'Demande introuvable.',404);
 if(d.rating!==undefined){
  insist(r.status==='confirmee'&&r.answer==='oui'&&!r.rating,'Cette demande ne se note plus.',409);
  const n=Number(d.rating);insist(Number.isInteger(n)&&n>=1&&n<=5,'Choisissez une note de 1 à 5.');
  s.run('UPDATE sc_demandes SET rating=?,updated=? WHERE id=?',n,now,r.id);
  return mine(s,uid,now);
 }
 insist(r.status==='reglee','Moov n’a pas encore fini de traiter cette demande.',409);
 insist(['oui','non'].includes(d.answer),'Répondez oui ou non.');
 if(d.answer==='oui'){s.run("UPDATE sc_demandes SET status='confirmee',answer='oui',answered_at=?,updated=? WHERE id=?",now,now,r.id);return mine(s,uid,now);}
 if(r.level>=2){
  s.run("UPDATE sc_demandes SET status='recours',answer='non',answered_at=?,updated=? WHERE id=?",now,now,r.id);
  notify(s,uid,'Votre dossier reste ouvert','Un responsable Moov reprend votre dossier. Vous pouvez aussi saisir l’ARTCI, l’autorité des télécoms, sur artci.ci.',now);
  return mine(s,uid,now);
 }
 s.run("UPDATE sc_demandes SET status='confirmee',answer='non',answered_at=?,updated=? WHERE id=?",now,now,r.id);
 const text='Pas réglé après l’appel du service client'+(d.text?' : '+String(d.text).trim().slice(0,300):'.');
 if(r.kind==='reclamation')require('./reclamation.cjs').escalate(s,uid,r.incident_id,text,now);
 else open(s,{uid,kind:r.kind,ref:r.ref,incident:r.incident_id,title:r.title,detail:text,level:2},now);
 return mine(s,uid,now);
});}

// File « À rappeler » des conseillers et responsables : retards d'abord, puis l'échéance la plus proche.
function queue(s,uid,now=Date.now()){
 const role=O.requireOperator(s,uid);tick(s,now);
 const phone=u=>has(s,'wa_accounts')?s.get('SELECT phone FROM wa_accounts WHERE user_id=?',u)?.phone||null:null;
 const items=s.all("SELECT d.*,u.name FROM sc_demandes d JOIN users u ON u.id=d.user_id WHERE d.status IN ('recue','prise','appele') ORDER BY d.due").map(d=>({
  id:d.id,kind:d.kind,what:KINDS[d.kind],title:d.title,detail:d.detail,name:short(d.name),phone:phone(d.user_id),level:d.level,status:d.status,
  due:d.due,dueText:when(d.due,now),late:now>d.due,agent:d.agent_name?short(d.agent_name):null,mine:d.agent_id===uid,tries:d.tries,outcome:d.outcome?OUTCOMES[d.outcome]?.label:null,ref:d.ref,
  canAct:(d.level<2||boss(role))&&(!d.agent_id||d.agent_id===uid||boss(role))}));
 items.sort((a,b)=>Number(b.late)-Number(a.late)||b.level-a.level||a.due-b.due);
 const week=s.all('SELECT * FROM sc_demandes WHERE created>?',now-7*DAY);
 const taken=week.filter(d=>d.taken_at),rated=week.filter(d=>d.rating);
 return {items,role,counts:{open:items.length,late:items.filter(i=>i.late).length,high:items.filter(i=>i.level>1).length},
  stats:{taken:taken.length?Math.round(taken.reduce((n,d)=>n+(d.taken_at-d.created),0)/taken.length/MIN):null,
   solved:week.filter(d=>d.answer==='oui').length,notSolved:week.filter(d=>d.answer==='non').length,
   rating:rated.length?Math.round(rated.reduce((n,d)=>n+d.rating,0)/rated.length*10)/10:null},
  outcomes:Object.entries(OUTCOMES).map(([key,o])=>({key,label:o.label}))};
}

// Le conseiller agit : « Je m'en occupe », puis le résultat de l'appel.
function act(s,uid,d,now=Date.now()){return s.transaction(()=>{
 const role=O.requireOperator(s,uid);
 const r=s.get('SELECT * FROM sc_demandes WHERE id=?',String(d?.id||''));insist(r,'Demande introuvable.',404);
 insist(OPEN.includes(r.status),'Cette demande est déjà traitée. Rechargez la page.',409);
 insist(r.level<2||boss(role),'Un responsable doit traiter cette demande.',403);
 insist(!r.agent_id||r.agent_id===uid||boss(role),'Un autre conseiller s’occupe déjà de cette demande.',409);
 const me=s.get('SELECT name FROM users WHERE id=?',uid)?.name||'Conseiller';
 if(d.action==='take'){
  insist(r.status==='recue'||r.agent_id!==uid,'Vous vous occupez déjà de cette demande.',409);
  s.run("UPDATE sc_demandes SET status='prise',agent_id=?,agent_name=?,taken_at=COALESCE(taken_at,?),updated=? WHERE id=?",uid,me,now,now,r.id);
  notify(s,r.user_id,first(me)+' s’occupe de votre demande',first(me)+', du service client Moov, va vous appeler avant '+when(r.due,now)+'.',now);
  return queue(s,uid,now);
 }
 insist(d.action==='result','Action inconnue.');
 insist(r.agent_id,'Prenez d’abord la demande (« Je m’en occupe »).',409);
 insist(typeof d.outcome==='string'&&Object.hasOwn(OUTCOMES,d.outcome),'Choisissez le résultat de l’appel.');
 insist(d.outcome!=='echange'||r.kind==='echange','Ce résultat ne concerne que les échanges de box.');
 const note=String(d.note||'').trim().slice(0,500)||null;
 if(d.outcome==='absent'){
  const tries=r.tries+1,due=now+RETRY;
  s.run('UPDATE sc_demandes SET tries=?,due=?,updated=? WHERE id=?',tries,due,now,r.id);
  notify(s,r.user_id,'Nous avons essayé de vous appeler',tries>=MAX_TRIES?'Toujours pas de réponse. Rappelez le 111 quand vous voulez, ou répondez ici : votre demande reste ouverte.':first(me)+' vous rappelle avant '+when(due,now)+'. Gardez votre téléphone près de vous.',now);
  return queue(s,uid,now);
 }
 if(r.kind==='reclamation'){
  // La réponse passe par les réclamations (historique, recours) ; settle() demande ensuite son avis au client.
  require('./reclamation.cjs').answer(s,uid,{id:r.ref,outcome:d.outcome==='technicien'?'intervention':'regle',message:note||OUTCOMES[d.outcome].client},now);
  return queue(s,uid,now);
 }
 if(OUTCOMES[d.outcome].wait){
  // Technicien envoyé, échange confirmé : la demande attend la suite avant de demander l'avis du client.
  s.run("UPDATE sc_demandes SET status='appele',outcome=?,note=?,called_at=?,updated=? WHERE id=?",d.outcome,note,now,now,r.id);
  if(r.kind!=='reclamation')notify(s,r.user_id,first(me)+' vous a appelé',note||OUTCOMES[d.outcome].client,now);
  return queue(s,uid,now);
 }
 s.run('UPDATE sc_demandes SET called_at=?,outcome=?,updated=? WHERE id=?',now,d.outcome,now,r.id);
 settle(s,r.kind,r.ref,{outcome:d.outcome,message:note,by:uid},now);
 return queue(s,uid,now);
});}

module.exports={migrate,open,cancelRef,settle,mine,answer,queue,act,KINDS,OUTCOMES,DUE};
