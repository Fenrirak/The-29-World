/* ===================== 29 World™ — random event popups =====================
   Each NZ week every student gets 2-5 random events, each planned for its
   own school day (see processWeeklyEvents in data-life.js) — so a student
   never sees them (or feels their balance change) all at once. This file:
   1. Only surfaces ONE event per check, the earliest one that's come due —
      never a batch — no matter how many are queued up.
   2. For fixed-amount events, doesn't apply the balance change until the
      exact moment it's about to show the popup (via revealWeeklyEvent in
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
  // in between, e.g. revealWeeklyEvent() below, invalidates the cache the
  // instant it resolves, so a later check in this same sequence still
  // never sees stale data).
  let cls = await getClassCached(classCode);
  const user = await getUserCached(username);
  if (!cls || !user) return;
  const weekKey = isoWeekKey();
  const now = trustedNow().getTime();
  const todayKey = nzDateKey();
  const mine = (cls.eventLog || []).filter(l => l.studentUser === username && l.week === weekKey);
  // revealAt is missing on legacy log entries (from before this field
  // existed) — treat those as already due so nothing old gets stuck.
  const due = mine.filter(l => l.status !== "skipped" && (l.revealAt === undefined || l.revealAt <= now));
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
  // One new weekly event a day at most: a student who wasn't on the site
  // on an event's day gets it on their next visit, but never more than one
  // new one a day, so a week's events can't all land at once. Ones the
  // teacher handed out with "Run this week's events now" don't count.
  const revealedToday = mine.some(l => l.revealedDay === todayKey && !l.manual);
  let state = getShownEventState(username);
  if (state.week !== weekKey) state = { week: weekKey, ids: [] };
  const shown = new Set(state.ids);
  // CROSS-DEVICE: the "already shown" marker used to live only in this
  // browser's localStorage, so logging in on another device/browser showed
  // the same popup again. It now lives on the log entry in Firestore
  // (popupShown, set atomically by claimEventPopup). Anything this device
  // remembers showing but that has no server flag yet (shown before this
  // fix) gets flagged now, quietly, so other devices don't show it either.
  due.filter(l => l.type === "fixed" && l.status === "resolved" && shown.has(l.id) && !l.popupShown)
    .forEach(l => { claimEventPopup(classCode, "weekly", l.id).catch(() => {}); });
  const candidates = due
    .filter(l => (l.status === "planned" && (l.manual || !revealedToday))
      || (l.type === "fixed" && (l.status === "scheduled" || l.status === "resolved") && !shown.has(l.id) && !l.popupShown))
    .sort((a, b) => (a.revealAt || 0) - (b.revealAt || 0));
  let entry = null;
  for (const c of candidates) {
    if (c.status !== "planned" && c.status !== "scheduled") { entry = c; break; }
    // This is the moment the event actually happens (and a fixed one's
    // balance change + txn) — not a moment before. If another tab already
    // did it, or it no longer applies, this returns null and the next one
    // is tried.
    const revealed = await revealWeeklyEvent(classCode, c.id);
    if (revealed) { entry = revealed; break; }
  }
  if (!entry) return;
  if (entry.type === "choice") {
    showChoiceEventPopup(entry, username, classCode);
    return;
  }

  // Only ONE device/tab ever gets to show this popup: the claim is an atomic
  // Firestore transaction, so if another device (or another tab racing this
  // one) already showed it, this returns false and nothing is shown here.
  // The event's money change already happened exactly once, in
  // revealWeeklyEvent — this only decides who displays the message.
  let firstToShow = false;
  try {
    firstToShow = await claimEventPopup(classCode, "weekly", entry.id);
  } catch (e) {
    return; // couldn't confirm — don't risk a duplicate; it's retried next load
  }
  state.ids = state.ids.concat([entry.id]);
  saveShownEventState(username, state);
  if (!firstToShow) return;

  // The plan that pays this student the most back for this event, if any —
  // plus, kept separate because claiming it gives their house away, an
  // Indemnity write-off when the house itself was damaged.
  const options = weeklyEventClaimOptions(cls, user, entry);
  const best = options.find(o => !o.writeOff) || null;
  const writeOff = options.find(o => o.writeOff) || null;

  const withDetails = [{
    id: entry.id, name: entry.name || "Random event", description: entry.description || "",
    amount: entry.amount || 0, severity: entry.severity || "neutral", claimed: !!entry.claimed,
    impact: eventImpactText(entry, entry.coverage),
    writeOffPlanId: writeOff ? writeOff.plan.id : null,
    writeOffLabel: writeOff ? writeOffButtonLabel(writeOff) : "",
    claimable: !!best && best.payout > 0,
    claimPlanId: best ? best.plan.id : null,
    claimLabel: best ? `Claim on ${insurancePlanName(best.plan)}. Get ${fmtMoney(best.payout)} back` : "",
    // Holds a matching plan, but its excess eats the whole payout.
    claimNote: best && best.payout <= 0 ? `Your ${insurancePlanName(best.plan)} excess (${fmtMoney(best.excess)}) is more than insurance would pay for this, so there's nothing to claim.` : ""
  }];

  showEventPopup(withDetails, username, classCode);
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
      <h2 style="display:flex;align-items:center;gap:9px;">${icon("sparkle", 24)} ${escapeHtml(entry.name)}</h2>
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
    <h2 style="display:flex;align-items:center;gap:9px;">${icon("sparkle", 24)} ${escapeHtml(entry.name)}</h2>
    ${outcome ? `<p>${escapeHtml(outcome)}</p>` : ""}
    <p class="${amount < 0 ? 'ticker-down' : 'ticker-up'}" style="font-weight:900;font-size:1.2em;">${amount >= 0 ? "+" : "-"}${fmtMoney(Math.abs(amount))}</p>
    ${claimable ? `<button class="btn small secondary" data-claim-btn onclick="claimFromPopup('${entry.id}', '${escapeJsAttr(username)}', '${classCode}', this)">${icon("shield", 13)} Claim insurance</button>` : ""}
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
      <span class="icon" style="width:26px;height:26px;flex-shrink:0;">${icon("sparkle", 26)}</span>
      <div style="flex:1;">
        <div class="anw-event-name">${escapeHtml(e.name)}</div>
        ${e.description ? `<div class="muted-small">${escapeHtml(e.description)}</div>` : ""}
        ${e.impact ? `<div class="muted-small">${escapeHtml(e.impact)}</div>` : ""}
        ${e.claimable ? `<button class="btn small secondary" data-claim-btn style="margin-top:6px;" onclick="claimFromPopup('${e.id}', '${escapeJsAttr(username)}', '${classCode}', this, '${e.claimPlanId}')">${icon("shield", 13)} ${escapeHtml(e.claimLabel)}</button>` : ""}
        ${e.writeOffPlanId ? `<button class="btn small coral" data-claim-btn style="margin-top:6px;" onclick="claimWriteOffFromPopup('${e.id}', '${escapeJsAttr(username)}', '${classCode}', this, '${e.writeOffPlanId}')">${icon("house", 13)} ${escapeHtml(e.writeOffLabel)}</button>` : ""}
        ${e.claimNote && !e.writeOffPlanId ? `<div class="muted-small">${escapeHtml(e.claimNote)}</div>` : ""}
        ${e.claimed ? `<div class="muted-small ticker-up">Claimed on insurance</div>` : ""}
      </div>
      <div class="${e.amount < 0 ? 'ticker-down' : 'ticker-up'}" style="font-weight:900;">
        ${e.amount >= 0 ? "+" : "-"}${fmtMoney(Math.abs(e.amount))}
      </div>
    </div>
  `).join("");

  overlay.innerHTML = `
    <div class="anw-modal-card">
      <h2 style="display:flex;align-items:center;gap:9px;">${icon("sparkle", 24)} Random events this week!</h2>
      <p>Here's what happened to you this week:</p>
      ${rows}
      <button class="btn gold" style="width:100%;justify-content:center;margin-top:16px;" id="anwEventCloseBtn">Nice, got it</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("anwEventCloseBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// What an event hit, in plain words, e.g. "Fire · your Ford Ranger (truck)".
function eventImpactText(entry, coverage) {
  if (!entry) return "";
  const happened = incidentLabels(coverage, entry.incident, "you").join(" + ");
  const kind = { car: "car", truck: "truck", bike: "bike/scooter" }[entry.assetType] || "";
  const asset = entry.assetName ? `${entry.assetName}${kind ? ` (${kind})` : ""}`
    : entry.assetType === "rented-home" ? "your rented home" : "";
  return [happened, asset, entry.basisNote].filter(Boolean).join(" · ");
}

// Short button text for an Indemnity write-off (the full breakdown is in
// the confirm box — see writeOffText).
function writeOffButtonLabel(o) {
  const name = (o.property && o.property.name) || "your house";
  return `Claim on ${insurancePlanName(o.plan)}: ${o.net >= 0 ? `get ${fmtMoney(o.net)}` : `owe ${fmtMoney(-o.net)}`}, and ${name} goes to the insurer`;
}

async function confirmWriteOff(o) {
  return await t29Confirm(`${writeOffText(o)}\n\nYou won't own it any more. Claim anyway?`);
}

// Indemnity write-off from a weekly event popup: re-checks the numbers
// fresh and asks the student to confirm before giving the house away.
async function claimWriteOffFromPopup(eventLogId, username, classCode, btn, planId) {
  const cls = withNewModuleDefaults(await getClass(classCode));
  const user = await getUser(username);
  const entry = (cls.eventLog || []).find(e => e.id === eventLogId);
  const o = weeklyEventClaimOptions(cls, user, entry).find(x => x.writeOff && x.plan.id === planId);
  if (!o) { btn.disabled = true; btn.textContent = "This claim isn't available any more"; return; }
  if (!await confirmWriteOff(o)) return;
  return claimFromPopup(eventLogId, username, classCode, btn, planId);
}

// planId is optional — without one (the multiple-choice outcome, where
// the loss is only known after the student picks), the plan paying the
// most back is looked up fresh here. A write-off is only ever used when
// it's the sole option AND the student confirms it.
async function claimFromPopup(eventLogId, username, classCode, btn, planId) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Claiming...";
  if (!planId) {
    const cls = withNewModuleDefaults(await getClass(classCode));
    const user = await getUser(username);
    const entry = (cls.eventLog || []).find(e => e.id === eventLogId);
    const options = weeklyEventClaimOptions(cls, user, entry);
    const best = options.find(o => !o.writeOff);
    const writeOff = options.find(o => o.writeOff);
    if (best && best.payout > 0) {
      planId = best.plan.id;
    } else if (writeOff) {
      if (!await confirmWriteOff(writeOff)) { btn.disabled = false; btn.innerHTML = label; return; }
      planId = writeOff.plan.id;
    } else if (best) {
      btn.textContent = `Your excess (${fmtMoney(best.excess)}) is more than this. Nothing to claim`; return;
    } else {
      btn.textContent = "No insurance plan covers this"; return;
    }
  }
  const res = await claimInsuranceForEvent(username, classCode, eventLogId, planId);
  if (res.ok) {
    // One claim per event — take away the other claim button, if any.
    const row = btn.closest(".anw-event-row, .anw-modal-card");
    if (row) row.querySelectorAll("[data-claim-btn]").forEach(b => { if (b !== btn) b.remove(); });
    btn.outerHTML = res.writeOff
      ? `<div class="muted-small">Claimed: ${res.payout >= 0 ? `${fmtMoney(res.payout)} paid out` : `${fmtMoney(-res.payout)} still owed`}, and the house now belongs to the insurer</div>`
      : `<div class="muted-small ticker-up">Claimed: ${fmtMoney(res.payout)} paid out</div>`;
    if (res.writeOff && typeof render === "function") render();
  } else {
    btn.disabled = false;
    btn.textContent = res.error || "Try again";
  }
}

/* ===================== Bonus / fine popup =====================
   When a teacher gives a bonus or fine from the dashboard, the student
   gets a one-time popup (like a good big event) showing the reason and
   the amount, instead of just quietly finding it in their activity feed. */
