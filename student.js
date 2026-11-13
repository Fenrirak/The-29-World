let CURRENT;

function badgeType(type) {
  const map = {
    welcome: ["navy", "star", "Welcome"],
    wage: ["mint", "briefcase", "Wage"],
    interest: ["gold", "piggy", "Savings interest"],
    "cash-interest": ["gold", "coin", "Cash interest"],
    bonus: ["mint", "star", "Bonus"],
    fine: ["coral", "coin", "Fine"],
    transfer: ["navy", "send", "Transfer"],
    automation: ["navy", "repeat", "Auto-pay"],
    "stock-buy": ["gold", "chart", "Stock buy"],
    "stock-sell": ["gold", "chart", "Stock sell"],
    "stock-close": ["gold", "building", "Delisted"],
    "insurance-buy": ["lilac", "shield", "Insurance"],
    "store-buy": ["mint", "cart", "Store"],
    "store-sell": ["gold", "cart", "Store sale"],
    "property-buy": ["navy", "house", "Property"],
    "property-sell": ["gold", "house", "Property sold"],
    "mortgage": ["coral", "house", "Mortgage"], "mortgage-extra": ["coral", "house", "Extra mortgage payment"],
    "event": ["lilac", "dice", "Random event"],
    "vehicle-buy": ["navy", "car", "Vehicle"], "vehicle-sell": ["gold", "car", "Vehicle sold"],
    "transport-expense": ["coral", "car", "Transport expenses"],
    "term-deposit-open": ["lilac", "vault", "Term deposit"], "term-deposit-early": ["coral", "vault", "Early withdrawal"],
    "term-deposit-mature": ["mint", "vault", "Deposit matured"],
    "gambling": ["gold", "dice", "Gambling"], "big-event": ["coral", "star", "Big event"],
    "insurance-claim": ["mint", "shield", "Insurance claim"], "insurance-premium": ["coral", "shield", "Premium"],
    "insurance-signup-fee": ["lilac", "shield", "Insurance sign-up"],
    "account-close": ["gold", "piggy", "Account closed"], "savings-deposit": ["mint", "piggy", "Savings deposit"], "savings-withdraw": ["gold", "piggy", "Savings withdrawal"],
    "card-purchase": ["navy", "cards", "Card purchase"], "card-payment": ["mint", "cards", "Card payment"],
    "card-interest": ["coral", "cards", "Card interest"], "card-fee": ["coral", "cards", "Card fee"], "account-fee": ["coral", "coin", "Account fee"],
    "card-cashback": ["mint", "cards", "Cashback"], "card-statement": ["gold", "cards", "Statement"],
    "loan-taken": ["navy", "vault", "Loan"], "loan-repayment": ["mint", "vault", "Loan repayment"],
    "side-hustle": ["mint", "briefcase", "Side hustle"],
    "store-gift": ["mint", "cart", "Free item"],
    "quiz-reward": ["mint", "idcard", "Quiz passed"],
    "p2p-buy": ["navy", "users", "Bought from a classmate"],
    "p2p-sell": ["gold", "users", "Sold to a classmate"],
    "property-rent": ["mint", "house", "Rent received"],
    "property-rent-pay": ["coral", "house", "Rent paid"],
    "property-rent-receive": ["mint", "house", "Rent received"],
    "property-occupancy": ["navy", "house", "Occupancy change"],
    "truck-drive": ["mint", "car", "Truck drive"],
    "truck-licence-buy": ["navy", "car", "Truck licence"],
    "loan-interest": ["coral", "loan", "Loan interest"],
    "gambling-buyin": ["gold", "dice", "Gambling buy-in"], "gambling-cashout": ["mint", "dice", "Gambling cash-out"],
    "life-grant": ["gold", "trophy", "Life event"], "life-revoke": ["coral", "trophy", "Life event removed"],
    "life-allowance": ["mint", "trophy", "Life allowance"],
    "kiwisaver-in": ["navy", "kiwi", "KiwiSaver"], "kiwisaver-out": ["mint", "kiwi", "KiwiSaver withdrawal"],
    "kiwisaver-refund": ["gold", "kiwi", "KiwiSaver refund"]
  };
  const [cls, ic, label] = map[type] || ["navy", "coin", type];
  return `<span class="badge ${cls}">${icon(ic, 12)}${label}</span>`;
}
const AVATAR_COLORS = ["c1", "c2", "c3", "c4", "c5"];
function avatarClass(username) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("iconBalance").innerHTML = icon("piggy", 30);
  document.getElementById("iconPortfolio").innerHTML = icon("chart", 30);
  document.getElementById("iconJob").innerHTML = icon("briefcase", 30);
  document.getElementById("iconLifestyle").innerHTML = icon("star", 30);
  document.getElementById("hLeaderboard").innerHTML = icon("medal", 18) + " Net worth ranking";
  document.getElementById("hBank").innerHTML = icon("piggy", 18) + " Bank account";
  document.getElementById("hClassmates").innerHTML = icon("users", 18) + " My classmates";
  document.getElementById("hMarket").innerHTML = icon("chart", 18) + " Market snapshot";
  document.getElementById("hActivity").innerHTML = icon("history", 18) + " My recent activity (last 3 days)";
  document.getElementById("bankLink").innerHTML = icon("piggy", 14) + " Go to Bank";
  document.getElementById("iconBcSavings").innerHTML = icon("piggy", 26);
  document.getElementById("iconBcRate").innerHTML = icon("percent", 26);
  document.getElementById("marketLink").innerHTML = icon("chart", 14) + " Go to Stock Market";
  document.getElementById("reportCardBtn").innerHTML = icon("idcard", 14) + " My report card";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  // A mismatched role here means the session on this device belongs to
  // someone else (e.g. a shared classroom computer where a teacher
  // account was left signed in). Forwarding straight to teacher-home.html
  // used to hand whoever's now sitting at the machine that teacher's
  // dashboard — confusing at best. Instead, sign this stale session out
  // and send them back to the login screen so the right person can log
  // in as themselves.
  if (u.role !== "student") { clearSession(); window.location.href = "index.html"; return; }
  CURRENT = u;
  document.getElementById("whoami").textContent = u.name;
  paintChrome();
  // BUGFIX: get a server-trustworthy "now" before any of the day-gated
  // jobs below decide "has this already run today?" — see
  // syncServerClock in data-core.js for why a device's own clock isn't good
  // enough for that check. Started here, in parallel with the first paint
  // below, so it doesn't add to the time before the student first sees
  // their balance; only the jobs themselves wait for it.
  const T29_CLOCK_SYNC = syncServerClock(u.classCode);
  // Fire any wages or automatic payments that have come due since last visit
  // These 7 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 7 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  // Note: mortgage payments are NOT auto-deducted here (see payMortgage in
  // the data-*.js files) — students pay their own weekly installment on the due day.
  await t29FirstPaint(render);
  await T29_CLOCK_SYNC;
  const T29_STARTUP_JOBS = Promise.all([
    safeBgJob(payMyWageIfDue(u.username), "payMyWageIfDue"),
    safeBgJob(payMyDailyLifeAllowanceIfDue(u.username), "payMyDailyLifeAllowanceIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    // Weekly rent for property owners used to only be collected when the Property page was opened.
    safeBgJob(processPropertyRent(u.classCode), "processPropertyRent"),
    safeBgJob(processCreditCards(u.classCode), "processCreditCards"),
    safeBgJob(applyMyInterestIfDue(u.username), "applyMyInterestIfDue"),
    safeBgJob(applyMyKiwiSaverReturnsIfDue(u.username), "applyMyKiwiSaverReturnsIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents"),
    safeBgJob(processJobPromotions(u.classCode), "processJobPromotions")
  ]);
  await T29_STARTUP_JOBS;
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await checkAdjustmentPopup(u.username, u.classCode);
  await checkAndShowPromotionPopup(u.username);
  await render();
  // Keeps the family link's summary (if this student has made one) up to
  // date — see "Parent view" in data-money.js. Quiet, and at most every
  // couple of hours per device.
  Promise.all([getUserCached(u.username), getClassCached(u.classCode)])
    .then(([me, cls]) => refreshParentViewIfStale(me, cls))
    .catch(() => {});
  if (typeof t29MaybeStartTour === "function") t29MaybeStartTour("student", u);
  // Keeps the side hustle check-in window (and everything else) in sync
  // with the clock even if the student just leaves the tab open. Paused
  // while the tab is hidden — this re-reads the user, the class AND the
  // roster each time, which is real data and battery on a phone that
  // isn't even looking at the page. Same approach as the balance widget
  // in the data-*.js files, and it catches up with one render on the way back.
  // The 30s redraw is clock-driven (side hustle window, "today" items) and now takes everything from
  // the cache, so it costs almost no reads. Changes to this student's own account arrive through a
  // live listener (instead of a re-read of the user, the class AND every classmate every 30 seconds).
  // Both pause while the tab is hidden, as before, and catch up with one redraw on the way back.
  const STUDENT_REFRESH_MS = 30000;
  let refreshTimer = setInterval(render, STUDENT_REFRESH_MS);
  let unwatchMe = null, watchDebounce = null, lastMeSig = null;
  // The time-limit tracker rewrites these two fields every ~10s; they never need a redraw.
  const meSig = d => JSON.stringify(d, (k, v) => (k === "timeSpentTodaySec" || k === "timeSpentDate" ? undefined : v));
  const startWatching = () => {
    if (unwatchMe || typeof t29WatchDoc !== "function") return;
    if (u.dailyLimitMinutes > 0) return; // that tracker would bill a read per write; the timer's cached re-read is cheaper
    let first = true;
    unwatchMe = t29WatchDoc("users", u.username, (doc, info) => {
      if (info && info.error) { unwatchMe = null; return; } // listener gone: timer redraws re-read as needed
      if (!doc) return;
      const sig = meSig(doc);
      if (first) { first = false; lastMeSig = sig; return; } // the opening snapshot is what was just drawn
      if (sig === lastMeSig) return;
      lastMeSig = sig;
      clearTimeout(watchDebounce);
      watchDebounce = setTimeout(render, 400);
    });
  };
  const stopWatching = () => {
    if (unwatchMe) { unwatchMe(); unwatchMe = null; }
    clearTimeout(watchDebounce);
  };
  startWatching();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearInterval(refreshTimer);
      refreshTimer = null;
      stopWatching();
    } else if (!refreshTimer) {
      render();
      refreshTimer = setInterval(render, STUDENT_REFRESH_MS);
      startWatching();
    }
  });
}

