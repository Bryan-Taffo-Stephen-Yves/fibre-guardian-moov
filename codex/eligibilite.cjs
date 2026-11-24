'use strict';
// « La fibre arrive-t-elle chez moi ? » (problème n°7 des clients fibre). Un parcours complet :
//  1. Dans « Dossier de ma fibre », le client choisit sa commune. Si la fibre Moov n'y arrive pas encore, il le sait
//     tout de suite, et il demande « Prévenez-moi quand elle arrive » (et, s'il veut, l'appel d'un conseiller :
//     file « À rappeler », service-client.cjs, pour lui proposer une solution en attendant).
//  2. L'équipe Moov voit dans le Superviseur (onglet Clients) les communes les plus demandées, avec les quartiers :
//     c'est la liste des prochains chantiers.
//  3. Quand la fibre arrive dans une commune, un responsable l'ouvre : chaque client qui attendait est prévenu et peut
//     commander tout de suite (Fibre Welcome), et le déménagement y devient possible.
// Les droits sont vérifiés ici : un client ne voit que sa demande ; seul un responsable (superviseur, admin) ouvre une commune.
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,DUE=4*3600000;
const ZONE=require('./smart-offer.js').ZONE;   // communes de départ de la zone fibre (carte d'Abidjan de l'application)
const OTHER=['Bingerville','Anyama','Songon','Dabou','Jacqueville','Bouaké','Yamoussoukro','San-Pédro','Autre ville'];
const boss=role=>['admin','supervisor'].includes(role);

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS elig_demandes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,commune TEXT NOT NULL,quartier TEXT NOT NULL,call INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,arrived_at INTEGER);
 CREATE INDEX IF NOT EXISTS elig_user ON elig_demandes(user_id,status);
 CREATE INDEX IF NOT EXISTS elig_commune ON elig_demandes(commune,status);
 CREATE TABLE IF NOT EXISTS elig_zones(commune TEXT PRIMARY KEY,opened INTEGER NOT NULL,opened_by TEXT REFERENCES users(id) ON DELETE SET NULL);
 `);}
// Créées au besoin (tests, autres modules). On regarde la base elle-même : une création annulée avec une transaction ne compte pas.
function ensure(s){if(!s.get("SELECT 1 FROM sqlite_master WHERE name='elig_zones'"))migrate(s);}

// Les communes où la fibre Moov arrive : celles de départ, plus celles ouvertes depuis par un responsable.
function zone(s){ensure(s);return [...ZONE,...s.all('SELECT commune FROM elig_zones ORDER BY opened').map(r=>r.commune).filter(c=>!ZONE.includes(c))];}
function covered(s,commune){return zone(s).includes(commune);}
function others(s){const z=zone(s);return OTHER.filter(c=>!z.includes(c));}

const J=()=>require('./journey-store.cjs');
const SC=()=>require('./service-client.cjs');
const text=(v,label,min,max)=>{const t=String(v??'').trim();insist(t.length>=min&&t.length<=max&&!/[\u0000-\u001f<>]/.test(t),label);return t;};
function notify(s,uid,title,body,now){
 const st=J().get(s,uid);if(!st)return;st.notifications=st.notifications||[];
 st.notifications.unshift({key:'elig:'+crypto.randomUUID(),home:'home-1',at:now,title,body,read:false,page:'bienvenue'});
 st.notifications=st.notifications.slice(0,100);J().put(s,uid,st);
}
const waiting=(s,commune)=>s.get("SELECT COUNT(*) n FROM elig_demandes WHERE commune=? AND status='attente'",commune).n;
const current=(s,uid)=>s.get("SELECT * FROM elig_demandes WHERE user_id=? AND status!='annule' ORDER BY created DESC LIMIT 1",uid);

// Ce que voit le client : sa demande (en attente, ou la fibre arrivée depuis moins de 30 jours), et la liste des communes.
function state(s,uid,now=Date.now()){
 ensure(s);const r=current(s,uid);
 const mine=r&&(r.status==='attente'||now-(r.arrived_at||0)<30*DAY)?{id:r.id,commune:r.commune,quartier:r.quartier,status:r.status,call:!!r.call,
  others:Math.max(0,waiting(s,r.commune)-(r.status==='attente'?1:0)),arrived:r.arrived_at||null}:null;
 return {mine,zone:zone(s),other:others(s)};
}

// « Prévenez-moi quand la fibre arrive » ; call : un conseiller appelle aussi pour proposer une solution en attendant.
function ask(s,uid,d,now=Date.now()){return s.transaction(()=>{
 ensure(s);
 const commune=text(d?.commune,'Choisissez votre commune.',2,40);
 insist(OTHER.includes(commune),'Choisissez votre commune.');
 insist(!covered(s,commune),'Bonne nouvelle : la fibre Moov arrive déjà à '+commune+'. Vous pouvez la commander.',409);
 const quartier=text(d.quartier,'Indiquez votre quartier.',2,80),call=d.call===true;
 const cur=s.get("SELECT * FROM elig_demandes WHERE user_id=? AND status='attente'",uid);
 let id=cur?.id;
 if(cur){
  s.run('UPDATE elig_demandes SET commune=?,quartier=?,call=MAX(call,?),updated=? WHERE id=?',commune,quartier,call?1:0,now,id);
  // Le client change de commune : la demande d'appel déjà ouverte suit sa nouvelle adresse.
  if(s.get("SELECT 1 FROM sqlite_master WHERE name='sc_demandes'"))s.run("UPDATE sc_demandes SET title=?,detail=?,updated=? WHERE kind='eligibilite' AND ref=? AND status IN ('recue','prise','appele')",'Fibre demandée à '+quartier+', '+commune,'Le client a changé de commune : '+quartier+', '+commune+'. Proposez une solution en attendant et dites au client qu’il sera prévenu.',now,id);
 }
 else{id=crypto.randomUUID();s.run('INSERT INTO elig_demandes(id,user_id,commune,quartier,call,status,created,updated) VALUES(?,?,?,?,?,?,?,?)',id,uid,commune,quartier,call?1:0,'attente',now,now);}
 const n=waiting(s,commune)-1;
 if(call){
  SC().open(s,{uid,kind:'eligibilite',ref:id,level:1,due:now+DUE,silent:true,title:'Fibre demandée à '+quartier+', '+commune,
   detail:'La fibre Moov n’arrive pas encore à '+commune+(n>0?' ('+n+' autre'+(n>1?'s':'')+' client'+(n>1?'s':'')+' attend'+(n>1?'ent':'')+' aussi)':'')+'. Proposez une solution en attendant et dites au client qu’il sera prévenu.'},now);
  notify(s,uid,'C’est noté : nous vous prévenons','La fibre Moov n’arrive pas encore à '+commune+'. Un conseiller vous appelle avant '+SC().when(now+DUE,now)+' pour voir une solution avec vous en attendant.',now);
 }else notify(s,uid,'C’est noté : nous vous prévenons',commune==='Autre ville'
  ?'Moov étudie les demandes de toutes les villes. Pour savoir ce qui est possible chez vous dès maintenant, demandez l’appel d’un conseiller.'
  :'Dès que la fibre Moov arrive à '+commune+', vous recevez un message ici et vous pouvez la commander tout de suite.',now);
 return state(s,uid,now);
});}

function cancel(s,uid,now=Date.now()){return s.transaction(()=>{
 ensure(s);const r=s.get("SELECT * FROM elig_demandes WHERE user_id=? AND status='attente'",uid);insist(r,'Aucune demande en cours.',404);
 s.run("UPDATE elig_demandes SET status='annule',updated=? WHERE id=?",now,r.id);
 SC().cancelRef(s,'eligibilite',r.id,now);
 return state(s,uid,now);
});}

// Équipe Moov : les communes les plus demandées, avec leurs quartiers. Les responsables peuvent ouvrir une commune.
function list(s,uid,now=Date.now()){
 const role=O.requireOperator(s,uid);ensure(s);
 const rows=s.all("SELECT commune,quartier,created FROM elig_demandes WHERE status='attente'");
 const by=new Map();
 for(const r of rows){const c=by.get(r.commune)||{commune:r.commune,count:0,quartiers:new Map(),since:r.created};c.count++;c.since=Math.min(c.since,r.created);c.quartiers.set(r.quartier,(c.quartiers.get(r.quartier)||0)+1);by.set(r.commune,c);}
 const items=[...by.values()].sort((a,b)=>b.count-a.count||a.since-b.since).map(c=>({commune:c.commune,count:c.count,since:c.since,
  quartiers:[...c.quartiers.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([name,n])=>({name,n})),canOpen:boss(role)&&c.commune!=='Autre ville'}));
 const opened=s.all('SELECT commune,opened FROM elig_zones WHERE opened>? ORDER BY opened DESC',now-30*DAY).map(z=>({commune:z.commune,at:z.opened,told:s.get("SELECT COUNT(*) n FROM elig_demandes WHERE commune=? AND status='arrivee'",z.commune).n}));
 return {items,opened,total:rows.length,canOpen:boss(role)};
}

// Un responsable annonce que la fibre est arrivée dans une commune : chaque client qui attendait est prévenu.
function open(s,uid,d,now=Date.now()){return s.transaction(()=>{
 const role=O.requireOperator(s,uid);insist(boss(role),'Seul un responsable peut ouvrir une commune à la fibre.',403);ensure(s);
 const commune=String(d?.commune||'');insist(OTHER.includes(commune)&&commune!=='Autre ville','Commune inconnue.');
 insist(!covered(s,commune),'La fibre arrive déjà à '+commune+'.',409);
 insist(d.confirm===true,'Confirmez l’arrivée de la fibre.');
 s.run('INSERT INTO elig_zones(commune,opened,opened_by) VALUES(?,?,?)',commune,now,uid);
 for(const r of s.all("SELECT * FROM elig_demandes WHERE commune=? AND status='attente'",commune)){
  s.run("UPDATE elig_demandes SET status='arrivee',arrived_at=?,updated=? WHERE id=?",now,now,r.id);
  notify(s,r.user_id,'La fibre Moov arrive à '+commune+' !','Vous nous aviez demandé de vous prévenir. Commandez-la maintenant dans « Dossier de ma fibre » : un technicien de Moov vient l’installer chez vous.',now);
  SC().settle(s,'eligibilite',r.id,{message:'La fibre Moov arrive à '+commune+' : vous pouvez la commander dans « Dossier de ma fibre ».',quiet:true},now);
 }
 return list(s,uid,now);
});}

module.exports={migrate,zone,covered,others,state,ask,cancel,list,open,OTHER};
