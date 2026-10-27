// auth.storage : où supabase-js range la session. QBAuth.storage (auth-ui.js) choisit localStorage ou sessionStorage selon
// la case « Rester connecté » (décochée : la session disparaît à la fermeture de l'onglet).
const supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: QBAuth.storage } });

// getSession() peut attendre très longtemps si le navigateur ne joint pas Supabase pour rafraîchir une session
// périmée (réseau filtré, extension, mise en veille). Au-delà de 6 s on considère qu'il n'y a pas de session et on
// affiche le formulaire de connexion ; se reconnecter remplace la session périmée.
async function getSessionSafe() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ data: { session: null } }), 6000));
  try {
    return await Promise.race([supa.auth.getSession(), timeout]);
  } catch (e) {
    return { data: { session: null } };
  }
}

const REF_KEY = "quizbot_referral_code";
const TABS = ["acheter", "licences", "parrainage", "support", "compte"];
let currentUserId = null;
let accountDeleted = false;

// ---------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------
// Toute valeur venant d'un utilisateur ou de la base passe par esc() avant d'aller dans innerHTML.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function euros(cents) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function setMsg(id, text, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = kind || "";
}

// -- Code parrain dans l'URL (?ref=CODE) : format strict, gardé en mémoire puis retiré de la barre d'adresse.
// Renvoie true si le visiteur arrive avec un code de format valide (il vient d'un lien de parrainage : on lui ouvre « Créer un compte »).
const ARRIVED_WITH_REF = (function captureReferral() {
  const params = new URLSearchParams(window.location.search);
  const cleaned = (params.get("ref") || "").trim().toUpperCase();
  const valid = /^[A-Z0-9]{4,12}$/.test(cleaned);
  if (valid) localStorage.setItem(REF_KEY, cleaned);
  if (params.has("ref")) {
    params.delete("ref");
    const qs = params.toString();
    history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
  }
  return valid;
})();

async function apiCall(path, body) {
  const { data: sessionData } = await supa.auth.getSession();
  const token = sessionData?.session?.access_token;
  let resp;
  try {
    resp = await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    throw new Error("Connexion au serveur impossible. Vérifie ta connexion internet.");
  }
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(json.error || "Erreur serveur.");
    err.status = resp.status;
    err.data = json;
    throw err;
  }
  return json;
}

// Le code existe-t-il vraiment ? (vérifié côté serveur -- jamais un simple test de format)
async function checkCode(code) {
  const { valid } = await apiCall("check-referral-code", { code });
  return valid === true;
}

// ---------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------
// Les formulaires ne sont (re)construits qu'une fois par affichage : un évènement tardif de supabase-js (INITIAL_SESSION,
// SIGNED_OUT…) ne doit pas effacer ce que l'utilisateur est en train de taper, ni son message d'erreur.
let authFormsRendered = false;
// Premier affichage seulement : arrivée par un lien de parrainage ou par /compte/#creer -> on ouvre « Créer un compte ».
let preferSignupOnce = ARRIVED_WITH_REF || window.location.hash === "#creer";

