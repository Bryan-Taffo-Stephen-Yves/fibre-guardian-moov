'use strict';
// Langues de Guardian : reconnaître le nouchi et le dioula sans réseau, à partir des packs de langue
// existants (src/lang/, lus sans les modifier), et choisir la phrase enregistrée en dioula qui convient.
// Quand Claude est disponible, guardian-ai.cjs affine la traduction ; sinon ce module suffit.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function pack(id){
 try{const ctx={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','src','lang',id+'.js'),'utf8'),ctx,{timeout:200});return (ctx.FG?.LANG_QUEUE||[]).find(p=>p.id===id)||null;}
 catch{return null;}
}
const PACKS={nouchi:pack('nouchi'),dioula:pack('dioula')};
const fold=t=>String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[’']/g,"'").replace(/\s+/g,' ').trim();
// Mots qui trahissent la langue (les mots communs au français, comme « wifi » ou « bonjour », ne comptent pas).
const MARKERS={
 nouchi:['deh','dèh','gere pas','gère pas','ya fohi',"y'a fohi",'fohi','gate','gâté','yako','on dit quoi','traine trop','connexion est partie','ca veut pas','ça veut pas','tape pas','c est propre','gars de moov','faut j appelle','mon dja','daba','enjailler','kpa'],
 dioula:['ɛ','ɔ','ɲ','i ni ce','i ni sogoma','i ni wula','a ni ce','man nyi','ma nyi','mandi',' ka connexion',' bɛ ',' be di','tɛ taa','te taa','n ka ','mun be','mun bɛ','wele']
};
// Sens en français de chaque intention reconnue par les packs.
const GLOSS={coupure:'Internet est coupé chez moi.',lent:'Ma connexion est lente.',wifi:'Mon Wi-Fi ne marche pas bien.',reboot:'Je veux redémarrer ma box.',appel:'Je veux parler à un technicien.',salut:'Bonjour.'};

function detect(text){
 const t=fold(text),raw=' '+String(text||'').toLowerCase()+' ';
 const score=lang=>MARKERS[lang].filter(m=>{const f=fold(m).trim();return /^[a-z' ]+$/.test(f)?new RegExp("(^|[^a-z'])"+f+"($|[^a-z'])").test(t):raw.includes(m);}).length;
 const d=score('dioula'),n=score('nouchi');
 const lang=d>n&&d>0?'dioula':n>0?'nouchi':'fr';
 if(lang==='fr')return {lang,french:null,intents:[]};
 const keys={...(PACKS[lang]?.keywords||{})};if(lang==='nouchi')keys.coupure=(keys.coupure||[]).concat(['y a fohi','fohi','partie']);
 const intents=Object.keys(keys).filter(k=>keys[k].some(w=>t.includes(fold(w))));
 return {lang,intents,french:intents.length?intents.map(k=>GLOSS[k]).filter(Boolean).join(' '):null};
}

// Phrases enregistrées en dioula (codex/voix/dioula.json) : numéro de la phrase selon la situation.
const VOICE=JSON.parse(fs.readFileSync(path.join(__dirname,'voix','dioula.json'),'utf8'));
function voiceKey({fault,action,state,verdict,greeting}){
 if(verdict)return ({sain:'02',rupture:'03',attenuation:'04',wifi:'05',amont:'06',congestion:'07',partage:'08',anomalie:'09',reboot:'10'})[verdict]||'09';
 if(fault)return fault.status==='resolved'?'13':['en_route','on_site'].includes(fault.status)?'12':'11';
 if(greeting)return '01';
 if(state==='redémarrage')return '10';
 if(action==='reboot')return '09';
 if(action==='devices')return '08';
 if(state==='dégradée')return '07';
 return '02';
}
function voice(key){const v=VOICE.phrases.find(p=>p.id===key);return v?{lang:'dioula',key:v.id,text:v.dioula||null,file:v.file||null}:null;}

module.exports={detect,voiceKey,voice,fold,PACKS,VOICE};
