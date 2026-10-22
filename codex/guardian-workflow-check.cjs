'use strict';
// Scénarios intégrés sur une base en mémoire et des comptes fictifs.
const A=require('node:assert/strict'),{createGuardianServer}=require('./pilot-server.cjs'),J=require('./journey-store.cjs'),O=require('./operator-store.cjs');
(async()=>{const errors=[],server=createGuardianServer({db:':memory:',onError:e=>errors.push(e.message)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,s=server.guardianStore;
try {
 async function account(name,role){await s.register({email:name+'@example.test',password:'workflow-password-123',name});if(role)O.grant(s,name+'@example.test',role);const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@example.test',password:'workflow-password-123'})});const d=await r.json();return {id:d.user.id,csrf:d.user.csrf,cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};}
 async function req(c,path,body,expected=200){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:c?.cookie||'','X-CSRF-Token':c?.csrf||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),d=await r.json();A.equal(r.status,expected,JSON.stringify(d));return d;}
 const admin=await account('admin','admin'),client=await account('client'),other=await account('other');
 let state=(await req(client,'/journey/start',{})).state;
 const action=async(body,expected=200)=>{const d=await req(client,'/journey/action',{version:state.version,...body},expected);if(expected===200)state=d.state;return d;};
 await req(client,'/guardian/chat',{portal:'noc',text:'Montrer les incidents'},403);await req(null,'/guardian/chat',{portal:'client',text:'Bonjour'},401);await req({...client,csrf:''},'/guardian/chat',{portal:'client',text:'Bonjour'},403);
 const baseline=s.get('SELECT count(*) n FROM noc_events').n;await req(admin,'/guardian/chat',{portal:'noc',page:'settings',text:'Qui peut approuver ?'});A.equal(s.get('SELECT count(*) n FROM noc_events').n,baseline);console.log('PASS copilote authentifié, rôle NOC, CSRF et lecture sans commande implicite');
 await action({type:'chat',text:'Un meilleur forfait ?'});A.equal(state.upgrade,null);await action({type:'chat',text:'Je veux 500 Mbps'});A.equal(state.upgrade,null);
 await action({type:'scenario',value:'slow'});await action({type:'chat',text:'Je veux 200 Mbps'});A.ok(!state.upgrade);
 await action({type:'scenario',value:'normal'});await action({type:'chat',text:'Je veux 200 Mbps'});A.equal(state.upgrade.amount,5000);A.equal(state.upgrade.to.price,25000);const quote=state.upgrade.id;
 await action({type:'upgrade-pay',id:quote},400);
 await action({type:'upgrade-pay',id:quote,confirm:true});A.equal(state.capacity,200);A.equal(state.payment.amount,5000);A.equal(state.plan.price,25000);
 await action({type:'upgrade-pay',id:quote,confirm:true});A.equal(state.audit.filter(v=>v.action==='upgrade.activated').length,1);A.equal((await req(client,'/journey/state')).state.capacity,200);
 await action({type:'chat',text:'Je veux un meilleur forfait'});A.equal(state.upgrade,null);console.log('PASS offre justifiée, complément exact, confirmation, persistance et paiement simulé idempotent');
 await action({type:'reset'});await action({type:'chat',text:'Je veux 200 Mbps'});await action({type:'upgrade-decline'});await action({type:'chat',text:'Je veux 200 Mbps'});A.equal(state.upgrade,null);
 await action({type:'reset'});await action({type:'chat',text:'Je veux 200 Mbps'});let raw=J.get(s,client.id);raw.upgrade.expires=Date.now()-1;J.put(s,client.id,raw);await action({type:'upgrade-pay',id:raw.upgrade.id,confirm:true},409);console.log('PASS refus mémorisé et offre expirée refusée');
 await action({type:'reset'});await action({type:'scenario',value:'download'});await action({type:'chat',text:'Gaming'});const qos=state.proposal.id;await action({type:'chat',text:'Je veux 200 Mbps'});const interrupted=state.upgrade.id;
 await req(client,'/noc/join',{segment:'YOP-07',consent:true});await req(other,'/noc/join',{segment:'COC-03',consent:true});
 await req(admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'fiber'});
 await action({type:'upgrade-pay',id:interrupted,confirm:true},409);
 // Crée une proposition avant la panne pour contrôler une validation arrivée trop tard.
 raw=J.get(s,client.id);raw.proposal={id:qos,limits:[{id:'tv',mbps:5}],minutes:30,expires:Date.now()+60000};J.put(s,client.id,raw);await action({type:'apply',id:qos,confirm:true},409);
 await action({type:'chat',text:'Je veux 200 Mbps pour le gaming'});A.equal(state.proposal,null);A.equal(state.upgrade,null);A.equal(state.messages.at(-1).action,'tracking');A.match(state.messages.at(-1).text,/prépare l’intervention.*dès que le plan est validé.*ne réglerait pas cette coupure/);
 A.equal((await req(other,'/noc/client')).incidents.length,0);const otherReply=await req(other,'/guardian/chat',{portal:'client',text:'Le technicien ?'});A.match(otherReply.message,/Aucun incident ouvert/);console.log('PASS incident partagé prioritaire, actions devenues dangereuses refusées et isolation entre quartiers');
 let incident=(await req(admin,'/noc/overview')).incidents[0];
 const noc=async(type,extra={})=>{incident=(await req(admin,'/noc/overview')).incidents.find(v=>v.id===incident.id);await req(admin,'/noc/action',{type,id:incident.id,version:incident.version,...extra});};
 await req(client,'/noc/feedback',{id:incident.id,rating:5},409);await req(other,'/noc/feedback',{id:incident.id,rating:5},404);
 await noc('approve',{note:'Plan et sécurité examinés dans le scénario'});await noc('dispatch',{technician:'awa',safety:true});await noc('advance');
 await action({type:'chat',text:'Où est le technicien ?'});A.match(state.messages.at(-1).text,/en route/);A.ok((await req(client,'/noc/client')).incidents[0].position);
 await noc('advance');await action({type:'chat',text:'Ma connexion est lente'});A.match(state.messages.at(-1).text,/sur place/);const onSite=(await req(client,'/noc/client')).incidents[0];A.equal(onSite.position,null);A.equal(onSite.technician.name,'Awa Kouamé');
 const copilot=await req(admin,'/guardian/chat',{portal:'noc',page:'missions',incidentId:incident.id,text:'Que faire ?'});A.match(copilot.message,/sur place/);A.ok(copilot.facts.some(f=>f.value==='RB-FIBER-v1'));const authority=await req(admin,'/guardian/chat',{portal:'noc',page:'settings',incidentId:incident.id,text:'Qui peut approuver ?'});A.match(authority.message,/responsable ou son mandataire/);A.equal(authority.actions[0].page,'settings');A.ok((await req(client,'/journey/state')).state.sharedIncident);
 console.log('PASS agent client et NOC reliés au départ, à l’arrivée et au runbook ; GPS caché sur place');
 await noc('advance');await action({type:'chat',text:'Le réseau revient ?'});A.match(state.messages.at(-1).text,/vérifions/);
 await req(admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'normal'});await noc('verify');
 await req(client,'/noc/feedback',{id:incident.id,rating:6},400);await req(client,'/noc/feedback',{id:incident.id,rating:5,comment:'Suivi clair'});
 await req(client,'/noc/feedback',{id:incident.id,rating:4,comment:'Avis mis à jour'});A.equal(s.get('SELECT count(*) n FROM noc_feedback').n,1);A.equal((await req(client,'/noc/client')).incidents[0].feedback.rating,4);
 await req(other,'/noc/feedback',{id:incident.id,rating:5},404);await action({type:'chat',text:'Je veux 200 Mbps'});A.equal(state.upgrade.amount,5000);console.log('PASS réparation vérifiée, avis propriétaire persistant, aucun doublon ni accès croisé et reprise après incident');
 A.deepEqual(errors,[]);console.log('PASS aucune erreur serveur');
}finally{await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});

