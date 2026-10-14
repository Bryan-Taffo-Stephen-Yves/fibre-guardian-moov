# Fibre Guardian — du foyer simulé à la démonstration réelle

État du 6 octobre 2026. Ce document est un plan de réalisation, pas une description de fonctionnalités déjà connectées à Moov.

Mise à jour du 9 octobre : un premier pilote Node/SQLite est désormais implémenté. Consulter [PILOTE-CONNECTE.md](PILOTE-CONNECTE.md) pour le périmètre effectivement réalisé, les tests, la sécurité et les limites restantes. Les propositions ci-dessous restent une feuille de route, pas une garantie de raccordement matériel.

## Le périmètre à défendre devant le jury

Le foyer connecté sert le diagnostic : différencier une coupure fibre, une saturation du lien partagé et un mauvais signal Wi-Fi ; expliquer ; proposer une action réversible ; vérifier le rétablissement. Les commandes du routeur sont des moyens de démonstration, pas le sujet principal. Ne pas promettre une compatibilité universelle ni une victoire au concours.

### Ce qui fonctionne dans cette livraison

L’écran **Ma maison** démarre avec cinq appareils et permet d’ajouter jusqu’à six invités fictifs. Il simule débit, volumes individuels, filtres jour/mois, courbes datées, quatre scénarios, limites, suspensions, blocages et retours à la normale. Le nombre habituel d’appareils est sauvegardé localement ; les autres données du foyer restent en mémoire pendant la navigation. L’export JSON inclut le foyer et porte `simulation: true`. Effacer la session retire ses volumes historiques et sa référence habituelle, puis met les simulateurs en pause.

Le propriétaire peut agir après confirmation pour les commandes qui interrompent l’accès. L’invité consulte. L’appareil servant à administrer est protégé contre la suspension et le blocage. Un redémarrage virtuel dure six secondes ; deux au maximum sur dix minutes simulées. Une alerte explicable signale un usage dominant sans jamais sanctionner automatiquement.

Le plan est prédéfini, en 3D avec repli 2D. Les appareils sont attribués à des pièces dans une liste ; ils ne sont pas localisés automatiquement ni représentés par des marqueurs individuels en 3D. L’optimisation compare cinq placements, privilégie le signal du moins bien desservi puis la moyenne. Distances, murs et signaux sont des hypothèses. L’éditeur libre du logement et les relevés radio restent à construire.

Le lot 1 relie le foyer au diagnostic abonné et au centre d’incidents par un flux normalisé commun. Le bandeau choisit explicitement une seule source : foyer simulé ou ligne simulée. Les deux simulateurs gardent des domaines différents ; sans optique dans les mesures du foyer, aucune rupture de fibre n’est affirmée. La supervision Moov reste une flotte indépendante et fictive. L’historique initial du foyer est synthétique. Les nouvelles secondes cumulent les octets ; la courbe présente les volumes horaires ou cumulés et le nombre d’appareils au dernier relevé de l’heure, pas une disponibilité moyenne. Les volumes sont décimaux : 1 Mo = 1 000 000 octets. Les alertes restent locales, sans notification push.

Le centre d’incidents conserve jusqu’à 40 dossiers localement. Détection après trois relevés anormaux ; vérification après cinq nouveaux relevés comparables, avec correction confirmée ou simple observation. Pause, changement de source, trous de mesures et rechargement ne valent jamais preuve de résolution. L’export contient avant/après et les relevés de vérification. Les anciennes sessions sont archivées et non commandables. Ce premier lot ne fournit pas encore de backend authentifié, de relecture interactive, d’espace participant ou de collecte matérielle réelle.

## Ce qu’il faut fournir avant le raccordement réel

### Évolution : statistiques et surveillance du nombre d’appareils

Les cases horaires ont été remplacées par un tableau de bord avec courbe, date, filtre par appareil, cumul, volumes individuels par heure et classement journalier. Les noms des appareils sont réalistes mais fictifs. Les relevés des jours précédents sont synthétiques et concordent avec les volumes mensuels. Les heures absentes ne sont pas remplacées par zéro.

