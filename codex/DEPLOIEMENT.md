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

Les autres réglages sont déjà dans l'image : `GUARDIAN_PROXY=1` (Railway s'occupe du HTTPS), le port, et le dossier `/data`.

Cliquez ensuite sur **Deploy** (ou **Redeploy**) pour relancer avec ces réglages.

## Étape 6 : vérifier

1. Ouvrez `https://votre-adresse/api/health` : la page doit afficher `"ok":true`.
2. Ouvrez `https://votre-adresse/` : l'écran d'accueil de Fibre Guardian apparaît.
3. Connectez-vous avec « Compte existant » : `awa.kone@demo.fibre-guardian.ci`. Vous devez voir la carte « Une coupure a été réparée » de son quartier.
4. Côté Moov, ouvrez `https://votre-adresse/codex/?portal=moov&section=operations` et connectez-vous avec `direction@demo.fibre-guardian.ci` et le mot de passe de l'étape 5. L'incident COC-03 attend votre validation.

Au premier démarrage, la démo se remplit toute seule. Elle n'est pas recréée aux démarrages suivants, puisque le volume garde la base.

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
| `GUARDIAN_TLS_KEY`, `GUARDIAN_TLS_CERT` | HTTPS géré par l'application elle-même (sans proxy) | aucun |

Essai local avec les réglages de l'image, sans Docker (macOS ou Linux) : `PORT=3000 GUARDIAN_DATA_DIR=/tmp/guardian node codex/serveur-local.cjs`, puis ouvrez http://127.0.0.1:3000/.
