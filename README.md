# Fibre Guardian

Prototype de diagnostic de ligne fibre pour Moov Africa Côte d'Ivoire : détection de panne, agent conversationnel en français, nouchi et dioula, lecture des voyants par photo, canal SMS, incidents de zone et score de résiliation.

## Lancer l'application

Tout fonctionne sans Internet. React, three.js et la police Archivo sont dans `vendor/`.

- **Le plus simple** : ouvrir `index.html` dans Chrome ou Edge.
- **Pour l'installer comme application (PWA)** : servir le dossier, par exemple avec `python3 -m http.server 8000`, ouvrir `http://localhost:8000`, puis choisir « Installer l'application ». Une fois chargée, elle marche en mode avion.
- **Avec l'agent Claude** : voir « Serveur d'agent » plus bas.

## Organisation

| Fichier | Rôle | CDC |
|---|---|---|
| `src/engine.js` | Règles physiques ordonnées, référence de 7 jours par tranche horaire (médiane / MAD), classe « anomalie », simulateur de ligne, collecte veille / diagnostic avec tampon | M1, M2, 6.3, 7.1 |
| `src/fleet.js` | Flotte de 48 abonnés sur 4 segments, agrégation sur 3 min, incident de zone (≥ 5 abonnés et ≥ 25 % du segment), notification avant appel, score de résiliation | M9, M10, M12 |
| `src/agent.js` | Intention de la question, réponse locale à partir des mesures, garde-fous (chiffres présents dans les mesures, longueur), appel au serveur si disponible | M5, 7.3 |
| `src/lang/*.js` | Un fichier par langue | ENF-23 |
| `src/vision.js` | Contrôle de qualité de la photo, repérage des voyants par couleur, clignotement sur deux photos, croisement avec la puissance optique | M6, 7.4 |
| `server/server.mjs` | Serveur optionnel : sert l'application, `/api/agent` et `/api/vision` avec Claude | 7.2 |
| `sw.js`, `manifest.webmanifest` | Fonctionnement hors ligne et installation | ENF |
| `tests/` | Tests automatiques et évaluation sur corpus | 3.2, 7.3 |

## Serveur d'agent (optionnel)

```bash
npm install
export ANTHROPIC_API_KEY=...   # clé fournie par l'équipe, jamais écrite dans le code
npm start                      # http://localhost:8080
```

- Le modèle utilisé est `claude-opus-5`, en effort bas pour que le premier texte arrive en moins de 5 s (ENF-4).
- Le repli côté serveur est activé (`fallbacks: "default"`) : si le modèle est surchargé, l'API bascule seule sur un modèle de secours.
- Le téléphone envoie les mesures avec la question. Il rejette toute réponse qui cite un chiffre absent des mesures et répond alors en local.
- Sans clé, ou si le serveur ne répond pas en 5 s, l'application répond en local. Elle ne tombe jamais en panne à cause de l'agent.
- La photo est envoyée au serveur uniquement si `config.js` le prévoit. Elle n'est jamais conservée (ENF-17).

## Ajouter une langue

1. Copier `src/lang/fr.js` en `src/lang/<code>.js`, puis traduire `verdict`, `keywords`, `quick` et `reply`.
2. Ajouter `<code>` dans `src/lang/manifest.js`.
3. Ajouter le fichier dans la liste de `sw.js` pour l'usage hors ligne.
4. Lancer `npm test` : chaque classe de panne doit avoir un verdict, et chaque réponse doit passer les garde-fous.

## Tests

```bash
npm test                          # 20 tests : détection, flotte, agent, vision
npm run eval                      # intention et garde-fous sur tests/corpus.json
node tests/eval-corpus.js mon_corpus.json
```

`tests/corpus.json` est **synthétique** : il ne sert qu'à amorcer l'outil. Remplacez-le par les formulations réelles collectées auprès d'abonnés et de locuteurs natifs. Le format est `{ "items": [{ "lang", "text", "intent" }] }`.

## Ce qui reste simulé ou à valider

- **Télémétrie de la box** : la puissance optique, le rapport S/B, le Wi-Fi et les appareils viennent du simulateur. En réel, il faut un accès TR-069 / TR-369 ou un agent sur la box. Le débit, la latence, la gigue et la perte sont réellement mesurés par « Lancer la mesure réelle ».
- **Historique de 7 jours** : il est généré. En production, il vient des agrégats horaires.
- **Vision** : la lecture est heuristique (couleur et luminosité), fiable sur une photo nette prise de face. Il faut la valider sur de vraies photos de box Moov. Le serveur peut compléter avec Claude.
- **Dioula et nouchi** : les textes sont à faire valider par des locuteurs natifs. Le dioula répond court, avec une traduction française.
- **SMS et USSD** : le canal est simulé dans l'application. Il faut la passerelle SMS de Moov.
- **Score de résiliation** : les poids sont posés à la main (`CHURN_W` dans `src/fleet.js`). Ils sont à réestimer sur l'historique réel des résiliations.
- **Économie** : toutes les valeurs marquées « hypothèse » sont à remplacer par les chiffres de Moov.
