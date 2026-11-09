'use strict';
// SmartOffer (« Quel forfait pour moi ? ») : le forfait conseillé suit les usages et la taille du foyer, sur la vraie grille.
const {test}=require('node:test'),assert=require('node:assert/strict');
const SO=require('./smart-offer.js'),{PLANS}=require('./journey-store.cjs');
const fs=require('node:fs'),path=require('node:path');

test('Sans usage coché, Guardian ne conseille rien',()=>{
 assert.equal(SO.recommend({uses:[],people:3,plans:PLANS}),null);
});

test('Une personne qui fait WhatsApp et réseaux sociaux : le plus petit forfait suffit',()=>{
 const r=SO.recommend({uses:['social'],people:1,plans:PLANS});
 assert.equal(r.plan.mbps,50);assert.equal(r.parts.length,1);
});

test('Famille de 4 avec films et jeux : 100 Mb/s',()=>{
 const r=SO.recommend({uses:['social','films','jeux'],people:4,plans:PLANS});
 assert.equal(r.total,8+30+35);assert.equal(r.need,Math.ceil(73*SO.MARGIN));assert.equal(r.plan.mbps,100);
 assert.deepEqual(r.sources.map(s=>s.id),['netflix','jeux']);
});

test('Grand foyer qui joue, regarde, travaille et télécharge : 200 Mb/s',()=>{
 const r=SO.recommend({uses:['films','jeux','visio','gros'],people:5,plans:PLANS});
 assert.equal(r.plan.mbps,200);assert.ok(r.need<=200&&r.need>100);
});

test('Plus de monde ou plus d’usages ne fait jamais baisser le conseil',()=>{
 const all=SO.USES.map(u=>u.id);let last=0;
 for(let n=1;n<=10;n++){const m=SO.recommend({uses:all,people:n,plans:PLANS}).plan.mbps;assert.ok(m>=last);last=m;}
 assert.equal(SO.recommend({uses:all,people:10,plans:PLANS}).plan.mbps,300);
 assert.equal(SO.recommend({uses:all,people:10,plans:PLANS.slice(0,2)}).plan.mbps,100,'au-delà de la grille, on propose le plus rapide');
});

test('Temps de téléchargement d’un jeu de 100 Go',()=>{
 assert.equal(SO.recommend({uses:['jeux'],people:1,plans:PLANS}).gameMinutes,Math.round(800000/50/60));
 assert.equal(SO.duration(45),'45 min');assert.equal(SO.duration(133),'2 h 13');assert.equal(SO.duration(120),'2 h');
});

test('La page forfait charge SmartOffer avant plan-view',()=>{
 const boot=fs.readFileSync(path.join(__dirname,'bootstrap.js'),'utf8');
 assert.ok(boot.indexOf("'smart-offer.js'")>0&&boot.indexOf("'smart-offer.js'")<boot.indexOf("'plan-view.js'"));
 assert.match(fs.readFileSync(path.join(__dirname,'plan-view.js'),'utf8'),/Quel forfait pour moi \?/);
});

test('Avant l’abonnement, la grille de SmartOffer est la même que celle du serveur',()=>{
 assert.deepEqual(SO.PLANS,PLANS);
});

test('Budget trop court : le meilleur forfait possible, et ce qu’il faut alléger',()=>{
 const r=SO.recommend({uses:['films','jeux','visio','gros'],people:5,budget:20000});
 assert.equal(r.ideal.mbps,200);assert.equal(r.plan.mbps,100);assert.ok(r.plan.price<=20000);
 assert.ok(r.over.trims.some(t=>/HD/.test(t)));
 assert.equal(SO.recommend({uses:['social'],people:1,budget:20000}).over,null,'budget suffisant : aucun avertissement');
 assert.equal(SO.recommend({uses:['gros'],people:3,budget:1000}).plan.mbps,50,'budget sous la grille : le moins cher');
});

test('Wi-Fi : un répéteur toutes les 2 pièces au-delà de ce que couvre la box',()=>{
 const n=rooms=>SO.recommend({uses:['social'],rooms}).extenders;
 assert.deepEqual([1,2,3,4,5,6].map(n),[0,0,1,1,2,2]);
});

test('Commune hors de la zone fibre : on le dit au lieu de vendre',()=>{
 assert.equal(SO.recommend({uses:['social'],commune:'Cocody'}).inZone,true);
 assert.equal(SO.recommend({uses:['social'],commune:'Autre'}).inZone,false);
 assert.equal(SO.recommend({uses:['social']}).inZone,true,'commune facultative');
});

test('La page d’accueil publique propose aussi « Quel forfait ? »',()=>{
 const landing=fs.readFileSync(path.join(__dirname,'landing.js'),'utf8');
 assert.match(landing,/P\.Finder/);assert.match(landing,/#offre/);
});
