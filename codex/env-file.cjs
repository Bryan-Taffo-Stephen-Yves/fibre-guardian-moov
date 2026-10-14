'use strict';
// Lit codex/.env (fichier local, ignoré par git) : une ligne NOM=valeur par réglage.
// Une variable déjà définie dans l'environnement (Railway, Windows) reste prioritaire.
// Tolère ce que produit le Bloc-notes de Windows : BOM, fins de ligne CRLF, guillemets, fichier « .env.txt ».
const fs=require('node:fs'),path=require('node:path');
function parse(text){const out={};for(const raw of String(text).replace(/^﻿/,'').split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const m=line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);if(!m)continue;let v=m[2].trim();if(/^(['"]).*\1$/.test(v))v=v.slice(1,-1);out[m[1]]=v;}return out;}
function load(dir=__dirname,env=process.env){
 for(const name of ['.env','.env.txt']){const file=path.join(dir,name);let text;try{text=fs.readFileSync(file,'utf8');}catch{continue;}
  const values=parse(text),applied=[];for(const [k,v] of Object.entries(values))if(env[k]===undefined||env[k]===''){env[k]=v;applied.push(k);}return {file,applied};}
 return {file:null,applied:[]};
}
module.exports={parse,load};
