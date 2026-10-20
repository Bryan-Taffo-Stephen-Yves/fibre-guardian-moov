# Fibre Guardian — nouvelle interface

Version locale de démonstration, développée à partir de l’archive `fibre-guardian-a-jour.zip`. Le moteur fourni, ses tests, les bibliothèques, le serveur d’origine et l’ancienne interface sont conservés sans modification. La nouvelle interface se trouve entièrement dans `codex/`.

## Ouvrir, sans installation

1. Extraire **tout** le dossier du ZIP.
2. Double-cliquer sur `OUVRIR-GUARDIAN.html`, ou sur `codex/index.html`.
3. Choisir **Faire la visite** ou **Essayer une panne**.

Ne pas déplacer seulement `codex/index.html` : il a besoin des fichiers locaux de `src/`, `vendor/` et `codex/`. Aucune police, bibliothèque ou image ne vient d’un CDN. La nouvelle interface ne fait aucun appel au serveur conversationnel optionnel.

Pour servir la démonstration en HTTP local avec Node, depuis la racine du projet :

```sh
node codex/serveur-local.cjs
```

Ouvrir `http://127.0.0.1:8186/codex/`. Node 24.21+ est requis pour le pilote SQLite. Ce serveur écoute uniquement sur l’ordinateur local par défaut et expose maintenant une API authentifiée. **Mon espace réel** ajoute comptes, foyers, participants, tests actifs et historique durable : voir [le guide du pilote connecté](PILOTE-CONNECTE.md). Un serveur Python ou le mode fichier ne permettent que la démonstration sans API.

## Démo pré-remplie (premier lancement)

Au premier démarrage de `node codex/serveur-local.cjs` sur une base vide, la démo se remplit toute seule : un incident en cours à Cocody (COC-03, poteau percuté, plan à valider), un incident résolu cette nuit à Yopougon (YOP-07), deux dossiers clients ouverts et 24 h de notifications. Rien n'est ajouté si la base contient déjà des comptes. Pour repartir de zéro : arrêter le serveur, supprimer `codex/.local/`, relancer ; ou bouton **Réinitialiser la démo** dans « À propos de la démo » (administrateur seulement, vérifié par le serveur). Désactiver le remplissage : `GUARDIAN_SEED_DEMO=0`.

| Rôle | E-mail | Mot de passe |
|---|---|---|
| Cliente Awa Koné (Yopougon, 100 Mbps à 25 000 FCFA) | `awa.kone@demo.fibre-guardian.ci` | `awa-demo-2026` (ou `GUARDIAN_DEMO_CLIENT_PASSWORD`) |
| Direction technique (administrateur Moov) | `direction@demo.fibre-guardian.ci` | `GUARDIAN_DEMO_ADMIN_PASSWORD`, sinon généré au premier lancement et écrit dans `codex/.local/identifiants-demo.txt` (hors git) |
| Technicien Ibrahim Traoré (Fibre Cocody) | `ibrahim.traore@demo.fibre-guardian.ci` | `ibrahim-demo-2026` (ou `GUARDIAN_DEMO_TECH_PASSWORD`) |
| Un client par poteau du simulateur (voir ci-dessous) | | même mot de passe qu'Awa |

Chaque client ne reçoit que les alertes de son quartier ; si l'équipement central d'une commune tombe, tous les clients de la commune sont prévenus. Awa Koné habite Niangon (YOP-07). Les autres clients de démonstration :

- Cocody · Cité des Arts (COC-03) : Aya Kouadio, `aya.kouadio@demo.fibre-guardian.ci`
- Cocody · Palmeraie (PAL-02) : Serge Gnagne, `serge.gnagne@demo.fibre-guardian.ci`
- Cocody · Riviera Golf (RIV-04) : Mariam Diabaté, `mariam.diabate@demo.fibre-guardian.ci`
- Marcory · Résidentiel (MAR-02) : Fabrice Aké, `fabrice.ake@demo.fibre-guardian.ci`
- Abobo · Abobo Gare (ABO-01) : Moussa Coulibaly, `moussa.coulibaly@demo.fibre-guardian.ci`
- Plateau (PLA-01) : Christelle Kassi, `christelle.kassi@demo.fibre-guardian.ci`
- Adjamé · Adjamé Liberté (ADJ-01) : Salif Ouattara, `salif.ouattara@demo.fibre-guardian.ci`
- Treichville (TRE-01) : Adjoua Brou, `adjoua.brou@demo.fibre-guardian.ci`
- Koumassi (KOU-01) : Didier Zadi, `didier.zadi@demo.fibre-guardian.ci`
- Port-Bouët (PBT-01) : Fanta Sylla, `fanta.sylla@demo.fibre-guardian.ci`
- Grand-Bassam · Quartier France (BAS-01) : Rose Ehui, `rose.ehui@demo.fibre-guardian.ci`

