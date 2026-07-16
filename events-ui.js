/* ===================== The 29 World — random event popups =====================
   Weekly random events are assigned to every student once per NZ calendar
   week (see processWeeklyEvents in data.js). This file just decides whether
   the CURRENT student has any events from this week they haven't been shown
   yet, and if so, pops up a small modal — no matter which tab they land on.
   The weekly limit itself lives in data.js; this only controls when the
   student gets notified about it.
================================================================== */

function eventsShownKey(username) {
  return "anw_events_shown_" + username;
}

function getShownEventState(username) {
  try {
    const raw = localStorage.getItem(eventsShownKey(username));
    return raw ? JSON.parse(raw) : { week: null, ids: [] };
  } catch (e) {
    return { week: null, ids: [] };
  }
}

function saveShownEventState(username, state) {
  try { localStorage.setItem(eventsShownKey(username), JSON.stringify(state)); } catch (e) { /* ignore */ }
}

async function checkWeeklyEventPopup(username, classCode) {
  if (!username || !classCode) return;
  const cls = await getClass(classCode);
  const user = await getUser(username);
  if (!cls || !user) return;
  const weekKey = isoWeekKey(new Date());
  const mine = (cls.eventLog || []).filter(l => l.studentUser === username && l.week === weekKey);
  if (mine.length === 0) return;

  // Multiple-choice events must be answered — show a forced modal (like a
  // big event) for the first pending one, before anything else pops up.
  const pendingChoice = mine.find(l => l.type === "choice" && l.status === "pending");
  if (pendingChoice && !document.getElementById("anwEventModal") && !document.getElementById("anwChoiceEventModal") && !document.getElementById("anwBigEventModal")) {
    showChoiceEventPopup(pendingChoice, username, classCode);
  }

  const resolved = mine.filter(l => l.status !== "pending");
  if (resolved.length === 0) return;

  let state = getShownEventState(username);
  if (state.week !== weekKey) state = { week: weekKey, ids: [] };
  const shown = new Set(state.ids);
  const fresh = resolved.filter(l => !shown.has(l.id || (l.eventId + "|" + l.date)));

  if (fresh.length === 0) return;

  const hasGeneralPlan = (user.insurance || [])
    .map(id => cls.insurancePlans.find(p => p.id === id))
    .some(p => p && p.coverage === "general");

  const withDetails = fresh.map(l => ({
    id: l.id, name: l.name || "Random event", description: (l.type === "choice" && l.outcome) ? l.outcome : (l.description || ""),
    amount: l.amount || 0, severity: l.severity || "neutral", claimed: !!l.claimed,
    claimable: l.severity === "bad" && !l.claimed && hasGeneralPlan
  }));

  showEventPopup(withDetails, username, classCode);

  state.ids = state.ids.concat(resolved.map(l => l.id || (l.eventId + "|" + l.date)));
  saveShownEventState(username, state);
}

