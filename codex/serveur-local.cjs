if (require.main === module) {
  const fs = require('node:fs');
  const host=process.env.GUARDIAN_HOST||'127.0.0.1',port=Number(process.env.GUARDIAN_PORT||8186);
  const tls=process.env.GUARDIAN_TLS_KEY&&process.env.GUARDIAN_TLS_CERT?{key:fs.readFileSync(process.env.GUARDIAN_TLS_KEY),cert:fs.readFileSync(process.env.GUARDIAN_TLS_CERT)}:null;
  if(host!=='127.0.0.1'&&(!tls||!process.env.GUARDIAN_ORIGIN))throw new Error('Accès réseau : TLS et GUARDIAN_ORIGIN sont requis.');
  const pilot=require('./pilot-server.cjs').createGuardianServer({tls,origin:process.env.GUARDIAN_ORIGIN,db:process.env.GUARDIAN_DB,onError:e=>console.error('Erreur serveur :',e.message)});
  pilot.on('error',e=>{console.error(e.message);process.exitCode=1;});
  pilot.listen(port,host,()=>console.log('Fibre Guardian : '+(process.env.GUARDIAN_ORIGIN||'http://127.0.0.1:'+port)+'/codex/ — SQLite local ; Ctrl+C pour arrêter.'));
}
