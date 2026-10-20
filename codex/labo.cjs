'use strict';
// Labo réseau de l'équipe Moov : ce que voit un technicien fibre sur son ordinateur.
// Centrale (OLT), ports PON, box (ONT) une par une, réflectomètre (OTDR) et console d'alarmes.
// Rien n'est stocké : chaque mesure est recalculée à partir de l'état des quartiers (noc_segments, donc du simulateur)
// et d'un tirage fixe par box. Les mêmes entrées donnent toujours les mêmes chiffres, historique compris.
// Valeurs de référence : GPON classe C+ (OLT +4,5 dBm, budget 32 dB), 1490 nm descendant, 1310 nm montant.
const O=require('./operator-store.cjs'),{insist}=require('./pilot-model.cjs');

const STEP=2000,HISTORY=60,ONTS=20,BRANCH=5;
const OLT_TX=4.5,ONT_TX=2.3,BUDGET=32,RX_WARN=-25,RX_ALARM=-27,RX_SENS=-28;
const KM={1310:.35,1490:.28,1550:.22};
const SPLIT={cabinet:7.3,pole:10.6},CONNECTOR=.3,SPLICE=.06;
// Nombre de box en ligne pour chaque panne du simulateur (mêmes valeurs que noc-store.cjs).
const ONLINE={fiber:8,pole:10,power:0,congestion:20,works:6,flood:4,theft:7,olt:0,normal:20};
const ALARMS={
 NONE:{code:'—',label:'Aucune alarme',severity:'info'},
 LOS:{code:'LOS',label:'Perte de lumière sur une partie du port',severity:'critique'},
 LOS_WORKS:{code:'LOS',label:'Perte de lumière · chantier signalé',severity:'critique'},
 DYING_GASP:{code:'DGi',label:'Dernier souffle des box : coupure de courant',severity:'majeure'},
 UPLINK_HIGH:{code:'UPL-HI',label:'Liaison de collecte saturée',severity:'majeure'},
 WATER:{code:'ATT-HI',label:'Affaiblissement anormal · capteur d’eau',severity:'critique'},
 INTRUSION:{code:'LOS',label:'Perte de lumière · boîtier ouvert',severity:'critique'},
 OLT_DOWN:{code:'BRD-F',label:'Carte GPON hors service',severity:'critique'},
 UPSTREAM:{code:'BRD-F',label:'Coupé par la carte GPON de la commune',severity:'critique'}
};
const FIBRE_CUT=['LOS','LOS_WORKS','INTRUSION'];

// Tirage fixe : même clé, même nombre entre 0 et 1.
function hash(text){let x=2166136261;for(const c of String(text)){x^=c.charCodeAt(0);x=Math.imul(x,16777619);}x^=x>>>16;x=Math.imul(x,2246822507);x^=x>>>13;x=Math.imul(x,3266489909);x^=x>>>16;return x>>>0;}
const rnd=key=>hash(key)/4294967296;
const pick=(key,min,max)=>min+(max-min)*rnd(key);
// Bruit doux : on glisse d'un tirage au suivant, pour des courbes qui bougent sans sauter.
function drift(key,t,period){const k=Math.floor(t/period),f=t/period-k,s=f*f*(3-2*f);return rnd(key+':'+k)*(1-s)+rnd(key+':'+(k+1))*s;}
const round=(v,d=1)=>Math.round(v*10**d)/10**d;
// Heure d'Abidjan (UTC) : creux la nuit, pic le soir.
function load(t){const hour=new Date(t).getUTCHours()+new Date(t).getUTCMinutes()/60;return .22+.55*Math.exp(-((hour-21)**2)/10)+.25*Math.exp(-((hour-13)**2)/8);}

