'use strict';
// Créneau de dépannage : le client choisit quand le technicien passe, le change tant que personne n'est parti,
// un créneau manqué est signalé (client prévenu une seule fois, Superviseur), et les pannes de quartier n'ont pas de rendez-vous.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');
const RV=require('./rendezvous.cjs');
const HOUR=3600000,DAY=24*HOUR;

async function setup(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);RV.migrate(s);const ids={};
 for(const n of ['awa','yao','fatou']){const u=(await s.register({email:n+'@example.test',name:n==='awa'?'Awa Koné':n,password:'rendezvous-password-123'})).user;ids[n]=u.id;}
 operator.grant(s,'fatou@example.test','agent');
 for(const u of [ids.awa,ids.yao])journey.put(s,u,journey.seed());
 return {s,ids};
}
function dossier(s,uid,iid,status,at,source='customer_report'){
 s.run("INSERT INTO noc_incidents(id,reporter,source,mode,status,title,description,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",iid,uid,source,'demo',status,'Internet coupé','Test',at,at);
}
const view=(s,uid,iid,now)=>RV.decorate(s,uid,{incidents:[{id:iid}]},now).incidents[0].rendezvous;

test('Le client choisit son créneau (jamais le dimanche, jamais dans le passé) puis peut le changer',async()=>{
 const {s,ids}=await setup(),fri=Date.UTC(2026,10,27,13);   // vendredi 13 h : l'après-midi n'a pas commencé
 dossier(s,ids.awa,'inc-1','reported',fri);
 let v=view(s,ids.awa,'inc-1',fri);
 assert.equal(v.current,null);assert.equal(v.canChange,true);
 assert.deepEqual(v.choices.map(c=>c.label),['vendredi 27 novembre','samedi 28 novembre','lundi 30 novembre']);
 assert.deepEqual(v.choices[0].slots.map(x=>x.id),['apres'],'le matin de vendredi est passé');
 assert.throws(()=>RV.choose(s,ids.awa,{incident:'inc-1',day:v.choices[0].day,slot:'matin'},fri),/créneaux proposés/);
 assert.throws(()=>RV.choose(s,ids.yao,{incident:'inc-1',day:v.choices[1].day,slot:'matin'},fri),/introuvable/,'seul le client du dossier choisit');
 RV.choose(s,ids.awa,{incident:'inc-1',day:v.choices[1].day,slot:'matin'},fri);
 v=view(s,ids.awa,'inc-1',fri);assert.equal(v.current.label,'samedi 28 novembre, entre 8 h et 12 h');assert.equal(v.current.late,false);
 assert.equal(journey.get(s,ids.awa).notifications[0].title,'Rendez-vous noté');
 RV.choose(s,ids.awa,{incident:'inc-1',day:v.choices[2].day,slot:'apres'},fri+1000);
 assert.equal(view(s,ids.awa,'inc-1',fri).current.label,'lundi 30 novembre, entre 14 h et 18 h');
 // Le technicien est parti : on ne change plus.
 s.run("UPDATE noc_incidents SET status='en_route' WHERE id='inc-1'");
 assert.equal(view(s,ids.awa,'inc-1',fri).canChange,false);
 assert.throws(()=>RV.choose(s,ids.awa,{incident:'inc-1',day:v.choices[1].day,slot:'matin'},fri),/déjà parti/);
});

test('Créneau passé sans technicien : en retard chez le client (prévenu une fois) et dans le Superviseur ; nouveau créneau possible',async()=>{
 const {s,ids}=await setup(),mon=Date.UTC(2026,10,23,7);
 dossier(s,ids.awa,'inc-2','dispatched',mon);
 RV.choose(s,ids.awa,{incident:'inc-2',day:Date.UTC(2026,10,23),slot:'matin'},mon);
 const after=Date.UTC(2026,10,23,12,30);
 let v=view(s,ids.awa,'inc-2',after);
 assert.equal(v.current.late,true);
 const notes=()=>journey.get(s,ids.awa).notifications.filter(n=>n.title==='Le technicien n’est pas venu à l’heure').length;
 assert.equal(notes(),1);view(s,ids.awa,'inc-2',after+60000);assert.equal(notes(),1,'prévenu une seule fois');
 assert.throws(()=>RV.list(s,ids.awa,after),'le client ne voit pas la liste de l’équipe');
 const l=RV.list(s,ids.fatou,after);assert.equal(l.late,1);assert.equal(l.items[0].name,'Awa Koné');assert.equal(l.items[0].late,true);
 RV.choose(s,ids.awa,{incident:'inc-2',day:v.choices.find(c=>c.slots.some(x=>x.id==='apres')).day,slot:'apres'},after);
 assert.equal(view(s,ids.awa,'inc-2',after).current.late,false);
 // Le technicien arrive : plus de retard ni de rendez-vous à afficher.
 s.run("UPDATE noc_incidents SET status='on_site' WHERE id='inc-2'");
 assert.equal(view(s,ids.awa,'inc-2',Date.UTC(2026,10,23,19)),null);
 assert.equal(RV.list(s,ids.fatou,after).items.length,0);
});

test('Panne de quartier : pas de rendez-vous, la réparation se fait dans la rue',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,9);
 dossier(s,ids.awa,'inc-3','approved',t,'telemetry');
 assert.equal(view(s,ids.awa,'inc-3',t),null);
 assert.throws(()=>RV.choose(s,ids.awa,{incident:'inc-3',day:Date.UTC(2026,10,25),slot:'matin'},t),/dans la rue/);
});

test('Centre d’opérations : le rendez-vous du client s’affiche sur son dossier',async()=>{
 const {s,ids}=await setup(),t=Date.UTC(2026,10,24,7);
 dossier(s,ids.awa,'inc-4','approved',t);
 RV.choose(s,ids.awa,{incident:'inc-4',day:Date.UTC(2026,10,24),slot:'matin'},t);
 const d=RV.forTeam(s,{incidents:[{id:'inc-4',status:'approved'},{id:'autre',status:'approved'}]},Date.UTC(2026,10,24,13));
 assert.equal(d.incidents[0].rendezvous.late,true);assert.match(d.incidents[0].rendezvous.label,/mardi 24 novembre/);
 assert.equal(d.incidents[1].rendezvous,null);
});