Client : `http://127.0.0.1:8186/codex/`, puis « Compte existant ». Équipe Moov : `http://127.0.0.1:8186/codex/?portal=moov&section=operations`. Le mot de passe administrateur n'a pas de valeur par défaut : le compte qui peut tout réinitialiser n'est jamais protégé par un mot de passe connu de tous.

## Mettre en ligne et installer sur téléphone

Fibre Guardian est une application web installable (manifeste, service worker, écran hors ligne). Pour la publier sur Internet (Railway conseillé, avec un volume pour la base), suivre [DEPLOIEMENT.md](DEPLOIEMENT.md). Port, dossier de données et adresse publique se règlent par variables d'environnement.

## Guardian avec Claude

Si la variable `ANTHROPIC_API_KEY` est définie (ou écrite dans `codex/.env`, ignoré par git), Guardian fait reformuler ses réponses par Claude côté serveur (`guardian-ai.cjs`). Le moteur à règles décide toujours des faits, de l'action et de l'offre ; un garde-fou rejette toute réponse qui cite un chiffre absent des mesures, tutoie ou dépasse 5 phrases. Sans clé, en cas de délai ou d'erreur, la réponse habituelle s'affiche. Mode d'emploi : `DEPLOIEMENT.md`, section « Guardian avec Claude ».

## Charte Moov Africa

