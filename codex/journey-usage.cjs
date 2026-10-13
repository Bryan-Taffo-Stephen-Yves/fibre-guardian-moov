'use strict';
// Volumes calculés à partir de relevés du simulateur, jamais de mesures d'une box réelle.
const {insist}=require('./pilot-model.cjs');
const MINUTE=60000,DAY=86400000,MAX_GAP=30000;
const WINDOWS={'1h':{step:MINUTE,count:60},'24h':{step:3600000,count:24},'7d':{step:DAY,count:7}};
const CONTEXTS={home:{label:'Maison',description:'Streaming, jeux et usages du quotidien.'},work:{label:'Télétravail',description:'Visioconférences et transferts professionnels sont des usages légitimes.'},developers:{label:'Équipe de développeurs',description:'Dépôts, images de conteneurs et sauvegardes peuvent consommer beaucoup sans être anormaux.'}};
function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS journey_usage_cursor(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,at INTEGER NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS journey_usage_minutes(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,at INTEGER NOT NULL,covered_ms INTEGER NOT NULL,saturated_ms INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(user_id,at));
 `);}
function compact(st){return {devices:st.devices.map(d=>({...d})),capacity:st.capacity,scenario:st.scenario,segment:st.segment,incidents:st.incidents.map(i=>({segment:i.segment,status:i.status})),sharedDown:!!st.sharedIncident};}
function rates(st,at){
 // Un incident collectif ne prouve pas que chaque appareil est hors ligne.
 // Conserver les débits du simulateur abonné ; le contexte NOC influe sur le conseil, pas sur les chiffres.
 const fault=st.incidents.some(i=>i.segment===st.segment&&!['resolved','false_alarm'].includes(i.status));
 const capacity=fault?0:st.scenario==='slow'?12:st.capacity;
 const demands=st.devices.map(d=>d.blocked?0:Math.min(d.demand,d.until>at?d.limit??Infinity:Infinity));
 const total=demands.reduce((a,b)=>a+b,0);
 return {capacity,devices:st.devices.map((d,n)=>({id:d.id,name:d.name,protected:!!d.protected,recognized:!!d.recognized,blocked:!!d.blocked,mbps:Math.round((total>capacity?demands[n]*capacity/total:demands[n])*10)/10}))};
}
function append(s,uid,from,to,observed){
 for(let cursor=from;cursor<to;){
  const at=Math.floor(cursor/MINUTE)*MINUTE,end=Math.min(to,at+MINUTE),elapsed=end-cursor;
  const previous=s.get('SELECT * FROM journey_usage_minutes WHERE user_id=? AND at=?',uid,at);
  const body=previous?JSON.parse(previous.body):{};
  for(const device of observed.devices){const record=body[device.id]||{id:device.id,name:device.name,bytes:0,observedMs:0};record.name=device.name;record.bytes+=device.mbps*125000*elapsed/1000;record.observedMs+=elapsed;body[device.id]=record;}
  const saturated=observed.capacity>0&&observed.devices.reduce((sum,d)=>sum+d.mbps,0)>=observed.capacity*.9;
  s.run('INSERT INTO journey_usage_minutes VALUES(?,?,?,?,?) ON CONFLICT(user_id,at) DO UPDATE SET covered_ms=excluded.covered_ms,saturated_ms=excluded.saturated_ms,body=excluded.body',uid,at,(previous?.covered_ms||0)+elapsed,(previous?.saturated_ms||0)+(saturated?elapsed:0),JSON.stringify(body));
  cursor=end;
 }
}
function observe(s,uid,state,now=Date.now()){
 const next=compact(state),cursor=s.get('SELECT * FROM journey_usage_cursor WHERE user_id=?',uid);
 if(cursor&&now>cursor.at&&now-cursor.at<=MAX_GAP){
  const previous=JSON.parse(cursor.body);
  // Une expiration de QoS peut intervenir entre deux relevés : scinder à cet instant.
  const boundaries=[cursor.at,...previous.devices.map(d=>d.until).filter(at=>at>cursor.at&&at<now),now].sort((a,b)=>a-b);
  for(let i=1;i<boundaries.length;i++)if(boundaries[i]>boundaries[i-1])append(s,uid,boundaries[i-1],boundaries[i],rates(previous,boundaries[i-1]));
 }
 if(!cursor||now>=cursor.at)s.run('INSERT INTO journey_usage_cursor VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET at=excluded.at,body=excluded.body',uid,now,JSON.stringify(next));
 s.run('DELETE FROM journey_usage_minutes WHERE user_id=? AND at<?',uid,now-8*DAY);
}
function clear(s,uid){s.run('DELETE FROM journey_usage_cursor WHERE user_id=?',uid);s.run('DELETE FROM journey_usage_minutes WHERE user_id=?',uid);}
function read(s,uid,window,state,now=Date.now()){
 insist(Object.hasOwn(WINDOWS,window),'Période inconnue : choisissez 1h, 24h ou 7d.');
 const config=WINDOWS[window],last=Math.floor(now/config.step)*config.step,start=last-(config.count-1)*config.step;
 const buckets=Array.from({length:config.count},(_,i)=>({at:start+i*config.step,end:Math.min(now,start+(i+1)*config.step),bytes:null,observedMs:0,devices:{}}));
 const totals=new Map(),rows=s.all('SELECT * FROM journey_usage_minutes WHERE user_id=? AND at>=? AND at<=? ORDER BY at',uid,start,now);
 let observedMs=0,saturatedMs=0;
 for(const row of rows){
  const bucket=buckets[Math.floor((row.at-start)/config.step)];if(!bucket)continue;
  bucket.observedMs+=row.covered_ms;observedMs+=row.covered_ms;saturatedMs+=row.saturated_ms;
  const devices=JSON.parse(row.body);
  for(const d of Object.values(devices)){
   const current=totals.get(d.id)||{id:d.id,name:d.name,bytes:0,observedMs:0};current.name=d.name;current.bytes+=d.bytes;current.observedMs+=d.observedMs;totals.set(d.id,current);
   bucket.bytes=(bucket.bytes??0)+d.bytes;bucket.devices[d.id]=(bucket.devices[d.id]||0)+d.bytes;
  }
 }
 const current=rates(compact(state),now);
 for(const d of current.devices)if(!totals.has(d.id))totals.set(d.id,{id:d.id,name:d.name,bytes:null,observedMs:0});
 const devices=Array.from(totals.values()).map(d=>{const live=current.devices.find(v=>v.id===d.id);return {...d,currentMbps:live?.mbps??null,connected:!!live&&!live.blocked,protected:!!live?.protected,recognized:!!live?.recognized,blocked:!!live?.blocked,present:!!live};});
 const bytes=observedMs?devices.reduce((sum,d)=>sum+(d.bytes||0),0):null,spanMs=now-start,coverageRatio=spanMs?Math.min(1,observedMs/spanMs):0;
 const context=Object.hasOwn(CONTEXTS,state.usageContext)?state.usageContext:'home';
 let advice={kind:'observe',title:'L’usage a besoin de contexte',body:CONTEXTS[context].description+' Un gros volume ne justifie ni un blocage ni un achat à lui seul.'};
 if(state.sharedIncident||state.incidents.some(i=>i.segment===state.segment&&!['resolved','false_alarm'].includes(i.status)))advice={kind:'incident',title:'Traiter l’incident d’abord',body:'Une panne de zone ne se corrige pas avec un forfait supérieur ou le blocage d’un appareil.'};
 else if(observedMs<15*MINUTE)advice={kind:'learning',title:'Construisons votre référence',body:'Moins de 15 minutes observées sur cette période : pas assez pour recommander un forfait. Les intervalles sans observation restent inconnus.'};
 else if(saturatedMs/observedMs>=.6&&state.scenario!=='slow')advice={kind:'review',title:'Capacité à discuter, usages à préserver',body:'La capacité de votre ligne est très sollicitée sur les instants observés. Vérifiez vos besoins prioritaires avant de déplacer des transferts ou de comparer un forfait. Aucun achat ni blocage automatique.'};
 return {source:'simulation-recorded',sourceLabel:'Téléchargement mesuré à la box',direction:'download',byteUnit:'B',rateUnit:'Mbps',window,timezone:'UTC',generatedAt:now,start,end:now,bucketMs:config.step,context,contexts:CONTEXTS,devices,buckets,summary:{bytes,observedMs,spanMs,coverageRatio,saturatedMs,currentMbps:current.devices.reduce((sum,d)=>sum+d.mbps,0),capacityMbps:current.capacity,connected:current.devices.filter(d=>!d.blocked).length,retentionDays:8,maximumGapMs:MAX_GAP},advice};
}
module.exports={migrate,observe,read,clear,rates,CONTEXTS,WINDOWS,MAX_GAP};
