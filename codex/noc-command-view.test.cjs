'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'noc-command-view.js'),'utf8');
function nodes(root,predicate){if(!root||typeof root!=='object')return [];if(Array.isArray(root))return root.flatMap(item=>nodes(item,predicate));return [...(predicate(root)?[root]:[]),...(root.children||[]).flatMap(item=>nodes(item,predicate))];}
function text(root){if(root==null||root===false)return '';return Array.isArray(root)?root.map(text).join(' '):typeof root==='object'?(root.children||[]).map(text).join(' '):String(root);}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture(){
 const common={version:4,sourceVersion:8,createdAt:100,updatedAt:200,owner:null,terminal:false,restorationVerified:false,mode:'demo',nextRole:'supervisor',nextStep:'Vérifier le plan.',description:'Un signalement partagé.',notificationTemplates:[{id:'received',label:'Réception du dossier',body:'Votre signalement est reçu.'}],notes:[],checklist:[],history:[],suggestion:{title:'Analyse disponible',body:'Preuves du dossier',requiresApproval:true}};
 const incident={...common,key:'incident:I1',id:'I1',kind:'incident',title:'Coupure Yopougon',segment:'YOP-07',status:'proposed',statusLabel:'À valider',allowed:{claim:true,note:true,notify:true,instruct:false,check:false,advance:false}};
 const ticket={...common,key:'ticket:T1',id:'T1',kind:'ticket',title:'Connexion lente au bureau',segment:null,mode:'local',status:'submitted',statusLabel:'À prendre en charge',nextRole:'agent',allowed:{claim:true,note:true,notify:true,ticketStatus:true},ticketStatuses:[{id:'in_progress',label:'En cours'},{id:'waiting_customer',label:'Retour client attendu'},{id:'resolved',label:'Clôturer le dossier'}]};
 return {role:'admin',roleLabel:'Directeur technique',scope:'all',paused:false,capabilities:{canManageTeam:true,canApprove:true},counts:{total:2,unassigned:2,awaitingApproval:1,activeMissions:0,sharedTickets:1},queue:[incident,ticket],team:[{id:'U1',name:'Awa',role:'admin',roleLabel:'Directeur technique',activeCases:0}],hierarchy:[{role:'agent',label:'Conseiller support',responsibility:'Qualifier et suivre.'}],technicians:[{id:'awa',name:'Awa',team:'Équipe A'}],network:{segments:[{id:'YOP-07',online:16,total:20}],incidents:[{id:'I1',segment_id:'YOP-07',status:'proposed'}],technicians:[]},source:'Données locales'};
}
function harness(data=fixture(),respond){
 const state=[data,false,false,'','',null,'open','','note','','',null,null,'actions',''];
 const refs=[],effects=[],pending=[],calls=[],intervals=[],selectedCalls=[],navigation=[];let si=0,ri=0,ei=0,tree,props;
 const React={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),useState:initial=>{const i=si++;if(!(i in state))state[i]=initial;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},useRef:initial=>{const i=ri++;return refs[i]||(refs[i]={current:initial});},useEffect:(fn,deps)=>{const i=ei++,old=effects[i];if(!old||deps.some((v,n)=>v!==old.deps[n])||deps.length!==old.deps.length)pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn(),runs:(old?.runs||0)+1};});}};
 const api=async(route,method,body)=>{calls.push({route,method,body});return respond?respond(route,method,body):state[0];};
 const document={activeElement:{focus(){},isConnected:true},addEventListener(){},removeEventListener(){}};
 const context={React,window:{FGMap:{View:'map'}},document,FormData:class {constructor(form){this.entries=Object.entries(form.values||{});}*[Symbol.iterator](){yield* this.entries;}},requestAnimationFrame:fn=>fn(),setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},Date};
 vm.runInNewContext(source,context);
 props={api,user:{id:'U1',name:'Awa Koné'},onNavigate:page=>navigation.push(page),onIncident:(id,page)=>navigation.push([id,page]),onAskGuardian:key=>navigation.push(['guardian',key]),onSelectionChange:key=>selectedCalls.push(key)};
 function render(extra={}){props={...props,...extra};si=0;ri=0;ei=0;tree=context.window.FGCommand.View(props);while(pending.length)pending.shift()();return tree;}
 render();
 return {state,refs,effects,calls,intervals,selectedCalls,navigation,render,get tree(){return tree;},exports:context.window.FGCommand,
  find:predicate=>nodes(tree,predicate)[0],all:predicate=>nodes(tree,predicate),button:label=>nodes(tree,n=>n.type==='button'&&text(n).trim()===label)[0],
  posts:()=>calls.filter(c=>c.method==='POST')};
}

