'use strict';
// Boîte à idées « Vos idées pour Moov » : le client propose, les autres votent « Moi aussi », Moov répond et tient parole.
//  1. Dans Mon compte, le client écrit son idée. Si une idée proche existe déjà, Guardian la lui montre : il peut voter
//     pour elle au lieu d'en créer une deuxième (les voix ne s'éparpillent pas).
//  2. Chaque idée a un état : Reçue → À l'étude → Prévue → Faite (ou « Pas pour l'instant », avec la raison).
//     Une idée « Reçue » n'est visible que de son auteur : un responsable la lit avant de la publier (« À l'étude »),
//     pour qu'aucune insulte ni aucun numéro de téléphone ne s'affiche chez tous les clients.
//  3. L'équipe Moov voit les idées dans le Superviseur (onglet Clients), les plus demandées d'abord, et change leur état
//     avec un mot de réponse. Chaque changement prévient l'auteur et tous ceux qui ont voté : « C'est fait ».
// Les droits sont vérifiés ici : un client propose et vote ; seul un responsable (superviseur, admin) change l'état.
// « Effacer mes données » (donnees.cjs) supprime les idées du client et ses voix, comme le reste de son compte.
const crypto=require('node:crypto');
const O=require('./operator-store.cjs');
const {insist}=require('./pilot-model.cjs');
const DAY=86400000,MAX_A_DAY=5;
const STATUS={recue:'Reçue',etude:'À l’étude',prevue:'Prévue',faite:'Faite',non:'Pas pour l’instant'};
const ACT={etude:'Mettre à l’étude',prevue:'La prévoir',faite:'C’est fait',non:'Pas pour l’instant'};
const NEXT={recue:['etude','non'],etude:['prevue','non'],prevue:['faite','non'],faite:[],non:['etude']};
// Le message envoyé à l'auteur et aux votants à chaque étape.
const TELL={
 etude:i=>['Votre idée est à l’étude','Moov étudie l’idée « '+i+' ». Nous vous disons ici ce qui est décidé.'],
 prevue:i=>['Votre idée est prévue','Moov va faire « '+i+' ». Nous vous prévenons dès que c’est prêt.'],
 faite:i=>['C’est fait : votre idée est là','« '+i+' » : c’est fait. Merci de l’avoir proposée !'],
 non:i=>['Réponse à votre idée','« '+i+' » : pas pour l’instant.']
};
const boss=role=>['admin','supervisor'].includes(role);

function migrate(s){s.db.exec(`
 CREATE TABLE IF NOT EXISTS idees(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'recue',answer TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,done_at INTEGER);
 CREATE TABLE IF NOT EXISTS idee_votes(idee_id TEXT NOT NULL REFERENCES idees(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,at INTEGER NOT NULL,PRIMARY KEY(idee_id,user_id));
 CREATE INDEX IF NOT EXISTS idees_status ON idees(status);
 `);}
const ready=new WeakSet();
function ensure(s){if(!ready.has(s)){migrate(s);ready.add(s);}}

const J=()=>require('./journey-store.cjs');
function notify(s,uid,[title,body],now){
 const st=J().get(s,uid);if(!st)return;st.notifications=st.notifications||[];
 st.notifications.unshift({key:'idee:'+crypto.randomUUID(),home:'home-1',at:now,title,body,read:false,page:'compte'});
 st.notifications=st.notifications.slice(0,100);J().put(s,uid,st);
}

// Idées proches : mêmes mots importants (sans accents, sans petits mots). Pas d'IA : une règle simple et explicable.
const STOP=new Set('je tu il elle on nous vous ils elles le la les un une des du de d l a au aux et ou en dans sur pour par avec sans que qui quoi ce cet cette ces mon ma mes ton ta tes son sa ses notre nos votre vos leur leurs est sont etre avoir peut pouvoir faut faudrait serait voudrais veux aimerais bien plus moins tres trop pas ne n y se s c qu moov fibre application appli app'.split(' '));
const words=t=>new Set(String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(w=>w.length>2&&!STOP.has(w)).map(w=>w.replace(/(s|x)$/,'')));
// Au moins deux mots importants en commun (ou une idée d'un seul mot, identique), rapportés à l'idée la plus longue :
// « Plus de débit » n'arrête pas toutes les idées qui parlent de débit.
function close(a,b){const A=words(a),B=words(b);if(!A.size||!B.size)return 0;let n=0;for(const w of A)if(B.has(w))n++;
 if(n<2&&!(A.size===1&&B.size===1))return 0;return n/Math.max(A.size,B.size);}

// Les idées avec leurs voix, en une seule requête (nombre de voix, et si ce client a voté).
const PICK="SELECT i.*,COUNT(v.user_id) votes,MAX(v.user_id=?) voted FROM idees i LEFT JOIN idee_votes v ON v.idee_id=i.id";
const rows=(s,uid,where,...args)=>s.all(PICK+' WHERE '+where+' GROUP BY i.id',uid,...args);
function card(i,uid){
 return {id:i.id,text:i.text,status:i.status,label:STATUS[i.status],answer:i.answer||null,votes:i.votes,
  mine:i.user_id===uid,voted:!!i.voted,created:i.created,done:i.done_at||null};
}
const order=(a,b)=>b.votes-a.votes||b.created-a.created;

