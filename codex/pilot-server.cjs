'use strict';
const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Store,passwordHash,passwordMatches}=require('./pilot-store.cjs');
const operator=require('./operator-store.cjs');
const approvals=require('./approval-store.cjs');
const journey=require('./journey-store.cjs');
const noc=require('./noc-store.cjs');
const workspace=require('./noc-workspace.cjs');
const {id,token,hash,Problem,insist,word,paragraph,number,metrics,diagnose,recording,floorplan,placement}=require('./pilot-model.cjs');
const ROOT=path.resolve(__dirname,'..'),TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webmanifest':'application/manifest+json'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function body(req,max=1048576){insist((req.headers['content-type']||'').split(';')[0]==='application/json','JSON requis.',415);let size=0,parts=[];for await(const chunk of req){size+=chunk.length;insist(size<=max,'Requête trop volumineuse.',413);parts.push(chunk);}try{const v=JSON.parse(Buffer.concat(parts).toString());insist(v&&typeof v==='object'&&!Array.isArray(v),'Objet JSON requis.');return v;}catch(e){if(e instanceof Problem)throw e;throw new Problem(400,'JSON invalide.');}}
function createGuardianServer(options={}){
 const store=options.store||new Store(options.db||path.join(__dirname,'.local','pilot.sqlite'));
 operator.migrate(store);
 approvals.migrate(store);
 journey.migrate(store);
 noc.migrate(store);
 for(const r of store.all('SELECT * FROM citizen_reports'))noc.importReport(store,r.user_id,r);
 const secure=!!options.tls,configured=options.origin?new URL(options.origin).origin:null,allowedHost=configured?new URL(configured).host:null;
 const pool=crypto.randomBytes(2*1024*1024),active=new Set();
 const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 function cookie(res,value,expires){res.setHeader('Set-Cookie','guardian='+value+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+expires+(secure?'; Secure':''));}
 function auth(req){return store.authenticate((req.headers.cookie||'').match(/(?:^|;\s*)guardian=([^;]+)/)?.[1]);}
 function participant(req){const secret=(req.headers.authorization||'').replace(/^Bearer /,'');insist(secret&&secret.length<100,'Accès participant requis.',401);const p=store.get('SELECT p.*,l.home,l.closed,l.expires FROM participants p JOIN labs l ON l.id=p.lab WHERE p.secret=?',hash(secret));insist(p&&!p.revoked&&!p.closed&&p.expires>Date.now(),'Session de test expirée ou révoquée.',401);return p;}
 function snapshot(user,hid){const home=store.home(user.id,hid),samples=store.all('SELECT * FROM samples WHERE home=? ORDER BY at DESC LIMIT 250',hid).map(s=>({...s,metrics:JSON.parse(s.metrics),diagnosis:diagnose(JSON.parse(s.metrics),s.source)}));return {home,samples,labs:store.all('SELECT id,name,code,created,expires,closed FROM labs WHERE home=? ORDER BY created DESC LIMIT 20',hid).map(l=>home.role==='owner'?l:{...l,code:null}),participants:store.all('SELECT p.id,p.lab,p.name,p.joined,p.last_seen,p.revoked,p.fault,p.fault_until FROM participants p JOIN labs l ON l.id=p.lab WHERE l.home=? ORDER BY p.joined DESC LIMIT 100',hid),records:store.all('SELECT id,name,created FROM records WHERE home=? ORDER BY created DESC',hid),devices:store.all('SELECT * FROM devices WHERE home=? ORDER BY seen DESC',hid),notifications:store.all('SELECT * FROM notifications WHERE home=? ORDER BY at DESC',hid),tickets:store.all('SELECT * FROM tickets WHERE home=? ORDER BY created DESC',hid),audit:store.all('SELECT at,action,detail FROM audit WHERE home=? ORDER BY at DESC LIMIT 100',hid),collector:store.get('SELECT last_at,sequence,capabilities FROM collectors WHERE home=?',hid)||null,members:store.all('SELECT u.id,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.home=?',hid)};}
 const listener=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try{
   const host=req.headers.host||'',local=/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);insist((allowedHost&&host===allowedHost)||(!allowedHost&&local),'Hôte refusé.',403);
   const origin=configured||'http://'+host,url=new URL(req.url,origin),route=url.pathname,method=req.method,mutate=!['GET','HEAD'].includes(method);
   if(route.startsWith('/api/')){
    if(mutate&&req.headers.origin)insist(req.headers.origin===origin,'Origine refusée.',403);
    if(mutate&&req.headers['sec-fetch-site'])insist(['same-origin','none'].includes(req.headers['sec-fetch-site']),'Site refusé.',403);
    if(route==='/api/health'&&method==='GET')return json(res,{ok:true,storage:'sqlite',adminSecure:secure||local,origin,version:1});
    if(route==='/api/session'&&method==='GET'){const u=auth(req);return json(res,{user:u?{...u,role:workspace.sessionRole(store,u.id)}:null});}
    if(route==='/api/journey/otp/request'&&method==='POST')return json(res,await journey.requestOtp(store,await body(req,4096),req.socket.remoteAddress));
    if(route==='/api/journey/otp/verify'&&method==='POST'){
     const u=await journey.verifyOtp(store,await body(req,4096),req.socket.remoteAddress),session=store.session(u);cookie(res,session.secret,8*3600);return json(res,{user:{...u,csrf:session.csrf,role:workspace.sessionRole(store,u.id)}});
    }
    if(/^\/api\/auth\/(register|login|recover)$/.test(route)&&method==='POST'){
     insist(secure||local,'Les comptes nécessitent HTTPS hors de cet ordinateur.',403);store.rate('auth:'+req.socket.remoteAddress,15);const d=await body(req,8192);let result;
     if(route.endsWith('/register')){insist(store.get('SELECT count(*) AS n FROM users').n<500,'Capacité du pilote atteinte.',409);result=await store.register(d);}
     else if(route.endsWith('/recover')){const u=store.get('SELECT * FROM users WHERE email=?',String(d.email||'').toLowerCase().trim());insist(typeof d.recovery==='string'&&u&&hash(d.recovery)===u.recovery,'Code ou compte incorrect.',401);const pw=await passwordHash(d.password),recovery=token();store.transaction(()=>{insist(store.get('SELECT recovery FROM users WHERE id=?',u.id)?.recovery===hash(d.recovery),'Code déjà utilisé.',401);store.run('UPDATE users SET password=?,recovery=? WHERE id=?',pw,hash(recovery),u.id);store.run('DELETE FROM sessions WHERE user_id=?',u.id);});result={user:{id:u.id,name:u.name,email:u.email},recovery};}
     else result={user:await store.login(d.email,d.password)};
     const s=store.session(result.user);cookie(res,s.secret,8*3600);return json(res,{...result,user:{...result.user,csrf:s.csrf,role:workspace.sessionRole(store,result.user.id)}});
    }
    if(route==='/api/participant/join'&&method==='POST'){
     store.rate('join:'+req.socket.remoteAddress,20);const d=await body(req,4096);insist(d.consent===true,'Votre consentement est nécessaire.');const l=store.get('SELECT * FROM labs WHERE code=?',String(d.code||''));insist(l&&!l.closed&&l.expires>Date.now(),'Invitation expirée ou incorrecte.',404);insist(store.get('SELECT count(*) AS n FROM participants WHERE lab=? AND revoked=0',l.id).n<30,'Session limitée à 30 participants.',409);const pid=id(),secret=token(),name=word(d.name,'Nom de l’appareil',80);store.run('INSERT INTO participants(id,lab,name,secret,joined,last_seen) VALUES(?,?,?,?,?,?)',pid,l.id,name,hash(secret),Date.now(),Date.now());store.event(l.home,null,'participant.join',name);return json(res,{id:pid,secret,name,expires:l.expires});
    }
    if(route.startsWith('/api/participant/')){
     const p=participant(req);store.rate('participant:'+p.id,100);const fault=p.fault_until>Date.now()?p.fault:'none';
     if(route==='/api/participant/status'&&method==='GET')return json(res,{name:p.name,fault,faultUntil:p.fault_until,expires:p.expires});
     if(route==='/api/participant/leave'&&method==='POST'){store.run('UPDATE participants SET revoked=1,fault_until=0 WHERE id=?',p.id);return json(res,{ok:true});}
     if(route==='/api/participant/sample'&&method==='POST'){
      const d=await body(req,8192),m=metrics(d.metrics);insist(m.wifiDbm===null&&m.opticalDbm===null&&m.connected===null,'Le navigateur ne mesure pas le signal radio, la fibre ou tous les appareils.');store.rate('sample:'+p.id,12);const sid=id();store.run('INSERT INTO samples VALUES(?,?,?,?,?,?,?)',sid,p.home,p.id,Date.now(),'participant',JSON.stringify(m),number(d.bytes,'Octets',0,10*1024*1024,false));store.run('UPDATE participants SET last_seen=? WHERE id=?',Date.now(),p.id);const diag=diagnose(m,'participant');if(!['observed','unknown'].includes(diag.kind))store.notice(p.home,diag.title,p.name+' : '+diag.evidence.join(', '));return json(res,{id:sid,diagnosis:diag});
     }
     if(route==='/api/participant/ping'&&method==='GET'){if(fault==='latency')await pause(300);if(fault==='timeout'){await pause(1200);throw new Problem(503,'Indisponibilité du point de test injectée.');}return json(res,{at:Date.now(),fault});}
     if(route==='/api/participant/download'&&method==='GET'){
      insist(!active.has(p.id),'Un transfert est déjà en cours.',409);active.add(p.id);res.once('close',()=>active.delete(p.id));
      if(fault==='timeout'){await pause(1200);active.delete(p.id);throw new Problem(503,'Indisponibilité du point de test injectée.');}
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':pool.length});
      try{for(let i=0;i<pool.length;i+=65536){if(res.destroyed)break;if(fault==='slow')await pause(125);res.write(pool.subarray(i,i+65536));}res.end();}finally{active.delete(p.id);}return;
     }
     throw new Problem(404,'Action participant introuvable.');
    }
    if(route==='/api/collector/ingest'&&method==='POST'){
     const secret=(req.headers.authorization||'').replace(/^Bearer /,'');insist(secret.length>=32&&secret.length<100,'Clé collecteur requise.',401);const c=store.get('SELECT * FROM collectors WHERE secret=?',hash(secret));insist(c,'Clé collecteur invalide.',401);store.rate('collector:'+c.home,60);const d=await body(req),at=number(d.at,'Date',0,8640000000000000,false),seq=number(d.sequence,'Séquence',0,Number.MAX_SAFE_INTEGER,false);insist(Number.isInteger(seq)&&seq>c.sequence&&at>(c.last_at||0)&&Math.abs(Date.now()-at)<300000,'Relevé périmé, hors ordre ou déjà reçu.',409);const m=metrics(d.metrics);insist(Array.isArray(d.devices)&&d.devices.length<=100,'Liste limitée à 100 appareils.');const seen=new Set(),devices=d.devices.map(v=>{const did=word(v.id,'Identifiant appareil',100);insist(!seen.has(did),'Appareil dupliqué.');seen.add(did);return {id:did,name:word(v.name,'Nom appareil',80),rx:number(v.rx,'Octets reçus',0,Number.MAX_SAFE_INTEGER),tx:number(v.tx,'Octets émis',0,Number.MAX_SAFE_INTEGER)};});insist(m.connected===null||m.connected===devices.length,'Le nombre connecté doit correspondre à la liste.');m.connected=devices.length;
     store.transaction(()=>{for(const v of devices)store.run('INSERT INTO devices(home,id,name,seen,rx,tx) VALUES(?,?,?,?,?,?) ON CONFLICT(home,id) DO UPDATE SET seen=excluded.seen,rx=excluded.rx,tx=excluded.tx',c.home,v.id,v.name,at,v.rx,v.tx);store.run('INSERT INTO samples VALUES(?,?,?,?,?,?,?)',id(),c.home,null,at,'collector',JSON.stringify(m),0);store.run('UPDATE collectors SET last_at=?,sequence=? WHERE home=?',at,seq,c.home);const settings=JSON.parse(store.get('SELECT settings FROM homes WHERE id=?',c.home).settings),baseline=settings.usualDevices;if(Number.isFinite(baseline)&&devices.length>baseline+(settings.extraDevices||2)){const previous=store.get("SELECT at FROM notifications WHERE home=? AND title='Nombre inhabituel d’appareils' ORDER BY at DESC LIMIT 1",c.home);if(!previous||Date.now()-previous.at>300000)store.notice(c.home,'Nombre inhabituel d’appareils',devices.length+' appareils signalés ; référence déclarée : '+baseline+'. Vérifiez les appareils avant toute action.');}});return json(res,{ok:true,diagnosis:diagnose(m,'collector')});
    }
    const user=auth(req);insist(user,'Connectez-vous à votre espace.',401);insist(secure||local,'HTTPS requis pour votre espace.',403);
    if(mutate){insist(req.headers['x-csrf-token']===user.csrf,'Session de formulaire expirée. Rechargez la page.',403);store.rate('write:'+user.id,80);}
    if(route==='/api/guardian/chat'&&method==='POST')return json(res,require('./guardian-copilot.cjs').reply(store,user,await body(req,4096)));
    if(route==='/api/noc/feedback'&&method==='POST')return json(res,noc.feedback(store,user.id,await body(req,4096)));
    if(route==='/api/noc/overview'&&method==='GET')return json(res,noc.overview(store,user.id));
    if(route==='/api/noc/workspace'&&method==='GET')return json(res,workspace.overview(store,user.id));
    if(route==='/api/noc/workspace/action'&&method==='POST')return json(res,workspace.action(store,user.id,await body(req,8192)));
    if(route==='/api/noc/action'&&method==='POST')return json(res,noc.operate(store,user.id,await body(req,8192)));
    if(route==='/api/noc/client'&&method==='GET')return json(res,noc.client(store,user.id));
    if(route==='/api/noc/notifications'&&method==='GET')return json(res,noc.notifications(store,user.id));
    if(route==='/api/noc/notifications'&&method==='POST')return json(res,noc.readNotifications(store,user.id,await body(req,24000)));
    if(route==='/api/noc/join'&&method==='POST')return json(res,noc.join(store,user.id,await body(req,4096)));
    if(route==='/api/journey/state'&&method==='GET'){const state=journey.get(store,user.id);return json(res,{state:state?journey.snapshotFor(store,user.id,state):null});}
    if(route==='/api/journey/usage'&&method==='GET'){const state=journey.get(store,user.id);insist(state,'Démarrez votre démonstration pour observer les appareils.',409);const current=journey.snapshotFor(store,user.id,state);return json(res,require('./journey-usage.cjs').read(store,user.id,url.searchParams.get('window')||'24h',current));}
    if(route==='/api/journey/start'&&method==='POST'){if(!journey.get(store,user.id))journey.put(store,user.id,journey.seed());return json(res,{state:journey.snapshotFor(store,user.id,journey.get(store,user.id))});}
    if(route==='/api/journey/action'&&method==='POST')return json(res,{state:journey.act(store,user.id,await body(req,600000))});
    if(route==='/api/journey/reports'&&method==='GET')return json(res,journey.realReports(store,user));
    if(route==='/api/journey/reports'&&method==='POST')return json(res,journey.reportReal(store,user.id,await body(req,600000)),201);
    if(route==='/api/journey/reports/respond'&&method==='POST'){operator.requireOperator(store,user.id);insist(!store.get('SELECT paused FROM noc_settings WHERE id=1').paused,'Supervision suspendue : le traitement des signalements est arrêté.',409);return json(res,journey.respondReal(store,user,await body(req,4096)));}
    if(route==='/api/operator/overview'&&method==='GET')return json(res,operator.overview(store,user.id));
    if(route==='/api/operator/approvals'&&method==='GET')return json(res,approvals.read(store,user.id));
    if(route==='/api/operator/approvals'&&method==='POST')return json(res,approvals.propose(store,user.id,await body(req,8192)),201);
    if(route==='/api/operator/autonomy'&&method==='POST')return json(res,approvals.configure(store,user.id,await body(req,8192)));
    const approvalRoute=route.match(/^\/api\/operator\/approvals\/([^/]+)\/(decide|execute|rollback)$/);
    if(approvalRoute&&method==='POST'){const d=await body(req,8192),rid=approvalRoute[1],verb=approvalRoute[2];return json(res,verb==='decide'?approvals.decide(store,user.id,rid,d):verb==='execute'?approvals.execute(store,user.id,rid):approvals.rollback(store,user.id,rid));}
    const operatorTicket=route.match(/^\/api\/operator\/tickets\/([^/]+)$/);
    if(operatorTicket&&method==='GET')return json(res,operator.detail(store,user.id,operatorTicket[1]));
    if(operatorTicket&&method==='POST'){operator.requireOperator(store,user.id);insist(!store.get('SELECT paused FROM noc_settings WHERE id=1').paused,'Supervision suspendue : le traitement des dossiers est arrêté.',409);return json(res,operator.update(store,user.id,operatorTicket[1],await body(req,8192)));}
    if(route==='/api/auth/logout'&&method==='POST'){store.run('DELETE FROM sessions WHERE user_id=? AND csrf=?',user.id,user.csrf);cookie(res,'',0);return json(res,{ok:true});}
    if(route==='/api/auth/password'&&method==='POST'){const d=await body(req,4096),u=store.get('SELECT * FROM users WHERE id=?',user.id);insist(await passwordMatches(d.current,u.password),'Mot de passe actuel incorrect.',401);const pw=await passwordHash(d.password);store.run('UPDATE users SET password=? WHERE id=?',pw,user.id);store.run('DELETE FROM sessions WHERE user_id=?',user.id);cookie(res,'',0);return json(res,{ok:true});}
    if(route==='/api/homes'&&method==='GET')return json(res,{homes:store.all('SELECT h.id,h.name,m.role FROM homes h JOIN members m ON m.home=h.id WHERE m.user_id=?',user.id)});
    if(route==='/api/homes'&&method==='POST'){const d=await body(req,4096);insist(store.get('SELECT count(*) AS n FROM homes WHERE owner=?',user.id).n<10,'Maximum 10 foyers.');const hid=id();store.transaction(()=>{store.run('INSERT INTO homes VALUES(?,?,?,?,?)',hid,user.id,word(d.name,'Nom du foyer',80),Date.now(),JSON.stringify({usualDevices:5,extraDevices:2}));store.run('INSERT INTO members VALUES(?,?,?)',hid,user.id,'owner');store.event(hid,user.id,'home.create');});return json(res,{id:hid},201);}
    if(route==='/api/invites/accept'&&method==='POST'){const d=await body(req,4096),v=store.get('SELECT * FROM invites WHERE hash=?',hash(String(d.code||'')));insist(v&&!v.used&&v.expires>Date.now(),'Invitation invalide ou expirée.',404);store.transaction(()=>{store.run('INSERT OR IGNORE INTO members VALUES(?,?,?)',v.home,user.id,'viewer');store.run('UPDATE invites SET used=1 WHERE id=?',v.id);store.event(v.home,user.id,'member.join');});return json(res,{id:v.home});}
    const match=route.match(/^\/api\/homes\/([^/]+)(?:\/(.*))?$/);insist(match,'Route introuvable.',404);const hid=match[1],action=match[2]||'',home=store.home(user.id,hid,mutate);
    if(!action&&method==='GET')return json(res,snapshot(user,hid));
    if(!action&&method==='DELETE'){const d=await body(req,4096);insist(d.confirm===home.name,'Saisissez le nom exact du foyer pour confirmer.');store.run('DELETE FROM homes WHERE id=?',hid);return json(res,{ok:true});}
    const d=mutate?await body(req):{};
    if(action==='support-shares'&&method==='GET')return json(res,{shares:operator.clientShares(store,hid)});
    if(action==='ticket/share'&&method==='POST')return json(res,operator.share(store,user.id,hid,d));
    if(action==='ticket/reply'&&method==='POST')return json(res,operator.reply(store,user.id,hid,d));
    if(action==='settings'&&method==='POST'){const settings={...home.settings,usualDevices:number(d.usualDevices,'Nombre habituel',0,100,false),extraDevices:number(d.extraDevices,'Marge',1,30,false)};insist(Number.isInteger(settings.usualDevices)&&Number.isInteger(settings.extraDevices),'Nombres entiers requis.');store.run('UPDATE homes SET settings=? WHERE id=?',JSON.stringify(settings),hid);store.event(hid,user.id,'settings.update');return json(res,{ok:true});}
    if(action==='invite'&&method==='POST'){const code=token();store.run('INSERT INTO invites(id,home,hash,expires) VALUES(?,?,?,?)',id(),hid,hash(code),Date.now()+86400000);store.event(hid,user.id,'member.invite');return json(res,{code});}
    if(action==='member/revoke'&&method==='POST'){insist(d.id!==home.owner,'Le propriétaire ne peut pas être retiré.');store.run('DELETE FROM members WHERE home=? AND user_id=?',hid,String(d.id));store.event(hid,user.id,'member.revoke');return json(res,{ok:true});}
    if(action==='labs'&&method==='POST'){insist(store.get('SELECT count(*) AS n FROM labs WHERE home=? AND closed=0 AND expires>?',hid,Date.now()).n<3,'Fermez une session avant d’en créer une autre.');const lid=id(),code=token();store.run('INSERT INTO labs(id,home,name,code,created,expires) VALUES(?,?,?,?,?,?)',lid,hid,word(d.name,'Nom du test',80),code,Date.now(),Date.now()+7200000);store.event(hid,user.id,'lab.create');return json(res,{id:lid,code,url:origin+'/codex/participant.html#'+code});}
    if(action==='lab/close'&&method==='POST'){const l=store.get('SELECT id FROM labs WHERE home=? AND id=?',hid,String(d.id));insist(l,'Session introuvable.',404);store.run('UPDATE labs SET closed=1 WHERE id=?',l.id);store.run('UPDATE participants SET fault_until=0 WHERE lab=?',l.id);store.event(hid,user.id,'lab.close');return json(res,{ok:true});}
    if(action==='participant/action'&&method==='POST'){const p=store.get('SELECT p.id,p.revoked,l.closed,l.expires FROM participants p JOIN labs l ON l.id=p.lab WHERE l.home=? AND p.id=?',hid,String(d.id));insist(p,'Participant introuvable.',404);insist(!p.revoked&&!p.closed&&p.expires>Date.now(),'Ce participant n’a plus de session active.',409);insist(['none','slow','latency','timeout','revoke'].includes(d.action),'Action inconnue.');if(d.action==='revoke')store.run('UPDATE participants SET revoked=1,fault_until=0 WHERE id=?',p.id);else store.run('UPDATE participants SET fault=?,fault_until=? WHERE id=?',d.action,d.action==='none'?0:Date.now()+60000,p.id);store.event(hid,user.id,'test.'+d.action,p.id);return json(res,{ok:true});}
    if(action==='record'&&method==='POST'){insist(store.get('SELECT count(*) AS n FROM records WHERE home=?',hid).n<50,'Maximum 50 enregistrements.');let r;if(d.recording)r=recording(d.recording);else {const rows=store.all('SELECT at,source,metrics FROM samples WHERE home=? ORDER BY at LIMIT 5000',hid),frames=rows.filter((s,i)=>i===0||s.at>rows[i-1].at).map(s=>({...s,metrics:JSON.parse(s.metrics)}));r=recording({schema:'guardian.recording.v1',name:d.name,frames});r.provenance='Copie des relevés reçus par ce serveur. Les déclarations du collecteur ne certifient pas le matériel.';}const rid=id();store.run('INSERT INTO records VALUES(?,?,?,?,?)',rid,hid,r.name,Date.now(),JSON.stringify(r));store.event(hid,user.id,'record.save',r.name);return json(res,{id:rid});}
    if(action.startsWith('records/')){const rid=action.slice(8),r=store.get('SELECT * FROM records WHERE home=? AND id=?',hid,rid);insist(r,'Enregistrement introuvable.',404);if(method==='GET')return json(res,JSON.parse(r.body));if(method==='DELETE'){store.run('DELETE FROM records WHERE id=?',rid);return json(res,{ok:true});}}
    if(action==='floorplan'&&method==='POST'){const plan=floorplan(d);store.run('UPDATE homes SET settings=? WHERE id=?',JSON.stringify({...home.settings,plan}),hid);store.event(hid,user.id,'floorplan.save');return json(res,{plan,placement:placement(plan)});}
    if(action==='floorplan'&&method==='GET')return json(res,home.settings.plan?{plan:home.settings.plan,placement:placement(home.settings.plan)}:{plan:null});
    if(action==='device'&&method==='POST'){const device=store.get('SELECT id FROM devices WHERE home=? AND id=?',hid,String(d.id));insist(device,'Appareil introuvable.',404);insist(typeof d.recognized==='boolean','Reconnaissance invalide.');store.run('UPDATE devices SET name=?,recognized=?,room=? WHERE home=? AND id=?',word(d.name,'Nom appareil',80),d.recognized?1:0,String(d.room||'').slice(0,60),hid,device.id);store.event(hid,user.id,'device.update',device.id);return json(res,{ok:true});}
    if(action==='collector'&&method==='POST'){const secret=token();store.run('INSERT OR REPLACE INTO collectors(home,secret,capabilities) VALUES(?,?,?)',hid,hash(secret),JSON.stringify({telemetry:true,deviceControl:false,reboot:false,model:word(d.model||'À identifier','Modèle',80)}));store.event(hid,user.id,'collector.rotate');return json(res,{secret,endpoint:origin+'/api/collector/ingest',notice:'Contrat de réception seulement : aucun adaptateur ZLT ni commande de box n’est activé.'});}
    if(action==='collector'&&method==='DELETE'){store.run('DELETE FROM collectors WHERE home=?',hid);store.event(hid,user.id,'collector.revoke');return json(res,{ok:true});}
    if(action==='notification/read'&&method==='POST'){store.run('UPDATE notifications SET read=1 WHERE home=? AND id=?',hid,String(d.id));return json(res,{ok:true});}
    if(action==='ticket'&&method==='POST'){insist(store.get('SELECT count(*) AS n FROM tickets WHERE home=?',hid).n<100,'Maximum 100 dossiers.');const tid=id(),subject=word(d.subject,'Sujet',100),detail=paragraph(d.detail,'Description',2000);store.run('INSERT INTO tickets VALUES(?,?,?,?,?,?)',tid,hid,Date.now(),'À transmettre',subject,JSON.stringify({detail,latest:store.all('SELECT at,source,metrics FROM samples WHERE home=? ORDER BY at DESC LIMIT 5',hid)}));store.event(hid,user.id,'ticket.create',subject);return json(res,{id:tid});}
    if(action==='ticket/status'&&method==='POST'){insist(['À transmettre','Transmis manuellement','Résolu'].includes(d.status),'Statut invalide.');const t=store.get('SELECT id FROM tickets WHERE home=? AND id=?',hid,String(d.id));insist(t,'Dossier introuvable.',404);store.run('UPDATE tickets SET status=? WHERE id=?',d.status,t.id);store.event(hid,user.id,'ticket.status',d.status);return json(res,{ok:true});}
    throw new Problem(404,'Action introuvable.');
   }
   if(!['GET','HEAD'].includes(method)){res.writeHead(405);res.end();return;}
   let pathname=decodeURIComponent(url.pathname);if(pathname==='/'){res.writeHead(302,{Location:'/codex/'});res.end();return;}if(pathname.endsWith('/'))pathname+='index.html';
   const target=path.resolve(ROOT,'.'+pathname),ext=path.extname(target);insist(target.startsWith(ROOT+path.sep)&&TYPES[ext]&&/^\/(codex\/|src\/|vendor\/|config\.js$|icon\.svg$|index\.html$)/.test(pathname)&&!pathname.split('/').some(p=>p.startsWith('.')),'Introuvable',404);
   let data;try{data=await fs.promises.readFile(target);}catch(_){throw new Problem(404,'Introuvable');}res.writeHead(200,{'Content-Type':TYPES[ext]});res.end(method==='HEAD'?undefined:data);
  }catch(e){if(res.headersSent){res.end();return;}json(res,{error:e instanceof Problem?e.message:'Erreur interne. Aucune action confirmée.'},e instanceof Problem?e.status:500);if(!(e instanceof Problem)&&options.onError)options.onError(e);}
 };
 const server=secure?https.createServer(options.tls,listener):http.createServer(listener);server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=60;server.guardianStore=store;const nocTimer=setInterval(()=>{try{store.transaction(()=>noc.scan(store));}catch(e){options.onError?.(e);}},5000);nocTimer.unref();const expiry=setInterval(()=>{try{approvals.tick(store);}catch(e){if(options.onError)options.onError(e);}},30000);expiry.unref();const cleanup=setInterval(()=>store.cleanup(),3600000);cleanup.unref();server.on('close',()=>{clearInterval(cleanup);clearInterval(nocTimer);clearInterval(expiry);if(!options.store)store.close();});return server;
}
module.exports={createGuardianServer};
