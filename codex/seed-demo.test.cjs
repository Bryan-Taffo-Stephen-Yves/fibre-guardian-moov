'use strict';
// Démo pré-remplie : idempotente, complète, et remise à zéro réservée à l'administrateur (vérifié côté serveur).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs');
const {createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO,NEIGHBOURS}=require('./seed-demo.cjs');

const COUNTS=['users','noc_incidents','noc_notifications','audit'];
function counts(store){return Object.fromEntries(COUNTS.map(t=>[t,store.get('SELECT count(*) AS n FROM '+t).n]));}
async function fresh(){const store=new Store(':memory:');const server=createGuardianServer({store});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {store,server,base:'http://127.0.0.1:'+server.address().port};}
async function login(base,email,password){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'connexion '+email);const {user}=await r.json();const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return (path,body)=>fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});}

test('La démo pré-remplie crée la situation attendue, et un second passage ne change rien',async()=>{
 const {store,server}=await fresh();
 try{
  const first=await seedDemo(store);assert.equal(first.seeded,true);
  const before=counts(store);
  assert.equal(before.users,3+NEIGHBOURS.length,'3 comptes et un client par quartier');
  const incidents=store.all('SELECT segment_id AS segment,status FROM noc_incidents ORDER BY segment_id');
  assert.ok(incidents.some(i=>i.segment==='COC-03'&&i.status==='proposed'),'COC-03 en attente de validation');
  assert.ok(incidents.some(i=>i.segment==='YOP-07'&&i.status==='resolved'),'YOP-07 résolu dans la nuit');
  const tickets=store.all('SELECT status FROM tickets');assert.equal(tickets.length,2);
  const second=await seedDemo(store);assert.equal(second.seeded,false);
  assert.deepEqual(counts(store),before,'aucune donnée en double');
 }finally{server.close();}
});

test('Réinitialiser la démo : refusé au client, accepté pour l’administrateur avec confirmation',async()=>{
 const {store,server,base}=await fresh();
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{
  await seedDemo(store);
  const awa=await login(base,DEMO.client.email,DEMO.client.fallback);
  assert.equal((await awa('/demo/reset',{confirm:true})).status,403,'un client ne peut pas réinitialiser');
  const admin=await login(base,DEMO.admin.email,'direction-test-2026');
  assert.equal((await admin('/demo/reset',{})).status,400,'confirmation obligatoire');
  store.run("UPDATE noc_incidents SET status='resolved' WHERE segment_id='COC-03'");
  const r=await admin('/demo/reset',{confirm:true});assert.equal(r.status,200);
  assert.equal(store.get("SELECT status FROM noc_incidents WHERE segment_id='COC-03'").status,'proposed','la démo est rejouée');
  assert.equal(store.get('SELECT count(*) AS n FROM users').n,3+NEIGHBOURS.length);
 }finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;server.close();}
});

test('Remise à zéro répétée pendant la répétition : jamais bloquée par la limite anti-abus des connexions',async()=>{
 const {store,server}=await fresh();
 const {resetDemo}=require('./seed-demo.cjs');
 try{
  await seedDemo(store);
  // Quatre remises à zéro dans la même minute : chacune recrée et reconnecte les comptes de la démo.
  for(let n=0;n<4;n++){const r=await resetDemo(store);assert.equal(r.seeded,true,'remise à zéro n° '+(n+1));}
  assert.equal(store.get('SELECT count(*) AS n FROM users').n,3+NEIGHBOURS.length,'tous les comptes de la démo sont là');
 }finally{server.close();}
});

test('Clients de quartier : leur espace est ouvert, l’accueil peut montrer la panne du quartier dès la connexion',async()=>{
 const {store,server}=await fresh();
 try{
  await seedDemo(store);
  for(const n of NEIGHBOURS){const u=store.get('SELECT id FROM users WHERE email=?',n.email);assert.ok(store.get('SELECT 1 AS ok FROM journey_state WHERE user_id=?',u.id),'espace ouvert pour '+n.email);}
 }finally{server.close();}
});
