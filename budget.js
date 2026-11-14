let CURRENT, IS_TEACHER;

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("calendar", 26) + (IS_TEACHER ? " Budgeting" : " Budget");
  document.getElementById("hBudget").innerHTML = "Budget";
  document.getElementById("hBudPlan").innerHTML = "My plan";
  document.getElementById("hBudTrack").innerHTML = "How this week is going";
  document.getElementById("hBudDays").innerHTML = "Day by day";
  document.getElementById("labBudSave").innerHTML = "How much will I save each week?";
  document.getElementById("hBudgetTeacher").innerHTML = "Students' budgets this week";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = t29DisplayName(u);
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = "Dashboard";
  paintChrome();
  // BUGFIX: get a server-trustworthy "now" before any of the day-gated
  // jobs below decide "has this already run today?" — see
  // syncServerClock in data-core.js for why a device's own clock isn't good
  // enough for that check. Started here, in parallel with the first paint
  // below, so it doesn't add to the time before the page first paints;
  // only the jobs themselves wait for it.
  const T29_CLOCK_SYNC = syncServerClock(u.classCode);
  // Kick the day's jobs off but DON'T block the page on them: paint what
  // we already have first, then wait. On the first load of the day pay day
  // alone can take seconds (it writes per student), and blocking here is
  // what made a phone sit on a blank page. The popups and the final
  // render() below still run after the jobs, exactly as they did before.
  await t29FirstPaint(render);
  await T29_CLOCK_SYNC;
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  const T29_STARTUP_JOBS = Promise.all([
    // Same reasoning as the interest line below — a student session can
    // only ever safely pay their OWN wage/allowance, never a classmate's.
    safeBgJob(IS_TEACHER ? payDayForClassIfDue(u.classCode) : payMyWageIfDue(u.username), "autoPayDay"),
    safeBgJob(IS_TEACHER ? dailyLifeAllowanceForClassIfDue(u.classCode) : payMyDailyLifeAllowanceIfDue(u.username), "autoDailyLifeAllowance"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processLoanInterest(u.classCode), "processLoanInterest"),
    safeBgJob(processCreditCards(u.classCode), "processCreditCards"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    safeBgJob(processPropertyRent(u.classCode), "processPropertyRent"),
    // Teacher sessions can write every student's doc, so they still run
    // the full class-wide sweep (and act as a safety net for anyone who
    // hasn't opened anything yet). A student session only ever pays
    // their OWN interest — see the big comment above these two functions
    // in data-core.js for why a student's login can't safely pay classmates.
    safeBgJob(IS_TEACHER ? applyInterestToClassIfDue(u.classCode) : applyMyInterestIfDue(u.username), "autoInterest"),
    safeBgJob(IS_TEACHER ? kiwiSaverReturnsForClassIfDue(u.classCode) : applyMyKiwiSaverReturnsIfDue(u.username), "kiwiSaverReturns"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents"),
    // This week's variable mortgage rate has to be in place before the bills are worked out.
    safeBgJob(autoVariableRatesIfDue(u.classCode), "autoVariableRatesIfDue")
  ]);
  await T29_STARTUP_JOBS;
  // These popups read the results of the jobs above (e.g. a weekly event
  // that just got generated), so they still need to run afterwards — but
  // they stay sequential since each checks "is another popup already
  // showing" before deciding to show its own.
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await checkAdjustmentPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  document.getElementById("budgetCard").classList.toggle("hidden", IS_TEACHER);
  document.getElementById("budgetTeacherCard").classList.toggle("hidden", !IS_TEACHER);
  if (IS_TEACHER) {
    const allStudents = await getClassStudents(me.classCode, cls);
    renderBudgetTeacher(cls, allStudents);
  } else {
    renderBudgetStudent(me, cls);
  }
}

/* ---------------- My budget ----------------
   All the sums live in data-money.js (buildBudgetView and friends); this is
   only drawing them and the one form. BUDGET_VIEW keeps the last view so
   the plan can update as the student types, without re-reading anything
   or redrawing the page under their cursor. */
let BUDGET_VIEW = null;

const BUD_STATUS = {
  in:     { done: "Arrived", today: "Today", upcoming: "Coming", missed: "Missed", free: "Free week", daily: "Every day" },
  out:    { done: "Paid", today: "Due today", upcoming: "Coming up", missed: "Missed", overdue: "Overdue", free: "Free week" },
  save:   { done: "Done", today: "Today", upcoming: "Coming", missed: "Didn't happen" },
  unsave: { done: "Done", today: "Today", upcoming: "Coming", missed: "Didn't happen" }
};
const BUD_STATUS_TONE = { done: "done", today: "today", upcoming: "upcoming", missed: "missed", overdue: "missed", free: "free", daily: "upcoming" };

function budEsc(s) { return escapeHtml(s === undefined || s === null ? "" : String(s)); }

// A date key as "Mon 12 Oct".
function budDateLabel(key, opts) {
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-NZ", Object.assign({ timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }, opts || {}))
    .format(new Date(Date.UTC(y, m - 1, d)));
}
// "Week of 12 Oct – 18 Oct", from the Monday it starts on.
function budWeekLabel(startKey) {
  const o = { weekday: undefined };
  return "Week of " + budDateLabel(startKey, o) + " – " + budDateLabel(dateKeyPlusDays(startKey, 6), o);
}

// -$12.34 for a loss, rather than fmtMoney's "$-12.34".
function fmtSigned(n) {
  const v = Number(n) || 0;
  return (v < 0 ? "-" : "") + fmtMoney(Math.abs(v));
}

function budSaveValue() {
  const raw = document.getElementById("budSave").value.trim();
  const n = Number(raw);
  return raw === "" || !isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100;
}

function renderBudgetStudent(me, cls) {
  const v = buildBudgetView(cls, me, CURRENT.username);
  BUDGET_VIEW = v;
  BUD_ME = me;
  document.getElementById("budWeek").textContent = budWeekLabel(v.weekStartKey);

  /* ---- The three numbers ---- */
  const tile = (cls2, ic, label, value, sub) => `
    <div class="bud-tile ${cls2}">
      <div class="bud-tile-label"><span>${label}</span></div>
      <div class="bud-tile-value">${value}</div>
      <div class="bud-tile-sub">${sub}</div>
    </div>`;
  document.getElementById("budSummary").innerHTML =
    tile("in", "coin", "Coming in", fmtMoney(v.inTotal),
      v.actual.extraTotal > 0 ? `Includes ${fmtMoney(v.actual.extraTotal)} extra so far` : "This week") +
    tile("out", "house", "Bills", fmtMoney(v.billsTotal),
      v.billsTotal <= 0 ? "None this week" : v.billsLeft > 0 ? `${fmtMoney(v.billsLeft)} still to pay` : "All paid") +
    tile("left" + (v.left < 0 ? " neg" : ""), "piggy", "Left after bills", fmtSigned(v.left),
      v.left < 0 ? "Your bills are more than you're earning" : "To save and spend");

  // Only things that need doing are shown — no "you're on track" boxes.
  document.getElementById("budVerdict").innerHTML = v.verdict.tone === "good" ? ""
    : `<div class="bud-verdict ${v.verdict.tone}"><span>${budEsc(v.verdict.text)}</span></div>`;

  /* ---- The plan ---- */
  const input = document.getElementById("budSave");
  if (document.activeElement !== input) {
    input.value = v.plan.hasPlan ? v.plan.saveAmount
      : (v.autoSave > 0 ? v.autoSave : "");
  }
  document.getElementById("budClearBtn").classList.toggle("hidden", !v.plan.hasPlan);
  document.getElementById("budSaveBtn").innerHTML = icon(v.plan.hasPlan ? "repeat" : "piggy", 15) + (v.plan.hasPlan ? " Update my plan" : " Save my plan");

  /* ---- How the week is going ---- */
  const row = (name, nums, pct, fill, sub) => `
    <div class="bud-track-row">
      <div class="bud-track-head"><span class="bud-track-name">${name}</span><span class="bud-track-nums">${nums}</span></div>
      ${pct === null ? "" : `<div class="bud-track-bar"><div class="bud-track-fill ${fill}" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></div></div>`}
      ${sub ? `<div class="bud-track-sub">${sub}</div>` : ""}
    </div>`;
  const rows = [];
  rows.push(v.billsTotal > 0
    ? row("Bills paid", `<strong>${fmtMoney(v.billsPaid)}</strong> of ${fmtMoney(v.billsTotal)}`,
        (v.billsPaid / v.billsTotal) * 100, "bills",
        v.billsLeft > 0 ? `${fmtMoney(v.billsLeft)} still to pay this week` : "Every bill is paid. Nice work")
    : row("Bills", "None this week", null, "", ""));
  const spendParts = v.actual.purchases.concat(v.actual.surprises);
  const spendSub = spendParts.length ? spendParts.map(p => `${budEsc(p.label)} ${fmtMoney(p.amount)}`).join(" · ") : "Nothing spent yet this week";
  if (v.plan.hasPlan) {
    const over = v.spendLeft < -0.005;
    rows.push(row("Spending", `<strong class="${over ? "bud-bad" : ""}">${fmtMoney(v.spent)}</strong> of ${fmtMoney(v.spendAllowed)}`,
      v.spendAllowed > 0 ? (v.spent / v.spendAllowed) * 100 : (v.spent > 0 ? 100 : 0), over ? "over" : "spend",
      (over ? `<span class="bud-bad">${fmtMoney(-v.spendLeft)} over your plan</span>` : `${fmtMoney(v.spendLeft)} left to spend`) + ` · ${spendSub}`));
    const savedOk = v.actual.saved >= v.saveTarget - 0.005;
    rows.push(row("Saved", `<strong class="${savedOk && v.saveTarget > 0 ? "bud-good" : ""}">${fmtSigned(v.actual.saved)}</strong> of ${fmtMoney(v.saveTarget)}`,
      v.saveTarget > 0 ? (v.actual.saved / v.saveTarget) * 100 : null, "save",
      v.actual.saved < 0 ? "You took more out of savings than you put in this week"
        : v.saveTarget <= 0 ? "You're not saving anything this week"
        : savedOk ? "Goal reached for this week" : `${fmtMoney(v.saveTarget - v.actual.saved)} to go. Move it into Savings on the Bank page`));
  } else {
    rows.push(row("Spending", `<strong>${fmtMoney(v.spent)}</strong> so far`, null, "", spendSub));
    rows.push(row("Saved", `<strong>${fmtSigned(v.actual.saved)}</strong> so far`, null, "",
      v.actual.saved < 0 ? "You took more out of savings than you put in this week" : "Savings, term deposits, shares and extra KiwiSaver, minus anything taken back out"));
  }
  // Credit card: what's owing against the limit, and what's coming.
  if (v.card) {
   const cardList = [v.card].concat(v.card.others || []), manyCards = cardList.length > 1;
   cardList.forEach(cd => {
    const hot = cd.limit > 0 && cd.balance / cd.limit >= 0.85;
    const earn = cd.cashbackSoFar > 0 ? `<span class="bud-cashback" title="Comes off your closing balance when the statement closes">+${fmtMoney(cd.cashbackSoFar)} cashback</span>` : "";
    rows.push(row(manyCards ? `${budEsc(cd.plan.name)} card${cd === v.card ? " (for purchases)" : ""}` : "Credit card", `<strong>${fmtMoney(cd.balance)}</strong> of ${fmtMoney(cd.limit)}${earn}`,
      cd.limit > 0 ? (cd.balance / cd.limit) * 100 : 0, hot ? "cardhot" : "cardbal",
      (cd.stmtRemaining > 0 ? `${fmtMoney(cd.stmtRemaining)} closing balance due ${budEsc(cardDateLabel(cd.dueKey))} · ` : "")
        + (cd.unbilled > 0 ? `${fmtMoney(cd.unbilled)} spent since the last statement, closing ${budEsc(cardDateLabel(cd.nextCloseKey))}` : `Next statement closes ${budEsc(cardDateLabel(cd.nextCloseKey))}`)
        + (cd.cashbackSoFar > 0 ? ` · ${fmtMoney(cd.cashbackSoFar)} cashback earned so far comes off your closing balance` : "")));
   });
  }
  // KiwiSaver comes off their pay before it reaches them, so it's shown
  // on its own rather than counted in the money above.
  if (v.kiwi) {
    const k = v.kiwi;
    const when = k.status === "done" ? "Came off your pay before it reached you" : "Comes off your pay before it reaches you";
    rows.push(k.paused
      ? row("KiwiSaver", "On a break", null, "", "Nothing comes off your pay, and your employer and the government aren't adding anything either.")
      : row("KiwiSaver", `<strong>${fmtMoney(k.you)}</strong> from your pay`, null, "",
          `${when}, so it isn't in the money above. Your employer adds ${fmtMoney(k.employerNet)}${k.govt > 0 ? ` and the government adds ${fmtMoney(k.govt)}` : ""}.`));
  }
  document.getElementById("budTrackRows").innerHTML = rows.join("");

  // Safe to spend = cash + savings + rest of this week's income − rest of
  // this week's bills (worked out in buildBudgetView).
  const cashNow = Math.max(0, v.cash);
  const othersWord = v.otherLabel === "Savings" ? "savings" : "other accounts";
  let safeWhy;
  if (v.historyIncomplete) safeWhy = "The full week's activity is unavailable, so this amount cannot be verified. Check the warning above.";
  else if (v.paymentIssues.length) safeWhy = "An automatic payment has a funding problem. Check the warning above before spending.";
  else if (v.safeTotal <= 0.005) safeWhy = `Your main account and withdrawable ${othersWord}, plus the money still to come, don't cover the rest of this week's bills, so there's nothing safe to spend.`;
  else {
    safeWhy = `Reserves money for bills on each remaining day, using only withdrawable accounts and excluding conditional income. Automatic saving is reserved too.`;
    if (v.safeTimed < v.safeTotal - 0.005) safeWhy += ` Some money hasn't arrived yet or is reserved for saving, so the timing limit is ${fmtMoney(v.safeTimed)}.`;
    if (v.safeNow > cashNow + 0.005) safeWhy += ` Only ${fmtMoney(cashNow)} is in your main account. Spending more means moving ${othersWord} into it first, on the Bank page.`;
    if (v.plan.hasPlan && v.spendLeft < v.safeTimed - 0.005) safeWhy += v.spendLeft > 0.005 ? ` Your plan limits spending to ${fmtMoney(v.spendLeft)} more.` : " You've already used all of your plan's spending money.";
  }
  document.getElementById("budSafe").innerHTML = `
    <div class="bud-safe-label">Safe to spend right now</div>
    <div class="bud-safe-value">${fmtMoney(v.safeNow)}</div>
    <div class="bud-safe-why">${budEsc(safeWhy)}</div>
    <div class="bud-safe-have"><span>${budEsc(v.mainLabel)} <strong>${fmtSigned(v.cash)}</strong></span><span>${budEsc(v.otherLabel || "Savings")} <strong>${fmtMoney(v.savings)}</strong></span><span>Expected income <strong>+${fmtMoney(v.restIn)}</strong></span>${v.restReturns > 0 ? `<span>Deposits returning <strong>+${fmtMoney(v.restReturns)}</strong></span>` : ""}<span>Bills to pay <strong>−${fmtMoney(v.restBills)}</strong></span></div>`;

  /* ---- Day by day ---- */
  const itemRow = i => {
    const sign = i.dir === "in" || i.dir === "unsave" ? "+" : "−";
    const amtCls = i.dir === "in" || i.dir === "unsave" ? "in" : i.dir === "save" ? "save" : "out";
    const crossed = i.status === "missed" || i.status === "free";
    // Money that hasn't moved yet is grey; it turns green/red once it has.
    const pending = ["today", "upcoming", "overdue", "daily"].includes(i.status);
    return `
      <div class="bud-row ${amtCls}${crossed ? " crossed" : ""}${pending ? " pending" : ""}">
        <span class="bud-row-icon">${icon(i.icon, 15)}</span>
        <div class="bud-row-text">
          <div class="bud-row-label">${budEsc(i.label)}</div>
          ${i.note ? `<div class="bud-row-note">${budEsc(i.note)}</div>` : ""}
        </div>
        <div class="bud-row-end">
          <span class="bud-row-amt">${sign}${fmtMoney(i.amount)}</span>
          <span class="bud-chip-status ${BUD_STATUS_TONE[i.status] || "upcoming"}">${budEsc((BUD_STATUS[i.dir] || BUD_STATUS.out)[i.status] || "")}</span>
        </div>
      </div>`;
  };
  const blocks = [];
  for (let d = 0; d < 7; d++) {
    const key = dateKeyPlusDays(v.weekStartKey, d);
    const dayItems = v.items.filter(i => i.dayKey === key);
    if (!dayItems.length) continue;
    const order = { in: 0, unsave: 1, out: 2, save: 3 };
    dayItems.sort((a, b) => order[a.dir] - order[b.dir]);
    blocks.push(`
      <div class="bud-day${key === v.todayKey ? " today" : ""}${key < v.todayKey ? " past" : ""}">
        <div class="bud-day-head">${budDateLabel(key)}${key === v.todayKey ? ` <span class="bud-today">Today</span>` : ""}</div>
        ${dayItems.map(itemRow).join("")}
      </div>`);
  }
  const daily = v.items.filter(i => i.status === "daily");
  if (daily.length) {
    blocks.push(`<div class="bud-day"><div class="bud-day-head">Every day</div>${daily.map(itemRow).join("")}</div>`);
  }
  if (v.actual.extra.length) {
    blocks.push(`<div class="bud-day"><div class="bud-day-head">Extra money so far</div>${v.actual.extra.map(e => `
      <div class="bud-row in">
        <span class="bud-row-icon">${icon("star", 15)}</span>
        <div class="bud-row-text"><div class="bud-row-label">${budEsc(e.label)}</div></div>
        <div class="bud-row-end"><span class="bud-row-amt">+${fmtMoney(e.amount)}</span><span class="bud-chip-status done">Arrived</span></div>
      </div>`).join("")}</div>`);
  }
  document.getElementById("budDays").innerHTML = blocks.length ? blocks.join("")
    : `<p class="muted-small bud-empty">Nothing regular comes in or goes out this week yet.</p>`;
  budRenderEditArea(v); // the Edit / Reset buttons (and the edit screen itself while editing)
  const toCome = v.items.filter(i => i.status === "today" || i.status === "upcoming" || i.status === "overdue").length;
  document.getElementById("budDaysCount").textContent = v.items.length
    ? `${v.items.length} item${v.items.length === 1 ? "" : "s"}${toCome ? ` · ${toCome} still to come` : ""}` : "";
  const daysWrap = document.getElementById("budDaysWrap");
  if (!daysWrap.dataset.ready) {
    daysWrap.dataset.ready = "1";
    let open = false;
    try { open = localStorage.getItem("t29_bud_days_open") === "1"; } catch (e) {}
    daysWrap.open = open;
  }

  // Warnings and tips sit at the top, straight under the main verdict.
  document.getElementById("budNotes").innerHTML = v.notes.filter(n => n.tone !== "good").map(n =>
    `<div class="bud-note ${n.tone}"><span>${budEsc(n.text)}</span></div>`).join("");

  budgetRecalc();
}

/* ---------------- Editing the day by day list ----------------
   Take regular items out, add your own, then save for this week only or for this and future
   weeks. The sums are in data-money.js (budgetApplyEdits / budgetValidateEdits / saveBudgetEdits);
   saving redraws the whole page, so the tiles, tracker and safe-to-spend follow the edited list. */
let BUD_EDIT = null;          // { removed: Set of item keys, added: [custom items] } while editing
let BUD_ME = null;            // the student's doc, for the saved edits
let BUD_RESET_OPEN = false;   // the "reset to automatic" choice is showing
let BUD_FLASH = "";           // the last save/reset message

function budInjectEditCss() {
  if (document.getElementById("budEditCss")) return;
  const st = document.createElement("style");
  st.id = "budEditCss";
  st.textContent = `.bud-edit-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.bud-edit-row .muted-small{flex:1 1 220px}
.bud-edit-panel{border:1px solid rgba(128,128,128,.3);border-radius:10px;padding:10px 14px;margin:8px 0}
.bud-add{border:1px dashed rgba(128,128,128,.5);border-radius:10px;padding:10px 14px;margin:14px 0}
.bud-add-title{font-weight:800;margin-bottom:8px}
.bud-add-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;align-items:end}
.bud-edit-actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 6px}
.bud-edit-issues{margin:8px 0;padding:10px 14px 10px 30px;border-radius:10px;background:rgba(224,88,106,.12)}
.bud-edit-issues li{margin:3px 0}
.bud-edit-notes{margin:8px 0;padding:10px 14px 10px 30px;border-radius:10px;background:rgba(240,180,41,.15)}
.bud-row-end .btn{padding:2px 9px;font-size:var(--fs-xs,12px)}
.bud-removed-title{font-weight:800;margin:16px 0 4px}`;
  document.head.appendChild(st);
}
function budEditSourceText(src) {
  return src === "week" ? "You've changed this week's list (this week only)."
    : src === "rule" ? "You've changed your list for this and future weeks."
    : "This list is automatic. Edit it to add or take out items.";
}
function budRenderEditArea(v) {
  budInjectEditCss();
  const bar = document.getElementById("budEditBar");
  if (!bar) return;
  if (BUD_EDIT) {
    bar.innerHTML = `<div class="muted-small">Editing your week. Take things out, add your own, then choose how to save.</div>`;
    document.getElementById("budDays").innerHTML = budEditHtml(v);
    return;
  }
  const edits = BUD_ME && BUD_ME.budget && BUD_ME.budget.edits;
  const hasEdits = v.editSource !== "auto" || !!(edits && (edits.rule || (edits.weeks && Object.keys(edits.weeks).length)));
  const resetPanel = BUD_RESET_OPEN ? `<div class="bud-edit-panel">
      <strong>Go back to the automatic list?</strong>
      <div class="muted-small" style="margin:4px 0 8px;">${v.editSource === "rule" ? "\"This week only\" keeps your changes for later weeks." : "Your own items and anything you took out are cleared."}</div>
      <div class="bud-edit-actions" style="margin:0;">
        <button class="btn small" onclick="budReset('week')">This week only</button>
        <button class="btn small" onclick="budReset('future')">This and future weeks</button>
        <button class="btn small secondary" onclick="budResetAsk(false)">Never mind</button>
      </div></div>` : "";
  bar.innerHTML = `<div class="bud-edit-row"><span class="muted-small">${budEsc(budEditSourceText(v.editSource))}</span>
      <button class="btn small gold" onclick="budEditStart()">Edit my days</button>
      ${hasEdits ? `<button class="btn small secondary" onclick="budResetAsk(true)">Reset to automatic</button>` : ""}</div>${resetPanel}${BUD_FLASH}`;
}
function budResetAsk(open) { BUD_RESET_OPEN = !!open; BUD_FLASH = ""; if (BUDGET_VIEW) budRenderEditArea(BUDGET_VIEW); }
async function budReset(scope) {
  const v = BUDGET_VIEW; if (!v) return;
  const res = await resetBudgetEdits(CURRENT.username, scope, v.weekStartKey);
  BUD_RESET_OPEN = false;
  BUD_FLASH = res.ok ? `<div class="success-msg">${scope === "future" ? "Back to automatic for this week and future weeks." : "Back to automatic for this week."}</div>` : `<div class="error-msg">${budEsc(res.error)}</div>`;
  await render();
}
function budEditStart() {
  const v = BUDGET_VIEW; if (!v) return;
  BUD_EDIT = { removed: new Set(v.removedKeys || []), added: (v.customAdded || []).map(c => Object.assign({}, c)) };
  BUD_RESET_OPEN = false; BUD_FLASH = "";
  const w = document.getElementById("budDaysWrap"); if (w) w.open = true;
  budRenderEditArea(v);
}
async function budEditCancel() { BUD_EDIT = null; await render(); }
function budDraftItems(v) {
  const kept = (v.baseItems || []).filter(i => !BUD_EDIT.removed.has(i.key));
  return kept.concat(BUD_EDIT.added.map(c => budgetCustomItem(c, v.weekStartKey, v.todayKey)));
}
function budEditHtml(v) {
  const items = budDraftItems(v);
  const todayIdx = Math.max(0, Math.round(daysBetweenKeys(v.weekStartKey, v.todayKey)));
  const row = i => {
    const sign = i.dir === "in" || i.dir === "unsave" ? "+" : "−";
    const amtCls = i.dir === "in" || i.dir === "unsave" ? "in" : i.dir === "save" ? "save" : "out";
    const happened = i.status === "done" && !i.custom;
    const btn = i.custom
      ? `<button type="button" class="btn small secondary" data-id="${budEsc(i.customId)}" onclick="budEditRemoveCustom(this.dataset.id)">Remove</button>`
      : happened ? `<span class="bud-chip-status done">Already happened</span>`
      : `<button type="button" class="btn small secondary" data-key="${budEsc(i.key)}" onclick="budEditRemove(this.dataset.key)">Take out</button>`;
    return `<div class="bud-row ${amtCls}">
      <span class="bud-row-icon">${icon(i.icon, 15)}</span>
      <div class="bud-row-text"><div class="bud-row-label">${budEsc(i.label)}</div>${i.note ? `<div class="bud-row-note">${budEsc(i.note)}</div>` : ""}</div>
      <div class="bud-row-end"><span class="bud-row-amt">${sign}${fmtMoney(i.amount)}</span>${btn}</div></div>`;
  };
  const blocks = [];
  for (let d = 0; d < 7; d++) {
    const key = dateKeyPlusDays(v.weekStartKey, d);
    const dayItems = items.filter(i => i.dayKey === key);
    const order = { in: 0, unsave: 1, out: 2, save: 3 };
    dayItems.sort((a, b) => order[a.dir] - order[b.dir]);
    blocks.push(`<div class="bud-day${key === v.todayKey ? " today" : ""}${key < v.todayKey ? " past" : ""}">
      <div class="bud-day-head">${budDateLabel(key)}${key === v.todayKey ? ` <span class="bud-today">Today</span>` : ""}</div>
      ${dayItems.length ? dayItems.map(row).join("") : `<p class="muted-small" style="margin:6px 0;">Nothing planned.</p>`}</div>`);
  }
  const daily = items.filter(i => i.status === "daily");
  if (daily.length) blocks.push(`<div class="bud-day"><div class="bud-day-head">Every day</div>${daily.map(row).join("")}</div>`);
  const gone = (v.baseItems || []).filter(i => BUD_EDIT.removed.has(i.key));
  const goneHtml = gone.length ? `<div class="bud-removed-title">Taken out of your plan</div>${gone.map(i => `
    <div class="bud-row crossed"><span class="bud-row-icon">${icon(i.icon, 15)}</span>
      <div class="bud-row-text"><div class="bud-row-label">${budEsc(i.label)}</div></div>
      <div class="bud-row-end"><span class="bud-row-amt">${i.dir === "in" || i.dir === "unsave" ? "+" : "−"}${fmtMoney(i.amount)}</span>
        <button type="button" class="btn small secondary" data-key="${budEsc(i.key)}" onclick="budEditRestore(this.dataset.key)">Put back</button></div></div>`).join("")}` : "";
  const dayOpts = [0, 1, 2, 3, 4, 5, 6].map(d => {
    const past = d < todayIdx, nm = budgetDayWord(dateKeyPlusDays(v.weekStartKey, d));
    return `<option value="${d}" ${past ? "disabled" : ""} ${d === todayIdx ? "selected" : ""}>${nm}${past ? " (passed)" : d === todayIdx ? " (today)" : ""}</option>`;
  }).join("");
  return `${blocks.join("")}${goneHtml}
    <div class="bud-add">
      <div class="bud-add-title">Add your own</div>
      <div class="bud-add-grid">
        <div><label for="budAddLabel">What is it?</label><input id="budAddLabel" type="text" maxlength="${BUDGET_MAX_LABEL}" placeholder="e.g. Pocket money"></div>
        <div><label for="budAddAmt">Amount</label><input id="budAddAmt" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00"></div>
        <div><label for="budAddDir">Type</label><select id="budAddDir"><option value="in">Money coming in</option><option value="out" selected>Bill or spending</option><option value="save">Saving</option></select></div>
        <div><label for="budAddDay">Day</label><select id="budAddDay">${dayOpts}</select></div>
        <div><button type="button" class="btn small gold" style="width:100%;" onclick="budEditAdd()">Add</button></div>
      </div>
    </div>
    <div class="bud-edit-actions">
      <button type="button" class="btn gold" id="budEditSaveWeek" onclick="budEditSave('week')">Save for this week only</button>
      <button type="button" class="btn" id="budEditSaveFuture" onclick="budEditSave('future')">Save for this and future weeks</button>
      <button type="button" class="btn secondary" onclick="budEditCancel()">Cancel</button>
    </div>
    <div id="budEditMsg"></div>`;
}
// Redraw the edit list without losing what's typed in the "add" boxes.
function budEditRerender() {
  const ids = ["budAddLabel", "budAddAmt", "budAddDir", "budAddDay"], keep = {};
  ids.forEach(id => { const el = document.getElementById(id); if (el) keep[id] = el.value; });
  document.getElementById("budDays").innerHTML = budEditHtml(BUDGET_VIEW);
  ids.forEach(id => { const el = document.getElementById(id); if (el && keep[id] !== undefined) el.value = keep[id]; });
}
function budEditMsg(html) { const el = document.getElementById("budEditMsg"); if (el) el.innerHTML = html || ""; }
function budEditRemove(key) { if (BUD_EDIT) { BUD_EDIT.removed.add(key); budEditRerender(); } }
function budEditRestore(key) { if (BUD_EDIT) { BUD_EDIT.removed.delete(key); budEditRerender(); } }
function budEditRemoveCustom(id) { if (BUD_EDIT) { BUD_EDIT.added = BUD_EDIT.added.filter(c => c.id !== id); budEditRerender(); } }
function budEditAdd() {
  if (!BUD_EDIT) return;
  const label = document.getElementById("budAddLabel").value.trim();
  const amount = Number(document.getElementById("budAddAmt").value);
  const dir = document.getElementById("budAddDir").value, day = Number(document.getElementById("budAddDay").value);
  const problems = [];
  if (!label) problems.push("Type what it is, like \"Pocket money\".");
  if (label.length > BUDGET_MAX_LABEL) problems.push(`Keep the name to ${BUDGET_MAX_LABEL} characters or fewer.`);
  if (!(amount > 0)) problems.push("Type an amount greater than $0.");
  else if (amount > BUDGET_MAX_ITEM) problems.push(`The amount can't be more than ${fmtMoney(BUDGET_MAX_ITEM)}.`);
  if (BUD_EDIT.added.length >= BUDGET_MAX_CUSTOM) problems.push(`You can add up to ${BUDGET_MAX_CUSTOM} items of your own. Remove one first.`);
  if (problems.length) { budEditMsg(`<ul class="bud-edit-issues">${problems.map(p => `<li>${budEsc(p)}</li>`).join("")}</ul>`); return; }
  BUD_EDIT.added.push({ id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), label, amount: budgetRound(amount), dir, day });
  budEditRerender();
  document.getElementById("budAddLabel").value = ""; document.getElementById("budAddAmt").value = "";
  budEditMsg("");
}
async function budEditSave(scope) {
  if (!BUD_EDIT || !BUDGET_VIEW) return;
  const draft = { removed: Array.from(BUD_EDIT.removed), added: BUD_EDIT.added };
  const chk = budgetValidateEdits(BUDGET_VIEW, BUD_ME, draft, scope);
  const list = (arr, cls) => arr.length ? `<ul class="${cls}">${arr.map(m => `<li>${budEsc(m)}</li>`).join("")}</ul>` : "";
  if (chk.errors.length) {
    budEditMsg(`<div class="muted-small"><strong>Not saved yet.</strong> Fix ${chk.errors.length === 1 ? "this" : "these"} and try again:</div>${list(chk.errors, "bud-edit-issues")}`);
    return;
  }
  const btns = ["budEditSaveWeek", "budEditSaveFuture"].map(id => document.getElementById(id));
  btns.forEach(b => { if (b) b.disabled = true; });
  const res = await saveBudgetEdits(CURRENT.username, scope, draft, BUDGET_VIEW.weekStartKey);
  if (!res.ok) {
    btns.forEach(b => { if (b) b.disabled = false; });
    budEditMsg(`<div class="muted-small"><strong>Not saved.</strong></div>${list(res.errors || [], "bud-edit-issues")}`);
    return;
  }
  BUD_EDIT = null;
  BUD_FLASH = `<div class="success-msg">Saved for ${scope === "future" ? "this week and future weeks" : "this week only"}. The numbers above now follow your list.</div>${list(chk.notes, "bud-edit-notes")}`;
  await render();
}

