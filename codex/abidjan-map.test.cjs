'use strict';
// « Abidjan en direct » : la carte de la ville, les trajets des équipes et le nombre de voisins touchés.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const A=require('./abidjan-map.js'),N=require('./noc-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');

test('Chaque quartier suivi et chaque équipe sont placés sur la carte, dans leur commune',()=>{
 for(const [id,s] of Object.entries(A.SEGMENTS)){
  const [x,y]=A.project(s.at);assert.ok(x>0&&x<A.W&&y>0&&y<A.H,id+' dans le cadre');
  assert.ok(A.COMMUNES.some(c=>c.id===s.commune),id+' rattaché à une commune connue');
 }
 for(const t of N.TECHS)assert.ok(A.BASES[t.id],'base connue pour '+t.name);
 assert.equal(A.COMMUNES.length,10,'les dix communes d’Abidjan');
});

test('Trajet : départ à la base, arrivée au quartier, passage par un pont pour changer de rive',()=>{
 const r=A.route('amina','COC-03');
 assert.deepEqual(r[0],A.project(A.BASES.amina.at));assert.deepEqual(r.at(-1),A.project(A.SEGMENTS['COC-03'].at));
 assert.ok(r.length>=4,'Treichville → Cocody passe par un pont');
 const start=A.along(r,0),end=A.along(r,1),mid=A.along(r,.5);
 assert.deepEqual([start.x,start.y],r[0]);assert.ok(Math.abs(end.x-r.at(-1)[0])<.01&&Math.abs(end.y-r.at(-1)[1])<.01);
 assert.ok(Number.isFinite(mid.x)&&Number.isFinite(mid.angle));
 assert.equal(A.route('inconnu','YOP-07'),null);
});

test('Avancement : en route selon l’heure de départ, puis immobile sur place',()=>{
 const now=Date.now(),position={departedAt:now-60000,durationMs:120000,progress:0};
 assert.ok(Math.abs(A.progressOf({status:'en_route',position},now)-.5)<.001);
 assert.equal(A.progressOf({status:'dispatched',position},now),0);
 assert.equal(A.progressOf({status:'on_site',position},now),1);
 assert.equal(A.progressOf({status:'en_route',position:{...position,departedAt:now-999999}},now),1);
});

test('Voisins touchés : box hors ligne du quartier, sans compter la vôtre ; jamais inventés',()=>{
 assert.equal(A.neighbors({online:8,total:20}),11);
 assert.equal(A.neighbors({online:20,total:20}),0);
 assert.equal(A.neighbors(null),null);assert.equal(A.neighbors({total:20}),null);
 assert.equal(A.homes('YOP-07',20).length,20);assert.deepEqual(A.homes('YOP-07',20),A.homes('YOP-07',20),'disposition stable');
});

test('Le client reçoit le compte de box de son quartier, sans donnée personnelle',async()=>{
 const server=createGuardianServer({db:':memory:',onError:()=>{}}),store=server.guardianStore;
 try{
  const u=(await store.register({email:'voisin@example.test',password:'voisin-password-1234',name:'Voisin'})).user;
  N.join(store,u.id,{segment:'YOP-07',consent:true});
  store.run("UPDATE noc_segments SET online=8,alarm='LOS',sample_at=? WHERE id='YOP-07'",Date.now());N.scan(store);
  const i=N.client(store,u.id).incidents.find(v=>v.segment==='YOP-07'&&!v.terminal);
  assert.ok(i,'incident de quartier visible');assert.deepEqual(i.area,{online:8,total:20});
  assert.equal(A.neighbors(i.area),11);
 }finally{server.close();}
});

test('La carte est chargée, n’utilise que les couleurs de marque et n’affiche aucun avertissement technique',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
 assert.match(read('bootstrap.js'),/'guardian-map\.js', 'abidjan-map\.js'/);
 assert.match(read('index.html'),/abidjan-map\.css/);
 assert.doesNotMatch(read('abidjan-map.css'),/#[0-9a-f]{3,8}\b|rgba?\(/i);
 assert.doesNotMatch(read('abidjan-map.js'),/simul|fictif/i);
});
