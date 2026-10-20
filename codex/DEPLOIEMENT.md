# Mettre Fibre Guardian en ligne

Ce guide explique comment publier Fibre Guardian sur Internet, pour que le jury l'ouvre depuis un téléphone ou un ordinateur, sans rien installer. Il est écrit pour quelqu'un qui n'est pas développeur. Comptez environ 20 minutes.

Rien n'a encore été mis en ligne : ce guide prépare l'opération, vous décidez quand la faire.

## Ce qu'il faut savoir avant de commencer

- **L'hébergeur conseillé est Railway** (railway.com). Il lit directement le dépôt GitHub, et un « volume » garde la base de données quand l'application redémarre. Sans volume, les comptes et les incidents seraient effacés à chaque mise à jour.
- **C'est payant après la période d'essai.** Railway donne un crédit d'essai, puis son offre « Hobby » coûte quelques dollars par mois. Vérifiez le prix du jour sur railway.com/pricing avant de valider.
- **Une seule copie de l'application doit tourner.** La base est un fichier sur le volume : ne demandez pas plusieurs « réplicas ». Le fichier `railway.json` du dépôt règle déjà cela.
- **Aucun mot de passe dans GitHub.** Les mots de passe se saisissent dans l'écran « Variables » de Railway, jamais dans un fichier du dépôt.

## Étape 1 : avoir la bonne version sur GitHub

Railway publie la branche principale (`main`) du dépôt `fibre-guardian-moov`. Fusionnez d'abord la pull request de la phase 1 sur GitHub, sinon Railway publiera l'ancienne version.

## Étape 2 : créer le projet sur Railway

1. Allez sur railway.com et cliquez sur **Login**, puis **Login with GitHub**.
2. Cliquez sur **New Project**, puis **Deploy from GitHub repo**.
3. Choisissez **fibre-guardian-moov**. Si Railway ne le voit pas, cliquez sur **Configure GitHub App** et autorisez ce dépôt.
4. Railway trouve tout seul le fichier `railway.json` et construit l'application avec `codex/Dockerfile`. Le premier lancement peut échouer tant que les étapes 3 à 5 ne sont pas faites : c'est normal.

## Étape 3 : ajouter le volume (la mémoire de l'application)

1. Dans le projet, faites un clic droit sur le carré de l'application, puis **Attach Volume** (ou **+ New**, puis **Volume**).
2. Dans **Mount path**, écrivez exactement : `/data`
3. Validez.

L'application range sa base dans ce volume. Railway lui indique automatiquement où il se trouve.

## Étape 4 : obtenir l'adresse publique

1. Cliquez sur l'application, puis sur l'onglet **Settings**.
2. Dans **Networking**, cliquez sur **Generate Domain**. Si Railway demande un port, indiquez `8080`.
3. Copiez l'adresse obtenue, par exemple `https://fibre-guardian-production.up.railway.app`.

## Étape 5 : saisir les réglages (variables)

Dans l'onglet **Variables** de l'application, ajoutez une ligne par réglage (bouton **New Variable**) :

| Nom | Valeur | Obligatoire |
|---|---|---|
| `GUARDIAN_ORIGIN` | l'adresse de l'étape 4, qui commence par `https://` et se termine sans `/` | oui |
| `GUARDIAN_DEMO_ADMIN_PASSWORD` | le mot de passe du compte « Direction technique », au moins 12 caractères, que vous gardez pour vous | oui |
| `GUARDIAN_DEMO_CLIENT_PASSWORD` | le mot de passe d'Awa Koné, si vous ne voulez pas celui du README | non |
| `GUARDIAN_DEMO_TECH_PASSWORD` | le mot de passe d'Ibrahim Traoré, si vous ne voulez pas celui du README | non |
| `ANTHROPIC_API_KEY` | votre clé API Anthropic (elle commence par `sk-ant-`) : Guardian rédige alors ses réponses avec Claude | non, mais conseillé |

Les autres réglages sont déjà dans l'image : `GUARDIAN_PROXY=1` (Railway s'occupe du HTTPS), le port, et le dossier `/data`.

Cliquez ensuite sur **Deploy** (ou **Redeploy**) pour relancer avec ces réglages.

## Étape 6 : vérifier

