/* Paiement Moov Money du changement de forfait, proposé par Guardian.
   Checkout : une page de paiement aux couleurs de Moov Money (compte, montant, numéro, code secret),
   puis Success : la fenêtre « Vous avez pris le forfait Fibre 200 Mbps ».
   Le code secret saisi ne quitte jamais le téléphone : il n'est ni envoyé ni gardé.
   Le montant et le forfait sont contrôlés par le serveur (journey-store.cjs, action upgrade-pay). */
(function(){
 'use strict';
 const h=React.createElement,{useState:S,useEffect:E,useRef:R}=React;
 const fcfa=n=>Number(n||0).toLocaleString('fr-FR')+' FCFA';
 const reduced=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 const wait=ms=>new Promise(r=>setTimeout(r,reduced()?Math.min(ms,300):ms));
 const ref=()=>'MM'+Date.now().toString(36).toUpperCase().slice(-6)+Math.floor(Math.random()*90+10);
 function Icon({d,size=20,width=1.9}){return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:width,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,focusable:false},h('path',{d}));}
 const I={close:'m6 6 12 12M18 6 6 18',lock:'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',check:'m5 12 5 5 9-10',wifi:'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',back:'m15 6-6 6 6 6'};

 // Garde le focus dans la fenêtre et ferme avec Échap.
 function useDialog(onClose,first){E(()=>{const prev=document.activeElement;first.current?.focus();const k=e=>{if(e.key==='Escape')onClose();};addEventListener('keydown',k);return()=>{removeEventListener('keydown',k);prev?.focus?.();};},[]);}

 function Checkout({quote,customer,account,onPay,onDone,onClose}){
  const [step,ST]=S('review'),[pin,P]=S(''),[phone,PH]=S(customer?.phone||''),[error,X]=S(''),first=R(null);
  useDialog(()=>{if(step!=='processing')onClose();},first);
  const plan=quote.to||{},amount=quote.amount||0;
  async function submit(e){
   e.preventDefault();X('');
   if(phone.replace(/\D/g,'').length<8){X('Entrez votre numéro Moov Money.');return;}
   if(!/^\d{4}$/.test(pin)){X('Entrez votre code secret à 4 chiffres.');return;}
   ST('processing');P('');
   try{await Promise.all([onPay(),wait(1800)]);onDone();}catch(err){ST('review');X(err?.message||'Le paiement n’a pas abouti. Réessayez.');}
  }
  return h('div',{className:'mm-overlay',role:'dialog','aria-modal':'true','aria-labelledby':'mm-title'},
   h('section',{className:'mm-sheet'},
    h('header',{className:'mm-head'},
     h('span',{className:'mm-logo','aria-hidden':true},h('b',null,'M'),'oov ',h('i',null,'Money')),
     h('span',{className:'mm-secure'},h(Icon,{d:I.lock,size:14}),'Paiement sécurisé'),
     h('button',{type:'button',className:'mm-close',ref:first,onClick:onClose,disabled:step==='processing','aria-label':'Fermer le paiement'},h(Icon,{d:I.close,size:18}))),
    step==='processing'?h('div',{className:'mm-processing',role:'status','aria-live':'polite'},h('span',{className:'mm-spinner','aria-hidden':true}),h('strong',null,'Validation de votre paiement…'),h('p',null,'Ne fermez pas cette page.')):
    h('form',{className:'mm-body',onSubmit:submit},
     h('div',{className:'mm-merchant'},h('span',{className:'mm-merchant-ico','aria-hidden':true},h(Icon,{d:I.wifi,size:22})),h('div',null,h('small',null,'Payer à'),h('strong',null,'Moov Africa · Fibre'))),
     h('h2',{id:'mm-title',className:'mm-amount'},fcfa(amount)),
     h('p',{className:'mm-what'},'Passage au forfait Fibre '+plan.mbps+' Mbps'),
     h('dl',{className:'mm-recap'},
      h('div',null,h('dt',null,'Compte fibre'),h('dd',null,account)),
      h('div',null,h('dt',null,'Titulaire'),h('dd',null,customer?.name||'')),
      h('div',null,h('dt',null,'Nouveau forfait'),h('dd',null,plan.mbps+' Mbps · '+fcfa(plan.price)+'/mois')),
      h('div',null,h('dt',null,'Frais'),h('dd',null,'0 FCFA'))),
     h('label',{className:'mm-field'},h('span',null,'Numéro Moov Money'),h('input',{type:'tel',inputMode:'tel',autoComplete:'tel',value:phone,onChange:e=>PH(e.target.value),placeholder:'07 00 00 00 00',required:true})),
     h('label',{className:'mm-field'},h('span',null,'Code secret'),h('input',{className:'mm-pin',type:'password',inputMode:'numeric',autoComplete:'off',maxLength:4,pattern:'[0-9]{4}',value:pin,onChange:e=>P(e.target.value.replace(/\D/g,'').slice(0,4)),placeholder:'••••','aria-describedby':'mm-pin-help'}),h('small',{id:'mm-pin-help'},'4 chiffres. Votre code reste sur ce téléphone.')),
     error&&h('p',{className:'mm-error',role:'alert'},error),
     h('button',{className:'mm-pay',type:'submit'},'Payer '+fcfa(amount)),
     h('button',{type:'button',className:'mm-cancel',onClick:onClose},h(Icon,{d:I.back,size:16}),'Retour à Guardian'))));
 }

 function Success({plan,amount,account,onClose,onDiscover}){
  const first=R(null),[code]=S(ref),when=new Date().toLocaleString('fr-FR',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
  useDialog(onClose,first);
  return h('div',{className:'mm-overlay mm-overlay--center',role:'dialog','aria-modal':'true','aria-labelledby':'mm-ok-title'},
   h('section',{className:'mm-success'},
    h('span',{className:'mm-burst','aria-hidden':true},Array.from({length:12},(_,k)=>h('i',{key:k,style:{'--k':k}}))),
    h('span',{className:'mm-check','aria-hidden':true},h(Icon,{d:I.check,size:40,width:2.6})),
    h('small',{className:'mm-ok-kicker'},'Paiement réussi'),
    h('h2',{id:'mm-ok-title'},'Vous avez pris le forfait Fibre '+plan.mbps+' Mbps'),
    h('p',null,'Votre nouveau débit est déjà actif. Profitez-en !'),
    h('dl',{className:'mm-recap'},
     h('div',null,h('dt',null,'Débit'),h('dd',null,plan.mbps+' Mbps')),
     h('div',null,h('dt',null,'Prix mensuel'),h('dd',null,fcfa(plan.price))),
     h('div',null,h('dt',null,'Montant payé'),h('dd',null,fcfa(amount))),
     h('div',null,h('dt',null,'Compte fibre'),h('dd',null,account)),
     h('div',null,h('dt',null,'Référence'),h('dd',null,code)),
     h('div',null,h('dt',null,'Date'),h('dd',null,when))),
    h('button',{type:'button',className:'mm-pay',ref:first,onClick:onDiscover},'Voir ma connexion'),
    h('button',{type:'button',className:'mm-cancel',onClick:onClose},'Continuer avec Guardian')));
 }
 window.FGPay={Checkout,Success};
})();
