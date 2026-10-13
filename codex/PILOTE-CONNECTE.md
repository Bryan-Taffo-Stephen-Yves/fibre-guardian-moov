# Pilote connecté — 9 octobre 2026

## Espaces client et administrateur — premier lot de la spécification étendue

**Décision d'architecture temporaire :** conserver le pilote Node/SQLite et le design existant conformément à la demande d'enrichir, pas de remplacer l'application. Ce lot n'est pas une migration vers Expo/Next.js/Supabase et ne revendique pas de RLS PostgreSQL. Les autorisations sont vérifiées par l'API à chaque requête. La migration vers la stack cible, ses politiques RLS et leurs tests restent à réaliser.

- **Mon espace réel** est l'espace client authentifié. Créer un dossier dans **Dossiers support**, puis cliquer **Partager le dossier**. Une confirmation détaille les données transmises : nom du foyer, sujet, description et cinq relevés joints lors de sa création. Aucun historique supplémentaire ni clé de collecteur n'est accessible au support.
- **Espace administrateur** est un portail distinct avec vérification serveur. Seuls les comptes habilités voient les dossiers explicitement partagés. Il ne s'agit pas du sélecteur de rôles de la démonstration.
- Le support prend en charge, demande un retour, déclare un dossier résolu ou le reprend, toujours avec un message au client. « Résolu par le support » ne prouve pas une réparation de la connexion. Les transitions sont versionnées pour refuser une écriture concurrente périmée.
- Le client reçoit une notification interne et une chronologie. Les écrans sont actualisés toutes les cinq secondes tant qu'ils sont ouverts. Ni SMS ni Supabase Realtime ne sont activés.
- Le propriétaire répond dans le même fil. Une réponse après clôture remet le dossier dans la file « À prendre en charge ». Les lecteurs du foyer ne peuvent ni partager ni répondre. Un partage retiré bloque les réponses des deux côtés.
- **Retirer le partage** empêche immédiatement les nouvelles lectures/écritures du support ; son écran est vidé à la prochaine actualisation (au plus cinq secondes). Cela ne peut effacer les informations déjà lues ou copiées par un agent.

### Habiliter un compte support

Le responsable de l'installation crée d'abord un compte normal, puis exécute localement, depuis la racine du projet, en remplaçant l'adresse d'exemple :

```powershell
node codex/operator-access.cjs responsable@example.test admin
```

Rôles acceptés : `agent`, `supervisor`, `admin`. Dans ce premier lot ils ont les mêmes droits de traitement des seuls dossiers partagés, sans accès aux commandes de box ni aux foyers privés. Aucun rôle n'est accordé à l'inscription. L'outil ne crée pas de compte et invalide les sessions existantes : il faut se reconnecter. Avec une base personnalisée, passer son chemin exact comme troisième argument. Aucun compte utilisateur n'a été promu automatiquement lors du développement.

Révocation : `node codex/operator-access.cjs responsable@example.test revoke`. Il n'existe aucune route publique de promotion. L'accès au système de fichiers/terminal de l'installation fait partie de la frontière de confiance.

Tables additives : `operator_grants`, `support_shares`, `support_events`. Les partages et échanges sont supprimés en cascade avec leur foyer/dossier. Les réponses destinées au client ne sont pas un espace de notes internes confidentielles. Les comptes restent locaux, sans vérification d'e-mail ni OTP : ne pas exposer ce pilote comme un service Moov de production.

### Scénario reproductible et limites de ce lot

`node --test codex/operator.test.cjs` vérifie les contrôles API. `node codex/operator-browser-check.cjs` joue le scénario complet sur une base en mémoire et un port éphémère : client → dossier privé → refus d'accès admin → habilitation du support → partage consenti → réponse → retrait du partage → révocation. Playwright et Edge sont requis pour le deuxième script ; aucune donnée personnelle de l'installation n'est utilisée.

Ce premier lot livre uniquement la séparation des espaces et la boucle de support sécurisée. Restent à implémenter selon la spécification :

1. M1 : rattachement à une vraie base abonnés, vision d'étiquette, OTP du titulaire ; une photo seule ne donne aucun droit.
2. M2–M4 : historique de ligne consolidé, diagnostic Claude, actions temporaires via adapters vérifiés ; les fonctions existantes de simulation et de tests locaux sont conservées.
3. M5–M6/M8–M9 : incidents de zone, dispatch, suivi technicien, notifications ciblées et remise en service avec preuves.
4. M7/M10/M11 : offres justifiées, paiement de démonstration puis intégration réelle, scoring et assistance agent fondés sur les données.
5. M12–M14 : topologie, segments, localisation déterministe, NOC, runbooks, supervision avec autonomie bornée et évaluation sur 40 scénarios.

