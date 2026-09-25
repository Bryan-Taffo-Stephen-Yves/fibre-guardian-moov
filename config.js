/* Configuration de déploiement. Les fonctions vitales n'en dépendent pas (ENF-9) :
 * sans serveur, l'agent et la vision tournent en local sur le téléphone. */
window.FG_CONFIG = {
  // Serveur optionnel (server/server.mjs) : agent conversationnel et vision par modèle de langage.
  agentEndpoint: /^https?:$/.test(location.protocol) ? 'api/agent' : null,
  visionEndpoint: /^https?:$/.test(location.protocol) ? 'api/vision' : null,
};