function renderAuthForms() {
  const stored = localStorage.getItem(REF_KEY) || "";
  const savedEmail = QBAuth.getRememberedEmail();
  const byId = (id) => document.getElementById(id);
  // Deux écrans distincts (onglets accessibles) : « Se connecter » et « Créer un compte ». Toute valeur dynamique passe par esc().
  // Les deux panneaux existent dans la page ; celui qui n'est pas affiché est « hidden » (on garde donc ce qui a été tapé).
  byId("auth-forms").innerHTML = `
    <div class="auth-tabs" role="tablist" aria-label="Connexion ou création de compte">
      <button type="button" class="auth-tab" role="tab" id="tab-login" aria-controls="panel-login" aria-selected="true" data-mode="login">Se connecter</button>
      <button type="button" class="auth-tab" role="tab" id="tab-signup" aria-controls="panel-signup" aria-selected="false" tabindex="-1" data-mode="signup">Créer un compte</button>
    </div>

    <div role="tabpanel" id="panel-login" aria-labelledby="tab-login">
      <form id="login-form" class="auth-form" method="post" novalidate>
        <label class="field-label" for="login-email">Adresse e-mail</label>
        <input type="email" id="login-email" name="email" autocomplete="username" maxlength="254" autocapitalize="none" spellcheck="false" value="${esc(savedEmail)}">
        <label class="field-label" for="login-password">Mot de passe</label>
        <input type="password" id="login-password" name="password" autocomplete="current-password" maxlength="72" data-pw-toggle>
        <label class="check-row"><input type="checkbox" id="login-stay"${QBAuth.isPersistent() ? " checked" : ""}> <span>Rester connecté</span></label>
        <label class="check-row"><input type="checkbox" id="login-remember"${savedEmail ? " checked" : ""}> <span>Se souvenir de mon e-mail</span></label>
        <p class="error" id="login-msg" role="alert"></p>
        <button id="login-btn" class="auth-submit" type="submit">Se connecter</button>
      </form>
    </div>

    <div role="tabpanel" id="panel-signup" aria-labelledby="tab-signup" hidden>
      <form id="signup-form" class="auth-form" method="post" novalidate>
        <label class="field-label" for="signup-email">Adresse e-mail</label>
        <input type="email" id="signup-email" name="email" autocomplete="username" maxlength="254" autocapitalize="none" spellcheck="false">
        <label class="field-label" for="signup-password">Mot de passe</label>
        <input type="password" id="signup-password" name="new-password" autocomplete="new-password" maxlength="72" data-pw-toggle aria-describedby="signup-password-hint">
        <p class="muted field-hint" id="signup-password-hint">${QBAuth.MIN_PASSWORD} caractères minimum.</p>
        <label class="field-label" for="signup-password2">Confirmer le mot de passe</label>
        <input type="password" id="signup-password2" name="confirm-password" autocomplete="new-password" maxlength="72" data-pw-toggle>
        <label class="field-label" for="signup-ref">Code parrain (optionnel)</label>
        <input type="text" id="signup-ref" value="${esc(stored)}" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <p id="ref-status" class="muted" aria-live="polite"></p>
        <p class="error" id="signup-msg" role="alert"></p>
        <button id="signup-btn" class="auth-submit" type="submit">Créer mon compte</button>
      </form>
    </div>
  `;
  QBAuth.enhancePasswordFields(byId("auth-forms"));

  // -- Onglets (motif ARIA « tabs » : flèches gauche/droite, Début/Fin ; seul l'onglet actif est dans l'ordre de tabulation) ----
  const MODES = ["login", "signup"];
  function showMode(mode, focusTab) {
    const other = mode === "login" ? "signup" : "login";
    MODES.forEach((m) => {
      const on = m === mode;
      const tab = byId(`tab-${m}`);
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      byId(`panel-${m}`).hidden = !on;
    });
    setMsg("login-msg", "");
    setMsg("signup-msg", "");
    // Pratique : l'adresse déjà tapée suit d'un écran à l'autre (sans écraser ce qui est déjà saisi).
    const from = byId(`${other}-email`), to = byId(`${mode}-email`);
    if (!to.value && from.value) to.value = from.value;
    if (focusTab) byId(`tab-${mode}`).focus();
  }
  MODES.forEach((m) => byId(`tab-${m}`).addEventListener("click", () => showMode(m, false)));
  byId("auth-forms").querySelector('[role="tablist"]').addEventListener("keydown", (ev) => {
    const current = byId("tab-signup").getAttribute("aria-selected") === "true" ? "signup" : "login";
    let next = null;
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") next = current === "login" ? "signup" : "login";
    else if (ev.key === "Home") next = "login";
    else if (ev.key === "End") next = "signup";
    if (next) { ev.preventDefault(); showMode(next, true); }
  });
  // Un visiteur qui arrive par un lien de parrainage (?ref=) ou par /compte/#creer commence sur « Créer un compte ».
  if (preferSignupOnce) showMode("signup", false);
  preferSignupOnce = false;

  // -- Champs : une erreur est annoncée, le champ fautif est signalé (aria-invalid) et reçoit le focus ----------------------
  byId("auth-forms").addEventListener("input", (ev) => ev.target.removeAttribute("aria-invalid"));
  function fail(msgId, text, field) {
    setMsg(msgId, text, "error");
    if (field) { field.setAttribute("aria-invalid", "true"); field.focus(); }
  }
  async function busy(btn, work) {   // bouton inactif pendant l'appel : pas de double envoi
    btn.disabled = true;
    try { return await work(); } finally { btn.disabled = false; }
  }

  // -- Code parrain (inchangé : vérifié côté serveur, jamais un simple test de format) -------------------------------------
  const refInput = byId("signup-ref");
  const validateRefField = async () => {
    const v = refInput.value.trim().toUpperCase();
    if (!v) return setMsg("ref-status", "");
    try {
      const ok = await checkCode(v);
      setMsg("ref-status", ok ? "✓ Code parrain valide -- tu auras -15% sur ta licence." : "✗ Code parrain invalide.", ok ? "success" : "error");
      return ok;
    } catch (e) {
      setMsg("ref-status", e.message, "error");
    }
  };
  refInput.addEventListener("blur", (ev) => {
    // Si le clic va sur « Créer mon compte », on ne vérifie pas ici : le code est de toute façon vérifié à l'envoi, et un message
    // qui apparaîtrait maintenant décalerait le bouton entre l'appui et le relâchement de la souris (le clic serait perdu).
    if (ev.relatedTarget && ev.relatedTarget.id === "signup-btn") return;
    validateRefField();
  });
  refInput.addEventListener("input", () => setMsg("ref-status", ""));   // le code change : l'ancien verdict ne vaut plus
  if (stored) validateRefField();

  // -- Connexion ---------------------------------------------------------------------------------------------------
  byId("login-remember").addEventListener("change", (ev) => {
    const email = byId("login-email").value.trim();
    // Décoché : l'adresse mémorisée est effacée tout de suite. Coché : on la garde dès qu'elle ressemble à une adresse.
    if (!ev.target.checked) QBAuth.rememberEmail("", false);
    else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) QBAuth.rememberEmail(email, true);
  });
  byId("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const emailEl = byId("login-email"), passEl = byId("login-password");
    const email = emailEl.value.trim();
    const password = passEl.value;
    setMsg("login-msg", "");
    if (!email || !password) return fail("login-msg", "Renseigne ton e-mail et ton mot de passe.", email ? passEl : emailEl);
    QBAuth.setPersistent(byId("login-stay").checked);                 // AVANT la connexion : décide où la session sera rangée
    QBAuth.rememberEmail(email, byId("login-remember").checked);      // l'adresse seule, jamais le mot de passe
    await busy(byId("login-btn"), async () => {
      let error = null;
      try {
        ({ error } = await supa.auth.signInWithPassword({ email, password }));
      } catch (e) {
        error = e;   // réseau coupé : supabase-js peut lever l'erreur au lieu de la renvoyer
      }
      // Message en français et volontairement générique : ne pas révéler si l'e-mail existe.
      if (error) return fail("login-msg", QBAuth.errorMessage(error, "login"), passEl);   // le mot de passe tapé reste : on peut le vérifier avec l'œil
      passEl.value = "";
    });
  });

  // -- Création de compte ------------------------------------------------------------------------------------------
  byId("signup-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const emailEl = byId("signup-email"), passEl = byId("signup-password"), pass2El = byId("signup-password2");
    const email = emailEl.value.trim();
    const password = passEl.value;
    const refRaw = refInput.value.trim().toUpperCase();
    setMsg("signup-msg", "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("signup-msg", "Adresse e-mail invalide.", emailEl);
    if (password.length < QBAuth.MIN_PASSWORD) return fail("signup-msg", `Le mot de passe doit faire au moins ${QBAuth.MIN_PASSWORD} caractères.`, passEl);
    if (pass2El.value !== password) return fail("signup-msg", "Les deux mots de passe ne sont pas identiques.", pass2El);
    await busy(byId("signup-btn"), async () => {
      if (refRaw) {
        try {
          if (!(await checkCode(refRaw))) return fail("signup-msg", "Code parrain invalide.", refInput);
        } catch (e) {
          return fail("signup-msg", e.message, refInput);
        }
      }
      let result;
      try {
        result = await supa.auth.signUp({
          email, password,
          options: { data: refRaw ? { referral_code: refRaw } : {} },
        });
      } catch (e) {
        result = { error: e };
      }
      if (result.error) return fail("signup-msg", QBAuth.errorMessage(result.error, "signup"));
      localStorage.removeItem(REF_KEY); // le parrainage est désormais enregistré sur le compte
      passEl.value = "";
      pass2El.value = "";
      if (!result.data.session) setMsg("signup-msg", "Compte créé -- consulte ta boîte mail pour confirmer ton adresse, puis connecte-toi.", "success");
    });
  });
}

