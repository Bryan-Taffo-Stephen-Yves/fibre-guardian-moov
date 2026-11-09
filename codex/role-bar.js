(function(){
 'use strict';
 // Barre des rôles de la démo, en bas de l'écran : Client, Conseiller, Technicien, Superviseur, Direction.
 // Elle n'apparaît que sur un appareil où la direction l'a activée (« À propos de la démo »).
 // Chaque bouton ouvre une vraie session sur un compte de démo : le serveur vérifie tout (role-bar.cjs).
 const h=React.createElement,{useState:S,useEffect:E}=React;
 const post=(url,data,csrf)=>fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:JSON.stringify(data||{})}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Action impossible pour le moment.');return d;});
 const load=()=>fetch('/api/demo/roles',{credentials:'same-origin'}).then(r=>r.ok?r.json():{active:false}).catch(()=>({active:false}));
 const LOOK={client:'client',conseiller:'team',technicien:'tech',superviseur:'team',direction:'team'};
 const HINT={client:'Awa, cliente fibre',conseiller:'Support client',technicien:'Missions terrain',superviseur:'Valide les plans',direction:'Pilote le réseau'};

 function Face({name,label,look}){
  if(name&&window.FGAvatar)return h(FGAvatar.Face,{name,role:look,size:30});
  return h('span',{className:'rb-initial','aria-hidden':true},label.charAt(0));
 }
 function Bar(){
  const [data,setData]=S(null),[busy,setBusy]=S(''),[error,setError]=S('');
  E(()=>{let live=true;const refresh=()=>load().then(d=>{if(live)setData(d);});refresh();
   const seen=()=>{if(document.visibilityState==='visible')refresh();};document.addEventListener('visibilitychange',seen);addEventListener('fg-rolebar-refresh',refresh);
   return()=>{live=false;document.removeEventListener('visibilitychange',seen);removeEventListener('fg-rolebar-refresh',refresh);};},[]);
  const active=!!data?.active;
  E(()=>{document.documentElement.classList.toggle('has-rolebar',active);},[active]);
  E(()=>{if(!error)return;const t=setTimeout(()=>setError(''),4000);return()=>clearTimeout(t);},[error]);
  if(!active)return null;
  async function pick(r){
   if(r.current||busy)return;setBusy(r.key);setError('');
   try{const d=await post('/api/demo/roles/switch',{role:r.key});const url=new URL(location.pathname+d.page,location.origin);location.assign(url.href);}
   catch(e){setError(e.message);setBusy('');}
  }
  return h('nav',{className:'rb-bar','aria-label':'Changer de rôle pour la démo'},
   error&&h('p',{className:'rb-error',role:'alert'},error),
   h('div',{className:'rb-row'},data.roles.map(r=>h('button',{type:'button',key:r.key,className:'rb-role'+(r.current?' is-current':'')+(busy===r.key?' is-busy':''),
    'aria-current':r.current?'true':undefined,disabled:!r.ready||!!busy,title:r.name?r.name+' · '+HINT[r.key]:HINT[r.key],onClick:()=>pick(r)},
    h(Face,{name:r.name,label:r.label,look:LOOK[r.key]}),h('span',{className:'rb-label'},r.label)))));
 }

 // Dans « À propos de la démo » : activer ou retirer la barre sur cet appareil.
 function Activator({user}){
  const [data,setData]=S(null),[busy,setBusy]=S(false),[error,setError]=S('');
  E(()=>{load().then(setData);},[]);
  if(!data)return null;
  const admin=user?.role==='admin';
  if(!data.active&&!admin)return null;
  async function run(open){setBusy(true);setError('');
   try{if(open)await post('/api/demo/roles/open',{},user.csrf);else await post('/api/demo/roles/close',{});setData(await load());dispatchEvent(new Event('fg-rolebar-refresh'));}
   catch(e){setError(e.message);}finally{setBusy(false);}}
  return h('div',{className:'fg-demo-block rb-activator'},h('h3',null,'Barre des rôles'),
   h('p',null,data.active?'Elle est active sur cet appareil pendant 12 heures. Un geste suffit pour passer du client au technicien, au superviseur ou à la direction.':'Ajoutez en bas de l’écran une barre pour passer d’un rôle à l’autre pendant la présentation. Elle reste sur cet appareil seulement, pendant 12 heures.'),
   error&&h('p',{role:'alert',className:'fg-demo-error'},error),
   h('div',{className:'fg-demo-choices'},data.active?h('button',{type:'button',className:'fg-demo-choice',disabled:busy,onClick:()=>run(false)},'Retirer la barre de cet appareil'):
    h('button',{type:'button',className:'fg-demo-choice is-active',disabled:busy,onClick:()=>run(true)},busy?'Activation…':'Activer sur cet appareil')));
 }

 window.FGRoleBar={Bar,Activator};
 const mount=()=>{const el=document.createElement('div');el.id='fg-rolebar';document.body.appendChild(el);ReactDOM.createRoot(el).render(h(Bar));};
 if(document.body)mount();else addEventListener('DOMContentLoaded',mount);
})();
