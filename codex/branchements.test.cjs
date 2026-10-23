'use strict';
// Les prises vers le vrai réseau Moov : fermées sans clé, protégées par une clé chacune, et branchées sur le moteur déjà testé.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs'),O=require('./operator-store.cjs'),N=require('./noc-store.cjs'),B=require('./branchements.cjs');

const CLES={GUARDIAN_RESEAU_CLE:'r'.repeat(40),GUARDIAN_CLIENTS_CLE:'c'.repeat(40),GUARDIAN_USSD_CLE:'u'.repeat(40)};

async function demarrer(env){
 const server=createGuardianServer({db:':memory:',env});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,s=server.guardianStore;
 const call=async(c,path,body,expected=200)=>{const res=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:c?.cookie||'','X-CSRF-Token':c?.csrf||''},body:body?JSON.stringify(body):undefined});const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));return data;};
 const prise=async(path,cle,body,expected=200)=>{const res=await fetch(base+'/api/branchements/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cle},body:JSON.stringify(body)});const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));return data;};
 const ussd=async(phoneNumber,text,cle=CLES.GUARDIAN_USSD_CLE)=>{const res=await fetch(base+'/api/branchements/ussd',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Bearer '+cle},body:new URLSearchParams({sessionId:'ATUid_1',serviceCode:'*144#',phoneNumber,text}).toString()});return {status:res.status,type:res.headers.get('content-type'),texte:await res.text()};};
 async function account(name,role){const password='test-password-'+name;let r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@example.test',password,name})});let data=await r.json();if(role){O.grant(s,name+'@example.test',role);r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@example.test',password})});data=await r.json();}return {csrf:data.user.csrf,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};}
 return {server,s,call,prise,ussd,account};
}
const box=(n,down,alarme)=>Array.from({length:n},(_,i)=>({serie:'HWTC'+String(1000+i),etat:i<down?'Down':'Up',rxDbm:i<down?-40:-21.5,...(i<down&&alarme?{alarme}:{})}));

test('Sans clé, toutes les prises restent fermées et la démo ne change pas',async()=>{
 const t=await demarrer({});
 try{
  for(const p of ['reseau','clients','ussd'])await t.prise(p,'x'.repeat(40),{},404);
  const admin=await t.account('director','admin'),client=await t.account('client');
  await t.call(client,'/branchements',null,403);
  const e=await t.call(admin,'/branchements');assert.deepEqual(e.prises.map(p=>p.mode),['demo','demo','demo','demo']);
  assert.equal(JSON.stringify(e).includes('rrrr'),false);
  assert.equal(B.config({GUARDIAN_RESEAU_CLE:'trop-courte'}).reseau,null,'Une clé courte n’ouvre rien');
  assert.equal(B.config({GUARDIAN_SMS_CLE:'s'.repeat(40),GUARDIAN_SMS_URL:'http://passerelle'}).sms,null,'Les SMS partent seulement en https');
 }finally{t.server.close();}
});

test('Prise réseau : les vraies box d’un quartier déclenchent la détection déjà testée',async()=>{
 const t=await demarrer(CLES);
 try{
  await t.prise('reseau','mauvaise-cle-'.repeat(4),{mesures:[{segment:'YOP-07',box:box(12,0)}]},401);
  await t.prise('reseau',CLES.GUARDIAN_CLIENTS_CLE,{mesures:[{segment:'YOP-07',box:box(12,0)}]},401);
  await t.prise('reseau',CLES.GUARDIAN_RESEAU_CLE,{mesures:[{segment:'YOP-07',box:[{serie:'HWTC1',etat:'Eteinte'}]}]},400);
  await t.prise('reseau',CLES.GUARDIAN_RESEAU_CLE,{mesures:[{segment:'YOP-07',alarme:'DROP TABLE',box:box(3,0)}]},400);

  // 4 box éteintes sur 12 : moins de 5, rien ne se déclenche.
  let r=await t.prise('reseau',CLES.GUARDIAN_RESEAU_CLE,{mesures:[{segment:'YOP-07',box:box(12,4,'LOS')},{segment:'ZZZ-99',box:box(5,0)}]});
  assert.deepEqual(r.inconnus,['ZZZ-99']);assert.deepEqual(r.recus[0],{segment:'YOP-07',box:12,enLigne:8,alarme:'LOS'});
  N.scan(t.s);assert.equal(t.s.get("SELECT count(*) AS n FROM noc_incidents WHERE segment_id='YOP-07'").n,0);

  // 8 box sur 12 perdent la fibre : dossier ouvert et cause « rupture » proposée, comme avec le simulateur.
  await t.prise('reseau',CLES.GUARDIAN_RESEAU_CLE,{mesures:[{segment:'YOP-07',box:box(12,8,'LOS')}]});
  N.scan(t.s);
  const i=t.s.get("SELECT * FROM noc_incidents WHERE segment_id='YOP-07'");assert.ok(i,'Dossier ouvert');assert.equal(JSON.parse(i.plan).cause,'FIBER_CUT_DISTRIBUTION');

  // Box sans courant majoritaires : coupure électrique, pas d'équipe envoyée.
  await t.prise('reseau',CLES.GUARDIAN_RESEAU_CLE,{mesures:[{segment:'COC-03',box:box(10,7,'DYING_GASP')}]});
  N.scan(t.s);assert.equal(JSON.parse(t.s.get("SELECT plan FROM noc_incidents WHERE segment_id='COC-03'").plan).cause,'POWER_OUTAGE');

  // Le simulateur ne touche plus un quartier branché : des mesures trop vieilles restent vieilles, rien n'est inventé.
  t.s.run("UPDATE noc_segments SET sample_at=1 WHERE id='YOP-07'");N.refreshTelemetry(t.s);
  assert.equal(t.s.get("SELECT sample_at FROM noc_segments WHERE id='YOP-07'").sample_at,1);
  assert.ok(t.s.get("SELECT sample_at FROM noc_segments WHERE id='MAR-02'").sample_at>1,'Les autres quartiers restent en démo');

  const admin=await t.account('director','admin'),e=await t.call(admin,'/branchements');
  assert.equal(e.prises.find(p=>p.id==='reseau').mode,'reel');assert.equal(e.prises.find(p=>p.id==='reseau').total,3);
  assert.deepEqual(e.quartiersBranches.map(q=>q.segment),['COC-03','YOP-07']);
 }finally{t.server.close();}
});

