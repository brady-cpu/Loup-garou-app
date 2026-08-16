// server.js
// Point d'entrée du serveur. Lance-le avec : npm start
// Voir le README à la racine du projet pour l'installation pas à pas.

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const G = require('./game');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const io = new Server(server);

// Toutes les parties en cours, indexées par leur code à 6 caractères
const parties = new Map();

function trouverJoueurParSocket(partie, socketId) {
  return [...partie.joueurs.values()].find((j) => j.socketId === socketId);
}

function diffuserEtat(partie) {
  io.to(partie.code).emit('etat_partie', G.vuePublique(partie));
}

function diffuserJournalMJ(partie, message) {
  io.to(partie.mjSocketId).emit('journal_mj', { message, timestamp: Date.now() });
}

function verifierEtAnnoncerVictoire(partie) {
  const resultat = G.verifierVictoire(partie);
  if (resultat) {
    partie.partieTerminee = resultat;
    partie.state = 'terminee';
    io.to(partie.code).emit('partie_terminee', { camp: resultat });
  }
  return resultat;
}

io.on('connection', (socket) => {
  // ---- Création / connexion ----

  socket.on('creer_partie', () => {
    const partie = G.creerPartie(socket.id);
    parties.set(partie.code, partie);
    socket.join(partie.code);
    socket.data.roomCode = partie.code;
    socket.data.estMJ = true;
    socket.emit('partie_creee', { code: partie.code });
  });

  socket.on('rejoindre_partie', ({ roomCode, prenom, cartePhysique }) => {
    const partie = parties.get(roomCode);
    if (!partie) return socket.emit('erreur', { message: 'Partie introuvable.' });
    if (partie.state !== 'lobby') return socket.emit('erreur', { message: 'La partie a déjà commencé.' });

    const joueur = G.creerJoueur(socket.id, prenom, cartePhysique);
    partie.joueurs.set(joueur.id, joueur);

    socket.join(partie.code);
    socket.data.roomCode = partie.code;
    socket.data.playerId = joueur.id;

    socket.emit('connecte', { playerId: joueur.id, code: partie.code });
    diffuserEtat(partie);
    diffuserJournalMJ(partie, `${prenom} a rejoint la partie (${cartePhysique}).`);
  });

  socket.on('reconnecter', ({ roomCode, playerId }) => {
    const partie = parties.get(roomCode);
    if (!partie) return socket.emit('erreur', { message: 'Partie introuvable.' });
    const joueur = partie.joueurs.get(playerId);
    if (!joueur) return socket.emit('erreur', { message: 'Joueur introuvable.' });

    joueur.socketId = socket.id;
    joueur.connected = true;
    socket.join(partie.code);
    socket.data.roomCode = partie.code;
    socket.data.playerId = playerId;
    if (joueur.quartierId) socket.join(`${partie.code}:${joueur.quartierId}`);
    if (joueur.cartePhysique === 'loup-garou') socket.join(`${partie.code}:meute`);
    if (joueur.amoureuxDe) socket.join(`${partie.code}:cocon`);
    if (joueur.statut === 'mort') socket.join(`${partie.code}:cimetiere`);

    socket.emit('etat_partie', G.vuePublique(partie));
    diffuserEtat(partie);
  });

  // ---- Contrôles MJ ----

  function estMJ(socket, partie) {
    return partie && partie.mjSocketId === socket.id;
  }

  socket.on('mj_lancer_partie', () => {
    const partie = parties.get(socket.data.roomCode);
    if (!estMJ(socket, partie)) return;
    G.attribuerPouvoirsNumeriques(partie);
    partie.joueurs.forEach((j) => {
      io.to(j.socketId).emit('pouvoir_attribue', { pouvoirNumerique: j.pouvoirNumerique });
    });
    partie.state = 'nuit';
    partie.jourIndex = 1;
    io.to(partie.code).emit('phase_changee', { phase: 'nuit', jourIndex: 1 });
    diffuserEtat(partie);
  });

  socket.on('mj_lancer_phase', ({ phase, duree }) => {
    const partie = parties.get(socket.data.roomCode);
    if (!estMJ(socket, partie)) return;

    if (phase === 'nuit') {
      partie.jourIndex += 1;
      partie.joueurs.forEach((j) => {
        j.pouvoirUsage.infiltreUtiliseCetteNuit = false;
        j.pouvoirUsage.pirateUtiliseCetteNuit = false;
      });
      partie.state = 'nuit';
      io.to(partie.code).emit('phase_changee', { phase: 'nuit', jourIndex: partie.jourIndex });
    }

    if (phase === 'jour') {
      const resume = G.resoudreNuit(partie);
      G.repartirQuartiers(partie);
      partie.joueurs.forEach((j) => {
        io.to(j.socketId).emit('mon_quartier', { quartierId: j.quartierId });
        io.sockets.sockets.get(j.socketId)?.join(`${partie.code}:${j.quartierId}`);
      });
      partie.gazetteEvenement = G.melanger(G.GAZETTE_EVENTS)[0];
      partie.joueurs.forEach((j) => {
        j.pouvoirUsage.alerteUtiliseeAujourdhui = false;
      });
      partie.state = 'jour';

      resume.morts.forEach((playerId) => {
        const j = partie.joueurs.get(playerId);
        io.sockets.sockets.get(j.socketId)?.join(`${partie.code}:cimetiere`);
        io.to(partie.code).emit('mort', { playerId, prenom: j.prenom });
      });

      io.to(partie.code).emit('phase_changee', {
        phase: 'jour',
        jourIndex: partie.jourIndex,
        gazetteEvenement: partie.gazetteEvenement,
      });
      diffuserJournalMJ(partie, `Nuit résolue : cible des loups = ${resume.cibleLoups || 'aucune'}, sauvé(e) = ${resume.sauvePar ? 'oui' : 'non'}, morts = ${resume.morts.length}.`);
      if (partie.chasseurEnAttente) {
        io.to(partie.code).emit('chasseur_doit_tirer', { playerId: partie.chasseurEnAttente });
      }
      verifierEtAnnoncerVictoire(partie);
    }

    if (phase === 'vote') {
      partie.votes.clear();
      partie.state = 'vote';
      const dureeMs = (duree || 60) * 1000;
      partie.voteTimerFin = Date.now() + dureeMs;
      io.to(partie.code).emit('vote_lance', { duree: duree || 60 });
      setTimeout(() => resoudreEtDiffuserVote(partie), dureeMs);
    }

    diffuserEtat(partie);
  });

  socket.on('mj_lancer_debat', ({ duree }) => {
    const partie = parties.get(socket.data.roomCode);
    if (!estMJ(socket, partie)) return;
    io.to(partie.code).emit('debat_lance', { duree });
  });

  socket.on('mj_toggle_vote_mode', () => {
    const partie = parties.get(socket.data.roomCode);
    if (!estMJ(socket, partie)) return;
    partie.voteMode = partie.voteMode === 'anonyme' ? 'public' : 'anonyme';
    diffuserEtat(partie);
  });

  socket.on('mj_toggle_meute_jour', () => {
    const partie = parties.get(socket.data.roomCode);
    if (!estMJ(socket, partie)) return;
    partie.meuteOuverteJour = !partie.meuteOuverteJour;
    diffuserEtat(partie);
  });

  socket.on('mj_eliminer_joueur', ({ playerId }) => {
    const partie = parties.get(socket.data.roomCode);
    if (!estMJ(socket, partie)) return;
    const morts = G.tuerJoueur(partie, playerId);
    morts.forEach((id) => {
      const j = partie.joueurs.get(id);
      io.sockets.sockets.get(j.socketId)?.join(`${partie.code}:cimetiere`);
      io.to(partie.code).emit('mort', { playerId: id, prenom: j.prenom });
    });
    if (partie.chasseurEnAttente) {
      io.to(partie.code).emit('chasseur_doit_tirer', { playerId: partie.chasseurEnAttente });
    }
    verifierEtAnnoncerVictoire(partie);
    diffuserEtat(partie);
  });

  socket.on('mj_attribuer_maire', ({ playerId }) => {
    const partie = parties.get(socket.data.roomCode);
    if (!estMJ(socket, partie)) return;
    partie.joueurs.forEach((j) => { j.estMaire = false; }); // un seul Maire actif à la fois
    const nouveauMaire = partie.joueurs.get(playerId);
    if (nouveauMaire) nouveauMaire.estMaire = true;
    diffuserEtat(partie);
  });

  socket.on('mj_resoudre_egalite', ({ playerId }) => {
    // Utilisé quand le vote est à égalité ET qu'un Maire vivant tranche à l'oral :
    // le MJ saisit ici le résultat décidé oralement.
    const partie = parties.get(socket.data.roomCode);
    if (!estMJ(socket, partie)) return;
    const morts = G.tuerJoueur(partie, playerId);
    morts.forEach((id) => {
      const j = partie.joueurs.get(id);
      io.sockets.sockets.get(j.socketId)?.join(`${partie.code}:cimetiere`);
      io.to(partie.code).emit('mort', { playerId: id, prenom: j.prenom });
    });
    io.to(partie.code).emit('resultat_vote', { elimineId: playerId, viaMaire: true });
    if (partie.chasseurEnAttente) {
      io.to(partie.code).emit('chasseur_doit_tirer', { playerId: partie.chasseurEnAttente });
    }
    verifierEtAnnoncerVictoire(partie);
    diffuserEtat(partie);
  });

  function resoudreEtDiffuserVote(partie) {
    if (partie.state !== 'vote') return; // déjà résolu manuellement
    const resultat = G.resoudreVote(partie);
    partie.state = 'jour';

    if (resultat.elimineId) {
      const morts = G.tuerJoueur(partie, resultat.elimineId);
      morts.forEach((id) => {
        const j = partie.joueurs.get(id);
        io.sockets.sockets.get(j.socketId)?.join(`${partie.code}:cimetiere`);
        io.to(partie.code).emit('mort', { playerId: id, prenom: j.prenom });
      });
    }

    io.to(partie.code).emit('resultat_vote', {
      elimineId: resultat.elimineId,
      egalite: resultat.egalite,
      egaliteAvecMaire: resultat.egaliteAvecMaire || false,
      detail: partie.voteMode === 'public' ? resultat.detailVotes : undefined,
    });

    if (partie.chasseurEnAttente) {
      io.to(partie.code).emit('chasseur_doit_tirer', { playerId: partie.chasseurEnAttente });
    }
    verifierEtAnnoncerVictoire(partie);
    diffuserEtat(partie);
  }

  // ---- Actions de rôle (nuit) ----

  socket.on('action_role', ({ type, cibleId, cibles }) => {
    const partie = parties.get(socket.data.roomCode);
    if (!partie) return;
    const joueur = trouverJoueurParSocket(partie, socket.id);
    if (!joueur || joueur.statut !== 'vivant') return;

    if (type === 'cupidon' && joueur.cartePhysique === 'cupidon' && partie.jourIndex === 1) {
      const [id1, id2] = cibles || [];
      const j1 = partie.joueurs.get(id1);
      const j2 = partie.joueurs.get(id2);
      if (j1 && j2) {
        j1.amoureuxDe = j2.id;
        j2.amoureuxDe = j1.id;
        [j1, j2].forEach((j) => io.sockets.sockets.get(j.socketId)?.join(`${partie.code}:cocon`));
        io.to(`${partie.code}:cocon`).emit('cocon_forme', { membres: [j1.id, j2.id] });
      }
    }

    if (type === 'voyante' && joueur.cartePhysique === 'voyante') {
      const cible = partie.joueurs.get(cibleId);
      if (cible) {
        socket.emit('resultat_voyante', { cibleId, cartePhysique: cible.cartePhysique });
      }
    }

    if (type === 'loup' && joueur.cartePhysique === 'loup-garou') {
      partie.loupsVotes.set(joueur.id, cibleId);
      io.to(`${partie.code}:meute`).emit('meute_maj', { loupId: joueur.id, cibleId });
    }

    if (type === 'sorciere_sauver' && joueur.cartePhysique === 'sorciere') {
      if (joueur.potions.resurrection) {
        joueur.potions.resurrection = false;
        partie.sorciereAction = { type: 'sauver', cibleId };
        socket.emit('sorciere_confirmation', { type: 'sauver' });
      }
    }

    if (type === 'sorciere_tuer' && joueur.cartePhysique === 'sorciere') {
      if (joueur.potions.mort) {
        joueur.potions.mort = false;
        partie.sorciereAction = { type: 'tuer', cibleId };
        socket.emit('sorciere_confirmation', { type: 'tuer' });
      }
    }

    if (type === 'chasseur' && joueur.id === partie.chasseurEnAttente) {
      partie.chasseurEnAttente = null;
      const morts = G.tuerJoueur(partie, cibleId);
      morts.forEach((id) => {
        const m = partie.joueurs.get(id);
        io.sockets.sockets.get(m.socketId)?.join(`${partie.code}:cimetiere`);
        io.to(partie.code).emit('mort', { playerId: id, prenom: m.prenom });
      });
      verifierEtAnnoncerVictoire(partie);
      diffuserEtat(partie);
    }

    // Voir la cible actuelle des loups en direct (utile pour la Sorcière)
    if (type === 'voir_cible_loups' && joueur.cartePhysique === 'sorciere') {
      socket.emit('cible_loups_actuelle', { cibleId: G.calculerCibleLoups(partie) });
    }
  });

  // ---- Pouvoirs bonus numériques ----

  socket.on('pouvoir_numerique', ({ pouvoir, cibleId }) => {
    const partie = parties.get(socket.data.roomCode);
    if (!partie) return;
    const joueur = trouverJoueurParSocket(partie, socket.id);
    if (!joueur || joueur.statut !== 'vivant' || joueur.pouvoirNumerique !== pouvoir) return;
    const usage = joueur.pouvoirUsage;

    if (pouvoir === 'corbeau') {
      if (usage.corbeauUtilise || partie.state !== 'nuit') return;
      usage.corbeauUtilise = true;
      partie.corbeauVoixFantomes = { cibleId, poids: 2 };
      socket.emit('pouvoir_confirmation', { pouvoir: 'corbeau' });
    }

    if (pouvoir === 'infiltre') {
      if (usage.infiltreUtiliseCetteNuit || partie.state !== 'nuit') return;
      const cible = partie.joueurs.get(cibleId);
      if (!cible || !cible.quartierId) return;
      usage.infiltreUtiliseCetteNuit = true;
      const quartier = partie.quartiers.find((q) => q.id === cible.quartierId);
      socket.emit('infiltre_resultat', { quartierId: cible.quartierId, messages: quartier ? quartier.messages : [] });
    }

    if (pouvoir === 'pirate') {
      if (usage.pirateUtiliseCetteNuit || partie.state !== 'nuit') return;
      if (usage.pirateDerniereCible === cibleId) return; // pas 2 fois de suite sur la même cible
      const cible = partie.joueurs.get(cibleId);
      if (!cible) return;
      usage.pirateUtiliseCetteNuit = true;
      usage.pirateDerniereCible = cibleId;
      cible.signalPerduActif = true;
      io.to(cible.socketId).emit('signal_perdu', { actif: true });
      socket.emit('pouvoir_confirmation', { pouvoir: 'pirate', cibleId });
    }

    if (pouvoir === 'lanceur-alerte') {
      if (usage.alerteUtiliseeAujourdhui || partie.state !== 'jour') return;
      usage.alerteUtiliseeAujourdhui = true;
      io.to(partie.code).emit('alerte_anonyme', { contenu: cibleId /* ici cibleId sert de texte libre du message */ });
    }
  });

  // ---- Messagerie (Quartiers / Meute / Cocon / Cimetière) ----

  socket.on('message_quartier', ({ canal, contenu }) => {
    const partie = parties.get(socket.data.roomCode);
    if (!partie) return;
    const joueur = trouverJoueurParSocket(partie, socket.id);
    if (!joueur) return;

    let autorise = false;
    let room = null;

    if (canal.startsWith('quartier:')) {
      const quartierId = canal.split(':')[1];
      autorise = joueur.quartierId === quartierId && joueur.statut === 'vivant';
      if (partie.gazetteEvenement && partie.gazetteEvenement.effet === 'brouillard' && partie.state === 'jour') autorise = false;
      room = `${partie.code}:${quartierId}`;
    } else if (canal === 'meute') {
      autorise = joueur.cartePhysique === 'loup-garou' && joueur.statut === 'vivant' && (partie.state === 'nuit' || partie.meuteOuverteJour);
      room = `${partie.code}:meute`;
    } else if (canal === 'cocon') {
      autorise = !!joueur.amoureuxDe && joueur.statut === 'vivant';
      room = `${partie.code}:cocon`;
    } else if (canal === 'cimetiere') {
      // Les morts peuvent écrire ; le Médium (vivant) peut seulement lire (donc pas passer ici)
      autorise = joueur.statut === 'mort';
      room = `${partie.code}:cimetiere`;
    }

    if (!autorise || !room) return;

    const message = { id: `${Date.now()}`, auteurId: joueur.id, auteurPrenom: joueur.prenom, contenu, timestamp: Date.now() };

    if (canal.startsWith('quartier:')) {
      const quartier = partie.quartiers.find((q) => q.id === canal.split(':')[1]);
      if (quartier) quartier.messages.push(message);
    }

    io.to(room).emit('nouveau_message', { canal, message });
  });

  // Le Médium (vivant) lit le Cimetière en lecture seule
  socket.on('lire_cimetiere', () => {
    const partie = parties.get(socket.data.roomCode);
    if (!partie) return;
    const joueur = trouverJoueurParSocket(partie, socket.id);
    if (!joueur || joueur.cartePhysique !== 'medium') return; // adapte selon le nom exact de ta carte Médium
    socket.join(`${partie.code}:cimetiere`);
  });

  // ---- Vote ----

  socket.on('voter', ({ cibleId }) => {
    const partie = parties.get(socket.data.roomCode);
    if (!partie || partie.state !== 'vote') return;
    const joueur = trouverJoueurParSocket(partie, socket.id);
    if (!joueur || joueur.statut !== 'vivant' || joueur.signalPerduActif) return;
    partie.votes.set(joueur.id, cibleId);
    io.to(partie.mjSocketId).emit('vote_recu', { nbVotes: partie.votes.size, nbVivants: G.joueursVivants(partie).length });
  });

  socket.on('disconnect', () => {
    const partie = parties.get(socket.data.roomCode);
    if (!partie) return;
    if (socket.data.playerId) {
      const joueur = partie.joueurs.get(socket.data.playerId);
      if (joueur) {
        joueur.connected = false;
        diffuserEtat(partie);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur Loup-Garou lancé sur http://localhost:${PORT}`);
  console.log('Ouvre cette adresse sur ton téléphone (même Wi-Fi) en remplaçant "localhost" par ton adresse IP locale.');
});
