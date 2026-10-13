(function(){
 'use strict';const root=document.getElementById('participant'),code=location.hash.slice(1);history.replaceState(null,'',location.pathname);let session=null,running=false,controller=null,last=null;
 const el=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text)node.textContent=text;Object.assign(node,attrs);return node;};
 const headers=()=>({'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.secret}:{})});
 async function api(route,body,signal){const r=await fetch('/api/participant/'+route,{method:body?'POST':'GET',headers:headers(),body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000),cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Action refusée.');return d;}
 function button(text,fn){const b=el('button',text,{type:'button',className:'btn'});b.onclick=fn;return b;}
 function message(text,error=false){let p=document.getElementById('participant-message');if(!p){p=el('p','',{id:'participant-message'});root.append(p);}p.setAttribute('role',error?'alert':'status');p.textContent=text;}
 function brand(){const header=el('header','',{className:'test-brand'});header.append(el('strong','fibre guardian'),el('span','TEST PARTICIPANT'));return header;}
 function sectionHead(number,title,description){const head=el('div','',{className:'lab-section-head'}),copy=el('div');copy.append(el('h2',title),el('p',description));head.append(el('span',number,{className:'lab-step'}),copy);return head;}
 function stage(value,text){const bar=document.getElementById('test-progress'),label=document.getElementById('test-stage');if(bar)bar.value=value;if(label)label.textContent=text;}
 function draw(){
  const intro=el('header','',{className:'test-heading'});
  intro.append(el('span','COMPRENDRE VOTRE CONNEXION',{className:'lab-eyebrow'}),el('h1','Votre appareil, votre test'),el('p','Mesurez le trajet entre cet appareil et le serveur Guardian. Ce n’est pas un test complet de votre accès Internet.'));
  root.replaceChildren(brand(),intro);
  if(!session){
   const f=el('form','',{className:'lab-card test-join'}),label=el('label','Nom de votre appareil'),name=el('input','',{name:'name',required:true,maxLength:80,placeholder:'iPhone de Koffi',autoComplete:'off'});label.append(name);
   const consentLabel=el('label','',{className:'test-consent'}),consent=el('input','',{type:'checkbox',name:'consent',required:true});
   consentLabel.append(consent,el('span','J’accepte un transfert de 2 Mio par test, le stockage des résultats et des injections temporaires sur le point de test (60 s maximum). Je peux arrêter ou quitter à tout moment.'));
   const join=el('button','Rejoindre la session',{className:'btn primary',type:'submit',disabled:!code});
   f.append(sectionHead('01','Prêt à participer ?','Donnez un nom reconnaissable à cet appareil.'),label,consentLabel,join);
   f.onsubmit=async e=>{e.preventDefault();join.disabled=true;try{session=await api('join',{name:name.value,code,consent:consent.checked});draw();}catch(err){message(err.message,true);join.disabled=false;}};
   const note=el('aside','',{className:'lab-boundary'});note.append(el('p','Votre accord, vos mesures. Aucun accès à vos fichiers, à vos mots de passe ou aux autres appareils du réseau.'));
   root.append(f,note);if(!code)message('Ouvrez le lien d’invitation fourni par le propriétaire. Il est nécessaire pour rejoindre un test.',true);return;
  }
  const card=el('section','',{className:'lab-card'}),heading=el('div','',{className:'test-session'}),copy=el('div');
  copy.append(el('h2',session.name),el('p','Session jusqu’au '+new Date(session.expires).toLocaleString('fr-FR')));heading.append(copy,el('span','PARTICIPATION AUTORISÉE',{className:'lab-status'}));
  const controls=el('div','',{className:'test-controls'}),run=button('Mesurer maintenant',measure),stop=button('Arrêter le test',()=>controller?.abort()),leave=button('Quitter la session',async()=>{controller?.abort();try{await api('leave',{});session=null;root.replaceChildren(brand(),el('h1','Session quittée'),el('p','Votre accès est révoqué. Les résultats déjà partagés restent dans le foyer jusqu’à leur suppression par le propriétaire.'));}catch(e){message(e.message,true);}});
  run.id='run-test';run.className+=' primary';stop.id='stop-test';stop.className+=' lab-secondary';leave.className+=' lab-text lab-danger';stop.disabled=!running;run.disabled=running;controls.append(run,stop,leave);
  const progress=el('div','',{className:'test-progress'}),bar=el('progress','',{id:'test-progress',max:7,value:0});bar.setAttribute('aria-label','Étapes du test terminées');progress.append(el('p','5 sondes de réponse → transfert de 2 Mio → enregistrement',{id:'test-stage'}),bar);
  card.append(heading,controls,progress);
  const results=el('section','',{id:'test-results',className:'lab-card test-results'});results.append(el('span','VOS RÉSULTATS',{className:'lab-eyebrow'}),el('h2','Votre première mesure vous attend'),el('p','Lancez le test. Vous verrez ici le transfert mesuré, le temps de réponse et une explication simple.'));
  root.append(card,results);if(last)show(last);
 }
 function show(r){
  const card=document.getElementById('test-results');if(!card)return;
  const grid=el('div','',{className:'lab-device-metrics'});
  for(const [label,value,unit] of [['Débit du test',r.metrics.downloadMbps,'Mbps'],['Temps de réponse',r.metrics.latencyMs,'ms'],['Sondes sans réponse',r.metrics.lossPct,'%']]){const cell=el('div'),n=el('strong',value==null?'—':Number(value).toLocaleString('fr-FR',{maximumFractionDigits:1}));n.append(el('small',' '+unit));cell.append(el('span',label),n);grid.append(cell);}
  card.replaceChildren(el('span','DERNIER TEST ENREGISTRÉ',{className:'lab-eyebrow'}),el('h2',r.diagnosis.title),grid,el('p',r.diagnosis.advice),el('p','Les sondes sans réponse sont des requêtes HTTP : ce n’est pas une mesure de perte de paquets IP.'),el('p','Mesure enregistrée à '+new Date(r.at).toLocaleTimeString('fr-FR')+'. Relancez après rétablissement pour comparer.'));
 }
 async function measure(){if(running)return;running=true;controller=new AbortController();const outer=controller.signal;document.getElementById('run-test').disabled=true;document.getElementById('stop-test').disabled=false;let bytes=0;
  async function request(route){const r=await fetch('/api/participant/'+route,{headers:headers(),cache:'no-store',signal:AbortSignal.any([outer,AbortSignal.timeout(10000)])});if(!r.ok)throw new Error('Sonde refusée ('+r.status+').');return r;}
  try{stage(0,'Préparation du test…');const status=await api('status',undefined,outer);message('Test en cours · '+({none:'aucune injection',slow:'transfert ralenti',latency:'latence ajoutée',timeout:'point de test interrompu'}[status.fault]||'état inconnu')+'. Ne fermez pas cet écran.');const times=[];let failed=0;
   for(let i=0;i<5;i++){if(outer.aborted)throw new DOMException('Arrêt','AbortError');const start=performance.now();try{await(await request('ping')).arrayBuffer();times.push(performance.now()-start);}catch(e){if(outer.aborted)throw e;failed++;}stage(i+1,'Sondes de réponse : '+(i+1)+' / 5');}
   let speed=null;stage(5,'Mesure du transfert de 2 Mio…');try{const start=performance.now(),r=await request('download'),buf=await r.arrayBuffer();bytes=buf.byteLength;speed=bytes*8/Math.max(1,performance.now()-start)/1000;}catch(e){if(outer.aborted)throw e;}
   const mean=times.length?times.reduce((a,b)=>a+b,0)/times.length:null,jitter=times.length>1?times.slice(1).reduce((a,b,i)=>a+Math.abs(b-times[i]),0)/(times.length-1):null,m={downloadMbps:speed,latencyMs:mean,jitterMs:jitter,lossPct:failed*20};
   if(outer.aborted)throw new DOMException('Arrêt','AbortError');stage(6,'Enregistrement du résultat…');const result=await api('sample',{metrics:m,bytes});last={...result,metrics:m,at:Date.now()};show(last);stage(7,'Terminé · résultat enregistré');message('Résultat envoyé au propriétaire. Vous pouvez comparer après rétablissement.');
  }catch(e){const label=document.getElementById('test-stage');if(label)label.textContent=outer.aborted?'Test arrêté':'Test non terminé';message(outer.aborted?'Test arrêté. Aucun résultat partiel envoyé.':e.message,!outer.aborted);}finally{running=false;const run=document.getElementById('run-test'),stop=document.getElementById('stop-test');if(run)run.disabled=false;if(stop)stop.disabled=true;}
 }
 draw();
})();
