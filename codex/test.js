(function(){
 'use strict';
 // « Tester ma connexion » : une vraie mesure, faite par cet appareil, sur le réseau où il est branché
 // (Wi-Fi de la box, partage de connexion ou données mobiles), jusqu'au serveur de Guardian.
 // 5 sondes de réponse, puis 2 Mo téléchargés ; si la ligne est rapide, 6 Mo de plus en 3 flux parallèles.
 // Le résultat part dans la conversation Guardian du client (et sur WhatsApp si le lien vient de là).
 // En plus : les infos du réseau (opérateur, adresse IP, appareil), un suivi en direct toutes les 2 secondes,
 // Dès l'ouverture, Guardian fait une copie du Wi-Fi (20 secondes de mesures, et avec un PC branché : nom, signal, appareils).
 // Le bouton « Démo » rejoue une panne sur cette copie : le vrai Wi-Fi n'est jamais touché.
 const root=document.getElementById('vt'),store=(k,v)=>{try{return v===undefined?sessionStorage.getItem(k):sessionStorage.setItem(k,v);}catch{return null;}};
 // Le jeton quitte la barre d'adresse (il ne doit pas être recopié ni partagé) mais reste pour cet onglet, si la page est rechargée.
 const token=location.hash.slice(1)||store('fg-test')||'';if(token)store('fg-test',token);history.replaceState(null,'',location.pathname);
 let info=null,running=false,last=null,net=null,fault=null,wifi=null,pcTimer=null,pcAsked=false,pcOps=[],pcAvail=[],pcOn=false,confirming=null;
 let lan=null,copy=null,copyLeft=5,copyRec=null,copyNote='',twinSays=null,twinError='',waiting=false;const COPY_MS=20000;
 const live={on:false,timer:null,tick:0,hist:[],speed:null,busy:false};
 const keep=(k,v)=>{try{return v===undefined?localStorage.getItem(k):localStorage.setItem(k,v);}catch{return null;}};
 const NETS=[['wifi','Wi-Fi de la box','M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 19.5h.01'],['ethernet','Câble de la box','M7 3h10v6H7zM9 9v4m6-4v4M6 13h12v8H6z'],['hotspot','Partage de connexion','M7 3h10v18H7zM11 18h2M12 7v4m-2.5-2.5a3.5 3.5 0 0 1 5 0'],['cellular','Données mobiles','M4 20v-3m5 3v-7m5 7V9m5 11V4']];
 const LEVEL={bonne:['good','Bonne connexion'],lente:['slow','Connexion lente'],'tres-lente':['bad','Très lente'],instable:['bad','Connexion instable'],coupe:['bad','Pas de connexion']};
 const el=(tag,attrs={},...kids)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs))k==='text'?n.textContent=v:k==='class'?n.className=v:n.setAttribute(k,v);n.append(...kids.filter(k=>k!=null&&k!==false));return n;};
 const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
 const icon=(d,size=20)=>{const s=svg('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});s.append(svg('path',{d}));return s;};
 const fr=(v,d=0)=>Number(v).toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d});
 const mbps=v=>v==null?'—':fr(v,v<10?1:0);
 const ago=ms=>ms<59500?Math.max(1,Math.round(ms/1000))+' s':ms<3570000?Math.round(ms/60000)+' min':Math.round(ms/3600000)+' h';
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const hour=t=>new Date(t).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 // Icônes des appareils du Wi-Fi.
 const DEV={box:'M4 14h16v5H4zM8 16.5h.01M12 16.5h.01M7 14 5 8m12 6 2-6',partage:'M8 3h8v18H8zM11 18h2M4 9a5 5 0 0 0 0 6M20 9a5 5 0 0 1 0 6',pc:'M5 5h14v10H5zM3 19h18',mobile:'M8 3h8v18H8zM11 18h2',self:'M8 3h8v18H8zM11 18h2',tele:'M3 6h18v11H3zM8 21h8M12 17v4',console:'M6 9h12a3 3 0 0 1 3 3v2a3 3 0 0 1-5.2 2L14 14h-4l-1.8 2A3 3 0 0 1 3 14v-2a3 3 0 0 1 3-3zM8 11v3M6.5 12.5h3M15.5 12h.01M17.5 13.5h.01',appareil:'M7 7h10v10H7zM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4'};
 const TONE={ok:'good',box:'good',lent:'slow',faible:'slow','box-charge':'slow',instable:'bad','sans-internet':'bad',deconnecte:'bad','box-los':'bad','box-clignote':'bad',eteinte:'bad'};
 async function api(route,body,timeout=8000){
  let r;
  try{r=await fetch('/api/test/'+route,{method:body?'POST':'GET',cache:'no-store',headers:{'X-Test-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});}
  catch{throw Object.assign(new Error('Guardian ne répond pas. Vérifiez que cet appareil est connecté, puis réessayez.'),{status:0});}
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
   windows?el('div',{class:'vt-devices',id:'vt-devices',hidden:''}):null,
   el('fieldset',{class:'vt-net'},el('legend',{text:'Cet appareil est connecté par :'}),nets,detected?el('p',{class:'vt-net-hint',text:'Choix proposé par votre appareil. Corrigez-le si besoin.'}):null),
   el('dl',{class:'vt-facts',id:'vt-facts'},...facts()));
  const full=el('section',{class:'vt-card vt-full','aria-labelledby':'vt-full-title'},
   el('h2',{id:'vt-full-title',text:'Test complet'}),el('p',{text:'Réception, envoi et temps de réponse, en 20 secondes environ.'}),
   gauge(),el('p',{class:'vt-stage',id:'vt-stage',text:'Prêt quand vous l’êtes.'}),el('ol',{class:'vt-steps','aria-hidden':'true'},el('li'),el('li'),el('li'),el('li'),el('li')),
   go,el('p',{class:'vt-data',text:'Le test utilise entre 3 et 11 Mo de données.'}));
  root.replaceChildren(head(true),card,copyCard(),liveCard(),demoCard(),full,result());
  loadNetwork();loadCopy();if(windows)pollPc(true);
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
   el('div',{class:'vt-pc-text'},el('b',{text:'Lire le vrai Wi-Fi de ce PC'}),el('small',{text:'Un petit fichier demande à Windows le nom du Wi-Fi, la force du signal, le canal et la vitesse de liaison, et compte les appareils de ce Wi-Fi (sans leur nom). Il envoie tout ici toutes les 2 secondes. Rien à installer, rien n’est changé.'})),
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
  return [el('h3',{text:'Opérations à distance sur ce PC'}),el('p',{class:'vt-ops-note',text:'En plus de ce relevé, Guardian ne fait que ces 4 actions, et seulement quand vous les demandez.'}),grid,done.length?el('ul',{class:'vt-op-results','aria-live':'polite'},...done):null].filter(Boolean);
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
  const read=async()=>{try{const r=await api('wifi',null,5000);const was=!!wifi,wasOn=pcOn;wifi=r.wifi;pcOps=r.ops||[];pcAvail=r.available||[];pcOn=!!r.connected;lan=r.scan?r:null;if((wifi||pcOn)&&!pcTimer)pcTimer=setInterval(read,2000);paintPc(was!==!!wifi);
   // Le PC vient de se brancher et la copie n'a ni le nom du Wi-Fi ni les appareils : Guardian la refait avec.
   if(pcOn&&!wasOn&&copy?.done&&!copy.pc&&!copyRec&&copyLeft>0&&!running&&!waiting){copyNote='Le PC est branché : Guardian refait la copie avec le nom du Wi-Fi et les appareils connectés.';startCopy();}
  }catch(e){if(e.status===404){clearInterval(pcTimer);pcTimer=null;}}};
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
  // La liste n'est redessinée que si un appareil arrive ou part (ou toutes les 20 secondes pour les durées).
  const dv=document.getElementById('vt-devices');if(dv){dv.hidden=!(pcOn&&lan);const sig=lan?JSON.stringify([lan.devices.map(d=>d.id+d.label),lan.events.map(e=>e.type+e.label),Math.floor(Date.now()/20000)]):'';if(pcOn&&lan&&sig!==dv.dataset.sig){dv.dataset.sig=sig;dv.replaceChildren(...devicesView());}}
  if(copyRec)paintCopy();
 }
 // Les appareils vus par le PC sur ce Wi-Fi : type d'appareil, adresse locale, fin de l'adresse MAC. Jamais leur nom.
 const devIcon=kind=>el('span',{class:'vt-dev-icon '+kind},icon(DEV[kind]||DEV.appareil,18));
 // On compte les appareils reliés à la box (la box elle-même est dans la liste, pas dans le compte), partout pareil.
 const linked=list=>(list||[]).filter(d=>d.kind!=='box'&&d.kind!=='partage').length;
 const plural=(n,word)=>n+' '+word+(n>1?'s':'');
 function devicesView(){
  const list=lan.devices||[],ev=(lan.events||[]).find(e=>e.ago<180000),n=linked(list),cable=lan.scan?.medium==='cable';
  return [el('div',{class:'vt-devices-head'},el('h3',{text:cable?'Sur ce réseau en ce moment':'Sur ce Wi-Fi en ce moment'}),el('span',{class:'vt-count',text:plural(n,'connecté')})),
   ev?el('p',{class:'vt-dev-event '+(ev.type==='arrive'?'in':'out'),role:'status',text:ev.label+(ev.type==='arrive'?' vient d’arriver':' vient de partir')+', il y a '+ago(ev.ago)+'.'}):null,
   el('ul',{class:'vt-dev-list'},...list.map(d=>el('li',{class:'vt-dev'},devIcon(d.kind),el('div',{class:'vt-dev-text'},el('b',{text:d.label}),el('small',{text:[d.ip,d.mac,d.random?'adresse privée':null].filter(Boolean).join(' · ')})),d.since==null?null:el('span',{class:'vt-dev-since',text:'arrivé il y a '+ago(d.since)})))),
   el('p',{class:'vt-devices-note',text:'Le PC regarde '+(cable?'le réseau':'le Wi-Fi')+' toutes les 20 secondes, sans lire le nom des appareils. Sous chaque appareil : son adresse dans la maison et la fin du numéro de sa carte Wi-Fi. « Adresse privée » : un téléphone qui cache son vrai numéro pour ne pas être suivi. Un téléphone en veille peut disparaître quelques minutes.'})].filter(Boolean);
 }

 // ---------- Copie du Wi-Fi : 20 secondes de mesures (et ce que le PC lit), gardées par Guardian sans le mot de passe ----------
 const netChoice=()=>document.querySelector('input[name=net]:checked')?.value||null;
 const typedName=()=>(document.getElementById('vt-wifi')?.value||'').trim()||null;
 function copyMetrics(){const m=stats();return {downloadMbps:m.downloadMbps??last?.metrics?.downloadMbps??null,uploadMbps:last?.metrics?.uploadMbps??null,latencyMs:m.latencyMs,jitterMs:m.jitterMs,lossPct:m.lossPct};}
 function copyCard(){return el('section',{class:'vt-card vt-copy',id:'vt-copy','aria-labelledby':'vt-copy-title','aria-busy':'true'},el('h2',{id:'vt-copy-title',text:'Copie de votre Wi-Fi'}));}
 // La dernière copie de ce lien : reprise si elle s'enregistrait encore ; sinon une copie se fait toute seule.
 // Si Guardian ne répond pas, on redemande deux fois avant de proposer « Réessayer » (jamais une copie à l'aveugle).
 async function loadCopy(){
  let ok=false;
  for(let i=0;i<3&&!ok;i++){try{const r=await api('copy',null,6000);copy=r.copy;copyLeft=r.left;ok=true;copyNote='';}catch(e){if(e.status===404)return expired();if(i<2)await pause(2000);else copyNote=e.message;}}
  if(ok&&copy&&!copy.done){copyRec={start:Date.now()-copy.seconds*1000,byLive:!live.on,timer:null,busy:false,hiddenAt:null};if(!live.on)startLive();copyRec.timer=setInterval(copyTick,2000);}
  else if(ok&&(!copy||!copy.measured)&&copyLeft>0&&!running&&!waiting)return startCopy();
  paintCopy();
 }
 async function startCopy(){
  if(copyRec||running||waiting)return;copyRec={start:Date.now(),byLive:!live.on,timer:null,busy:true,hiddenAt:null};paintCopy();
  try{const r=await api('copy',{new:true,network:netChoice(),typed:typedName(),metrics:copyMetrics()},8000);copy=r.copy;copyLeft=r.left;twinSays=null;twinError='';if(fault)paintTwin();}
  catch(e){copyRec=null;if(e.status===404)return expired();if(e.status===429)copyLeft=0;copyNote=e.message;paintCopy();return;}
  copyRec.start=Date.now();copyRec.busy=false;if(!live.on)startLive();copyRec.timer=setInterval(copyTick,2000);paintCopy();
 }
 // Toutes les 2 secondes : les nouvelles mesures du direct partent dans la copie. Onglet caché : la copie attend.
 async function copyTick(){
  if(!copyRec||copyRec.busy||!copy||document.hidden)return;
  const rec=copyRec;rec.busy=true;
  const done=Date.now()-rec.start>=COPY_MS,fresh=live.hist.filter(h=>h.t>=rec.start-500&&!h.copied),points=fresh.map(h=>({t:Math.max(0,h.t-rec.start),rtt:h.rtt,mbps:h.mbps??null}));
  let failed=false;
  try{const r=await api('copy',{id:copy.id,metrics:copyMetrics(),points,network:netChoice(),typed:typedName(),final:done},8000);copy=r.copy;copyLeft=r.left;fresh.forEach(h=>{h.copied=true;});}
  catch(e){if(e.status===404)return expired();failed=true;}
  if(copyRec!==rec)return;rec.busy=false;
  // Dernier envoi sans réponse : la copie est finie quand même (Guardian la fige de son côté avec ce qu'il a reçu).
  if(done&&failed)copy={...copy,done:true};
  if(done||copy.done){clearInterval(rec.timer);copyRec=null;copyNote='';if(rec.byLive)stopLive();paintCopy();if(fault)runTwin();return;}
  paintCopy();
 }
 function paintCopy(){
  const c=document.getElementById('vt-copy');if(!c)return;
  const rec=!!copyRec,v=copy,secs=rec?Math.max(0,Math.min(COPY_MS/1000,Math.round((Date.now()-copyRec.start)/1000))):0,m=v?.metrics||{},windows=/Windows/.test(navigator.userAgent);
  c.setAttribute('aria-busy',String(rec));c.classList.toggle('rec',rec);
  const head=el('div',{class:'vt-copy-head'},el('span',{class:'vt-eyebrow'+(rec?' rec':'')},el('i'),rec?'COPIE EN COURS':'COPIE DE VOTRE WI-FI'),v&&!rec?el('span',{class:'vt-copy-tag',text:'Copiée à '+hour(v.created)}):null);
  const name=v?.label||typedName()||'Votre Wi-Fi';
  const kids=[head,el('h2',{id:'vt-copy-title'},icon(DEV.box,22),el('span',{text:name}))];
  if(copyNote)kids.push(el('p',{class:'vt-copy-note',role:'status',text:copyNote}));
  const again=(label='Refaire la copie')=>{const b=el('button',{type:'button',class:'vt-btn'},icon('M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5',18),label);b.onclick=()=>{copyNote='';startCopy();};if(copyLeft<=0||running||waiting)b.disabled=true;return el('div',{class:'vt-actions'},b);};
  if(rec){
   const pcNow=pcOn&&wifi&&!wifi.error,devs=linked(lan?.devices),measured=live.hist.some(h=>h.t>=copyRec.start&&h.rtt!=null);
   kids.push(el('p',{text:pcNow?'Guardian enregistre une copie de ce Wi-Fi : mêmes chiffres, mêmes appareils, sans le mot de passe.':'Guardian enregistre une copie de ce Wi-Fi : les mêmes chiffres, sans le mot de passe.'}),
    el('div',{class:'vt-copy-bar',role:'progressbar','aria-valuemin':'0','aria-valuemax':String(COPY_MS/1000),'aria-valuenow':String(secs),'aria-label':'Copie en cours'},el('i',{style:'width:'+Math.round(100*secs/(COPY_MS/1000))+'%'})),
    el('p',{class:'vt-copy-time',text:document.hidden?'En pause':secs+' s sur '+COPY_MS/1000}),
    el('ul',{class:'vt-copy-steps'},
     el('li',{class:measured?'on':''},el('i'),'Débit, temps de réponse et stabilité'),
     el('li',{class:pcNow||typedName()?'on':''},el('i'),pcNow?'Nom et signal du Wi-Fi, lus par le PC':typedName()?'Nom du Wi-Fi que vous avez tapé':'Nom du Wi-Fi (tapez-le plus haut)'),
     windows?el('li',{class:pcNow&&devs?'on':''},el('i'),pcNow&&devs?plural(devs,'appareil')+' sur ce Wi-Fi':'Appareils du Wi-Fi (avec ce PC branché)'):null));
  }else if(v&&!v.measured){
   kids.push(el('p',{text:'La copie s’est arrêtée avant d’avoir des mesures (page fermée ou mise de côté trop longtemps). Refaites-la : elle ne compte pas dans vos copies.'}),again());
  }else if(v){
   kids.push(el('div',{class:'vt-tiles'},
    el('div',{class:'vt-tile'},el('small',{text:'Débit'}),el('strong',{text:mbps(m.downloadMbps)}),el('span',{text:'Mbps'})),
    el('div',{class:'vt-tile'},el('small',{text:'Réponse'}),el('strong',{text:m.latencyMs==null?'—':fr(m.latencyMs)}),el('span',{text:'ms'})),
    v.wifi?.signal!=null?el('div',{class:'vt-tile'},el('small',{text:'Signal Wi-Fi'}),el('strong',{text:v.wifi.signal+' %'}),el('span',{text:'lu par le PC'})):null,
    v.pc?el('div',{class:'vt-tile'},el('small',{text:'Appareils'}),el('strong',{text:String(v.connected)}),el('span',{text:'reliés à la box'})):el('div',{class:'vt-tile'},el('small',{text:'Stabilité'}),el('strong',{text:fr(100-(m.lossPct||0))+' %'}),el('span',{text:'réponses'}))),
    v.pc&&v.devices.length?el('ul',{class:'vt-copy-devs','aria-label':'Appareils de la copie'},...v.devices.slice(0,8).map(d=>el('li',{title:d.label},devIcon(d.kind),el('span',{text:d.label})))):null,
    el('p',{class:'vt-copy-text',text:'Copie faite sans le mot de passe du Wi-Fi. Les pannes se rejouent sur cette copie : votre vrai Wi-Fi n’est jamais touché. L’équipe Moov la voit aussi, pour vous aider plus vite.'}));
   if(!v.pc&&windows)kids.push(el('p',{class:'vt-copy-hint',text:'Branchez ce PC plus haut : la copie prendra aussi le nom du Wi-Fi, son signal et les appareils connectés.'}));
   kids.push(again());
  }else if(copyLeft<=0)kids.push(el('p',{text:'Vous avez fait toutes les copies possibles avec ce lien. Demandez un nouveau lien à Guardian pour en refaire une.'}));
  else if(copyNote){const b=el('button',{type:'button',class:'vt-btn'},'Réessayer la copie');b.onclick=()=>{copyNote='';paintCopy();loadCopy();};kids.push(el('div',{class:'vt-actions'},b));}
  else kids.push(el('p',{text:'Guardian prépare la copie de votre Wi-Fi…'}));
  kids.push(el('p',{class:'vt-data',text:'La copie utilise environ 1,5 Mo de données.'}));
  c.replaceChildren(...kids.filter(Boolean));
  paintDemoState();
 }
 function expired(){stopLive();clearInterval(copyRec?.timer);copyRec=null;closed('Ce lien de test a expiré','Demandez-en un nouveau à Guardian, dans l’application ou sur WhatsApp. Chaque lien sert 30 minutes.');}

 // ---------- En direct : une sonde toutes les 2 secondes, 512 Ko toutes les 10 secondes ----------
 const WINDOW=60000;
 function liveCard(){
  const b=el('button',{type:'button',class:'vt-btn primary vt-live-go',id:'vt-live-go'},icon('M6 4l14 8-14 8z',18),'Suivre en direct');b.onclick=()=>{if(copyRec)copyRec.byLive=false;live.on?stopLive():startLive();};
  return el('section',{class:'vt-card vt-live','aria-labelledby':'vt-live-title'},
   el('div',{class:'vt-live-head'},el('h2',{id:'vt-live-title'},'En direct'),el('span',{class:'vt-live-dot',id:'vt-live-dot'},el('i'),'Arrêté')),
   el('p',{class:'vt-fault-ribbon',id:'vt-ribbon',hidden:''}),
   el('div',{class:'vt-tiles vt-live-tiles',id:'vt-live-tiles'},...liveTiles()),
   el('div',{class:'vt-chart',id:'vt-chart'},chart()),
   el('div',{class:'vt-guardian',id:'vt-live-guardian',hidden:''}),
   b,el('p',{class:'vt-data',text:'Le suivi en direct utilise environ 3 Mo par minute.'}));
 }
 function stats(){
  // Les 30 dernières secondes de mesures (celles du moment, ou les dernières faites si le direct est arrêté).
  const end=live.on?Date.now():live.hist.at(-1)?.t??Date.now(),recent=live.hist.filter(h=>end-h.t<30000),ok=recent.filter(h=>h.rtt!=null).map(h=>h.rtt),sorted=[...ok].sort((a,b)=>a-b);
  const latencyMs=sorted.length?sorted[Math.floor(sorted.length/2)]:null,jitterMs=ok.length>1?ok.slice(1).reduce((a,b,i)=>a+Math.abs(b-ok[i]),0)/(ok.length-1):null;
  return {signal:wifi&&!wifi.error?wifi.signal:null,downloadMbps:live.speed,latencyMs,jitterMs,lossPct:recent.length?Math.round(100*(recent.length-ok.length)/recent.length):0,network:document.querySelector('input[name=net]:checked')?.value||null};
 }
 function liveTiles(){
  const real=stats(),stab=live.hist.length?fr(100-real.lossPct)+' %':'—';
  return [
   el('div',{class:'vt-tile'},el('small',{text:'Réponse'}),el('strong',{text:real.latencyMs==null?(live.hist.length?'aucune':'—'):fr(real.latencyMs)}),el('span',{text:'ms'})),
   el('div',{class:'vt-tile'},el('small',{text:'Débit'}),el('strong',{text:mbps(real.downloadMbps)}),el('span',{text:'Mbps'})),
   el('div',{class:'vt-tile'},el('small',{text:'Stabilité'}),el('strong',{text:stab}),el('span',{text:'réponses'})),
   real.signal!=null?el('div',{class:'vt-tile'},el('small',{text:'Signal Wi-Fi'}),el('strong',{text:real.signal+' %'}),el('span',{text:'lu par le PC'})):null].filter(Boolean);
 }
 // Une courbe de temps de réponse : la dernière minute en direct, ou les 20 secondes de la copie (avant et pendant la panne).
 function plot({pts,sim=null,span,from,labels,empty,aria}){
  const W=innerWidth>=900?460:320,H=120,s=svg('svg',{viewBox:'0 0 '+W+' '+H,role:'img','aria-label':aria});
  const top=Math.max(200,...pts.map(h=>h.rtt||0),...(sim||[]).map(h=>h.rtt||0))*1.15,x=t=>Math.max(0,Math.min(W,(t-from)/span*W)),y=v=>H-18-(v/top)*(H-30);
  for(const v of [0,.5,1]){const yy=H-18-v*(H-30);s.append(svg('line',{x1:0,x2:W,y1:yy,y2:yy,class:'vt-grid'}));}
  const label=svg('text',{x:4,y:12,class:'vt-tick'});label.textContent=fr(top)+' ms';s.append(label);
  for(const [xx,txt,anchor] of [[4,labels[0],'start'],[W-4,labels[1],'end']]){const t=svg('text',{x:xx,y:H-1,class:'vt-tick','text-anchor':anchor});t.textContent=txt;s.append(t);}
  const line=(list,cls)=>{let d='',pen=false;for(const h of list){if(h.rtt==null){pen=false;continue;}d+=(pen?'L':'M')+x(h.t).toFixed(1)+' '+y(h.rtt).toFixed(1)+' ';pen=true;}if(d)s.append(svg('path',{d:d.trim(),class:cls,fill:'none'}));for(const h of list)if(h.rtt==null)s.append(svg('rect',{x:x(h.t)-3,y:H-24,width:6,height:8,rx:2,class:'vt-lost'}));};
  if(sim){line(pts.map(h=>({...h,rtt:h.rtt})),'vt-line-real');line(sim,'vt-line-sim');}else line(pts,'vt-line');
  if(!pts.length){const t=svg('text',{x:W/2,y:H/2,class:'vt-empty','text-anchor':'middle'});t.textContent=empty;s.append(t);}
  return s;
 }
 function chart(){const now=Date.now();return plot({pts:live.hist.filter(h=>now-h.t<WINDOW),span:WINDOW,from:now-WINDOW,labels:['il y a 1 min','maintenant'],empty:'Touchez « Suivre en direct »',aria:'Temps de réponse sur la dernière minute'});}
 function paintLive(){
  const tiles=document.getElementById('vt-live-tiles'),c=document.getElementById('vt-chart'),dot=document.getElementById('vt-live-dot'),rib=document.getElementById('vt-ribbon'),b=document.getElementById('vt-live-go'),g=document.getElementById('vt-live-guardian');
  if(tiles)tiles.replaceChildren(...liveTiles());if(c)c.replaceChildren(chart());
  if(dot){dot.className='vt-live-dot'+(live.on?' on':'');dot.lastChild.textContent=live.on?'En direct':'Arrêté';}
  if(rib){rib.hidden=!fault;rib.textContent=fault?'Ici, c’est votre vrai Wi-Fi : la panne « '+fault.label+' » se joue seulement sur la copie.':'';}
  if(b){b.replaceChildren(icon(live.on?'M7 5h3v14H7zM14 5h3v14h-3z':'M6 4l14 8-14 8z',18),live.on?'Arrêter le direct':'Suivre en direct');}
  if(g)g.hidden=true;
  if(fault&&twinSays)paintTwinReal();
 }
 async function liveTick(){
  if(live.busy||running)return;live.busy=true;const n=live.tick++; // pendant le test complet, le direct se tait pour ne pas le fausser
  try{const t=performance.now();let rtt=null;try{await api('ping',null,3000);rtt=Math.round(performance.now()-t);}catch(e){if(e.status===404){stopLive();return closed('Ce lien de test a expiré','Demandez-en un nouveau à Guardian, dans l’application ou sur WhatsApp. Chaque lien sert 30 minutes.');}}
   live.hist.push({t:Date.now(),rtt});live.hist=live.hist.filter(h=>Date.now()-h.t<WINDOW+4000);
   if(n%5===0&&rtt!=null){const s=performance.now();try{const r=await fetch('/api/test/sample',{cache:'no-store',headers:{'X-Test-Token':token},signal:AbortSignal.timeout(8000)});const b=await r.arrayBuffer();if(r.ok){live.speed=Math.round(b.byteLength*8/((performance.now()-s)/1000)/1e5)/10;live.hist[live.hist.length-1].mbps=live.speed;}}catch{}}
   paintLive();
  }finally{live.busy=false;}
 }
 function startLive(){if(live.on)return;live.on=true;liveTick();live.timer=setInterval(liveTick,2000);paintLive();}
 function stopLive(){live.on=false;clearInterval(live.timer);live.timer=null;paintLive();}
 // Onglet caché : le direct s'arrête et la copie se met en pause ; elle reprend là où elle en était au retour.
 addEventListener('visibilitychange',()=>{
  if(document.hidden){if(live.on){clearInterval(live.timer);live.timer=null;}if(copyRec&&!copyRec.hiddenAt)copyRec.hiddenAt=Date.now();}
  else{if(copyRec?.hiddenAt){copyRec.start+=Date.now()-copyRec.hiddenAt;copyRec.hiddenAt=null;}if(live.on&&!live.timer)live.timer=setInterval(liveTick,2000);if(copyRec)paintCopy();}
 });

 // ---------- Démo : une panne rejouée sur la copie du Wi-Fi ----------
 function demoCard(){
  const grid=el('div',{class:'vt-scenarios'});
  for(const f of info.scenarios||[]){const b=el('button',{type:'button',class:'vt-scenario','aria-pressed':'false','data-id':f.id},el('b',{text:f.label}),el('small',{text:f.hint}));b.onclick=()=>pickFault(f);grid.append(b);}
  const stop=el('button',{type:'button',class:'vt-btn',id:'vt-fault-stop',disabled:''},'Arrêter la simulation');stop.onclick=()=>pickFault(null);
  return el('section',{class:'vt-card vt-demo',id:'vt-demo',hidden:'','aria-labelledby':'vt-demo-title'},
   el('h2',{id:'vt-demo-title',text:'Simuler une panne sur la copie'}),
   el('p',{id:'vt-demo-intro',text:'Guardian rejoue la panne sur la copie de votre Wi-Fi. Votre vrai Wi-Fi n’est jamais touché.'}),
   grid,el('p',{class:'vt-sr',id:'vt-twin-status',role:'status'}),el('div',{class:'vt-twin',id:'vt-twin',hidden:''}),stop);
 }
 function paintDemoState(){
  const intro=document.getElementById('vt-demo-intro');if(!intro)return;
  intro.textContent=copy?.done?'Guardian rejoue la panne sur la copie de « '+copy.label+' », faite à '+hour(copy.created)+(copy.pc?' : mêmes chiffres, mêmes appareils.':' : mêmes chiffres.')+' Votre vrai Wi-Fi n’est jamais touché.':copyRec?'La copie de votre Wi-Fi se termine (encore '+Math.max(0,Math.round((COPY_MS-(Date.now()-copyRec.start))/1000))+' s). Choisissez déjà une panne : elle se jouera dessus.':'Guardian rejoue la panne sur la copie de votre Wi-Fi. Votre vrai Wi-Fi n’est jamais touché.';
 }
 // Chaque panne choisie part tout de suite ; seule la réponse de la dernière choisie s'affiche.
 async function runTwin(){
  if(!fault||!copy?.done)return;const f=fault,id=copy.id;twinError='';
  try{const r=await api('copy/simulate',{id,scenario:f.id},8000);if(fault===f&&copy?.id===id){twinSays=r;paintTwin();const st=document.getElementById('vt-twin-status');if(st)st.textContent='Panne « '+r.label+' » jouée sur la copie : '+((LEVEL[r.level]||[])[1]||'')+'. '+r.summary.online+' appareil'+(r.summary.online>1?'s':'')+' sur '+r.summary.devices+' avec Internet.';}}
  catch(e){if(fault===f){twinError=e.message;paintTwin();}}
 }
 const devState=d=>el('li',{class:'vt-dev'+(d.added?' added':'')},devIcon(d.kind),el('div',{class:'vt-dev-text'},el('b',{text:d.label}),el('small',{text:d.played?(copy?.network==='cellular'?'à la place des données mobiles':'à la place du partage de connexion'):d.added?'en plus sur la copie · '+d.usage:d.inferred?'déduit du test':d.ip||' '})),el('span',{class:'vt-state '+(TONE[d.state]||'slow'),text:d.stateLabel}));
 function paintTwin(){
  const box=document.getElementById('vt-twin');if(!box)return;box.hidden=!fault;
  if(!fault)return box.replaceChildren();
  if(twinError){const retry=el('button',{type:'button',class:'vt-btn'},'Réessayer');retry.onclick=()=>{twinError='';paintTwin();runTwin();};return box.replaceChildren(el('div',{class:'vt-twin-wait',role:'alert'},el('p',{text:twinError}),retry));}
  if(!twinSays)return box.replaceChildren(el('p',{class:'vt-twin-wait',text:copyRec?'La panne se jouera sur la copie dès qu’elle est prête…':copy?.done&&copy.measured?'Guardian joue la panne sur la copie…':'Il faut d’abord une copie de votre Wi-Fi : elle se fait en haut de la page.'}));
  const t=twinSays,m=t.metrics,b=t.base,[tone,label]=LEVEL[t.level]||['slow',''],stab=v=>fr(100-(v||0))+' %';
  const tile=(name,val,unit,before)=>el('div',{class:'vt-tile'},el('small',{text:name}),el('strong',{text:val}),el('span',{text:unit}),el('em',{text:'avant : '+before}));
  const pts=copy.points||[],span=Math.max(COPY_MS,...pts.map(p=>p.t+2000));
  box.replaceChildren(...[
   el('div',{class:'vt-twin-head'},
    el('div',{class:'vt-twin-side real',id:'vt-twin-real'}),
    el('span',{class:'vt-twin-arrow','aria-hidden':'true'},icon('M5 12h14m-6-6 6 6-6 6',18)),
    el('div',{class:'vt-twin-side copy'},el('small',{text:'La copie'}),el('b',{text:copy.label}),el('span',{class:'vt-twin-tag'},el('i'),t.label))),
   t.note?el('p',{class:'vt-twin-note',text:t.note}):null,
   el('div',{class:'vt-tiles vt-twin-tiles'},
    tile('Débit',m.downloadMbps==null?'0':mbps(m.downloadMbps),'Mbps',b.downloadMbps==null?'—':mbps(b.downloadMbps)+' Mbps'),
    tile('Réponse',m.latencyMs==null?'aucune':fr(m.latencyMs),m.latencyMs==null?'':'ms',b.latencyMs==null?'—':fr(b.latencyMs)+' ms'),
    tile('Stabilité',stab(m.lossPct),'réponses',stab(b.lossPct)),
    tile('Appareils',t.summary.online+' sur '+t.summary.devices,'avec Internet',t.summary.before+' sur '+t.summary.before),
    t.baseSignal!=null?tile('Signal Wi-Fi',t.signal?t.signal+' %':'aucun',t.signal?'':'box éteinte',t.baseSignal+' %'):null),
   pts.length?el('div',{class:'vt-chart'},plot({pts,sim:t.points,span,from:0,labels:['début de la copie',Math.round(span/1000)+' s'],empty:'',aria:'Temps de réponse de la copie, avant et pendant la panne'})):null,
   el('div',{class:'vt-twin-devs'},el('h3',{text:'Les appareils de la copie pendant la panne'}),el('ul',{class:'vt-dev-list'},...t.devices.map(devState))),
   el('div',{class:'vt-guardian'},el('img',{src:'pwa/icon-192.png',alt:''}),el('div',{class:'vt-bubble'},el('b',{text:'Guardian'}),el('span',{class:'vt-verdict small '+tone},el('i'),label),el('span',{text:t.text})))].filter(Boolean));
  paintTwinReal();
 }
 // À gauche du face-à-face : le vrai Wi-Fi, qui continue normalement (avec ses chiffres du moment si le direct tourne).
 function paintTwinReal(){
  const r=document.getElementById('vt-twin-real');if(!r)return;const m=stats();
  r.replaceChildren(el('small',{text:'Votre vrai Wi-Fi'}),el('b',{text:copy?.label||'Votre Wi-Fi'}),el('span',{class:'vt-twin-tag ok'},el('i'),live.on&&m.latencyMs!=null?'Jamais touché · '+fr(m.latencyMs)+' ms':'Jamais touché'));
 }
 function toggleDemo(open){const d=document.getElementById('vt-demo'),b=document.getElementById('vt-demo-badge');if(!d)return;const show=open??d.hidden;d.hidden=!show;b?.setAttribute('aria-expanded',String(show));paintDemoState();if(show)d.scrollIntoView({behavior:reduced()?'auto':'smooth',block:'nearest'});}
 async function pickFault(f){
  fault=f;twinSays=null;twinError='';
  document.querySelectorAll('.vt-scenario').forEach(b=>b.setAttribute('aria-pressed',String(!!f&&b.dataset.id===f.id)));
  const stop=document.getElementById('vt-fault-stop');if(stop)stop.disabled=!f;
  if((!copy||!copy.measured)&&!copyRec&&copyLeft>0&&!running&&!waiting)startCopy();
  paintTwin();paintLive();
  if(f)await runTwin();
  if(f&&innerWidth<900)document.getElementById('vt-twin')?.scrollIntoView({behavior:reduced()?'auto':'smooth',block:'start'});
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
  if(running||waiting)return;const go=document.getElementById('vt-go');
  // La copie du Wi-Fi se termine d'abord : les deux ensemble se gêneraient et fausseraient les chiffres.
  if(copyRec){waiting=true;if(go){go.disabled=true;go.lastChild.textContent='Test en attente…';}paintCopy();
   while(copyRec){stage('Guardian finit la copie de votre Wi-Fi… '+Math.max(1,Math.ceil((COPY_MS-(Date.now()-copyRec.start))/1000))+' s',0);await pause(500);}
   waiting=false;}
  running=true;root.classList.add('vt-running');if(go){go.disabled=true;go.lastChild.textContent='Test en cours…';}paintCopy();
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
  }finally{running=false;root.classList.remove('vt-running');const b=document.getElementById('vt-go');if(b){b.disabled=false;b.lastChild.textContent=last?'Refaire le test':'Lancer le test';}paintCopy();}
 }

 (async()=>{
  if(!/^[A-Za-z0-9_-]{20,40}$/.test(token))return closed('Ouvrez votre lien de test','Ce test s’ouvre avec le lien personnel que Guardian vous envoie, dans l’application ou sur WhatsApp.');
  try{info=await api('info');draw();}catch(e){closed('Ce lien de test a expiré','Demandez-en un nouveau à Guardian, dans l’application ou sur WhatsApp. Chaque lien sert 30 minutes.');}
 })();
})();