// Plan physique d'un quartier : armoire de rue (coupleur 1:4), quatre poteaux (coupleur 1:8), vingt box.
function plant(segmentId){
 const feeder=round(pick(segmentId+':feeder',1.1,3.6),2);
 const branches=[0,1,2,3].map(b=>round(pick(segmentId+':branch'+b,.18,.95),2));
 const dirty=rnd(segmentId+':dirty')<.62?Math.floor(pick(segmentId+':dirty-ont',0,ONTS)):-1;
 const bend=rnd(segmentId+':bend')<.38?Math.floor(pick(segmentId+':bend-ont',0,ONTS)):-1;
 const onts=Array.from({length:ONTS},(_,n)=>{
  const branch=Math.floor(n/BRANCH),drop=round(pick(segmentId+':drop'+n,.02,.26),3),km=round(feeder+branches[branch]+drop,3);
  // Petites différences de pose (connecteurs, soudures) : aucune box n'a exactement la même lumière.
  const extra=pick(segmentId+':var'+n,0,3.4)+(n===dirty?pick(segmentId+':dirty-db',7.2,9.4):n===bend?pick(segmentId+':bend-db',2.6,4.2):0);
  const plan=[100,100,200,200,200,500][Math.floor(pick(segmentId+':plan'+n,0,6))];
  return {n:n+1,branch:branch+1,km,extra,flawDb:n===dirty||n===bend?extra-pick(segmentId+':var'+n,0,3.4):0,flaw:n===dirty?'dirty':n===bend?'bend':null,plan,serial:'HWTC'+hash(segmentId+':sn'+n).toString(16).toUpperCase().padStart(8,'0'),boot:pick(segmentId+':boot'+n,2,41)*86400000};
 });
 return {feeder,branches,onts};
}
// Perte optique de l'OLT jusqu'à la box, à une longueur d'onde donnée.
function loss(ont,nm){const bendFactor=ont.flaw==='bend'?(nm===1550?1.9:nm===1490?1.3:1):1;return ont.km*KM[nm]+SPLIT.cabinet+SPLIT.pole+4*CONNECTOR+Math.ceil(ont.km/2)*SPLICE+(ont.extra-ont.flawDb)+ont.flawDb*bendFactor;}

// Ordre de chute : une coupure prend d'abord les branches les plus lointaines, poteau par poteau.
function downSet(segmentId,count){
 const order=[...Array(ONTS).keys()].sort((a,b)=>Math.floor(b/BRANCH)-Math.floor(a/BRANCH)||rnd(segmentId+':o'+a)-rnd(segmentId+':o'+b));
 return new Set(order.slice(0,Math.max(0,ONTS-count)));
}

// État d'un quartier à l'instant t. Avant le dernier changement du simulateur, le quartier était normal.
function stateAt(seg,change,t){return change&&t<change.at?{alarm:change.before,online:change.beforeOnline,latency:change.before==='UPLINK_HIGH'?110:change.before==='NONE'?18:95}:{alarm:seg.alarm,online:seg.online,latency:seg.latency};}

function ontAt(seg,p,ont,st,t){
 const down=downSet(seg.id,st.online).has(ont.n-1);
 const water=st.alarm==='WATER'&&!down?pick(seg.id+':water'+ont.n,8.6,10.8):0;
 const rxBox=OLT_TX-loss(ont,1490)-water+(drift(seg.id+':rx'+ont.n,t,9000)-.5)*.18;
 const rxOlt=ONT_TX-loss(ont,1310)-water+(drift(seg.id+':rxo'+ont.n,t,11000)-.5)*.22;
 let status='online';
 if(down)status=st.alarm==='DYING_GASP'?'dying':['OLT_DOWN','UPSTREAM'].includes(st.alarm)?'olt':'los';
 else if(rxBox<RX_ALARM)status='weak';
 else if(rxBox<RX_WARN)status='warn';
 const live=status!=='los'&&status!=='dying'&&status!=='olt';
 const busy=st.alarm==='UPLINK_HIGH'?.92:load(t)*(.35+.65*drift(seg.id+':use'+ont.n,t,6000));
 const down_=live?round(Math.min(ont.plan,ont.plan*busy*(st.alarm==='UPLINK_HIGH'?1:.55)),1):0;
 const margin=rxBox-RX_SENS;
 const fec=live?Math.round(margin<3?400+(3-margin)*900:margin<6?20+(6-margin)*40:drift(seg.id+':fec'+ont.n,t,4000)*6):0;
 return {
  n:ont.n,branch:ont.branch,serial:ont.serial,plan:ont.plan,km:ont.km,distance:Math.round(ont.km*1000),status,flaw:ont.flaw,
  rx:live?round(rxBox,2):null,rxOlt:live?round(rxOlt,2):null,tx:live?round(ONT_TX+(rnd(seg.id+':tx'+ont.n)-.5)*.5,2):null,
  temperature:live?round(41+rnd(seg.id+':temp'+ont.n)*9+load(t)*4,1):null,voltage:live?round(3.29+rnd(seg.id+':v'+ont.n)*.04,2):null,bias:live?round(9+rnd(seg.id+':bias'+ont.n)*6,1):null,
  down:down_,up:live?round(down_*(.12+rnd(seg.id+':upr'+ont.n)*.1),1):0,fec,bip:live&&margin<3?Math.round((3-margin)*14):0,
  since:down&&seg._change?seg._change.at:null
 };
}

