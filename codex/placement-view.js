/* « Placer ma box » dans l'écran Appareils (placement-box.cjs côté serveur).
   Le plan de la maison sert aussi de sélecteur : on touche la pièce où la box est posée, puis « Mesurer ici ».
   Après deux endroits, Guardian compare et recommande celui où l'appareil le plus mal servi reçoit le plus. */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const LEVEL={'tres-bon':'Très bon',bon:'Bon',moyen:'Moyen',faible:'Faible'};
 const lvl=v=>v>=70?'tres-bon':v>=50?'bon':v>=35?'moyen':'faible';
 const tag=n=>{const w=String(n||'?').split(/\s+/);const t=w[0]==='PC'||w[0]==='LG'?w.slice(0,2).join(' '):w[0];return t.length>9?t.slice(0,8)+'…':t;};
 function BoxIcon(){return h('svg',{width:22,height:22,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('rect',{x:3,y:12,width:18,height:7,rx:2}),h('path',{d:'M7 15.5h.01M10 15.5h.01M8 12 6 5M16 12l2-7'}));}
 function Waves(){return h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round','aria-hidden':true},h('path',{d:'M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01'}));}
 function Bar({value}){return h('span',{className:'pb-bar','aria-hidden':true},h('i',{className:'pb-'+lvl(value),style:{width:Math.max(4,value)+'%'}}));}

 function Card({api,version}){
  const [v,V]=S(null),[spot,SP]=S(null),[busy,B]=S(false),[error,X]=S(''),[notice,N]=S(''),apiRef=R(api);apiRef.current=api;
  const say=e=>e&&e.status?e.message:'Guardian n’arrive pas à joindre le service. Vérifiez votre connexion, puis réessayez.';
  const load=()=>apiRef.current('/journey/placement').then(d=>{V(d);X('');SP(s=>s||d.boxAt);}).catch(e=>X(say(e)));
  E(()=>{load();const t=setInterval(load,15000);return()=>clearInterval(t);},[version]);
  const send=async body=>{B(true);try{const d=await apiRef.current('/journey/placement','POST',body);V(d);X('');return d;}catch(e){X(say(e));}finally{B(false);}};
  if(!v)return error?h('section',{className:'du-card pb-card'},h('p',{role:'alert',className:'j-error'},error)):null;
  const room=id=>v.rooms.find(r=>r.id===id),shown=v.spots.find(s=>s.spot===spot),sig=id=>shown?.devices.find(d=>d.id===id)?.signal;
  const measure=async()=>{const d=await send({action:'measure',spot});if(d)N('');};
  const maxed=v.spots.length>=v.max&&!shown;
  return h('section',{className:'du-card pb-card','aria-labelledby':'pb-title'},
   h('div',{className:'du-watch-head'},h('span',{className:'du-device-icon pb-head-icon'},h(BoxIcon)),
    h('div',null,h('h2',{id:'pb-title'},'Placer ma box au meilleur endroit'),h('p',null,'Guardian mesure le signal Wi-Fi de chaque appareil. Déplacez la box, mesurez encore : il vous dit où la poser.'))),
   h('ol',{className:'pb-steps','aria-label':'Les étapes'},['Touchez la pièce où est la box','Mesurez','Déplacez la box et recommencez'].map((t,i)=>h('li',{key:i,className:i<(v.spots.length>1?3:v.spots.length?2:spot?1:0)?'done':''},h('b',null,i+1),t))),
   h('div',{className:'pb-body'},h('div',{className:'pb-left'},
   h('div',{className:'pb-plan',role:'radiogroup','aria-label':'Plan de la maison. Touchez la pièce où se trouve la box.'},v.rooms.map(r=>{
    const here=v.devices.filter(d=>d.room===r.id),measured=v.spots.find(s=>s.spot===r.id),isBest=v.best===r.id;
    return h('button',{type:'button',key:r.id,className:'pb-room'+(spot===r.id?' active':'')+(isBest?' best':''),style:{gridColumn:r.col+1,gridRow:r.row+1},role:'radio','aria-checked':spot===r.id,onClick:()=>{SP(r.id);N('');},
      'aria-label':r.label+(spot===r.id?', la box est ici':'')+(measured?', déjà mesuré : le plus faible reçoit '+measured.min+' %':'')+(isBest?', meilleur endroit':'')+(here.length?', '+here.length+' appareil'+(here.length>1?'s':''):'')},
     h('span',{className:'pb-room-name'},r.label),
     isBest&&h('span',{className:'pb-best-tag'},'Le meilleur'),
     spot===r.id&&h('span',{className:'pb-box'},h(BoxIcon),h('span',{className:'pb-pulse','aria-hidden':true})),
     !isBest&&measured&&spot!==r.id&&h('span',{className:'pb-measured'},'Essayé · '+measured.min+' %'),
     h('span',{className:'pb-dots'},here.map(d=>{const s=sig(d.id);return h('span',{key:d.id,className:'pb-dot'+(s==null?'':' pb-'+lvl(s)),title:d.name+(s==null?'':' : '+s+' %')},tag(d.name));})));
   })),
   h('div',{className:'pb-actions'},
    h('button',{type:'button',className:'j-button primary pb-measure',disabled:busy||!spot||maxed,onClick:measure},h(Waves),busy?'Mesure en cours…':shown?'Mesurer encore ici':'Mesurer avec la box ici'),
    v.spots.length>0&&h('button',{type:'button',className:'j-text-button pb-reset',disabled:busy,onClick:()=>send({action:'reset'}).then(d=>d&&N('On recommence. Touchez la pièce où est la box.'))},'Recommencer')),
   maxed&&h('p',{className:'pb-note'},'Vous avez essayé '+v.max+' endroits. Touchez une pièce déjà mesurée, ou « Recommencer ».'),
   notice&&h('p',{className:'pb-note',role:'status'},notice),
   error&&h('p',{role:'alert',className:'j-error'},error),
   ),h('div',{className:'pb-right'},
   h('div',{className:'du-advice pb-advice',role:'status'},h('div',{className:'du-advice-head'},h('span',{className:'j-chat-avatar du-advice-art','aria-hidden':true},h('i'),h('i'),h('b')),h('div',null,h('small',null,v.advice.title),h('p',null,v.advice.text)))),
   v.spots.length>1&&h('div',{className:'pb-compare'},h('h3',null,'Les endroits essayés'),h('ul',null,[...v.spots].sort((a,b)=>b.min-a.min||b.avg-a.avg).map(s=>{const weak=s.devices.reduce((w,d)=>d.signal<w.signal?d:w,s.devices[0]);
    return h('li',{key:s.spot,className:s.best?'best':''},h('button',{type:'button',className:'pb-compare-row',onClick:()=>SP(s.spot),'aria-pressed':spot===s.spot},
     h('span',{className:'pb-compare-name'},h('strong',null,room(s.spot)?.label),h('small',null,'Le moins bien servi : '+(weak?weak.name:'—'))),h(Bar,{value:s.min}),h('strong',{className:'pb-compare-val'},s.min+' %')));}))),
   shown&&h('div',{className:'pb-result'},h('h3',null,'Box '+(room(shown.spot)?.dans||'')),h('ul',null,shown.devices.map(d=>h('li',{key:d.id},
    h('span',{className:'pb-result-name'},h('strong',null,d.name),h('small',null,room(d.room)?.label+(d.real?' · lu par le PC':''))),h(Bar,{value:d.signal}),h('span',{className:'pb-val'},h('strong',null,d.signal+' %'),h('small',{className:'pb-'+d.level},LEVEL[d.level])))))),
   )),
   h('details',{className:'pb-rooms'},h('summary',null,'Changer la pièce d’un appareil'),h('ul',null,v.devices.map(d=>h('li',{key:d.id},h('label',null,h('span',null,d.name),
    h('select',{value:d.room,disabled:busy,onChange:e=>send({action:'room',id:d.id,room:e.target.value})},v.rooms.map(r=>h('option',{key:r.id,value:r.id},r.label)))))))),
   h('small',{className:'du-watch-note'},v.pc?'Le signal du PC branché est lu par Windows à chaque mesure. Celui des autres appareils est donné par la box.':'Le signal de chaque appareil est donné par la box. Avec un PC branché (« Tester ma connexion », puis « Brancher ce PC »), son vrai signal s’ajoute.'));
 }
 window.FGPlacementBox={Card};
})();
