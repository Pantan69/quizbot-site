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
}

document.getElementById("login-btn").addEventListener("click", async () => {
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
  el.innerHTML = `<table><tr><th>Date</th><th>Montant</th><th>IBAN</th><th>Titulaire</th><th>Statut</th><th></th></tr>` +
    data.map((w) => `
      <tr>
        <td>${new Date(w.requested_at).toLocaleDateString()}</td>
        <td>${euros(w.amount_cents)}</td>
        <td>${esc(w.iban)}</td>
        <td>${esc(w.account_holder_name)}</td>
        <td>${esc(w.status)}</td>
        <td>${w.status === "pending" ? `<button data-id="${esc(w.id)}" class="mark-paid-btn">Marquer payé</button>` : ""}</td>
      </tr>
    `).join("") + `</table>`;

  el.querySelectorAll(".mark-paid-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supa.from("withdrawal_requests").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", btn.dataset.id);
      // Uniquement les crédits liés à CETTE demande précise (pas ceux
      // d'une autre demande en attente au même moment).
      await supa.from("referral_credits").update({ status: "paid" }).eq("withdrawal_request_id", btn.dataset.id);
      loadWithdrawals();
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

checkAccess();
