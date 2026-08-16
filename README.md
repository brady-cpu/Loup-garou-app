# Loup-Garou Hybride — Squelette fonctionnel

Ceci est un **prototype fonctionnel**, pas encore le design final : les écrans sont volontairement bruts, l'objectif est de valider que toutes les règles marchent (nuit, vote, pouvoirs, Maire, chats...). Une fois que tu es content du fonctionnement, tu donnes ce projet + la maquette visuelle qu'on a faite avant à l'autre IA pour qu'elle l'habille.

## Ce que contient le projet

```
loup-garou-app/
  server/         → le "cerveau" du jeu (Node.js + Socket.io)
    server.js
    game.js
    package.json
  public/         → ce que les joueurs et le MJ voient dans leur navigateur
    index.html
    joueur.html / joueur.js
    mj.html / mj.js
    style.css
    manifest.json
  README.md       → ce fichier
```

## Étape 1 — Installer Node.js (une seule fois)

1. Va sur https://nodejs.org
2. Télécharge la version "LTS" (recommandée) pour ton système (Windows / Mac).
3. Installe-la comme n'importe quel logiciel (clique sur "Suivant" jusqu'au bout).
4. Pour vérifier que ça a marché : ouvre le **Terminal** (Mac : appli "Terminal" — Windows : appli "Invite de commandes" ou "PowerShell") et tape :
   ```
   node -v
   ```
   Si un numéro de version s'affiche (ex: `v20.11.0`), c'est bon.

## Étape 2 — Installer les dépendances du projet

1. Ouvre le Terminal.
2. Déplace-toi dans le dossier `server` du projet. Exemple si le projet est sur ton Bureau :
   ```
   cd Desktop/loup-garou-app/server
   ```
   (Astuce : tape `cd ` avec l'espace, puis glisse-dépose le dossier `server` dans le Terminal, ça remplit le chemin automatiquement.)
3. Tape :
   ```
   npm install
   ```
   Ça télécharge les briques nécessaires (Express, Socket.io). Ça prend quelques secondes à 1-2 minutes.

## Étape 3 — Lancer le serveur

Toujours dans le dossier `server`, tape :
```
npm start
```

Tu dois voir apparaître :
```
Serveur Loup-Garou lancé sur http://localhost:3000
```

Le serveur tourne maintenant sur ton ordinateur. Laisse ce Terminal ouvert pendant toute la soirée — si tu le fermes, le jeu s'arrête.

## Étape 4 — Trouver l'adresse à partager aux joueurs

Pour que les téléphones des joueurs se connectent, ils doivent être **sur le même Wi-Fi que ton ordinateur**, et utiliser ton adresse IP locale (pas "localhost", qui ne fonctionne que sur ton propre ordinateur).

**Sur Mac** : Réglages → Wi-Fi → clique sur le réseau connecté → une adresse type `192.168.1.XX` s'affiche.
**Sur Windows** : ouvre l'Invite de commandes et tape `ipconfig`, cherche "Adresse IPv4" (type `192.168.1.XX`).

L'adresse à partager est donc :
```
http://192.168.1.XX:3000
```
(remplace `192.168.1.XX` par ce que tu as trouvé).

- Le **MJ** ouvre `http://192.168.1.XX:3000/mj.html`
- Les **joueurs** ouvrent `http://192.168.1.XX:3000/joueur.html`

Tu peux générer un QR Code qui pointe vers cette adresse `.../joueur.html` avec n'importe quel générateur de QR Code gratuit en ligne (tape "générateur QR code" sur Google, colle l'adresse).

## Étape 5 — Jouer

1. Le MJ ouvre sa page, clique sur "Créer une nouvelle partie" → un code à 6 caractères s'affiche.
2. Les joueurs scannent le QR Code (ou ouvrent l'adresse), entrent le code de la partie, leur prénom, et sélectionnent la carte physique que le MJ leur a distribuée.
3. Le MJ clique sur "Lancer la partie" → chacun reçoit son pouvoir bonus numérique en privé.
4. Le MJ enchaîne les boutons : Nuit → (les rôles font leurs actions sur leur téléphone) → Jour → Débat → Vote.

## Limites connues de ce prototype (normal à ce stade)

- Le style visuel est volontairement basique — il sera repris par ailleurs.
- Si le serveur redémarre (crash, coupure), toutes les parties en cours sont perdues (rien n'est encore sauvegardé sur disque). Pour une vraie soirée, teste bien avant que les joueurs arrivent.
- L'historique des messages de chat n'est pas rechargé si un joueur recharge sa page en cours de partie (seule sa reconnexion à la partie elle-même est gérée).
- Le Corbeau ajoute ses voix fantômes uniquement si le vote a lieu **après** son utilisation — logique, mais pense à en informer les joueurs.

## Et après ?

Une fois que tu as testé une partie complète avec des amis (même en mode "brut") et que la logique te convient, transmets tout ce dossier + le document d'architecture + la maquette visuelle à l'IA qui s'occupera du design. Elle pourra remplacer `style.css` et la mise en page des fichiers `.html` sans toucher à `server.js` / `game.js`, qui contiennent toute la logique du jeu.
