const socket = io();
let moi = { id: null, code: null, cartePhysique: null, pouvoirNumerique: null, avatarData: null };
let etatPartie = null;

function previsualiserAvatar() {
  const fichier = document.getElementById('input-avatar').files[0];
  if (!fichier) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // On réduit la photo à 96x96 max avant envoi, pour rester léger sur le réseau
      const taille = 96;
      const canvas = document.createElement('canvas');
      canvas.width = taille;
      canvas.height = taille;
      const ctx = canvas.getContext('2d');
      const ratio = Math.max(taille / img.width, taille / img.height);
      const w = img.width * ratio;
      const h = img.height * ratio;
      ctx.drawImage(img, (taille - w) / 2, (taille - h) / 2, w, h);
      moi.avatarData = canvas.toDataURL('image/jpeg', 0.7);
      document.getElementById('avatar-preview').innerHTML = `<img src="${moi.avatarData}">`;
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(fichier);
}

function rejoindre() {
  const roomCode = document.getElementById('input-code').value.trim().toUpperCase();
  const prenom = document.getElementById('input-prenom').value.trim();
  const cartePhysique = document.getElementById('input-carte').value;
  if (!roomCode || !prenom) return alert('Renseigne le code et ton prénom.');
  moi.cartePhysique = cartePhysique;
  socket.emit('rejoindre_partie', { roomCode, prenom, cartePhysique, avatarData: moi.avatarData });
}

socket.on('connecte', ({ playerId, code }) => {
  moi.id = playerId;
  moi.code = code;
  localStorage.setItem('loupgarou_playerId', playerId);
  localStorage.setItem('loupgarou_roomCode', code);
  document.getElementById('ecran-connexion').style.display = 'none';
  document.getElementById('ecran-jeu').style.display = 'block';
  if (moi.cartePhysique === 'medium') {
    socket.emit('lire_cimetiere');
    document.getElementById('bloc-cimetiere').style.display = 'block';
  }
});

// Reconnexion automatique si on rouvre la page en pleine partie
window.addEventListener('load', () => {
  const playerId = localStorage.getItem('loupgarou_playerId');
  const roomCode = localStorage.getItem('loupgarou_roomCode');
  if (playerId && roomCode && document.getElementById('ecran-connexion').style.display !== 'none') {
    moi.id = playerId;
    moi.code = roomCode;
    socket.emit('reconnecter', { roomCode, playerId });
    document.getElementById('ecran-connexion').style.display = 'none';
    document.getElementById('ecran-jeu').style.display = 'block';
  }
});

socket.on('erreur', ({ message }) => alert(message));

socket.on('pouvoir_attribue', ({ pouvoirNumerique }) => {
  moi.pouvoirNumerique = pouvoirNumerique;
  document.getElementById('pouvoir-bonus').textContent = pouvoirNumerique
    ? `Ton pouvoir bonus numérique : ${pouvoirNumerique}`
    : 'Aucun pouvoir bonus numérique cette partie.';
});

socket.on('phase_changee', ({ phase, gazetteEvenement }) => {
  document.getElementById('phase-actuelle').textContent = `Phase : ${phase}`;
  document.getElementById('bloc-nuit').style.display = phase === 'nuit' ? 'block' : 'none';
  document.getElementById('bloc-vote').style.display = 'none';
  document.getElementById('alerte-signal-perdu').style.display = 'none';

  if (phase === 'nuit') afficherActionsNuit();
  if (phase === 'jour') {
    const gazette = document.getElementById('gazette');
    if (gazetteEvenement) {
      gazette.style.display = 'block';
      gazette.innerHTML = `<div class="section-titre">La Gazette du Village</div><b>${gazetteEvenement.titre}</b><br><span class="log">${gazetteEvenement.detail}</span>`;
    }
    afficherActionsJour();
  } else {
    document.getElementById('bloc-jour-pouvoir').style.display = 'none';
  }
});

function afficherActionsJour() {
  const zone = document.getElementById('bloc-jour-pouvoir');
  if (moi.pouvoirNumerique === 'lanceur-alerte') {
    zone.style.display = 'block';
    zone.innerHTML = `
      <div class="section-titre">Lanceur d'Alerte (1x/jour)</div>
      <input id="alerte-texte" placeholder="Message anonyme à envoyer à tous">
      <button onclick="envoyerAlerteBouton()">Envoyer l'alerte anonyme</button>`;
  } else {
    zone.style.display = 'none';
  }
}