// The ranking and classmates table need everyone's account, which costs one Firestore read per
// classmate. They used to be re-read on every redraw (every 30s). Classmates' balances only matter
// at a glance, so the list is kept for a few minutes; this student's own row is always the live one.
const ROSTER_TTL_MS = 5 * 60000;
const STUDENT_CLASS_TTL_MS = 2 * 60000;
let ROSTER_CACHE = { at: 0, code: null, count: -1, list: null };
async function getRosterForRender(me, cls) {
  const count = (cls.students || []).length; // someone joining or leaving refreshes it straight away
  const fresh = ROSTER_CACHE.list && ROSTER_CACHE.code === me.classCode && ROSTER_CACHE.count === count &&
    (Date.now() - ROSTER_CACHE.at) < ROSTER_TTL_MS;
  if (!fresh) {
    const list = await getClassStudents(me.classCode, cls);
    ROSTER_CACHE = { at: Date.now(), code: me.classCode, count, list };
  }
  return ROSTER_CACHE.list.map(s => (s.username === me.username ? Object.assign({}, s, me, { username: s.username }) : s));
}

async function render() {
  // getUserCached and getClassCached are independent reads — CURRENT.classCode
  // is already known without needing `me` first, so fetch both at once
  // instead of waiting on one before starting the other.
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  // Events, locks and rates change rarely, so redraws don't need to re-read the class document every time.
  if (cls && window._rcSet) window._rcSet("classes", CURRENT.classCode, cls, STUDENT_CLASS_TTL_MS);

  document.getElementById("greeting").textContent = "Hi, " + me.name + "!";
  document.getElementById("balance").textContent = t29SvActive() ? "Unlimited ∞" : fmtMoney(me.balance); // student view: the teacher's own bank never runs out
  document.getElementById("portfolio").textContent = fmtMoney(await portfolioValue(me.username, me.classCode));
  bcLast = { me: acctLogical(me), cls };
  bcRenderAcct();

  const job = cls.jobs.find(j => j.id === me.jobId);
  const myTier = job ? getStudentTier(job, me) : null;
  document.getElementById("jobLabel").textContent = job
    ? (myTier ? `${myTier.name}: ${fmtMoney(myTier.wage)}/payday` : `${job.title}/payday`)
    : "No job assigned";

  renderGoals(me);
  try { renderTodo(Object.assign({ username: CURRENT.username }, me), cls); } catch (e) { console.warn("To-do list failed:", e); }

  const lockReasons = await getModuleLockReasons(me.username, me.classCode);
  const lockedModules = Object.keys(lockReasons);
  applyModuleLocks(lockReasons);

  await renderSideHustle(me, cls, lockedModules);

  // Fetch the class roster once and reuse it for both the leaderboard and
  // the classmates table below — these used to each independently call
  // getClassStudents(), which batches one Firestore read PER STUDENT, so
  // every render() was reading every student in the class twice over.
  const allStudents = await getRosterForRender(me, cls);

  // net worth leaderboard
  const board = await classLeaderboard(me.classCode, me.username, allStudents);

  const cfg = cls.lifestyleConfig || {};
  const anyEnabled = ["property", "store", "insurance", "transport", "loan"].some(k => cfg[k] && cfg[k].enabled);
  document.getElementById("lifestyleCard").classList.toggle("hidden", !anyEnabled);
  if (anyEnabled) {
    const score = await lifestyleRating(me.username, me.classCode);
    // Pass the leaderboard we already built above instead of having
    // lifestyleBandForStudent() recompute it (another full-class re-read).
    const label = await lifestyleBandForStudent(me.username, me.classCode, board);
    const isOverride = me.lifestyleOverride !== undefined && me.lifestyleOverride !== null;
    document.getElementById("lifestyleValue").textContent =
      score + (label ? ": " + label : "") + (isOverride ? " (set by teacher)" : "");
  }
  const avById = {}; allStudents.forEach(s => { avById[s.username] = s; });
  const medalClass = i => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "");
  const lbBox = document.getElementById("leaderboardList");
  lbBox.innerHTML = "";
  board.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "leaderboard-row" + (row.username === me.username ? " me" : "");
    div.innerHTML = leaderboardRowHtml(row, i, { avatarSource: avById[row.username] || row, you: row.username === me.username, medal: medalClass(i) });
    lbBox.appendChild(div);
  });
  leaderboardWireTaps(lbBox);

  // classmates (reuses allStudents fetched above for the leaderboard)
  const classmates = allStudents.filter(s => s.username !== me.username);
  const ctbl = document.getElementById("classmateTable");
  ctbl.innerHTML = "";
  classmates.forEach(s => {
    const j = cls.jobs.find(jj => jj.id === s.jobId);
    const sTier = j ? getStudentTier(j, s) : null;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><span class="cm-name">${avatarBadge(s)}<span>${escapeHtml(s.name)}</span></span></td><td>${sTier ? escapeHtml(sTier.name) : (j ? escapeHtml(j.title) : "—")}</td>`;
    ctbl.appendChild(tr);
  });

  // market snapshot
  const mbody = document.getElementById("marketSnapshot");
  mbody.innerHTML = "";
  document.getElementById("noCompanies").classList.toggle("hidden", cls.companies.length > 0);
  // "Since Monday" reuses the same Monday-of-the-current-week key and
  // price-lookup helpers the weekly stock estimate (the data-*.js files) already uses,
  // so this figure lines up with what students see there.
  const mondayKey = budgetWeekStartKey();
  // All-time $ / % per company: unrealized (current holdings vs. what they
  // cost) plus realized (locked in from past sells/delistings). See the
  // big comment on stockAllTimeGain() in data-money.js for exactly what this can
  // and can't see — a "*" after a row's all-time figures means that row's
  // number might be missing history that's no longer retrievable (a
  // legacy holding bought before this feature existed, or an older sale
  // that's aged out of the shared transaction log).
  const gain = await stockAllTimeGain(me.username, me.classCode);
  cls.companies.forEach(co => {
    const mine = co.holders[me.username] || 0;
    const mondayPrice = companyPriceAtDate(co, mondayKey);
    const diff = Math.round((co.price - mondayPrice) * 100) / 100;
    const pct = mondayPrice ? (diff / mondayPrice) * 100 : 0;
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
    const moveClass = diff > 0 ? "ticker-up" : diff < 0 ? "ticker-down" : "";

    const g = gain.perCompany[co.id] || { total: 0, pct: null, complete: true };
    const gSign = g.total > 0 ? "+" : g.total < 0 ? "-" : "";
    const gClass = g.total > 0 ? "ticker-up" : g.total < 0 ? "ticker-down" : "";
    const gStar = g.complete ? "" : "*";
    const gPctText = g.pct === null ? "—" : `${g.pct > 0 ? "+" : g.pct < 0 ? "-" : ""}${Math.abs(g.pct).toFixed(1)}%`;

    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(co.name)}</td><td>${fmtMoney(co.price)}</td><td>${mine}</td>
      <td class="${moveClass}">${sign}${fmtMoney(Math.abs(diff))}</td>
      <td class="${moveClass}">${sign}${Math.abs(pct).toFixed(1)}%</td>
      <td class="${gClass}">${gSign}${fmtMoney(Math.abs(g.total))}${gStar}</td>
      <td class="${gClass}">${gPctText}${gStar}</td>`;
    mbody.appendChild(tr);
  });
  const allTimeNote = document.getElementById("allTimeNote");
  if (allTimeNote) allTimeNote.classList.toggle("hidden", gain.complete);

  // my transactions — last 3 days only (txns carry a raw "ts" epoch-ms
  // alongside the display "date" string; very old entries from before
  // "ts" existed don't have one, so those are kept rather than hidden).
  // Individual gambling bets ("gambling") are left out of this general feed
  // on purpose — they now have their own dedicated list on the Gambling
  // module's Account tab (see renderGamblingAccountRecent in gambling.js) —
  // but buying into/cashing out of the gambling account still shows up
  // here like any other money movement, since those touch the student's
  // main cash balance.
  const activityCutoff = Date.now() - 3 * 24 * 3600 * 1000;
  const my = cls.txns
    .filter(t => txnBelongsTo(t, me.username) && t.type !== "gambling" && (t.ts === undefined || t.ts >= activityCutoff))
    .slice(0, 200);
  document.getElementById("noTxns").classList.toggle("hidden", my.length > 0);
  const tbody = document.getElementById("txnTable");
  tbody.innerHTML = "";
  const BANK_PREVIEW_TYPES = new Set(["transfer", "automation", "savings-deposit", "savings-withdraw", "account-close", "interest", "cash-interest"]);
  const bankPreview = [];
  const nameCache = {};
  for (const s of allStudents) nameCache[s.username] = s.name;
  const teacher = await getClassTeacherDisplay(cls);
  if (teacher) nameCache[teacher.username] = teacher.name;
  const nameOf = u => nameCache[u] || u;
  my.forEach(t => {
    let detail = t.note || "";
    if (t.type === "transfer" || t.type === "automation") {
      if (t.from === me.username) detail = "To " + nameOf(t.to) + (t.note ? ": " + t.note : (t.type === "automation" ? ". Automatic payment" : ""));
      else detail = "From " + nameOf(t.from) + (t.note ? ": " + t.note : (t.type === "automation" ? ". Automatic payment" : ""));
    }
    // Which way the money went — one shared answer for every page (see
    // txnDirection in data-money.js): green "+" in, red "−" out, plain when
    // it only moved between the student's own pockets.
    const { sign, amount: amt } = txnDirection(t, me.username);

    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted-small">${t.date}</td><td>${badgeType(t.type)}</td><td>${escapeHtml(detail)}</td>
      <td class="${moneyClass(sign)}">${fmtSignedMoney(sign, amt)}</td>`;
    tbody.appendChild(tr);

    if (BANK_PREVIEW_TYPES.has(t.type) && bankPreview.length < 3) bankPreview.push({ type: t.type, detail, sign, amt, date: t.date });
  });

  const bpBox = document.getElementById("bcRecentActivity");
  bpBox.innerHTML = "";
  document.getElementById("bcNoActivity").classList.toggle("hidden", bankPreview.length > 0);
  bankPreview.forEach((t, i) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;" + (i < bankPreview.length - 1 ? "border-bottom:1px solid var(--line);" : "");
    row.innerHTML = `
      <div style="min-width:0;">
        ${badgeType(t.type)}
        <div class="muted-small" style="margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(t.detail)} · ${t.date}</div>
      </div>
      <div class="${moneyClass(t.sign)}" style="white-space:nowrap;">${fmtSignedMoney(t.sign, t.amt)}</div>
    `;
    bpBox.appendChild(row);
  });
}

/* ---------------- To do today ----------------
   Everything that needs the student to DO something, in one list at the
   top of their account. Most of it comes straight from the notification
   bell's own builders (notifications.js — loans, mortgage, rent,
   transport, big events, promotion offers, side hustle check-in, quizzes,
   offers on their listings), so the box and the bell always agree. Added
   here: a money-for-bills warning from the budget, a weekly event waiting
   for a choice, KiwiSaver once it's unlocked, and finding a job. */
const TODO_CTA = {
  "loan.html": "Repay", "property.html": "Go to Property", "transport.html": "Pay transport", "bigevents.html": "Decide",
  "marketplace.html": "See offers", "budget.html": "Open budget", "jobs.html": "Find a job", "kiwisaver.html": "Open KiwiSaver"
};
let LAST_TODO = null;
function refreshTodo() { if (LAST_TODO) renderTodo(LAST_TODO.me, LAST_TODO.cls); }
function restoreTodo() { notifTodoRestoreAll(LAST_TODO.me.username); if (typeof notifRefresh === "function") notifRefresh(LAST_TODO.me.username, CURRENT.classCode); refreshTodo(); }
function renderTodo(me, cls) {
  LAST_TODO = { me, cls };
  let items = [];
  if (typeof buildNotifications === "function") {
    if (typeof NOTIF_USER !== "undefined" && !NOTIF_USER) NOTIF_USER = me.username;
    buildNotifications(me, cls, { keepDismissed: true }).filter(n => n.action).forEach(n => {
      const item = { id: n.id, title: n.title, body: n.body, urgent: n.tone === "coral", href: n.href, onClick: n.onClick };
      // On this page, these two are handled right here rather than by a link.
      if (/^promo-/.test(n.id)) { item.onClick = "checkAndShowPromotionPopup(CURRENT.username)"; item.cta = "Answer"; item.href = null; }
      if (/^sh-\d/.test(n.id)) { item.onClick = "document.getElementById('sideHustleCard').scrollIntoView({ behavior: 'smooth' })"; item.cta = "Check in"; item.href = null; }
      if (n.onClick && /QuizForModule/.test(n.onClick)) item.cta = "Take the quiz";
      items.push(item);
    });
  }
  // A weekly event waiting for the student to choose what to do.
  const weekKey = isoWeekKey();
  const now = trustedNow().getTime();
  (cls.eventLog || []).filter(l => l.studentUser === me.username && l.week === weekKey && l.type === "choice" && l.status === "pending" && (l.revealAt === undefined || l.revealAt <= now))
    .forEach(l => items.push({ id: "event-choice-" + (l.id || l.week) + "-" + nzDateKey(), title: "Choose what to do: " + (l.name || "this week's event"), body: "An event this week is waiting for your choice.", urgent: true,
      onClick: "checkWeeklyEventPopup(CURRENT.username, CURRENT.classCode)", cta: "Choose" }));
  // Money for bills (the budget's own warning, which already counts savings).
  try {
    const v = buildBudgetView(cls, me, me.username);
    if (v && v.verdict && (v.verdict.tone === "bad" || v.verdict.tone === "warn") && v.shortfall) {
      items.push({ id: "budget-bills-" + nzDateKey(), title: v.verdict.tone === "bad" ? "Not enough money for this week's bills" : "Move money from savings for bills",
        body: v.verdict.text, urgent: v.verdict.tone === "bad", href: "budget.html#budgetCard", cta: "Open budget" });
    }
  } catch (e) { /* budget is a bonus here — never let it stop the list */ }
  // KiwiSaver unlocked after the class retired.
  const ks = typeof kiwiSaverOf === "function" ? kiwiSaverOf(me) : null;
  if (ks && ks.balance > 0 && kiwiSaverSettings(cls).retired) {
    items.push({ id: "kiwisaver-unlocked-" + nzDateKey(), title: "Your KiwiSaver is unlocked", body: `You've retired, so you can take out your ${fmtMoney(ks.balance)} whenever you like.`, href: "kiwisaver.html" });
  }
  // No job yet, and there are jobs to apply for.
  const hasJobs = (cls.jobs || []).some(j => j.tiers && j.tiers.length);
  const applied = (cls.jobApplications || []).some(a => a.studentUser === me.username && (!a.status || a.status === "pending"));
  if (!me.jobId && hasJobs && !applied && !(kiwiSaverSettings(cls).retired)) {
    items.push({ id: "get-a-job-" + nzDateKey(), title: "Get a job", body: "You don't have a job yet, so nothing comes in on pay day. Apply for one on the Jobs page.", href: "jobs.html" });
  }

  items.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  const total = items.length;
  items = items.filter(it => !(it.id && notifTodoIsDismissed(me.username, it.id)));
  const hidden = total - items.length;
  const list = document.getElementById("todoList");
  document.getElementById("todoCount").textContent = items.length ? `${items.length} thing${items.length === 1 ? "" : "s"}` : "";
  const restore = hidden ? `<p class="todo-restore-row"><button type="button" class="todo-restore" onclick="restoreTodo()">Show ${hidden} dismissed</button></p>` : "";
  if (!items.length) {
    list.innerHTML = `<p class="todo-empty">${hidden ? "Everything is dismissed for now." : "You're all caught up. Nothing needs doing today."}</p>${restore}`;
    return;
  }
  list.innerHTML = `<ul class="todo-list">${items.map(it => {
    const cta = it.cta || TODO_CTA[(it.href || "").split("#")[0]] || "Open";
    const btn = it.onClick
      ? `<button type="button" class="btn small ${it.urgent ? "gold" : "secondary"}" onclick="${escapeHtml(it.onClick)}">${escapeHtml(cta)}</button>`
      : it.href ? `<a class="btn small ${it.urgent ? "gold" : "secondary"}" href="${escapeHtml(it.href)}">${escapeHtml(cta)}</a>` : "";
    return `<li class="todo-item">
      <div class="todo-text">
        <div class="todo-title">${it.urgent ? `<span class="todo-tag">Today</span>` : ""}${escapeHtml(it.title)}</div>
        ${it.body ? `<div class="todo-body">${escapeHtml(it.body)}</div>` : ""}
      </div>
      <div class="todo-actions">${btn}<button type="button" class="todo-dismiss" data-todo-id="${escapeHtml(it.id || it.title)}" aria-label="Dismiss: ${escapeHtml(it.title)}" title="Dismiss">&times;</button></div>
    </li>`;
  }).join("")}</ul>${restore}`;
  list.onclick = ev => {
    const x = ev.target.closest && ev.target.closest(".todo-dismiss");
    if (!x) return;
    notifTodoDismiss(me.username, x.getAttribute("data-todo-id"));
    refreshTodo();
  };
}

