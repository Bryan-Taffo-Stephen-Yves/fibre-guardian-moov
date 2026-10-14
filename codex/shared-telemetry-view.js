/* One normalized measurement frame for the subscriber-facing screens. */
(function (root) {
  'use strict';
  const h = React.createElement;
  const number = value => Number.isFinite(value) ? value.toLocaleString('fr-FR', {maximumFractionDigits:1}) : '—';
  function Source({frame, source, paused, onSource, onPause, onIncidents}) {
    return h('section', {className:'fg-source', 'aria-label':'Source commune des mesures', 'data-testid':'active-source', 'data-source':source},
      h('div', null, h('span', {className:'eyebrow'}, 'SOURCE COMMUNE · SIMULATION'),
        h('strong', null, source === 'household' ? 'Votre foyer de test' : 'Votre ligne de test'),
        h('p', null, 'Le diagnostic, l’assistant et les incidents lisent ces mêmes relevés. Aucune box réelle connectée.')),
      h('div', {className:'fg-source-controls'}, h('label', null, 'Source des mesures', h('select', {value:source,'aria-label':'Source des mesures',onChange:e=>onSource(e.target.value)},
        h('option',{value:'line'},'Ligne simulée'),h('option',{value:'household'},'Foyer simulé'),h('option',{value:'real',disabled:true},'Réseau réel — connecteur à préparer'))),
        h('div',{className:'fg-source-actions'}, h('button',{type:'button',className:'btn',onClick:onPause},paused?'Reprendre les mesures communes':'Mettre les mesures en pause'),
          h('button',{type:'button',className:'btn',onClick:onIncidents},'Voir les incidents'))),
      h('small',{className:'fg-source-freshness'}, !frame?.available ? 'En attente d’un premier relevé de cette source.' : (paused?'Mesures figées · ':'Dernier relevé · ')+new Date(frame.at).toLocaleTimeString('fr-FR',{timeZone:'UTC'})+' UTC · horloge '+(source==='household'?'virtuelle':'de la simulation')));
  }
  function Summary({frame, onIncidents, onHousehold, paused}) {
    const available = frame?.available, m = available ? frame.metrics : {}, d=frame?.diagnosis;
    return h('section',{className:'panel fg-shared-summary','aria-label':'Diagnostic du foyer partagé','data-testid':'shared-diagnosis'},
      h('span',{className:'eyebrow'},'FOYER SIMULÉ · MÊME SOURCE, MÊMES PREUVES'),
      h('h2',null,available?d.title:'Observation en attente'),
      h('p',null,available?d.explanation:'Reprenez les relevés pour observer le foyer. Aucune valeur n’est remplacée par une mesure de ligne inventée.'),
      h('div',{className:'fg-shared-metrics'}, [['Capacité Internet',m.capacityMbps,'Mbps'],['Trafic du foyer',m.usageMbps,'Mbps'],['Temps de réponse',m.latencyMs,'ms'],['Pertes',m.lossPct,'%'],['Appareils connectés',m.connected,'']].map(([label,value,unit])=>h('div',{key:label},h('span',null,label),h('strong',null,number(value),' ',h('small',null,unit))))),
      h('div',{className:'notice'},'La capacité du lien n’est pas la consommation. Le signal optique et la cause exacte d’une coupure ne sont pas mesurés par ce simulateur de foyer.'),
      paused&&h('p',null,'Les mesures sont en pause : ce diagnostic ne décrit pas une nouvelle observation.'),
      h('div',{className:'fg-source-actions'},h('button',{type:'button',className:'btn primary',onClick:onIncidents},'Résoudre et vérifier'),h('button',{type:'button',className:'btn',onClick:onHousehold},'Examiner les appareils')));
  }
  root.FGSharedTelemetry = {Source,Summary};
})(window);
