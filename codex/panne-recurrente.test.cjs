'use strict';
// Panne qui revient : à la 3e coupure en 30 jours dans un quartier, chaque client a un dossier prioritaire,
// il est prévenu, un conseiller l'appelle sous 2 h, et le Centre d'opérations voit « Panne qui revient ».
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const SC=require('./service-client.cjs'),PR=require('./panne-recurrente.cjs');
const HOUR=3600000,DAY=24*HOUR;

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);SC.migrate(s);const ids={};
 for(const [n,name] of [['awa','Awa Koné'],['yao','Yao Konan'],['kader','Kader Diallo'],['bob','Bob Zadi']]){ids[n]=(await s.register({email:n+'@example.test',name,password:'panne-password-123'})).user.id;}
 operator.grant(s,'kader@example.test','agent');
 for(const u of [ids.awa,ids.yao,ids.kader,ids.bob])journey.put(s,u,journey.seed());
 const seg=s.get('SELECT id FROM noc_segments LIMIT 1').id,other=s.get('SELECT id FROM noc_segments WHERE id!=? LIMIT 1',seg).id;
 for(const u of [ids.awa,ids.yao,ids.kader])s.run('INSERT OR REPLACE INTO noc_members(user_id,segment_id) VALUES(?,?)',u,seg);
 s.run('INSERT OR REPLACE INTO noc_members(user_id,segment_id) VALUES(?,?)',ids.bob,other);
 return {s,ids,seg};
}
let n=0;
function coupure(s,seg,at,status='resolved'){n++;s.run("INSERT INTO noc_incidents(id,segment_id,source,mode,status,title,description,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",'p-'+n,seg,'telemetry','demo',status,'Coupure','Test',at,at+HOUR);return 'p-'+n;}

test('3e coupure en 30 jours : dossier prioritaire pour chaque client du quartier, appel d’un conseiller sous 2 h',async()=>{
 const {s,ids,seg}=await setup(),t=Date.UTC(2026,10,24,9);
 coupure(s,seg,t-20*DAY);coupure(s,seg,t-8*DAY);
 coupure(s,seg,t-8*DAY+2*HOUR,'false_alarm');                 // fausse alerte : ne compte pas
 coupure(s,seg,t-8*DAY+3*HOUR);                               // même coupure signalée deux fois (moins de 6 h) : une seule
 assert.equal(PR.outages(s,seg,t).length,2);
 assert.equal(PR.sweep(s,t),0,'2 coupures : rien encore');
 coupure(s,seg,t-HOUR,'en_route');
 assert.equal(PR.sweep(s,t+60000),2,'Awa et Yao ; ni le conseiller (membre de l’équipe), ni Bob (autre quartier)');
 const q=SC.queue(s,ids.kader,t+60000);
 assert.equal(q.items.length,2);assert.equal(q.items[0].kind,'panne');assert.equal(q.items[0].due,t+60000+2*HOUR);
 assert.match(q.items[0].title,/^3e coupure en 30 jours/);
 const note=journey.get(s,ids.awa).notifications[0];assert.match(note.title,/3e coupure ce mois/);assert.match(note.body,/dans les 2 heures/);
 assert.equal(SC.mine(s,ids.bob,t).items.length,0);
 // Pas de deuxième dossier pour la même période, même à la 4e coupure.
 coupure(s,seg,t+DAY);assert.equal(PR.sweep(s,t+DAY+HOUR),0);
 // Le Centre d'opérations voit la panne qui revient sur les dossiers du quartier.
 const d=PR.forTeam(s,{incidents:[{id:'x',segment_id:seg},{id:'y',segment_id:s.get('SELECT segment_id FROM noc_members WHERE user_id=?',ids.bob).segment_id}]},t+DAY+HOUR);
 assert.match(d.incidents[0].recurrent.text,/4e coupure en 30 jours/);assert.equal(d.incidents[1].recurrent,null);
});

test('Le conseiller appelle et envoie un technicien vérifier toute la ligne ; le client confirme quand c’est réparé',async()=>{
 const {s,ids,seg}=await setup(),t=Date.UTC(2026,10,24,9);
 coupure(s,seg,t-20*DAY);coupure(s,seg,t-10*DAY);const last=coupure(s,seg,t-HOUR,'en_route');
 PR.sweep(s,t);
 const id=SC.queue(s,ids.kader,t).items.find(i=>i.name==='Awa Koné').id;
 SC.act(s,ids.kader,{id,action:'take'},t);SC.act(s,ids.kader,{id,action:'result',outcome:'technicien',note:'Un technicien vérifie tout le câble de votre rue demain.'},t+HOUR);
 assert.equal(SC.mine(s,ids.awa,t+HOUR).items[0].status,'appele');
 s.run("INSERT INTO noc_events VALUES('pr-e','"+last+"',NULL,'resolved','Internet est revenu.','{}',?)",t+5*HOUR);
 const c=SC.mine(s,ids.awa,t+6*HOUR).items[0];assert.equal(c.status,'reglee');assert.equal(c.what,'Panne qui revient');
});
