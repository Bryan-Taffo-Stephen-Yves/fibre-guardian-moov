'use strict';
// Réseau de démo : le partage de connexion de l'équipe joue la box du quartier. Une panne (fibre coupée, vol de câble, chantier,
// courant coupé ou réseau saturé) est jouée sur la copie de ce Wi-Fi ; les téléphones inscrits par QR code ne sont prévenus
// qu'après la validation d'un responsable.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs'),O=require('./operator-store.cjs'),F=require('./sim-flow.js');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
// Les mots de la page du jury et de la régie (jury.js), chargés sans navigateur.
function view(){const ctx={window:{},React:{createElement(){}},document:{addEventListener(){}},navigator:{},location:{search:''},URLSearchParams};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'jury.js'),'utf8'),ctx);
 // Résultats recopiés hors du bac à sable : les comparaisons d'assert portent sur les valeurs.
 const J=ctx.window.FGJury,out={};for(const k of ['lookOf','guardianSays','stagesOf','certOf','stepsFor','toastOf'])out[k]=(...a)=>JSON.parse(JSON.stringify(J[k](...a)));return out;}

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
  for(const bad of ['Awa2','0707070707','A'.repeat(31),'<b>Awa</b>',42,'\u3164','\u3164\u3164\u3164','\u115F\u1160','A'+'\u0301'.repeat(29),'A\uFE0F\uFE0F\uFE0F','A\u202EB','Awa\u200B'])assert.equal((await t.juror(room.code,{firstName:bad})).status,400,'refusé : '+JSON.stringify(bad));
  assert.equal(t.store.get('SELECT count(*) AS n FROM jury_members').n,0,'aucune inscription refusée n’a laissé de trace');
  const awa=await t.juror(room.code,{firstName:'  Awa  '}),yao=await t.juror(room.code,{firstName:'Jean-Marc N’Guessan'}),anon=await t.juror(room.code);
  assert.equal(awa.data.user.name,'Awa');assert.equal(yao.data.user.name,'Jean-Marc N’Guessan');assert.equal(anon.data.user.name,'Membre du jury 3');
  assert.equal(O.role(t.store,awa.id),'subscriber','aucun rôle opérateur');
  let me=(await t.call(awa,'/jury/me')).data;assert.equal(me.first,'Awa');assert.equal(me.network,'MOOV-FIBRE-DEMO');assert.equal(me.scene,null);
  let r=(await regie(t)).data;
  assert.deepEqual(r.members.map(m=>m.name),['Awa','Jean-Marc N’Guessan',null],'le grand écran montre les prénoms, rien d’autre');
  // « whatsapp » dit seulement si la personne a donné un numéro (vrai ou faux), jamais lequel.
  assert.ok(r.members.every(m=>Object.keys(m).sort().join()==='delivered,name,number,seen,whatsapp'&&m.whatsapp===false),'ni adresse e-mail ni identifiant sur le grand écran');
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
  const partial=await regie(t,{type:'partial'});assert.equal(partial.status,409);assert.match(partial.data.error,/courant/,'pas de réparation partielle pour une coupure de courant');
  r=(await regie(t,{type:'repair'})).data;assert.equal(r.scene.status,'resolved');
  me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene.status,'resolved');assert.equal(me.segment.online,me.segment.total);assert.equal(me.scene.certificate.cause,'POWER_OUTAGE');assert.equal(me.scene.certificate.technician,null);
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
  // La copie d'un client n'est jamais prise, même si son Wi-Fi porte le nom du réseau de démo (vie privée, et personne ne peut la remplacer).
  const other=await t.account('client@example.test'),otherLink=(await t.call(other,'/test/link',{})).data;
  const intruder=await t.page('copy',otherLink.token,{new:true,network:'wifi',typed:'moov-fibre-demo',metrics:{downloadMbps:90},points:[{t:500,rtt:10,mbps:90}]});
  assert.equal(intruder.status,201);
  // Un test fait ensuite en données mobiles depuis la régie n'est pas le réseau de démo non plus.
  await t.page('copy',token,{new:true,network:'cellular',metrics:{downloadMbps:12},points:[{t:500,rtt:80,mbps:12}]});
  const view=(await regie(t)).data.network;assert.equal(view.copy.id,started.data.copy.id);assert.ok(!JSON.stringify(view).includes(intruder.data.copy.id));
  // Remise à zéro : le réseau et sa copie restent, la scène repart de zéro ; la copie du client part avec son compte.
  const reset=await regie(t,{type:'reset',confirm:true});assert.equal(reset.status,200);
  assert.equal(reset.data.room.network,'MOOV-FIBRE-DEMO');assert.equal(reset.data.network.copy.id,started.data.copy.id);assert.equal(reset.data.scene,null);assert.equal(reset.data.next,'cut');
  assert.deepEqual(t.store.all('SELECT id FROM wifi_copies').map(r=>r.id),[started.data.copy.id]);
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

