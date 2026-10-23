'use strict';
// Recommandation de Codex (2026-10-23), « le moment waouh » : la réparation principale est faite mais des foyers
// restent coupés. Guardian refuse de déclarer le quartier rétabli, avec les nombres mesurés, et propose un contrôle ciblé.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO}=require('./seed-demo.cjs'),N=require('./noc-store.cjs'),S=require('./superviseur.cjs'),J=require('./jury-store.cjs');

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id;
 return {store,chef:uid(DEMO.admin.email),awa:uid(DEMO.client.email),regie:type=>J.step(store,uid(DEMO.admin.email),{type},'http://127.0.0.1'),close:()=>server.close()};
}

test('Réparation partielle depuis la régie : Guardian refuse la clôture, puis le contrôle ciblé rétablit tout',async()=>{
 const t=await seeded();
 try{
  t.regie('open');t.regie('cut');t.regie('send');t.regie('arrive');
  let st=t.regie('partial');
  assert.equal(st.scene.status,'verifying');
  assert.equal(st.scene.hold.remaining,4,'nombre mesuré');
  assert.equal(st.next,'repair');
  const seg=t.store.get("SELECT online,total FROM noc_segments WHERE id='YOP-07'");
  assert.deepEqual({...seg},{online:16,total:20});
  let i=N.overview(t.store,t.chef).incidents.find(x=>x.id===st.scene.id);
  const hold=i.events.find(e=>e.kind==='guardian.hold');
  assert.match(hold.public_text,/mais 4 foyers restent hors ligne sur une branche secondaire/);
  // La chaîne du dossier montre le refus au lieu d'un résultat « en attente ».
  const ctx={window:{},React:{createElement:()=>null}};require('node:vm').createContext(ctx);
  require('node:vm').runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'dossier-chain.js'),'utf8'),ctx);
  const result=ctx.window.FGDossierChain.steps(i,N.teamView(t.store)).find(s=>s.key==='resultat');
  assert.equal(result.state,'warn');assert.match(result.text,/4 foyers sur 20 encore hors ligne/);
  // La clôture est refusée avec les nombres du scénario.
  assert.throws(()=>N.operate(t.store,t.chef,{type:'verify',id:i.id,version:i.version}),e=>e.status===409&&/Guardian refuse la clôture : 4 foyers sur 20 restent hors ligne/.test(e.message));
  // Le Superviseur met ce refus en tête, le client est prévenu sans fausse bonne nouvelle.
  const f=S.bilan(t.store,t.chef).findings[0];
  assert.equal(f.key,'partielle:'+i.id);assert.equal(f.level,'critique');
  const mine=N.client(t.store,t.awa).incidents.find(x=>x.id===i.id);
  assert.equal(mine.partial.remaining,4);
  assert.ok(!mine.events.some(e=>e.kind==='resolved'));
  const j=require('./journey-store.cjs'),st0=j.get(t.store,t.awa);j.act(t.store,t.awa,{type:'chat',text:'Internet est coupé chez moi',version:st0.version});
  assert.match(j.get(t.store,t.awa).messages.at(-1).text,/La réparation principale est faite dans votre quartier, mais 4 foyers sont encore coupés/,'Guardian du client dit la vérité');
  // Pas de double injection.
  assert.throws(()=>t.regie('partial'),e=>e.status===409);
  // Étape 4 : contrôle ciblé (nouvelle consigne au technicien), nouvelle réparation, mesures complètes, clôture.
  st=t.regie('repair');
  assert.equal(st.scene.status,'resolved');
  i=N.overview(t.store,t.chef).incidents.find(x=>x.id===st.scene.id);
  const kinds=i.events.map(e=>e.kind);
  assert.ok(kinds.indexOf('guardian.hold')<kinds.indexOf('followup')&&kinds.indexOf('followup')<kinds.lastIndexOf('verifying')&&kinds.lastIndexOf('verifying')<kinds.indexOf('resolved'));
  assert.ok(t.store.get("SELECT body FROM noc_checklist WHERE case_key=? AND body LIKE 'Contrôle ciblé%'",'incident:'+i.id),'consigne de contrôle ciblé');
  assert.equal(JSON.parse(i.events.find(e=>e.kind==='resolved').detail).online,20);
  assert.equal(i.hold,null);
 }finally{t.close();}
});

test('Sans réparation déclarée, la variante partielle est refusée ; seul un responsable lance le contrôle ciblé',async()=>{
 const t=await seeded();
 try{
  N.operate(t.store,t.chef,{type:'simulate',segment:'MAR-02',scenario:'fiber'});
  assert.throws(()=>N.operate(t.store,t.chef,{type:'simulate',segment:'MAR-02',scenario:'partial'}),e=>e.status===409);
  t.regie('open');t.regie('cut');t.regie('send');t.regie('arrive');t.regie('partial');
  const i=N.overview(t.store,t.chef).incidents.find(x=>x.hold);
  assert.throws(()=>N.operate(t.store,t.awa,{type:'followup',id:i.id,version:i.version}),e=>e.status===403);
 }finally{t.close();}
});
