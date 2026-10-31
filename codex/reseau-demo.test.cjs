'use strict';
// Réseau de démo : le partage de connexion de l'équipe joue la box du quartier. Une panne (fibre ou courant) est jouée
// sur la copie de ce Wi-Fi ; les téléphones inscrits par QR code ne sont prévenus qu'après la validation d'un responsable.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs'),O=require('./operator-store.cjs');

async function setup(){
 const server=createGuardianServer({db:':memory:',onError:()=>{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port,store=server.guardianStore;
 const cookies=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 async function call(who,p,body){const r=await fetch(base+'/api'+p,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:who?.cookie||'','X-CSRF-Token':who?.csrf||''},body:body?JSON.stringify(body):undefined});const data=await r.json();if(r.ok&&data.user?.csrf&&who&&r.headers.getSetCookie().length){who.cookie=cookies(r);who.csrf=data.user.csrf;}return {status:r.status,data};}
 async function account(email,kind='register'){const r=await fetch(base+'/api/auth/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'reseau-password-1234',name:'Compte '+email})});const d=await r.json();return {id:d.user.id,csrf:d.user.csrf,cookie:cookies(r)};}
 async function juror(code,extra={}){const r=await fetch(base+'/api/jury/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,consent:true,...extra})});const d=await r.json();return {status:r.status,data:d,id:d.user?.id,csrf:d.user?.csrf,cookie:cookies(r)};}
 const page=async(p,token,body)=>{const r=await fetch(base+'/api/test/'+p,{method:body?'POST':'GET',headers:{'X-Test-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 await account('regie@example.test');O.grant(store,'regie@example.test','admin');const admin=await account('regie@example.test','login');
 return {server,store,base,call,account,juror,page,admin};
}
const regie=(t,body)=>t.call(t.admin,'/regie',body);

test('Réseau de démo : prénom à l’inscription, rien avant la validation, puis tous les inscrits sont prévenus',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'  MOOV-FIBRE-DEMO '})).data.room;
  assert.equal(room.network,'MOOV-FIBRE-DEMO','nom du réseau nettoyé');
  // Prénom facultatif : des lettres seulement (accents, tiret, apostrophe), jamais de chiffres.
  for(const bad of ['Awa2','0707070707','A'.repeat(31),'<b>Awa</b>',42])assert.equal((await t.juror(room.code,{firstName:bad})).status,400,'refusé : '+bad);
  const awa=await t.juror(room.code,{firstName:'  Awa  '}),yao=await t.juror(room.code,{firstName:'Jean-Marc N’Guessan'}),anon=await t.juror(room.code);
  assert.equal(awa.data.user.name,'Awa');assert.equal(yao.data.user.name,'Jean-Marc N’Guessan');assert.equal(anon.data.user.name,'Membre du jury 3');
  assert.equal(O.role(t.store,awa.id),'subscriber','aucun rôle opérateur');
  let me=(await t.call(awa,'/jury/me')).data;assert.equal(me.first,'Awa');assert.equal(me.network,'MOOV-FIBRE-DEMO');assert.equal(me.scene,null);
  let r=(await regie(t)).data;
  assert.deepEqual(r.members.map(m=>m.name),['Awa','Jean-Marc N’Guessan',null],'le grand écran montre les prénoms, rien d’autre');
  assert.ok(r.members.every(m=>Object.keys(m).sort().join()==='delivered,name,number,seen'),'ni adresse e-mail ni identifiant sur le grand écran');
  assert.equal(r.network.ssid,'MOOV-FIBRE-DEMO');assert.equal(r.network.copy,null,'pas encore de copie');
  // Panne : Guardian la repère et propose un plan, mais les inscrits ne voient encore rien.
  r=(await regie(t,{type:'cut',fault:'fiber'})).data;assert.equal(r.scene.status,'proposed');assert.equal(r.next,'validate');assert.equal(r.scene.cause,'FIBER_CUT_DISTRIBUTION');
  me=(await t.call(awa,'/jury/me')).data;assert.equal(me.scene,null,'pas d’alerte avant la validation');assert.equal(me.segment,null,'pas de chiffres non plus');
  assert.equal(r.report.alert.delivered,0);
  const early=await regie(t,{type:'send'});assert.equal(early.status,409,'pas de technicien avant la validation');assert.match(early.data.error,/responsable/);
  assert.equal(t.store.get("SELECT count(*) AS n FROM jury_alerts").n,0);
  // Un responsable valide : à cet instant les téléphones inscrits reçoivent l'alerte, avec l'heure de retour.
  r=(await regie(t,{type:'validate'})).data;assert.equal(r.scene.status,'approved');assert.equal(r.next,'send');
  const approval=t.store.get("SELECT actor,detail FROM noc_events WHERE kind='plan.approved'");
  assert.equal(approval.actor,t.admin.id,'validation tracée au nom du responsable connecté');assert.match(JSON.parse(approval.detail).note,/MOOV-FIBRE-DEMO/);
  me=(await t.call(awa,'/jury/me')).data;assert.equal(me.scene.status,'approved');assert.ok(me.segment.online<me.segment.total);assert.match(me.scene.restore.label,/^\d{2} h \d{2}$/,'heure de retour promise');
  await t.call(yao,'/jury/me');
  assert.equal((await t.call(awa,'/jury/seen',{id:'autre'})).status,404);
  assert.equal((await t.call(anon,'/jury/seen',{id:me.scene.id})).status,404,'alerte pas encore affichée sur ce téléphone');
  assert.equal((await t.call(awa,'/jury/seen',{id:me.scene.id})).status,200);
  r=(await regie(t)).data;
  assert.deepEqual(r.members.map(m=>[m.name,!!m.delivered,!!m.seen]),[['Awa',true,true],['Jean-Marc N’Guessan',true,false],[null,false,false]]);
  assert.equal(r.report.alert.members,3);assert.equal(r.report.alert.delivered,2);assert.equal(r.report.alert.seen,1);assert.ok(r.report.alert.seconds>=0);
  assert.equal((await t.call(awa,'/noc/notifications')).data.unreadCount,0,'alerte vue = notifications lues');
  // Un inscrit appelle quand même : le serveur vocal lui dit ce que Moov sait ; il raccroche rassuré. Appels évités comptés.
  const ivr=(await t.call(yao,'/noc/call',{type:'start'})).data;assert.equal(ivr.known,true);assert.equal(ivr.incident,me.scene.id);
  await t.call(yao,'/noc/call',{type:'end',outcome:'reassured',incident:ivr.incident});
  const asked=(await t.call(awa,'/noc/call',{type:'start'})).data;await t.call(awa,'/noc/call',{type:'end',outcome:'called',incident:asked.incident});
  r=(await regie(t)).data;assert.equal(r.report.alert.called,1);assert.equal(r.report.alert.reassured,1);assert.equal(r.report.alert.avoided,1);
  // Suite habituelle : technicien, arrivée, réparation vérifiée, certificat.
  r=(await regie(t,{type:'send'})).data;assert.equal(r.scene.status,'en_route');
  r=(await regie(t,{type:'arrive'})).data;assert.equal(r.scene.status,'on_site');
  r=(await regie(t,{type:'repair'})).data;assert.equal(r.scene.status,'resolved');assert.equal(r.next,'cut');
  me=(await t.call(anon,'/jury/me')).data;assert.ok(me.scene.certificate,'certificat aussi pour qui n’avait pas encore ouvert la page');
  assert.equal((await regie(t,{type:'validate'})).status,409,'rien à valider');
 }finally{t.server.close();}
});

test('Coupure de courant : validation, pas de technicien, le courant revient et tout repasse au vert',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code,{firstName:'Aya'});
  let r=(await regie(t,{type:'cut',fault:'power'})).data;assert.equal(r.scene.cause,'POWER_OUTAGE');assert.equal(r.next,'validate');assert.equal(r.scene.dispatch,false);
  assert.equal((await t.call(j,'/jury/me')).data.scene,null);
  r=(await regie(t,{type:'validate'})).data;assert.equal(r.scene.status,'approved');assert.equal(r.next,'repair','pas de technicien à envoyer');
  const send=await regie(t,{type:'send'});assert.equal(send.status,409);assert.match(send.data.error,/courant/);
  let me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene.cause,'POWER_OUTAGE');assert.equal(me.segment.online,0);assert.equal(me.scene.restore.power,true,'aucune heure promise pour le courant');
  r=(await regie(t,{type:'repair'})).data;assert.equal(r.scene.status,'resolved');
  me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene.status,'resolved');assert.equal(me.segment.online,me.segment.total);assert.ok(me.scene.certificate);
  assert.equal(t.store.get("SELECT actor FROM noc_events WHERE kind='resolved' AND incident_id=?",me.scene.id).actor,t.admin.id);
 }finally{t.server.close();}
});

