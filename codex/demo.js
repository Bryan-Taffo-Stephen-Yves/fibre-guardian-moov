/* Badge « Démo » et page « À propos de la démo », communs à l'espace client et à l'espace Moov.
   C'est le seul endroit de l'interface qui dit honnêtement ce qui est simulé. */
(function(){
 'use strict';
 const h=React.createElement,{useEffect:E,useRef:R,useState:S}=React;
 const SIMULATED=[
  ['Box et mesures','Les débits, les appareils connectés et les pannes viennent d’un simulateur. Aucune box réelle n’est lue ni modifiée.'],
  ['SMS','Le code de connexion s’affiche à l’écran au lieu d’être envoyé par SMS. Les notifications restent dans l’application.'],
  ['GPS et trajets','La carte d’Abidjan est dessinée à partir de la vraie géographie, mais simplifiée. Les véhicules et les heures d’arrivée sont calculés, pas suivis par GPS.'],['Panne prévue','La baisse de lumière de la fibre est simulée sur 10 jours (situation « La fibre faiblit »). La prévision de coupure et les créneaux du technicien sont calculés à partir de ces mesures.'],['Appel du technicien','Le bouton « Appeler » ouvre un écran d’appel dans l’application. Aucun appel téléphonique n’est passé et les numéros des techniciens sont réservés à la démonstration.'],['Messages au technicien et carte du trajet','Les réponses du technicien dans « Message » sont écrites d’avance et restent sur le téléphone. Le quartier de la carte de suivi est dessiné (ce n’est pas un vrai plan) et le lien « Partager » reste valable 6 heures.'],
  ['Impact pour Moov','Les valeurs de départ de l’écran Impact sont des estimations. Les parts d’appels, de déplacements et de clients évités restent à mesurer lors d’un essai réel.'],
  ['Code *144# (sans internet)','Le menu *144# s’affiche sur un téléphone dessiné dans l’application, et ses SMS aussi. Un vrai code court demande un accord entre Moov et l’ARTCI : *144# est un exemple. Le serveur répond déjà comme une passerelle USSD d’opérateur, et le signalement arrive pour de vrai au centre d’opérations.'],
  ['WhatsApp et mail','Les messages WhatsApp du simulateur s’affichent dans l’application. Si le bac à sable WhatsApp de Twilio (ou le numéro de test de Meta) est branché, ils partent aussi vers les téléphones inscrits pour la démonstration, et seulement ceux de la commune touchée pour les clients. Les mails à l’équipe s’affichent dans l’application et ne sont pas envoyés.'],
  ['Agents de Guardian','Les quatre agents prennent volontairement une douzaine de secondes pour montrer leur travail. Leurs conclusions viennent de règles testées ; ils n’envoient jamais un technicien sans l’accord d’une personne de Moov.'],
  ['Capteurs d’armoire','Le capteur d’eau des armoires, l’alarme d’ouverture des boîtiers et l’avis de chantier sont imaginés pour la démo. Guardian saurait s’en servir si Moov les installe.'],
  ['Labo réseau','Les mesures du Labo (centrales OLT, box ONT, réflectomètre, console d’alarmes) sont calculées à partir des pannes du simulateur, avec les valeurs habituelles d’un réseau fibre GPON classe C+. Elles ne viennent pas des équipements de Moov. Les seuils réglés et le redémarrage d’une box ne changent que l’écran du Labo.'],
  ['Paiement','Le paiement Moov Money est simulé. Aucun argent n’est débité.'],
  ['Systèmes Moov','L’application n’est pas reliée au système d’information de Moov (ACS, facturation, supervision réelle).'],
  ['Guardian','L’assistant suit des règles écrites à l’avance. Il ne fait rien sans l’accord d’une personne.']
 ];
 // Quand la clé Anthropic est configurée sur le serveur, Guardian rédige ses réponses avec Claude.
 const GUARDIAN_CLAUDE='Les réponses sont rédigées par Claude, l’IA d’Anthropic, à partir des seules mesures de la box. Ce que Guardian vérifie et propose reste décidé par des règles écrites à l’avance, et il ne fait rien sans l’accord d’une personne.';
 function Badge({onClick}){return h('button',{type:'button',className:'fg-demo-badge',onClick,'aria-haspopup':'dialog',title:'À propos de la démo'},'Démo');}
 // Remise à zéro de la démo : le bouton n'apparaît que pour l'administrateur, et le serveur revérifie le rôle.
 function Reset({user}){
  const [step,setStep]=S('idle'),[error,setError]=S('');
  async function run(){setStep('busy');setError('');try{const r=await fetch('/api/demo/reset',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':user.csrf},body:JSON.stringify({confirm:true})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'La réinitialisation n’a pas abouti.');location.reload();}catch(e){setError(e.message);setStep('confirm');}}
  return h('div',{className:'fg-demo-block'},h('h3',null,'Réinitialiser la démo'),
   h('p',null,step==='idle'?'Remet la démo dans son état de départ : comptes, incidents et notifications. Tout le monde sera déconnecté.':'Confirmez : toutes les données de la démo seront remplacées.'),
   error&&h('p',{role:'alert',className:'fg-demo-error'},error),
   step==='idle'?h('button',{type:'button',className:'fg-demo-danger',onClick:()=>setStep('confirm')},'Réinitialiser la démo'):
   h('div',{className:'fg-demo-choices'},h('button',{type:'button',className:'fg-demo-danger',disabled:step==='busy',onClick:run},step==='busy'?'Réinitialisation…':'Oui, tout remettre à zéro'),h('button',{type:'button',className:'fg-demo-choice',disabled:step==='busy',onClick:()=>setStep('idle')},'Annuler')));
 }
 function About({onClose,user,scenarios,scenario,onScenario,busy,children}){
  const box=R(null),[assistant,setAssistant]=S('regles');
  E(()=>{let live=true;fetch('/api/health',{credentials:'same-origin'}).then(r=>r.json()).then(d=>{if(live&&d.assistant)setAssistant(d.assistant);}).catch(()=>{});return()=>{live=false;};},[]);
  const items=SIMULATED.map(([title,text])=>[title,title==='Guardian'&&assistant==='claude'?GUARDIAN_CLAUDE:text]);
  E(()=>{const previous=document.activeElement;box.current?.querySelector('button')?.focus();const key=e=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus?.();};},[]);
  return h('div',{className:'fg-demo-layer',onClick:e=>{if(e.target===e.currentTarget)onClose();}},
   h('section',{ref:box,className:'fg-demo-sheet',role:'dialog','aria-modal':'true','aria-labelledby':'fg-demo-title'},
    h('header',null,h('span',{className:'fg-demo-badge is-static'},'Démo'),h('h2',{id:'fg-demo-title'},'À propos de la démo'),h('button',{type:'button',className:'fg-demo-close',onClick:onClose,'aria-label':'Fermer'},'×')),
    h('p',{className:'fg-demo-lead'},'Fibre Guardian est présenté ici en version de démonstration. Les parcours et les règles de sécurité sont réels ; voici ce qui est simulé.'),
    h('ul',{className:'fg-demo-list'},items.map(([title,text])=>h('li',{key:title},h('strong',null,title),h('span',null,text)))),
    scenarios&&h('div',{className:'fg-demo-block'},h('h3',null,'Choisir une situation à montrer'),h('p',null,'Changez la situation de la box pour présenter un cas.'),
     h('div',{className:'fg-demo-choices'},Object.entries(scenarios).map(([value,label])=>h('button',{type:'button',key:value,className:'fg-demo-choice'+(scenario===value?' is-active':''),'aria-pressed':scenario===value,disabled:busy,onClick:()=>onScenario(value)},label)))),
    children,
    user?.role==='admin'&&h(Reset,{user})));
 }
 window.FGDemo={Badge,About,SIMULATED};
})();
