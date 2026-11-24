'use strict';
// Déménagement (problème n°6 des clients fibre) : « je déménage, ma fibre me suit ? ». Un parcours complet :
//  1. Dans Mon compte, le client donne sa nouvelle adresse (commune, quartier, repère) et le jour où il veut
//     la fibre là-bas. Il sait tout de suite si la fibre Moov y arrive.
//  2. La demande arrive dans la file « À rappeler » des conseillers (service-client.cjs) : un conseiller l'appelle
//     sous 4 h pour confirmer l'adresse et le jour (résultat « Déménagement confirmé »).
//  3. Le jour venu, le technicien installe la fibre à la nouvelle adresse : le client est rattaché à son nouveau
//     quartier (alertes de panne, techniciens de la commune), puis on lui demande si c'est réglé et sa note.
//  Hors de la zone fibre : le conseiller appelle quand même pour trouver une solution avec lui.
// L'ancienne adresse garde internet jusqu'au jour de l'installation.
const crypto=require('node:crypto');
const {insist}=require('./pilot-model.cjs');
const HOUR=3600000,DAY=24*HOUR,DAYS=12,DUE=4*HOUR;
// Communes où la fibre Moov arrive, y compris celles ouvertes depuis par un responsable (eligibilite.cjs).
const EL=()=>require('./eligibilite.cjs');
const SLOTS={matin:{label:'entre 8 h et 12 h',from:8,to:12},apres:{label:'entre 14 h et 18 h',from:14,to:18}};
const OPEN=['demande','planifie'];

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS demenagements(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,commune TEXT NOT NULL,quartier TEXT NOT NULL,repere TEXT NOT NULL DEFAULT '',covered INTEGER NOT NULL,day INTEGER,slot TEXT,status TEXT NOT NULL,old_segment TEXT,new_segment TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,done_at INTEGER);
 CREATE INDEX IF NOT EXISTS demenagements_user ON demenagements(user_id,created);
 `);}
function ensure(s){if(!s.get("SELECT 1 FROM sqlite_master WHERE name='demenagements'"))migrate(s);}

const J=()=>require('./journey-store.cjs');
const SC=()=>require('./service-client.cjs');
const midnight=t=>{const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());};   // Abidjan = UTC
const dayName=t=>new Date(t).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan',weekday:'long',day:'numeric',month:'long'});
// Les jours possibles : à partir de demain (le conseiller doit appeler avant), 12 jours sans le dimanche.
function choices(now){const out=[];let t=midnight(now);while(out.length<DAYS){t+=DAY;if(new Date(t).getUTCDay()!==0)out.push({day:t,label:dayName(t)});}return out;}
const when=r=>dayName(r.day)+', '+SLOTS[r.slot].label;
const endOf=r=>r.day+SLOTS[r.slot].to*HOUR;
const text=(v,label,min,max)=>{const t=String(v??'').trim();insist(t.length>=min&&t.length<=max&&!/[\u0000-\u001f<>]/.test(t),label);return t;};
const current=(s,uid)=>s.get("SELECT * FROM demenagements WHERE user_id=? ORDER BY created DESC LIMIT 1",uid);

function notify(s,uid,title,body,now){
 const st=J().get(s,uid);if(!st)return;st.notifications=st.notifications||[];
 st.notifications.unshift({key:'dem:'+crypto.randomUUID(),home:'home-1',at:now,title,body,read:false,page:'compte'});
 st.notifications=st.notifications.slice(0,100);J().put(s,uid,st);
}

// Le quartier de la nouvelle adresse, quand Moov le suit déjà ; sinon le premier quartier suivi de la commune.
function segmentFor(s,commune,quartier){
 const rows=s.all('SELECT id,zone FROM noc_segments WHERE zone LIKE ? ORDER BY id',commune+' ·%');
 const q=quartier.toLowerCase();
 return (rows.find(r=>{const z=r.zone.split('·').pop().trim().toLowerCase();return q.includes(z)||z.includes(q);})||rows[0])?.id||null;
}

// Ce qui avance tout seul à la lecture : le jour venu, la fibre est installée à la nouvelle adresse.
function tick(s,now=Date.now()){
 ensure(s);
 for(const r of s.all("SELECT * FROM demenagements WHERE status='planifie'"))if(now>=endOf(r))finish(s,r,now);
}
// Le technicien a installé la fibre à la nouvelle adresse (le jour prévu, ou tout de suite dans la scène de la Régie).
function finish(s,r,now=Date.now()){
 const seg=segmentFor(s,r.commune,r.quartier);
 // Le client a donné lui-même sa nouvelle adresse : il suit son nouveau quartier. Sans quartier suivi dans la commune,
 // il ne reçoit plus les alertes de l'ancien.
 if(seg)s.run('INSERT INTO noc_members(user_id,segment_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET segment_id=excluded.segment_id',r.user_id,seg);
 else s.run('DELETE FROM noc_members WHERE user_id=?',r.user_id);
 s.run("UPDATE demenagements SET status='fait',new_segment=?,done_at=?,updated=? WHERE id=?",seg,now,now,r.id);
 SC().settle(s,'demenagement',r.id,{message:'Votre fibre est installée à votre nouvelle adresse ('+r.quartier+', '+r.commune+'). Bienvenue chez vous !'},now);
}

// Avant que le conseiller note son appel (service-client.cjs) : hors zone fibre, pas de technicien ni d'installation.
function check(s,id,outcome){
 ensure(s);const r=s.get('SELECT * FROM demenagements WHERE id=?',String(id));
 insist(!r||r.covered||EL().covered(s,r.commune)||!['demenagement','technicien'].includes(outcome),'La fibre n’arrive pas à cette adresse : proposez une solution au client, puis notez « Réglé au téléphone ».',409);
}
// Le conseiller a appelé : la date est confirmée, ou la demande est close au téléphone.
// Confirmée après le jour choisi : l'installation passe au premier jour possible (jamais « installée » sans technicien).
function called(s,id,outcome,now=Date.now()){
 ensure(s);const r=s.get('SELECT * FROM demenagements WHERE id=?',String(id));if(!r||!OPEN.includes(r.status))return;
 // Une commune ouverte à la fibre depuis la demande compte comme couverte (eligibilite.cjs).
 if((r.covered||EL().covered(s,r.commune))&&['demenagement','technicien'].includes(outcome)){
  const day=r.day&&endOf(r)>now?r.day:choices(now)[0].day;
  s.run("UPDATE demenagements SET status='planifie',covered=1,day=?,slot=COALESCE(slot,'matin'),updated=? WHERE id=?",day,now,r.id);
  if(day!==r.day)notify(s,r.user_id,'Nouvelle date d’installation','Le jour que vous aviez choisi est passé : le technicien installe votre fibre '+when({day,slot:r.slot||'matin'})+'. Vous pouvez annuler dans Mon compte.',now);
 }
 else if(outcome!=='absent')s.run("UPDATE demenagements SET status='conseille',updated=? WHERE id=?",now,r.id);
}
// La demande du service client attend l'installation seulement tant que le déménagement est prévu.
const waiting=(s,id)=>{ensure(s);return s.get('SELECT status FROM demenagements WHERE id=?',String(id))?.status==='planifie';};

function view(s,r,now){
 if(!r)return null;
 const sc=s.get("SELECT status,due,agent_name FROM sc_demandes WHERE kind='demenagement' AND ref=? ORDER BY created DESC LIMIT 1",r.id);
 const agent=sc?.agent_name?String(sc.agent_name).split(' ')[0]:null,late=r.status==='demande'&&sc&&now>sc.due;
 const by=sc?SC().when(sc.due,now):null;
 const steps=r.covered?[['Demande reçue',true],[agent?agent+' a appelé':'Appel du conseiller',r.status!=='demande'],['Installation',r.status==='fait'],['Fibre active',r.status==='fait']]
  :[['Demande reçue',true],[agent?agent+' a appelé':'Appel du conseiller',r.status!=='demande']];
 const msg={
  demande:late?'Moov est en retard pour vous appeler : votre demande est en tête de liste.'
   :(agent?agent+', du service client,':'Un conseiller Moov')+' vous appelle avant '+by+(r.covered?' pour confirmer l’adresse et le jour.':' pour chercher une solution avec vous.'),
  planifie:'C’est confirmé : le technicien installe votre fibre '+(r.day?when(r):'')+'. Votre ancienne adresse garde internet jusque-là.',
  fait:'Votre fibre est installée à votre nouvelle adresse. Bienvenue chez vous !',
  conseille:'Le conseiller vous a appelé. Votre demande est close.',
  annule:'Demande annulée.'
 }[r.status];
 return {id:r.id,status:r.status,commune:r.commune,quartier:r.quartier,repere:r.repere,covered:!!r.covered,when:r.day&&r.status!=='fait'?'Installation '+when(r):r.done_at?'Installée '+dayName(r.done_at):null,
  steps:steps.map(([label,done])=>({label,done})),text:msg,late:!!late,canCancel:OPEN.includes(r.status)};
}

// Ce que voit le client : sa demande en cours (ou finie depuis moins de 7 jours), les communes et les jours possibles.
function state(s,uid,now=Date.now()){
 tick(s,now);
 const r=current(s,uid),show=r&&(OPEN.includes(r.status)||now-r.updated<7*DAY)&&r.status!=='annule';
 return {current:show?view(s,r,now):null,zone:EL().zone(s),other:EL().others(s),choices:choices(now),slots:Object.entries(SLOTS).map(([id,v])=>({id,label:v.label}))};
}

// Le client déclare son déménagement.
function ask(s,uid,d,now=Date.now()){return s.transaction(()=>{
 ensure(s);
 const cur=current(s,uid);insist(!cur||!OPEN.includes(cur.status),'Vous avez déjà une demande de déménagement en cours.',409);
 const commune=text(d?.commune,'Choisissez votre nouvelle commune.',2,40);
 insist(EL().covered(s,commune)||EL().OTHER.includes(commune),'Choisissez votre nouvelle commune.');
 const quartier=text(d.quartier,'Indiquez votre nouveau quartier.',2,60),repere=text(d.repere||'','Le repère est trop long.',0,120);
 const covered=EL().covered(s,commune);let day=null,slot=null;
 if(covered){
  day=Number(d.day);slot=String(d.slot||'');
  insist(choices(now).some(c=>c.day===day)&&Object.hasOwn(SLOTS,slot),'Choisissez le jour de l’installation.');
 }
 const id=crypto.randomUUID(),old=s.get('SELECT segment_id FROM noc_members WHERE user_id=?',uid)?.segment_id||null;
 s.run('INSERT INTO demenagements(id,user_id,commune,quartier,repere,covered,day,slot,status,old_segment,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,uid,commune,quartier,repere,covered?1:0,day,slot,'demande',old,now,now);
 const r={day,slot},due=now+DUE;
 SC().open(s,{uid,kind:'demenagement',ref:id,level:1,due,silent:true,
  title:covered?quartier+', '+commune+' · '+when(r):'Hors zone fibre · '+quartier+', '+commune,
  detail:'Nouvelle adresse : '+quartier+', '+commune+(repere?' ('+repere+')':'')+'. '+(covered?'Installation souhaitée '+when(r)+'. Confirmez l’adresse et le jour (« Déménagement confirmé »).':'La fibre Moov n’arrive pas encore dans cette commune : proposez une solution au client.')},now);
 notify(s,uid,'Demande de déménagement reçue',covered
  ?'Un conseiller Moov vous appelle avant '+SC().when(due,now)+' pour confirmer votre nouvelle adresse et l’installation '+when(r)+'.'
  :'La fibre Moov n’arrive pas encore à '+commune+'. Un conseiller vous appelle avant '+SC().when(due,now)+' pour chercher une solution avec vous.',now);
 return state(s,uid,now);
});}

function cancel(s,uid,now=Date.now()){return s.transaction(()=>{
 ensure(s);const r=current(s,uid);insist(r&&OPEN.includes(r.status),'Aucune demande de déménagement en cours.',404);
 s.run("UPDATE demenagements SET status='annule',updated=? WHERE id=?",now,r.id);
 SC().cancelRef(s,'demenagement',r.id,now);
 return state(s,uid,now);
});}

module.exports={migrate,state,ask,cancel,check,called,waiting,tick,finish,choices,segmentFor};