function envoyerAlerteBouton() {
  const texte = document.getElementById('alerte-texte').value.trim();
  if (!texte) return;
  envoyerAlerte(texte);
  document.getElementById('alerte-texte').value = '';
}

socket.on('debat_lance', ({ duree }) => {
  demarrerCompteAReboursSimple(duree, 'phase-actuelle', 'Débat en cours');
});

socket.on('vote_lance', ({ duree }) => {
  document.getElementById('bloc-vote').style.display = 'block';
  afficherSuspects();
  demarrerCompteARebours(duree);
});

function demarrerCompteARebours(secondes) {
  let restant = secondes;
  const el = document.getElementById('timer-vote');
  const maj = () => {
    const m = String(Math.floor(restant / 60)).padStart(2, '0');
    const s = String(restant % 60).padStart(2, '0');
    el.textContent = `${m}:${s}`;
    if (restant <= 0) return clearInterval(intervalle);
    restant -= 1;
  };
  maj();
  const intervalle = setInterval(maj, 1000);
}

function demarrerCompteAReboursSimple(secondes, elementId, prefixe) {
  let restant = secondes;
  const el = document.getElementById(elementId);
  const intervalle = setInterval(() => {
    if (restant <= 0) return clearInterval(intervalle);
    restant -= 1;
    const m = String(Math.floor(restant / 60)).padStart(2, '0');
    const s = String(restant % 60).padStart(2, '0');
    el.textContent = `${prefixe} — ${m}:${s}`;
  }, 1000);
}

function afficherSuspects() {
  const div = document.getElementById('suspects');
  div.innerHTML = '';
  etatPartie.joueurs.filter((j) => j.statut === 'vivant').forEach((j) => {
    const btn = document.createElement('button');
    btn.className = 'secondaire';
    btn.textContent = j.prenom;
    btn.onclick = () => {
      document.querySelectorAll('#suspects button').forEach((b) => (b.style.background = '#333'));
      btn.style.background = '#8c2f39';
      btn.dataset.cible = j.id;
      div.dataset.cibleChoisie = j.id;
    };
    div.appendChild(btn);
  });
}

function envoyerVote() {
  const cibleId = document.getElementById('suspects').dataset.cibleChoisie;
  if (!cibleId) return alert('Choisis un suspect avant de sceller ton vote.');
  socket.emit('voter', { cibleId });

  const j = etatPartie.joueurs.find((x) => x.id === cibleId);
  document.getElementById('parchment-note').textContent = j ? j.prenom : '—';
  const overlay = document.getElementById('letter-overlay');
  overlay.classList.add('show');
  setTimeout(() => overlay.classList.remove('show'), 2600);
}

function optionsJoueursVivants(excluMoi) {
  return etatPartie.joueurs
    .filter((j) => j.statut === 'vivant' && (!excluMoi || j.id !== moi.id))
    .map((j) => `<option value="${j.id}">${j.prenom}</option>`)
    .join('');
}

