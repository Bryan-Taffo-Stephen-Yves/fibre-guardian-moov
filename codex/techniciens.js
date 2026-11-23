/* « Vos techniciens près de chez vous » (accueil client) : les visages de l'équipe Moov qui intervient dans la commune,
   et leur fiche qui s'ouvre par-dessus l'accueil (pas de nouvelle page). Les données viennent de GET /api/techniciens
   (noc-store.cjs publicTeam) : nom, équipe, quartier, note, missions, occupé ou non. Jamais le téléphone ni la plaque. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const first=n=>String(n||'').trim().split(/\s+/)[0]||'';
 const note=r=>String(r).replace('.',',');
 const n=v=>Number(v||0).toLocaleString('fr-FR');
 const Face=p=>window.FGAvatar?h(FGAvatar.Face,{role:'tech',...p}):null;
 const Ico=p=>window.FGIcones?h(FGIcones.Icon,p):null;
 const STAR='m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z';
 const star=size=>h('svg',{width:size,height:size,viewBox:'0 0 24 24','aria-hidden':true,focusable:false,className:'tq-star'},h('path',{d:STAR,fill:'currentColor'}));
 const pin=h('svg',{width:14,height:14,viewBox:'0 0 24 24','aria-hidden':true,focusable:false},h('path',{d:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round'}));

 // Fiche du technicien : grand portrait, ce qu'il fait, et comment le faire venir (Moov envoie le plus proche).
 function Sheet({t,onClose,onReport,onGuardian}){
  const close=R(null);
  E(()=>{const prev=document.activeElement;close.current?.focus();const k=e=>{if(e.key==='Escape')return onClose();if(e.key!=='Tab')return;const box=document.querySelector('.tq-sheet');if(!box)return;const f=[...box.querySelectorAll('button,[href],[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled);if(!f.length)return;const a=f[0],z=f[f.length-1];if(!box.contains(document.activeElement)){e.preventDefault();a.focus();}else if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus();}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus();}};document.addEventListener('keydown',k);return()=>{document.removeEventListener('keydown',k);try{prev&&prev.focus();}catch{}};},[]);
  const go=fn=>()=>{onClose();fn&&fn();};
  const layer=h('div',{className:'tq-backdrop',onClick:e=>{if(e.target===e.currentTarget)onClose();}},
   h('section',{className:'tq-sheet',role:'dialog','aria-modal':true,'aria-labelledby':'tq-sheet-name'},
    h('div',{className:'tq-hero'},
     h('button',{type:'button',className:'tq-close',ref:close,onClick:onClose,'aria-label':'Fermer la fiche'},h('svg',{width:20,height:20,viewBox:'0 0 24 24','aria-hidden':true},h('path',{d:'m6 6 12 12M18 6 6 18',fill:'none',stroke:'currentColor',strokeWidth:2.2,strokeLinecap:'round'}))),
     h('span',{className:'tq-hero-tag'},'Technicien Moov'),
     window.FGAvatar&&h(FGAvatar.Sticker,{name:t.name,role:'tech',pose:'tools',size:190,bare:true,className:'tq-hero-art'})),
    h('div',{className:'tq-body'},
     h('div',{className:'tq-id'},
      h('div',null,h('h2',{id:'tq-sheet-name'},t.name),h('p',{className:'tq-where'},pin,'Équipe '+t.team+' · '+t.zone)),
      h('span',{className:'tq-rate'},star(16),note(t.rating))),
     h('p',{className:'tq-state '+(t.busy?'busy':'free')},h('i',{'aria-hidden':true}),t.busy?first(t.name)+' est en mission en ce moment.':first(t.name)+' est disponible aujourd’hui.'),
     h('div',{className:'tq-stats'},
      h('div',null,h('strong',null,note(t.rating)),h('small',null,'Note des clients')),
      h('div',null,h('strong',null,n(t.missions)),h('small',null,'Interventions')),
      h('div',null,h('strong',null,t.zone),h('small',null,'Son quartier'))),
     h('h3',null,'Son métier'),
     h('p',{className:'tq-about'},'Installation de la fibre, câble coupé, box qui ne s’allume plus, Wi-Fi qui ne passe pas dans une pièce : '+first(t.name)+' s’en occupe chez vous, avec le matériel Moov.'),
     h('p',{className:'tq-how'},Ico({name:'guardian',size:22}),h('span',null,'Quand vous signalez un problème, Moov envoie le technicien libre le plus proche. Vous le suivez en direct dans l’app.')),
     h('div',{className:'tq-actions'},
      onReport&&h('button',{type:'button',className:'tq-btn primary',onClick:go(onReport)},Ico({name:'alert',size:20}),'Signaler un problème'),
      onGuardian&&h('button',{type:'button',className:'tq-btn ghost',onClick:go(onGuardian)},Ico({name:'guardian',size:20}),'Demander à Guardian')))));
  // Posée dans .journey (pour garder le mode sombre) mais hors de l'accueil animé, sinon « position:fixed » se décale.
  const host=document.querySelector('.journey')||document.body;
  return window.ReactDOM&&ReactDOM.createPortal?ReactDOM.createPortal(layer,host):layer;
 }

 // Bande de cartes à faire défiler : d'abord les techniciens de la commune du client, puis les mieux notés.
 function Strip({zone,onReport,onGuardian}){
  const [team,setTeam]=S(null),[open,setOpen]=S(null);
  E(()=>{let alive=true;fetch('/api/techniciens',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(r=>{if(alive&&Array.isArray(r))setTeam(r);}).catch(()=>{});return()=>{alive=false;};},[]);
  if(!team||!team.length)return null;
  const here=t=>zone&&String(zone).toLowerCase().includes(String(t.zone).toLowerCase())?1:0;
  const list=team.slice().sort((a,b)=>here(b)-here(a)||b.rating-a.rating).slice(0,5),cur=open&&team.find(t=>t.id===open);
  return h('section',{className:'tq','aria-labelledby':'tq-title'},
   h('div',{className:'tq-head'},h('h2',{id:'tq-title'},'Vos techniciens près de chez vous'),h('p',null,'Les équipes Moov d’Abidjan, en commençant par votre commune')),
   h('div',{className:'tq-row'},list.map(t=>h('button',{type:'button',key:t.id,className:'tq-card',onClick:()=>setOpen(t.id),'aria-label':t.name+', équipe '+t.team+', note '+note(t.rating)+' sur 5, '+(t.busy?'en mission':'disponible')},
    h('span',{className:'tq-face'},Face({name:t.name,size:64}),h('i',{className:'tq-dot '+(t.busy?'busy':'free'),'aria-hidden':true})),
    h('b',null,t.name),
    h('small',{className:'tq-team'},'Équipe '+t.team),
    h('span',{className:'tq-meta'},h('span',{className:'tq-rate'},star(13),note(t.rating)),h('span',null,n(t.missions)+' interventions')),
    h('span',{className:'tq-zone'},pin,t.zone),
    h('span',{className:'tq-see'},'Voir sa fiche')))),
   cur&&h(Sheet,{t:cur,onClose:()=>setOpen(null),onReport,onGuardian}));
 }
 window.FGTechniciens={Strip,Sheet};
})();