test('Panne annulée sans validation (simulateur de la console) : rien sur les téléphones, rien de compté',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code,{firstName:'Awa'});
  await regie(t,{type:'cut',fault:'fiber'});
  // Quelqu'un remet le quartier en état depuis le simulateur de l'espace Moov : le dossier est clôturé sans validation.
  assert.equal((await t.call(t.admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'normal',close:true})).status,200);
  const me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene,null,'jamais validée : jamais montrée');assert.equal(me.segment.online,me.segment.total);
  const r=(await regie(t)).data;assert.equal(r.report.alert.delivered,0);assert.equal(r.report.alert.avoided,0);assert.equal(r.members[0].delivered,null);assert.equal(r.next,'cut');
 }finally{t.server.close();}
});

test('Plan validé puis dépassé : « Envoyer le technicien » réactualise sans cacher l’alerte déjà reçue',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code);
  await regie(t,{type:'cut',fault:'fiber'});await regie(t,{type:'validate'});
  const id=(await t.call(j,'/jury/me')).data.scene.id;
  // Le jury a lu l'alerte pendant 20 minutes : le plan a expiré et les mesures ont vieilli.
  t.store.run("UPDATE noc_incidents SET plan=json_set(plan,'$.expiresAt',?) WHERE id=?",Date.now()-1000,id);
  t.store.run('UPDATE noc_segments SET sample_at=sample_at-170000 WHERE id=?','YOP-07');
  const sent=await regie(t,{type:'send'});assert.equal(sent.status,200,sent.data.error);assert.equal(sent.data.scene.status,'en_route');
  assert.equal(t.store.get("SELECT count(*) AS n FROM noc_events WHERE incident_id=? AND kind='plan.approved'",id).n,2,'nouvelle validation tracée');
  assert.equal((await t.call(j,'/jury/me')).data.scene.id,id,'l’alerte reste affichée');
 }finally{t.server.close();}
});

test('Nouvelle analyse après la validation : l’alerte reste, la régie propose de valider à nouveau',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code);
  await regie(t,{type:'cut',fault:'fiber'});await regie(t,{type:'validate'});
  const i=t.store.get("SELECT id,version FROM noc_incidents WHERE segment_id='YOP-07' AND status='approved'");
  assert.equal((await t.call(t.admin,'/noc/action',{type:'analyze',id:i.id,version:i.version})).status,200);
  const me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene.id,i.id,'déjà prévenu : l’alerte ne disparaît pas');assert.ok(me.segment);
  const r=(await regie(t)).data;assert.equal(r.next,'validate');
  assert.equal((await regie(t,{type:'validate'})).data.scene.status,'approved');
 }finally{t.server.close();}
});

test('Salle rouverte pendant une panne : la régie la reprend, les chiffres restent cachés jusqu’à la validation',async()=>{
 const t=await setup();
 try{
  await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEM'});await regie(t,{type:'cut',fault:'fiber'});
  // Faute de frappe corrigée : la salle est rouverte avec le bon nom pendant que la panne est en cours.
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code);
  const me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene,null);assert.equal(me.segment,null,'pas de « 8 foyers sur 20 » avant la validation');
  let r=(await regie(t)).data;assert.equal(r.scene.status,'proposed');assert.equal(r.next,'validate');
  r=(await regie(t,{type:'validate'})).data;assert.equal(r.scene.status,'approved');
  assert.equal((await t.call(j,'/jury/me')).data.scene.status,'approved');
 }finally{t.server.close();}
});

test('Alertes comptées honnêtement : ni certificat vu après coup, ni retardataire',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,a=await t.juror(room.code),b=await t.juror(room.code);
  await regie(t,{type:'cut',fault:'power'});await regie(t,{type:'validate'});
  await t.call(a,'/jury/me');
  await regie(t,{type:'repair'});
  // B ouvre sa page après le retour du courant, C s'inscrit après : ils voient le certificat, mais n'ont pas reçu d'alerte.
  assert.ok((await t.call(b,'/jury/me')).data.scene.certificate);
  const c=await t.juror(room.code);assert.ok((await t.call(c,'/jury/me')).data.scene.certificate);
  const alert=(await regie(t)).data.report.alert;
  assert.equal(alert.members,3);assert.equal(alert.delivered,1);assert.equal(alert.avoided,1);assert.ok(alert.seconds<5,'délai mesuré sur les inscrits présents à la validation');
 }finally{t.server.close();}
});

