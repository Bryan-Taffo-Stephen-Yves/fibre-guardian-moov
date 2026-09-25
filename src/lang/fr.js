/* Pack de langue : français. Ajouter une langue = ajouter un fichier sur ce modèle
 * et son nom dans lang/manifest.js (ENF-23). Aucune modification du code applicatif. */
(function (root) {
  const FG = root.FG = root.FG || {};
  (FG.LANG_QUEUE = FG.LANG_QUEUE || []).push({
    id: 'fr', label: 'FR', name: 'français', translateTo: null,
    placeholder: 'Décrivez votre problème…',
    quick: ['Pourquoi ma connexion est lente ?', 'Est-ce que je dois appeler le 101 ?'],
    verdict: {
      sain: 'Votre ligne est en pleine forme.', rupture: "Coupure de la fibre. Ce n'est pas votre box.",
      attenuation: 'Signal fibre en baisse. Agir maintenant évite la coupure.', wifi: 'Votre Wi-Fi faiblit, la fibre est bonne.',
      amont: 'Incident sur le réseau Moov. Votre installation est saine.', congestion: 'Réseau chargé à cette heure. Votre ligne est saine.',
      partage: "Beaucoup d'appareils sur votre ligne.", anomalie: 'Votre ligne sort de ses habitudes. Nous surveillons.',
      reboot: 'Redémarrage de votre box…',
    },
    // Mots-clés d'intention (minuscules, sans accents). Le corpus d'évaluation les affine.
    keywords: {
      appel: ['appeler', '101', 'technicien', 'conseiller', 'service client'],
      reboot: ['redemarr', 'rallum', 'eteindre', 'reboot', 'debranch'],
      wifi: ['wifi', 'wi-fi', 'chambre', 'salon', 'signal du telephone'],
      coupure: ['coupe', 'plus rien', 'marche pas', 'rien ne marche', 'pas de connexion', 'plus internet'],
      lent: ['lent', 'rame', 'saccade', 'lag', 'charge pas', 'debit', 'vitesse'],
      salut: ['bonjour', 'bonsoir', 'salut', 'merci'],
    },
    reply(cls, m, intent) {
      const R = {
        sain: `Votre fibre est saine : ${m.dl} Mbps mesurés à la box pour 100 souscrits, puissance optique ${m.o} dBm. Aucun défaut réseau n'apparaît. Si un appareil est lent, rapprochez-le de la box. Action proposée : redémarrer la box à distance.`,
        rupture: `La lumière n'arrive plus jusqu'à votre box : puissance optique ${m.o} dBm, sous le seuil de −36 dBm. Ce n'est pas votre box, vous n'avez rien à faire chez vous. Un signalement avec le diagnostic complet peut partir maintenant, avec un créneau proposé.`,
        attenuation: `Le signal de votre fibre baisse : ${m.o} dBm contre −18 dBm habituellement. Votre débit tient encore (${m.dl} Mbps), mais la coupure se prépare. Cause probable : connecteur encrassé ou fibre pincée. Suivez le guide de nettoyage du connecteur.`,
        wifi: `La fibre est bonne : ${m.dl} Mbps arrivent à la box. C'est votre Wi-Fi qui faiblit : ${m.wi} dBm sur votre téléphone, qui ne reçoit que ${m.lo} Mbps. Pas besoin de technicien. Je peux changer automatiquement le canal Wi-Fi.`,
        amont: `Votre installation est saine, puissance optique ${m.o} dBm. Le problème est sur le réseau Moov : ${m.ls} % de paquets perdus, latence ${m.la} ms. Nos équipes sont prévenues. Suivez le rétablissement en direct.`,
        congestion: `Votre ligne est saine. Le réseau est chargé à cette heure : latence ${m.la} ms, débit ${m.dl} Mbps. Les gros téléchargements passeront mieux la nuit. Je peux les programmer hors pointe.`,
        partage: `Votre ligne est saine, mais ${m.dv} appareils y sont connectés avec un envoi soutenu de ${m.ul} Mbps. C'est bien plus qu'un foyer. Une offre partagée légale existe pour ce cas.`,
        anomalie: `Aucun seuil de panne n'est franchi, mais votre ligne s'écarte de ses valeurs habituelles à cette heure : débit ${m.dl} Mbps, latence ${m.la} ms. Je surveille en continu et vous préviens si cela s'aggrave. Vous pouvez redémarrer la box à distance.`,
      };
      const lead = {
        appel: { sain: "Pas besoin d'appeler le 101.", rupture: "Pas besoin d'appeler le 101 : je m'en charge.", wifi: "Pas besoin d'appeler le 101.", attenuation: 'Un technicien peut venir, mais préparé.', amont: "Pas besoin d'appeler : l'incident est déjà connu.", congestion: "Pas besoin d'appeler.", partage: "Pas besoin d'appeler.", anomalie: "Pas besoin d'appeler pour l'instant." },
        reboot: { rupture: 'Redémarrer la box ne changera rien ici.', amont: 'Redémarrer la box ne changera rien ici.', wifi: 'Un redémarrage aide peu.', attenuation: 'Un redémarrage ne corrige pas un signal faible.' },
        wifi: { rupture: "Ce n'est pas le Wi-Fi : c'est la fibre.", amont: "Ce n'est pas votre Wi-Fi.", attenuation: "Ce n'est pas le Wi-Fi : c'est le signal de la fibre." },
        salut: { sain: 'Bonjour.', rupture: 'Bonjour.', wifi: 'Bonjour.', attenuation: 'Bonjour.', amont: 'Bonjour.', congestion: 'Bonjour.', partage: 'Bonjour.', anomalie: 'Bonjour.' },
      };
      const l = lead[intent] && lead[intent][cls];
      return (l ? l + ' ' : '') + R[cls];
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
