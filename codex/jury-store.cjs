'use strict';
// « Le jury vit la panne » : chaque membre du jury scanne un QR code et devient un abonné anonyme
// de Yopougon (segment YOP-07), sans numéro (un prénom seulement, s'il le veut). La régie (administrateur uniquement)
// déclenche les scènes avec les actions habituelles du NOC : mêmes validations, mêmes droits, rien n'est contourné.
// Réseau de démo (salle ouverte avec un nom de réseau) : le partage de connexion de l'équipe joue la box du quartier.
// La panne est jouée sur sa copie (copie-wifi.cjs), et les inscrits ne sont prévenus qu'après la validation d'un responsable.
const crypto=require('node:crypto');
const {id,token,insist}=require('./pilot-model.cjs');
const O=require('./operator-store.cjs'),noc=require('./noc-store.cjs'),journey=require('./journey-store.cjs'),workspace=require('./noc-workspace.cjs'),CW=require('./copie-wifi.cjs');
const SEGMENT='YOP-07',ZONE='Yopougon · Niangon',TECH='koffi';
const ROOM_MS=4*3600000,MAX_JURORS=60,DEFAULT_SSID='MOOV-FIBRE-DEMO',COPY_MS=12*3600000;
// Pannes du réseau de démo : le scénario du NOC et la même panne rejouée sur la copie du Wi-Fi.
const FAULTS={fiber:{scenario:'fiber',copy:'fibre-coupee',cause:'FIBER_CUT_DISTRIBUTION'},power:{scenario:'power',copy:'courant',cause:'POWER_OUTAGE'}};
const faultOf=i=>i?.plan?.cause==='POWER_OUTAGE'?'power':'fiber';
// Tant qu'un responsable n'a pas validé, les inscrits du réseau de démo ne voient rien : pas de fausse alerte.
// On regarde la validation elle-même (événement « plan.approved »), pas l'état du dossier : un dossier refusé ou clôturé
// sans validation reste invisible, et une nouvelle analyse après la validation ne cache pas une alerte déjà reçue.
const validated=i=>!!(i&&(i.events||[]).some(e=>e.kind==='plan.approved'));
// Lettres invisibles (remplissages coréens) : refusées, sinon un prénom vide s'afficherait sur le grand écran.
const BLANK_LETTERS=/[\u115F\u1160\u3164\uFFA0]/u;
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0 ni I/1, faciles à confondre à l'oral.

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS jury_rooms(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,closed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS jury_members(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,room TEXT NOT NULL,number INTEGER NOT NULL,joined INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS jury_networks(room TEXT PRIMARY KEY,ssid TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS jury_alerts(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,incident_id TEXT NOT NULL,delivered INTEGER NOT NULL,seen INTEGER,PRIMARY KEY(user_id,incident_id));
 `);
 // Prénom facultatif, montré sur le grand écran de la régie (bases déjà créées : colonne ajoutée une fois).
 if(!s.all('PRAGMA table_info(jury_members)').some(c=>c.name==='first'))s.db.exec('ALTER TABLE jury_members ADD COLUMN first TEXT');
 // Un numéro par inscrit dans une salle, même quand tout le monde scanne en même temps.
 try{s.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS jury_member_number ON jury_members(room,number)');}catch(_){/* ancienne base avec des doublons : le numéro reste attribué dans la transaction */}
}
function requireAdmin(s,uid){insist(O.role(s,uid)==='admin','Régie réservée à l’administrateur.',403);}
const openRoom=s=>s.get('SELECT * FROM jury_rooms WHERE closed=0 AND expires>? ORDER BY created DESC LIMIT 1',Date.now());
const code=()=>Array.from({length:6},()=>ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const networkOf=(s,roomId)=>roomId?s.get('SELECT ssid FROM jury_networks WHERE room=?',roomId)?.ssid||null:null;
// Nom du réseau : celui du partage de connexion (32 octets au plus, comme un vrai nom de Wi-Fi).
// Caractères de contrôle et caractères invisibles (sens d'écriture, espaces sans largeur) retirés.
function cleanSsid(v){const t=String(v??'').replace(/[\p{Cc}\p{Cf}]/gu,'').trim()||DEFAULT_SSID;insist(Buffer.byteLength(t)<=32,'Le nom du réseau est trop long : 32 caractères au plus (un accent compte double).');return t;}
// Prénom : des lettres (accents compris, deux au plus par lettre), un espace, un tiret ou une apostrophe.
// Jamais de chiffres : pas de numéro caché. 30 caractères visibles au plus.
const graphemes=t=>[...new Intl.Segmenter('fr',{granularity:'grapheme'}).segment(t)].length;
function cleanFirst(v){if(v==null)return null;insist(typeof v==='string','Prénom invalide.');const t=v.normalize('NFC').replace(/\s+/g,' ').trim();if(!t)return null;
 insist(graphemes(t)<=30&&!BLANK_LETTERS.test(t)&&/^\p{L}\p{M}{0,2}(?:[\p{L}'’ -]\p{M}{0,2})*$/u.test(t),'Votre prénom : des lettres seulement, 30 au plus.');return t;}

// La scène du jury : la dernière intervention de démonstration de Yopougon ouverte depuis la salle,
// ou une coupure encore en cours qui l'a précédée (salle rouverte pendant une panne : la régie la reprend).
function sceneId(s,room){return room?s.get("SELECT id FROM noc_incidents WHERE mode='demo' AND segment_id=? AND (created>=? OR (source='telemetry' AND status NOT IN ('resolved','closed'))) ORDER BY created DESC,rowid DESC LIMIT 1",SEGMENT,room.created)?.id||null:null;}
function at(events,kind){return (events||[]).filter(e=>e.kind===kind).map(e=>e.at).pop()||null;}
// Certificat de réparation : uniquement quand la supervision a vérifié le retour des mesures du segment.
function certificate(s,i){
 if(!i||i.status!=='resolved'||!i.restorationVerified)return null;
 const resolved=s.get("SELECT detail,at FROM noc_events WHERE incident_id=? AND kind='resolved' ORDER BY at DESC,rowid DESC LIMIT 1",i.id),detail=JSON.parse(resolved?.detail||'{}');
 const start=at(i.events,'detected')||i.created,end=resolved?.at||at(i.events,'resolved');
 return {reference:'FG-'+i.id.replace(/[^a-z0-9]/gi,'').slice(0,6).toUpperCase(),zone:ZONE,cause:i.cause||null,technician:i.technician?.name||null,team:i.technician?.team||null,
  detectedAt:start,arrivedAt:at(i.events,'on_site'),repairedAt:at(i.events,'verifying'),restoredAt:end,durationMin:end&&start?Math.max(1,Math.round((end-start)/60000)):null,
  online:Number.isFinite(detail.online)?detail.online:null,total:Number.isFinite(detail.total)?detail.total:null,verifiedBy:'Supervision Moov'};
}

// Rapport de preuves de la scène (recommandation de Codex, 2026-10-23) : chaque chiffre vient des événements
// réellement enregistrés pendant cette démonstration, rien n'est estimé. Les économies en francs restent sur la page Impact.
function report(s,i,room=null){
 if(!i)return null;
 const ev=i.events||[],when=k=>ev.find(e=>e.kind===k)?.at||null,last=k=>at(ev,k),detail=k=>{try{return JSON.parse(ev.filter(e=>e.kind===k).at(-1)?.detail||'{}');}catch{return {};}};
 const cut=s.get("SELECT at FROM noc_events WHERE kind='simulation' AND incident_id IS NULL AND at<=? AND json_extract(detail,'$.segment')=? ORDER BY at DESC,rowid DESC LIMIT 1",i.created,SEGMENT)?.at||null;
 const detected=when('detected')||i.created,approved=when('plan.approved'),departed=when('en_route'),arrived=when('on_site'),repaired=when('verifying'),restored=last('resolved');
 const sec=(a,b)=>a&&b&&b>=a?Math.round((b-a)/1000):null;
 const before=detail('detected'),after=detail('resolved');
 const notified=s.get("SELECT count(DISTINCT n.user_id) AS n,count(DISTINCT CASE WHEN n.read_at IS NOT NULL THEN n.user_id END) AS read FROM noc_notifications n JOIN noc_events e ON e.id=n.event_id WHERE e.incident_id=?",i.id);
 const rows=[
  {key:'detection',label:'Coupure → détection par Guardian',seconds:sec(cut,detected)},
  {key:'decision',label:'Détection → plan validé par un responsable',seconds:sec(detected,approved)},
  {key:'trajet',label:'Départ → arrivée du technicien',seconds:sec(departed,arrived)},
  {key:'intervention',label:'Arrivée → réparation déclarée',seconds:sec(arrived,repaired)},
  {key:'total',label:'Détection → retour du service vérifié',seconds:sec(detected,restored)}];
 const restoredBoxes=Number.isFinite(after.online)&&Number.isFinite(before.online)?after.online-before.online:null;
 return {at:Date.now(),rows,offline:Number.isFinite(before.online)?before.total-before.online:null,total:before.total??null,restored:restoredBoxes,
  notified:notified.n,read:notified.read,partial:ev.some(e=>e.kind==='guardian.hold'),verified:i.status==='resolved'&&!!i.restorationVerified,
  // Réseau de démo : l'alerte part à la validation ; sinon dès la détection.
  alert:room?alertStats(s,room,i,room.network?approved:detected):null,
  source:'Événements enregistrés pendant cette démonstration'};
}
// L'alerte sur les téléphones inscrits : reçue (la page l'a affichée), vue (la personne a touché « Suivre »),
// et les appels au service client. Appel évité = prévenu qui n'a pas demandé de conseiller.
// Une alerte compte seulement si elle est arrivée pendant la panne (jury_alerts n'est rempli que tant que le dossier est ouvert).
// Le délai « validation → alerte » ne prend que les inscrits déjà là au moment de la validation : un retardataire ne l'allonge pas.
function alertStats(s,room,i,from){
 const members=s.get('SELECT count(*) AS n FROM jury_members WHERE room=?',room.id).n;
 const a=s.get('SELECT count(*) AS delivered,count(a.seen) AS seen,max(CASE WHEN m.joined<=? THEN a.delivered END) AS last FROM jury_alerts a JOIN jury_members m ON m.user_id=a.user_id WHERE m.room=? AND a.incident_id=?',from||0,room.id,i.id);
 const calls=s.get("SELECT count(CASE WHEN c.outcome='called' THEN 1 END) AS called,count(CASE WHEN c.outcome<>'called' THEN 1 END) AS reassured FROM noc_calls c JOIN jury_members m ON m.user_id=c.user_id WHERE m.room=? AND c.incident_id=?",room.id,i.id);
 return {members,delivered:a.delivered,seen:a.seen,seconds:a.last&&from&&a.last>=from?Math.round((a.last-from)/1000):null,called:calls.called,reassured:calls.reassured,avoided:Math.max(0,a.delivered-calls.called)};
}

async function join(s,d,ip){
 s.rate('jury-join:'+ip,40,600000);
 insist(d.consent===true,'Votre accord est nécessaire pour recevoir les alertes du quartier.');
 const first=cleanFirst(d.firstName);
 const room=s.get('SELECT * FROM jury_rooms WHERE code=?',String(d.code||'').trim().toUpperCase().slice(0,12));
 insist(room&&!room.closed&&room.expires>Date.now(),'Ce code n’est plus valable. Demandez le nouveau code à l’équipe.',404);
 const full=()=>insist(s.get('SELECT count(*) AS n FROM jury_members WHERE room=?',room.id).n<MAX_JURORS,'La salle du jury est complète.',409);full();
 // Compte anonyme d'abonné : aucun numéro de téléphone, aucun rôle opérateur ; le prénom seulement si la personne l'a écrit.
 // Le numéro d'inscrit est donné dans la transaction : plusieurs personnes qui scannent ensemble ont chacune le leur.
 const {user}=await s.register({email:'jury-'+id()+'@guardian.invalid',name:first||'Membre du jury',password:token()});
 let number;
 try{s.transaction(()=>{full();number=s.get('SELECT COALESCE(max(number),0)+1 AS n FROM jury_members WHERE room=?',room.id).n;
  if(!first)s.run('UPDATE users SET name=? WHERE id=?','Membre du jury '+number,user.id);
  s.run('INSERT INTO jury_members(user_id,room,number,joined,first) VALUES(?,?,?,?,?)',user.id,room.id,number,Date.now(),first);journey.put(s,user.id,journey.seed());noc.join(s,user.id,{segment:SEGMENT,consent:true});});}
 catch(e){s.run('DELETE FROM users WHERE id=?',user.id);throw e;}
 return {...user,name:first||'Membre du jury '+number};
}

function me(s,uid){
 const m=s.get('SELECT m.*,r.code,r.created AS room_created,r.expires,r.closed FROM jury_members m JOIN jury_rooms r ON r.id=m.room WHERE m.user_id=?',uid);insist(m,'Cet espace est réservé aux membres du jury.',404);
 const sid=sceneId(s,{created:m.room_created}),network=networkOf(s,m.room),seg=s.get('SELECT online,total,alarm FROM noc_segments WHERE id=?',SEGMENT);
 let scene=sid?noc.client(s,uid).incidents.find(i=>i.id===sid)||null:null;
 const plan=sid?s.get('SELECT plan,created FROM noc_incidents WHERE id=?',sid):null;
 // Réseau de démo : la panne existe déjà pour Moov, mais l'abonné ne reçoit rien avant la validation d'un responsable.
 if(network&&scene&&!validated(scene))scene=null;
 // Alerte reçue : seulement pendant la panne (un certificat vu après coup n'est pas une alerte reçue).
 if(scene&&!scene.terminal)s.run('INSERT OR IGNORE INTO jury_alerts(user_id,incident_id,delivered) VALUES(?,?,?)',uid,scene.id,Date.now());
 // Sans alerte validée, les chiffres du quartier ne s'affichent que s'ils sont normaux : rien ne laisse deviner une panne non confirmée.
 const calm=seg.alarm==='NONE'&&seg.online>=seg.total,showSegment=!network||!!scene||calm;
 return {number:m.number,first:m.first||null,zone:ZONE,network,joined:m.joined,room:{open:!m.closed&&m.expires>Date.now()},segment:showSegment?{online:seg.online,total:seg.total,alarm:seg.alarm}:null,
  scene:scene?{...scene,created:plan.created,cause:plan.plan?JSON.parse(plan.plan).cause:null,certificate:certificate(s,scene)}:null};
}
// « Suivre l'intervention » : la personne a vu l'alerte. Ses notifications du quartier passent en lues.
function seen(s,uid,d){
 const m=s.get('SELECT user_id FROM jury_members WHERE user_id=?',uid);insist(m,'Cet espace est réservé aux membres du jury.',404);
 insist(typeof d?.id==='string'&&d.id.length<=100,'Alerte inconnue.');
 const row=s.get('SELECT seen FROM jury_alerts WHERE user_id=? AND incident_id=?',uid,d.id);insist(row,'Alerte inconnue.',404);
 s.run('UPDATE jury_alerts SET seen=COALESCE(seen,?) WHERE user_id=? AND incident_id=?',Date.now(),uid,d.id);
 noc.readNotifications(s,uid,{all:true});
 return {ok:true};
}

// La copie du réseau de démo : uniquement une copie faite depuis le compte de la régie (jamais celle d'un client, même si
// son Wi-Fi porte le même nom), mesurée, pas en données mobiles, et soit faite depuis l'ouverture du réseau de démo,
// soit dont le Wi-Fi porte son nom. La plus récente gagne (« Refaire la copie »).
function copyFor(s,uid,room,ssid){
 const want=ssid.trim().toLowerCase(),opened=s.get('SELECT created FROM jury_networks WHERE room=?',room.id)?.created||room.created;
 for(const r of s.all('SELECT id,created FROM wifi_copies WHERE user_id IN (?,?) AND created>=? ORDER BY created DESC LIMIT 20',room.created_by,uid,Date.now()-COPY_MS)){
  const c=CW.detail(s,uid,r.id).copy;
  if(!c.measured||c.network==='cellular')continue;
  if(r.created>=opened||String(c.wifi?.ssid||'').trim().toLowerCase()===want)return c;
 }
 return null;
}
const slim=d=>({id:d.id,kind:d.kind,label:d.label,state:d.state||null,stateLabel:d.stateLabel||null,played:!!d.played,added:!!d.added});
const GATEWAY=d=>d.kind==='box'||d.kind==='partage';
// Sans panne : les appareils de la copie tels qu'ils étaient (le téléphone qui partage sa connexion joue la box).
function calm(copy){
 const list=copy.devices.length?copy.devices:[{id:'la-box',kind:'box',label:'Box Wi-Fi'},{id:'cet-appareil',kind:'self',label:'Appareil du test'}];
 return list.map(d=>GATEWAY(d)?{...d,label:d.kind==='partage'?'Box Wi-Fi':d.label,played:d.kind==='partage'||!copy.devices.length,state:'box',stateLabel:CW.STATES.box}:{...d,state:'ok',stateLabel:CW.STATES.ok}).map(slim);
}
function networkView(s,uid,room,ssid,scene){
 const d=copyFor(s,uid,room,ssid);if(!d)return {ssid,copy:null,twin:null};
 const c=d,active=scene&&!['resolved','closed','rejected'].includes(scene.status);
 const copy={id:d.id,label:d.label,created:d.created,network:d.networkLabel,pc:d.pc,downloadMbps:d.metrics.downloadMbps,latencyMs:d.metrics.latencyMs,connected:d.connected,devices:calm(d)};
 if(!active)return {ssid,copy,twin:null};
 const t=CW.teamSimulate(s,uid,{id:c.id,scenario:FAULTS[faultOf(scene)].copy});
 return {ssid,copy,twin:{fault:faultOf(scene),label:t.label,text:t.text,note:t.note,devices:t.devices.map(slim),summary:t.summary}};
}
// L'étape suivante de la régie. Réseau de démo : un responsable valide avant toute alerte ; coupure de courant : pas de technicien.
function nextOf(i,network){
 const st=i?.status;
 if(!i||['resolved','closed','rejected'].includes(st))return 'cut';
 if(network&&['reported','proposed'].includes(st))return 'validate';
 if(st==='approved'&&i.plan?.dispatch===false)return 'repair';
 if(['reported','proposed','approved','dispatched'].includes(st))return 'send';
 return st==='en_route'?'arrive':'repair';
}

function status(s,uid,origin){
 requireAdmin(s,uid);
 const room=openRoom(s),sid=sceneId(s,room),scene=sid?noc.overview(s,uid).incidents.find(i=>i.id===sid):null,network=room?networkOf(s,room.id):null;
 const jurors=room?s.get('SELECT count(*) AS n FROM jury_members WHERE room=?',room.id).n:0;
 const ratings=sid?s.get('SELECT count(*) AS n,avg(f.rating) AS avg FROM noc_feedback f JOIN jury_members m ON m.user_id=f.user_id WHERE f.incident_id=?',sid):{n:0,avg:null};
 const st=scene?.status,step=nextOf(scene,network);
 const seg=s.get('SELECT online,total,alarm FROM noc_segments WHERE id=?',SEGMENT);
 // Les inscrits, pour le grand écran : prénom (ou numéro), alerte reçue, alerte vue. Jamais d'adresse ni de numéro de téléphone.
 const members=room?s.all('SELECT m.number,m.first,a.delivered,a.seen FROM jury_members m LEFT JOIN jury_alerts a ON a.user_id=m.user_id AND a.incident_id=? WHERE m.room=? ORDER BY m.number LIMIT ?',sid||'',room.id,MAX_JURORS)
  .map(r=>({number:r.number,name:r.first||null,delivered:r.delivered||null,seen:r.seen||null})):[];
 return {room:room?{code:room.code,url:origin+'/codex/?jury='+room.code,expires:room.expires,created:room.created,jurors,network}:null,
  members,network:network?networkView(s,uid,room,network,scene):null,
  report:scene?report(s,scene,{...room,network}):null,
  scene:scene?{id:scene.id,status:st,cause:scene.plan?.cause||null,dispatch:scene.plan?scene.plan.dispatch!==false:true,hold:scene.hold||null,created:scene.created,technician:scene.technician,position:scene.position,events:scene.events.map(e=>({kind:e.kind,text:e.public_text,at:e.at}))}:null,
  next:room?step:'open',segment:{id:SEGMENT,zone:ZONE,...seg},ratings:{count:ratings.n,average:ratings.avg==null?null:Math.round(ratings.avg*10)/10}};
}

// Une étape de la scène = une suite d'actions NOC habituelles, faites avec les droits de l'administrateur connecté.
function step(s,uid,d,origin){
 requireAdmin(s,uid);
 insist(['open','close','cut','validate','send','arrive','repair','partial'].includes(d.type),'Étape inconnue.');
 if(d.type==='open'){
  // Avec un nom de réseau (la régie l'envoie toujours) : réseau de démo, validation d'un responsable avant l'alerte.
  const ssid=typeof d.ssid==='string'?cleanSsid(d.ssid):null;
  s.transaction(()=>{s.run('UPDATE jury_rooms SET closed=1 WHERE closed=0');const rid=id(),now=Date.now();s.run('INSERT INTO jury_rooms VALUES(?,?,?,?,?,0)',rid,code(),uid,now,now+ROOM_MS);if(ssid)s.run('INSERT INTO jury_networks VALUES(?,?,?)',rid,ssid,now);});
  return status(s,uid,origin);}
 const room=openRoom(s);insist(room,'Ouvrez d’abord la salle du jury.',409);
 if(d.type==='close'){s.run('UPDATE jury_rooms SET closed=1 WHERE id=?',room.id);return status(s,uid,origin);}
 const network=networkOf(s,room.id),where=network?'sur le réseau '+network:'à Niangon';
 const current=()=>{const sid=sceneId(s,room);return sid?noc.overview(s,uid).incidents.find(i=>i.id===sid):null;};
 const act=(type,extra={})=>{const i=current();noc.operate(s,uid,{type,id:i.id,version:i.version,...extra});return current();};
 let i=current();
 // Mesures trop anciennes ou plan dépassé : nouvelle collecte puis nouvelle analyse, comme le demande le NOC.
 const refresh=()=>{
  const seg=s.get('SELECT sample_at FROM noc_segments WHERE id=?',SEGMENT);
  if(Date.now()-seg.sample_at>120000){noc.operate(s,uid,{type:'simulate',segment:SEGMENT,scenario:FAULTS[faultOf(i)].scenario});i=current();}
  const fresh=s.get('SELECT sample_at FROM noc_segments WHERE id=?',SEGMENT).sample_at;
  if(!i.plan||i.plan.expiresAt<=Date.now()+60000||i.plan.segmentSample!==fresh)i=act('analyze');
 };
 if(d.type==='cut'){
  // Réseau de démo : fibre coupée ou courant coupé. Salle classique : la coupure fibre habituelle.
  const fault=network&&d.fault==='power'?'power':'fiber';
  insist(!i||i.terminal||i.status==='rejected','Une coupure est déjà en cours '+where+'.',409);
  // Plan refusé par un responsable (fausse alerte) : le quartier revient à la normale et le dossier est clôturé sans déplacement.
  if(i?.status==='rejected')noc.operate(s,uid,{type:'simulate',segment:SEGMENT,scenario:'normal'});
  insist(!s.get("SELECT id FROM noc_incidents WHERE segment_id=? AND source='telemetry' AND status NOT IN ('resolved','closed')",SEGMENT),'Une coupure est déjà en cours '+where+'.',409);
  noc.operate(s,uid,{type:'simulate',segment:SEGMENT,scenario:FAULTS[fault].scenario});
  insist(current(),'La coupure n’a pas été détectée. Vérifiez que la supervision n’est pas suspendue.',409);
 }else if(d.type==='validate'){
  // Un responsable confirme le diagnostic de Guardian : c'est à ce moment que les téléphones inscrits sont prévenus.
  insist(network,'Cette salle n’a pas de réseau de démo : utilisez « Envoyer le technicien ».',409);
  insist(i&&!i.terminal&&['reported','proposed','approved'].includes(i.status),'Aucune panne à valider pour le moment.',409);
  if(i.status!=='approved'){refresh();i=act('approve',{note:'Validé par un responsable depuis la régie : '+(faultOf(i)==='power'?'coupure de courant':'coupure fibre')+' confirmée sur le réseau '+network+'.'});}
 }else if(d.type==='send'){
  insist(i&&['proposed','approved','dispatched'].includes(i.status),'Aucune coupure à traiter pour le moment.',409);
  insist(!network||i.status!=='proposed','Un responsable doit d’abord valider la panne.',409);
  insist(i.plan?.dispatch!==false,'Pas de technicien à envoyer : les box repartiront au retour du courant.',409);
  if(i.status==='proposed'){refresh();}
  if(i.status==='proposed')i=act('approve',{note:'Validé depuis la régie : alarmes de coupure fibre confirmées sur Niangon.'});
  // Validée depuis un moment (le jury lisait l'alerte) : plan ou mesures dépassés, Guardian réactualise et la régie confirme.
  if(i.status==='approved'&&!i.technician){const sample=s.get('SELECT sample_at FROM noc_segments WHERE id=?',SEGMENT).sample_at;
   if(!i.plan||i.plan.expiresAt<=Date.now()+60000||i.plan.segmentSample!==sample||Date.now()-sample>120000){refresh();if(i.status==='proposed')i=act('approve',{note:'Plan actualisé avant le départ de l’équipe : validation confirmée depuis la régie.'});}}
  if(i.status==='approved'){const free=noc.overview(s,uid).technicians.filter(t=>!t.busy),t=free.find(t=>t.id===TECH)||free.find(t=>t.zone==='Yopougon')||free[0];insist(t,'Toutes les équipes sont déjà en intervention.',409);i=act('dispatch',{technician:t.id,safety:true});}
  if(i.status==='dispatched')i=act('advance');
 }else if(d.type==='arrive'){
  // Le trajet dure 30 s puis le technicien arrive tout seul : un clic tardif ne fait rien de plus.
  if(i&&['on_site','verifying'].includes(i.status))return status(s,uid,origin);
  insist(i&&i.status==='en_route','Le technicien n’est pas en route.',409);act('advance');
 }else if(d.type==='repair'&&i&&i.status==='approved'&&i.plan?.dispatch===false){
  // Coupure de courant validée : le courant revient, les box se reconnectent seules, la supervision vérifie avant de clôturer.
  noc.operate(s,uid,{type:'simulate',segment:SEGMENT,scenario:'normal'});
  act('verify');
 }else{
  insist(!(d.type==='partial'&&i?.plan?.dispatch===false),'Pas de réparation partielle pour une coupure de courant : toutes les box repartent ensemble au retour du courant.',409);
  insist(i&&['on_site','verifying'].includes(i.status),'Le technicien doit être sur place avant la réparation.',409);
  // Les consignes de la checklist terrain sont cochées par l'administrateur, comme dans l'espace Moov.
  const repaired=()=>{const key='incident:'+i.id;for(const c of s.all('SELECT id FROM noc_checklist WHERE case_key=? AND done=0',key)){const w=workspace.overview(s,uid).queue.find(r=>r.key===key);workspace.action(s,uid,{key,type:'check',itemId:c.id,done:true,version:w.version,sourceVersion:w.sourceVersion});}return act('advance');};
  if(d.type==='partial'){
   // Variante du jury : la réparation principale est faite mais 4 foyers restent coupés. Guardian doit refuser la clôture.
   insist(!i.hold,'La réparation partielle est déjà en cours : lancez le contrôle ciblé.',409);
   if(i.status==='on_site')i=repaired();
   noc.operate(s,uid,{type:'simulate',segment:SEGMENT,scenario:'partial',remaining:4});
   return status(s,uid,origin);
  }
  // Après une réparation partielle : contrôle ciblé demandé au technicien, puis nouvelle réparation déclarée.
  if(i.status==='verifying'&&i.hold)i=act('followup');
  if(i.status==='on_site')i=repaired();
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
 // Le réseau de démo et la copie de son Wi-Fi restent : la scène se rejoue sur le même réseau.
 const room=openRoom(s),ssid=room?networkOf(s,room.id):null,copy=ssid?copyFor(s,uid,room,ssid):null;
 const kept={
  jury_networks:room?rows('SELECT * FROM jury_networks WHERE room=?',room.id):[],
  wifi_copies:copy?rows('SELECT * FROM wifi_copies WHERE id=?',copy.id):[],
  jury_rooms:rows('SELECT * FROM jury_rooms WHERE closed=0 AND expires>?',Date.now()),
  // Seuls les inscrits de la salle encore ouverte restent : ceux des salles fermées (et leur prénom) sont effacés.
  users:rows('SELECT u.* FROM users u JOIN jury_members m ON m.user_id=u.id JOIN jury_rooms r ON r.id=m.room WHERE r.closed=0 AND r.expires>?',Date.now()).concat(keepSelf?[self]:[]),
  sessions:rows('SELECT s.* FROM sessions s JOIN jury_members m ON m.user_id=s.user_id JOIN jury_rooms r ON r.id=m.room WHERE r.closed=0 AND r.expires>?',Date.now()),
  jury_members:rows('SELECT m.* FROM jury_members m JOIN jury_rooms r ON r.id=m.room WHERE r.closed=0 AND r.expires>?',Date.now()),
  operator_grants:keepSelf?rows('SELECT * FROM operator_grants WHERE user_id=?',uid):[]
 };
 const result=await demo.resetDemo(s,options);
 const insert=(table,list)=>{for(const r of list){const cols=Object.keys(r);s.run('INSERT OR IGNORE INTO "'+table+'"('+cols.map(c=>'"'+c+'"').join(',')+') VALUES('+cols.map(()=>'?').join(',')+')',...cols.map(c=>r[c]));}};
 s.transaction(()=>{
  for(const t of ['users','operator_grants','sessions','jury_rooms','jury_members','jury_networks','wifi_copies'])insert(t,kept[t]);
  const rooms=new Set(kept.jury_rooms.map(r=>r.id));s.run('DELETE FROM jury_members WHERE room NOT IN ('+(rooms.size?[...rooms].map(()=>'?').join(','):"''")+')',...rooms);
  // Les rooms gardées repartent de zéro : la nouvelle scène commence maintenant.
  s.run('UPDATE jury_rooms SET created=?',Date.now());
  for(const m of s.all('SELECT user_id FROM jury_members')){journey.put(s,m.user_id,journey.seed());noc.join(s,m.user_id,{segment:SEGMENT,consent:true});}
 });
 const admin=s.get('SELECT id,email,name FROM users WHERE email=?',self.email);
 insist(admin&&O.role(s,admin.id)==='admin','Démo remise à zéro. Reconnectez-vous à la régie.',401);
 return {seeded:result.seeded,user:admin};
}

module.exports={report,migrate,join,me,seen,status,step,reset,certificate,SEGMENT,ZONE,DEFAULT_SSID};