async function refreshAuthUI() {
  const authSection = document.getElementById("auth-section");
  const appSection = document.getElementById("app-section");
  const goodbye = document.getElementById("goodbye-section");
  if (accountDeleted) {
    authSection.hidden = true; appSection.hidden = true; goodbye.hidden = false;
    return;
  }
  const { data: { session } } = await getSessionSafe();
  if (session?.user) {
    if (session.user.id === currentUserId && !appSection.hidden) return; // rien à recharger
    currentUserId = session.user.id;
    authSection.hidden = true;
    appSection.hidden = false;
    // On détruit les formulaires : plus aucun mot de passe tapé ne reste dans la page une fois connecté (ni après déconnexion).
    document.getElementById("auth-forms").innerHTML = "";
    authFormsRendered = false;
    document.getElementById("user-email").textContent = session.user.email;
    await loadLicenses();
    loadProducts();
    loadReferral();
    loadProfile();
    handlePurchaseReturn();
  } else {
    currentUserId = null;
    authSection.hidden = false;
    appSection.hidden = true;
    if (!authFormsRendered) { renderAuthForms(); authFormsRendered = true; }
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supa.auth.signOut();
  currentUserId = null;
  refreshAuthUI();
});

// IMPORTANT : ne jamais appeler d'autre méthode de supabase-js directement dans cet écouteur (il s'exécute pendant que
// la bibliothèque tient son verrou : getSession() y attendrait indéfiniment et la page resterait vide). On diffère.
supa.auth.onAuthStateChange((event) => {
  if (event === "TOKEN_REFRESHED") return;
  setTimeout(() => { refreshAuthUI(); }, 0);
});

