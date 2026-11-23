'use strict';
// Vraies mesures des box : rien ne change sans réglage, l'ACS est lu quand il est branché, et une mesure vieille ou en erreur
// laisse la place au simulateur au lieu d'inventer.
const {test}=require('node:test'),assert=require('node:assert/strict');
const MB=require('./mesures-box.cjs'),B=require('./branchements.cjs'),J=require('./journey-store.cjs');
const {createGuardianServer}=require('./pilot-server.cjs');

const ACS='https://acs.moov.test/nbi',CLE='k'.repeat(40),CLIENTS='c'.repeat(40);
const iso=at=>new Date(at).toISOString();
// Une box telle que GenieACS la renvoie (TR-181) : chaque valeur porte l'heure où elle a été lue sur la box.
function genie(serie,{etat='Up',rx=-21400,vu=Date.now(),rxVu=vu,inform=vu}={}){
 const v=(x,at=vu)=>({_value:x,_timestamp:iso(at)});
 return {_id:'00259E-HG8145V5-'+serie,_lastInform:iso(inform),
  Device:{Optical:{Interface:{1:{Status:v(etat),OpticalSignalLevel:v(rx,rxVu),TransmitOpticalLevel:v(2300)}}},DeviceInfo:{UpTime:v(90061),ModelName:v('HG8145V5'),SoftwareVersion:v('V5R020C10S115')},Hosts:{HostNumberOfEntries:v(6)}}};
}
const v=x=>({_value:x});
// Un faux ACS : toutes les autres adresses passent par le vrai fetch (le serveur de test local).
function fauxAcs(reponse){
 const vrai=globalThis.fetch,appels=[];
 const f=async(url,o)=>{if(!String(url).startsWith(ACS))return vrai(url,o);appels.push({url:String(url),auth:o?.headers?.Authorization});const r=await reponse(String(url),o);return new Response(JSON.stringify(r.body),{status:r.status||200,headers:{'Content-Type':'application/json'}});};
 return {f,appels,installer(){globalThis.fetch=f;},retirer(){globalThis.fetch=vrai;}};
}

test('Sans réglage, aucune box n’est lue et le simulateur répond',()=>{
 assert.equal(MB.config({}),null);
 assert.equal(MB.config({GUARDIAN_BOX_URL:ACS,GUARDIAN_BOX_CLE:'courte'}),null,'Une clé courte n’ouvre rien');
 assert.equal(MB.config({GUARDIAN_BOX_URL:'http://acs.moov.test',GUARDIAN_BOX_CLE:CLE}),null,'L’ACS se lit seulement en https');
 assert.equal(MB.config({GUARDIAN_BOX_URL:ACS,GUARDIAN_BOX_CLE:CLE,GUARDIAN_BOX_FORMAT:'autre'}),null);
 assert.deepEqual(MB.config({GUARDIAN_BOX_URL:ACS+'/',GUARDIAN_BOX_CLE:CLE}),{url:ACS,cle:CLE,format:'genieacs'});
 const snap=J.snapshot(J.seed());assert.equal(snap.box,undefined);assert.equal(MB.appliquer(snap,null),snap);
});

