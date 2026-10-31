(function(){
 'use strict';
 // « Tester ma connexion » : une vraie mesure, faite par cet appareil, sur le réseau où il est branché
 // (Wi-Fi de la box, partage de connexion ou données mobiles), jusqu'au serveur de Guardian.
 // 5 sondes de réponse, puis 2 Mo téléchargés ; si la ligne est rapide, 6 Mo de plus en 3 flux parallèles.
 // Le résultat part dans la conversation Guardian du client (et sur WhatsApp si le lien vient de là).
 // En plus : les infos du réseau (opérateur, adresse IP, appareil), un suivi en direct toutes les 2 secondes,
 // et le bouton « Démo » qui montre, à partir des vraies mesures, ce que deviendrait la connexion pendant une panne.
 const root=document.getElementById('vt'),store=(k,v)=>{try{return v===undefined?sessionStorage.getItem(k):sessionStorage.setItem(k,v);}catch{return null;}};
 // Le jeton quitte la barre d'adresse (il ne doit pas être recopié ni partagé) mais reste pour cet onglet, si la page est rechargée.
 const token=location.hash.slice(1)||store('fg-test')||'';if(token)store('fg-test',token);history.replaceState(null,'',location.pathname);
 let info=null,running=false,last=null,net=null,fault=null,guardianSays=null,wifi=null,pcTimer=null,pcAsked=false,pcOps=[],pcAvail=[],pcOn=false,confirming=null;
 const live={on:false,timer:null,tick:0,hist:[],speed:null,busy:false};
 const keep=(k,v)=>{try{return v===undefined?localStorage.getItem(k):localStorage.setItem(k,v);}catch{return null;}};
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
 const head=(demo=false)=>{const h=el('header',{class:'vt-head'},el('img',{src:'pwa/icon-192.png',alt:''}),el('div',{},el('strong',{text:'Moov Africa · Fibre'}),el('small',{text:'Tester ma connexion avec Guardian'})));
  if(demo){const b=el('button',{type:'button',class:'vt-demo-badge',id:'vt-demo-badge','aria-expanded':'false','aria-controls':'vt-demo'},'Démo');b.onclick=()=>toggleDemo();h.append(b);}return h;};

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
  const windows=/Windows/.test(navigator.userAgent);
  const wifi=el('input',{id:'vt-wifi',type:'text',maxlength:'40',autocomplete:'off',spellcheck:'false',placeholder:'Exemple : MOOV-FIBRE-2A4F',value:keep('fg-wifi-name')||''});
  wifi.oninput=()=>keep('fg-wifi-name',wifi.value.trim());
  const card=el('section',{class:'vt-card vt-network','aria-labelledby':'vt-title'},
   el('span',{class:'vt-eyebrow'},el('i'),'VOTRE RÉSEAU, EN CE MOMENT'),el('h1',{id:'vt-title',text:hello}),
   el('p',{text:'Guardian mesure la connexion de cet appareil, là où vous êtes. Rien n’est installé.'}),
   el('label',{class:'vt-wifi',for:'vt-wifi'},el('span',{},'Nom du Wi-Fi',el('em',{class:'vt-wifi-tag',id:'vt-wifi-tag',hidden:''},'Lu sur ce PC')),wifi,el('small',{id:'vt-wifi-help',text:windows?'Une page web ne peut pas lire ce nom elle-même. Tapez-le, ou branchez ce PC juste en dessous : Windows le donnera.':'Votre téléphone ne laisse aucune page web lire ce nom : tapez-le une fois, il est gardé sur cet appareil.'})),
   windows?pcBlock():null,
   el('fieldset',{class:'vt-net'},el('legend',{text:'Cet appareil est connecté par :'}),nets,detected?el('p',{class:'vt-net-hint',text:'Choix proposé par votre appareil. Corrigez-le si besoin.'}):null),
   el('dl',{class:'vt-facts',id:'vt-facts'},...facts()));
  const full=el('section',{class:'vt-card vt-full','aria-labelledby':'vt-full-title'},
   el('h2',{id:'vt-full-title',text:'Test complet'}),el('p',{text:'Réception, envoi et temps de réponse, en 20 secondes environ.'}),
   gauge(),el('p',{class:'vt-stage',id:'vt-stage',text:'Prêt quand vous l’êtes.'}),el('ol',{class:'vt-steps','aria-hidden':'true'},el('li'),el('li'),el('li'),el('li'),el('li')),
   go,el('p',{class:'vt-data',text:'Le test utilise entre 3 et 11 Mo de données.'}));
  root.replaceChildren(head(true),card,liveCard(),demoCard(),full,result());
  loadNetwork();if(windows)pollPc(true);
 }

 // Ce que l'appareil et le réseau disent d'eux-mêmes. L'opérateur vient de l'adresse IP publique, vue par le serveur.
 function device(){const u=navigator.userAgent,os=/iPhone/.test(u)?'iPhone':/iPad/.test(u)?'iPad':/Android/.test(u)?'Android':/Windows/.test(u)?'Windows':/Mac OS X/.test(u)?'Mac':/Linux/.test(u)?'Linux':'Appareil',nav=/Edg\//.test(u)?'Edge':/OPR\//.test(u)?'Opera':/SamsungBrowser/.test(u)?'Samsung Internet':/Firefox\//.test(u)?'Firefox':/CriOS|Chrome\//.test(u)?'Chrome':/Safari\//.test(u)?'Safari':'navigateur';return os+' · '+nav;}
 function facts(){
  const c=navigator.connection,rows=[['Opérateur du réseau',net?(net.operator||(net.local?'Réseau local':'Non trouvé')):'Recherche…'],['Adresse IP publique',net?(net.ip||'—'):'Recherche…'],['Lieu du réseau',net?([net.city,net.country].filter(Boolean).join(', ')||'—'):'Recherche…'],['Appareil',device()]];
  if(wifi&&!wifi.error){const q=wifi.signal==null?'':wifi.signal>=80?' · très bon':wifi.signal>=60?' · bon':wifi.signal>=40?' · moyen':' · faible';
   rows.unshift(...[['Signal Wi-Fi',wifi.signal==null?null:wifi.signal+' %'+q+' (≈ '+Math.round(wifi.signal/2-100)+' dBm)'],['Canal',[wifi.channel,wifi.band].filter(v=>v!=null).join(' · ')||null],['Norme Wi-Fi',wifi.radio],['Vitesse de liaison',wifi.rxMbps||wifi.txMbps?[wifi.rxMbps&&fr(wifi.rxMbps)+' Mbps en réception',wifi.txMbps&&fr(wifi.txMbps)+' Mbps en envoi'].filter(Boolean).join(' · '):null],['Sécurité',wifi.auth]].filter(r=>r[1]));}
  if(c&&(c.downlink||c.effectiveType))rows.push(['Estimation de l’appareil',[c.effectiveType&&c.effectiveType.toUpperCase(),c.downlink?fr(c.downlink,c.downlink<10?1:0)+' Mbps':null,c.rtt?fr(c.rtt)+' ms':null].filter(Boolean).join(' · ')]);
  return rows.map(([k,v])=>el('div',{},el('dt',{text:k}),el('dd',{text:v})));
 }
 async function loadNetwork(){try{net=await api('network',null,6000);}catch(e){net={ip:null,operator:null};}const dl=document.getElementById('vt-facts');if(dl)dl.replaceChildren(...facts());}

 // ---------- Brancher ce PC (Windows) : un petit fichier lit le Wi-Fi auprès de Windows et l'envoie ici ----------
 function pcBlock(){
  const b=el('button',{type:'button',class:'vt-btn vt-pc-go',id:'vt-pc-go'},icon('M4 5h16v10H4zM9 19h6M12 15v4',18),'Brancher ce PC');b.onclick=plugPc;
  return el('div',{class:'vt-pc',id:'vt-pc'},
   el('div',{class:'vt-pc-text'},el('b',{text:'Lire le vrai Wi-Fi de ce PC'}),el('small',{text:'Un petit fichier demande à Windows le nom du Wi-Fi, la force du signal, le canal et la vitesse de liaison, puis les envoie ici toutes les 2 secondes. Rien à installer.'})),
   b,el('ol',{class:'vt-pc-steps',id:'vt-pc-steps',hidden:''},
    el('li',{text:'Ouvrez le fichier « Guardian-Wi-Fi.cmd » qui vient d’être téléchargé. Si Edge demande, choisissez « Conserver ».'}),
    el('li',{text:'Si Windows affiche « Windows a protégé votre ordinateur » : touchez « Informations complémentaires », puis « Exécuter quand même ».'}),
    el('li',{text:'Laissez la fenêtre noire ouverte : les chiffres apparaissent ici. Fermez-la pour arrêter.'})),
   el('p',{class:'vt-pc-status',id:'vt-pc-status',role:'status',hidden:''}),
   el('div',{class:'vt-ops',id:'vt-ops',hidden:''}));
 }
 // Opérations à distance : 4 actions fixes que le PC sait faire, lancées seulement quand le client les demande.
 const OP_STATE={attente:'En attente',['en cours']:'En cours…'};
 function opsView(){
  const grid=el('div',{class:'vt-ops-grid'});
  for(const o of pcAvail){
   const busy=pcOps.some(x=>x.op===o.id&&x.state!=='fait');
   if(confirming===o.id){const yes=el('button',{type:'button',class:'vt-btn primary'},'Oui, on y va'),no=el('button',{type:'button',class:'vt-btn'},'Annuler');yes.onclick=()=>{confirming=null;runOp(o.id);};no.onclick=()=>{confirming=null;paintPc();};setTimeout(()=>yes.focus(),0);grid.append(el('div',{class:'vt-op-confirm'},el('p',{text:o.confirm}),el('div',{class:'vt-op-confirm-actions'},yes,no)));continue;}
   const b=el('button',{type:'button',class:'vt-op','data-op':o.id},el('b',{text:o.label}),el('small',{text:busy?'En cours…':o.hint}));if(busy)b.disabled=true;
   b.onclick=()=>{if(o.confirm){confirming=o.id;paintPc();}else runOp(o.id);};grid.append(b);
  }
  const done=[...pcOps].reverse().slice(0,4).map(x=>el('li',{class:'vt-op-result '+(x.state!=='fait'?'wait':x.ok?'good':'bad')},
   el('div',{class:'vt-op-result-head'},el('b',{text:x.label}),el('span',{text:x.state==='fait'?(x.ok?'Réussi':'À voir'):OP_STATE[x.state]||x.state})),
   x.text?el('p',{text:x.text}):null));
  return [el('h3',{text:'Opérations à distance sur ce PC'}),el('p',{class:'vt-ops-note',text:'Guardian ne fait que ces 4 actions, et seulement quand vous les demandez.'}),grid,done.length?el('ul',{class:'vt-op-results','aria-live':'polite'},...done):null].filter(Boolean);
 }
 async function runOp(op){try{await api('op',{op},8000);}catch(e){const st=document.getElementById('vt-pc-status');if(st){st.hidden=false;st.className='vt-pc-status warn';st.textContent=e.message;}}await pollPc(true);}
 async function plugPc(){
  const b=document.getElementById('vt-pc-go');if(b)b.disabled=true;
  try{const r=await fetch('/api/test/agent',{cache:'no-store',headers:{'X-Test-Token':token},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Object.assign(new Error(),{status:r.status});
   const url=URL.createObjectURL(await r.blob()),a=el('a',{href:url,download:'Guardian-Wi-Fi.cmd'});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   pcAsked=true;document.getElementById('vt-pc-steps').hidden=false;paintPc();pollPc();
  }catch(e){if(e.status===404)return closed('Ce lien de test a expiré','Demandez-en un nouveau à Guardian, dans l’application ou sur WhatsApp. Chaque lien sert 30 minutes.');const st=document.getElementById('vt-pc-status');if(st){st.hidden=false;st.textContent='Le fichier n’a pas pu être téléchargé. Réessayez.';}}
  finally{if(b)b.disabled=false;}
 }
 // Une lecture tout de suite (le PC est peut-être déjà branché), puis toutes les 2 secondes une fois le fichier lancé.
 async function pollPc(once=false){
  if(pcTimer&&!once)return;
  const read=async()=>{try{const r=await api('wifi',null,5000);const was=!!wifi;wifi=r.wifi;pcOps=r.ops||[];pcAvail=r.available||[];pcOn=!!r.connected;if((wifi||pcOn)&&!pcTimer)pcTimer=setInterval(read,2000);paintPc(was!==!!wifi);}catch(e){if(e.status===404){clearInterval(pcTimer);pcTimer=null;}}};
  await read();if(!once&&!pcTimer)pcTimer=setInterval(read,2000);
 }
 function paintPc(changed=true){
  const st=document.getElementById('vt-pc-status'),input=document.getElementById('vt-wifi'),tag=document.getElementById('vt-wifi-tag'),dl=document.getElementById('vt-facts'),b=document.getElementById('vt-pc-go'),steps=document.getElementById('vt-pc-steps');
  const ok=wifi&&!wifi.error&&wifi.ssid;
  if(input){input.readOnly=!!ok;if(ok)input.value=wifi.ssid;}if(tag)tag.hidden=!ok;
  if(st){st.hidden=!(pcAsked||wifi);st.className='vt-pc-status'+(ok?' on':wifi?.error?' warn':'');
   st.textContent=ok?'PC branché · '+(wifi.computer?wifi.computer+' · ':'')+'mis à jour il y a '+Math.max(1,Math.round((wifi.age||0)/1000))+' s'
    :wifi?.error==='location'?'Windows cache le nom du Wi-Fi. Ouvrez Paramètres > Confidentialité et sécurité > Localisation, activez « Services de localisation » et « Autoriser les applications de bureau ».'
    :wifi?.error==='no-wifi'?'Ce PC n’est pas connecté en Wi-Fi en ce moment (câble ou aucun réseau).'
    :wifi?.error?'Windows ne donne pas les informations Wi-Fi sur ce PC.'
    :'En attente du PC… Lancez le fichier téléchargé.';}
  if(ok&&steps)steps.hidden=true;if(b)b.hidden=!!ok;
  // On ne redessine les opérations que si quelque chose a changé (le focus clavier reste en place).
  const ops=document.getElementById('vt-ops'),sig=JSON.stringify([pcOn,pcOps,pcAvail,confirming]);if(ops){ops.hidden=!pcOn;if(pcOn&&sig!==ops.dataset.sig){ops.dataset.sig=sig;ops.replaceChildren(...opsView());}}
  if(dl)dl.replaceChildren(...facts());
  if(live.on||fault)paintLive();
 }

 // ---------- En direct : une sonde toutes les 2 secondes, 512 Ko toutes les 10 secondes ----------
 const WINDOW=60000;
 function liveCard(){
  const b=el('button',{type:'button',class:'vt-btn primary vt-live-go',id:'vt-live-go'},icon('M6 4l14 8-14 8z',18),'Suivre en direct');b.onclick=()=>live.on?stopLive():startLive();
  return el('section',{class:'vt-card vt-live','aria-labelledby':'vt-live-title'},
   el('div',{class:'vt-live-head'},el('h2',{id:'vt-live-title'},'En direct'),el('span',{class:'vt-live-dot',id:'vt-live-dot'},el('i'),'Arrêté')),
   el('p',{class:'vt-fault-ribbon',id:'vt-ribbon',hidden:''}),
   el('div',{class:'vt-tiles vt-live-tiles',id:'vt-live-tiles'},...liveTiles()),
   el('div',{class:'vt-chart',id:'vt-chart'},chart()),
   el('div',{class:'vt-guardian',id:'vt-live-guardian',hidden:''}),
   b,el('p',{class:'vt-data',text:'Le suivi en direct utilise environ 3 Mo par minute.'}));
 }
 function stats(){
  const recent=live.hist.filter(h=>Date.now()-h.t<30000),ok=recent.filter(h=>h.rtt!=null).map(h=>h.rtt),sorted=[...ok].sort((a,b)=>a-b);
  const latencyMs=sorted.length?sorted[Math.floor(sorted.length/2)]:null,jitterMs=ok.length>1?ok.slice(1).reduce((a,b,i)=>a+Math.abs(b-ok[i]),0)/(ok.length-1):null;
  return {signal:wifi&&!wifi.error?wifi.signal:null,downloadMbps:live.speed,latencyMs,jitterMs,lossPct:recent.length?Math.round(100*(recent.length-ok.length)/recent.length):0,network:document.querySelector('input[name=net]:checked')?.value||null};
 }
 // Panne simulée : mêmes règles que le serveur (vrai-test.cjs), appliquées aux vraies mesures pour l'affichage.
 function simulate(m,f){if(!f)return m;const signal=m.signal==null?null:Math.round(m.signal*(f.signal??1));if(f.cut)return {...m,signal,downloadMbps:null,latencyMs:null,jitterMs:null,lossPct:100};return {...m,downloadMbps:m.downloadMbps==null?null:Math.round(m.downloadMbps*f.down*10)/10,latencyMs:m.latencyMs==null?null:Math.round(m.latencyMs+f.add),jitterMs:Math.round((m.jitterMs||0)+f.jitter),lossPct:Math.max(m.lossPct,f.loss),signal};}
 function liveTiles(){
  const real=stats(),shown=simulate(real,fault),was=(v,unit,d=0)=>fault?el('em',{text:'réel : '+(v==null?'—':fr(v,d)+(unit?' '+unit:''))}):null;
  const stab=m=>live.hist.length?fr(100-m.lossPct)+' %':'—';
  return [
   el('div',{class:'vt-tile'},el('small',{text:'Réponse'}),el('strong',{text:shown.latencyMs==null?(live.hist.length?'aucune':'—'):fr(shown.latencyMs)}),el('span',{text:'ms'}),was(real.latencyMs,'ms')),
   el('div',{class:'vt-tile'},el('small',{text:'Débit'}),el('strong',{text:shown.downloadMbps==null?(fault?.cut&&live.hist.length?'0':'—'):mbps(shown.downloadMbps)}),el('span',{text:'Mbps'}),was(real.downloadMbps,'Mbps',real.downloadMbps<10?1:0)),
   el('div',{class:'vt-tile'},el('small',{text:'Stabilité'}),el('strong',{text:stab(shown)}),el('span',{text:'réponses'}),fault?el('em',{text:'réel : '+stab(real)}):null),
   real.signal!=null?el('div',{class:'vt-tile'},el('small',{text:'Signal Wi-Fi'}),el('strong',{text:shown.signal?shown.signal+' %':'—'}),el('span',{text:shown.signal?'de la box':'box éteinte'}),fault?el('em',{text:'réel : '+real.signal+' %'}):null):null].filter(Boolean);
 }
 // Courbe des 60 dernières secondes : temps de réponse réel, et pendant une panne simulée, ce qu'il deviendrait.
 function chart(){
  const W=innerWidth>=900?460:320,H=120,s=svg('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':'Temps de réponse sur la dernière minute'}),now=Date.now(),pts=live.hist.filter(h=>now-h.t<WINDOW);
  const sim=pts.map(h=>({...h,rtt:fault?(fault.cut?null:h.rtt==null?null:h.rtt+fault.add):h.rtt}));
  const top=Math.max(200,...pts.map(h=>h.rtt||0),...sim.map(h=>h.rtt||0))*1.15,x=t=>W-(now-t)/WINDOW*W,y=v=>H-18-(v/top)*(H-30);
  for(const v of [0,.5,1]){const yy=H-18-v*(H-30);s.append(svg('line',{x1:0,x2:W,y1:yy,y2:yy,class:'vt-grid'}));}
  const label=svg('text',{x:4,y:12,class:'vt-tick'});label.textContent=fr(top)+' ms';s.append(label);
  for(const [xx,txt,anchor] of [[4,'il y a 1 min','start'],[W-4,'maintenant','end']]){const t=svg('text',{x:xx,y:H-1,class:'vt-tick','text-anchor':anchor});t.textContent=txt;s.append(t);}
  const line=(list,cls)=>{let d='',pen=false;for(const h of list){if(h.rtt==null){pen=false;continue;}d+=(pen?'L':'M')+x(h.t).toFixed(1)+' '+y(h.rtt).toFixed(1)+' ';pen=true;}if(d)s.append(svg('path',{d:d.trim(),class:cls,fill:'none'}));for(const h of list)if(h.rtt==null)s.append(svg('rect',{x:x(h.t)-3,y:H-24,width:6,height:8,rx:2,class:'vt-lost'}));};
  if(fault)line(pts,'vt-line-real');line(fault?sim:pts,fault?'vt-line-sim':'vt-line');
  if(!pts.length){const t=svg('text',{x:W/2,y:H/2,class:'vt-empty','text-anchor':'middle'});t.textContent='Touchez « Suivre en direct »';s.append(t);}
  return s;
 }
 function paintLive(){
  const tiles=document.getElementById('vt-live-tiles'),c=document.getElementById('vt-chart'),dot=document.getElementById('vt-live-dot'),rib=document.getElementById('vt-ribbon'),b=document.getElementById('vt-live-go'),g=document.getElementById('vt-live-guardian');
  if(tiles)tiles.replaceChildren(...liveTiles());if(c)c.replaceChildren(chart());
  if(dot){dot.className='vt-live-dot'+(live.on?' on':'')+(fault?' sim':'');dot.lastChild.textContent=live.on?(fault?'Panne simulée':'En direct'):'Arrêté';}
  if(rib){rib.hidden=!fault;rib.textContent=fault?'Panne simulée : '+fault.label+'. Vos vraies mesures continuent, l’écran montre ce qu’elles deviendraient.':'';}
  if(b){b.replaceChildren(icon(live.on?'M7 5h3v14H7zM14 5h3v14h-3z':'M6 4l14 8-14 8z',18),live.on?'Arrêter le direct':'Suivre en direct');}
  if(g){g.hidden=!(fault&&guardianSays);if(fault&&guardianSays){const [tone,label]=LEVEL[guardianSays.level]||['slow',''];g.replaceChildren(el('img',{src:'pwa/icon-192.png',alt:''}),el('div',{class:'vt-bubble'},el('b',{text:'Guardian'}),el('span',{class:'vt-verdict small '+tone},el('i'),label),el('span',{text:guardianSays.text})));}}
 }
 async function liveTick(){
  if(live.busy)return;live.busy=true;const n=live.tick++;
  try{const t=performance.now();let rtt=null;try{await api('ping',null,3000);rtt=Math.round(performance.now()-t);}catch(e){if(e.status===404){stopLive();return closed('Ce lien de test a expiré','Demandez-en un nouveau à Guardian, dans l’application ou sur WhatsApp. Chaque lien sert 30 minutes.');}}
   live.hist.push({t:Date.now(),rtt});live.hist=live.hist.filter(h=>Date.now()-h.t<WINDOW+4000);
   if(n%5===0&&rtt!=null){const s=performance.now();try{const r=await fetch('/api/test/sample',{cache:'no-store',headers:{'X-Test-Token':token},signal:AbortSignal.timeout(8000)});const b=await r.arrayBuffer();if(r.ok)live.speed=Math.round(b.byteLength*8/((performance.now()-s)/1000)/1e5)/10;}catch{}}
   paintLive();
   if(fault&&(n%5===0||!guardianSays))askGuardian(fault);
  }finally{live.busy=false;}
 }
 function startLive(){if(live.on)return;live.on=true;liveTick();live.timer=setInterval(liveTick,2000);paintLive();}
 function stopLive(){live.on=false;clearInterval(live.timer);live.timer=null;paintLive();}
 addEventListener('visibilitychange',()=>{if(document.hidden&&live.on){clearInterval(live.timer);live.timer=null;}else if(!document.hidden&&live.on&&!live.timer){live.timer=setInterval(liveTick,2000);}});

 // ---------- Démo : pannes simulées sur les vraies mesures ----------
 function demoCard(){
  const grid=el('div',{class:'vt-scenarios'});
  for(const f of info.scenarios||[]){const b=el('button',{type:'button',class:'vt-scenario','aria-pressed':'false','data-id':f.id},el('b',{text:f.label}),el('small',{text:f.hint}));b.onclick=()=>pickFault(f);grid.append(b);}
  const stop=el('button',{type:'button',class:'vt-btn',id:'vt-fault-stop',disabled:''},'Arrêter la simulation');stop.onclick=()=>pickFault(null);
  return el('section',{class:'vt-card vt-demo',id:'vt-demo',hidden:'','aria-labelledby':'vt-demo-title'},
   el('h2',{id:'vt-demo-title',text:'Simuler une panne'}),
   el('p',{text:'Votre Wi-Fi n’est pas touché. Guardian part de vos vraies mesures et montre ce qu’elles deviendraient pendant la panne, puis ce qu’il ferait pour vous.'}),
   grid,stop);
 }
 function toggleDemo(open){const d=document.getElementById('vt-demo'),b=document.getElementById('vt-demo-badge');if(!d)return;const show=open??d.hidden;d.hidden=!show;b?.setAttribute('aria-expanded',String(show));if(show)d.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});}
 // Guardian juge la panne simulée à partir des vraies mesures du moment ; il refait son avis toutes les 10 secondes.
 async function askGuardian(f){const m=stats();if(m.latencyMs==null&&live.hist.length<2&&!f.cut)return;try{const r=await api('preview',{scenario:f.id,metrics:m});if(fault===f){guardianSays=r;paintLive();}}catch{}}
 async function pickFault(f){
  fault=f;guardianSays=null;
  document.querySelectorAll('.vt-scenario').forEach(b=>b.setAttribute('aria-pressed',String(!!f&&b.dataset.id===f.id)));
  const stop=document.getElementById('vt-fault-stop');if(stop)stop.disabled=!f;
  if(f&&!live.on)startLive();paintLive();
  if(f)await askGuardian(f);
  if(f&&innerWidth<900)document.querySelector('.vt-live')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
 }
 function result(){
  const card=el('section',{class:'vt-card',id:'vt-result','aria-labelledby':'vt-result-title'});
  if(!last){card.append(el('h2',{id:'vt-result-title',text:'Votre résultat apparaîtra ici'}),el('div',{class:'vt-guardian'},el('img',{src:'pwa/icon-192.png',alt:''}),el('p',{class:'vt-bubble'},el('b',{text:'Guardian'}),'Pour savoir si c’est le Wi-Fi ou la ligne, faites un premier test près de la box, puis un second dans la pièce où ça rame.')));return card;}
  const [tone,label]=LEVEL[last.level]||['slow','Résultat'],m=last.metrics,answered=5-Math.round(m.lossPct/20);
  card.append(el('span',{class:'vt-verdict '+tone},el('i'),label),el('h2',{id:'vt-result-title',class:'vt-sr',text:'Résultat du test'}),
   el('div',{class:'vt-tiles'},
    el('div',{class:'vt-tile'},el('small',{text:'Réception'}),el('strong',{text:mbps(m.downloadMbps)}),el('span',{text:'Mbps'})),
    el('div',{class:'vt-tile'},el('small',{text:'Envoi'}),el('strong',{text:mbps(m.uploadMbps)}),el('span',{text:'Mbps'})),
    el('div',{class:'vt-tile'},el('small',{text:'Réponse'}),el('strong',{text:m.latencyMs==null?'—':fr(m.latencyMs)}),el('span',{text:'ms'})),
    el('div',{class:'vt-tile'},el('small',{text:'Stabilité'}),el('strong',{text:answered+'/5'}),el('span',{text:'réponses'}))),
   el('div',{class:'vt-guardian'},el('img',{src:'pwa/icon-192.png',alt:''}),el('p',{class:'vt-bubble'},el('b',{text:'Guardian'}),last.text)),
   last.whatsapp?el('p',{class:'vt-wa'},icon('M20 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20.5l1.4-4.4A8.5 8.5 0 1 1 20 11.5Z',18),'Je vous ai aussi envoyé ce résultat sur WhatsApp.'):'',
   el('details',{class:'vt-how'},el('summary',{text:'Comment ce test est fait'}),el('ul',{},
    el('li',{text:'Cet appareil envoie 5 sondes à Guardian et chronomètre chaque réponse.'}),
    el('li',{text:'Il télécharge ensuite 2 Mo, et 6 Mo de plus si la ligne est rapide.'}),
    el('li',{text:'Il envoie enfin 1 Mo, et 2 Mo de plus si la ligne est rapide.'}),
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
 // Débit d'envoi : des données au hasard (rien de personnel), comptées par le serveur puis oubliées.
 async function push(mib){const data=new Uint8Array(mib*1024*1024);for(let i=0;i<data.length;i+=65536)crypto.getRandomValues(data.subarray(i,i+65536));const start=performance.now();const r=await fetch('/api/test/upload',{method:'POST',cache:'no-store',headers:{'X-Test-Token':token,'Content-Type':'application/octet-stream'},body:data,signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Envoi refusé.');const seconds=(performance.now()-start)/1000;return {mbps:Math.round(data.length*8/seconds/1e5)/10,seconds};}
 async function measure(){
  if(running)return;running=true;root.classList.add('vt-running');const go=document.getElementById('vt-go');if(go){go.disabled=true;go.lastChild.textContent='Test en cours…';}
  const net=document.querySelector('input[name=net]:checked')?.value||null;dial(null);
  try{
   const times=[];let lost=0;
   for(let i=0;i<5;i++){stage('Temps de réponse · '+(i+1)+' sur 5',1);const t=performance.now();try{await api('ping',null,4000);times.push(performance.now()-t);}catch(e){if(e.status===404||e.status===429)throw e;lost++;}}
   stage('Débit · premier transfert',2);let speed=null;
   const one=await round(1,12000).catch(()=>({mbps:null,seconds:99}));speed=one.mbps;
   if(one.mbps!=null&&one.seconds<2.5){stage('Débit · trois transferts en même temps',3);const three=await round(3,10000).catch(()=>({mbps:null}));if(three.mbps!=null)speed=Math.max(speed,three.mbps);}
   dial(speed);stage('Envoi · cet appareil envoie des données',4);let upload=null;
   const up1=await push(1).catch(()=>null);upload=up1?.mbps??null;
   if(up1&&up1.seconds<1.5){const up2=await push(2).catch(()=>null);if(up2?.mbps!=null)upload=Math.max(upload,up2.mbps);}
   stage('Guardian analyse le résultat…',5);
   const mean=times.length?times.reduce((a,b)=>a+b,0)/times.length:null,jitter=times.length>1?times.slice(1).reduce((a,b,i)=>a+Math.abs(b-times[i]),0)/(times.length-1):null;
   const r=await api('result',{metrics:{downloadMbps:speed,uploadMbps:upload,latencyMs:mean,jitterMs:jitter,lossPct:lost*20,network:net}},10000);
   info.tests++;last={...r,left:info.maxTests-info.tests};
   const tone=(LEVEL[r.level]||['slow'])[0];dial(speed,tone);stage('Test terminé.',5);
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