/* Savings goals: see savings-goals.js (shared with the Bank page). */

/* ---------------- Lifestyle-based module locks ---------------- */
// `reasons` is the moduleKey -> "lifestyle" | "quiz" | "both" map from
// getModuleLockReasons(). The two lock systems need different next steps
// from the student — "your rating is too low" vs "go and pass the quiz" —
// so the banner splits them out instead of blaming the rating for both.
function applyModuleLocks(reasons) {
  applyNavModuleLocks(reasons);
  const banner = document.getElementById("lifestyleLockBanner");
  const labelFor = key => {
    const a = document.querySelector(`nav a[data-module="${key}"] .nav-label`);
    if (a) return a.textContent;
    return key === "sidehustle" ? "Side hustle" : key;
  };
  const byLifestyle = [], byQuiz = [];
  Object.keys(reasons || {}).forEach(key => {
    if (reasons[key] !== "quiz") byLifestyle.push(labelFor(key));
    if (reasons[key] !== "lifestyle") byQuiz.push(labelFor(key));
  });

  if (!byLifestyle.length && !byQuiz.length) {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  banner.innerHTML = `<p style="margin:0;"><strong>Some modules are locked</strong></p>` +
    (byLifestyle.length ? `<p style="margin:6px 0 0;">Your lifestyle rating is too low right now to use: ${byLifestyle.join(", ")}. Ask your teacher what's needed to unlock them.</p>` : "") +
    (byQuiz.length ? `<p style="margin:6px 0 0;">Pass the quiz set for each of these to unlock them: ${byQuiz.join(", ")}. Click the module in the menu above and the quiz will open right here.</p>` : "");
}

/* ---------------- Side hustle ----------------
   Rewritten as a single explicit state machine so there's exactly one
   place that decides what's on screen, instead of several toggle() calls
   that can drift out of sync. States:
     "locked"   — lifestyle rating too low, module locked by teacher
     "empty"    — teacher hasn't added any side hustles yet
     "pick"     — student has no hustle yet (first-ever pick, no approval needed)
     "request"  — student has a hustle, is requesting a change (needs approval)
     "active"   — student has a hustle and isn't currently editing it
   sh() is a tiny helper that warns loudly in the console instead of
   silently failing if an expected element is missing from the page. */
function sh(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[side hustle] expected #${id} in the page but it's missing`);
  return el;
}

let SH_MODE_REQUEST = false; // true once the student clicks "Request a change"
let SH_HUSTLES = []; // cached from the latest render, used by the pay chart
let SH_ME = null;
let SH_SEL = null; // { hustleId, hour } the student tapped in the pay chart

// e.g. "4pm – 4:15pm"
function sideHustleWindowLabel(h) {
  const period = h < 12 ? "am" : "pm";
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hourLabel(h)} – ${hh}:15${period}`;
}

function shSetBlock(state) {
  const blocks = { locked: "shLockedBlock", empty: "shEmptyBlock", pick: "shPickBlock", request: "shPickBlock", active: "shActiveBlock" };
  ["shLockedBlock", "shEmptyBlock", "shPickBlock", "shActiveBlock"].forEach(id => {
    const el = sh(id);
    if (el) el.classList.toggle("hidden", blocks[state] !== id);
  });
}

async function renderSideHustle(me, cls, lockedModules) {
  SH_ME = me;
  const hustles = cls.sideHustles || [];
  const isLocked = (lockedModules || []).includes("sidehustle");

  if (isLocked) { shSetBlock("locked"); return; }
  if (hustles.length === 0) { shSetBlock("empty"); return; }
  SH_HUSTLES = hustles;

  const myHustle = me.sideHustle;
  const current = myHustle && hustles.find(h => h.id === myHustle.hustleId);
  const request = me.sideHustleRequest;
  const hasPendingRequest = !!(request && request.status === "pending");

  const state = !current ? "pick" : (SH_MODE_REQUEST ? "request" : "active");
  shSetBlock(state);

  if (state === "pick" || state === "request") {
    const intro = sh("shPickIntro");
    if (intro) intro.textContent = state === "pick"
      ? "Compare every side hustle below, then tap the pay for the hustle and hour you want. You must check in within 15 minutes after your chosen hour to get paid."
      : "Tap the pay for the hustle and hour you want to switch to. Your teacher has to approve the change before it applies, and your current hustle keeps working until they do.";
    const saveBtn = sh("shSaveBtn");
    if (saveBtn) saveBtn.textContent = state === "pick" ? "Save my side hustle" : "Request this change";
    const cancelBtn = sh("shCancelBtn");
    if (cancelBtn) cancelBtn.classList.toggle("hidden", state === "pick");
    if (SH_SEL && !hustles.some(h => h.id === SH_SEL.hustleId)) SH_SEL = null;
    shRenderPickChart(me, hustles);
    shUpdateConfirm();
    return;
  }

  // state === "active"
  const pendingNote = sh("shPendingNote");
  if (pendingNote) pendingNote.classList.toggle("hidden", !hasPendingRequest);
  if (hasPendingRequest) {
    const reqHustle = hustles.find(h => h.id === request.hustleId);
    const pendingText = sh("shPendingText");
    if (pendingText) pendingText.textContent =
      `Waiting on your teacher to approve your request to switch to ${reqHustle ? reqHustle.name : "a new hustle"} at ${hourLabel(request.checkinHour)}. Your current hustle still applies until then.`;
  }

  const denialEl = sh("shDenialNote");
  if (denialEl) {
    if (me.sideHustleDenialNote) {
      denialEl.classList.remove("hidden");
      denialEl.innerHTML = `<span class="badge coral">Change request denied</span> <span class="muted-small">${escapeHtml(me.sideHustleDenialNote)}</span>`;
    } else {
      denialEl.classList.add("hidden");
    }
  }

  const cmp = sh("shCompareChart");
  if (cmp) cmp.innerHTML = shChartHtml(hustles, myHustle, false);

  const nameEl = sh("shName"); if (nameEl) nameEl.textContent = current.name;
  const windowEl = sh("shWindow"); if (windowEl) windowEl.textContent = sideHustleWindowLabel(myHustle.checkinHour);
  const pay = Number(current.payouts[myHustle.checkinHour]) || 0;
  const payEl = sh("shPay"); if (payEl) payEl.textContent = fmtMoney(pay);

  const { hour, minute } = nzHourMinute();
  const inWindow = hour === myHustle.checkinHour && minute <= 15;
  const already = myHustle.lastCheckin === nzDateKey();
  const checkinBtn = sh("shCheckinBtn");
  if (checkinBtn) checkinBtn.disabled = !inWindow || already;
  const statusEl = sh("shStatus");
  if (statusEl) {
    if (already) statusEl.textContent = `You've checked in today. Streak: ${myHustle.streak || 0} day${(myHustle.streak || 0) === 1 ? "" : "s"}.`;
    else if (inWindow) statusEl.textContent = "You're in your check-in window. Go ahead!";
    else statusEl.textContent = `Come back at ${hourLabel(myHustle.checkinHour)} to check in.`;
  }
  const changeBtn = sh("shChangeBtn");
  if (changeBtn) changeBtn.classList.toggle("hidden", hasPendingRequest);
}