test('Lecture GenieACS : TR-181, TR-098 de Huawei, unités de lumière et heure de chaque valeur',()=>{
 const now=Date.now(),m=MB.depuisGenieacs([genie('HWTC1A2B',{vu:now})],'HWTC1A2B');
 assert.deepEqual(m,{serie:'HWTC1A2B',etat:'Up',rxDbm:-21.4,txDbm:2.3,uptimeS:90061,uptimeAt:now,modele:'HG8145V5',logiciel:'V5R020C10S115',appareils:6,vu:now});
 // La box vient de passer à l'ACS, mais sa lumière date de 3 jours : l'heure de la mesure est celle de la lumière.
 assert.equal(MB.depuisGenieacs([genie('X',{vu:now,rxVu:now-3*86400000})],'X').vu,now-3*86400000);
 // Box plus ancienne (TR-098, chemins Huawei) : état « up » en minuscules compris.
 const vieille={_lastInform:iso(now),InternetGatewayDevice:{WANDevice:{1:{X_GponInterafceConfig:{Status:v('up'),RXPower:v('-19.80')}}}}};
 assert.equal(MB.depuisGenieacs([vieille],'X').etat,'Up');assert.equal(MB.depuisGenieacs([vieille],'X').rxDbm,-19.8);assert.equal(MB.depuisGenieacs([vieille],'X').vu,now,'Sans heure par valeur : la dernière visite');
 // Sans état : la lumière décide, avec la sensibilité GPON classe B+ (-28 dBm).
 delete vieille.InternetGatewayDevice.WANDevice[1].X_GponInterafceConfig.Status;
 vieille.InternetGatewayDevice.WANDevice[1].X_GponInterafceConfig.RXPower=v('-29.1');assert.equal(MB.depuisGenieacs([vieille],'X').etat,'Down');
 vieille.InternetGatewayDevice.WANDevice[1].X_GponInterafceConfig.RXPower=v('-27.5');assert.equal(MB.depuisGenieacs([vieille],'X').etat,'Up');
 assert.throws(()=>MB.depuisGenieacs([],'X'),/inconnue/);
 assert.throws(()=>MB.depuisGenieacs([genie('X'),genie('X')],'X'),/Plusieurs box/);
 assert.throws(()=>MB.depuisGenieacs([{_lastInform:iso(now)}],'X'),/État de la fibre/);
 assert.equal(MB.dbm(-21400),-21.4);assert.equal(MB.dbm('-21.4'),-21.4);assert.equal(MB.dbm(-900000),null);assert.equal(MB.dbm('n/a'),null);
 const u=MB.adresse({url:ACS,format:'genieacs'},'hwtc1a2b');assert.ok(u.startsWith(ACS+'/devices/?query='));assert.ok(decodeURIComponent(u).includes('"_deviceId._SerialNumber":"hwtc1a2b"'),'La casse du numéro de série est gardée');
 assert.equal(MB.adresse({url:ACS,format:'guardian'},'HWTC1A2B'),ACS+'/box/HWTC1A2B');
 assert.throws(()=>MB.serie('HW TC/../'),/invalide/);assert.equal(MB.serie(' 4857544311aa '),'4857544311aa');
});

test('Lecture : réponse illisible, trop grosse ou lente, sans recopier ce que l’ACS renvoie',async()=>{
 const cfg={url:ACS,cle:CLE,format:'guardian'},rep=(body,status=200)=>async()=>new Response(body,{status});
 await assert.rejects(MB.lire(cfg,'X',{fetchImpl:rep('<html>secret-interne</html>')}),e=>e.message==='Réponse de l’ACS illisible.');
 await assert.rejects(MB.lire(cfg,'X',{fetchImpl:rep('x'.repeat(300000))}),/trop volumineuse/);
 await assert.rejects(MB.lire(cfg,'X',{fetchImpl:rep('{}',404)}),/inconnue/);
 await assert.rejects(MB.lire(cfg,'X',{fetchImpl:rep('{}',500)}),/réponse 500/);
 const m=await MB.lire(cfg,'X',{fetchImpl:rep(JSON.stringify({etat:'Up',rxDbm:-21.4,vu:iso(Date.now())}))});assert.equal(m.etat,'Up');
});

test('La vraie mesure remplace le simulateur sur les mêmes champs, sans prédire de coupure',()=>{
 const st=J.seed();st.scenario='fading';st.fadingSince=Date.now();
 const now=Date.now(),vu=now-20000,m={serie:'HWTC1A2B',etat:'Up',rxDbm:-20.1,txDbm:2.3,uptimeS:3700,uptimeAt:vu,modele:'HG8145V5',logiciel:null,appareils:4,vu};
 const s=MB.appliquer(J.snapshot(st),m,now);
 assert.equal(s.metrics.state,'stable');assert.equal(s.box.vu,vu);assert.equal(s.box.uptimeS,3720,'Le compteur avance depuis sa lecture');
 assert.equal(s.optical.current,-20.1);assert.equal(s.optical.state,'healthy','La démo « baisse de lumière » ne s’affiche pas sur une vraie box saine');
 assert.deepEqual(s.optical.slots,[]);assert.equal(s.optical.points.length,1);assert.equal(s.box.modele,'HG8145V5');
 assert.equal(MB.appliquer(J.snapshot(st),{...m,uptimeAt:now-MB.FRAIS_MS-1000},now).box.uptimeS,null,'Un vieux compteur n’est pas montré');
 // Fibre coupée sur la vraie box : coupée à l'écran, même sans panne de quartier, et plus aucun appareil ne consomme.
 const c=MB.appliquer(J.snapshot(J.seed()),{...m,etat:'Down',rxDbm:null},now);
 assert.equal(c.metrics.state,'panne');assert.equal(c.metrics.capacity,0);assert.equal(c.metrics.latency,null);assert.ok(c.devices.every(d=>d.mbps===0));
 // Lumière faible : signalée, sans inventer de date.
 assert.equal(MB.appliquer(J.snapshot(J.seed()),{...m,rxDbm:-25.2},now).optical.state,'low');
});

