/* Fibre Guardian · M1 collecte + M2 moteur de détection.
 * Même code dans le navigateur (window.FG) et côté serveur / tests (require).
 * Le moteur ne reçoit que des échantillons : il ne connaît jamais la panne injectée (CDC 6.1). */
(function (root) {
  const FG = root.FG = root.FG || {};

  const SUB = { dl: 100, ul: 50 };
  // Valeurs nominales CDC 5.1. dl/ul/loc en % du souscrit (100 Mbps / 50 Mbps).
  const BASE = { dl: 96, ul: 47, lat: 11, jit: 2, loss: 0.1, opt: -18, snr: 32, wifi: -50, dev: 4, loc: 86 };
  // Signatures physiques par type de panne (cibles du simulateur, invisibles du moteur).
  const PROFILES = {
    nominal: BASE,
    rupture: { dl: 0, ul: 0, lat: 0, jit: 0, loss: 100, opt: -40, snr: 0, wifi: -50, dev: 4, loc: 0 },
    attenuation: { dl: 74, ul: 40, lat: 16, jit: 3, loss: 2.6, opt: -27.6, snr: 18, wifi: -50, dev: 4, loc: 66 },
    wifi: { dl: 97, ul: 47, lat: 12, jit: 9, loss: 0.2, opt: -18, snr: 32, wifi: -79, dev: 5, loc: 19 },
    wifiFixed: { dl: 97, ul: 47, lat: 11, jit: 3, loss: 0.1, opt: -18, snr: 32, wifi: -63, dev: 5, loc: 71 },
    amont: { dl: 22, ul: 12, lat: 185, jit: 14, loss: 12, opt: -18.5, snr: 31, wifi: -50, dev: 4, loc: 20 },
    congestion: { dl: 58, ul: 38, lat: 62, jit: 6, loss: 1.2, opt: -18, snr: 32, wifi: -50, dev: 4, loc: 52 },
    partage: { dl: 61, ul: 46, lat: 24, jit: 4, loss: 0.4, opt: -18, snr: 32, wifi: -52, dev: 24, loc: 40 },
    reboot: { dl: 0, ul: 0, lat: 0, jit: 0, loss: 0, opt: -18, snr: 32, wifi: -95, dev: 0, loc: 0 },
    reel: { ...BASE },
  };
  const NOISE = { dl: 1.4, ul: 0.9, lat: 0.7, jit: 0.3, loss: 0.04, opt: 0.22, snr: 0.35, wifi: 1.1, dev: 0, loc: 2 };
  const KEYS = Object.keys(NOISE);
  const METRICS9 = ['dl', 'ul', 'lat', 'jit', 'loss', 'opt', 'snr', 'wifi', 'dev'];

  const CLS = {
    sain: { name: 'Ligne saine', layer: 'aucune', st: 'ok' },
    rupture: { name: 'Rupture optique', layer: 'fibre', st: 'ko' },
    attenuation: { name: 'Atténuation optique', layer: 'fibre', st: 'warn' },
    partage: { name: 'Partage illicite', layer: 'box', st: 'warn' },
    wifi: { name: 'Problème Wi-Fi', layer: 'Wi-Fi', st: 'warn' },
    amont: { name: 'Incident amont', layer: 'amont', st: 'ko' },
    congestion: { name: 'Congestion', layer: 'amont', st: 'warn' },
    anomalie: { name: 'Anomalie à surveiller', layer: 'à confirmer', st: 'warn' },
  };
  const CLSORD = ['sain', 'rupture', 'attenuation', 'wifi', 'amont', 'congestion', 'partage'];
  const EXPECT = { nominal: 'sain', rupture: 'rupture', attenuation: 'attenuation', wifi: 'wifi', amont: 'amont', congestion: 'congestion', partage: 'partage' };

  const f = (v, d = 1) => (Math.abs(v) < 0.05 && d > 0 ? 0 : v).toFixed(d).replace('.', ',').replace('-', '−');
  const med = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  // Règles physiques ordonnées (EF-M2-2) : rupture, atténuation, partage, Wi-Fi, amont, congestion.
  const RULES = [
    { id: 'rupture', test: w => w.opt < -36 || w.link < 0.5, sup: w => [w.opt < -36, w.dl < 1, w.snr < 5, w.loss > 50],
      ev: w => [[w.opt < -36, `Puissance optique ${f(w.opt)} dBm < −36 dBm`], [w.dl < 1, `Débit WAN ${f(w.dl)} Mbps`], [w.snr < 5, `S/B ${f(w.snr)} dB`]] },
    { id: 'attenuation', test: w => w.opt < -26 || (w.snr < 20 && w.loss > 2), sup: w => [w.opt < -26, w.snr < 20, w.loss > 2, w.dl < 85],
      ev: w => [[w.opt < -26, `Puissance optique ${f(w.opt)} dBm < −26 dBm`], [w.snr < 20, `S/B ${f(w.snr)} dB < 20 dB`], [w.loss > 2, `Perte ${f(w.loss)} % > 2 %`], [true, `Débit encore à ${f(w.dl, 0)} % du souscrit`]] },
    { id: 'partage', test: w => w.dev > 18 && w.opt > -22, sup: w => [w.dev > 18, w.ul > 40, w.opt > -22, w.dl < 75],
      ev: w => [[w.dev > 18, `${f(w.dev, 0)} appareils > 18`], [w.ul > 40, `Montant soutenu ${f(w.ul)} Mbps`], [w.opt > -22, `Optique saine ${f(w.opt)} dBm`]] },
    { id: 'wifi', test: w => w.wifi < -72 && w.dl > 80 && w.loc < 45, sup: w => [w.wifi < -72, w.dl > 80, w.loc < 45, w.opt > -22],
      ev: w => [[w.wifi < -72, `Niveau Wi-Fi ${f(w.wifi, 0)} dBm < −72 dBm`], [w.dl > 80, `WAN ${f(w.dl, 0)} % > 80 % du souscrit`], [w.loc < 45, `Local ${f(w.loc, 0)} % < 45 %`], [w.opt > -22, `Optique saine ${f(w.opt)} dBm`]] },
    { id: 'amont', test: w => w.loss > 8 && w.lat > 120 && w.opt > -22, sup: w => [w.loss > 8, w.lat > 120, w.opt > -22, w.dl < 50],
      ev: w => [[w.loss > 8, `Perte ${f(w.loss)} % > 8 %`], [w.lat > 120, `Latence ${f(w.lat, 0)} ms > 120 ms`], [w.opt > -22, `Optique saine ${f(w.opt)} dBm`]] },
    { id: 'congestion', test: w => w.lat > 45 && w.dl < 70 && w.loss < 3, sup: w => [w.lat > 45, w.dl < 70, w.loss < 3, w.opt > -22],
      ev: w => [[w.lat > 45, `Latence ${f(w.lat, 0)} ms > 45 ms`], [w.dl < 70, `Débit ${f(w.dl, 0)} % < 70 %`], [w.loss < 3, `Perte ${f(w.loss)} % < 3 %`]] },
  ];
  const RNAME = { rupture: 'Rupture optique', attenuation: 'Atténuation optique', partage: 'Partage illicite', wifi: 'Problème Wi-Fi', amont: 'Incident amont', congestion: 'Congestion' };

  /* ---------- Ligne de base robuste (EF-M1-3, CDC 7.1) ----------
   * Par métrique et par tranche horaire : médiane et MAD sur 7 jours glissants.
   * z = (x − med) / (1,4826 · MAD). La MAD résiste à une panne présente dans l'historique. */
  // Profil horaire réaliste d'un abonné abidjanais : pointe 19 h–23 h.
  const peakFactor = h => (h >= 19 && h <= 23 ? 1 : h >= 12 && h <= 14 ? 0.4 : h >= 1 && h <= 6 ? -0.3 : 0);
  class Baseline {
    constructor(days = 7) { this.days = days; this.slots = {}; } // slots[h][k] = [valeurs horaires]
    add(hour, sample) {
      const s = this.slots[hour] = this.slots[hour] || {};
      METRICS9.concat('loc').forEach(k => { const a = s[k] = s[k] || []; a.push(sample[k]); if (a.length > this.days) a.shift(); });
    }
    stat(hour, k) {
      const a = this.slots[hour] && this.slots[hour][k]; if (!a || a.length < 3) return null;
      const m = med(a), mad = med(a.map(x => Math.abs(x - m)));
      return { med: m, mad, scale: Math.max(1.4826 * mad, MIN_SCALE[k] || 0.5) };
    }
    z(hour, k, x) { const s = this.stat(hour, k); return s ? (x - s.med) / s.scale : 0; }
    // Historique simulé de 7 jours (en production : agrégats horaires réels, CDC 6.2).
    static seed(rng = Math.random, opts = {}) {
      const b = new Baseline();
      const jitter = (k, amp) => (rng() - 0.5) * 2 * amp * (NOISE[k] || 0.5);
      for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
        const p = peakFactor(h), s = {};
        METRICS9.concat('loc').forEach(k => { s[k] = BASE[k] + jitter(k, 3); });
        s.dl -= 22 * Math.max(0, p); s.loc -= 18 * Math.max(0, p); s.lat += 30 * Math.max(0, p); s.dev += Math.round(3 * Math.max(0, p));
        // Une panne ancienne dans l'historique : la MAD l'ignore, l'écart-type non.
        if (opts.pastFault && d === 2 && h === 21) { s.dl = 0; s.lat = 400; s.loss = 60; }
        b.add(h, s);
      }
      return b;
    }
  }
  const MIN_SCALE = { dl: 2, ul: 1.5, lat: 1.5, jit: 0.6, loss: 0.1, opt: 0.4, snr: 0.6, wifi: 2, dev: 1, loc: 3 };

  /* Classification hybride (CDC 6.3) : les règles physiques priment ; l'écart à la ligne de base
   * corrobore (confiance) et signale les dérives qu'aucune règle ne couvre encore. */
  function detect(w, ctx = {}) {
    const baseline = ctx.baseline, hour = ctx.hour ?? new Date().getHours();
    const z = {};
    if (baseline) ['dl', 'loc', 'lat', 'loss', 'opt', 'wifi', 'dev'].forEach(k => { z[k] = baseline.z(hour, k, w[k]); });
    const bad = baseline ? [['dl', -1], ['loc', -1], ['lat', 1], ['loss', 1], ['opt', -1], ['wifi', -1], ['dev', 1]].filter(([k, s]) => z[k] * s > 4) : [];
    let hit = null; const trace = [];
    RULES.forEach(r => {
      if (hit) { trace.push({ id: r.id, name: RNAME[r.id], st: 'masquée' }); return; }
      if (r.test(w)) { hit = r; trace.push({ id: r.id, name: RNAME[r.id], st: 'déclenchée' }); }
      else trace.push({ id: r.id, name: RNAME[r.id], st: 'négative' });
    });
    const zEv = bad.slice(0, 2).map(([k]) => [true, `Écart à votre habitude ${LABEL[k]} : z = ${f(z[k])} (tranche ${hour} h)`]);
    if (!hit) {
      // Congestion à l'heure de pointe : 60 % peut être normal pour CET abonné à CETTE heure (CDC 7.1).
      if (bad.length >= 2 && !(bad.every(([k]) => k === 'dev'))) {
        trace.push({ id: 'anomalie', name: 'Écart à la ligne de base', st: 'retenue' }, { id: 'sain', name: 'Ligne saine', st: 'masquée' });
        return { cls: 'anomalie', conf: Math.min(0.9, 0.55 + 0.05 * bad.length), ev: zEv.concat([[false, 'Aucun seuil physique franchi']]), trace, z };
      }
      trace.push({ id: 'sain', name: 'Ligne saine', st: 'retenue' });
      const sup = [w.opt > -22, w.dl > 85, w.wifi > -65, w.loss < 0.5, w.lat < 20];
      return { cls: 'sain', conf: 0.6 + 0.39 * sup.filter(Boolean).length / sup.length, trace, z,
        ev: [[w.opt > -22, `Puissance optique ${f(w.opt)} dBm · nominal −18`], [w.dl > 85, `Débit ${f(w.dl, 0)} / 100 Mbps`], [w.wifi > -65, `Wi-Fi ${f(w.wifi, 0)} dBm`], [w.lat < 20, `Latence ${f(w.lat, 0)} ms`]] };
    }
    trace.push({ id: 'sain', name: 'Ligne saine', st: 'masquée' });
    const s = hit.sup(w);
    // La ligne de base corrobore : +0,05 si l'écart robuste confirme, sans jamais contredire une règle.
    const corro = bad.length ? 0.05 : 0;
    return { cls: hit.id, conf: Math.min(0.99, 0.6 + 0.34 * s.filter(Boolean).length / s.length + corro), ev: hit.ev(w).concat(zEv.slice(0, 1)), trace, z };
  }
  const LABEL = { dl: 'débit box', loc: 'débit local', lat: 'latence', loss: 'perte', opt: 'puissance optique', wifi: 'niveau Wi-Fi', dev: 'appareils' };

  /* ---------- Simulateur de ligne (CDC 6.1) ---------- */
  class LineSim {
    constructor(opts = {}) { this.m = { ...BASE, link: 1 }; this.win = []; this.rng = opts.rng || Math.random; this.noise = opts.noise || 1; }
    step(mode, target) {
      const tg = target || PROFILES[mode] || BASE, slow = mode === 'attenuation', rate = slow ? 0.07 : mode === 'rupture' ? 0.6 : 0.35;
      KEYS.forEach(k => {
        const n = NOISE[k] * this.noise * (tg[k] === 0 ? 0 : 1);
        let v = this.m[k] + (tg[k] - this.m[k]) * rate + (this.rng() - 0.5) * 2 * n;
        if (k !== 'opt' && k !== 'wifi') v = Math.max(0, v);
        if (k === 'dev') v = Math.round(v + (tg[k] - v) * 0.5);
        this.m[k] = v;
      });
      this.m.link = this.m.opt < -34 ? 0 : 1;
      this.win.push({ ...this.m }); if (this.win.length > 9) this.win.shift();
      return { ...this.m };
    }
    // Fenêtre glissante 9 s, médiane par métrique (CDC 5.2).
    window() { const w = {}; [...KEYS, 'link'].forEach(k => w[k] = med(this.win.map(s => s[k]))); return w; }
  }

  /* ---------- Agent embarqué : échantillonnage adaptatif + tampon (EF-M1-1, EF-M1-2, ENF-8) ---------- */
  const BYTES_PER_SAMPLE = 9 * 4 + 8 + 16; // 9 float32 + horodatage + en-tête compact
  class Collector {
    constructor() { this.mode = 'diagnostic'; this.buffer = []; this.sent = 0; this.bytes = 0; this.replayed = 0; this.fine = true; this.lastVeille = 0; }
    setFine(on) { this.fine = on; if (!on) this.mode = 'veille'; }
    // Retourne true si l'échantillon est transmis (ou mis en tampon) à cette seconde.
    tick(t, sample, wanUp, anomaly) {
      if (this.fine && anomaly) this.mode = 'diagnostic';
      const due = this.mode === 'diagnostic' || t - this.lastVeille >= 60;
      if (!due) return null;
      this.lastVeille = t;
      const rec = { t, ...pick(sample) };
      if (!wanUp) { this.buffer.push(rec); if (this.buffer.length > 3600) this.buffer.shift(); return 'buffer'; }
      let replay = 0;
      if (this.buffer.length) { replay = this.buffer.length; this.replayed += replay; this.bytes += replay * BYTES_PER_SAMPLE; this.buffer = []; }
      this.sent++; this.bytes += BYTES_PER_SAMPLE;
      return replay ? 'replay:' + replay : 'sent';
    }
    static monthlyVeilleMB() { return 60 * 24 * 30 * BYTES_PER_SAMPLE / 1e6; }
  }
  const pick = s => { const o = {}; METRICS9.forEach(k => o[k] = s[k]); return o; };

  // Monte-Carlo aveugle : même simulateur, même moteur, jamais le type injecté (critère 3.2).
  function simulate(mode, noise = 1, sev = 0, maxT = 60, rng = Math.random, ctx = {}) {
    const s = 1 - rng() * sev, tgt = {};
    KEYS.forEach(k => { tgt[k] = mode === 'nominal' ? BASE[k] : BASE[k] + (PROFILES[mode][k] - BASE[k]) * s; });
    const sim = new LineSim({ rng, noise });
    for (let i = 0; i < 9; i++) sim.step('nominal');
    let first = null, cls = 'sain', fa = false; const exp = EXPECT[mode];
    for (let t = 1; t <= maxT; t++) {
      sim.step(mode, tgt);
      cls = detect(sim.window(), ctx).cls;
      if (cls === exp) { if (first === null) first = t; } else if (mode !== 'nominal' && first !== null && t > first + 3) first = null;
      if (mode === 'nominal' && cls !== 'sain') fa = true;
    }
    return { exp, got: cls, first, fa };
  }

  Object.assign(FG, { SUB, BASE, PROFILES, NOISE, KEYS, METRICS9, CLS, CLSORD, EXPECT, RULES, RNAME, f, med, detect, Baseline, LineSim, Collector, simulate, peakFactor });
  if (typeof module !== 'undefined' && module.exports) module.exports = FG;
})(typeof window !== 'undefined' ? window : globalThis);