Les clés Claude/SMS, l'accès Supabase, le SI abonnés, la cartographie et l'ACS Moov ne sont pas supposés disponibles. Les vrais raccordements et les tests sur la box restent non effectués. Aucune clé figurant sur une photographie n'est intégrée au code.

## Démarrer et essayer

### Guardian : laboratoire d'autorisations (document agent IA, T13 partiel)

Dans **Espace administrateur**, le panneau **Proposer. Autoriser. Vérifier.** prépare les garde-fous de Guardian. Le mode ombre est activé par défaut. Il ne contient aucun LLM, microphone, fournisseur vocal, ACS ou intégration SMS. Les quatre actions sont des exercices sur des ressources fictives : notification R1, mobilisation R2, redémarrage de zone R3, changement de deux zones R4. Les niveaux de risque ne peuvent pas être abaissés par le client HTTP.

Parcours de démonstration :

1. Avec un compte habilité, proposer une action ; examiner justification, impact, retour arrière et dossier fictif R3/R4.
2. Un agent support peut lire/proposer, mais seul un superviseur ou administrateur valide, règle les modes et exécute la simulation.
3. En mode assisté : une validation R1–R3, deux validateurs distincts pour R4. Le mode ombre bloque toute exécution, même validée.
4. Désactiver volontairement le mode ombre du laboratoire, puis cliquer **Exécuter la simulation**. L'effet est écrit et relu dans un registre SQLite ; aucun réseau réel n'est modifié. **Annuler l'effet simulé** restaure le registre, sans prétendre annuler un vrai redémarrage.
5. Le mode semi-autonome dispense de validation pour R1 ; le mode autonome la dispense pour R1/R2 seulement pendant la plage prévue. Une plage quotidienne traversant minuit est supportée, en UTC/Abidjan. Hors plage : mode assisté. Ce lot calcule les autorisations ; il n'exécute pas de boucle autonome d'agent.
6. Une demande est relancée dans le journal local après deux minutes, puis expire à dix minutes. Pas de SMS d'astreinte. Un contrôle serveur a lieu toutes les trente secondes et avant chaque décision/exécution ; aucune demande périmée ne peut s'exécuter.
7. **Arrêt d'urgence Guardian** bloque les nouvelles propositions et annule toutes les demandes encore en attente ou approuvées. Lever l'arrêt ne les réactive pas. Cela n'annule pas les effets déjà exécutés ; le retour arrière simulé reste disponible.

Les permissions et validations sont relues au moment d'exécuter. Les doubles clics et rejeux ne créent pas plusieurs effets. Une mise à jour concurrente des réglages est refusée. Toutes les décisions et simulations ont un journal. L'API refuse tout adaptateur réel ; aucune commande arbitraire n'est acceptée.

Ce lot n'implémente **pas encore** T12–T17 dans leur ensemble : manquent notamment l'orchestrateur Claude, les outils limités au foyer et le consentement du titulaire, les modifications de plans à réapprouver, plusieurs plages d'autonomie, les notifications d'escalade réelles, la mémoire multicanal, la voix, le transfert téléphonique et les 60 conversations d'évaluation. Les objectifs de latence vocale et de résolution autonome ne sont pas mesurés. L'authentification reste celle du pilote local ; aucune conformité RLS Supabase n'est revendiquée.

Vérification : `node --test codex/approval.test.cjs` et `node codex/approval-browser-check.cjs` (Playwright/Edge). Le parcours navigateur utilise une base en mémoire et deux comptes de test habilités ; aucun compte personnel n'est promu. Les captures sont enregistrées dans `../verification/approvals/`.

Utiliser Node 24.21 ou ultérieur compatible avec `node:sqlite`, depuis la racine du projet :

Sous Windows, vous pouvez aussi double-cliquer sur `codex/DEMARRER-GUARDIAN.cmd`, garder sa fenêtre ouverte puis ouvrir l’adresse affichée.

```powershell
node codex/serveur-local.cjs
```

Ouvrir `http://127.0.0.1:8186/codex/`, puis **Mon espace réel**. Créer un compte local, conserver le code de récupération et créer un foyer. Le compte n’est pas un compte Moov et l’adresse e-mail n’est ni vérifiée ni utilisée pour envoyer des messages.