1. Ouvrez `https://votre-adresse/api/health` : la page doit afficher `"ok":true`.
2. Ouvrez `https://votre-adresse/` : l'écran d'accueil de Fibre Guardian apparaît.
3. Connectez-vous avec « Compte existant » : `awa.kone@demo.fibre-guardian.ci`. Vous devez voir la carte « Une coupure a été réparée » de son quartier.
4. Côté Moov, ouvrez `https://votre-adresse/codex/?portal=moov&section=operations` et connectez-vous avec `direction@demo.fibre-guardian.ci` et le mot de passe de l'étape 5. L'incident COC-03 attend votre validation.

Au premier démarrage, la démo se remplit toute seule. Elle n'est pas recréée aux démarrages suivants, puisque le volume garde la base.

## Guardian avec Claude (clé API Anthropic)

Sans clé, Guardian répond avec ses règles écrites à l'avance. Avec une clé, Claude reformule chaque réponse pour qu'elle colle à la question de l'abonné. Ce que Guardian vérifie et propose ne change pas : Claude ne peut ni ajouter d'action ni citer un chiffre absent des mesures. Si Claude ne répond pas à temps, la réponse habituelle s'affiche, sans message d'erreur.

**Créer la clé** : sur console.anthropic.com, menu **API Keys**, puis **Create Key**, dans l'espace de travail **Default** (pas une clé « Admin »). Copiez-la aussitôt : elle ne s'affiche qu'une fois. Dans **Limits**, fixez une limite de dépense mensuelle.

**Sur Railway** : onglet **Variables**, **New Variable**, nom `ANTHROPIC_API_KEY`, valeur la clé, puis **Redeploy**.

**Sur votre ordinateur (Windows)** : dans le dossier `codex`, créez avec le Bloc-notes un fichier nommé `.env` (type « Tous les fichiers ») qui contient une seule ligne : `ANTHROPIC_API_KEY=sk-ant-…`. Relancez le serveur : la console affiche « Guardian : réponses rédigées avec Claude ». Ce fichier est ignoré par git, il ne part jamais sur GitHub.

Garde-fous de dépense : 20 réponses rédigées par abonné toutes les 10 minutes et 400 par jour pour toute l'application ; au-delà, Guardian revient à ses règles.

## Vrais messages WhatsApp (facultatif)

Sans réglage, les messages du Simulateur restent dans le téléphone affiché à l'écran. Avec les réglages ci-dessous, les mêmes messages partent aussi sur de vrais téléphones WhatsApp : le client ne reçoit que les pannes de sa commune, l'équipe Moov et le technicien reçoivent les leurs. Chaque message ne part qu'une fois. Le Simulateur affiche « Parti aussi sur un vrai téléphone », ou la raison d'un échec en mots simples.

**Twilio (le plus rapide, gratuit, sans carte bancaire)** :

1. Créez un compte sur twilio.com/try-twilio et confirmez votre e-mail et votre numéro.
2. Menu **Messaging**, puis **Try it out**, puis **Send a WhatsApp message**. La page affiche un mot de code (par exemple « join fresh-tiger ») et le numéro +1 415 523 8886.
3. Sur chaque téléphone de la démo, envoyez ce mot de code par WhatsApp à ce numéro. À refaire tous les 3 jours (et le matin du jury).
4. Sur la page d'accueil de la console Twilio, copiez **Account SID** et **Auth Token**.

**Sur Render** (onglet **Environment**) ou **Railway** (onglet **Variables**), ajoutez :

- `TWILIO_ACCOUNT_SID` : l'Account SID ;
- `TWILIO_AUTH_TOKEN` : l'Auth Token ;
- `WHATSAPP_NUMEROS` : qui reçoit quoi, par exemple `Grand-Bassam=2250701020304, equipe=2250705060708, technicien=2250709101112`. À gauche du signe `=`, une commune (Cocody), un quartier (Palmeraie) ou son code (BAS-01) pour un client, ou bien `equipe` ou `technicien` ; à droite, le numéro WhatsApp complet avec l'indicatif 225 (par exemple `2250701020304` pour le 07 01 02 03 04).

Le compte gratuit envoie environ 100 messages, un toutes les 3 secondes : le client reçoit le sien en premier.

**Meta (numéro de test WhatsApp Cloud)** fonctionne aussi : `WHATSAPP_TOKEN` et `WHATSAPP_PHONE_ID` à la place des deux réglages Twilio, 5 téléphones autorisés au plus, chacun doit d'abord écrire au numéro de test.

Comme pour la clé Claude : ces réglages ne se collent jamais dans une discussion ni dans GitHub. En local, ils peuvent aller dans `codex/.env`.

## Étape 7 : l'application Android (fichier APK)