// ---------------------------------------------------------------------
// Onglets
// ---------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});
function selectTab(name) {
  document.querySelector(`.tab-btn[data-tab="${TABS.includes(name) ? name : "acheter"}"]`)?.click();
}
selectTab((window.location.hash || "#acheter").slice(1));

// ---------------------------------------------------------------------
// Acheter
// ---------------------------------------------------------------------
async function loadProducts() {
  const el = document.getElementById("products-list");
  const { data: settings, error } = await supa.from("settings").select("*").eq("id", 1).maybeSingle();
  if (error || !settings) {
    el.innerHTML = `<p class="muted">Aucune offre disponible pour le moment.</p>`;
    return;
  }

  // Un parrain posé à l'inscription est définitif ; sinon on accepte un code saisi ici (vérifié côté serveur).
  const { data: profile } = await supa.from("profiles").select("referred_by").eq("user_id", currentUserId).maybeSingle();
  const hasReferrer = !!profile?.referred_by;
  let code = hasReferrer ? null : localStorage.getItem(REF_KEY);
  if (code) {
    try {
      if (!(await checkCode(code))) { localStorage.removeItem(REF_KEY); code = null; }
    } catch (e) { code = null; }
  }
  const discounted = hasReferrer || !!code;

  let finalCents = settings.price_cents;
  const lines = [];
  if (settings.seasonal_promo_active) {
    finalCents -= Math.round(settings.base_price_cents * settings.seasonal_promo_percent);
    lines.push(`🎉 ${esc(settings.seasonal_promo_label || "Promo en cours")} (-${Math.round(settings.seasonal_promo_percent * 100)}%)`);
  }
  if (discounted) {
    finalCents -= Math.round(settings.base_price_cents * settings.referral_discount_percent);
    lines.push(`👥 Code parrain appliqué (-${Math.round(settings.referral_discount_percent * 100)}%)`);
  }
  finalCents = Math.max(finalCents, 100);

  el.innerHTML = `
    <div style="padding:10px 0;">
      <p>
        <span style="text-decoration:line-through;color:var(--muted);">${euros(settings.base_price_cents)}</span>
        &nbsp;<strong style="font-size:1.3rem;">${euros(finalCents)}</strong>
      </p>
      ${lines.map((l) => `<p class="muted">${l}</p>`).join("")}
      <p class="muted">✅ <strong>Testé, sinon remboursé</strong> : essaie ${esc(settings.trial_questions)} questions sur ta propre session ;
      si ça ne te convient pas, remboursement sans condition sous ${esc(settings.withdrawal_days)} jours.</p>
      ${hasReferrer ? "" : `
        <div style="margin:12px 0;">
          <input type="text" id="buy-ref-input" placeholder="Code parrain (optionnel)" value="${esc(code || "")}" maxlength="12" autocomplete="off" style="max-width:240px;">
          <button class="secondary" id="apply-ref-btn">Appliquer</button>
          <p id="buy-ref-msg"></p>
        </div>`}
      <button id="buy-btn">Acheter</button>
      <p id="buy-msg"></p>
    </div>
  `;

  document.getElementById("apply-ref-btn")?.addEventListener("click", async () => {
    const v = document.getElementById("buy-ref-input").value.trim().toUpperCase();
    if (!v) { localStorage.removeItem(REF_KEY); return loadProducts(); }
    try {
      if (await checkCode(v)) { localStorage.setItem(REF_KEY, v); loadProducts(); }
      else setMsg("buy-ref-msg", "Code parrain invalide.", "error");
    } catch (e) {
      setMsg("buy-ref-msg", e.message, "error");
    }
  });

  document.getElementById("buy-btn").addEventListener("click", async () => {
    const btn = document.getElementById("buy-btn");
    btn.disabled = true;
    btn.textContent = "Redirection...";
    try {
      const { url } = await apiCall("create-checkout", { referral_code: code || undefined });
      // Défense en profondeur : on ne redirige que vers le domaine de paiement Stripe.
      if (typeof url !== "string" || !/^https:\/\/checkout\.stripe\.com\//.test(url)) throw new Error("Réponse de paiement inattendue.");
      window.location.href = url;
    } catch (e) {
      setMsg("buy-msg", e.message, "error");
      btn.disabled = false;
      btn.textContent = "Acheter";
    }
  });
}

// ---------------------------------------------------------------------
// Mes licences : essai gratuit, renonciation au droit de rétractation, remboursement
// ---------------------------------------------------------------------
// Version du texte ci-dessous : envoyée avec la renonciation et conservée en base comme PREUVE de ce qui a été
// accepté. À incrémenter à chaque modification du texte (le serveur refuse une version qu'il ne connaît pas).
const WAIVER_VERSION = "2026-09-v1";
const WAIVER_TEXT = "Je demande l'exécution immédiate du contrat, c'est-à-dire l'accès complet et illimité au logiciel, " +
  "avant la fin du délai de rétractation de 14 jours. Je reconnais qu'en cas d'exécution complète du contrat avec mon accord " +
  "préalable exprès, je perds mon droit de rétractation (article L221-28, 13° du Code de la consommation) : ma licence ne sera " +
  "plus remboursable au titre du droit de rétractation.";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function waiverBoxHtml(id, buttonLabel) {
  return `
    <div class="waiver-box" data-license="${esc(id)}">
      <label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0;">
        <input type="checkbox" class="waiver-check" style="width:auto;margin-top:4px;">
        <span>${esc(WAIVER_TEXT)}</span>
      </label>
      <button class="waive-btn" disabled>${esc(buttonLabel)}</button>
    </div>`;
}

function licenseCardHtml(l, trialLimit) {
  const deadline = fmtDate(l.withdrawal_deadline);
  let badge, body;
  if (l.disabled) {
    badge = `<span class="badge bad">Désactivée</span>`;
    body = `<p class="muted">${esc(l.disabled_reason || "")}</p>`;
  } else if (l.mode === "full") {
    badge = `<span class="badge ok">Licence complète</span>`;
    body = `<p class="muted">Utilisation complète activée. ${l.waived
      ? "Tu as renoncé à ton droit de rétractation."
      : "Le délai de rétractation est écoulé."}</p>`;
  } else if (l.mode === "trial") {
    const pct = Math.round((l.questions_used / trialLimit) * 100);
    badge = `<span class="badge trial">Essai en cours</span>`;
    body = `
      <p>Essai : <strong>${l.questions_used} / ${trialLimit}</strong> questions utilisées.</p>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <p class="muted">Teste le bot sur ta propre session : si tu n'es pas satisfait, tu es <strong>remboursé sans condition</strong>
      jusqu'au ${esc(deadline)}.</p>
      <details><summary>Passer à l'utilisation complète dès maintenant</summary>${waiverBoxHtml(l.id, "Je renonce à mon droit de rétractation et je débloque le bot")}</details>`;
  } else if (l.mode === "trial_exhausted") {
    badge = `<span class="badge warn">Essai terminé</span>`;
    body = `
      <p><strong>Ton essai gratuit de ${trialLimit} questions est terminé.</strong> Pour continuer, choisis :</p>
      ${waiverBoxHtml(l.id, "Oui, je renonce à mon droit de rétractation et je débloque le bot")}
      <p><button class="secondary decline-btn" data-license="${esc(l.id)}">Non, je conserve mon droit de rétractation</button></p>
      <p class="muted">Si tu conserves ton droit, le bot reste <strong>bloqué</strong> : tu peux demander le remboursement, ou attendre le
      ${esc(deadline)} (déblocage automatique).</p>`;
  } else { // blocked
    badge = `<span class="badge bad">Bloquée</span>`;
    body = l.refund_requested
      ? `<p>Remboursement demandé : il est en cours de traitement. Le bot est bloqué.</p>`
      : `<p><strong>Utilisation bloquée</strong> : tu as choisi de conserver ton droit de rétractation.
         Le bot sera débloqué automatiquement le <strong>${esc(deadline)}</strong>, ou tu peux :</p>
         ${waiverBoxHtml(l.id, "Renoncer à mon droit de rétractation et débloquer le bot maintenant")}`;
  }
  const canRefund = !l.disabled && !l.waived && !l.refund_requested && new Date(l.withdrawal_deadline) > new Date();
  return `
    <div class="license-card" data-license-id="${esc(l.id)}">
      <div class="license-head"><span class="license-key">${esc(l.license_key)}</span> ${badge}</div>
      ${body}
      ${canRefund ? `<p><button class="secondary refund-btn" data-license="${esc(l.id)}">Demander le remboursement</button></p>` : ""}
      <p class="muted">Téléchargement du logiciel : bientôt disponible.</p>
    </div>`;
}

async function loadLicenses() {
  const el = document.getElementById("licenses-list");
  let data;
  try {
    data = await apiCall("my-licenses", {});
  } catch (e) {
    el.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    return 0;
  }
  if (!data.licenses || data.licenses.length === 0) {
    el.innerHTML = `<p class="muted">Aucune licence pour le moment -- va dans l'onglet "Acheter".</p>`;
    return 0;
  }
  el.innerHTML = data.licenses.map((l) => licenseCardHtml(l, data.trial_limit)).join("");

  // Le bouton de renonciation reste inactif tant que la case n'est pas cochée.
  el.querySelectorAll(".waiver-box").forEach((box) => {
    const check = box.querySelector(".waiver-check");
    const btn = box.querySelector(".waive-btn");
    check.addEventListener("change", () => { btn.disabled = !check.checked; });
    btn.addEventListener("click", async () => {
      if (!check.checked) return;
      if (!window.confirm("Dernière confirmation : tu renonces à ton droit de rétractation et ta licence ne sera plus remboursable. Continuer ?")) return;
      btn.disabled = true;
      try {
        await apiCall("waive-withdrawal", { license_id: box.dataset.license, accept: true, version: WAIVER_VERSION });
        loadLicenses();
      } catch (e) {
        window.alert(e.message);
        btn.disabled = false;
      }
    });
  });
  el.querySelectorAll(".decline-btn").forEach((btn) => btn.addEventListener("click", async () => {
    if (!window.confirm("Tu conserves ton droit de rétractation : le bot restera BLOQUÉ jusqu'à ton remboursement ou jusqu'à la fin du délai de 14 jours. Confirmer ?")) return;
    try {
      await apiCall("decline-waiver", { license_id: btn.dataset.license });
      loadLicenses();
    } catch (e) { window.alert(e.message); }
  }));
  el.querySelectorAll(".refund-btn").forEach((btn) => btn.addEventListener("click", async () => {
    if (!window.confirm("Demander le remboursement de cette licence ? Le bot sera bloqué immédiatement.")) return;
    try {
      await apiCall("request-refund", { license_id: btn.dataset.license });
      loadLicenses();
    } catch (e) { window.alert(e.message); }
  }));
  return data.licenses.length;
}

// Retour de Stripe (?purchased=1) : la licence est créée par le webhook, quelques secondes après le paiement.
async function handlePurchaseReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("purchased") !== "1") return;
  history.replaceState(null, "", window.location.pathname + "#licences");
  selectTab("licences");
  const banner = document.getElementById("licenses-banner");
  banner.innerHTML = `<p class="success">Paiement reçu -- création de ta licence en cours...</p>`;
  let count = await loadLicenses();
  const before = count;
  for (let i = 0; i < 15 && count === before; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    count = await loadLicenses();
  }
  banner.innerHTML = count > before || count > 0
    ? `<p class="success">Merci ! Ta licence est prête ci-dessous.</p>`
    : `<p class="muted">Ta licence n'est pas encore apparue. Recharge la page dans un instant ; sans nouvelle après quelques minutes, contacte le support (onglet Support).</p>`;
}

