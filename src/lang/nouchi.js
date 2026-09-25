/* Pack de langue : nouchi (argot ivoirien). Textes à valider par le corpus d'évaluation (CDC 7.3). */
(function (root) {
  const FG = root.FG = root.FG || {};
  (FG.LANG_QUEUE = FG.LANG_QUEUE || []).push({
    id: 'nouchi', label: 'Nouchi', name: 'nouchi ivoirien', translateTo: null,
    placeholder: 'Dis ce qui se passe…',
    quick: ['mon wifi là il gère pas dèh', "y'a quoi sur ma ligne dèh ?"],
    verdict: {
      sain: 'Ta ligne là est propre, tout gère.', rupture: "La fibre est coupée dèh. C'est pas ta box qui est gâtée.",
      attenuation: 'Signal de ta fibre commence à fatiguer. Faut agir avant ça coupe.', wifi: "C'est ton Wi-Fi qui gère pas, la fibre est propre.",
      amont: "C'est chez Moov ça bloque, ton matériel est propre.", congestion: "Réseau est chargé à l'heure-ci, ta ligne est propre.",
      partage: "Y'a trop d'appareils qui tapent ta connexion là.", anomalie: "Ta ligne fait un peu drôle, on est dessus.",
      reboot: 'On redémarre ta box…',
    },
    keywords: {
      appel: ['appeler', '101', 'technicien', 'faut j appelle', 'faut appeler', 'gars de moov'],
      reboot: ['redemarr', 'eteindre', 'rallum', 'debranch'],
      wifi: ['wifi', 'wi-fi', 'chambre', 'salon', 'reseau du phone'],
      coupure: ['ya fohi', "y'a fohi", 'coupe', 'rien ne marche', 'ca marche pas', 'ca veut pas', 'connexion est partie', 'y a quoi', "y'a quoi"],
      lent: ['gere pas', 'traine', 'lent', 'lourd', 'charge pas', 'saccade', 'rame', 'tourne'],
      salut: ['bonjour', 'bonsoir', 'salut', 'on dit quoi', 'merci', 'yako'],
    },
    reply(cls, m, intent) {
      const R = {
        sain: `Ta fibre est propre dèh : ${m.dl} Mbps arrivent sur la box, tu as pris 100. Signal c'est ${m.o} dBm, ça gère. Si c'est ton phone qui traîne, rapproche-le de la box. On peut redémarrer la box à distance si tu veux.`,
        rupture: `Ya fohi sur ta ligne, la lumière arrive plus : ${m.o} dBm, c'est en dessous de −36. C'est pas ta box qui est gâtée, faut pas toucher. On envoie le signalement avec le diagnostic, technicien va venir en sachant ce qu'il cherche.`,
        attenuation: `Signal de ta fibre commence à fatiguer : ${m.o} dBm alors que c'est −18 normalement. Connexion tient encore, ${m.dl} Mbps, mais ça va couper si on laisse. Souvent c'est connecteur qui est sale ou fibre pincée derrière meuble. Regarde le guide pour nettoyer.`,
        wifi: `Ta fibre est propre, ${m.dl} Mbps tapent la box. C'est ton Wi-Fi qui est fatigué : ${m.wi} dBm sur ton phone, ça fait que tu as ${m.lo} Mbps seulement. Pas besoin de technicien dèh. On change le canal Wi-Fi maintenant ?`,
        amont: `Ton matériel est propre, signal ${m.o} dBm. C'est chez Moov que ça bloque : ${m.ls} % de paquets qui se perdent, ${m.la} ms de latence. Les gars sont déjà dessus. Tu peux suivre le rétablissement en direct.`,
        congestion: `Ta ligne est propre. C'est le réseau qui est chargé à l'heure-ci : ${m.la} ms, ${m.dl} Mbps. Gros téléchargements là, faut laisser ça pour la nuit. On peut programmer ça hors pointe.`,
        partage: `Ta ligne est propre mais ${m.dv} appareils sont dessus, et ça envoie ${m.ul} Mbps sans arrêt. Ça c'est pas un seul foyer dèh. Y'a une offre partagée légale pour ça.`,
        anomalie: `Y'a pas de panne franche, mais ta ligne est pas comme d'habitude à l'heure-ci : ${m.dl} Mbps, ${m.la} ms. On surveille, si ça gâte on te dit. Tu peux redémarrer la box à distance.`,
      };
      const lead = {
        appel: { sain: 'Faut pas appeler 101 dèh.', rupture: "Faut pas appeler, on s'occupe.", wifi: 'Faut pas appeler 101 dèh.', amont: 'Faut pas appeler, Moov est déjà au courant.', congestion: 'Faut pas appeler.', partage: 'Faut pas appeler.', attenuation: 'Technicien peut venir, mais préparé.', anomalie: 'Faut pas appeler pour le moment.' },
        reboot: { rupture: 'Redémarrer box là ça va rien changer.', amont: 'Redémarrer box là ça va rien changer.', attenuation: 'Redémarrer ça règle pas signal faible.' },
        wifi: { rupture: "C'est pas Wi-Fi, c'est la fibre même.", amont: "C'est pas ton Wi-Fi.", attenuation: "C'est pas Wi-Fi, c'est signal de la fibre." },
        salut: { sain: 'On dit quoi !', rupture: 'On dit quoi.', wifi: 'On dit quoi !', attenuation: 'On dit quoi.', amont: 'On dit quoi.', congestion: 'On dit quoi.', partage: 'On dit quoi.', anomalie: 'On dit quoi.' },
      };
      const l = lead[intent] && lead[intent][cls];
      return (l ? l + ' ' : '') + R[cls];
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
