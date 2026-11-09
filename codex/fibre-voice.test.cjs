'use strict';
// Fibre Voice (thème 8) : les phrases en images sont comprises dans les trois langues, une question à la voix est comptée
// (sujet et langue seulement) et seule l'équipe Moov voit ces chiffres.
const {test}=require('node:test'),assert=require('node:assert/strict');
const langues=require('./langues.cjs'),journey=require('./journey-store.cjs'),FV=require('./fibre-voice.cjs');

function phrases(){globalThis.React=globalThis.React||{createElement(){},useState(){},useEffect(){},useRef(){}};delete require.cache[require.resolve('./fibre-voice-view.js')];require('./fibre-voice-view.js');return globalThis.FGFibreVoice;}

test('Chaque phrase en images est comprise en français, en nouchi et en dioula',()=>{
 const V=phrases();
 for(const p of V.PHRASES)for(const [lang,text] of Object.entries(p.say)){
  const m=langues.detect(text);assert.equal(m.lang,lang,text);
  assert.equal(journey.intent(m.french?text+' '+m.french:text),p.id,lang+' : « '+text+' »');
 }
});

test('« Oui » et « non » à la voix, y compris en dioula',()=>{
 const V=phrases();
 for(const t of ['Oui','oui vas-y',"d'accord",'Awɔ','ok'])assert.ok(V.YES.test(t),t);
 for(const t of ['Non','non merci','Ayi','pas maintenant'])assert.ok(V.NO.test(t),t);
 assert.equal(V.YES.test('non'),false);assert.equal(V.YES.test('Où est le technicien'),false);
});

test('Une question posée à la voix est comptée pour Moov, sans le son ni la phrase ; un client reçoit 403',async()=>{
 const {createGuardianServer}=require('./pilot-server.cjs');const srv=createGuardianServer({db:':memory:'});await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+srv.address().port;
 try{
  const res=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'fv@example.test',password:'fibre-voice-123',name:'Client FV'})});
  const {user}=await res.json(),cookie=res.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),H={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':user.csrf};
  let r=await (await fetch(base+'/api/journey/start',{method:'POST',headers:H,body:'{}'})).json();
  r=await (await fetch(base+'/api/journey/action',{method:'POST',headers:H,body:JSON.stringify({type:'chat',channel:'voix',text:'Ma connexion est gâtée deh, y a fohi',version:r.state.version})})).json();
  const answer=r.state.messages.at(-1);assert.equal(answer.role,'assistant');assert.ok(answer.text.length>10);
  assert.equal((await fetch(base+'/api/noc/voix',{headers:{Cookie:cookie}})).status,403);
 }finally{srv.close();}
});

test('Les chiffres de Moov : sujets, langues et clients sur 7 jours ; « bonjour » ne compte pas comme une demande',async()=>{
 const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs');
 const s=new Store(':memory:');operator.migrate(s);FV.migrate(s);const ids=[];
 for(const n of ['a','b','boss']){const u=(await s.register({email:n+'@example.test',name:n,password:'fibre-voice-password'})).user;ids.push(u.id);}
 operator.grant(s,'boss@example.test','supervisor');
 const now=Date.UTC(2026,10,9,12);
 FV.record(s,ids[0],{subject:'coupure',lang:'nouchi'},now);FV.record(s,ids[1],{subject:'coupure',lang:'fr'},now-3600000);
 FV.record(s,ids[1],{subject:'salut',lang:'dioula'},now);FV.record(s,ids[0],{subject:'nimporte',lang:'klingon'},now);
 FV.record(s,ids[0],{subject:'lent',lang:'fr'},now-8*86400000);
 const st=FV.stats(s,ids[2],now);
 assert.equal(st.total,4);assert.equal(st.clients,2);
 assert.deepEqual(st.subjects,[{subject:'Internet coupé',count:2},{subject:'Autre demande',count:1}]);
 assert.deepEqual(st.langs.find(l=>l.lang==='fr'),{lang:'fr',count:2},'une langue inconnue compte comme du français');
 assert.throws(()=>FV.stats(s,ids[0],now),{status:403});
 assert.deepEqual(Object.keys(s.get('SELECT * FROM voice_requests LIMIT 1')).sort(),['at','lang','subject','user_id'],'ni son ni phrase enregistrés');
});
