'use strict';
// Instance locale éphémère pour essais navigateur, jamais la base réelle.
const {createGuardianServer}=require('./pilot-server.cjs'),J=require('./journey-store.cjs');
(async()=>{const server=createGuardianServer({db:':memory:',onError:e=>console.error(e.message)});
 const {user}=await server.guardianStore.register({email:'scenario@example.test',password:'scenario-password-123',name:'Test Scénarios'});J.put(server.guardianStore,user.id,J.seed());
 await server.guardianStore.register({email:'noc@example.test',password:'noc-password-123',name:'Responsable NOC'});require('./operator-store.cjs').grant(server.guardianStore,'noc@example.test','admin');
 server.listen(0,'127.0.0.1',()=>console.log('TEST UI ISOLÉ : http://127.0.0.1:'+server.address().port+'/codex/'));
})().catch(e=>{console.error(e);process.exitCode=1;});
