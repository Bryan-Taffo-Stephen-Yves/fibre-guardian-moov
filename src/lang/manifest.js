/* Langues chargées par l'application (ENF-23). Pour ajouter une langue :
 * 1. copier src/lang/fr.js en src/lang/<code>.js et traduire les textes ;
 * 2. ajouter <code> dans la liste ci-dessous. Aucun autre fichier ne change. */
(function (root) {
  const FG = root.FG = root.FG || {};
  FG.LANG_FILES = ['fr', 'nouchi', 'dioula'];
})(typeof window !== 'undefined' ? window : globalThis);