// ---------------------------------------------------------------------
// Parrainage
// ---------------------------------------------------------------------
async function loadReferral() {
  const linkEl = document.getElementById("referral-link");
  const balEl = document.getElementById("referral-balance");
  const listEl = document.getElementById("withdrawals-list");

  try {
    const { code } = await apiCall("get-or-create-referral-code", {});
    const link = `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(code)}`;
    linkEl.innerHTML = `<p>Ton code : <strong>${esc(code)}</strong></p><p class="muted">${esc(link)}</p>
      <button id="copy-link-btn">Copier le lien</button>`;
    document.getElementById("copy-link-btn").onclick = () => {
      navigator.clipboard.writeText(link);
      document.getElementById("copy-link-btn").textContent = "Copié !";
    };
  } catch (e) {
    linkEl.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }

  const [{ data: credits }, { data: settings }] = await Promise.all([
    supa.from("referral_credits").select("*"),
    supa.from("settings").select("withdrawal_min_cents").eq("id", 1).maybeSingle(),
  ]);
  const minCents = settings?.withdrawal_min_cents ?? 500;
  const now = Date.now();
  const sum = (arr) => arr.reduce((s, c) => s + c.amount_cents, 0);
  const pending = (credits || []).filter((c) => c.status === "pending");
  const availableCredits = pending.filter((c) => new Date(c.available_at).getTime() <= now);
  const holdCredits = pending.filter((c) => new Date(c.available_at).getTime() > now);
  const available = sum(availableCredits);
  const hold = sum(holdCredits);
  const requested = sum((credits || []).filter((c) => c.status === "requested"));
  const paid = sum((credits || []).filter((c) => c.status === "paid"));
  const nextRelease = holdCredits.length
    ? new Date(Math.min(...holdCredits.map((c) => new Date(c.available_at).getTime()))).toLocaleDateString("fr-FR")
    : null;

  balEl.innerHTML = `
    <p>Disponible au retrait : <strong>${euros(available)}</strong></p>
    <p class="muted">En période de carence : ${euros(hold)}${nextRelease ? ` (prochaine libération le ${esc(nextRelease)})` : ""}
      -- Retrait en cours : ${euros(requested)} -- Déjà versé : ${euros(paid)}</p>
    ${available < minCents ? `<p class="muted">Retrait possible à partir de ${euros(minCents)} disponibles.</p>` : ""}
  `;
  document.getElementById("withdrawal-form").hidden = available < minCents;

  const { data: withdrawals } = await supa.from("withdrawal_requests").select("*").order("requested_at", { ascending: false });
  const label = { pending: "En cours", paid: "Versé", rejected: "Rejeté (gains remis à disposition)" };
  listEl.innerHTML = (withdrawals && withdrawals.length)
    ? `<table><tr><th>Date</th><th>Montant</th><th>Statut</th></tr>` +
      withdrawals.map((w) => `<tr><td>${esc(new Date(w.requested_at).toLocaleDateString("fr-FR"))}</td><td>${euros(w.amount_cents)}</td>
        <td>${esc(label[w.status] || w.status)}${w.status === "rejected" && w.admin_note ? `<br><span class="muted">${esc(w.admin_note)}</span>` : ""}</td></tr>`).join("") +
      `</table>`
    : `<p class="muted">Aucune demande pour le moment.</p>`;
}

