(function(){
 'use strict';
 // Comptes de démo : Client, Conseiller, Technicien, Superviseur, Direction.
 // - DemoAccounts : sous le formulaire de connexion, un bouton par rôle, sans rien taper.
 // - Bar : en bas de l'écran pendant une session de démo, pour passer d'un rôle à l'autre en un geste.
 // La Direction demande son mot de passe, sauf sur un appareil où elle a activé la barre (« À propos de la démo »).
 // Chaque bouton ouvre une vraie session sur un compte de démo : le serveur vérifie tout (role-bar.cjs).
 const h=React.createElement,{useState:S,useEffect:E}=React;
 const post=(url,data,csrf)=>fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:JSON.stringify(data||{})}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Action impossible pour le moment.');return d;});
 const load=()=>fetch('/api/demo/roles',{credentials:'same-origin'}).then(r=>r.ok?r.json():{active:false}).catch(()=>({active:false}));
 const LOOK={client:'client',conseiller:'team',technicien:'tech',superviseur:'team',direction:'team'};
 const HINT={client:'Awa, cliente fibre',conseiller:'Support client',technicien:'Missions terrain',superviseur:'Valide les plans',direction:'Pilote le réseau'};

 // Choisir un rôle. Direction verrouillée : on quitte le compte actuel et la connexion s'ouvre, adresse remplie.
 async function choose(r){
  if(r.locked){await post('/api/demo/roles/leave',{});location.assign(new URL(location.pathname+r.login,location.origin).href);return;}
  const d=await post('/api/demo/roles/switch',{role:r.key});location.assign(new URL(location.pathname+d.page,location.origin).href);
 }
 const Lock=()=>h('svg',{className:'rb-lock',width:12,height:12,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2.4,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('rect',{x:5,y:11,width:14,height:10,rx:2}),h('path',{d:'M8 11V8a4 4 0 0 1 8 0v3'}));
 function Face({name,label,look}){
  if(name&&window.FGAvatar)return h(FGAvatar.Face,{name,role:look,size:30});
  return h('span',{className:'rb-initial','aria-hidden':true},label.charAt(0));
 }
 function Bar(){
  const [data,setData]=S(null),[busy,setBusy]=S(''),[error,setError]=S('');
  E(()=>{let live=true;const refresh=()=>load().then(d=>{if(live)setData(d);});refresh();
   const seen=()=>{if(document.visibilityState==='visible')refresh();};document.addEventListener('visibilitychange',seen);addEventListener('fg-rolebar-refresh',refresh);
   // Connexion ou déconnexion faite dans l'application : la barre suit sans recharger la page.
   const t=setInterval(()=>{if(document.visibilityState==='visible')refresh();},15000);
   return()=>{live=false;clearInterval(t);document.removeEventListener('visibilitychange',seen);removeEventListener('fg-rolebar-refresh',refresh);};},[]);
  const active=!!data?.active;
  E(()=>{document.documentElement.classList.toggle('has-rolebar',active);},[active]);
  E(()=>{if(!error)return;const t=setTimeout(()=>setError(''),4000);return()=>clearTimeout(t);},[error]);
  if(!active)return null;
  async function pick(r){
   if(r.current||busy)return;setBusy(r.key);setError('');
   try{await choose(r);}
   catch(e){setError(e.message);setBusy('');}
  }
  return h('nav',{className:'rb-bar','aria-label':'Changer de rôle pour la démo'},
   error&&h('p',{className:'rb-error',role:'alert'},error),
   h('div',{className:'rb-row'},data.roles.map(r=>h('button',{type:'button',key:r.key,className:'rb-role'+(r.current?' is-current':'')+(busy===r.key?' is-busy':''),
    'aria-current':r.current?'true':undefined,disabled:!r.ready||!!busy,title:(r.name?r.name+' · ':'')+HINT[r.key]+(r.locked?' · mot de passe demandé':''),onClick:()=>pick(r)},
    h('span',{className:'rb-face'},h(Face,{name:r.name,label:r.label,look:LOOK[r.key]}),r.locked&&h(Lock)),h('span',{className:'rb-label'},r.label)))));
 }

 // Sous le formulaire de connexion : « Comptes de démo », comme dans Dabali.
 function DemoAccounts({onDirection,disabled}){
  const [data,setData]=S(null),[busy,setBusy]=S(''),[error,setError]=S(''),[hint,setHint]=S('');
  const fill=email=>setTimeout(()=>{const f=document.querySelector('.ln-panel form');const m=f?.querySelector('input[name=email]'),p=f?.querySelector('input[name=password]');if(m&&email){m.value=email;}p?.focus();},60);
  E(()=>{load().then(d=>{setData(d);const dir=d.roles?.find(r=>r.key==='direction');if(new URLSearchParams(location.search).get('compte')==='direction'&&dir){setHint('Direction : entrez son mot de passe. Elle peut tout remettre à zéro, elle reste donc protégée.');fill(dir.email);}});},[]);
  if(!data?.roles)return null;
  async function pick(r){
   if(busy||!r.ready)return;setError('');
   if(r.locked){onDirection?.();setHint('Direction : entrez son mot de passe. Elle peut tout remettre à zéro, elle reste donc protégée.');fill(r.email);return;}
   setBusy(r.key);try{await choose(r);}catch(e){setError(e.message);setBusy('');}
  }
  return h('section',{className:'rb-accounts','aria-labelledby':'rb-accounts-title'},
   h('h3',{id:'rb-accounts-title'},'Comptes de démo'),
   h('p',null,'Un geste pour entrer, sans rien taper.'),
   h('div',{className:'rb-chips'},data.roles.map(r=>h('button',{type:'button',key:r.key,className:'rb-chip'+(busy===r.key?' is-busy':''),disabled:disabled||!r.ready||!!busy,onClick:()=>pick(r),title:HINT[r.key]+(r.locked?' · mot de passe demandé':'')},
    h('span',{className:'rb-face'},h(Face,{name:r.name,label:r.label,look:LOOK[r.key]}),r.locked&&h(Lock)),h('span',null,r.label)))),
   hint&&h('p',{className:'rb-hint',role:'status'},hint),
   error&&h('p',{className:'j-error',role:'alert'},error));
 }

 // Dans « À propos de la démo » : la direction peut ouvrir la Direction en un geste sur cet appareil.
 function Activator({user}){
  const [data,setData]=S(null),[busy,setBusy]=S(false),[error,setError]=S('');
  E(()=>{load().then(setData);},[]);
  if(!data)return null;
  const admin=user?.role==='admin',pass=!!data.pass;
  if(!pass&&!admin)return null;
  async function run(open){setBusy(true);setError('');
   try{if(open)await post('/api/demo/roles/open',{},user.csrf);else await post('/api/demo/roles/close',{});setData(await load());dispatchEvent(new Event('fg-rolebar-refresh'));}
   catch(e){setError(e.message);}finally{setBusy(false);}}
  return h('div',{className:'fg-demo-block rb-activator'},h('h3',null,'Direction en un geste'),
   h('p',null,pass?'Sur cet appareil, la barre des rôles ouvre aussi la Direction sans mot de passe, pendant 12 heures.':'Les comptes de démo s’ouvrent sans rien taper, sauf la Direction. Sur cet appareil seulement, vous pouvez l’ouvrir aussi en un geste pendant 12 heures.'),
   error&&h('p',{role:'alert',className:'fg-demo-error'},error),
   h('div',{className:'fg-demo-choices'},pass?h('button',{type:'button',className:'fg-demo-choice',disabled:busy,onClick:()=>run(false)},'Retirer de cet appareil'):
    h('button',{type:'button',className:'fg-demo-choice is-active',disabled:busy,onClick:()=>run(true)},busy?'Activation…':'Activer sur cet appareil')));
 }

 window.FGRoleBar={Bar,Activator,DemoAccounts};
 const mount=()=>{const el=document.createElement('div');el.id='fg-rolebar';document.body.appendChild(el);ReactDOM.createRoot(el).render(h(Bar));};
 if(document.body)mount();else addEventListener('DOMContentLoaded',mount);
})();
