'use strict';
// Retention Score (thème 6) : le risque de départ suit ce que le client a vécu, et l'action conseillée suit la cause.
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('./retention.cjs');
const DAY=86400000,now=Date.UTC(2026,10,9,12);
const empty=()=>({incidents:[],eta:new Map(),calls:[],reports:[],feedback:[]});
const client={id:'u1',segment:'YOP-07',messages:[],saturation:0};

test('Un client sans souci a un score nul et rien à faire',()=>{
 const f=R.factorsFor(client,empty(),now);assert.deepEqual(f,[]);assert.equal(R.actionFor(f).kind,'rien');
});

test('Les pannes de son quartier, une longue coupure et un retour promis non tenu font monter le risque',()=>{
 const d=empty();
 d.incidents=[{id:'i1',segment_id:'YOP-07',status:'resolved',created:now-2*DAY,updated:now-2*DAY+6*3600000},{id:'i2',segment_id:'YOP-07',status:'resolved',created:now-DAY,updated:now-DAY+3600000},{id:'i3',segment_id:'COC-01',status:'resolved',created:now-DAY,updated:now-DAY+3600000},{id:'old',segment_id:'YOP-07',status:'resolved',created:now-40*DAY,updated:now-40*DAY}];
 d.eta.set('i2',{promised:now-DAY+1800000});
 const f=R.factorsFor(client,d,now),pts=Object.fromEntries(f.map(x=>[x.key,x.points]));
 assert.deepEqual(pts,{pannes:30,longue:10,retard:15},'pannes d’un autre quartier ou de plus de 30 jours ignorées');
 assert.equal(R.actionFor(f).kind,'geste');
});

test('Dire « je veux résilier » à Guardian, même en nouchi traduit, met le client en tête',()=>{
 for(const text of ['Je veux résilier mon abonnement','je vais partir chez Orange','On va couper l’abonnement'])
  assert.ok(R.LEAVE.test(R.fold(text)),text);
 const f=R.factorsFor({...client,messages:[{role:'user',text:'Ma connexion là gère pas',meaning:'je veux résilier'}]},empty(),now);
 assert.equal(f[0].key,'depart');assert.equal(f[0].points,30);assert.equal(R.actionFor(f).kind,'appel');
 assert.deepEqual(R.factorsFor({...client,messages:[{role:'assistant',text:'Une résiliation se fait en agence'}]},empty(),now),[],'les mots de Guardian ne comptent pas');
});

test('Appels, signalements, mauvaise note, ligne saturée',()=>{
 const d=empty();d.calls=[{user_id:'u1',at:now-DAY},{user_id:'u1',at:now-2*DAY},{user_id:'u1',at:now-3*DAY},{user_id:'u2',at:now}];
 d.reports=[{user_id:'u1',created:now}];d.feedback=[{user_id:'u1',rating:2,created:now}];
 const f=R.factorsFor({...client,saturation:.2},d,now),pts=Object.fromEntries(f.map(x=>[x.key,x.points]));
 assert.deepEqual(pts,{appels:20,signalements:5,note:20,sature:10});assert.equal(R.actionFor(f).kind,'excuse');
});

test('Côté Moov : réservé à l’équipe, clients triés du plus au moins à risque',async()=>{
 const {createGuardianServer}=require('./pilot-server.cjs');const srv=createGuardianServer({db:':memory:'});await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+srv.address().port;
 try{
  const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'client-ret@example.test',password:'retention-pass-123',name:'Client Test'})});
  const cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  assert.equal((await fetch(base+'/api/noc/retention',{headers:{Cookie:cookie}})).status,403);
 }finally{srv.close();}
});

// Thème 6 : le conseiller appelle, puis envoie l'offre préparée par Guardian. Le client la reçoit dans ses notifications.
test('Le conseiller note son appel et envoie l’offre adaptée à la cause, une fois par mois',async()=>{
 const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);R.migrate(s);const ids={};
 for(const n of ['awa','kader']){ids[n]=(await s.register({email:n+'@example.test',name:n==='awa'?'Awa Koné':'Kader',password:'retention-password-1'})).user.id;}
 operator.grant(s,'kader@example.test','agent');
 s.run("INSERT OR IGNORE INTO noc_segments(id,zone,total,online,latency,sample_at) VALUES('YOP-07','Yopougon · Niangon',20,20,10,?)",now);
 s.run("INSERT OR REPLACE INTO noc_members(user_id,segment_id) VALUES(?,'YOP-07')",ids.awa);
 const st=journey.seed();st.plan={mbps:100,price:20000};st.messages=[{role:'user',text:'Je veux résilier mon abonnement'}];journey.put(s,ids.awa,st);
 const c=R.scores(s,ids.kader,now).clients.find(x=>x.id===ids.awa);
 assert.equal(c.offer.kind,'mois');assert.match(c.offer.label,/1 mois offert \(20.000 F\)/);assert.equal(c.suivi,null);
 assert.throws(()=>R.act(s,ids.awa,{client:ids.awa,action:'offre'},now),e=>e.status===403,'un client ne peut rien envoyer');
 assert.throws(()=>R.act(s,ids.kader,{client:ids.awa,action:'appel',outcome:'peut-être'},now),/résultat de l’appel/);
 let r=R.act(s,ids.kader,{client:ids.awa,action:'appel',outcome:'hesite'},now);
 assert.equal(r.clients.find(x=>x.id===ids.awa).suivi.outcomeText,'Hésite encore');
 r=R.act(s,ids.kader,{client:ids.awa,action:'offre'},now+1000);
 assert.match(r.clients.find(x=>x.id===ids.awa).suivi.offerLabel,/1 mois offert/);
 const n=journey.get(s,ids.awa).notifications[0];
 assert.equal(n.title,'Une attention de Moov pour vous');assert.match(n.body,/prochain mois est offert/);
 assert.throws(()=>R.act(s,ids.kader,{client:ids.awa,action:'offre'},now+2000),/déjà été envoyée/);
});

test('L’offre suit la cause : ligne saturée, mauvaise note, pannes',()=>{
 const plan={mbps:100,price:20000};
 assert.equal(R.offerFor([{key:'sature'}],plan).kind,'monter');
 assert.equal(R.offerFor([{key:'note'}],plan).kind,'visite');
 assert.equal(R.offerFor([{key:'pannes'}],plan).kind,'boost');
});
