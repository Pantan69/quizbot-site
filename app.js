const supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// -- Capture le code de parrainage dans l'URL (?ref=CODE), le garde en
// mémoire même si la personne n'est pas encore connectée -- réutilisé au
// moment de l'achat.
(function captureReferral() {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  if (ref) localStorage.setItem("quizbot_referral_code", ref.toUpperCase());
})();

function euros(cents) {
  return (cents / 100).toFixed(2) + " €";
}

async function apiCall(path, body) {
  const { data: sessionData } = await supa.auth.getSession();
  const token = sessionData?.session?.access_token;
  const resp = await fetch(`${API_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || "Erreur serveur");
  return json;
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
function renderAuthForms() {
  const el = document.getElementById("auth-forms");
  el.innerHTML = `
    <h3>Connexion</h3>
    <input type="email" id="login-email" placeholder="Email">
    <input type="password" id="login-password" placeholder="Mot de passe">
    <button id="login-btn">Se connecter</button>
    <button class="secondary" id="signup-btn">Créer un compte</button>
    <p class="error" id="auth-error"></p>
  `;
  document.getElementById("login-btn").onclick = async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const { error } = await supa.auth.signInWithPassword({ email, password });
    document.getElementById("auth-error").textContent = error ? error.message : "";
  };
  document.getElementById("signup-btn").onclick = async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const { error } = await supa.auth.signUp({ email, password });
    document.getElementById("auth-error").textContent = error
      ? error.message
      : "Compte créé -- vérifie ta boîte mail si une confirmation est demandée, puis connecte-toi.";
  };
}

async function refreshAuthUI() {
  const { data: { session } } = await supa.auth.getSession();
  const authSection = document.getElementById("auth-section");
  const appSection = document.getElementById("app-section");
  if (session?.user) {
    authSection.hidden = true;
    appSection.hidden = false;
    document.getElementById("user-email").textContent = session.user.email;
    loadProducts();
    loadLicenses();
    loadReferral();
  } else {
    authSection.hidden = false;
    appSection.hidden = true;
    renderAuthForms();
  }
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supa.auth.signOut();
  refreshAuthUI();
});

supa.auth.onAuthStateChange(() => refreshAuthUI());

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
  document.querySelector(`.tab-btn[data-tab="${name}"]`)?.click();
}
const initialTab = (window.location.hash || "#acheter").slice(1);
document.addEventListener("DOMContentLoaded", () => selectTab(initialTab));

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

  const referral_code = localStorage.getItem("quizbot_referral_code");
  let finalCents = settings.price_cents;
  const lines = [];
  if (settings.seasonal_promo_active) {
    finalCents -= Math.round(settings.base_price_cents * settings.seasonal_promo_percent);
    lines.push(`🎉 ${settings.seasonal_promo_label || "Promo en cours"} (-${Math.round(settings.seasonal_promo_percent * 100)}%)`);
  }
  if (referral_code) {
    finalCents -= Math.round(settings.base_price_cents * settings.referral_discount_percent);
    lines.push(`👥 Code parrain "${referral_code}" appliqué (-${Math.round(settings.referral_discount_percent * 100)}%)`);
  }
  finalCents = Math.max(finalCents, 0);

  el.innerHTML = `
    <div style="padding:10px 0;">
      <p>
        <span style="text-decoration:line-through;color:var(--muted);">${euros(settings.base_price_cents)}</span>
        &nbsp;<strong style="font-size:1.3rem;">${euros(finalCents)}</strong>
      </p>
      ${lines.map((l) => `<p class="muted">${l}</p>`).join("")}
      <button id="buy-btn">Acheter</button>
    </div>
  `;
  document.getElementById("buy-btn").addEventListener("click", async () => {
    const btn = document.getElementById("buy-btn");
    btn.disabled = true;
    btn.textContent = "Redirection...";
    try {
      const { url } = await apiCall("create-checkout", { referral_code: referral_code || undefined });
      window.location.href = url;
    } catch (e) {
      alert(e.message);
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
  if (error) { el.innerHTML = `<p class="error">${error.message}</p>`; return; }
  if (!data || data.length === 0) {
    el.innerHTML = `<p class="muted">Aucune licence pour le moment -- va dans l'onglet "Acheter".</p>`;
    return;
  }
  el.innerHTML = data.map((l) => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border);">
      <span class="license-key">${l.license_key}</span>
      <span class="badge ${l.disabled ? "bad" : "ok"}">${l.disabled ? "Désactivée" : "Active"}</span>
      ${l.disabled ? `<p class="muted">${l.disabled_reason || ""}</p>` : ""}
    </div>
  `).join("");
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
    const link = `${window.location.origin}${window.location.pathname}?ref=${code}`;
    linkEl.innerHTML = `<p>Ton code : <strong>${code}</strong></p><p class="muted">${link}</p>
      <button id="copy-link-btn">Copier le lien</button>`;
    document.getElementById("copy-link-btn").onclick = () => {
      navigator.clipboard.writeText(link);
      document.getElementById("copy-link-btn").textContent = "Copié !";
    };
  } catch (e) {
    linkEl.innerHTML = `<p class="error">${e.message}</p>`;
  }

  const { data: credits } = await supa.from("referral_credits").select("*");
  const available = (credits || []).filter((c) => c.status === "available").reduce((s, c) => s + c.amount_cents, 0);
  const requested = (credits || []).filter((c) => c.status === "requested").reduce((s, c) => s + c.amount_cents, 0);
  const paid = (credits || []).filter((c) => c.status === "paid").reduce((s, c) => s + c.amount_cents, 0);
  balEl.innerHTML = `
    <p>Disponible : <strong>${euros(available)}</strong></p>
    <p class="muted">En attente de virement : ${euros(requested)} -- Déjà versé : ${euros(paid)}</p>
  `;
  document.getElementById("withdrawal-form").hidden = available <= 0;

  const { data: withdrawals } = await supa.from("withdrawal_requests").select("*").order("requested_at", { ascending: false });
  listEl.innerHTML = (withdrawals && withdrawals.length)
    ? `<table><tr><th>Date</th><th>Montant</th><th>Statut</th></tr>` +
      withdrawals.map((w) => `<tr><td>${new Date(w.requested_at).toLocaleDateString()}</td><td>${euros(w.amount_cents)}</td><td>${w.status}</td></tr>`).join("") +
      `</table>`
    : `<p class="muted">Aucune demande pour le moment.</p>`;
}

document.getElementById("withdraw-btn").addEventListener("click", async () => {
  const iban = document.getElementById("iban-input").value.trim();
  const account_holder_name = document.getElementById("holder-input").value.trim();
  const msgEl = document.getElementById("withdraw-msg");
  if (!iban || !account_holder_name) {
    msgEl.textContent = "IBAN et nom du titulaire requis.";
    msgEl.className = "error";
    return;
  }
  try {
    const res = await apiCall("request-withdrawal", { iban, account_holder_name });
    msgEl.textContent = `Demande envoyée pour ${euros(res.amount_cents)}.`;
    msgEl.className = "success";
    loadReferral();
  } catch (e) {
    msgEl.textContent = e.message;
    msgEl.className = "error";
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
  div.textContent = text;
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
  try {
    const { reply } = await apiCall("support-chat", { messages: chatHistory });
    appendChatMsg("bot", reply);
    chatHistory.push({ role: "assistant", content: reply });
  } catch (e) {
    appendChatMsg("bot", "Le chat est indisponible pour le moment -- utilise \"Parler à un humain\".");
  }
});

document.getElementById("human-btn").addEventListener("click", () => {
  document.getElementById("human-form").hidden = false;
});

document.getElementById("human-send-btn").addEventListener("click", async () => {
  const message = document.getElementById("human-message").value.trim();
  const msgEl = document.getElementById("human-msg");
  if (!message) return;
  try {
    await apiCall("support-ticket", { message, chatbot_transcript: chatHistory });
    msgEl.textContent = "Message envoyé -- on te répond au plus vite.";
    msgEl.className = "success";
    document.getElementById("human-message").value = "";
  } catch (e) {
    msgEl.textContent = e.message;
    msgEl.className = "error";
  }
});

refreshAuthUI();
