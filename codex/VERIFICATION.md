# Vérification de la nouvelle interface

Mise à jour : voir [l’audit du 9 octobre 2026](AUDIT-2026-10-09.md) pour le nouveau pilote, les 125 tests et les 13 suites navigateur. Le document ci-dessous conserve la trace de la vérification du 6 octobre.

Contrôles réalisés le **6 octobre 2026** sur Windows, Node 24 et Microsoft Edge piloté en mode headless. Ce rapport concerne un prototype local, pas une infrastructure Moov.

## Préservation de l’existant

Comparaison SHA-256 des 41 fichiers d’origine avec `fibre-guardian-a-jour.zip` : **aucun fichier d’origine modifié**. L’ancienne interface et tous les modules `src/`, `tests/`, `server/`, `vendor/` sont identiques à l’archive. Les ajouts sont `codex/` et le raccourci HTML d’ouverture.

## Tests automatisés

- 20 tests d’origine + 14 tests de contrat d’interface + 14 tests du foyer + 9 tests de statistiques/surveillance + 7 tests de scénario + 7 tests de régression après audit + 30 tests de source commune/incidents : **101/101 réussis**.
- Évaluation du corpus synthétique : 17/17 intentions reconnues, 136/136 réponses respectant les garde-fous existants. **Ce corpus ne valide pas les langues auprès de locuteurs réels.**
- JavaScript : contrôles syntaxiques réussis pour l’application et les scènes.
- Navigateur hors ligne, ouverture par `file://` : aucun appel HTTP externe, aucun débordement horizontal à 1440, 390 et 360 px sur les écrans contrôlés.
- Scènes three.js : rendu WebGL vérifié dans Edge ; désactivation 3D et repli SVG vérifiés ; captures en mode mouvement réduit également produites.
- Serveur statique local : réponse HTTP 200 sur `/codex/`.

## Parcours exécutés dans le navigateur

1. Injection Wi-Fi faible → diagnostic du moteur → proposition d’optimisation.
2. Saisie d’une question pendant les mises à jour → focus conservé → réponse locale.
3. Analyse d’une image d’exemple → résultat local signalé comme exemple.
4. SMS simulé provenant d’un numéro non lié → refus.
5. Deux redémarrages simulés → confirmation exigée ; troisième → limite atteinte.
6. Maison : exploration → 25 % de pièces bien couvertes ; box centrée → 75 % ; répéteur → 100 %, selon le modèle simplifié.
7. Coupure de quartier → anomalies de lignes → incident collectif créé par le moteur.
8. Rôle Technicien → supervision et relation client retirées de la navigation.
9. Visite guidée : cinq étapes jusqu’à la fin.
10. Présentation : cinq séquences au clavier, sortie du plein écran à la fin.
11. Effacement de session → données de session réinitialisées et simulation en pause.
12. Rendu 3D → bascule du réglage → schéma 2D de repli.

Les captures de contrôle sont disponibles dans le dossier `verification/` voisin du projet, dans l’espace de travail. Les scripts reproductibles sont `browser-check.cjs` et `journeys-check.cjs`.

## Ajout Ma maison

`household-model.test.cjs` vérifie conversion Mbps/octets, partage de capacité, cumuls jour/mois, refus des commandes invité, protection administrateur, confirmations, conservation des volumes après blocage, plafonds, alerte après 10 secondes sans sanction, coupure WAN, quota de redémarrage, placement, passage à minuit/changement de mois et effacement sans réensemencer les volumes.

`household-check.cjs` vérifie dans Edge : cinq cartes d’appareils, filtres, annulation et confirmation, suspension/reconnexion, blocage/déblocage, rôle invité, placement recommandé, alerte après gros téléchargement, limitation à 10 Mbps, conservation des réglages après navigation, absence de débordement à 1440/390/360 px, rendu WebGL et fonctionnement hors ligne. Aucun message d’erreur navigateur ni appel HTTP externe. Les deux suites navigateur antérieures passent également après l’intégration.

Les captures du foyer sont `household-1440.png`, `household-390.png`, `household-360.png` et `household-3d.png`. Le plan reste prédéfini et le signal reste estimé ; aucun routeur réel n’a été contrôlé.

