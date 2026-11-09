'use strict';
// Fibre Welcome (thème 1) : le parcours du nouvel abonné, de la commande à l'ouverture de son espace.
const {test}=require('node:test'),assert=require('node:assert/strict'),{Store}=require('./pilot-store.cjs');
const operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),W=require('./welcome.cjs');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const now=Date.UTC(2026,10,9,10);

async function fixture(){const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);W.migrate(s);const ids={};
 for(const [name,role]of [['awa',null],['koffi',null],['nadia','agent']]){const u=(await s.register({email:name+'@example.test',name:name+' Test',password:'welcome-test-password'})).user;ids[name]=u.id;if(role)operator.grant(s,u.email,role);}
 return {s,...ids};}

test('Commande, dossier vérifié, rendez-vous, installation puis espace ouvert avec le forfait commandé',async()=>{
 const {s,awa,nadia}=await fixture();
 let r=W.act(s,awa,{action:'order',plan:'demo-200',commune:'Cocody',quartier:'Riviera 3'},now);
 assert.equal(r.order.step,'dossier');assert.equal(r.order.plan.mbps,200);
 assert.throws(()=>W.act(s,awa,{action:'order',plan:'demo-100',commune:'Cocody',quartier:'Riviera 3'},now),{status:409},'une seule installation à la fois');
 assert.throws(()=>W.act(s,awa,{action:'photos',idPhoto:'pas une photo',homePhoto:PNG},now),/Photo/);
 r=W.act(s,awa,{action:'photos',idPhoto:PNG,homePhoto:PNG},now);
 assert.equal(r.order.step,'verification');assert.equal(r.order.deadline,now+24*3600000);
 assert.equal(JSON.stringify(r).includes('base64'),false,'le client ne reçoit jamais les photos en retour');
 const l=W.list(s,nadia,now);assert.equal(l.toCheck,1);assert.equal(l.items[0].client,'awa T.');assert.ok(l.items[0].photoUrls.id.startsWith('data:image'));
 W.operate(s,nadia,{id:r.order.id,action:'validate'},now);
 r=W.state(s,awa,now);assert.equal(r.order.step,'rdv');assert.equal(r.order.slots.length,6);
 assert.throws(()=>W.act(s,awa,{action:'slot',at:now+1},now),/créneaux/);
 r=W.act(s,awa,{action:'slot',at:r.order.slots[0]},now);
 assert.equal(r.order.status,'planifie');assert.equal(r.order.tech.name,'Yao Konan','technicien de Cocody');
 assert.throws(()=>W.activate(s,awa),{status:409},'pas d’espace avant l’installation');
 W.operate(s,nadia,{id:r.order.id,action:'depart'},now);
 assert.throws(()=>W.act(s,awa,{action:'cancel'},now),{status:409},'technicien en route : on ne peut plus annuler dans l’app');
 W.operate(s,nadia,{id:r.order.id,action:'done'},now);
 r=W.state(s,awa,now);assert.equal(r.order.step,'bienvenue');
 assert.equal(s.get('SELECT id_photo FROM fibre_welcome WHERE id=?',r.order.id).id_photo,null,'photos effacées après l’installation');
 const st=W.activate(s,awa);assert.equal(st.plan.mbps,200);assert.equal(st.notifications[0].title,'Bienvenue chez Moov');
 r=W.act(s,awa,{action:'rate',stars:5,comment:'Rapide et propre'},now);assert.equal(r.order.rating,5);
 assert.throws(()=>W.act(s,awa,{action:'rate',stars:4},now),{status:409},'une seule note');
});

test('Le conseiller peut demander une nouvelle photo ; un client ne voit ni ne touche les dossiers des autres',async()=>{
 const {s,awa,koffi,nadia}=await fixture();
 const o=W.act(s,awa,{action:'order',plan:'demo-100',commune:'Abobo',quartier:'PK 18'},now).order;
 W.act(s,awa,{action:'photos',idPhoto:PNG,homePhoto:PNG},now);
 assert.throws(()=>W.list(s,koffi,now),{status:403});
 assert.throws(()=>W.operate(s,koffi,{id:o.id,action:'validate'}),{status:403});
 assert.equal(W.state(s,koffi,now).order,null);
 assert.throws(()=>W.operate(s,nadia,{id:o.id,action:'ask',note:''}),/préciser/);
 W.operate(s,nadia,{id:o.id,action:'ask',note:'La pièce d’identité est floue, reprenez-la à la lumière.'},now);
 const r=W.state(s,awa,now);assert.equal(r.order.step,'dossier');assert.match(r.order.note,/floue/);assert.equal(r.order.photos.id,false);
 assert.throws(()=>W.act(s,awa,{action:'order',plan:'demo-100',commune:'Paris',quartier:'Centre'},now),{status:409});
 W.act(s,awa,{action:'cancel'},now);
 assert.throws(()=>W.act(s,awa,{action:'order',plan:'demo-100',commune:'Paris',quartier:'Centre'},now),/couverte/);
 assert.equal(W.techFor('Abobo').name,'Yao Konan','Abobo : l’équipe de Cocody, la plus proche');
});

test('Les créneaux : trois jours à partir de demain, sans dimanche',()=>{
 const sat=Date.UTC(2026,10,7,9),list=W.slots(sat);
 assert.equal(list.length,6);assert.ok(list.every(t=>new Date(t).getDay()!==0));assert.ok(list[0]>sat);
});

test('Un client sans compte Moov reçoit 403 sur la liste des installations',async()=>{
 const {createGuardianServer}=require('./pilot-server.cjs');const srv=createGuardianServer({db:':memory:'});await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+srv.address().port;
 try{
  const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'fw@example.test',password:'welcome-pass-123',name:'Client FW'})});
  const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),H={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf};
  assert.equal((await fetch(base+'/api/noc/welcome',{headers:{Cookie:cookie}})).status,403);
  const r=await (await fetch(base+'/api/welcome',{method:'POST',headers:H,body:JSON.stringify({action:'order',plan:'demo-50',commune:'Yopougon',quartier:'Niangon'})})).json();
  assert.equal(r.order.step,'dossier');
 }finally{srv.close();}
});