/* Pay chart: every hustle side by side, one row per check-in hour, so pay can be
   compared at a glance with nothing to select first. Hours nobody pays for are
   left out. selectable = students tap a pay amount to choose it (the picker);
   otherwise it's a read-only comparison (shown once they already have a hustle). */
function shChartHtml(hustles, mine, selectable) {
  const hours = [];
  for (let h = 0; h < 24; h++) if (hustles.some(x => Number((x.payouts || {})[h]) > 0)) hours.push(h);
  if (!hours.length) return `<p class="muted-small">Your teacher hasn't set any pay amounts yet.</p>`;
  const head = hustles.map(x => {
    const r = hustlePayRange(x.payouts);
    return `<th scope="col"><div class="sh-hname">${escapeHtml(x.name)}</div>
      <div class="sh-hrange">${r ? (r.min === r.max ? hustleMoney(r.max) : hustleMoney(r.min) + " to " + hustleMoney(r.max)) : "no pay set"}</div>
      ${x.description ? `<div class="sh-hdesc">${escapeHtml(x.description)}</div>` : ""}</th>`;
  }).join("");
  const rows = hours.map(h => {
    const pays = hustles.map(x => Number((x.payouts || {})[h]) || 0);
    const top = Math.max(...pays);
    const hasBest = pays.filter(p => p > 0).length > 1 && pays.some(p => p > 0 && p < top);
    const cells = hustles.map((x, i) => {
      const p = pays[i];
      if (!(p > 0)) return `<td><span class="sh-none">–</span></td>`;
      const cur = mine && mine.hustleId === x.id && Number(mine.checkinHour) === h;
      const cls = "sh-pay" + (hasBest && p === top ? " best" : "") + (cur ? " cur" : "") + (selectable ? "" : " ro");
      const label = `${x.name} at ${hourLabel(h)}: ${fmtMoney(p)}${cur ? " (your current choice)" : ""}`;
      return selectable
        ? `<td><button type="button" class="${cls}" data-hid="${escapeHtml(x.id)}" data-hr="${h}" aria-label="${escapeHtml(label)}">${hustleMoney(p)}</button></td>`
        : `<td><span class="${cls}" title="${escapeHtml(label)}">${hustleMoney(p)}</span></td>`;
    }).join("");
    return `<tr><th scope="row">${hourLabel(h)}</th>${cells}</tr>`;
  }).join("");
  const legend = [hustles.length > 1 ? `<span class="sh-key best"></span> best pay for that hour` : "", mine ? `<span class="sh-key cur"></span> your current choice` : ""].filter(Boolean).join(" &nbsp; ");
  return `<div class="sh-chart-scroll"><table class="sh-chart"><thead><tr><th scope="col" class="sh-corner">Check-in</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    ${legend ? `<p class="muted-small sh-legend">${legend}</p>` : ""}`;
}
function shRenderPickChart(me, hustles) {
  const wrap = sh("shChartWrap");
  if (!wrap) return;
  wrap.innerHTML = shChartHtml(hustles, me.sideHustle || null, true);
  wrap.onclick = ev => {
    const b = ev.target.closest && ev.target.closest(".sh-pay[data-hr]");
    if (!b) return;
    SH_SEL = { hustleId: b.getAttribute("data-hid"), hour: Number(b.getAttribute("data-hr")) };
    wrap.querySelectorAll(".sh-pay.sel").forEach(x => x.classList.remove("sel"));
    b.classList.add("sel");
    shUpdateConfirm();
  };
  if (SH_SEL) {
    const b = wrap.querySelector(`.sh-pay[data-hid="${SH_SEL.hustleId}"][data-hr="${SH_SEL.hour}"]`);
    if (b) b.classList.add("sel"); else SH_SEL = null;
  }
}
function shUpdateConfirm() {
  const preview = sh("shPayPreview"), save = sh("shSaveBtn");
  if (!preview || !save) return;
  const hustle = SH_SEL && SH_HUSTLES.find(h => h.id === SH_SEL.hustleId);
  if (!hustle) {
    preview.textContent = "Tap a pay amount above to choose that side hustle and check-in hour.";
    save.disabled = true;
    return;
  }
  const mine = SH_ME && SH_ME.sideHustle;
  const same = !!(mine && mine.hustleId === hustle.id && Number(mine.checkinHour) === SH_SEL.hour);
  preview.innerHTML = `<strong>${escapeHtml(hustle.name)}</strong> at <strong>${hourLabel(SH_SEL.hour)}</strong> pays <strong>${fmtMoney(Number(hustle.payouts[SH_SEL.hour]) || 0)}</strong> each day you check in.${same ? " This is already your hustle." : ""}`;
  save.disabled = same;
}

