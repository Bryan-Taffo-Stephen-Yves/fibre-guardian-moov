'use strict';
// Fibre Voice, centre des avis (thème 8) : une note basse crée un rappel sous 24 h et prévient le client,
// les commentaires sont classés par sujet (y compris en nouchi), et seule l'équipe Moov voit ces chiffres.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const AV=require('./avis.cjs'),WEL=require('./welcome.cjs');
const HOUR=3600000;

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);WEL.migrate(s);AV.migrate(s);const ids={};
 for(const n of ['awa','yao','fatou','kader']){const u=(await s.register({email:n+'@example.test',name:n==='awa'?'Awa Koné':n,password:'avis-password-123'})).user;ids[n]=u.id;}
 operator.grant(s,'fatou@example.test','supervisor');operator.grant(s,'kader@example.test','agent');
 for(const u of [ids.awa,ids.yao])journey.put(s,u,journey.seed());
 return {s,ids};
}
// Une intervention terminée par Koffi, notée par le client (les tables habituelles, sans passer par l'écran).
function rate(s,uid,iid,rating,comment,at){
 if(!s.get('SELECT 1 FROM noc_incidents WHERE id=?',iid))s.run("INSERT INTO noc_incidents(id,source,mode,status,title,description,created,updated,technician) VALUES(?,?,?,?,?,?,?,?,?)",iid,'telemetry','demo','resolved','Coupure fibre','Test',at-2*HOUR,at-HOUR,'koffi');
 s.run('INSERT INTO noc_feedback VALUES(?,?,?,?,?)',uid,iid,rating,comment,at);
}

test('Une note de 1 ou 2 crée un seul rappel sous 24 h et le client est prévenu',async()=>{
 const {s,ids}=await setup(),now=Date.UTC(2026,10,10,9);
 rate(s,ids.awa,'inc-1',2,'Le technicien est arrivé en retard, on a attendu toute la matinée',now-HOUR);
 rate(s,ids.yao,'inc-1',5,'Très poli et rapide, merci',now-HOUR);
 assert.equal(AV.sync(s,now),1);assert.equal(AV.sync(s,now),0,'un seul rappel par avis');
 const n=journey.get(s,ids.awa).notifications[0];
 assert.equal(n.title,'Moov vous rappelle');assert.match(n.body,/conseiller Moov vous appelle avant/);
 assert.ok(!journey.get(s,ids.yao).notifications.some(x=>x.title==='Moov vous rappelle'),'un client content n’est pas rappelé');
 const st=AV.stats(s,ids.kader,now);
 assert.equal(st.count,2);assert.equal(st.average,3.5);assert.equal(st.satisfied,50);
 assert.equal(st.open.length,1);assert.equal(st.open[0].name,'Awa K.');assert.equal(st.open[0].due,now-HOUR+24*HOUR);assert.equal(st.open[0].late,false);
 assert.equal(AV.stats(s,ids.kader,now+24*HOUR).open[0].late,true,'en retard après 24 h');
 assert.deepEqual(st.techs,[{name:'Koffi N’Guessan',average:3.5,count:2}]);
});

test('« Pas de réponse » garde le rappel ouvert ; « Réglé » le ferme ; un client reçoit 403',async()=>{
 const {s,ids}=await setup(),now=Date.UTC(2026,10,10,9);
 rate(s,ids.awa,'inc-2',1,'Internet coupe encore le soir',now);AV.sync(s,now);
 const id=AV.stats(s,ids.kader,now).open[0].id;
 let st=AV.done(s,ids.kader,{id,outcome:'absent'},now+HOUR);
 assert.equal(st.open.length,1);assert.equal(st.open[0].tries,1);assert.equal(st.open[0].due,now+5*HOUR);
 st=AV.done(s,ids.kader,{id,outcome:'regle'},now+2*HOUR);
 assert.equal(st.open.length,0);assert.equal(st.done[0].outcome,'Problème réglé au téléphone');
 assert.throws(()=>AV.done(s,ids.kader,{id,outcome:'regle'},now),{status:409});
 assert.throws(()=>AV.done(s,ids.kader,{id,outcome:'oublie'},now),{status:400});
 assert.throws(()=>AV.stats(s,ids.awa,now),{status:403});
 assert.throws(()=>AV.done(s,ids.awa,{id,outcome:'regle'},now),{status:403});
});

test('Les commentaires qui reviennent sont classés par sujet, compliment ou reproche, y compris en nouchi',()=>{
 assert.deepEqual(AV.topicsOf('Le technicien est arrivé en retard'),['retard']);
 assert.ok(AV.topicsOf('Internet coupe encore le soir').includes('panne'));
 assert.ok(AV.topicsOf('Il m’a bien expliqué, très gentil').includes('explications'));
 assert.ok(AV.topicsOf('Il m’a bien expliqué, très gentil').includes('politesse'));
 assert.deepEqual(AV.topicsOf('Y a fohi depuis hier'),['panne'],'nouchi : « y a fohi » = Internet est coupé');
 assert.deepEqual(AV.topicsOf(''),[]);
 assert.deepEqual(AV.tones('Très poli et il a bien expliqué, mais Internet est encore lent le soir'),[{key:'panne',bad:true},{key:'explications',bad:false},{key:'politesse',bad:false}],'un compliment dans un avis mécontent reste un compliment');
 assert.deepEqual(AV.tones('Pas très poli, il ne m’a rien expliqué').map(t=>t.bad),[true,true]);
});

test('Une installation notée 2/5 dans Fibre Welcome est aussi rappelée',async()=>{
 const {s,ids}=await setup(),now=Date.UTC(2026,10,10,9);
 s.run("INSERT INTO fibre_welcome(id,user_id,plan,commune,quartier,status,tech,rating,comment,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)",'w1',ids.yao,'fibre-100','Cocody','Angré','installe',JSON.stringify({name:'Yao Konan'}),2,'Câble qui traîne par terre, pas propre',now-DAY(),now);
 AV.sync(s,now);const st=AV.stats(s,ids.fatou,now);
 assert.equal(st.open[0].what,'Installation');assert.equal(st.open[0].tech,'Yao Konan');
 assert.deepEqual(st.topics.map(t=>t.key),['proprete']);assert.equal(st.topics[0].bad,1);
});
function DAY(){return 24*HOUR;}
