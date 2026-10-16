'use strict';
// « Le jury vit la panne » : chaque membre du jury scanne un QR code et devient un abonné anonyme
// de Yopougon (segment YOP-07), sans nom ni numéro. La régie (administrateur uniquement) déclenche
// les scènes avec les actions habituelles du NOC : mêmes validations, mêmes droits, rien n'est contourné.
const crypto=require('node:crypto');
const {id,token,insist}=require('./pilot-model.cjs');
const O=require('./operator-store.cjs'),noc=require('./noc-store.cjs'),journey=require('./journey-store.cjs'),workspace=require('./noc-workspace.cjs');
const SEGMENT='YOP-07',ZONE='Yopougon · Niangon',TECH='koffi';
const ROOM_MS=4*3600000,MAX_JURORS=60;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0 ni I/1, faciles à confondre à l'oral.

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS jury_rooms(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,closed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS jury_members(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,room TEXT NOT NULL,number INTEGER NOT NULL,joined INTEGER NOT NULL);
 `);}
function requireAdmin(s,uid){insist(O.role(s,uid)==='admin','Régie réservée à l’administrateur.',403);}
const openRoom=s=>s.get('SELECT * FROM jury_rooms WHERE closed=0 AND expires>? ORDER BY created DESC LIMIT 1',Date.now());
const code=()=>Array.from({length:6},()=>ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

// La scène du jury : la dernière intervention de démonstration de Yopougon ouverte depuis la salle.
function sceneId(s,room){return room?s.get("SELECT id FROM noc_incidents WHERE mode='demo' AND segment_id=? AND created>=? ORDER BY created DESC,rowid DESC LIMIT 1",SEGMENT,room.created)?.id||null:null;}
function at(events,kind){return (events||[]).filter(e=>e.kind===kind).map(e=>e.at).pop()||null;}
// Certificat de réparation : uniquement quand la supervision a vérifié le retour des mesures du segment.
function certificate(s,i){
 if(!i||i.status!=='resolved'||!i.restorationVerified)return null;
 const resolved=s.get("SELECT detail,at FROM noc_events WHERE incident_id=? AND kind='resolved' ORDER BY at DESC,rowid DESC LIMIT 1",i.id),detail=JSON.parse(resolved?.detail||'{}');
 const start=at(i.events,'detected')||i.created,end=resolved?.at||at(i.events,'resolved');
 return {reference:'FG-'+i.id.replace(/[^a-z0-9]/gi,'').slice(0,6).toUpperCase(),zone:ZONE,technician:i.technician?.name||null,team:i.technician?.team||null,
  detectedAt:start,arrivedAt:at(i.events,'on_site'),repairedAt:at(i.events,'verifying'),restoredAt:end,durationMin:end&&start?Math.max(1,Math.round((end-start)/60000)):null,
  online:Number.isFinite(detail.online)?detail.online:null,total:Number.isFinite(detail.total)?detail.total:null,verifiedBy:'Supervision Moov'};
}

async function join(s,d,ip){
 s.rate('jury-join:'+ip,40,600000);
 insist(d.consent===true,'Votre accord est nécessaire pour recevoir les alertes du quartier.');
 const room=s.get('SELECT * FROM jury_rooms WHERE code=?',String(d.code||'').trim().toUpperCase().slice(0,12));
 insist(room&&!room.closed&&room.expires>Date.now(),'Ce code n’est plus valable. Demandez le nouveau code à l’équipe.',404);
 const count=s.get('SELECT count(*) AS n FROM jury_members WHERE room=?',room.id).n;insist(count<MAX_JURORS,'La salle du jury est complète.',409);
 // Compte anonyme d'abonné : aucun nom, aucun numéro, aucun rôle opérateur.
 const number=count+1,{user}=await s.register({email:'jury-'+id()+'@guardian.invalid',name:'Membre du jury '+number,password:token()});
 s.transaction(()=>{s.run('INSERT INTO jury_members VALUES(?,?,?,?)',user.id,room.id,number,Date.now());journey.put(s,user.id,journey.seed());noc.join(s,user.id,{segment:SEGMENT,consent:true});});
 return user;
}

function me(s,uid){
 const m=s.get('SELECT m.*,r.code,r.created AS room_created,r.expires,r.closed FROM jury_members m JOIN jury_rooms r ON r.id=m.room WHERE m.user_id=?',uid);insist(m,'Cet espace est réservé aux membres du jury.',404);
 const sid=sceneId(s,{created:m.room_created}),scene=sid?noc.client(s,uid).incidents.find(i=>i.id===sid)||null:null,seg=s.get('SELECT online,total,alarm FROM noc_segments WHERE id=?',SEGMENT);
 const plan=sid?s.get('SELECT plan,created FROM noc_incidents WHERE id=?',sid):null;
 return {number:m.number,zone:ZONE,joined:m.joined,room:{open:!m.closed&&m.expires>Date.now()},segment:{online:seg.online,total:seg.total,alarm:seg.alarm},
  scene:scene?{...scene,created:plan.created,cause:plan.plan?JSON.parse(plan.plan).cause:null,certificate:certificate(s,scene)}:null};
}

function status(s,uid,origin){
 requireAdmin(s,uid);
 const room=openRoom(s),sid=sceneId(s,room),scene=sid?noc.overview(s,uid).incidents.find(i=>i.id===sid):null;
 const jurors=room?s.get('SELECT count(*) AS n FROM jury_members WHERE room=?',room.id).n:0;
 const ratings=sid?s.get('SELECT count(*) AS n,avg(f.rating) AS avg FROM noc_feedback f JOIN jury_members m ON m.user_id=f.user_id WHERE f.incident_id=?',sid):{n:0,avg:null};
 const st=scene?.status,step=!scene||['resolved','closed','rejected'].includes(st)?'cut':['reported','proposed','approved','dispatched'].includes(st)?'send':st==='en_route'?'arrive':'repair';
 const seg=s.get('SELECT online,total,alarm FROM noc_segments WHERE id=?',SEGMENT);
 return {room:room?{code:room.code,url:origin+'/codex/?jury='+room.code,expires:room.expires,created:room.created,jurors}:null,
  scene:scene?{id:scene.id,status:st,created:scene.created,technician:scene.technician,position:scene.position,events:scene.events.map(e=>({kind:e.kind,text:e.public_text,at:e.at}))}:null,
  next:room?step:'open',segment:{id:SEGMENT,zone:ZONE,...seg},ratings:{count:ratings.n,average:ratings.avg==null?null:Math.round(ratings.avg*10)/10}};
}

// Une étape de la scène = une suite d'actions NOC habituelles, faites avec les droits de l'administrateur connecté.
function step(s,uid,d,origin){
 requireAdmin(s,uid);
 insist(['open','close','cut','send','arrive','repair'].includes(d.type),'Étape inconnue.');
 if(d.type==='open'){s.transaction(()=>{s.run('UPDATE jury_rooms SET closed=1 WHERE closed=0');s.run('INSERT INTO jury_rooms VALUES(?,?,?,?,?,0)',id(),code(),uid,Date.now(),Date.now()+ROOM_MS);});return status(s,uid,origin);}
 const room=openRoom(s);insist(room,'Ouvrez d’abord la salle du jury.',409);
 if(d.type==='close'){s.run('UPDATE jury_rooms SET closed=1 WHERE id=?',room.id);return status(s,uid,origin);}
 const current=()=>{const sid=sceneId(s,room);return sid?noc.overview(s,uid).incidents.find(i=>i.id===sid):null;};
 const act=(type,extra={})=>{const i=current();noc.operate(s,uid,{type,id:i.id,version:i.version,...extra});return current();};
 let i=current();
 if(d.type==='cut'){
  insist(!i||i.terminal||i.status==='rejected','Une coupure est déjà en cours à Niangon.',409);
  insist(!s.get("SELECT id FROM noc_incidents WHERE segment_id=? AND source='telemetry' AND status NOT IN ('resolved','closed')",SEGMENT),'Une coupure est déjà en cours à Niangon.',409);
  noc.operate(s,uid,{type:'simulate',segment:SEGMENT,scenario:'fiber'});
  insist(current(),'La coupure n’a pas été détectée. Vérifiez que la supervision n’est pas suspendue.',409);
 }else if(d.type==='send'){
  insist(i&&['proposed','approved','dispatched'].includes(i.status),'Aucune coupure à traiter pour le moment.',409);
  if(i.status==='proposed'){
   // Mesures trop anciennes ou plan dépassé : nouvelle collecte puis nouvelle analyse, comme le demande le NOC.
   const seg=s.get('SELECT sample_at FROM noc_segments WHERE id=?',SEGMENT);
   if(Date.now()-seg.sample_at>120000)noc.operate(s,uid,{type:'simulate',segment:SEGMENT,scenario:'fiber'});
   const fresh=s.get('SELECT sample_at FROM noc_segments WHERE id=?',SEGMENT).sample_at;
   if(!i.plan||i.plan.expiresAt<=Date.now()+60000||i.plan.segmentSample!==fresh)i=act('analyze');
  }
  if(i.status==='proposed')i=act('approve',{note:'Validé depuis la régie : alarmes de coupure fibre confirmées sur Niangon.'});
  if(i.status==='approved'){const free=noc.overview(s,uid).technicians.filter(t=>!t.busy),t=free.find(t=>t.id===TECH)||free.find(t=>t.zone==='Yopougon')||free[0];insist(t,'Toutes les équipes sont déjà en intervention.',409);i=act('dispatch',{technician:t.id,safety:true});}
  if(i.status==='dispatched')i=act('advance');
 }else if(d.type==='arrive'){
  insist(i&&i.status==='en_route','Le technicien n’est pas en route.',409);act('advance');
 }else{
  insist(i&&['on_site','verifying'].includes(i.status),'Le technicien doit être sur place avant la réparation.',409);
  if(i.status==='on_site'){
   // Les consignes de la checklist terrain sont cochées par l'administrateur, comme dans l'espace Moov.
   const key='incident:'+i.id;for(const c of s.all('SELECT id FROM noc_checklist WHERE case_key=? AND done=0',key)){const w=workspace.overview(s,uid).queue.find(r=>r.key===key);workspace.action(s,uid,{key,type:'check',itemId:c.id,done:true,version:w.version,sourceVersion:w.sourceVersion});}
   i=act('advance');
  }
  // Le segment réparé renvoie des mesures normales, puis la supervision vérifie avant de clôturer.
  noc.operate(s,uid,{type:'simulate',segment:SEGMENT,scenario:'normal'});
  act('verify');
 }
 return status(s,uid,origin);
}

// Tout remettre à zéro : la démo repart de son état initial, mais les membres du jury restent connectés
// et la personne à la régie aussi. Ses droits sont revérifiés après la remise à zéro.
async function reset(s,uid,options={}){
 requireAdmin(s,uid);s.rate('regie-reset',20,600000);
 const self=s.get('SELECT * FROM users WHERE id=?',uid),demo=require('./seed-demo.cjs'),demoEmails=Object.values(demo.DEMO).map(a=>a.email);
 const keepSelf=!demoEmails.includes(self.email);
 const rows=(sql,...p)=>s.all(sql,...p);
 const kept={
  jury_rooms:rows('SELECT * FROM jury_rooms WHERE closed=0 AND expires>?',Date.now()),
  users:rows('SELECT u.* FROM users u JOIN jury_members m ON m.user_id=u.id').concat(keepSelf?[self]:[]),
  sessions:rows('SELECT s.* FROM sessions s JOIN jury_members m ON m.user_id=s.user_id'),
  jury_members:rows('SELECT * FROM jury_members'),
  operator_grants:keepSelf?rows('SELECT * FROM operator_grants WHERE user_id=?',uid):[]
 };
 const result=await demo.resetDemo(s,options);
 const insert=(table,list)=>{for(const r of list){const cols=Object.keys(r);s.run('INSERT OR IGNORE INTO "'+table+'"('+cols.map(c=>'"'+c+'"').join(',')+') VALUES('+cols.map(()=>'?').join(',')+')',...cols.map(c=>r[c]));}};
 s.transaction(()=>{
  for(const t of ['users','operator_grants','sessions','jury_rooms','jury_members'])insert(t,kept[t]);
  const rooms=new Set(kept.jury_rooms.map(r=>r.id));s.run('DELETE FROM jury_members WHERE room NOT IN ('+(rooms.size?[...rooms].map(()=>'?').join(','):"''")+')',...rooms);
  // Les rooms gardées repartent de zéro : la nouvelle scène commence maintenant.
  s.run('UPDATE jury_rooms SET created=?',Date.now());
  for(const m of s.all('SELECT user_id FROM jury_members')){journey.put(s,m.user_id,journey.seed());noc.join(s,m.user_id,{segment:SEGMENT,consent:true});}
 });
 const admin=s.get('SELECT id,email,name FROM users WHERE email=?',self.email);
 insist(admin&&O.role(s,admin.id)==='admin','Démo remise à zéro. Reconnectez-vous à la régie.',401);
 return {seeded:result.seeded,user:admin};
}

module.exports={migrate,join,me,status,step,reset,certificate,SEGMENT,ZONE};
