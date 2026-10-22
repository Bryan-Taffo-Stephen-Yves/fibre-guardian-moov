# Brancher Fibre Guardian sur le vrai réseau Moov

Ce document s'adresse à l'équipe informatique de Moov Africa Côte d'Ivoire. Il explique comment Fibre Guardian passe de la démonstration au vrai réseau **sans modifier l'application** : on règle quatre « prises », une par système Moov.

Tant qu'une prise n'a pas sa clé, elle est fermée (réponse 404) et l'application garde son simulateur. Dès que la clé est réglée sur le serveur, la prise s'ouvre. On peut brancher une seule prise, ou un seul quartier, pour un essai.

| Prise | Système Moov | Variable(s) | Adresse |
|---|---|---|---|
| Réseau | Supervision des box et des OLT (serveur TR-069 / ACS, gestion des OLT) | `GUARDIAN_RESEAU_CLE` | `POST /api/branchements/reseau` |
| Clients | Fichier clients (CRM, facturation) | `GUARDIAN_CLIENTS_CLE` | `POST /api/branchements/clients` |
| USSD | Passerelle USSD | `GUARDIAN_USSD_CLE` | `POST /api/branchements/ussd` |
| SMS | Passerelle SMS (devant le centre SMS) | `GUARDIAN_SMS_URL`, `GUARDIAN_SMS_CLE`, `GUARDIAN_SMS_EXPEDITEUR` (facultatif, « Moov » par défaut) | appelée par Guardian |

Règles communes :

- Chaque clé fait **au moins 32 caractères** (par exemple `openssl rand -hex 32`). Une clé plus courte est ignorée.
- Chaque clé n'ouvre **qu'une seule prise**. La clé « réseau » ne permet pas d'écrire dans le fichier clients, et inversement.
- La clé est envoyée dans l'en-tête `Authorization: Bearer <clé>`. Elle vit dans les variables de l'hébergeur, **jamais dans git**.
- Les envois sont limités en nombre (protection contre les erreurs en boucle) et leur taille est bornée.
- L'équipe Moov voit l'état des prises (démo ou branchée, dernier envoi, dernière erreur) sur `GET /api/branchements`, réservé aux comptes de l'équipe. Aucune clé n'y apparaît.

## 1. Prise « réseau » : l'état des box

L'outil de supervision envoie, pour chaque quartier (segment PON), l'état de ses box. Toutes les 1 à 5 minutes suffit : Guardian regarde les quartiers toutes les 5 secondes et **ignore des mesures de plus de 3 minutes** (il n'invente rien).

```json
{
  "mesures": [
    {
      "segment": "YOP-07",
      "box": [
        {"serie": "HWTC1A2B3C4D", "etat": "Up",   "rxDbm": -21.4},
        {"serie": "HWTC1A2B3C4E", "etat": "Down", "rxDbm": -40,  "alarme": "LOS"},
        {"serie": "ZTEG00112233", "etat": "Down", "alarme": "DYING_GASP"}
      ]
    },
    {"segment": "ABO-01", "alarme": "OLT_DOWN", "box": [{"serie": "HWTC9F8E7D6C", "etat": "Down"}]}
  ]
}
```

- `etat` reprend la norme **TR-181** (`Device.Optical.Interface.{i}.Status`) : `Up`, `Down`, `Unknown`, `Dormant`, `NotPresent`, `LowerLayerDown`, `Error`. Seul `Up` compte comme « en ligne ».
- `rxDbm` est le signal reçu par la box, en dBm. Dans TR-181, `OpticalSignalLevel` est donné en millièmes de dBm : diviser par 1000.
- `alarme` d'une box : `LOS` (plus de lumière : fibre coupée) ou `DYING_GASP` (la box a perdu son courant).
- `alarme` d'un quartier, si l'OLT ou un capteur la donne : `LOS`, `DYING_GASP`, `LOS_WORKS`, `WATER`, `INTRUSION`, `OLT_DOWN`, `UPLINK_HIGH`.

Ce que fait Guardian : il met à jour le quartier (nombre de box, box en ligne, alarme) et applique **la même règle que dans la démo** : un dossier s'ouvre quand au moins 5 box **et** au moins 30 % des box du quartier sont éteintes. Si la plupart des box éteintes ont perdu leur courant, la cause proposée est une coupure électrique (pas d'équipe envoyée) ; sinon une perte de lumière fait penser à la fibre. Un responsable Moov valide toujours le plan avant toute intervention.