function portAt(seg,p,change,t){
 const st=stateAt(seg,change,t),onts=p.onts.map(o=>ontAt(seg,p,o,st,t)),live=onts.filter(o=>o.rx!==null);
 const downMbps=live.reduce((n,o)=>n+o.down,0),upMbps=live.reduce((n,o)=>n+o.up,0);
 return {st,onts,live:live.length,rxAvg:live.length?round(live.reduce((n,o)=>n+o.rx,0)/live.length,2):null,rxMin:live.length?Math.min(...live.map(o=>o.rx)):null,
  fec:live.reduce((n,o)=>n+o.fec,0),downMbps:round(downMbps,0),upMbps:round(upMbps,0),utilisation:round(Math.min(99.4,st.alarm==='UPLINK_HIGH'?96+drift(seg.id+':sat',t,5000)*3.2:downMbps/2488*100),1),
  latency:round(st.latency+(drift(seg.id+':lat',t,5000)-.5)*(st.alarm==='UPLINK_HIGH'?30:3),1)};
}

// Derniers changements du simulateur, par quartier, avec l'état d'avant (pour dessiner l'historique).
const SCENARIO_ALARM={fiber:'LOS',pole:'LOS',power:'DYING_GASP',congestion:'UPLINK_HIGH',works:'LOS_WORKS',flood:'WATER',theft:'INTRUSION',olt:'OLT_DOWN',normal:'NONE'};
function changes(s,segments){
 const seen={},commune=id=>(segments.find(g=>g.id===id)?.zone||'').split(' · ')[0];
 const rows=s.all("SELECT kind,detail,public_text,at FROM noc_events WHERE incident_id IS NULL AND kind IN ('simulation','telemetry.recovered') ORDER BY at DESC,rowid DESC LIMIT 160");
 for(const r of rows){
  const d=JSON.parse(r.detail||'{}');let targets=[],alarm='NONE',online=20;
  if(r.kind==='simulation'){targets=d.scenario==='olt'?segments.filter(g=>commune(g.id)===commune(d.segment)).map(g=>g.id):[d.segment];alarm=SCENARIO_ALARM[d.scenario]||'NONE';online=ONLINE[d.scenario]??20;}
  else targets=segments.filter(g=>r.public_text.includes(g.id)).map(g=>g.id);
  for(const id of targets){(seen[id]||=[]);if(seen[id].length<2)seen[id].push({at:r.at,alarm:id===d.segment||r.kind!=='simulation'?alarm:'UPSTREAM',online:r.kind==='simulation'?online:20});}
 }
 const out={};
 for(const [id,[last,prev]] of Object.entries(seen))out[id]={at:last.at,before:prev?prev.alarm:'NONE',beforeOnline:prev?prev.online:20};
 return out;
}

