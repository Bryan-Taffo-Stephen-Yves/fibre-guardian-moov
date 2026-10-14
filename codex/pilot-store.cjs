'use strict';
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{promisify}=require('node:util');
const {id,token,hash,Problem,insist,word}=require('./pilot-model.cjs'),scrypt=promisify(crypto.scrypt);
async function passwordHash(password){insist(typeof password==='string'&&password.length>=12&&password.length<=128,'Choisissez un mot de passe de 12 à 128 caractères.');const salt=crypto.randomBytes(16).toString('hex');return salt+':'+Buffer.from(await scrypt(password,salt,64)).toString('hex');}
async function passwordMatches(password,stored){if(typeof password!=='string'||password.length>128||!stored)return false;const [salt,digest]=stored.split(':');const got=await scrypt(password,salt,64);const want=Buffer.from(digest,'hex');return got.length===want.length&&crypto.timingSafeEqual(got,want);}
class Store {
 constructor(file){if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});this.db=new DatabaseSync(file);this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,recovery TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS homes(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,created INTEGER NOT NULL,settings TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS members(home TEXT REFERENCES homes(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL,PRIMARY KEY(home,user_id));
 CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY,home TEXT REFERENCES homes(id) ON DELETE CASCADE,hash TEXT UNIQUE,expires INTEGER,used INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS labs(id TEXT PRIMARY KEY,home TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,name TEXT NOT NULL,code TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,closed INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS participants(id TEXT PRIMARY KEY,lab TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,name TEXT NOT NULL,secret TEXT UNIQUE NOT NULL,joined INTEGER NOT NULL,last_seen INTEGER NOT NULL,revoked INTEGER DEFAULT 0,fault_until INTEGER DEFAULT 0,fault TEXT DEFAULT 'none');
 CREATE TABLE IF NOT EXISTS samples(id TEXT PRIMARY KEY,home TEXT NOT NULL REFERENCES homes(id) ON DELETE CASCADE,participant TEXT REFERENCES participants(id) ON DELETE CASCADE,at INTEGER NOT NULL,source TEXT NOT NULL,metrics TEXT NOT NULL,bytes INTEGER DEFAULT 0);
 CREATE INDEX IF NOT EXISTS samples_home_at ON samples(home,at);
 CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,home TEXT REFERENCES homes(id) ON DELETE CASCADE,name TEXT NOT NULL,created INTEGER NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS devices(home TEXT REFERENCES homes(id) ON DELETE CASCADE,id TEXT,name TEXT NOT NULL,recognized INTEGER DEFAULT 0,guest_until INTEGER,room TEXT,seen INTEGER,rx REAL,tx REAL,PRIMARY KEY(home,id));
 CREATE TABLE IF NOT EXISTS collectors(home TEXT PRIMARY KEY REFERENCES homes(id) ON DELETE CASCADE,secret TEXT NOT NULL,last_at INTEGER,sequence INTEGER DEFAULT -1,capabilities TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,home TEXT REFERENCES homes(id) ON DELETE CASCADE,at INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,read INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,home TEXT REFERENCES homes(id) ON DELETE CASCADE,created INTEGER NOT NULL,status TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,home TEXT REFERENCES homes(id) ON DELETE CASCADE,user_id TEXT,at INTEGER NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,start INTEGER NOT NULL,count INTEGER NOT NULL);
 `);this.cleanup();}
 run(sql,...args){return this.db.prepare(sql).run(...args);} get(sql,...args){return this.db.prepare(sql).get(...args);} all(sql,...args){return this.db.prepare(sql).all(...args);}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 cleanup(){const now=Date.now();this.run('DELETE FROM sessions WHERE expires<?',now);this.run('DELETE FROM limits WHERE start<?',now-86400000);this.run('DELETE FROM samples WHERE at<?',now-30*86400000);this.run('DELETE FROM audit WHERE at<?',now-365*86400000);}
 rate(key,max=30,period=60000){const now=Date.now(),r=this.get('SELECT * FROM limits WHERE key=?',key);if(!r||now-r.start>=period){this.run('INSERT OR REPLACE INTO limits VALUES(?,?,1)',key,now);return;}insist(r.count<max,'Trop de tentatives. Réessayez dans une minute.',429);this.run('UPDATE limits SET count=count+1 WHERE key=?',key);}
 async register(data){const email=word(data.email,'Adresse e-mail',254).toLowerCase();insist(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Adresse e-mail invalide.');const name=word(data.name,'Nom',80),password=await passwordHash(data.password),recovery=token(),uid=id();try{this.run('INSERT INTO users VALUES(?,?,?,?,?,?)',uid,email,name,password,hash(recovery),Date.now());}catch(e){if(e.message.includes('UNIQUE'))throw new Problem(409,'Ce compte existe déjà. Connectez-vous ou utilisez votre code de récupération.');throw e;}return {user:{id:uid,email,name},recovery};}
 async login(email,password){const user=this.get('SELECT * FROM users WHERE email=?',String(email||'').toLowerCase().trim());const okay=await passwordMatches(password,user?.password||'00000000000000000000000000000000:'+ '0'.repeat(128));insist(user&&okay,'Identifiants incorrects.',401);return {id:user.id,email:user.email,name:user.name};}
 session(user){const secret=token(),csrf=token(),expires=Date.now()+8*3600000;this.run('INSERT INTO sessions VALUES(?,?,?,?)',hash(secret),user.id,csrf,expires);return {secret,csrf,expires};}
 authenticate(secret){if(!secret||secret.length>100)return null;return this.get('SELECT u.id,u.name,u.email,s.csrf,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',hash(secret),Date.now())||null;}
 home(uid,hid,write=false){const h=this.get('SELECT h.*,m.role FROM homes h JOIN members m ON m.home=h.id WHERE h.id=? AND m.user_id=?',hid,uid);insist(h,'Foyer introuvable.',404);insist(!write||h.role==='owner','Cette action est réservée au propriétaire.',403);return {...h,settings:JSON.parse(h.settings)};}
 event(home,uid,action,detail=''){this.run('INSERT INTO audit VALUES(?,?,?,?,?,?)',id(),home,uid||null,Date.now(),action,String(detail).slice(0,500));}
 notice(home,title,body){this.run('INSERT INTO notifications VALUES(?,?,?,?,?,0)',id(),home,Date.now(),title,body);this.run('DELETE FROM notifications WHERE home=? AND id NOT IN (SELECT id FROM notifications WHERE home=? ORDER BY at DESC LIMIT 200)',home,home);}
 close(){this.db.close();}
}
module.exports={Store,passwordHash,passwordMatches};