function afficherActionsNuit() {
  const zone = document.getElementById('action-role');
  const zonePouvoir = document.getElementById('pouvoir-numerique-action');
  zone.innerHTML = '';
  zonePouvoir.innerHTML = '';

  if (!etatPartie) return;

  if (moi.cartePhysique === 'cupidon' && etatPartie.jourIndex === 1) {
    zone.innerHTML = `
      <p>Choisis les deux Amoureux :</p>
      <select id="cupidon-1">${optionsJoueursVivants(false)}</select>
      <select id="cupidon-2">${optionsJoueursVivants(false)}</select>
      <button onclick="actionCupidon()">Former le couple</button>`;
  }

  if (moi.cartePhysique === 'voyante') {
    zone.innerHTML += `
      <p>Sonde le rôle d'un joueur :</p>
      <select id="voyante-cible">${optionsJoueursVivants(true)}</select>
      <button onclick="actionVoyante()">Consulter</button>
      <div id="resultat-voyante" class="log"></div>`;
  }

  if (moi.cartePhysique === 'loup-garou') {
    zone.innerHTML += `
      <p>Désigne une victime (coordonne-toi avec la Meute ci-dessous) :</p>
      <select id="loup-cible">${optionsJoueursVivants(true)}</select>
      <button onclick="actionLoup()">Voter</button>`;
  }

  if (moi.cartePhysique === 'sorciere') {
    zone.innerHTML += `
      <button onclick="voirCibleLoups()">Voir la cible actuelle des loups</button>
      <div id="cible-loups-info" class="log"></div>
      <select id="sorciere-cible">${optionsJoueursVivants(false)}</select>
      <button id="btn-sorciere-sauver" onclick="actionSorciere('sauver')">Potion de résurrection</button>
      <button id="btn-sorciere-tuer" onclick="actionSorciere('tuer')">Potion de mort</button>`;
  }

  // Pouvoirs bonus numériques
  if (moi.pouvoirNumerique === 'corbeau') {
    zonePouvoir.innerHTML += `
      <div class="section-titre">Corbeau (1x/partie)</div>
      <select id="corbeau-cible">${optionsJoueursVivants(true)}</select>
      <button onclick="pouvoirCorbeau()">Ajouter 2 voix fantômes</button>`;
  }
  if (moi.pouvoirNumerique === 'infiltre') {
    zonePouvoir.innerHTML += `
      <div class="section-titre">Infiltré (1x/nuit)</div>
      <select id="infiltre-cible">${optionsJoueursVivants(true)}</select>
      <button onclick="pouvoirInfiltre()">Espionner son Quartier</button>
      <div id="resultat-infiltre" class="log"></div>`;
  }
  if (moi.pouvoirNumerique === 'pirate') {
    zonePouvoir.innerHTML += `
      <div class="section-titre">Pirate (1x/nuit, jamais 2x de suite la même cible)</div>
      <select id="pirate-cible">${optionsJoueursVivants(true)}</select>
      <button onclick="pouvoirPirate()">SIGNAL PERDU</button>`;
  }
}

function actionCupidon() {
  const id1 = document.getElementById('cupidon-1').value;
  const id2 = document.getElementById('cupidon-2').value;
  socket.emit('action_role', { type: 'cupidon', cibles: [id1, id2] });
}
function actionVoyante() {
  const cibleId = document.getElementById('voyante-cible').value;
  socket.emit('action_role', { type: 'voyante', cibleId });
}
socket.on('resultat_voyante', ({ cibleId, cartePhysique }) => {
  const j = etatPartie.joueurs.find((x) => x.id === cibleId);
  document.getElementById('resultat-voyante').textContent = `${j ? j.prenom : '?'} est : ${cartePhysique}`;
});
function actionLoup() {
  const cibleId = document.getElementById('loup-cible').value;
  socket.emit('action_role', { type: 'loup', cibleId });
}
function voirCibleLoups() {
  socket.emit('action_role', { type: 'voir_cible_loups' });
}
socket.on('cible_loups_actuelle', ({ cibleId }) => {
  const j = etatPartie.joueurs.find((x) => x.id === cibleId);
  document.getElementById('cible-loups-info').textContent = `Cible actuelle des loups : ${j ? j.prenom : 'aucune pour le moment'}`;
});
function actionSorciere(type) {
  const cibleId = document.getElementById('sorciere-cible').value;
  socket.emit('action_role', { type: `sorciere_${type}`, cibleId });
}
socket.on('sorciere_confirmation', ({ type }) => {
  const btn = document.getElementById(type === 'sauver' ? 'btn-sorciere-sauver' : 'btn-sorciere-tuer');
  if (btn) btn.disabled = true;
});

function pouvoirCorbeau() {
  const cibleId = document.getElementById('corbeau-cible').value;
  socket.emit('pouvoir_numerique', { pouvoir: 'corbeau', cibleId });
}
function pouvoirInfiltre() {
  const cibleId = document.getElementById('infiltre-cible').value;
  socket.emit('pouvoir_numerique', { pouvoir: 'infiltre', cibleId });
}
socket.on('infiltre_resultat', ({ messages }) => {
  document.getElementById('resultat-infiltre').textContent = messages.length
    ? messages.map((m) => `${m.auteurPrenom}: ${m.contenu}`).join('\n')
    : 'Aucun message pour le moment.';
});
function pouvoirPirate() {
  const cibleId = document.getElementById('pirate-cible').value;
  socket.emit('pouvoir_numerique', { pouvoir: 'pirate', cibleId });
}
function envoyerAlerte(texte) {
  socket.emit('pouvoir_numerique', { pouvoir: 'lanceur-alerte', cibleId: texte });
}

socket.on('signal_perdu', () => {
  document.getElementById('alerte-signal-perdu').style.display = 'block';
});

