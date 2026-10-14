'use strict';
// Tests isolés : aucun accès à la base locale de l'utilisateur.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('./pilot-store.cjs'),J=require('./journey-store.cjs'),U=require('./journey-usage.cjs');
const {createGuardianServer}=require('./pilot-server.cjs');
const approx=(value,expected)=>assert.ok(Math.abs(value-expected)<.001,`${value} !== ${expected}`);
function one(mbps){const st=J.seed();st.devices=[{id:'mac',name:'Poste développement',demand:mbps,protected:true,recognized:true}];return st;}
(async()=>{
 const server=createGuardianServer({db:':memory:'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port,s=server.guardianStore;
  const register=async email=>{const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'usage-password-123',name:'Test usage'})});assert.equal(r.status,200);return {...await r.json(),cookie:r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};};
  const a=await register('usage-a@example.test'),b=await register('usage-b@example.test');
  const request=async(account,url,data,csrf=true)=>{const r=await fetch(base+'/api'+url,{method:data?'POST':'GET',headers:{Cookie:account?.cookie||'','Content-Type':'application/json',...(csrf?{'X-CSRF-Token':account?.user.csrf||''}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
  assert.equal((await request(null,'/journey/usage')).status,401);assert.equal((await request(a,'/journey/usage')).status,409);
  let state=(await request(a,'/journey/start',{})).data.state;await request(b,'/journey/start',{});
  assert.equal((await request(a,'/journey/usage?window=bad')).status,400);console.log('PASS API : authentification, parcours requis et période validée');
  const time=Date.UTC(2026,9,11,12,0,0),st=one(80);
  U.clear(s,a.user.id);U.observe(s,a.user.id,st,time);let result=U.read(s,a.user.id,'24h',st,time);
  assert.equal(result.summary.bytes,null);assert.equal(result.summary.coverageRatio,0);assert.equal(result.buckets.every(v=>v.bytes===null),true);
  U.observe(s,a.user.id,st,time+10000);result=U.read(s,a.user.id,'1h',st,time+10000);
  approx(result.summary.bytes,100000000);assert.equal(result.summary.observedMs,10000);assert.equal(result.devices[0].currentMbps,80);console.log('PASS conversion exacte Mbps → octets ; aucun historique inventé');
  st.devices[0].blocked=true;U.observe(s,a.user.id,st,time+10000);U.observe(s,a.user.id,st,time+20000);result=U.read(s,a.user.id,'1h',st,time+20000);
  assert.equal(result.devices[0].currentMbps,0);approx(result.summary.bytes,100000000);assert.equal(result.summary.observedMs,20000);console.log('PASS blocage : débit zéro et volume historique conservé');
  U.observe(s,a.user.id,st,time+100000);result=U.read(s,a.user.id,'1h',st,time+100000);assert.equal(result.summary.observedMs,20000);assert.equal(result.buckets.filter(v=>v.bytes===null).length,59);console.log('PASS interruption >30 secondes : période inconnue, aucun octet ajouté');
  U.clear(s,a.user.id);const limited=one(20);limited.devices[0].limit=2;limited.devices[0].until=time+5000;
  U.observe(s,a.user.id,limited,time);U.observe(s,a.user.id,limited,time+10000);result=U.read(s,a.user.id,'1h',limited,time+10000);
  approx(result.summary.bytes,13750000);assert.equal(result.devices[0].currentMbps,20);console.log('PASS plancher QoS 2 Mbps et expiration au milieu d’un intervalle');
  U.clear(s,a.user.id);const midnight=Date.UTC(2026,9,12),low=one(8);U.observe(s,a.user.id,low,midnight-10000);U.observe(s,a.user.id,low,midnight+10000);
  result=U.read(s,a.user.id,'7d',low,midnight+10000);approx(result.summary.bytes,20000000);const observed=result.buckets.filter(v=>v.bytes!==null);assert.equal(observed.length,2);approx(observed[0].bytes,10000000);approx(observed[1].bytes,10000000);approx(result.devices.reduce((sum,d)=>sum+(d.bytes||0),0),result.summary.bytes);console.log('PASS jour UTC : volumes cohérents entre appareils, total et courbe');
  U.clear(s,a.user.id);const demand=one(400);U.observe(s,a.user.id,demand,time);U.observe(s,a.user.id,demand,time+10000);result=U.read(s,a.user.id,'1h',demand,time+10000);assert.equal(result.devices[0].currentMbps,100);approx(result.summary.bytes,125000000);
  demand.sharedIncident={id:'fault'};U.observe(s,a.user.id,demand,time+10000);U.observe(s,a.user.id,demand,time+20000);result=U.read(s,a.user.id,'1h',demand,time+20000);assert.equal(result.devices[0].currentMbps,100);assert.equal(result.advice.kind,'incident');console.log('PASS capacité partagée et incident prioritaire sans faux débit zéro');
  const context={type:'usage-context',value:'developers',confirm:true,version:state.version};
  assert.equal((await request(a,'/journey/action',context,false)).status,403);assert.equal((await request(a,'/journey/action',{...context,confirm:false})).status,400);
  const saved=await request(a,'/journey/action',context);assert.equal(saved.status,200);state=saved.data.state;assert.equal(state.usageContext,'developers');assert.equal(state.plan.price,25000);assert.deepEqual(state.devices.map(d=>[d.blocked,d.limit]),J.seed().devices.map(()=>[undefined,null]));
  const after=await request(a,'/journey/usage?window=7d'),other=await request(b,'/journey/usage?window=7d&user_id='+a.user.id);assert.equal(after.data.context,'developers');assert.equal(other.data.context,'home');assert.ok(other.data.summary.bytes===null||other.data.summary.bytes<10000000);console.log('PASS contexte professionnel confirmé, persistant et isolé ; aucun achat/blocage');
  const action=async body=>{const r=await request(a,'/journey/action',{...body,version:state.version});assert.equal(r.status,200,JSON.stringify(r.data));state=r.data.state;};
  await action({type:'chat',text:'Gaming'});assert.equal(state.proposal,null);assert.match(state.messages.at(-1).text,/légitimement/);
  await action({type:'chat',text:'Pour ma visio, la TV peut attendre'});assert.deepEqual(state.proposal.limits.map(d=>d.id),['tv']);const proposal=state.proposal.id;assert.ok(state.proposal.limits.every(d=>d.mbps>=2));
  await action({type:'chat',text:'Pour ma visio ne limite pas la TV'});assert.equal(state.proposal,null);
  await action({type:'chat',text:'Pour ma visio, la TV peut attendre'});assert.ok(state.proposal);
  await action({type:'usage-context',value:'home',confirm:true});assert.equal(state.proposal,null);
  assert.equal((await request(a,'/journey/action',{type:'apply',id:proposal,confirm:true,version:state.version})).status,409);console.log('PASS assistant professionnel : priorité à préciser, sélection explicite, négation et proposition périmée');
  assert.equal((await request(a,'/journey/action',{type:'device',id:'mac',action:'block',confirm:true,version:state.version})).status,403);
  const reset=await request(a,'/journey/action',{type:'reset',version:state.version});assert.equal(reset.status,200);assert.equal(s.get('SELECT count(*) AS n FROM journey_usage_minutes WHERE user_id=?',a.user.id).n,0);console.log('PASS appareil protégé et réinitialisation du seul historique de démo');
 }finally{await new Promise(resolve=>server.close(resolve));}
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'guardian-usage-check-')),db=path.join(temp,'test.sqlite');let disk;
 try{
  disk=new Store(db);J.migrate(disk);const {user}=await disk.register({email:'persist@example.test',password:'usage-password-123',name:'Persist'}),st=one(8),now=Date.now();U.observe(disk,user.id,st,now);U.observe(disk,user.id,st,now+10000);disk.close();disk=new Store(db);J.migrate(disk);approx(U.read(disk,user.id,'1h',st,now+10000).summary.bytes,10000000);console.log('PASS historique SQLite conservé après réouverture');
 }finally{disk?.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
