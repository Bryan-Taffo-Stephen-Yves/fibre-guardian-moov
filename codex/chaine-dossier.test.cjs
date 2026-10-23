'use strict';
// Recommandation de Codex (2026-10-23) : suggestion → demande d'approbation → décision du responsable → mission
// → action → résultat mesuré, dans le MÊME dossier, avec un auteur, une heure et un état à chaque étape.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO}=require('./seed-demo.cjs'),N=require('./noc-store.cjs'),S=require('./superviseur.cjs');

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id;
 const chef=uid(DEMO.admin.email);
 const op=(d)=>{const i=store.get("SELECT id,version FROM noc_incidents WHERE segment_id='YOP-07' AND status NOT IN ('resolved','closed')");return N.operate(store,chef,{id:i.id,version:i.version,...d});};
 N.operate(store,chef,{type:'simulate',segment:'COC-03',scenario:'normal'});
 return {store,chef,awa:uid(DEMO.client.email),op,close:()=>server.close()};
}
function chainSteps(incident,technicians){
 const ctx={window:{},React:{createElement:()=>null}};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'dossier-chain.js'),'utf8'),ctx);
 return JSON.parse(JSON.stringify(ctx.window.FGDossierChain.steps(incident,technicians)));
}

test('Du conseil de Guardian au résultat mesuré : un seul dossier, chaque étape signée et datée',async()=>{
 const t=await seeded();
 try{
  N.operate(t.store,t.chef,{type:'simulate',segment:'YOP-07',scenario:'fiber'});
  let i=N.overview(t.store,t.chef).incidents.find(x=>x.segment_id==='YOP-07'&&!x.terminal);
  assert.equal(i.status,'proposed');
  assert.match(i.ref,/^[0-9A-F]{6}$/,'numéro de dossier court');
  assert.ok(i.plan.team?.id,'Guardian propose une équipe');
  assert.ok(!N.teamView(t.store).find(x=>x.id===i.plan.team.id).busy,'équipe libre');
  // 1. Le Superviseur transmet : la note entre dans le dossier, sans le faire avancer ni prévenir les clients.
  const notes=t.store.get('SELECT COUNT(*) AS n FROM noc_notifications').n;
  const b=S.signal(t.store,t.chef,{key:'panne:YOP-07'});
  assert.equal(b.findings.find(f=>f.key==='panne:YOP-07').ref,i.ref);
  i=N.overview(t.store,t.chef).incidents.find(x=>x.id===i.id);
  const sig=i.events.find(e=>e.kind==='superviseur.signal');
  assert.ok(sig&&sig.actor_name==='Direction technique','la transmission est dans le dossier, avec son auteur');
  assert.equal(i.status,'proposed');
  assert.ok(!N.client(t.store,t.awa).incidents.flatMap(x=>x.events).some(e=>e.kind==='superviseur.signal'),'note interne');
  assert.equal(t.store.get('SELECT COUNT(*) AS n FROM noc_notifications').n,notes);
  // 2. Le responsable demande un complément : rien ne part sur le terrain.
  t.op({type:'complement',note:'Photo du boîtier avant de décider'});
  i=N.overview(t.store,t.chef).incidents.find(x=>x.id===i.id);
  assert.equal(i.status,'rejected');
  assert.equal(JSON.parse(i.events.find(e=>e.kind==='plan.complement').detail).note,'Photo du boîtier avant de décider');
  assert.throws(()=>t.op({type:'dispatch',technician:'koffi',safety:true}),e=>e.status===409,'aucune mission sans accord');
  assert.equal(chainSteps(i,N.teamView(t.store)).find(s=>s.key==='decision').state,'warn');
  // 3. Nouvelle analyse, accord, mission à l'équipe proposée, action, résultat mesuré.
  t.op({type:'analyze'});t.op({type:'approve',note:'Mesures vérifiées'});
  i=N.overview(t.store,t.chef).incidents.find(x=>x.id===i.id);
  t.op({type:'dispatch',technician:i.plan.team.id,safety:true});
  t.op({type:'advance'});t.op({type:'advance'});t.op({type:'advance'});
  N.refreshTelemetry(t.store,{recovery:0});
  t.op({type:'verify'});
  i=N.overview(t.store,t.chef).incidents.find(x=>x.id===i.id);
  assert.equal(i.status,'resolved');
  const kinds=i.events.map(e=>e.kind);
  for(const k of ['detected','plan.proposed','superviseur.signal','plan.complement','plan.approved','dispatched','en_route','on_site','verifying','resolved'])assert.ok(kinds.includes(k),k);
  assert.ok(i.events.every(e=>e.incident_id===i.id),'toutes les étapes dans le même dossier');
  const steps=chainSteps(i,N.teamView(t.store));
  assert.deepEqual(steps.map(s=>s.key),['suggestion','decision','mission','action','resultat']);
  assert.ok(steps.every(s=>s.state==='done'),JSON.stringify(steps.map(s=>s.state)));
  assert.match(steps.find(s=>s.key==='resultat').text,/20 box sur 20 en ligne/,'résultat mesuré, pas déclaré');
  assert.match(steps.find(s=>s.key==='decision').meta,/Direction technique/);
 }finally{t.close();}
});

test('Demander un complément est réservé au responsable',async()=>{
 const t=await seeded();
 try{
  N.operate(t.store,t.chef,{type:'simulate',segment:'YOP-07',scenario:'fiber'});
  const i=t.store.get("SELECT id,version FROM noc_incidents WHERE segment_id='YOP-07' AND status='proposed'");
  assert.throws(()=>N.operate(t.store,t.awa,{type:'complement',id:i.id,version:i.version,note:'test'}),e=>e.status===403);
 }finally{t.close();}
});