function shStartChangeRequest() {
  SH_MODE_REQUEST = true;
  render();
}

function shCancelPick() {
  SH_MODE_REQUEST = false;
  SH_SEL = null;
  const msg = sh("shPickMsg");
  if (msg) msg.textContent = "";
  render();
}

async function shSaveChoice() {
  const msg = sh("shPickMsg");
  if (!SH_SEL) { if (msg) msg.textContent = "Tap a pay amount in the table first."; return; }
  const hustleId = SH_SEL.hustleId, hour = SH_SEL.hour;
  if (msg) msg.textContent = "Saving...";
  const res = await requestSideHustleChange(CURRENT.username, CURRENT.classCode, hustleId, hour);
  if (!res.ok) { if (msg) msg.textContent = res.error; return; }
  if (msg) msg.textContent = res.pending ? "Request sent. Waiting on your teacher to approve it." : "";
  SH_MODE_REQUEST = false;
  SH_SEL = null;
  await render();
}

async function shDoCheckin() {
  const btn = sh("shCheckinBtn");
  if (btn) btn.disabled = true;
  const res = await checkinSideHustle(CURRENT.username, CURRENT.classCode);
  const statusEl = sh("shStatus");
  if (statusEl) {
    statusEl.textContent = res.ok
      ? `Checked in! +${fmtMoney(res.amount)}. Streak: ${res.streak} day${res.streak === 1 ? "" : "s"}.`
      : res.error;
  }
  await render();
}

