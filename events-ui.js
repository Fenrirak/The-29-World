/* ===================== The 29 World — random event popups =====================
   Weekly random events are assigned to every student once per NZ calendar
   week (see processWeeklyEvents in data-life.js), but each event gets its own
   random "revealAt" moment spread across the following day or so — so a
   student who was given 3 events doesn't see them (or feel their balance
   change) all at once. This file:
   1. Only surfaces ONE event per check, the earliest one that's come due —
      never a batch — no matter how many are queued up.
   2. For fixed-amount events, doesn't apply the balance change until the
      exact moment it's about to show the popup (via revealFixedEvent in
      the data-*.js files) — so a student's balance can never change silently ahead of
      them actually seeing what happened and why.
   3. For multiple-choice events, shows a forced modal that must be
      answered before the student can continue (unchanged from before).
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
  if (anyModalShowing()) return; // something's already showing
  // PERF FIX: this, checkBigEventPopup and checkAdjustmentPopup (below)
  // and checkPromotionNotification (data-life.js) all run back-to-back, in
  // this order, from every page's init() (see the callers list — that's
  // ~17 pages), and each used to call the uncached getClass()/getUser()
  // — the ones the write-path/background-job functions elsewhere in
  // the data-*.js files deliberately use because THEY need guaranteed-fresh state for
  // a read-modify-write. These four are pure reads with no such need, so
  // that bought nothing but up to 4 extra sequential Firestore round
  // trips on every single page load, back-to-back, on top of the ~9
  // background jobs that already just ran. Switching to
  // getClassCached()/getUserCached() — the same helpers render() already
  // uses for exactly this "read the same doc again a moment later"
  // situation — means only the first of these four calls actually hits
  // the network; the rest reuse that cached copy (still safe: any write
  // in between, e.g. revealFixedEvent() below, invalidates the cache the
  // instant it resolves, so a later check in this same sequence still
  // never sees stale data).
  let cls = await getClassCached(classCode);
  const user = await getUserCached(username);
  if (!cls || !user) return;
  const weekKey = isoWeekKey(new Date());
  const now = Date.now();
  // revealAt is missing on legacy log entries (from before this field
  // existed) — treat those as already due so nothing old gets stuck.
  const due = (cls.eventLog || []).filter(l => l.studentUser === username && l.week === weekKey && (l.revealAt === undefined || l.revealAt <= now));
  if (due.length === 0) return;

  // Multiple-choice events take priority — forced modal, must be answered.
  const pendingChoice = due.filter(l => l.type === "choice" && l.status === "pending").sort((a, b) => (a.revealAt || 0) - (b.revealAt || 0))[0];
  if (pendingChoice) {
    showChoiceEventPopup(pendingChoice, username, classCode);
    return;
  }

  // Otherwise, find the single earliest-due item the student hasn't seen
  // yet — this includes fixed events still waiting to be revealed
  // ("scheduled") as well as anything already resolved but unshown (a
  // legacy fallback from before "scheduled" existed).
  let state = getShownEventState(username);
  if (state.week !== weekKey) state = { week: weekKey, ids: [] };
  const shown = new Set(state.ids);
  const candidates = due
    .filter(l => l.type === "fixed" && (l.status === "scheduled" || l.status === "resolved") && !shown.has(l.id))
    .sort((a, b) => (a.revealAt || 0) - (b.revealAt || 0));
  if (candidates.length === 0) return;
  let entry = candidates[0];

  if (entry.status === "scheduled") {
    // This is the moment the balance change + txn actually happens — not
    // a moment before. If it's already been revealed by another tab/page
    // load in the meantime, revealFixedEvent just returns the resolved
    // entry instead of double-applying anything.
    const revealed = await revealFixedEvent(classCode, entry.id);
    if (!revealed) return; // someone else's page load already handled it
    entry = revealed;
  }

  // The plan that pays this student the most back for this event, if any.
  const best = weeklyEventClaimOptions(cls, user, entry)[0] || null;

  const withDetails = [{
    id: entry.id, name: entry.name || "Random event", description: entry.description || "",
    amount: entry.amount || 0, severity: entry.severity || "neutral", claimed: !!entry.claimed,
    claimable: !!best && best.payout > 0,
    claimPlanId: best ? best.plan.id : null,
    claimLabel: best ? `Claim on ${best.plan.name} — get ${fmtMoney(best.payout)} back` : "",
    // Holds a matching plan, but its excess eats the whole payout.
    claimNote: best && best.payout <= 0 ? `Your ${best.plan.name} excess (${fmtMoney(best.excess)}) is more than insurance would pay for this, so there's nothing to claim.` : ""
  }];

  showEventPopup(withDetails, username, classCode);

  state.ids = state.ids.concat([entry.id]);
  saveShownEventState(username, state);
}

// Multiple-choice weekly event popup. Has no close button and can't be
// dismissed by clicking outside — the student must pick an option, which
// resolves the event (applies the balance change) via resolveChoiceEvent.
function showChoiceEventPopup(entry, username, classCode) {
  const overlay = document.createElement("div");
  overlay.id = "anwChoiceEventModal";
  overlay.className = "anw-modal-overlay";

  // Amounts are intentionally withheld here — the student should be
  // choosing based on the label/description, not min-maxing the payout.
  // The actual amount + outcome only appears after they've committed.
  const optionsHtml = (entry.options || []).map(o => `
    <button class="btn secondary" style="width:100%;justify-content:flex-start;" data-opt="${o.id}">
      <span>${escapeHtml(o.label)}</span>
    </button>
  `).join("");

  overlay.innerHTML = `
    <div class="anw-modal-card">
      <h2 style="display:flex;align-items:center;gap:9px;">${icon("dice", 24)} ${escapeHtml(entry.name)}</h2>
      <p>${escapeHtml(entry.description) || ""}</p>
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
        showChoiceOutcome(overlay, entry, res.amount, res.outcome, username, classCode);
        if (typeof render === "function") render();
      } else {
        document.getElementById("choiceEventMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
        overlay.querySelectorAll("button").forEach(b => b.disabled = false);
      }
    });
  });
}

// Swaps the choice modal's content for a reveal of what actually happened
// — this is the first moment the student sees the amount, now that
// they've already committed to their choice.
function showChoiceOutcome(overlay, entry, amount, outcome, username, classCode) {
  const card = overlay.querySelector(".anw-modal-card");
  // Same claimability rule as fixed events: the event def was marked
  // "bad" and the option the student picked actually cost them money.
  // A student who picks a $0/positive option on a "bad" event has
  // nothing to claim, even though the event itself is tagged bad.
  const claimable = entry.severity === "bad" && amount < 0;
  card.innerHTML = `
    <h2 style="display:flex;align-items:center;gap:9px;">${icon("dice", 24)} ${escapeHtml(entry.name)}</h2>
    ${outcome ? `<p>${escapeHtml(outcome)}</p>` : ""}
    <p class="${amount < 0 ? 'ticker-down' : 'ticker-up'}" style="font-weight:900;font-size:1.2em;">${amount >= 0 ? "+" : "-"}${fmtMoney(Math.abs(amount))}</p>
    ${claimable ? `<button class="btn small secondary" onclick="claimFromPopup('${entry.id}', '${escapeJsAttr(username)}', '${classCode}', this)">${icon("shield", 13)} Claim insurance</button>` : ""}
    <button class="btn gold" style="width:100%;justify-content:center;margin-top:16px;" id="anwChoiceOutcomeCloseBtn">Nice, got it</button>
  `;
  document.getElementById("anwChoiceOutcomeCloseBtn").addEventListener("click", () => overlay.remove());
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
        <div class="anw-event-name">${escapeHtml(e.name)}</div>
        ${e.description ? `<div class="muted-small">${escapeHtml(e.description)}</div>` : ""}
        ${e.claimable ? `<button class="btn small secondary" style="margin-top:6px;" onclick="claimFromPopup('${e.id}', '${escapeJsAttr(username)}', '${classCode}', this, '${e.claimPlanId}')">${icon("shield", 13)} ${escapeHtml(e.claimLabel)}</button>` : ""}
        ${e.claimNote ? `<div class="muted-small">${escapeHtml(e.claimNote)}</div>` : ""}
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

// planId is optional — without one (the multiple-choice outcome, where
// the loss is only known after the student picks), the plan paying the
// most back is looked up fresh here.
async function claimFromPopup(eventLogId, username, classCode, btn, planId) {
  btn.disabled = true;
  btn.textContent = "Claiming...";
  if (!planId) {
    const cls = withNewModuleDefaults(await getClass(classCode));
    const user = await getUser(username);
    const entry = (cls.eventLog || []).find(e => e.id === eventLogId);
    const best = weeklyEventClaimOptions(cls, user, entry)[0];
    if (!best) { btn.textContent = "No insurance plan covers this"; return; }
    if (best.payout <= 0) { btn.textContent = `Your excess (${fmtMoney(best.excess)}) is more than this — nothing to claim`; return; }
    planId = best.plan.id;
  }
  const res = await claimInsuranceForEvent(username, classCode, eventLogId, planId);
  if (res.ok) {
    btn.outerHTML = `<div class="muted-small ticker-up">Claimed — ${fmtMoney(res.payout)} paid out</div>`;
  } else {
    btn.disabled = false;
    btn.textContent = "Try again";
  }
}

/* ===================== Bonus / fine popup =====================
   When a teacher gives a bonus or fine from the dashboard, the student
   gets a one-time popup (like a good big event) showing the reason and
   the amount, instead of just quietly finding it in their activity feed. */