L’export JSON a été téléchargé et relu automatiquement : mode simulation présent, cinq appareils et limite appliquée conservés. Après effacement via l’interface : volume nul, aucune alerte ni action historique et simulation en pause. Le serveur local renvoie HTTP 200 pour le nouveau modèle du foyer.

## Tableau de bord et connexions inhabituelles

`household-analytics.test.cjs` vérifie la concordance des courbes horaires, cumuls, détail individuel et total mensuel ; les dates absentes/heures futures restent nulles ; un zéro mesuré reste distinct. L’archivage à minuit conserve les détails. Les tests de surveillance vérifient la référence initiale, le seuil et le délai, la non-adaptation aux inconnus, l’absence de sanction automatique, la reconnaissance sans changement implicite de référence, la confirmation de mise à jour, les permissions et l’apprentissage après effacement.

`analytics-check.cjs` vérifie calendrier, filtre, trois courbes, curseur clavier, pointeur, détail horaire et tailles 1440/390/360 px. Le scénario 5 → 8 appareils déclenche l’alerte ; un blocage confirmé ramène à 7 ; reconnaître les autres ne change pas la référence ; une mise à jour explicite la change. Après rechargement, cette référence locale est restaurée ; l’effacement la réinitialise. Aucune erreur navigateur ni requête HTTP externe. Captures : `analytics-1440.png`, `analytics-390.png`, `analytics-360.png`, `connections-alert.png`.

## Correctif des scénarios du foyer

`scenario-repro.cjs` a reproduit l’échec avant correction : bouton Gros téléchargement actif, mais horloge figée et bouton Reprendre le foyer toujours présent. Le même contrôle passe après correction. Un second cas a confirmé qu’une console déjà limitée à 10 Mbps ne déclenche pas l’alerte : le panneau l’explique maintenant au lieu de promettre une alerte inconditionnelle.

`scenario.test.cjs` couvre progression 0→9→10, explication des limites et du Wi-Fi, conservation des blocages, préparation avec confirmation et permissions, préservation des historiques/réglages tiers, relance sans suppression des alertes et distinction entre normal, débit réduit, coupure et redémarrage.

`scenario-check.cjs` exécute lancement depuis pause, alerte après dix relevés, limitation, nouveau lancement limité, annulation et confirmation de préparation, seconde alerte, console bloquée et distante, quatre modes, invité et tailles 1440/390/360 px. Captures `scenario-fixed-*.png` ; aucun débordement ni erreur JavaScript. Le script du foyer a été adapté au nouveau comportement de reprise automatique.

## Régression après audit — 6 octobre 2026

Les preuves de l’audit initial sont conservées dans `../../audit-interface-2026-10-06/`. Le nouvel audit est reproductible avec `audit-regression-check.cjs` ; ses 20 contrôles passent. `extra-flows-check.cjs` ajoute 8 contrôles réussis sur le chargement HTTP, le serveur statique, le signalement exporté avec son créneau, le journal de relation client, la coupure/restauration collective, les quatre histoires et les replis WebGL. Les deux scripts écrivent leurs résultats dans `../../audit-corrections-2026-10-06/` (chemins depuis la racine du projet) et retournent un code non nul en cas d’échec.

Correctifs vérifiés :

- A01 : le bouton « Essayer une fibre coupée » de l’aide ouvre le diagnostic.
- A02 : le rôle invité reste invité après navigation et présentation ; le blocage reste désactivé.
- A03 : l’ajout de connexions depuis la pause reprend les relevés et déclenche l’alerte attendue.
- A04 : un redémarrage confirmé depuis la pause se termine ; son annulation conserve la pause.
- A05 : focus initial sur le bouton de fermeture, boucles Tab/Shift+Tab, arrière-plan inerte, fermeture par Échap et restitution du focus.
- A12 : apprentissage après exclusion des inconnus ; remise à zéro de la fenêtre lorsqu’un inconnu actif est observé.
- A13 : attribution des volumes à l’intervalle écoulé, heure complète de 3 600 secondes, passage à minuit, fin de mois et d’année.
- A14 : coupure immédiate, six intervalles sans aucun octet puis rétablissement au temps virtuel +6 s ; une panne WAN persistante n’est pas effacée.

