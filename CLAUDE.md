# Fibre Guardian — règles du projet

Projet pour le concours MOOV APPLICATION 2026 (Moov Africa Côte d'Ivoire × IUGB), thème 3 « Fibre Guardian — self-care et diagnostic intelligent ». Dépôt le 31 octobre 2026, code gelé le 29 octobre.

Le produit doit impressionner un jury d'ingénieurs et de managers de Moov. Chaque écran est jugé en démo, en direct, sur téléphone et sur grand écran.

## Version active

- La seule version à modifier est `codex/`.
- La racine (`index.html`, `support.js`, `server/`, `lancer.bat`, `npm start`) est l'ancien prototype. Ne pas la modifier.
- `src/` (ancien prototype) contient des briques à réutiliser plus tard : `agent.js` (agent Claude), `vision.js` (lecture des voyants par photo), `lang/` (français, nouchi, dioula), `fleet.js` (score de résiliation). On les importe ou on les porte dans `codex/`, on ne les modifie pas sur place.
- `vendor/` et `_ds/` sont des bibliothèques embarquées : ne pas les modifier.

## Lancer et tester

- Serveur : `node codex/serveur-local.cjs` depuis la racine `fibre-guardian/`, puis :
  - client : http://127.0.0.1:8186/codex/
  - équipe Moov : http://127.0.0.1:8186/codex/?portal=moov&section=operations
- Node.js 22.5 ou plus récent (module `node:sqlite`). Aucun `npm install` nécessaire pour `codex/`.
- Compte opérateur local : créer un compte, puis `node codex/operator-access.cjs <email> admin`.
- Tests à lancer avant ET après chaque tâche (ils doivent tous passer) :

```
node --test codex/*.test.cjs
node codex/noc-check.cjs
node codex/journey-scenario-check.cjs
node codex/guardian-workflow-check.cjs
node codex/noc-team-workflow-check.cjs
```

- Ne jamais supprimer ou affaiblir un test pour le faire passer. Si un test teste un texte d'interface qu'on a volontairement changé, on met à jour l'attendu et on le signale.

## Règles de l'interface (non négociables)

1. Aucun avertissement technique à l'écran. Pas de « simulé », « fictif », « pas de LLM connecté », « aucun SMS envoyé », « plan fictif », « installation locale », « moteur à règles ». La seule mention autorisée est un badge « Démo » discret dans l'en-tête, qui ouvre une page « À propos de la démo » listant honnêtement ce qui est simulé.
2. Couleurs Moov Africa via les variables CSS de marque (`--moov-primary`, `--moov-accent`, etc.), jamais de couleur codée en dur dans un composant.
3. Mobile d'abord : chaque écran client doit être parfait à 390 px de large, puis vérifié à 1440 px.
4. Langue : français simple et chaleureux, vouvoiement, phrases courtes. Pas de jargon sans explication.
5. L'assistant s'appelle Guardian. Jamais « Alexa » ni le nom d'un autre produit.
6. Les fonctions de laboratoire et de test (« Tests réels », « Support local », « Laboratoire », « Participants », « Outils avancés ») restent dans le code mais sont cachées derrière `?mode=lab`.

## Méthode de travail

- Une tâche à la fois. Ne pas commencer autre chose que la tâche demandée, même si c'est tentant.
- Avant de coder : lire les fichiers concernés et annoncer en quelques lignes ce qui va changer.
- Réutiliser l'existant : le moteur d'incidents, les rôles, les validations et le simulateur fonctionnent et sont testés. On les branche, on ne les réécrit pas.
- Vérifier visuellement après chaque changement d'interface : captures avec `playwright-cli` à 390 × 844 et 1440 × 900, côté client et côté Moov. Regarder les captures avant de déclarer la tâche finie.
- Pour le design, utiliser les skills `impeccable` et `apple-design`.
- Un commit git par tâche, message en français qui dit ce qui a changé.
- À la fin de chaque tâche, donner : ce qui a changé, le résultat des tests, les captures, et ce qui reste éventuellement à faire.

## Sécurité

- Jamais de clé API, mot de passe ou secret dans le code ou dans git : variables d'environnement uniquement (`.env` dans `.gitignore`).
- Les permissions restent vérifiées côté serveur. Ne jamais contourner un contrôle de rôle pour faire marcher une démo.
- Ne pas accorder le rôle admin automatiquement à un compte créé depuis l'interface.
