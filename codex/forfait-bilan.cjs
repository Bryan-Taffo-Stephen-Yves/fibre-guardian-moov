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
 // Comme dans une vraie maison, les appareils ne se partagent pas le débit à parts égales : la télé et la console d'abord.
 const weights=devices.map(d=>/tv|télé/i.test(d.name)?5:/ps5|console|xbox/i.test(d.name)?2.5:/pc|mac|ordinateur/i.test(d.name)?1.5:1),sum=weights.reduce((a,w)=>a+w,0)||1,start=Math.floor(now/MINUTE)*MINUTE-7*DAY;
 s.run('DELETE FROM journey_usage_minutes WHERE user_id=? AND at>=?',uid,start);
 const ins=s.db.prepare('INSERT OR REPLACE INTO journey_usage_minutes VALUES(?,?,?,?,?)');
 for(let at=start;at<now;at+=5*MINUTE){
  const hour=new Date(at).getUTCHours(),night=hour<7,eve=EVENING.includes(hour);
  const level=profile==='soir'?(eve?.97:night?.05:.3):(eve?.18:night?.02:.08);
  const mbps=capacity*level,body={};
  devices.forEach((d,i)=>{body[d.id]={id:d.id,name:d.name,bytes:mbps*weights[i]/sum*125000*60,observedMs:MINUTE};});
  ins.run(uid,at,MINUTE,level>=.9?MINUTE:0,JSON.stringify(body));
 }
}
// Conseiller conso : quel appareil prend le plus de données, et quel forfait va à la maison, en deux phrases.
// Les chiffres viennent du PC qui partage sa connexion s'il compte en ce moment (comptés pour de vrai, depuis le lancement
// de Guardian), sinon des 7 derniers jours mesurés à la box. Le forfait vient du bilan ci-dessus : un seul avis, jamais deux.
const MIN_BYTES=5e6;
const volume=b=>{const f=v=>String(Math.round(v*10)/10).replace('.',',');return b>=1e9?f(b/1e9)+' Go':b>=1e6?f(b/1e6)+' Mo':f(b/1e3)+' Ko';};
const price=v=>v.toLocaleString('fr-FR').replace(/ | /g,' ')+' F';
function conso(s,uid,st,plans,{pc=null,now=Date.now()}={}){
 const bilan=compute(s,uid,st,plans,now),plan=st.plan||plans[1];
 let source='box',period='ces 7 derniers jours',list=[];
 const real=pc&&pc.counting==='on'?(pc.devices||[]).map(d=>({name:d.label,bytes:(d.down||0)+(d.up||0)})).filter(d=>d.bytes>0):[];
 if(real.reduce((a,d)=>a+d.bytes,0)>=MIN_BYTES){source='pc';period='depuis le lancement de Guardian';list=real;}
 else{
  const by=new Map();
  for(const r of s.all('SELECT body FROM journey_usage_minutes WHERE user_id=? AND at>=?',uid,now-7*DAY))
   for(const d of Object.values(JSON.parse(r.body))){const v=by.get(d.id)||{name:d.name,bytes:0};v.name=d.name||v.name;v.bytes+=d.bytes||0;by.set(d.id,v);}
  list=[...by.values()].filter(d=>d.bytes>0);
 }
 const total=list.reduce((a,d)=>a+d.bytes,0);
 const base={title:'Le conseil de Guardian',verdict:bilan.verdict,plan,to:bilan.to||null,extra:bilan.extra||0,saving:bilan.saving||0};
 if(total<MIN_BYTES)return {...base,source:null,devices:[],text:'Guardian n’a pas encore assez de mesures pour dire quel appareil consomme le plus. Revenez dans quelques heures.'};
 const devices=list.sort((a,b)=>b.bytes-a.bytes).slice(0,4).map(d=>({name:String(d.name||'Appareil').slice(0,60),bytes:Math.round(d.bytes),share:Math.round(100*d.bytes/total)}));
 const top=devices[0];
 let text='« '+top.name+' » a pris '+top.share+' % des données de la maison '+period+' ('+volume(top.bytes)+').';
 if(top.share>=50)text+=' C’est lui qui remplit le plus votre ligne.';
 const to=bilan.to;
 if(bilan.verdict==='monter'&&to)text+=' Le soir, votre maison manque de débit : le forfait '+to.mbps+' Mb/s vous irait mieux (+ '+price(bilan.extra)+' par mois). Vous pouvez aussi limiter « '+top.name+' » aux heures chargées, avec « Gérer ».';
 else if(bilan.verdict==='baisser'&&to)text+=' Pourtant, votre maison n’utilise pas tout son débit : le forfait '+to.mbps+' Mb/s vous suffirait, et vous économiseriez '+price(bilan.saving)+' par mois.';
 else if(bilan.verdict==='ok')text+=' Votre forfait '+plan.mbps+' Mb/s vous va bien : rien à changer.';
 else if(bilan.verdict==='incident')text+=' Une panne touche votre quartier : Guardian refera le point sur votre forfait après la réparation.';
 else text+=' Pour vous conseiller un forfait, Guardian a encore besoin de quelques jours de mesures.';
 return {...base,source,period,devices,text,total:Math.round(total)};
}
module.exports={compute,seed,conso,EVENING,MIN_OBSERVED};