Le test A14 distingue désormais les six intervalles mesurés (`lastSample`) de l’état instantané à leur fin (`capacity`). Exiger un débit instantané nul à +6 s aurait retardé le retour visible jusqu’à +7 s. Les deux anciens tests de minuit ont également été alignés sur la convention d’intervalle : la dernière seconde appartient au jour précédent.

Affichage : 10 écrans × 7 largeurs (320, 360, 390, 768, 1024, 1440 et 1920 px), aucun débordement horizontal ; contrôles de noms des boutons et d’étiquettes des champs visibles. Cela ne constitue pas un audit WCAG complet. Le rôle du foyer reste une permission de démonstration en mémoire, pas une sécurité serveur.

Après ces correctifs, les six suites navigateur antérieures (`browser-check`, `journeys-check`, `household-check`, `analytics-check`, `scenario-repro`, `scenario-check`) passent à nouveau, ainsi que les deux nouvelles suites. Contrôle syntaxique des 23 fichiers JavaScript/CJS de `codex/` réussi. Le corpus synthétique reste à 17/17 intentions et 136/136 garde-fous. Nouvelle comparaison SHA-256 des 41 fichiers de l’archive d’origine : aucun écart.

## Lot 1 — source commune et incidents vérifiés

Le module `incident-model.js` transforme les relevés de deux adaptateurs simulés en un contrat commun. L’interface choisit explicitement une source active pour la vue d’ensemble, le diagnostic, l’assistant et les incidents. Il ne s’agit pas encore d’un connecteur physique ni d’un backend. La supervision de flotte et le plan pédagogique restent distincts.

`incident-model.test.cjs` : 30 tests, notamment relevé initial indisponible plutôt que faux zéro, distinction WAN/optique, trois relevés consécutifs pour détecter, déduplication, immutabilité, cinq preuves nouvelles avant résultat, amélioration partielle, cas inchangé, données manquantes ou physiquement invalides, ordre des horodatages, interruption de source, absence de comparaison entre modes, récidive, bornes de rétention et validation des archives corrompues. L’export comporte provenance, avant/après et les cinq relevés. Un statut enregistré « résolu » incohérent avec ses preuves est invalidé ; cela ne rend pas le stockage local inviolable.

`incidents-check.cjs` vérifie le parcours dans Edge hors ligne : Ma maison → téléchargement → incident, cohérence de source sur Diagnostic/Assistant, correction annulée sans effet, propriétaire/invité, pause sans faux échantillons, reprise et résolution après cinq relevés, preuve exportée, affichage 320/390/1440, conservation en archive au rechargement, interruption de vérification au rechargement/changement de source et effacement du stockage. Les captures et résultats sont dans `verification/incidents/`, voisin du projet.

Validation finale : les 13 contrôles de `incidents-check.cjs` passent, y compris l’export global qui ne mélange plus historique de ligne et mesures du foyer. Zéro erreur JavaScript et zéro requête HTTP externe pendant ce parcours hors ligne. Les six anciennes suites navigateur ont été rejouées séquentiellement avec succès ; un premier essai WebGL avait dépassé son délai lorsque plusieurs navigateurs de test tournaient simultanément, sans reproduction lors de l’exécution isolée. Les 20 contrôles d’audit et 8 parcours HTTP/WebGL complémentaires passent également. Syntaxe des 28 fichiers JavaScript/CJS contrôlée et 41 fichiers d’origine toujours identiques par SHA-256.

Le parcours a aussi été exécuté sur le serveur HTTP local : limitation du gros transfert, observation des nouveaux relevés et résultat vérifié. Contrôles de mise en page du centre à 320, 390, 768, 1024, 1440 et 1920 px sans débordement, aucune erreur d’exécution. Les captures compactes sont `verification/incidents-integrated-compact-390.png` et `-1440.png` ; les captures finales hors ligne sont dans `verification/incidents/`.

Les mesures demeurent simulées : les valeurs avant/après observées lors de ces essais ne constituent pas des performances sur une box réelle. Une résolution confirme le critère surveillé, pas la santé universelle du réseau. La collecte réelle, l’authentification serveur, la relecture interactive et l’espace participant ne sont pas livrés dans ce lot.

