'use strict';
// Données fictives en mémoire uniquement : permet de tester le cockpit sans toucher aux comptes réels.
const {createGuardianServer}=require('./pilot-server.cjs');
const O=require('./operator-store.cjs'),N=require('./noc-store.cjs'),J=require('./journey-store.cjs');
(async()=>{
 const server=createGuardianServer({db:':memory:',onError:error=>console.error(error)}),s=server.guardianStore;
 const actors={};
 for(const [key,name,role] of [['client','Awa · cliente test',null],['director','Direction · test','admin'],['support','Support · test','agent'],['supervisor','Supervision · test','supervisor'],['field','Awa · terrain test',null]]){
  actors[key]=(await s.register({email:key+'@example.test',password:'guardian-fixture-123',name})).user;
  if(role)O.grant(s,key+'@example.test',role);
 }
 J.put(s,actors.client.id,J.seed());N.join(s,actors.client.id,{segment:'YOP-07',consent:true});
 s.run('INSERT INTO homes VALUES(?,?,?,?,?)','fixture-home',actors.client.id,'Bureau de développement',Date.now(),'{}');
 s.run('INSERT INTO members VALUES(?,?,?)','fixture-home',actors.client.id,'owner');
 for(const [tid,subject,detail,shared] of [['fixture-shared','Visioconférences instables','Notre bureau compte six développeurs. Les téléchargements sont légitimes ; préserver les appels en cours.',true],['fixture-private','Dossier privé non transmis','Ce dossier ne doit jamais apparaître chez l’opérateur.',false]]){
  s.run('INSERT INTO tickets VALUES(?,?,?,?,?,?)',tid,'fixture-home',Date.now(),'À transmettre',subject,JSON.stringify({detail,latest:[]}));
  if(shared)O.share(s,actors.client.id,'fixture-home',{id:tid,share:true,consent:true});
 }
 N.operate(s,actors.director.id,{type:'simulate',segment:'YOP-07',scenario:'fiber'});
 N.operate(s,actors.director.id,{type:'simulate',segment:'COC-03',scenario:'power'});
 // Un vrai signalement local n'est jamais assimilé à une télémétrie de production.
 J.reportReal(s,actors.client.id,{consent:true,zone:'Marcory · rue déclarée',description:'Un coffret ouvert observé depuis le trottoir, sans toucher au matériel.',lat:5.35,lon:-4.06,photo:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='});
 N.scan(s);
 require('./noc-workspace.cjs').action(s,actors.director.id,{type:'field-account',email:'field@example.test',technicianId:'awa',enabled:true,confirm:true});
 server.listen(0,'127.0.0.1',()=>console.log('COCKPIT UI ISOLÉ : http://localhost:'+server.address().port+'/codex/?portal=moov\nComptes fictifs : director / support / supervisor / field / client @example.test ; mot de passe : guardian-fixture-123'));
})().catch(error=>{console.error(error);process.exitCode=1;});
