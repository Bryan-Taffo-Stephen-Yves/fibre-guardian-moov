# Brancher Fibre Guardian sur le vrai réseau Moov

Ce document s'adresse à l'équipe informatique de Moov Africa Côte d'Ivoire. Il explique comment Fibre Guardian passe de la démonstration au vrai réseau **sans modifier l'application** : on règle cinq « prises », une par système Moov.

Tant qu'une prise n'a pas sa clé, elle est fermée (réponse 404) et l'application garde son simulateur. Dès que la clé est réglée sur le serveur, la prise s'ouvre. On peut brancher une seule prise, ou un seul quartier, pour un essai.

| Prise | Système Moov | Variable(s) | Adresse |
|---|---|---|---|
| Réseau | Supervision des box et des OLT (serveur TR-069 / ACS, gestion des OLT) | `GUARDIAN_RESEAU_CLE` | `POST /api/branchements/reseau` |
| Clients | Fichier clients (CRM, facturation) | `GUARDIAN_CLIENTS_CLE` | `POST /api/branchements/clients` |
| USSD | Passerelle USSD | `GUARDIAN_USSD_CLE` | `POST /api/branchements/ussd` |
| SMS | Passerelle SMS (devant le centre SMS) | `GUARDIAN_SMS_URL`, `GUARDIAN_SMS_CLE`, `GUARDIAN_SMS_EXPEDITEUR` (facultatif, « Moov » par défaut) | appelée par Guardian |
| Box | Serveur de gestion des box (ACS TR-069, par exemple GenieACS) | `GUARDIAN_BOX_URL`, `GUARDIAN_BOX_CLE`, `GUARDIAN_BOX_FORMAT` (facultatif, `genieacs` par défaut) | lue par Guardian |

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
{"lignes": [{"telephone": "0701020304", "email": "client@exemple.ci", "segment": "YOP-07", "serie": "HWTC1A2B3C4D"}]}
```

- `telephone` : 10 chiffres ivoiriens, avec ou sans `225` ou `+225`.
- `serie` (facultatif) : le numéro de série de la box du client (4 à 32 lettres, chiffres ou tirets, casse gardée). Il sert à la prise « box » ci-dessous. Une box n'appartient qu'à un compte : la relier à un client la retire de l'ancien, et une ligne qui change d'abonné retire la box à l'ancien.
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

## 5. Prise « box » : les vraies mesures de la box de chaque client

Les prises 1 à 4 reçoivent des données. Celle-ci **lit** : quand un client ouvre l'application ou parle à Guardian, Guardian demande à l'ACS de Moov les dernières valeurs de **sa** box (reliée par le champ `serie` de la prise « clients »). Guardian ne fait que lire : aucun ordre n'est envoyé à la box.

Valeurs lues (TR-181, avec l'équivalent TR-098 pour les box plus anciennes) :

| Valeur | Paramètre TR-181 | Ce que Guardian en fait |
|---|---|---|
| État de la fibre | `Device.Optical.Interface.1.Status` (Huawei TR-098 : `X_GponInterafceConfig.Status`) | `Up` = la fibre arrive ; autre chose = box coupée à l'écran et Guardian le dit, même sans panne de quartier. Sans état, une lumière au-dessus de −28 dBm (sensibilité GPON classe B+) veut dire que la fibre arrive |
| Lumière reçue | `Device.Optical.Interface.1.OpticalSignalLevel` (millièmes de dBm) | remplace la valeur simulée ; « faible » à −24 dBm ou moins |
| Lumière envoyée | `Device.Optical.Interface.1.TransmitOpticalLevel` | gardée pour l'équipe |
| Dernier redémarrage | `Device.DeviceInfo.UpTime` | « allumée depuis 1 jour et 1 heure » dans les preuves de Guardian, seulement si le compteur a moins de 3 minutes |
| Modèle, logiciel | `Device.DeviceInfo.ModelName`, `SoftwareVersion` | affichés dans les preuves |
| Appareils connus | `Device.Hosts.HostNumberOfEntries` | gardé pour l'équipe |
| Heure de la mesure | `_timestamp` de chaque valeur (GenieACS), sinon `_lastInform` | « Dernière remontée de la box » : l'heure de la plus ancienne des valeurs montrées (état, lumière) |

Deux formats sont compris :

- `GUARDIAN_BOX_FORMAT=genieacs` (par défaut) : l'interface NBI de [GenieACS](https://genieacs.com), ACS libre très répandu. Guardian appelle `GET <GUARDIAN_BOX_URL>/devices/?query={"_deviceId._SerialNumber":"<serie>"}&projection=…`.
- `GUARDIAN_BOX_FORMAT=guardian` : pour un autre ACS (Huawei, Nokia, ZTE…), une petite passerelle de Moov répond à `GET <GUARDIAN_BOX_URL>/box/<serie>` :

```json
{"etat": "Up", "rxDbm": -21.4, "txDbm": 2.3, "uptimeS": 90061, "modele": "HG8145V5", "logiciel": "V5R020C10S115", "appareils": 6, "vu": "2026-11-23T10:30:00Z"}
```

Règles :

- L'adresse est en `https` et la clé (32 caractères ou plus) part dans `Authorization: Bearer <clé>`. Sans les deux, rien n'est lu. L'interface NBI de GenieACS n'a pas d'authentification à elle : on la met derrière un proxy https (nginx par exemple) qui vérifie cette clé.
- L'ACS a 4 secondes pour répondre, mais l'écran du client n'attend jamais plus de 1,5 seconde : il s'affiche avec la dernière mesure et la lecture se termine en arrière-plan. Une box n'est pas relue plus d'une fois toutes les 30 secondes, même après un échec. Une réponse de plus de 256 Ko est refusée et son contenu n'est jamais recopié.
- **Une mesure de plus de 3 minutes n'est jamais montrée comme actuelle** : Guardian revient alors au simulateur, il n'invente rien. La date compte valeur par valeur : une box passée à l'ACS il y a une minute, mais dont la lumière n'a pas été relue depuis 3 jours, est trop vieille. Côté Moov, il faut donc que l'ACS relise ces valeurs souvent (dans GenieACS, une « provision » qui les rafraîchit à chaque inform, avec un intervalle d'inform de quelques minutes).
- Une box qui a perdu la fibre ne peut plus parler à l'ACS (son TR-069 passe par la fibre). L'ACS sert donc surtout à voir une lumière faible ou une box qui va mal ; la coupure elle-même se voit sur l'OLT, par la prise « réseau » (alarme `LOS`).
- Le débit et le temps de réponse ne viennent pas de l'ACS : ils sont mesurés par « Tester ma connexion » sur le téléphone du client.
- Hors démonstration, un client relié à une vraie box ne devrait jamais voir de valeur du simulateur : au lancement, le simulateur est coupé pour ces comptes (étape « Comptes » ci-dessous).
- Une panne de quartier en cours garde la priorité sur la mesure de la box.
- Une seule vraie mesure ne fait pas une tendance : la carte « Guardian a vu venir une panne » attend d'avoir une mesure par jour de la vraie box. C'est l'étape suivante.
- Un échec (ACS injoignable, box inconnue) est noté et visible dans `GET /api/branchements`, avec le nombre de box reliées (`boxReliees`).

## Ce qui reste à faire avec Moov pour un vrai lancement

1. **Héberger** Guardian sur les serveurs de Moov en Côte d'Ivoire (données personnelles : loi n° 2013-450 et ARTCI), avec une base PostgreSQL à la place de SQLite pour plusieurs serveurs.
2. **Topologie** : importer la liste réelle des quartiers, OLT et ports PON à la place de la carte de démonstration.
3. **Comptes** : créer les comptes clients depuis le CRM et se connecter avec le numéro de téléphone (code par SMS, déjà présent dans l'application).
4. **Outil d'intervention** : relier les dossiers à l'outil de gestion des techniciens de Moov.
5. **Essai** : un seul quartier ou une seule commune (par exemple Grand-Bassam) pendant 3 mois, puis élargir.

Tests : `node --test codex/branchements.test.cjs` vérifie les quatre premières prises (fermées sans clé, clés séparées, détection sur de vraies valeurs, *144# depuis un numéro relié, SMS). `node --test codex/mesures-box.test.cjs` vérifie la prise « box » (lecture GenieACS et TR-098, heure de chaque valeur, mesure trop vieille, ACS en panne ou lent, box coupée dans le chat, une box par compte).
