'use strict';
// Régression serveur, base éphémère : aucun compte ou historique de l'installation n'est touché.
const assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs');
const J=require('./journey-store.cjs');
(async()=>{
 const server=createGuardianServer({db:':memory:'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'scenario@example.test',password:'scenario-password-123',name:'Test Scénarios'})});
  assert.equal(response.status,200);const {user}=await response.json(),cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const request=async(path,body)=>{const res=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};};
  let state=(await request('/journey/start',{})).data.state;
  const action=async data=>{const r=await request('/journey/action',{version:state.version,...data});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data.state;return state;};
  for(const [value,capacity,connected,health] of [['normal',100,4,'stable'],['download',100,4,'dégradée'],['slow',12,4,'dégradée'],['devices',100,6,'stable']]){
   await action({type:'scenario',value});assert.equal(state.scenario,value);assert.equal(state.metrics.capacity,capacity);assert.equal(state.metrics.connected,connected);assert.equal(state.metrics.state,health);assert.ok(state.metrics.used<=capacity+.2);if(value==='download')assert.ok(state.devices.find(d=>d.id==='ps5').mbps>70);assert.equal((await request('/journey/state')).data.state.scenario,value);console.log('PASS bouton/API/persistance : '+value);
  }
  await action({type:'device',id:'guest-1',action:'block',confirm:true});const count=state.notifications.length;
  await action({type:'scenario',value:'devices'});assert.equal(state.devices.find(d=>d.id==='guest-1').blocked,true);assert.equal(state.metrics.connected,5);assert.equal(state.notifications.length,count);console.log('PASS répétition : blocage conservé, aucun doublon d’alerte');
  await action({type:'device',id:'guest-1',action:'unblock',confirm:true});await action({type:'baseline'});assert.equal(state.usual,6);
  await action({type:'scenario',value:'normal'});await action({type:'scenario',value:'devices'});assert.equal(state.notifications.length,count);console.log('PASS référence 6 : pas de fausse alerte pour 6 appareils');
  const raw=J.get(server.guardianStore,user.id);raw.usual=2;J.put(server.guardianStore,user.id,raw);
  await action({type:'scenario',value:'normal'});await action({type:'scenario',value:'devices'});assert.match(state.notifications[0].body,/6 appareils au lieu des 2 habituels/);console.log('PASS chiffres d’alerte issus des données');
  await action({type:'scenario',value:'download'});await action({type:'baseline'});await action({type:'chat',text:'Gaming'});assert.ok(state.proposal);const old=state.proposal.id;
  await action({type:'scenario',value:'slow'});assert.equal(state.proposal,null);assert.equal((await request('/journey/action',{type:'apply',id:old,confirm:true,version:state.version})).status,409);console.log('PASS proposition périmée après changement de scénario refusée');
  await action({type:'scenario',value:'download'});await action({type:'chat',text:'Gaming'});const before=state.devices.find(d=>d.id==='ps5').mbps;await action({type:'apply',id:state.proposal.id,confirm:true});assert.ok(state.devices.find(d=>d.id==='ps5').mbps>before);assert.equal(state.devices.find(d=>d.id==='tv').limit,5);await action({type:'restore'});assert.equal(state.devices.find(d=>d.id==='tv').limit,null);console.log('PASS diagnostic, accord QoS, gain de débit et annulation');
  const denied=await request('/journey/action',{type:'device',id:'phone',action:'block',confirm:true,version:state.version});assert.equal(denied.status,403);
  const stale=await request('/journey/action',{type:'scenario',value:'normal',version:-1});assert.equal(stale.status,409);console.log('PASS protections appareil et état concurrent conservées');
  const faulty=J.get(server.guardianStore,user.id);faulty.incidents.push({id:'fault',segment:faulty.segment,status:'reported'});J.put(server.guardianStore,user.id,faulty);
  await action({type:'scenario',value:'normal'});assert.equal(state.metrics.capacity,0);assert.equal(state.metrics.state,'panne');console.log('PASS incident de zone prioritaire : jamais de faux rétablissement');
 }finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
