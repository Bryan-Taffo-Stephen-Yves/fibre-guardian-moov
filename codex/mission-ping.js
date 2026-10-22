(function(){
 'use strict';
 // Bandeau « en direct » d'une mission, en haut de l'écran comme une notification de téléphone.
 // Chaque nouveau bandeau envoie l'événement « fg-mission-ping » : les écrans ouverts se rafraîchissent aussitôt.
 // Même composant pour le client, le technicien et l'équipe Moov ; le serveur choisit ce que chacun voit (/api/noc/pings).
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const ICON={truck:'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4',pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0',check:'m5 12 5 5 9-10',tool:'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5Z',bell:'M18 8a6 6 0 0 0-12 0v7l-3 3h18l-3-3ZM10 21h4',note:'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',wifi:'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',alert:'M12 8v5M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'};
 const LOOK={received:['alert','report'],dispatched:['truck','go'],mission:['truck','go'],en_route:['truck','go'],on_site:['pin','here'],verifying:['tool','done'],resolved:['wifi','done'],instruction:['note','team'],message:['note','team'],report:['note','team']};
 const SHOW_MS=9000;
 function Icon({name}){return h('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.9,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d:ICON[name]||ICON.bell}));}

 function Banner({api,onOpen}){
  const [list,L]=S([]),since=R(0),seen=R(new Set());
  E(()=>{let alive=true;
   const poll=()=>api('/noc/pings'+(since.current?'?since='+since.current:'')).then(r=>{if(!alive)return;since.current=r.now;const fresh=(r.items||[]).filter(p=>!seen.current.has(p.id));fresh.forEach(p=>seen.current.add(p.id));if(fresh.length){dispatchEvent(new Event('fg-mission-ping'));}if(fresh.length)L(v=>[...v,...fresh.map(p=>({...p,shown:Date.now()}))].slice(-3));}).catch(()=>{});
   poll();const t=setInterval(poll,3000);return()=>{alive=false;clearInterval(t);};},[]);
  E(()=>{if(!list.length)return;const t=setTimeout(()=>L(v=>v.filter(p=>Date.now()-p.shown<SHOW_MS)),1000);return()=>clearTimeout(t);},[list]);
  if(!list.length)return null;
  const close=id=>L(v=>v.filter(p=>p.id!==id));
  return h('div',{className:'mp-stack',role:'status','aria-live':'polite'},list.map(p=>{const [icon,tone]=LOOK[p.kind]||['bell','go'];
   return h('div',{key:p.id,className:'mp-card','data-tone':tone},
    h('button',{type:'button',className:'mp-main',onClick:()=>{close(p.id);onOpen?.(p);}},
     h('span',{className:'mp-icon'},h(Icon,{name:icon})),
     h('span',{className:'mp-text'},h('span',{className:'mp-top'},h('b',null,'Fibre Guardian'),h('small',null,'maintenant')),h('strong',null,p.title),p.body&&h('span',{className:'mp-body'},p.body))),
    h('button',{type:'button',className:'mp-close','aria-label':'Fermer la notification',onClick:()=>close(p.id)},'×'));}));
 }
 window.FGMissionPing={Banner};
})();
