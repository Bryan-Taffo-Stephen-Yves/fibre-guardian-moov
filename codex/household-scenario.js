(function(root){
 const h=React.createElement;
 function Scenario({state:s,paused,owner,onAction,onPrepare,onTogglePause}){
  const status=FGHouse.scenarioStatus(s,paused),consoleDevice=s.devices.find(d=>d.id==='console');
  const fmt=v=>v.toLocaleString('fr-FR',{maximumFractionDigits:1});
  return h('section',{className:'panel hh-scenarios'},h('h2',null,'1. Essayez une situation'),
   h('p',null,'Lancez le gros téléchargement et observez les mesures ici. Une alerte apparaît si la console utilise plus de 60 % du débit total pendant 10 secondes simulées, avec au moins 25 Mbps utilisés dans le foyer.'),
   h('div',{className:'hh-actions'},[['normal','Réseau normal'],['heavy','Gros téléchargement'],['slow','Débit réduit à 12 Mbps'],['cut','Coupure Internet']].map(([mode,label])=>h('button',{key:mode,type:'button',className:'hh-button',disabled:!owner,'aria-pressed':s.scenario===mode,onClick:()=>onAction({type:'scenario',mode})},label))),
   h('div',{className:'hs-result','data-stage':status.stage},h('div',{className:'hs-title'},h('strong',null,paused?'Test en pause':s.scenario==='heavy'?'Test · téléchargement de la PlayStation':'Résultat du scénario'),h('span',null,status.elapsed+' s simulées depuis le lancement')),
    h('p',{role:'status','data-testid':'scenario-status'},status.text),
    h('div',{className:'hs-metrics'},[['Débit total',fmt(s.total)+' Mbps'],['PlayStation 5 de Koffi',fmt(consoleDevice.mbps)+' Mbps'],['Part de la console',fmt(status.share)+' %'],['Capacité du foyer',s.capacity+' Mbps']].map(([label,value])=>h('div',{key:label},h('span',null,label),h('strong',null,value)))),
    s.scenario==='heavy'&&h('div',{className:'hs-progress'},h('label',null,'Usage dominant consécutif : '+status.progress+' / 10 s',h('progress',{max:10,value:status.progress,'aria-label':'Progression vers l’alerte'})),h('small',null,'Le graphe de la journée cumule des volumes horaires : son évolution ne reflète pas immédiatement une variation de débit.')),
    h('div',{className:'hh-actions'},paused&&h('button',{type:'button',className:'hh-button',onClick:onTogglePause},'Reprendre ce test'),s.scenario==='heavy'&&h('button',{type:'button',className:'hh-button',disabled:!owner,onClick:onPrepare},'Préparer et relancer le test'),s.scenario==='heavy'&&h('button',{type:'button',className:'hh-button',disabled:!owner||consoleDevice.blocked||!consoleDevice.connected||consoleDevice.limit===10,onClick:()=>onAction({type:'limit',id:'console',mbps:10})},'Limiter la console à 10 Mbps'))),
   h('p',{className:'small muted'},'Le lancement reprend les mesures. Les réglages existants sont conservés ; leur remise à zéro pour la console demande confirmation. Aucun équipement réel modifié.')
  );
 }
 root.FGHouseholdScenario=Scenario;
})(window);
