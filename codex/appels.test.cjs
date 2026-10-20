'use strict';
// « Le client n'appelle plus » : heure de retour tenue, serveur vocal qui sait déjà, compteur d'appels évités.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {Store}=require('./pilot-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const {seedDemo,DEMO,NEIGHBOURS}=require('./seed-demo.cjs'),N=require('./noc-store.cjs'),A=require('./appels.cjs'),W=require('./noc-workspace.cjs');
const MIN=60000;

async function seeded(){
 const store=new Store(':memory:'),server=createGuardianServer({store});
 const saved=process.env[DEMO.admin.env];process.env[DEMO.admin.env]='direction-test-2026';
 try{await seedDemo(store);}finally{if(saved===undefined)delete process.env[DEMO.admin.env];else process.env[DEMO.admin.env]=saved;}
 const uid=email=>store.get('SELECT id FROM users WHERE email=?',email).id,chef=uid(DEMO.admin.email);
 const rose=uid(NEIGHBOURS.find(n=>n.segment==='BAS-01').email),awa=uid(DEMO.client.email);
 const op=(d,id)=>{const i=id&&N.overview(store,chef).incidents.find(x=>x.id===id);return N.operate(store,chef,{...d,...(i?{id,version:i.version}:{})});};
 return {store,server,chef,rose,awa,op,close:()=>server.close()};
}
const open=(t,uid)=>N.client(t.store,uid).incidents.find(i=>!i.terminal&&i.mode==='demo');

test('Heure de retour : rien avant la validation, puis une heure ronde qui ne bouge pas tant que tout va bien',()=>{
 const t0=Date.parse('2026-10-28T19:00:00Z'),i={id:'x',mode:'demo',status:'proposed',created:t0,plan:{cause:'FIBER_CUT_DISTRIBUTION',dispatch:true}};
 assert.deepEqual(A.estimate(i,[],t0+MIN),{pending:true},'pas de promesse avant la décision');
 const approved={...i,status:'approved'},ev=[{kind:'plan.approved',at:t0+2*MIN}];
 const a=A.estimate(approved,ev,t0+2*MIN).at,b=A.estimate(approved,ev,t0+3*MIN).at;
 assert.equal(a,b,'même heure une minute plus tard');
 assert.equal(a,t0+2*MIN+A.STEP.dispatch+A.STEP.dispatch+A.STEP.travel+A.STEP.repair+A.STEP.check);
 assert.ok(A.estimate(approved,ev,t0+30*MIN).at>a,'une étape en retard repousse l’heure');
 assert.deepEqual(A.estimate({...i,plan:{cause:'POWER_OUTAGE'}},[],t0),{power:true},'coupure de courant : pas d’heure inventée');
 assert.equal(A.estimate({...approved,status:'resolved'},ev,t0),null);
 assert.equal(A.clock(Date.parse('2026-10-28T19:45:00Z')),'19 h 45','heure d’Abidjan');
});

test('Le client voit l’heure promise ; si elle glisse, il est prévenu une fois, sans relance en boucle',async()=>{
 const t=await seeded();
 try{
  N.operate(t.store,t.chef,{type:'simulate',segment:'BAS-01',scenario:'fiber'});
  let i=open(t,t.rose);assert.equal(i.restore.pending,true);
  t.op({type:'approve',note:'Plan conforme.'},i.id);
  i=open(t,t.rose);assert.match(i.restore.label,/^\d\d h \d\d$/);assert.equal(i.restore.late,false);
  const before=N.notifications(t.store,t.rose).unreadCount,later=Date.now()+40*MIN;
  A.tick(t.store,later);
  const after=N.notifications(t.store,t.rose);assert.equal(after.unreadCount,before+1,'un seul message de retard');
  assert.match(after.items[0].body,/^Petit retard : votre internet devrait revenir vers \d\d h \d\d\./);
  assert.match(after.items[0].body,/Vous n’avez pas à vous inquiéter\.$/);
  A.tick(t.store,later+MIN);assert.equal(N.notifications(t.store,t.rose).unreadCount,before+1,'pas de relance une minute après');
  assert.equal(N.notifications(t.store,t.awa).items.some(n=>/Petit retard/.test(n.body)),false,'les autres quartiers ne reçoivent rien');
 }finally{t.close();}
});

test('Serveur vocal : il dit ce que Moov sait du quartier ; sans panne, il propose Guardian',async()=>{
 const t=await seeded();
 try{
  const calm=A.call(t.store,t.rose,{type:'start'});assert.equal(calm.known,false);assert.deepEqual(calm.choices,['guardian','called']);
  N.operate(t.store,t.chef,{type:'simulate',segment:'BAS-01',scenario:'fiber'});
  const v=A.call(t.store,t.rose,{type:'start'});
  assert.equal(v.known,true);assert.match(v.lines[0],/^Bonjour Rose, ici Moov\.$/);
  assert.ok(v.lines.some(l=>/Nous savons déjà qu’internet est coupé dans votre quartier \(Quartier France, Grand-Bassam\)/.test(l)));
  assert.ok(v.lines.some(l=>/Vous n’avez pas à vous inquiéter/.test(l)));
  assert.throws(()=>A.call(t.store,t.rose,{type:'end',outcome:'pirater'}),/Choix inconnu/);
  assert.deepEqual(A.call(t.store,t.rose,{type:'end',outcome:'reassured',incident:v.incident}),{ok:true,outcome:'reassured'});
 }finally{t.close();}
});

test('Compteur Moov : prévenus, appels quand même, appels évités ; réservé à l’équipe',async()=>{
 const t=await seeded();
 try{
  N.operate(t.store,t.chef,{type:'simulate',segment:'BAS-01',scenario:'fiber'});
  const id=open(t,t.rose).id;
  let row=A.stats(t.store).rows.find(r=>r.id===id);
  assert.equal(row.informed,1,'Rose, seule cliente du quartier, est prévenue');assert.equal(row.called,0);assert.equal(row.avoided,1);
  A.call(t.store,t.rose,{type:'end',outcome:'called',incident:id});
  row=A.stats(t.store).rows.find(r=>r.id===id);assert.equal(row.called,1);assert.equal(row.avoided,0,'un client qui appelle quand même n’est pas compté comme évité');
  assert.ok(W.overview(t.store,t.chef).calls.informed>=1,'le tableau de bord Moov reçoit le compteur');
  assert.throws(()=>W.overview(t.store,t.rose),/réservé|habilité/i,'un client ne voit pas le compteur');
 }finally{t.close();}
});

test('Interface : bouton du serveur vocal côté client, carte du compteur côté Moov, couleurs de marque',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
 assert.match(read('pilot-server.cjs'),/\/api\/noc\/call/);
 assert.match(read('bootstrap.js'),/'appel-view\.js'/);assert.match(read('index.html'),/appel\.css/);
 assert.doesNotMatch(read('appel.css'),/#[0-9a-f]{3,8}\b|rgba?\(/i);
 assert.doesNotMatch(read('appel-view.js'),/simul|fictif/i);
 new (require('node:vm').Script)(read('appel-view.js'),{filename:'appel-view.js'}); // le fichier se charge sans erreur de syntaxe
 assert.match(read('noc-command-view.js'),/'calls','Appels évités'/);
 assert.match(read('demo.js'),/Serveur vocal/);
});
