/* Changer de forfait (onglet Compte) : la grille des offres fibre, le conseil de Guardian d'après les mesures de la box,
   puis un récapitulatif à confirmer. Plus rapide : complément payé avec Moov Money, actif tout de suite.
   « Quel forfait pour moi ? » (SmartOffer, smart-offer.js) : le client coche ses usages, Guardian conseille le forfait qui suffit.
   Moins cher : rien à payer, actif le 1er du mois suivant. Prix et complément sont recalculés par le serveur (journey-store.cjs). */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const F=n=>Number(n||0).toLocaleString('fr-FR')+' F';
 const USES={50:'Pour 1 ou 2 personnes : WhatsApp, réseaux sociaux, vidéos.',100:'Pour la famille : plusieurs écrans, télétravail, visio.',200:'Pour les grands foyers : vidéo 4K et jeux en ligne.',300:'Pour beaucoup d’appareils en même temps.',500:'Pour travailler à la maison et envoyer de gros fichiers.'};
 const day=at=>new Date(at).toLocaleDateString('fr-FR',{day:'numeric',month:'long'}).replace(/^1 /,'1er ');
 const nextMonth=()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth()+1,1).getTime();};
 function Icon({d,size=20}){return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d}));}
 const I={home:'M4 11 12 4l8 7v9H4zM10 20v-5h4v5',wifi:'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',game:'M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-1a4 4 0 0 1 4-4zM7 11v3M5.5 12.5h3M16 12h.01M18 13.5h.01',pin:'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',users:'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3M15.5 4.2a3.5 3.5 0 0 1 0 6.6',back:'m15 6-6 6 6 6',check:'m5 12 5 5 9-10',spark:'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18',calendar:'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',gift:'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10 3 7.5 4 9 7 12 7m0 0s2-4 4.5-3S15 7 12 7'};

 // Conseil de Guardian : le plus petit forfait qui laisse de la marge au débit utilisé en ce moment.
 function advice(state,plans){
  const m=state.metrics||{};if(!plans.length||!m.capacity||state.sharedIncident)return null;
  const need=Math.max(m.used||0,1)*1.6,rec=plans.find(p=>p.mbps>=need)||plans.at(-1);
  return {plan:rec,used:m.used||0,connected:m.connected||0};
 }

 // « Quel forfait pour moi ? » (SmartOffer) : usages, foyer, pièces, budget (et commune avant l'abonnement) → forfait conseillé,
 // avec le détail du calcul. Utilisé dans « Changer de forfait » et sur la page d'accueil publique (landing.js).
 function Counter({label,icon,value,min,max,onChange,unit}){
  const id='pv-c-'+unit;
  return h('div',{className:'pv-people'},h('span',{className:'pv-people-ico','aria-hidden':true},h(Icon,{d:icon,size:20})),h('span',{id},label),
   h('div',{className:'pv-step',role:'group','aria-labelledby':id},
    h('button',{type:'button','aria-label':'Une '+unit+' de moins',onClick:()=>onChange(Math.max(min,value-1)),disabled:value<=min},'−'),
    h('output',{'aria-live':'polite'},value),
    h('button',{type:'button','aria-label':'Une '+unit+' de plus',onClick:()=>onChange(Math.min(max,value+1)),disabled:value>=max},'+')));
 }
 function Finder({plans,current,form,onForm,onPick,pickLabel,withCommune,invite}){
  const SO=window.FGSmartOffer;if(!SO)return null;
  const set=k=>v=>onForm({...form,[k]:v}),uses=form.uses;
  const r=SO.recommend({...form,plans:plans&&plans.length?plans:SO.PLANS}),toggle=id=>set('uses')(uses.includes(id)?uses.filter(u=>u!==id):uses.concat(id));
  const mine=r&&current&&r.plan.id===current.id;
  return h('section',{className:'pv-find','aria-labelledby':'pv-find-title'},
   h('div',{className:'pv-find-head'},h('h2',{id:'pv-find-title'},'Quel forfait pour moi ?'),h('p',null,'Dites-nous ce que vous faites sur internet. Guardian calcule le débit qu’il vous faut.')),
   h('div',{className:'pv-find-form'},
    h('div',{className:'pv-uses',role:'group','aria-label':'Vos usages'},SO.USES.map(u=>{const on=uses.includes(u.id);
     return h('button',{key:u.id,type:'button',className:'pv-use'+(on?' on':''),'aria-pressed':on,onClick:()=>toggle(u.id)},
      h('span',{className:'pv-use-box','aria-hidden':true},on&&h(Icon,{d:I.check,size:14})),h('span',null,h('strong',null,u.label),h('small',null,u.hint)));})),
    h('div',{className:'pv-find-side'},
     h(Counter,{label:'Personnes à la maison',icon:I.users,value:form.people,min:1,max:10,onChange:set('people'),unit:'personne'}),
     h(Counter,{label:'Pièces à couvrir en Wi-Fi',icon:I.home,value:form.rooms,min:1,max:12,onChange:set('rooms'),unit:'pièce'}),
     h('div',{className:'pv-budget',role:'group','aria-label':'Budget par mois'},h('span',null,'Budget par mois'),
      h('div',null,[0,...SO.BUDGETS].map(b=>h('button',{key:b,type:'button','aria-pressed':form.budget===b,className:form.budget===b?'on':'',onClick:()=>set('budget')(b)},b?'≤ '+F(b):'Pas de limite')))),
     withCommune&&h('label',{className:'pv-commune'},h('span',null,'Votre commune'),
      h('select',{value:form.commune,onChange:e=>set('commune')(e.target.value)},h('option',{value:''},'Choisir…'),SO.ZONE.map(c=>h('option',{key:c,value:c},c)),h('option',{value:'Autre'},'Autre ville'))))),
   r?h('div',{className:'pv-result',role:'status'},
    h('div',{className:'pv-result-top'},h('span',{className:'pv-speed'},h('b',null,r.plan.mbps),h('small',null,'Mb/s')),
     h('div',null,h('small',null,'Guardian vous conseille'),h('strong',null,'Fibre '+r.plan.mbps+' · '+F(r.plan.price)+' par mois'),
      h('p',null,mine?'C’est déjà votre forfait : il vous suffit.':r.over?'Le meilleur forfait dans votre budget.':'Il vous faut environ '+r.need+' Mb/s quand toute la maison est connectée.'))),
    r.over&&h('div',{className:'pv-over'},h('strong',null,'Pour être tout à fait à l’aise, il faudrait '+r.ideal.mbps+' Mb/s ('+F(r.ideal.price)+').'),r.over.trims.length>0&&h(React.Fragment,null,h('span',null,'Avec '+r.plan.mbps+' Mb/s, ça passe si :'),h('ul',null,r.over.trims.map(t=>h('li',{key:t},t))))),
    h('ul',{className:'pv-calc'},r.parts.map(p=>h('li',{key:p.id},h('span',null,p.label),h('b',null,p.mbps+' Mb/s'))),h('li',{className:'pv-calc-margin'},h('span',null,'Marge pour que ça reste fluide'),h('b',null,'+ '+Math.round((SO.MARGIN-1)*100)+' %'))),
    h('ul',{className:'pv-perks'},
     h('li',null,h(Icon,{d:I.wifi,size:18}),r.extenders?'Wi-Fi : '+r.rooms+' pièces, c’est trop pour la box seule. Ajoutez '+r.extenders+' répéteur'+(r.extenders>1?'s':'')+' Wi-Fi, un toutes les 2 pièces.':'Wi-Fi : la box couvre vos '+r.rooms+' pièce'+(r.rooms>1?'s':'')+', placez-la au centre de la maison.'),
     uses.includes('jeux')&&h('li',null,h(Icon,{d:I.game,size:18}),'Un jeu de '+SO.GAME_GB+' Go (la taille d’un Call of Duty) se télécharge en '+SO.duration(r.gameMinutes)+' environ.'),
     withCommune&&r.commune&&h('li',{className:r.inZone?'':'warn'},h(Icon,{d:I.pin,size:18}),r.inZone?(invite?h('span',null,r.commune+' fait partie de la zone fibre. ',h('b',null,'Votre offre : Fibre '+r.plan.mbps+' à '+F(r.plan.price)+' par mois, et 1 mois offert après 3 mois (code de '+invite.parrain+').'),' Un conseiller confirme votre adresse exacte.'):r.commune+' fait partie de la zone fibre : un conseiller confirme votre adresse exacte.'):'Votre ville n’est pas encore dans notre zone fibre. Un conseiller Moov vous dit ce qui est possible à votre adresse.')),
    r.sources.length>0&&h('details',{className:'pv-sources'},h('summary',null,'D’où viennent ces chiffres ?'),h('ul',null,r.sources.map(s=>h('li',{key:s.id},s.text)))),
    !mine&&onPick&&h('button',{type:'button',className:'pv-cta',onClick:()=>onPick(r.plan)},pickLabel?pickLabel(r.plan):'Voir l’offre '+r.plan.mbps+' Mb/s')):
   h('p',{className:'pv-hint'},'Cochez au moins un usage pour voir le forfait conseillé.'));
 }
 const FORM={uses:[],people:2,rooms:2,budget:0,commune:''};

 // « Votre forfait est-il toujours le bon ? » : bilan des 7 derniers jours mesurés (forfait-bilan.cjs), dans les deux sens.
 function Bilan({api,lab,plans,onPick,onVerdict}){
  const [b,B]=S(null),[err,X]=S(''),[busy,U]=S(false),alive=R(true);
  const load=(path='/journey/bilan',method,body)=>{U(true);return api(path,method,body).then(r=>{if(alive.current){B(r);X('');onVerdict&&onVerdict(r.verdict);}}).catch(e=>alive.current&&X(e.message||'Le bilan n’a pas pu être calculé.')).finally(()=>alive.current&&U(false));};
  E(()=>{alive.current=true;if(api)load();return()=>{alive.current=false;};},[]);
  if(!api||(!b&&!err))return null;
  const to=b&&b.to&&plans.find(p=>p.id===b.to.id),tone=b?{monter:'up',baisser:'down',ok:'ok',tot:'wait',incident:'wait'}[b.verdict]:'wait';
  return h('section',{className:'pv-bilan is-'+tone,'aria-labelledby':'pv-bilan-title'},
   h('small',{className:'pv-bilan-kicker'},'Votre forfait est-il toujours le bon ?'),
   err?h('p',{role:'alert'},err):h(React.Fragment,null,
    h('h2',{id:'pv-bilan-title'},b.title),h('p',null,b.body),
    b.minutes>=15&&h('dl',{className:'pv-bilan-facts'},[['Observé',b.days>1?b.days+' jours':Math.round(b.minutes/60)>=1?Math.round(b.minutes/60)+' h':b.minutes+' min'],['Au plus fort',String(b.peak).replace('.',',')+' Mb/s'],['Votre ligne',b.capacity+' Mb/s'],['Ligne à fond',b.share+' % du temps']].map(([k,v])=>h('div',{key:k},h('dt',null,k),h('dd',null,v)))),
    to&&h('button',{type:'button',className:'pv-cta'+(b.verdict==='baisser'?' soft':''),onClick:()=>onPick(to)},b.verdict==='baisser'?'Passer à '+to.mbps+' Mb/s et économiser '+F(b.saving)+' par mois':'Passer à '+to.mbps+' Mb/s (+ '+F(b.extra)+' par mois)')),
   lab&&h('div',{className:'pv-bilan-lab'},h('small',null,'Laboratoire : remplir 7 jours d’usage du simulateur'),
    h('div',null,[['soir','Soirées saturées'],['calme','Maison calme']].map(([k,l])=>h('button',{key:k,type:'button',disabled:busy,onClick:()=>load('/journey/bilan/demo','POST',{profile:k})},l)))));
 }

 function View({api,lab,state,user,busy,onUpgrade,onDowngrade,onKeep,onBack}){
  const plans=state.plans||[],current=state.plan||plans[1]||{},next=state.nextPlan,tip=advice(state,plans);
  const [pick,P]=S(null),[verdict,VD]=S(null),[form,FM]=S(FORM),smart=window.FGSmartOffer?FGSmartOffer.recommend({...form,plans}):null,tipId=smart?smart.plan.id:['monter','baisser','ok'].includes(verdict)?null:tip?.plan.id,review=R(null),sel=pick&&pick.id!==current.id?plans.find(p=>p.id===pick.id):null,up=sel&&sel.price>current.price;
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
   window.FGFibrePlus&&h(FGFibrePlus.Section,{api,mbps:current.mbps}),
   h(Bilan,{api,lab,plans,onPick:p=>P(p.id===current.id?null:p),onVerdict:VD}),
   // Le bilan sur 7 jours prime sur le conseil de l'instant, pour ne jamais dire deux choses différentes.
   tip&&!['monter','baisser','ok'].includes(verdict)&&h('section',{className:'pv-tip'},h('span',{className:'j-chat-avatar pv-tip-art','aria-hidden':true},h('i'),h('i'),h('b')),
    h('div',null,h('small',null,'Le conseil de Guardian'),h('p',null,'Chez vous, '+tip.connected+' appareil'+(tip.connected>1?'s':'')+' utilise'+(tip.connected>1?'nt':'')+' '+String(tip.used).replace('.',',')+' Mb/s en ce moment. '+tipText))),
   h(Finder,{plans,current,form,onForm:FM,onPick:p=>P(p)}),
   h('div',{className:'pv-list',role:'radiogroup','aria-label':'Choisir un forfait'},plans.map(p=>{
    const mine=p.id===current.id,chosen=pick?.id===p.id,diff=p.price-current.price,later=next?.plan.id===p.id;
    return h('button',{key:p.id,type:'button',role:'radio','aria-checked':chosen,className:'pv-plan'+(mine?' mine':'')+(chosen?' chosen':''),onClick:()=>P(mine?null:p)},
     h('span',{className:'pv-speed'},h('b',null,p.mbps),h('small',null,'Mb/s')),
     h('span',{className:'pv-info'},h('span',{className:'pv-tags'},mine&&h('em',{className:'pv-tag mine'},'Votre forfait'),tipId===p.id&&!mine&&h('em',{className:'pv-tag tip'},'Conseillé par Guardian'),p.mbps>=300&&h('em',{className:'pv-tag plus'},'Fibre+ inclus'),later&&h('em',{className:'pv-tag later'},'Prévu le '+day(next.at))),h('small',null,USES[p.mbps]||'')),
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
 window.FGPlans={View,Finder,FORM};
})();