async function openLifestyleBreakdown() {
  const modal = document.getElementById("lifestyleModal");
  const body = document.getElementById("lifestyleModalBody");
  body.innerHTML = `<p class="muted-small">Loading...</p>`;
  modal.classList.remove("hidden");

  const [breakdown, label, tier] = await Promise.all([
    lifestyleRatingBreakdown(CURRENT.username, CURRENT.classCode),
    lifestyleBandForStudent(CURRENT.username, CURRENT.classCode),
    lifestyleTierProgress(CURRENT.username, CURRENT.classCode)
  ]);

  document.getElementById("lifestyleModalTitle").innerHTML =
    icon("star", 20) + ` Lifestyle rating: ${breakdown.total}${label ? ": " + label : ""}`;

  if (breakdown.overridden) {
    body.innerHTML = `<p class="muted-small">Your teacher has set this score manually, so it isn't calculated from what you own. It's fixed at <strong>${breakdown.total}</strong> until they change or clear it.</p>`;
    return;
  }

  if (breakdown.items.length === 0) {
    body.innerHTML = nextTierHtml(tier) + `<p class="muted-small">Nothing is affecting your score yet. Property, a vehicle, store items, or insurance can raise it.</p>`;
    return;
  }

  // Collapse repeats of the exact same line (same label/detail/type, e.g.
  // several identical "Pot Plants" store items) into one row with a "xN"
  // count and the points summed, instead of listing each copy separately.
  const groupItems = arr => {
    const grouped = [];
    const byKey = new Map();
    arr.forEach(i => {
      const key = i.type + "|" + i.label + "|" + i.detail;
      if (byKey.has(key)) {
        const g = byKey.get(key);
        g.count += 1;
        g.points += i.points;
      } else {
        const g = { ...i, count: 1 };
        byKey.set(key, g);
        grouped.push(g);
      }
    });
    return grouped;
  };

  const gains = groupItems(breakdown.items.filter(i => i.type === "gain"));
  const losses = groupItems(breakdown.items.filter(i => i.type === "loss"));
  const rows = arr => arr.length
    ? arr.map(i => `
        <div class="auto-row">
          <div class="auto-details">${escapeHtml(i.label)}${i.count > 1 ? ` &times;${i.count}` : ""}<div class="muted-small">${escapeHtml(i.detail)}</div></div>
          <div class="${i.type === "gain" ? "status-approved" : "status-declined"}">${i.type === "gain" ? "+" : "-"}${i.points}</div>
        </div>
      `).join("")
    : `<p class="muted-small">None right now.</p>`;

  body.innerHTML = `
    ${nextTierHtml(tier)}
    <div class="grid grid-2" style="align-items:start;">
      <div>
        <h4>${icon("star", 14)} Adding to your score</h4>
        ${rows(gains)}
      </div>
      <div>
        <h4>${icon("coin", 14)} Taking away from your score</h4>
        ${rows(losses)}
      </div>
    </div>
  `;
}

