if (require.main === module) {
  const fs = require('node:fs');
  const host=process.env.GUARDIAN_HOST||'127.0.0.1',port=Number(process.env.GUARDIAN_PORT||8186);
  const tls=process.env.GUARDIAN_TLS_KEY&&process.env.GUARDIAN_TLS_CERT?{key:fs.readFileSync(process.env.GUARDIAN_TLS_KEY),cert:fs.readFileSync(process.env.GUARDIAN_TLS_CERT)}:null;
  if(host!=='127.0.0.1'&&(!tls||!process.env.GUARDIAN_ORIGIN))throw new Error('Accès réseau : TLS et GUARDIAN_ORIGIN sont requis.');
  const path=require('node:path'),dbFile=path.resolve(process.env.GUARDIAN_DB||path.join(__dirname,'.local','pilot.sqlite'));
  const pilot=require('./pilot-server.cjs').createGuardianServer({tls,origin:process.env.GUARDIAN_ORIGIN,db:dbFile,liveTelemetry:process.env.GUARDIAN_LIVE_TELEMETRY!=='0',onError:e=>console.error('Erreur serveur :',e.message)});
  // Première ouverture : base vide, on installe la démo pré-remplie (une seule fois).
  const demo=require('./seed-demo.cjs'),ready=process.env.GUARDIAN_SEED_DEMO!=='0'&&demo.isEmpty(pilot.guardianStore)?demo.seedDemo(pilot.guardianStore,{log:console.log,credentialsFile:path.join(path.dirname(dbFile),'identifiants-demo.txt')}).then(r=>{if(r.seeded)console.log('Démo pré-remplie installée ('+r.accounts.length+' comptes, voir README).');}):Promise.resolve();
  pilot.on('error',e=>{console.error(e.message);process.exitCode=1;});
  ready.catch(e=>{console.error('Démo pré-remplie impossible :',e.message);}).then(()=>pilot.listen(port,host,()=>console.log('Fibre Guardian : '+(process.env.GUARDIAN_ORIGIN||'http://127.0.0.1:'+port)+'/codex/ — SQLite local ; Ctrl+C pour arrêter.')));
}