La surveillance mémorise localement un nombre habituel, d’abord calculé sur l’historique simulé. Elle alerte après une hausse d’au moins deux appareils pendant trois secondes simulées, sans modifier automatiquement cette référence ni bloquer personne. Le propriétaire reconnaît ou bloque chaque nouvel appareil. La mise à jour de référence est confirmée et refusée tant qu’un appareil connecté reste non reconnu. Seul le nombre habituel persiste après rechargement ; identité, reconnaissance et historique détaillé nécessiteront la base du pilote. Une adresse privée ou un nom d’appareil ne constitue pas une preuve d’identité, et l’application ne peut pas savoir à qui le mot de passe a été donné.

En production, apprendre les habitudes par plages horaires/jours sur une période représentative ; exclure les anomalies et visiteurs temporaires de l’apprentissage ; gérer révocation, fraîcheur, changement d’adresse et appareils hors ligne. Prévoir notifications authentifiées (dans l’application, puis push/SMS si autorisé), préférences, accusés et journal. Les seuils actuels servent à démontrer le parcours et ne sont pas validés sur des foyers réels.

1. Marque, modèle, version du micrologiciel et statut de propriété du routeur/box. Ne pas envoyer de mots de passe dans le chat.
2. Autorisation du propriétaire pour les tests et accord de Moov si l’équipement opérateur doit être commandé. Aucun contournement des restrictions du fournisseur.
3. Liste des interfaces documentées disponibles : compte de lecture, compte de commande limité, API et compteurs accessibles. Vérifier séparément débit par appareil, compteurs cumulés, RSSI, limitations, blocage et redémarrage.
4. Quatre ou cinq volontaires consentants, appareils identifiés par des noms de test et durée de conservation décidée. Ne pas collecter pages, DNS, messages, vidéos ou contenus.
5. Un routeur de laboratoire si la box est verrouillée, un ordinateur de passerelle, une liaison Ethernet d’administration et un point de retour à la configuration sauvegardée. Ne rien acheter avant la vérification du matériel existant.
6. Un plan simple de la salle : dimensions, cloisons, position de la box et prises possibles. La position physique ne se déduit pas d’un compteur de trafic ou d’une adresse IP.

## Architecture proposée pour le pilote

```text
Téléphone du propriétaire / écran du jury
                 │ HTTPS + session utilisateur
                 ▼
Passerelle locale : API, droits, collecte, commandes, journal
       │ compte lecture       │ compte commande limité
       └──────────────┬───────┘
                      ▼
              Routeur du laboratoire
                      │ SSID de test isolé
                      ▼
               4–5 appareils consentants
```

Proposition de départ : interface actuelle adaptée en client d’API, service Node.js/TypeScript local, SQLite pour le pilote, flux SSE vers le tableau de bord. Adapter la collecte au matériel, initialement toutes les 2–5 secondes, puis mesurer sa charge. Pas de Kubernetes pour cette démonstration. Ce sont des choix proposés ; ces services ne sont pas encore implémentés.

Un adaptateur expose des capacités explicites : `listDevices`, `readCounters`, `readWifiSignal`, `setRateLimit`, `pauseDevice`, `resumeDevice`, `reboot`. Si une fonction manque, l’interface la marque indisponible ; elle ne fabrique jamais une mesure de substitution présentée comme réelle. Un mode démonstration conserve un badge distinct et ne complète jamais silencieusement un historique réel.

