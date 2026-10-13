# Contrôle empirique du moteur fourni

Contrôle local du 4 octobre 2026, sans modification de `src/`, sans réseau Moov et sans appel de modèle externe.

## Résultats reproductibles

- `node --test tests/*.test.js` : **20 tests réussis sur 20**.
- `node tests/eval-corpus.js` : intentions FR 7/7, nouchi 6/6, dioula 4/4 ; garde-fous 136/136. **Corpus synthétique**, ces chiffres ne constituent pas une évaluation auprès d'abonnés ni une validation linguistique.
- Tests d'intégration du contrat : `node --test codex/engine-contract.test.cjs` ; inclut affichage par rôle, limite des redémarrages SMS simulés (deux par dix minutes, frontières exactes), repli de stockage local.
- Mesure de détection : 40 graines (1 à 40), bruit 1, sévérité 0, horizon 90 pas. Toutes les classes finales sont celles attendues. Chaque pas représente une seconde simulée ; ce n'est pas une mesure de latence réseau réelle.

| Scénario | Minimum | Médiane | Maximum |
|---|---:|---:|---:|
| Rupture | 6 s | 6 s | 6 s |
| Atténuation | 24 s | 29 s | 32 s |
| Wi-Fi | 7 s | 8 s | 8 s |
| Amont | 7 s | 7 s | 7 s |
| Congestion | 7 s | 7 s | 8 s |
| Partage | 6 s | 6 s | 6 s |

Le seuil « moins de 10 secondes » ne s'applique donc pas à la convergence de l'atténuation. Le moteur ne doit pas être modifié artificiellement pour masquer ce résultat.

## Contrat à respecter dans l'interface

1. Amorcer `LineSim` par neuf échantillons nominaux avant `window()`. Sans échantillon, la médiane est non définie.
2. Passer seulement des mesures valides au détecteur ; le module ne valide pas le schéma d'entrée et ne remplace pas un adaptateur sécurisé pour une box réelle.
3. Afficher les mesures, les preuves et la trace de règles. `conf` est un **indice heuristique de concordance**, pas une probabilité calibrée ni une précision mesurée.
4. Conserver les exemples visuels à 320 × 200 : `samplePhoto` utilise des positions de voyants fixes. `vision.analyze` nécessite au moins une image RGBA et une télémétrie optique valide ; ne pas annoncer une lecture fiable du matériel sans cette télémétrie.
5. Les images sont analysées par luminosité, couleurs et composantes connexes. Ce n'est ni un modèle entraîné ni une reconnaissance fiable des modèles de box. Deux images peuvent suggérer un clignotement, mais leur mouvement peut aussi créer une différence.
6. Les trois langues ont des réponses ; nouchi et dioula restent à valider avec des locuteurs. Les textes hérités contiennent des affirmations de démonstration (« équipes prévenues ») : ne pas les présenter comme des notifications opérateur réelles.

## Limites produit et sécurité à rendre visibles

- Les notifications de flotte sont des horodatages `notifiedAt` **en mémoire**. Il n'y a ni fournisseur SMS, ni réception vérifiée, ni envoi à Moov dans ces modules.
- Le risque de résiliation utilise des poids manuels. Les caractéristiques et 48 abonnés de la flotte sont synthétiques. Une proposition d'action n'est pas une action effectuée.
- L'ETA d'incident de flotte « 1 h 40 » est une constante de démonstration, pas une estimation calculée.
- La flotte utilise une accélération temporelle pour le score de résiliation (un pas ajoute 0,05 h dégradée), tandis que la détection compte les pas comme secondes. Éviter de confondre ces deux échelles.
- Beaucoup d'appareils ne prouvent aucun partage illégal. Présenter la classe interne `partage` comme **usage partagé à vérifier**, sans accusation ou sanction automatique.
- Le garde-fou conversationnel contrôle des nombres et la longueur, mais **ne vérifie pas effectivement les actions autorisées** malgré son commentaire. Le seuil de longueur tolère jusqu'à sept phrases. Aucun agent externe ne devrait être exposé en production sans renforcement.
- Le serveur optionnel fourni est une démonstration sans authentification/rate limiting pour l'API de modèle. Ne pas l'exposer avec une clé payante avant durcissement. Le nom de modèle et les options bêta fournis n'ont pas été validés ici.
- Ces résultats ne valident ni équipements réels, ni SMS réel, ni performance terrain, ni déploiement public sécurisé.
