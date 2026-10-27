// Filet de sécurité : une page ne doit jamais rester vide sans explication.
// Si, 8 secondes après le chargement, aucune section de la page n'est affichée, c'est que l'initialisation est
// bloquée (session enregistrée périmée ou invalide, stockage du navigateur bloqué, extension qui coupe la connexion…).
// On affiche alors un message clair et un bouton pour repartir d'une session propre.
// Aucun secret, aucune donnée : le bouton efface seulement les clés « sb-… » de CE site dans le navigateur.
(function () {
  "use strict";
  var IDS = ["auth-section", "app-section", "goodbye-section", "denied-section", "admin-section"];

  function nothingVisible() {
    var found = false;
    for (var i = 0; i < IDS.length; i++) {
      var el = document.getElementById(IDS[i]);
      if (!el) continue;
      found = true;
      if (!el.hidden) return false;
    }
    return found;
  }

  function resetSession() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("sb-") === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* stockage bloqué : on recharge quand même */ }
    window.location.reload();
  }

  function showHelp() {
    var card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "alert");
    card.id = "init-help";

    var title = document.createElement("h2");
    title.textContent = "La page n’a pas pu se charger";
    var text = document.createElement("p");
    text.textContent =
      "Votre session enregistrée dans ce navigateur est peut-être périmée. Cliquez sur « Repartir de zéro » : " +
      "vous pourrez ensuite vous reconnecter normalement. Si le problème continue, essayez une fenêtre de " +
      "navigation privée ou désactivez vos extensions pour ce site.";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Repartir de zéro";
    btn.addEventListener("click", resetSession);

    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(btn);
    var host = document.querySelector(".wrap") || document.body;
    host.appendChild(card);
  }

  window.setTimeout(function () {
    if (nothingVisible() && !document.getElementById("init-help")) showHelp();
  }, 8000);
})();
