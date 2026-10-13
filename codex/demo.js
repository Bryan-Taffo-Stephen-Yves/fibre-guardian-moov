/* Badge « Démo » et page « À propos de la démo », communs à l'espace client et à l'espace Moov.
   C'est le seul endroit de l'interface qui dit honnêtement ce qui est simulé. */
(function(){
 'use strict';
 const h=React.createElement,{useEffect:E,useRef:R}=React;
 const SIMULATED=[
  ['Box et mesures','Les débits, les appareils connectés et les pannes viennent d’un simulateur. Aucune box réelle n’est lue ni modifiée.'],
  ['SMS','Le code de connexion s’affiche à l’écran au lieu d’être envoyé par SMS. Les notifications restent dans l’application.'],
  ['GPS et trajets','La carte est un plan schématique. Les véhicules et les heures d’arrivée sont calculés, pas suivis par GPS.'],
  ['Paiement','Le paiement Moov Money est simulé. Aucun argent n’est débité.'],
  ['Systèmes Moov','L’application n’est pas reliée au système d’information de Moov (ACS, facturation, supervision réelle).'],
  ['Guardian','L’assistant suit des règles écrites à l’avance. Il ne fait rien sans l’accord d’une personne.']
 ];
 function Badge({onClick}){return h('button',{type:'button',className:'fg-demo-badge',onClick,'aria-haspopup':'dialog',title:'À propos de la démo'},'Démo');}
 function About({onClose,scenarios,scenario,onScenario,busy,children}){
  const box=R(null);
  E(()=>{const previous=document.activeElement;box.current?.querySelector('button')?.focus();const key=e=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus?.();};},[]);
  return h('div',{className:'fg-demo-layer',onClick:e=>{if(e.target===e.currentTarget)onClose();}},
   h('section',{ref:box,className:'fg-demo-sheet',role:'dialog','aria-modal':'true','aria-labelledby':'fg-demo-title'},
    h('header',null,h('span',{className:'fg-demo-badge is-static'},'Démo'),h('h2',{id:'fg-demo-title'},'À propos de la démo'),h('button',{type:'button',className:'fg-demo-close',onClick:onClose,'aria-label':'Fermer'},'×')),
    h('p',{className:'fg-demo-lead'},'Fibre Guardian est présenté ici en version de démonstration. Les parcours et les règles de sécurité sont réels ; voici ce qui est simulé.'),
    h('ul',{className:'fg-demo-list'},SIMULATED.map(([title,text])=>h('li',{key:title},h('strong',null,title),h('span',null,text)))),
    scenarios&&h('div',{className:'fg-demo-block'},h('h3',null,'Choisir une situation à montrer'),h('p',null,'Changez la situation de la box pour présenter un cas.'),
     h('div',{className:'fg-demo-choices'},Object.entries(scenarios).map(([value,label])=>h('button',{type:'button',key:value,className:'fg-demo-choice'+(scenario===value?' is-active':''),'aria-pressed':scenario===value,disabled:busy,onClick:()=>onScenario(value)},label)))),
    children));
 }
 window.FGDemo={Badge,About,SIMULATED};
})();
