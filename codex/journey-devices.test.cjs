'use strict';
// Gestion des appareils par le client : limiter, bloquer, retirer. Base éphémère, contrôles côté serveur.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs');
test('Le client limite, bloque et retire un appareil ; les appareils protégés se limitent mais ne se coupent pas, les débits hors liste sont refusés',async()=>{
 const server=createGuardianServer({db:':memory:'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'appareils@example.test',password:'appareils-password-123',name:'Test Appareils'})});
  assert.equal(response.status,200);const {user}=await response.json(),cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const request=async(path,body)=>{const res=await fetch(base+'/api'+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
  let state=(await request('/journey/start',{})).data.state;
  const send=async(data,status=200)=>{const r=await request('/journey/action',{type:'device',version:state.version,...data});assert.equal(r.status,status,JSON.stringify(r.data));if(status===200)state=r.data.state;return r;};
  const tv=()=>state.devices.find(d=>d.id==='tv');
  await send({id:'tv',action:'limit',mbps:10},400);
  await send({id:'tv',action:'limit',mbps:1,confirm:true},400);
  await send({id:'tv',action:'limit',mbps:10,confirm:true});assert.equal(tv().limit,10);assert.ok(tv().mbps<=10);assert.ok(tv().until>Date.now()+86400000,'La limite choisie reste en place');
  await send({id:'tv',action:'unlimit',confirm:true});assert.equal(tv().limit,null);assert.equal(tv().mbps,20);
  await send({id:'tv',action:'block',confirm:true});assert.equal(tv().blocked,true);assert.equal(tv().mbps,0);
  await send({id:'tv',action:'limit',mbps:5,confirm:true},409);
  await send({id:'tv',action:'unblock',confirm:true});
  // Appareil protégé : on peut réduire son débit, jamais le couper ni le retirer.
  for(const action of ['remove','block'])await send({id:'phone',action,confirm:true},403);
  await send({id:'phone',action:'limit',mbps:5,confirm:true});assert.equal(state.devices.find(d=>d.id==='phone').limit,5);
  await send({id:'phone',action:'unlimit',confirm:true});assert.equal(state.devices.find(d=>d.id==='phone').limit,null);
  await send({id:'ps5',action:'remove'},400);
  await send({id:'ps5',action:'remove',confirm:true});assert.equal(state.devices.some(d=>d.id==='ps5'),false);assert.match(state.audit[0].action,/device.remove/);
  await send({id:'ps5',action:'block',confirm:true},404);
 }finally{server.close();}
});