document.getElementById("withdraw-btn").addEventListener("click", async () => {
  const iban = document.getElementById("iban-input").value.trim();
  const account_holder_name = document.getElementById("holder-input").value.trim();
  if (!iban || !account_holder_name) return setMsg("withdraw-msg", "IBAN et nom du titulaire requis.", "error");
  try {
    const res = await apiCall("request-withdrawal", { iban, account_holder_name });
    document.getElementById("iban-input").value = "";
    document.getElementById("holder-input").value = "";
    setMsg("withdraw-msg", `Demande envoyée pour ${euros(res.amount_cents)} -- traitée sous 3 jours ouvrés.`, "success");
    loadReferral();
  } catch (e) {
    setMsg("withdraw-msg", e.message, "error");
  }
});

// ---------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------
let chatHistory = [];

function appendChatMsg(role, text) {
  const log = document.getElementById("chat-log");
  const div = document.createElement("div");
  div.className = `chat-msg ${role === "user" ? "user" : "bot"}`;
  div.textContent = text; // textContent : jamais interprété comme du HTML
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

document.getElementById("chat-send-btn").addEventListener("click", async () => {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  appendChatMsg("user", text);
  chatHistory.push({ role: "user", content: text });
  chatHistory = chatHistory.slice(-12);
  try {
    const { reply } = await apiCall("support-chat", { messages: chatHistory });
    appendChatMsg("bot", reply);
    chatHistory.push({ role: "assistant", content: reply });
  } catch (e) {
    appendChatMsg("bot", e.status === 429 ? e.message : "Le chat est indisponible pour le moment -- utilise \"Parler à un humain\".");
  }
});
document.getElementById("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("chat-send-btn").click();
});