1. Dans **Tests réels**, créer une session puis ouvrir le lien participant dans un autre onglet.
2. Nommer l’appareil, lire et accepter le consentement ; cliquer **Mesurer maintenant**.
3. Sur l’écran propriétaire, essayer la latence ou le ralentissement ; refaire le test côté participant.
4. Cliquer **Rétablir le test**, puis mesurer à nouveau. L’injection expire aussi automatiquement après 60 secondes.
5. Consulter **Historique et relecture**, enregistrer et exporter les résultats.
6. Créer un dossier dans **Dossiers support** ; exporter les preuves pour les transmettre manuellement.

Le mode fichier (`file://`) et un simple serveur Python permettent toujours la démonstration, mais pas cet espace connecté : son API Node est nécessaire.

## Ce que mesure le test

Cinq requêtes HTTP de réponse, suivies d’un téléchargement non compressé de 2 Mio. Le navigateur mesure le temps écoulé et transmet débit descendant, latence moyenne, variation entre sondes et pourcentage de sondes HTTP échouées. Ces mesures concernent **le trajet appareil → serveur Guardian**. Elles ne prouvent ni le débit de l’abonnement Internet, ni une panne fibre, ni le niveau radio. Les résultats sont déclarés par le client de test, pas attestés par un composant matériel sécurisé.

Sur le même ordinateur, le trajet est la boucle locale : c’est une validation fonctionnelle, pas un essai Wi-Fi. Sur deux appareils du même réseau, le test sollicite réellement le lien local entre ces appareils. Les injections ralentissent ou refusent seulement les réponses de ce point de test. Elles ne modifient ni la box, ni le pare-feu, ni le trafic d’autres applications. Les actions et dates sont journalisées. Un résultat de test ne ferme pas automatiquement un incident réel.

## Tester avec un téléphone ou un autre ordinateur

Le serveur écoute uniquement sur `127.0.0.1` par défaut. Copier cette adresse dans un téléphone ne fonctionne pas : elle désigne le téléphone lui-même.

Préparer une adresse locale stable, un certificat TLS que les appareils participants reconnaissent, et vérifier l’adresse IP réelle du PC. Le lancement réseau refuse une configuration sans TLS ni origine explicite. Exemple de configuration, à adapter avec vos vrais chemins et votre nom réseau :

```powershell
$env:GUARDIAN_HOST='0.0.0.0'
$env:GUARDIAN_PORT='8186'
$env:GUARDIAN_ORIGIN='https://guardian-maison.example:8186'
$env:GUARDIAN_TLS_CERT='C:\certificats\guardian-cert.pem'
$env:GUARDIAN_TLS_KEY='C:\certificats\guardian-key.pem'
node codex/serveur-local.cjs
```

L’exemple de nom n’est pas provisionné. Résolution DNS locale et certificat doivent correspondre. Autoriser, avec votre accord, seulement ce port sur le profil réseau privé du pare-feu Windows. Ne pas ouvrir l’administration de la box sur Internet, ne pas configurer de redirection WAN, ne pas désactiver globalement le pare-feu. Le réseau invité peut isoler les appareils et empêcher le test. Le PC doit rester allumé et joignable. Un VPN ou une passerelle distante devra être étudié séparément pour un usage hors domicile.

## Droits et stockage

- Propriétaire : crée les sessions, injections contrôlées, seuils, plans et dossiers ; gère les invitations et effacements.
- Lecteur : consulte un seul foyer auquel il a été invité ; aucune modification, même par appel API direct.
- Participant : consent à une session de deux heures maximum ; ne consulte pas le foyer, ne commande pas la box. Il peut arrêter un test ou révoquer son accès.
- Collecteur : clé distincte limitée à la réception de télémétrie pour un foyer. Rotation et révocation immédiates ; pas de commandes matérielles.
- Les rôles de démonstration de l’ancienne interface sont indépendants et n’accordent aucun droit API.

SQLite : `codex/.local/pilot.sqlite` et ses fichiers WAL/SHM éventuels. Ne jamais servir ce dossier, le publier, le mettre dans Git, un ZIP de livraison ou un partage public. Les clés et codes sont stockés hachés ; les mots de passe utilisent scrypt avec sel aléatoire. La base n’est pas chiffrée par l’application : protéger la session Windows et le disque. Sauvegarder la base après arrêt propre du serveur, avec accès restreint, puis tester la restauration sur une copie.

