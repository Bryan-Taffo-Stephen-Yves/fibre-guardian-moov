'use strict';
// Réclamations (problème n°1 des clients fibre, enquête ARTCI) : chaque dossier dit QUAND Moov répondra,
// et le client peut dire « Ce n'est pas réglé » au lieu de rappeler le 111.
//  - Dossier ouvert par le client et pas encore pris en main (reçu, en préparation, à revoir) : « Réponse promise avant 15 h 20 » (4 h).
//    L'heure passée sans réponse, le dossier est marqué « en retard » chez le client et dans le Superviseur.
//  - Réparation terminée depuis moins de 7 jours, ou promesse non tenue : bouton « Ce n'est pas réglé ».
//    1re fois : un conseiller répond sous 4 h. 2e et dernière fois : le dossier monte chez un responsable (réponse sous 2 h).
//    À la 2e fois, le client voit aussi ses recours : saisir l'ARTCI, avec la référence de son dossier.
//  - L'équipe Moov voit les réclamations dans le Superviseur (onglet Clients), les retards en premier,
//    et répond en un geste ; le client reçoit la réponse dans ses notifications et sur son dossier.
// Rien n'est envoyé hors de l'application ; les permissions sont vérifiées ici, côté serveur.
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const HOUR=3600000,DAY=24*HOUR;
const PROMISE=4*HOUR,WINDOW=7*DAY,MAX=2;
const DUE=[4*HOUR,2*HOUR];
const WAITING=['reported','proposed','approved','rejected'];
const OUTCOMES={
 regle:['Réglé avec le client','Un conseiller Moov a réglé votre problème avec vous.'],
 intervention:['Nouvelle intervention prévue','Un technicien va repasser chez vous. Vous suivrez son arrivée dans « Suivi ».'],
 rappel:['Client rappelé, suite en cours','Un conseiller Moov vous a rappelé. Il revient vers vous dès que c’est réglé.']
};
const LEVELS=['Conseiller','Responsable'];

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS reclamations(id TEXT PRIMARY KEY,incident_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,level INTEGER NOT NULL,text TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,due INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'open',outcome TEXT,response TEXT,done_by TEXT REFERENCES users(id),done_at INTEGER);
 CREATE INDEX IF NOT EXISTS reclamation_user ON reclamations(user_id,incident_id);
 CREATE INDEX IF NOT EXISTS reclamation_status ON reclamations(status,due);
 `);}

const hour=t=>new Date(t).toLocaleTimeString('fr-FR',{timeZone:'Africa/Abidjan',hour:'2-digit',minute:'2-digit'}).replace(':',' h ');
const sameDay=(a,b)=>new Date(a).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan'})===new Date(b).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan'});
const when=(t,now)=>sameDay(t,now)?hour(t):(sameDay(t,now+DAY)?'demain':'le '+new Date(t).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan',day:'numeric',month:'short'}))+' à '+hour(t);
const ref=iid=>String(iid||'').replace(/-/g,'').slice(0,6).toUpperCase();
const terminal=i=>['resolved','closed'].includes(i.status);
// Fin de la réparation : le dernier événement « résolu » ou « clôturé » (jamais un simple message qui parle de retour).
function endOf(i){const e=(i.events||[]).filter(e=>e.kind==='resolved'||e.kind==='closed').pop();return e?e.at:0;}

// La promesse de réponse d'un dossier pas encore pris en main.
function promise(i,now,mine=true){
 if(!mine||!WAITING.includes(i.status))return null;
 const start=(i.events||[])[0]?.at||now,by=start+PROMISE;
 return {by,late:now>by,text:now>by?'Réponse promise avant '+when(by,now)+' : Moov est en retard.':'Réponse promise avant '+when(by,now)};
}

const reporter=(s,iid)=>s.get('SELECT reporter FROM noc_incidents WHERE id=?',iid)?.reporter||null;
function rows(s,uid,iid){return s.all('SELECT * FROM reclamations WHERE user_id=? AND incident_id=? ORDER BY created',uid,iid);}
function view(r,now){return {id:r.id,level:r.level,who:LEVELS[r.level-1],text:r.text,at:r.created,due:r.due,dueText:when(r.due,now),late:r.status==='open'&&now>r.due,status:r.status,outcome:r.outcome?OUTCOMES[r.outcome][0]:null,response:r.response||null,doneAt:r.done_at};}

// Ajoute à chaque dossier du client : la promesse, ses réclamations, et s'il peut dire « Ce n'est pas réglé ».
function decorate(s,uid,data,now=Date.now()){
 if(!data||!Array.isArray(data.incidents))return data;
 for(const i of data.incidents){
  const list=rows(s,uid,i.id),open=list.find(r=>r.status==='open'),p=promise(i,now,reporter(s,i.id)===uid);
  i.promise=open?null:p;
  i.reclamation={
   ref:ref(i.id),
   items:list.map(r=>view(r,now)),
   open:open?view(open,now):null,
   canClaim:!open&&list.length<MAX&&((terminal(i)&&now-endOf(i)<=WINDOW)||(!!p&&p.late)),
   recours:list.length>=2
  };
 }
 return data;
}

function notify(s,uid,key,title,body,now){
 const J=require('./journey-store.cjs'),st=J.get(s,uid);if(!st)return;
 st.notifications=st.notifications||[];
 st.notifications.unshift({key,home:'home-1',at:now,title,body,read:false});
 st.notifications=st.notifications.slice(0,100);J.put(s,uid,st);
}

// Le client dit « Ce n'est pas réglé » (ou « Toujours pas de réponse ») sur un dossier qu'il voit dans son suivi.
function claim(s,uid,d,now=Date.now()){
 const noc=require('./noc-store.cjs'),item=decorate(s,uid,noc.client(s,uid),now).incidents.find(i=>i.id===d?.id);
 insist(item,'Dossier introuvable dans votre suivi.',404);
 insist(!item.reclamation.open,'Votre réclamation est déjà entre les mains de Moov.',409);
 insist(item.reclamation.items.length<MAX,'Votre dossier est déjà chez un responsable de Moov. Si rien n’est réglé, voyez vos recours juste en dessous.',409);
 insist(item.reclamation.canClaim,terminal(item)?'Ce dossier est fermé depuis plus de 7 jours : signalez un nouveau problème.':'Moov a encore le temps de vous répondre.',409);
 const text=String(d.text||'').trim().slice(0,500),level=item.reclamation.items.length+1,due=now+DUE[level-1];
 s.run('INSERT INTO reclamations(id,incident_id,user_id,level,text,created,due) VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),item.id,uid,level,text,now,due);
 notify(s,uid,'reclamation:'+item.id+':'+level,level===1?'Votre réclamation est enregistrée':'Votre dossier monte chez un responsable','Dossier '+ref(item.id)+' : '+(level===1?'un conseiller':'un responsable')+' Moov vous répond avant '+when(due,now)+'.',now);
 return {ok:true,due,dueText:when(due,now),level};
}

// Équipe Moov : réclamations ouvertes (retards d'abord), dossiers en retard de réponse, et ce qui a été réglé cette semaine.
function list(s,uid,now=Date.now()){
 const role=O.requireOperator(s,uid),boss=['admin','supervisor'].includes(role);
 const open=s.all("SELECT r.*,u.name,i.title,i.segment_id FROM reclamations r JOIN users u ON u.id=r.user_id LEFT JOIN noc_incidents i ON i.id=r.incident_id WHERE r.status='open' ORDER BY r.due").map(r=>({...view(r,now),name:String(r.name||'Client').split(' ').slice(0,2).join(' '),title:r.title||'Dossier',zone:r.segment_id||null,ref:ref(r.incident_id),canAnswer:r.level<2||boss}));
 open.sort((a,b)=>(b.late-a.late)||(b.level-a.level)||(a.due-b.due));
 const done=s.get("SELECT COUNT(*) n FROM reclamations WHERE status='done' AND done_at>=?",now-WINDOW).n;
 return {open,counts:{open:open.length,late:open.filter(r=>r.late).length,high:open.filter(r=>r.level>=2).length,done},outcomes:Object.entries(OUTCOMES).map(([k,[label]])=>({key:k,label}))};
}

// Un conseiller (ou un responsable pour le niveau 2 et plus) répond : le client est prévenu.
function answer(s,uid,d,now=Date.now()){
 const role=O.requireOperator(s,uid);
 const r=s.get('SELECT * FROM reclamations WHERE id=?',d?.id);
 insist(r,'Réclamation introuvable.',404);insist(r.status==='open','Cette réclamation a déjà une réponse.',409);
 insist(r.level<2||['admin','supervisor'].includes(role),'Un responsable doit répondre à cette réclamation.',403);
 insist(typeof d.outcome==='string'&&Object.hasOwn(OUTCOMES,d.outcome),'Choisissez ce qui a été fait.');
 const message=String(d.message||'').trim().slice(0,500)||OUTCOMES[d.outcome][1];
 s.run("UPDATE reclamations SET status='done',outcome=?,response=?,done_by=?,done_at=? WHERE id=?",d.outcome,message,uid,now,r.id);
 notify(s,r.user_id,'reclamation-reponse:'+r.id,'Moov a répondu à votre réclamation','Dossier '+ref(r.incident_id)+' : '+message,now);
 return {ok:true};
}

module.exports={migrate,decorate,claim,list,answer,promise,OUTCOMES,PROMISE,WINDOW};