test('La file distingue tous les périmètres sans inventer les statistiques',()=>{
 const h=harness(),queue=fixture().queue;
 const selected=h.exports.selectQueue(queue,{filter:'tickets'});assert.equal(selected.length,1);assert.equal(selected[0].kind,'ticket');
 assert.equal(h.exports.selectQueue(queue,{filter:'approval'}).length,1);
 assert.equal(h.exports.selectQueue(queue,{query:'BUREAU'}).length,1);
 assert.equal(h.exports.selectQueue(queue,{filter:'mine',userId:'U1'}).length,0);
 assert.equal(h.all(n=>n.props.className?.startsWith('oc-metric')&&n.type==='button').length,4);
 assert.equal(h.all(n=>n.type==='h1').length,0,'Le titre de page reste dans le shell');
 assert.match(text(h.tree),/Responsable de supervision/);
 assert.deepEqual(h.selectedCalls,['incident:I1']);
 h.button('Clients').props.onClick();h.render();assert.deepEqual(h.selectedCalls,['incident:I1','ticket:T1']);
});

test('Une clôture support ou administrative ne constitue pas une réparation réseau',()=>{
 const h=harness(),workflow=h.exports.workflow;
 assert.equal(workflow({kind:'incident',status:'closed'}),null);
 assert.equal(workflow({kind:'incident',status:'resolved',restorationVerified:false}).complete,false);
 assert.equal(workflow({kind:'incident',status:'resolved',restorationVerified:true}).complete,true);
 assert.equal(workflow({kind:'ticket',status:'resolved',terminal:true}).stages.at(-1),'Clôture support');
});

test('La prise en charge attend une confirmation et transmet les deux versions',async()=>{
 const h=harness();await tick();h.button('Prendre en charge').props.onClick();assert.equal(h.posts().length,0);h.render();
 assert.match(text(h.find(n=>n.props.role==='dialog')),/ne dépêche pas de technicien/);
 await h.button('Confirmer').props.onClick();
 assert.equal(h.posts().length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.posts()[0])),{route:'/noc/workspace/action',method:'POST',body:{key:'incident:I1',version:4,sourceVersion:8,type:'claim',confirm:true}});
});

test('Passer d’une note interne à un message client efface le brouillon',()=>{
 const h=harness();h.find(n=>n.type==='textarea').props.onChange({target:{value:'Information interne confidentielle'}});h.render();
 h.button('Informer le client').props.onClick();h.render();assert.equal(h.state[9],'');assert.equal(h.find(n=>n.type==='textarea'),undefined);
 h.button('Vérifier et envoyer').props.onClick();h.render();assert.equal(h.state[11].payload.template,'received');assert.equal(h.state[11].payload.body,undefined);
 assert.doesNotMatch(text(h.find(n=>n.props.role==='dialog')),/confidentielle/);
});

test('Le traitement client change de statut avec une réponse publique confirmée',async()=>{
 const h=harness();await tick();h.button('Clients').props.onClick();h.render();h.button('Faire avancer').props.onClick();h.render();
 h.find(n=>n.type==='textarea').props.onChange({target:{value:'Pouvez-vous préciser le voyant de la box ?'}});h.find(n=>n.type==='select'&&n.props.value==='in_progress').props.onChange({target:{value:'waiting_customer'}});h.render();
 const form=h.find(n=>n.type==='form'&&nodes(n,c=>c.type==='textarea').length);form.props.onSubmit({preventDefault(){}});assert.equal(h.posts().length,0);h.render();
 assert.match(text(h.find(n=>n.props.role==='dialog')),/Message visible par le client/);await h.button('Confirmer').props.onClick();
 assert.equal(h.posts()[0].body.type,'ticket-status');assert.equal(h.posts()[0].body.status,'waiting_customer');assert.equal(h.posts()[0].body.body,'Pouvez-vous préciser le voyant de la box ?');assert.equal(h.posts()[0].body.sourceVersion,8);
});

test('Le technicien ne peut pas ouvrir les vues réseau globales ni les comptes',async()=>{
 const data=fixture();data.scope='assigned';data.role='technician';data.capabilities={};data.queue=[{...data.queue[0],status:'on_site',technician:{id:'awa',name:'Awa',team:'Équipe A'},allowed:{note:true,advance:true,check:true},checklist:[{id:'C1',body:'Contrôler le raccord',done:false,author:'Directeur'}]}];
 const h=harness(data);await tick();assert.equal(h.button('Ouvrir le dossier réseau'),undefined);assert.equal(h.button('Ouvrir la carte'),undefined);assert.equal(h.button('Habilitations'),undefined);assert.doesNotMatch(text(h.tree),/Rattacher un compte/);
 assert.ok(h.button('Déclarer la réparation'));h.button('Terrain · 1').props.onClick();h.render();await h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
 assert.equal(h.posts()[0].body.type,'check');assert.equal(h.posts()[0].body.itemId,'C1');assert.equal(h.posts()[0].body.done,true);assert.match(text(h.tree),/ne confirme pas le rétablissement/);
});

