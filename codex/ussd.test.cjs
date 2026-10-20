'use strict';
// Mode survie : le menu *144# marche sans internet, crée un vrai dossier pour l'équipe Moov et suit le technicien.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs'),O=require('./operator-store.cjs'),N=require('./noc-store.cjs'),U=require('./ussd.cjs');

test('Le 0 d’un sous-menu revient en arrière et une saisie étrangère est refusée',()=>{
 assert.deepEqual(U.path(''),[]);assert.deepEqual(U.path('1*0'),[]);assert.deepEqual(U.path('1*0*2'),['2']);assert.deepEqual(U.path('1*3*1'),['1','3','1']);
 assert.throws(()=>U.path('1;DROP'));assert.throws(()=>U.path('1*'.repeat(30)));assert.ok(U.MENU.length<=U.MAX);
});

test('Signaler, suivre et recevoir le lien du technicien depuis le *144#',async()=>{
 const server=createGuardianServer({db:':memory:'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,s=server.guardianStore;
 try{
  const call=async(c,path,body,expected=200)=>{const res=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:c?.cookie||'','X-CSRF-Token':c?.csrf||''},body:body?JSON.stringify(body):undefined});const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));return data;};
  async function account(name,role){const password='test-password-'+name;let r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@example.test',password,name})});let data=await r.json();if(role){O.grant(s,name+'@example.test',role);r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@example.test',password})});data=await r.json();}return {csrf:data.user.csrf,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};}
  const admin=await account('director','admin'),client=await account('client'),neighbor=await account('neighbor');
  const dial=async(c,text,expected=200)=>{const r=await call(c,'/ussd',{text},expected);if(expected===200){assert.ok(r.message.length<=U.MAX,'Écran trop long : '+r.message);assert.equal(r.code,'*144#');}return r;};

  await call(null,'/ussd',{text:''},401);
  await dial(client,'abc',400);
  let r=await dial(client,'');assert.equal(r.end,false);assert.match(r.message,/1\. Signaler une panne/);
  assert.match((await dial(client,'2')).message,/Aucun dossier ouvert/);
  assert.match((await dial(client,'4')).message,/Aucune panne connue/);
  r=await dial(client,'1');assert.equal(r.end,false);assert.match(r.message,/Câble ou poteau tombé/);
  assert.match((await dial(client,'1*0')).message,/Moov Fibre Guardian/,'0 revient au menu');
  r=await dial(client,'1*1');assert.match(r.message,/Plus d’internet du tout.*Niangon/s);
  r=await dial(client,'1*1*2');assert.equal(r.end,true);assert.match(r.message,/Rien n’a été envoyé/);
  assert.equal((await call(admin,'/noc/overview')).incidents.filter(i=>i.source==='ussd').length,0,'Un « Non » n’envoie rien');

  r=await dial(client,'1*1*1');assert.equal(r.end,true);assert.match(r.message,/Signalement reçu : FG-001/);assert.match(r.sms.text,/FG-001/);
  let i=(await call(admin,'/noc/overview')).incidents.find(v=>v.source==='ussd');
  assert.ok(i,'Le centre d’opérations reçoit le dossier');assert.match(i.title,/^Signalement par \*144# · /);assert.match(i.description,/\*144#/);assert.equal(i.segment_id,'YOP-07');
  assert.equal((await call(client,'/journey/state')).state.incidents[0].channel,'ussd');
  assert.match((await dial(client,'1')).message,/déjà le dossier FG-001/,'Pas de doublon');
  assert.match((await dial(client,'2')).message,/Dossier FG-001/);
  assert.match((await dial(client,'3')).message,/Pas encore de technicien/);

  const act=async(type,extra={})=>{i=(await call(admin,'/noc/overview')).incidents.find(v=>v.id===i.id);await call(admin,'/noc/action',{type,id:i.id,version:i.version,...extra});};
  N.scan(s);assert.match((await dial(client,'2')).message,/En analyse chez Moov/);
  await act('approve',{note:'Plan vérifié'});await act('dispatch',{technician:'koffi',safety:true});await act('advance');
  r=await dial(client,'3');assert.match(r.message,/Koffi N’Guessan est en route/);assert.match(r.message,/Tél : \+225/);
  assert.match((await dial(client,'2')).message,/Technicien en route\.\nArrivée dans \d+ min/);
  r=await dial(client,'5');assert.match(r.sms.link,/^\/codex\/\?suivi=[A-Za-z0-9_-]{20,40}$/);
  const view=await call(null,'/track/'+r.sms.link.split('=')[1]);assert.equal(view.incident.status,'en_route');

  // Un voisin du même quartier : la panne est déjà connue, inutile de la signaler une deuxième fois.
  await call(neighbor,'/noc/join',{segment:'YOP-07',consent:true});
  assert.match((await dial(neighbor,'4')).message,/Oui : panne en cours/);
  assert.match((await dial(neighbor,'1')).message,/déjà une panne dans votre quartier/);
  assert.match((await dial(neighbor,'9')).message,/Choix inconnu/);
  assert.match((await dial(neighbor,'0')).message,/\*144#/);
 }finally{server.close();}
});
