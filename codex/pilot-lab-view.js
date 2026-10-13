(function () {
  'use strict';
  const h = React.createElement;
  const paths = {
    link: ['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2', 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'],
    phone: ['M7 2h10v20H7z', 'M10 18h4'],
    pulse: ['M2 12h4l3-8 5 16 3-8h5'],
    shield: ['M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z', 'm8 12 3 3 5-6'],
    arrow: ['M4 12h16', 'm14 6 6 6-6 6']
  };
  function Icon({name}) {return h('svg',{viewBox:'0 0 24 24',width:22,height:22,fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},(paths[name]||paths.pulse).map((d,i)=>h('path',{d,key:i})));}
  function Head({number,title,description}) {return h('div',{className:'lab-section-head'},h('span',{className:'lab-step'},number),h('div',null,h('h3',null,title),description&&h('p',null,description)));}
  const time=v=>new Date(v).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  const value=v=>v==null?'—':Number(v).toLocaleString('fr-FR',{maximumFractionDigits:1});
  function View({data,owner,busy,createForm,shareUrl,onShare,onCopy,onClose,onAction,onHistory}) {
    const active=l=>!l.closed&&l.expires>Date.now();
    const authorized=p=>!p.revoked&&data.labs.some(l=>l.id===p.lab&&active(l));
    return h('section',{className:'lab-page','aria-label':'Atelier de tests réels'},
      h('header',{className:'lab-hero'},h('div',null,h('span',{className:'lab-eyebrow'},'VOTRE ATELIER WI-FI'),h('h1',null,'Un test. Des mesures.',h('br'),'Une réponse plus claire.'),h('p',null,'Invitez vos appareils, mesurez leur connexion au serveur Guardian, puis comparez avant et après un incident de test.')),h('div',{className:'lab-hero-art','aria-hidden':true},h('span',{className:'lab-orbit'},h(Icon,{name:'pulse'})),h('span',{className:'lab-art-label'},'OBSERVER → COMPARER'))),
      h('div',{className:'lab-stats'},[[data.labs.filter(active).length,'sessions ouvertes'],[data.participants.filter(authorized).length,'participants autorisés'],[data.samples.length,'relevés récents']].map(([n,label])=>h('div',{key:label},h('strong',null,n),h('span',null,label)))),
      h('div',{className:'lab-setup-grid'},
        h('section',{className:'lab-card'},h(Head,{number:'01',title:'Inviter vos appareils',description:'Créez une session, puis partagez son lien.'}),createForm,
          shareUrl&&h('div',{className:'lab-share'},h('span',{className:'lab-eyebrow'},'VOTRE LIEN EST PRÊT'),h('p',null,'Ouvrez-le sur chaque appareil qui doit participer.'),h('div',{className:'lab-actions'},h('a',{className:'btn primary',href:shareUrl,target:'_blank',rel:'noopener'},h(Icon,{name:'arrow'}),'Ouvrir le parcours participant'),h('button',{className:'btn',onClick:onCopy},'Copier le lien participant')),h('details',null,h('summary',null,'Afficher le lien d’invitation'),h('code',null,shareUrl))),
          h('div',{className:'lab-sessions'},data.labs.map(l=>h('div',{className:'lab-session',key:l.id},h('span',{className:'lab-icon'},h(Icon,{name:'link'})),h('div',{className:'lab-session-copy'},h('strong',null,l.name),h('small',null,l.closed?'Session fermée':l.expires<Date.now()?'Lien expiré':'Lien valable jusqu’à '+time(l.expires))),h('div',{className:'lab-actions'},active(l)&&h('button',{className:'btn lab-secondary',disabled:busy||!owner,onClick:()=>onShare(l)},'Partager '+l.name),h('button',{className:'btn lab-text',disabled:busy||!owner||!!l.closed,onClick:()=>onClose(l)},'Fermer '+l.name)))))),
        h('aside',{className:'lab-card lab-guide'},h('span',{className:'lab-icon'},h(Icon,{name:'shield'})),h('h3',null,'Un cadre de test clair'),h('ul',null,h('li',null,h('strong',null,'2 Mio par mesure'),h('span',null,'Chaque participant donne son accord avant de rejoindre.')),h('li',null,h('strong',null,'Un lien · deux heures'),h('span',null,'Jusqu’à 30 participants. Chacun peut arrêter ou quitter.')),h('li',null,h('strong',null,'Aucune commande de box'),h('span',null,'Les incidents touchent le point de test, pas les autres applications.'))),h('details',null,h('summary',null,'Tester depuis un téléphone'),h('p',null,'Il faut une adresse réseau HTTPS accessible et un certificat de confiance. 127.0.0.1 désigne l’appareil qui ouvre le lien, pas votre ordinateur.')))),
      h('section',{className:'lab-observe'},h('div',{className:'lab-observe-head'},h(Head,{number:'02',title:'Observer et expérimenter',description:'Lancez une mesure sur l’appareil, injectez un incident, puis mesurez à nouveau.'}),h('button',{className:'btn lab-secondary',onClick:onHistory},'Voir l’historique',h(Icon,{name:'arrow'}))),
        !data.participants.length?h('div',{className:'lab-empty'},h('span',{className:'lab-empty-icon'},h(Icon,{name:'phone'})),h('h3',null,'Vos appareils apparaîtront ici'),h('p',null,'Partagez le lien de la session. Après son inscription, chaque participant aura sa carte et ses résultats.')):
        h('div',{className:'lab-devices'},data.participants.map(p=>{
          const enabled=authorized(p),fault=enabled&&p.fault_until>Date.now()?p.fault:'none',sample=data.samples.find(s=>s.participant===p.id);
          const status=p.revoked?'Accès révoqué':!enabled?'Session terminée':fault==='none'?'Aucune injection':{slow:'Transfert ralenti',latency:'Latence ajoutée',timeout:'Point de test interrompu'}[fault];
          return h('article',{className:'lab-device pilot-device',key:p.id},h('div',{className:'lab-device-head'},h('span',{className:'lab-icon'},h(Icon,{name:'phone'})),h('div',null,h('h3',null,p.name),h('span',{className:'lab-status'+(fault!=='none'?' lab-status-warn':'')},status))),
            h('div',{className:'lab-device-metrics'},h('div',null,h('span',null,'Débit du test'),h('strong',null,value(sample?.metrics.downloadMbps),h('small',null,' Mbps'))),h('div',null,h('span',null,'Temps de réponse'),h('strong',null,value(sample?.metrics.latencyMs),h('small',null,' ms')))),
            h('p',{className:'lab-last-reading'},sample?'Dernier relevé : '+time(sample.at)+' · '+sample.diagnosis.title:'En attente de la première mesure. Cliquez sur « Mesurer maintenant » sur l’appareil.'),
            h('fieldset',{className:'lab-injections',disabled:busy||!owner||!enabled},h('legend',null,'Injecter un incident · 60 s maximum'),h('div',{className:'lab-faults'},[['slow','Ralentir le test'],['latency','Ajouter une latence'],['timeout','Interrompre le point de test']].map(([a,label])=>h('button',{key:a,type:'button','aria-pressed':fault===a,onClick:()=>onAction(p,a)},label))),h('small',null,fault!=='none'?'Injection active jusqu’à '+time(p.fault_until)+'. Relancez une mesure sur l’appareil.':'Seules les requêtes de ce test seront modifiées.')),
            h('div',{className:'lab-actions lab-device-footer'},h('button',{className:'btn lab-restore',disabled:busy||!owner||!enabled,onClick:()=>onAction(p,'none')},'Rétablir le test'),h('button',{className:'btn lab-text lab-danger',disabled:busy||!owner||!enabled,onClick:()=>onAction(p,'revoke')},'Révoquer le participant')));
        }))),
      h('aside',{className:'lab-boundary'},h(Icon,{name:'shield'}),h('p',null,h('strong',null,'Ce que vous mesurez vraiment. '),'Le trajet entre votre appareil et ce serveur. Ce test ne certifie ni le débit Internet de votre abonnement, ni la qualité radio de toute la maison.')));
  }
  window.FGPilotLab=View;
})();
