'use strict';
// Les « prises » qui branchent Guardian sur le vrai réseau Moov. Chacune marche en démo tant que sa clé n'est pas réglée,
// et passe en réel dès que l'équipe informatique de Moov règle ses variables d'environnement : l'application ne change pas.
//   Réseau  : GUARDIAN_RESEAU_CLE  → l'outil de supervision des box (serveur TR-069 / gestion des OLT) envoie les états des box.
//   Clients : GUARDIAN_CLIENTS_CLE → le fichier clients relie un numéro de téléphone à un compte et à son quartier.
//   USSD    : GUARDIAN_USSD_CLE    → la passerelle USSD de Moov relaie le menu *144# depuis n'importe quel téléphone.
//   SMS     : GUARDIAN_SMS_URL + GUARDIAN_SMS_CLE → les SMS du menu partent par la passerelle SMS de Moov.
// Chaque clé fait au moins 32 caractères, vit chez l'hébergeur (jamais dans git) et n'ouvre qu'une seule prise.
// Le détail des formats est dans BRANCHEMENTS.md.
const crypto=require('node:crypto');
const {insist}=require('./pilot-model.cjs'),O=require('./operator-store.cjs'),U=require('./ussd.cjs');

const PRISES=['reseau','clients','ussd','sms'];
const NOMS={reseau:'États des box (supervision réseau)',clients:'Fichier clients',ussd:'Passerelle USSD',sms:'Passerelle SMS'};
// États d'une interface optique dans la norme TR-181 (Device.Optical.Interface.{i}.Status) : seule « Up » veut dire en ligne.
const ETATS=['Up','Down','Unknown','Dormant','NotPresent','LowerLayerDown','Error'];
// Alarmes d'une box (ONT) remontées par l'OLT, et alarmes d'équipement central comprises par le moteur d'incidents.
const ALARMES_BOX=['LOS','DYING_GASP'];
const ALARMES_ZONE=['LOS','DYING_GASP','LOS_WORKS','WATER','INTRUSION','OLT_DOWN','UPLINK_HIGH'];
const MAX_BOX=5000,MAX_LIGNES=500;

const empreinte=v=>crypto.createHash('sha256').update(String(v)).digest();
const cle=v=>typeof v==='string'&&v.trim().length>=32?v.trim():null;

