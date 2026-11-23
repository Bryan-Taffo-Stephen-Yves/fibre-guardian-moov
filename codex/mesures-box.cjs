'use strict';
// Les vraies mesures de la box d'un client, lues sur le serveur de gestion des box de Moov (ACS, protocole TR-069).
// Tant que GUARDIAN_BOX_URL et GUARDIAN_BOX_CLE ne sont pas réglées, rien n'est lu et le simulateur répond, comme avant.
// Dès qu'elles le sont, chaque box reliée à un compte (prise « clients », champ « serie ») est lue ici :
//   - état de la fibre (Device.Optical.Interface.1.Status), lumière reçue et envoyée (en millièmes de dBm dans TR-181),
//   - temps depuis le dernier redémarrage, modèle, version du logiciel, nombre d'appareils connus de la box,
//   - heure de la dernière remontée de la box à l'ACS.
// Une mesure de plus de 3 minutes n'est jamais montrée comme actuelle (même règle que la prise « réseau ») :
// Guardian revient alors au simulateur au lieu d'inventer. Aucun ordre n'est envoyé à la box : on lit seulement.
// Deux formats sont compris (GUARDIAN_BOX_FORMAT) :
//   genieacs (par défaut) : l'interface NBI de GenieACS, ACS libre très répandu : GET <url>/devices/?query=…&projection=…
//   guardian             : une petite passerelle de Moov qui répond déjà au format simple : GET <url>/box/<serie>
// Le détail est dans BRANCHEMENTS.md (prise 5).
const {insist}=require('./pilot-model.cjs');

const FRAIS_MS=3*60000;      // au-delà, la mesure est trop vieille pour être montrée comme actuelle
const RELIRE_MS=30000;       // une box n'est pas relue plus d'une fois toutes les 30 s (même après un échec)
const DELAI_MS=4000;         // l'ACS a 4 s pour répondre
const ATTENTE_MS=1500;       // l'écran n'attend jamais l'ACS plus de 1,5 s : la lecture continue en arrière-plan
const MAX_OCTETS=262144;     // taille maximale d'une réponse de l'ACS
const SEUIL_FIBRE=-28;       // sensibilité d'un récepteur GPON classe B+ : en dessous, la box ne reçoit plus la fibre
const ETATS=['Up','Down','Unknown','Dormant','NotPresent','LowerLayerDown','Error'];
const SERIE=/^[A-Za-z0-9-]{4,32}$/;
// Chemins TR-181 lus sur l'ACS, et leurs équivalents TR-098 (InternetGatewayDevice, chemins Huawei) pour les box plus anciennes.
const CHEMINS={
 etat:['Device.Optical.Interface.1.Status','InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.Status'],
 rx:['Device.Optical.Interface.1.OpticalSignalLevel','InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower'],
 tx:['Device.Optical.Interface.1.TransmitOpticalLevel','InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.TXPower'],
 uptime:['Device.DeviceInfo.UpTime','InternetGatewayDevice.DeviceInfo.UpTime'],
 modele:['Device.DeviceInfo.ModelName','InternetGatewayDevice.DeviceInfo.ModelName'],
 logiciel:['Device.DeviceInfo.SoftwareVersion','InternetGatewayDevice.DeviceInfo.SoftwareVersion'],
 appareils:['Device.Hosts.HostNumberOfEntries','InternetGatewayDevice.LANDevice.1.Hosts.HostNumberOfEntries']
};