async function demarrer(env,acs){
 acs.installer();
 const server=createGuardianServer({db:':memory:',env});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,s=server.guardianStore;
 const call=async(c,path,body,expected=200)=>{const res=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:c?.cookie||'','X-CSRF-Token':c?.csrf||''},body:body?JSON.stringify(body):undefined});const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));return data;};
 async function account(name,role){const password='test-password-'+name;let r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@example.test',password,name})});let data=await r.json();if(role){require('./operator-store.cjs').grant(s,name+'@example.test',role);r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@example.test',password})});data=await r.json();}return {id:data.user.id,csrf:data.user.csrf,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};}
 const prise=async(body,expected=200)=>{const r=await fetch(base+'/api/branchements/clients',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+CLIENTS},body:JSON.stringify(body)});assert.equal(r.status,expected);return r.json();};
 const fin=()=>{server.close();acs.retirer();};
 return {s,call,account,prise,fin};
}
const ENV={GUARDIAN_BOX_URL:ACS,GUARDIAN_BOX_CLE:CLE,GUARDIAN_CLIENTS_CLE:CLIENTS};
const ligne=(email,serie,telephone='0701020304')=>({lignes:[{telephone,email:email+'@example.test',segment:'YOP-07',...(serie?{serie}:{})}]});

test('Branchée : la prise clients relie la box, l’écran et Guardian lisent l’ACS, l’erreur et la vieille mesure rendent la main',async()=>{
 let vu=Date.now(),panne=false;
 const acs=fauxAcs(()=>panne?{status:503,body:{}}:{body:[genie('hwTC1A2B3C4D',{vu,rx:-22300})]});
 const t=await demarrer(ENV,acs),{s,call}=t;
 try{
  const client=await t.account('aya'),admin=await t.account('direction','admin');
  await call(client,'/journey/start',{});
  // Pas encore reliée : rien n'est demandé à l'ACS.
  let st=(await call(client,'/journey/state')).state;assert.equal(st.box,undefined);assert.equal(acs.appels.length,0);
  await t.prise(ligne('aya','HW TC/../'),400);
  await t.prise(ligne('aya','hwTC1A2B3C4D'));assert.equal(MB.serieDe(s,client.id),'hwTC1A2B3C4D');

  st=(await call(client,'/journey/state')).state;
  assert.equal(acs.appels.length,1);assert.equal(acs.appels[0].auth,'Bearer '+CLE);assert.ok(decodeURIComponent(acs.appels[0].url).includes('hwTC1A2B3C4D'));
  assert.equal(st.box.modele,'HG8145V5');assert.equal(st.optical.current,-22.3);assert.equal(st.metrics.state,'stable');
  // Relu au plus une fois toutes les 30 s.
  await call(client,'/journey/state');assert.equal(acs.appels.length,1);

  // Guardian parle de la vraie box dans ses preuves.
  const v1=(await call(client,'/journey/state')).state.version;
  const apres=(await call(client,'/journey/action',{type:'chat',text:'internet est lent',version:v1})).state;
  const preuves=apres.messages.at(-1).proof?.measured||[];
  assert.ok(preuves.some(p=>p.label==='Lumière de la fibre à la box'&&p.value.startsWith('−22,3 dBm')),JSON.stringify(preuves));
  assert.ok(preuves.some(p=>p.label==='Votre box'&&/^HG8145V5, allumée depuis 1 jour et 1 heure$/.test(p.value)),JSON.stringify(preuves));

  // L'équipe Moov voit la prise « box » branchée, sans la clé.
  let e=await call(admin,'/branchements');const p=e.prises.find(x=>x.id==='box');
  assert.equal(p.mode,'reel');assert.equal(p.total,1);assert.equal(e.boxReliees,1);assert.equal(JSON.stringify(e).includes('kkkk'),false);

  // L'ACS tombe : l'écran garde la dernière mesure tant qu'elle a moins de 3 minutes, et l'erreur est notée.
  panne=true;s.run('UPDATE box_mesures SET lu=0');
  st=(await call(client,'/journey/state')).state;assert.equal(st.box.modele,'HG8145V5');
  e=await call(admin,'/branchements');assert.match(e.prises.find(x=>x.id==='box').erreur,/503/);
  // Plus de 3 minutes sans nouvelle de la box : retour au simulateur, rien n'est inventé.
  const m=JSON.parse(s.get('SELECT body FROM box_mesures').body);
  s.run('UPDATE box_mesures SET body=? ',JSON.stringify({...m,vu:Date.now()-MB.FRAIS_MS-1000}));
  st=(await call(client,'/journey/state')).state;assert.equal(st.box,undefined);assert.notEqual(st.optical.source,'Mesure lue sur la box');
  // La vraie mesure n'est jamais enregistrée comme état du parcours (seule la réponse de Guardian la cite).
  assert.equal(JSON.parse(s.get('SELECT body FROM journey_state WHERE user_id=?',client.id).body).box,undefined);
 }finally{t.fin();}
});

