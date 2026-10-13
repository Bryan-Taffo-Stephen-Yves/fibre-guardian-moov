'use strict';
// Copilote déterministe local. Aucun appel LLM ni commande implicite sur une box.
const N=require('./noc-store.cjs'),{paragraph,insist}=require('./pilot-model.cjs');
const SOURCE='Moteur de règles local · LLM non connecté · aucune action exécutée';
const ROLE_LABELS={agent:'Agent support',supervisor:'Responsable technique',admin:'Administrateur',technician:'Technicien terrain',field:'Technicien terrain'};
const sentence=value=>String(value||'').trim().replace(/[.!?…\s]+$/u,'')+'.';
function operatorReply(s,user,d,text){
 const workspace=require('./noc-workspace.cjs').overview(s,user.id);
 const queue=workspace.queue,capabilities=workspace.capabilities||{};
 // La projection du cockpit applique le consentement et le périmètre terrain avant lecture.
 // Aucun accès global N.overview : un technicien ne voit que ses missions autorisées.
 const key=d.workItemKey||(d.incidentId?'incident:'+d.incidentId:null);
 if(key)insist(typeof key==='string'&&key.length<=160,'Référence de dossier invalide.');
 const item=key?queue.find(row=>row.key===key):queue.find(row=>!row.terminal);
 if(key)insist(item,'Dossier inaccessible ou partage retiré.',404);
 const active=queue.filter(row=>!row.terminal),pending=queue.filter(row=>row.kind==='incident'&&row.status==='proposed');
 const facts=[
  {label:'Votre rôle',value:workspace.roleLabel||ROLE_LABELS[workspace.role]||workspace.role},
  {label:'Périmètre',value:workspace.scope==='assigned'?'Vos missions affectées uniquement':'Dossiers autorisés sur cette installation'},
  {label:'Source',value:'Base locale : dossiers consentis et réseau de démonstration, pas de supervision réelle Moov'},
  {label:'Dossiers actifs autorisés',value:String(active.length)},
  {label:'Plans en attente dans votre périmètre',value:String(pending.length)}
 ];
 const link=(page,label)=>({page,label,...(item?{workItemKey:item.key,...(item.kind==='incident'?{incidentId:item.id}:{})}:{})});
 let actions=[link('operations','Ouvrir le cockpit opérationnel')];
 let message='Je coordonne la lecture des dossiers autorisés, pas les commandes réseau. Votre file contient '+active.length+' dossier(s) actif(s). Chaque dossier indique son responsable et la prochaine équipe à intervenir. Aucun ticket non partagé ni appareil privé n’est ajouté à cette file.';
 if(item){
  facts.push({label:'Dossier',value:item.title},{label:'État enregistré',value:item.statusLabel||item.status},{label:'Responsable actuel',value:item.owner?.name||'À prendre en charge'},{label:'Prochain rôle',value:ROLE_LABELS[item.nextRole]||item.nextRole||'À définir par le responsable'},{label:'Prochaine étape',value:item.nextStep||'Examiner le dossier'});
  const actionsAllowed={claim:'Prendre en charge',note:'Ajouter une note interne',notify:'Notifier par gabarit',instruct:'Donner une consigne terrain',check:'Renseigner la checklist',advance:'Déclarer une étape terrain',ticketStatus:'Répondre et faire avancer le dossier support',reportStatus:'Répondre au signalement local'};
  facts.push({label:'Actions disponibles pour votre session',value:Object.entries(actionsAllowed).filter(([key])=>item.allowed?.[key]).map(([,label])=>label).join(' · ')||'Lecture seulement à cette étape'});
  if(item.kind==='ticket'){
   message='Ce ticket a été explicitement partagé avec le support. '+(item.owner?.name?'Responsable : '+sentence(item.owner.name):'Il attend une prise en charge nominative.')+' Prochaine étape : '+sentence(item.nextStep||'Examiner les éléments transmis')+' Les relevés joints sont historiques, pas une surveillance en direct.';
   facts.push({label:'Limite des données',value:'Relevés joints au ticket, pas un accès continu à tout le foyer'});
  }else if(item.status==='closed'){
   message='Ce dossier est clôturé administrativement. Cette clôture ne prouve pas le rétablissement : aucune télémétrie réseau réelle n’a confirmé une réparation. Le support peut réexaminer une demande de réouverture, sans contourner le consentement du client.';
   actions.push(link('incidents','Consulter la clôture administrative'));
  }else{
   const plan=item.plan;
   if(plan){
    facts.push({label:'Cause proposée',value:plan.cause||'À confirmer'},{label:'Procédure de référence',value:plan.runbook||'À préciser'});
    const generated=Number(plan.generatedAt);if(Number.isFinite(generated))facts.push({label:'Mesures ayant servi au plan (pas en direct)',value:new Date(generated).toISOString()});
    if(Array.isArray(plan.evidence))facts.push(...plan.evidence.filter(f=>f.label!=='Fraîcheur').slice(0,8));
   }
   const phase={dispatched:'L’équipe est affectée ; son départ reste à confirmer.',en_route:'L’équipe est en route.',on_site:'L’équipe est sur place.',verifying:'La réparation est déclarée ; le retour du réseau reste à vérifier.',resolved:'Le rétablissement a été vérifié dans le simulateur.'}[item.status]||'';
   message=[phase,plan?.title?'Hypothèse : '+sentence(plan.title):'',
    'Prochaine étape · '+(ROLE_LABELS[item.nextRole]||item.nextRole||'responsable à désigner')+' : '+sentence(item.nextStep||'Examiner les preuves du dossier')].filter(Boolean).join(' ');
   if(item.mode!=='demo')message+=' Il s’agit d’un signalement local : aucune commande de box ni intervention réelle n’est déclenchée ici.';
   else message+=' Les mesures, le trajet et les actions réseau restent simulés.';
   if(capabilities.canApprove&&item.status==='proposed')actions.push(link('approvals','Examiner le plan à valider'));
   else if(item.technician&&capabilities.canInstruct)actions.push(link('missions','Suivre la mission terrain'));
   else if(capabilities.canInstruct)actions.push(link('incidents','Examiner les preuves du dossier'));
  }
 }
 if(/mandat|droit|sécurité|faille|autorisa|habilitation|qui.*(?:approuv|valid)/i.test(text)){
  message='La validation des plans est réservée au responsable ou son mandataire actif. '+(capabilities.canApprove?'Votre session peut actuellement valider un plan, avec motif et confirmation.':'Votre session ne peut pas valider un plan : transmettez-le au responsable habilité.')+' Le copilote ne signe jamais une validation à votre place. Une réponse ne constitue pas un audit de sécurité ni un scan de vulnérabilités.';
  facts.push({label:'Droit de validation actuel',value:capabilities.canApprove?'Autorisé':'Non autorisé'},{label:'Gestion des mandats',value:capabilities.canDelegate?'Administrateur habilité':'Non autorisée pour cette session'});
  if(capabilities.canDelegate)actions.unshift(link('settings','Consulter les mandats'));
 }
 if(workspace.paused)message+=' Les actions opérationnelles sont actuellement suspendues : la lecture reste disponible.';
 return {message,facts,actions,source:SOURCE,requiresApproval:true,executed:false};
}
function reply(s,user,d){
 const text=paragraph(d.text,'Message',1200);
 if(d.portal==='noc')return operatorReply(s,user,d,text);
 insist(d.portal==='client','Portail inconnu.');
 const data=N.client(s,user.id),active=data.incidents.find(N.isOpen);
 if(active){const stages={on_site:'Le technicien est sur place.',en_route:'Le technicien est en route.',verifying:'La réparation est déclarée ; la vérification reste à faire.',dispatched:'Une équipe est affectée.',proposed:'Le plan attend la validation du responsable.'};return {message:(stages[active.status]||'Votre incident est en cours de traitement.')+' Consultez le suivi partagé. '+(active.mode==='demo'?'Attention : il s’agit du réseau de démonstration.':'Ce signalement est traité dans cette installation locale, pas dans le SI Moov.'),facts:[{label:'Dernier événement',value:active.events.at(-1)?.public_text||active.status}],actions:[{page:'tracking',label:'Suivre l’intervention'}]};}
 const closed=data.incidents.find(i=>i.status==='closed');
 if(closed&&/incident|panne|intervention|résolu|rétabli|termin|clôtur/i.test(text))return {message:'Votre dossier a été clôturé administrativement par le support local. Cela ne confirme pas que la connexion est réparée : aucune mesure réseau réelle ne l’a vérifié. Si le problème persiste, contactez le support pour demander sa réouverture.',facts:[{label:'Dossier',value:closed.title},{label:'Rétablissement vérifié',value:'Non'}],actions:[{page:'tracking',label:'Consulter la clôture du dossier'},{page:'reports',label:'Contacter le support local'}]};
 return {message:'Bonjour '+user.name+'. Aucun incident partagé ouvert pour votre compte. Pour analyser votre vrai Wi-Fi, il faut des mesures autorisées dans Tests réels : je ne déduis pas un débit ou une panne sans données. Le laboratoire de démonstration propose séparément les scénarios de débit, appareils et forfait.',facts:[{label:'Source',value:'Compte local · aucune commande réseau exécutée'}],actions:[{page:'real',label:'Ouvrir les tests réels'},{page:'home',label:'Revenir à la démonstration'}]};
}
module.exports={reply};