function anyModalShowing() {
  return !!(document.getElementById("anwEventModal") || document.getElementById("anwChoiceEventModal")
    || document.getElementById("anwBigEventModal") || document.getElementById("anwGoodBigEventModal")
    || document.getElementById("anwAdjustmentModal") || document.getElementById("anwBigEventReminderModal"));
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
  const pendingList = (cls.txns || []).filter(t => t.announce && !t.acknowledged && t.to === username && (t.type === "bonus" || t.type === "fine"));
  // Acknowledge FIRST, atomically: only the device that actually flips it
  // from unacknowledged shows the popup, so a second device/tab (or one that
  // read a slightly stale copy) never shows the same bonus/fine again.
  for (const pending of pendingList) {
    let won = false;
    try { won = await acknowledgeTxn(classCode, pending.id); } catch (e) { return; }
    if (won) { showAdjustmentPopup(pending); return; }
  }
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
   Unlike small weekly events, big events must be resolved. The modal has no
   close button and clicking outside doesn't dismiss it, with one exception:
   it can be put away for 5 minutes (once started, the same clock keeps running
   however often it is reopened from the countdown timer; at zero it is forced
   back and can't be put away). Until the student picks pay / forfeit / claim
   it covers the page so nothing else can be done: it's shown as soon as
   the page loads (see the listener at the end of this section), on top of
   any other popup, and — via the notification poll — on a page that was
   already open when the event arrived. The data-*.js files back this up
   by refusing to sell the thing it puts at risk (see pendingBigEventFor). */
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

// onlyPending: just the must-answer popup (the early and polled checks),
// leaving the one-time "good event" heads-up to the page's own check.
async function checkBigEventPopup(username, classCode, onlyPending) {
  if (!username || !classCode) return;
  if (document.getElementById("anwBigEventModal")) return; // already showing
  // PERF FIX: see the comment on checkWeeklyEventPopup above.
  let cls = await getClassCached(classCode);
  if (!cls) return;

  // A scheduled big event whose moment has come happens now (see
  // revealBigEvent). A bad one is always brought on, even over another
  // popup; a good one only when its popup can be shown straight away, so
  // the money never arrives without the student seeing why.
  const nowMs = trustedNow().getTime();
  const dueNow = (cls.bigEventLog || [])
    .filter(e => e.studentUser === username && e.status === "scheduled" && (e.revealAt || 0) <= nowMs)
    .sort((a, b) => (a.revealAt || 0) - (b.revealAt || 0));
  const toReveal = dueNow.find(e => e.kind !== "good")
    || (!onlyPending && !anyModalShowing() ? dueNow.find(e => e.kind === "good") : null);
  if (toReveal) {
    await revealBigEvent(classCode, toReveal.id);
    cls = await getClassCached(classCode); // the reveal cleared the cache — read it fresh
    if (!cls) return;
    if (document.getElementById("anwBigEventModal")) return; // another check got there while we waited
  }

  // Bad events (job/property/vehicle at risk) take priority — forced
  // modal, must be resolved via pay / forfeit / claim before continuing.
  // Shown even over another popup: nothing else can happen until it's
  // answered, and that popup is still there underneath afterwards.
  const waiting = (cls.bigEventLog || []).filter(e => e.studentUser === username && e.status === "pending");
  if (waiting.length) {
    // The 5 minutes (see snoozeBigEvent): one whose time is up is forced back, one never put away is shown
    // now, and one whose clock is still running stays out of the way behind the countdown timer (the
    // student is off moving money, so a page change mustn't bring it straight back).
    const toShow = waiting.find(e => bigEventSnooze(e).expired) || waiting.find(e => !bigEventSnooze(e).used) || null;
    beSyncTimer(waiting, username, classCode);
    if (!toShow) return;
    const user = await getUserCached(username);
    if (document.getElementById("anwBigEventModal")) return; // another check got there while we waited
    showBigEventPopup(toShow, bigEventClaimOptions(cls, user, toShow), username, classCode, user);
    return;
  }
  beStopTimer(); // nothing waiting (any more): no timer
  if (onlyPending || anyModalShowing()) return;

  // Good (windfall) events are already paid out the moment they happen
  // (revealBigEvent) — this just shows a friendly, dismissible heads-up the
  // first time the student sees it, same one-time-shown pattern as the
  // regular weekly events.
  const state = getShownBigEventState(username);
  const shown = new Set(state.ids);
  const received = (cls.bigEventLog || []).filter(e => e.studentUser === username && e.status === "received");
  // Shown on this device before the server flag existed — flag it quietly so
  // other devices don't show it again either.
  received.filter(e => shown.has(e.id) && !e.popupShown)
    .forEach(e => { claimEventPopup(classCode, "big", e.id).catch(() => {}); });
  // CROSS-DEVICE: skip any the server says has already been shown anywhere,
  // and claim the one to show atomically (see claimEventPopup) so two
  // devices opening at the same moment can't both show it. The windfall
  // itself was paid once, in revealBigEvent.
  for (const e of received.filter(e => !shown.has(e.id) && !e.popupShown)) {
    let won = false;
    try { won = await claimEventPopup(classCode, "big", e.id); } catch (err) { return; }
    state.ids = state.ids.concat([e.id]);
    saveShownBigEventState(username, state);
    if (won) {
      if (!document.getElementById("anwGoodBigEventModal")) showGoodBigEventPopup(e);
      return;
    }
  }
}

function showGoodBigEventPopup(entry) {
  const overlay = document.createElement("div");
  overlay.id = "anwGoodBigEventModal";
  overlay.className = "anw-modal-overlay";

  overlay.innerHTML = `
    <div class="anw-modal-card be-card" role="dialog" aria-modal="true" aria-labelledby="bigWindfallTitle">
      <div class="be-heading">
        <span class="badge gold">${icon("bolt", 14)} Big event</span>
        <h2 id="bigWindfallTitle" class="be-title">${escapeHtml(entry.name)}</h2>
        ${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}
      </div>
      <div class="be-summary"><span>Paid into your everyday account</span><strong class="ticker-up">+${fmtMoney(entry.cost)}</strong></div>
      ${entry.basisNote ? `<p class="muted-small be-note">${escapeHtml(entry.basisNote)}</p>` : ""}
      <button class="btn gold be-full" type="button" id="anwGoodBigEventCloseBtn">Nice, got it</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("anwGoodBigEventCloseBtn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// claimOptions: the student's plans that can claim this event, from
// bigEventClaimOptions — each gets its own breakdown and claim button.
async function showBigEventPopup(entry, claimOptions, username, classCode, user) {
  // Room left on the student's credit card (if they have one) for the "pay on card" options.
  let hasCard = false, cardRoom = 0;
  try {
    if (user && user.role !== "teacher" && cardIsActive(user)) {
      const cardCls = await getClassCached(classCode);
      const cardPlan = cardCls && cardPlanById(cardCls, user.creditCard.planId);
      if (cardPlan) { hasCard = true; cardRoom = cardAvailable(user.creditCard, cardPlan); }
    }
  } catch (e) { /* no card options if it can't be read */ }
  if (document.getElementById("anwBigEventModal")) return;
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
  const cash = Number(user && user.balance) || 0;
  // Cash payment is never disabled for insufficient funds — it's allowed
  // to take the balance negative, same as fines and choice events
  // elsewhere in the app (see resolveBigEvent). Without this, an event with
  // takesAsset:false plus no insurance could disable every single button and
  // leave the modal with no way out. There is no "pay from savings": the student
  // moves money into their everyday account first (that's what the 5 minutes are for).
  const snz = bigEventSnooze(entry);
  const cashWouldGoNegative = !isTeacher && cash < entry.cost;

  // Insurance: one button per matching plan. A claim is paid from cash and
  // (unlike paying the event outright) can't take the balance negative —
  // see resolveBigEvent — so a claim the student can't afford is greyed
  // out with the reason; "Pay from cash" always stays available.
  const coverage = BIG_EVENT_COVERAGE[entry.module];
  const cover = entry.insuranceCover || [];
  const claims = claimOptions || [];
  const canChooseClaimSource = cardRoom > 0 && claims.some(o => !o.writeOff && o.studentPays > 0);
  const defaultClaimSource = canChooseClaimSource && claims.some(o => !o.writeOff && o.studentPays > Math.max(0, cash)
    && o.studentPays <= cardRoom + Math.max(0, cash)) ? "card" : "cash";
  const impact = eventImpactText(entry, coverage);
  // Types listed on the event that could cover THIS vehicle (Truck
  // Insurance only covers trucks, the other types only cars and bikes).
  const fittingTypes = cover.filter(c => typeFitsVehicle(coverage, c.type, entry.assetType));
  const vehicleName = entry.assetName || "your vehicle";
  const claimPayment = (o, source) => {
    const card = source === "card" && !o.writeOff ? Math.min(cardRoom, Math.max(0, o.studentPays)) : 0;
    const due = Math.round((o.studentPays - card) * 100) / 100;
    return { card, due, ok: isTeacher || due <= 0 || cash >= due };
  };
  const claimPaymentNote = (o, source) => {
    const { card, due, ok } = claimPayment(o, source);
    const parts = [];
    if (card > 0) parts.push(`${fmtMoney(card)} on credit card`);
    if (due > 0 && !isTeacher) parts.push(`${fmtMoney(due)} from your everyday account`);
    return parts.join(" · ") + (ok ? "" : `. Available in everyday: ${fmtMoney(cash)}`);
  };
  const claimButtons = claims.length
    ? claims.map((o, i) => {
        const planName = escapeHtml(insurancePlanName(o.plan));
        const takeAsset = o.writeOff || o.losesVehicle;
        const amount = o.studentPays < 0 ? `You receive ${fmtMoney(-o.studentPays)}`
          : o.studentPays === 0 ? "No charge" : `You pay ${fmtMoney(o.studentPays)}`;
        const detail = o.writeOff ? `The insurer takes ${escapeHtml(o.property.name || "your house")}.`
          : `Insurer covers ${fmtMoney(o.payout)} · Excess due ${fmtMoney(o.excessDue)}`
            + (o.uncovered > 0 ? ` · Uncovered cost ${fmtMoney(o.uncovered)}` : "")
            + (o.losesVehicle ? `. You lose ${escapeHtml(vehicleName)}.` : "");
        return `<div class="be-claim">
          <div class="be-claim-head"><strong>${planName}</strong><strong>${amount}</strong></div>
          <p class="muted-small">${detail}</p>
          <p class="muted-small be-pay-note" id="bigClaimNote${i}">${claimPaymentNote(o, defaultClaimSource)}</p>
          <button type="button" class="btn small ${takeAsset ? "coral" : "gold"}" id="bigClaimBtn${i}"
            aria-label="Claim on ${planName}" ${claimPayment(o, defaultClaimSource).ok ? "" : "disabled"}>Claim insurance</button>
        </div>`;
      }).join("")
    : `<p class="muted-small">${cover.length
        ? (fittingTypes.length
          ? `You need ${escapeHtml(fittingTypes.map(c => insuranceTypeLabel(coverage, c.type)).join(" or "))} to claim.`
          : `No eligible plan covers this ${entry.assetType === "truck" ? "truck" : "vehicle"}.`)
        : "You have no matching insurance plan."}</p>`;

  const dismissHtml = snz.canDismiss
    ? `<div class="be-dismiss" id="bigDismissWrap">
        <button class="btn secondary" id="bigDismissBtn" type="button">${snz.used ? `Dismiss (${beFmt(snz.remainingMs)} left)` : "Dismiss for 5 minutes"}</button>
        <p class="muted-small">${snz.used
          ? "The popup will reopen when the timer runs out."
          : "Use this time to move money into your everyday account if you need to."}</p>
      </div>`
    : `<div class="be-forced" id="bigForcedNote" role="status">${icon("lock", 15)} <span>Your 5 minutes are up. You need to deal with this now.</span></div>`;
  overlay.innerHTML = `
    <div class="anw-modal-card be-card" role="dialog" aria-modal="true" aria-labelledby="bigEventTitle" tabindex="-1">
      <div class="be-heading">
        <span class="badge gold">${icon("bolt", 14)} Big event</span>
        <span class="badge navy">${BIG_EVENT_MODULE_LABEL[entry.module] || "General"}</span>
        <h2 id="bigEventTitle" class="be-title">${escapeHtml(entry.name)}</h2>
        ${entry.description ? `<p>${escapeHtml(entry.description)}</p>` : ""}
        ${impact ? `<p class="muted-small">${escapeHtml(impact)}</p>` : ""}
      </div>
      <div class="be-summary"><span>Full cost without a claim</span><strong>${fmtMoney(entry.cost)}</strong></div>
      <section class="be-section" aria-labelledby="bigInsuranceTitle">
        <h3 id="bigInsuranceTitle">Insurance</h3>
        ${canChooseClaimSource ? `<label class="muted-small be-from" for="bigClaimPayFrom">Pay your share from
          <select id="bigClaimPayFrom"><option value="cash">Everyday (${fmtMoney(cash)})</option><option value="card" ${defaultClaimSource === "card" ? "selected" : ""}>Credit card (${fmtMoney(cardRoom)} available)</option></select></label>` : ""}
        ${claimButtons}
      </section>
      <section class="be-section" aria-labelledby="bigPayTitle">
        <h3 id="bigPayTitle">Pay in full</h3>
        <div class="be-pay-buttons">
          <button class="btn small ${claims.length ? "secondary" : "gold"}" id="bigPayCashBtn" type="button">Pay from everyday</button>
          ${hasCard ? `<button class="btn small secondary" id="bigPayCardBtn" type="button" ${cardRoom > 0 ? "" : "disabled"}>Pay by credit card</button>` : ""}
        </div>
        ${cashWouldGoNegative ? `<p class="muted-small">You have ${fmtMoney(cash)} in everyday. Paying the full cost from everyday will take your balance below zero.</p>` : ""}
        ${hasCard && cardRoom < entry.cost ? `<p class="muted-small">${cardRoom > 0
          ? `Card payment uses ${fmtMoney(cardRoom)} of credit and ${fmtMoney(entry.cost - cardRoom)} from everyday.`
          : "Your credit card has no available credit."}</p>` : ""}
      </section>
      ${canForfeit ? `<div class="be-section"><button class="btn small coral" id="bigForfeitBtn" type="button">Lose ${assetLabel} without paying</button></div>` : ""}
      ${dismissHtml}
      <div id="bigEventMsg" role="alert"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector(".be-card").focus();

  // Only buttons that are actually usable get toggled between attempts.
  // Buttons disabled because of a genuine constraint (not enough cash,
  // no matching insurance plan) must STAY disabled after a
  // failed attempt at a different option. Previously ALL buttons were
  // blindly re-enabled on any error, which could un-disable e.g. "Claim
  // insurance" for a student with no matching plan.
  const eligibleIds = ["bigPayCashBtn"];
  if (canForfeit) eligibleIds.push("bigForfeitBtn");
  if (hasCard && cardRoom > 0) eligibleIds.push("bigPayCardBtn");
  if (snz.canDismiss) eligibleIds.push("bigDismissBtn");
  const claimSource = overlay.querySelector("#bigClaimPayFrom");
  const setClaimButtons = (busy) => {
    const source = claimSource ? claimSource.value : "cash";
    claims.forEach((o, i) => {
      overlay.querySelector("#bigClaimBtn" + i).disabled = busy || !claimPayment(o, source).ok;
      overlay.querySelector("#bigClaimNote" + i).textContent = claimPaymentNote(o, source);
    });
  };
  if (claimSource) claimSource.addEventListener("change", () => setClaimButtons(false));
  const setBusy = (busy) => {
    eligibleIds.forEach(id => { const b = overlay.querySelector("#" + id); if (b) b.disabled = busy; });
    if (claimSource) claimSource.disabled = busy;
    setClaimButtons(busy);
  };

  const resolve = async (choice, paySource, planId) => {
    setBusy(true);
    const res = await resolveBigEvent(username, classCode, entry.id, choice, paySource, planId);
    if (res.ok) {
      overlay.remove();
      entry.status = "resolved"; beDropEntry(entry.id);
      if (typeof render === "function") render();
    } else {
      overlay.querySelector("#bigEventMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
      setBusy(false);
    }
  };

  if (canForfeit) document.getElementById("bigForfeitBtn").addEventListener("click", () => resolve("forfeit"));
  document.getElementById("bigPayCashBtn").addEventListener("click", () => resolve("pay", "cash"));
  if (hasCard) document.getElementById("bigPayCardBtn").addEventListener("click", () => resolve("pay", "card"));
  claims.forEach((o, i) => {
    document.getElementById("bigClaimBtn" + i).addEventListener("click", async () => {
      if (o.writeOff && !await confirmWriteOff(o)) return;
      if (o.losesVehicle && !await t29Confirm(`${insurancePlanName(o.plan)} covers the damage to someone else's property. You'll lose ${vehicleName} and pay ${fmtMoney(o.excessDue)} in excess.\n\nClaim anyway?`)) return;
      const source = claimSource && !o.writeOff ? claimSource.value : "cash";
      resolve("claim", source, o.plan.id);
    });
  });

  // Put it away for 5 minutes. The first time starts the clock; a reopened popup is dismissed on that same
  // clock (snoozeBigEvent just confirms it); once the 5 minutes are up the server refuses and the button goes.
  const dismissBtn = overlay.querySelector("#bigDismissBtn");
  if (dismissBtn) dismissBtn.addEventListener("click", async () => {
    setBusy(true);
    const res = await snoozeBigEvent(username, classCode, entry.id);
    if (res.ok) {
      entry.snoozeUntil = res.snoozeUntil;
      overlay.remove();
      beSyncTimer([entry], username, classCode);
    } else if (res.expired) {
      entry.snoozeUntil = entry.snoozeUntil || 1; // time's up: make sure it reads as expired here too
      overlay.beForce();
      setBusy(false);
    } else if (res.gone) {
      overlay.remove(); beDropEntry(entry.id);
      if (typeof render === "function") render();
    } else {
      overlay.querySelector("#bigEventMsg").innerHTML = `<div class="error-msg">${res.error}</div>`;
      setBusy(false);
    }
  });
  // Called every second by the countdown timer while this popup is open: keeps the dismiss label's time
  // right, and takes the dismiss button away the moment the 5 minutes run out (so it can't be closed).
  overlay.beTick = (s) => {
    const b = overlay.querySelector("#bigDismissBtn");
    if (b && s.used && !b.disabled) b.textContent = `Dismiss (${beFmt(s.remainingMs)} left)`;
  };
  overlay.beForce = () => {
    const i = eligibleIds.indexOf("bigDismissBtn"); if (i >= 0) eligibleIds.splice(i, 1);
    const w = overlay.querySelector("#bigDismissWrap");
    if (w) w.outerHTML = `<div class="be-forced" id="bigForcedNote" role="status">${icon("lock", 15)} <span>Your 5 minutes are up. You need to deal with this now.</span></div>`;
  };
}

/* ===================== Big event countdown timer + reminders =====================
   A student who puts a big event away for 5 minutes (snoozeBigEvent in data-life.js) gets a small
   floating timer, under the cash widget on wide desktops and above it on laptops, tablets and phones
   (see .anw-be-timer in style.css). Tapping it reopens the popup, which can be dismissed again on the
   same clock. Because the clock is saved on the event, the timer comes back on every page and device
   (checkBigEventPopup restarts it on load), and at zero the forced popup returns.
   Two reminders happen on the way, each claimed once on the event (claimBigEventReminder) so they
   don't repeat on another page or device, and a student who reloads part-way through still gets the
   one they're due: at half time, and with 1 minute left ("have you moved your money?"). */
const BE_TIMER = { el: null, iv: null, entry: null, username: "", classCode: "", claiming: false, bound: false };

// 4:05 style countdown text.
function beFmt(ms) {
  const s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// Starts, retargets or stops the timer from the student's waiting events: it follows whichever
// running clock ends first.
function beSyncTimer(entries, username, classCode) {
  const running = (entries || []).filter(e => bigEventSnooze(e).running).sort((a, b) => a.snoozeUntil - b.snoozeUntil);
  if (!running.length) { beStopTimer(); return; }
  BE_TIMER.entry = running[0];
  BE_TIMER.username = username;
  BE_TIMER.classCode = classCode;
  if (!BE_TIMER.el || !BE_TIMER.el.isConnected) beMountTimer();
  if (!BE_TIMER.iv) BE_TIMER.iv = setInterval(beTick, 1000);
  beTick();
}

function beMountTimer() {
  if (!document.body) return;
  const old = document.getElementById("anwBigEventTimer");
  if (old) old.remove();
  const b = document.createElement("button");
  b.type = "button";
  b.id = "anwBigEventTimer";
  b.className = "anw-be-timer";
  b.setAttribute("aria-haspopup", "dialog");
  b.innerHTML = `<span class="anw-be-label">${icon("bolt", 14)} <span class="anw-be-txt">Big event</span></span><span class="anw-be-value">0:00</span>`;
  b.addEventListener("click", beReopen);
  document.body.appendChild(b);
  BE_TIMER.el = b;
  if (!BE_TIMER.bound) { BE_TIMER.bound = true; window.addEventListener("resize", bePositionTimer); }
  bePositionTimer();
}

// On a wide desktop the cash widget sits in the corner and the timer goes just below it; everywhere else
// the CSS stacks it above the cash widget's pill, so nothing needs measuring.
function bePositionTimer() {
  const t = BE_TIMER.el;
  if (!t) return;
  const cash = document.getElementById("anwBalanceWidget");
  if (cash && window.innerWidth > 1480) t.style.setProperty("--be-top", (cash.getBoundingClientRect().bottom + 10) + "px");
  else t.style.removeProperty("--be-top");
}

function beStopTimer() {
  if (BE_TIMER.iv) { clearInterval(BE_TIMER.iv); BE_TIMER.iv = null; }
  if (BE_TIMER.el) { BE_TIMER.el.remove(); BE_TIMER.el = null; }
  BE_TIMER.entry = null;
  const r = document.getElementById("anwBigEventReminderModal");
  if (r && r.beClose) r.beClose();
}

// The event was answered (or is gone): stop following it.
function beDropEntry(id) {
  if (BE_TIMER.entry && BE_TIMER.entry.id === id) beStopTimer();
}

function beTick() {
  const T = BE_TIMER, e = T.entry;
  if (!e) return;
  if (!T.el || !T.el.isConnected) beMountTimer();
  const s = bigEventSnooze(e);
  if (s.expired) { beExpire(); return; }
  const text = beFmt(s.remainingMs);
  const v = T.el.querySelector(".anw-be-value");
  if (v && v.textContent !== text) v.textContent = text;
  T.el.classList.toggle("is-warn", s.remainingMs <= BIG_EVENT_SNOOZE_FINAL_MS);
  T.el.title = `Big event: ${text} left. Tap to open it.`;
  bePositionTimer();
  const m = document.getElementById("anwBigEventModal");
  if (m && m.beTick) m.beTick(s);
  beCheckReminders(s);
}

// Shows the reminder that is due, once. The claim is atomic on the event, so only one page/device wins it.
async function beCheckReminders(s) {
  const T = BE_TIMER, e = T.entry;
  if (!e || T.claiming) return;
  let which = null;
  if (s.remainingMs <= BIG_EVENT_SNOOZE_FINAL_MS && !e.snoozeFinalShown) which = "final";
  else if (s.remainingMs <= BIG_EVENT_SNOOZE_HALF_MS && !e.snoozeHalfShown) which = "half";
  if (!which) return;
  T.claiming = true;
  const before = { half: e.snoozeHalfShown, final: e.snoozeFinalShown };
  // Mark it locally first so a slow claim isn't retried every second (claiming "final" also uses up "half").
  if (which === "final") { e.snoozeFinalShown = true; e.snoozeHalfShown = true; } else e.snoozeHalfShown = true;
  let won = false;
  try { won = await claimBigEventReminder(T.classCode, e.id, which); }
  catch (err) { e.snoozeHalfShown = before.half; e.snoozeFinalShown = before.final; } // couldn't claim: try again next tick
  T.claiming = false;
  if (won && BE_TIMER.entry === e && bigEventSnooze(e).running) beShowReminder(which, e);
}

function beShowReminder(which, entry) {
  const old = document.getElementById("anwBigEventReminderModal");
  if (old && old.beClose) old.beClose();
  const final = which === "final";
  const onBank = /bank\.html$/.test(location.pathname);
  const overlay = document.createElement("div");
  overlay.id = "anwBigEventReminderModal";
  overlay.className = "anw-modal-overlay";
  overlay.innerHTML = `
    <div class="anw-modal-card be-card" role="alertdialog" aria-modal="true" aria-labelledby="beRemTitle" aria-describedby="beRemBody">
      <h2 id="beRemTitle" class="be-title">${icon(final ? "bolt" : "hourglass", 24)} <span>${final ? "1 minute left" : "Halfway through your 5 minutes"}</span></h2>
      <div id="beRemBody">
        ${final
          ? `<p><strong>Have you transferred money into your everyday account to pay the excess or cost?</strong></p>
             <p class="muted-small">${escapeHtml(entry.name)} comes back in about a minute, and then you have to deal with it.</p>`
          : `<p>About <strong>${beFmt(bigEventSnooze(entry).remainingMs)}</strong> left before <strong>${escapeHtml(entry.name)}</strong> comes back. If you need to move money into your everyday account to pay the excess or cost, now is the time.</p>`}
      </div>
      <div class="be-actions">
        <button class="btn gold" id="beRemOpen" type="button">${final ? "Yes, open the big event" : "Open the big event"}</button>
        ${final && !onBank
          ? `<a class="btn secondary" href="bank.html">Not yet. Go to Bank</a>`
          : `<button class="btn secondary" id="beRemClose" type="button">${final ? "Not yet" : "Keep going"}</button>`}
      </div>
    </div>`;
  const onKey = (ev) => { if (ev.key === "Escape") overlay.beClose(); };
  overlay.beClose = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.beClose(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  overlay.querySelector("#beRemOpen").addEventListener("click", () => { overlay.beClose(); beReopen(); });
  const closeBtn = overlay.querySelector("#beRemClose");
  if (closeBtn) closeBtn.addEventListener("click", () => overlay.beClose());
  overlay.querySelector("#beRemOpen").focus();
}

// The 5 minutes are up. If the popup is open it is locked in place (no dismiss, can't be closed);
// otherwise the forced popup comes back.
function beExpire() {
  const { username, classCode } = BE_TIMER;
  beStopTimer();
  const m = document.getElementById("anwBigEventModal");
  if (m && m.beForce) { m.beForce(); return; }
  try { window._rcDel("classes", classCode); } catch (e) { /* the cache is only a safety net */ }
  checkBigEventPopup(username, classCode, true).catch(() => {});
}

// Tapping the timer (or "open the big event" in a reminder): reads the latest copy, so money the student
// just moved is counted, and shows the popup again.
async function beReopen() {
  if (document.getElementById("anwBigEventModal")) return;
  const { username, classCode } = BE_TIMER;
  const id = BE_TIMER.entry && BE_TIMER.entry.id;
  if (!username || !classCode || !id) return;
  try { window._rcDel("classes", classCode); window._rcDel("users", username); } catch (e) { /* ignore */ }
  const [cls, user] = await Promise.all([getClassCached(classCode), getUserCached(username)]);
  const entry = cls && (cls.bigEventLog || []).find(e => e.id === id && e.status === "pending");
  if (!entry) { beStopTimer(); if (typeof render === "function") render(); return; } // answered somewhere else
  if (document.getElementById("anwBigEventModal")) return;
  showBigEventPopup(entry, bigEventClaimOptions(cls, user, entry), username, classCode, user);
}

/* ---------------- Buttons held while a big event is waiting ----------------
   For the pages' sell / list / insurance buttons (the data-*.js files refuse these too, see
   BIG_EVENT_BLOCK_MESSAGE). kind: "vehicle" | "property" | "insurance". Returns
   { locked, reason, attr, note }: attr goes inside the <button> tag (disabled + the reason as a
   tooltip), note is a visible line saying why (touch screens have no tooltips). */
function bigEventLockUi(cls, username, kind) {
  let lock;
  try { lock = bigEventLockFor(cls, username); } catch (e) { lock = null; }
  const on = !!lock && (kind === "vehicle" ? lock.vehicles : kind === "property" ? lock.property : kind === "insurance" ? lock.insurance : false);
  if (!on) return { locked: false, reason: "", attr: "", note: "" };
  const what = kind === "vehicle" ? "your transport big event is" : kind === "property" ? "your property big event is" : "a big event is";
  const reason = `Locked while ${what} waiting. Tap the Big event timer to deal with it first.`;
  return {
    locked: true, reason,
    attr: ` disabled aria-disabled="true" title="${escapeHtml(reason)}"`,
    note: `<div class="be-lock-note">${icon("lock", 13)} <span>${escapeHtml(reason)}</span></div>`
  };
}

/* ===================== Weekly life voucher picker =====================
   Life items give a student one voucher per category (store / transport /
   property / insurance) every week. Called before the pay step of a purchase.
   Resolves "" if they have no voucher to offer or chose none, the voucher id
   if they picked one, or null if they backed out. */
async function lifeAskVoucher(me, category, price, what) {
  price = Math.round((Number(price) || 0) * 100) / 100;
  const vs = price > 0 ? lifeUsableVouchers(me, category) : [];
  if (!vs.length) return "";
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "anw-modal-overlay";
    overlay.innerHTML = `
      <div class="anw-modal-card">
        <h2 style="display:flex;align-items:center;gap:9px;">${icon("ticket", 24)} Use a life voucher?</h2>
        <p><strong>${escapeHtml(what || "This purchase")}</strong> &middot; ${fmtMoney(price)}</p>
        <p class="muted-small">Each voucher works once and runs out at the end of this week.</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px;">
          ${vs.map(v => `<button class="btn gold" data-vid="${escapeHtml(v.id)}">${v.pct}% off &middot; ${escapeHtml(v.itemName)} <small>(saves ${fmtMoney(Math.round(price * v.pct) / 100)})</small></button>`).join("")}
          <button class="btn secondary" data-vid="">No voucher, pay full price</button>
          <button class="btn" data-vid="__cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = v => { overlay.remove(); resolve(v); };
    overlay.querySelectorAll("[data-vid]").forEach(b => b.addEventListener("click", () => {
      const v = b.getAttribute("data-vid");
      done(v === "__cancel" ? null : v);
    }));
    overlay.addEventListener("click", e => { if (e.target === overlay) done(null); });
  });
}

/* ===================== Pay with: cash, credit card, or both =====================
   Used by every purchase a real card could pay for (vehicles, licence,
   weekly transport, insurance sign-up, Trade Centre). A student with no
   active card never sees it: it resolves straight away with {} (= cash).
   Resolves with null if they back out. Otherwise the options go straight
   into the purchase function: { useCard, split, cardMax }. Splitting is
   only offered on big purchases (the teacher's setting) or when the card
   can't cover the whole thing — see cardSplitAllowed(). */
async function cardAskPay(total, what) {
  total = Math.round((Number(total) || 0) * 100) / 100;
  const s = await getSessionUser();
  if (!s || s.role !== "student" || !(total > 0)) return {};
  const [me, cls] = await Promise.all([getUserCached(s.username), getClassCached(s.classCode)]);
  if (!me || !cls || !cardIsActive(me)) return {};
  const plan = cardPlanById(cls, me.creditCard.planId);
  if (!plan) return {};
  const avail = cardAvailable(me.creditCard, plan), cash = me.balance || 0;
  const canCard = avail >= total - 0.004, canSplit = cardSplitAllowed(me, cls, total);
  const maxCard = Math.min(avail, total);
  const startCard = total > avail ? maxCard : Math.round(total / 2 * 100) / 100;
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "anw-modal-overlay";
    overlay.innerHTML = `
      <div class="anw-modal-card">
        <h2 style="display:flex;align-items:center;gap:9px;">${icon("creditcard", 24)} How do you want to pay?</h2>
        <p><strong>${escapeHtml(what || "This purchase")}</strong> &middot; ${fmtMoney(total)}</p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px;">
          <button class="btn gold" data-mode="cash">Pay from cash <small>(${fmtMoney(cash)} available)</small></button>
          <button class="btn gold" data-mode="card" ${canCard ? "" : "disabled"}>Put it on my credit card <small>(${canCard ? `${fmtMoney(avail)} available` : `only ${fmtMoney(avail)} available`})</small></button>
          ${canSplit ? `<div style="border:1px solid var(--line, #ddd);border-radius:var(--r-4);padding:10px;display:flex;flex-direction:column;gap:8px;">
            <label for="cardSplitAmt" style="font-weight:700;">Part card, part cash</label>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">Card covers $<input id="cardSplitAmt" type="number" min="0.01" max="${maxCard}" step="0.01" value="${startCard}" style="width:110px;">
              <span class="muted-small" id="cardSplitCash"></span></div>
            <button class="btn secondary" data-mode="split">Split the payment</button></div>` : ""}
          <button class="btn" data-mode="cancel">Cancel</button>
        </div>
        <div id="cardAskMsg"></div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    const amtEl = overlay.querySelector("#cardSplitAmt");
    const upd = () => { if (!amtEl) return; const c = Math.min(maxCard, Math.max(0, Number(amtEl.value) || 0)); overlay.querySelector("#cardSplitCash").textContent = `Cash covers ${fmtMoney(Math.max(0, Math.round((total - c) * 100) / 100))}`; };
    if (amtEl) { amtEl.addEventListener("input", upd); upd(); }
    overlay.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => {
      const m = b.getAttribute("data-mode");
      if (m === "cancel") return done(null);
      if (m === "cash") return done({});
      if (m === "card") return done({ useCard: true });
      const c = Math.round((Number(amtEl.value) || 0) * 100) / 100;
      if (!(c > 0) || c > maxCard + 0.004) { overlay.querySelector("#cardAskMsg").innerHTML = `<div class="error-msg">Enter an amount between $0.01 and ${fmtMoney(maxCard)}.</div>`; return; }
      done({ useCard: true, split: true, cardMax: c });
    }));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
  });
}

// Shows a waiting big event the moment a student's page loads, rather
// than only once the page's start-up jobs have finished (that can take a
// few seconds on pay day — time enough to sell the thing at risk).
document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    const s = await getSessionUser();
    if (s && s.role === "student" && s.classCode) await checkBigEventPopup(s.username, s.classCode, true);
  })().catch(() => { /* the page's own check still runs after its start-up jobs */ });
});

