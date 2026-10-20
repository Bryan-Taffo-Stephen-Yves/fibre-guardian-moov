'use strict';
// Lien de suivi du technicien : créé par un client concerné, lisible sans compte, sans données personnelles, expirant.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createGuardianServer}=require('./pilot-server.cjs'),O=require('./operator-store.cjs');
test('Le lien de suivi se partage, se lit sans compte et ne donne que le trajet',async()=>{
 const server=createGuardianServer({db:':memory:'});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,s=server.guardianStore;
 try{
  const call=async(c,path,body,expected=200)=>{const res=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:c?.cookie||'','X-CSRF-Token':c?.csrf||''},body:body?JSON.stringify(body):undefined});const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));return data;};
  async function account(name,role){const password='test-password-'+name;let r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@example.test',password,name})});let data=await r.json();if(role){O.grant(s,name+'@example.test',role);r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:name+'@example.test',password})});data=await r.json();}return {csrf:data.user.csrf,cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};}
  const admin=await account('director','admin'),client=await account('client'),other=await account('other');
  await call(client,'/noc/join',{segment:'YOP-07',consent:true});await call(other,'/noc/join',{segment:'COC-03',consent:true});
  await call(admin,'/noc/action',{type:'simulate',segment:'YOP-07',scenario:'fiber'});
  let i=(await call(admin,'/noc/overview')).incidents[0];const act=async(type,extra={})=>{i=(await call(admin,'/noc/overview')).incidents.find(v=>v.id===i.id);await call(admin,'/noc/action',{type,id:i.id,version:i.version,...extra});};
  await act('approve',{note:'Plan vérifié'});await act('dispatch',{technician:'koffi',safety:true});await act('advance');
  await call(null,'/track/link',{id:i.id},401);
  await call(other,'/track/link',{id:i.id},404);
  const {url}=await call(client,'/track/link',{id:i.id});assert.match(url,/^\/codex\/\?suivi=[A-Za-z0-9_-]{20,40}$/);
  const token=url.split('=')[1],view=await call(null,'/track/'+token);
  assert.equal(view.incident.status,'en_route');assert.ok(view.incident.position.durationMs>0);assert.equal(view.incident.technician.name,'Koffi N’Guessan');
  const text=JSON.stringify(view);assert.doesNotMatch(text,/client@example|"title"|feedback|public_text/,'Ni compte, ni dossier, ni avis dans la vue publique');
  await call(null,'/track/'+token.slice(0,-2)+'xx',null,404);await call(null,'/track/court',null,404);
  s.run('UPDATE noc_track_links SET expires=?',Date.now()-1);await call(null,'/track/'+token,null,404);
 }finally{server.close();}
});
