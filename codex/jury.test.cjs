'use strict';
// « Le jury vit la panne » et la régie : comptes anonymes, droits vérifiés côté serveur, scène complète, remise à zéro.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs'),O=require('./operator-store.cjs');

async function setup(){
 const server=createGuardianServer({db:':memory:',onError:()=>{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,store=server.guardianStore;
 async function call(who,p,body){const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:who?.cookie||'','X-CSRF-Token':who?.csrf||''},body:body?JSON.stringify(body):undefined});const data=await r.json();if(r.ok&&data.user?.csrf&&who&&r.headers.getSetCookie().length){who.cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');who.csrf=data.user.csrf;}return {status:r.status,data};}
 async function account(email,kind='register'){const r=await fetch(base+'/api/auth/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'jury-password-1234',name:'Compte '+email})});const d=await r.json();return {id:d.user.id,csrf:d.user.csrf,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};}
 async function juror(code){const r=await fetch(base+'/api/jury/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,consent:true})});const d=await r.json();return {status:r.status,data:d,id:d.user?.id,csrf:d.user?.csrf,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};}
 await account('regie@example.test');O.grant(store,'regie@example.test','admin');const admin=await account('regie@example.test','login');
 return {server,store,base,call,account,juror,admin};
}

test('Salle du jury : code requis, accord requis, compte anonyme sans rôle opérateur',async()=>{
 const t=await setup();
 try{
  assert.equal((await t.juror('ZZZZZZ')).status,404);
  const room=(await t.call(t.admin,'/regie',{type:'open'})).data.room;
  assert.match(room.code,/^[A-HJ-NP-Z2-9]{6}$/);assert.ok(room.url.endsWith('/codex/?jury='+room.code));
  const refused=await fetch(t.base+'/api/jury/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:room.code})});assert.equal(refused.status,400);
  const j=await t.juror(room.code.toLowerCase());assert.equal(j.status,201);
  assert.equal(j.data.user.name,'Membre du jury 1');assert.equal(j.data.user.role,'subscriber');assert.match(j.data.user.email,/@guardian\.invalid$/);
  const me=(await t.call(j,'/jury/me')).data;assert.equal(me.number,1);assert.equal(me.zone,'Yopougon · Niangon');assert.equal(me.scene,null);
  assert.equal((await t.call(j,'/noc/client')).data.segment,'YOP-07');
  assert.equal((await t.juror(room.code)).data.user.name,'Membre du jury 2');
  assert.equal((await t.call(t.admin,'/regie')).data.room.jurors,2);
 }finally{t.server.close();}
});

test('Régie : refusée à un abonné, à un membre du jury et à un agent support',async()=>{
 const t=await setup();
 try{
  const room=(await t.call(t.admin,'/regie',{type:'open'})).data.room,j=await t.juror(room.code);
  const client=await t.account('abonne@example.test');await t.account('agent@example.test');O.grant(t.store,'agent@example.test','agent');const agent=await t.account('agent@example.test','login');
  for(const who of [j,client,agent]){
   assert.equal((await t.call(who,'/regie')).status,403);
   assert.equal((await t.call(who,'/regie',{type:'cut'})).status,403);
   assert.equal((await t.call(who,'/regie',{type:'reset',confirm:true})).status,403);
  }
  assert.equal((await t.call(null,'/regie')).status,401);
 }finally{t.server.close();}
});

test('Scène complète : coupure, alerte, technicien, réparation vérifiée, certificat et note du jury',async()=>{
 const t=await setup();
 try{
  assert.equal((await t.call(t.admin,'/regie',{type:'cut'})).status,409,'salle à ouvrir d’abord');
  const room=(await t.call(t.admin,'/regie',{type:'open'})).data.room,j=await t.juror(room.code);
  let r=(await t.call(t.admin,'/regie',{type:'cut'})).data;assert.equal(r.scene.status,'proposed');assert.equal(r.next,'send');
  assert.equal((await t.call(t.admin,'/regie',{type:'cut'})).status,409,'une seule coupure à la fois');
  let me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene.status,'proposed');assert.equal(me.scene.cause,'FIBER_CUT_DISTRIBUTION');assert.ok(me.segment.online<me.segment.total);
  assert.ok((await t.call(j,'/noc/notifications')).data.unreadCount>0,'le jury est prévenu');
  r=(await t.call(t.admin,'/regie',{type:'send'})).data;assert.equal(r.scene.status,'en_route');assert.equal(r.scene.technician,'koffi');assert.equal(r.next,'arrive');
  me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene.position.technician,'Koffi N’Guessan');assert.equal(me.scene.certificate,null);
  r=(await t.call(t.admin,'/regie',{type:'arrive'})).data;assert.equal(r.scene.status,'on_site');
  r=(await t.call(t.admin,'/regie',{type:'repair'})).data;assert.equal(r.scene.status,'resolved');assert.equal(r.next,'cut');
  me=(await t.call(j,'/jury/me')).data;const c=me.scene.certificate;
  assert.ok(c,'certificat après vérification');assert.match(c.reference,/^FG-[A-Z0-9]{6}$/);assert.equal(c.technician,'Koffi N’Guessan');assert.equal(c.online,20);assert.equal(c.total,20);assert.ok(c.arrivedAt&&c.restoredAt>=c.detectedAt);
  assert.equal((await t.call(j,'/noc/feedback',{id:me.scene.id,rating:5,comment:'Bluffant'})).status,200);
  assert.deepEqual((await t.call(t.admin,'/regie')).data.ratings,{count:1,average:5});
  // Les droits du NOC restent ceux de l'administrateur : chaque étape est tracée à son nom.
  const events=t.store.all("SELECT actor,kind FROM noc_events WHERE incident_id=? AND kind IN ('plan.approved','dispatched','resolved')",me.scene.id);
  assert.equal(events.length,3);assert.ok(events.every(e=>e.actor===t.admin.id));
 }finally{t.server.close();}
});

test('Tout remettre à zéro : moins de 2 secondes, le jury et la régie restent connectés',async()=>{
 const t=await setup();
 try{
  const room=(await t.call(t.admin,'/regie',{type:'open'})).data.room,j=await t.juror(room.code);
  await t.call(t.admin,'/regie',{type:'cut'});await t.call(t.admin,'/regie',{type:'send'});
  assert.equal((await t.call(t.admin,'/regie',{type:'reset'})).status,400,'confirmation requise');
  const start=Date.now(),r=await t.call(t.admin,'/regie',{type:'reset',confirm:true});
  assert.equal(r.status,200);assert.ok(Date.now()-start<2000,'remise à zéro en '+(Date.now()-start)+' ms');
  assert.equal(r.data.room.code,room.code);assert.equal(r.data.room.jurors,1);assert.equal(r.data.scene,null);assert.equal(r.data.next,'cut');
  assert.equal((await t.call(t.admin,'/regie')).status,200,'la régie garde la main avec sa nouvelle session');
  const me=await t.call(j,'/jury/me');assert.equal(me.status,200);assert.equal(me.data.scene,null);assert.equal(me.data.segment.online,me.data.segment.total);
  assert.equal(O.role(t.store,j.id),'subscriber');
  // La démo pré-remplie est réinstallée : la scène peut être rejouée.
  assert.equal((await t.call(t.admin,'/regie',{type:'cut'})).data.scene.status,'proposed');
 }finally{t.server.close();}
});
