'use strict';
// Notifications « Web Push » : le téléphone reçoit l'alerte de Guardian même quand l'application est fermée.
// Tout est fait ici avec node:crypto, sans bibliothèque : chiffrement du message (RFC 8291, « aes128gcm ») et
// signature de l'expéditeur (VAPID, RFC 8292). Le service du téléphone (Apple, Google, Mozilla, Microsoft) ne lit jamais le texte.
//
// Une seule variable chez l'hébergeur : VAPID_PRIVATE_KEY. Elle accepte une vraie clé VAPID (32 octets en base64url)
// ou n'importe quel long texte secret (bouton « Generate » de Render) : la clé est alors tirée de ce texte.
// Sans elle, une clé est créée au démarrage : les alertes marchent, mais chaque téléphone se réabonne tout seul
// à la réouverture de l'application après un redémarrage du serveur.
const crypto = require('node:crypto');

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = text => Buffer.from(String(text || ''), 'base64url');
// Ordre de la courbe P-256 : une clé privée doit être entre 1 et n − 1.
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');

function scalarOk(buf) { if (buf.length !== 32) return false; const v = BigInt('0x' + buf.toString('hex')); return v > 0n && v < N; }

// La clé privée de l'expéditeur, tirée de la variable (ou créée au démarrage). Jamais renvoyée au navigateur.
function vapidKeys(secret) {
  let d = null, generated = false;
  const text = String(secret || '').trim();
  if (text) {
    const raw = /^[A-Za-z0-9_-]{43}$/.test(text) ? unb64u(text) : null;
    if (raw && scalarOk(raw)) d = raw;
    else { let h = crypto.createHash('sha256').update('fibre-guardian-vapid|' + text).digest(); while (!scalarOk(h)) h = crypto.createHash('sha256').update(h).digest(); d = h; }
  } else { do d = crypto.randomBytes(32); while (!scalarOk(d)); generated = true; }
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); // 65 octets, non compressée
  const key = crypto.createPrivateKey({key: {kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33))}, format: 'jwk'});
  return {publicKey: b64u(pub), key, generated};
}

// Jeton VAPID : « c'est bien Fibre Guardian qui écrit à ce téléphone ». Valable 12 h, signé ES256.
function vapidHeader(endpoint, keys, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({typ: 'JWT', alg: 'ES256'})), body = b64u(JSON.stringify({aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject}));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), {key: keys.key, dsaEncoding: 'ieee-p1363'});
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + keys.publicKey;
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Chiffrement RFC 8291 : clé éphémère + secret du téléphone → clé AES-128-GCM et nonce, un seul bloc.
// salt et ephemeral ne servent qu'aux tests (valeurs fixées) ; en vrai, ils sont tirés au hasard à chaque message.
function encrypt(subscription, payload, {salt = crypto.randomBytes(16), ephemeral = null} = {}) {
  const uaPublic = unb64u(subscription.keys?.p256dh), auth = unb64u(subscription.keys?.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || auth.length < 16) throw new Error('Abonnement du téléphone invalide.');
  const as = crypto.createECDH('prime256v1');
  if (ephemeral) as.setPrivateKey(ephemeral); else as.generateKeys();
  const asPublic = as.getPublicKey(), shared = as.computeSecret(uaPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 2 = dernier (et seul) bloc
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce), body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPublic.length;
  return Buffer.concat([head, asPublic, body]);
}

// Services de notification des téléphones et navigateurs : le serveur n'écrit à aucune autre adresse
// (un abonnement inventé ne peut pas faire appeler une machine interne).
const HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
function endpointOk(endpoint, hosts = HOSTS) {
  try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.username && !u.password && !u.port && hosts.some(r => r.test(u.hostname)); } catch { return false; }
}

// Un envoi. Renvoie {ok, gone} : gone = le téléphone s'est désabonné (404/410), l'abonnement est à effacer.
async function send(subscription, message, {keys, subject, ttl = 3600, urgency = 'high', fetchImpl = fetch, now = Date.now()} = {}) {
  const body = encrypt(subscription, JSON.stringify(message));
  const r = await fetchImpl(subscription.endpoint, {method: 'POST', headers: {
    'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: String(ttl), Urgency: urgency,
    Authorization: vapidHeader(subscription.endpoint, keys, subject, now)}, body, signal: AbortSignal.timeout(10000)});
  return {ok: r.status >= 200 && r.status < 300, gone: r.status === 404 || r.status === 410, status: r.status};
}

module.exports = {vapidKeys, vapidHeader, encrypt, endpointOk, send, HOSTS, b64u, unb64u};
