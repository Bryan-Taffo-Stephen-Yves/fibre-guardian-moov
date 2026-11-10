'use strict';
// Fibre Voice (thème 8 du concours) : le centre des avis clients.
// Le client note chaque intervention (noc_feedback) et son installation (fibre_welcome) avec un commentaire.
// Une note de 1 ou 2 sur 5 crée un rappel par un conseiller Moov sous 24 h, et le client en est prévenu.
// L'équipe Moov voit la note moyenne, les rappels à faire et ce qui revient dans les commentaires.
// Guardian classe les commentaires par sujet avec des mots-clés (français, et nouchi ou dioula traduits par langues.cjs) :
// aucun commentaire n'est envoyé ailleurs.
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,HOUR=3600000,WINDOW=30*DAY,DUE=DAY,LOW=2,RETRY=4*HOUR;

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
const TECH=()=>require('./noc-store.cjs').TECHS;

// Tous les avis des 30 derniers jours : interventions après une panne et installations.
function collect(s,now=Date.now()){
 const techs=TECH(),out=[];
 for(const r of s.all('SELECT f.user_id,f.incident_id,f.rating,f.comment,f.created,i.technician,i.title,u.name FROM noc_feedback f JOIN noc_incidents i ON i.id=f.incident_id JOIN users u ON u.id=f.user_id WHERE f.created>=?',now-WINDOW))
  out.push({source:'intervention',ref:r.incident_id,userId:r.user_id,name:r.name,rating:r.rating,comment:r.comment||'',at:r.created,tech:techs.find(t=>t.id===r.technician)?.name||null,what:'Intervention'});
 try{for(const r of s.all('SELECT w.id,w.user_id,w.rating,w.comment,w.tech,w.updated,u.name FROM fibre_welcome w JOIN users u ON u.id=w.user_id WHERE w.rating IS NOT NULL AND w.updated>=?',now-WINDOW))
  out.push({source:'installation',ref:r.id,userId:r.user_id,name:r.name,rating:r.rating,comment:r.comment||'',at:r.updated,tech:r.tech?JSON.parse(r.tech).name:null,what:'Installation'});}catch{}
 return out.sort((a,b)=>b.at-a.at);
}

// Une note basse crée un rappel (une seule fois par avis) et le client est prévenu de l'heure limite.
function sync(s,now=Date.now()){
 const J=require('./journey-store.cjs');let made=0;
 for(const a of collect(s,now)){
  if(a.rating>LOW)continue;
  if(s.get('SELECT 1 FROM avis_rappels WHERE source=? AND ref=? AND user_id=?',a.source,a.ref,a.userId))continue;
  const due=a.at+DUE;
  s.run('INSERT INTO avis_rappels(id,source,ref,user_id,rating,created,due) VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),a.source,a.ref,a.userId,a.rating,a.at,due);made++;
  const st=J.get(s,a.userId);if(!st)continue;st.notifications=st.notifications||[];
  st.notifications.unshift({key:'avis:'+a.source+':'+a.ref,home:'home-1',at:now,title:'Moov vous rappelle',body:'Merci pour votre avis, et pardon pour ce qui n’a pas été. Un conseiller Moov vous appelle avant '+(due-now<DAY/2?'':'demain ')+hour(due)+'.',read:false});
  st.notifications=st.notifications.slice(0,100);J.put(s,a.userId,st);
 }
 return made;
}

// Vue de l'équipe Moov : notes, rappels à faire, sujets qui reviennent, techniciens.
function stats(s,uid,now=Date.now()){
 O.requireOperator(s,uid);sync(s,now);
 const all=collect(s,now),avg=list=>list.length?Math.round(list.reduce((n,a)=>n+a.rating,0)/list.length*10)/10:null;
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
  topics,techs:[...byTech].map(([name,list])=>({name,average:avg(list),count:list.length})).sort((a,b)=>b.average-a.average||b.count-a.count)};
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
module.exports={migrate,collect,sync,stats,done,topicsOf,tones,TOPICS,OUTCOMES,LOW};
