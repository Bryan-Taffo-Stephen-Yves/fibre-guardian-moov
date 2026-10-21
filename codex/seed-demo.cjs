'use strict';
// Démo pré-remplie : comptes, incidents et historique créés par les routes et fonctions habituelles
// (mêmes règles, mêmes validations). Aucune insertion SQL directe dans les tables métier.
// Idempotent : si les comptes de démo existent déjà, rien n'est ajouté.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');

const DEMO={
 client:{email:'awa.kone@demo.fibre-guardian.ci',name:'Awa Koné',env:'GUARDIAN_DEMO_CLIENT_PASSWORD',fallback:'awa-demo-2026'},
 admin:{email:'direction@demo.fibre-guardian.ci',name:'Direction technique',env:'GUARDIAN_DEMO_ADMIN_PASSWORD',fallback:null},
 technician:{email:'ibrahim.traore@demo.fibre-guardian.ci',name:'Ibrahim Traoré',env:'GUARDIAN_DEMO_TECH_PASSWORD',fallback:'ibrahim-demo-2026'}
};
// Un client par poteau du simulateur (Awa habite Niangon) : chacun ne reçoit que les alertes de son quartier.
// Même mot de passe que la cliente Awa.
const NEIGHBOURS=[
 ['COC-03','Aya Kouadio'],['PAL-02','Serge Gnagne'],['RIV-04','Mariam Diabaté'],['MAR-02','Fabrice Aké'],
 ['ABO-01','Moussa Coulibaly'],['PLA-01','Christelle Kassi'],['ADJ-01','Salif Ouattara'],['TRE-01','Adjoua Brou'],
 ['KOU-01','Didier Zadi'],['PBT-01','Fanta Sylla'],['BAS-01','Rose Ehui']
].map(([segment,name])=>({segment,name,email:name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ /g,'.')+'@demo.fibre-guardian.ci'}));
const MIN=60000,HOUR=3600000;

function isSeeded(store){return !!store.get('SELECT id FROM users WHERE email=?',DEMO.admin.email);}
function isComplete(store){return !!store.get("SELECT at FROM audit WHERE action='demo.seeded'");}
function isEmpty(store){return store.get('SELECT count(*) AS n FROM users').n===0;}
function password(account,previous){const value=process.env[account.env];if(value)return {value,generated:false};if(account.fallback)return {value:account.fallback,generated:false};if(previous[account.email])return {value:previous[account.email],generated:true};return {value:crypto.randomBytes(12).toString('base64url'),generated:true};}
// Un mot de passe déjà généré est réutilisé après une réinitialisation de la démo.
function previousPasswords(file){try{return Object.fromEntries(fs.readFileSync(file,'utf8').split('\n').map(l=>l.match(/: (\S+@\S+) \/ (\S+)$/)).filter(Boolean).map(m=>[m[1],m[2]]));}catch{return {};}}