test('Inscriptions simultanées : chacun son numéro ; sans prénom, le serveur vocal dit seulement « Bonjour »',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room;
  const all=await Promise.all(Array.from({length:6},()=>t.juror(room.code)));
  assert.ok(all.every(j=>j.status===201));
  const numbers=(await regie(t)).data.members.map(m=>m.number);assert.deepEqual(numbers,[1,2,3,4,5,6]);
  assert.equal(new Set(all.map(j=>j.data.user.name)).size,6,'des noms tous différents');
  await regie(t,{type:'cut',fault:'fiber'});await regie(t,{type:'validate'});
  const ivr=(await t.call(all[0],'/noc/call',{type:'start'})).data;assert.equal(ivr.lines[0],'Bonjour, ici Moov.');
 }finally{t.server.close();}
});

test('Remise à zéro : les inscrits d’une salle fermée sont effacés, prénom compris',async()=>{
 const t=await setup();
 try{
  const old=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,gone=await t.juror(old.code,{firstName:'Awa Kouassi'});
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,kept=await t.juror(room.code,{firstName:'Koffi'});
  assert.equal((await regie(t,{type:'reset',confirm:true})).status,200);
  assert.equal(t.store.get("SELECT count(*) AS n FROM users WHERE name='Awa Kouassi'").n,0);
  assert.equal((await t.call(gone,'/session')).data.user,null,'session effacée');
  assert.equal((await t.call(kept,'/jury/me')).data.first,'Koffi','la salle ouverte garde ses inscrits');
 }finally{t.server.close();}
});

test('Nom du réseau : caractères invisibles retirés',async()=>{
 const t=await setup();
 try{
  assert.equal((await regie(t,{type:'open',ssid:'\u202EMOOV\u200B-DEMO\u0007'})).data.room.network,'MOOV-DEMO');
  assert.equal((await regie(t,{type:'open',ssid:'\u200B'})).data.room.network,'MOOV-FIBRE-DEMO','vide : nom par défaut');
 }finally{t.server.close();}
});

test('Diagnostic changé après la validation : l’envoi ne revalide pas à la place d’un responsable, et rien n’est enregistré à moitié',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code);
  await regie(t,{type:'cut',fault:'fiber'});await regie(t,{type:'validate'});
  const id=(await t.call(j,'/jury/me')).data.scene.id;
  // Pendant que le jury lit l'alerte, les mesures du quartier changent : l'armoire est inondée.
  assert.equal((await t.call(t.admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'flood'})).status,200);
  const sent=await regie(t,{type:'send'});assert.equal(sent.status,409);assert.match(sent.data.error,/revu son diagnostic : panne « Armoire inondée »/);
  const approvals=()=>t.store.get("SELECT count(*) AS n FROM noc_events WHERE incident_id=? AND kind='plan.approved'",id).n;
  let r=(await regie(t)).data;assert.equal(r.scene.id,id,'la régie garde sa scène');assert.equal(r.scene.status,'proposed');assert.equal(r.scene.cause,'CABINET_FLOOD');assert.equal(r.next,'validate');
  assert.equal(approvals(),1,'aucune validation automatique d’un autre diagnostic');assert.equal(r.scene.technician,null);
  assert.equal((await t.call(j,'/jury/me')).data.scene.id,id,'l’alerte déjà reçue reste');
  // Le responsable relit et valide : la note dit la vraie cause, jamais « coupure fibre ».
  r=(await regie(t,{type:'validate'})).data;assert.equal(r.scene.status,'approved');
  const note=JSON.parse(t.store.get("SELECT detail FROM noc_events WHERE incident_id=? AND kind='plan.approved' ORDER BY at DESC,rowid DESC LIMIT 1",id).detail).note;
  assert.match(note,/Armoire inondée/);assert.doesNotMatch(note,/fibre/);
  // L'eau n'est pas retirée : l'affectation est refusée, le dossier reste tel quel.
  const blocked=await regie(t,{type:'send'});assert.equal(blocked.status,409);assert.match(blocked.data.error,/eau/);
  assert.equal(t.store.get('SELECT status,technician FROM noc_incidents WHERE id=?',id).status,'approved');
 }finally{t.server.close();}
});

