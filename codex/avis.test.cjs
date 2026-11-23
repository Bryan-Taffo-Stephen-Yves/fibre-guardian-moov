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

test('Suivi de satisfaction : note par quartier et par technicien, semaine après semaine, et repère « À surveiller »',async()=>{
 const {s,ids}=await setup(),now=Date.UTC(2026,10,11,15),DAY=24*HOUR;// mercredi 11 novembre
 assert.equal(AV.weekStart(now),Date.UTC(2026,10,9),'les semaines commencent le lundi');
 s.run("INSERT INTO noc_incidents(id,segment_id,source,mode,status,title,description,created,updated,technician) VALUES('inc-y','YOP-07','telemetry','demo','resolved','Coupure','Test',?,?,'koffi')",now-3*HOUR,now-2*HOUR);
 s.run('INSERT INTO noc_feedback VALUES(?,?,?,?,?)',ids.awa,'inc-y',2,'Encore lent le soir',now-HOUR);
 s.run('INSERT INTO noc_feedback VALUES(?,?,?,?,?)',ids.yao,'inc-y',4,'',now-HOUR);
 // Semaine dernière à Niangon : 4,5 ; il y a 3 semaines au Plateau (le quartier porte le nom de la commune).
 const old=(zone,tech,rating,at)=>s.run('INSERT INTO avis_historique VALUES(?,?,?,?,?,?)',zone+at+rating+Math.random(),zone,tech,rating,'',at);
 old('Yopougon · Niangon','Koffi N’Guessan',5,now-7*DAY);old('Yopougon · Niangon','Koffi N’Guessan',4,now-7*DAY);
 old('Plateau','Ibrahim Traoré',5,now-21*DAY);old('Plateau','Ibrahim Traoré',4,now-14*DAY);
 old('Abobo · Abobo Gare','Awa Kouamé',5,now-70*DAY);// plus de 8 semaines : hors du suivi
 const st=AV.stats(s,ids.kader,now),su=st.suivi;
 assert.equal(su.weeks.length,8);assert.equal(su.weeks[7],Date.UTC(2026,10,9));
 assert.deepEqual(su.overall[7],{average:3,count:2});assert.deepEqual(su.overall[6],{average:4.5,count:2});
 const yop=su.zones.find(z=>z.name==='Yopougon · Niangon');
 assert.equal(yop.average,3);assert.equal(yop.delta,-1.5);assert.equal(yop.week,7);assert.equal(yop.watch,true);
 assert.equal(su.zones[0].name,'Yopougon · Niangon','le quartier à surveiller est en tête');
 const pla=su.zones.find(z=>z.name==='Plateau');assert.equal(pla.average,4);assert.equal(pla.delta,-1);assert.equal(pla.week,5);
 assert.ok(!su.zones.some(z=>z.name.startsWith('Abobo')),'un avis de plus de 8 semaines sort du suivi');
 assert.deepEqual(su.techs.map(t=>t.name).sort(),['Ibrahim Traoré','Koffi N’Guessan']);
 // L'historique ne crée jamais de rappel : seul l'avis de 2 sur 5 de cette semaine en crée un.
 assert.equal(st.open.length,1);
});

test('Historique de la démo : 7 semaines passées par quartier, Abobo en baisse, aucun rappel créé',async()=>{
 const {s,ids}=await setup(),now=Date.UTC(2026,10,12,15);
 const n=AV.history(s,now);
 assert.equal(n,AV.HISTORY.reduce((k,[, ,w])=>k+w.flat().length,0));
 assert.ok(s.get('SELECT max(at) AS m FROM avis_historique').m<AV.weekStart(now),'tout l’historique est avant cette semaine');
 const st=AV.stats(s,ids.kader,now);
 assert.equal(st.open.length,0,'l’historique ne crée aucun rappel');
 const abo=st.suivi.zones.find(z=>z.name==='Abobo · Abobo Gare');
 assert.equal(abo.watch,true);assert.ok(abo.delta<0);assert.equal(st.suivi.zones[0].name,'Abobo · Abobo Gare');
 assert.equal(st.suivi.zones.find(z=>z.name==='Cocody · Cité des Arts').watch,false);
 assert.equal(st.count,0,'les chiffres du haut ne comptent que les vrais avis');assert.deepEqual(st.topics,[]);
 assert.notDeepEqual(st.suivi.techs.map(t=>t.average),st.suivi.zones.map(z=>z.average),'les onglets Techniciens et Quartiers ne se répètent pas');
 assert.throws(()=>AV.stats(s,ids.awa,now),{status:403},'un client ne voit pas le suivi');
});