Un quartier branché n'est plus jamais touché par le simulateur. Les autres quartiers restent en démo : on peut donc faire un essai sur un seul quartier.

La réponse liste les quartiers reçus et ceux qui sont inconnus de Guardian (`inconnus`). La liste des quartiers vient aujourd'hui de la carte de démonstration ; au branchement, elle est remplacée par la topologie réelle (OLT, ports PON, coupleurs).

```bash
curl -X POST https://<serveur>/api/branchements/reseau \
  -H "Authorization: Bearer $GUARDIAN_RESEAU_CLE" -H "Content-Type: application/json" \
  -d @mesures.json
```

## 2. Prise « clients » : relier une ligne à un compte

Le fichier clients relie le numéro de téléphone d'un abonné fibre à son compte Fibre Guardian et à son quartier. C'est ce qui permet au *144# de reconnaître l'appelant, et aux alertes d'aller seulement aux clients du quartier touché.

```json
{"lignes": [{"telephone": "0701020304", "email": "client@exemple.ci", "segment": "YOP-07"}]}
```

- `telephone` : 10 chiffres ivoiriens, avec ou sans `225` ou `+225`.
- Au plus 500 lignes par envoi. Un compte de l'équipe Moov n'est **jamais** relié (refusé), un compte inconnu ou un quartier inconnu est refusé ligne par ligne, avec la raison.
- Cette prise ne crée pas de compte et ne donne aucun rôle. La création automatique des comptes depuis le CRM est l'étape suivante du pilote.

## 3. Prise « USSD » : le *144# sur n'importe quel téléphone

La passerelle USSD de Moov appelle Guardian à chaque touche du client, au format habituel des passerelles (formulaire `application/x-www-form-urlencoded` ou JSON) :

| Champ | Exemple | Rôle |
|---|---|---|
| `sessionId` | `ATUid_123` | session USSD |
| `serviceCode` | `*144#` | code composé |
| `phoneNumber` | `+2250701020304` | numéro de l'appelant |
| `text` | `1*1*1` | tout ce que le client a tapé depuis le début |

Guardian répond en texte brut : `CON …` (l'écran attend une touche) ou `END …` (fin de session). Chaque écran fait au plus 182 caractères. Le menu est **exactement celui de l'application** (signaler une panne, suivre son dossier, son technicien, panne dans le quartier, suivi par SMS). Un numéro non relié reçoit un message poli et rien d'autre. Un signalement crée un vrai dossier dans le centre d'opérations.

Le code `*144#` est un exemple. Moov peut aussi ajouter une ligne « Ma fibre » dans un menu USSD qu'il possède déjà : dans les deux cas, la passerelle appelle la même adresse.

## 4. Prise « SMS » : les messages au client

Quand le menu USSD envoie un SMS (accusé de signalement, lien de suivi du technicien), Guardian appelle la passerelle SMS de Moov :

```http
POST <GUARDIAN_SMS_URL>
Authorization: Bearer <GUARDIAN_SMS_CLE>
Content-Type: application/json

{"to": "+2250701020304", "from": "Moov", "text": "Moov Fibre : signalement FG-001 reçu. Suivez-le au *144#, même sans internet."}
```

- L'adresse doit être en `https`. Une petite passerelle HTTP devant le centre SMS (par exemple Kannel relié en SMPP) suffit.
- Un échec n'arrête jamais le menu : il est noté et visible dans `GET /api/branchements`.

## Ce qui reste à faire avec Moov pour un vrai lancement

1. **Héberger** Guardian sur les serveurs de Moov en Côte d'Ivoire (données personnelles : loi n° 2013-450 et ARTCI), avec une base PostgreSQL à la place de SQLite pour plusieurs serveurs.
2. **Topologie** : importer la liste réelle des quartiers, OLT et ports PON à la place de la carte de démonstration.
3. **Comptes** : créer les comptes clients depuis le CRM et se connecter avec le numéro de téléphone (code par SMS, déjà présent dans l'application).
4. **Outil d'intervention** : relier les dossiers à l'outil de gestion des techniciens de Moov.
5. **Essai** : un seul quartier ou une seule commune (par exemple Grand-Bassam) pendant 3 mois, puis élargir.

Tests : `node --test codex/branchements.test.cjs` vérifie les quatre prises (fermées sans clé, clés séparées, détection sur de vraies valeurs, *144# depuis un numéro relié, SMS).
