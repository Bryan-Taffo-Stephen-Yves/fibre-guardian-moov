'use strict';
// Fibre Voice (thème 8 du concours) : le centre des avis clients.
// Le client note chaque intervention (noc_feedback) et son installation (fibre_welcome) avec un commentaire.
// Une note de 1 ou 2 sur 5 crée un rappel par un conseiller Moov sous 24 h, et le client en est prévenu.
// L'équipe Moov voit la note moyenne, les rappels à faire et ce qui revient dans les commentaires.
// Guardian classe les commentaires par sujet avec des mots-clés (français, et nouchi ou dioula traduits par langues.cjs) :
// aucun commentaire n'est envoyé ailleurs.
// Suivi de satisfaction : la note moyenne par quartier et par technicien, semaine après semaine (8 semaines),
// pour voir tout de suite un quartier ou un technicien dont la note baisse.
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,HOUR=3600000,WINDOW=30*DAY,DUE=DAY,LOW=2,RETRY=4*HOUR,WEEKS=8,DROP=0.5,WATCH=3.5;

// Sujets qui reviennent dans les commentaires (texte sans accents, en minuscules) : le sujet, puis ce qui en fait un reproche.
// Sans mot de reproche, le sujet compte comme un compliment (« très poli »), sauf « La panne revient », toujours un reproche.
const TOPICS=[
 ['retard','Ponctualité du technicien',/retard|attendu|attendre|attente|trop tard|pas venu|jamais venu|rendez-vous|rdv|a l'heure|ponctuel/,/retard|attendu|attendre|attente|trop tard|pas venu|jamais venu|pas a l'heure/],
 ['panne','La panne revient',/encore|est coupe|revenu|revient|recoup|re-coup|toujours (pas|coupe|lent)|lent|marche (pas|plus)|ne (marche|fonctionne)|rien (n'a )?change|meme probleme/,/./],
 ['explications','Explications données',/expliqu|compris|comprendre|clair|conseil|montre/,/(pas|rien|mal) (bien )?(explique|compris|clair|montre)|sans (rien )?expliquer|n'a rien/],
 ['politesse','Politesse et accueil',/poli|gentil|aimable|respect|sourire|courtois|sympa|agressif|mal parle/,/impoli|mal poli|agressif|mal parle|pas (tres )?(poli|gentil|aimable|respectueux|sympa)|manque de respect/],
 ['rapidite','Rapidité',/rapide|vite|efficace|en (quelques|\d+) minutes|tout de suite/,/pas (tres )?(rapide|vite|efficace)|trop lent/],
 ['proprete','Propreté du chantier',/sale|propre|salet|gravats|trou|cable (par terre|qui traine|traine)|range/,/sale|salet|gravats|trou|cable (par terre|qui traine|traine)|pas (tres )?propre|pas range/],
 ['prix','Prix et facture',/prix|cher|factur|payer|paye|argent/,/cher|trop|pas normal|arnaque|double/]
];
const OUTCOMES={regle:'Problème réglé au téléphone',intervention:'Nouvelle intervention prévue',absent:'Pas de réponse, à rappeler'};

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS avis_historique(id TEXT PRIMARY KEY,zone TEXT NOT NULL,tech TEXT,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),comment TEXT NOT NULL DEFAULT '',at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS avis_rappels(id TEXT PRIMARY KEY,source TEXT NOT NULL,ref TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,rating INTEGER NOT NULL,created INTEGER NOT NULL,due INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'open',tries INTEGER NOT NULL DEFAULT 0,outcome TEXT,done_by TEXT REFERENCES users(id),done_at INTEGER,UNIQUE(source,ref,user_id));
 `);}

const plain=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/’/g,"'");
// Un commentaire en nouchi ou en dioula est d'abord ramené au français (packs de langue), puis classé.
// Chaque sujet est lu dans le morceau de phrase où il apparaît (« poli, mais encore lent » : politesse = compliment).
function tones(comment){
 if(!comment)return [];
 let text=plain(comment);
 try{const m=require('./langues.cjs').detect(comment);if(m&&m.french)text+=' . '+plain(m.french);}catch{}
 const parts=text.split(/[.,;!?]|\bmais\b|\bpar contre\b|\bsauf\b/),out=[];
 for(const [k,,re,bad] of TOPICS){const hit=parts.filter(p=>re.test(p));if(hit.length)out.push({key:k,bad:hit.some(p=>bad.test(p))});}
 return out;
}
const topicsOf=comment=>tones(comment).map(t=>t.key);
const shortName=name=>{const p=String(name||'').trim().split(/\s+/).filter(Boolean);return p.length?p[0]+(p[1]?' '+p[1][0].toUpperCase()+'.':''):'Client';};
const hour=t=>new Date(t).toLocaleTimeString('fr-FR',{timeZone:'Africa/Abidjan',hour:'2-digit',minute:'2-digit'}).replace(':',' h ');
// Date absolue (« le 22 nov. à 21 h 26 ») : le message reste juste quand le client le lit le lendemain.
const dayHour=t=>'le '+new Date(t).toLocaleDateString('fr-FR',{timeZone:'Africa/Abidjan',day:'numeric',month:'short'})+' à '+hour(t);
const TECH=()=>require('./noc-store.cjs').TECHS;

// Le quartier tel que les clients le disent : « Yopougon · Niangon », ou « Plateau » quand le quartier porte le nom de la commune.
const zoneOf=(commune,area)=>commune?(area&&area!==commune?commune+' · '+area:commune):null;
const splitZone=zone=>{const [c,a]=String(zone||'').split(' · ');return zoneOf(c,a);};

// Tous les avis récents (30 jours par défaut) : interventions après une panne, installations,
// et l'historique des semaines passées de la démo (déjà traité : il ne crée jamais de rappel).
function collect(s,now=Date.now(),{span=WINDOW,history=true}={}){
 const techs=TECH(),out=[],from=now-span;
 for(const r of s.all('SELECT f.user_id,f.incident_id,f.rating,f.comment,f.created,i.technician,i.title,u.name,g.zone FROM noc_feedback f JOIN noc_incidents i ON i.id=f.incident_id JOIN users u ON u.id=f.user_id LEFT JOIN noc_segments g ON g.id=i.segment_id WHERE f.created>=?',from))
  out.push({source:'intervention',ref:r.incident_id,userId:r.user_id,name:r.name,rating:r.rating,comment:r.comment||'',at:r.created,tech:techs.find(t=>t.id===r.technician)?.name||null,what:'Intervention',zone:splitZone(r.zone)});
 try{for(const r of s.all('SELECT w.id,w.user_id,w.rating,w.comment,w.tech,w.updated,w.commune,w.quartier,u.name FROM fibre_welcome w JOIN users u ON u.id=w.user_id WHERE w.rating IS NOT NULL AND w.updated>=?',from))
  out.push({source:'installation',ref:r.id,userId:r.user_id,name:r.name,rating:r.rating,comment:r.comment||'',at:r.updated,tech:r.tech?JSON.parse(r.tech).name:null,what:'Installation',zone:zoneOf(r.commune,r.quartier)});}catch{}
 if(history)for(const r of s.all('SELECT * FROM avis_historique WHERE at>=?',from))
  out.push({source:'historique',ref:r.id,userId:null,name:null,rating:r.rating,comment:r.comment||'',at:r.at,tech:r.tech,what:'Intervention',zone:r.zone});
 return out.sort((a,b)=>b.at-a.at);
}

// Semaines du lundi au dimanche, heure d'Abidjan (UTC).
function weekStart(t){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-((d.getUTCDay()+6)%7)*DAY;}
const avgOf=list=>list.length?Math.round(list.reduce((n,a)=>n+a.rating,0)/list.length*10)/10:null;

// Suivi semaine après semaine : la courbe de toute l'équipe, puis une ligne par quartier et par technicien.
// La note affichée est celle de la dernière semaine notée, comparée à la semaine notée d'avant.
// « À surveiller » : la note passe sous 3,5, ou baisse d'un demi-point ou plus et tombe à 4 ou moins.
function suivi(list,now=Date.now()){
 const first=weekStart(now)-(WEEKS-1)*7*DAY,starts=Array.from({length:WEEKS},(_,k)=>first+k*7*DAY);
 const inWeek=(items,w)=>items.filter(a=>a.at>=w&&a.at<w+7*DAY);
 const series=items=>starts.map(w=>{const x=inWeek(items,w);return {average:avgOf(x),count:x.length};});
 const kept=list.filter(a=>a.at>=first&&a.at<=now);
 const group=key=>{const m=new Map();for(const a of kept){const k=a[key];if(k)m.set(k,(m.get(k)||[]).concat(a));}
  return [...m].map(([name,items])=>{const weeks=series(items),rated=weeks.map((w,i)=>({...w,i})).filter(w=>w.count),last=rated[rated.length-1],prev=rated[rated.length-2];
   const delta=prev?Math.round((last.average-prev.average)*10)/10:null;
   return {name,weeks,average:last.average,week:last.i,delta,count:items.length,watch:(delta!==null&&delta<=-DROP&&last.average<=4)||last.average<WATCH};})
   .sort((a,b)=>b.watch-a.watch||a.average-b.average||b.count-a.count);};
 return {weeks:starts,overall:series(kept),zones:group('zone'),techs:group('tech')};
}

// Démo : 7 semaines d'avis passés par quartier, pour que la courbe ait un sens dès l'ouverture.
// Niangon remontait (la panne de cette nuit le fait redescendre), Cocody et Marcory restent hauts,
// Abobo baisse depuis trois semaines (retards). Plusieurs techniciens par quartier : les deux onglets diffèrent.
// Écrit seulement par la démo pré-remplie (seed-demo.cjs) ; « À propos de la démo » le dit.
const HISTORY=[
 ['Yopougon · Niangon',['Koffi N’Guessan','Koffi N’Guessan','Awa Kouamé'],[[3,4,3],[4,3,4],[3,4,4],[4,4,4],[4,4,5],[4,5,4],[5,4,4]],{3:'Internet coupe encore le soir.',5:'Très poli, il a bien expliqué.'}],
 ['Cocody · Cité des Arts',['Yao Konan','Ibrahim Traoré','Yao Konan'],[[5,5,4],[5,4,5],[5,5,5],[4,5,5],[5,5,4],[5,5,5],[5,4,5]],{5:'Rapide et très poli, merci.'}],
 ['Marcory · Résidentiel',['Amina Traoré','Amina Traoré','Yao Konan'],[[4,4,5],[4,5,4],[4,4,4],[5,4,4],[4,5,4],[4,4,5],[5,4,4]],{5:'Elle a tout expliqué, c’était clair.'}],
 ['Abobo · Abobo Gare',['Awa Kouamé','Awa Kouamé','Koffi N’Guessan'],[[5,4,5],[5,5,4],[4,5,5],[4,5,4],[4,3,4],[3,4,3],[2,3,3]],{2:'Le technicien est arrivé avec deux heures de retard.',3:'On a attendu toute la matinée, personne n’a prévenu.',5:'Rapide et efficace.'}],
 ['Plateau',['Ibrahim Traoré','Amina Traoré'],[[5,4],[4,5],[5,5],[4,4],[5,4],[5,5],[4,5]],{5:'Très gentil et rapide.'}]
];
function history(s,now=Date.now()){
 const monday=weekStart(now);let n=0;
 // Une seule transaction : la remise à zéro de la démo reste rapide.
 s.transaction(()=>{for(const [zone,techs,weeks,comments] of HISTORY)weeks.forEach((ratings,k)=>{const ago=weeks.length-k;
  ratings.forEach((rating,i)=>{s.run('INSERT INTO avis_historique VALUES(?,?,?,?,?,?)',crypto.randomUUID(),zone,techs[i%techs.length],rating,i===0&&comments[rating]||'',monday-ago*7*DAY+(1+2*i)*DAY+10*HOUR);n++;});});});
 return n;
}

// Une note basse crée un rappel (une seule fois par avis) et le client est prévenu de l'heure limite.
function sync(s,now=Date.now()){
 const J=require('./journey-store.cjs');let made=0;
 for(const a of collect(s,now,{history:false})){
  if(a.rating>LOW)continue;
  if(s.get('SELECT 1 FROM avis_rappels WHERE source=? AND ref=? AND user_id=?',a.source,a.ref,a.userId))continue;
  const due=a.at+DUE;
  s.run('INSERT INTO avis_rappels(id,source,ref,user_id,rating,created,due) VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),a.source,a.ref,a.userId,a.rating,a.at,due);made++;
  const st=J.get(s,a.userId);if(!st)continue;st.notifications=st.notifications||[];
  st.notifications.unshift({key:'avis:'+a.source+':'+a.ref,home:'home-1',at:now,title:'Moov vous rappelle',body:'Merci pour votre avis, et pardon pour ce qui n’a pas été. Un conseiller Moov vous appelle avant '+dayHour(due)+'.',read:false});
  st.notifications=st.notifications.slice(0,100);J.put(s,a.userId,st);
 }
 return made;
}

// Vue de l'équipe Moov : notes, rappels à faire, sujets qui reviennent, techniciens.
function stats(s,uid,now=Date.now()){
 O.requireOperator(s,uid);sync(s,now);
 // Les chiffres du haut ne comptent que les vrais avis ; l'historique d'exemple de la démo ne sert qu'au suivi.
 const all=collect(s,now,{history:false}),avg=avgOf;
 const week=all.filter(a=>a.at>=now-7*DAY);
 const read=all.map(a=>tones(a.comment));
 const topics=TOPICS.map(([k,label])=>{const hits=read.map(t=>t.find(x=>x.key===k)).filter(Boolean);return {key:k,label,count:hits.length,bad:hits.filter(x=>x.bad).length,good:hits.filter(x=>!x.bad).length};}).filter(t=>t.count).sort((a,b)=>b.bad-a.bad||b.count-a.count);
 const byTech=new Map();for(const a of all)if(a.tech)byTech.set(a.tech,(byTech.get(a.tech)||[]).concat(a));
 const rows=s.all("SELECT r.*,u.name FROM avis_rappels r JOIN users u ON u.id=r.user_id WHERE r.created>=? ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,r.due",now-WINDOW);
 const find=r=>all.find(a=>a.source===r.source&&a.ref===r.ref&&a.userId===r.user_id);
 const callback=r=>{const a=find(r);return {id:r.id,name:shortName(r.name),rating:r.rating,what:a?.what||(r.source==='installation'?'Installation':'Intervention'),comment:a?.comment||'',tech:a?.tech||null,at:r.created,due:r.due,late:r.status==='open'&&now>r.due,tries:r.tries,status:r.status,outcome:r.outcome?OUTCOMES[r.outcome]:null,doneAt:r.done_at};};
 return {count:all.length,week:week.length,average:avg(all),satisfied:all.length?Math.round(all.filter(a=>a.rating>=4).length/all.length*100):null,
  stars:[5,4,3,2,1].map(n=>({stars:n,count:all.filter(a=>a.rating===n).length})),
  open:rows.filter(r=>r.status==='open').map(callback),done:rows.filter(r=>r.status==='done').slice(0,3).map(callback),
  topics,techs:[...byTech].map(([name,list])=>({name,average:avg(list),count:list.length})).sort((a,b)=>b.average-a.average||b.count-a.count),
  suivi:suivi(collect(s,now,{span:WEEKS*7*DAY}),now)};
}

// Un conseiller note le résultat de son appel. « Pas de réponse » garde le rappel ouvert, à refaire dans 4 h.
function done(s,uid,d,now=Date.now()){
 return s.transaction(()=>{
  O.requireOperator(s,uid);
  insist(d&&typeof d.id==='string'&&Object.hasOwn(OUTCOMES,d.outcome),'Choisissez le résultat de l’appel.');
  const r=s.get('SELECT * FROM avis_rappels WHERE id=?',d.id);insist(r,'Rappel introuvable.',404);insist(r.status==='open','Ce client a déjà été rappelé.',409);
  if(d.outcome==='absent')s.run('UPDATE avis_rappels SET tries=tries+1,due=?,outcome=? WHERE id=?',Math.min(r.due,now+RETRY),'absent',r.id);
  else s.run("UPDATE avis_rappels SET status='done',tries=tries+1,outcome=?,done_by=?,done_at=? WHERE id=?",d.outcome,uid,now,r.id);
  s.event(null,uid,'avis.rappel',OUTCOMES[d.outcome]);
  return stats(s,uid,now);
 });
}
module.exports={migrate,collect,sync,stats,done,suivi,history,weekStart,topicsOf,tones,TOPICS,OUTCOMES,LOW,HISTORY};