async function seedDemo(store,{log=()=>{},credentialsFile=null}={}){
 if(isSeeded(store)){if(!isComplete(store))throw new Error('Démo pré-remplie incomplète dans cette base : supprimez la base (codex/.local/) et relancez.');return {seeded:false};}
 const {createGuardianServer}=require('./pilot-server.cjs'),O=require('./operator-store.cjs');
 store.demoSeeding=true; // suspend le réseau vivant pendant que l’historique est rejoué
 const server=createGuardianServer({store});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,realNow=Date.now,start=realNow();
 // Horloge de démonstration : chaque étape est datée dans les dernières 24 heures.
 const at=ago=>{Date.now=()=>start-ago;};
 const passwords={};
 try{
  async function request(account,route,body){
   const r=await fetch(base+'/api'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:account?.cookie||'','X-CSRF-Token':account?.csrf||''},body:body===undefined?undefined:JSON.stringify(body)});
   const data=await r.json();if(!r.ok)throw new Error('Démo pré-remplie : '+route+(body?.type?' ('+body.type+')':'')+' → '+(data.error||r.status));return data;
  }
  async function auth(kind,account){
   // Ces connexions viennent du serveur privé de la démo (127.0.0.1), pas d'un visiteur : elles ne comptent pas
   // dans la limite anti-abus, sinon deux remises à zéro dans la même minute laisseraient la base vide.
   store.run("DELETE FROM limits WHERE key IN ('auth:127.0.0.1','auth:::ffff:127.0.0.1','auth:::1')");
   const r=await fetch(base+'/api/auth/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:account.email,password:passwords[account.email],name:account.name})});
   const data=await r.json();if(!r.ok)throw new Error('Démo pré-remplie : compte '+account.email+' → '+data.error);
   return {id:data.user.id,email:account.email,csrf:data.user.csrf,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
  }
  const generated=[];
  const previous=credentialsFile?previousPasswords(credentialsFile):{};
  for(const account of Object.values(DEMO)){const p=password(account,previous);passwords[account.email]=p.value;if(p.generated)generated.push(account);}

  // --- Comptes (la veille au soir)
  at(20*HOUR);
  let awa=await auth('register',DEMO.client);
  await auth('register',DEMO.admin);O.grant(store,DEMO.admin.email,'admin');
  let direction=await auth('login',DEMO.admin);
  // Les sessions durent 8 heures : on se reconnecte quand l’horloge de démonstration avance beaucoup.
  const relogin=async()=>{direction=await auth('login',DEMO.admin);awa=await auth('login',DEMO.client);};
  await auth('register',DEMO.technician);
  await request(direction,'/noc/workspace/action',{type:'field-account',email:DEMO.technician.email,technicianId:'ibrahim',enabled:true,confirm:true});
  // Les voisins sont créés par les fonctions du serveur (même validation) : 11 inscriptions de suite dépasseraient la limite anti-abus.
  const noc=require('./noc-store.cjs');
  // Leur espace est déjà ouvert (comme pour le jury) : à la première connexion, l'accueil montre tout de suite la panne de leur quartier.
  const J=require('./journey-store.cjs');
  for(const n of NEIGHBOURS){const {user}=await store.register({email:n.email,name:n.name,password:passwords[DEMO.client.email]});J.put(store,user.id,J.seed());noc.join(store,user.id,{segment:n.segment,consent:true});}

  // --- Espace d'Awa : sa box à Yopougon et son quartier suivi
  let journey=(await request(awa,'/journey/start',{})).state;
  const act=async data=>{journey=(await request(awa,'/journey/action',{version:journey.version,...data})).state;};
  await request(awa,'/noc/join',{segment:'YOP-07',consent:true});
  await act({type:'scenario',value:'devices'});
  at(19*HOUR+50*MIN);await act({type:'scenario',value:'normal'});

  // --- Cette nuit : coupure fibre sur YOP-07, réparée et vérifiée
  const overview=()=>request(direction,'/noc/overview');
  const incidentAction=async(iid,type,extra={})=>{const row=(await overview()).incidents.find(i=>i.id===iid);return request(direction,'/noc/action',{id:iid,type,version:row.version,...extra});};
  const workItem=async key=>(await request(direction,'/noc/workspace')).queue.find(r=>r.key===key);
  const work=async(key,type,extra={})=>{const row=await workItem(key);return request(direction,'/noc/workspace/action',{key,type,version:row.version,sourceVersion:row.sourceVersion,...extra});};
  const notify=async key=>{const row=await workItem(key),template=row.notificationTemplates?.[0];if(template)await work(key,'notify',{template:template.id,confirm:true});};
  at(7*HOUR+52*MIN);await relogin();
  await request(direction,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'fiber'});
  const night=(await overview()).incidents.find(i=>i.segment_id==='YOP-07'&&!i.terminal),nightKey='incident:'+night.id;
  at(7*HOUR+51*MIN+40000);
  await work(nightKey,'note',{body:'Alarme LOS sur 12 box de Niangon depuis 23 h 08. Des travaux de voirie ont eu lieu hier rue des Jardins : câble de distribution probablement sectionné.'});
  await notify(nightKey);
  at(7*HOUR+51*MIN);await incidentAction(night.id,'approve',{note:'Alarmes cohérentes avec une coupure de distribution. Intervention de nuit autorisée.'});
  at(7*HOUR+50*MIN);await incidentAction(night.id,'dispatch',{technician:'koffi',safety:true});await notify(nightKey);
  at(7*HOUR+46*MIN);
  await work(nightKey,'instruct',{body:'Baliser la zone de travaux avant d’ouvrir la chambre de tirage.'});
  await work(nightKey,'instruct',{body:'Contrôler le tronçon au réflectomètre, puis souder le câble de distribution.'});
  at(7*HOUR+40*MIN);await incidentAction(night.id,'advance');await notify(nightKey);
  at(7*HOUR+14*MIN);await incidentAction(night.id,'advance');await notify(nightKey);
  const checklist=(await workItem(nightKey)).checklist||[];
  at(6*HOUR+50*MIN);if(checklist[0])await work(nightKey,'check',{itemId:checklist[0].id,done:true});
  at(6*HOUR+24*MIN);if(checklist[1])await work(nightKey,'check',{itemId:checklist[1].id,done:true});
  at(6*HOUR+22*MIN);await incidentAction(night.id,'advance');await notify(nightKey);
  at(6*HOUR+16*MIN);await request(direction,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'normal'});
  at(6*HOUR+15*MIN);await incidentAction(night.id,'verify');await notify(nightKey);

  // --- Ce matin : la box d'Awa ralentit, elle la redémarre à distance
  at(3*HOUR+12*MIN);await act({type:'scenario',value:'slow'});
  at(3*HOUR+10*MIN);await act({type:'reboot',confirm:true});

  // --- Dossiers clients partagés avec le support
  at(2*HOUR+40*MIN);await relogin();
  const home=(await request(awa,'/homes',{name:'Maison Koné · Yopougon'})).id;
  const ticket=async(subject,detail)=>{const before=new Set((await request(awa,'/homes/'+home)).tickets.map(t=>t.id));await request(awa,'/homes/'+home+'/ticket',{subject,detail});const t=(await request(awa,'/homes/'+home)).tickets.find(t=>!before.has(t.id));await request(awa,'/homes/'+home+'/ticket/share',{id:t.id,share:true,consent:true});return 'ticket:'+t.id;};
  const intruder=await ticket('Un appareil inconnu sur mon Wi-Fi','Depuis hier soir, un appareil nommé « Galaxy-A14 » apparaît sur mon réseau. Personne à la maison n’a ce téléphone. Faut-il changer le mot de passe du Wi-Fi ?');
  at(2*HOUR+5*MIN);await work(intruder,'claim',{confirm:true});
  at(2*HOUR);await work(intruder,'ticket-status',{status:'in_progress',body:'Bonjour Madame Koné. Nous vérifions la liste de vos appareils. Ne bloquez rien pour l’instant : nous vous proposons la marche à suivre avant 18 h.',confirm:true});
  at(48*MIN);
  await ticket('Internet très lent le soir','Entre 19 h et 22 h, les vidéos coupent sur la télévision du salon. La console de mon fils télécharge souvent des jeux à ce moment-là.');

  // --- En ce moment : poteau percuté à Cocody, plan en attente de validation
  at(14*MIN);
  await request(direction,'/noc/action',{type:'simulate',segment:'COC-03',scenario:'pole'});
  const pole=(await overview()).incidents.find(i=>i.segment_id==='COC-03'&&!i.terminal);
  at(11*MIN);
  await work('incident:'+pole.id,'note',{body:'Appel d’un riverain : un véhicule a percuté le poteau P-112, avenue de la Cité des Arts. Câble au sol, zone balisée par la police. 10 abonnés sans service.'});

  Date.now=realNow;
  store.event(null,direction.id,'demo.seeded','Démo pré-remplie installée');
  const summary={seeded:true,accounts:Object.values(DEMO).map(a=>({email:a.email,name:a.name,password:passwords[a.email],generated:generated.includes(a)})),neighbours:NEIGHBOURS.map(n=>({email:n.email,name:n.name,segment:n.segment}))};
  if(credentialsFile&&generated.length){
   fs.mkdirSync(path.dirname(credentialsFile),{recursive:true,mode:0o700});
   fs.writeFileSync(credentialsFile,'Identifiants de la démo Fibre Guardian (fichier local, hors git)\n\n'+summary.accounts.map(a=>a.name+' : '+a.email+' / '+a.password).join('\n')+'\n',{mode:0o600});
  }
  // Le mot de passe généré n'est jamais écrit dans les journaux du serveur : seulement dans le fichier local.
  for(const a of generated)log('Mot de passe généré pour '+a.email+(credentialsFile?' : voir '+credentialsFile:' : '+passwords[a.email]));
  return summary;
 }finally{Date.now=realNow;store.demoSeeding=false;await new Promise(r=>server.close(r));}
}

