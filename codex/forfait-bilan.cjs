'use strict';
// « Votre forfait est-il toujours le bon ? » (SmartOffer, ajustement) : Guardian relit les 7 derniers jours de débit
// mesuré à la box (journey-usage.cjs, minute par minute) et conseille, dans les deux sens : monter si la maison
// est souvent à fond le soir, descendre si le client paie pour un débit qu'il n'utilise pas. Rien ne change sans son accord.
const MINUTE=60000,DAY=86400000,MARGIN=1.3;
const EVENING=[19,20,21,22]; // heures d'Abidjan (UTC+0) où toute la maison est connectée
const MIN_OBSERVED=15*MINUTE,SATURATED_SHARE=.1,LOW_SHARE=.35;

function mbpsOf(row){if(!row.covered_ms)return 0;const bytes=Object.values(JSON.parse(row.body)).reduce((s,d)=>s+(d.bytes||0),0);return bytes*8/1e6/(row.covered_ms/1000);}
function percentile(values,p){if(!values.length)return 0;const v=[...values].sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.floor(p*v.length))];}

function compute(s,uid,st,plans,now=Date.now()){
 const plan=st.plan||plans[1],capacity=plan.mbps,sorted=[...plans].sort((a,b)=>a.mbps-b.mbps);
 if(st.sharedIncident||(st.incidents||[]).some(i=>i.segment===st.segment&&!['resolved','false_alarm'].includes(i.status)))
  return {verdict:'incident',plan,title:'Une panne d’abord',body:'Une coupure du quartier ne se règle pas en changeant de forfait. Guardian refera le bilan après la réparation.'};
 const rows=s.all('SELECT * FROM journey_usage_minutes WHERE user_id=? AND at>=? ORDER BY at',uid,now-7*DAY);
 const observed=rows.reduce((a,r)=>a+r.covered_ms,0),minutes=Math.round(observed/MINUTE);
 const days=Math.min(7,new Set(rows.map(r=>Math.floor(r.at/DAY))).size);
 if(observed<MIN_OBSERVED)return {verdict:'tot',plan,minutes,days,title:'Guardian apprend vos habitudes',body:'Guardian a observé votre connexion pendant '+minutes+' minute'+(minutes>1?'s':'')+'. Il lui faut un peu plus de temps pour vous dire si votre forfait est le bon.'};
 const rates=rows.map(mbpsOf),saturated=rows.reduce((a,r)=>a+r.saturated_ms,0),share=saturated/observed;
 const evening=rows.filter(r=>EVENING.includes(new Date(r.at).getUTCHours()));
 const satDays=Math.min(days,new Set(evening.filter(r=>r.saturated_ms>=r.covered_ms*.5).map(r=>Math.floor(r.at/DAY))).size);
 const peak=Math.round(percentile(rates,.95)*10)/10,eveningAvg=evening.length?Math.round(evening.map(mbpsOf).reduce((a,b)=>a+b,0)/evening.length):null;
 const facts={minutes,days,peak,eveningAvg,satDays,share:Math.round(share*100),capacity};
 if(share>=SATURATED_SHARE){
  const need=Math.ceil(Math.max(peak,capacity)*MARGIN),up=sorted.find(p=>p.mbps>=need&&p.mbps>capacity)||sorted.find(p=>p.mbps>capacity);
  if(up)return {verdict:'monter',plan,to:up,...facts,extra:up.price-plan.price,title:'Votre maison manque de débit le soir',
   body:(satDays?satDays+' soir'+(satDays>1?'s':'')+' sur '+days+', ':'')+'votre ligne de '+capacity+' Mb/s a tourné à fond '+facts.share+' % du temps observé. Passer à '+up.mbps+' Mb/s laisserait de la marge à tout le monde.'};
 }
 const enough=Math.ceil(Math.max(peak,1)*MARGIN),down=sorted.find(p=>p.mbps>=enough&&p.mbps<capacity);
 if(peak<capacity*LOW_SHARE&&share<.02&&down)return {verdict:'baisser',plan,to:down,...facts,saving:plan.price-down.price,title:'Vous payez pour du débit que vous n’utilisez pas',
  body:'Même aux heures chargées, votre maison utilise au plus '+String(peak).replace('.',',')+' Mb/s sur les '+capacity+' de votre forfait. '+down.mbps+' Mb/s vous suffiraient, et vous économiseriez '+(plan.price-down.price).toLocaleString('fr-FR')+' F par mois.'};
 return {verdict:'ok',plan,...facts,title:'Votre forfait vous va bien',body:'Aux heures chargées, votre maison utilise jusqu’à '+String(peak).replace('.',',')+' Mb/s sur '+capacity+'. Il reste de la marge, sans payer pour rien.'};
}

// Mode laboratoire (?mode=lab) : remplit 7 jours d'usage du simulateur pour montrer le bilan sans attendre une semaine.
// « soir » : la maison sature chaque soir ; « calme » : peu d'usage. Les relevés restent marqués comme venant du simulateur.
function seed(s,uid,st,profile,now=Date.now()){
 const capacity=(st.plan||{}).mbps||st.capacity||100,devices=(st.devices||[]).filter(d=>!d.blocked).slice(0,4);
 const share=devices.length?1/devices.length:1,start=Math.floor(now/MINUTE)*MINUTE-7*DAY;
 s.run('DELETE FROM journey_usage_minutes WHERE user_id=? AND at>=?',uid,start);
 const ins=s.db.prepare('INSERT OR REPLACE INTO journey_usage_minutes VALUES(?,?,?,?,?)');
 for(let at=start;at<now;at+=5*MINUTE){
  const hour=new Date(at).getUTCHours(),night=hour<7,eve=EVENING.includes(hour);
  const level=profile==='soir'?(eve?.97:night?.05:.3):(eve?.18:night?.02:.08);
  const mbps=capacity*level,body={};
  for(const d of devices)body[d.id]={id:d.id,name:d.name,bytes:mbps*share*125000*60,observedMs:MINUTE};
  ins.run(uid,at,MINUTE,level>=.9?MINUTE:0,JSON.stringify(body));
 }
}
module.exports={compute,seed,EVENING,MIN_OBSERVED};