// Remembers whether this student likes the day-by-day list open.
function budgetDaysToggled(el) {
  if (!el.dataset.ready) return;
  try { localStorage.setItem("t29_bud_days_open", el.open ? "1" : "0"); } catch (e) {}
}

// The plan part, redrawn on every keystroke — only reads the input, never
// the database.
function budgetRecalc() {
  const v = BUDGET_VIEW;
  if (!v) return;
  const save = budSaveValue();
  const left = v.left;

  // Quick amounts: a share of what's left after bills.
  const chips = document.getElementById("budChips");
  chips.innerHTML = left > 0
    ? [10, 20, 30, 50].map(p => {
        const amt = Math.round(left * p) / 100;
        const on = save !== null && Math.abs(save - amt) < 0.005;
        return `<button type="button" class="bud-chip${on ? " on" : ""}" onclick="budgetPickPercent(${p})">${p}% <span>${fmtMoney(amt)}</span></button>`;
      }).join("")
    : "";

  const s = save === null ? 0 : save;
  const spend = Math.max(0, Math.round((left - s) * 100) / 100);
  const result = document.getElementById("budResult");
  let html;
  if (save === null) {
    html = `<span>Type an amount, or pick one of the buttons. ${left > 0 ? `You have <strong>${fmtMoney(left)}</strong> left after bills this week.` : ""}</span>`;
  } else if (left <= 0) {
    html = `<span class="bud-warn">Your bills already use up everything coming in this week, so ${s > 0 ? "anything you save" : "your spending"} would come from cash you already have.</span>`;
  } else if (s > left + 0.005) {
    html = `<span class="bud-warn">That's ${fmtMoney(s - left)} more than you have left after bills. It would have to come from cash you already have, leaving nothing to spend.</span>`;
  } else {
    html = `<span class="bud-result-line">Spending money this week: <strong>${fmtMoney(spend)}</strong></span>
            <span class="muted-small">${left > 0 ? `Saving ${Math.round((s / left) * 100)}% of what's left after bills.` : ""}</span>`;
  }
  result.innerHTML = html;

  // The whole week's money in one bar: bills / spending / saving.
  const wrap = document.getElementById("budSplitWrap");
  const total = Math.max(v.inTotal, v.billsTotal + s + spend, 0.01);
  wrap.classList.toggle("hidden", v.inTotal <= 0 && v.billsTotal <= 0);
  const parts = [
    { key: "needs", label: "Bills (needs)", amt: v.billsTotal },
    { key: "wants", label: "Spending (wants)", amt: spend },
    { key: "savings", label: "Saving", amt: s }
  ];
  const pct = a => v.inTotal > 0 ? Math.round((a / v.inTotal) * 100) : 0;
  const bar = document.getElementById("budSplitBar");
  bar.classList.toggle("over", v.billsTotal + s > v.inTotal + 0.005);
  bar.innerHTML = parts.map(p => `<div class="seg ${p.key}" style="width:${((p.amt / total) * 100).toFixed(2)}%"></div>`).join("");
  bar.setAttribute("aria-label", parts.map(p => `${p.label} ${pct(p.amt)}%`).join(", ") + " of the money coming in");
  document.getElementById("budSplitLegend").innerHTML = parts.map(p =>
    `<span><span class="dot ${p.key}"></span>${p.label} ${fmtMoney(p.amt)}${v.inTotal > 0 ? ` (${pct(p.amt)}%)` : ""}</span>`).join("");
}

