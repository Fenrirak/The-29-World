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
  if (!cls) return;
  const weekKey = isoWeekKey(new Date());
  const mine = (cls.eventLog || []).filter(l => l.studentUser === username && l.week === weekKey);
  if (mine.length === 0) return;

  let state = getShownEventState(username);
  if (state.week !== weekKey) state = { week: weekKey, ids: [] };
  const shown = new Set(state.ids);
  const fresh = mine.filter(l => !shown.has(l.eventId + "|" + l.date));

  if (fresh.length === 0) return;

  const withDetails = fresh.map(l => ({
    name: l.name || "Random event",
    description: l.description || "",
    amount: l.amount || 0
  }));

  showEventPopup(withDetails);

  state.ids = state.ids.concat(mine.map(l => l.eventId + "|" + l.date));
  saveShownEventState(username, state);
}

function showEventPopup(events) {
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