function config(env=process.env){
 const sms=cle(env.GUARDIAN_SMS_CLE),url=String(env.GUARDIAN_SMS_URL||'').trim();
 return {
  reseau:cle(env.GUARDIAN_RESEAU_CLE),clients:cle(env.GUARDIAN_CLIENTS_CLE),ussd:cle(env.GUARDIAN_USSD_CLE),
  sms:sms&&/^https:\/\//.test(url)?{url,cle:sms,expediteur:String(env.GUARDIAN_SMS_EXPEDITEUR||'Moov').slice(0,11)}:null
 };
}
// Une prise sans clé n'existe pas (404) ; une mauvaise clé est refusée sans dire pourquoi.
function autoriser(cfg,prise,req){
 const attendue=prise==='sms'?null:cfg[prise];insist(attendue,'Introuvable.',404);
 const recue=String(req.headers.authorization||'').replace(/^Bearer /,'');
 insist(recue.length>=32&&recue.length<200&&crypto.timingSafeEqual(empreinte(recue),empreinte(attendue)),'Clé refusée.',401);
}

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS branchement_lignes(telephone TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS branchement_journal(prise TEXT PRIMARY KEY,derniere INTEGER NOT NULL,total INTEGER NOT NULL,erreur TEXT);
`);}
function noter(s,prise,erreur=null){s.run('INSERT INTO branchement_journal VALUES(?,?,1,?) ON CONFLICT(prise) DO UPDATE SET derniere=excluded.derniere,total=total+1,erreur=excluded.erreur',prise,Date.now(),erreur);}

// Numéro ivoirien à 10 chiffres, avec ou sans 225 devant : on garde toujours 225 + 10 chiffres.
function telephone(v){const n=String(v||'').replace(/\D/g,'').replace(/^00/,'');const t=n.length===10?'225'+n:n;insist(/^225\d{10}$/.test(t),'Numéro de téléphone invalide : '+String(v).slice(0,20)+'.');return t;}

// Prise « réseau » : les états des box d'un ou plusieurs quartiers, tels que l'outil de supervision de Moov les lit.
// Format : {mesures:[{segment:'YOP-07', alarme?:'OLT_DOWN', box:[{serie:'HWTC…', etat:'Up'|'Down'…, rxDbm?:-21.4, alarme?:'LOS'}]}]}
// Le quartier reçoit le nombre de box et de box en ligne : la détection reste la règle déjà testée (≥ 5 box et ≥ 30 % éteintes).
function reseau(s,d){
 insist(Array.isArray(d.mesures)&&d.mesures.length>=1&&d.mesures.length<=200,'Liste « mesures » requise (1 à 200 quartiers).');
 const now=Date.now(),recus=[],inconnus=[];let total=0;
 for(const m of d.mesures){
  insist(m&&typeof m.segment==='string'&&m.segment.length<=20&&Array.isArray(m.box)&&m.box.length>=1,'Chaque mesure donne un « segment » et sa liste « box ».');
  insist((total+=m.box.length)<=MAX_BOX,'Trop de box dans un seul envoi ('+MAX_BOX+' au plus).',413);
  insist(m.alarme==null||ALARMES_ZONE.includes(m.alarme),'Alarme de quartier inconnue.');
  for(const b of m.box){insist(b&&typeof b.serie==='string'&&b.serie.length>=4&&b.serie.length<=32&&ETATS.includes(b.etat),'Chaque box donne sa « serie » et un « etat » de la norme TR-181.');insist(b.rxDbm==null||(typeof b.rxDbm==='number'&&b.rxDbm>=-50&&b.rxDbm<=10),'Signal « rxDbm » hors limites.');insist(b.alarme==null||ALARMES_BOX.includes(b.alarme),'Alarme de box inconnue.');}
 }
 s.transaction(()=>{for(const m of d.mesures){
  if(!s.get('SELECT id FROM noc_segments WHERE id=?',m.segment)){inconnus.push(m.segment);continue;}
  const enLigne=m.box.filter(b=>b.etat==='Up').length,eteintes=m.box.filter(b=>b.etat!=='Up');
  // Box sans courant (« dying gasp ») majoritaires : coupure électrique ; sinon une perte de signal (LOS) suffit à parler de fibre.
  const gasp=eteintes.filter(b=>b.alarme==='DYING_GASP').length,los=eteintes.some(b=>b.alarme==='LOS');
  const alarme=m.alarme||(eteintes.length&&gasp*2>=eteintes.length?'DYING_GASP':los?'LOS':'NONE');
  s.run('UPDATE noc_segments SET total=?,online=?,alarm=?,sample_at=? WHERE id=?',m.box.length,enLigne,alarme,now,m.segment);
  s.run("INSERT INTO noc_sources VALUES(?,'reseau',?) ON CONFLICT(segment_id) DO UPDATE SET received=excluded.received",m.segment,now);
  recus.push({segment:m.segment,box:m.box.length,enLigne,alarme});
 }noter(s,'reseau');});
 return {ok:true,recus,inconnus};
}

// Prise « clients » : relie le numéro d'une ligne à un compte abonné existant et à son quartier.
// Format : {lignes:[{telephone:'0701020304', email:'client@…', segment:'YOP-07'}]}. Un compte de l'équipe Moov n'est jamais relié.
function clients(s,d){
 insist(Array.isArray(d.lignes)&&d.lignes.length>=1&&d.lignes.length<=MAX_LIGNES,'Liste « lignes » requise (1 à '+MAX_LIGNES+').');
 const lignes=d.lignes.map(l=>{insist(l&&typeof l.email==='string'&&typeof l.segment==='string','Chaque ligne donne « telephone », « email » et « segment ».');return {telephone:telephone(l.telephone),email:l.email.toLowerCase().trim(),segment:l.segment};});
 const relies=[],refuses=[];
 s.transaction(()=>{for(const l of lignes){
  const u=s.get('SELECT id FROM users WHERE email=?',l.email);
  if(!u){refuses.push({telephone:l.telephone,raison:'Compte introuvable'});continue;}
  if(O.role(s,u.id)!=='subscriber'){refuses.push({telephone:l.telephone,raison:'Compte de l’équipe Moov'});continue;}
  if(!s.get('SELECT id FROM noc_segments WHERE id=?',l.segment)){refuses.push({telephone:l.telephone,raison:'Quartier inconnu'});continue;}
  s.run('INSERT INTO branchement_lignes VALUES(?,?,?) ON CONFLICT(telephone) DO UPDATE SET user_id=excluded.user_id,updated=excluded.updated',l.telephone,u.id,Date.now());
  s.run('INSERT INTO noc_members VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET segment_id=excluded.segment_id',u.id,l.segment);
  relies.push(l.telephone);
 }noter(s,'clients');});
 return {ok:true,relies:relies.length,refuses};
}

// Prise « USSD » : le format des passerelles USSD (sessionId, serviceCode, phoneNumber, text), réponse en texte « CON … » ou « END … ».
// Le menu est exactement celui de l'application (ussd.cjs) : seul le numéro d'appelant remplace la connexion au compte.
function ussd(s,d,{envoyer}={}){
 const numero=telephone(d.phoneNumber),texte=String(d.text??'');
 s.rate('ussd-passerelle:'+numero,60,600000);
 const ligne=s.get('SELECT user_id FROM branchement_lignes WHERE telephone=?',numero);
 noter(s,'ussd');
 if(!ligne)return 'END Ce numéro n’est relié à aucune ligne fibre Moov.\nContactez le service client Moov.';
 const r=U.respond(s,ligne.user_id,{text:texte});
 if(r.sms&&envoyer)envoyer(numero,r.sms.text+(r.sms.link||''));
 return (r.end?'END ':'CON ')+r.message;
}

// Prise « SMS » : un envoi par la passerelle HTTP de Moov (devant son centre SMS). Sans réglage, rien ne part.
async function sms(s,cfg,a,texte,{fetchImpl=fetch}={}){
 if(!cfg.sms)return false;
 try{
  const r=await fetchImpl(cfg.sms.url,{method:'POST',headers:{Authorization:'Bearer '+cfg.sms.cle,'Content-Type':'application/json'},body:JSON.stringify({to:'+'+a,from:cfg.sms.expediteur,text:String(texte).slice(0,459)}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('Passerelle SMS : réponse '+r.status+'.');
  noter(s,'sms');return true;
 }catch(e){noter(s,'sms',e.message.slice(0,200));return false;}
}

// L'état des prises pour l'équipe Moov : en démo ou branchée, et la dernière fois qu'elle a servi. Aucune clé n'est montrée.
function etat(s,cfg){
 const journal=Object.fromEntries(s.all('SELECT * FROM branchement_journal').map(j=>[j.prise,j]));
 return {prises:PRISES.map(p=>({id:p,nom:NOMS[p],mode:cfg[p]?'reel':'demo',derniere:journal[p]?.derniere||null,total:journal[p]?.total||0,erreur:journal[p]?.erreur||null})),
  quartiersBranches:s.all("SELECT segment_id AS segment,received FROM noc_sources WHERE source='reseau' ORDER BY segment_id"),lignes:s.get('SELECT count(*) AS n FROM branchement_lignes').n};
}

// Les passerelles USSD envoient souvent un formulaire (application/x-www-form-urlencoded) plutôt que du JSON.
async function lire(req,max=4096){
 const type=(req.headers['content-type']||'').split(';')[0].trim();
 insist(['application/json','application/x-www-form-urlencoded'].includes(type),'Format refusé.',415);
 let size=0;const parts=[];for await(const c of req){size+=c.length;insist(size<=max,'Requête trop volumineuse.',413);parts.push(c);}
 const raw=Buffer.concat(parts).toString();
 if(type==='application/x-www-form-urlencoded')return Object.fromEntries(new URLSearchParams(raw));
 try{const v=JSON.parse(raw);insist(v&&typeof v==='object'&&!Array.isArray(v),'Objet JSON requis.');return v;}catch(e){if(e.status)throw e;insist(false,'JSON invalide.');}
}

// Routes /api/branchements/… ; renvoie true si la requête a été traitée.
async function route(s,cfg,req,res,chemin,{json,body,user}){
 if(chemin==='/api/branchements'&&req.method==='GET'){O.requireOperator(s,user()?.id);json(res,etat(s,cfg));return true;}
 if(req.method!=='POST')return false;
 if(chemin==='/api/branchements/reseau'){autoriser(cfg,'reseau',req);s.rate('branchement:reseau',120,60000);json(res,reseau(s,await body(req,2*1048576)));return true;}
 if(chemin==='/api/branchements/clients'){autoriser(cfg,'clients',req);s.rate('branchement:clients',30,60000);json(res,clients(s,await body(req,262144)));return true;}
 if(chemin==='/api/branchements/ussd'){
  autoriser(cfg,'ussd',req);
  // Une passerelle attend toujours un écran : une saisie refusée ou trop rapide termine la session poliment.
  let texte;try{texte=ussd(s,await lire(req),{envoyer:(a,t)=>{sms(s,cfg,a,t).catch(()=>{});}});}
  catch(e){if(!e.status||e.status>=500||e.status===413||e.status===415)throw e;texte=e.status===429?'END Trop de demandes. Réessayez dans quelques minutes.':'END Saisie non comprise. Recomposez le '+U.CODE+'.';}
  res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end(texte);return true;
 }
 return false;
}

module.exports={PRISES,ETATS,config,migrate,reseau,clients,ussd,sms,etat,route,telephone};
