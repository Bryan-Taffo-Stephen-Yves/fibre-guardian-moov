# FIBRE GUARDIAN — Spécification technique

> Concours MOOV APPLICATION 2026 (Moov Africa CI x IUGB) — dépôt au plus tard le 31 octobre 2026.
> Thèmes couverts : self-care et diagnostic intelligent de ligne fibre (thème 3) + score de rétention (thème 6) + extensions : gestion de pannes de zone, dispatch technicien, upsell IA.
> Ce document est destiné à être donné tel quel à Claude Code / Codex. Il décrit le "quoi" et le "comment". Chaque section "Tâches agent" est un prompt exécutable.

---

## 0. Instructions pour les agents de code (à lire en premier)

- Langue de l'UI : français (Côte d'Ivoire). Code, noms de tables et de fonctions : anglais. Commentaires : français ou anglais, mais cohérents.
- Stack imposée : voir section 3. Ne pas la changer sans raison écrite.
- Design : mode sombre par défaut, sobre, aucune emoji décorative dans l'UI, icônes vectorielles uniquement (lucide). Couleur d'accent alignée sur l'identité Moov (bleu/orange à confirmer avec la charte).
- Toute intégration externe (routeur/ACS, SMS, paiement, GPS) passe par une interface "adapter" avec une implémentation `mock` (démo) et une implémentation `real` (production). Le mode démo doit fonctionner sans aucun service externe.
- Sécurité : Row Level Security (RLS) activée sur toutes les tables. Aucune clé secrète côté client. Secrets uniquement dans les variables d'environnement des Edge Functions.
- Chaque fonctionnalité livrée doit avoir : un écran, une route/Edge Function, une table ou migration, et un scénario de démo reproductible via le simulateur (section 9).
- Ne jamais redémarrer une box ou limiter un appareil sans règle de sécurité vérifiée (section 7.4).

---

## 1. Vision

Fibre Guardian est l'application qui transforme la fibre Move en service que l'on pilote soi-même, avec une IA qui voit, explique et résout.

Trois idées fortes :

1. **Diagnostic et pilotage par l'IA côté abonné** : lenteur, saturation, gros téléchargement, priorisation d'appareils, sans compétence technique.
2. **Détection et gestion des pannes côté opérateur** : l'IA surveille le réseau, détecte avant l'appel client, déclenche l'intervention, notifie la zone, suit le technicien, vérifie la remise en service.
3. **IA commerciale honnête** : quand l'offre de l'abonné ne correspond pas à son usage réel, l'IA le prouve avec des mesures et propose le forfait adapté, avec paiement du seul complément.

Public : abonnés fibre Move (peu techniques), agents du support Move, techniciens terrain, superviseurs réseau.

---

## 2. Acteurs et applications

| Acteur | Surface | Rôle |
|---|---|---|
| Abonné | App mobile | Diagnostic, signalement, suivi technicien, upgrade |
| Agent support Move | Dashboard web | Voir les clients, tickets, l'assistant IA qui prépare les réponses |
| Technicien terrain | App mobile (mode technicien) | Missions, navigation vers le poteau, checklist, assistance à distance |
| Superviseur réseau | Dashboard web | Carte des pannes, prédictions, dispatch, KPI |
| IA (agent) | Edge Functions | Diagnostic, détection, recommandations, rédaction de messages |

Une seule base de code mobile (Expo) avec deux modes (abonné / technicien) selon le rôle. Un dashboard web séparé (agents + superviseurs).

---

## 3. Architecture et stack

