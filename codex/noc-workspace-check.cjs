'use strict';
// Tests de coordination purement en mémoire ; aucune attribution de rôle sur le pilote réel.
const {test}=require('node:test'),A=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),O=require('./operator-store.cjs'),N=require('./noc-store.cjs'),W=require('./noc-workspace.cjs');
function fixture(){
 const s=new Store(':memory:');O.migrate(s);N.migrate(s);
 for(const u of ['admin','supervisor','agent','field','client','other'])s.run('INSERT INTO users VALUES(?,?,?,?,?,?)',u,u+'@example.test',u,'not-an-auth-fixture','unused',Date.now());
 for(const role of ['admin','supervisor','agent'])O.grant(s,role+'@example.test',role);
 N.join(s,'client',{segment:'YOP-07',consent:true});N.join(s,'other',{segment:'COC-03',consent:true});
 N.operate(s,'admin',{type:'simulate',segment:'YOP-07',scenario:'fiber'});
 const incident=N.overview(s,'admin').incidents[0],key='incident:'+incident.id;
 const item=(uid='admin',k=key)=>W.overview(s,uid).queue.find(q=>q.key===k);
 const act=(uid,data,k=key)=>{const q=item(uid,k);return W.action(s,uid,{key:k,version:q.version,sourceVersion:q.sourceVersion,...data});};
 const op=data=>{const q=item();return N.operate(s,'admin',{id:incident.id,version:q.sourceVersion,...data});};
 const ticket=(tid,shared=true)=>{
  s.run('INSERT OR IGNORE INTO homes VALUES(?,?,?,?,?)','home','client','Foyer client',Date.now(),'{}');s.run('INSERT OR IGNORE INTO members VALUES(?,?,?)','home','client','owner');
  s.run('INSERT INTO tickets VALUES(?,?,?,?,?,?)',tid,'home',Date.now(),'À transmettre','Ticket '+tid,JSON.stringify({detail:'Informations volontairement transmises '+tid,latest:[]}));
  if(shared)O.share(s,'client','home',{id:tid,share:true,consent:true});return 'ticket:'+tid;
 };
 return {s,key,incident,item,act,op,ticket};
}
test('file unifiée : références sources sans copie, lecture pure, consentement retiré immédiatement',()=>{
 const f=fixture(),{s,item,act,ticket}=f;try{
  const shared=ticket('shared'),privateKey=ticket('private',false),initial=W.overview(s,'agent');
  A.equal(initial.counts.total,2);A.equal(initial.counts.sharedTickets,1);A.ok(!initial.queue.some(q=>q.key===privateKey));A.throws(()=>W.overview(s,'client'),e=>e.status===403);
  const before=s.db.prepare('SELECT total_changes() AS n').get().n;W.overview(s,'admin');W.overview(s,'admin');A.equal(s.db.prepare('SELECT total_changes() AS n').get().n,before);
  act('agent',{type:'claim',confirm:true},shared);A.equal(item('agent',shared).owner.id,'agent');A.equal(s.get('SELECT assignee FROM support_shares WHERE ticket_id=?','shared').assignee,'agent');
  act('agent',{type:'note',body:'Une note interne liée uniquement au consentement actif.'},shared);
  const stale=item('agent',shared);O.share(s,'client','home',{id:'shared',share:false});
  A.ok(!W.overview(s,'admin').queue.some(q=>q.key===shared));A.throws(()=>W.action(s,'admin',{type:'note',key:shared,version:stale.version,sourceVersion:stale.sourceVersion,body:'Ne doit pas passer'}),e=>e.status===404);
  A.equal(s.get('SELECT count(*) AS n FROM tickets').n,2);A.ok(!JSON.stringify(O.clientShares(s,'home')).includes('note interne'));
 }finally{s.close();}
});
test('versions source et workflow protègent prise en charge, notes, et conflits concurrents',()=>{
 const {s,key,item,act,op}=fixture();try{
  const old=item();act('agent',{type:'claim',confirm:true});A.equal(item().owner.id,'agent');A.equal(item().version,old.version+1);
  A.throws(()=>W.action(s,'supervisor',{key,version:old.version,sourceVersion:old.sourceVersion,type:'note',body:'Conflit attendu'}),e=>e.status===409);
  const stale=item();op({type:'analyze'});A.throws(()=>W.action(s,'agent',{key,version:stale.version,sourceVersion:stale.sourceVersion,type:'note',body:'Mesures changées'}),e=>e.status===409);
  const before=item();A.throws(()=>act('agent',{type:'note',body:'x'.repeat(1001)}),e=>e.status===400);A.equal(item().version,before.version);A.equal(item().notes.length,0);
  act('agent',{type:'note',body:'Vérifier la disponibilité de notre équipe interne.'});A.equal(item().notes.length,1);A.equal(item().notes[0].author,'agent');
 }finally{s.close();}
});
test('notes privées et consignes ne se diffusent jamais aux clients ; gabarits ciblés et dédoublonnés',()=>{
 const {s,item,act,op}=fixture();try{
  const initial=N.notifications(s,'client').items.length;
  act('agent',{type:'note',body:'CONFIDENTIEL : coordination logistique.'});op({type:'approve',note:'Plan contrôlé et validé.'});act('agent',{type:'instruct',body:'INTERNE : vérifier le réflectomètre avant départ.'});
  A.equal(N.notifications(s,'client').items.length,initial+1);A.ok(!JSON.stringify(N.client(s,'client')).includes('CONFIDENTIEL'));A.ok(!JSON.stringify(N.notifications(s,'client')).includes('INTERNE'));
  const before=item();A.throws(()=>act('agent',{type:'notify',template:'free_text',body:'Connexion réparée',confirm:true}),e=>e.status===409);A.equal(item().version,before.version);
  const t=item().notificationTemplates[0];act('agent',{type:'notify',template:t.id,confirm:true});A.equal(N.notifications(s,'client').items.filter(n=>n.kind==='support.template').length,1);A.equal(N.notifications(s,'other').items.length,0);
  A.throws(()=>act('agent',{type:'notify',template:t.id,confirm:true}),e=>e.status===409);A.equal(N.notifications(s,'client').items.filter(n=>n.kind==='support.template').length,1);
 }finally{s.close();}
});
test('terrain limité à son équipe ; checklist obligatoire et clôture toujours soumise aux mesures',()=>{
 const {s,key,item,act,op,ticket}=fixture();try{
  ticket('never-field');W.action(s,'admin',{type:'field-account',email:'field@example.test',technicianId:'awa',enabled:true,confirm:true});A.equal(W.sessionRole(s,'field'),'technician');
  A.equal(W.overview(s,'field').queue.length,0);A.equal(W.overview(s,'field').network.segments.length,0);
  A.throws(()=>N.overview(s,'field'),e=>e.status===403);A.throws(()=>N.operate(s,'field',{type:'simulate',segment:'YOP-07',scenario:'normal'}),e=>e.status===403);
  op({type:'approve',note:'Plan de démonstration validé.'});op({type:'dispatch',technician:'awa',safety:true});
  const scoped=W.overview(s,'field');A.equal(scoped.queue.length,1);A.equal(scoped.network.incidents.length,1);A.equal(scoped.team.length,1);A.equal(scoped.capabilities.canApprove,false);
  act('agent',{type:'instruct',body:'Sécuriser le site avant intervention.'});A.throws(()=>act('agent',{type:'advance',confirm:true}),e=>e.status===403);
  A.throws(()=>N.operate(s,'agent',{type:'advance',id:item().id,version:item().sourceVersion}),e=>e.status===403);
  act('field',{type:'advance',confirm:true});act('field',{type:'advance',confirm:true});A.equal(item().status,'on_site');
  const before=item();A.throws(()=>act('field',{type:'advance',confirm:true}),e=>e.status===409);A.equal(item().version,before.version);A.equal(item().sourceVersion,before.sourceVersion);
  act('field',{type:'check',itemId:item().checklist[0].id,done:true});A.equal(item().checklist[0].completedBy,'field');act('field',{type:'advance',confirm:true});A.equal(item().status,'verifying');A.equal(item().restorationVerified,false);
  A.throws(()=>N.operate(s,'field',{type:'verify',id:item().id,version:item().sourceVersion}),e=>e.status===403);A.throws(()=>op({type:'verify'}),e=>e.status===409);
  N.operate(s,'admin',{type:'simulate',segment:'YOP-07',scenario:'normal'});op({type:'verify'});A.equal(item().status,'resolved');A.equal(item().restorationVerified,true);
  W.action(s,'admin',{type:'field-account',email:'field@example.test',enabled:false,confirm:true});A.equal(W.sessionRole(s,'field'),'subscriber');A.throws(()=>W.overview(s,'field'),e=>e.status===403);
 }finally{s.close();}
});
test('pause interdit toutes écritures opérationnelles, mais permet la révocation terrain de sécurité',()=>{
 const {s,item,act}=fixture();try{
  W.action(s,'admin',{type:'field-account',email:'field@example.test',technicianId:'awa',enabled:true,confirm:true});N.operate(s,'admin',{type:'pause',paused:true});
  const view=W.overview(s,'agent');A.equal(view.paused,true);A.equal(view.settings.paused,1);A.ok(Object.values(view.queue[0].allowed).every(v=>v===false));
  A.throws(()=>act('agent',{type:'note',body:'Interdit en pause'}),e=>e.status===409);A.equal(item().notes.length,0);
  A.throws(()=>W.action(s,'admin',{type:'field-account',email:'other@example.test',technicianId:'yao',enabled:true,confirm:true}),e=>e.status===409);
  W.action(s,'admin',{type:'field-account',email:'field@example.test',enabled:false,confirm:true});A.equal(W.sessionRole(s,'field'),'subscriber');
 }finally{s.close();}
});
test('ticket notifié depuis gabarit sans toucher son statut ni inventer une réparation réseau',()=>{
 const {s,item,act,ticket}=fixture();try{
  const key=ticket('support');act('agent',{type:'claim',confirm:true},key);const before=item('agent',key);
  act('agent',{type:'notify',template:'ticket_update',confirm:true},key);A.equal(item('agent',key).status,'submitted');A.equal(item('agent',key).sourceVersion,before.sourceVersion+1);A.equal(s.get('SELECT count(*) AS n FROM notifications WHERE home=?','home').n,1);
  A.equal(s.get('SELECT count(*) AS n FROM support_events WHERE ticket_id=? AND kind=?','support','support.template').n,1);A.equal(N.notifications(s,'client').items.filter(i=>i.kind==='support.template').length,0);
  A.throws(()=>act('agent',{type:'notify',template:'ticket_update',confirm:true},key),e=>e.status===409);
 }finally{s.close();}
});
test('traitement support complet réutilise les transitions et réponses publiques de la source',()=>{
 const {s,item,act,ticket}=fixture();try{
  const key=ticket('flow');A.deepEqual(item('agent',key).ticketStatuses.map(x=>x.id),['in_progress']);
  A.throws(()=>act('agent',{type:'ticketStatus',status:'in_progress',body:'Aucune fausse action',confirm:true},key),e=>e.status===400);
  A.throws(()=>act('agent',{type:'ticket-status',status:'resolved',body:'Saut interdit',confirm:true},key),e=>e.status===409);
  A.throws(()=>act('agent',{type:'ticket-status',status:'in_progress',body:'',confirm:true},key),e=>e.status===400);
  A.equal(item('agent',key).version,0);A.equal(item('agent',key).status,'submitted');
  for(const status of ['in_progress','waiting_customer','resolved','in_progress'])act('agent',{type:'ticket-status',status,body:'Réponse publique précise : '+status,confirm:true},key);
  const current=item('agent',key);A.equal(current.status,'in_progress');A.equal(current.version,4);A.equal(current.owner.id,'agent');A.equal(current.restorationVerified,false);
  A.equal(s.get('SELECT status FROM support_shares WHERE ticket_id=?','flow').status,current.status);A.equal(s.get('SELECT count(*) AS n FROM notifications WHERE home=?','home').n,4);
  A.equal(O.clientShares(s,'home')[0].events.filter(e=>e.message.includes('Réponse publique')).length,4);A.equal(current.notes.length,0);
 }finally{s.close();}
});
test('vrai signalement photo local : examen, fermeture administrative et réouverture sans ancienne approbation',()=>{
 const {s,item,act}=fixture(),J=require('./journey-store.cjs');try{
  J.migrate(s);const photo='data:image/jpeg;base64,'+Buffer.from([255,216,255,...Array(20).fill(0)]).toString('base64');
  const report=J.reportReal(s,'client',{consent:true,photo,lat:5.35,lon:-4.02,zone:'Zone déclarée par le client',description:'Photo transmise explicitement au support local.'}),key='incident:'+report.id;
  N.scan(s);const start=item('agent',key);A.equal(start.allowed.reportStatus,true);A.equal(start.reportStatus,'received');
  A.throws(()=>act('agent',{type:'report-status',status:'resolved',body:'',confirm:true},key),e=>e.status===400);
  act('agent',{type:'report-status',status:'reviewing',body:'Nous examinons votre signalement.',confirm:true},key);A.equal(item('agent',key).reportStatus,'reviewing');A.ok(item('agent',key).sourceVersion>start.sourceVersion);
  N.operate(s,'admin',{type:'approve',id:report.id,version:item('agent',key).sourceVersion,note:'Examen administratif uniquement.'});
  act('agent',{type:'report-status',status:'resolved',body:'Dossier clôturé après échange ; réseau non vérifié.',confirm:true},key);
  const closed=item('agent',key);A.equal(closed.status,'closed');A.equal(closed.terminal,true);A.equal(closed.restorationVerified,false);A.equal(closed.reportStatus,'resolved');A.deepEqual(closed.reportStatuses.map(t=>t.id),['reviewing']);
  A.ok(!N.client(s,'client').incidents.find(i=>i.id===report.id).events.some(e=>e.kind==='resolved'));A.ok(!N.client(s,'other').incidents.some(i=>i.id===report.id));
  act('agent',{type:'report-status',status:'reviewing',body:'Le client demande une nouvelle vérification.',confirm:true},key);
  A.equal(item('agent',key).status,'reported');A.equal(item('agent',key).plan,null);A.equal(s.get('SELECT approved_by FROM noc_incidents WHERE id=?',report.id).approved_by,null);
  const stale=item('agent',key);J.respondReal(s,{id:'agent'},{id:report.id,status:'reviewing',response:'Complément depuis l’ancien écran.'});A.throws(()=>W.action(s,'agent',{key,version:stale.version,sourceVersion:stale.sourceVersion,type:'report-status',status:'resolved',body:'Réponse dépassée',confirm:true}),e=>e.status===409);
  N.importReport(s,'client',{id:'manual-import',zone:'Hors source',description:'Import sans dossier citoyen.',created:Date.now()});A.equal(item('agent','incident:manual-import').allowed.reportStatus,false);
  A.throws(()=>act('agent',{type:'report-status',status:'resolved',body:'Ne pas créer un dossier fantôme',confirm:true},'incident:manual-import'),e=>e.status===403);
 }finally{s.close();}
});
test('télémétrie à la borne de trois minutes : approbation et dispatch refusés, rejet toujours disponible',()=>{
 const actual=Date.now;let now=Date.now();Date.now=()=>now;const {s,item,op}=fixture();try{
  now+=180000;A.throws(()=>op({type:'approve',note:'Mesures trop anciennes'}),e=>e.status===409);A.equal(item().status,'proposed');op({type:'reject',note:'Nouvelles mesures requises'});A.equal(item().status,'rejected');
  N.operate(s,'admin',{type:'simulate',segment:'YOP-07',scenario:'fiber'});op({type:'analyze'});op({type:'approve',note:'Mesures fraîchement réexaminées'});now+=180000;A.throws(()=>op({type:'dispatch',technician:'awa',safety:true}),e=>e.status===409);A.equal(item().status,'approved');
 }finally{Date.now=actual;s.close();}
});
