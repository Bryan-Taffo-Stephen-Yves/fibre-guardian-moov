'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'pilot-view.js'), 'utf8');

// Le rendu contrôlé teste les réponses différées sans ouvrir de navigateur ni modifier la base réelle.
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; }
function nodes(root, predicate) {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(n => nodes(n, predicate));
  return [...(predicate(root) ? [root] : []), ...(root.children || []).flatMap(n => nodes(n, predicate))];
}
function text(node) {
  if (node == null || node === false) return '';
  if (Array.isArray(node)) return node.map(text).join(' ');
  return typeof node === 'object' ? (node.children || []).map(text).join(' ') : String(node);
}
function snapshot(id = 'A') {
  return {home:{id, role:'owner', settings:{}}, samples:[], labs:[], participants:[], notifications:[], devices:[], records:[{id:'record-a',name:'Mesure A',created:1}], members:[], audit:[], tickets:[], collector:null};
}
function harness(tab = 'labs', respond = async () => ({})) {
  const state = [{id:'user',name:'Test',csrf:'token'},true,[{id:'A',name:'Maison A'},{id:'B',name:'Bureau B'}],'A',snapshot('A'),tab,'login','','',false,null,null,0,false,null,null,false,false,'create','home'];
  const refs = [{current:'A'},{current:false},{current:new Set()},{current:0},{current:0}];
  let stateIndex=0, refIndex=0, tree;
  const react = {Fragment:'fragment',createElement:(type,props,...children)=>({type,props:props||{},children}),useEffect:()=>{},
    useState:initial=>{const i=stateIndex++;if(!(i in state))state[i]=initial;return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];},
    useRef:initial=>{const i=refIndex++;return refs[i]||(refs[i]={current:initial});}};
  const requests = [];
  const context = {React:react,window:{},FGPilotLab:'lab',FGOperator:{},AbortSignal,location:{origin:'http://localhost'},
    fetch:async(url,options)=>{requests.push({url,options});const response=await respond(url,options);return {ok:response.ok!==false,status:response.status||200,json:async()=>response.body===undefined?response:response.body};}};
  vm.runInNewContext(source, context);
  const render=()=>{stateIndex=0;refIndex=0;tree=context.window.FGPilot.View({embedded:true});return tree;};
  render();
  return {state,refs,requests,render,get tree(){return tree;},find:predicate=>nodes(tree,predicate)[0],
    forceOtherSpace:()=>{refs[0].current='B';state[3]='B';state[4]=snapshot('B');state[10]=null;state[11]=null;state[14]=null;state[15]=null;}};
}
function assertNoStaleOutput(h) {
  assert.equal(h.state[3],'B');assert.equal(h.state[4].home.id,'B');
  assert.equal(h.state[10],null,'Pas de lien, invitation ou clé collecteur A dans B');
  assert.equal(h.state[11],null,'Pas de relecture A dans B');
  assert.equal(h.state[14],null,'Pas de plan A dans B');assert.equal(h.state[15],null,'Pas d’estimation A dans B');
  assert.equal(h.state[7],'','Pas d’erreur de A présentée dans B');assert.equal(h.state[8],'','Pas de succès de A présenté dans B');
  assert.equal(h.state[9],false,'Le verrou est libéré');
}

test('Le sélecteur d’espace se verrouille pendant la création d’une session',async()=>{
  const gate=deferred(),h=harness('labs',async url=>url.endsWith('/labs')?(await gate.promise,{url:'http://localhost/participant#A'}):snapshot());
  const priorSelector=h.find(n=>n.type==='select'&&n.props.value==='A');
  const pending=h.find(n=>n.type==='lab').props.createForm.props.submit({name:'Session A'});
  h.render();assert.equal(h.find(n=>n.type==='select'&&n.props.value==='A').props.disabled,true);
  priorSelector.props.onChange({target:{value:'B'}});assert.equal(h.state[3],'A','Un ancien handler ne contourne pas le verrou synchrone');
  gate.resolve();await pending;assert.equal(h.state[10].url,'http://localhost/participant#A');assert.equal(h.state[9],false);
});

test('Une réponse de création A arrivée après le changement vers B ne publie pas son lien',async()=>{
  const gate=deferred(),h=harness('labs',async url=>url.endsWith('/labs')?(await gate.promise,{url:'http://localhost/participant#A'}):snapshot());
  const pending=h.find(n=>n.type==='lab').props.createForm.props.submit({name:'Session A'});
  h.forceOtherSpace();gate.resolve();await pending;assertNoStaleOutput(h);
});

test('Changement d’espace pendant le rafraîchissement suivant la mutation : pas de publication tardive',async()=>{
  const gate=deferred(),requested=deferred(),h=harness('labs',async url=>{if(url.endsWith('/labs'))return {url:'http://localhost/participant#A'};requested.resolve();await gate.promise;return snapshot();});
  const pending=h.find(n=>n.type==='lab').props.createForm.props.submit({name:'Session A'});
  await requested.promise;h.forceOtherSpace();gate.resolve();await pending;assertNoStaleOutput(h);
});