document.getElementById("human-btn").addEventListener("click", () => {
  document.getElementById("human-form").hidden = false;
});

document.getElementById("human-send-btn").addEventListener("click", async () => {
  const message = document.getElementById("human-message").value.trim();
  if (!message) return;
  try {
    await apiCall("support-ticket", { message, chatbot_transcript: chatHistory });
    setMsg("human-msg", "Message envoyé -- on te répond au plus vite.", "success");
    document.getElementById("human-message").value = "";
  } catch (e) {
    setMsg("human-msg", e.message, "error");
  }
});

// ---------------------------------------------------------------------
// Mon compte : profil, mot de passe, suppression
// ---------------------------------------------------------------------
async function loadProfile() {
  const { data } = await supa.from("profiles").select("first_name,last_name").eq("user_id", currentUserId).maybeSingle();
  document.getElementById("first-name-input").value = data?.first_name || "";
  document.getElementById("last-name-input").value = data?.last_name || "";
}

document.getElementById("save-profile-btn").addEventListener("click", async () => {
  const first_name = document.getElementById("first-name-input").value.trim().slice(0, 80) || null;
  const last_name = document.getElementById("last-name-input").value.trim().slice(0, 80) || null;
  const { error } = await supa.from("profiles").update({ first_name, last_name }).eq("user_id", currentUserId);
  setMsg("profile-msg", error ? "Enregistrement impossible." : "Profil enregistré.", error ? "error" : "success");
});