test('La pause désactive toute commande opérationnelle, sans cacher les dossiers',()=>{
 const data=fixture();data.paused=true;const h=harness(data);
 assert.match(text(h.tree),/actions sont gelées/);assert.equal(h.button('Prendre en charge').props.disabled,true);assert.equal(h.find(n=>n.type==='textarea').props.disabled,true);
 h.button('Prendre en charge').props.onClick();assert.equal(h.state[11],null);
});

test('La chronologie conserve l’ordre récent → ancien donné par le backend',()=>{
 const data=fixture();data.queue[0].history=[{id:'e2',body:'Dernière action',at:200,author:'Awa'},{id:'e1',body:'Première action',at:100,author:'Awa'}];const h=harness(data);h.button('Chronologie').props.onClick();h.render();
 const history=text(h.find(n=>n.props.className==='oc-history'));assert.ok(history.indexOf('Dernière action')<history.indexOf('Première action'));
});

test('Le polling n’est pas réinitialisé par une nouvelle fonction api du parent',async()=>{
 const h=harness();await tick();assert.equal(h.intervals.length,1);let latestCalls=0;
 h.render({api:async()=>{latestCalls++;return fixture();}});assert.equal(h.intervals.length,1);assert.equal(h.effects[0].runs,1);
 await h.intervals[0]();assert.equal(latestCalls,1,'Le poll utilise le callback API courant');
});

test('Un ancien poll ne remplace jamais le résultat plus récent d’une action',async()=>{
 const gate=deferred(),latest=fixture();latest.queue[0].owner={id:'U1',name:'Awa'};const h=harness(fixture(),async(route,method)=>method==='POST'?latest:gate.promise);
 h.button('Prendre en charge').props.onClick();h.render();await h.button('Confirmer').props.onClick();assert.equal(h.state[0].queue[0].owner.name,'Awa');
 gate.resolve(fixture());await tick();assert.equal(h.state[0].queue[0].owner.name,'Awa');
});

test('Une erreur de permission retire les données et les commandes',async()=>{
 const error=Object.assign(new Error('Accès retiré'),{status:403});const h=harness(fixture(),async()=>{throw error;});await tick();h.render();
 assert.equal(h.state[0],null);assert.match(text(h.tree),/Accès retiré/);assert.equal(h.button('Prendre en charge'),undefined);
});

test('La carte et le copilote partagent la sélection autorisée du workspace',()=>{
 const h=harness();h.button('Demander à Guardian').props.onClick();assert.deepEqual(h.navigation,[['guardian','incident:I1']]);
 const map=h.find(n=>n.type==='map');assert.equal(map.props.incident.id,'I1');assert.equal(map.props.segments[0].id,'YOP-07');map.props.onSelect('YOP-07');h.render();assert.equal(h.state[5],'incident:I1');
});

test('Clôturer un signalement local exige un message public et une confirmation administrative',async()=>{
 const data=fixture();data.queue=[{...data.queue[0],mode:'local',status:'reported',reportStatus:'received',allowed:{note:true,reportStatus:true},reportStatuses:[{id:'reviewing',label:'En examen'},{id:'resolved',label:'Clos'}]}];const h=harness(data);await tick();
 h.button('Traiter le signalement').props.onClick();h.render();
 assert.equal(h.find(n=>n.type==='textarea').props.maxLength,1000);
 h.find(n=>n.type==='select'&&n.props.value==='reviewing').props.onChange({target:{value:'resolved'}});h.find(n=>n.type==='textarea').props.onChange({target:{value:'Le signalement est un doublon du dossier existant.'}});h.render();
 h.find(n=>n.type==='form'&&nodes(n,c=>c.type==='textarea').length).props.onSubmit({preventDefault(){}});assert.equal(h.posts().length,0);h.render();
 assert.match(text(h.find(n=>n.props.role==='dialog')),/Clôturer administrativement/);assert.match(text(h.find(n=>n.props.role==='dialog')),/aucune réparation ni remise en service/);
 await h.button('Confirmer').props.onClick();assert.equal(h.posts()[0].body.type,'report-status');assert.equal(h.posts()[0].body.status,'resolved');assert.equal(h.posts()[0].body.version,4);assert.equal(h.posts()[0].body.sourceVersion,8);
 assert.match(h.state[4],/Aucun rétablissement réseau n’est certifié/);
});