test('Vraie box sans fibre : l’écran la montre coupée et Guardian dit la vérité',async()=>{
 const acs=fauxAcs(()=>({body:[genie('HWTC0000DOWN',{etat:'Down',rx:-40000})]}));
 const t=await demarrer(ENV,acs),{call}=t;
 try{
  const client=await t.account('kone');await call(client,'/journey/start',{});await t.prise(ligne('kone','HWTC0000DOWN'));
  const st=(await call(client,'/journey/state')).state;
  assert.equal(st.metrics.state,'panne');assert.ok(st.devices.every(d=>d.mbps===0));assert.equal(st.box.fibre,false);
  for(const text of ['internet est coupé','redémarre ma box','mon wifi capte mal']){
   const v=(await call(client,'/journey/state')).state.version,r=(await call(client,'/journey/action',{type:'chat',text,version:v})).state.messages.at(-1);
   assert.match(r.text,/la fibre n’arrive plus jusqu’à elle/,text+' → '+r.text);assert.doesNotMatch(r.text,/redémarr|arrive bien/,text);assert.equal(r.action,'report');
  }
  // Aucun forfait vendu ni redémarrage lancé sur une box qui ne reçoit plus la fibre.
  let v=(await call(client,'/journey/state')).state.version;
  const offre=(await call(client,'/journey/action',{type:'chat',text:'je veux 200 Mb/s',version:v})).state;
  assert.match(offre.messages.at(-1).text,/la fibre n’arrive plus/);assert.equal(offre.upgrade??null,null);
  v=offre.version;
  assert.match(JSON.stringify(await call(client,'/journey/action',{type:'plan-quote',to:'demo-200',version:v},409)),/ne reçoit plus la fibre/);
  assert.match(JSON.stringify(await call(client,'/journey/action',{type:'reboot',confirm:true,version:v},409)),/ne reçoit plus la fibre/);
 }finally{t.fin();}
});

test('Une box appartient à un seul compte, même quand la ligne change d’abonné',async()=>{
 const acs=fauxAcs(()=>({body:[genie('HWTC1111')]}));
 const t=await demarrer(ENV,acs),{s}=t;
 try{
  const aya=await t.account('aya'),kone=await t.account('kone'),awa=await t.account('awa');
  await t.prise(ligne('aya','HWTC1111'));
  // La même box donnée à un autre compte quitte le premier.
  await t.prise(ligne('awa','HWTC1111','0505050505'));assert.equal(MB.serieDe(s,aya.id),null);assert.equal(MB.serieDe(s,awa.id),'HWTC1111');
  await t.prise(ligne('aya','HWTC1111'));assert.equal(MB.serieDe(s,awa.id),null);
  // La ligne passe à Koné sans numéro de série : Aya ne voit plus la box.
  await t.prise(ligne('kone',null));assert.equal(MB.serieDe(s,aya.id),null);assert.equal(MB.serieDe(s,kone.id),null);
 }finally{t.fin();}
});

test('Un ACS lent ne bloque pas l’écran, et deux demandes ne lisent la box qu’une fois',async()=>{
 let lacher;const bloque=new Promise(r=>{lacher=r;});
 const acs=fauxAcs(async()=>{await bloque;return {body:[genie('HWTC2222')]};});
 const t=await demarrer(ENV,acs),{s,call}=t;
 try{
  const client=await t.account('aya');await call(client,'/journey/start',{});await t.prise(ligne('aya','HWTC2222'));
  const debut=Date.now();
  const [a,b]=await Promise.all([call(client,'/journey/state'),call(client,'/journey/state')]);
  assert.ok(Date.now()-debut<3500,'Réponse sans attendre l’ACS');assert.equal(a.state.box,undefined);assert.equal(b.state.box,undefined);
  assert.equal(acs.appels.length,1,'Une seule lecture en cours par box');
  lacher();await new Promise(r=>setTimeout(r,50));
  assert.ok(MB.lecture(s,client.id),'La lecture finie en arrière-plan sert à l’écran suivant');
  assert.equal((await call(client,'/journey/state')).state.box.serie,'HWTC2222');
 }finally{t.fin();}
});