document.getElementById("change-password-btn").addEventListener("click", async () => {
  const password = document.getElementById("new-password-input").value;
  if (password.length < 10) return setMsg("password-msg", "Le mot de passe doit faire au moins 10 caractères.", "error");
  const { error } = await supa.auth.updateUser({ password });
  if (!error) document.getElementById("new-password-input").value = "";
  setMsg("password-msg", error ? "Changement impossible : " + error.message : "Mot de passe modifié.", error ? "error" : "success");
});

async function deleteAccount(confirmForfeit) {
  try {
    await apiCall("delete-account", {
      confirm_email: document.getElementById("delete-email-input").value.trim(),
      password: document.getElementById("delete-password-input").value,
      confirm_forfeit: confirmForfeit === true,
    });
  } catch (e) {
    // Gains non versés : on demande une confirmation explicite avant de les perdre.
    if (e.status === 409 && e.data?.code === "balance_forfeit" && !confirmForfeit) {
      if (window.confirm(`${e.data.error}\n\nContinuer et perdre ces gains ?`)) return deleteAccount(true);
      return;
    }
    return setMsg("delete-msg", e.message, "error");
  }
  // Succès : on vide tout ce qui reste côté navigateur.
  accountDeleted = true;
  await supa.auth.signOut({ scope: "local" });
  localStorage.removeItem(REF_KEY);
  QBAuth.rememberEmail("", false); // l'adresse mémorisée pour la connexion est une donnée personnelle : effacée aussi
  document.getElementById("delete-password-input").value = "";
  refreshAuthUI();
}

document.getElementById("delete-account-btn").addEventListener("click", () => {
  setMsg("delete-msg", "");
  if (!window.confirm("Supprimer définitivement ton compte ? Cette action est irréversible et ta licence sera désactivée.")) return;
  deleteAccount(false);
});

refreshAuthUI();