function otdr(seg,p,st,nm){
 // On vise la branche la plus longue : celle qu'un technicien mesure en premier.
 const branch=p.branches.indexOf(Math.max(...p.branches)),end=round(p.feeder+p.branches[branch]+.2,3),k=KM[nm];
 const bendOnt=p.onts.find(o=>o.flaw==='bend'&&o.branch===branch+1);
 const events=[
  {km:0,kind:'connector',label:'Connecteur de départ (répartiteur de la centrale)',loss:.32,reflect:-52},
  ...Array.from({length:Math.floor(p.feeder/2)},(_,i)=>({km:2*(i+1),kind:'splice',label:'Épissure de câble',loss:SPLICE,reflect:null})),
  {km:p.feeder,kind:'splitter',label:'Armoire de rue · coupleur 1:4',loss:SPLIT.cabinet,reflect:-55},
  {km:round(p.feeder+p.branches[branch],3),kind:'splitter',label:'Poteau '+(branch+1)+' · coupleur 1:8',loss:SPLIT.pole,reflect:-55}
 ];
 if(bendOnt)events.push({km:round(p.feeder+p.branches[branch]+.05,3),kind:'bend',label:'Courbure trop serrée vers la box '+bendOnt.n,loss:round(bendOnt.flawDb*(nm===1550?1.9:1),2),reflect:null});
 let fault=null;
 if(FIBRE_CUT.includes(st.alarm)){const at=round(p.feeder+p.branches[branch]*pick(seg.id+':cut',.3,.8),3);fault={km:at,kind:'break',label:st.alarm==='LOS_WORKS'?'Fibre coupée (chantier)':st.alarm==='INTRUSION'?'Fibre coupée (câble arraché)':'Fibre coupée',loss:null,reflect:-14};}
 if(st.alarm==='WATER'){const at=round(p.feeder*.62,3);fault={km:at,kind:'water',label:'Eau dans le boîtier d’épissure',loss:nm===1550?11.6:9.4,reflect:null};}
 if(fault)events.push(fault);
 events.sort((a,b)=>a.km-b.km);
 if(fault?.kind==='break')events.splice(events.indexOf(fault)+1);
 // Trace : niveau rétrodiffusé (dB) en fonction de la distance, avec le bruit qui grandit au loin.
 const points=[],stepKm=end/360;let level=0,cursor=0,cut=false;
 for(let i=0;i<=360;i++){
  const km=i*stepKm;
  while(cursor<events.length&&events[cursor].km<=km){const e=events[cursor];if(cut){cursor++;continue;}if(e.kind==='break'){cut=true;points.push([round(e.km,3),round(level+4.5,2)]);points.push([round(e.km+stepKm*.6,3),round(-25.5,2)]);}else{if(e.reflect!==null&&e.km>0)points.push([round(e.km,3),round(level+1.4,2)]);level-=e.loss;}cursor++;}
  if(cut){points.push([round(km,3),round(-26-rnd(seg.id+':nz'+i+nm)*2.4,2)]);continue;}
  level-=k*stepKm;
  const noise=(rnd(seg.id+':n'+i+nm)-.5)*(.04+km/end*.5);
  points.push([round(km,3),round(level+noise,2)]);
 }
 if(!cut){const last=points.at(-1);points.push([last[0],round(last[1]+3,2)],[round(end,3),-26.4]);}
 const total=round(events.filter(e=>e.loss!==null&&(!fault||fault.kind!=='break'||e.km<fault.km)).reduce((n,e)=>n+e.loss,0)+k*(fault?.kind==='break'?fault.km:end),2);
 const verdict=fault?.kind==='break'?'La lumière s’arrête net à '+fmtKm(fault.km)+' : la fibre est coupée à cet endroit. L’équipe peut aller directement au bon poteau.':
  fault?.kind==='water'?'Une marche de '+fault.loss+' dB à '+fmtKm(fault.km)+', sans pic : l’eau a envahi le boîtier d’épissure. Il faut le vider et refaire les soudures.':
  st.alarm==='DYING_GASP'?'La fibre est intacte jusqu’au bout. Les box se sont éteintes faute de courant : inutile d’envoyer une équipe fibre.':
  ['OLT_DOWN','UPSTREAM'].includes(st.alarm)?'La fibre est intacte. La panne vient de la carte GPON dans la centrale, pas du câble.':
  st.alarm==='UPLINK_HIGH'?'La fibre est intacte. Le ralentissement vient de la liaison de collecte, côté centrale.':
  bendOnt?'Fibre en bon état, mais une petite marche près de la box '+bendOnt.n+' : un câble trop plié. Elle grandit à 1550 nm, c’est le signe d’une courbure.':
  'Fibre en bon état, du départ jusqu’au dernier poteau. Pertes conformes au plan.';
 return {nm,end,branch:branch+1,points,events,fault,total,budget:BUDGET,verdict,pulse:'100 ns',range:'10 km',averaging:'30 s'};
}
const fmtKm=km=>km<1?Math.round(km*1000)+' m':String(round(km,2)).replace('.',',')+' km';