test('Salle classique : validation et affectation se font ensemble ou pas du tout',async()=>{
 const t=await setup();
 try{
  await regie(t,{type:'open'});await regie(t,{type:'cut'});
  assert.equal((await t.call(t.admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'flood'})).status,200);
  const id=(await regie(t)).data.scene.id,sent=await regie(t,{type:'send'});
  assert.equal(sent.status,409);assert.match(sent.data.error,/eau/);
  assert.equal(t.store.get("SELECT count(*) AS n FROM noc_events WHERE incident_id=? AND kind='plan.approved'",id).n,0,'refus de l’affectation : la validation est annulée aussi');
  assert.equal(t.store.get('SELECT status FROM noc_incidents WHERE id=?',id).status,'proposed');
 }finally{t.server.close();}
});

test('Inscription pendant une remise à zéro ou après la fermeture : refusée proprement, aucun inscrit gardé n’est perdu',async()=>{
 const t=await setup(),jury=require('./jury-store.cjs');
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,kept=await t.juror(room.code);
  t.store.juryResetting=true;
  const busy=await t.juror(room.code);assert.equal(busy.status,409);assert.match(busy.data.error,/redémarre/);
  t.store.juryResetting=false;
  // Une inscription commencée juste avant la remise à zéro : refusée, ou inscrite après, jamais sur le numéro d'un autre.
  const late=jury.join(t.store,{code:room.code,consent:true},'10.0.0.9').then(u=>u,e=>e);
  const reset=jury.reset(t.store,t.admin.id);
  const [joined]=await Promise.all([late,reset]);
  assert.ok(joined instanceof Error?/redémarre|plus valable/.test(joined.message):joined.id,'refus clair ou inscription complète');
  const numbers=t.store.all('SELECT number,user_id FROM jury_members WHERE room=? ORDER BY number',t.store.get('SELECT id FROM jury_rooms WHERE code=?',room.code).id);
  assert.ok(numbers.some(m=>m.user_id===kept.id),'l’inscrit gardé est toujours là');assert.equal(new Set(numbers.map(m=>m.number)).size,numbers.length);
  // Salle fermée pendant que le compte se crée : refus, et le compte commencé est effacé.
  const users=t.store.get('SELECT count(*) AS n FROM users').n;
  const closing=jury.join(t.store,{code:room.code,consent:true},'10.0.0.8').then(u=>u,e=>e);
  t.store.run('UPDATE jury_rooms SET closed=1');
  const refused=await closing;assert.ok(refused instanceof Error);assert.equal(refused.status,404);
  assert.equal(t.store.get('SELECT count(*) AS n FROM users').n,users,'aucun compte orphelin');
 }finally{t.server.close();}
});

test('Remise à zéro : un inscrit gardé dont le numéro est pris reçoit le suivant au lieu d’être effacé',async()=>{
 const t=await setup(),demo=require('./seed-demo.cjs'),original=demo.resetDemo;
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,kept=await t.juror(room.code);
  const rid=t.store.get('SELECT id FROM jury_rooms WHERE code=?',room.code).id;
  // Cas de secours : quelqu'un a déjà pris le numéro 1 dans la salle au moment de la remise en place.
  demo.resetDemo=async(...a)=>{const r=await original(...a);const r0=t.store.get('SELECT * FROM jury_rooms WHERE id=?',rid);if(!r0)t.store.run('INSERT INTO jury_rooms VALUES(?,?,?,?,?,0)',rid,room.code,t.admin.id,Date.now(),Date.now()+3600000);
   const {user}=await t.store.register({email:'autre@guardian.invalid',name:'Autre',password:'autre-password-1234'});t.store.run('INSERT INTO jury_members(user_id,room,number,joined) VALUES(?,?,1,?)',user.id,rid,Date.now());return r;};
  assert.equal((await regie(t,{type:'reset',confirm:true})).status,200);
  const m=t.store.get('SELECT number FROM jury_members WHERE user_id=?',kept.id);assert.ok(m,'jamais effacé en silence');assert.equal(m.number,2);
  assert.equal(t.store.get('SELECT name FROM users WHERE id=?',kept.id).name,'Membre du jury 2');
 }finally{demo.resetDemo=original;t.server.close();}
});