// Renders the "what do I need for the next tier" block shown at the bottom
// of the lifestyle breakdown modal. `tier` comes from lifestyleTierProgress
// and is null when the class has no lifestyle bands configured at all, in
// which case this renders nothing.
function nextTierHtml(tier) {
  if (!tier) return "";
  if (tier.atTop) {
    return `
      <div style="margin-bottom:18px;padding-bottom:14px;border-bottom:1.5px solid var(--line);">
        <h4>${icon("briefcase", 14)} Next tier</h4>
        <p class="muted-small">You're already at the top tier${tier.currentLabel ? `: <strong>${tier.currentLabel}</strong>` : ""}. Nothing more needed!</p>
      </div>
    `;
  }
  const needs = [];
  if (tier.pointsNeeded > 0) needs.push(`${tier.pointsNeeded} more lifestyle point${tier.pointsNeeded === 1 ? "" : "s"}`);
  if (tier.netWorthNeeded > 0) needs.push(`${fmtMoney(tier.netWorthNeeded)} more net worth`);
  if (tier.propertyComfortNeeded > 0) needs.push(`${tier.propertyComfortNeeded} more property comfort`);
  if (tier.transportComfortNeeded > 0) needs.push(`${tier.transportComfortNeeded} more transport comfort`);
  return `
    <div style="margin-bottom:18px;padding-bottom:14px;border-bottom:1.5px solid var(--line);">
      <h4>${icon("briefcase", 14)} Next tier</h4>
      <p class="muted-small">To reach <strong>${tier.nextLabel}</strong>${tier.currentLabel ? ` from ${tier.currentLabel}` : ""}, you still need:</p>
      ${needs.length
        ? `<ul style="margin:6px 0 0 18px;padding:0;">${needs.map(n => `<li class="muted-small">${n}</li>`).join("")}</ul>`
        : `<p class="muted-small">You already meet the requirements. Your rating should update shortly.</p>`}
    </div>
  `;
}

