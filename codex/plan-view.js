/* Changer de forfait (onglet Compte) : la grille des offres fibre, le conseil de Guardian d'après les mesures de la box,
   puis un récapitulatif à confirmer. Plus rapide : complément payé avec Moov Money, actif tout de suite.
   Moins cher : rien à payer, actif le 1er du mois suivant. Prix et complément sont recalculés par le serveur (journey-store.cjs). */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const F=n=>Number(n||0).toLocaleString('fr-FR')+' F';
 const USES={50:'Pour 1 ou 2 personnes : WhatsApp, réseaux sociaux, vidéos.',100:'Pour la famille : plusieurs écrans, télétravail, visio.',200:'Pour les grands foyers : vidéo 4K et jeux en ligne.',300:'Pour beaucoup d’appareils en même temps.',500:'Pour travailler à la maison et envoyer de gros fichiers.'};
 const day=at=>new Date(at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'}).replace(/^1 /,'1er ');
 const nextMonth=()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth()+1,1).getTime();};
 function Icon({d,size=20}){return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d}));}
 const I={back:'m15 6-6 6 6 6',check:'m5 12 5 5 9-10',spark:'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',calendar:'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',gift:'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10 3 7.5 4 9 7 12 7m0 0s2-4 4.5-3S15 7 12 7'};

 // Conseil de Guardian : le plus petit forfait qui laisse de la marge au débit utilisé en ce moment.
 function advice(state,plans){
  const m=state.metrics||{};if(!plans.length||!m.capacity||state.sharedIncident)return null;
  const need=Math.max(m.used||0,1)*1.6,rec=plans.find(p=>p.mbps>=need)||plans.at(-1);
  return {plan:rec,used:m.used||0,connected:m.connected||0};
 }

 function View({state,user,busy,onUpgrade,onDowngrade,onKeep,onBack}){
  const plans=state.plans||[],current=state.plan||plans[1]||{},next=state.nextPlan,tip=advice(state,plans);
  const [pick,P]=S(null),review=R(null),sel=pick&&pick.id!==current.id?plans.find(p=>p.id===pick.id):null,up=sel&&sel.price>current.price;
  E(()=>{if(sel&&matchMedia('(max-width:760px)').matches)review.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[pick]);
  const tipText=tip&&(tip.plan.id===current.id?'Votre forfait actuel vous suffit.':tip.plan.mbps>current.mbps?'Passer à '+tip.plan.mbps+' Mb/s vous donnerait de la marge.':tip.plan.mbps+' Mb/s suffiraient pour vos usages du moment.');
  return h('div',{className:'pv'},
   h('button',{type:'button',className:'pv-back',onClick:onBack},h(Icon,{d:I.back,size:18}),'Mon compte'),
   h('header',{className:'pv-head'},
    h('div',null,h('h1',null,'Changer de forfait'),h('p',null,'Installation et box offertes. Vous changez quand vous voulez.')),
    h('div',{className:'pv-now'},window.FGAvatar&&h(FGAvatar.Face,{name:user?.name,size:44,role:'client'}),h('div',null,h('small',null,'Votre forfait'),h('strong',null,current.mbps+' Mb/s'),h('span',null,F(current.price)+' par mois')))),
   next&&h('section',{className:'pv-next',role:'status'},h('span',{className:'pv-next-ico'},h(Icon,{d:I.calendar,size:20})),
    h('div',null,h('strong',null,'À partir du '+day(next.at)+' : '+next.plan.mbps+' Mb/s'),h('small',null,'Pour '+F(next.plan.price)+' par mois. D’ici là, vous gardez '+current.mbps+' Mb/s.')),
    h('button',{type:'button',className:'pv-link',onClick:onKeep,disabled:busy},'Garder '+current.mbps+' Mb/s')),
   tip&&h('section',{className:'pv-tip'},h('span',{className:'j-chat-avatar pv-tip-art','aria-hidden':true},h('i'),h('i'),h('b')),
    h('div',null,h('small',null,'Le conseil de Guardian'),h('p',null,'Chez vous, '+tip.connected+' appareil'+(tip.connected>1?'s':'')+' utilise'+(tip.connected>1?'nt':'')+' '+String(tip.used).replace('.',',')+' Mb/s en ce moment. '+tipText))),
   h('div',{className:'pv-list',role:'radiogroup','aria-label':'Choisir un forfait'},plans.map(p=>{
    const mine=p.id===current.id,chosen=pick?.id===p.id,diff=p.price-current.price,later=next?.plan.id===p.id;
    return h('button',{key:p.id,type:'button',role:'radio','aria-checked':chosen,className:'pv-plan'+(mine?' mine':'')+(chosen?' chosen':''),onClick:()=>P(mine?null:p)},
     h('span',{className:'pv-speed'},h('b',null,p.mbps),h('small',null,'Mb/s')),
     h('span',{className:'pv-info'},h('span',{className:'pv-tags'},mine&&h('em',{className:'pv-tag mine'},'Votre forfait'),tip?.plan.id===p.id&&!mine&&h('em',{className:'pv-tag tip'},'Conseillé par Guardian'),later&&h('em',{className:'pv-tag later'},'Prévu le '+day(next.at))),h('small',null,USES[p.mbps]||'')),
     h('span',{className:'pv-price'},h('strong',null,F(p.price)),h('small',null,'par mois'),!mine&&h('i',{className:diff>0?'more':'less'},(diff>0?'+ ':'− ')+F(Math.abs(diff)))),
     h('span',{className:'pv-radio','aria-hidden':true},chosen&&h(Icon,{d:I.check,size:14})));
   })),
   sel?h('section',{ref:review,className:'pv-review','aria-labelledby':'pv-review-title'},
    h('h2',{id:'pv-review-title'},'Passer à '+sel.mbps+' Mb/s'),
    h('dl',null,
     h('div',null,h('dt',null,'Aujourd’hui'),h('dd',null,up?F(sel.price-current.price):'0 F',h('small',null,up?'Complément pour ce mois':'Rien à payer'))),
     h('div',null,h('dt',null,'Ensuite, chaque mois'),h('dd',null,F(sel.price))),
     h('div',null,h('dt',null,'Nouveau débit'),h('dd',null,up?'Tout de suite':'Le '+day(nextMonth()),!up&&h('small',null,'Vous gardez '+current.mbps+' Mb/s jusque-là')))),
    up?h('button',{type:'button',className:'pv-cta mm',onClick:()=>onUpgrade(sel),disabled:busy},h('span',{className:'pv-mm','aria-hidden':true},'M'),'Payer '+F(sel.price-current.price)+' avec Moov Money'):
     h('button',{type:'button',className:'pv-cta',onClick:()=>onDowngrade(sel).then(()=>P(null)),disabled:busy},'Confirmer le passage à '+sel.mbps+' Mb/s'),
    h('button',{type:'button',className:'pv-cancel',onClick:()=>P(null)},'Annuler')):
   h('p',{className:'pv-hint'},h(Icon,{d:I.gift,size:18}),'Choisissez une offre pour voir ce que vous payez. Rien ne change sans votre accord.'));
 }
 window.FGPlans={View};
})();