Une piste possible, à confirmer selon le matériel, est RouterOS : son API REST expose des commandes et des permissions, avec accès HTTPS. La documentation recommande des utilisateurs dédiés aux droits nécessaires et de garder l’API hors d’Internet. Le connecteur resterait dans la passerelle locale, sans identifiants de routeur dans le navigateur. [Documentation officielle MikroTik](https://manual.mikrotik.com/docs/developer-guides/rest-api/).

### Mesures et historique fiables

- Enregistrer `householdId`, identifiant pseudonyme d’appareil, horodatage UTC, source, qualité de mesure, octets entrants/sortants et temps entre relevés. Définir clairement le sens entrant/sortant.
- Calculer les deltas de compteurs ; détecter remise à zéro, redémarrage, débordement et absence d’échantillon. Ne jamais transformer une mesure manquante en zéro débit ou en coupure certaine.
- Agréger minutes/heures/jours/mois dans le fuseau du foyer. Conserver un horodatage de fraîcheur et signaler les trous de collecte. Dédupliquer les remontées après une reconnexion.
- Un appareil peut changer d’adresse privée ; son identité et son historique ne doivent pas être fusionnés sans preuve. Le nombre d’appareils n’est pas un nombre de personnes.
- Distinguer octets WAN, trafic LAN et retransmissions Wi-Fi. Les compteurs n’ont pas forcément le même périmètre que la facturation de l’opérateur.
- Un test de débit actif consomme du trafic : le déclencher avec accord, l’indiquer dans le graphique et le séparer des usages ordinaires.

### Commandes et droits

| Acteur | Consultation | Commandes |
| --- | --- | --- |
| Propriétaire authentifié | Son foyer | Limite / suspension / blocage / redémarrage, selon capacités et confirmations |
| Invité | Vue restreinte approuvée | Aucune |
| Conseiller Moov | Diagnostic nécessaire sur ligne autorisée | Proposition d’action ; pas de blocage d’appareils du foyer par défaut |
| Technicien habilité | Données de son intervention | Commandes explicitement autorisées pour cette intervention |
| Superviseur Moov | Incidents agrégés par zone | Pilotage opérateur selon habilitation, pas de droits implicites sur tous les foyers |

Contrôler ces droits côté serveur et pour chaque foyer. Prévoir authentification, sessions courtes, protection CSRF si cookies, limitation des requêtes, séparation des secrets, journal d’audit et masquage des données dans les journaux techniques.

Toute commande reçoit un identifiant unique et les états demandé → accepté → en cours → vérifié / échec / résultat inconnu. Un accusé de réception n’est pas une preuve d’exécution. Après timeout, vérifier l’état avant toute répétition, surtout pour un redémarrage. Prévoir retour arrière des limites/blocages, plafond de redémarrages persistant côté serveur et protection du chemin d’administration, y compris Ethernet de secours. Une déconnexion simple et un blocage durable ne sont pas la même opération.

## Démonstration réelle reproductible — ordre de réalisation

### Lot 1 — lecture seule sur un routeur, avant toute commande

Connecter 4–5 appareils au SSID de test protégé par un mot de passe temporaire. Isoler le réseau d’administration. Ne pas exposer la console du routeur à un Wi-Fi ouvert au public. Pour un accès public ultérieur, prévoir une architecture invitée séparée et une revue de sécurité.

Comparer la liste et les compteurs affichés avec ceux du routeur. Faire transférer un fichier de taille connue vers une destination de test maîtrisée ; comparer des compteurs de même périmètre et définir la tolérance avant la mesure. Consigner l’écart, les unités et les trous éventuels. Déconnecter un appareil puis le reconnecter ; vérifier que le compteur ne devient jamais négatif.

Critère de passage : aucune valeur inventée, source/fraîcheur visibles, écarts documentés, invités incapables de lire un autre foyer. Les objectifs de latence et précision seront fixés après le premier relevé matériel, pas annoncés comme acquis.

### Lot 2 — actions réversibles et preuve de résultat

1. Établir une référence pendant deux minutes, avec le même protocole de mesure pour tous.
2. Un volontaire lance un transfert volumineux, les autres gardent une activité comparable. Observer les débits et les volumes ; une vidéo adaptative seule n’est pas un étalon reproductible.
3. Confirmer une limite sur cet appareil. Vérifier le plafond dans le routeur et sur le client, pas seulement dans l’interface. Retirer la limite et vérifier le rétablissement.
4. Suspendre puis reconnecter l’appareil consentant. Confirmer qu’aucun autre client ni l’administration ne sont coupés. Tester séparément le blocage persistant.
5. Créer un ralentissement réversible de la sortie WAN du routeur de test, avec une durée maximale et un retour automatique. Montrer que les clients restent associés au Wi-Fi. Restaurer le débit et comparer avant/après.
6. Tester le redémarrage uniquement en dernier, quand la restauration et l’accès de secours sont validés. Ne pas couper une fibre de production ni modifier un OLT Moov pour la soutenance.

Le navigateur ne commande pas à lui seul une box quelconque. Si le matériel interdit une action, la démonstration l’explique et utilise le routeur de laboratoire autorisé.

### Lot 3 — logement et diagnostic unifiés

Construire l’éditeur de pièces, dimensions, murs et placements manuels ; afficher les appareils sur la scène 3D. Collecter des mesures radio et des tests comparables en plusieurs points, avec consentement. Comparer l’emplacement recommandé à l’emplacement initial à activité et protocole identiques. Montrer les incertitudes, les contraintes de prises et l’alternative répéteur/point d’accès quand déplacer la box ne suffit pas.

Le raccordement logiciel commun est commencé dans le lot 1 : `incident-model.js` normalise les deux sources de simulation et suit les preuves, sans commandes matérielles. Il reste à brancher l’adaptateur réel à ce contrat, avec capacités déclarées et timestamps de collecte fiables. Un usage dominant produit une explication différente d’une coupure WAN ; sans télémétrie optique, ne pas affirmer qu’une fibre est rompue. Étendre les tests d’intégration aux équipements et conserver les cas ambigus comme tels.

### Lot 4 — supervision Moov et météo

La supervision actuelle reste une flotte fictive. Pour une vraie supervision : identifiants de lignes autorisés, topologie réseau, zones, horodatages, incidents réels, déduplication, statut d’intervention, notification avec preuve d’envoi/réception et rôles par périmètre. Pour la démonstration en salle, les 5 appareils d’un seul foyer ne doivent pas être présentés comme 5 abonnements fibre.

La météo peut enrichir une hypothèse de risque, mais « il pleut donc la fibre va tomber » n’est pas une règle valide. D’abord collecter incidents historiques, météo horodatée/géolocalisée, topologie et exposition pertinente. Définir une cible, un horizon et les coûts des fausses alertes. Comparer à une référence simple sur des périodes futures non utilisées à l’entraînement ; publier précision, rappel et calibration. Sans données suffisantes, afficher seulement le contexte météo, pas une prédiction présentée comme fiable. Pas de décisions automatiques sur les abonnés.

### Lot 5 — durcissement et déploiement

Après validation du pilote : API hébergée et base PostgreSQL, cloisonnement par client/opérateur, passerelles locales sortantes authentifiées, HTTPS, rotation de secrets, sauvegardes avec exercice de restauration, limites de rétention et suppression. Ajouter supervision technique, journal d’audit protégé, alertes de collecte périmée, tests de charge et de sécurité, revue des droits, budget d’hébergement et procédure de retour arrière. Aucun port d’administration des box ne doit être ouvert publiquement pour faciliter le déploiement.

Valider sur de vrais téléphones Android/iOS et sur le réseau du lieu du concours. Préparer un mode démo hors ligne clairement étiqueté, un jeu de mesures réelles anonymisées avec consentement et une vidéo de secours identifiée comme enregistrement. Présenter séparément ce qui a été mesuré, simulé et seulement prévu.

## Prochaine décision

Identifier le modèle exact du routeur. Cela détermine le connecteur et les commandes réellement possibles. En attendant, aucun adaptateur matériel, collecte réseau réelle, entraînement prédictif, envoi SMS ni publication publique ne sont activés dans cette livraison.