test('Scène du jury : jamais le signalement d’un client, jamais une autre panne suivie par l’équipe Moov',async()=>{
 const t=await setup(),noc=require('./noc-store.cjs');
 try{
  // Une inondation est en cours avant l'ouverture de la salle : la régie ne la prend pas pour une coupure fibre.
  assert.equal((await t.call(t.admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'flood'})).status,200);
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code);
  let r=(await regie(t)).data;assert.equal(r.scene,null);assert.equal(r.next,'cut');
  const cut=await regie(t,{type:'cut',fault:'fiber'});assert.equal(cut.status,409);assert.match(cut.data.error,/équipe Moov/);
  // Retour à la normale, puis la vraie scène ; un abonné du quartier signale la panne de son côté.
  await t.call(t.admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'normal',close:true});
  for(const i of t.store.all("SELECT id,version FROM noc_incidents WHERE status NOT IN ('resolved','closed')"))t.store.run("UPDATE noc_incidents SET status='closed' WHERE id=?",i.id);
  r=(await regie(t,{type:'cut',fault:'fiber'})).data;const id=r.scene.id;await regie(t,{type:'validate'});
  noc.importReport(t.store,j.id,{id:'rep-yop07',zone:'Niangon',description:'Plus de connexion depuis ce matin',created:Date.now()+1000},{mode:'demo'});
  assert.ok(t.store.get("SELECT id FROM noc_incidents WHERE id='rep-yop07' AND segment_id='YOP-07'"));
  assert.equal((await regie(t)).data.scene.id,id,'la régie garde sa panne');assert.equal((await t.call(j,'/jury/me')).data.scene.id,id,'le jury aussi');
 }finally{t.server.close();}
});

test('Serveur vocal et plan refusé : pas un mot avant la validation, plus d’alerte après un refus, rien pour un retardataire',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code);
  await regie(t,{type:'cut',fault:'fiber'});
  assert.equal((await t.call(j,'/noc/call',{type:'start'})).data.known,false,'avant la validation, le serveur vocal ne connaît pas la panne');
  await regie(t,{type:'validate'});
  assert.equal((await t.call(j,'/noc/call',{type:'start'})).data.known,true);
  // Nouvelle analyse puis refus du responsable : c'était une fausse alerte.
  let i=t.store.get("SELECT id,version FROM noc_incidents WHERE segment_id='YOP-07' AND status='approved'");
  await t.call(t.admin,'/noc/action',{type:'analyze',id:i.id,version:i.version});
  i=t.store.get('SELECT id,version FROM noc_incidents WHERE id=?',i.id);
  assert.equal((await t.call(t.admin,'/noc/action',{type:'reject',id:i.id,version:i.version,note:'Fausse alerte : capteur en maintenance.'})).status,200);
  assert.equal((await t.call(j,'/jury/me')).data.scene,null,'l’alerte est levée');
  assert.equal((await t.call(j,'/noc/call',{type:'start'})).data.known,false);
  const late=await t.juror(room.code);assert.equal((await t.call(late,'/jury/me')).data.scene,null,'pas d’alarme pour un retardataire');
  assert.equal(t.store.get('SELECT count(*) AS n FROM jury_alerts WHERE user_id=?',late.id).n,0);
  assert.equal((await regie(t)).data.next,'cut');
 }finally{t.server.close();}
});

test('Rapport de la coupure de courant : ni trajet ni intervention de technicien',async()=>{
 const t=await setup();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room;await t.juror(room.code);
  await regie(t,{type:'cut',fault:'power'});await regie(t,{type:'validate'});
  const rows=(await regie(t,{type:'repair'})).data.report.rows.map(r=>r.key);
  assert.deepEqual(rows,['detection','decision','total']);
  await regie(t,{type:'cut',fault:'fiber'});
  assert.deepEqual((await regie(t)).data.report.rows.map(r=>r.key),['detection','decision','trajet','intervention','total'],'coupure fibre : toutes les lignes');
 }finally{t.server.close();}
});

// Copie du réseau de démo faite depuis la régie (partage de connexion mesuré) : la panne s'y rejoue.
async function copy(t){const link=(await t.call(t.admin,'/test/link',{})).data;return (await t.page('copy',link.token,{new:true,network:'hotspot',metrics:{downloadMbps:31.4,latencyMs:42},points:[{t:500,rtt:40,mbps:30},{t:1500,rtt:44,mbps:32}]})).data.copy;}