function budgetPickPercent(p) {
  if (!BUDGET_VIEW || BUDGET_VIEW.left <= 0) return;
  document.getElementById("budSave").value = (Math.round(BUDGET_VIEW.left * p) / 100).toFixed(2);
  budgetRecalc();
}

async function saveBudgetPlan(e) {
  e.preventDefault();
  const box = document.getElementById("budMsg");
  const btn = document.getElementById("budSaveBtn");
  btn.disabled = true;
  try {
    const res = await saveBudget(CURRENT.username, document.getElementById("budSave").value);
    if (res.ok) {
      flashMsg(box, `<div class="success-msg">Plan saved. It keeps going every week until you change it.</div>`);
      await render();
    } else {
      box.innerHTML = `<div class="error-msg">${budEsc(res.error)}</div>`;
    }
  } catch (err) {
    box.innerHTML = `<div class="error-msg">Your plan couldn't be saved. Check your connection and try again.</div>`;
  } finally {
    btn.disabled = false;
  }
  return false;
}

async function budgetClear() {
  if (!await t29Confirm("Clear your budget plan?")) return;
  await clearBudget(CURRENT.username);
  document.getElementById("budSave").value = "";
  document.getElementById("budMsg").innerHTML = "";
  await render();
}

/* ---------------- Teacher: everyone's budget ---------------- */
function renderBudgetTeacher(cls, students) {
  document.getElementById("budWeekTeacher").textContent = budWeekLabel(budgetWeekStartKey());
  const rows = classBudgetOverviewFromData(cls, students.filter(s => s.role !== "teacher"));
  document.getElementById("noBudTeacher").classList.toggle("hidden", rows.length > 0);

  const planned = rows.filter(r => r.planned);
  const onTrack = rows.filter(r => r.status === "ok");
  const needHelp = rows.filter(r => ["unknown", "bounce", "move", "short", "over"].includes(r.status));
  const stat = (tone, ic, label, value, of) => `
    <div class="stat ${tone}"><span class="icon">${icon(ic, 26)}</span>
      <div class="label">${label}</div>
      <div class="value">${value}${of !== undefined ? `<span style="font-size:1rem;font-weight:700;"> / ${of}</span>` : ""}</div></div>`;
  document.getElementById("budTeacherStats").innerHTML =
    stat("sky", "idcard", "Have a savings plan", planned.length, rows.length) +
    stat("mint", "trophy", "On track", onTrack.length, rows.length) +
    stat(needHelp.length ? "gold" : "mint", "shield", "Might need a hand", needHelp.length, rows.length);

  const FLAG = {
    unknown: `<span class="bud-flag warn">Incomplete activity history</span>`,
    bounce: `<span class="bud-flag short">A bill could bounce</span>`,
    move: `<span class="bud-flag warn">Needs money from savings</span>`,
    short: `<span class="bud-flag short">Bills more than money in</span>`,
    over: `<span class="bud-flag short">Over their plan</span>`,
    none: `<span class="bud-flag none">No plan yet</span>`,
    ok: `<span class="bud-flag ok">On track</span>`
  };
  document.getElementById("budTeacherTable").innerHTML = rows.map(r => `
    <tr>
      <td><strong>${budEsc(r.name)}</strong></td>
      <td>${fmtMoney(r.inTotal)}</td>
      <td>${r.billsTotal > 0 ? fmtMoney(r.billsTotal) : "—"}</td>
      <td class="${r.left < 0 ? "money-out" : ""}">${fmtSigned(r.left)}</td>
      <td>${r.planned ? fmtMoney(r.saveTarget) + " a week" : "—"}</td>
      <td class="${r.saved < 0 ? "money-out" : ""}">${fmtSigned(r.saved)}</td>
      <td>${fmtMoney(r.spent)}${r.planned ? ` <span class="muted-small">of ${fmtMoney(r.spendAllowed)}</span>` : ""}</td>
      <td>${FLAG[r.status]}</td>
    </tr>`).join("");
}

document.addEventListener("DOMContentLoaded", init);
