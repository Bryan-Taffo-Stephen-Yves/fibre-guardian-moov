/* SmartOffer : « Quel forfait pour moi ? ». Le client dit ce qu'il fait sur internet et combien de personnes vivent chez lui ;
   Guardian additionne le débit de chaque usage au moment où toute la maison est connectée, ajoute une marge, puis conseille
   le plus petit forfait de la grille qui suffit. Les débits viennent des recommandations publiques des services cités (SOURCES).
   Le même fichier sert au navigateur (window.FGSmartOffer) et aux tests Node (module.exports). */
(function(){
 'use strict';
 // Débit nécessaire pour une activité en cours, en Mb/s.
 const SOURCES=[
  {id:'netflix',text:'Netflix : 5 Mb/s pour un film en HD, 15 Mb/s en 4K (centre d’aide Netflix).'},
  {id:'zoom',text:'Zoom : 3,8 Mb/s pour une visio de groupe en 1080p (configuration requise Zoom).'},
  {id:'jeux',text:'Jeux en ligne : la partie elle-même demande peu (3 à 5 Mb/s), ce sont les mises à jour de 50 à 150 Go qui demandent du débit.'}
 ];
 const USES=[
  {id:'social',label:'WhatsApp et réseaux sociaux',hint:'Messages, appels, TikTok, Facebook',perPerson:2},
  {id:'films',label:'Films et séries',hint:'Netflix, YouTube, Canal+ en 4K',mbps:15,perScreens:true,source:'netflix'},
  {id:'jeux',label:'Jeux en ligne',hint:'Fortnite, Call of Duty, GTA, EA FC',mbps:5,download:30,source:'jeux'},
  {id:'visio',label:'Télétravail et visio',hint:'Zoom, Teams, Google Meet',mbps:4,perScreens:true,source:'zoom'},
  {id:'gros',label:'Gros téléchargements',hint:'Fichiers de travail, sauvegardes, logiciels',mbps:50}
 ];
 const MARGIN=1.3,GAME_GB=100,ROOMS_PER_BOX=2;
 // Grille publique de la fibre Moov (même liste que journey-store.cjs, vérifiée par smart-offer.test.cjs) : sert avant l'abonnement.
 const PLANS=[{id:'demo-50',name:'Fibre 50',mbps:50,price:15000},{id:'demo-100',name:'Fibre 100',mbps:100,price:20000},{id:'demo-200',name:'Fibre 200',mbps:200,price:25000},{id:'demo-300',name:'Fibre 300',mbps:300,price:30000},{id:'demo-500',name:'Fibre 500',mbps:500,price:60000}];
 // Zone fibre de la démonstration : les communes dessinées sur la carte d'Abidjan de l'application. La vraie couverture se vérifie à l'adresse.
 const ZONE=['Abobo','Adjamé','Attécoubé','Cocody','Koumassi','Marcory','Plateau','Port-Bouët','Treichville','Yopougon','Grand-Bassam'];
 const BUDGETS=[15000,20000,25000,30000];
 // Ce qu'on peut alléger pour tenir un budget, du plus facile au plus gênant.
 const TRIMS={films:'regardez en HD plutôt qu’en 4K (5 Mb/s au lieu de 15)',gros:'lancez les gros téléchargements la nuit',jeux:'lancez les mises à jour de jeux la nuit',visio:'coupez la caméra pendant les grandes réunions'};
 const screens=people=>Math.max(1,Math.ceil(people/2));

 // uses : identifiants choisis ; people : personnes dans le foyer (1 à 10) ; plans : grille triée du moins cher au plus cher.
 // rooms : pièces à couvrir en Wi-Fi ; budget : maximum par mois (0 = pas de limite) ; commune : facultatif.
 function recommend({uses=[],people=1,plans=PLANS,rooms=0,budget=0,commune=''}={}){
  const n=Math.min(10,Math.max(1,Math.round(Number(people)||1))),chosen=USES.filter(u=>uses.includes(u.id));
  if(!chosen.length||!plans.length)return null;
  const parts=[{id:'base',label:n+' personne'+(n>1?'s':'')+' sur leur téléphone',mbps:2*n}];
  for(const u of chosen){
   if(u.id==='social')continue;
   const count=u.perScreens?screens(n):1,mbps=u.mbps*count+(u.download||0);
   parts.push({id:u.id,label:u.id==='films'?count+' écran'+(count>1?'s':'')+' en 4K':u.id==='visio'?count+' visio'+(count>1?'s':'')+' en même temps':u.id==='jeux'?'Une partie en ligne et une mise à jour':'Un gros téléchargement',mbps});
  }
  const total=parts.reduce((s,p)=>s+p.mbps,0),need=Math.ceil(total*MARGIN),sorted=[...plans].sort((a,b)=>a.mbps-b.mbps);
  const plan=sorted.find(p=>p.mbps>=need)||sorted.at(-1);
  const ideal=plan,afford=budget>0&&plan.price>budget?[...sorted].reverse().find(p=>p.price<=budget)||sorted[0]:plan;
  const over=afford!==ideal?{ideal,trims:chosen.filter(u=>TRIMS[u.id]).map(u=>TRIMS[u.id])}:null;
  const r=Math.min(12,Math.max(0,Math.round(Number(rooms)||0))),extenders=r>ROOMS_PER_BOX?Math.ceil((r-ROOMS_PER_BOX)/ROOMS_PER_BOX):0;
  const inZone=!commune||ZONE.includes(commune);
  return {plan:afford,ideal,over,need,total,people:n,parts,rooms:r,extenders,commune,inZone,gameMinutes:Math.round(GAME_GB*8000/afford.mbps/60),sources:SOURCES.filter(s=>chosen.some(u=>u.source===s.id))};
 }
 const duration=min=>min<60?min+' min':Math.floor(min/60)+' h'+(min%60?' '+String(min%60).padStart(2,'0'):'');
 const api={USES,SOURCES,MARGIN,GAME_GB,ROOMS_PER_BOX,PLANS,ZONE,BUDGETS,recommend,duration};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof window!=='undefined')window.FGSmartOffer=api;
})();
