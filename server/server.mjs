/* Fibre Guardian · serveur d'agent (optionnel).
 * Sert l'application et expose deux routes appelées par le téléphone quand il a du réseau :
 *   POST /api/agent  { system, user }          → { text }
 *   POST /api/vision { image: dataURL, opt }    → { text }
 * Sans ce serveur, ou s'il ne répond pas en 5 s, l'application répond en local (src/agent.js).
 * La clé reste côté serveur : variable d'environnement ANTHROPIC_API_KEY, jamais dans le code. */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const MODEL = process.env.FG_MODEL || 'claude-opus-5';
const MAX_BODY = 4 * 1024 * 1024;

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// Repli côté serveur : si le modèle principal est surchargé, l'API bascule seule sur un modèle de secours.
async function complete({ system, content, maxTokens = 600 }) {
  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    output_config: { effort: 'low' }, // réponse courte, premier texte attendu en moins de 5 s (ENF-4)
    system,
    messages: [{ role: 'user', content }],
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  if (msg.stop_reason === 'refusal') return null;
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim() || null;
}

const VISION_SYSTEM = `Tu lis la photo de la face avant d'une box fibre Moov (voyants PWR, PON, LOS, LAN, WLAN). Décris en 2 phrases courtes, en français, les voyants allumés et leur couleur, puis ce que cela indique. Ne cite aucun chiffre sauf la puissance optique fournie. Si la photo ne montre pas une box, dis-le.`;

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('trop volumineux'), { status: 413 }); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT + path.sep) && p !== ROOT) { res.writeHead(403).end(); return; }
  if (p.includes(`${path.sep}server${path.sep}`) || p.includes(`${path.sep}node_modules${path.sep}`)) { res.writeHead(404).end(); return; }
  try { if ((await stat(p)).isDirectory()) p = path.join(p, 'index.html'); const body = await readFile(p); res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404).end('introuvable'); }
}

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && (req.url === '/api/agent' || req.url === '/api/vision')) {
      if (!client) return send(res, 503, { error: 'ANTHROPIC_API_KEY absente : le téléphone répond en local.' });
      const b = await readJson(req);
      let text;
      if (req.url === '/api/agent') {
        if (typeof b.system !== 'string' || typeof b.user !== 'string') return send(res, 400, { error: 'system et user attendus' });
        text = await complete({ system: b.system, content: b.user });
      } else {
        const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(b.image || '');
        if (!m) return send(res, 400, { error: 'image attendue en data URL' });
        text = await complete({
          system: VISION_SYSTEM, maxTokens: 300,
          content: [
            { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
            { type: 'text', text: `Puissance optique mesurée au même instant : ${Number(b.opt).toFixed(1)} dBm.` },
          ],
        });
      }
      return text ? send(res, 200, { text }) : send(res, 502, { error: 'pas de réponse exploitable' });
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    res.writeHead(405).end();
  } catch (e) {
    console.error(e.message);
    send(res, e.status === 413 ? 413 : 502, { error: 'échec, le téléphone répond en local' });
  }
}).listen(PORT, () => console.log(`Fibre Guardian sur http://localhost:${PORT} · agent ${client ? MODEL : 'désactivé (pas de clé)'}`));