for(const [fault,name,cause,client] of [['theft','Vol de câble','CABLE_THEFT',/un câble a été endommagé dans votre quartier/i],['works','Chantier','ROADWORK_CUT',/des travaux de route ont arraché un câble dans votre quartier/i]])
 test(name+' sur le réseau de démo : rien avant la validation, puis un technicien part et le certificat de réparation arrive',async()=>{
  const t=await setup(),V=view();
  try{
   const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code,{firstName:'Awa'});await copy(t);
   let r=(await regie(t,{type:'cut',fault})).data;
   assert.equal(r.scene.cause,cause);assert.equal(r.scene.status,'proposed');assert.equal(r.scene.dispatch,true,'une équipe part');assert.equal(r.next,'validate');
   // La copie du Wi-Fi joue une fibre coupée : box au voyant rouge, appareil sans Internet.
   assert.equal(r.network.twin.fault,fault);assert.equal(r.network.twin.label,'Fibre coupée');assert.deepEqual(r.network.twin.devices.map(d=>d.state),['box-los','sans-internet']);
   // Avant la validation : rien sur le téléphone, ni chiffres, ni serveur vocal, ni technicien.
   let me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene,null);assert.equal(me.segment,null);
   assert.equal((await t.call(j,'/noc/call',{type:'start'})).data.known,false);
   const early=await regie(t,{type:'send'});assert.equal(early.status,409);assert.match(early.data.error,/responsable/);
   assert.equal(t.store.get('SELECT count(*) AS n FROM jury_alerts').n,0);
   r=(await regie(t,{type:'validate'})).data;assert.equal(r.scene.status,'approved');assert.equal(r.next,'send','étape suivante : envoyer le technicien');
   const note=JSON.parse(t.store.get("SELECT detail FROM noc_events WHERE kind='plan.approved' AND incident_id=?",r.scene.id).detail).note;
   assert.match(note,fault==='theft'?/coupure par vol de câble confirmée sur le réseau MOOV-FIBRE-DEMO/:/coupure par un chantier confirmée sur le réseau MOOV-FIBRE-DEMO/);
   // Après la validation : l'alerte, avec la vraie cause, le quartier coupé et l'heure de retour.
   me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene.cause,cause);assert.equal(me.scene.status,'approved');assert.ok(me.segment.online<me.segment.total);assert.match(me.scene.restore.label,/^\d{2} h \d{2}$/);
   // Les mots de l'abonné : ceux du message client de Guardian (sim-flow.js), jamais « vol ».
   const look=V.lookOf(me.scene,me.network),says=V.guardianSays(me.scene,me.segment);
   assert.equal(look.tone,'down');assert.equal(look.title,'Votre quartier est privé de fibre');assert.equal(look.alert,fault==='theft'?'Câble endommagé':'Câble arraché par un chantier');
   assert.match(says,client);assert.match(F.KIND[fault].client,client,'même phrase que l’alerte WhatsApp du client');assert.doesNotMatch(says+look.alert,/\bvol/i);
   assert.deepEqual(V.stepsFor(r.room.network,r.scene).map(s=>s[0]),['cut','validate','send','arrive','repair']);
   // « Appeler Moov » sur la même page : le serveur vocal dit la même cause que Guardian, jamais « vol ».
   const ivr=(await t.call(j,'/noc/call',{type:'start'})).data;assert.equal(ivr.known,true);
   assert.match(ivr.lines.join(' '),fault==='theft'?/un câble a été endommagé/:/un chantier a arraché un câble/);assert.doesNotMatch(ivr.lines.join(' '),/\bvol/i);
   r=(await regie(t,{type:'send'})).data;assert.equal(r.scene.status,'en_route');assert.equal(r.scene.technician,'koffi');assert.equal(r.next,'arrive');
   r=(await regie(t,{type:'arrive'})).data;assert.equal(r.scene.status,'on_site');assert.equal(r.next,'repair');
   assert.match(V.guardianSays({...me.scene,status:'on_site',technician:{name:'Koffi N’Guessan'}},me.segment),fault==='theft'?/^Koffi est arrivé\. Il remplace le câble et sécurise le boîtier/:/^Koffi est arrivé\. Il remplace le câble arraché/);
   // La variante du jury (réparation partielle) existe pour les pannes où un technicien répare.
   if(fault==='theft'){r=(await regie(t,{type:'partial'})).data;assert.equal(r.scene.hold.remaining,4);assert.equal(r.report.partial,true);}
   r=(await regie(t,{type:'repair'})).data;assert.equal(r.scene.status,'resolved');assert.equal(r.next,'cut');assert.equal(r.network.twin,null,'fin de scène : la copie revient au calme');
   assert.deepEqual(r.report.rows.map(x=>x.key),['detection','decision','trajet','intervention','total']);assert.equal(r.report.slow,false);
   me=(await t.call(j,'/jury/me')).data;const c=me.scene.certificate;
   assert.equal(c.cause,cause);assert.equal(c.technician,'Koffi N’Guessan');assert.equal(c.online,c.total);
   const cert=V.certOf(c);assert.equal(cert.title,'Votre fibre est réparée');assert.ok(cert.rows.some(([k])=>k==='Technicien sur place'));
   assert.equal(V.toastOf(me.scene),'Connexion rétablie et vérifiée');
  }finally{t.server.close();}
 });

