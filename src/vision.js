/* Fibre Guardian · M6 diagnostic par photo des voyants.
 * Lecture locale (hors ligne) par vision classique : qualité de l'image, puis détection des points
 * lumineux saturés, classés par couleur. Clignotement : comparaison de deux photos prises à 1 s.
 * Si un serveur de vision est configuré, un modèle multimodal peut compléter la lecture (CDC 7.4).
 * La lecture est toujours croisée avec la télémétrie du même instant (EF-M6-3). */
(function (root) {
  const FG = root.FG = root.FG || {};

  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return [h, mx ? d / mx : 0, mx];
  }
  const colorOf = h => (h < 18 || h >= 330 ? 'rouge' : h < 55 ? 'orange' : h < 170 ? 'vert' : h < 270 ? 'bleu' : 'rouge');

  // Qualité : luminosité, contraste, netteté (variance du laplacien).
  function quality(img) {
    const { data, width: W, height: H } = img, g = new Float32Array(W * H);
    let sum = 0;
    for (let i = 0; i < W * H; i++) { g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; sum += g[i]; }
    const mean = sum / (W * H); let v = 0; for (let i = 0; i < W * H; i++) v += (g[i] - mean) ** 2;
    let lap = 0, lm = 0, n = 0; const L = [];
    for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) { const i = y * W + x; const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W]; L.push(l); lm += l; n++; }
    lm /= n || 1; L.forEach(l => { lap += (l - lm) ** 2; });
    return { mean, contrast: Math.sqrt(v / (W * H)), sharp: lap / (n || 1) };
  }

  // Points lumineux saturés → composantes connexes.
  function findLeds(img) {
    const { data, width: W, height: H } = img, mask = new Int16Array(W * H).fill(-1), cols = ['rouge', 'orange', 'vert', 'bleu'];
    for (let i = 0; i < W * H; i++) {
      const [h, s, v] = rgb2hsv(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      if (v > 0.72 && s > 0.45) mask[i] = cols.indexOf(colorOf(h));
    }
    const seen = new Uint8Array(W * H), blobs = [], maxArea = W * H * 0.02;
    for (let i = 0; i < W * H; i++) {
      if (mask[i] < 0 || seen[i]) continue;
      const c = mask[i], st = [i]; seen[i] = 1; let area = 0, sx = 0, sy = 0;
      while (st.length) {
        const p = st.pop(), x = p % W, y = (p - x) / W; area++; sx += x; sy += y;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) return; const q = ny * W + nx; if (!seen[q] && mask[q] === c) { seen[q] = 1; st.push(q); } });
      }
      if (area >= 4 && area <= maxArea) blobs.push({ color: cols[c], x: sx / area / W, y: sy / area / H, area });
    }
    return blobs.sort((a, b) => a.x - b.x);
  }

  /* Analyse d'une ou deux photos. frames : [{data,width,height}, …]. telemetry : mesures du même instant. */
  function analyze(frames, telemetry) {
    const q = quality(frames[0]);
    if (q.mean < 22 || q.contrast < 10) return { ok: false, reason: 'Photo trop sombre ou sans contraste. Reprenez-la de face, lumière allumée, à 30 cm de la box.' };
    if (q.sharp < 8) return { ok: false, reason: 'Photo floue. Tenez le téléphone immobile et reprenez la photo.' };
    const leds = findLeds(frames[0]);
    if (!leds.length) return { ok: false, reason: "Aucun voyant allumé n'apparaît. Vérifiez que la photo montre la face avant de la box, et que la box est branchée." };
    let blink = [];
    if (frames[1]) {
      const other = findLeds(frames[1]);
      const match = (a, list) => list.some(b => b.color === a.color && Math.hypot(a.x - b.x, a.y - b.y) < 0.03);
      blink = leds.filter(a => !match(a, other)).concat(other.filter(b => !match(b, leds)));
    }
    const count = c => leds.filter(l => l.color === c).length;
    const red = count('rouge'), green = count('vert'), orange = count('orange');
    const reading = [
      green ? `${green} voyant${green > 1 ? 's' : ''} vert${green > 1 ? 's' : ''}` : null,
      red ? `${red} voyant${red > 1 ? 's' : ''} rouge${red > 1 ? 's' : ''}` : null,
      orange ? `${orange} voyant${orange > 1 ? 's' : ''} orange` : null,
      count('bleu') ? `${count('bleu')} voyant(s) bleu(s)` : null,
    ].filter(Boolean).join(', ') + (blink.length ? `, dont ${blink.length} clignotant${blink.length > 1 ? 's' : ''}` : frames[1] ? ', tous fixes' : '');
    // Interprétation visuelle seule (ambiguë par nature, CDC 7.4).
    const visual = red ? 'rupture' : orange ? 'wifi' : 'normal';
    // Croisement avec la télémétrie : c'est la combinaison qui lève l'ambiguïté.
    const opt = telemetry ? telemetry.opt : null, measuredCut = opt != null && opt < -36;
    let concord = true, cause;
    if (visual === 'rupture' && measuredCut) cause = `Panne probable : la fibre est coupée (puissance optique ${FG.f(opt)} dBm), la box n'est pas en cause.`;
    else if (visual === 'rupture' && !measuredCut) { concord = false; cause = `Divergence : un voyant rouge est allumé mais la fibre reçoit ${FG.f(opt)} dBm. Alarme locale probable (câble, alimentation) : le signalement part avec les deux sources.`; }
    else if (visual !== 'rupture' && measuredCut) { concord = false; cause = `Divergence : les voyants semblent normaux mais la puissance optique est à ${FG.f(opt)} dBm. Vérifiez que la photo montre bien la box Moov.`; }
    else if (visual === 'wifi') cause = 'Panne probable côté Wi-Fi : le voyant sans fil signale une alerte, la fibre reçoit bien.';
    else cause = opt != null && opt < -26 ? `Voyants normaux, mais le signal fibre faiblit (${FG.f(opt)} dBm) : connecteur à vérifier.` : 'Aucune panne visible sur la box ; la fibre reçoit normalement.';
    return { ok: true, leds, blink, reading: 'Les voyants montrent ' + reading + '.', cause, concord, visual };
  }

  /* Photo d'exemple générée (démo sans box réelle) : face avant avec 5 voyants PWR PON LOS LAN WLAN
   * dans l'état qui correspond à la panne courante. Clairement signalée comme exemple dans l'interface. */
  function samplePhoto(cls, phase = 0, W = 320, H = 200, rng = Math.random) {
    const data = new Uint8ClampedArray(W * H * 4);
    const px = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const n = (rng() - 0.5) * 16; const inBox = x > 30 && x < 290 && y > 60 && y < 140; const base = inBox ? 238 : 90 + y * 0.3; px(x, y, base + n, base + n, base - 4 + n); }
    for (let x = 30; x < 290; x++) { px(x, 60, 150, 150, 150); px(x, 140, 150, 150, 150); }
    const G = [40, 220, 90], R = [245, 40, 30], O = [255, 150, 20], OFF = null;
    const blinkOn = phase % 2 === 0;
    const st = {
      PWR: G, PON: cls === 'rupture' ? OFF : cls === 'attenuation' && !blinkOn ? OFF : G,
      LOS: cls === 'rupture' && blinkOn ? R : OFF, LAN: G, WLAN: cls === 'wifi' ? O : G,
    };
    Object.values(st).forEach((c, k) => {
      const cx = 70 + k * 45, cy = 100;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (dx * dx + dy * dy <= 25) {
        if (c) px(cx + dx, cy + dy, c[0], c[1], c[2]); else px(cx + dx, cy + dy, 70, 70, 70);
      }
    });
    return { data, width: W, height: H };
  }

  // Lecture d'un fichier image → ImageData réduite (navigateur).
  function fileToImage(file, maxW = 480) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const s = Math.min(1, maxW / im.naturalWidth), c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
        const x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height);
        URL.revokeObjectURL(url); // ENF-17 : l'image n'est pas conservée
        res({ img: d, dataUrl: c.toDataURL('image/jpeg', 0.8) });
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image illisible')); };
      im.src = url;
    });
  }

  async function remoteVision(endpoint, dataUrl, telemetry, timeoutMs = 12000) {
    const ac = new AbortController(); const id = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: dataUrl, opt: telemetry.opt }), signal: ac.signal });
      if (!r.ok) return null; const j = await r.json(); return j.text || null;
    } catch (e) { return null; } finally { clearTimeout(id); }
  }

  FG.vision = { quality, findLeds, analyze, samplePhoto, fileToImage, remoteVision };
  if (typeof module !== 'undefined' && module.exports) module.exports = FG;
})(typeof window !== 'undefined' ? window : globalThis);
