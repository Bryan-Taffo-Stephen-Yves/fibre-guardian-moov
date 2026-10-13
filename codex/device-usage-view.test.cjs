'use strict';
// Tests des éléments et callbacks React, sans navigateur, réseau ni base de données.
// Ce harnais ne remplace pas les tests visuels : il vérifie les comportements de la vue.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'device-usage-view.js'),'utf8');
function fixture(){
 const devices=[
  {id:'phone',name:'iPhone protégé',currentMbps:5,bytes:null,observedMs:0,protected:true,recognized:true,present:true,connected:true},
  {id:'tv',name:'LG TV du salon',currentMbps:20,bytes:1000000000,observedMs:60000,protected:false,recognized:true,present:true,connected:true},
  {id:'old',name:'Ancien appareil invité',currentMbps:null,bytes:250000000,observedMs:30000,protected:false,recognized:false,present:false,connected:false}
 ];
 return {context:'developers',devices,summary:{currentMbps:25,capacityMbps:100,bytes:1250000000,connected:2,observedMs:60000,coverageRatio:.0007},buckets:[{at:Date.UTC(2026,9,11,12),end:Date.UTC(2026,9,11,13),bytes:null,observedMs:0,devices:{}},{at:Date.UTC(2026,9,11,13),end:Date.UTC(2026,9,11,14),bytes:1250000000,observedMs:60000,devices:{tv:1000000000,old:250000000}}],advice:{title:'Observer avant de décider',body:'Aucun blocage ni achat automatique.'}};
}
function harness(options={}){
 let current=null,root=null,props;
 const cells=new Map(),effects=[],timers=new Map(),apiCalls=[],actions=[],confirmations=[],questions=[];
 let sequence=0;
 function cell(){const position=current.index++;if(!current.cells[position])current.cells[position]={};return current.cells[position];}
 const React={
  Fragment:Symbol('Fragment'),
  createElement(type,properties,...children){return {type,props:properties||{},children:children.flat(Infinity).filter(v=>v!==null&&v!==undefined&&typeof v!=='boolean')};},
  useState(initial){const item=cell();if(!item.initialized){item.value=typeof initial==='function'?initial():initial;item.initialized=true;}return [item.value,value=>{item.value=typeof value==='function'?value(item.value):value;}];},
  useRef(initial){const item=cell();return item.ref||(item.ref={current:initial});},
  useEffect(effect,deps){const item=cell();if(!item.deps||deps.some((v,i)=>!Object.is(v,item.deps[i]))){item.deps=[...deps];effects.push(()=>{item.cleanup?.();item.cleanup=effect();});}}
 };
 function component(type,input,key){const parent=current;current={cells:cells.get(key)||[],index:0};cells.set(key,current.cells);try{return type(input);}finally{current=parent;}}
 function materialize(node,key){
  if(node===null||node===undefined||typeof node==='boolean')return null;
  if(typeof node!=='object')return node;
  if(Array.isArray(node))return node.map((child,index)=>materialize(child,key+'/'+index)).flat(Infinity);
  if(typeof node.type==='function')return materialize(component(node.type,{...node.props,children:node.children},key),key+'/component');
  return {...node,children:node.children.map((child,index)=>materialize(child,key+'/'+index)).flat(Infinity).filter(v=>v!==null)};
 }
 const context={React,window:{},Intl,Date,setInterval(fn){const id=++sequence;timers.set(id,fn);return id;},clearInterval(id){timers.delete(id);}};
 vm.runInNewContext(source,context,{filename:'device-usage-view.js'});
 const data=options.data||fixture();
 props={api:async url=>{apiCalls.push(url);return options.api?options.api(url):structuredClone(data);},state:{version:1,usual:4,metrics:{used:25,capacity:100},devices:data.devices.filter(d=>d.present).map(d=>({...d,mbps:d.currentMbps}))},busy:false,onAction:(...args)=>actions.push(args),onAsk:text=>questions.push(text),onConfirm:value=>confirmations.push(value),...options.props};
 function render(){root=materialize(component(context.window.FGDevices.View,props,'root'),'tree');return root;}
 function flushEffects(){while(effects.length)effects.shift()();}
 async function settle(){render();flushEffects();await new Promise(resolve=>setImmediate(resolve));render();flushEffects();return root;}
 return {render,settle,flushEffects,timers,apiCalls,actions,confirmations,questions,get tree(){return root;},setProps(next){props={...props,...next};}};
}
function all(node,predicate){if(node===null||node===undefined||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(child=>all(child,predicate));return [...(predicate(node)?[node]:[]),...node.children.flatMap(child=>all(child,predicate))];}
function text(node){if(node===null||node===undefined)return '';if(typeof node!=='object')return String(node);if(Array.isArray(node))return node.map(text).join('');return node.children.map(text).join('');}
const tag=(root,name)=>all(root,node=>node.type===name);
const namedButton=(root,label)=>tag(root,'button').find(node=>(node.props['aria-label']||text(node))===label);
const article=(root,name)=>tag(root,'article').find(node=>text(node).includes(name));

test('Les appareils absents conservent leur volume sans proposer de commande',async()=>{
 const app=harness();await app.settle();const row=article(app.tree,'Ancien appareil invité');assert.ok(row,'L’appareil historique doit rester visible');
 assert.match(text(row),/historique conservé/);assert.match(text(row),/250 Mo/);assert.match(text(row),/— Mbps/);
 assert.equal(namedButton(row,'Gérer'),undefined);assert.equal(namedButton(row,'Rétablir'),undefined);assert.equal(namedButton(row,'Reconnaître'),undefined);
 namedButton(row,'Détails de Ancien appareil invité').props.onClick();await app.settle();assert.match(text(app.tree),/Graphique filtré sur Ancien appareil invité/);assert.equal(app.actions.length,0);assert.equal(app.confirmations.length,0);
});
test('Un appareil protégé est consultable mais ne propose jamais de blocage',async()=>{
 const app=harness();await app.settle();const row=article(app.tree,'iPhone protégé');assert.match(text(row),/Protégé/);assert.equal(namedButton(row,'Gérer'),undefined);assert.equal(namedButton(row,'Rétablir'),undefined);
 namedButton(row,'Détails de iPhone protégé').props.onClick();await app.settle();assert.match(text(article(app.tree,'iPhone protégé')),/aucune réduction ou coupure/);assert.equal(app.actions.length,0);
});
test('Un volume absent reste inconnu, le graphique ne le transforme pas en zéro',async()=>{
 const data=fixture();data.summary.bytes=null;data.summary.observedMs=0;data.summary.coverageRatio=0;data.buckets=[data.buckets[0]];
 const app=harness({data});await app.settle();const card=tag(app.tree,'section').find(node=>text(node).startsWith('Données sur la période'));assert.equal(text(tag(card,'strong')[0]),'—');
 const row=article(app.tree,'iPhone protégé');assert.match(text(row),/—Sans relevé historique/);
 const chartGroup=all(app.tree,node=>node.props['aria-label']==='Volumes par intervalle. Sélectionnez une barre pour voir le détail.')[0];assert.equal(tag(chartGroup,'button').length,1);assert.match(tag(chartGroup,'button')[0].props['aria-label'],/aucun relevé/);assert.match(text(app.tree),/Aucun volume passé n’est inventé/);
});
test('Les trois périodes changent le paramètre API et gardent une seule sélection',async()=>{
 const app=harness();await app.settle();
 for(const [label,key] of [['1 heure','1h'],['7 jours','7d'],['24 heures','24h']]){
  const group=all(app.tree,node=>node.props['aria-label']==='Période de consommation')[0];assert.equal(tag(group,'button').length,3);namedButton(group,label).props.onClick();await app.settle();
  const buttons=tag(all(app.tree,node=>node.props['aria-label']==='Période de consommation')[0],'button');assert.equal(buttons.filter(node=>node.props['aria-pressed']).length,1);assert.equal(text(buttons.find(node=>node.props['aria-pressed'])),label);assert.equal(app.apiCalls.at(-1),'/journey/usage?window='+key);
 }
});
test('Le contexte sélectionné vient du serveur et ne change qu’après confirmation',async()=>{
 const app=harness();await app.settle();let select=tag(app.tree,'select')[0];assert.equal(select.props.value,'developers');assert.equal(select.props.disabled,false);
 select.props.onChange({target:{value:'work'}});assert.equal(app.confirmations.length,1);assert.equal(app.actions.length,0);assert.match(app.confirmations[0].body,/jamais les limites/);
 await app.settle();assert.equal(tag(app.tree,'select')[0].props.value,'developers');app.confirmations[0].run();assert.equal(app.actions[0][0],'usage-context');assert.equal(app.actions[0][1].value,'work');assert.equal(app.actions[0][1].confirm,true);
 app.setProps({busy:true});await app.settle();assert.equal(tag(app.tree,'select')[0].props.disabled,true);
});
test('Gérer un appareil actif prépare une confirmation, jamais une coupure implicite',async()=>{
 const app=harness();await app.settle();namedButton(article(app.tree,'LG TV du salon'),'Gérer').props.onClick();assert.equal(app.actions.length,0);assert.equal(app.confirmations.length,1);assert.match(app.confirmations[0].title,/Bloquer LG TV/);
 app.confirmations[0].run();assert.equal(app.actions[0][0],'device');assert.equal(app.actions[0][1].id,'tv');assert.equal(app.actions[0][1].action,'block');assert.equal(app.actions[0][1].confirm,true);
});
test('Le rafraîchissement attend la requête active et les erreurs deviennent visibles',async()=>{
 let reject;const app=harness({api:()=>new Promise((_,no)=>{reject=no;})});app.render();app.flushEffects();assert.equal(app.apiCalls.length,1);
 for(let i=0;i<3;i++)for(const timer of app.timers.values())timer();assert.equal(app.apiCalls.length,1,'Aucune seconde requête pendant la première');
 reject(new Error('Serveur de test indisponible'));await Promise.resolve();await app.settle();const alert=all(app.tree,node=>node.props.role==='alert')[0];assert.equal(text(alert),'Serveur de test indisponible');
});
