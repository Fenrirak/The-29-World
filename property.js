let CURRENT, IS_TEACHER, EDITING_ID = null, EDITING_NPC_ID = null;
let MORTGAGE_SETTINGS_CLS = null; // last-loaded class doc, used to preview the force-due toggle before saving
function comfortStars(n) {
  n = Number(n) || 0;
  return `<span class="ticker-up">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
}


// "Today's" price move for a listing — the difference between the most
// recent two points in its priceHistory (NOT the oldest-vs-newest of the
// whole up-to-30-day window, which would blur many days together into one
// number). A listing with only one history point (brand new, or hasn't
// been through a simulated day yet) has no "today" to report — callers
// check hist.length before showing this.
function propertyDailyChange(p) {
  const hist = p.priceHistory && p.priceHistory.length ? p.priceHistory : [p.price];
  const last = hist[hist.length - 1];
  const prev = hist.length > 1 ? hist[hist.length - 2] : last;
  const diff = Math.round((last - prev) * 100) / 100;
  const pct = prev ? (diff / prev) * 100 : 0;
  return { diff, pct };
}

// Shown next to every action that actually moves a student into a new
// home (choosing to live in an owned property, claiming a classmate's
// sublet, or renting an NPC listing) so the cost is visible right where
// they're about to trigger it, not just buried in the confirm() prompt or
// the teacher's settings panel. cls.movingCost is a single class-wide
// value, so this reads the same wherever it's shown.
function movingCostNote(cls) {
  const cost = Number(cls && cls.movingCost) || 0;
  return `<p class="muted-small"> Moving cost: <strong>${cost > 0 ? fmtMoney(cost) : "Free"}</strong> &middot; you can only move house once a day.</p>`;
}




async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = "Dashboard";
  document.getElementById("teacherTabs").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentTabs").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  // Teachers don't need data to know which tab to open; students get theirs
  // in render() once it's known whether they own or rent anything.
  if (IS_TEACHER) setTab(TABS_BY_ROLE.teacher.includes(savedTab()) ? savedTab() : "listings", false);
  // BUGFIX: this page runs the same day-gated jobs (automations, rent,
  // interest, term deposits...) as bank.js/teacher.js/student.js but was
  // missing the server-clock sync those pages already do first — see
  // syncServerClock in data-core.js. Without it, a device with a wrong local
  // clock decides "today" for every job below off its own drifted clock,
  // which is exactly what makes an automatic payment fire more than once
  // in the same real day. Kicked off here, in parallel with the first
  // paint below, so it doesn't add to load time; the jobs themselves
  // aren't constructed until it resolves (same order as the other pages).
  const T29_CLOCK_SYNC = syncServerClock(u.classCode);
  await t29FirstPaint(render);
  await T29_CLOCK_SYNC;
  // These 7 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 7 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  const T29_STARTUP_JOBS = Promise.all([
    IS_TEACHER
      ? safeBgJob(payDayForClassIfDue(u.classCode), "payDayForClassIfDue")
      : safeBgJob(payMyWageIfDue(u.username), "payMyWageIfDue"),
    IS_TEACHER
      ? safeBgJob(dailyLifeAllowanceForClassIfDue(u.classCode), "dailyLifeAllowanceForClassIfDue")
      : safeBgJob(payMyDailyLifeAllowanceIfDue(u.username), "payMyDailyLifeAllowanceIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processPropertyRent(u.classCode), "processPropertyRent"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    IS_TEACHER
      ? safeBgJob(applyInterestToClassIfDue(u.classCode), "applyInterestToClassIfDue")
      : safeBgJob(applyMyInterestIfDue(u.username), "applyMyInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents"),
    safeBgJob(autoVariableRatesIfDue(u.classCode), "autoVariableRatesIfDue")
  ]);
  await T29_STARTUP_JOBS;
  // These popups read the results of the jobs above, so they still need
  // to run afterwards — but stay sequential since each checks whether
  // another popup is already showing before deciding to show its own.
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

// Groups the flat list of per-unit property records into listings (all
// units sharing a groupId — see the data-*.js files). Properties saved before this
// feature existed have no groupId, so they fall back to being their own
// group of 1, exactly as before.
function groupProperties(props) {
  const order = [];
  const byGroup = new Map();
  props.forEach(p => {
    const gid = p.groupId || p.id;
    if (!byGroup.has(gid)) { byGroup.set(gid, []); order.push(gid); }
    byGroup.get(gid).push(p);
  });
  return order.map(gid => byGroup.get(gid));
}


/* ---------------- Teacher: property daily price movement ---------------- */
function populatePropertyMarketSettings(cls) {
  const range = cls.propertyPriceRange || { min: 0.5, max: 2 };
  document.getElementById("propRangeMin").value = range.min;
  document.getElementById("propRangeMax").value = range.max;
}
async function savePropRange() {
  const min = document.getElementById("propRangeMin").value;
  const max = document.getElementById("propRangeMax").value;
  await setPropertyPriceRange(CURRENT.classCode, min, max);
  setMsg("propRangeMsg", `<div class="success-msg">Saved — listings without their own custom range will move between ${min}% and ${max}% per simulated day.</div>`);
  await render();
}
async function runPropertyMarketDay() {
  const results = await simulatePropertyMarketDay(CURRENT.classCode);
  if (results.length === 0) {
    alert("There are no properties listed for sale yet.");
    return;
  }
  const summary = results.map(r => `${r.name}: ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%`).join("\n");
  alert("Property market day complete!\n\n" + summary);
  await render();
}
// id is any unit's id within the listing (see setListingPriceRange in
// the data-*.js files) — the msg box lives at msg-<groupId>, so this looks up the
// listing's groupId fresh rather than trying to thread it through the
// onclick call.
async function overridePriceClick(id) {
  const val = document.getElementById("price-" + id).value;
  const res = await setPropertyPrice(CURRENT.classCode, id, val);
  await showListingActionResult(id, res, "Price updated.");
}
async function setListingRangeClick(id) {
  const min = document.getElementById("prmin-" + id).value;
  const max = document.getElementById("prmax-" + id).value;
  const res = await setListingPriceRange(CURRENT.classCode, id, min, max);
  await showListingActionResult(id, res, "Range saved for this listing.");
}
async function clearListingRangeClick(id) {
  const res = await setListingPriceRange(CURRENT.classCode, id, "", "");
  await showListingActionResult(id, res, "Reset to the class default range.");
}

// "Since you bought it" gain/loss for an owned unit — how today's
// (fluctuating — see applyPropertyMarketDayMoves) price compares to what
// was actually paid at purchase time (p.purchasePrice, set by buyProperty;
// see the comment there for exactly what it captures, and the migration
// note on withNewModuleDefaults for how a property owned before this
// feature existed gets a starting baseline). Returns null when there's no
// baseline to compare against, which should only ever be an unowned unit.
function propertyGainSinceBought(p) {
  if (!Number.isFinite(p.purchasePrice) || p.purchasePrice <= 0) return null;
  const diff = Math.round((p.price - p.purchasePrice) * 100) / 100;
  const pct = (diff / p.purchasePrice) * 100;
  return { diff, pct };
}



async function createSubletClick(id) {
  const price = document.getElementById(`subletPrice-${id}`).value;
  const weeks = document.getElementById(`subletWeeks-${id}`).value;
  const res = await createSublet(CURRENT.username, CURRENT.classCode, id, price, weeks);
  const box = document.getElementById(`subletFormMsg-${id}`);
  if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
  await render();
}



async function cancelSubletClick(id) {
  const res = await cancelSublet(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}
async function teacherEndSubletClick(id) {
  if (!await t29Confirm("End this classmate rental? If someone's living there, they'll be kicked out immediately.")) return;
  const res = await teacherEndSublet(CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

/* ---------------- Teacher: rental settings & moderation ---------------- */
function populateRentalSettings(cls) {
  const pr = cls.propertyRentals || {};
  document.getElementById("rentalEnabled").checked = !!pr.enabled;
  document.getElementById("rentalRequireApproval").checked = !!pr.requireApproval;
  document.getElementById("rentalMinPricePct").value = pr.minPricePct != null ? pr.minPricePct : 25;
  document.getElementById("rentalMaxPricePct").value = pr.maxPricePct != null ? pr.maxPricePct : 200;
  document.getElementById("rentalMaxLeaseWeeks").value = pr.maxLeaseWeeks != null ? pr.maxLeaseWeeks : 8;
}
async function saveRentalSettingsClick() {
  const settings = {
    enabled: document.getElementById("rentalEnabled").checked,
    requireApproval: document.getElementById("rentalRequireApproval").checked,
    minPricePct: document.getElementById("rentalMinPricePct").value,
    maxPricePct: document.getElementById("rentalMaxPricePct").value,
    maxLeaseWeeks: document.getElementById("rentalMaxLeaseWeeks").value
  };
  await saveSubletSettings(CURRENT.classCode, settings);
  setMsg("rentalSettingsMsg", `<div class="success-msg">Settings saved.</div>`);
  await render();
}
async function approveSubletClick(id) {
  await decideSublet(CURRENT.classCode, id, true);
  await render();
}
async function rejectSubletClick(id) {
  const reason = await t29Prompt("Optional reason to show the student (leave blank for none):", "", { confirmText: "Decline", danger: true, placeholder: "Reason (optional)" });
  if (reason === null) return;
  await decideSublet(CURRENT.classCode, id, false, reason);
  await render();
}

/* ---------------- Student: my rented home & browsing rentals ---------------- */
// Shared status-line builder for a tenant's own rented home — works for
// both a classmate sublet and an NPC unit, since both carry the same
// leaseStartWeekKey/rentLastWeekPaid shape, just at different paths on the
// caller's object (prop.sublet.* vs unit.* directly), so callers pass the
// individual fields in rather than the whole record.
function tenantRentStatusLine(leaseStartWeekKey, rentLastWeekPaid, rentDay, price, overdue) {
  const weekKey = isoWeekKey();
  const moveInWeek = leaseStartWeekKey === weekKey;
  const alreadyPaid = rentLastWeekPaid === weekKey;
  const isDueToday = (rentDay || "Fri") === nzDayName();
  if (moveInWeek) return { status: `Your first payment isn't due yet — the week you moved in is free. It'll be ${fmtMoney(price)}, due ${DAY_FULL[rentDay || "Fri"]}.`, canPay: false, why: "The week you moved in is free" };
  if (alreadyPaid) return { status: `This week's rent of ${fmtMoney(price)} is already sorted.`, canPay: false, why: "Already paid this week" };
  if (!isDueToday) return { status: `Rent is due every ${DAY_FULL[rentDay || "Fri"]}. This week's will be ${fmtMoney(price)} — come back then to pay it yourself.`, canPay: false, why: `Rent can only be paid on ${DAY_FULL[rentDay || "Fri"]}s` };
  return { status: `${overdue ? "This week's rent is overdue. " : "Rent is due today. "}<strong>${fmtMoney(price)}</strong>.`, canPay: true };
}

