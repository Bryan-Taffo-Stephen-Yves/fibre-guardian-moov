// « Alertes sur ce téléphone » : Guardian prévient même quand l'application est fermée (Web Push, push.cjs côté serveur).
// Client : dans « Mon compte ». Technicien : sur « Mes missions ». Sur iPhone, Safari ne le permet qu'à l'application
// ajoutée à l'écran d'accueil (iOS 16.4 ou plus récent) : la carte explique comment faire, en deux gestes.
(function (root) {
  'use strict';
  const h = React.createElement, {useState: S, useEffect: E} = React;
  const nav = root.navigator || {};
  const supported = () => 'serviceWorker' in nav && 'PushManager' in root && 'Notification' in root;
  const iphone = () => /iPhone|iPad|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const installed = () => { try { return root.matchMedia('(display-mode: standalone)').matches || nav.standalone === true; } catch (_) { return false; } };
  const bytes = text => { const b = atob(String(text).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(text).length % 4) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const same = (a, b) => { if (!a || !b) return false; const x = new Uint8Array(a), y = new Uint8Array(b); return x.length === y.length && x.every((v, i) => v === y[i]); };
  const worker = () => Promise.race([nav.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('Rechargez la page puis réessayez.')), 8000))]);

  // L'abonnement du téléphone, refait si la clé du serveur a changé, puis envoyé au serveur (qui l'oublie à chaque redémarrage).
  async function attach(api, reg) {
    const {publicKey} = await api('/push');
    if (!publicKey) throw new Error('Les alertes ne sont pas disponibles pour le moment.');
    const key = bytes(publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !same(sub.options && sub.options.applicationServerKey, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key});
    await api('/push', 'POST', sub.toJSON());
    return sub;
  }
  // À chaque ouverture : un téléphone déjà autorisé se réinscrit sans rien demander.
  let syncing = null;
  function sync(api) { return syncing || (syncing = resync(api).finally(() => { syncing = null; })); }
  async function resync(api) {
    try {
      if (!supported() || Notification.permission !== 'granted') return false;
      const reg = await worker(), sub = await reg.pushManager.getSubscription();
      if (!sub) return false;
      await attach(api, reg); return true;
    } catch (_) { return false; }
  }
  async function enable(api) {
    // La question du téléphone doit venir tout de suite après le geste (Safari l'exige).
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm;
    const sub = await attach(api, await worker());
    await api('/push/essai', 'POST', {endpoint: sub.endpoint}).catch(() => {});
    return 'on';
  }
  async function disable(api) {
    if (!supported() || Notification.permission !== 'granted') return 'off';
    const reg = await worker(), sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/push', 'DELETE', {endpoint: sub.endpoint}).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    return 'off';
  }
  async function current() {
    if (!supported()) return iphone() && !installed() ? 'install' : 'absent';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission !== 'granted') return 'off';
    try { const reg = await worker(); return (await reg.pushManager.getSubscription()) ? 'on' : 'off'; } catch (_) { return 'off'; }
  }

  const BELL = 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4';
  const icon = size => h('svg', {width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false}, h('path', {d: BELL}));
  const HINT = {
    off: 'Soyez prévenu d’une panne ou d’un message, même quand l’application est fermée.',
    on: 'Activées : Guardian vous prévient même quand l’application est fermée.',
    denied: 'Bloquées. Autorisez les notifications de Fibre Guardian dans les réglages du téléphone.',
    install: 'Sur iPhone : touchez Partager, puis « Sur l’écran d’accueil ». Ouvrez Fibre Guardian depuis cette icône, puis revenez ici.',
    absent: 'Ce navigateur ne peut pas recevoir les alertes. Essayez avec Chrome, Edge ou Safari à jour.'
  };
  const TECH = {off: 'Recevez vos nouvelles missions, même quand l’application est fermée.', on: 'Activées : vos missions arrivent même quand l’application est fermée.'};

  // look : 'client' (ligne de « Mon compte ») ou 'tech' (carte de « Mes missions »).
  function Card({api, look = 'client'}) {
    const [st, T] = S(null), [busy, B] = S(false), [err, X] = S('');
    E(() => { let alive = true; current().then(v => { if (alive) T(v); }); sync(api); return () => { alive = false; }; }, []);
    if (!st) return null;
    async function run(fn) { if (busy) return; B(true); X(''); try { T(await fn(api)); } catch (e) { X(e.message || 'Impossible pour le moment. Réessayez.'); } finally { B(false); } }
    const hint = (look === 'tech' && TECH[st]) || HINT[st];
    const action = st === 'off' ? h('button', {type: 'button', className: look === 'tech' ? 'tv-btn primary' : 'ch-chip strong', disabled: busy, onClick: () => run(enable)}, busy ? 'Un instant…' : 'Activer')
      : st === 'on' ? h('button', {type: 'button', className: look === 'tech' ? 'tv-btn' : 'ch-chip', disabled: busy, onClick: () => run(disable)}, busy ? 'Un instant…' : 'Arrêter') : null;
    const text = h('span', {className: 'fp-text'}, h('b', null, 'Alertes sur ce téléphone'), h('small', null, hint));
    return h('section', {className: (look === 'tech' ? 'tv-card ' : 'ch-group ') + 'fp-card fp-' + st, 'aria-live': 'polite'},
      h('div', {className: 'fp-row'}, h('span', {className: look === 'tech' ? 'fp-icon' : 'ch-row-icon fp-icon'}, icon(19)), text, action),
      err && h('p', {className: 'fp-error', role: 'alert'}, err));
  }

  root.FGPush = {Card, sync, enable, disable, current, supported};
})(window);