Le concours demande une application qui fonctionne sur Android. Fibre Guardian en devient une grâce à PWABuilder, un service gratuit de Microsoft qui emballe le site en vraie application Android. Il faut que le site soit déjà en ligne (étapes 1 à 6).

1. Allez sur **pwabuilder.com**, collez l'adresse publique suivie de `/codex/` (par exemple `https://fibre-guardian-production.up.railway.app/codex/`), puis cliquez sur **Start**.
2. PWABuilder affiche une note : l'icône, les captures d'écran et le mode hors ligne sont déjà prêts.
3. Cliquez sur **Package for stores**, puis sur **Android** et **Generate Package**. Dans les options :
   - **Package ID** : `ci.fibreguardian.app`
   - **App name** : `Fibre Guardian`
   - **Signing key** : laissez **Create new** (PWABuilder crée la clé de signature).
4. Téléchargez le fichier zip. Il contient l'application (`.apk`), la version pour le Play Store (`.aab`), la clé de signature (`signing.keystore` et `signing-key-info.txt`) et un fichier `assetlinks.json`.
5. **Rangez la clé de signature en lieu sûr** (clé USB, coffre de mots de passe). Elle ne va jamais sur GitHub. Sans elle, vous ne pourrez plus mettre l'application à jour.
6. Ouvrez `assetlinks.json` avec le Bloc-notes. Copiez la longue empreinte entre guillemets après `sha256_cert_fingerprints` (elle ressemble à `AB:12:CD:…`).
7. Dans Railway, onglet **Variables**, ajoutez :
   - `GUARDIAN_ANDROID_PACKAGE` = `ci.fibreguardian.app`
   - `GUARDIAN_ANDROID_SHA256` = l'empreinte copiée

   Puis cliquez sur **Redeploy**. Vérifiez que `https://votre-adresse/.well-known/assetlinks.json` affiche le nom du paquet. C'est ce qui permet à l'application de s'ouvrir en plein écran, sans barre d'adresse.
8. Envoyez le fichier `.apk` sur un téléphone Android (câble, WhatsApp, Drive), ouvrez-le et acceptez « Installer des applications inconnues ». L'icône Fibre Guardian apparaît avec les autres applications.

Pour le dépôt du concours, joignez le fichier `.apk`. Le fichier `.aab` ne sert que pour une publication sur le Play Store.

## Installer l'application sur un téléphone

Fibre Guardian est une application web installable :

- **Android (Chrome)** : ouvrez l'adresse, puis menu **⋮**, puis **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
- **iPhone (Safari)** : ouvrez l'adresse, touchez le bouton **Partager**, puis **Sur l'écran d'accueil**.
- **Ordinateur (Edge ou Chrome)** : cliquez sur l'icône d'installation à droite de la barre d'adresse.

Sans réseau, l'application ouvre un écran « Vous êtes hors ligne » avec quelques conseils, au lieu d'une page d'erreur du navigateur.

## Remettre la démo à zéro

- **Le plus simple** : connecté en « Direction technique », ouvrez le badge **Démo**, puis **Réinitialiser la démo**.
- **Tout effacer** : dans Railway, supprimez le volume puis recréez-le sur `/data` (étape 3) et relancez. La démo se remplit de nouveau.

## Mettre à jour

Chaque fusion sur la branche `main` de GitHub relance automatiquement la publication sur Railway. Les données du volume sont conservées.

## En cas de problème

| Ce que vous voyez | Ce qu'il faut faire |
|---|---|
| Le déploiement s'arrête avec « GUARDIAN_ORIGIN est requis » ou « doit être une adresse https » | Vérifiez la variable `GUARDIAN_ORIGIN` (étape 5). Elle doit commencer par `https://`. |
| La page affiche « Hôte refusé » | L'adresse dans `GUARDIAN_ORIGIN` ne correspond pas à celle que vous ouvrez. Recopiez-la exactement. |
| Les comptes disparaissent après une mise à jour | Le volume manque ou n'est pas monté sur `/data` (étape 3). |
| Impossible de se connecter en « Direction technique » | Vérifiez `GUARDIAN_DEMO_ADMIN_PASSWORD`. Si la base existait déjà avant que vous ajoutiez cette variable, le mot de passe est celui du fichier `identifiants-demo.txt` du volume : remettez la démo à zéro en supprimant le volume. |
| La console affiche « Guardian : réponses du moteur à règles » alors que la clé est saisie | En local, vérifiez que le fichier s'appelle bien `.env` dans le dossier `codex` et que la ligne commence par `ANTHROPIC_API_KEY=`. Sur Railway, vérifiez le nom de la variable puis relancez. |
| L'application Android affiche une barre d'adresse en haut | `GUARDIAN_ANDROID_SHA256` ne correspond pas à la clé qui a signé l'APK, ou Railway n'a pas été relancé. Recopiez l'empreinte de `assetlinks.json` (étape 7). |
| Trop de tentatives de connexion | C'est la protection contre les abus : 15 essais par minute, et 3 codes SMS par numéro toutes les 10 minutes. Attendez quelques minutes. |

