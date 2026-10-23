'use strict';
// Recommandation de Codex (2026-10-23) : une démonstration reproductible et des chiffres propres.
// Le rapport de preuves de la régie ne contient que des durées et des nombres tirés des événements de la scène.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO}=require('./seed-demo.cjs'),J=require('./jury-store.cjs');

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const chef=store.get('SELECT id FROM users WHERE email=?',DEMO.admin.email).id;
 return {store,chef,regie:type=>J.step(store,chef,{type},'http://127.0.0.1'),close:()=>server.close()};
}

test('Rapport de preuves : mêmes étapes, mêmes nombres à chaque scène rejouée',async()=>{
 const t=await seeded();
 try{
  const run=()=>{t.regie('cut');let st=t.regie('send');assert.ok(st.report&&!st.report.verified,'rapport visible pendant la scène');t.regie('arrive');return t.regie('repair').report;};
  t.regie('open');
  const first=run(),second=run();
  for(const r of [first,second]){
   assert.equal(r.verified,true);
   assert.equal(r.offline,12,'box coupées à la détection, mesurées');
   assert.equal(r.total,20);
   assert.equal(r.restored,12,'box rétablies = mesure après − mesure à la détection');
   assert.ok(r.notified>=1,'les clients du quartier ont été prévenus');
   assert.deepEqual(r.rows.map(x=>x.key),['detection','decision','trajet','intervention','total']);
   assert.ok(r.rows.every(x=>x.seconds===null||(Number.isInteger(x.seconds)&&x.seconds>=0)));
   assert.ok(r.rows.find(x=>x.key==='detection').seconds!==null,'détection mesurée depuis la coupure');
   assert.match(r.source,/Événements enregistrés/);
  }
  assert.deepEqual([second.offline,second.restored,second.total],[first.offline,first.restored,first.total],'scène reproductible');
 }finally{t.close();}
});