test('Refus d’un responsable : les inscrits ne reçoivent jamais l’alerte',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code);
  const r=(await regie(t,{type:'cut',fault:'fiber'})).data,i=t.store.get('SELECT id,version FROM noc_incidents WHERE id=?',r.scene.id);
  assert.equal((await t.call(t.admin,'/noc/action',{type:'reject',id:i.id,version:i.version,note:'Fausse alerte : capteur en maintenance.'})).status,200);
  assert.equal((await t.call(j,'/jury/me')).data.scene,null,'fausse alerte : rien sur le téléphone');
  assert.equal(t.store.get('SELECT count(*) AS n FROM jury_alerts').n,0);
  // La régie peut rejouer une nouvelle panne : le dossier refusé est clôturé sans déplacement.
  const again=(await regie(t)).data;assert.equal(again.next,'cut');
  const replay=await regie(t,{type:'cut',fault:'power'});assert.equal(replay.status,200);assert.equal(replay.data.scene.cause,'POWER_OUTAGE');assert.notEqual(replay.data.scene.id,i.id);
  assert.equal(t.store.get('SELECT status FROM noc_incidents WHERE id=?',i.id).status,'closed');
 }finally{t.server.close();}
});

test('Copie du réseau de démo : faite depuis la régie, la panne s’y joue, le vrai Wi-Fi n’est pas touché, elle survit à la remise à zéro',async()=>{
 const t=await setup();
 try{
  await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'});
  // La régie demande un lien de test pour son propre compte ; l'appareil branché sur le partage de connexion fait la copie.
  const link=(await t.call(t.admin,'/test/link',{})).data;assert.match(link.url,/\/codex\/test\.html#/);
  const token=link.token,started=await t.page('copy',token,{new:true,network:'hotspot',metrics:{downloadMbps:31.4,latencyMs:42},points:[{t:500,rtt:40,mbps:30},{t:1500,rtt:44,mbps:32}]});
  assert.equal(started.status,201);
  let r=(await regie(t)).data;
  assert.equal(r.network.copy.id,started.data.copy.id);assert.equal(r.network.copy.downloadMbps,31.4);assert.match(r.network.copy.network,/^Partage de connexion/);
  assert.deepEqual(r.network.copy.devices.map(d=>[d.label,d.state]),[['Box Wi-Fi','box'],['Appareil du test','ok']],'sans PC : la box et l’appareil du test');
  assert.equal(r.network.twin,null);
  // La fibre coupe : la copie montre la box au voyant rouge et l'appareil sans Internet.
  r=(await regie(t,{type:'cut',fault:'fiber'})).data;
  assert.equal(r.network.twin.fault,'fiber');assert.deepEqual(r.network.twin.devices.map(d=>d.state),['box-los','sans-internet']);
  assert.match(r.network.twin.note,/partage de connexion/);
  const stored=t.store.get('SELECT data FROM wifi_copies WHERE id=?',started.data.copy.id).data;assert.equal(JSON.parse(stored).metrics.downloadMbps,31.4,'la copie elle-même ne change pas');
  // La copie d'un autre client, d'un autre réseau, n'est jamais prise.
  const other=await t.account('client@example.test'),otherLink=(await t.call(other,'/test/link',{})).data;
  await t.page('copy',otherLink.token,{new:true,network:'wifi',metrics:{downloadMbps:90},points:[{t:500,rtt:10,mbps:90}]});
  assert.equal((await regie(t)).data.network.copy.id,started.data.copy.id);
  // Remise à zéro : le réseau et sa copie restent, la scène repart de zéro.
  const reset=await regie(t,{type:'reset',confirm:true});assert.equal(reset.status,200);
  assert.equal(reset.data.room.network,'MOOV-FIBRE-DEMO');assert.equal(reset.data.network.copy.id,started.data.copy.id);assert.equal(reset.data.scene,null);assert.equal(reset.data.next,'cut');
 }finally{t.server.close();}
});

test('Salle classique : sans nom de réseau, la scène d’origine est inchangée et le nom de réseau est contrôlé',async()=>{
 const t=await setup();
 try{
  assert.equal((await regie(t,{type:'open',ssid:'X'.repeat(33)})).status,400,'32 caractères au plus, comme un vrai nom de Wi-Fi');
  const room=(await regie(t,{type:'open'})).data.room;assert.equal(room.network,null);
  const j=await t.juror(room.code);
  assert.equal((await regie(t,{type:'cut',fault:'power'})).data.scene.cause,'FIBER_CUT_DISTRIBUTION','salle classique : la coupure fibre habituelle');
  assert.equal((await t.call(j,'/jury/me')).data.scene.status,'proposed','salle classique : alerte dès la détection');
  assert.equal((await regie(t,{type:'validate'})).status,409);
  assert.equal((await regie(t,{type:'send'})).data.scene.status,'en_route');
  for(const who of [j,await t.account('abonne@example.test')])assert.equal((await t.call(who,'/regie',{type:'validate'})).status,403);
 }finally{t.server.close();}
});
