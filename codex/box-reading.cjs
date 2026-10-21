'use strict';
// « La photo qui parle » : ce que montrent les voyants de la box, croisé avec les mesures de la box
// et l'état du quartier. La lecture vient de Claude (guardian-ai.readLeds) ou, sans connexion à Claude,
// de la lecture faite sur le téléphone (src/vision.js). La conclusion est toujours décidée ici, par des règles.
const NAMES={power:'Alimentation (Power)',pon:'Fibre (PON)',los:'Perte de fibre (LOS)',internet:'Internet',wifi:'Wi-Fi',lan:'Câble réseau (LAN)',phone:'Téléphone',wps:'WPS',autre:'Autre voyant'};
const STATES={allume:'allumé',eteint:'éteint',clignote:'clignote',inconnu:'illisible'};
const VISUALS=['rupture','wifi','normal'];

// Lecture faite par le téléphone : seule une synthèse est acceptée, jamais l'image.
function localReading(v){
 if(!v||typeof v!=='object')return null;
 if(v.ok!==true)return {source:'telephone',ok:false,reason:typeof v.reason==='string'?v.reason.slice(0,200):'Photo illisible.'};
 if(!VISUALS.includes(v.visual))return null;
 return {source:'telephone',ok:true,visual:v.visual,summary:typeof v.reading==='string'?v.reading.slice(0,200):''};
}

function interpret(reading,snap){
 const shared=snap.sharedIncident&&!snap.sharedIncident.terminal?snap.sharedIncident:null;
 const measuredDown=snap.metrics?.state==='panne'||!!shared;
 const facts=[];
 const say=(message,{verdict=null,action=null,concord=true}={})=>({message,facts,verdict,action,concord});
 const context=()=>{facts.push({label:'Mesures de la box',value:measuredDown?'Pas de signal Internet':snap.metrics.state==='redémarrage'?'Redémarrage en cours':snap.metrics.capacity+' Mbps disponibles'},{label:'Votre quartier',value:shared?'Coupure en cours ('+(shared.zone||shared.segment)+')':'Aucune coupure signalée'});};

 if(reading.source==='claude'){
  facts.push({label:'Lecture des voyants',value:'Faite par Guardian sur votre photo'});
  if(reading.model)facts.push({label:'Modèle reconnu',value:reading.model});
  if(!reading.isBox)return say('Je ne reconnais pas une box sur cette photo. Photographiez la face avant de la box, avec ses petits voyants bien visibles, à environ 30 cm.');
  const lit=reading.leds.filter(l=>l.state!=='inconnu');
  if(!lit.length||(['floue','sombre'].includes(reading.quality)&&lit.length<2))return say(reading.quality==='sombre'?'La photo est trop sombre pour lire les voyants. Allumez la lumière et reprenez-la de face, sans flash.':'Je n’arrive pas à lire les voyants. Tenez le téléphone immobile, de face, à environ 30 cm de la box, puis reprenez la photo.');
  for(const l of reading.leds)facts.push({label:'Voyant '+(NAMES[l.name]||NAMES.autre),value:STATES[l.state]+(l.state!=='eteint'&&!['aucune','inconnue'].includes(l.color)?', '+l.color:'')});
  context();
  const led=name=>reading.leds.find(l=>l.name===name),on=l=>l&&['allume','clignote'].includes(l.state),off=l=>l&&l.state==='eteint';
  if(off(led('power'))||reading.leds.length&&reading.leds.every(l=>l.state==='eteint'))return say('Votre box semble éteinte : aucun voyant n’est allumé. Vérifiez qu’elle est bien branchée sur la prise et que son bouton marche est enfoncé. Rien ne peut fonctionner sans courant.',{verdict:'anomalie'});
  const fiberLost=on(led('los'))||off(led('pon'))||led('pon')?.state==='clignote';
  return conclude({fiberLost,wifiOff:off(led('wifi')),internetOff:off(led('internet'))&&on(led('pon')),shared,measuredDown,snap,say});
 }
 facts.push({label:'Lecture des voyants',value:'Faite sur votre téléphone'});
 if(!reading.ok)return say(reading.reason+' Je n’ai rien conclu à partir de cette photo.');
 if(reading.summary)facts.push({label:'Ce que montre la photo',value:reading.summary.replace(/^Les voyants montrent /,'').replace(/\.$/,'')});
 context();
 return conclude({fiberLost:reading.visual==='rupture',wifiAlert:reading.visual==='wifi',shared,measuredDown,snap,say});
}

function conclude({fiberLost,wifiOff,wifiAlert,internetOff,shared,measuredDown,snap,say}){
 if(fiberLost&&shared)return say('Le voyant de la fibre le confirme : la fibre n’arrive plus jusqu’à votre box, à cause de la coupure dans votre quartier. Votre box n’est pas en cause, inutile de la débrancher. Moov s’en occupe déjà et je vous préviens à chaque étape.',{verdict:'rupture',action:'tracking'});
 if(fiberLost&&measuredDown)return say('La fibre n’arrive plus jusqu’à votre box, alors que votre quartier n’a pas de coupure. Le souci est sans doute chez vous : vérifiez que le petit câble fibre, au connecteur vert, est bien enfoncé et n’est pas plié. Ne regardez jamais le bout de ce câble. Si rien ne change, signalez la panne.',{verdict:'rupture'});
 if(fiberLost)return say('Sur la photo, le voyant de la fibre signale une perte de signal, mais vos mesures montrent que la fibre arrive bien. La photo a peut-être été prise pendant un redémarrage : reprenez-la dans une minute.',{verdict:'anomalie',concord:false});
 if(measuredDown&&shared)return say('Vos voyants fibre paraissent normaux alors qu’une coupure touche votre quartier : votre ligne n’est peut-être pas concernée. Si Internet ne marche pas chez vous, dites-le-moi et je l’ajoute au dossier de l’intervention.',{verdict:'anomalie',action:'tracking',concord:false});
 if(wifiOff)return say('Le voyant Wi-Fi est éteint : le Wi-Fi de votre box est coupé, la fibre, elle, arrive bien. Appuyez une fois sur le bouton Wi-Fi ou WLAN de la box ; le voyant doit se rallumer en quelques secondes.',{verdict:'wifi'});
 if(wifiAlert)return say('Un voyant orange signale une alerte du côté du Wi-Fi, alors que la fibre arrive bien. Rapprochez-vous de la box ou redémarrez son Wi-Fi avec le bouton WLAN.',{verdict:'wifi'});
 if(internetOff)return say('La fibre arrive bien jusqu’à votre box, mais la connexion à Internet ne s’établit pas. Un redémarrage de la box règle souvent ce souci.',{verdict:'anomalie',action:'reboot'});
 if(snap.scenario==='slow')return say('Vos voyants sont normaux : la fibre arrive bien jusqu’à votre box, le câble n’est donc pas en cause. Le ralentissement vient de la box elle-même : la redémarrer à distance règle souvent ce souci.',{verdict:'anomalie',action:'reboot'});
 return say('Tous vos voyants sont normaux, et vos mesures aussi : la fibre arrive bien et votre box fonctionne. Si un appareil est lent, rapprochez-le de la box.',{verdict:'sain'});
}

module.exports={interpret,localReading,NAMES};