test('Prises clients et USSD : le *144# marche depuis un vrai téléphone relié à sa ligne',async()=>{
 const t=await demarrer(CLES);
 try{
  await t.account('client');await t.account('voisin');await t.account('agent','admin');
  const r=await t.prise('clients',CLES.GUARDIAN_CLIENTS_CLE,{lignes:[
   {telephone:'07 01 02 03 04',email:'client@example.test',segment:'YOP-07'},
   {telephone:'+225 0705060708',email:'agent@example.test',segment:'YOP-07'},
   {telephone:'0709101112',email:'inconnu@example.test',segment:'YOP-07'},
   {telephone:'0709101113',email:'voisin@example.test',segment:'NULLE-PART'}
  ]});
  assert.equal(r.relies,1);assert.deepEqual(r.refuses.map(x=>x.raison),['Compte de l’équipe Moov','Compte introuvable','Quartier inconnu']);
  await t.prise('clients',CLES.GUARDIAN_CLIENTS_CLE,{lignes:[{telephone:'12',email:'client@example.test',segment:'YOP-07'}]},400);

  assert.equal((await t.ussd('2250701020304','','mauvaise-cle-'.repeat(4))).status,401);
  let u=await t.ussd('2250799999999','');assert.equal(u.status,200);assert.match(u.type,/text\/plain/);assert.match(u.texte,/^END .*aucune ligne fibre/s);
  assert.equal((await t.ussd('2250705060708','')).texte.startsWith('END '),true,'Le numéro d’un agent n’ouvre aucun compte');
  u=await t.ussd('2250701020304','');assert.match(u.texte,/^CON Moov Fibre Guardian\n1\. Signaler une panne/);
  u=await t.ussd('2250701020304','1*1');assert.match(u.texte,/^CON .*Niangon/s);
  u=await t.ussd('2250701020304','1*1*1');assert.match(u.texte,/^END Signalement reçu : dossier [0-9A-F]{6}/);
  assert.equal(t.s.get("SELECT count(*) AS n FROM noc_incidents WHERE source='ussd'").n,1,'Un vrai dossier pour l’équipe Moov');
  u=await t.ussd('2250701020304','1;DROP');assert.match(u.texte,/^END Saisie non comprise/);
 }finally{t.server.close();}
});

test('Prise SMS : un envoi par la passerelle de Moov, rien sans réglage, une panne notée sans bloquer',async()=>{
 const t=await demarrer({});
 try{
  const envois=[],fetchImpl=async(url,o)=>{envois.push({url,o});return {ok:envois.length===1,status:envois.length===1?200:503};};
  assert.equal(await B.sms(t.s,B.config({}),'2250701020304','Bonjour',{fetchImpl}),false);assert.equal(envois.length,0);
  const cfg=B.config({GUARDIAN_SMS_URL:'https://sms.moov.example/envoi',GUARDIAN_SMS_CLE:'s'.repeat(40)});
  assert.equal(await B.sms(t.s,cfg,'2250701020304','Moov Fibre : signalement FG-001 reçu.',{fetchImpl}),true);
  assert.equal(envois[0].url,'https://sms.moov.example/envoi');assert.equal(envois[0].o.headers.Authorization,'Bearer '+'s'.repeat(40));
  assert.deepEqual(JSON.parse(envois[0].o.body),{to:'+2250701020304',from:'Moov',text:'Moov Fibre : signalement FG-001 reçu.'});
  assert.equal(await B.sms(t.s,cfg,'2250701020304','Bonjour',{fetchImpl}),false);
  const e=B.etat(t.s,cfg).prises.find(p=>p.id==='sms');assert.equal(e.mode,'reel');assert.equal(e.total,2);assert.match(e.erreur,/503/);
 }finally{t.server.close();}
});