function anyModalShowing() {
  return !!(document.getElementById("anwEventModal") || document.getElementById("anwChoiceEventModal")
    || document.getElementById("anwBigEventModal") || document.getElementById("anwGoodBigEventModal")
    || document.getElementById("anwAdjustmentModal"));
}

async function checkAdjustmentPopup(username, classCode) {
  if (!username || !classCode) return;
  if (anyModalShowing()) return;
  // PERF FIX: see the comment on checkWeeklyEventPopup above — same
  // reasoning, this reuses whatever it (or checkBigEventPopup, just
  // before this in every page's init()) already fetched a moment ago
  // instead of paying for its own round trip.
  const cls = await getClassCached(classCode);
  if (!cls) return;
  const pending = (cls.txns || []).find(t => t.announce && !t.acknowledged && t.to === username && (t.type === "bonus" || t.type === "fine"));
  if (!pending) return;

  showAdjustmentPopup(pending);
  await acknowledgeTxn(classCode, pending.id);
}

function showAdjustmentPopup(txn) {
  const overlay = document.createElement("div");
  overlay.id = "anwAdjustmentModal";
  overlay.className = "anw-modal-overlay";

  const isBonus = txn.type === "bonus";
  overlay.innerHTML = `
    <div class="anw-modal-card">
      <h2 style="display:flex;align-items:center;gap:9px;">${icon(isBonus ? "star" : "coin", 24)} ${isBonus ? "You got a bonus!" : "You got a fine"}</h2>
      ${txn.note ? `<p>${escapeHtml(txn.note)}</p>` : ""}
      <p class="${isBonus ? 'ticker-up' : 'ticker-down'}" style="font-weight:900;font-size:1.2em;">${isBonus ? "+" : "-"}${fmtMoney(txn.amount)}</p>
      <button class="btn gold" style="width:100%;justify-content:center;margin-top:16px;" id="anwAdjustmentCloseBtn">Nice, got it</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("anwAdjustmentCloseBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

/* ===================== Big event popup =====================
   Unlike small weekly events, big events must be resolved — the modal has
   no close button and clicking outside doesn't dismiss it. It reappears on
   every page load until the student picks pay / forfeit / claim. */
const BIG_EVENT_MODULE_LABEL = { income: "Income", property: "Property", transport: "Transport", general: "General" };
const BIG_EVENT_COVERAGE = { income: "jobs", property: "property", transport: "transport" };

function bigEventsShownKey(username) {
  return "anw_bigevents_shown_" + username;
}
function getShownBigEventState(username) {
  try {
    const raw = localStorage.getItem(bigEventsShownKey(username));
    return raw ? JSON.parse(raw) : { ids: [] };
  } catch (e) {
    return { ids: [] };
  }
}
function saveShownBigEventState(username, state) {
  try { localStorage.setItem(bigEventsShownKey(username), JSON.stringify(state)); } catch (e) { /* ignore */ }
}

async function checkBigEventPopup(username, classCode) {
  if (!username || !classCode) return;
  if (anyModalShowing()) return; // something's already showing
  // PERF FIX: see the comment on checkWeeklyEventPopup above.
  const cls = await getClassCached(classCode);
  if (!cls) return;

  // Bad events (job/property/vehicle at risk) take priority — forced
  // modal, must be resolved via pay / forfeit / claim before continuing.
  const pending = (cls.bigEventLog || []).find(e => e.studentUser === username && e.status === "pending");
  if (pending) {
    const user = await getUserCached(username);
    const coverage = BIG_EVENT_COVERAGE[pending.module];
    const claimOptions = coverage ? insuranceClaimOptions(cls, user, coverage, pending.insuranceCover, pending.cost) : [];
    showBigEventPopup(pending, claimOptions, username, classCode, user);
    return;
  }

  // Good (windfall) events are already paid out the moment they're
  // generated — this just shows a friendly, dismissible heads-up the
  // first time the student sees it, same one-time-shown pattern as the
  // regular weekly events.
  const state = getShownBigEventState(username);
  const shown = new Set(state.ids);
  const unseenGood = (cls.bigEventLog || [])
    .find(e => e.studentUser === username && e.status === "received" && !shown.has(e.id));
  if (!unseenGood) return;

  showGoodBigEventPopup(unseenGood);
  state.ids = state.ids.concat([unseenGood.id]);
  saveShownBigEventState(username, state);
}

function showGoodBigEventPopup(entry) {
  const overlay = document.createElement("div");
  overlay.id = "anwGoodBigEventModal";
  overlay.className = "anw-modal-overlay";

  overlay.innerHTML = `
    <div class="anw-modal-card">
      <h2 style="display:flex;align-items:center;gap:9px;">${icon("star", 24)} Big event: ${escapeHtml(entry.name)}</h2>
      <p>${escapeHtml(entry.description) || ""}</p>
      <p class="ticker-up" style="font-weight:900;font-size:1.2em;">+${fmtMoney(entry.cost)}</p>
      <button class="btn gold" style="width:100%;justify-content:center;margin-top:16px;" id="anwGoodBigEventCloseBtn">Nice, got it</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("anwGoodBigEventCloseBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// claimOptions: the student's plans that can claim this event, from
// insuranceClaimOptions — each gets its own button showing what it costs.
function showBigEventPopup(entry, claimOptions, username, classCode, user) {
  const overlay = document.createElement("div");
  overlay.id = "anwBigEventModal";
  overlay.className = "anw-modal-overlay";

  const assetLabel = { income: "your job", property: "your property", transport: "your vehicle" }[entry.module];
  // Some events are only ever a cost — the def can be set so not paying
  // never takes the associated job/property/vehicle away. Older log
  // entries (created before this option existed) had no such field, so
  // treat that as "at risk", same as before.
  const canForfeit = entry.takesAsset !== false;

  // Teachers can hit this modal too (defensive — resolveBigEvent lets them
  // pay/claim regardless of balance), so don't gate their buttons on funds
  // they don't actually need.
  const isTeacher = user && user.role === "teacher";
  const cash = (user && user.balance) || 0;
  const savings = (user && user.savings) || 0;
  // Cash payment is never disabled for insufficient funds — it's allowed
  // to take the balance negative, same as fines and choice events
  // elsewhere in the app (see resolveBigEvent). Savings genuinely can't go
  // negative anywhere in the app, so that gate stays. Without this, an
  // event with takesAsset:false plus no savings/insurance could disable
  // every single button and leave the modal with no way out.
  const savingsOk = isTeacher || savings >= entry.cost;
  const cashWouldGoNegative = !isTeacher && cash < entry.cost;

  // Insurance: one button per matching plan. A claim is paid from cash and
  // (unlike paying the event outright) can't take the balance negative —
  // see resolveBigEvent — so a claim the student can't afford is greyed
  // out with the reason; "Pay from cash" always stays available.
  const coverage = BIG_EVENT_COVERAGE[entry.module];
  const cover = entry.insuranceCover || [];
  const claims = (claimOptions || []).map(o => ({ ...o, ok: isTeacher || cash >= o.studentPays }));
  const coverLine = cover.length
    ? `<p class="muted-small">Insurance that covers this: ${escapeHtml(insuranceCoverSummary(coverage, cover))}. You'd also pay your plan's excess.</p>`
    : "";
  const claimButtons = claims.length
    ? claims.map((o, i) => {
        const typeLabel = insuranceTypeLabel(coverage, o.plan.insType);
        return `<button class="btn secondary" id="bigClaimBtn${i}" data-plan="${escapeHtml(o.plan.id)}" ${o.ok ? "" : "disabled"}>
          Claim on ${escapeHtml(o.plan.name)}${typeLabel ? ` (${escapeHtml(typeLabel)})` : ""} — you pay ${fmtMoney(o.studentPays)}
          (${fmtMoney(o.excess)} excess${o.uncovered > 0 ? ` + ${fmtMoney(o.uncovered)} not covered` : ""})${o.ok ? "" : ` — you only have ${fmtMoney(cash)}`}
        </button>`;
      }).join("")
    : `<button class="btn secondary" disabled>${cover.length
        ? `Claim insurance — needs ${escapeHtml(cover.map(c => insuranceTypeLabel(coverage, c.type)).join(" or "))}`
        : "Claim insurance (no matching plan)"}</button>`;

  overlay.innerHTML = `
    <div class="anw-modal-card">
      <h2 style="display:flex;align-items:center;gap:9px;">${icon("star", 24)} Big event: ${escapeHtml(entry.name)}</h2>
      <p>${escapeHtml(entry.description) || ""}</p>
      <p><strong>${BIG_EVENT_MODULE_LABEL[entry.module]}</strong> &middot; costs <strong>${fmtMoney(entry.cost)}</strong> to resolve</p>
      <p class="muted-small">${canForfeit ? "You need to choose how to handle this before you can continue." : `This doesn't put ${assetLabel} at risk — you just need to cover the cost, or claim insurance if you have it.`}</p>
      ${coverLine}
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">
        ${canForfeit ? `<button class="btn coral" id="bigForfeitBtn">Don't pay — lose ${assetLabel}</button>` : ""}
        <button class="btn gold" id="bigPayCashBtn">
          Pay ${fmtMoney(entry.cost)} from cash${cashWouldGoNegative ? ` (will take your balance negative — you have ${fmtMoney(cash)})` : ""}
        </button>
        <button class="btn gold" id="bigPaySavingsBtn" ${savingsOk ? "" : "disabled"}>
          Pay ${fmtMoney(entry.cost)} from savings${savingsOk ? "" : ` (only ${fmtMoney(savings)} available)`}
        </button>
        ${claimButtons}
      </div>
      <div id="bigEventMsg"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Only buttons that are actually usable get toggled between attempts.
  // Buttons disabled because of a genuine constraint (not enough cash, not
  // enough savings, no matching insurance plan) must STAY disabled after a
  // failed attempt at a different option — previously ALL buttons were
  // blindly re-enabled on any error, which could un-disable e.g. "Claim
  // insurance" for a student with no matching plan.
  const eligibleIds = ["bigPayCashBtn"];
  if (canForfeit) eligibleIds.push("bigForfeitBtn");
  if (savingsOk) eligibleIds.push("bigPaySavingsBtn");
  claims.forEach((o, i) => { if (o.ok) eligibleIds.push("bigClaimBtn" + i); });
  const setBusy = (busy) => {
    eligibleIds.forEach(id => { document.getElementById(id).disabled = busy; });
  };

  const resolve = async (choice, paySource, planId) => {
    setBusy(true);
    const res = await resolveBigEvent(username, classCode, entry.id, choice, paySource, planId);
    if (res.ok) {
      overlay.remove();
      if (typeof render === "function") render();
    } else {
      document.getElementById("bigEventMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
      setBusy(false);
    }
  };

  if (canForfeit) document.getElementById("bigForfeitBtn").addEventListener("click", () => resolve("forfeit"));
  document.getElementById("bigPayCashBtn").addEventListener("click", () => resolve("pay", "cash"));
  document.getElementById("bigPaySavingsBtn").addEventListener("click", () => resolve("pay", "savings"));
  claims.forEach((o, i) => {
    document.getElementById("bigClaimBtn" + i).addEventListener("click", () => resolve("claim", null, o.plan.id));
  });
}

/* ===================== Insurance types picker (teacher) =====================
   Shared by the weekly events form (teacher.html) and the big events form
   (bigevents.html): one row per property/transport insurance type, each
   with a tick box and how much that type pays out for the event. */
function renderInsuranceCoverPicker(boxId, coverage, cover) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const types = INSURANCE_TYPES[coverage] || [];
  box.dataset.coverage = types.length ? coverage : "";
  if (!types.length) { box.innerHTML = ""; box.classList.add("hidden"); return; }
  const byType = {};
  (cover || []).forEach(c => { byType[c.type] = c; });
  box.classList.remove("hidden");
  box.innerHTML = `
    <label style="margin-top:12px;">Which ${coverage} insurance covers this?</label>
    <p class="muted-small" style="margin-top:0;">Tick each type that can claim and how much it pays out. Students pay their plan's excess plus anything the payout doesn't cover. Tick none and any ${coverage} plan covers the full cost (the student just pays the excess).</p>
    ${types.map(t => {
      const row = byType[t.key];
      return `
      <div class="ins-cover-row">
        <input type="checkbox" id="${boxId}-${t.key}" data-ins-type="${t.key}" ${row ? "checked" : ""}>
        <label for="${boxId}-${t.key}">${escapeHtml(t.label)}</label>
        <span class="ins-cover-pay">
          <span class="muted-small">pays $</span>
          <input type="number" min="0" step="0.01" data-ins-payout="${t.key}" aria-label="${escapeHtml(t.label)} payout" placeholder="0" value="${row ? row.payout : ""}" ${row ? "" : "disabled"}>
        </span>
      </div>`;
    }).join("")}
  `;
  box.querySelectorAll("[data-ins-type]").forEach(cb => cb.addEventListener("change", () => {
    const amt = box.querySelector(`[data-ins-payout="${cb.dataset.insType}"]`);
    amt.disabled = !cb.checked;
    if (cb.checked) amt.focus();
  }));
}

// Reads the picker back as [{ type, payout }] ([] when it's hidden). Returns
// null, after telling the teacher why, if a ticked type has no valid payout.
function readInsuranceCoverPicker(boxId) {
  const box = document.getElementById(boxId);
  if (!box || box.classList.contains("hidden")) return [];
  const coverage = box.dataset.coverage;
  const out = [];
  for (const cb of box.querySelectorAll("[data-ins-type]")) {
    if (!cb.checked) continue;
    const type = cb.dataset.insType;
    const raw = box.querySelector(`[data-ins-payout="${type}"]`).value.trim();
    const amount = Number(raw);
    if (raw === "" || !Number.isFinite(amount) || amount < 0) {
      alert(`Enter how much ${insuranceTypeLabel(coverage, type)} pays out (0 or more), or untick it.`);
      return null;
    }
    out.push({ type, payout: amount });
  }
  return out;
}
