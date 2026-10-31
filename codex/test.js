(function(){
 'use strict';
 // « Tester ma connexion » : une vraie mesure, faite par cet appareil, sur le réseau où il est branché
 // (Wi-Fi de la box, partage de connexion ou données mobiles), jusqu'au serveur de Guardian.
 // 5 sondes de réponse, puis 2 Mo téléchargés ; si la ligne est rapide, 6 Mo de plus en 3 flux parallèles.
 // Le résultat part dans la conversation Guardian du client (et sur WhatsApp si le lien vient de là).
 const root=document.getElementById('vt'),store=(k,v)=>{try{return v===undefined?sessionStorage.getItem(k):sessionStorage.setItem(k,v);}catch{return null;}};
 // Le jeton quitte la barre d'adresse (il ne doit pas être recopié ni partagé) mais reste pour cet onglet, si la page est rechargée.
 const token=location.hash.slice(1)||store('fg-test')||'';if(token)store('fg-test',token);history.replaceState(null,'',location.pathname);
 let info=null,running=false,last=null;
 const NETS=[['wifi','Wi-Fi de la box','M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 19.5h.01'],['ethernet','Câble de la box','M7 3h10v6H7zM9 9v4m6-4v4M6 13h12v8H6z'],['hotspot','Partage de connexion','M7 3h10v18H7zM11 18h2M12 7v4m-2.5-2.5a3.5 3.5 0 0 1 5 0'],['cellular','Données mobiles','M4 20v-3m5 3v-7m5 7V9m5 11V4']];
 const LEVEL={bonne:['good','Bonne connexion'],lente:['slow','Connexion lente'],'tres-lente':['bad','Très lente'],instable:['bad','Connexion instable'],coupe:['bad','Pas de connexion']};
 const el=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs))k==='text'?n.textContent=v:k==='class'?n.className=v:n.setAttribute(k,v);n.append(...kids.filter(k=>k!=null&&k!==false));return n;};
 const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
 const icon=(d,size=20)=>{const s=svg('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});s.append(svg('path',{d}));return s;};
 const fr=(v,d=0)=>Number(v).toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d});
 const mbps=v=>v==null?'—':fr(v,v<10?1:0);
 async function api(route,body,timeout=8000){
  const r=await fetch('/api/test/'+route,{method:body?'POST':'GET',cache:'no-store',headers:{'X-Test-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||'Le test n’a pas pu se terminer.'),{status:r.status});return d;
 }
 const head=()=>el('header',{class:'vt-head'},el('img',{src:'pwa/icon-192.png',alt:''}),el('div',{},el('strong',{text:'Moov Africa · Fibre'}),el('small',{text:'Tester ma connexion avec Guardian'})));

 // Le cadran : échelle logarithmique de 0 à 1 000 Mbps, pour qu'1 Mbps et 300 Mbps soient lisibles tous les deux.
 const ARC=Math.PI*120,frac=v=>v==null?0:Math.min(1,Math.log10(1+v)/3);
 function gauge(){
  const s=svg('svg',{viewBox:'0 0 300 184',role:'img','aria-label':'Débit mesuré'}),path='M30 150 A120 120 0 0 1 270 150';
  s.append(svg('path',{d:path,class:'vt-track',fill:'none','stroke-width':18,'stroke-linecap':'round'}),svg('path',{d:path,id:'vt-arc',class:'vt-arc',fill:'none','stroke-width':18,'stroke-linecap':'round','stroke-dasharray':ARC,'stroke-dashoffset':ARC}));
  // Graduations : 10 et 100 au-dessus de l'arc, 0 et 1000 sous ses deux bouts.
  for(const [v,label] of [[0,'0'],[10,'10'],[100,'100'],[1000,'1000']]){const a=Math.PI*(1-frac(v)),end=v===0||v===1000,t=svg('text',{x:end?150+120*Math.cos(a):150+146*Math.cos(a),y:end?178:154-146*Math.sin(a),class:'vt-tick','text-anchor':'middle'});t.textContent=label;s.append(t);}
  return el('div',{class:'vt-gauge'},s,el('div',{class:'vt-read'},el('strong',{id:'vt-num',text:'—'}),el('span',{text:'Mbps'})));
 }
 function dial(v,tone=''){const a=document.getElementById('vt-arc'),n=document.getElementById('vt-num');if(a){a.style.strokeDashoffset=String(ARC*(1-frac(v)));a.setAttribute('class','vt-arc '+tone);}if(n)n.textContent=mbps(v);}
 function stage(text,step){const s=document.getElementById('vt-stage');if(s)s.textContent=text;document.querySelectorAll('.vt-steps li').forEach((li,i)=>li.classList.toggle('on',i<step));}

 function network(){const c=navigator.connection?.type;return c==='wifi'?'wifi':c==='cellular'?'cellular':c==='ethernet'?'ethernet':null;}
 function draw(){
  const detected=network(),hello=info.name?'Bonjour '+info.name+', testons votre connexion.':'Testons votre connexion.';
  const nets=el('div',{class:'vt-net-grid'});
  for(const [v,label,d] of NETS){const input=el('input',{type:'radio',name:'net',value:v});if(v===(detected||'wifi'))input.checked=true;nets.append(el('label',{},input,icon(d),el('span',{text:label})));}
  const go=el('button',{type:'button',class:'vt-go',id:'vt-go'},icon('M5 12h14m-6-6 6 6-6 6',22),el('span',{text:'Lancer le test'}));go.onclick=measure;
  const card=el('section',{class:'vt-card','aria-labelledby':'vt-title'},
   el('span',{class:'vt-eyebrow'},el('i'),'MESURE EN DIRECT SUR CET APPAREIL'),el('h1',{id:'vt-title',text:hello}),
   el('p',{text:'Guardian mesure la connexion de cet appareil, là où vous êtes, en 15 secondes environ.'}),
   el('fieldset',{class:'vt-net'},el('legend',{text:'Cet appareil est connecté par :'}),nets,detected?el('p',{class:'vt-net-hint',text:'Choix proposé par votre appareil. Corrigez-le si besoin.'}):null),
   gauge(),el('p',{class:'vt-stage',id:'vt-stage',text:'Prêt quand vous l’êtes.'}),el('ol',{class:'vt-steps','aria-hidden':'true'},el('li'),el('li'),el('li'),el('li')),
   go,el('p',{class:'vt-data',text:'Le test utilise entre 2 et 8 Mo de données.'}));
  root.replaceChildren(head(),card,result());
 }
 function result(){
  const card=el('section',{class:'vt-card',id:'vt-result','aria-labelledby':'vt-result-title'});
  if(!last){card.append(el('h2',{id:'vt-result-title',text:'Votre résultat apparaîtra ici'}),el('div',{class:'vt-guardian'},el('img',{src:'pwa/icon-192.png',alt:''}),el('p',{class:'vt-bubble'},el('b',{text:'Guardian'}),'Pour savoir si c’est le Wi-Fi ou la ligne, faites un premier test près de la box, puis un second dans la pièce où ça rame.')));return card;}
  const [tone,label]=LEVEL[last.level]||['slow','Résultat'],m=last.metrics,answered=5-Math.round(m.lossPct/20);
  card.append(el('span',{class:'vt-verdict '+tone},el('i'),label),el('h2',{id:'vt-result-title',class:'vt-sr',text:'Résultat du test'}),
   el('div',{class:'vt-tiles'},
    el('div',{class:'vt-tile'},el('small',{text:'Débit'}),el('strong',{text:mbps(m.downloadMbps)}),el('span',{text:'Mbps'})),
    el('div',{class:'vt-tile'},el('small',{text:'Réponse'}),el('strong',{text:m.latencyMs==null?'—':fr(m.latencyMs)}),el('span',{text:'ms'})),
    el('div',{class:'vt-tile'},el('small',{text:'Stabilité'}),el('strong',{text:answered+'/5'}),el('span',{text:'réponses'}))),
   el('div',{class:'vt-guardian'},el('img',{src:'pwa/icon-192.png',alt:''}),el('p',{class:'vt-bubble'},el('b',{text:'Guardian'}),last.text)),
   last.whatsapp?el('p',{class:'vt-wa'},icon('M20 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20.5l1.4-4.4A8.5 8.5 0 1 1 20 11.5Z',18),'Je vous ai aussi envoyé ce résultat sur WhatsApp.'):'',
   el('details',{class:'vt-how'},el('summary',{text:'Comment ce test est fait'}),el('ul',{},
    el('li',{text:'Cet appareil envoie 5 sondes à Guardian et chronomètre chaque réponse.'}),
    el('li',{text:'Il télécharge ensuite 2 Mo, et 6 Mo de plus si la ligne est rapide.'}),
    el('li',{text:'Le serveur de Guardian est loin d’Abidjan : le débit de votre fibre peut être plus élevé que ce chiffre.'}))));
  const again=el('button',{type:'button',class:'vt-btn'},icon('M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5',18),'Refaire le test');again.onclick=measure;
  if(last.left<=0)again.disabled=true;
  card.append(el('div',{class:'vt-actions'},again,el('a',{class:'vt-btn primary',href:'/codex/?section=guardian'},'Parler à Guardian')));
  return card;
 }
 function closed(title,text){root.replaceChildren(head(),el('section',{class:'vt-card vt-solo'},el('h1',{text:title}),el('p',{text:text}),el('div',{class:'vt-actions'},el('a',{class:'vt-btn primary',href:'/codex/'},'Ouvrir Fibre Guardian'))));}

 // Un téléchargement, compté au fil de l'eau pour faire bouger le cadran.
 async function pull(signal,count){const r=await fetch('/api/test/download',{cache:'no-store',headers:{'X-Test-Token':token},signal});if(!r.ok)throw new Error('Transfert refusé.');const reader=r.body.getReader();for(;;){const {done,value}=await reader.read();if(done)return;count(value.byteLength);}}
 async function round(streams,limitMs){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),limitMs),start=performance.now();let bytes=0,shown=0;
  const tick=setInterval(()=>{const s=(performance.now()-start)/1000;if(s>.25&&bytes>0)dial(Math.max(shown,bytes*8/s/1e6));},150);
  try{await Promise.all(Array.from({length:streams},()=>pull(ctl.signal,n=>{bytes+=n;})));}catch(e){if(!ctl.signal.aborted)throw e;}finally{clearTimeout(timer);clearInterval(tick);}
  const s=(performance.now()-start)/1000;return {mbps:bytes>65536?bytes*8/s/1e6:null,seconds:s};
 }
 async function measure(){
  if(running)return;running=true;root.classList.add('vt-running');const go=document.getElementById('vt-go');if(go){go.disabled=true;go.lastChild.textContent='Test en cours…';}
  const net=document.querySelector('input[name=net]:checked')?.value||null;dial(null);
  try{
   const times=[];let lost=0;
   for(let i=0;i<5;i++){stage('Temps de réponse · '+(i+1)+' sur 5',1);const t=performance.now();try{await api('ping',null,4000);times.push(performance.now()-t);}catch(e){if(e.status===404||e.status===429)throw e;lost++;}}
   stage('Débit · premier transfert',2);let speed=null;
   const one=await round(1,12000).catch(()=>({mbps:null,seconds:99}));speed=one.mbps;
   if(one.mbps!=null&&one.seconds<2.5){stage('Débit · trois transferts en même temps',3);const three=await round(3,10000).catch(()=>({mbps:null}));if(three.mbps!=null)speed=Math.max(speed,three.mbps);}
   dial(speed);stage('Guardian analyse le résultat…',4);
   const mean=times.length?times.reduce((a,b)=>a+b,0)/times.length:null,jitter=times.length>1?times.slice(1).reduce((a,b,i)=>a+Math.abs(b-times[i]),0)/(times.length-1):null;
   const r=await api('result',{metrics:{downloadMbps:speed,latencyMs:mean,jitterMs:jitter,lossPct:lost*20,network:net}},10000);
   info.tests++;last={...r,left:info.maxTests-info.tests};
   const tone=(LEVEL[r.level]||['slow'])[0];dial(speed,tone);stage('Test terminé.',4);
   const old=document.getElementById('vt-result');old.replaceWith(result());if(innerWidth<900)document.getElementById('vt-result').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  }catch(e){
   if(e.status===404)return closed('Ce lien de test a expiré','Demandez-en un nouveau à Guardian, dans l’application ou sur WhatsApp. Chaque lien sert 30 minutes.');
   stage('',0);const card=document.getElementById('vt-result');card.replaceChildren(el('p',{class:'vt-error',role:'alert',text:e.status===429?e.message:'Le test n’a pas pu se terminer. Vérifiez que cet appareil est bien connecté, puis réessayez.'}));
  }finally{running=false;root.classList.remove('vt-running');const b=document.getElementById('vt-go');if(b){b.disabled=false;b.lastChild.textContent=last?'Refaire le test':'Lancer le test';}}
 }

 (async()=>{
  if(!/^[A-Za-z0-9_-]{20,40}$/.test(token))return closed('Ouvrez votre lien de test','Ce test s’ouvre avec le lien personnel que Guardian vous envoie, dans l’application ou sur WhatsApp.');
  try{info=await api('info');draw();}catch(e){closed('Ce lien de test a expiré','Demandez-en un nouveau à Guardian, dans l’application ou sur WhatsApp. Chaque lien sert 30 minutes.');}
 })();
})();
