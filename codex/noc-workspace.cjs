'use strict';
// Coordination interne uniquement : les données clientes restent dans leurs tables sources.
const {id,insist,paragraph,word}=require('./pilot-model.cjs');
const O=require('./operator-store.cjs'),N=require('./noc-store.cjs');
const ROLE_LABELS={admin:'Directeur technique',supervisor:'Responsable de supervision',agent:'Conseiller support',technician:'Technicien terrain'};
const HIERARCHY=[
 {role:'agent',label:ROLE_LABELS.agent,responsibility:'Accueillir, qualifier et suivre les dossiers partagés.'},
 {role:'supervisor',label:ROLE_LABELS.supervisor,responsibility:'Valider les plans, coordonner les équipes et vérifier les mesures.'},
 {role:'admin',label:ROLE_LABELS.admin,responsibility:'Mandater les responsables, habiliter le terrain et suspendre les opérations.'},
 {role:'technician',label:ROLE_LABELS.technician,responsibility:'Consulter uniquement ses missions, appliquer les consignes et déclarer leur avancement.'}
];
const LABELS={reported:'Reçu',proposed:'Validation attendue',rejected:'Analyse à revoir',approved:'Plan approuvé',dispatched:'Équipe affectée',en_route:'En route',on_site:'Sur place',verifying:'Vérification attendue',resolved:'Dossier terminé',closed:'Clôturé administrativement',submitted:'À prendre en charge',in_progress:'En cours',waiting_customer:'Retour client attendu'};
function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS noc_field_accounts(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,technician_id TEXT NOT NULL UNIQUE,granted_by TEXT NOT NULL REFERENCES users(id),granted_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS noc_case_workflows(case_key TEXT PRIMARY KEY,owner TEXT REFERENCES users(id),version INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS noc_workspace_events(id TEXT PRIMARY KEY,case_key TEXT,actor TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,body TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS noc_workspace_event_case ON noc_workspace_events(case_key,at);
 CREATE TABLE IF NOT EXISTS noc_checklist(id TEXT PRIMARY KEY,case_key TEXT NOT NULL,body TEXT NOT NULL,author TEXT NOT NULL REFERENCES users(id),created INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0,1)),completed_by TEXT REFERENCES users(id),completed_at INTEGER);
 CREATE TABLE IF NOT EXISTS noc_template_deliveries(id TEXT PRIMARY KEY,case_key TEXT NOT NULL,template TEXT NOT NULL,source_version INTEGER NOT NULL,actor TEXT NOT NULL REFERENCES users(id),at INTEGER NOT NULL,UNIQUE(case_key,template,source_version));
 `);}
function sessionRole(s,uid){const role=O.role(s,uid);return role!=='subscriber'?role:s.get('SELECT user_id FROM noc_field_accounts WHERE user_id=?',uid)?'technician':'subscriber';}
function access(s,uid){
 const role=sessionRole(s,uid);insist(role!=='subscriber','Accès réservé à une équipe habilitée.',403);
 const technicianId=role==='technician'?s.get('SELECT technician_id FROM noc_field_accounts WHERE user_id=?',uid).technician_id:null;
 const staff=role!=='technician',canApprove=staff&&(['admin','supervisor'].includes(role)||!!s.get('SELECT user_id FROM noc_delegations WHERE user_id=? AND expires>?',uid,Date.now()));
 return {role,roleLabel:ROLE_LABELS[role],scope:staff?'all':'assigned',technicianId,capabilities:{canManageTeam:role==='admin',canApprove,canDelegate:role==='admin',canTakeCharge:staff,canNote:true,canNotify:staff,canInstruct:staff,canDispatch:['admin','supervisor'].includes(role),canVerify:['admin','supervisor'].includes(role),canAdvance:['admin','supervisor','technician'].includes(role)}};
}
function source(s,p,key){
 insist(typeof key==='string'&&key.length<=100,'Référence de dossier invalide.');
 const [kind,...parts]=key.split(':'),rid=parts.join(':');insist(['incident','ticket'].includes(kind)&&rid,'Référence de dossier invalide.');
 if(kind==='incident'){
  const row=s.get('SELECT * FROM noc_incidents WHERE id=?',rid);insist(row&&(p.scope==='all'||(row.mode==='demo'&&row.technician===p.technicianId)),'Dossier introuvable ou hors de votre périmètre.',404);
  return {...row,kind,key,plan:row.plan?JSON.parse(row.plan):null};
 }
 insist(p.scope==='all','Dossier introuvable ou hors de votre périmètre.',404);
 const row=s.get('SELECT t.id,t.subject AS title,t.body,t.created,t.home,h.name AS home_name,x.status,x.assignee,x.version,x.shared_at AS updated FROM support_shares x JOIN tickets t ON t.id=x.ticket_id JOIN homes h ON h.id=t.home WHERE x.ticket_id=? AND x.active=1',rid);
 insist(row,'Dossier introuvable ou partage retiré.',404);return {...row,kind,key,mode:'local',description:JSON.parse(row.body).detail,plan:null};
}
function templates(i){
 if(i.kind==='ticket')return [{id:'ticket_update',label:'Informer du suivi',body:({submitted:'Votre dossier partagé a été reçu. Le support va l’examiner.',in_progress:'Le support examine votre dossier. Vous pouvez répondre depuis votre espace.',waiting_customer:'Le support attend votre réponse dans le dossier partagé.',resolved:'Le traitement de votre dossier support est terminé. Cette clôture ne certifie pas une réparation de la ligne.'})[i.status]}];
 const options={
  reported:['received','Confirmer la réception','Votre signalement est reçu. Le support vérifie la situation.'],
  proposed:['review','Informer de la validation','L’analyse de votre incident est préparée. La décision d’un responsable habilité est attendue.'],
  rejected:['review','Informer de la révision','Le support complète l’analyse de votre incident avant toute intervention.'],
  approved:['approved','Informer du plan validé','Un responsable habilité a validé le plan de prise en charge de votre incident.'],
  dispatched:['assigned','Informer de l’affectation','Une équipe est affectée à cet incident simulé. Son départ n’est pas encore confirmé.'],
  en_route:['en_route','Informer du départ','L’équipe de démonstration est en route. Suivez sa progression simulée dans votre espace.'],
  on_site:['on_site','Informer de l’arrivée','L’équipe de démonstration est sur place et suit les consignes d’intervention.'],
  verifying:['verifying','Informer de la vérification','La réparation a été déclarée dans le simulateur. Le retour des mesures doit encore être vérifié.'],
  closed:['closed','Informer de la clôture administrative','Votre dossier est clôturé administrativement. Le rétablissement du réseau n’a pas été vérifié.'],
  resolved:['resolved','Confirmer le rétablissement simulé','Le retour à la normale a été vérifié sur la télémétrie simulée. Aucun rétablissement de box réelle n’est revendiqué.']
 };
 const item=options[i.status];return item&&!(i.status==='resolved'&&i.mode!=='demo')?[{id:item[0],label:item[1],body:item[2]}]:[];
}
function next(i,owner){
 if(['closed','resolved'].includes(i.status))return {nextRole:'agent',nextStep:i.status==='closed'?'Clôture administrative : aucune réparation réseau certifiée.':'Consulter le compte rendu et les éventuels retours clients.'};
 if(i.kind==='ticket')return {nextRole:'agent',nextStep:i.status==='waiting_customer'?'Attendre la réponse du client dans le ticket partagé.':owner?'Poursuivre le traitement dans le dossier support.':'Prendre en charge et qualifier la demande partagée.'};
 if(['reported','rejected'].includes(i.status))return {nextRole:'agent',nextStep:'Compléter les faits et préparer une analyse pour validation.'};
 if(i.status==='proposed')return {nextRole:'supervisor',nextStep:'Faire approuver ou réviser le plan par un responsable habilité.'};
 if(i.status==='approved')return {nextRole:'supervisor',nextStep:i.plan?.dispatch?'Affecter une équipe après contrôle de sécurité.':'Suivre le plan validé et vérifier les mesures.'};
 if(i.status==='verifying')return {nextRole:'supervisor',nextStep:'Vérifier le retour de mesures fraîches avant de conclure au rétablissement.'};
 return {nextRole:'technician',nextStep:'Suivre les consignes puis déclarer la prochaine étape terrain.'};
}
function meta(s,key){return s.get('SELECT * FROM noc_case_workflows WHERE case_key=?',key)||{owner:null,version:0,updated:null};}
function actor(s,uid){const u=uid&&s.get('SELECT id,name FROM users WHERE id=?',uid);return u||null;}
function log(s,key,uid,kind,body){s.run('INSERT INTO noc_workspace_events VALUES(?,?,?,?,?,?)',id(),key,uid,kind,body,Date.now());}
function project(s,p,i,paused){
 const m=meta(s,i.key),owner=actor(s,i.kind==='ticket'?i.assignee:m.owner),terminal=['resolved','closed'].includes(i.status),tech=i.technician?N.TECHS.find(t=>t.id===i.technician):null;
 const notes=s.all("SELECT e.id,e.body,e.at,u.name AS author FROM noc_workspace_events e JOIN users u ON u.id=e.actor WHERE e.case_key=? AND e.kind='note' ORDER BY e.at,e.rowid LIMIT 100",i.key);
 const checklist=s.all('SELECT c.id,c.body,c.done,c.completed_at AS completedAt,a.name AS author,b.name AS completedBy FROM noc_checklist c JOIN users a ON a.id=c.author LEFT JOIN users b ON b.id=c.completed_by WHERE c.case_key=? ORDER BY c.created,c.rowid',i.key).map(c=>({...c,done:!!c.done}));
 const history=s.all('SELECT e.id,e.kind,e.body,e.at,u.name AS author FROM noc_workspace_events e JOIN users u ON u.id=e.actor WHERE e.case_key=? ORDER BY e.at DESC,e.rowid DESC LIMIT 100',i.key);
 const route=next(i,owner),allowed={claim:!paused&&!terminal&&p.capabilities.canTakeCharge&&!owner,note:!paused&&!terminal,notify:!paused&&p.capabilities.canNotify,instruct:!paused&&!terminal&&i.kind==='incident'&&!!i.approved_by&&['approved','dispatched','en_route','on_site'].includes(i.status)&&p.capabilities.canInstruct,check:!paused&&!terminal&&i.kind==='incident'&&['dispatched','en_route','on_site'].includes(i.status)&&(p.role==='technician'||['admin','supervisor'].includes(p.role)),advance:!paused&&i.kind==='incident'&&['dispatched','en_route','on_site'].includes(i.status)&&['admin','supervisor','technician'].includes(p.role)};
 const notificationTemplates=templates(i).filter(t=>!s.get('SELECT id FROM noc_template_deliveries WHERE case_key=? AND template=? AND (source_version=? OR at>?)',i.key,t.id,i.version,Date.now()-300000));
 allowed.ticketStatus=!paused&&i.kind==='ticket'&&p.scope==='all';
 const ticketStatuses=i.kind==='ticket'?O.TRANSITIONS[i.status].map(status=>({id:status,label:status==='resolved'?'Clôturer le dossier support':LABELS[status]})):[];
 const report=i.kind==='incident'&&i.mode==='local'&&s.get("SELECT name FROM sqlite_master WHERE type='table' AND name='citizen_reports'")?s.get('SELECT status FROM citizen_reports WHERE id=? AND user_id=?',i.id,i.reporter):null;
 allowed.reportStatus=!paused&&p.scope==='all'&&!!report;
 const reportStatuses=report?(report.status==='resolved'?[{id:'reviewing',label:'Rouvrir pour examen'}]:[{id:'reviewing',label:'Examiner le signalement'},{id:'resolved',label:'Clôturer administrativement'}]):[];
 return {key:i.key,kind:i.kind,id:i.id,title:i.title,description:i.description,status:i.status,statusLabel:LABELS[i.status]||i.status,mode:i.mode,terminal,restorationVerified:i.kind==='incident'&&i.mode==='demo'&&i.status==='resolved',version:m.version,sourceVersion:i.version,createdAt:i.created,updatedAt:Math.max(i.updated||i.created,m.updated||0),owner,...route,segment:i.segment_id||null,technician:tech?{id:tech.id,name:tech.name,team:tech.team}:null,allowed,ticketStatuses,reportStatus:report?.status||null,reportStatuses,notificationTemplates,notes,checklist,history,plan:i.plan,suggestion:{title:route.nextStep,body:i.plan?i.plan.title+' · '+i.plan.runbook:'Qualification à partir des éléments explicitement transmis ; aucune télémétrie opérateur présumée.',requiresApproval:true}};
}
function overview(s,uid){
 const p=access(s,uid),settings=s.get('SELECT paused,last_scan FROM noc_settings WHERE id=1'),paused=!!settings.paused;
 const incidentRows=p.scope==='all'?s.all('SELECT id FROM noc_incidents ORDER BY updated DESC'):s.all("SELECT id FROM noc_incidents WHERE mode='demo' AND technician=? ORDER BY updated DESC",p.technicianId);
 const raw=incidentRows.map(i=>source(s,p,'incident:'+i.id));
 if(p.scope==='all')for(const t of s.all('SELECT ticket_id FROM support_shares WHERE active=1 ORDER BY shared_at DESC'))raw.push(source(s,p,'ticket:'+t.ticket_id));
 const queue=raw.map(i=>project(s,p,i,paused)).sort((a,b)=>Number(a.terminal)-Number(b.terminal)||b.updatedAt-a.updatedAt);
 const teams=p.scope==='all'?s.all('SELECT u.id,u.name,g.role,NULL AS technicianId FROM operator_grants g JOIN users u ON u.id=g.user_id UNION ALL SELECT u.id,u.name,? AS role,f.technician_id AS technicianId FROM noc_field_accounts f JOIN users u ON u.id=f.user_id WHERE NOT EXISTS(SELECT 1 FROM operator_grants g WHERE g.user_id=f.user_id)','technician'):s.all('SELECT u.id,u.name,? AS role,f.technician_id AS technicianId FROM noc_field_accounts f JOIN users u ON u.id=f.user_id WHERE f.user_id=?','technician',uid);
 const visibleSegments=new Set(raw.filter(i=>i.kind==='incident').map(i=>i.segment_id));
 const technicians=N.TECHS.filter(t=>p.scope==='all'||t.id===p.technicianId).map(t=>({...t,busy:raw.some(i=>i.kind==='incident'&&i.technician===t.id&&!['closed','resolved'].includes(i.status))}));
 return {...p,paused,settings,counts:{total:queue.length,unassigned:queue.filter(i=>!i.owner&&!i.terminal).length,awaitingApproval:queue.filter(i=>i.status==='proposed').length,activeMissions:queue.filter(i=>['dispatched','en_route','on_site','verifying'].includes(i.status)).length,sharedTickets:queue.filter(i=>i.kind==='ticket').length},queue,team:teams.map(u=>({...u,roleLabel:ROLE_LABELS[u.role],activeCases:queue.filter(i=>!i.terminal&&(i.owner?.id===u.id||(u.technicianId&&i.technician?.id===u.technicianId))).length})),hierarchy:HIERARCHY,technicians,network:{segments:s.all('SELECT * FROM noc_segments').filter(v=>p.scope==='all'||visibleSegments.has(v.id)),incidents:raw.filter(i=>i.kind==='incident').map(i=>({id:i.id,segment_id:i.segment_id,title:i.title,status:i.status,mode:i.mode,technician:i.technician,position:N.position(i)})),technicians},journal:p.scope==='all'?s.all('SELECT e.id,e.kind,e.body,e.at,u.name AS author FROM noc_workspace_events e JOIN users u ON u.id=e.actor WHERE e.case_key IS NULL ORDER BY e.at DESC,e.rowid DESC LIMIT 50'):[],source:'Coordination interne locale · simulations signalées · aucun SMS, GPS réel ou ordre ACS envoyé'};
}
function fieldAccount(s,uid,p,d){
 insist(p.capabilities.canManageTeam,'Habilitation terrain réservée au directeur technique.',403);insist(d.confirm===true&&typeof d.enabled==='boolean','Confirmation explicite requise.');
 if(d.enabled)insist(!s.get('SELECT paused FROM noc_settings WHERE id=1').paused,'Supervision suspendue : seule la révocation d’un accès terrain reste disponible.',409);
 const email=word(d.email,'Adresse du compte terrain',254).toLowerCase(),u=s.get('SELECT id FROM users WHERE email=?',email);insist(u,'Ce compte doit d’abord être créé par son titulaire.',404);insist(O.role(s,u.id)==='subscriber','Un rôle support existant ne peut pas être remplacé par une habilitation terrain.',409);
 if(d.enabled){const tech=N.TECHS.find(t=>t.id===d.technicianId);insist(tech,'Équipe terrain inconnue.');const bound=s.get('SELECT user_id FROM noc_field_accounts WHERE technician_id=?',tech.id);insist(!bound||bound.user_id===u.id,'Cette équipe est déjà liée à un autre compte.',409);s.run('INSERT INTO noc_field_accounts VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET technician_id=excluded.technician_id,granted_by=excluded.granted_by,granted_at=excluded.granted_at',u.id,tech.id,uid,Date.now());}
 else s.run('DELETE FROM noc_field_accounts WHERE user_id=?',u.id);
 log(s,null,uid,d.enabled?'field.granted':'field.revoked',d.enabled?'Accès terrain attribué à un compte existant pour l’équipe '+d.technicianId+'.':'Accès terrain révoqué.');
 s.event(null,uid,'noc.field-account',u.id+' · '+(d.enabled?d.technicianId:'revoked'));
}
function action(s,uid,d){
 const p=access(s,uid);
 s.transaction(()=>{
  if(d.type==='field-account'){fieldAccount(s,uid,p,d);return;}
  insist(['claim','note','notify','instruct','check','advance','ticket-status','report-status'].includes(d.type),'Action de coordination inconnue.');
  insist(!s.get('SELECT paused FROM noc_settings WHERE id=1').paused,'Supervision suspendue : les écritures opérationnelles sont arrêtées.',409);
  const i=source(s,p,d.key),m=meta(s,i.key);
  insist(Number.isInteger(d.version)&&d.version===m.version&&Number.isInteger(d.sourceVersion)&&d.sourceVersion===i.version,'Ce dossier a changé. Actualisez avant de confirmer.',409);
  const item=project(s,p,i,false),permission=({'ticket-status':'ticketStatus','report-status':'reportStatus'})[d.type]||d.type;insist(Object.hasOwn(item.allowed,permission)&&item.allowed[permission],'Cette action n’est pas autorisée pour ce rôle ou cet état.',403);
  if(['claim','notify','advance','ticket-status','report-status'].includes(d.type))insist(d.confirm===true,'Confirmation explicite requise.');
  if(d.type==='claim'){
   if(i.kind==='ticket')s.run('UPDATE support_shares SET assignee=?,version=version+1 WHERE ticket_id=? AND active=1',uid,i.id);
   else s.run('INSERT INTO noc_case_workflows(case_key,owner,version,updated) VALUES(?,?,0,?) ON CONFLICT(case_key) DO UPDATE SET owner=excluded.owner',i.key,uid,Date.now());
   log(s,i.key,uid,'claimed','Prise en charge nominative du dossier.');
  }else if(d.type==='note'){
   insist(s.get("SELECT count(*) AS n FROM noc_workspace_events WHERE case_key=? AND kind='note'",i.key).n<100,'Maximum 100 notes par dossier.',409);
   log(s,i.key,uid,'note',paragraph(d.body,'Note interne',1000));
  }else if(d.type==='instruct'){
   insist(s.get('SELECT count(*) AS n FROM noc_checklist WHERE case_key=?',i.key).n<30,'Maximum 30 consignes par intervention.',409);
   const body=paragraph(d.body,'Consigne terrain',1000);s.run('INSERT INTO noc_checklist(id,case_key,body,author,created) VALUES(?,?,?,?,?)',id(),i.key,body,uid,Date.now());log(s,i.key,uid,'instruction','Consigne interne ajoutée à la checklist terrain.');
  }else if(d.type==='check'){
   insist(typeof d.done==='boolean','État de checklist explicite requis.');const c=s.get('SELECT id,done FROM noc_checklist WHERE id=? AND case_key=?',String(d.itemId),i.key);insist(c,'Consigne introuvable pour cette mission.',404);
   s.run('UPDATE noc_checklist SET done=?,completed_by=?,completed_at=? WHERE id=?',d.done?1:0,d.done?uid:null,d.done?Date.now():null,c.id);log(s,i.key,uid,'check',d.done?'Consigne cochée par un membre habilité.':'Consigne remise en attente.');
  }else if(d.type==='notify'){
   const template=item.notificationTemplates.find(t=>t.id===d.template);insist(template,'Gabarit indisponible pour cet état ou déjà envoyé récemment.',409);
   insist(!s.get('SELECT id FROM noc_template_deliveries WHERE case_key=? AND at>? ORDER BY at DESC LIMIT 1',i.key,Date.now()-30000),'Une notification vient d’être envoyée. Attendez avant de renvoyer.',429);
   s.run('INSERT INTO noc_template_deliveries VALUES(?,?,?,?,?,?)',id(),i.key,template.id,i.version,uid,Date.now());
   if(i.kind==='incident')N.event(s,i.id,uid,'support.template',template.body,{template:template.id});
   else {s.run('INSERT INTO support_events VALUES(?,?,?,?,?,?)',id(),i.id,uid,Date.now(),'support.template',template.body);s.notice(i.home,'Suivi de votre dossier : '+i.title,template.body);s.run('UPDATE support_shares SET version=version+1 WHERE ticket_id=?',i.id);}
   log(s,i.key,uid,'notified','Gabarit « '+template.label+' » publié dans l’espace client local.');
  }else if(d.type==='advance'){
   N.operate(s,uid,{type:'advance',id:i.id,version:i.version},{withinTransaction:true});log(s,i.key,uid,'advanced','Avancement terrain déclaré, sans présumer le retour du réseau.');
  }else if(d.type==='ticket-status'){
   O.update(s,uid,i.id,{status:d.status,message:d.body??d.message,version:i.version},{withinTransaction:true});
   log(s,i.key,uid,'ticket.status','Dossier support mis à jour : '+LABELS[d.status]+'. Réponse publiée dans l’espace client.');
  }else if(d.type==='report-status'){
   insist(item.reportStatuses.some(t=>t.id===d.status),'Transition de signalement indisponible.',409);
   require('./journey-store.cjs').respondReal(s,{id:uid},{id:i.id,status:d.status,response:d.body??d.message},{withinTransaction:true});
   log(s,i.key,uid,'report.status',d.status==='resolved'?'Signalement clôturé administrativement. Aucun rétablissement réseau certifié.':'Signalement en cours d’examen. Réponse publiée au déclarant.');
  }
  s.run('INSERT INTO noc_case_workflows(case_key,version,updated) VALUES(?,1,?) ON CONFLICT(case_key) DO UPDATE SET version=version+1,updated=excluded.updated',i.key,Date.now());
 });
 return overview(s,uid);
}
module.exports={migrate,sessionRole,access,overview,action};
