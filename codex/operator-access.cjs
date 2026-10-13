'use strict';
// Administration locale seulement : aucune route HTTP ne peut s'attribuer un rôle.
const fs=require('node:fs'),path=require('node:path'),{Store}=require('./pilot-store.cjs'),operator=require('./operator-store.cjs');
if(require.main===module){const [email,role,dbFile]=process.argv.slice(2),file=path.resolve(dbFile||path.join(__dirname,'.local','pilot.sqlite'));
 if(!email||!['agent','supervisor','admin','revoke'].includes(role)||!fs.existsSync(file)){console.error('Usage : node codex/operator-access.cjs <email> <agent|supervisor|admin|revoke> [base existante]');process.exitCode=1;}
 else {const store=new Store(file);try{operator.migrate(store);const result=operator.grant(store,email,role);console.log('Rôle '+result.role+' enregistré. Les sessions de ce compte sont invalidées : reconnectez-vous.');}catch(e){console.error(e.message);process.exitCode=1;}finally{store.close();}}
}
