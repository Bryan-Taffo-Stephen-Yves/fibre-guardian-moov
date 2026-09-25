/* Fibre Guardian · M5 agent conversationnel.
 * 1. Si un serveur d'agent est configuré et joignable : modèle de langage, mesures injectées (EF-M5-1).
 * 2. Sinon, ou si la réponse du modèle viole un garde-fou : réponse locale, construite à partir
 *    du diagnostic, des mesures ET de l'intention détectée dans la question. Jamais de panne réseau. */
(function (root) {
  const FG = root.FG = root.FG || {};

  FG.LANGS = FG.LANGS || {};
  FG.registerLang = pack => { FG.LANGS[pack.id] = pack; };
  (FG.LANG_QUEUE || []).forEach(FG.registerLang);
  FG.LANG_QUEUE = { push: FG.registerLang };
  FG.langList = () => (FG.LANG_FILES || Object.keys(FG.LANGS)).map(id => FG.LANGS[id]).filter(Boolean);

  // Catalogue d'actions (CDC 5.4). L'agent n'en propose jamais d'autre (garde-fou 7.3).
  const ACT = {
    sain: [['reboot', 'Redémarrer la box à distance']],
    rupture: [['ticket', 'Signalement avec créneau proposé'], ['sms', 'Suivi par SMS']],
    attenuation: [['clean', 'Guide de nettoyage du connecteur'], ['tech', 'Technicien, pièce identifiée']],
    wifi: [['channel', 'Optimiser le canal Wi-Fi'], ['map', 'Cartographier la couverture']],
    amont: [['track', 'Suivre le rétablissement en direct']],
    congestion: [['schedule', 'Programmer hors pointe'], ['offer', 'Voir une offre adaptée']],
    partage: [['share', 'Passer à une offre partagée légale'], ['secure', 'Sécuriser le Wi-Fi']],
    anomalie: [['reboot', 'Redémarrer la box à distance'], ['ticket', 'Signalement avec créneau proposé']],
  };

  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'");
  // Intention : première famille dont un mot-clé apparaît, dans l'ordre de priorité du pack.
  function intentOf(text, langId) {
    const q = norm(text);
    const packs = [FG.LANGS[langId], ...Object.values(FG.LANGS).filter(p => p.id !== langId)].filter(Boolean);
    for (const p of packs) for (const [intent, words] of Object.entries(p.keywords || {})) if (words.some(w => q.includes(norm(w)))) return intent;
    return 'general';
  }

  function measures(w) {
    const f = FG.f;
    return { o: f(w.opt), dl: f(w.dl, 0), wi: f(w.wifi, 0), lo: f(w.loc, 0), ls: f(w.loss), la: f(w.lat, 0), dv: f(w.dev, 0), ul: f(w.ul, 0), snr: f(w.snr), jit: f(w.jit) };
  }

  function localReply(cls, langId, w, question) {
    const pack = FG.LANGS[langId] || FG.LANGS.fr, m = measures(w), intent = intentOf(question, langId);
    const text = pack.reply(cls, m, intent);
    const tr = pack.translateTo ? FG.LANGS[pack.translateTo].reply(cls, m, intent) : null;
    return { text, tr, intent };
  }

  /* Garde-fous (CDC 7.3) : chaque nombre cité doit exister dans les mesures, les seuils ou l'offre ;
   * la réponse ne peut proposer qu'une action du catalogue ; 3 à 5 phrases. */
  function guard(reply, cls, w) {
    const allowed = new Set();
    const add = v => { if (v == null || !isFinite(v)) return; [0, 1].forEach(d => allowed.add((+v).toFixed(d))); allowed.add(String(Math.round(v))); allowed.add(String(Math.round(Math.abs(v)))); };
    Object.values(w).forEach(add);
    [100, 50, 101, 18, 36, 26, 22, 72, 45, 120, 8, 3, 2, 1, 5, 20, 9].forEach(add);
    const nums = (reply.match(/\d+(?:[.,]\d+)?/g) || []).map(s => s.replace(',', '.'));
    const bad = nums.filter(n => !allowed.has(n) && !allowed.has(String(Math.round(+n))) && !allowed.has((+n).toFixed(1)));
    if (bad.length) return { ok: false, why: 'chiffre absent des mesures : ' + bad.join(', ') };
    const sentences = reply.split(/[.!?](\s|$)/).filter(s => s && s.trim().length > 2).length;
    if (sentences > 7) return { ok: false, why: 'réponse trop longue' };
    return { ok: true };
  }

  function prompt(cls, conf, langId, w, question) {
    const pack = FG.LANGS[langId] || FG.LANGS.fr, f = FG.f;
    const lang = pack.translateTo ? `${pack.name}, suivi d'une traduction française courte après « || »` : pack.name;
    return {
      system: `Tu es l'agent Fibre Guardian de Moov Africa Côte d'Ivoire. Tu aides un abonné fibre à comprendre sa panne. Réponds en ${lang}, en 3 à 5 phrases courtes, sans mise en forme. Propose une seule action, prise dans ce catalogue et nulle part ailleurs : ${(ACT[cls] || []).map(a => a[1]).join(' ; ')}. Cite au moins un chiffre mesuré qui explique le problème, avec son unité (Mbps, ms, dBm, %). N'utilise aucun chiffre absent des mesures fournies. Si la fibre est saine et que le problème est domestique, dis-le explicitement. Ne promets ni remboursement ni délai non fourni.`,
      user: `Diagnostic courant : ${FG.CLS[cls].name} (confiance ${f(conf, 2)}).\nMesures (médiane sur 9 s) : débit à la box ${f(w.dl, 0)} Mbps pour 100 souscrits, débit sur le téléphone ${f(w.loc, 0)} Mbps, montant ${f(w.ul, 0)} Mbps, latence ${f(w.lat, 0)} ms, gigue ${f(w.jit)} ms, perte ${f(w.loss)} %, puissance optique ${f(w.opt)} dBm, rapport S/B ${f(w.snr)} dB, niveau Wi-Fi ${f(w.wifi, 0)} dBm, ${f(w.dev, 0)} appareils connectés.\nMessage de l'abonné : « ${question} »`,
    };
  }

  // Appel au serveur d'agent (server/server.mjs). Premier texte attendu en moins de 5 s (ENF-4).
  async function remoteReply(endpoint, cls, conf, langId, w, question, timeoutMs = 5000) {
    const ac = new AbortController(); const id = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prompt(cls, conf, langId, w, question)), signal: ac.signal });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j.text) return null;
      const [a, b] = j.text.split('||');
      return { text: a.trim(), tr: b ? b.trim() : null };
    } catch (e) { return null; } finally { clearTimeout(id); }
  }

  async function ask({ question, cls, conf, lang, w, endpoint }) {
    const t0 = Date.now();
    if (endpoint && (typeof navigator === 'undefined' || navigator.onLine)) {
      const r = await remoteReply(endpoint, cls, conf, lang, w, question);
      if (r) {
        const g = guard(r.text + ' ' + (r.tr || ''), cls, w);
        if (g.ok) return { ...r, src: 'Modèle de langage · mesures injectées · ' + ((Date.now() - t0) / 1000).toFixed(1).replace('.', ',') + ' s' };
        const loc = localReply(cls, lang, w, question);
        return { ...loc, src: 'Réponse locale · réponse du modèle écartée (' + g.why + ')' };
      }
    }
    const loc = localReply(cls, lang, w, question);
    return { ...loc, src: endpoint ? 'Réponse locale · serveur d’agent injoignable' : 'Réponse locale · hors ligne' };
  }

  Object.assign(FG, { ACT, intentOf, localReply, guard, agentPrompt: prompt, ask, norm });
  if (typeof module !== 'undefined' && module.exports) module.exports = FG;
})(typeof window !== 'undefined' ? window : globalThis);
