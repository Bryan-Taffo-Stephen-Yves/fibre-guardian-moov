/* Accueil client, simple comme pour un enfant.
   1. Un grand voyant : vert, ça marche ; orange, c'est lent ; rouge, panne. Une phrase, un bouton.
   2. Une grille « Services » : toutes les fonctions en tuiles, la suite derrière « Voir tout ».
   3. Deux cartes au plus, seulement si elles concernent le client maintenant. */
(function(){
 'use strict';
 const h=React.createElement;
 const P={
  check:'M5 12.5 10 17.5 19 7',
  slow:'M12 13 16 9M4.5 17a8 8 0 1 1 15 0',
  down:'M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18',
  refresh:'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  box:'M3 14h18v5H3zM7 16.5h.01M11 16.5h.01M8 14l-2-8M16 14l2-8',
  truck:'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  mic:'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 11a7 7 0 0 0 14 0M12 18v3',
  gauge:'M4.5 17a8 8 0 1 1 15 0M12 13l4-4',
  alert:'M12 4 2.5 20h19zM12 10v4.5M12 17.5h.01',
  phone:'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1',
  devices:'M3 5h13v9H3zM7 18h5M20 9v9h-4V9z',
  arrow:'M5 12h14M13 6l6 6-6 6',
  sms:'M7 3h10v18H7zM11 18h2',
  bell:'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 21h4',
  list:'M4 7h10M4 12h16M4 17h7M18 5v4M16 7h4'
 };
 function Icon({d,size=24,stroke=2}){return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:stroke,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d}));}
 // Icônes dessinées pour Fibre Guardian (icones.js) ; repli sur le trait simple si elles manquent.
 function Ico({name,d,size=24,stroke}){return window.FGIcones&&FGIcones.has(name)?h(FGIcones.Icon,{name,size}):h(Icon,{d:d||S[name]||P[name],size,stroke});}
 const first=n=>String(n||'').trim().split(/\s+/)[0]||'';

 // Ce que dit le voyant. Une seule réponse, la plus importante d'abord.
 function status({state,fault}){
  const m=state.metrics||{},plan=state.plan?.mbps||100,got=Math.round(m.capacity||0),inc=state.sharedIncident;
  if(m.state==='redémarrage')return {tone:'wait',icon:P.refresh,title:'Votre box redémarre',text:'Internet revient dans quelques secondes. Ne touchez à rien.'};
  if(inc){const tech=first(inc.technician?.name);
   const text={dispatched:(tech?tech+', technicien Moov,':'Une équipe Moov')+' va partir chez vous.',en_route:(tech||'Le technicien')+' est en route vers votre quartier.',on_site:(tech||'L’équipe')+' est sur place et répare la fibre.',verifying:'C’est réparé. Moov vérifie que tout revient.'}[inc.status]||'Moov l’a vue et s’en occupe. Vous n’avez rien à faire.';
   return {tone:'down',icon:P.down,title:'Panne dans votre quartier',text,action:'track',actionLabel:'Suivre la réparation'};}
  if(fault)return {tone:'slow',icon:P.truck,title:'Moov s’occupe de votre problème',text:'Votre signalement est bien arrivé. On vous prévient à chaque étape.',action:'track',actionLabel:'Voir où ça en est'};
  if(m.latency===null)return {tone:'down',icon:P.box,title:'Votre box ne répond pas',text:'Vérifiez qu’elle est branchée et que ses lumières sont allumées.',action:'guardian',actionLabel:'Me faire aider par Guardian'};
  if(state.scenario==='slow'||got<.8*plan)return {tone:'slow',icon:P.slow,title:'Votre internet est lent',text:'Vous recevez '+got+' Mb/s au lieu de '+plan+'. Redémarrer la box règle souvent le souci.',action:'reboot',actionLabel:'Redémarrer ma box',second:'guardian',secondLabel:'Demander à Guardian'};
  if(state.optical?.state==='fading')return {tone:'slow',icon:P.slow,title:'Une coupure se prépare',text:state.prevention?'Un technicien passe avant la coupure. Tout est prévu.':'Internet marche encore. Choisissez juste en dessous quand le technicien peut passer.'};
  return {tone:'ok',icon:P.check,title:'Votre internet marche bien',text:'Vous recevez '+got+' Mb/s, tout ce que prévoit votre offre.'};
 }

 // Heure courte d'une notification : « 14 h 05 » aujourd'hui, sinon « lun. 9 nov. ».
 function when(at){const d=new Date(at),now=new Date();return d.toDateString()===now.toDateString()?d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}).replace(':',' h '):d.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});}
 function kind(n){const t=String(n.title||'').toLowerCase();return /répar|rétabli|revenu|terminé/.test(t)?{icon:P.check,tone:'ok'}:/technicien|équipe|route|place/.test(t)?{icon:P.truck,tone:'info'}:/panne|coupure|lent|baisse|alerte|inconnu/.test(t)?{icon:P.alert,tone:'warn'}:{icon:P.bell,tone:'info'};}

 // Accueil façon « super-app » d'opérateur : bonjour, une carte sombre « Ma fibre » (offre, débit, voyant),
 // puis la grille « Services » bien en avant : chaque tuile ouvre un écran qui existe déjà.
 // Le bandeau d'état n'apparaît que s'il se passe quelque chose ; la bannière orange propose un forfait plus rapide.
 const S={
  gauge:P.gauge,
  chat:'M20 11.5a8 8 0 0 1-11.8 7L4 20l1.3-4A8 8 0 1 1 20 11.5ZM8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01',
  devices:P.devices,
  map:'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2ZM9 4v14M15 6v14',
  up:'M5 19h14M12 15V5M8 9l4-4 4 4',
  alert:P.alert,
  folder:'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 13l2.5 2.5L16 10',
  sms:P.sms,
  gift:'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10 3 7.5 4 9 7 12 7m0 0s2-4 4.5-3S15 7 12 7',
  shield:'m12 3 8 3v6c0 6-8 9-8 9s-8-3-8-9V6Zm-4 9 3 3 5-6',
  user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',
  chevron:'m9 6 6 6-6 6',
  eye:'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z'
 };
 function Home({state,user,fault,busy,on,call,cards,recent=[],bell=0,demo}){
  const s=status({state,fault}),m=state.metrics||{},extra=Math.max(0,(m.connected||0)-(state.usual||0)),plan=state.plan?.mbps||100,price=state.plan?.price;
  const [all,setAll]=React.useState(false),[order,setOrder]=React.useState(false),[edit,setEdit]=React.useState(false);
  // Raccourcis préférés : le client met jusqu'à 4 services en tête de la grille (gardés sur ce téléphone).
  const KEY='fg-favoris:'+user.id;
  const [fav,setFav]=React.useState(()=>{try{const v=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(v)?v.slice(0,4):[];}catch{return [];}});
  // Services proposés à ce client (le dossier de la fibre n'existe que pour un nouvel abonné) : un favori qui n'est plus proposé ne garde pas sa place.
  const offered=['Tester ma connexion','Guardian','Appareils connectés','Voir le réseau','Changer de forfait','Signaler une panne','Sans internet','Mes avantages','Mes données','Mon compte'].concat(order?['Dossier de ma fibre']:[]);
  const live=fav.filter(id=>offered.includes(id));
  const toggle=id=>{const next=live.includes(id)?live.filter(x=>x!==id):live.length<4?live.concat(id):live;try{localStorage.setItem(KEY,JSON.stringify(next));}catch{}setFav(next);};
  // « Dossier de ma fibre » seulement s'il existe un dossier d'installation (nouvel abonné) ; sinon « Mon compte » prend sa place.
  React.useEffect(()=>{let alive=true;fetch('/api/welcome',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(r=>{if(alive)setOrder(!!(r&&r.order&&r.order.status!=='annule'));}).catch(()=>{});return()=>{alive=false;};},[user.id]);
  const run=k=>({track:on.track,guardian:on.guardian,reboot:on.reboot,devices:on.devices})[k];
  const shown=(cards||[]).filter(Boolean).slice(0,2),cut=s.tone==='down',got=cut?0:Math.round(m.capacity||0);
  const go=k=>on.go?()=>on.go(k):undefined;
  // En mode « Modifier », toucher une tuile l'épingle ou la retire (étoile) au lieu d'ouvrir le service.
  const tile=(icon,label,onClick,{tone='blue',badge,aria,disabled}={})=>{const pinned=live.includes(label),full=!pinned&&live.length>=4;
   return h('button',{type:'button',key:label,'data-id':label,className:'ac-svc ac-svc--'+tone+(edit?' is-edit':'')+(edit&&pinned?' is-fav':'')+(edit&&full?' is-full':''),onClick:edit?()=>{if(!full)toggle(label);}:onClick,disabled:edit?undefined:disabled,'aria-disabled':edit&&full?true:undefined,'aria-pressed':edit?pinned:undefined,'aria-label':edit?label:aria||label},
    h('span',{className:'ac-svc-ico','aria-hidden':true},h(Ico,{name:icon,size:28}),badge&&!edit?h('b',{className:'ac-svc-badge'},badge):null,edit&&h('i',{className:'ac-svc-star','aria-hidden':true},h(Icon,{d:S.star,size:13,stroke:2.2}))),h('span',{className:'ac-svc-txt'},label));};
  const main=[
   tile('gauge','Tester ma connexion',on.test,{disabled:busy||!on.test||s.tone==='wait'}),
   tile('chat','Guardian',on.voice,{tone:'orange',aria:'Parler à Guardian'}),
   tile('devices','Appareils connectés',on.devices,{tone:'green',badge:extra||null,aria:'Appareils connectés'+(extra?' : '+extra+' inconnu'+(extra>1?'s':''):'')}),
   tile('map','Voir le réseau',go('ville'),{tone:'sky'}),
   tile('up','Changer de forfait',go('forfait'),{tone:'orange'}),
   tile('alert','Signaler une panne',on.report,{tone:'red'}),
   order?tile('folder','Dossier de ma fibre',go('bienvenue'),{tone:'blue',aria:'Suivre le dossier de ma fibre'}):tile('user','Mon compte',go('compte'),{tone:'blue'}),
   tile('sms','Sans internet',on.survie,{tone:'sky',aria:'Sans internet : composez *144#'})];
  const extraTiles=[tile('gift','Mes avantages',go('fidelite'),{tone:'orange'}),tile('shield','Mes données',go('donnees'),{tone:'green'}),order&&tile('user','Mon compte',go('compte'),{tone:'blue'})].filter(Boolean);
  // Les favoris passent devant ; la grille garde 8 tuiles, le reste va dans « Voir tout ».
  // « Signaler une panne » et « Sans internet » restent toujours dans les 8 tuiles visibles : ce sont celles d'une coupure.
  const pool=main.concat(extraTiles),pins=live.map(id=>pool.find(t=>t.key===id)).filter(Boolean),ordered=pins.concat(pool.filter(t=>!live.includes(t.key)));
  const KEEP=['Signaler une panne','Sans internet'],top=ordered.slice(0,8),rest=ordered.slice(8);
  for(const k of KEEP){const i=rest.findIndex(t=>t.key===k);if(i<0)continue;let j=top.length-1;while(j>=0&&(KEEP.includes(top[j].key)||live.includes(top[j].key)))j--;if(j<0)continue;rest.splice(i,1,top[j]);top.splice(j,1);top.push(pool.find(t=>t.key===k));}
  const grid=edit?ordered:top,more=edit?[]:[!cut&&call].concat(rest).filter(Boolean);
  const promo=s.tone==='ok'&&!fault&&!state.sharedIncident&&plan<500&&on.go;
  // Tout marche mais des appareils inconnus sont sur le Wi-Fi : le bandeau le dit en toutes lettres.
  const a=s.tone==='ok'&&extra?{tone:'slow',icon:P.devices,title:extra+' appareil'+(extra>1?'s':'')+' inconnu'+(extra>1?'s':'')+' sur votre Wi-Fi',text:'Vérifiez que vous les connaissez. Vous pouvez les bloquer en un geste.',action:'devices',actionLabel:'Voir mes appareils'}:s;
  return h('div',{className:'ac ac--svc'},
   h('header',{className:'ac-hello'},
    h('div',{className:'ac-hi'},h('small',null,'Bienvenue,'),h('strong',null,first(user.name)||user.name)),
    h('div',{className:'ac-top-actions'},demo,
     h('button',{type:'button',className:'ac-round',onClick:on.bell,'aria-label':'Mes messages'+(bell?' : '+bell+' à lire':'')},h(Ico,{name:'bell',d:P.bell,size:22}),bell>0&&h('i',{className:'ac-round-dot','aria-hidden':true})),
     h('button',{type:'button',className:'ac-face',onClick:go('compte'),'aria-label':'Mon compte'},window.FGAvatar?h(FGAvatar.Face,{name:user.name,size:44,role:'client'}):first(user.name).slice(0,1)))),
   h('section',{className:'ac-fibre ac-'+s.tone,'aria-label':'Ma fibre'},
    h('div',{className:'ac-fibre-main'},
     h('p',{className:'ac-fibre-plan'},h('span',{className:'ac-fibre-dot','aria-hidden':true}),'Ma fibre · Offre '+plan+' Mb/s'+(state.homeZone?.zone?' · '+state.homeZone.zone:'')),
     h('p',{className:'ac-fibre-num'},h('strong',null,got),h('small',null,' Mb/s reçus')),
     h('p',{className:'ac-fibre-state',role:'status','aria-live':'polite'},s.title),
     on.go&&h('button',{type:'button',className:'ac-fibre-link',onClick:go('compte'),'aria-label':'Mon compte'+(price?' : '+price.toLocaleString('fr-FR')+' F par mois':'')},price?price.toLocaleString('fr-FR')+' F par mois':'Mon compte',h(Icon,{d:S.chevron,size:16}))),
    h('button',{type:'button',className:'ac-fibre-test',onClick:on.test,disabled:busy||!on.test||s.tone==='wait'},
     h('span',{className:'ac-fibre-test-ico','aria-hidden':true},h(Ico,{name:'gauge',size:44,stroke:1.8})),
     h('span',null,'Tester ma connexion'))),
   a.tone!=='ok'&&h('section',{className:'ac-alert ac-'+a.tone},
    h('span',{className:'ac-alert-ico','aria-hidden':true},h(Icon,{d:a.icon,size:26,stroke:2.3})),
    h('div',null,h('h2',null,a.title),h('p',null,a.text)),
    (a.action||a.second||cut&&call)&&h('div',{className:'ac-alert-actions'},
     a.action&&h('button',{type:'button',className:'ac-go',onClick:run(a.action),disabled:busy&&a.action!=='devices'},a.actionLabel),
     a.second&&h('button',{type:'button',className:'ac-go ghost',onClick:run(a.second),disabled:busy},a.secondLabel),
     cut&&call)),
   shown.length>0&&h('div',{className:'ac-cards'},shown),
   h('section',{className:'ac-services','aria-labelledby':'ac-svc-title'},
    h('div',{className:'ac-services-head'},h('h2',{id:'ac-svc-title'},'Services'),
     h('div',{className:'ac-services-tools'},
      on.go&&h('button',{type:'button',className:'ac-more'+(edit?' is-done':''),'aria-pressed':edit,onClick:()=>{setEdit(v=>!v);setAll(false);}},edit?'Terminé':'Modifier'),
      !edit&&more.length>0&&h('button',{type:'button',className:'ac-more','aria-expanded':all,'aria-controls':'ac-svc-grid',onClick:()=>setAll(v=>!v)},all?'Moins':'Voir tout',h(Icon,{d:S.chevron,size:16})))),
    edit&&h('p',{className:'ac-svc-hint',role:'status'},'Touchez jusqu’à 4 services pour les mettre en premier. '+live.length+' sur 4 choisis'+(live.length>=4?' : touchez une étoile pour en changer.':'.')),
    h('div',{className:'ac-svc-grid',id:'ac-svc-grid'},grid,all&&more)),
   // Des visages : l'équipe Moov de la commune du client (techniciens.js).
   window.FGTechniciens&&h(FGTechniciens.Strip,{zone:state.homeZone?.zone,onReport:on.report,onGuardian:on.voice}),
   promo&&h('button',{type:'button',className:'ac-promo',onClick:go('forfait')},
    h('span',{className:'ac-promo-txt'},h('small',null,'Jeux, films, télétravail'),h('strong',null,'Plus de débit ? Passez au forfait supérieur'),h('span',null,'Vous payez juste la différence. Voir les forfaits')),
    window.FGAvatar?h('span',{className:'ac-promo-human','aria-hidden':true},h(FGAvatar.Sticker,{name:'Koffi N’Guessan',role:'tech',pose:'thumbs',size:118,bare:true})):h('span',{className:'ac-promo-ico','aria-hidden':true},h(Ico,{name:'up',size:30,stroke:2.2}))),
   h('section',{className:'ac-recent','aria-labelledby':'ac-recent-title'},
    h('div',{className:'ac-recent-head'},h('h2',{id:'ac-recent-title'},'Derniers messages'),h('button',{type:'button',className:'ac-more',onClick:on.bell},'Tout voir',h(Icon,{d:S.chevron,size:16}))),
    recent.length?h('ul',null,recent.filter((n,i,all)=>all.findIndex(x=>x.title===n.title&&x.body===n.body)===i).slice(0,3).map(n=>{const k=kind(n);return h('li',{key:n.key||n.id||n.at},h('button',{type:'button',onClick:on.bell},
     h('span',{className:'ac-recent-ico '+k.tone,'aria-hidden':true},h(Icon,{d:k.icon,size:20})),
     h('span',{className:'ac-recent-txt'},h('b',null,n.title),h('small',null,when(n.at))),
     h('span',{className:'ac-recent-tag'+(n.read?'':' new')},n.read?'Lu':'Nouveau')));})):
     h('p',{className:'ac-recent-empty'},'Pas de message pour l’instant. Guardian vous écrit ici dès qu’il se passe quelque chose.')));
 }
 // Le téléphone n'est pas sur le Wi-Fi de la box : le serveur voit des données mobiles, ou le réseau d'un autre opérateur.
 // (Une page web ne peut pas lire le nom du Wi-Fi.) Sur données mobiles, Guardian peut quand même redémarrer la box à distance.
 const short=op=>String(op||'').replace(/\s+(c[oô]te|ci\b|s\.?a\.?\b).*$/i,'').trim();
 function Where({where,busy,onReboot}){
  const kind=where?.cellular?'mobile':where?.place,[hid,setHid]=React.useState(()=>{try{return sessionStorage.getItem('fg-where-ok')||'';}catch{return '';}});
  if(kind!=='mobile'&&kind!=='autre'||hid===kind)return null;
  const hide=()=>{try{sessionStorage.setItem('fg-where-ok',kind);}catch{}setHid(kind);},op=short(where.operator),phone=/iPhone|iPad|Android/.test(navigator.userAgent);
  return h('section',{className:'ac-where ac-where-'+kind,role:'status'},
   h('span',{className:'ac-where-ico','aria-hidden':true},h(Icon,{d:kind==='mobile'?P.sms:P.box,size:24})),
   h('div',null,h('h2',null,'Vous n’êtes pas sur le Wi-Fi de votre box'),
    h('p',null,kind==='mobile'?(phone?'Ce téléphone utilise ses données mobiles':'Cet appareil passe par les données mobiles d’un téléphone')+(op?' '+op:'')+'. Si le Wi-Fi de la maison ne marche plus, Guardian peut redémarrer votre box d’ici.':(phone?'Ce téléphone':'Cet appareil')+' est sur un autre réseau'+(op?' ('+op+')':'')+'. Pour suivre votre fibre Moov, connectez-vous au Wi-Fi de votre box.')),
   h('div',{className:'ac-where-actions'},
    kind==='mobile'&&onReboot&&h('button',{type:'button',className:'ac-where-go',onClick:onReboot,disabled:busy},h(Icon,{d:P.refresh,size:18}),'Redémarrer ma box'),
    h('button',{type:'button',className:'ac-where-ok',onClick:hide},'Compris')));
 }
 window.FGAccueil={Home,status,Where};
})();