socket.on('chasseur_doit_tirer', ({ playerId }) => {
  if (playerId !== moi.id) return;
  const select = document.getElementById('chasseur-select');
  select.innerHTML = optionsJoueursVivants(true);
  document.getElementById('bloc-chasseur').style.display = 'block';
});

function tirerChasseur() {
  const cibleId = document.getElementById('chasseur-select').value;
  if (!cibleId) return;
  socket.emit('action_role', { type: 'chasseur', cibleId });
  document.getElementById('bloc-chasseur').style.display = 'none';
}

socket.on('mort', ({ playerId, prenom }) => {
  const fil = document.getElementById('fil-village');
  document.getElementById('bloc-alerte').style.display = 'block';
  fil.innerHTML = `<div class="chat-msg">☠️ <b>${prenom}</b> est mort(e).</div>` + fil.innerHTML;
  if (playerId === moi.id) {
    document.getElementById('bloc-cimetiere').style.display = 'block';
  }
});

socket.on('resultat_vote', ({ elimineId, egalite }) => {
  const fil = document.getElementById('fil-village');
  document.getElementById('bloc-alerte').style.display = 'block';
  let texte;
  if (elimineId) {
    const j = etatPartie.joueurs.find((x) => x.id === elimineId);
    texte = `Résultat du vote : ${j ? j.prenom : '?'} est éliminé(e).`;
  } else if (egalite) {
    texte = 'Résultat du vote : égalité, personne n\'est éliminé.';
  } else {
    texte = 'Résultat du vote : aucune élimination.';
  }
  fil.innerHTML = `<div class="chat-msg">${texte}</div>` + fil.innerHTML;
});

socket.on('alerte_anonyme', ({ contenu }) => {
  alert(`🚨 Alerte anonyme : ${contenu}`);
});

socket.on('cocon_forme', ({ membres }) => {
  if (membres.includes(moi.id)) {
    document.getElementById('bloc-cocon').style.display = 'block';
  }
});

socket.on('mon_quartier', ({ quartierId }) => {
  moi.quartierId = quartierId;
  document.getElementById('msg-quartier').dataset.quartierId = quartierId;
  document.getElementById('chat-quartier').innerHTML = '';
});

function avatarHtml(j) {
  if (j.avatarData) return `<img class="avatar-rond" src="${j.avatarData}">`;
  return `<span class="avatar-placeholder">${j.prenom.charAt(0).toUpperCase()}</span>`;
}

socket.on('etat_partie', (etat) => {
  etatPartie = etat;
  const liste = document.getElementById('liste-joueurs');
  liste.innerHTML = '';
  etat.joueurs.forEach((j) => {
    const div = document.createElement('div');
    div.className = 'ligne-joueur';
    div.innerHTML = `<span class="${j.statut === 'mort' ? 'mort' : ''}">${avatarHtml(j)}${j.prenom}${j.estMaire ? ' <span class="badge-maire">★ Maire</span>' : ''}</span>`;
    liste.appendChild(div);
  });

  const monJoueur = etat.joueurs.find((j) => j.id === moi.id);
  if (monJoueur && monJoueur.quartierId !== undefined) {
    // Le champ quartierId n'est pas exposé dans vuePublique pour les autres,
    // mais le bloc Quartier reste affiché dès qu'on a rejoint une partie en cours.
  }
  document.getElementById('bloc-quartier').style.display = etat.state === 'jour' ? 'block' : 'none';
  if (moi.cartePhysique === 'loup-garou') {
    document.getElementById('bloc-meute').style.display = 'block';
  }
});

function envoyerMessage(type) {
  let canal;
  if (type === 'quartier') canal = `quartier:${document.getElementById('msg-quartier').dataset.quartierId || ''}`;
  if (type === 'meute') canal = 'meute';
  if (type === 'cocon') canal = 'cocon';
  if (type === 'cimetiere') canal = 'cimetiere';
  const input = document.getElementById(`msg-${type}`);
  const contenu = input.value.trim();
  if (!contenu) return;
  socket.emit('message_quartier', { canal, contenu });
  input.value = '';
}

socket.on('nouveau_message', ({ canal, message }) => {
  let elId;
  if (canal.startsWith('quartier:')) elId = 'chat-quartier';
  if (canal === 'meute') elId = 'chat-meute';
  if (canal === 'cocon') elId = 'chat-cocon';
  if (canal === 'cimetiere') elId = 'chat-cimetiere';
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = `<div class="chat-msg"><b>${message.auteurPrenom}:</b> ${message.contenu}</div>` + el.innerHTML;
});
