// Aides partagées de l'écran de connexion (/compte/ et /admin/). Chargé AVANT app.js : le client Supabase en a besoin.
// Aucune dépendance, aucun gestionnaire en ligne (CSP : script-src 'self'). Aucun mot de passe n'est lu, stocké ni journalisé ici.
//
// Ce que ce fichier fournit (window.QBAuth) :
//   - storage              : stockage de la session Supabase, choisi selon « Rester connecté » (voir plus bas) ;
//   - isPersistent / setPersistent : lecture / écriture de ce choix (indicateur non secret) ;
//   - getRememberedEmail / rememberEmail : « Se souvenir de mon e-mail » (SEULEMENT l'adresse, jamais le mot de passe) ;
//   - enhancePasswordFields : ajoute le bouton « œil » à chaque <input type="password" data-pw-toggle> ;
//   - errorMessage         : messages d'erreur en français, sans information sensible.
(function () {
  "use strict";

  var PERSIST_KEY = "qb_persist";        // "0" = session limitée à l'onglet ; toute autre valeur (ou absence) = persistante
  var EMAIL_KEY = "qb_remember_email";   // adresse e-mail mémorisée (jamais le mot de passe)
  var MIN_PASSWORD = 10;

  // -- Accès au stockage du navigateur, tolérant aux navigateurs qui le bloquent (mode privé strict, réglages) --------
  function store(name) {
    try { return window[name]; } catch (e) { return null; }
  }
  function tryGet(s, key) {
    try { return s ? s.getItem(key) : null; } catch (e) { return null; }
  }
  function trySet(s, key, value) {
    try { if (!s) return false; s.setItem(key, value); return true; } catch (e) { return false; }
  }
  function tryRemove(s, key) {
    try { if (s) s.removeItem(key); } catch (e) { /* stockage bloqué : rien à faire */ }
  }

  // -- « Rester connecté » -------------------------------------------------------------------------------------------
  // supabase-js garde la session (jetons) sous une clé « sb-…-auth-token ». Par défaut il l'écrit dans localStorage, qui
  // survit à la fermeture du navigateur. On lui fournit à la place un petit « adaptateur » (getItem/setItem/removeItem) :
  //   - case cochée (défaut)  -> localStorage   (la session survit à la fermeture : comportement d'avant) ;
  //   - case décochée          -> sessionStorage (la session disparaît à la fermeture de l'onglet).
  // Le choix est mémorisé dans localStorage sous « qb_persist » (indicateur non secret). À la lecture on regarde dans LES DEUX
  // stockages (celui du choix d'abord) : une session déjà enregistrée par l'ancienne version du site reste donc lisible.
  function isPersistent() {
    return tryGet(store("localStorage"), PERSIST_KEY) !== "0";
  }
  function setPersistent(on) {
    trySet(store("localStorage"), PERSIST_KEY, on ? "1" : "0");
  }

  var memory = {};   // dernier recours si le navigateur bloque TOUT stockage : la session tient jusqu'au rechargement
  var storage = {
    getItem: function (key) {
      var ls = store("localStorage"), ss = store("sessionStorage");
      var order = isPersistent() ? [ls, ss] : [ss, ls];
      for (var i = 0; i < order.length; i++) {
        var v = tryGet(order[i], key);
        if (v !== null && v !== undefined) return v;
      }
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    },
    setItem: function (key, value) {
      var ls = store("localStorage"), ss = store("sessionStorage");
      var persistent = isPersistent();
      var ok = trySet(persistent ? ls : ss, key, value);
      tryRemove(persistent ? ss : ls, key);          // jamais deux copies de la session dans deux stockages
      if (ok) delete memory[key]; else memory[key] = value;
    },
    removeItem: function (key) {
      tryRemove(store("localStorage"), key);
      tryRemove(store("sessionStorage"), key);
      delete memory[key];
    },
  };

  // -- « Se souvenir de mon e-mail » ---------------------------------------------------------------------------------
  function getRememberedEmail() {
    return tryGet(store("localStorage"), EMAIL_KEY) || "";
  }
  function rememberEmail(email, on) {
    var value = String(email || "").trim().slice(0, 254);
    if (on && value) trySet(store("localStorage"), EMAIL_KEY, value);
    else tryRemove(store("localStorage"), EMAIL_KEY);
  }

  // -- Bouton « œil » ------------------------------------------------------------------------------------------------
  // Constante écrite ici (aucune donnée utilisateur) : deux icônes SVG en ligne, l'une ou l'autre affichée par le CSS selon aria-pressed.
  var EYE_SVG =
    '<svg class="icon-on" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
    '<svg class="icon-off" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>' +
    '<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>' +
    '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function enhancePasswordFields(root) {
    var inputs = (root || document).querySelectorAll("input[data-pw-toggle]");
    Array.prototype.forEach.call(inputs, function (input) {
      if (input.parentNode && input.parentNode.classList.contains("pw-field")) return;   // déjà équipé
      var wrap = document.createElement("div");
      wrap.className = "pw-field";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      var btn = document.createElement("button");
      btn.type = "button";                       // jamais « submit » : cliquer sur l'œil n'envoie pas le formulaire
      btn.className = "pw-toggle";
      if (input.id) btn.setAttribute("aria-controls", input.id);
      btn.innerHTML = EYE_SVG;
      function render(visible) {
        var label = visible ? "Masquer le mot de passe" : "Afficher le mot de passe";
        btn.setAttribute("aria-pressed", visible ? "true" : "false");
        btn.setAttribute("aria-label", label);
        btn.title = label;
      }
      render(false);
      btn.addEventListener("click", function () {
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        render(show);
      });
      wrap.appendChild(btn);
    });
  }

  // -- Messages d'erreur en français ---------------------------------------------------------------------------------
  // Jamais le texte brut renvoyé par le serveur (anglais, parfois révélateur) : on classe l'erreur puis on affiche NOTRE message.
  var MSG = {
    badLogin: "E-mail ou mot de passe incorrect.",   // volontairement identique que l'e-mail existe ou non
    notConfirmed: "Cette adresse e-mail n'est pas encore confirmée : clique sur le lien reçu par e-mail, puis reconnecte-toi.",
    tooMany: "Trop de tentatives. Patiente quelques minutes avant de réessayer.",
    network: "Connexion au serveur impossible. Vérifie ta connexion internet puis réessaie.",
    server: "Le service est momentanément indisponible. Réessaie dans un instant.",
    loginOther: "Connexion impossible pour le moment. Réessaie dans un instant.",
    signupRefused: "Inscription impossible avec ces informations. Si tu as déjà un compte, utilise « Se connecter ».",
    weak: "Ce mot de passe est refusé (trop faible ou trop courant). Choisis-en un autre, d'au moins " + MIN_PASSWORD + " caractères.",
    badEmail: "Adresse e-mail invalide.",
    signupClosed: "Les inscriptions sont fermées pour le moment.",
    signupOther: "Inscription impossible pour le moment. Réessaie dans un instant.",
  };

  function classify(err) {
    var e = err || {};
    var status = typeof e.status === "number" ? e.status : null;
    var code = String(e.code || "").toLowerCase();
    var name = String(e.name || "");
    var text = String(e.message || "").toLowerCase();
    if (status === 429 || code.indexOf("rate_limit") !== -1 || /rate limit|too many/.test(text)) return "tooMany";
    if ((name === "AuthRetryableFetchError" && !status) || (status === null && (e instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed/.test(text)))) return "network";
    if ((status !== null && status >= 500) || name === "AuthRetryableFetchError") return "server";
    if (code === "email_not_confirmed" || /not confirmed/.test(text)) return "notConfirmed";
    if (code === "invalid_credentials") return "badLogin";
    if (name === "AuthWeakPasswordError" || code === "weak_password") return "weak";
    if (code === "user_already_exists" || code === "email_exists" || /already (been )?registered|already exists/.test(text)) return "exists";
    if (code === "email_address_invalid" || (code === "validation_failed" && /email/.test(text))) return "badEmail";
    if (code === "signup_disabled" || code === "email_provider_disabled") return "signupClosed";
    if (status === 400 || status === 401 || status === 422) return "client";
    return "other";
  }

  // context : "login" (connexion, y compris /admin/) ou "signup" (création de compte).
  function errorMessage(error, context) {
    var kind = classify(error);
    if (kind === "tooMany" || kind === "network" || kind === "server") return MSG[kind];
    if (context === "signup") {
      if (kind === "exists") return MSG.signupRefused;
      if (kind === "weak") return MSG.weak;
      if (kind === "badEmail") return MSG.badEmail;
      if (kind === "signupClosed") return MSG.signupClosed;
      return MSG.signupOther;
    }
    if (kind === "notConfirmed") return MSG.notConfirmed;
    if (kind === "badLogin" || kind === "client") return MSG.badLogin;
    return MSG.loginOther;
  }

  window.QBAuth = {
    MIN_PASSWORD: MIN_PASSWORD,
    storage: storage,
    isPersistent: isPersistent,
    setPersistent: setPersistent,
    getRememberedEmail: getRememberedEmail,
    rememberEmail: rememberEmail,
    enhancePasswordFields: enhancePasswordFields,
    errorMessage: errorMessage,
  };
})();
