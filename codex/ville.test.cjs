'use strict';
// Carte des pannes du client : il voit si la panne touche seulement son quartier ou d'autres aussi,
// sans jamais voir un nom, un numéro ou un dossier d'un autre client.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO,NEIGHBOURS}=require('./seed-demo.cjs'),N=require('./noc-store.cjs'),V=require('./ville.cjs');

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id,chef=uid(DEMO.admin.email);
 return {store,server,chef,awa:uid(DEMO.client.email),rose:uid('rose.ehui@demo.fibre-guardian.ci'),sim:(segment,scenario)=>N.operate(store,chef,{type:'simulate',segment,scenario}),close:()=>server.close()};
}
const of=(snap,id)=>snap.quartiers.find(q=>q.id===id);

test('Les douze quartiers sont sur la carte, le sien est repéré',async()=>{
 const t=await seeded();
 try{
  const s=V.snapshot(t.store,t.awa);
  assert.equal(s.quartiers.length,12);assert.equal(s.mine,'YOP-07');
  assert.deepEqual(s.quartiers.filter(q=>q.chezMoi).map(q=>q.id),['YOP-07']);
  // La démo démarre avec une seule panne, à Cité des Arts (Cocody) ; partout ailleurs tout va bien.
  assert.deepEqual(s.quartiers.filter(q=>q.state!=='normal').map(q=>q.id),['COC-03']);
  assert.ok(s.quartiers.filter(q=>q.id!=='COC-03').every(q=>q.boxEteintes===0));
  assert.equal(of(s,'PLA-01').quartier,'Plateau','pas de « Plateau · Plateau »');
  assert.equal(of(s,'BAS-01').commune,'Grand-Bassam');
 }finally{t.close();}
});

test('Panne ailleurs : Awa voit que Grand-Bassam est touché et que son quartier va bien',async()=>{
 const t=await seeded();
 try{
  t.sim('BAS-01','fiber');
  const s=V.snapshot(t.store,t.awa),bas=of(s,'BAS-01');
  assert.equal(bas.state,'panne');assert.equal(bas.cause,'fibre');assert.equal(bas.boxEteintes,12);assert.equal(bas.box,20);
  assert.ok(bas.etape,'où en est Moov');
  assert.equal(of(s,'YOP-07').state,'normal');
  // Rose, à Grand-Bassam, voit la même panne, chez elle.
  const r=V.snapshot(t.store,t.rose);assert.equal(r.mine,'BAS-01');assert.ok(of(r,'BAS-01').chezMoi);
 }finally{t.close();}
});

test('Coupure de courant, internet ralenti, équipement central : chaque cas est dit en clair',async()=>{
 const t=await seeded();
 try{
  t.sim('YOP-07','power');t.sim('ABO-01','congestion');t.sim('KOU-01','olt');
  const s=V.snapshot(t.store,t.awa);
  assert.equal(of(s,'YOP-07').state,'courant');assert.ok(of(s,'YOP-07').chezMoi);
  assert.equal(of(s,'ABO-01').state,'lent');
  assert.equal(of(s,'KOU-01').state,'panne');assert.equal(of(s,'KOU-01').cause,'central');
  t.sim('ABO-01','normal');assert.notEqual(of(V.snapshot(t.store,t.awa),'ABO-01').state,'lent');
 }finally{t.close();}
});

test('Rien sur les autres clients : ni nom, ni e-mail, ni dossier, ni technicien',async()=>{
 const t=await seeded();
 try{
  t.sim('BAS-01','fiber');t.sim('MAR-02','pole');
  const s=V.snapshot(t.store,t.awa),text=JSON.stringify(s);
  assert.deepEqual(Object.keys(s).sort(),['at','mine','quartiers']);
  for(const q of s.quartiers)assert.deepEqual(Object.keys(q).sort(),['box','boxEteintes','cause','chezMoi','commune','etape','id','quartier','retour','state']);
  assert.doesNotMatch(text,/@|Rose|Ehui|Awa|Koffi|N’Guessan/);
  for(const n of NEIGHBOURS)assert.ok(!text.includes(n.name),n.name);
  for(const {id} of t.store.all('SELECT id FROM noc_incidents'))assert.ok(!text.includes(id),'pas d’identifiant de dossier');
 }finally{t.close();}
});

test('Le serveur sert la carte aux clients connectés seulement',async()=>{
 const t=await seeded();
 try{
  await new Promise(r=>t.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+t.server.address().port;
  assert.equal((await fetch(base+'/api/ville')).status,401);
  const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'carte@example.test',password:'carte-password-123',name:'Test Carte'})});
  const cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const r=await fetch(base+'/api/ville',{headers:{Cookie:cookie}});assert.equal(r.status,200);
  const d=await r.json();assert.equal(d.quartiers.length,12);assert.equal(d.mine,null,'pas encore de quartier choisi');
 }finally{t.close();}
});

test('Côté client : page « Carte des pannes », carte 3D en lecture seule, aucun avertissement technique',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8'),view=read('ville-view.js'),journey=read('journey.js');
 assert.match(journey,/'survie','ville'/);assert.match(journey,/nav\('Carte des pannes','ville'\)/);assert.match(journey,/FGVille\.Card/);
 assert.match(read('bootstrap.js'),/'ville-view\.js'/);assert.match(read('index.html'),/ville\.css/);
 assert.match(view,/FGSim3D\.Scene/);assert.doesNotMatch(view,/noc\/action|'simulate'/,'le client ne déclenche rien');
 assert.doesNotMatch(view,/simulé|fictif|moteur à règles|pas de LLM/i);
 assert.doesNotMatch(read('ville.css'),/#[0-9a-f]{3,6}\b|rgb\(/i,'couleurs Moov seulement');
});
