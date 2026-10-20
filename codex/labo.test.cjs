'use strict';
// Labo réseau : réservé à l'équipe Moov, et fidèle à l'état des quartiers du simulateur.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO}=require('./seed-demo.cjs'),N=require('./noc-store.cjs'),L=require('./labo.cjs');

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id;
 return {store,chef:uid(DEMO.admin.email),awa:uid(DEMO.client.email),sim:(segment,scenario)=>N.operate(store,uid(DEMO.admin.email),{type:'simulate',segment,scenario}),close:()=>server.close()};
}

test('Un compte client ne peut pas ouvrir le Labo : le serveur refuse',async()=>{
 const t=await seeded();
 try{assert.throws(()=>L.snapshot(t.store,t.awa),e=>e.status===403);assert.ok(L.snapshot(t.store,t.chef).ports.length===12);}finally{t.close();}
});

test('Les box du Labo suivent les pannes du simulateur',async()=>{
 const t=await seeded();
 try{
  t.sim('YOP-07','fiber');t.sim('MAR-02','power');t.sim('ABO-01','congestion');
  const s=L.snapshot(t.store,t.chef,{segment:'YOP-07'}),port=id=>s.ports.find(p=>p.id===id);
  const yop=port('YOP-07');assert.equal(yop.online,8);assert.equal(yop.onts.filter(o=>o.status==='los').length,12);assert.equal(yop.tone,'down');
  assert.ok(yop.since,'heure de la panne connue');
  assert.ok(port('MAR-02').dots.every(d=>d==='dying'),'coupure de courant : dernier souffle de toutes les box');
  assert.equal(port('ABO-01').online,20);assert.ok(port('ABO-01').utilisation>=95,'liaison saturée');
  assert.ok(s.console.some(l=>l.code==='LOS'&&l.equipment.includes('Yopougon')),'alarme dans la console');
  // Lumière crédible pour du GPON classe C+ : entre −8 et −30 dBm pour une box en ligne.
  for(const p of s.ports)for(const d of p.flagged)assert.ok(d.rx<-25);
  for(const o of yop.onts.filter(o=>o.rx!==null))assert.ok(o.rx<-8&&o.rx>-30,'lumière '+o.rx);
  t.sim('YOP-07','normal');assert.equal(L.snapshot(t.store,t.chef).ports.find(p=>p.id==='YOP-07').online,20);
 }finally{t.close();}
});

test('Le réflectomètre trouve la coupure, et voit une fibre intacte quand le courant manque',async()=>{
 const t=await seeded();
 try{
  t.sim('YOP-07','fiber');t.sim('MAR-02','power');
  const cut=L.snapshot(t.store,t.chef,{segment:'YOP-07',otdr:true,nm:1310}).otdr;
  assert.equal(cut.fault.kind,'break');assert.ok(cut.fault.km>0&&cut.fault.km<cut.end);assert.match(cut.verdict,/coupée/);
  assert.equal(cut.events.at(-1).kind,'break','rien n’est visible après la coupure');
  const power=L.snapshot(t.store,t.chef,{segment:'MAR-02',otdr:true,nm:1550}).otdr;
  assert.equal(power.fault,null);assert.match(power.verdict,/intacte/);
 }finally{t.close();}
});

test('Les mesures sont stables pour un même instant, historique compris',async()=>{
 const t=await seeded();
 try{const at=Date.now(),a=L.snapshot(t.store,t.chef,{},at),b=L.snapshot(t.store,t.chef,{},at);assert.deepEqual(a.ports,b.ports);assert.equal(a.ports[0].history.length,60);}finally{t.close();}
});
