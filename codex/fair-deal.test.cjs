'use strict';
// Fair Deal (thème 4) : le geste suit la coupure vécue, et seul un responsable l'accorde.
const {test}=require('node:test'),assert=require('node:assert/strict');
const FD=require('./fair-deal.cjs');
const H=3600000,t0=Date.UTC(2026,10,9,8);

test('Toute coupure confirmée vaut 1 jour, puis 1 jour par 24 h commencées, puis 1 jour si le retour promis est raté',()=>{
 assert.deepEqual(FD.gesture({created:t0,ended:t0+2*H,price:20000}).days,1);
 assert.equal(FD.gesture({created:t0,ended:t0+2*H,price:20000}).amount,670,'20 000 F / 30, arrondi à 10 F');
 assert.equal(FD.gesture({created:t0,ended:t0+30*H}).days,2);
 assert.equal(FD.gesture({created:t0,ended:t0+50*H}).days,3);
 const late=FD.gesture({created:t0,ended:t0+3*H,promised:t0+2*H,price:30000});
 assert.equal(late.days,2);assert.equal(late.amount,2000);assert.match(late.reasons.at(-1),/promise/);
 assert.equal(FD.gesture({created:t0,ended:t0+2*H+10*60000,promised:t0+2*H}).days,1,'un retard de moins de 15 minutes ne compte pas');
});

test('Un client ne voit pas les gestes ; un agent les voit sans pouvoir les accorder',async()=>{
 const {createGuardianServer}=require('./pilot-server.cjs');const srv=createGuardianServer({db:':memory:'});await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+srv.address().port;
 try{
  const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'fd@example.test',password:'fairdeal-pass-123',name:'Client FD'})});
  const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  assert.equal((await fetch(base+'/api/noc/fairdeal',{headers:{Cookie:cookie}})).status,403);
  assert.equal((await fetch(base+'/api/noc/fairdeal',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:JSON.stringify({incidentId:'x',decision:'validate',confirm:true})})).status,403);
 }finally{srv.close();}
});

test('Coupure réparée : gestes préparés une fois, validés par un responsable, clients prévenus',()=>{
 const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE operator_grants(user_id TEXT PRIMARY KEY,role TEXT);CREATE TABLE noc_field_accounts(user_id TEXT PRIMARY KEY);
  CREATE TABLE noc_segments(id TEXT PRIMARY KEY,zone TEXT);CREATE TABLE noc_members(user_id TEXT PRIMARY KEY,segment_id TEXT);
  CREATE TABLE noc_incidents(id TEXT PRIMARY KEY,segment_id TEXT,mode TEXT,status TEXT,title TEXT,created INTEGER,updated INTEGER);
  CREATE TABLE noc_eta(incident_id TEXT PRIMARY KEY,promised INTEGER);CREATE TABLE journey_state(user_id TEXT PRIMARY KEY,body TEXT);
  CREATE TABLE noc_events(id TEXT PRIMARY KEY,incident_id TEXT,actor TEXT,kind TEXT,public_text TEXT,detail TEXT,at INTEGER);`);
 const s={db,get:(q,...a)=>db.prepare(q).get(...a),all:(q,...a)=>db.prepare(q).all(...a),run:(q,...a)=>db.prepare(q).run(...a),transaction:f=>f()};
 FD.migrate(s);
 s.run("INSERT INTO users VALUES('boss','Direction'),('agent','Agent'),('awa','Awa Koné'),('yao','Yao Konan'),('far','Loin')");
 s.run("INSERT INTO operator_grants VALUES('boss','admin'),('agent','agent')");
 s.run("INSERT INTO noc_segments VALUES('YOP','Yopougon · Niangon'),('COC','Cocody')");
 s.run("INSERT INTO noc_members VALUES('awa','YOP'),('yao','YOP'),('far','COC'),('agent','YOP')");
 s.run("INSERT INTO journey_state VALUES('awa',?)",JSON.stringify({plan:{price:30000},notifications:[]}));
 const now=t0+10*H;s.run("INSERT INTO noc_incidents VALUES('i1','YOP','demo','resolved','Fibre coupée',?,?)",t0,t0+3*H);s.run("INSERT INTO noc_eta VALUES('i1',?)",t0+2*H);
 const l=FD.list(s,'agent',now);assert.equal(l.canDecide,false);assert.equal(l.pending.length,1);
 const g=l.pending[0];assert.equal(g.clients.length,2,'les clients du quartier, pas l’équipe ni Cocody');assert.equal(g.days,4);
 FD.list(s,'boss',now);assert.equal(s.get('SELECT COUNT(*) AS n FROM fair_deal').n,2,'préparés une seule fois');
 assert.throws(()=>FD.decide(s,'agent',{incidentId:'i1',decision:'validate',confirm:true},now),/responsable/);
 assert.throws(()=>FD.decide(s,'boss',{incidentId:'i1',decision:'validate'},now),/Confirmez/);
 const after=FD.decide(s,'boss',{incidentId:'i1',decision:'validate',confirm:true},now);
 assert.equal(after.pending.length,0);assert.equal(after.decided[0].status,'validated');
 const awa=JSON.parse(s.get("SELECT body FROM journey_state WHERE user_id='awa'").body);
 assert.equal(awa.notifications[0].title,'Moov vous offre 2 jours');assert.match(awa.notifications[0].body,/2\s000\sF/);
 assert.throws(()=>FD.decide(s,'boss',{incidentId:'i1',decision:'refuse'},now),/Aucun geste/);
});