// Console : les vrais événements du simulateur et des dossiers, plus la vie ordinaire d'un réseau.
function console_(s,segments,ports,now){
 const name=id=>segments.find(g=>g.id===id),port=id=>ports.find(p=>p.id===id);
 const out=[];
 for(const r of s.all("SELECT kind,detail,public_text,at,incident_id FROM noc_events WHERE at>? AND kind IN ('simulation','telemetry.recovered','detected','plan.proposed','approved','dispatched','resolved') ORDER BY at DESC LIMIT 40",now-3600000)){
  const d=JSON.parse(r.detail||'{}');
  if(r.kind==='simulation'){const g=name(d.segment),p=port(d.segment);if(!g)continue;const a=ALARMS[SCENARIO_ALARM[d.scenario]||'NONE'];
   out.push(d.scenario==='normal'?{at:r.at,severity:'info',code:'CLR',equipment:p.olt+' '+p.pon,text:'Alarmes levées sur '+g.zone+'. Les box se reconnectent.'}:{at:r.at,severity:a.severity,code:a.code,equipment:p.olt+' '+p.pon,text:a.label+' · '+g.zone+' ('+(ONTS-ONLINE[d.scenario])+' box)'});continue;}
  const text={'telemetry.recovered':['info','CLR','Mesures revenues à la normale.'],detected:['majeure','INC','Dossier ouvert par Guardian sur les mesures.'],'plan.proposed':['info','PLAN','Plan d’intervention prêt, en attente de validation.'],approved:['info','OK','Plan validé par un responsable.'],dispatched:['info','DSP','Équipe terrain affectée.'],resolved:['info','RÉT','Rétablissement vérifié sur les mesures.']}[r.kind];
  if(text)out.push({at:r.at,severity:text[0],code:text[1],equipment:'Supervision',text:r.public_text||text[2]});
 }
 // Vie ordinaire : un petit événement de temps en temps, toujours le même pour une fenêtre donnée.
 const warn=ports.flatMap(p=>p.flagged.map(o=>({p,o})));
 for(let w=Math.floor(now/6000);w>Math.floor(now/6000)-40;w--){
  if(rnd('amb'+w)>.5)continue;
  const at=w*6000+Math.floor(rnd('amb-at'+w)*5000),p=ports[Math.floor(rnd('amb-p'+w)*ports.length)],o=Math.floor(rnd('amb-o'+w)*ONTS)+1,kind=Math.floor(rnd('amb-k'+w)*7);
  if(p.alarm!=='NONE'&&kind!==5)continue;
  const f=warn.length?warn[Math.floor(rnd('amb-w'+w)*warn.length)]:null;
  const line=[
   ()=>f&&{severity:'mineure',code:'RX-LO',equipment:f.p.olt+' '+f.p.pon+':'+f.o.n,text:'Signal de la box '+f.o.n+' à '+String(f.o.rx).replace('.',',')+' dBm, proche du seuil.'},
   ()=>({severity:'info',code:'LOFi',equipment:p.olt+' '+p.pon+':'+o,text:'Box '+o+' reconnectée après une micro-coupure de 2 s.'}),
   ()=>({severity:'info',code:'NTP',equipment:p.olt,text:'Horloge synchronisée.'}),
   ()=>f&&{severity:'mineure',code:'FEC',equipment:f.p.olt+' '+f.p.pon,text:'Erreurs corrigées en hausse sur la box '+f.o.n+' ('+f.o.fec+'/s).'},
   ()=>({severity:'info',code:'DBA',equipment:p.olt+' '+p.pon+':'+o,text:'Profil de débit '+(p.onts?.[o-1]?.plan||100)+' Mbit/s réappliqué à la box '+o+'.'}),
   ()=>({severity:'info',code:'BKP',equipment:p.olt,text:'Sauvegarde de la configuration terminée.'}),
   ()=>({severity:'info',code:'RX',equipment:p.olt+' '+p.pon,text:'Relevé de lumière des 20 box terminé · '+p.zone+'.'})
  ][kind]();
  if(line&&at<=now)out.push({at,...line});
 }
 return out.sort((a,b)=>b.at-a.at).slice(0,40);
}

