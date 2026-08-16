// game.js
// Toute la logique "pure" du jeu : création de partie, joueurs, résolution des nuits et des votes.
// Ce fichier ne connaît rien à Socket.io : il manipule juste des objets JavaScript.
// server.js s'occupe de brancher ça au réseau.

const { randomUUID } = require('crypto');

const CARTES_PHYSIQUES = ['villageois', 'loup-garou', 'voyante', 'sorciere', 'cupidon', 'chasseur', 'medium'];
const POUVOIRS_NUMERIQUES = ['corbeau', 'infiltre', 'pirate', 'lanceur-alerte'];

const GAZETTE_EVENTS = [
  { titre: 'Brouillard Épais', detail: "Les chats de Quartiers sont désactivés aujourd'hui.", effet: 'brouillard' },
  { titre: 'Couvre-Feu', detail: 'Le débat sera plus court aujourd\'hui.', effet: 'couvre-feu' },
  { titre: 'Marché du Village', detail: 'Journée calme, aucun effet particulier.', effet: null },
];

function genererCodePartie() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // pas de 0/O/1/I pour éviter la confusion
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function melanger(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function creerPartie(mjSocketId) {
  return {
    code: genererCodePartie(),
    mjSocketId,
    state: 'lobby', // lobby | nuit | jour | vote | terminee
    jourIndex: 0,
    voteMode: 'anonyme', // anonyme | public
    gazetteEvenement: null,
    joueurs: new Map(), // id -> joueur
    quartiers: [],
    votes: new Map(), // voterId -> cibleId
    loupsVotes: new Map(), // loupId -> cibleId (pendant la nuit en cours)
    sorciereAction: null, // { type: 'sauver'|'tuer', cibleId }
    corbeauVoixFantomes: null, // { cibleId, poids } en attente d'être appliqué au prochain vote
    chasseurEnAttente: null, // playerId si un chasseur vient de mourir et doit encore tirer
    voteTimerFin: null,
    meuteOuverteJour: false,
    partieTerminee: null, // 'village' | 'loups' | 'amoureux' | null
  };
}

function creerJoueur(socketId, prenom, cartePhysique) {
  return {
    id: randomUUID(),
    socketId,
    prenom,
    cartePhysique,
    pouvoirNumerique: null,
    statut: 'vivant', // vivant | mort
    quartierId: null,
    amoureuxDe: null,
    estMaire: false,
    connected: true,
    potions: cartePhysique === 'sorciere' ? { resurrection: true, mort: true } : null,
    pouvoirUsage: {
      corbeauUtilise: false,
      infiltreUtiliseCetteNuit: false,
      pirateUtiliseCetteNuit: false,
      pirateDerniereCible: null,
      alerteUtiliseeAujourdhui: false,
    },
    signalPerduActif: false, // Pirate : bloqué pour le tour en cours
  };
}

function attribuerPouvoirsNumeriques(partie) {
  const joueurs = [...partie.joueurs.values()];
  const pouvoirs = melanger(POUVOIRS_NUMERIQUES);
  joueurs.forEach((j, i) => {
    j.pouvoirNumerique = pouvoirs[i] || null;
  });
}

function joueursVivants(partie) {
  return [...partie.joueurs.values()].filter((j) => j.statut === 'vivant');
}

function repartirQuartiers(partie) {
  const vivants = melanger(joueursVivants(partie));
  const quartiers = [];
  let i = 0;
  let idx = 1;
  while (i < vivants.length) {
    const restant = vivants.length - i;
    const taille = restant <= 4 ? restant : 3; // groupes de 3, sauf le dernier qui peut monter à 4
    const membres = vivants.slice(i, i + taille).map((j) => j.id);
    const quartierId = `quartier-${idx}`;
    quartiers.push({ id: quartierId, membres, messages: [] });
    membres.forEach((id) => {
      partie.joueurs.get(id).quartierId = quartierId;
    });
    i += taille;
    idx++;
  }
  partie.quartiers = quartiers;
}

// Calcule la cible désignée par les loups à partir des votes reçus pendant la nuit
function calculerCibleLoups(partie) {
  const compte = new Map();
  for (const cibleId of partie.loupsVotes.values()) {
    compte.set(cibleId, (compte.get(cibleId) || 0) + 1);
  }
  if (compte.size === 0) return null;
  let max = -1;
  let candidats = [];
  for (const [cibleId, n] of compte.entries()) {
    if (n > max) {
      max = n;
      candidats = [cibleId];
    } else if (n === max) {
      candidats.push(cibleId);
    }
  }
  return candidats[Math.floor(Math.random() * candidats.length)];
}

// Applique la mort d'un joueur + effets en cascade (amoureux, chasseur, maire)
// Retourne la liste des morts effectives (peut contenir plus d'un joueur : réaction amoureux)
function tuerJoueur(partie, playerId, morts = []) {
  const joueur = partie.joueurs.get(playerId);
  if (!joueur || joueur.statut === 'mort') return morts;
  joueur.statut = 'mort';
  if (joueur.estMaire) joueur.estMaire = false; // transmission gérée manuellement par le MJ ensuite
  morts.push(playerId);

  // Réaction en cascade : cœur brisé
  if (joueur.amoureuxDe) {
    const partenaire = partie.joueurs.get(joueur.amoureuxDe);
    if (partenaire && partenaire.statut === 'vivant') {
      tuerJoueur(partie, partenaire.id, morts);
    }
  }

  // Chasseur : action différée, à déclencher côté serveur (server.js écoute ce champ)
  if (joueur.cartePhysique === 'chasseur') {
    partie.chasseurEnAttente = joueur.id;
  }

  return morts;
}

// Résout la nuit : combine vote des loups + action de la sorcière
function resoudreNuit(partie) {
  const cibleLoups = calculerCibleLoups(partie);
  let morts = [];
  let sauvePar = null;

  const action = partie.sorciereAction;

  if (cibleLoups) {
    if (action && action.type === 'sauver' && action.cibleId === cibleLoups) {
      sauvePar = 'sorciere';
    } else {
      morts = tuerJoueur(partie, cibleLoups, morts);
    }
  }

  if (action && action.type === 'tuer') {
    morts = tuerJoueur(partie, action.cibleId, morts);
  }

  // reset des éléments propres à cette nuit
  partie.loupsVotes.clear();
  partie.sorciereAction = null;

  return { cibleLoups, sauvePar, morts };
}

// Résout le vote du village. Retourne { elimineId, egaliteAvecMaire, detailVotes }
function resoudreVote(partie) {
  const compte = new Map();
  for (const cibleId of partie.votes.values()) {
    compte.set(cibleId, (compte.get(cibleId) || 0) + 1);
  }

  // Voix fantômes du Corbeau (appliquées une seule fois, puis on vide)
  if (partie.corbeauVoixFantomes) {
    const { cibleId, poids } = partie.corbeauVoixFantomes;
    compte.set(cibleId, (compte.get(cibleId) || 0) + poids);
    partie.corbeauVoixFantomes = null;
  }

  if (compte.size === 0) {
    return { elimineId: null, egalite: false, detailVotes: [] };
  }

  let max = -1;
  let candidats = [];
  for (const [cibleId, n] of compte.entries()) {
    if (n > max) {
      max = n;
      candidats = [cibleId];
    } else if (n === max) {
      candidats.push(cibleId);
    }
  }

  const detailVotes = [...compte.entries()].map(([cibleId, n]) => ({ cibleId, n }));

  if (candidats.length > 1) {
    // Égalité : pas d'élimination, sauf si un Maire vivant peut trancher (géré côté server.js)
    const maireVivant = joueursVivants(partie).some((j) => j.estMaire);
    return { elimineId: null, egalite: true, egaliteAvecMaire: maireVivant, candidats, detailVotes };
  }

  return { elimineId: candidats[0], egalite: false, detailVotes };
}

function verifierVictoire(partie) {
  const vivants = joueursVivants(partie);
  const loups = vivants.filter((j) => j.cartePhysique === 'loup-garou');
  const villageois = vivants.filter((j) => j.cartePhysique !== 'loup-garou');

  if (vivants.length === 2 && vivants[0].amoureuxDe === vivants[1].id) {
    return 'amoureux';
  }
  if (loups.length === 0) return 'village';
  if (loups.length >= villageois.length) return 'loups';
  return null;
}

// Vue "filtrée" d'une partie à envoyer à un joueur donné (on ne révèle pas les infos privées des autres)
function vuePublique(partie) {
  return {
    code: partie.code,
    state: partie.state,
    jourIndex: partie.jourIndex,
    voteMode: partie.voteMode,
    gazetteEvenement: partie.gazetteEvenement,
    joueurs: [...partie.joueurs.values()].map((j) => ({
      id: j.id,
      prenom: j.prenom,
      statut: j.statut,
      estMaire: j.estMaire,
      connected: j.connected,
    })),
  };
}

module.exports = {
  CARTES_PHYSIQUES,
  POUVOIRS_NUMERIQUES,
  GAZETTE_EVENTS,
  genererCodePartie,
  melanger,
  creerPartie,
  creerJoueur,
  attribuerPouvoirsNumeriques,
  joueursVivants,
  repartirQuartiers,
  calculerCibleLoups,
  tuerJoueur,
  resoudreNuit,
  resoudreVote,
  verifierVictoire,
  vuePublique,
};