// Multiple-choice weekly event popup. Has no close button and can't be
// dismissed by clicking outside — the student must pick an option, which
// resolves the event (applies the balance change) via resolveChoiceEvent.
function showChoiceEventPopup(entry, username, classCode) {
  const overlay = document.createElement("div");
  overlay.id = "anwChoiceEventModal";
  overlay.className = "anw-modal-overlay";

  const optionsHtml = (entry.options || []).map(o => `
    <button class="btn secondary" style="width:100%;justify-content:space-between;" data-opt="${o.id}">
      <span>${o.label}</span>
      <span class="${o.amount < 0 ? 'ticker-down' : 'ticker-up'}">${o.amount >= 0 ? "+" : "-"}${fmtMoney(Math.abs(o.amount))}</span>
    </button>
  `).join("");

  overlay.innerHTML = `
    <div class="anw-modal-card">
      <h2 style="display:flex;align-items:center;gap:9px;">${icon("dice", 24)} ${entry.name}</h2>
      <p>${entry.description || ""}</p>
      <p class="muted-small">You need to choose how to handle this before you can continue.</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
        ${optionsHtml}
      </div>
      <div id="choiceEventMsg"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelectorAll("[data-opt]").forEach(btn => {
    btn.addEventListener("click", async () => {
      overlay.querySelectorAll("button").forEach(b => b.disabled = true);
      const res = await resolveChoiceEvent(username, classCode, entry.id, btn.getAttribute("data-opt"));
      if (res.ok) {
        overlay.remove();
        if (typeof render === "function") render();
      } else {
        document.getElementById("choiceEventMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
        overlay.querySelectorAll("button").forEach(b => b.disabled = false);
      }
    });
  });
}

function showEventPopup(events, username, classCode) {
  const existing = document.getElementById("anwEventModal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "anwEventModal";
  overlay.className = "anw-modal-overlay";

  const rows = events.map(e => `
    <div class="anw-event-row">
      <span class="icon" style="width:26px;height:26px;flex-shrink:0;">${icon("dice", 26)}</span>
      <div style="flex:1;">
        <div class="anw-event-name">${e.name}</div>
        ${e.description ? `<div class="muted-small">${e.description}</div>` : ""}
        ${e.claimable ? `<button class="btn small secondary" style="margin-top:6px;" onclick="claimFromPopup('${e.id}', '${username}', '${classCode}', this)">${icon("shield", 13)} Claim insurance</button>` : ""}
        ${e.claimed ? `<div class="muted-small ticker-up">Claimed on insurance</div>` : ""}
      </div>
      <div class="${e.amount < 0 ? 'ticker-down' : 'ticker-up'}" style="font-weight:900;">
        ${e.amount >= 0 ? "+" : "-"}${fmtMoney(Math.abs(e.amount))}
      </div>
    </div>
  `).join("");

  overlay.innerHTML = `
    <div class="anw-modal-card">
      <h2 style="display:flex;align-items:center;gap:9px;">${icon("dice", 24)} Random events this week!</h2>
      <p>Here's what happened to you this week:</p>
      ${rows}
      <button class="btn gold" style="width:100%;justify-content:center;margin-top:16px;" id="anwEventCloseBtn">Nice, got it</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("anwEventCloseBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

async function claimFromPopup(eventLogId, username, classCode, btn) {
  btn.disabled = true;
  btn.textContent = "Claiming...";
  const cls = await getClass(classCode);
  const user = await getUser(username);
  const plan = (user.insurance || []).map(id => cls.insurancePlans.find(p => p.id === id)).find(p => p && p.coverage === "general");
  if (!plan) { btn.textContent = "No General plan"; return; }
  const res = await claimInsuranceForEvent(username, classCode, eventLogId, plan.id);
  if (res.ok) {
    btn.outerHTML = `<div class="muted-small ticker-up">Claimed — ${fmtMoney(res.payout)} paid out</div>`;
  } else {
    btn.disabled = false;
    btn.textContent = "Try again";
  }
}

/* ===================== Big event popup =====================
   Unlike small weekly events, big events must be resolved — the modal has
   no close button and clicking outside doesn't dismiss it. It reappears on
   every page load until the student picks pay / forfeit / claim. */
const BIG_EVENT_MODULE_LABEL = { income: "Income", property: "Property", transport: "Transport" };
const BIG_EVENT_COVERAGE = { income: "jobs", property: "property", transport: "transport" };

async function checkBigEventPopup(username, classCode) {
  if (!username || !classCode) return;
  const cls = await getClass(classCode);
  if (!cls) return;
  const pending = (cls.bigEventLog || []).find(e => e.studentUser === username && e.status === "pending");
  if (!pending) return;
  if (document.getElementById("anwBigEventModal")) return; // already showing

  const user = await getUser(username);
  const coverage = BIG_EVENT_COVERAGE[pending.module];
  const plan = (user.insurance || []).map(id => cls.insurancePlans.find(p => p.id === id)).find(p => p && p.coverage === coverage);

  showBigEventPopup(pending, plan, username, classCode);
}

function showBigEventPopup(entry, plan, username, classCode) {
  const overlay = document.createElement("div");
  overlay.id = "anwBigEventModal";
  overlay.className = "anw-modal-overlay";

  const assetLabel = { income: "your job", property: "your property", transport: "your vehicle" }[entry.module];

  overlay.innerHTML = `
    <div class="anw-modal-card">
      <h2 style="display:flex;align-items:center;gap:9px;">${icon("star", 24)} Big event: ${entry.name}</h2>
      <p>${entry.description || ""}</p>
      <p><strong>${BIG_EVENT_MODULE_LABEL[entry.module]}</strong> &middot; costs <strong>${fmtMoney(entry.cost)}</strong> to resolve</p>
      <p class="muted-small">You need to choose how to handle this before you can continue.</p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">
        <button class="btn coral" id="bigForfeitBtn">Don't pay — lose ${assetLabel}</button>
        <button class="btn gold" id="bigPayBtn">Pay ${fmtMoney(entry.cost)}</button>
        <button class="btn secondary" id="bigClaimBtn" ${plan ? "" : "disabled"}>
          ${plan ? `Claim insurance (${plan.name}) — pay ${fmtMoney(plan.excess)} excess` : "Claim insurance (no matching plan)"}
        </button>
      </div>
      <div id="bigEventMsg"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const resolve = async (choice) => {
    overlay.querySelectorAll("button").forEach(b => b.disabled = true);
    const res = await resolveBigEvent(username, classCode, entry.id, choice);
    if (res.ok) {
      overlay.remove();
      if (typeof render === "function") render();
    } else {
      document.getElementById("bigEventMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
      overlay.querySelectorAll("button").forEach(b => b.disabled = false);
    }
  };

  document.getElementById("bigForfeitBtn").addEventListener("click", () => resolve("forfeit"));
  document.getElementById("bigPayBtn").addEventListener("click", () => resolve("pay"));
  document.getElementById("bigClaimBtn").addEventListener("click", () => resolve("claim"));
}
