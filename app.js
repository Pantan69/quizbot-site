const supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
(function captureReferral() {
  const params = new URLSearchParams(window.location.search);
  const cleaned = (params.get("ref") || "").trim().toUpperCase();
  if (/^[A-Z0-9]{4,12}$/.test(cleaned)) localStorage.setItem(REF_KEY, cleaned);
  if (params.has("ref")) {
    params.delete("ref");
    const qs = params.toString();
    history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
  }
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
function renderAuthForms() {
  const stored = localStorage.getItem(REF_KEY) || "";
  document.getElementById("auth-forms").innerHTML = `
    <h3>Connexion / Inscription</h3>
    <form id="auth-form">
    <input type="email" id="login-email" placeholder="Email" autocomplete="email" maxlength="254">
    <input type="password" id="login-password" placeholder="Mot de passe (10 caractères minimum)" autocomplete="current-password" maxlength="72">
    <input type="text" id="signup-ref" placeholder="Code parrain (optionnel)" value="${esc(stored)}" maxlength="12" autocomplete="off">
    <p id="ref-status" class="muted"></p>
    <button id="login-btn" type="submit">Se connecter</button>
    <button class="secondary" id="signup-btn" type="button">Créer un compte</button>
    </form>
    <p class="error" id="auth-error"></p>
  `;
  const refInput = document.getElementById("signup-ref");
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
  refInput.addEventListener("blur", validateRefField);
  if (stored) validateRefField();

  document.getElementById("auth-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    if (!email || !password) return setMsg("auth-error", "Renseigne ton email et ton mot de passe.", "error");
    const { error } = await supa.auth.signInWithPassword({ email, password });
    // Message volontairement générique : ne pas révéler si l'email existe.
    setMsg("auth-error", error ? "Email ou mot de passe incorrect." : "", "error");
  });

  document.getElementById("signup-btn").onclick = async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const refRaw = refInput.value.trim().toUpperCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg("auth-error", "Adresse email invalide.", "error");
    if (password.length < 10) return setMsg("auth-error", "Le mot de passe doit faire au moins 10 caractères.", "error");
    if (refRaw) {
      try {
        if (!(await checkCode(refRaw))) return setMsg("auth-error", "Code parrain invalide.", "error");
      } catch (e) {
        return setMsg("auth-error", e.message, "error");
      }
    }
    const { data, error } = await supa.auth.signUp({
      email, password,
      options: { data: refRaw ? { referral_code: refRaw } : {} },
    });
    if (error) return setMsg("auth-error", "Inscription impossible : " + error.message, "error");
    localStorage.removeItem(REF_KEY); // le parrainage est désormais enregistré sur le compte
    if (!data.session) setMsg("auth-error", "Compte créé -- consulte ta boîte mail pour confirmer ton adresse, puis connecte-toi.", "success");
  };
}

async function refreshAuthUI() {
  const authSection = document.getElementById("auth-section");
  const appSection = document.getElementById("app-section");
  const goodbye = document.getElementById("goodbye-section");
  if (accountDeleted) {
    authSection.hidden = true; appSection.hidden = true; goodbye.hidden = false;
    return;
  }
  const { data: { session } } = await supa.auth.getSession();
  if (session?.user) {
    if (session.user.id === currentUserId && !appSection.hidden) return; // rien à recharger
    currentUserId = session.user.id;
    authSection.hidden = true;
    appSection.hidden = false;
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
    renderAuthForms();
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supa.auth.signOut();
  currentUserId = null;
  refreshAuthUI();
});

supa.auth.onAuthStateChange((event) => {
  if (event === "TOKEN_REFRESHED") return;
  refreshAuthUI();
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
// Mes licences
// ---------------------------------------------------------------------
async function loadLicenses() {
  const el = document.getElementById("licenses-list");
  const { data, error } = await supa.from("licenses").select("*").order("created_at", { ascending: false });
  if (error) { el.innerHTML = `<p class="error">${esc(error.message)}</p>`; return 0; }
  if (!data || data.length === 0) {
    el.innerHTML = `<p class="muted">Aucune licence pour le moment -- va dans l'onglet "Acheter".</p>`;
    return 0;
  }
  el.innerHTML = data.map((l) => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border);">
      <span class="license-key">${esc(l.license_key)}</span>
      <span class="badge ${l.disabled ? "bad" : "ok"}">${l.disabled ? "Désactivée" : "Active"}</span>
      ${l.disabled ? `<p class="muted">${esc(l.disabled_reason || "")}</p>` : ""}
    </div>
  `).join("");
  return data.length;
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
  document.getElementById("delete-password-input").value = "";
  refreshAuthUI();
}

document.getElementById("delete-account-btn").addEventListener("click", () => {
  setMsg("delete-msg", "");
  if (!window.confirm("Supprimer définitivement ton compte ? Cette action est irréversible et ta licence sera désactivée.")) return;
  deleteAccount(false);
});

refreshAuthUI();
