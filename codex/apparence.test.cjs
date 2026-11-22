'use strict';
// Réglage « Apparence » : Clair par défaut, choix gardé dans localStorage (fg-apparence), posé sur <html data-theme>.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
function load(storage){
 const attrs={},context={window:{},document:{documentElement:{setAttribute(k,v){attrs[k]=v;}}}};
 if(storage!==undefined)context.localStorage=storage;
 vm.runInNewContext(read('apparence.js'),context);return {A:context.window.FGApparence,attrs};
}
function memory(init){const m=new Map(Object.entries(init||{}));return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),m};}
test('Sans choix enregistré, l’application est en Clair dès le chargement',()=>{
 const {A,attrs}=load(memory());assert.equal(A.read(),'light');assert.equal(attrs['data-theme'],'light');
});
test('Le choix est gardé dans fg-apparence et appliqué au chargement suivant',()=>{
 const store=memory(),{A,attrs}=load(store);
 assert.equal(A.save('dark'),'dark');assert.equal(store.m.get('fg-apparence'),'dark');assert.equal(attrs['data-theme'],'dark');
 assert.equal(load(store).attrs['data-theme'],'dark');
 A.save('auto');assert.equal(load(store).attrs['data-theme'],'auto');
});
test('Une valeur inconnue ou un stockage bloqué ramène en Clair',()=>{
 assert.equal(load(memory({'fg-apparence':'violet'})).attrs['data-theme'],'light');
 const blocked={getItem(){throw new Error('bloqué');},setItem(){throw new Error('bloqué');}};
 const {A,attrs}=load(blocked);assert.equal(attrs['data-theme'],'light');assert.equal(A.save('dark'),'dark');assert.equal(attrs['data-theme'],'dark');
 assert.equal(load(undefined).attrs['data-theme'],'light');
});
test('Le script est chargé dans le <head> avant les styles, et gardé hors ligne',()=>{
 const html=read('index.html'),head=html.slice(0,html.indexOf('</head>'));
 assert.ok(head.includes('<script src="apparence.js"></script>'));
 assert.ok(head.indexOf('apparence.js')<head.indexOf('rel="stylesheet"'));
 assert.match(read('sw.js'),/'\.\/apparence\.js'/);
});
test('Mon compte propose Clair, Sombre et Automatique',()=>{
 const src=read('client-home.js');
 assert.match(src,/\['light','Clair'\],\['dark','Sombre'\],\['auto','Automatique'\]/);
 assert.match(src,/h\(Apparence\)/);
});
test('data-mode dit ce qui s’affiche : Automatique suit le téléphone',()=>{
 const run=(choice,dark)=>{const attrs={},ctx={window:{matchMedia:()=>({matches:dark,addEventListener(){}})},document:{documentElement:{setAttribute(k,v){attrs[k]=v;}}},localStorage:memory({'fg-apparence':choice})};ctx.window.matchMedia=ctx.window.matchMedia;ctx.matchMedia=ctx.window.matchMedia;vm.runInNewContext(read('apparence.js'),ctx);return attrs['data-mode'];};
 assert.equal(run('light',true),'light');assert.equal(run('dark',false),'dark');
 assert.equal(run('auto',true),'dark');assert.equal(run('auto',false),'light');
});