// Ce que voit le client : les idées publiées (les plus soutenues d'abord), les siennes, et ce qui a été fait.
// Une idée « Reçue » (pas encore lue par Moov) ou « Pas pour l'instant » n'est montrée qu'à son auteur.
function state(s,uid,now=Date.now()){
 ensure(s);
 const all=rows(s,uid,"(i.status IN ('etude','prevue') OR (i.status='faite' AND i.done_at>?) OR (i.user_id=? AND (i.status!='non' OR i.updated>?)))",now-90*DAY,uid,now-30*DAY).map(i=>card(i,uid));
 return {open:all.filter(i=>['recue','etude','prevue'].includes(i.status)).sort(order).slice(0,8),
  done:all.filter(i=>i.status==='faite').sort((a,b)=>b.done-a.done).slice(0,3),
  mine:all.filter(i=>i.mine).sort((a,b)=>b.created-a.created).slice(0,5),statuses:STATUS};
}

// Le client propose une idée. Une idée proche existe : on la lui montre (force : il la propose quand même).
function propose(s,uid,d,now=Date.now()){return s.transaction(()=>{
 ensure(s);
 const text=String(d?.text||'').trim().replace(/\s+/g,' ');
 insist(text.length>=10&&text.length<=280&&!/[\u0000-\u001f<>]/.test(text),'Écrivez votre idée en une ou deux phrases (10 à 280 caractères).');
 insist(s.get('SELECT COUNT(*) n FROM idees WHERE user_id=? AND created>?',uid,now-DAY).n<MAX_A_DAY,'Vous avez déjà proposé '+MAX_A_DAY+' idées aujourd’hui. Merci ! Revenez demain.',429);
 if(!d.force){
  // Seulement parmi les idées publiées (et les siennes) : une idée pas encore lue par Moov ne s'affiche chez personne d'autre.
  const near=rows(s,uid,"(i.status IN ('etude','prevue','faite') OR (i.user_id=? AND i.status='recue'))",uid).map(i=>({i,score:close(text,i.text)})).filter(x=>x.score>=0.5).sort((a,b)=>b.score-a.score)[0];
  if(near)return {...state(s,uid,now),similar:card(near.i,uid)};
 }
 const id=crypto.randomUUID();
 s.run('INSERT INTO idees(id,user_id,text,status,created,updated) VALUES(?,?,?,?,?,?)',id,uid,text,'recue',now,now);
 s.run('INSERT INTO idee_votes(idee_id,user_id,at) VALUES(?,?,?)',id,uid,now);
 return {...state(s,uid,now),sent:id};
});}

// « Moi aussi » (ou retirer sa voix).
function vote(s,uid,d,now=Date.now()){return s.transaction(()=>{
 ensure(s);const i=s.get('SELECT * FROM idees WHERE id=?',String(d?.id||''));insist(i&&(i.status!=='recue'||i.user_id===uid),'Idée introuvable.',404);
 insist(['recue','etude','prevue'].includes(i.status),'Cette idée n’attend plus de voix.',409);
 if(d.off){insist(i.user_id!==uid,'C’est votre idée : votre voix reste.',409);s.run('DELETE FROM idee_votes WHERE idee_id=? AND user_id=?',i.id,uid);}
 else s.run('INSERT OR IGNORE INTO idee_votes(idee_id,user_id,at) VALUES(?,?,?)',i.id,uid,now);
 return state(s,uid,now);
});}

// Équipe Moov : toutes les idées, les plus demandées d'abord ; un responsable change l'état.
function list(s,uid,now=Date.now()){
 const role=O.requireOperator(s,uid);ensure(s);
 const names=new Map(s.all("SELECT u.id,u.name FROM users u JOIN idees i ON i.user_id=u.id").map(u=>[u.id,u.name]));
 const items=rows(s,uid,"i.status IN ('recue','etude','prevue') OR i.updated>?",now-30*DAY)
  .map(i=>({...card(i,uid),author:String(names.get(i.user_id)||'Client').split(' ').slice(0,2).join(' '),hidden:i.status==='recue',
   next:boss(role)?NEXT[i.status].map(k=>({key:k,label:i.status==='recue'&&k==='etude'?'Publier et étudier':ACT[k],status:STATUS[k]})):[]}))
  .sort((a,b)=>Number(['faite','non'].includes(a.status))-Number(['faite','non'].includes(b.status))||order(a,b));
 const week=s.get('SELECT COUNT(*) n FROM idees WHERE created>?',now-7*DAY).n;
 return {items,canAct:boss(role),counts:{open:items.filter(i=>['recue','etude','prevue'].includes(i.status)).length,week,done:items.filter(i=>i.status==='faite').length}};
}

function decide(s,uid,d,now=Date.now()){return s.transaction(()=>{
 const role=O.requireOperator(s,uid);insist(boss(role),'Seul un responsable peut répondre aux idées.',403);ensure(s);
 const i=s.get('SELECT * FROM idees WHERE id=?',String(d?.id||''));insist(i,'Idée introuvable.',404);
 insist(NEXT[i.status].includes(d.status),'Étape impossible depuis « '+STATUS[i.status]+' ».',409);
 const answer=String(d.answer||'').trim().slice(0,300)||null;
 insist(d.status!=='non'||answer,'Dites en une phrase pourquoi ce n’est pas pour l’instant : le client le lira.');
 // Une nouvelle réponse remplace l'ancienne ; la raison d'un « Pas pour l'instant » ne reste pas affichée quand l'idée repart.
 s.run('UPDATE idees SET status=?,answer=?,done_at=?,updated=? WHERE id=?',d.status,answer||(i.status==='non'?null:i.answer),d.status==='faite'?now:null,now,i.id);
 const short=i.text.length>80?i.text.slice(0,77)+'…':i.text,[title,body]=TELL[d.status](short);
 const people=new Set([i.user_id,...s.all('SELECT user_id FROM idee_votes WHERE idee_id=?',i.id).map(v=>v.user_id)].filter(Boolean));
 for(const p of people)notify(s,p,[title,body+(answer?' '+answer:'')],now);
 return {...list(s,uid,now),told:people.size};
});}

module.exports={migrate,state,propose,vote,list,decide,close,STATUS};
