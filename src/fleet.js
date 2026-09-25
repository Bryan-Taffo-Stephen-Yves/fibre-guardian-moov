/* Fibre Guardian · M10 détection collaborative + M12 score de résiliation, sur simulateur de flotte.
 * Chaque abonné a sa propre ligne simulée et son propre moteur (engine.js). L'agrégateur ne lit que
 * les verdicts horodatés par segment de répartiteur : il ignore quelle panne a été provoquée. */
(function (root) {
  const FG = root.FG = root.FG || {};
  const { LineSim, detect, CLS } = FG;

  const FIRST = ['Awa', 'Kouassi', 'Mariam', 'Yao', 'Aminata', 'Konan', 'Fatou', 'Serge', 'Adjoua', 'Ibrahim', 'Akissi', 'Moussa', 'Aya', 'Drissa', 'Affoué', 'Bakary'];
  const LAST = 'KADBTFSNOGCYMLEZ';
  // Segments de répartiteur (CDC 11.2 : zone de 48 abonnés simulés).
  const SEGMENTS = [
    { id: 'YOP-07', commune: 'Yopougon', n: 20 },
    { id: 'ABO-03', commune: 'Abobo', n: 10 },
    { id: 'COC-12', commune: 'Cocody', n: 10 },
    { id: 'KOU-02', commune: 'Koumassi', n: 8 },
  ];

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const sig = x => 1 / (1 + Math.exp(-x));

  /* M12 : score de résiliation (EF-M12-1..3).
   * Régression logistique sur signaux techniques et comportementaux. Poids posés à la main, documentés,
   * à ré-estimer sur l'historique de résiliations Moov (CDC 4.2). */
  const CHURN_W = { bias: -3.1, incidents30: 0.55, degradedH: 0.035, gap: 2.2, contacts: 0.6, usageDrop: 1.8 };
  function churnRaw(x) {
    return sig(CHURN_W.bias + CHURN_W.incidents30 * x.incidents30 + CHURN_W.degradedH * x.degradedH
      + CHURN_W.gap * x.gap + CHURN_W.contacts * x.contacts + CHURN_W.usageDrop * x.usageDrop);
  }
  const CHURN_ALPHA = 0.03; // lissage exponentiel (EF-M12-2) : un incident ponctuel ne fait pas osciller le score
  const CHURN_THRESHOLD = 60;
  function retentionFor(sub) {
    const x = sub.feat;
    if (sub.score < CHURN_THRESHOLD) return x.contacts >= 2 ? 'SMS d’information' : 'Aucune';
    if (sub.incidentOpen) return 'Prévenir avant l’appel · geste proposé';
    if (x.gap > 0.35) return 'Visite technicien prioritaire';
    if (x.contacts >= 3) return 'Appel conseiller dédié';
    if (x.usageDrop > 0.4) return 'Offre adaptée hors pointe';
    return 'Appel proactif, diagnostic à distance';
  }

  class Fleet {
    constructor(opts = {}) {
      this.rng = opts.rng || Math.random;
      this.t = 0; this.subs = []; this.events = []; this.incidents = {}; this.faults = {};
      this.windowS = opts.windowS || 180; // fenêtre courte : 3 minutes (CDC 9.4)
      this.minCount = opts.minCount || 5; this.minShare = opts.minShare || 0.25; // seuil d'incident de zone (EF-M10-2)
      let i = 0;
      SEGMENTS.forEach(seg => { for (let k = 0; k < seg.n; k++, i++) {
        const r = this.rng;
        const feat = { incidents30: Math.floor(r() * 3), degradedH: r() * 20, gap: r() * 0.25, contacts: Math.floor(r() * 3), usageDrop: r() * 0.3 };
        const sub = { id: 'AB' + String(1000 + i), name: FIRST[i % FIRST.length] + ' ' + LAST[(i * 7 + Math.floor(i / FIRST.length) * 3) % LAST.length] + '.', seg: seg.id, commune: seg.commune,
          sim: new LineSim({ rng: this.rng }), cls: 'sain', since: 0, feat, calledAt: null, notifiedAt: null, incidentOpen: false };
        sub.score = Math.round(100 * churnRaw(feat)); sub.prev = sub.score; sub.trend = '→';
        this.subs.push(sub);
      } });
      // Profils connus de la démonstration.
      const set = (n, patch) => { const s = this.subs.find(x => x.name.startsWith(n)); if (s) { Object.assign(s.feat, patch); s.score = s.prev = Math.round(100 * churnRaw(s.feat)); } };
      set('Mariam', { incidents30: 4, contacts: 3, degradedH: 30 }); set('Serge', { gap: 0.45, incidents30: 3 }); set('Konan', { incidents30: 0, contacts: 0, gap: 0.02, usageDrop: 0, degradedH: 1 });
      for (let k = 0; k < 10; k++) this.step();
    }
    segment(id) { return SEGMENTS.find(s => s.id === id); }
    // Superviseur : coupe un segment. Seul le simulateur le sait ; l'agrégateur ne voit que les verdicts.
    cutSegment(segId, mode = 'amont', spreadS = 150) {
      this.subs.filter(s => s.seg === segId).forEach(s => { if (this.rng() < 0.85) this.faults[s.id] = { mode, at: this.t + Math.floor(this.rng() * spreadS) }; });
    }
    restore(segId) { this.subs.filter(s => !segId || s.seg === segId).forEach(s => { delete this.faults[s.id]; }); }
    step() {
      this.t++;
      const t = this.t;
      this.subs.forEach(s => {
        const fl = this.faults[s.id], mode = fl && t >= fl.at ? fl.mode : 'nominal';
        s.sim.step(mode);
        const d = detect(s.sim.window());
        if (d.cls !== s.cls) {
          if (d.cls !== 'sain') this.events.push({ t, sub: s.id, seg: s.seg, cls: d.cls });
          s.cls = d.cls; s.since = t;
        }
        // Un abonné dégradé non prévenu finit par appeler le 101 (4 à 9 min après le début).
        if (s.cls !== 'sain' && CLS[s.cls].st !== 'ok' && !s.notifiedAt && !s.calledAt && t - s.since > 240 + (parseInt(s.id.slice(2)) % 5) * 60) s.calledAt = t;
        if (s.cls === 'sain') { s.calledAt = null; if (!this.incidents[s.seg]) s.notifiedAt = null; }
        // Signaux M12 : minutes dégradées alimentent la durée cumulée, un appel est un contact support.
        if (s.cls !== 'sain') s.feat.degradedH += 0.05; // 1 pas de démo ≈ 3 min réelles, pour rendre la tendance visible
        // Écart au débit souscrit : moyenne glissante (un creux ponctuel pèse peu).
        s.feat.gap += 0.01 * (Math.max(0, 1 - s.sim.window().dl / 100) - s.feat.gap);
        if (s.calledAt === t) s.feat.contacts += 1;
        s.incidentOpen = !!this.incidents[s.seg];
        const raw = 100 * churnRaw(s.feat);
        s.prev = s.score; s.score = s.score + CHURN_ALPHA * (raw - s.score);
      });
      this.events = this.events.filter(e => t - e.t <= this.windowS);
      this.aggregate();
    }
    // EF-M10-1/2 : agrégation par segment dans la fenêtre courte.
    aggregate() {
      const t = this.t;
      SEGMENTS.forEach(seg => {
        const degraded = this.subs.filter(s => s.seg === seg.id && s.cls !== 'sain');
        const recent = new Set(this.events.filter(e => e.seg === seg.id).map(e => e.sub));
        const count = degraded.filter(s => recent.has(s.id)).length;
        const inc = this.incidents[seg.id];
        if (!inc && count >= this.minCount && count / seg.n >= this.minShare) {
          const firstCall = this.subs.filter(s => s.seg === seg.id && s.calledAt).length;
          this.incidents[seg.id] = { seg: seg.id, at: t, count, beforeFirstCall: firstCall === 0, eta: '1 h 40', dominant: dominant(degraded) };
          // EF-M10-3 : les abonnés du segment sont prévenus avant d'appeler.
          this.subs.filter(s => s.seg === seg.id).forEach(s => { s.notifiedAt = t; });
        } else if (inc) {
          inc.count = Math.max(inc.count, count);
          this.subs.filter(s => s.seg === seg.id && s.cls !== 'sain').forEach(s => { s.notifiedAt = s.notifiedAt || t; });
          if (degraded.length === 0) { inc.closedAt = t; delete this.incidents[seg.id]; this.closed = (this.closed || []).concat(inc); }
        }
      });
    }
    segmentStats(segId) {
      const subs = this.subs.filter(s => s.seg === segId);
      return { n: subs.length, degraded: subs.filter(s => s.cls !== 'sain').length, calls: subs.filter(s => s.calledAt).length,
        notified: subs.filter(s => s.notifiedAt).length, incident: this.incidents[segId] || null };
    }
    // EF-M9-3/4 : classement par risque, tendance et action proposée (jamais exécutée seule, EF-M12-3).
    ranking(limit = 10) {
      return this.subs.map(s => {
        const sc = Math.round(s.score), d = s.score - (s.ref ?? s.score);
        return { id: s.id, name: s.name, commune: s.commune, seg: s.seg, score: sc, trend: d > 0.3 ? '↑' : d < -0.3 ? '↓' : '→', action: retentionFor(s), cls: s.cls };
      }).sort((a, b) => b.score - a.score).slice(0, limit);
    }
    // Référence de tendance : score d'il y a ~30 pas.
    markTrend() { this.subs.forEach(s => { s.ref = s.score; }); }
  }
  const dominant = subs => { const c = {}; subs.forEach(s => c[s.cls] = (c[s.cls] || 0) + 1); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'amont'; };

  Object.assign(FG, { SEGMENTS, Fleet, churnRaw, CHURN_W, CHURN_THRESHOLD });
  if (typeof module !== 'undefined' && module.exports) module.exports = FG;
})(typeof window !== 'undefined' ? window : globalThis);