test('Invitation lecteur et clé collecteur restent attachées à leur espace',async()=>{
  for(const tab of ['settings','connector']){
    const gate=deferred(),h=harness(tab,async()=>{await gate.promise;return {code:'invitation-A',secret:'collector-A'};});
    const pending=tab==='settings'?h.find(n=>n.type==='button'&&text(n)==='Créer une invitation lecteur').props.onClick():h.find(n=>typeof n.type==='function'&&n.props.label==='Créer la clé collecteur').props.submit({model:'Test'});
    h.forceOtherSpace();gate.resolve();await pending;assertNoStaleOutput(h);
  }
});

test('Relecture et comparaison de plan : les réponses de A ne changent pas les panneaux de B',async()=>{
  for(const tab of ['history','plan']){
    const gate=deferred(),h=harness(tab,async()=>{await gate.promise;return {name:'Enregistrement A',frames:[],plan:{rooms:[]},placement:{}};});
    const label=tab==='history'?'Relire Mesure A':'Enregistrer et comparer les emplacements';
    const pending=h.find(n=>n.type==='button'&&text(n)===label).props.onClick();
    h.forceOtherSpace();gate.resolve();await pending;assertNoStaleOutput(h);
  }
});

test('Une erreur réseau tardive de A ne masque pas B, mais reste visible si A est actif',async()=>{
  for(const change of [true,false]){
    const gate=deferred(),h=harness('labs',async()=>{await gate.promise;return {ok:false,status:400,body:{error:'Session refusée'}};});
    const pending=h.find(n=>n.type==='lab').props.createForm.props.submit({name:'Session A'});
    if(change)h.forceOtherSpace();gate.resolve();await pending;
    if(change)assertNoStaleOutput(h);else assert.equal(h.state[7],'Session refusée');
  }
});

test('Création et invitation verrouillent aussi le changement de contexte',async()=>{
  for(const mode of ['create','join']){
    const gate=deferred(),h=harness('overview',async url=>{if(url==='/api/homes'&&h.requests.at(-1).options.method==='GET')return {homes:[]};await gate.promise;return {id:'new-space'};});
    h.state[17]=true;h.state[18]=mode;h.render();
    const label=mode==='create'?'Créer mon espace':'Rejoindre cet espace';
    const pending=h.find(n=>typeof n.type==='function'&&n.props.label===label).props.submit(mode==='create'?{name:'Bureau'}:{code:'test'});
    h.render();assert.equal(h.find(n=>n.type==='select'&&n.props.value==='A').props.disabled,true);
    h.forceOtherSpace();gate.resolve();await pending;assertNoStaleOutput(h);
  }
});

test('Création maison / bureau, invitation et guide restent explicites',()=>{
  const h=harness('overview');h.state[2]=[];h.state[3]='';h.state[4]=null;h.refs[0].current='';h.render();
  assert.match(text(h.tree),/ne connecte pas automatiquement votre box/);
  assert.equal(h.find(n=>typeof n.type==='function'&&n.props.label==='Créer mon espace').props.fields[0].value,'Ma maison');
  h.state[19]='office';h.render();assert.equal(h.find(n=>typeof n.type==='function'&&n.props.label==='Créer mon espace').props.fields[0].value,'Mon bureau');
  h.state[18]='join';h.render();assert.match(text(h.tree),/consulter ses résultats, sans modifier son réseau/);
  assert.equal(h.find(n=>typeof n.type==='function'&&n.props.label==='Rejoindre cet espace').props.fields[0].name,'code');
});

test('Les aides du signalement et du guide restent lisibles sur leurs fonds clairs',()=>{
  const report=fs.readFileSync(path.join(__dirname,'report-form.css'),'utf8');
  const home=fs.readFileSync(path.join(__dirname,'home-onboarding.css'),'utf8');
  function rule(css,selector){const from=css.indexOf(selector+'{');assert.notEqual(from,-1);return css.slice(from,css.indexOf('}',from));}
  function luminance(hex){const [r,g,b]=hex.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;}
  for(const selector of ['.rf-form .rf-hint','.rf-form .rf-submit-bar small','.rf-form .rf-coordinates>p','.rf-form .rf-demo-note']){
    const style=rule(report,selector),color=style.match(/color:#([0-9a-f]{6})/)[1];
    for(const background of ['ffffff','f5f7ef'])assert.ok((luminance(background)+.05)/(luminance(color)+.05)>=4.5,selector+' doit conserver un contraste de 4,5:1');
    assert.match(style,/font-size:12px/);
  }
  assert.match(home,/\.ws-steps strong\{font-size:12px;/);assert.match(home,/\.ws-steps small\{font-size:12px;/);
  assert.match(home,/\.ws-setup-grid\{grid-template-columns:1fr;/,'Création / aide sur une colonne mobile');
});