- **Mobile** : Expo (React Native) + TypeScript, Expo Router, React Query, Zustand. Notifications : Expo Notifications (push).
- **Web dashboard** : Next.js + TypeScript + Tailwind + shadcn/ui, carte avec MapLibre ou Mapbox.
- **Backend** : Supabase
  - Postgres + extension PostGIS (zones, poteaux, positions)
  - Auth (OTP téléphone) + RLS
  - Realtime (positions technicien, statuts d'incident, alertes)
  - Storage (photos de box, photos de poteaux)
  - Edge Functions (Deno/TypeScript) pour toute la logique serveur
  - pg_cron pour les tâches planifiées (détection, relances, scoring)
- **IA** : API Claude (vision pour lire la photo de la box ou du poteau, tool use pour exécuter des actions encadrées). Modèle recommandé : Sonnet pour le temps réel, Haiku pour les classifications à gros volume.
- **Gestion des box** : couche `DeviceAdapter` (section 7). Production : ACS TR-069/TR-369 (ex. GenieACS en démo avancée). Démo : simulateur.
- **SMS** : couche `SmsAdapter` (Africa's Talking, Twilio ou passerelle Moov). Démo : journal en base.
- **Paiement** : couche `PaymentAdapter` (Moov Money, Wave, Orange Money, via un agrégateur comme CinetPay ou FedaPay). Démo : page de paiement simulée.
- **GPS technicien** : géolocalisation de l'app technicien envoyée toutes les 5 à 10 s vers Realtime. ETA calculé via API d'itinéraire (Mapbox Directions / OSRM).

```
[App abonné] ──┐
[App technicien]──┼─> Supabase (Auth, RLS, Postgres+PostGIS, Realtime, Storage)
[Dashboard web]──┘            │
                              ├─> Edge Functions ──> Claude API (diagnostic, vision, tools)
                              │                  ──> DeviceAdapter (ACS réel | simulateur)
                              │                  ──> SmsAdapter / PaymentAdapter / RouteAdapter
                              └─> pg_cron (détection d'anomalies, relances, scoring)
```

---

## 4. Modules fonctionnels

### M1. Onboarding et rattachement de la ligne

Deux méthodes :
- **Photo de la box** : l'IA (vision) lit l'étiquette (numéro de série, MAC, SSID) et rattache la ligne.
- **Nom de l'abonné + numéro** : recherche dans la base abonnés, validation par OTP SMS envoyé au numéro titulaire.

Règle : une ligne est rattachée seulement après validation OTP du titulaire ou d'un utilisateur autorisé par le titulaire (rôle `member`).

### M2. Tableau de bord abonné

- État de la ligne (OK / dégradée / panne), débit mesuré vs débit souscrit
- Liste des appareils connectés avec consommation en temps réel
- Historique 7 jours : débit, latence, incidents
- Bouton "Quelque chose ne va pas" (lance le diagnostic IA)

### M3. Diagnostic IA de lenteur (côté abonné)

Flux :
1. L'abonné signale une lenteur (ou l'IA la détecte).
2. L'Edge Function `ai-diagnose` récupère via `DeviceAdapter` : débit WAN, latence, perte de paquets, liste des clients, trafic par client, qualité Wi-Fi (canal, signal), uptime.
3. L'IA classe la cause : saturation interne (un appareil consomme trop), Wi-Fi (canal/portée), box (surcharge/uptime), ligne (signal optique dégradé), panne de zone (voir M5), offre sous-dimensionnée.
4. L'IA répond en langage simple, avec 1 à 3 actions proposées. Aucune action n'est exécutée sans confirmation de l'abonné (sauf règles automatiques activées par lui).

### M4. Mode "Priorité" (gaming, gros téléchargement, meeting)

- L'abonné dit : "Je télécharge un jeu de 80 Go sur ma PS5".
- L'IA calcule le temps estimé au débit actuel et au débit prioritaire.
- Elle propose de limiter certains appareils (QoS par appareil) pendant une durée définie.
- Les limites sont **temporaires** (expiration obligatoire) et annulables d'un bouton.
- Si la limitation ne suffit pas : proposition d'upgrade (M7) avec temps gagné chiffré.

### M5. Pannes de zone : signalement, détection, résolution

**Signalement abonné**
- Photo du poteau ou du coffret + zone (GPS auto, ajustable) + description facultative.
- L'IA (vision) vérifie la pertinence (poteau cassé, câble tombé, coffret ouvert) et déduplique avec les incidents existants de la zone.
- Un incident est créé ou un signalement est rattaché à l'incident existant (compteur de signalements = signal de gravité).

**Détection proactive (IA de supervision)**
- Tâche pg_cron toutes les 1 à 2 minutes : agrégation par zone des métriques (taux de box hors ligne, chute de débit médian, hausse de latence, perte optique).
- Si l'écart dépasse un seuil par rapport à la ligne de base de la zone (statistique simple en V1 : z-score ou médiane glissante), création d'un incident `suspected`.
- Un incident `suspected` devient `confirmed` si : signalements abonnés >= N, ou validation du superviseur, ou corrélation avec événement connu (coupure électrique).
- L'IA propose les causes probables et les mesures à prendre (checklist).

**Prédiction (V2)**
- Modèle de détection d'anomalies sur séries temporelles (dégradation lente de puissance optique, redémarrages répétés) pour afficher "risque de panne" par zone sur le dashboard.

**Cycle de vie d'un incident**

```
suspected -> confirmed -> dispatched -> technician_en_route -> on_site -> repaired -> verifying -> resolved
                                   └────────────────────────────────────────────────> cancelled / false_alarm
```

### M6. Dispatch et suivi du technicien (type Yango)

- Le superviseur (ou l'IA en suggestion, validée par le superviseur) assigne l'incident à une équipe. Critères : proximité, disponibilité, compétence.
- App technicien : liste des missions, adresse précise du poteau (coordonnées + identifiant du poteau + photo de référence), bouton d'itinéraire, statuts (en route, sur place, terminé).
- Côté abonnés de la zone : écran de suivi avec position de l'équipe, ETA, bouton d'appel masqué (appel via numéro intermédiaire) vers le technicien.
- **Assistance à distance** : un expert Move voit la mission, les photos, peut envoyer des instructions pas à pas dans l'app technicien (chat + checklist + photo annotée). Appel audio/vidéo en V2.
- Option de confidentialité : la position du technicien n'est partagée aux abonnés que pendant la phase `technician_en_route`, avec précision réduite (arrondie) si la politique de Move l'exige. À valider avec Move.

### M7. IA commerciale : upgrade ciblé

- Déclencheurs : lenteurs récurrentes liées à l'usage (streaming 4K, gaming, télétravail, nombre d'appareils), débit souscrit saturé de façon répétée, demande explicite de l'abonné.
- L'IA présente : usage mesuré, ce que le forfait actuel permet, ce que le forfait suivant permet, gain concret (temps de téléchargement, qualité streaming).
- Calcul : paiement du **complément** entre forfaits (ex. 25 000 -> 35 000 FCFA : 10 000 FCFA), proratisé selon la politique de Move.
- Génération d'un lien de paiement (mobile money), retour dans l'app, activation du nouveau forfait via le SI de Move (adapter), confirmation par notification.
- Garde-fous : l'IA ne propose un upgrade que si les mesures le justifient, jamais plus d'une fois par période (limite de fréquence), toujours avec bouton "Non merci" qui mémorise le refus.
- Option "boost temporaire" (24 h / 7 jours) en alternative à l'upgrade permanent. À valider avec Move.

### M8. Notifications de zone

- Cible : uniquement les abonnés de la zone concernée (géofiltrage par `zone_id`).
- Événements et messages types :
  - Incident confirmé : "Panne détectée dans votre zone (Yopougon Niangon). Nous enquêtons."
  - Technicien assigné : "Une équipe est en route. Arrivée estimée : 25 min."
  - Réparation terminée, vérification en cours.
  - Incident résolu : durée totale, retour progressif du débit.
- Canaux : push (prioritaire), SMS (repli et pour abonnés sans app). Dédoublonnage et limite de fréquence par abonné et par incident.
- Le texte est généré par l'IA à partir d'un gabarit validé (pas de génération libre non contrôlée en envoi de masse : gabarits + variables, relecture automatique des chiffres).

### M9. Remise en service intelligente (redémarrage orchestré)

Après réparation :
1. Vérification : l'IA/le superviseur confirme le retour du signal optique et de la connectivité de la zone.
2. Message préalable aux abonnés : "Votre box va redémarrer dans quelques minutes."
3. Pour chaque box de la zone, **contrôle d'activité avant redémarrage** : si trafic actif (téléchargement en cours, appel/visio détecté, débit supérieur à un seuil), le redémarrage est reporté ou remplacé par une resynchronisation douce.
4. Redémarrage par lots (pas toutes les box en même temps) pour éviter la surcharge des serveurs d'authentification.
5. Si redémarrage nécessaire mais abonné actif : notification "Redémarrage proposé, voulez-vous le faire maintenant ?" avec report possible.
6. Clôture : incident `resolved`, rapport automatique (durée, abonnés impactés, cause, actions).

### M10. Score de rétention (thème 6)

- Score par abonné (0 à 100) : fréquence d'incidents, lenteurs vécues, tickets ouverts, ancienneté, usage vs offre, satisfaction post-incident.
- Dashboard agent : clients à risque, action recommandée (appel proactif, geste commercial, upgrade).
- V1 : score par règles pondérées (transparent, explicable). V2 : modèle appris sur historique.

### M11. Assistant IA pour les agents Move

- Fiche client enrichie : état de la ligne, historique, incidents de la zone.
- Brouillon de réponse au client, diagnostic pré-rempli, actions suggérées (envoyer un technicien, geste commercial).
- L'agent valide avant exécution.

---

## 5. Modèle de données (Postgres + PostGIS)

```sql
create extension if not exists postgis;

create type user_role as enum ('subscriber','member','technician','agent','supervisor','admin');
create type incident_status as enum ('suspected','confirmed','dispatched','technician_en_route','on_site','repaired','verifying','resolved','cancelled','false_alarm');
create type device_action_type as enum ('qos_limit','qos_priority','reboot','resync','wifi_channel_change');
create type action_status as enum ('proposed','confirmed','executing','done','failed','expired','reverted');

create table zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- ex: 'Yopougon Niangon'
  city text not null default 'Abidjan',
  geom geography(MultiPolygon, 4326),
  created_at timestamptz default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'subscriber',
  full_name text,
  phone text unique,
  push_token text,
  created_at timestamptz default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  holder_name text not null,
  holder_phone text not null,
  zone_id uuid references zones(id),
  address_text text,
  location geography(Point,4326),
  plan_id uuid,
  box_serial text unique,
  box_mac text,
  status text default 'active',
  created_at timestamptz default now()
);

create table subscription_members (
  subscription_id uuid references subscriptions(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  member_role text default 'owner',  -- owner | member
  primary key (subscription_id, user_id)
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  down_mbps int not null,
  up_mbps int not null,
  price_xof int not null,
  rank int not null                  -- pour calculer le complément
);

create table devices (                -- appareils connectés derrière la box
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id) on delete cascade,
  mac text not null,
  label text,                         -- 'PS5 salon', 'iPhone de Awa'
  type text,                          -- console | phone | tv | pc | iot | unknown
  last_seen timestamptz,
  unique (subscription_id, mac)
);

create table line_metrics (           -- séries temporelles par box (partitionner par mois si volume)
  id bigint generated always as identity primary key,
  subscription_id uuid references subscriptions(id) on delete cascade,
  zone_id uuid references zones(id),
  ts timestamptz not null default now(),
  down_mbps numeric, up_mbps numeric,
  latency_ms numeric, loss_pct numeric,
  optical_rx_dbm numeric,
  wifi_clients int, uptime_s bigint,
  online boolean default true
);
create index on line_metrics (zone_id, ts desc);
create index on line_metrics (subscription_id, ts desc);

create table device_traffic (
  id bigint generated always as identity primary key,
  device_id uuid references devices(id) on delete cascade,
  ts timestamptz default now(),
  down_mbps numeric, up_mbps numeric
);

create table device_actions (         -- toute action sur une box passe ici (audit)
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id),
  device_id uuid references devices(id),
  type device_action_type not null,
  params jsonb,                       -- ex: {"limit_mbps": 5}
  status action_status default 'proposed',
  proposed_by text,                   -- 'ai' | 'user' | 'agent' | 'system'
  confirmed_by uuid references profiles(id),
  expires_at timestamptz,             -- obligatoire pour qos_limit
  created_at timestamptz default now(),
  executed_at timestamptz,
  result jsonb
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid references zones(id) not null,
  status incident_status default 'suspected',
  source text,                        -- 'ai_detection' | 'user_report' | 'supervisor'
  severity int default 1,             -- 1..5
  cause_hypothesis text,
  location geography(Point,4326),
  pole_ref text,                      -- identifiant du poteau/coffret
  affected_count int default 0,
  report_count int default 0,
  eta_resolution timestamptz,
  created_at timestamptz default now(),
  confirmed_at timestamptz, resolved_at timestamptz
);

create table incident_reports (       -- signalements abonnés
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id),
  user_id uuid references profiles(id),
  subscription_id uuid references subscriptions(id),
  photo_path text,
  location geography(Point,4326),
  description text,
  ai_analysis jsonb,                  -- sortie vision : type de dommage, confiance
  created_at timestamptz default now()
);

create table technicians (
  id uuid primary key references profiles(id),
  team_name text,
  skills text[],
  available boolean default true,
  current_location geography(Point,4326),
  location_updated_at timestamptz
);

create table dispatches (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references incidents(id) not null,
  technician_id uuid references technicians(id),
  status text default 'assigned',     -- assigned | en_route | on_site | done
  eta timestamptz,
  checklist jsonb,
  remote_expert_id uuid references profiles(id),
  assigned_at timestamptz default now(),
  arrived_at timestamptz, completed_at timestamptz
);

create table dispatch_events (        -- fil d'instructions et chat expert <-> technicien
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid references dispatches(id) on delete cascade,
  author_id uuid references profiles(id),
  kind text,                          -- message | instruction | photo | status
  body text, media_path text,
  created_at timestamptz default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  subscription_id uuid references subscriptions(id),
  incident_id uuid references incidents(id),
  channel text,                       -- push | sms
  template text, payload jsonb,
  status text default 'queued',       -- queued | sent | failed
  sent_at timestamptz,
  unique (user_id, incident_id, template)  -- dédoublonnage
);

create table upgrade_offers (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id),
  from_plan uuid references plans(id),
  to_plan uuid references plans(id),
  amount_xof int not null,            -- complément à payer
  reason jsonb,                       -- mesures qui justifient l'offre
  status text default 'proposed',     -- proposed | declined | pending_payment | paid | activated | expired
  payment_ref text, payment_url text,
  created_at timestamptz default now(),
  decided_at timestamptz
);

create table retention_scores (
  subscription_id uuid references subscriptions(id) primary key,
  score int, factors jsonb, computed_at timestamptz default now()
);

create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references subscriptions(id),
  user_id uuid references profiles(id),
  messages jsonb default '[]',
  created_at timestamptz default now()
);
```

**RLS (principes)**
- Abonné/membre : lecture de ses propres `subscriptions`, `devices`, `line_metrics`, `device_actions`, `upgrade_offers`.
- Incidents : lecture publique restreinte aux abonnés de la même `zone_id` (vue `incidents_public` sans données internes).
- Technicien : lecture/écriture sur ses `dispatches` et leur `dispatch_events`.
- Agent/superviseur : lecture étendue, écriture contrôlée. Toute écriture sensible passe par Edge Function avec le service role, jamais depuis le client.

---

## 6. Edge Functions

| Fonction | Rôle |
|---|---|
| `link-subscription` | Rattachement par photo (vision) ou nom+numéro, envoi/validation OTP |
| `ai-diagnose` | Diagnostic de lenteur : collecte métriques via adapter, appel Claude avec tools, retour explication + actions proposées |
| `ai-chat` | Conversation abonné avec l'IA (diagnostic, questions, priorité, upgrade), contexte = ligne + historique |
| `device-action` | Exécute une action validée (QoS, reboot, resync) via adapter, vérifie les règles de sécurité, journalise |
| `device-action-expire` | (cron) Annule les limitations expirées |
| `ingest-metrics` | Reçoit/poll les métriques des box (ou du simulateur) vers `line_metrics` |
| `detect-anomalies` | (cron 1-2 min) Détection par zone, création/mise à jour d'incidents `suspected` |
| `report-incident` | Reçoit photo + position, analyse vision, déduplique, crée ou rattache un signalement |
| `incident-transition` | Machine d'états des incidents, effets de bord (notifications, ETA) |
| `suggest-dispatch` | Propose l'équipe optimale (proximité, dispo, compétence) |
| `dispatch-update` | Mises à jour technicien (statut, position, checklist), calcul ETA |
| `notify-zone` | Génère et envoie les notifications de zone depuis gabarits, dédoublonnées et limitées |
| `orchestrate-restart` | Remise en service par lots avec contrôle d'activité (M9) |
| `compute-upgrade-offer` | Analyse l'usage, décide s'il y a une offre, calcule le complément |
| `create-payment` / `payment-webhook` | Lien de paiement mobile money, réception du webhook, activation du forfait |
| `compute-retention` | (cron nocturne) Calcul des scores |
| `agent-assist` | Brouillons et suggestions pour les agents Move |

**Outils (tools) exposés à l'IA via tool use** — l'IA ne touche jamais directement aux box, elle appelle des outils encadrés :
- `get_line_status(subscription_id)`
- `get_connected_devices(subscription_id)`
- `get_zone_status(zone_id)`
- `estimate_download_time(size_gb, mbps)`
- `propose_device_limit(device_id, limit_mbps, duration_min)` : crée une action `proposed`, ne l'exécute pas
- `compute_upgrade(subscription_id)`
- `open_incident(...)`

---

## 7. Intégration réseau (le point critique)

### 7.1 Réalité technique
Une IA ne se connecte pas "au panneau admin" de la box en mode navigateur. Chez un opérateur, la gestion se fait par **TR-069 (CWMP)** ou **TR-369 (USP)** via un serveur **ACS**. Moov dispose (ou aura) d'un ACS qui parle déjà aux box. Fibre Guardian doit s'y brancher, pas contourner.

### 7.2 Couche `DeviceAdapter`

```ts
interface DeviceAdapter {
  getLineStatus(box: BoxRef): Promise<LineStatus>;
  getConnectedDevices(box: BoxRef): Promise<ConnectedDevice[]>;
  getTrafficByDevice(box: BoxRef): Promise<DeviceTraffic[]>;
  setDeviceRateLimit(box: BoxRef, mac: string, mbps: number): Promise<void>;
  clearDeviceRateLimit(box: BoxRef, mac: string): Promise<void>;
  rebootBox(box: BoxRef): Promise<void>;
  getZoneMetrics(zoneId: string): Promise<ZoneMetrics>;
}
```

- `SimulatorAdapter` : génère des box, appareils, trafic, pannes injectables (démo, tests).
- `AcsAdapter` (GenieACS ou API Moov) : implémentation réelle. À spécifier avec l'équipe réseau de Moov.
- Mode hybride pour le concours : démo sur simulateur + 1 box réelle de test si Moov en fournit une.

### 7.3 Fonctions "difficiles" et approche
- **Limitation par appareil** : QoS/SQM sur la box (si supporté par le firmware) via TR-069. Sinon : limite côté OLT/BNG par Moov. Prévoir un mode "conseil" (l'app guide l'abonné) si l'action automatique n'est pas supportée.
- **Mesure de débit réel** : combiner (a) compteurs d'interface de la box, (b) test actif léger depuis l'app (speedtest vers un serveur Moov), pas de test lourd en continu.
- **Détection de panne de zone** : agrégation des box qui ne répondent plus à l'ACS + alarmes OLT (si accessibles).

### 7.4 Règles de sécurité des actions automatiques (obligatoires)
1. Aucune limitation sans confirmation de l'abonné, avec durée d'expiration (défaut 2 h, max 24 h).
2. Aucune limite ne peut descendre sous un plancher (ex. 2 Mbps) ni toucher l'appareil "protégé" (ex. visioconférence active).
3. Aucun redémarrage si trafic actif ou appel détecté, sauf consentement explicite.
4. Redémarrages par lots (taille et pause configurables).
5. Toute action est journalisée dans `device_actions` (qui, quoi, quand, résultat) et annulable.
6. Kill switch global côté superviseur pour désactiver les actions automatiques.

---

## 8. IA : conception des prompts

**Prompt système — assistant abonné (extrait)**
- Rôle : assistant de Move pour la fibre, ton simple, phrases courtes, français ivoirien courant, jamais de jargon sans explication.
- Règles : n'inventer aucun chiffre, utiliser uniquement les outils. Toute action sur la box = proposition à confirmer. Ne proposer un upgrade que si `compute_upgrade` le justifie. Si une panne de zone est en cours, le dire avant tout autre diagnostic.
- Sortie structurée (JSON) pour l'UI : `{message, causes[], actions[{id,label,requires_confirmation}], upgrade_offer?}`.

**Prompt vision (photo box / poteau)** : extraire serial, MAC, SSID ; ou type de dommage, gravité estimée, visibilité d'un identifiant de poteau ; renvoyer un niveau de confiance. En dessous d'un seuil, demander une nouvelle photo.

**Prompt supervision** : à partir des métriques agrégées d'une zone, produire hypothèses ordonnées, mesures recommandées, et brouillon de message. Les messages envoyés en masse utilisent des gabarits validés (section M8).

**Évaluation** : constituer un jeu de 30 à 50 scénarios (lenteur interne, panne de zone, Wi-Fi saturé, demande d'upgrade légitime, demande où l'upgrade n'est PAS justifié) et vérifier automatiquement les sorties avant chaque livraison.

---

## 9. Simulateur et scénarios de démo (indispensable pour le jury)

Le simulateur doit permettre de jouer en direct :

1. **Lenteur interne** : une PS5 télécharge, la TV streame en 4K, le téléphone rame. L'IA identifie, propose de limiter la TV, le débit de la PS5 monte, temps estimé affiché.
2. **Forfait insuffisant** : même scénario avec forfait 25 000. L'IA montre le gain avec 35 000, génère le lien de paiement du complément (10 000), paiement simulé, forfait activé.
3. **Panne de zone** : bouton "Casser un poteau à Yopougon" dans le simulateur. Chute de débit sur 200 box, détection IA, incident `suspected` puis `confirmed`, notification à la zone.
4. **Dispatch** : le superviseur assigne une équipe, la voiture du technicien se déplace sur la carte, ETA mis à jour chez les abonnés.
5. **Assistance à distance** : l'expert envoie 3 instructions dans l'app technicien, le technicien coche la checklist.
6. **Remise en service** : l'IA annonce le redémarrage, reporte les box actives (téléchargement, meeting), redémarre les autres par lots, incident résolu avec rapport.
7. **Score de rétention** : vue agent des clients à risque après l'incident.

Chaque scénario doit être rejouable par un script (`pnpm demo:scenario <n>`).

---

## 10. Plan de livraison jusqu'au 31 octobre 2026

| Période | Objectif | Livrables |
|---|---|---|
| 9 -> 14 oct | Fondations | Repo, Supabase, migrations, auth OTP, rôles/RLS, simulateur V0, adapters |
| 15 -> 21 oct | Cœur abonné | M1, M2, M3, M4 (diagnostic + priorité) avec IA et outils |
| 22 -> 27 oct | Pannes et terrain | M5, M6, M8, M9 (incident -> dispatch -> notification -> remise en service), dashboard web carte |
| 28 -> 30 oct | Valeur commerciale + finition | M7 (upgrade + paiement simulé), M10 (score), polish UI, scénarios de démo, dossier |
| 31 oct | Dépôt | Dossier, vidéo démo, APK/lien de test |

**Priorités si le temps manque (ordre de coupe)** : couper d'abord M11, puis la prédiction de M5 (garder la détection par seuil), puis l'appel vidéo de M6. Ne jamais couper : M3, M4, M5 (détection + notification), M6 (suivi technicien), M7 (upgrade).

---

## 11. Critères d'acceptation (extraits)

- Un abonné rattache sa ligne en moins de 60 secondes, par photo ou par nom+OTP.
- Le diagnostic IA renvoie une cause et au moins une action en moins de 8 secondes sur le simulateur.
- Une limitation d'appareil expire automatiquement et se révoque d'un bouton.
- Une panne simulée sur une zone crée un incident et notifie uniquement les abonnés de cette zone.
- La position du technicien se met à jour chez l'abonné au moins toutes les 10 secondes.
- Le redémarrage orchestré ne touche aucune box dont le trafic dépasse le seuil d'activité.
- Un upgrade n'est proposé que si les mesures le justifient, et le montant affiché est exactement le complément entre forfaits.
- Aucun accès croisé entre abonnés (tests RLS automatisés).

---

## 12. Suggestions d'amélioration (au-delà de la demande)

1. **Mode "Santé de la maison"** : score Wi-Fi par pièce, conseil de placement de la box ou de répéteur.
2. **Contrôle parental simple** : plages horaires par appareil, utile pour les familles.
3. **Compensation automatique** : après une panne longue, l'IA propose un geste (jours offerts, bonus data) calculé selon la durée, validé par règles Move.
4. **Mode hors-ligne côté technicien** : file de synchronisation (les zones de panne ont souvent une mauvaise couverture).
5. **Voisinage solidaire** : un abonné peut confirmer "moi aussi" sur un incident en un tap, ce qui renforce le signal sans nouvelle photo.
6. **Fenêtres de maintenance programmée** : annonce proactive des coupures planifiées par zone.
7. **Tableau de bord impact pour Move** : minutes de panne évitées, appels support évités, revenus d'upgrade, baisse de churn. C'est l'argument central du dossier.
8. **Langues** : français d'abord, prévoir une couche i18n (dioula/baoulé en messages audio simples en V2).

---

## 13. Points à valider avec Moov / questions ouvertes

1. Accès réel à l'ACS ou à une API de gestion des box ? Quel modèle de box et quel firmware ?
2. La limitation par appareil est-elle supportée par la box ou doit-elle passer par le réseau ?
3. Politique de partage de position des techniciens aux abonnés (vie privée du personnel).
4. Politique tarifaire : complément proratisé, boost temporaire, conditions de changement de forfait.
5. Passerelle SMS et agrégateur de paiement imposés par Moov ?
6. Données personnelles : hébergement, durée de conservation, conformité à la loi ivoirienne sur la protection des données (ARTCI).

---

## 14. Tâches agent (prompts prêts à l'emploi)

**T1 — Fondations**
"Initialise un monorepo (apps/mobile Expo, apps/web Next.js, packages/shared, supabase/). Crée les migrations SQL de la section 5, les policies RLS décrites, les types TypeScript générés, et le seed de données : 6 zones d'Abidjan, 5 forfaits, 300 abonnés fictifs. Ajoute les tests RLS."

**T2 — Simulateur et adapters**
"Implémente l'interface DeviceAdapter de la section 7.2 et un SimulatorAdapter : box virtuelles, appareils avec trafic dynamique, injection de pannes par zone, CLI `pnpm demo:scenario <n>` pour les scénarios de la section 9."

**T3 — Diagnostic IA**
"Implémente `ai-diagnose` et `ai-chat` (Edge Functions) avec tool use Claude selon la section 6 et 8. Sortie JSON structurée, aucune action exécutée sans confirmation, tests d'évaluation sur 30 scénarios."

**T4 — Pannes et dispatch**
"Implémente `report-incident`, `detect-anomalies`, `incident-transition`, `suggest-dispatch`, `dispatch-update`, `notify-zone` et le mode technicien de l'app mobile avec carte, ETA et suivi Realtime. Respecte la machine d'états de M5."

**T5 — Remise en service et sécurité**
"Implémente `orchestrate-restart` et les règles de la section 7.4, y compris le kill switch superviseur et l'audit dans `device_actions`."

**T6 — Upgrade et paiement**
"Implémente `compute-upgrade-offer`, `create-payment`, `payment-webhook` avec PaymentAdapter (mock + interface réelle), en respectant les garde-fous de M7."

**T7 — Dashboard web**
"Construis le dashboard Next.js : carte des incidents par zone, file de dispatch, fiche client enrichie, score de rétention, KPI d'impact (section 12.7). Mode sombre, sans emoji."

**T8 — Finition démo**
"Écris les scripts des 7 scénarios de la section 9, vérifie leur reproductibilité, prépare un build de démonstration et un jeu de captures."
