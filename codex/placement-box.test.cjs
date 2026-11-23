'use strict';
// « Placer ma box » (placement-box.cjs) : mesurer le signal de chaque appareil à un endroit, déplacer la box,
// mesurer encore, et recommander l'endroit où l'appareil le plus mal servi reçoit le plus.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const PB=require('./placement-box.cjs');
const {createGuardianServer}=require('./pilot-server.cjs');

async function server(){const srv=createGuardianServer({db:':memory:'});await new Promise(r=>srv.listen(0,'127.0.0.1',r));return {srv,base:'http://127.0.0.1:'+srv.address().port};}
async function client(base,email){
 const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'placement-password-123',name:'Client Placement'})});
 const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 return async(p,body)=>{const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
}

test('Signal : plus fort dans la même pièce, plus faible à travers les murs, toujours entre 5 et 97 %',()=>{
 const same=PB.signal('salon','salon','tv'),next=PB.signal('salon','couloir','tv'),far=PB.signal('salon','enfants','tv');
 assert.ok(same>next&&next>far,`${same} > ${next} > ${far}`);
 for(const a of PB.ROOMS)for(const b of PB.ROOMS){const v=PB.signal(a.id,b.id,'x');assert.ok(v>=5&&v<=97);}
 assert.equal(PB.level(80),'tres-bon');assert.equal(PB.level(55),'bon');assert.equal(PB.level(40),'moyen');assert.equal(PB.level(20),'faible');
});

test('Deux endroits qui se valent : pas de faux gagnant ; PC immobile signalé ; répéteur au bon article',()=>{
 const dev=(id,signal,real=false,room='bureau')=>({id,name:id,signal,real,room});
 let a=PB.advice([{spot:'salon',min:20,avg:52,devices:[dev('PC X',20,true),dev('tv',84)]},{spot:'chambre',min:20,avg:51,devices:[dev('PC X',20,true),dev('tv',82)]}]);
 assert.equal(a.tie,true);assert.match(a.title,/Pas de différence nette/);assert.match(a.text,/la box a-t-elle vraiment changé de place/);
 a=PB.advice([{spot:'salon',min:20,avg:40,devices:[dev('ps5',20)]},{spot:'couloir',min:30,avg:60,devices:[dev('ps5',30)]}]);
 assert.match(a.text,/un répéteur Wi-Fi dans le bureau/);assert.doesNotMatch(a.text,/la bureau|la salon|la couloir/);
});

test('Le meilleur endroit sert le mieux l’appareil le plus mal servi, pas seulement la moyenne',()=>{
 const spots=[{spot:'salon',min:30,avg:80,devices:[]},{spot:'couloir',min:60,avg:70,devices:[]}];
 assert.equal(PB.best(spots).spot,'couloir');
});

test('Parcours complet : mesurer au salon, déplacer au couloir, Guardian recommande le couloir',async()=>{
 const {srv,base}=await server();
 try{
  const c=await client(base,'placement@example.test');
  assert.equal((await c('/journey/placement')).status,409,'parcours non démarré');
  await c('/journey/start',{});
  let v=(await c('/journey/placement')).data;
  assert.equal(v.rooms.length,6);assert.equal(v.spots.length,0);assert.equal(v.pc,false);
  assert.equal(v.devices.find(d=>d.id==='tv').room,'salon','la TV est devinée au salon');
  assert.equal(v.devices.find(d=>d.id==='ps5').room,'enfants');
  assert.ok(v.devices.every(d=>d.real===false));
  assert.equal((await c('/journey/placement',{action:'measure',spot:'grenier'})).status,400);
  v=(await c('/journey/placement',{action:'measure',spot:'salon'})).data;
  assert.equal(v.spots.length,1);assert.equal(v.boxAt,'salon');assert.equal(v.best,null,'pas de verdict après une seule mesure');
  assert.match(v.advice.text,/Posez la box dans une autre pièce/);
  const salon=v.spots[0];
  assert.equal(salon.devices.length,4);assert.equal(salon.min,Math.min(...salon.devices.map(d=>d.signal)));
  v=(await c('/journey/placement',{action:'measure',spot:'couloir'})).data;
  assert.equal(v.spots.length,2);assert.equal(v.best,'couloir');
  const couloir=v.spots.find(s=>s.spot==='couloir');
  assert.ok(couloir.min>salon.min,'au couloir, le moins bien servi reçoit plus');
  assert.match(v.advice.title,/Le meilleur endroit : Couloir/);
  assert.match(v.advice.text,/^Posez la box dans le couloir : même « .+ » y reçoit \d+ %, soit \d+ points de plus que dans le salon\./);
  // Re-mesurer au même endroit remplace la mesure, sans en ajouter.
  v=(await c('/journey/placement',{action:'measure',spot:'couloir'})).data;assert.equal(v.spots.length,2);
  // Changer la pièce d'un appareil : la prochaine mesure en tient compte.
  v=(await c('/journey/placement',{action:'room',id:'ps5',room:'salon'})).data;
  assert.equal(v.devices.find(d=>d.id==='ps5').room,'salon');
  assert.equal((await c('/journey/placement',{action:'room',id:'inconnu',room:'salon'})).status,400);
  // Les mots internes de JavaScript ne passent pas pour des pièces ou des appareils.
  for(const spot of ['valueOf','toString','constructor','__proto__'])assert.equal((await c('/journey/placement',{action:'measure',spot})).status,400,spot);
  assert.equal((await c('/journey/placement',{action:'room',id:'ps5',room:'constructor'})).status,400);
  assert.equal((await c('/journey/placement',{action:'room',id:'hasOwnProperty',room:'salon'})).status,400);
  // 4 endroits au plus.
  await c('/journey/placement',{action:'measure',spot:'bureau'});await c('/journey/placement',{action:'measure',spot:'cuisine'});
  assert.equal((await c('/journey/placement',{action:'measure',spot:'chambre'})).status,400);
  v=(await c('/journey/placement',{action:'reset'})).data;assert.equal(v.spots.length,0);assert.equal(v.boxAt,null);
 }finally{srv.close();}
});

test('Interface : la carte est dans Appareils, sans mot technique, et « À propos » dit ce qui est calculé',()=>{
 const view=fs.readFileSync(path.join(__dirname,'placement-view.js'),'utf8'),devices=fs.readFileSync(path.join(__dirname,'device-usage-view.js'),'utf8');
 const demo=fs.readFileSync(path.join(__dirname,'demo.js'),'utf8'),boot=fs.readFileSync(path.join(__dirname,'bootstrap.js'),'utf8');
 assert.match(devices,/FGPlacementBox\.Card/);assert.match(boot,/'placement-view\.js'/);
 assert.doesNotMatch(view,/simul|fictif|TR-069|RSSI|dBm/i);
 assert.match(demo,/\['Placer ma box','Le signal Wi-Fi du PC Windows branché/);
 assert.doesNotMatch(view,/#[0-9a-f]{3,6}\b/i,'aucune couleur codée en dur');
});