// Remise à zéro : vide les tables (sauf les compteurs anti-abus) puis rejoue la démo. Réservé à l'administrateur (vérifié par la route).
async function resetDemo(store,options={}){
 const tables=store.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r=>r.name).filter(t=>t!=='limits');
 store.db.exec('PRAGMA foreign_keys=OFF');
 try{store.transaction(()=>{for(const t of tables)store.run('DELETE FROM "'+t.replace(/"/g,'')+'"');});}
 finally{store.db.exec('PRAGMA foreign_keys=ON');}
 // Les tables de référence (segments, réglages) sont recréées par leurs migrations habituelles.
 for(const m of ['./operator-store.cjs','./approval-store.cjs','./journey-store.cjs','./noc-store.cjs'])require(m).migrate(store);
 return seedDemo(store,options);
}

module.exports={seedDemo,resetDemo,isSeeded,isComplete,isEmpty,DEMO,NEIGHBOURS};

if(require.main===module){
 const {Store}=require('./pilot-store.cjs');
 const file=path.resolve(process.argv[2]||process.env.GUARDIAN_DB||path.join(__dirname,'.local','pilot.sqlite'));
 const {createGuardianServer}=require('./pilot-server.cjs');
 const store=new Store(file);
 // Les migrations sont appliquées par le serveur, exactement comme au démarrage normal.
 const probe=createGuardianServer({store});probe.close();
 seedDemo(store,{log:console.log,credentialsFile:path.join(path.dirname(file),'identifiants-demo.txt')})
  .then(r=>{console.log(r.seeded?'Démo pré-remplie : '+r.accounts.map(a=>a.email).join(', '):'Démo déjà présente : rien à ajouter.');})
  .catch(e=>{console.error(e.message);process.exitCode=1;})
  .finally(()=>store.close());
}
