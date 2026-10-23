/* Chaîne du dossier (recommandation de Codex, 2026-10-23) : de la suggestion de Guardian au résultat mesuré,
   chaque étape du MÊME dossier avec son auteur, son heure et son état. Lecture seule : les décisions restent
   dans les formulaires du dossier, vérifiées par le serveur. */
(function(){
 'use strict';
 const h=React.createElement;
 const time=at=>new Date(at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
 const detail=e=>{try{return JSON.parse(e.detail||'{}');}catch(_){return {};}};
 const last=(events,kinds)=>events.filter(e=>kinds.includes(e.kind)).at(-1)||null;
 const firstOf=(events,kinds)=>events.find(e=>kinds.includes(e.kind))||null;
 const who=e=>e?.actor_name||'Guardian';
 function steps(i,technicians=[]){
  const ev=i.events||[],plan=i.plan||{},tech=technicians.find(t=>t.id===i.technician)?.name||null;
  const proposed=firstOf(ev,['plan.proposed']),revised=ev.filter(e=>e.kind==='plan.proposed').length>1?last(ev,['plan.proposed']):null,signal=last(ev,['superviseur.signal']),decision=last(ev,['plan.approved','plan.rejected','plan.complement']);
  const dispatched=last(ev,['dispatched']),moving=last(ev,['en_route','on_site']),repaired=last(ev,['verifying']),done=last(ev,['resolved']),closed=last(ev,['closed']);
  const decided=decision&&['approved','dispatched','en_route','on_site','verifying','resolved'].includes(i.status);
  const out=[];
  out.push({key:'suggestion',title:'Suggestion de Guardian',state:proposed?'done':'current',
   meta:proposed?'Guardian · '+time(proposed.at):'Analyse en cours',
   text:proposed?(plan.title||'Plan d’intervention')+(signal?' · transmis en priorité par '+who(signal)+' à '+time(signal.at):'')+(revised?' · plan revu à '+time(revised.at):''):'Guardian rapproche les mesures et prépare un plan.'});
  const d=decision?detail(decision):{};
  out.push({key:'decision',title:'Décision du responsable',
   state:!decision||i.status==='proposed'?(proposed?'current':'todo'):decision.kind==='plan.approved'?'done':'warn',
   meta:decision&&i.status!=='proposed'?who(decision)+' · '+time(decision.at):'En attente d’un responsable',
   text:!decision||i.status==='proposed'?'Accepter, refuser ou demander un complément.':decision.kind==='plan.approved'?'Plan accepté'+(d.note?' : « '+d.note+' »':'.'):decision.kind==='plan.complement'?'Complément demandé'+(d.note?' : « '+d.note+' »':'.'):'Plan refusé'+(d.note?' : « '+d.note+' »':'.')});
  if(plan.dispatch===false){
   out.push({key:'mission',title:'Mission',state:decided?'done':'todo',meta:'Sans déplacement',text:'Ce plan n’envoie pas d’équipe sur place.'});
  }else{
   out.push({key:'mission',title:'Mission affectée',state:dispatched?'done':decided?'current':'todo',
    meta:dispatched?who(dispatched)+' · '+time(dispatched.at):'À affecter',
    text:dispatched?(tech||'Équipe')+' reçoit la mission dans son application.':plan.team?.name?'Guardian propose '+plan.team.name+' : '+plan.team.why:'Le responsable choisit l’équipe.'});
   out.push({key:'action',title:'Action sur le terrain',state:repaired?'done':dispatched?'current':'todo',
    meta:repaired?who(repaired)+' · '+time(repaired.at):moving?(moving.kind==='on_site'?'Sur place':'En route')+' · '+time(moving.at):'—',
    text:repaired?'Réparation déclarée. Le dossier attend la preuve des mesures.':moving?'Intervention en cours.':'Le technicien déclare la réparation depuis son application.'});
  }
  const r=done?detail(done):{};
  out.push({key:'resultat',title:'Résultat mesuré',state:done?'done':closed?'done':repaired||(decided&&plan.dispatch===false)?'current':'todo',
   meta:done?who(done)+' · '+time(done.at):closed?'Clos · '+time(closed.at):'—',
   text:done?(r.online!=null?r.online+' box sur '+r.total+' en ligne, mesurées après la réparation.':'Retour du réseau vérifié sur les mesures.'):closed?closed.public_text:'Le dossier ne se ferme que sur des mesures revenues à la normale.'});
  return out;
 }
 function Chain({incident,technicians}){
  if(!incident||incident.mode!=='demo')return null;
  const list=steps(incident,technicians||[]);
  return h('section',{className:'dc-chain','aria-label':'Chaîne du dossier'},
   h('div',{className:'dc-head'},h('strong',null,'Dossier n° '+(incident.ref||'—')),h('small',null,'Même numéro pour le client, le technicien, le *144# et les SMS')),
   h('ol',null,list.map((s,n)=>h('li',{key:s.key,'data-state':s.state},h('span',{className:'dc-dot','aria-hidden':true},s.state==='done'?'✓':s.state==='warn'?'!':String(n+1)),h('div',null,h('div',{className:'dc-row'},h('b',null,s.title),h('small',null,s.meta)),h('p',null,s.text))))));
 }
 window.FGDossierChain={Chain,steps};
})();
