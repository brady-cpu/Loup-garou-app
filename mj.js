const socket = io();
let etatPartie = null;

function creerPartie() {
  socket.emit('creer_partie');
}

socket.on('partie_creee', ({ code }) => {
  document.getElementById('ecran-creation').style.display = 'none';
  document.getElementById('ecran-mj').style.display = 'block';
  document.getElementById('code-partie').textContent = code;
});

function lancerPartie() {
  socket.emit('mj_lancer_partie');
}

function lancerPhase(phase, duree) {
  socket.emit('mj_lancer_phase', { phase, duree });
}

function lancerDebat() {
  const duree = parseInt(document.getElementById('duree-debat').value, 10);
  socket.emit('mj_lancer_debat', { duree });
}

function lancerVote() {
  const duree = parseInt(document.getElementById('duree-vote').value, 10);
  lancerPhase('vote', duree);
}

function toggleVoteMode() {
  socket.emit('mj_toggle_vote_mode');
}

function toggleMeuteJour() {
  socket.emit('mj_toggle_meute_jour');
}

function eliminerJoueur(playerId) {
  if (confirm('Confirmer l\'élimination manuelle de ce joueur ?')) {
    socket.emit('mj_eliminer_joueur', { playerId });
  }
}

function attribuerMaire(playerId) {
  socket.emit('mj_attribuer_maire', { playerId });
}

function resoudreEgalite() {
  const playerId = document.getElementById('select-egalite').value;
  if (!playerId) return;
  socket.emit('mj_resoudre_egalite', { playerId });
  document.getElementById('alerte-egalite').style.display = 'none';
}

socket.on('etat_partie', (etat) => {
  etatPartie = etat;
  document.getElementById('phase-actuelle').textContent = `Phase : ${etat.state} (jour/nuit n°${etat.jourIndex})`;
  document.getElementById('mode-vote').textContent = etat.voteMode;

  const liste = document.getElementById('liste-joueurs');
  liste.innerHTML = '';
  etat.joueurs.forEach((j) => {
    const div = document.createElement('div');
    div.className = 'ligne-joueur';
    div.innerHTML = `
      <span class="${j.statut === 'mort' ? 'mort' : ''}">
        ${j.prenom} ${j.estMaire ? '<span class="badge-maire">★ Maire</span>' : ''} ${j.connected ? '' : '(déconnecté)'}
      </span>
      <span>
        <button class="secondaire" style="width:auto;display:inline-block;padding:6px 8px;font-size:11px;" onclick="attribuerMaire('${j.id}')">Maire</button>
        ${j.statut === 'vivant' ? `<button class="secondaire" style="width:auto;display:inline-block;padding:6px 8px;font-size:11px;" onclick="eliminerJoueur('${j.id}')">Éliminer</button>` : ''}
      </span>
    `;
    liste.appendChild(div);
  });
});

socket.on('journal_mj', ({ message, timestamp }) => {
  const journal = document.getElementById('journal');
  const heure = new Date(timestamp).toLocaleTimeString();
  journal.textContent = `[${heure}] ${message}\n` + journal.textContent;
});

socket.on('mort', ({ prenom }) => {
  const journal = document.getElementById('journal');
  journal.textContent = `☠️ ${prenom} est mort(e).\n` + journal.textContent;
});

socket.on('resultat_vote', ({ elimineId, egalite, egaliteAvecMaire }) => {
  if (egalite && egaliteAvecMaire) {
    const select = document.getElementById('select-egalite');
    select.innerHTML = etatPartie.joueurs
      .filter((j) => j.statut === 'vivant')
      .map((j) => `<option value="${j.id}">${j.prenom}</option>`)
      .join('');
    document.getElementById('alerte-egalite').style.display = 'block';
  } else if (egalite) {
    alert('Égalité au vote — pas de Maire vivant, personne n\'est éliminé.');
  }
});

socket.on('chasseur_doit_tirer', ({ playerId }) => {
  const joueur = etatPartie?.joueurs.find((j) => j.id === playerId);
  document.getElementById('alerte-chasseur').style.display = 'block';
  document.getElementById('texte-chasseur').textContent = `${joueur ? joueur.prenom : 'Le Chasseur'} doit choisir sa cible sur son téléphone avant de continuer.`;
});

socket.on('partie_terminee', ({ camp }) => {
  alert(`Partie terminée — victoire : ${camp}`);
});

socket.on('vote_recu', ({ nbVotes, nbVivants }) => {
  document.getElementById('phase-actuelle').textContent += ` — votes reçus : ${nbVotes}/${nbVivants}`;
});