/* ===================== Insurance types picker (teacher) =====================
   Shared by the weekly events form (teacher.html) and the big events form
   (events.html): first what happened (fire, theft, house damage...),
   then one row per property/transport insurance type, each with a tick box
   and how much that type pays out. Types that don't cover what happened
   can't be ticked — each type only covers what its description says.
   Transport events can tick several things that happened (e.g. an accident
   that also damaged someone else's car); property events pick one, since
   "the house and its contents" already covers both. */

// What's currently picked under "What happened?": a list for transport,
// one value (or "") for property.
function pickerIncident(box) {
  const opts = box.querySelectorAll("[data-ins-incident-opt]");
  if (opts.length) return [...opts].filter(cb => cb.checked).map(cb => cb.value);
  const sel = box.querySelector("[data-ins-incident]");
  return sel ? sel.value : "";
}

function renderInsuranceCoverPicker(boxId, coverage, cover, incident, vehicles) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const types = INSURANCE_TYPES[coverage] || [];
  box.dataset.coverage = types.length ? coverage : "";
  box.dataset.vehicles = vehicles === undefined ? "" : cleanEventVehicles(vehicles);
  if (!types.length) { box.innerHTML = ""; box.classList.add("hidden"); return; }
  const multi = coverage === "transport";
  const inc = cleanIncident(coverage, incident);
  const picked = incidentList(inc);
  const byType = {};
  (cover || []).forEach(c => { byType[c.type] = c; });
  box.classList.remove("hidden");
  const rowHtml = t => {
    const row = byType[t.key];
    // vehicles (transport big events only): Truck Insurance only fits events for trucks, the rest only cars and bikes.
    const vehOk = vehicles === undefined || typeFitsEventVehicles(coverage, t.key, vehicles);
    const fits = vehOk && picked.length > 0 && typeCoversIncident(coverage, t.key, inc, false);
    const coveredHere = picked.filter(k => t.covers.includes(k));
    const writeOff = fits && isHouseWriteOff(coverage, t.key, inc);
    const checked = fits && !!row;
    const subs = [];
    if (t.vehicles === "trucks") subs.push("Trucks only.");
    if (t.vehicles === "cars") subs.push("Cars and bikes only.");
    if (writeOff) subs.push("The student gets the house's market price and the insurer takes the house.");
    // Several things happened but this type only covers some of them —
    // its amount should be for its part.
    if (fits && coveredHere.length < picked.length) {
      subs.push(`Only covers ${incidentLabels(coverage, coveredHere, "short").join(" and ")} here, so set the amount for that part.`);
    }
    let pay;
    if (!picked.length) pay = `<span class="muted-small">${multi ? "Tick what happened first" : "Choose what happened first"}</span>`;
    else if (!vehOk) pay = `<span class="muted-small">Not for ${cleanEventVehicles(vehicles) === "trucks" ? "truck" : "car and bike"} events</span>`;
    else if (!fits) pay = `<span class="muted-small">Doesn't cover ${picked.length > 1 ? "any of these" : escapeHtml(incidentLabels(coverage, inc, "short")[0])}</span>`;
    else if (writeOff && inc === "house") pay = `<span class="muted-small ins-cover-pay">pays the house's market price</span>`;
    else pay = `<span class="ins-cover-pay"><span class="muted-small">${writeOff ? "market price + contents $" : "pays $"}</span>
        <input type="number" min="0" step="0.01" data-ins-payout="${t.key}" aria-label="${escapeHtml(t.label)} payout" placeholder="0" value="${row ? row.payout : ""}" ${checked ? "" : "disabled"}></span>`;
    return `
      <div class="ins-cover-row${fits ? "" : " off"}">
        <input type="checkbox" id="${boxId}-${t.key}" data-ins-type="${t.key}" ${checked ? "checked" : ""} ${fits ? "" : "disabled"}>
        <label for="${boxId}-${t.key}"><span>${escapeHtml(t.label)}</span>${subs.length ? `<span class="ins-cover-sub">${escapeHtml(subs.join(" "))}</span>` : ""}</label>
        ${pay}
      </div>`;
  };
  const incidentHtml = multi
    ? `<label style="margin-top:12px;">What happened? <span class="muted-small" style="font-weight:400;">Tick everything that applies.</span></label>
      <div class="ins-incident-grid">
        ${INSURANCE_INCIDENTS[coverage].map(i => `
          <label class="ins-incident-opt"><input type="checkbox" data-ins-incident-opt value="${i.key}" ${picked.includes(i.key) ? "checked" : ""}> ${escapeHtml(i.label)}</label>`).join("")}
      </div>`
    : `<label for="${boxId}-incident" style="margin-top:12px;">What was damaged?</label>
      <select id="${boxId}-incident" data-ins-incident>
        <option value="" disabled ${inc ? "" : "selected"}>Choose…</option>
        ${INSURANCE_INCIDENTS[coverage].map(i => `<option value="${i.key}" ${i.key === inc ? "selected" : ""}>${escapeHtml(i.label)}</option>`).join("")}
      </select>`;
  box.innerHTML = `
    ${incidentHtml}
    <label style="margin-top:12px;">Which ${coverage} insurance covers this?</label>
    <p class="muted-small" style="margin-top:0;">Tick each type that can claim and how much it pays out.${multi ? " If a type only covers part of what happened, set the amount for its part." : ""} Students pay their plan's excess plus anything the payout doesn't cover. Tick none and any ${coverage} plan that covers ${multi ? "everything that happened" : "this"} pays the full cost (the student just pays the excess).</p>
    ${types.map(rowHtml).join("")}
  `;
  box.querySelectorAll("[data-ins-type]").forEach(cb => cb.addEventListener("change", () => {
    const amt = box.querySelector(`[data-ins-payout="${cb.dataset.insType}"]`);
    if (!amt) return;
    amt.disabled = !cb.checked;
    if (cb.checked) amt.focus();
  }));
  // Changing what happened redraws the rows, keeping whatever's still ticked.
  const redraw = () => {
    const kept = [];
    box.querySelectorAll("[data-ins-type]").forEach(cb => {
      if (!cb.checked) return;
      const amt = box.querySelector(`[data-ins-payout="${cb.dataset.insType}"]`);
      kept.push({ type: cb.dataset.insType, payout: amt ? amt.value : "" });
    });
    renderInsuranceCoverPicker(boxId, coverage, kept, pickerIncident(box), vehicles);
  };
  box.querySelectorAll("[data-ins-incident], [data-ins-incident-opt]").forEach(el => el.addEventListener("change", redraw));
}

