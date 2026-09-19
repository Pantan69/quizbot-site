const supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function euros(cents) {
  return (cents / 100).toFixed(2) + " €";
}

async function checkAccess() {
  const { data: { session } } = await supa.auth.getSession();
  const authSection = document.getElementById("auth-section");
  const deniedSection = document.getElementById("denied-section");
  const adminSection = document.getElementById("admin-section");
  authSection.hidden = true;
  deniedSection.hidden = true;
  adminSection.hidden = true;

  if (!session?.user) {
    authSection.hidden = false;
    return;
  }

  // is_admin() est une fonction SQL security definer -- vérifie CÔTÉ
  // SERVEUR que ce compte est bien admin (jamais une simple URL secrète).
  const { data: isAdmin, error } = await supa.rpc("is_admin");
  if (error || !isAdmin) {
    deniedSection.hidden = false;
    return;
  }

  adminSection.hidden = false;
  document.getElementById("admin-email").textContent = session.user.email;
  loadSalesChart();
  loadWithdrawals();
  loadTickets();
  loadAudit();
}

document.getElementById("login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const { error } = await supa.auth.signInWithPassword({ email, password });
  document.getElementById("auth-error").textContent = error ? error.message : "";
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supa.auth.signOut();
  checkAccess();
});
document.getElementById("logout-denied-btn").addEventListener("click", async () => {
  await supa.auth.signOut();
  checkAccess();
});

supa.auth.onAuthStateChange(() => checkAccess());

// ---------------------------------------------------------------------
// Ventes
// ---------------------------------------------------------------------
async function loadSalesChart() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data } = await supa.from("licenses").select("created_at").gte("created_at", since.toISOString());

  const counts = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    counts[d.toISOString().slice(0, 10)] = 0;
  }
  (data || []).forEach((row) => {
    const day = row.created_at.slice(0, 10);
    if (day in counts) counts[day] += 1;
  });

  new Chart(document.getElementById("sales-chart"), {
    type: "bar",
    data: {
      labels: Object.keys(counts),
      datasets: [{ label: "Ventes", data: Object.values(counts), backgroundColor: "#2e7d32" }],
    },
    options: { scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } },
  });
}

// ---------------------------------------------------------------------
// Retraits
// ---------------------------------------------------------------------
async function loadWithdrawals() {
  const el = document.getElementById("withdrawals-list");
  const { data, error } = await supa
    .from("withdrawal_requests")
    .select("*")
    .order("requested_at", { ascending: true });
  if (error) { el.innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
  if (!data || data.length === 0) {
    el.innerHTML = `<p class="muted">Aucune demande.</p>`;
    return;
  }
  el.innerHTML = `<table><tr><th>Date</th><th>Montant</th><th>IBAN</th><th>Titulaire</th><th>Statut</th><th>Note</th><th></th></tr>` +
    data.map((w) => `
      <tr>
        <td>${esc(new Date(w.requested_at).toLocaleDateString("fr-FR"))}</td>
        <td>${euros(w.amount_cents)}</td>
        <td>${esc(w.iban)}</td>
        <td>${esc(w.account_holder_name)}</td>
        <td>${esc(w.status)}</td>
        <td>${esc(w.admin_note || "")}</td>
        <td>${w.status === "pending"
          ? `<button data-id="${esc(w.id)}" class="mark-paid-btn">Marquer payé</button>
             <button data-id="${esc(w.id)}" class="reject-btn danger">Rejeter</button>` : ""}</td>
      </tr>
    `).join("") + `</table>
    <p class="muted">L'IBAN et le nom du titulaire sont effacés automatiquement dès qu'un retrait est marqué payé ou rejeté : copie-les avant.</p>`;

  // Seul chemin d'écriture : la fonction admin_process_withdrawal (vérifie is_admin(), impose l'état
  // "pending", met à jour les crédits liés ET journalise). Pas de modification libre de la table.
  const process = async (id, action, note) => {
    const { error } = await supa.rpc("admin_process_withdrawal", { p_id: id, p_action: action, p_note: note || null });
    if (error) alert("Action impossible : " + error.message);
    loadWithdrawals();
    loadAudit();
  };
  el.querySelectorAll(".mark-paid-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("As-tu bien effectué le virement ? L'IBAN sera effacé.")) process(btn.dataset.id, "paid");
    });
  });
  el.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const note = prompt("Motif du rejet (visible par l'utilisateur) :");
      if (note !== null) process(btn.dataset.id, "rejected", note);
    });
  });
}

// ---------------------------------------------------------------------
// Tickets support
// ---------------------------------------------------------------------
async function loadTickets() {
  const el = document.getElementById("tickets-list");
  const { data, error } = await supa.from("support_tickets").select("*").order("created_at", { ascending: false });
  if (error) { el.innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
  if (!data || data.length === 0) {
    el.innerHTML = `<p class="muted">Aucun ticket.</p>`;
    return;
  }
  el.innerHTML = data.map((t) => `
    <div style="padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;">
        <strong>${esc(t.email || "(non connecté)")}</strong>
        <span class="badge ${t.status === "open" ? "bad" : "ok"}">${esc(t.status)}</span>
      </div>
      <p>${esc(t.message)}</p>
      <p class="muted">${new Date(t.created_at).toLocaleString()}</p>
      ${t.status === "open" ? `<button data-id="${esc(t.id)}" class="close-ticket-btn">Marquer traité</button>` : ""}
    </div>
  `).join("");

  el.querySelectorAll(".close-ticket-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supa.from("support_tickets").update({ status: "closed" }).eq("id", btn.dataset.id);
      loadTickets();
    });
  });
}

// ---------------------------------------------------------------------
// Journal d'audit
// ---------------------------------------------------------------------
async function loadAudit() {
  const el = document.getElementById("audit-list");
  const { data, error } = await supa.from("audit_log").select("*").order("at", { ascending: false }).limit(50);
  if (error) { el.innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
  if (!data || data.length === 0) { el.innerHTML = `<p class="muted">Aucun événement.</p>`; return; }
  el.innerHTML = `<table><tr><th>Date</th><th>Événement</th><th>Détails</th></tr>` +
    data.map((a) => `<tr><td>${esc(new Date(a.at).toLocaleString("fr-FR"))}</td><td>${esc(a.action)}</td>
      <td class="muted">${esc(JSON.stringify(a.details))}</td></tr>`).join("") + `</table>`;
}

checkAccess();