test('Réseau saturé sur le réseau de démo : rien n’est coupé, pas de technicien, le débit revient et tout repasse au vert',async()=>{
 const t=await setup(),V=view();
 try{
  const room=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data.room,j=await t.juror(room.code,{firstName:'Aya'});await copy(t);
  let r=(await regie(t,{type:'cut',fault:'congestion'})).data;
  assert.equal(r.scene.cause,'UPLINK_CONGESTION');assert.equal(r.scene.status,'proposed');assert.equal(r.scene.dispatch,false);assert.equal(r.next,'validate');
  assert.equal(r.segment.online,r.segment.total,'les box restent en ligne');assert.equal(r.segment.alarm,'UPLINK_HIGH');
  // La copie du Wi-Fi joue un quartier chargé : box allumée, appareils connectés mais lents.
  assert.equal(r.network.twin.fault,'congestion');assert.equal(r.network.twin.label,'Quartier chargé');assert.deepEqual(r.network.twin.devices.map(d=>d.state),['box','lent']);assert.equal(r.network.twin.summary.online,r.network.twin.summary.devices);
  // Avant la validation : rien sur le téléphone (le quartier n'est pas calme, ses chiffres restent cachés).
  let me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene,null);assert.equal(me.segment,null);
  assert.equal((await t.call(j,'/noc/call',{type:'start'})).data.known,false);
  assert.equal(t.store.get('SELECT count(*) AS n FROM jury_alerts').n,0);
  r=(await regie(t,{type:'validate'})).data;assert.equal(r.scene.status,'approved');assert.equal(r.next,'repair','personne à envoyer');
  const note=JSON.parse(t.store.get("SELECT detail FROM noc_events WHERE kind='plan.approved' AND incident_id=?",r.scene.id).detail).note;
  assert.match(note,/saturation du réseau confirmée sur le réseau MOOV-FIBRE-DEMO/);
  // Pas de technicien, pas de réparation partielle : des refus propres à un réseau saturé (pas ceux du courant).
  const send=await regie(t,{type:'send'});assert.equal(send.status,409);assert.match(send.data.error,/rien n’est coupé, Moov ajoute de la capacité/);assert.doesNotMatch(send.data.error,/courant/);
  const partial=await regie(t,{type:'partial'});assert.equal(partial.status,409);assert.match(partial.data.error,/réseau saturé/);
  assert.equal((await regie(t,{type:'arrive'})).status,409);
  // Après la validation : l'alerte, avec les box toujours en ligne et l'heure où le débit redevient normal.
  me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene.cause,'UPLINK_CONGESTION');assert.equal(me.scene.status,'approved');assert.equal(me.segment.online,me.segment.total);assert.match(me.scene.restore.label,/^\d{2} h \d{2}$/);
  // Les mots de l'abonné : internet est lent, jamais coupé ni « privé de fibre ».
  const look=V.lookOf(me.scene,me.network),says=V.guardianSays(me.scene,me.segment),stages=V.stagesOf(me.scene).map(s=>s[1]);
  assert.deepEqual([look.tone,look.pill,look.title,look.alert,look.eta],['slow','Internet ralenti','Internet est lent dans votre quartier','Internet ralenti','Débit normal vers ']);
  assert.match(says,/^Internet est plus lent dans votre quartier en ce moment/);assert.match(says,/Moov ajoute de la capacité/);assert.match(F.KIND.congestion.client,/^Internet est plus lent dans votre quartier en ce moment\. Moov ajoute de la capacité\./,'même phrase que l’alerte WhatsApp du client');
  assert.deepEqual(stages,['Ralentissement détecté','Moov ajoute de la capacité','Débit revenu à la normale']);
  const ivr=(await t.call(j,'/noc/call',{type:'start'})).data;assert.equal(ivr.known,true);assert.match(ivr.lines.join(' '),/internet est lent dans votre quartier/);assert.match(ivr.lines.join(' '),/Le débit devrait redevenir normal vers/);
  for(const text of [says,look.pill,look.title,look.alert,look.meter,...stages,...ivr.lines])assert.doesNotMatch(text,/fibre|coupé|coupure|privé/i,'rien n’est coupé : '+text);
  const steps=V.stepsFor(r.room.network,r.scene);assert.deepEqual(steps.map(s=>s[0]),['cut','validate','repair']);assert.equal(steps[2][1],'Le débit revient');
  // Le débit revient : mesures normales, la supervision vérifie, la scène se termine.
  r=(await regie(t,{type:'repair'})).data;assert.equal(r.scene.status,'resolved');assert.equal(r.next,'cut');assert.equal(r.segment.alarm,'NONE');assert.equal(r.network.twin,null);
  assert.deepEqual(r.report.rows.map(x=>x.key),['detection','decision','total']);assert.match(r.report.rows[0].label,/^Saturation/);
  assert.equal(r.report.slow,true);assert.equal(r.report.offline,0,'aucune box coupée');assert.equal(r.report.online,r.report.total);assert.equal(r.report.onlineAfter,r.report.totalAfter);
  me=(await t.call(j,'/jury/me')).data;assert.equal(me.scene.status,'resolved');assert.equal(me.segment.online,me.segment.total);
  const c=me.scene.certificate;assert.equal(c.cause,'UPLINK_CONGESTION');assert.equal(c.technician,null);
  // Le certificat dit le retour du débit normal, sans ligne « technicien ».
  const cert=V.certOf(c);assert.equal(cert.kind,'Certificat de retour du service');assert.equal(cert.title,'Votre débit est revenu à la normale');
  assert.ok(!cert.rows.some(([k])=>/Technicien/.test(k)));assert.ok(cert.rows.some(([k])=>k==='Débit normal retrouvé'));
  assert.equal(V.lookOf(me.scene,me.network).pill,'Débit rétabli');assert.match(V.guardianSays(me.scene,me.segment),/^Le débit est revenu à la normale/);
  // Le signal de fin parle du débit : internet n'a jamais été coupé, pas de « connexion rétablie ».
  assert.equal(V.toastOf(me.scene),'Débit revenu à la normale et vérifié');assert.match(V.toastOf({...me.scene,status:'verifying'}),/débit/);
  for(const st of ['verifying','resolved'])assert.doesNotMatch(V.toastOf({...me.scene,status:st}),/connexion|coupé|coupure|réparation/i,st);
  assert.equal(t.store.get("SELECT actor FROM noc_events WHERE kind='resolved' AND incident_id=?",me.scene.id).actor,t.admin.id);
 }finally{t.server.close();}
});

