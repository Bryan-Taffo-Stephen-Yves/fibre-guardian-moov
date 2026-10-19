'use strict';
// « Guardian voit venir la panne » : la lumière de la fibre baisse, Guardian prévoit la coupure et propose un passage avant.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const F=require('./forecast.cjs'),N=require('./noc-store.cjs'),{createGuardianServer}=require('./pilot-server.cjs');
const DAY=F.DAY;

async function client(){
 const server=createGuardianServer({db:':memory:',onError:()=>{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'lumiere@example.test',password:'lumiere-password-123',name:'Test Lumière'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const request=async(p,body)=>{const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 let state=(await request('/journey/start',{})).data.state;
 const action=async data=>{const r=await request('/journey/action',{version:state.version,...data});if(r.status===200)state=r.data.state;return r;};
 return {server,user,action,get state(){return state;}};
}

test('Ligne saine : mesures stables, aucune alerte ni rendez-vous',()=>{
 const f=F.forecast({now:Date.UTC(2026,9,19,9)});
 assert.equal(f.points.length,10);assert.equal(f.state,'healthy');assert.equal(f.cutAt,null);assert.deepEqual(f.slots,[]);
 assert.ok(Math.abs(f.slope)<.1,'pas de tendance sur une ligne saine');
 assert.ok(f.points.every(p=>p.dbm>F.WARN));
});

test('Lumière qui baisse : pente mesurée, coupure estimée dans quelques jours, rejouable à l’identique',()=>{
 const now=Date.UTC(2026,9,19,9),f=F.forecast({fadingSince:now,now,technician:{name:'Koffi'}});
 assert.equal(f.state,'fading');assert.ok(f.slope<-.6&&f.slope>-1.1,'environ −0,85 dB par jour');
 assert.ok(f.current<=F.WARN&&f.current>F.CUT,'sous le seuil d’alerte, pas encore coupée');
 assert.ok(f.daysLeft>1&&f.daysLeft<5);assert.ok(f.cutAt>now);
 assert.deepEqual(F.forecast({fadingSince:now,now}).points,f.points,'même historique à chaque démonstration');
 assert.equal(f.technician.name,'Koffi');
});

test('Créneaux : jours ouvrés, 10 h ou 15 h, tous avant la coupure ; urgence si la coupure est imminente',()=>{
 const now=Date.UTC(2026,9,17,9),cut=now+4*DAY,s=F.slots(now,cut);// samedi 17 octobre
 assert.ok(s.length>=1&&s.length<=3);
 for(const v of s){const d=new Date(v.at);assert.notEqual(d.getDay(),0,'pas le dimanche');assert.ok([10,15].includes(d.getHours()));assert.ok(v.at<cut-12*3600000&&v.at>now);}
 const urgent=F.slots(now,now+3600000);assert.equal(urgent.length,1);assert.notEqual(new Date(urgent[0].at).getDay(),0);
});

test('Le client choisit le passage ; refusé hors baisse de lumière ou sur un moment inconnu',async()=>{
 const c=await client();
 try{
  assert.equal(c.state.optical.state,'healthy');
  assert.equal((await c.action({type:'prevention',slot:'slot-1'})).status,409,'pas de visite sur une ligne saine');
  await c.action({type:'scenario',value:'fading'});
  const f=c.state.optical;assert.equal(f.state,'fading');assert.ok(f.slots.length>=1);assert.equal(c.state.prevention,null);
  assert.ok(c.state.notifications.some(n=>n.title==='Guardian a vu venir une panne'));
  assert.equal(f.technician.name.split(' ')[0],'Koffi','technicien de Yopougon');
  assert.equal((await c.action({type:'prevention',slot:'slot-0'})).status,409,'moment inventé refusé');
  const r=await c.action({type:'prevention',slot:f.slots.at(-1).id});assert.equal(r.status,200);
  assert.equal(c.state.prevention.slot,f.slots.at(-1).at);
  assert.ok(c.state.notifications.some(n=>n.title==='Passage du technicien confirmé'&&/pas coupé/.test(n.body)));
  await c.action({type:'chat',text:'Pourquoi un technicien vient chez moi ?'});
  assert.match(c.state.messages.at(-1).text,/lumière/);
  // L'équipe Moov voit la ligne à risque et le rendez-vous pris.
  const rows=N.forecasts(c.server.guardianStore);assert.equal(rows.length,1);
  assert.equal(rows[0].segment,'YOP-07');assert.equal(rows[0].prevention.slot,c.state.prevention.slot);assert.ok(rows[0].daysLeft>0);
  await c.action({type:'scenario',value:'normal'});assert.equal(c.state.prevention,null,'retour à la normale : plus de rendez-vous');
  assert.equal(N.forecasts(c.server.guardianStore).length,0);
 }finally{c.server.close();}
});

test('Coupure de courant : le client sait que ce n’est pas une panne Moov',async()=>{
 const server=createGuardianServer({db:':memory:',onError:()=>{}}),store=server.guardianStore;
 try{
  const u=(await store.register({email:'courant@example.test',password:'courant-password-1234',name:'Courant'})).user;
  N.join(store,u.id,{segment:'YOP-07',consent:true});
  store.run("UPDATE noc_segments SET online=0,alarm='DYING_GASP',sample_at=? WHERE id='YOP-07'",Date.now());N.scan(store);
  const i=N.client(store,u.id).incidents.find(v=>v.segment==='YOP-07'&&!v.terminal);
  assert.ok(i);assert.equal(i.cause,'POWER_OUTAGE');
 }finally{server.close();}
});

test('Les écrans sont chargés, en couleurs de marque, sans avertissement technique',()=>{
 const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
 assert.match(read('bootstrap.js'),/'abidjan-map\.js', 'forecast-view\.js'/);
 assert.match(read('index.html'),/forecast\.css/);
 assert.doesNotMatch(read('forecast.css'),/#[0-9a-f]{3,8}\b|rgba?\(/i);
 for(const f of ['forecast-view.js','forecast.cjs'])assert.doesNotMatch(read(f),/simul|fictif/i);
 assert.match(read('demo.js'),/La fibre faiblit/,'la page « À propos » dit honnêtement ce qui est simulé');
});