test('Un signalement clos reste réouvrable depuis Tous, sans rétablissement fictif',async()=>{
 const data=fixture();data.queue=[{...data.queue[0],mode:'local',status:'closed',terminal:true,reportStatus:'resolved',allowed:{reportStatus:true},reportStatuses:[{id:'reviewing',label:'Réouvrir'}]}];const h=harness(data);await tick();h.button('Tous').props.onClick();h.render();
 assert.match(text(h.tree),/Réouvrir le signalement/);assert.match(text(h.tree),/aucune réparation réseau n’est attestée/);
 h.find(n=>n.type==='textarea').props.onChange({target:{value:'Le client a apporté un nouvel élément.'}});h.render();h.find(n=>n.type==='form'&&nodes(n,c=>c.type==='textarea').length).props.onSubmit({preventDefault(){}});h.render();await h.button('Confirmer').props.onClick();
 assert.equal(h.posts()[0].body.type,'report-status');assert.equal(h.posts()[0].body.status,'reviewing');
});

test('Sous pause, le directeur peut retirer un accès terrain mais ne peut pas en accorder',async()=>{
 const data=fixture();data.paused=true;const h=harness(data);await tick();
 assert.equal(h.find(n=>n.type==='select'&&n.props.name==='enabled').props.disabled,false);assert.equal(h.button('Vérifier cette habilitation').props.disabled,true);
 const event={preventDefault(){},currentTarget:{values:{email:'terrain@example.ci',technicianId:'awa'}}};
 h.find(n=>n.type==='form'&&nodes(n,c=>c.props.name==='enabled').length).props.onSubmit(event);assert.equal(h.state[11],null,'Accorder reste bloqué même via un ancien handler');
 h.find(n=>n.type==='select'&&n.props.name==='enabled').props.onChange({target:{value:'false'}});h.render();assert.equal(h.button('Vérifier cette habilitation').props.disabled,false);
 h.find(n=>n.type==='form'&&nodes(n,c=>c.props.name==='enabled').length).props.onSubmit(event);h.render();assert.equal(h.button('Confirmer').props.disabled,false);await h.button('Confirmer').props.onClick();
 assert.equal(h.posts().length,1);assert.equal(h.posts()[0].body.type,'field-account');assert.equal(h.posts()[0].body.enabled,false);assert.equal(h.posts()[0].body.confirm,true);
});

test('Le terrain voit les compteurs et filtres de ses missions, pas ceux du support',()=>{
 const data=fixture();data.scope='assigned';data.role='technician';data.capabilities={};
 data.queue=['dispatched','en_route','on_site','resolved'].map((status,i)=>({...data.queue[0],key:'incident:M'+i,id:'M'+i,status,terminal:status==='resolved',technician:{id:'awa',name:'Awa'},owner:null,allowed:{note:status!=='resolved',advance:status!=='resolved'}}));
 const h=harness(data),metrics=h.all(n=>n.type==='button'&&n.props.className?.startsWith('oc-metric'));
 assert.deepEqual(metrics.map(node=>text(nodes(node,n=>n.type==='strong')[0]).trim()),['3','1','1','1']);
 assert.match(text(metrics[0]),/Mes missions actives/);assert.equal(h.button('Clients'),undefined);assert.equal(h.button('Mes dossiers'),undefined);assert.doesNotMatch(text(h.tree),/Plans à valider|Dossiers clients/);
 assert.ok(h.button('Confirmer le départ'));
 h.button('En route').props.onClick();h.render();assert.ok(h.button('Confirmer l’arrivée'));assert.equal(h.all(n=>n.type==='button'&&n.props.className?.startsWith('oc-item')).length,1);
 h.button('Sur place').props.onClick();h.render();assert.ok(h.button('Déclarer la réparation'));
 h.button('Terminées').props.onClick();h.render();assert.equal(h.all(n=>n.type==='button'&&n.props.className?.startsWith('oc-item')).length,1);assert.equal(h.button('Déclarer la réparation'),undefined);
 h.button('Toutes').props.onClick();h.render();assert.equal(h.all(n=>n.type==='button'&&n.props.className?.startsWith('oc-item')).length,4);
});

