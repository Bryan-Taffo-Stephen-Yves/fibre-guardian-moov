/* Pack de langue : dioula. Réponse courte en dioula + traduction française (EF-M5-6).
 * Textes à faire valider par des locuteurs natifs lors de la constitution du corpus (CDC 7.3, 12.1). */
(function (root) {
  const FG = root.FG = root.FG || {};
  (FG.LANG_QUEUE = FG.LANG_QUEUE || []).push({
    id: 'dioula', label: 'Dioula', name: 'dioula', translateTo: 'fr',
    placeholder: 'I ka gɛlɛya fɔ…',
    quick: ['N ka connexion man nyi', 'Mun bɛ n ka ligne la ?'],
    verdict: {
      sain: 'I ka ligne ka nyi kosɛbɛ.', rupture: 'Fibre tigɛra. I ka box tɛ.', attenuation: 'Fibre fanga bɛ dɔgɔya. A labɛn sisan.',
      wifi: 'I ka Wi-Fi fanga dɔgɔyara, fibre ka nyi.', amont: 'Gɛlɛya bɛ Moov ka rezo la. I ka minɛnw ka nyi.',
      congestion: 'Rezo fara ye sisan. I ka ligne ka nyi.', partage: 'Minɛn caman bɛ i ka ligne kan.', anomalie: 'I ka ligne tɛ i ko a ka kan. An bɛ a lajɛ.',
      reboot: 'I ka box bɛ ka wuli kokura…',
    },
    keywords: {
      appel: ['101', 'technicien', 'wele', 'weele'],
      reboot: ['redemarr', 'reboot'],
      wifi: ['wifi', 'wi-fi'],
      coupure: ['tigɛ', 'tige', 'mun be', 'mun bɛ', 'a te taa', 'a tɛ taa'],
      lent: ['man nyi', 'ma nyi', 'mandi', 'dɔgɔ', 'dogo'],
      salut: ['i ni ce', 'i ni sogoma', 'i ni wula', 'a ni ce'],
    },
    // Dioula : verdict + chiffre mesuré ; la réponse complète (3 à 5 phrases) est donnée en français.
    reply(cls, m) { return `${this.verdict[cls]} (${cls === 'wifi' ? m.wi : m.o} dBm)`; },
  });
})(typeof window !== 'undefined' ? window : globalThis);