Sessions de compte : 8 h, cookie HttpOnly/SameSite Strict et Secure avec HTTPS. Mutations protégées par jeton CSRF ; contrôles d’origine et d’hôte ; requêtes SQL paramétrées ; limites de taille et de fréquence ; CSP et anti-encadrement. Ces protections ne constituent pas un audit de sécurité indépendant ni une certification de production.

Mesures brutes : purge au démarrage et toutes les heures au-delà de 30 jours ; journal d’actions : 365 jours. Les enregistrements copiés et dossiers restent jusqu’à suppression du foyer ou de l’enregistrement concerné. Maximum 50 enregistrements, 100 dossiers, 10 foyers par propriétaire, 3 sessions actives par foyer, 30 participants par session. La suppression d’un foyer supprime ses dépendances ; elle ne supprime pas le compte local. Il n’existe pas encore d’interface de suppression individuelle du compte.

## Contrat de collecteur, pas encore un pilote ZLT

Créer une clé dans **Ma box**. Envoyer un POST JSON sur `/api/collector/ingest` avec `Authorization: Bearer <clé>`. Ne pas mettre la clé dans une URL ou dans un fichier livré.

```json
{
  "sequence": 1,
  "at": 1791504000000,
  "metrics": {"downloadMbps": 30, "latencyMs": 15, "connected": 1},
  "devices": [{"id": "identifiant-local-stable", "name": "iPhone de Koffi", "rx": 123456, "tx": 9876}]
}
```

Exemple de forme, pas un relevé réel : remplacer `at` par l’heure actuelle en millisecondes. Séquences et dates strictement croissantes ; heure à moins de cinq minutes du serveur ; maximum 100 appareils ; une identité locale stable par appareil. N’envoyer que des appareils actuellement observés et des mesures que le matériel fournit réellement. L’absence d’une métrique reste `null`, pas zéro. Après redémarrage de l’adaptateur, reprendre sa séquence persistée ou renouveler la clé. Les noms choisis par le propriétaire sont conservés lors des relevés suivants. Les compteurs reçus sont **bruts**, pas des volumes journaliers calculés ; les appareils ont une date de dernière observation, pas une promesse de présence permanente.

L’alerte de nombre inhabituel compare le nombre courant à une référence déclarée + une marge. Elle est enregistrée au dépassement, avec temporisation de cinq minutes pour limiter les doublons. Ce premier raccordement ne revendique pas un apprentissage automatique du comportement réel.

## Limites à lever avant un vrai déploiement Moov

- Identifier l’interface de la ZLT T30, obtenir l’autorisation d’accès puis développer et tester son adaptateur en lecture seule. Aucun mot de passe photographié n’est incorporé au projet.
- Vérifier blocage/déblocage, limitations et redémarrage sur matériel isolé, avec protections du propriétaire et preuve de résultat, avant d’activer ces commandes. Aucun endpoint de commandes arbitraires ou de scan de réseau n’est exposé ici.
- La box photographiée est 4G : elle n’offre pas une preuve de test optique FTTH. Prévoir une box fibre compatible pour valider ce volet.
- Compléter les statistiques réelles par appareil (deltas de compteurs, remises à zéro, trous de collecte, historique long), l’apprentissage des habitudes et les alertes de collecteur déconnecté.
- Ajouter partage QR, notifications en arrière-plan/SMS avec prestataire et consentement, intégration tickets Moov, comptes opérateurs, récupération e-mail vérifiée et suppression de compte.
- Valider la qualité des diagnostics/photographies avec de vrais utilisateurs et pannes contrôlées ; définir les critères et résultats avant/après. L’assistant actuel reste un moteur local explicable, pas un LLM connecté.
- Avant Internet public : revue de sécurité indépendante, récupération et rotation de secrets, HTTPS/DNS, sauvegardes restaurées, surveillance, tests de charge et politique de conservation approuvée.

## Vérification reproductible

```powershell
node --test codex/pilot.test.cjs
node --test codex/pilot-security.test.cjs
node codex/pilot-browser-check.cjs
node codex/pilot-edge-check.cjs
node codex/buttons-audit-runner.cjs
```

Les tests navigateur nécessitent Playwright et Microsoft Edge. Le nouveau test démarre sa propre API sur un port éphémère et une base temporaire : il ne crée aucun compte dans le foyer de l’utilisateur. Les anciennes suites utilisent le serveur de démonstration local sur 8186. Les captures et résultats sont dans `../verification/pilot/` et `../verification/buttons/`, à côté du projet. Les transferts des tests automatisés sont locaux ; aucun SMS, appel Moov ou commande de box n’est exécuté.