test('Une erreur d’action reste affichée après les polls, jusqu’à l’actualisation manuelle',async()=>{
 const data=fixture(),failure=Object.assign(new Error('Terminez la checklist avant de déclarer la réparation.'),{status:409});
 const h=harness(data,async(route,method)=>{if(method==='POST')throw failure;return data;});await tick();
 h.button('Prendre en charge').props.onClick();h.render();await h.button('Confirmer').props.onClick();h.render();
 assert.equal(h.state[3],failure.message);assert.equal(h.button('Prendre en charge').props.disabled,true);
 await h.intervals[0]();h.render();assert.equal(h.state[3],failure.message);assert.match(text(h.find(n=>n.props.role==='alert')),/Terminez la checklist/);assert.equal(h.button('Prendre en charge').props.disabled,true);
 await h.button('Réessayer').props.onClick();h.render();assert.equal(h.state[3],'');assert.equal(h.find(n=>n.props.role==='alert'),undefined);assert.equal(h.button('Prendre en charge').props.disabled,false);
});

test('Changer de dossier efface l’erreur d’action précédente, sans masquer les erreurs de lecture',async()=>{
 const data=fixture();const h=harness(data,async(route,method)=>{if(method==='POST')throw Object.assign(new Error('Action refusée sur I1'),{status:409});return data;});await tick();
 h.button('Prendre en charge').props.onClick();h.render();await h.button('Confirmer').props.onClick();h.render();assert.equal(h.state[3],'Action refusée sur I1');
 h.button('Clients').props.onClick();h.render();h.render();assert.equal(h.state[3],'');assert.equal(h.selectedCalls.at(-1),'ticket:T1');
});

test('Une erreur de lecture disparaît au prochain poll réussi',async()=>{
 let failing=true;const data=fixture(),h=harness(data,async()=>{if(failing)throw new Error('Réseau temporairement indisponible');return data;});await tick();h.render();assert.equal(h.state[3],'Réseau temporairement indisponible');
 failing=false;await h.intervals[0]();h.render();assert.equal(h.state[3],'');
});

test('Un lien du copilote ouvre exactement le dossier demandé, malgré les filtres et la recherche',()=>{
 const data=fixture();data.queue[1]={...data.queue[1],status:'resolved',terminal:true};
 const h=harness(data);h.find(n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value:'Yopougon'}});h.render();
 const request={key:'ticket:T1'};h.render({selectionRequest:request});
 assert.equal(h.selectedCalls.at(-1),'ticket:T1');assert.equal(h.state[6],'all');assert.equal(h.state[7],'');
 assert.match(text(h.find(n=>n.props.className==='oc-card oc-detail')),/Connexion lente au bureau/);
 h.render();assert.equal(h.find(n=>n.type==='button'&&n.props.className?.includes('oc-item selected')).props['aria-pressed'],true);
 assert.equal(h.selectedCalls.filter(key=>key==='ticket:T1').length,1);
});

test('Le retour de sélection au parent ne rejoue pas un ancien lien et ne crée pas de boucle',()=>{
 const h=harness(),request={key:'ticket:T1'};h.render({selectionRequest:request});h.render();
 h.button('À valider').props.onClick();h.render();assert.equal(h.selectedCalls.at(-1),'incident:I1');
 const before=h.selectedCalls.length;h.render({selectionRequest:request,onSelectionChange:key=>h.selectedCalls.push(key)});h.render();
 assert.equal(h.state[6],'approval');assert.equal(h.selectedCalls.length,before);assert.equal(h.intervals.length,1);
 // Une nouvelle activation du même lien constitue bien une nouvelle demande.
 h.render({selectionRequest:{key:'ticket:T1'}});assert.equal(h.selectedCalls.at(-1),'ticket:T1');assert.equal(h.state[6],'all');
});

test('Un lien vers un dossier retiré n’ouvre pas un autre dossier ni ses commandes',()=>{
 const h=harness();h.render({selectionRequest:{key:'ticket:retire'}});h.render();
 assert.equal(h.selectedCalls.at(-1),null);assert.match(text(h.tree),/n’est plus accessible dans votre périmètre/);
 assert.equal(h.button('Prendre en charge'),undefined);assert.match(text(h.find(n=>n.props.className==='oc-card oc-detail')),/Choisissez un élément/);
 h.button('À traiter').props.onClick();h.render();assert.equal(h.selectedCalls.at(-1),'incident:I1');
});

test('Une sélection reçue avant le chargement attend les données autorisées',async()=>{
 const gate=deferred(),h=harness(null,()=>gate.promise),request={key:'ticket:T1'};
 h.render({selectionRequest:request});assert.equal(h.selectedCalls.at(-1),null);
 gate.resolve(fixture());await tick();h.render();h.render();
 assert.equal(h.selectedCalls.at(-1),'ticket:T1');assert.ok(!h.selectedCalls.includes('incident:I1'),'Aucun autre dossier ne doit être sélectionné pendant le chargement du lien.');
});