async function payTenantRentClick(id) {
  // Same double-tap guard as buy() in market.js.
  const btn = document.getElementById("payTenantRentBtn-" + id);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const res = await payTenantRent(CURRENT.username, CURRENT.classCode, id, false);
    const box = document.getElementById(`tenantRentMsg-${id}`);
    if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
    await render();
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function tenantMoveOutClick(id) {
  if (!await t29Confirm("Move out of this rental? You'll stop paying rent, but you'll also lose the lifestyle bonus for living here.")) return;
  const res = await tenantMoveOut(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

async function claimSubletClick(id) {
  const res = await claimSublet(CURRENT.username, CURRENT.classCode, id);
  const box = document.getElementById("rentMsg");
  if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
  await render();
  setTab("homes");
}

/* ---------------- Student: NPC (school) rentals ---------------- */
async function payNpcRentClick(id) {
  // Same double-tap guard as buy() in market.js.
  const btn = document.getElementById("payNpcRentBtn-" + id);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const res = await payNpcRent(CURRENT.username, CURRENT.classCode, id, cardPayToggleOn("n-" + id));
    const box = document.getElementById(`npcRentMsg-${id}`);
    if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
    await render();
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function npcMoveOutClick(id) {
  if (!await t29Confirm("Move out of this rental? You'll stop paying rent, but you'll also lose the lifestyle bonus for living here.")) return;
  const res = await moveOutNpcProperty(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

async function pickAvailableNpcUnitId(gid) {
  const cls = await getClassCached(CURRENT.classCode);
  const unit = (cls.npcProperties || []).find(p => (p.groupId || p.id) === gid && !p.tenant);
  return unit ? unit.id : null;
}
async function rentNpcClick(gid) {
  const id = await pickAvailableNpcUnitId(gid);
  const box = document.getElementById("rentMsg");
  if (!id) { if (box) box.innerHTML = `<div class="error-msg">Sorry, none are available right now.</div>`; return; }
  const res = await rentNpcProperty(CURRENT.username, CURRENT.classCode, id);
  if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
  await render();
  setTab("homes");
}


async function payMortgageClick(id) {
  // Same double-tap guard as buy() in market.js.
  const btn = document.getElementById("payMortgageBtn-" + id);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const res = await payMortgage(CURRENT.username, CURRENT.classCode, id, false); // cash only
    if (!res.ok) {
      const box = document.getElementById(`mortgageMsg-${id}`);
      if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`;
      return;
    }
    await render();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Builds the status badge row for the teacher-only mortgage settings card.
// previewForceDue, when passed, lets the toggle show what would change
// before it's actually saved (see previewMortgageForceDue).
function mortgageStatusBadges(cls, previewForceDue) {
  const day = cls.mortgageDay || "Fri";
  const weekKey = isoWeekKey();
  const storedForceDue = cls.mortgageForceDueWeek === weekKey;
  const forceDue = previewForceDue === undefined ? storedForceDue : previewForceDue;
  const dueToday = day === nzDayName();

  let badges = `<span class="badge navy">Due every ${DAY_FULL[day]}</span>`;
  if (dueToday) badges += `<span class="badge mint">Due today</span>`;
  if (forceDue && !dueToday) badges += `<span class="badge gold">This week: due now (override)</span>`;
  if (forceDue !== storedForceDue) badges += `<span class="badge lilac">Unsaved change — click Save below</span>`;
  return badges;
}

function populateMortgageSettings(cls) {
  MORTGAGE_SETTINGS_CLS = cls;
  document.getElementById("mortgageDaySelect").value = cls.mortgageDay || "Fri";
  document.getElementById("mortgageForceDue").checked = cls.mortgageForceDueWeek === isoWeekKey();
  document.getElementById("mortgageStatusRow").innerHTML = mortgageStatusBadges(cls);
  document.getElementById("movingCostInput").value = cls.movingCost || 0;
  document.getElementById("mortgageBreakFeeInput").value = cls.propertyBreakFee || 0;
}

async function saveMovingCostClick() {
  const val = document.getElementById("movingCostInput").value;
  await setMovingCost(CURRENT.classCode, val);
  setMsg("movingCostMsg", `<div class="success-msg">Moving cost saved. Students are charged this the moment they move into a new home (buying and choosing to live in it, or moving in as a classmate's tenant) — capped at one move per student per day.</div>`);
  await render();
}

// Moves every variable rate one step right now (the weekly auto-move still
// happens on its own) and says what changed.
async function changeVariableRatesNow() {
  const btn = document.getElementById("changeVarRatesBtn");
  if (btn && btn.disabled) return;
  const cls = await getClassCached(CURRENT.classCode);
  if (!((cls && cls.properties) || []).some(variableRateOffered)) {
    setMsg("variableRatesMsg", `<div class="error-msg">No listings offer a variable rate yet. Add a variable range in a listing's Financing section first.</div>`, 6000);
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const changes = await runVariableRateRefresh(CURRENT.classCode, true);
    const lines = changes.map(c => `${escapeHtml(c.name)}: ${c.from}% &rarr; ${c.to}%`);
    setMsg("variableRatesMsg", `<div class="success-msg">${lines.length ? "Rates moved &mdash; " + lines.join("; ") + ". Students with a variable mortgage on those were told." : "Rates are already as far as they can go in their range."}</div>`, 9000);
    await render();
  } catch (err) {
    setMsg("variableRatesMsg", `<div class="error-msg">Couldn't change the rates — please try again.</div>`, 6000);
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function saveMortgageBreakFeeClick() {
  const val = document.getElementById("mortgageBreakFeeInput").value;
  await setPropertyBreakFee(CURRENT.classCode, val);
  setMsg("mortgageBreakFeeMsg", `<div class="success-msg">Break fee saved. It'll be deducted on top of the remaining mortgage payoff whenever a student sells back a property that still has a mortgage on it.</div>`);
  await render();
}

// Live-updates the status badges as soon as the teacher flips the toggle,
// before they've actually clicked Save — makes it obvious the change is
// only local until confirmed.
function previewMortgageForceDue() {
  if (!MORTGAGE_SETTINGS_CLS) return;
  const checked = document.getElementById("mortgageForceDue").checked;
  document.getElementById("mortgageStatusRow").innerHTML = mortgageStatusBadges(MORTGAGE_SETTINGS_CLS, checked);
}

async function saveMortgageDayClick() {
  await setMortgageDay(CURRENT.classCode, document.getElementById("mortgageDaySelect").value);
  setMsg("mortgageDayMsg", `<div class="success-msg">Mortgage day saved. Students can pay their weekly mortgage installment themselves on this day.</div>`);
  await render();
}

async function saveMortgageForceDue() {
  const active = document.getElementById("mortgageForceDue").checked;
  await setMortgageDueOverride(CURRENT.classCode, active);
  setMsg("mortgageForceDueMsg", `<div class="success-msg">${active ? "This week's mortgage payments are now marked as due — students can pay below." : "Manual override turned off."}</div>`);
  await render();
}

async function chooseOccupancy(id, choice) {
  const cls = await getClassCached(CURRENT.classCode);
  const prop = (cls.properties || []).find(p => p.id === id);
  const preview = propertyLifestylePreview(cls, prop);
  const bonus = preview ? preview.livingBonusPoints : 0;
  const movingCost = cls.movingCost || 0;
  const movingNote = choice === "living" && prop && prop.occupancy !== "living"
    ? `\n\nMoving in ${movingCost > 0 ? `costs ${fmtMoney(movingCost)} and ` : ""}counts as your one house-move for today, and you can't already be living somewhere else.`
    : "";
  const msg = choice === "living"
    ? `Live in this property?\n\nYou'll get a +${bonus} bonus to your lifestyle rating (property category) while you live here, but you won't receive any rent. You can switch to renting it out again at any time, for free.${movingNote}`
    : `Rent this property out?\n\nYou'll receive weekly rent instead of living here, but you will NOT get the +${bonus} lifestyle bonus for living in it — only the property's base comfort rating will count toward your lifestyle rating. You can move back in at any time.`;
  if (!await t29Confirm(msg)) return;
  const res = await setPropertyOccupancy(CURRENT.username, CURRENT.classCode, id, choice);
  if (!res.ok) { alert(res.error); return; }
  await render();
}




async function deleteProp(id) {
  if (await t29Confirm("Remove this property listing (all units of it)? Any owners will not be refunded automatically.")) {
    await removeProperty(CURRENT.classCode, id);
    await render();
  }
}
/* ---------------- Sell-back confirmation popup ----------------
   Both the teacher's "force sell" button on a student's listing and a
   student's own "sell back" button route through here, so the two ways of
   triggering a sale always show the exact same breakdown before it
   actually happens. Built the same way the change-password popup is
   (see _pwBuildModal in data-core.js) — plain DOM injection reusing the
   .anw-modal-overlay/.anw-modal-card classes already in style.css, so
   there's no extra HTML to keep in sync and no new CSS needed. */
function _sellBuildModal() {
  const existing = document.getElementById("sellConfirmModal");
  if (existing) return existing;
  const overlay = document.createElement("div");
  overlay.id = "sellConfirmModal";
  overlay.className = "anw-modal-overlay hidden";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSellModal(); });
  overlay.innerHTML = `
    <div class="anw-modal-card">
      <div class="flex-between">
        <h2 style="margin:0 0 2px;" id="sellModalTitle">Sell property</h2>
        <button class="btn small secondary" type="button" id="sellModalCloseBtn">Close</button>
      </div>
      <div id="sellModalBody" style="margin-top:12px;"></div>
      <div class="row-flex" style="gap:8px;margin-top:16px;">
        <button class="btn gold" type="button" id="sellModalConfirmBtn">Confirm sale</button>
        <button class="btn secondary" type="button" id="sellModalCancelBtn">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#sellModalCloseBtn").addEventListener("click", closeSellModal);
  overlay.querySelector("#sellModalCancelBtn").addEventListener("click", closeSellModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeSellModal();
  });
  return overlay;
}
function closeSellModal() {
  const overlay = document.getElementById("sellConfirmModal");
  if (overlay) overlay.classList.add("hidden");
}
// Looks the property up fresh, works out exactly what selling it right now
// would pay out — current market price, minus any mortgage payoff and
// break fee (see sellProperty in data-property.js, which this mirrors so the
// number shown here is never different from what the student/owner
// actually gets) — shows that in the popup above, and only calls
// sellProperty if the user actually confirms.
async function openSellModal(id, isTeacherSelling) {
  const cls = await getClassCached(CURRENT.classCode);
  const prop = (cls.properties || []).find(p => p.id === id);
  if (!prop) return;
  const marketPrice = prop.price;
  let mortgagePayoff = 0, breakFee = 0;
  if (prop.mortgage) {
    mortgagePayoff = mortgageWeekAmount(prop.mortgage).balanceBefore;
    breakFee = isVariableMortgage(prop.mortgage) ? 0 : Math.max(0, Number(cls.propertyBreakFee) || 0);
  }
  const breakFeeWaived = !!prop.mortgage && isVariableMortgage(prop.mortgage) && (Number(cls.propertyBreakFee) || 0) > 0;
  const payout = Math.round((marketPrice - mortgagePayoff - breakFee) * 100) / 100;
  const overlay = _sellBuildModal();
  document.getElementById("sellModalTitle").innerHTML = icon("house", 18) + ` Sell ${escapeHtml(prop.name)}`;
  let body = `<p>Current market price: <strong>${fmtMoney(marketPrice)}</strong></p>`;
  if (prop.mortgage) {
    body += `<p>This property still has a mortgage on it. <strong>${fmtMoney(mortgagePayoff)}</strong> will be deducted from the sale to pay off the remaining mortgage`;
    body += breakFee > 0 ? `, plus a <strong>${fmtMoney(breakFee)}</strong> break fee for selling with financing still owing.</p>` : `.</p>`;
    if (breakFeeWaived) body += `<p class="muted-small">No break fee — it's a variable-rate mortgage, which can be cleared at any time.</p>`;
  }
  const who = isTeacherSelling ? "The owner" : "You";
  body += `<p class="muted-small">${who} will receive <strong>${fmtMoney(payout)}</strong>${payout < 0 ? " — this will come out of their balance instead, since what's owed is more than the sale is worth" : ""}.</p>`;
  document.getElementById("sellModalBody").innerHTML = body;
  const confirmBtn = document.getElementById("sellModalConfirmBtn");
  confirmBtn.onclick = async () => {
    closeSellModal();
    const res = await sellProperty(CURRENT.classCode, id);
    if (res && !res.ok && res.error) { alert(res.error); return; }
    await render();
  };
  overlay.classList.remove("hidden");
}
async function forceSell(id) {
  await openSellModal(id, true);
}
async function sellMine(id) {
  await openSellModal(id, false);
}
// gid is a listing's groupId — picks whichever unit in that listing is
// still unowned (fresh read, to keep the race window with another buyer
// as small as possible) and buys that specific unit.
async function pickAvailableUnitId(gid) {
  const cls = await getClassCached(CURRENT.classCode);
  const unit = (cls.properties || []).find(p => (p.groupId || p.id) === gid && !p.owner);
  return unit ? unit.id : null;
}
function ksTicked(gid) {
  const box = document.getElementById("useKs-" + gid);
  return !!(box && box.checked);
}
async function buyOutright(gid) {
  // Double-tap guard (same reasoning as buy() in market.js) — matters
  // more here than most: pickAvailableUnitId() below can hand out a
  // *different* unit from the same listing group to each overlapping
  // call, so an unguarded double-click could actually buy two houses,
  // not just fire the same purchase twice.
  const btn = document.getElementById("buyOutrightBtn-" + gid);
  const btn2 = document.getElementById("buyFinancedBtn-" + gid);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  if (btn2) btn2.disabled = true;
  try {
    const id = await pickAvailableUnitId(gid);
    if (!id) { document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">Sorry, none are available right now.</div>`; return; }
    const [lMe, lCls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
    const lProp = ((lCls && lCls.properties) || []).find(p => p.id === id);
    let lifeVid = "";
    if (lProp) { const lv = await lifeAskVoucher(lMe, "property", lProp.price, lProp.name); if (lv === null) return; lifeVid = lv; }
    const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, false, undefined, { useKiwiSaver: ksTicked(gid), lifeVoucherId: lifeVid });
    if (!res.ok) { document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
    await render();
    // render() rebuilds this listing's card (and its message box), so the
    // success message goes in afterwards — same pattern as transport.js.
    showPurchaseResult(`<div class="success-msg">Congratulations, it's yours!${res.fromKiwi > 0 ? ` ${fmtMoney(res.fromKiwi)} came from your KiwiSaver.` : ""}</div>`);
  } finally {
    if (btn) btn.disabled = false;
    if (btn2) btn2.disabled = false;
  }
}
async function buyFinanced(gid) {
  // Same guard as buyOutright above, and for the same reason — this and
  // buyOutright both draw from the same available-units pool for this
  // listing group.
  const btn = document.getElementById("buyFinancedBtn-" + gid);
  const btn2 = document.getElementById("buyOutrightBtn-" + gid);
  if (btn && btn.disabled) return;
  // Student's custom deposit, in dollars. The input's own min= stops most
  // typing/arrow attempts below the 10% floor, but a pasted or emptied
  // value can still slip through, so re-validate here before it's sent —
  // both the 10% minimum (read straight off the input's own min attribute,
  // so it always matches what was actually shown) and the student's cash
  // balance. buyProperty in data-property.js also clamps/checks server-side as the
  // real line of defense; this just gives a clear message instead of a
  // silent correction or a generic error.
  const depositInput = document.getElementById("depositAmt-" + gid);
  const minDeposit = Number(depositInput && depositInput.min) || 0;
  let depositAmt = Number(depositInput && depositInput.value);
  const me = await getUserCached(CURRENT.username);
  if (!Number.isFinite(depositAmt) || depositAmt < minDeposit) {
    document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">Enter a deposit of at least ${fmtMoney(minDeposit)}.</div>`;
    return;
  }
  // KiwiSaver (first home) can pay part of the deposit.
  const useKs = ksTicked(gid);
  const cls0 = useKs ? await getClassCached(CURRENT.classCode) : null;
  const ksAvail = useKs ? kiwiSaverFirstHomeInfo(cls0, me, CURRENT.username).available || 0 : 0;
  if (depositAmt > me.balance + ksAvail) {
    document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">You don't have enough money for that deposit${useKs ? ", even with your KiwiSaver" : ""}.</div>`;
    return;
  }
  // Listings that offer both kinds of mortgage ask which one first (each is
  // explained in the dialog); fixed-only listings carry straight on.
  const clsV = await getClassCached(CURRENT.classCode);
  const listing = ((clsV && clsV.properties) || []).find(p => (p.groupId || p.id) === gid);
  if (!listing) { document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">That listing isn't available any more.</div>`; return; }
  // Always ask first (never silently default to fixed). Listings with no
  // variable range still show the dialog, with only the fixed option live.
  try { await openMortgageChoiceModal(gid, depositAmt, useKs); }
  catch (err) {
    console.error("Mortgage dialog failed", err);
    document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">Couldn't open the mortgage options. Please try again.</div>`;
  }
}
// The actual financed purchase, once the student's deposit and mortgage type
// are settled. Same double-tap guard as buyOutright/buyFinanced.
async function completeFinancedPurchase(gid, depositAmt, useKs, mortgageType) {
  const btn = document.getElementById("buyFinancedBtn-" + gid);
  const btn2 = document.getElementById("buyOutrightBtn-" + gid);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  if (btn2) btn2.disabled = true;
  try {
    const id = await pickAvailableUnitId(gid);
    if (!id) { document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">Sorry, none are available right now.</div>`; return; }
    const [lMe, lCls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
    const lProp = ((lCls && lCls.properties) || []).find(p => p.id === id);
    let lifeVid = "";
    if (lProp) { const lv = await lifeAskVoucher(lMe, "property", lProp.price, lProp.name); if (lv === null) return; lifeVid = lv; }
    const res = await buyProperty(CURRENT.username, CURRENT.classCode, id, true, depositAmt, { useKiwiSaver: useKs, lifeVoucherId: lifeVid, mortgageType });
    if (!res.ok) { document.getElementById("msg-" + gid).innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
    await render();
    // Mortgage payments are never taken automatically — the student pays
    // each one themselves on the class's mortgage day (see payMortgage).
    const cls = await getClassCached(CURRENT.classCode);
    showPurchaseResult(`<div class="success-msg">Mortgaged (${mortgageType === "variable" ? "variable" : "fixed"} rate) with a ${fmtMoney(depositAmt)} deposit${res.fromKiwi > 0 ? ` (${fmtMoney(res.fromKiwi)} of it from your KiwiSaver)` : ""}! Payments aren't taken automatically — come back every ${DAY_FULL[cls.mortgageDay || "Fri"]} to pay them yourself (the week you bought is free).${mortgageType === "variable" ? " Because it's variable, you can make extra repayments any time from My homes." : ""}</div>`);
  } finally {
    if (btn) btn.disabled = false;
    if (btn2) btn2.disabled = false;
  }
}

/* ---------------- Fixed or variable? (shown when a listing offers both) ---------------- */
function _mcBuildModal() {
  const existing = document.getElementById("mortgageChoiceModal");
  if (existing) return existing;
  const overlay = document.createElement("div");
  overlay.id = "mortgageChoiceModal";
  overlay.className = "anw-modal-overlay hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "mcTitle");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeMortgageChoiceModal(); });
  overlay.innerHTML = `<div class="anw-modal-card mc-modal"><div id="mcBody"></div></div>`;
  document.body.appendChild(overlay);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeMortgageChoiceModal();
  });
  return overlay;
}
function closeMortgageChoiceModal() {
  const overlay = document.getElementById("mortgageChoiceModal");
  if (overlay) overlay.classList.add("hidden");
}
// Opens the dialog that explains fixed vs variable for one listing and lets
// the student pick. The deposit (and KiwiSaver tick) were already validated
// by buyFinanced; nothing is bought until a choice button is pressed.
// The payment figures are estimates from the listed price plus tax — the
// real first payment is shown on the property afterwards.
async function openMortgageChoiceModal(gid, depositAmt, useKs) {
  const cls = await getClassCached(CURRENT.classCode);
  const p = ((cls && cls.properties) || []).find(x => (x.groupId || x.id) === gid);
  if (!p) return;
  const overlay = _mcBuildModal();
  const taxed = applyTaxToExpense(cls, "property", p.price).total;
  const deposit = Math.min(taxed, Math.max(0, Number(depositAmt) || 0));
  const loan = Math.max(0, Math.round((taxed - deposit) * 100) / 100);
  const weeks = p.mortgageWeeks;
  const principal = loan / weeks;
  const firstPay = rate => fmtMoney(Math.round((principal + loan * (rate / 100)) * 100) / 100);
  const fixedRate = Number(p.mortgageInterestRate) || 0;
  const vMin = Number(p.variableRateMin) || 0, vMax = Number(p.variableRateMax) || 0, vNow = Number(p.variableRate) || 0;
  const fee = Math.max(0, Number(cls.propertyBreakFee) || 0);
  const day = dayFull(cls.mortgageDay);
  const varOn = variableRateOffered(p);
  const varCard = varOn ? `<section class="mc-opt is-variable" aria-label="Variable rate mortgage">
        <div class="mc-head">
          <div class="mc-ico">${icon("chart", 20)}</div>
          <div><h3 class="mc-title">Variable rate</h3><span class="mc-tag">Flexible</span></div>
        </div>
        <div>
          <div class="mc-rate">${vMin}&ndash;${vMax}%<small> per week</small></div>
          <div class="mc-rate-sub">Right now it's <strong>${vNow}%</strong>.</div>
        </div>
        <ul class="mc-points">
          <li>Pay extra whenever you like to clear it faster and save interest.</li>
          <li>Pay it all off, or sell, with no break fee.</li>
          <li class="is-trade">The rate moves up or down each week, so your payment can change too.</li>
        </ul>
        <div class="mc-est">First payment about <strong>${firstPay(vNow)}</strong> now. It could be anywhere from <strong>${firstPay(vMin)}</strong> to <strong>${firstPay(vMax)}</strong> as the rate moves.</div>
        <button type="button" class="btn sky" id="mcPickVariable">${icon("chart", 14)} Choose variable</button>
      </section>` : `<section class="mc-opt is-variable is-off" aria-label="Variable rate mortgage, not offered">
        <div class="mc-head">
          <div class="mc-ico">${icon("chart", 20)}</div>
          <div><h3 class="mc-title">Variable rate</h3><span class="mc-tag">Not offered</span></div>
        </div>
        <div class="mc-rate-sub">A variable mortgage has a rate that moves each week, but lets you pay extra or pay off early with no break fee. Your teacher hasn't turned it on for this property.</div>
        <button type="button" class="btn sky" disabled>Not available here</button>
      </section>`;
  document.getElementById("mcBody").innerHTML = `
    <div class="p-modal-head">
      <h2 id="mcTitle">${icon("house", 18)} Choose your mortgage</h2>
      <button type="button" class="btn small secondary" id="mcCloseBtn">Close</button>
    </div>
    <div class="mc-deal">
      <span><strong>${escapeHtml(p.name)}</strong></span>
      <span>Borrowing <strong>${fmtMoney(loan)}</strong> over <strong>${weeks} weeks</strong></span>
      <span>Deposit <strong>${fmtMoney(deposit)}</strong></span>
    </div>
    <div class="mc-grid">
      <section class="mc-opt is-fixed" aria-label="Fixed rate mortgage">
        <div class="mc-head">
          <div class="mc-ico">${icon("lock", 20)}</div>
          <div><h3 class="mc-title">Fixed rate</h3><span class="mc-tag">Predictable</span></div>
        </div>
        <div>
          <div class="mc-rate">${fixedRate}%<small> per week</small></div>
          <div class="mc-rate-sub">Locked in for all ${weeks} weeks.</div>
        </div>
        <ul class="mc-points">
          <li>The rate never changes, so you always know what you'll owe.</li>
          <li>Pay it off on the weekly schedule every ${day}.</li>
          <li class="is-trade">No extra repayments.${fee > 0 ? ` Selling before it's paid off costs a ${fmtMoney(fee)} break fee.` : ""}</li>
        </ul>
        <div class="mc-est">First payment about <strong>${firstPay(fixedRate)}</strong>, then a little less each week as what you owe goes down.</div>
        <button type="button" class="btn gold" id="mcPickFixed">${icon("lock", 14)} Choose fixed</button>
      </section>
      ${varCard}
    </div>
    <p class="muted-small mc-note">Payment figures are estimates. Either way, nothing comes out automatically &mdash; you pay each week yourself on ${day}s, and the week you buy is free.</p>`;
  const pick = (type) => {
    closeMortgageChoiceModal();
    completeFinancedPurchase(gid, deposit, useKs, type);
  };
  document.getElementById("mcCloseBtn").onclick = closeMortgageChoiceModal;
  document.getElementById("mcPickFixed").onclick = () => pick("fixed");
  const vb = document.getElementById("mcPickVariable");
  if (vb) vb.onclick = () => pick("variable");
  overlay.classList.remove("hidden");
  // Focus the dialog itself, not an option, so neither choice looks pre-selected.
  const card = overlay.querySelector(".mc-modal");
  if (card) { card.setAttribute("tabindex", "-1"); card.focus(); }
}

// Extra repayment / pay-off on a variable mortgage (see payExtraMortgage).
async function payExtraMortgageClick(id, payOff) {
  const btn = document.getElementById("extraBtn-" + id);
  const btn2 = document.getElementById("payoffBtn-" + id);
  if ((btn && btn.disabled) || (btn2 && btn2.disabled)) return;
  const box = document.getElementById("extraMsg-" + id);
  let amount = 0;
  if (!payOff) {
    const input = document.getElementById("extraAmt-" + id);
    amount = Number(input && input.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      if (box) box.innerHTML = `<div class="error-msg">Enter how much extra you'd like to pay.</div>`;
      return;
    }
  }
  if (btn) btn.disabled = true;
  if (btn2) btn2.disabled = true;
  try {
    const res = await payExtraMortgage(CURRENT.username, CURRENT.classCode, id, amount, !!payOff);
    if (!res.ok) { if (box) box.innerHTML = `<div class="error-msg">${res.error}</div>`; return; }
    await render();
    // render() rebuilds the card, so the message goes in afterwards.
    if (res.fullyPaid) {
      setMsg("pageMsg", `<div class="success-msg">Mortgage paid off with ${fmtMoney(res.amount)} &mdash; no break fee. The property is all yours!</div>`, 10000);
      try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
    } else {
      setMsg("extraMsg-" + id, `<div class="success-msg">${fmtMoney(res.amount)} paid off your mortgage. You now owe ${fmtMoney(res.balanceAfter)} &mdash; about ${res.weeksLeft} week${res.weeksLeft === 1 ? "" : "s"} to go.</div>`, 8000);
    }
  } finally {
    const b1 = document.getElementById("extraBtn-" + id), b2 = document.getElementById("payoffBtn-" + id);
    if (b1) b1.disabled = false;
    if (b2) b2.disabled = false;
  }
}
async function payOffMortgageClick(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const prop = ((cls && cls.properties) || []).find(x => x.id === id);
  if (!prop || !prop.mortgage) return;
  const owed = mortgageWeekAmount(prop.mortgage).balanceBefore;
  if (!await t29Confirm(`Pay off the whole mortgage on ${prop.name} now? ${fmtMoney(owed)} will come out of your cash. There's no break fee on a variable mortgage.`)) return;
  await payExtraMortgageClick(id, true);
}

/* ---------------- Teacher: NPC (school) property listings ---------------- */
async function resolveNpcOverdueClick(id) {
  const res = await resolveNpcRentOverdue(CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}
async function teacherEndNpcTenancyClick(id) {
  if (!await t29Confirm("End this student's tenancy right now? They'll be moved out immediately, regardless of their minimum lease.")) return;
  const res = await teacherEndNpcTenancy(CURRENT.classCode, id);
  if (!res.ok) { alert(res.error); return; }
  await render();
}

function resetNpcForm() {
  ["npcName", "npcDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("npcQuantity").value = 1;
  document.getElementById("npcRent").value = "";
  document.getElementById("npcRentDay").value = "Fri";
  document.getElementById("npcMinWeeks").value = 1;
  document.getElementById("npcLifestylePoints").value = 0;
}
async function deleteNpcProp(id) {
  if (await t29Confirm("Remove this NPC property listing (all units of it)? Any current tenants will be moved out immediately.")) {
    await removeNpcProperty(CURRENT.classCode, id);
    await render();
  }
}

/* =====================================================================
   Page structure — tabs, dialogs and small helpers

   The page is split into tabs instead of one long stack of cards:
     Students: My homes / For sale / To rent
     Teachers: Listings / School rentals / Classmate rentals / Settings
   render() fills every pane on each pass, so switching tabs is instant
   (no re-render) and an action in one pane never loses another's state.
   Add / edit / pricing forms live in dialogs, which keeps the page
   itself short no matter how many listings a class has.
   ===================================================================== */
const TABS_BY_ROLE = { student: ["homes", "buy", "rent"], teacher: ["listings", "school", "classmates", "settings"] };
let ACTIVE_TAB = null;
// Listings whose owner list is fully expanded (render() rebuilds every card,
// so this has to live outside the DOM).
const OWNERS_EXPANDED = new Set();
const OWNERS_PREVIEW = 3;

function tabStorageKey() { return "t29-prop-tab-" + (IS_TEACHER ? "teacher" : "student"); }
function savedTab() { try { return sessionStorage.getItem(tabStorageKey()); } catch (e) { return null; } }
function setTab(tab, remember) {
  const allowed = IS_TEACHER ? TABS_BY_ROLE.teacher : TABS_BY_ROLE.student;
  if (!allowed.includes(tab)) return;
  ACTIVE_TAB = tab;
  if (remember !== false) { try { sessionStorage.setItem(tabStorageKey(), tab); } catch (e) {} }
  allowed.forEach(t => {
    const pane = document.getElementById("pane-" + t);
    if (pane) pane.classList.toggle("hidden", t !== tab);
  });
  document.querySelectorAll(".p-tabs button").forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}
function setCount(id, n, alert) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = n > 0 ? String(n) : "";
  el.classList.toggle("alert", !!alert && n > 0);
}
// Shows a message in a box and clears it again after a few seconds, so
// success notes don't sit on the page forever.
function setMsg(id, html, ms) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = html;
  clearTimeout(el._t);
  if (html) el._t = setTimeout(() => { el.innerHTML = ""; }, ms || 5000);
}
function openOverlay(id) { const o = document.getElementById(id); if (o) o.classList.remove("hidden"); }
function closeOverlay(id) { const o = document.getElementById(id); if (o) o.classList.add("hidden"); }
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const open = id => { const o = document.getElementById(id); return o && !o.classList.contains("hidden"); };
  if (open("propModal")) closePropModal();
  else if (open("npcModal")) closeNpcModal();
  else if (open("pricingModal")) closePricingModal();
});
function dayFull(d) { return DAY_FULL[d || "Fri"]; }
async function gidOfProperty(id, npc) {
  const cls = await getClassCached(CURRENT.classCode);
  const list = (npc ? cls.npcProperties : cls.properties) || [];
  const t = list.find(x => x.id === id);
  return t ? (t.groupId || t.id) : id;
}

// Small inline "recent days" price trend chart (same look as the Stock
// Market's sparkline). Green when the latest point is up on the one before,
// coral when it's down. Safe with a one-point history.
function sparkline(history, w, h) {
  const hist = (history && history.length ? history : [0]);
  w = w || 140; h = h || 40;
  const pad = 2;
  const max = Math.max(...hist), min = Math.min(...hist);
  const range = (max - min) || 1;
  const pts = hist.map((v, i) => ({
    x: pad + (i / (hist.length - 1 || 1)) * (w - pad * 2),
    y: (h - pad) - ((v - min) / range) * (h - pad * 2)
  }));
  const segments = pts.slice(1).map((pt, i) => {
    const prev = pts[i];
    const up = pt.y <= prev.y; // y is inverted (smaller y = higher price)
    return `<line x1="${prev.x.toFixed(1)}" y1="${prev.y.toFixed(1)}" x2="${pt.x.toFixed(1)}" y2="${pt.y.toFixed(1)}" stroke="${up ? '#3fbf8f' : '#e8735f'}" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join("");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="max-width:${w}px;width:100%;height:auto;flex-shrink:0;" aria-hidden="true">${segments}</svg>`;
}

// One compact chip describing what owning (and living in) a listing does
// for a student's lifestyle rating — replaces the long explanatory line.
function lifestyleChip(cls, p) {
  const pv = propertyLifestylePreview(cls, p);
  if (!pv) return "";
  const title = `Owning it: +${pv.ownPoints} lifestyle points. Living in it instead of renting it out: +${pv.livingBonusPoints} more on top (${pv.livingBonusStars} bonus star${pv.livingBonusStars === 1 ? "" : "s"} x ${pv.weight} pts/star).`;
  return `<span class="chip" title="${title}">Lifestyle +${pv.ownPoints} &middot; +${pv.livingBonusPoints} living in</span>`;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("house", 26) + " Property";
  setPropModalMode(false);
  setNpcModalMode(false);
}

/* ---------------- Render ---------------- */
async function render() {
  // getUser and getClass are independent reads — fetch both at once.
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  window.T29_ME = me; // used by the "pay with credit card" tick boxes
  const propTaxEl = document.getElementById("propTaxNote");
  if (propTaxEl) { const r = IS_TEACHER ? 0 : t29TaxRate(cls, "property"); propTaxEl.innerHTML = t29TaxNoteHtml(r ? `Buying a property adds <strong>${t29TaxPct(r)}</strong> tax on top of the price.` : ""); }
  const props = cls.properties || [];
  // Hand over the class doc already in hand (when it's the same class) so
  // this doesn't read it a second time before reading the students.
  const students = await getClassStudents(me.classCode, me.classCode === CURRENT.classCode ? cls : undefined);
  const nameOf = un => (students.find(s => s.username === un) || {}).name || un;
  if (IS_TEACHER) renderTeacher(cls, props, me, nameOf);
  else renderStudent(cls, props, me, nameOf);
}

/* ================= Shared listing-card pieces ================= */
// Header of a for-sale listing: icon, name, description, and the price block
// (price after life discount, tax chip for students, today's move, trend).
function listingTop(p, cls, me, badgesHtml) {
  const hist = p.priceHistory && p.priceHistory.length ? p.priceHistory : [p.price];
  const chg = propertyDailyChange(p);
  const dir = chg.diff > 0 ? "ticker-up" : chg.diff < 0 ? "ticker-down" : "muted-small";
  const sgn = chg.diff > 0 ? "+" : chg.diff < 0 ? "-" : "";
  const today = hist.length > 1 ? `<span class="pcard-delta ${dir}">${sgn}${Math.abs(chg.pct).toFixed(1)}% today</span>` : "";
  return `
    <div class="pcard-top">
      <div class="pcard-id">
        <div class="pcard-name">
          <h3>${escapeHtml(p.name)}</h3>
          ${badgesHtml ? `<div class="pcard-badges">${badgesHtml}</div>` : ""}
          <p class="pcard-desc">${escapeHtml(p.description) || "No description provided."}</p>
        </div>
      </div>
      <div class="pcard-money">
        <div class="pcard-price">${priceWithLifeDiscount(me, "property", p.price)}</div>
        ${IS_TEACHER ? "" : t29TaxChip(cls, "property")}
        ${today}
        ${sparkline(hist, 112, 28)}
      </div>
    </div>`;
}
function listingChips(p, cls, extraChips) {
  const chips = [];
  if (extraChips) chips.push(extraChips);
  chips.push(`<span class="chip">${comfortStars(p.comfort)}</span>`);
  if (p.mortgageWeeks > 0 && variableRateOffered(p)) {
    const due = `Weekly payments are due ${dayFull(cls.mortgageDay)}s`;
    chips.push(`<span class="chip chip-fixed" title="Rate locked in for the whole mortgage. ${due}"><span class="chip-ico">${icon("lock", 13)}</span>Fixed ${p.mortgageWeeks} wks${p.mortgageInterestRate > 0 ? ` @ ${p.mortgageInterestRate}%/wk` : ""}</span>`);
    chips.push(`<span class="chip chip-var" title="Rate moves each week inside this range. ${due}"><span class="chip-ico">${icon("chart", 13)}</span>Variable ${p.variableRateMin}\u2013${p.variableRateMax}%/wk &middot; now ${p.variableRate}%</span>`);
  } else {
    chips.push(p.mortgageWeeks > 0
      ? `<span class="chip" title="Weekly payments are due ${dayFull(cls.mortgageDay)}s">Mortgage ${p.mortgageWeeks} wks${p.mortgageInterestRate > 0 ? ` @ ${p.mortgageInterestRate}%/wk` : ""}</span>`
      : `<span class="chip">Cash only</span>`);
  }
  if (p.rentPerWeek > 0) chips.push(`<span class="chip">Rent income ${fmtMoney(p.rentPerWeek)}/wk</span>`);
  const ls = lifestyleChip(cls, p);
  if (ls) chips.push(ls);
  return `<div class="pcard-chips">${chips.join("")}</div>`;
}
function availabilityChip(units, available) {
  if (available.length === 0) return `<span class="chip chip-off">Sold out</span>`;
  return `<span class="chip chip-ok">${units.length > 1 ? `${available.length} of ${units.length} available` : "Available"}</span>`;
}
// A small badge showing what an owned unit is currently being used for.
function occupancyChip(p) {
  if (p.occupancy === "living") return `<span class="badge mint">Living here</span>`;
  if (p.occupancy === "rented") return `<span class="badge gold">Rented out</span>`;
  if (p.occupancy === "sublet" && p.sublet) {
    const s = p.sublet;
    if (s.status === "pending") return `<span class="badge lilac">Awaiting approval</span>`;
    if (s.status === "rejected") return `<span class="badge coral">Listing declined</span>`;
    if (!s.tenant) return `<span class="badge navy">Listed to classmates</span>`;
    return `<span class="badge gold">Rented to a classmate</span>`;
  }
  return `<span class="badge navy">Not set yet</span>`;
}
function choiceRow(title, sub, actionsHtml) {
  return `<div class="prow"><div class="prow-main"><div class="prow-title">${title}</div>${sub ? `<div class="prow-sub">${sub}</div>` : ""}</div>${actionsHtml ? `<div class="prow-actions">${actionsHtml}</div>` : ""}</div>`;
}

/* ================= Student view ================= */
function renderStudent(cls, props, me, nameOf) {
  const homes = renderStudentHomes(cls, props, me, nameOf);
  const rentals = renderStudentRentals(cls, props, me, nameOf);

  // Listings the student already owns a unit of live under "My homes".
  const groups = groupProperties(props).filter(units => !units.some(u => u.owner === me.username));
  // Anything still available first; sold-out listings after (stable sort).
  groups.sort((a, b) => ((a.some(u => !u.owner) ? 0 : 1) - (b.some(u => !u.owner) ? 0 : 1)) || (a[0].price - b[0].price));
  // First-home KiwiSaver: when a student can put it towards a purchase,
  // each listing they can buy gets a "Use my KiwiSaver" tick box.
  const ksHome = typeof kiwiSaverFirstHomeInfo === "function"
    ? kiwiSaverFirstHomeInfo(cls, me, me.username) : { eligible: false };
  document.getElementById("propList").innerHTML = groups.map(units => buyCard(units, cls, me, ksHome)).join("");
  const noProps = document.getElementById("noProps");
  noProps.classList.toggle("hidden", groups.length > 0);
  noProps.firstElementChild.textContent = props.length ? "There's nothing else for sale right now." : "No properties are listed yet.";

  setCount("cntHomes", homes.count, homes.due);
  setCount("cntBuy", groups.filter(g => g.some(u => !u.owner)).length);
  setCount("cntRent", rentals.count);

  if (!ACTIVE_TAB) {
    const saved = savedTab();
    setTab(TABS_BY_ROLE.student.includes(saved) ? saved : (homes.count > 0 ? "homes" : "buy"), false);
  }
}

function buyCard(units, cls, me, ksHome) {
  const p = units[0]; // shared listing fields come from any unit
  const gid = p.groupId || p.id;
  const available = units.filter(u => !u.owner);
  // Same price the server will actually charge (discount + tax applied),
  // computed with the exact same shared functions the data-*.js files use
  // server-side so the minimum deposit shown here never drifts from what
  // buyProperty enforces. Only meaningful when this listing offers financing.
  let minDeposit = 0;
  if (p.mortgageWeeks > 0) {
    const discounted = p.price;
    const taxed = applyTaxToExpense(cls, "property", discounted).total;
    minDeposit = Math.round(taxed * 0.1 * 100) / 100;
  }
  return `
    <article class="pcard${available.length ? "" : " is-sold"}">
      ${listingTop(p, cls, me, "")}
      ${listingChips(p, cls, availabilityChip(units, available))}
      <div class="pcard-msg" id="msg-${gid}"></div>
      ${available.length ? `<div class="pcard-foot">${buyControls(p, gid, minDeposit, ksHome, cls)}</div>` : ""}
    </article>`;
}
function buyControls(p, gid, minDeposit, ksHome, cls) {
  return `
    ${ksHome.eligible ? `<label class="ks-use" for="useKs-${gid}"><input type="checkbox" id="useKs-${gid}"> Use my KiwiSaver (up to ${fmtMoney(ksHome.available)})</label>` : ""}
    <div class="buy-row">
      <button class="btn small gold" id="buyOutrightBtn-${gid}" onclick="buyOutright('${gid}')">${icon("coin", 13)} Buy cash</button>
      ${p.mortgageWeeks > 0 ? `
        <div class="deposit-group">
          <div class="deposit-field"><span class="deposit-prefix">$</span>
          <input type="number" id="depositAmt-${gid}" min="${minDeposit}" step="0.01" value="${minDeposit}" aria-label="Deposit amount in dollars, minimum ${fmtMoney(minDeposit)}"></div>
          <button class="btn small secondary" id="buyFinancedBtn-${gid}" onclick="buyFinanced('${gid}')">Mortgage</button>
        </div>
        <span class="muted-small buy-hint">Deposit from ${fmtMoney(minDeposit)} &middot; weekly payments due ${dayFull(cls.mortgageDay)}s</span>
        ${variableRateOffered(p)
          ? `<div class="buy-choice">${icon("chart", 15)}<span>This one comes with a choice: tap <strong>Mortgage</strong> and you'll pick a <strong>fixed</strong> or a <strong>variable</strong> rate &mdash; each is explained first, and nothing is bought until you choose.</span></div>`
          : `<div class="buy-choice">${icon("lock", 15)}<span>Tap <strong>Mortgage</strong> to see how the loan works first &mdash; nothing is bought until you confirm.</span></div>`}` : ""}
    </div>`;
}

/* ---------- Student: My homes ---------- */
// Pure status calculation for an owned unit's mortgage this week — shared by
// the card below and the "payment due" marker on the tab. Never an amount
// to type in; the figure shown is the same one payMortgage() will charge.
function mortgageStatus(p, cls) {
  const mortgageDayName = DAY_FULL[cls.mortgageDay || "Fri"];
  const weekKey = isoWeekKey();
  const purchaseWeek = p.mortgage.purchaseWeekKey === weekKey;
  const alreadyPaid = p.mortgage.lastWeekPaid === weekKey;
  // Payable either on the class's normal mortgage day, or — for this ISO
  // week only — if the teacher has manually marked mortgages as due (see
  // setMortgageDueOverride).
  const forcedDue = cls.mortgageForceDueWeek === weekKey;
  const isDueToday = (cls.mortgageDay || "Fri") === nzDayName() || forcedDue;
  const amt = mortgageWeekAmount(p.mortgage);
  const breakdown = amt.interest > 0
    ? `${fmtMoney(amt.principal)} + ${fmtMoney(amt.interest)} interest on the ${fmtMoney(amt.balanceBefore)} still owed`
    : `${fmtMoney(amt.principal)}, no interest owing`;
  let status, canPay = false;
  if (purchaseWeek) {
    status = `Your first payment isn't due yet — the week you bought is free. It'll be ${fmtMoney(amt.total)} (${breakdown}).`;
  } else if (alreadyPaid) {
    status = `This week's payment of ${fmtMoney(amt.total)} is already sorted.`;
  } else if (!isDueToday) {
    status = `Due every ${mortgageDayName}. This week's would be ${fmtMoney(amt.total)} (${breakdown}) — come back then to pay it yourself.`;
  } else {
    const dueLine = forcedDue && (cls.mortgageDay || "Fri") !== nzDayName()
      ? `Your teacher has marked this week's payment as due now.`
      : `This week's payment is due today.`;
    status = `${dueLine} <strong>${fmtMoney(amt.total)}</strong> — ${breakdown}.`;
    canPay = true;
  }
  return { status, canPay, amt };
}
// The rate the variable mortgage was on before its latest change (null when
// there's no earlier rate or it hasn't moved) — for the "up from / down from" note.
function previousVariableRate(p, nowRate) {
  const h = Array.isArray(p.variableRateHistory) ? p.variableRateHistory : [];
  for (let i = h.length - 2; i >= 0; i--) {
    if (Number(h[i].rate) !== Number(nowRate)) return Number(h[i].rate);
  }
  return null;
}
function mortgageSection(p, cls) {
  const st = mortgageStatus(p, cls);
  const m = p.mortgage;
  const variable = isVariableMortgage(m);
  const badge = variable ? `<span class="badge lilac">Variable rate</span>` : `<span class="badge navy">Fixed rate</span>`;
  let rateLine;
  if (variable) {
    const prev = previousVariableRate(p, m.interestRate);
    const move = prev == null ? "" : (m.interestRate > prev
      ? ` <span class="rate-up">&#9650; up from ${prev}%</span>`
      : ` <span class="rate-down">&#9660; down from ${prev}%</span>`);
    const range = variableRateOffered(p) ? ` &middot; moves between ${p.variableRateMin}% and ${p.variableRateMax}%` : "";
    rateLine = `<div class="prow-sub rate-line">Due ${dayFull(cls.mortgageDay)}s &middot; interest at <strong>${m.interestRate}%</strong> a week on the balance still owed${move}${range}</div>`;
  } else {
    rateLine = `<div class="prow-sub">Due ${dayFull(cls.mortgageDay)}s${m.interestRate > 0 ? ` &middot; plus ${m.interestRate}% interest on the balance still owed (shrinks each week)` : ""} &middot; rate locked in</div>`;
  }
  const owed = st.amt.balanceBefore;
  const fee = Math.max(0, Number(cls.propertyBreakFee) || 0);
  const extra = variable ? `
      <div class="mx-box">
        <div class="mx-head">${icon("chart", 15)} Extra repayments</div>
        <span class="muted-small">Pay any amount, any day. It comes straight off the <strong>${fmtMoney(owed)}</strong> you owe, so you pay less interest and finish sooner. It doesn't replace the weekly payment. No break fee.${m.extraPaid > 0 ? ` You've paid ${fmtMoney(m.extraPaid)} extra so far.` : ""}</span>
        <div class="mx-row">
          <div class="deposit-group">
            <div class="deposit-field"><span class="deposit-prefix">$</span>
            <input type="number" id="extraAmt-${p.id}" min="0.01" max="${owed}" step="0.01" placeholder="0.00" aria-label="Extra repayment in dollars"></div>
            <button class="btn small gold" id="extraBtn-${p.id}" onclick="payExtraMortgageClick('${p.id}')">${icon("send", 13)} Pay extra</button>
          </div>
          <button class="btn small secondary" id="payoffBtn-${p.id}" onclick="payOffMortgageClick('${p.id}')">Pay off in full &middot; ${fmtMoney(owed)}</button>
        </div>
        <div id="extraMsg-${p.id}"></div>
      </div>` : `
      <p class="muted-small">Fixed rate: your rate can't change, so your payments are easy to plan. Extra repayments aren't available${fee > 0 ? ` and selling before it's paid off costs a ${fmtMoney(fee)} break fee` : ""}.</p>`;
  return `
    <div class="pcard-sec">
      <div class="pcard-sec-head">Mortgage ${badge}</div>
      <div class="prow">
        <div class="prow-main">
          <div class="prow-title">${fmtMoney(m.weeklyPayment)}/week base &middot; ${m.weeksLeft} week${m.weeksLeft === 1 ? "" : "s"} left</div>
          ${rateLine}
          <div class="prow-sub">${st.status}</div>
        </div>
        ${st.canPay ? `<button class="btn small gold" id="payMortgageBtn-${p.id}" onclick="payMortgageClick('${p.id}')">${icon("send", 13)} Pay ${fmtMoney(st.amt.total)}</button>` : ""}
      </div>
      ${st.canPay ? `<p class="muted-small">Mortgage payments come out of your cash — a credit card can't be used.</p>` : ""}
      <div id="mortgageMsg-${p.id}"></div>${extra}
    </div>`;
}

// "Living here / rented out / rented to a classmate" status + choices for a
// property the student owns, as flat rows (no boxes inside the card).
function studentOccupancySection(p, cls, nameOf) {
  const pr = cls.propertyRentals || {};
  const canSublet = !!(pr.enabled && p.rentPerWeek > 0);
  const pv = propertyLifestylePreview(cls, p);
  const bonus = pv ? pv.livingBonusPoints : 0;
  const btn = (label, fn, cls2) => `<button class="btn small ${cls2 || "secondary"}" onclick="${fn}">${label}</button>`;
  const sublet = `${btn("Rent to a classmate", `showSubletForm('${p.id}')`)}`;
  let inner;
  if (p.occupancy === "living") {
    inner = choiceRow("You're living here",
      `+${bonus} lifestyle bonus (property category) while you live here. You're not collecting rent.`,
      `${p.rentPerWeek > 0 ? btn("Rent it out", `chooseOccupancy('${p.id}','rented')`) : ""}${canSublet ? sublet : ""}`)
      + (!p.rentPerWeek ? `<p class="muted-small">Your teacher hasn't set a rent amount for this property, so it can't be rented out yet.</p>` : "");
  } else if (p.occupancy === "rented") {
    inner = choiceRow(`Rented out — ${fmtMoney(p.rentPerWeek)}/week`,
      `Paid every ${dayFull(p.rentDay)}. You're not getting the living-in lifestyle bonus.`,
      `${btn("Move in instead", `chooseOccupancy('${p.id}','living')`)}${canSublet ? sublet : ""}`)
      + movingCostNote(cls);
  } else if (p.occupancy === "sublet" && p.sublet) {
    inner = studentSubletRows(p, cls, nameOf);
  } else {
    // Owned but no choice made yet — spell out each option before they pick.
    inner = `<p class="muted-small" style="margin:0 0 4px;">Choose how to use it — you can change your mind at any time.</p>`
      + choiceRow("Live in it", `No rent income, but +${bonus} to your lifestyle rating (property category) while you live there.`, btn("Live here", `chooseOccupancy('${p.id}','living')`, "gold"))
      + (p.rentPerWeek > 0
          ? choiceRow("Rent it out", `${fmtMoney(p.rentPerWeek)}/week, paid every ${dayFull(p.rentDay)}. No lifestyle bonus — only the base comfort rating counts.`, btn("Rent it out", `chooseOccupancy('${p.id}','rented')`))
          : choiceRow("Rent it out", "Your teacher hasn't set a rent amount yet.", ""))
      + (canSublet ? choiceRow("Rent to a classmate", "You set the price and minimum lease, and get real weekly rent from whoever moves in. No living-in bonus for you.", sublet) : "")
      + movingCostNote(cls);
  }
  return `
    <div class="pcard-sec">
      <div class="pcard-sec-head">Living arrangement</div>
      ${inner}
      <div id="subletForm-${p.id}"></div>
    </div>`;
}
// The owner's view once a unit is set to "sublet": waiting for approval,
// declined, listed with no tenant yet, or occupied.
function studentSubletRows(p, cls, nameOf) {
  const s = p.sublet;
  const withdraw = label => `<button class="btn small secondary" onclick="cancelSubletClick('${p.id}')">${label}</button>`;
  if (s.status === "pending") {
    return choiceRow("Waiting for teacher approval", `Listed at ${fmtMoney(s.price)}/week, ${s.minWeeks}-week minimum lease. It'll be visible to classmates once approved.`, withdraw("Withdraw listing"));
  }
  if (s.status === "rejected") {
    return choiceRow("Listing declined by your teacher", s.rejectReason ? escapeHtml(s.rejectReason) : "", withdraw("Remove listing"));
  }
  if (!s.tenant) {
    return choiceRow("Listed for rent to classmates", `${fmtMoney(s.price)}/week, ${s.minWeeks}-week minimum lease. No one's moved in yet.`, withdraw("Withdraw listing"));
  }
  const canEnd = leaseMinWeeksElapsed(s);
  return choiceRow(`Rented to ${escapeHtml(nameOf(s.tenant))}`,
    `${fmtMoney(s.price)}/week, paid every ${dayFull(p.rentDay)}. Minimum ${s.minWeeks}-week lease${canEnd ? " (met — you can end it any time now)" : " (still running)"}.`,
    canEnd ? withdraw("End lease") : "");
}

function ownedHomeCard(p, cls, nameOf) {
  const gain = propertyGainSinceBought(p);
  const gcls = gain ? (gain.diff > 0 ? "ticker-up" : gain.diff < 0 ? "ticker-down" : "muted-small") : "";
  const sgn = gain ? (gain.diff > 0 ? "+" : gain.diff < 0 ? "-" : "") : "";
  const gainHtml = gain
    ? `<span class="pcard-delta ${gcls}">${sgn}${fmtMoney(Math.abs(gain.diff))} (${sgn}${Math.abs(gain.pct).toFixed(1)}%)</span><span class="muted-small">You bought for ${fmtMoney(p.purchasePrice)}</span>`
    : "";
  return `
    <article class="pcard">
      <div class="pcard-top">
        <div class="pcard-id">
          <div class="pcard-name">
            <h3>${escapeHtml(p.name)}</h3>
            <div class="pcard-badges">${occupancyChip(p)}<span class="chip">${comfortStars(p.comfort)}</span></div>
          </div>
        </div>
        <div class="pcard-money">
          <span class="pcard-cap">Current Price</span>
          <div class="pcard-price">${fmtMoney(p.price)}</div>
          ${gainHtml}
          ${sparkline(p.priceHistory && p.priceHistory.length ? p.priceHistory : [p.price], 112, 28)}
        </div>
      </div>
      ${p.mortgage ? mortgageSection(p, cls) : ""}
      ${studentOccupancySection(p, cls, nameOf)}
      <div class="pcard-foot pcard-foot-end"><button class="btn small secondary" onclick="sellMine('${p.id}')">Sell back</button></div>
    </article>`;
}

// Shared card for a tenant's rented home — works for both a classmate sublet
// and an NPC unit, since both carry the same lease shape (see
// tenantRentStatusLine), just with different ids/handlers passed in.
function rentedHomeCard(o) {
  return `
    <article class="pcard">
      <div class="pcard-top">
        <div class="pcard-id">
          <div class="pcard-name">
            <h3>${escapeHtml(o.name)}</h3>
            <div class="pcard-badges">${o.badge}</div>
            ${o.desc ? `<p class="pcard-desc">${escapeHtml(o.desc)}</p>` : ""}
          </div>
        </div>
        <div class="pcard-money">
          <span class="pcard-cap">Your rent</span>
          <div class="pcard-price">${fmtMoney(o.price)}<small class="muted-small">/wk</small></div>
        </div>
      </div>
      <div class="pcard-sec">
        <div class="pcard-sec-head">This week's rent</div>
        <div class="prow">
          <div class="prow-main"><div class="prow-sub">${o.status}</div>${o.cardToggle || ""}</div>
          <button class="btn small gold rent-pay-btn" id="${o.payId}" ${o.canPay ? "" : `disabled title="${o.why}"`} onclick="${o.payFn}">${icon("send", 13)} Pay ${fmtMoney(o.price)}</button>
        </div>
        <div id="${o.msgId}"></div>
      </div>
      <div class="pcard-sec">
        <div class="pcard-sec-head">Lease</div>
        <div class="prow">
          <div class="prow-main"><div class="prow-sub">${o.canMoveOut ? "You've met the minimum lease length, so you can move out at any time." : `You agreed to a minimum ${o.minWeeks}-week lease, so you can't move out just yet.`}</div></div>
          ${o.canMoveOut ? `<button class="btn small secondary" onclick="${o.moveFn}">Move out</button>` : ""}
        </div>
      </div>
    </article>`;
}

// A student can only ever have ONE current home (see currentHomeOf), so a
// classmate rental and a school rental never show together.
function renderStudentHomes(cls, props, me, nameOf) {
  const box = document.getElementById("myHomes");
  const items = props.filter(p => p.owner === me.username).map(p => ({
    rank: p.occupancy === "living" ? 0 : 1,
    due: !!p.mortgage && mortgageStatus(p, cls).canPay,
    html: ownedHomeCard(p, cls, nameOf)
  }));
  const rentedProp = props.find(p => p.sublet && p.sublet.tenant === me.username);
  const npcUnit = rentedProp ? null : (cls.npcProperties || []).find(u => u.tenant === me.username);
  if (rentedProp) {
    const s = rentedProp.sublet;
    const t = tenantRentStatusLine(s.leaseStartWeekKey, s.rentLastWeekPaid, rentedProp.rentDay, s.price, isSubletRentOverdue(rentedProp, cls));
    items.push({ rank: 0, due: t.canPay, html: rentedHomeCard({
      icon: "house", name: rentedProp.name, desc: `Renting from ${nameOf(rentedProp.owner)}`,
      badge: `<span class="badge navy">Classmate rental</span>`,
      price: s.price, status: t.status, canPay: t.canPay, why: t.why,
      payId: `payTenantRentBtn-${rentedProp.id}`, payFn: `payTenantRentClick('${rentedProp.id}')`, msgId: `tenantRentMsg-${rentedProp.id}`,
      canMoveOut: leaseMinWeeksElapsed(s), minWeeks: s.minWeeks, moveFn: `tenantMoveOutClick('${rentedProp.id}')`
    }) });
  } else if (npcUnit) {
    const t = tenantRentStatusLine(npcUnit.leaseStartWeekKey, npcUnit.rentLastWeekPaid, npcUnit.rentDay, npcUnit.rentPerWeek, isNpcRentOverdue(npcUnit));
    items.push({ rank: 0, due: t.canPay, html: rentedHomeCard({
      icon: "building", name: npcUnit.name, desc: npcUnit.description || "",
      badge: `<span class="badge lilac">School rental</span>`,
      price: npcUnit.rentPerWeek, status: t.status, canPay: t.canPay, why: t.why,
      cardToggle: t.canPay ? cardPayToggleHtml("n-" + npcUnit.id, window.T29_ME, cls) : "",
      payId: `payNpcRentBtn-${npcUnit.id}`, payFn: `payNpcRentClick('${npcUnit.id}')`, msgId: `npcRentMsg-${npcUnit.id}`,
      canMoveOut: leaseMinWeeksElapsed(npcUnit), minWeeks: npcUnit.minWeeks, moveFn: `npcMoveOutClick('${npcUnit.id}')`
    }) });
  }
  items.sort((a, b) => a.rank - b.rank);
  box.innerHTML = items.length
    ? `<div class="prop-grid">${items.map(i => i.html).join("")}</div>`
    : `<div class="empty-state">
         <p>You don't own or rent a home yet.</p>
         <div class="p-actions" style="justify-content:center;">
           <button type="button" class="btn small gold" onclick="setTab('buy')">Browse properties for sale</button>
           <button type="button" class="btn small secondary" onclick="setTab('rent')">Find a rental</button>
         </div>
       </div>`;
  return { count: items.length, due: items.some(i => i.due) };
}

/* ---------- Student: To rent (classmates + school, one list) ---------- */
function renderStudentRentals(cls, props, me, nameOf) {
  const box = document.getElementById("rentList");
  const pr = cls.propertyRentals || {};
  const alreadyHoused = !!currentHomeOf(cls, me.username);
  const rows = [];
  if (pr.enabled) {
    props.filter(p => p.sublet && p.sublet.status === "active" && !p.sublet.tenant && p.owner !== me.username).forEach(p => {
      rows.push(`
        <div class="prow rent-row">
          <div class="prow-main">
            <div class="prow-title">${escapeHtml(p.name)} <span class="badge navy">Classmate</span></div>
            <div class="prow-sub">Rented out by ${escapeHtml(nameOf(p.owner))}</div>
            <div class="rent-chips"><span class="chip">${comfortStars(p.comfort)}</span><span class="chip">${p.sublet.minWeeks}-week minimum lease</span></div>
          </div>
          <div class="rent-side">
            <div class="rent-price">${fmtMoney(p.sublet.price)}<small>/wk</small></div>
            <button class="btn small gold" ${alreadyHoused ? "disabled" : ""} onclick="claimSubletClick('${p.id}')">Move in</button>
          </div>
        </div>`);
    });
  }
  // Group NPC units into listings the same way groupProperties does for
  // purchasable properties, so a listing with several units is one row.
  groupProperties(cls.npcProperties || []).forEach(g => {
    const p = g[0];
    const gid = p.groupId || p.id;
    const available = g.filter(u => !u.tenant);
    if (!available.length) return;
    rows.push(`
      <div class="prow rent-row">
        <div class="prow-main">
          <div class="prow-title">${escapeHtml(p.name)} <span class="badge lilac">School</span></div>
          ${p.description ? `<div class="prow-sub">${escapeHtml(p.description)}</div>` : ""}
          <div class="rent-chips">
            <span class="chip">${p.minWeeks}-week minimum lease</span>
            ${p.lifestylePoints > 0 ? `<span class="chip">+${p.lifestylePoints} lifestyle while you live here</span>` : ""}
            <span class="chip chip-ok">${g.length > 1 ? `${available.length} of ${g.length} available` : "Available"}</span>
          </div>
        </div>
        <div class="rent-side">
          <div class="rent-price">${fmtMoney(p.rentPerWeek)}<small>/wk</small></div>
          <button class="btn small gold" ${alreadyHoused ? "disabled" : ""} onclick="rentNpcClick('${gid}')">Move in</button>
        </div>
      </div>`);
  });
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state"><p>No rentals are available right now. Check back later — your teacher or a classmate may list one.</p></div>`;
    return { count: 0 };
  }
  box.innerHTML = `
    <div class="card">
      <div class="set-head"><h2>${icon("key", 18)} Available rentals</h2></div>
      <div style="margin-top:6px;">${movingCostNote(cls)}</div>
      ${alreadyHoused ? `<p class="muted-small">You're already living somewhere — move out first if you'd rather rent one of these instead.</p>` : ""}
      <div id="rentMsg"></div>
      ${rows.join("")}
    </div>`;
  return { count: rows.length };
}

/* Inline "list it for rent" form — price + minimum lease length, both
   bounded by the teacher's settings. Shown on demand rather than always,
   so the plain living/rented choice isn't crowded out. */
async function showSubletForm(id) {
  const box = document.getElementById(`subletForm-${id}`);
  if (!box) return;
  if (box.dataset.open === "1") { box.innerHTML = ""; box.dataset.open = "0"; return; }
  box.dataset.open = "1";
  const cls = await getClassCached(CURRENT.classCode);
  const p = (cls.properties || []).find(x => x.id === id);
  const pr = cls.propertyRentals || {};
  let hint = "";
  if (p && p.rentPerWeek > 0) {
    const minPct = pr.minPricePct != null ? pr.minPricePct : 25;
    const maxPct = pr.maxPricePct != null ? pr.maxPricePct : 200;
    const lo = Math.round(p.rentPerWeek * minPct) / 100;
    const hi = Math.round(p.rentPerWeek * maxPct) / 100;
    const weeks = pr.maxLeaseWeeks != null ? ` and a minimum lease of up to ${pr.maxLeaseWeeks} week${pr.maxLeaseWeeks === 1 ? "" : "s"}` : "";
    hint = `Your teacher allows ${fmtMoney(lo)}${maxPct > 0 ? ` to ${fmtMoney(hi)}` : " or more"} per week${weeks}.`;
  }
  box.innerHTML = `
    <div class="p-inline-form">
      <div class="grid grid-2">
        <div>
          <label for="subletPrice-${id}">Weekly rent to charge</label>
          <input id="subletPrice-${id}" type="number" min="0" step="0.01">
        </div>
        <div>
          <label for="subletWeeks-${id}">Minimum lease (weeks)</label>
          <input id="subletWeeks-${id}" type="number" min="1" step="1" value="1">
        </div>
      </div>
      <span class="muted-small" id="subletHint-${id}">${hint}</span>
      <div><button class="btn small gold" onclick="createSubletClick('${id}')">${icon("send", 13)} List it</button></div>
      <div id="subletFormMsg-${id}"></div>
    </div>`;
}

/* ================= Teacher view ================= */
function renderTeacher(cls, props, me, nameOf) {
  populateMortgageSettings(cls);
  populatePropertyMarketSettings(cls);
  populateRentalSettings(cls);
  renderPendingSublets(cls, nameOf);
  renderNpcListings(cls, nameOf);
  const groups = groupProperties(props);
  document.getElementById("teacherPropList").innerHTML = groups.map(units => teacherListingCard(units, cls, me, nameOf)).join("");
  document.getElementById("noTeacherProps").classList.toggle("hidden", groups.length > 0);
  setCount("cntListings", groups.length);
}

function teacherListingCard(units, cls, me, nameOf) {
  const p = units[0];
  const gid = p.groupId || p.id;
  const owned = units.filter(u => u.owner);
  const available = units.filter(u => !u.owner);
  const range = p.priceRange || cls.propertyPriceRange || { min: 0.5, max: 2 };
  const rangeChip = `<span class="chip" title="${p.priceRange ? "Custom range for this listing" : "Class-wide default range"}">${range.min}%\u2013${range.max}%/day${p.priceRange ? " (custom)" : ""}</span>`;
  return `
    <article class="pcard">
      ${listingTop(p, cls, me, "")}
      ${listingChips(p, cls, availabilityChip(units, available) + rangeChip)}
      <div class="pcard-msg" id="msg-${gid}"></div>
      <div class="pcard-sec">
        <div class="p-actions">
          <button class="btn small secondary" onclick="editProp('${p.id}')">${icon("plus", 13)} Edit</button>
          <button class="btn small secondary" onclick="openPricingModal('${p.id}')">${icon("chart", 13)} Pricing</button>
          <button class="btn small coral" onclick="deleteProp('${p.id}')">${icon("trash", 13)} Remove</button>
        </div>
      </div>
      ${ownersSection(owned, cls, nameOf, gid)}
    </article>`;
}
function ownersSection(owned, cls, nameOf, gid) {
  if (!owned.length) return "";
  const expanded = OWNERS_EXPANDED.has(gid);
  const shown = expanded ? owned : owned.slice(0, OWNERS_PREVIEW);
  const hidden = owned.length - OWNERS_PREVIEW;
  return `
    <div class="pcard-sec">
      <div class="pcard-sec-head">Owners (${owned.length})</div>
      ${shown.map(u => ownerRowTeacher(u, cls, nameOf)).join("")}
      ${hidden > 0 ? `<button type="button" class="link-btn" onclick="toggleOwners('${gid}')">${expanded ? "Show fewer" : `Show ${hidden} more`}</button>` : ""}
    </div>`;
}
async function toggleOwners(gid) {
  if (OWNERS_EXPANDED.has(gid)) OWNERS_EXPANDED.delete(gid); else OWNERS_EXPANDED.add(gid);
  await render();
}
// One owned unit as a flat row: who, what it's worth vs what they paid,
// mortgage, how it's being used — plus the teacher's override buttons.
function ownerRowTeacher(u, cls, nameOf) {
  const gain = propertyGainSinceBought(u);
  const bits = [];
  if (gain) {
    const gc = gain.diff > 0 ? "ticker-up" : gain.diff < 0 ? "ticker-down" : "";
    const sign = gain.diff > 0 ? "+" : gain.diff < 0 ? "-" : "";
    bits.push(`bought ${fmtMoney(u.purchasePrice)}, now ${fmtMoney(u.price)} <span class="${gc}">(${sign}${Math.abs(gain.pct).toFixed(1)}%)</span>`);
  }
  if (u.mortgage) bits.push(`mortgage ${fmtMoney(u.mortgage.weeklyPayment)}/wk, ${u.mortgage.weeksLeft} wk left`);
  let note = "", action = "";
  const s = u.occupancy === "sublet" ? u.sublet : null;
  if (s) {
    if (s.status === "pending") note = `Wants to rent to classmates at ${fmtMoney(s.price)}/week, ${s.minWeeks}-week minimum — see Classmate rentals.`;
    else if (s.status === "rejected") note = `Rental listing declined${s.rejectReason ? `: ${escapeHtml(s.rejectReason)}` : "."}`;
    else if (!s.tenant) { note = `Listed at ${fmtMoney(s.price)}/week, no tenant yet.`; action = `<button class="btn small coral" onclick="teacherEndSubletClick('${u.id}')">End listing</button>`; }
    else { note = `Rented to ${escapeHtml(nameOf(s.tenant))} at ${fmtMoney(s.price)}/week.`; action = `<button class="btn small coral" onclick="teacherEndSubletClick('${u.id}')">End rental</button>`; }
  }
  return `
    <div class="prow">
      <div class="prow-main">
        <div class="prow-title">${escapeHtml(nameOf(u.owner))} ${occupancyChip(u)}</div>
        ${bits.length ? `<div class="prow-sub">${bits.join(" &middot; ")}</div>` : ""}
        ${note ? `<div class="prow-sub">${note}</div>` : ""}
      </div>
      <div class="prow-actions">${action}<button class="btn small secondary" onclick="forceSell('${u.id}')">Sell back</button></div>
    </div>`;
}

/* ---------------- Teacher: pricing dialog ---------------- */
async function openPricingModal(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const p = (cls.properties || []).find(x => x.id === id);
  if (!p) return;
  const dflt = cls.propertyPriceRange || { min: 0.5, max: 2 };
  const range = p.priceRange || dflt;
  document.getElementById("pricingTitle").textContent = "Pricing \u2014 " + p.name;
  document.getElementById("pricingBody").innerHTML = `
    <div class="form-sec">
      <div class="form-sec-title">Set a new price</div>
      <span class="muted-small">Changes the price right away. It's currently ${fmtMoney(p.price)}.</span>
      <div class="p-inline">
        <input type="number" min="0.01" step="0.01" id="price-${p.id}" value="${p.price}" aria-label="New price in dollars">
        <button class="btn small" onclick="overridePriceClick('${p.id}')">${icon("chart", 13)} Update</button>
      </div>
    </div>
    <div class="form-sec">
      <div class="form-sec-title">Daily movement for this listing</div>
      <span class="muted-small">${p.priceRange ? "This listing uses its own custom range." : `Using the class-wide default (${dflt.min}%\u2013${dflt.max}% per day).`}</span>
      <div class="grid grid-2">
        <div><label for="prmin-${p.id}">Min % change</label><input type="number" min="0" step="0.1" id="prmin-${p.id}" value="${range.min}"></div>
        <div><label for="prmax-${p.id}">Max % change</label><input type="number" min="0" step="0.1" id="prmax-${p.id}" value="${range.max}"></div>
      </div>
      <div class="p-modal-foot">
        <button class="btn small gold" onclick="setListingRangeClick('${p.id}')">${icon("chart", 13)} Save range</button>
        ${p.priceRange ? `<button class="btn small secondary" onclick="clearListingRangeClick('${p.id}')">Reset to class default</button>` : ""}
      </div>
    </div>
    <div id="pricingMsg"></div>`;
  openOverlay("pricingModal");
}
function closePricingModal() { closeOverlay("pricingModal"); }
// id is any unit's id within the listing. Errors stay in the dialog; on
// success it closes and the confirmation shows on the listing's own card.
async function showListingActionResult(id, res, successMsg) {
  if (!res.ok) { setMsg("pricingMsg", `<div class="error-msg">${res.error}</div>`, 7000); return; }
  closePricingModal();
  const gid = await gidOfProperty(id);
  await render();
  setMsg("msg-" + gid, `<div class="success-msg">${successMsg}</div>`, 4000);
}

/* ---------------- Teacher: classmate-rental requests ---------------- */
function renderPendingSublets(cls, nameOf) {
  const box = document.getElementById("pendingSublets");
  if (!box) return;
  const pending = (cls.properties || []).filter(p => p.sublet && p.sublet.status === "pending");
  setCount("cntPending", pending.length, true);
  if (!pending.length) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="card p-pending">
      <div class="set-head"><h2>${icon("send", 18)} Pending rental requests</h2><span class="badge coral">${pending.length} waiting</span></div>
      ${pending.map(p => `
        <div class="prow">
          <div class="prow-main">
            <div class="prow-title">${escapeHtml(p.name)}</div>
            <div class="prow-sub">${escapeHtml(nameOf(p.owner))} wants to rent it out at ${fmtMoney(p.sublet.price)}/week, ${p.sublet.minWeeks}-week minimum lease.</div>
          </div>
          <div class="prow-actions">
            <button class="btn small mint" onclick="approveSubletClick('${p.id}')">Approve</button>
            <button class="btn small coral" onclick="rejectSubletClick('${p.id}')">Reject</button>
          </div>
        </div>`).join("")}
    </div>`;
}

/* ---------------- Teacher: add / edit a property (dialog) ---------------- */
function resetPropForm() {
  ["hName", "hPrice", "hDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("hComfort").value = 3;
  document.getElementById("hQuantity").value = 1;
  document.getElementById("hLivingBonus").value = 1;
  document.getElementById("hMortgage").value = 0;
  document.getElementById("hMortgageRate").value = 0;
  document.getElementById("hVarMin").value = 0;
  document.getElementById("hVarMax").value = 0;
  document.getElementById("hRent").value = 0;
  document.getElementById("hRentDay").value = "Fri";
}
function setPropModalMode(editing) {
  document.getElementById("hAdd").textContent = editing ? "Edit property" : "Add a property";
  document.getElementById("addBtn").innerHTML = editing ? icon("send", 15) + " Save changes" : icon("plus", 15) + " Add property";
  document.getElementById("addMsg").innerHTML = "";
}
function openPropModal() {
  EDITING_ID = null;
  resetPropForm();
  setPropModalMode(false);
  openOverlay("propModal");
}
function closePropModal() {
  closeOverlay("propModal");
  EDITING_ID = null;
  resetPropForm();
  setPropModalMode(false);
}
async function addProp(e) {
  e.preventDefault();
  const btn = document.getElementById("addBtn");
  if (btn.disabled) return false;
  const varMin = Number(document.getElementById("hVarMin").value) || 0;
  const varMax = Number(document.getElementById("hVarMax").value) || 0;
  const addMsgEl = document.getElementById("addMsg");
  if (varMin < 0 || varMax < 0) { addMsgEl.innerHTML = `<div class="error-msg">Variable rates can't be negative.</div>`; return false; }
  if (varMax > 0 && varMin > varMax) { addMsgEl.innerHTML = `<div class="error-msg">The lowest variable rate can't be higher than the highest.</div>`; return false; }
  if (varMax > 0 && !(Number(document.getElementById("hMortgage").value) > 0)) { addMsgEl.innerHTML = `<div class="error-msg">Set a mortgage length above 0 weeks to offer a variable rate.</div>`; return false; }
  addMsgEl.innerHTML = "";
  const prop = {
    name: document.getElementById("hName").value.trim(),
    price: document.getElementById("hPrice").value,
    comfort: document.getElementById("hComfort").value,
    quantity: document.getElementById("hQuantity").value,
    livingBonusStars: document.getElementById("hLivingBonus").value,
    mortgageWeeks: document.getElementById("hMortgage").value,
    mortgageInterestRate: document.getElementById("hMortgageRate").value,
    variableRateMin: varMin,
    variableRateMax: varMax,
    description: document.getElementById("hDesc").value.trim(),
    rentPerWeek: document.getElementById("hRent").value,
    rentDay: document.getElementById("hRentDay").value
  };
  const editingId = EDITING_ID;
  btn.disabled = true;
  try {
    if (editingId) {
      await updateProperty(CURRENT.classCode, editingId, prop);
      const gid = await gidOfProperty(editingId);
      closePropModal();
      await render();
      setMsg("msg-" + gid, `<div class="success-msg">Property updated!</div>`, 4000);
    } else {
      await addProperty(CURRENT.classCode, prop);
      closePropModal();
      setTab("listings");
      await render();
      setMsg("pageMsg", `<div class="success-msg">Property added!</div>`, 4000);
    }
  } catch (err) {
    document.getElementById("addMsg").innerHTML = `<div class="error-msg">${escapeHtml(err && err.message ? err.message : "Something went wrong — please try again.")}</div>`;
  } finally {
    btn.disabled = false;
  }
  return false;
}
// id is any unit's id within the listing — edits apply to the whole
// group (see updateProperty in data-property.js). Quantity shown is how many
// units currently exist in that group.
async function editProp(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const props = cls.properties || [];
  const prop = props.find(p => p.id === id);
  if (!prop) return;
  const gid = prop.groupId || prop.id;
  const groupSize = props.filter(p => (p.groupId || p.id) === gid).length;
  EDITING_ID = id;
  document.getElementById("hName").value = prop.name;
  document.getElementById("hPrice").value = prop.price;
  document.getElementById("hComfort").value = prop.comfort;
  document.getElementById("hQuantity").value = groupSize;
  document.getElementById("hLivingBonus").value = prop.livingBonusStars !== undefined ? prop.livingBonusStars : 1;
  document.getElementById("hMortgage").value = prop.mortgageWeeks || 0;
  document.getElementById("hMortgageRate").value = prop.mortgageInterestRate || 0;
  document.getElementById("hVarMin").value = prop.variableRateMin || 0;
  document.getElementById("hVarMax").value = prop.variableRateMax || 0;
  document.getElementById("hDesc").value = prop.description || "";
  document.getElementById("hRent").value = prop.rentPerWeek || 0;
  document.getElementById("hRentDay").value = prop.rentDay || "Fri";
  setPropModalMode(true);
  openOverlay("propModal");
}

/* ---------------- Teacher: NPC (school) rentals ---------------- */
function renderNpcListings(cls, nameOf) {
  const list = document.getElementById("npcPropList");
  const units = cls.npcProperties || [];
  const groups = groupProperties(units);
  document.getElementById("noNpcProps").classList.toggle("hidden", groups.length > 0);
  setCount("cntSchool", groups.length);
  list.innerHTML = groups.map(g => {
    const p = g[0];
    const gid = p.groupId || p.id;
    const tenanted = g.filter(u => u.tenant);
    const vacant = g.filter(u => !u.tenant);
    return `
      <article class="pcard">
        <div class="pcard-top">
          <div class="pcard-id">
            <div class="pcard-name">
              <h3>${escapeHtml(p.name)}</h3>
              <div class="pcard-badges"><span class="badge lilac">School rental</span></div>
              <p class="pcard-desc">${escapeHtml(p.description) || "No description provided."}</p>
            </div>
          </div>
          <div class="pcard-money">
            <div class="pcard-price">${fmtMoney(p.rentPerWeek)}<small class="muted-small">/wk</small></div>
          </div>
        </div>
        <div class="pcard-chips">
          <span class="chip">${p.minWeeks}-week minimum lease</span>
          <span class="chip">Due ${dayFull(p.rentDay)}s</span>
          ${p.lifestylePoints > 0 ? `<span class="chip">+${p.lifestylePoints} lifestyle</span>` : ""}
          ${vacant.length ? `<span class="chip chip-ok">${g.length > 1 ? `${vacant.length} of ${g.length} available` : "Available"}</span>` : `<span class="chip chip-off">${g.length > 1 ? "All rented" : "Rented"}</span>`}
        </div>
        <div class="pcard-msg" id="npcMsg-${gid}"></div>
        <div class="pcard-sec">
          <div class="p-actions">
            <button class="btn small secondary" onclick="editNpcProp('${p.id}')">${icon("plus", 13)} Edit</button>
            <button class="btn small coral" onclick="deleteNpcProp('${p.id}')">${icon("trash", 13)} Remove</button>
          </div>
        </div>
        ${tenanted.length ? `
          <div class="pcard-sec">
            <div class="pcard-sec-head">Tenants (${tenanted.length})</div>
            ${tenanted.map(u => npcTenantBlock(u, nameOf)).join("")}
          </div>` : ""}
      </article>`;
  }).join("");
}
// One tenanted unit as a flat row — who's renting it, whether this week's
// rent is overdue, and the teacher's override controls (waive the overdue
// payment, or end the tenancy outright).
function npcTenantBlock(u, nameOf) {
  const overdue = isNpcRentOverdue(u);
  return `
    <div class="prow">
      <div class="prow-main">
        <div class="prow-title">${escapeHtml(nameOf(u.tenant))} ${overdue ? `<span class="badge coral">Rent overdue</span>` : ""}</div>
      </div>
      <div class="prow-actions">
        ${overdue ? `<button class="btn small secondary" onclick="resolveNpcOverdueClick('${u.id}')">Mark as resolved</button>` : ""}
        <button class="btn small coral" onclick="teacherEndNpcTenancyClick('${u.id}')">End tenancy</button>
      </div>
    </div>`;
}
function setNpcModalMode(editing) {
  document.getElementById("hAddNpc").textContent = editing ? "Edit school rental" : "Add a school rental";
  document.getElementById("addNpcBtn").innerHTML = editing ? icon("send", 15) + " Save changes" : icon("plus", 15) + " Add school rental";
  document.getElementById("addNpcMsg").innerHTML = "";
}
function openNpcModal() {
  EDITING_NPC_ID = null;
  resetNpcForm();
  setNpcModalMode(false);
  openOverlay("npcModal");
}
function closeNpcModal() {
  closeOverlay("npcModal");
  EDITING_NPC_ID = null;
  resetNpcForm();
  setNpcModalMode(false);
}
async function addNpcProp(e) {
  e.preventDefault();
  const btn = document.getElementById("addNpcBtn");
  if (btn.disabled) return false;
  const listing = {
    name: document.getElementById("npcName").value.trim(),
    description: document.getElementById("npcDesc").value.trim(),
    quantity: document.getElementById("npcQuantity").value,
    rentPerWeek: document.getElementById("npcRent").value,
    rentDay: document.getElementById("npcRentDay").value,
    minWeeks: document.getElementById("npcMinWeeks").value,
    lifestylePoints: document.getElementById("npcLifestylePoints").value
  };
  const editingId = EDITING_NPC_ID;
  btn.disabled = true;
  try {
    if (editingId) {
      await updateNpcProperty(CURRENT.classCode, editingId, listing);
      const gid = await gidOfProperty(editingId, true);
      closeNpcModal();
      await render();
      setMsg("npcMsg-" + gid, `<div class="success-msg">School rental updated!</div>`, 4000);
    } else {
      await addNpcProperty(CURRENT.classCode, listing);
      closeNpcModal();
      setTab("school");
      await render();
      setMsg("pageMsg", `<div class="success-msg">School rental added!</div>`, 4000);
    }
  } catch (err) {
    document.getElementById("addNpcMsg").innerHTML = `<div class="error-msg">${escapeHtml(err && err.message ? err.message : "Something went wrong — please try again.")}</div>`;
  } finally {
    btn.disabled = false;
  }
  return false;
}
// id is any unit's id within the listing — edits apply to the whole
// group (see updateNpcProperty in data-property.js). Quantity shown is how many
// units currently exist in that group.
async function editNpcProp(id) {
  const cls = await getClassCached(CURRENT.classCode);
  const units = cls.npcProperties || [];
  const p = units.find(u => u.id === id);
  if (!p) return;
  const gid = p.groupId || p.id;
  const groupSize = units.filter(u => (u.groupId || u.id) === gid).length;
  EDITING_NPC_ID = id;
  document.getElementById("npcName").value = p.name;
  document.getElementById("npcDesc").value = p.description || "";
  document.getElementById("npcQuantity").value = groupSize;
  document.getElementById("npcRent").value = p.rentPerWeek;
  document.getElementById("npcRentDay").value = p.rentDay || "Fri";
  document.getElementById("npcMinWeeks").value = p.minWeeks || 1;
  document.getElementById("npcLifestylePoints").value = p.lifestylePoints || 0;
  setNpcModalMode(true);
  openOverlay("npcModal");
}

// A successful purchase / move-in changes what's in "My homes", and the
// listing leaves the For-sale tab — so confirm at the top of the page and
// take the student to where their new home now lives.
function showPurchaseResult(html) {
  setTab("homes");
  setMsg("pageMsg", html, 10000);
  try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { window.scrollTo(0, 0); }
}

document.addEventListener("DOMContentLoaded", init);
