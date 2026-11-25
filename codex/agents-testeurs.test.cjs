'use strict';
// Défauts trouvés par les agents testeurs (25/11/2026) : signaler une panne sans photo, et Guardian qui explique la facture
// au lieu de proposer un autre forfait.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs'),journey=require('./journey-store.cjs'),noc=require('./noc-store.cjs');

async function client(){
 const s=new Store(':memory:');operator.migrate(s);journey.migrate(s);noc.migrate(s);
 const u=(await s.register({email:'aya@example.test',name:'Aya',password:'agents-testeurs-12'})).user;
 journey.put(s,u.id,journey.seed());noc.join(s,u.id,{segment:'YOP-07',consent:true});return {s,uid:u.id};
}

test('Signaler une panne : la photo est facultative, une photo mal formée reste refusée',async()=>{
 const {s,uid}=await client();
 const base={type:'report',consent:true,zone:'Marcory · Zone 4',description:'Plus d’internet depuis ce matin.',lat:5.3,lon:-4};
 assert.throws(()=>journey.act(s,uid,{...base,photo:'pas une photo',version:journey.get(s,uid).version}),/Photo/);
 journey.act(s,uid,{...base,version:journey.get(s,uid).version});
 const st=journey.get(s,uid),incident=st.incidents.at(-1);
 assert.equal(incident.description,'Plus d’internet depuis ce matin.');
 assert.equal(incident.photo,null);
});

test('« Pourquoi ma facture a augmenté ? » : Guardian donne le montant du mois, sans vendre un forfait',async()=>{
 for(const t of ['Pourquoi ma facture a augmenté ?','ma facture est plus chère','pourquoi je paye plus ce mois'])assert.equal(journey.intent(t),'hausse',t);
 assert.equal(journey.intent('combien je paie'),'prix');assert.equal(journey.intent('je veux plus de débit'),'upgrade');
 const {s,uid}=await client();
 journey.act(s,uid,{type:'chat',text:'Pourquoi ma facture a augmenté ?',version:journey.get(s,uid).version});
 const answer=journey.get(s,uid).messages.filter(m=>m.role==='assistant').at(-1).text;
 assert.match(answer,/20\s000 FCFA/);assert.match(answer,/n’a pas changé/);assert.doesNotMatch(answer,/Changer de forfait/);
});