function closeLifestyleBreakdown() {
  document.getElementById("lifestyleModal").classList.add("hidden");
}

// Settings (gear icon), Dark Mode, Sidebar Navigation, and Change password
// are all handled by the shared settings-menu.js popover + the data layer's
// openPasswordModal()/_pwBuildModal(), exactly like every other page.
// This page used to hardcode its own second copy of all of that — see the
// changelog / audit notes for why it was removed.

document.addEventListener("DOMContentLoaded", init);

/* ── Promotion popup ─────────────────────────────────────── */
async function checkAndShowPromotionPopup(username) {
  try {
    const promo = await checkPromotionNotification(username);
    if (promo) showPromotionPopup(promo);
  } catch (e) {}
}

function showPromotionPopup(promo) {
  const existing = document.getElementById("t29LevelupOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "t29LevelupOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(14,27,55,0.72);z-index:600;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div class="levelup-card-card">
      <div class="levelup-card-stars">✦ ✦ ✦</div>
      <div class="levelup-card-emoji">🎉</div>
      <h2 class="levelup-card-title">You've been offered a promotion!</h2>
      <p class="levelup-card-sub">Move up to</p>
      <div class="levelup-card-tier">
        <div class="levelup-card-tier-name">${promo.tierName}</div>
        <div class="levelup-card-tier-meta">${promo.jobTitle} &middot; ${typeof fmtMoney === "function" ? fmtMoney(promo.wage) : "$" + promo.wage}/pay day</div>
      </div>
      <div class="levelup-card-actions">
        <button class="btn secondary" onclick="respondPromotionPopup(false)">Not right now</button>
        <button class="btn gold" onclick="respondPromotionPopup(true)">🎉 Accept</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function respondPromotionPopup(accept) {
  const overlay = document.getElementById("t29LevelupOverlay");
  if (overlay) overlay.querySelectorAll("button").forEach(b => b.disabled = true);
  try {
    await respondToPromotion(CURRENT.username, accept);
  } catch (e) {}
  if (overlay) overlay.remove();
  await render();
}

// ---- Dashboard bank preview: shows whichever account the student picks ----
// This choice is separate from the Bank page and the floating balance widget (its own storage key).
let bcLast = null;
const BC_KEY = "t29-dash-bank-acct";
function bcRateFor(me, cls, id) {
  if (id === "cash") return Number(cls.cashInterestRate) || 0;
  if (id === "savings") return Number(cls.interestRate) || 0;
  const a = acctActiveOf(me).find(x => x.id === id), p = a && acctPlanById(cls, a.planId);
  return p ? (Number(p.rate) || 0) : 0;
}
function bcChoice() {
  const { me, cls } = bcLast;
  const ch = anwOpenAccounts(me, cls);
  let saved = null;
  try { saved = localStorage.getItem(BC_KEY); } catch (e) {}
  const cur = ch.find(c => c.id === saved) || ch.find(c => c.id === "savings") || ch[0] || null;
  return { ch, cur };
}
function bcRenderAcct() {
  if (!bcLast) return;
  const { me, cls } = bcLast;
  const { ch, cur } = bcChoice();
  const card = document.getElementById("bcAcctCard"), chev = card.querySelector(".bc-chev");
  document.getElementById("bcAcctLabel").textContent = cur ? cur.label : "Balance";
  document.getElementById("bcSavingsBalance").textContent = fmtMoney(cur ? cur.bal : 0);
  document.getElementById("bcSavingsRate").textContent = (cur ? bcRateFor(me, cls, cur.id) : 0) + "%";
  card.style.cursor = ch.length > 1 ? "pointer" : "default";
  if (chev) chev.classList.toggle("hidden", ch.length < 2);
}
function bcOpenPicker() {
  if (!bcLast) return;
  const { me, cls } = bcLast;
  const { ch, cur } = bcChoice();
  if (ch.length < 2) return;
  const wrap = document.createElement("div");
  wrap.className = "t29-modal-backdrop";
  const close = () => wrap.remove();
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  wrap.innerHTML = `<div class="card" style="width:100%;max-width:420px;margin-top:0;">
    <div class="flex-between"><h2 style="margin-bottom:2px;">Choose an account</h2><button class="btn small secondary" type="button" data-close>Close</button></div>
    <div class="bc-opts">${ch.map(c => `<button type="button" class="bc-opt${cur && c.id === cur.id ? " active" : ""}" data-id="${escapeHtml(String(c.id))}">
      <span><strong>${escapeHtml(c.label)}</strong><span class="muted-small" style="display:block;">${bcRateFor(me, cls, c.id)}% interest</span></span>
      <span>${fmtMoney(c.bal)}</span></button>`).join("")}</div></div>`;
  wrap.querySelector("[data-close]").addEventListener("click", close);
  wrap.querySelectorAll(".bc-opt").forEach(b => b.addEventListener("click", () => {
    try { localStorage.setItem(BC_KEY, b.dataset.id); } catch (e) {}
    bcRenderAcct(); close();
  }));
  document.body.appendChild(wrap);
}
(function bcInitAcctPicker() {
  const init = () => {
    const card = document.getElementById("bcAcctCard");
    if (!card) return;
    card.addEventListener("click", bcOpenPicker);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bcOpenPicker(); } });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