## Autres hébergeurs possibles

L'image `codex/Dockerfile` fonctionne chez tout hébergeur qui accepte Docker et un disque permanent. Il faut seulement fournir les mêmes variables et un disque monté sur `/data` (ou indiquer son chemin dans `GUARDIAN_DATA_DIR`).

- **Render** : il faut un service payant avec « Persistent Disk », car l'offre gratuite efface le disque et met l'application en veille.
- **Fly.io** : fonctionne avec un « volume », mais la configuration se fait en ligne de commande.

## Pour un informaticien : réglages complets

| Variable | Rôle | Par défaut |
|---|---|---|
| `PORT` | Port d'écoute (donné par l'hébergeur) | `8080` dans l'image, `8186` en local |
| `GUARDIAN_PROXY` | `1` : derrière un proxy HTTPS (cookies `Secure`, HSTS, redirection HTTP→HTTPS, adresse du visiteur lue dans `X-Real-IP` ou `X-Forwarded-For`) | `1` dans l'image |
| `GUARDIAN_ORIGIN` | Adresse publique `https://…`, seule adresse acceptée | aucune |
| `GUARDIAN_DATA_DIR` | Dossier de la base SQLite et de `identifiants-demo.txt` | `/data` dans l'image, sinon `RAILWAY_VOLUME_MOUNT_PATH`, sinon `codex/.local` |
| `GUARDIAN_DB` | Chemin complet du fichier de base (prioritaire sur le dossier) | `<dossier>/pilot.sqlite` |
| `GUARDIAN_HOST` | Adresse d'écoute | `0.0.0.0` avec le proxy, `127.0.0.1` sinon |
| `GUARDIAN_SEED_DEMO` | `0` pour ne pas remplir la démo au premier démarrage | rempli |
| `GUARDIAN_LIVE_TELEMETRY` | `0` pour couper le rafraîchissement automatique des mesures simulées | actif |
| `GUARDIAN_DEMO_*_PASSWORD` | Mots de passe des comptes de démo | voir `codex/README.md` |
| `ANTHROPIC_API_KEY` | Clé API Anthropic : Guardian reformule ses réponses avec Claude (appel HTTP direct, sans dépendance npm) | aucune (règles seules) |
| `ANTHROPIC_MODEL` | Modèle utilisé | `claude-opus-5-5` |
| `GUARDIAN_AI` | `0` pour couper Claude même si la clé est présente | actif si clé |
| `GUARDIAN_AI_TIMEOUT_MS` | Délai maximal d'attente de Claude avant la réponse habituelle | `8000` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Vrais WhatsApp par le bac à sable Twilio (`whatsapp.cjs`) | aucun (messages affichés seulement) |
| `TWILIO_WHATSAPP_FROM` | Numéro d'envoi Twilio | `whatsapp:+14155238886` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_API_VERSION` | Vrais WhatsApp par l'API WhatsApp Cloud de Meta (si Twilio n'est pas réglé) | aucun, `v23.0` |
| `WHATSAPP_NUMEROS` | Destinataires : `commune, quartier ou code=numéro`, `equipe=numéro`, `technicien=numéro`, séparés par des virgules | aucun |
| `GUARDIAN_ANDROID_PACKAGE` | Nom du paquet de l'application Android, publié dans `/.well-known/assetlinks.json` | aucun |
| `GUARDIAN_ANDROID_SHA256` | Empreinte(s) SHA-256 de la clé de signature Android, séparées par des virgules | aucune |
| `GUARDIAN_TLS_KEY`, `GUARDIAN_TLS_CERT` | HTTPS géré par l'application elle-même (sans proxy) | aucun |

Essai local avec les réglages de l'image, sans Docker (macOS ou Linux) : `PORT=3000 GUARDIAN_DATA_DIR=/tmp/guardian node codex/serveur-local.cjs`, puis ouvrez http://127.0.0.1:3000/.