test('Salle classique : seule la coupure fibre se joue, quelle que soit la panne demandée ; une panne inconnue est refusée',async()=>{
 const t=await setup(),V=view();
 try{
  // Un réseau saturé suivi par l'équipe Moov avant l'ouverture : la salle classique ne le reprend pas.
  assert.equal((await t.call(t.admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'congestion'})).status,200);
  await regie(t,{type:'open'});
  let r=(await regie(t)).data;assert.equal(r.room.network,null);assert.equal(r.scene,null);assert.equal(r.next,'cut');
  await t.call(t.admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'normal',close:true});
  for(const i of t.store.all("SELECT id FROM noc_incidents WHERE status NOT IN ('resolved','closed')"))t.store.run("UPDATE noc_incidents SET status='closed' WHERE id=?",i.id);
  assert.equal((await regie(t,{type:'cut',fault:'olt'})).status,400,'panne inconnue');
  assert.equal((await regie(t,{type:'cut',fault:'__proto__'})).status,400);
  for(const fault of ['theft','works','congestion']){
   r=(await regie(t,{type:'cut',fault})).data;assert.equal(r.scene.cause,'FIBER_CUT_DISTRIBUTION','salle classique : la coupure fibre habituelle ('+fault+')');assert.equal(r.next,'send');
   assert.deepEqual(V.stepsFor(null,r.scene).map(s=>s[0]),['cut','send','arrive','repair']);
   await t.call(t.admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'normal',close:true});
  }
  // Réseau de démo : la même panne d'avant l'ouverture est reprise par la régie (elle sait la jouer).
  assert.equal((await t.call(t.admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'congestion'})).status,200);
  r=(await regie(t,{type:'open',ssid:'MOOV-FIBRE-DEMO'})).data;assert.equal(r.scene.cause,'UPLINK_CONGESTION');assert.equal(r.next,'validate');
 }finally{t.server.close();}
});