const cle=v=>typeof v==='string'&&v.trim().length>=32?v.trim():null;
function config(env=process.env){
 const url=String(env.GUARDIAN_BOX_URL||'').trim().replace(/\/+$/,''),k=cle(env.GUARDIAN_BOX_CLE),format=String(env.GUARDIAN_BOX_FORMAT||'genieacs').trim().toLowerCase();
 if(!k||!/^https:\/\//.test(url)||!['genieacs','guardian'].includes(format))return null;
 return {url,cle:k,format};
}

// Une box appartient à un seul compte : relier une box à un client la retire de tout autre compte.
function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS branchement_box(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,serie TEXT NOT NULL UNIQUE,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS box_mesures(serie TEXT PRIMARY KEY,body TEXT,lu INTEGER NOT NULL,erreur TEXT);
`);}
// Le numéro de série garde sa casse : l'ACS la respecte.
function serie(v){insist(typeof v==='string'&&SERIE.test(v.trim()),'Numéro de série de box invalide.');return v.trim();}
function relier(s,uid,v){const sn=serie(v);s.run('DELETE FROM branchement_box WHERE serie=? AND user_id<>?',sn,uid);s.run('INSERT INTO branchement_box VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET serie=excluded.serie,updated=excluded.updated',uid,sn,Date.now());}
function delier(s,uid){s.run('DELETE FROM branchement_box WHERE user_id=?',uid);}
const serieDe=(s,uid)=>s.get('SELECT serie FROM branchement_box WHERE user_id=?',uid)?.serie||null;

const nombre=v=>{const n=typeof v==='string'&&v.trim()!==''?Number(v):v;return typeof n==='number'&&Number.isFinite(n)?n:null;};
const texte=v=>typeof v==='string'&&v.trim()?v.trim().slice(0,60):null;
const date=v=>typeof v==='string'?Date.parse(v):nombre(v);
const round=v=>Math.round(v*10)/10;
// Lumière de la fibre : TR-181 la donne en millièmes de dBm (-21400), certaines box en dBm (-21.4).
function dbm(v){const n=nombre(v);if(n==null)return null;const d=Math.abs(n)>100?n/1000:n;return d>=-50&&d<=10?round(d):null;}
// « up », « UP », « Up » → « Up » ; une valeur hors de la norme TR-181 est ignorée.
const etatDe=v=>v==null?null:ETATS.find(e=>e.toLowerCase()===String(v).trim().toLowerCase())||null;

// Une mesure propre, quelle que soit la source.
// vu : heure à laquelle l'état et la lumière ont été lus sur la box (pas seulement la dernière visite de la box à l'ACS).
// uptimeAt : heure à laquelle le compteur « allumée depuis » a été lu, pour le faire avancer sans inventer.
function normaliser(m,serieAttendue){
 insist(m&&typeof m==='object','Réponse de l’ACS illisible.',502);
 const etat=etatDe(m.etat);insist(etat,'État de la fibre absent de la réponse de l’ACS.',502);
 const vu=date(m.vu);insist(Number.isFinite(vu),'Heure de mesure absente de la réponse de l’ACS.',502);
 const uptime=nombre(m.uptimeS),appareils=nombre(m.appareils),uptimeAt=date(m.uptimeAt);
 return {serie:serieAttendue,etat,rxDbm:dbm(m.rxDbm),txDbm:dbm(m.txDbm),uptimeS:uptime!=null&&uptime>=0?Math.round(uptime):null,uptimeAt:Number.isFinite(uptimeAt)?uptimeAt:vu,
  modele:texte(m.modele),logiciel:texte(m.logiciel),appareils:appareils!=null&&appareils>=0&&appareils<=512?Math.round(appareils):null,vu};
}

// GenieACS range chaque paramètre dans un objet imbriqué, avec l'heure où il a été lu sur la box :
// {Device:{Optical:{Interface:{1:{Status:{_value:'Up',_timestamp:'2026-11-23T10:30:00Z'}}}}}}.
function param(doc,chemins){for(const c of chemins){let v=doc;for(const p of c.split('.')){v=v?.[p];if(v==null)break;}if(v&&typeof v==='object'&&'_value' in v)return {valeur:v._value,at:date(v._timestamp)};}return {valeur:null,at:NaN};}
function depuisGenieacs(docs,serieAttendue){
 insist(Array.isArray(docs),'Réponse de l’ACS illisible.',502);insist(docs.length,'Box inconnue de l’ACS.',404);
 insist(docs.length===1,'Plusieurs box portent ce numéro de série sur l’ACS.',502);
 const d=docs[0],e=param(d,CHEMINS.etat),r=param(d,CHEMINS.rx),u=param(d,CHEMINS.uptime),inform=date(d._lastInform);
 // Pas d'état optique remonté : la lumière décide (au-dessus de la sensibilité du récepteur, la fibre arrive).
 const rx=dbm(r.valeur),etat=etatDe(e.valeur)||(rx!=null?(rx>SEUIL_FIBRE?'Up':'Down'):null);
 // L'heure de la mesure est celle de la plus ancienne des valeurs montrées comme actuelles (état, lumière).
 const heures=[etatDe(e.valeur)?e.at:null,rx!=null?r.at:null].filter(x=>x!=null).map(x=>Number.isFinite(x)?x:inform);
 return normaliser({etat,rxDbm:rx,txDbm:param(d,CHEMINS.tx).valeur,uptimeS:u.valeur,uptimeAt:Number.isFinite(u.at)?u.at:inform,modele:param(d,CHEMINS.modele).valeur,
  logiciel:param(d,CHEMINS.logiciel).valeur,appareils:param(d,CHEMINS.appareils).valeur,vu:heures.length?Math.min(...heures):inform},serieAttendue);
}

function adresse(cfg,sn){
 if(cfg.format==='guardian')return cfg.url+'/box/'+encodeURIComponent(sn);
 const projection=['_lastInform',...Object.values(CHEMINS).flat()].join(',');
 return cfg.url+'/devices/?query='+encodeURIComponent(JSON.stringify({'_deviceId._SerialNumber':sn}))+'&projection='+encodeURIComponent(projection);
}
async function lire(cfg,sn,{fetchImpl=fetch}={}){
 const r=await fetchImpl(adresse(cfg,sn),{headers:{Authorization:'Bearer '+cfg.cle,Accept:'application/json'},signal:AbortSignal.timeout(DELAI_MS)});
 insist(r.status!==404,'Box inconnue de l’ACS.',404);insist(r.ok,'ACS : réponse '+r.status+'.',502);
 const brut=await r.text();insist(brut.length<=MAX_OCTETS,'Réponse de l’ACS trop volumineuse.',502);
 // Le contenu de la réponse n'est jamais recopié dans un message d'erreur.
 let data;try{data=JSON.parse(brut);}catch{insist(false,'Réponse de l’ACS illisible.',502);}
 return cfg.format==='guardian'?normaliser(data,sn):depuisGenieacs(data,sn);
}

// Relit la box d'un client si elle est reliée et si la dernière lecture date de plus de 30 s.
// N'attend jamais plus de 1,5 s : au-delà, l'écran répond avec la dernière mesure et la lecture se termine en arrière-plan.
// Ne lève jamais d'erreur : un échec est noté (visible dans GET /api/branchements) et l'écran garde le simulateur.
const enCours=new WeakMap();
async function rafraichir(s,cfg,uid,{fetchImpl,now=Date.now(),attente=ATTENTE_MS}={}){
 if(!cfg)return null;const sn=serieDe(s,uid);if(!sn)return null;
 const prev=s.get('SELECT lu FROM box_mesures WHERE serie=?',sn);if(prev&&now-prev.lu<RELIRE_MS)return lecture(s,uid);
 if(!enCours.has(s))enCours.set(s,new Map());const lectures=enCours.get(s);
 if(!lectures.has(sn))lectures.set(sn,(async()=>{
  const journal=require('./branchements.cjs');
  try{const m=await lire(cfg,sn,{fetchImpl});s.run('INSERT INTO box_mesures VALUES(?,?,?,NULL) ON CONFLICT(serie) DO UPDATE SET body=excluded.body,lu=excluded.lu,erreur=NULL',sn,JSON.stringify(m),Date.now());journal.noter(s,'box');}
  catch(e){const msg=(e.name==='TimeoutError'?'ACS : pas de réponse en '+DELAI_MS/1000+' s.':String(e.message||e)).slice(0,200);
   try{s.run('INSERT INTO box_mesures VALUES(?,NULL,?,?) ON CONFLICT(serie) DO UPDATE SET lu=excluded.lu,erreur=excluded.erreur',sn,Date.now(),msg);journal.noter(s,'box',msg);}catch{}}
  finally{lectures.delete(sn);}
 })());
 let minuteur;await Promise.race([lectures.get(sn),new Promise(r=>{minuteur=setTimeout(r,attente);})]);clearTimeout(minuteur);
 return lecture(s,uid);
}

// La dernière mesure de la box d'un client, seulement si elle a moins de 3 minutes. Sinon null : le simulateur répond.
function lecture(s,uid,now=Date.now()){
 let sn;try{sn=serieDe(s,uid);}catch(e){if(/no such table/.test(e.message))return null;throw e;} // base sans la prise (outils de test)
 if(!sn)return null;
 const row=s.get('SELECT body FROM box_mesures WHERE serie=?',sn);if(!row?.body)return null;
 const m=JSON.parse(row.body);return m.serie===sn&&now-m.vu<=FRAIS_MS&&m.vu<=now+60000?m:null;
}

// Pose la vraie mesure sur l'instantané du parcours (journey-store.snapshot) : mêmes champs, l'écran ne change pas.
// Une panne de quartier en cours garde la priorité ; une box sans fibre sans panne de quartier est montrée coupée.
// Le débit et le temps de réponse ne viennent pas de l'ACS : ils sont mesurés par « Tester ma connexion ».
function appliquer(snap,m,now=Date.now()){
 if(!m)return snap;
 const up=m.etat==='Up',coupee=!up&&snap.metrics.state!=='panne';
 const metrics=coupee?{...snap.metrics,capacity:0,used:0,latency:null,state:'panne',rebootUntil:null}:snap.metrics;
 const devices=coupee?snap.devices.map(d=>({...d,mbps:0})):snap.devices;
 let optical=snap.optical;
 // Une seule vraie mesure ne fait pas une tendance : on montre la vraie valeur et son niveau, sans prédire de date de coupure.
 // (La courbe sur 7 jours viendra quand Guardian aura gardé une mesure par jour de la vraie box.)
 if(m.rxDbm!=null&&optical){
  const F=require('./forecast.cjs');
  optical={...optical,points:[{at:m.vu,dbm:m.rxDbm}],slope:0,current:m.rxDbm,state:m.rxDbm<=F.WARN?'low':'healthy',
   daysLeft:null,cutAt:null,slots:[],technician:null,source:'Mesure lue sur la box'};
 }
 // « Allumée depuis » : montré seulement si le compteur a été lu il y a moins de 3 minutes (un redémarrage plus ancien le fausserait).
 const uptimeS=m.uptimeS!=null&&now-m.uptimeAt<=FRAIS_MS?m.uptimeS+Math.max(0,Math.round((now-m.uptimeAt)/1000)):null;
 return {...snap,metrics,devices,optical,box:{serie:m.serie,modele:m.modele,logiciel:m.logiciel,uptimeS,txDbm:m.txDbm,appareils:m.appareils,vu:m.vu,fibre:up}};
}

module.exports={config,migrate,serie,relier,delier,serieDe,lire,rafraichir,lecture,appliquer,normaliser,depuisGenieacs,adresse,dbm,FRAIS_MS,RELIRE_MS,SEUIL_FIBRE,CHEMINS};