## Audit des boutons et démo Wi-Fi — 6 octobre 2026

Constat reproduit sur le serveur local : le bouton principal lançait bien le scénario, mais conservait le verdict sain des mesures de départ jusqu’à la classification (environ huit relevés). Chaque nouveau clic réinitialisait cette observation. Le lancement avait ainsi l’apparence d’une action sans effet.

Correctifs : retour immédiat et panneau de progression, compteur de nouveaux relevés distinct des neuf mesures d’amorçage, verdict provisoire clairement indiqué, absence de confiance affichée sur ces anciennes mesures pendant l’attente, protection contre les relances répétées, pause/reprise sans remise à zéro, arrêt et relance explicites. Le lancement depuis un foyer en pause choisit la ligne et reprend la collecte. Les parcours SMS et fibre coupée restent deux choix d’interface distincts, même s’ils utilisent la même panne optique sous-jacente. Le détecteur fourni n’a pas été modifié ; aucun résultat n’est forcé.

Validation finale de cette livraison :

- **108/108 tests unitaires/contrat réussis**, dont sept nouveaux tests de progression, attente, expiration et provenance.
- **11/11 suites navigateur réussies**, exécutées séquentiellement : `buttons-check`, `line-actions-check`, `browser-check`, `journeys-check`, `household-check`, `analytics-check`, `scenario-repro`, `scenario-check`, `incidents-check`, `audit-regression-check`, `extra-flows-check`.
- `buttons-check` : neuf contrôles sur le CTA exact, réponse immédiate, clics répétés, pause/reprise, arrêt/relance, passage foyer → ligne, optimisation, export, clavier, HTTP/hors ligne et affichage sur sept largeurs.
- `line-actions-check` : dix contrôles sur les actions des diagnostics fibre/atténuation/opérateur/congestion/appareils, changement immédiat SMS → fibre, statut SMS, annulation de redémarrage, tous les placements du plan Wi-Fi, boutons répéteur et remise à zéro. Cette suite accélère les temporisateurs du navigateur ; la suite ciblée Wi-Fi utilise les délais réels.
- Les suites existantes couvrent les confirmations, blocage/déblocage, suspension/reconnexion, permissions, alertes, surveillance des connexions, graphiques, dates, assistant, photo, quotas SMS, incidents et preuves, effacement, réglages, visite, présentation, supervision, restauration collective, données économiques, signalements et histoires.
- Zéro erreur d’exécution et zéro requête externe dans les deux nouveaux parcours hors ligne. Contrôle responsive des dix écrans sur sept largeurs et de la progression Wi-Fi à 320–1920 px. Captures de bureau et mobile inspectées.
- 32 fichiers JavaScript/CJS contrôlés syntaxiquement ; corpus synthétique inchangé : 17/17 intentions et 136/136 garde-fous. Comparaison SHA-256 : **41 fichiers d’origine inchangés**.

Les résultats, captures et journaux de cet audit sont dans `verification/buttons/`, voisin du projet. `suite-results.json` contient les onze statuts finaux. Lors du développement des nouveaux tests, une attente incorrecte de retour systématique à une ligne saine a été retirée : après optimisation, le débit augmente et le défaut Wi-Fi disparaît, mais le détecteur peut légitimement garder `anomalie` pour un écart à la référence habituelle. L’export observé conserve ce diagnostic au lieu de fabriquer une résolution complète.

Les boutons volontairement désactivés pour l’administrateur protégé, le rôle invité, un quota atteint ou une intégration réelle non livrée restent protégés. Cet audit automatisé vérifie les parcours décrits sous Edge ; il ne prouve pas tous les enchaînements possibles, une conformité WCAG, ni un fonctionnement sur matériel réel.

## Non validé sur le terrain

Vraies box, SMS opérateur, diagnostic de photos de matériel Moov, langues naturelles avec corpus terrain, performances sur téléphones physiques, Safari/iOS, authentification de production, accessibilité certifiée et efficacité économique. Le mode présentation comporte des scènes illustratives ; les expérimentations en direct se font dans le laboratoire. Voir `README.md` et `ENGINE-AUDIT.md` avant une soutenance.