Toutes les couleurs sont dans `moov-theme.css` : bleu Moov `--moov-primary` (#005CA8), orange Moov `--moov-accent` (#F28E39, accents seulement), nuances, gris et couleurs d'état. `moov-brand.css` (chargé en dernier) donne leur rôle aux éléments clés : boutons principaux, menus, mascotte Guardian. Les composants n'écrivent jamais une couleur en dur ; le test `moov-theme.test.cjs` le vérifie, avec les contrastes AA.

## Parcours disponibles

- **Guardian — autorisations** (dans l'espace administrateur) : laboratoire serveur avec actions fictives R1–R4, risque imposé côté serveur, mode ombre, règles assisté/semi/autonome planifié, approbations distinctes pour R4, expiration, relance locale, arrêt d'urgence et annulation d'effet simulé. Aucun LLM ni microphone raccordé à ce stade. Voir la section T13 du [guide connecté](PILOTE-CONNECTE.md) pour les limites et les tests.

- **Espace administrateur** : comptes habilités côté serveur, file des dossiers que les clients ont explicitement partagés, prise en charge, messages aller-retour, historique, clôture déclarative et réouverture. Le retrait du partage et la révocation du rôle bloquent l'accès côté API. Ce premier lot n'est pas encore le centre NOC M12–M14. Pour attribuer un rôle et rejouer le scénario client/support, consulter [le guide du pilote connecté](PILOTE-CONNECTE.md).

- **Mon espace réel** : comptes locaux, foyer propriétaire/lecteurs, sessions consenties de test, téléchargement mesuré, injections bornées sur le point de test, historique SQLite, relecture/export/import, plan déclaré, seuils d’appareils, provisionnement de collecteur en lecture seule, alertes locales et dossiers support. Voir le guide pour les limites et le passage à deux appareils en HTTPS.

- **Vue d’ensemble** : état, débit comparé à l’offre, box illustrée, explication en trois étapes.
- **Ma maison** : appareils nommés (iPhone de Koffi, MacBook de Hady, LG TV…), tableau de bord à courbes, calendrier, filtre par appareil, volumes horaires/cumulés et classement journalier. Limites, suspension, blocage et confirmations. Entrer dans ce laboratoire choisit le foyer comme source commune de la vue d’ensemble, du diagnostic, de l’assistant et du centre d’incidents.
- **Incidents** : dossiers locaux, chronologie, explication, correction confirmée et vérification sur cinq nouveaux relevés. Résultats résolu/amélioré/inchangé/non vérifiable, comparaison avant/après et export JSON de preuves. Les anciennes sessions sont archivées sans possibilité de commande.
- **Diagnostic** : sept états de ligne et un parcours sans Internet, schéma de localisation, preuves, mesures détaillées, chronométrage de la première classification et export JSON.
- **Aperçu abonné** : verdict, bonne action, assistant, lecture photo locale, consultation des données et SMS simulé.
- **Wi-Fi maison** : exploration de quatre pièces, glisser-déposer indépendant de la box et du répéteur sur la carte 3D (souris ou tactile), flèches du clavier, annulation par Échap et plan 2D interactif de repli. Signal et couleurs recalculés avec un même modèle pédagogique ; boutons de placement par pièce conservés.
- **Assistant** : réponses locales ancrées sur la source commune ; français/nouchi/dioula pour les packs de ligne, synthèse française explicitement étiquetée pour le foyer dans ce premier lot.
- **Supervision** : flotte de 48 abonnés fictifs, incident de quartier, notifications simulées, restauration et journal.
- **Relation client** : huit profils prioritaires, explication du score, fiche de préparation d’appel, aucune action automatique.
- **Impact Moov** : hypothèses modifiables et décomposition des coûts évités et revenus préservés, avec leurs horizons distincts.
- **Histoires, aide, données** : quatre situations concrètes, lexique, effacement de session, paramètres et limites.
- **Visite guidée et présentation** : cinq étapes de découverte et cinq temps forts de soutenance, clavier et plein écran avec repli.

Les scènes three.js ont un schéma SVG de repli. L’option 3D se trouve dans Réglages. Le mouvement réduit et l’absence de WebGL sont pris en compte. Un seul contexte WebGL est actif ; les ressources sont libérées au changement de scène.

## Ce qui est réellement testé, et ce qui est simulé

Les calculs du détecteur, la logique de flotte, les langues, le traitement de pixels, les interactions, les contraintes SMS et l’export fonctionnent localement. Le pilote connecté ajoute des mesures actives appareil-vers-serveur ; mais **aucune mesure n’a encore été vérifiée sur la vraie box de l’utilisateur**, aucun SMS n’est envoyé et aucun signalement n’est transmis à Moov.

- Le diagnostic de ligne vient de `FG.detect(mesures, contexte)`. Les incidents du foyer utilisent des règles sur les mesures normalisées de capacité, trafic et nombre d’appareils, sans lire le nom du scénario. Une coupure WAN du foyer ne prouve jamais une rupture optique.
- Le chrono mesure le premier signal classé, pas une latence réseau garantie. L’atténuation converge plus lentement que les pannes franches.
- Le score de confiance est heuristique. Le score de départ utilise les poids manuels du moteur fourni, sans entraînement sur des résiliations Moov.
- L’assistant est un moteur de réponses locales, **pas un LLM**. Les textes des packs hérités qui évoquent des équipes prévenues décrivent le scénario, pas un envoi réel. Nouchi et dioula restent à valider auprès de locuteurs.
- La photo est analysée localement par couleur/luminosité puis non conservée. Même une vraie photo est croisée avec la **télémétrie simulée**, ce qui ne constitue pas un diagnostic de la vraie ligne. Une seule photo ne démontre pas un clignotement.
- Le déplacement Wi-Fi fonctionne par glisser-déposer, clic sur une pièce ou flèches du clavier. Les équipements restent dans les limites du plan, Échap annule un geste et « Recommencer l’expérience » restaure les positions. Activer le répéteur pour afficher sa prise de déplacement. Le premier déplacement validé calcule les quatre pièces ; les suivants actualisent les estimations pendant le geste. Les résultats restent un modèle simplifié, pas une mesure radio. Les emplacements sont propres à cette expérience, sans action sur une vraie box.
- Les rôles masquent des vues de démonstration ; ce n’est pas une autorisation serveur de production. Les redémarrages virtuels exigent confirmation et sont limités à deux par dix minutes ; l’historique local ne remplace pas une authentification opérateur.
- Les signalements, conversations et historiques complets du foyer restent en mémoire et disparaissent au rechargement. Les préférences, la limite SMS, le nombre habituel d’appareils et jusqu’à 40 dossiers d’incident avec leurs preuves sont conservés en stockage local si le navigateur l’autorise. Au rechargement, les dossiers sont des archives consultables/exportables ; une vérification interrompue devient non vérifiable. La reconnaissance individuelle reste limitée à la session. Ces limites concernent les écrans de démonstration. Le nouvel espace réel dispose de comptes serveur et d’identifiants transmis par un collecteur, sans adaptateur de box raccordé à ce jour.
- La formule par défaut totalise 660,6 M FCFA : **255,6 M de coûts annuels évitables + 405 M de revenus préservés sur 18 mois**. Ce n’est ni une économie annuelle nette ni un chiffre Moov validé.

## Vérifier

Sans installer de dépendance applicative :

```sh
node --test tests/*.test.js codex/engine-contract.test.cjs codex/household-model.test.cjs codex/household-analytics.test.cjs codex/scenario.test.cjs codex/audit-regression.test.cjs codex/incident-model.test.cjs codex/buttons.test.cjs
node tests/eval-corpus.js
```

Les tests navigateur optionnels nécessitent Playwright et Microsoft Edge, uniquement pour le développement :

```sh
node codex/browser-check.cjs
node codex/journeys-check.cjs
node codex/household-check.cjs
node codex/analytics-check.cjs
node codex/scenario-repro.cjs
node codex/scenario-check.cjs
node codex/audit-regression-check.cjs
node codex/incidents-check.cjs
```

Ils ouvrent l’interface par `file://`, bloquent les requêtes HTTP externes, testent les parcours et contrôlent le débordement horizontal. L’audit de régression couvre dix écrans à sept largeurs, de 320 à 1920 pixels. Les captures sont créées dans le dossier voisin `verification/`. Les résultats JSON du nouvel audit sont dans `../../audit-corrections-2026-10-06/` depuis la racine du projet. Le contrôle complémentaire `node codex/extra-flows-check.cjs` nécessite le serveur `node codex/serveur-local.cjs` sur le port 8186 ; il teste les parcours HTTP, les exports et les défaillances WebGL. Voir `VERIFICATION.md` pour les résultats et `ENGINE-AUDIT.md` pour les réserves du moteur.

## Lot 1 — source commune et résolution vérifiée

Essai conseillé : **Ma maison → Gros téléchargement → Incidents**. Après trois relevés anormaux, un dossier apparaît. Cliquer **Appliquer et vérifier**, puis **Confirmer et vérifier** : la console virtuelle est limitée à 10 Mbps. Le résultat n’apparaît qu’après cinq nouveaux relevés distincts et comparables. Exporter le dossier pour retrouver la référence avant action et les cinq preuves. La résolution signifie que le critère surveillé est revenu à la normale, pas que tous les problèmes du réseau sont réparés.

Le bandeau **Source des mesures** choisit explicitement l’adaptateur **Ligne simulée** ou **Foyer simulé**. Un seul flux normalisé alimente les écrans abonnés et le centre d’incidents à la fois ; les deux simulateurs ne sont pas présentés comme un même équipement physique. La flotte Moov et le plan pédagogique restent des laboratoires séparés. Changer de source invalide une vérification en cours ; la pause ne crée aucun nouvel échantillon. Une ancienne mesure de ligne demande une reprise de collecte avant vérification.

Les dossiers restent sur cet appareil sous `fg-codex-incidents-v1`, avec limites de taille, validation au chargement et effacement via **Vos données & les limites**. Un stockage refusé affiche une réserve et permet l’export. Ce stockage peut être modifié par l’utilisateur : il ne constitue pas un journal d’audit sécurisé ni une preuve certifiée.

Le contrat d’échantillon prépare un raccordement matériel : identifiant, heure, provenance, disponibilité, métriques nullables et diagnostic expliqué. Seuls deux adaptateurs simulés sont implémentés. **Réseau réel** n’est pas activable ; **Relecture** est annoncée à venir. Backend authentifié, passerelle routeur, historique complet persistant, espace participant et tests réseau réels appartiennent aux lots suivants.

## Correctifs après audit de l’interface

### Démo Wi-Fi et boutons — 6 octobre 2026

Dans **Diagnostic**, cliquer **Lancer la démo Wi-Fi**. Le panneau **Progression du test de ligne** apparaît immédiatement et compte uniquement les nouveaux relevés. Le moteur reconnaît normalement le problème après 7–10 relevés, à raison d’un par seconde ; ce délai est une observation du simulateur, pas une garantie réseau. L’ancien verdict sain de départ n’est plus présenté comme le résultat final. Les clics répétés pendant l’observation ne réinitialisent plus le test.

**Mettre ce test en pause** fige le compteur ; **Reprendre ce test** ou **Reprendre la démo Wi-Fi** poursuit le même test. **Arrêter ce test** revient au scénario nominal. Après classification, **Relancer ce test** crée une nouvelle observation et **Voir les incidents de ce test** ouvre le centre. Si le diagnostic attendu n’est pas observé après 45 relevés, la relance redevient disponible sans résultat forcé. L’optimisation retire le défaut Wi-Fi et améliore le débit ; un écart à la référence personnelle peut néanmoins rester signalé.

Pour rejouer l’audit des boutons, lancer le serveur local puis `node codex/buttons-audit-runner.cjs` avec Playwright et Edge disponibles. Les onze suites s’exécutent séquentiellement. `buttons-check.cjs` utilise les vrais délais du navigateur en HTTP et hors ligne ; `line-actions-check.cjs` accélère les temporisateurs du navigateur pour vérifier les autres scénarios et leurs actions, sans modifier le détecteur. Les journaux, captures et résultats JSON sont dans `verification/buttons/`, à côté du projet.

Les protections administrateur/invité, les quotas de redémarrage et le choix **Réseau réel** non implémenté restent volontairement désactivés ; ce ne sont pas des boutons en panne.

Les huit anomalies de l’audit du 6 octobre sont corrigées. Le bouton d’aide ouvre maintenant le diagnostic. Le rôle propriétaire/invité du foyer reste inchangé pendant la navigation et la présentation, jusqu’au rechargement de la page ; ce choix de démonstration n’est pas une authentification. Les fenêtres principales retiennent le focus dans les deux sens, désactivent temporairement l’arrière-plan et rendent le focus au bouton d’ouverture à leur fermeture.

Une simulation de nouvelles connexions ou un redémarrage confirmé reprend automatiquement les mesures si elles étaient en pause. Annuler le redémarrage ne les reprend pas. Le redémarrage coupe immédiatement le trafic virtuel, couvre six intervalles complets d’une seconde puis restaure les mesures instantanées à la sixième seconde, sauf si une panne reste active. Dans l’export, `lastSample` décrit le dernier intervalle écoulé ; les débits affichés décrivent l’état courant. Chaque intervalle est comptabilisé dans l’heure et la journée de son début : la seconde 18:59:59–19:00:00 appartient à 18–19 h.

## Avant un pilote réel

### Correctif du test « Gros téléchargement »

Le lancement d’un scénario reprend désormais les mesures si elles étaient en pause et remet son compteur d’observation à zéro. Un panneau sous les boutons affiche le débit total, celui de la console, sa part et la progression vers l’alerte. Les limites, blocages et placements sont conservés : si la console ne peut pas dépasser le seuil, le panneau en explique la raison. Une alerte n’est pas garantie sans les conditions affichées.

Pour reproduire la démonstration après d’autres essais, cliquer **Préparer et relancer le test**, puis confirmer : seule la console virtuelle est reconnectée/débloquée, sa limite retirée et sa pièce alignée sur celle de la box. Les autres appareils et historiques restent inchangés. Après dix relevés dominants consécutifs, le résultat indique l’alerte ; **Limiter la console à 10 Mbps** permet d’observer immédiatement l’action correctrice au relevé suivant. Rejouer le test crée une nouvelle observation sans effacer les alertes antérieures. Le graphe horaire cumule des volumes et ne remplace pas les mesures de débit instantané de ce panneau.

### Tableau de bord et connexions

Dans **Ma maison**, sélectionner une date du mois courant et un appareil. Survoler/toucher la courbe ou utiliser le curseur au clavier : le détail affiche le volume de chaque appareil dans l’heure et le nombre connecté au dernier relevé. Basculer entre volume horaire, cumul et appareils connectés. Les heures sans données restent vides, même si une heure observée sans trafic peut valoir zéro. Les anciens jours sont des historiques fictifs cohérents avec les totaux mensuels.

Cliquer sur **Simuler 3 nouvelles connexions** : la référence initiale est de 5 appareils et le nombre présent passe à 8. Après 3 secondes simulées, l’alerte apparaît. Examiner les cartes encadrées : **Je reconnais cet appareil** confirme seulement la reconnaissance ; **Bloquer** demande confirmation. La référence ne change pas automatiquement. **Actualiser ma référence** demande confirmation et refuse si un appareil connecté reste non reconnu. Une visite ponctuelle ne devrait pas devenir une nouvelle habitude.

Règle de démonstration : au moins 2 appareils de plus que la référence durant 3 échantillons, puis un délai de 120 secondes entre alertes. La référence de départ est la médiane des derniers relevés horaires synthétiques à partir de 6 h. Après effacement, 30 relevés consécutifs avec uniquement des appareils actifs reconnus sont nécessaires pour reconstruire une référence. Les inconnus bloqués ou déconnectés ne bloquent pas cet apprentissage ; un inconnu actif remet sa fenêtre d’observation à zéro. Ce n’est pas un modèle d’IA entraîné ; en production, il faudra un historique représentatif, des habitudes selon l’heure et le jour, une gestion des invités temporaires et une calibration terrain. L’alerte est uniquement dans l’application, sans push/SMS.

Voir **[PILOTE-REEL.md](PILOTE-REEL.md)** : matériel à identifier, architecture de passerelle, droits, collecte fiable, protocole avec 4–5 volontaires et progression jusqu’au déploiement. Le foyer démarre à 18 h UTC virtuelles avec un historique inventé ; ses nouveaux volumes sont calculés, jamais mesurés sur votre réseau. Les commandes de ce foyer restent en mémoire et sa limite de redémarrage est réinitialisée au rechargement, contrairement au garde-fou SMS existant en stockage local. La pause de ses mesures met aussi les autres simulateurs en pause.

Obtenir les accès documentés aux box et à la passerelle SMS Moov ; développer les adaptateurs et l’authentification ; sécuriser les rôles et commandes côté serveur ; recueillir les consentements ; valider les langues et photos sur un corpus réel ; calibrer les seuils ; mesurer l’efficacité et les coûts sur un pilote. Ne pas exposer le serveur de modèle d’origine avec une clé payante sans durcissement.

Cette livraison est une copie locale, sans dépôt Git distant identifié, sans pull request et sans publication publique. L’application Fibre Welcome n’a pas été modifiée.

## Démo du jury : « Le jury vit la panne »

- **Régie** (téléphone de l'administrateur) : `/codex/?section=regie`, connexion avec le compte de la direction. Le serveur vérifie le rôle administrateur à chaque action.
  1. « Ouvrir la salle du jury » : un code QR et un code à 6 caractères apparaissent (« Projeter le code QR » pour le grand écran).
  2. « Couper la fibre à Niangon », « Envoyer le technicien », « Le technicien est arrivé », « Réparer et vérifier » : chaque bouton enchaîne les actions habituelles du NOC (plan validé, Koffi affecté, mesures vérifiées).
  3. « Tout remettre à zéro » : la démo repart de zéro en moins de 2 secondes ; le jury et la régie restent connectés.
- **Membres du jury** : ils scannent le QR (`/codex/?jury=CODE`), acceptent les alertes et deviennent des abonnés anonymes de Yopougon (ni nom, ni numéro, aucun rôle opérateur). À la coupure, le téléphone vibre et sonne avec le message de Guardian, puis suit le technicien, reçoit un certificat de réparation et note l'intervention. La note moyenne s'affiche dans la régie.
- Les téléphones doivent joindre le serveur : en pratique, l'adresse publique (Railway). Sur iPhone, Safari ne vibre pas : le son et l'alerte plein écran restent.