// Reads the picker back as { incident, cover: [{ type, payout }] } — empty
// when it's hidden. incident is a list for transport, one value for
// property. Returns null, after telling the teacher why, if nothing is
// picked for what happened or a ticked type has no valid payout.
function readInsuranceCoverPicker(boxId) {
  const box = document.getElementById(boxId);
  if (!box || box.classList.contains("hidden")) return { incident: null, cover: [] };
  const coverage = box.dataset.coverage;
  const incident = cleanIncident(coverage, pickerIncident(box));
  if (!incident) {
    alert(coverage === "property" ? "Choose what was damaged." : "Tick at least one thing that happened.");
    const first = box.querySelector("[data-ins-incident], [data-ins-incident-opt]");
    if (first) first.focus();
    return null;
  }
  const out = [];
  for (const cb of box.querySelectorAll("[data-ins-type]")) {
    if (!cb.checked || cb.disabled) continue;
    const type = cb.dataset.insType;
    const input = box.querySelector(`[data-ins-payout="${type}"]`);
    if (!input) { out.push({ type, payout: 0 }); continue; } // Indemnity on the house: market price, no amount
    const raw = input.value.trim();
    const amount = Number(raw);
    if (raw === "" || !Number.isFinite(amount) || amount < 0) {
      alert(isHouseWriteOff(coverage, type, incident)
        ? `Enter how much ${insuranceTypeLabel(coverage, type)} pays for the contents (0 or more), or untick it.`
        : `Enter how much ${insuranceTypeLabel(coverage, type)} pays out (0 or more), or untick it.`);
      return null;
    }
    out.push({ type, payout: amount });
  }
  return { incident, cover: out };
}