function snapshot(s,uid,q={},now=Date.now()){
 O.requireOperator(s,uid);
 const segments=s.all('SELECT * FROM noc_segments ORDER BY rowid'),plans=Object.fromEntries(segments.map(g=>[g.id,plant(g.id)])),change=changes(s,segments);
 const communes=[...new Set(segments.map(g=>g.zone.split(' · ')[0]))];
 const selected=segments.find(g=>g.id===q.segment)?.id||segments.find(g=>g.alarm!=='NONE')?.id||segments[0].id;
 const ports=segments.map(g=>{
  g._change=change[g.id]&&change[g.id].at>now-86400000?change[g.id]:null;
  const commune=g.zone.split(' · ')[0],siblings=segments.filter(x=>x.zone.split(' · ')[0]===commune),cur=portAt(g,plans[g.id],null,now);
  const hist=Array.from({length:HISTORY},(_,i)=>{const t=now-(HISTORY-1-i)*STEP,v=portAt(g,plans[g.id],g._change,t);return {rx:v.rxAvg,down:v.downMbps,online:v.live,fec:v.fec};});
  const flagged=cur.onts.filter(o=>['warn','weak'].includes(o.status));
  return {id:g.id,zone:g.zone,commune,olt:'OLT '+commune,pon:'0/1/'+(siblings.indexOf(g)+1),alarm:g.alarm,alarmInfo:ALARMS[g.alarm]||ALARMS.NONE,total:g.total,online:cur.live,rxAvg:cur.rxAvg,rxMin:cur.rxMin,fec:cur.fec,downMbps:cur.downMbps,upMbps:cur.upMbps,utilisation:cur.utilisation,latency:cur.latency,
   since:g._change&&g.alarm!=='NONE'?g._change.at:null,history:hist,flagged:flagged.map(o=>({n:o.n,rx:o.rx,fec:o.fec,flaw:o.flaw,status:o.status})),dots:cur.onts.map(o=>o.status),rxs:cur.onts.map(o=>o.rx),onts:selected===g.id?cur.onts:undefined,feeder:plans[g.id].feeder,branches:plans[g.id].branches,
   tone:g.alarm!=='NONE'?(cur.live===0||FIBRE_CUT.includes(g.alarm)||g.alarm==='WATER'?'down':'warn'):flagged.some(o=>o.status==='weak')?'warn':'ok'};
 });
 const olts=communes.map(c=>{
  const mine=ports.filter(p=>p.commune===c),dead=mine.some(p=>p.alarm==='OLT_DOWN'),hot=mine.some(p=>p.alarm==='UPLINK_HIGH'),uplink=mine.reduce((n,p)=>n+p.downMbps,0);
  return {name:'OLT '+c,commune:c,ports:mine.map(p=>p.pon),cpu:round(dead?0:16+drift('cpu'+c,now,7000)*14+(hot?48:0),0),temperature:round(dead?0:43+drift('t'+c,now,20000)*6+load(now)*3,1),
   uplink:round(Math.min(99.5,hot?96+drift('u'+c,now,5000)*3:uplink/10000*100),1),uplinkMbps:round(hot?9700+drift('u'+c,now,5000)*250:uplink,0),fans:dead?0:Math.round(5200+drift('f'+c,now,9000)*900),
   board:dead?'Hors service':'En service',power:['A','B'].map(x=>({feed:x,ok:true})),bootedAt:dead?null:Math.round(now-pick('up'+c,40,210)*86400000)};
 });
 const port=ports.find(p=>p.id===selected),g=segments.find(x=>x.id===selected),plan=plans[selected];
 const budgetOnt=plan.onts.reduce((a,b)=>loss(b,1490)>loss(a,1490)?b:a);
 const budget={ont:budgetOnt.n,lines:[
  {label:'Départ de la centrale',value:OLT_TX,kind:'source'},
  {label:'Connecteurs (4)',value:-4*CONNECTOR},
  {label:'Fibre · '+fmtKm(budgetOnt.km)+' à 0,28 dB/km',value:-round(budgetOnt.km*KM[1490],2)},
  {label:'Épissures ('+Math.ceil(budgetOnt.km/2)+')',value:-round(Math.ceil(budgetOnt.km/2)*SPLICE,2)},
  {label:'Coupleur 1:4 (armoire)',value:-SPLIT.cabinet},
  {label:'Coupleur 1:8 (poteau)',value:-SPLIT.pole},
  {label:'Pose (soudures, cordons)',value:-round(budgetOnt.extra-budgetOnt.flawDb,2)},
  ...(budgetOnt.flawDb?[{label:budgetOnt.flaw==='dirty'?'Connecteur sale chez le client':'Courbure du câble',value:-round(budgetOnt.flawDb*(budgetOnt.flaw==='bend'?1.3:1),2),kind:'flaw'}]:[])
 ]};
 budget.arrival=round(budget.lines.reduce((n,l)=>n+l.value,0),2);budget.loss=round(OLT_TX-budget.arrival,2);budget.margin=round(budget.arrival-RX_SENS,2);
 const field=ports.flatMap(p=>p.flagged.map(o=>({segment:p.id,zone:p.zone,...o})));
 return {at:now,step:STEP,thresholds:{warn:RX_WARN,alarm:RX_ALARM,sensitivity:RX_SENS,overload:-8,budget:BUDGET,oltTx:OLT_TX},selected,olts,ports,budget,field,
  otdr:q.otdr?otdr(g,plan,{alarm:g.alarm},[1310,1550].includes(Number(q.nm))?Number(q.nm):1310):null,
  console:console_(s,segments,ports,now),
  profiles:profiles(port)};
}

// Réglages de la centrale tels qu'un technicien les lit : profils de ligne, services, seuils.
function profiles(port){return {
 line:[['T-CONT','Type 4 · best effort + assuré'],['Allocation dynamique (DBA)','Activée · cycle 125 µs'],['Correction d’erreurs (FEC)','Activée dans les deux sens'],['Chiffrement','AES-128 sur le flux descendant'],['Portée du port','0 à 20 km']],
 services:[{vlan:100,name:'Internet',priority:0,profile:'Selon forfait (100 à 500 Mbit/s)'},{vlan:200,name:'Téléphone',priority:5,profile:'256 kbit/s garantis'},{vlan:300,name:'Télévision',priority:4,profile:'Multicast IGMP v3'},{vlan:4000,name:'Gestion des box',priority:6,profile:'Supervision à distance'}],
 port:port?{olt:port.olt,pon:port.pon,zone:port.zone,laser:'Classe C+ · +4,5 dBm',wavelengths:'1490 nm descendant · 1310 nm montant',split:'1:32 (1:4 puis 1:8)',onts:port.total}:null
};}

module.exports={snapshot,plant,loss,otdr,hash,THRESHOLDS:{RX_WARN,RX_ALARM,RX_SENS,BUDGET},ONLINE};
