'use strict';
// Fibre Welcome (thème 1) : de la commande au premier surf. Le client commande son forfait, envoie deux photos
// (pièce d'identité et façade du logement), un conseiller Moov vérifie le dossier sous 24 h, le client choisit son
// rendez-vous, un technicien de sa commune installe, puis Guardian accueille le nouvel abonné dans son espace.
// Les droits sont vérifiés ici : un client ne voit que sa commande, seul un compte Moov vérifie ou fait avancer une installation.
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const HOUR=3600000,DAY=24*HOUR,CHECK=24*HOUR,MAX_PHOTO=480000;
const STEPS=[['commande','Commande'],['dossier','Dossier'],['verification','Vérification'],['rdv','Rendez-vous'],['installation','Installation'],['bienvenue','Bienvenue']];
// Statut enregistré → étape affichée au client.
const STEP_OF={dossier:'dossier',a_corriger:'dossier',verification:'verification',rdv:'rdv',planifie:'installation',en_route:'installation',installe:'bienvenue'};
const OPEN=['dossier','a_corriger','verification','rdv','planifie','en_route'];
const ZONE=require('./smart-offer.js').ZONE; // les communes de la carte, comme dans « Quel forfait pour moi ? »
// Technicien de la commune quand il y en a un, sinon l'équipe la plus proche.
const NEAR={Abobo:'Cocody',Adjamé:'Cocody',Attécoubé:'Yopougon',Plateau:'Marcory',Koumassi:'Marcory',Treichville:'Marcory','Port-Bouët':'Marcory','Grand-Bassam':'Marcory'};

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS fibre_welcome(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,plan TEXT NOT NULL,commune TEXT NOT NULL,quartier TEXT NOT NULL,status TEXT NOT NULL,id_photo TEXT,home_photo TEXT,note TEXT,deadline INTEGER,slot INTEGER,tech TEXT,checked_by TEXT REFERENCES users(id),rating INTEGER,comment TEXT,events TEXT NOT NULL DEFAULT '[]',created INTEGER NOT NULL,updated INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS fibre_welcome_user ON fibre_welcome(user_id,created);
 `);}

const plans=()=>require('./journey-store.cjs').PLANS;
const text=(v,label,max)=>{insist(typeof v==='string'&&v.trim().length>=2&&v.trim().length<=max&&!/[\u0000-\u001f<>]/.test(v),label+' à préciser.');return v.trim();};
function photo(v){insist(typeof v==='string'&&v.length<MAX_PHOTO&&/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(v),'Photo JPEG ou PNG de moins de 350 Ko requise.');return v;}
const shortName=name=>{const p=String(name||'').trim().split(/\s+/).filter(Boolean);return p.length?p[0]+(p[1]?' '+p[1][0].toUpperCase()+'.':''):'Client';};
function techFor(commune){const T=require('./noc-store.cjs').TECHS;const t=T.find(x=>x.zone===commune)||T.find(x=>x.zone===(NEAR[commune]||'Cocody'))||T[0];return {id:t.id,name:t.name,team:t.team,rating:t.rating,missions:t.missions};}
// Trois jours ouvrés à partir de demain, matin ou après-midi.
function slots(now=Date.now()){const out=[],d=new Date(now);d.setHours(0,0,0,0);while(out.length<6){d.setDate(d.getDate()+1);if(d.getDay()===0)continue;out.push(d.getTime()+8*HOUR,d.getTime()+14*HOUR);}return out;}
function log(row,what,now){const e=JSON.parse(row.events||'[]');e.push({at:now,what});return JSON.stringify(e.slice(-30));}
const current=(s,uid)=>s.get('SELECT * FROM fibre_welcome WHERE user_id=? ORDER BY created DESC LIMIT 1',uid);

function view(row,now=Date.now()){
 if(!row)return null;const plan=plans().find(p=>p.id===row.plan)||plans()[1],step=STEP_OF[row.status]||'commande';
 return {id:row.id,status:row.status,step,steps:STEPS.map(([id,label])=>({id,label})),plan,commune:row.commune,quartier:row.quartier,
  photos:{id:!!row.id_photo,home:!!row.home_photo},note:row.note||'',deadline:row.deadline,late:row.status==='verification'&&now>row.deadline,
  slot:row.slot,tech:row.tech?JSON.parse(row.tech):null,rating:row.rating,events:JSON.parse(row.events||'[]'),created:row.created,
  slots:row.status==='rdv'?slots(now):[]};
}

// Côté client.
function state(s,uid,now=Date.now()){return {order:view(current(s,uid),now),plans:plans(),zone:ZONE};}

function act(s,uid,d,now=Date.now()){return s.transaction(()=>{
 insist(d&&typeof d.action==='string','Action manquante.');
 const row=current(s,uid),open=row&&OPEN.includes(row.status);
 if(d.action==='order'){
  insist(!open,'Vous avez déjà une installation en cours.',409);
  const plan=plans().find(p=>p.id===d.plan);insist(plan,'Choisissez un forfait.');
  insist(ZONE.includes(d.commune),'Cette commune n’est pas encore couverte par la fibre Moov.');
  const quartier=text(d.quartier,'Le quartier',80),id=crypto.randomUUID();
  s.run('INSERT INTO fibre_welcome(id,user_id,plan,commune,quartier,status,events,created,updated) VALUES(?,?,?,?,?,?,?,?,?)',id,uid,plan.id,d.commune,quartier,'dossier',JSON.stringify([{at:now,what:'Commande de la '+plan.name+' enregistrée'}]),now,now);
  return state(s,uid,now);
 }
 insist(open||(row&&d.action==='rate'),'Aucune installation en cours.',409);
 if(d.action==='photos'){
  insist(['dossier','a_corriger'].includes(row.status),'Votre dossier est déjà envoyé.',409);
  const idp=photo(d.idPhoto),home=photo(d.homePhoto);
  s.run("UPDATE fibre_welcome SET id_photo=?,home_photo=?,note=NULL,status='verification',deadline=?,events=?,updated=? WHERE id=?",idp,home,now+CHECK,log(row,'Dossier envoyé : un conseiller le vérifie sous 24 h',now),now,row.id);
 }else if(d.action==='slot'){
  insist(row.status==='rdv','Le rendez-vous se choisit après la vérification du dossier.',409);
  insist(slots(now).includes(d.at),'Choisissez un des créneaux proposés.');
  const tech=techFor(row.commune);
  s.run("UPDATE fibre_welcome SET slot=?,tech=?,status='planifie',events=?,updated=? WHERE id=?",d.at,JSON.stringify(tech),log(row,'Rendez-vous choisi, '+tech.name+' viendra installer la fibre',now),now,row.id);
 }else if(d.action==='cancel'){
  insist(['dossier','a_corriger','verification','rdv','planifie'].includes(row.status),'Le technicien est déjà en route : appelez Moov pour annuler.',409);
  s.run("UPDATE fibre_welcome SET status='annule',id_photo=NULL,home_photo=NULL,events=?,updated=? WHERE id=?",log(row,'Commande annulée',now),now,row.id);
 }else if(d.action==='rate'){
  insist(row.status==='installe'&&!row.rating,'Vous pourrez noter l’installation une fois la fibre posée.',409);
  insist(Number.isInteger(d.stars)&&d.stars>=1&&d.stars<=5,'Choisissez une note de 1 à 5.');
  const comment=typeof d.comment==='string'&&d.comment.trim()?text(d.comment,'Le commentaire',300):null;
  s.run('UPDATE fibre_welcome SET rating=?,comment=?,events=?,updated=? WHERE id=?',d.stars,comment,log(row,'Installation notée '+d.stars+'/5',now),now,row.id);
 }else insist(false,'Action inconnue.');
 return state(s,uid,now);
});}

// Le nouvel abonné ouvre son espace : Guardian démarre avec le forfait commandé.
function activate(s,uid){const J=require('./journey-store.cjs'),row=current(s,uid);insist(row&&row.status==='installe','Votre fibre n’est pas encore installée.',409);
 let st=J.get(s,uid);if(!st){st=J.seed();const plan=plans().find(p=>p.id===row.plan);if(plan){st.plan={...plan};st.capacity=plan.mbps;}
  st.notifications.unshift({key:crypto.randomUUID(),home:'home-1',at:Date.now(),title:'Bienvenue chez Moov',body:'Votre '+(plan?.name||'fibre')+' est installée. Guardian veille sur votre connexion jour et nuit.',read:false});J.put(s,uid,st);}
 return st;}

// Côté équipe Moov : les dossiers à vérifier et les installations à suivre.
function list(s,uid,now=Date.now()){
 const role=O.requireOperator(s,uid);
 const rows=s.all("SELECT w.*,u.name FROM fibre_welcome w JOIN users u ON u.id=w.user_id WHERE w.status IN ('verification','a_corriger','rdv','planifie','en_route') OR (w.status='installe' AND w.updated>=?) ORDER BY CASE w.status WHEN 'verification' THEN 0 WHEN 'en_route' THEN 1 WHEN 'planifie' THEN 2 ELSE 3 END,w.updated DESC LIMIT 30",now-7*DAY);
 const items=rows.map(r=>({...view(r,now),slots:[],client:shortName(r.name),photoUrls:r.status==='verification'?{id:r.id_photo,home:r.home_photo}:null,comment:r.comment||''}));
 return {role,toCheck:items.filter(i=>i.status==='verification').length,items};
}

function operate(s,uid,d,now=Date.now()){return s.transaction(()=>{
 O.requireOperator(s,uid);
 insist(d&&typeof d.id==='string'&&typeof d.action==='string','Action incomplète.');
 const row=s.get('SELECT * FROM fibre_welcome WHERE id=?',d.id);insist(row,'Installation introuvable.',404);
 const name=s.get('SELECT name FROM users WHERE id=?',uid)?.name||'Un conseiller';
 if(d.action==='validate'){
  insist(row.status==='verification','Ce dossier n’attend pas de vérification.',409);
  s.run("UPDATE fibre_welcome SET status='rdv',checked_by=?,events=?,updated=? WHERE id=?",uid,log(row,'Dossier validé par '+shortName(name)+' : choisissez votre rendez-vous',now),now,row.id);
 }else if(d.action==='ask'){
  insist(row.status==='verification','Ce dossier n’attend pas de vérification.',409);
  const note=text(d.note,'Ce qu’il faut refaire',200);
  s.run("UPDATE fibre_welcome SET status='a_corriger',note=?,id_photo=NULL,home_photo=NULL,checked_by=?,events=?,updated=? WHERE id=?",note,uid,log(row,'Le conseiller demande une nouvelle photo',now),now,row.id);
 }else if(d.action==='depart'){
  insist(row.status==='planifie','Le rendez-vous n’est pas encore fixé.',409);
  s.run("UPDATE fibre_welcome SET status='en_route',events=?,updated=? WHERE id=?",log(row,JSON.parse(row.tech).name+' est en route vers chez vous',now),now,row.id);
 }else if(d.action==='done'){
  insist(row.status==='en_route','Le technicien n’est pas encore parti.',409);
  // Les photos du dossier ne servent plus : elles sont effacées une fois la fibre posée.
  s.run("UPDATE fibre_welcome SET status='installe',id_photo=NULL,home_photo=NULL,events=?,updated=? WHERE id=?",log(row,'Fibre installée et testée : bienvenue chez Moov',now),now,row.id);
 }else insist(false,'Action inconnue.');
 return list(s,uid,now);
});}

module.exports={migrate,STEPS,ZONE,slots,techFor,view,state,act,activate,list,operate};
