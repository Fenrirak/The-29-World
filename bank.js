let CURRENT, IS_TEACHER, EDITING_AUTO_ID = null, EDITING_SAV_AUTO_ID = null;
// Students in the class as of the last render() — what a teacher's "All
// students" payment goes to.
let ALL_STUDENTS = [];

const FREQ_LABEL = { weekly: "every week", fortnightly: "every 2 weeks", monthly: "every 4 weeks" };
const DAY_LABEL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("piggy", 26) + " Bank Account";
  document.getElementById("iconAuto").innerHTML = icon("repeat", 30);
  document.getElementById("iconCardStat").innerHTML = icon("creditcard", 30); // credit card tile: its own card icon (not the wallet)
  document.getElementById("hActivity").innerHTML = icon("bank", 18) + (IS_TEACHER ? " My recent activity" : " My recent activity (last 3 days)");
  if (IS_TEACHER) document.getElementById("labAmount").textContent = "Amount (negative to deduct from a student)";
  if (IS_TEACHER) {
    const amtInput = document.getElementById("amount");
    amtInput.removeAttribute("min");
    amtInput.step = "0.01";
  }
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
  enablePasswordToggles();
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
    // Teacher sessions can write every student's doc, so they still run
    // the full class-wide sweep (and act as a safety net for anyone who
    // hasn't opened anything yet). A student session only ever pays
    // their OWN interest — see the big comment above these two functions
    // in data-core.js for why a student's login can't safely pay classmates.
    safeBgJob(IS_TEACHER ? applyInterestToClassIfDue(u.classCode) : applyMyInterestIfDue(u.username), "autoInterest"),
    safeBgJob(IS_TEACHER ? kiwiSaverReturnsForClassIfDue(u.classCode) : applyMyKiwiSaverReturnsIfDue(u.username), "kiwiSaverReturns"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
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

// Everyone else in the class you can send money to / pay automatically —
// classmates plus the teacher, labelled clearly.
async function payableRecipients(precomputedStudents) {
  const cls = await getClassCached(CURRENT.classCode);
  const options = [];
  const students = precomputedStudents || await getClassStudents(CURRENT.classCode);
  students.forEach(s => {
    if (s.username === CURRENT.username) return;
    options.push({ username: s.username, label: s.name });
  });
  if (CURRENT.role !== "teacher") {
    const t = await getUserCached(cls.teacher);
    if (t) options.push({ username: t.username, label: t.name + " (Teacher)" });
  }
  return options;
}

async function render() {
  // getUserCached and getClassCached are independent reads — CURRENT.classCode
  // is already known without needing `me` first, so fetch both at once
  // instead of waiting on one before starting the other.
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);

  // The top tiles (one per account for students, the "Unlimited" tile for teachers) are painted by accounts.js.
  // A closed Cash / Savings account that money has landed in (e.g. a wage) is open again — see acctDefaultClosed().
  if (!IS_TEACHER && acctNeedsRevive(me)) {
    const revived = await acctReviveDefaults(me.username);
    if (revived.length) AC_NOTICE = `<div class="success-msg">Money arrived in your ${revived.map(id => id === "cash" ? "Cash balance" : "Savings Account").join(" and ")}, so ${revived.length > 1 ? "they are" : "it is"} open again.</div>`;
  }

  document.getElementById("goalsCard").classList.toggle("hidden", IS_TEACHER);
  document.getElementById("xferCard").classList.toggle("hidden", IS_TEACHER);
  if (!IS_TEACHER) renderGoals(me); // see savings-goals.js

  // Fetch the class roster once and reuse it for both the recipients
  // dropdown and the transaction-history name lookup below — these used
  // to each independently call getClassStudents(), which batches one
  // Firestore read PER STUDENT, so every render() (including after every
  // send/deposit/withdraw/automation action) read the whole class twice.
  const allStudents = await getClassStudents(me.classCode, cls);

  // Credit card: the stat tile up top, and the card section (see creditcard.js).
  const showCardStat = !IS_TEACHER && cardIsActive(me);
  document.getElementById("cardStat").classList.toggle("hidden", !showCardStat);
  renderSavingsSettings(cls); // teacher-only savings & interest settings (moved here from Class settings)
  renderBankAccounts(me, cls, allStudents); // the account tiles at the top, "My accounts" and "Open an account" (see accounts.js)
  if (showCardStat) {
    const cp = cardPlanById(cls, me.creditCard.planId);
    document.getElementById("cardOwing").textContent = fmtMoney(me.creditCard.balance || 0);
    {
      const earned = cp ? cardRewardOf(cp, me.creditCard.periodSpend || 0).total : 0;
      document.getElementById("cardStatNote").textContent = cp
        ? `${fmtMoney(cardAvailable(me.creditCard, cp))} available of ${fmtMoney(cp.limit)}` + (earned > 0 ? ` · ${fmtMoney(earned)} cashback earned so far` : "") : "";
    }
  }
  renderCreditCard(me, cls, allStudents);
  AUTO_CARD_CTX = { me, cls };
  renderXfer(me, cls); // the automatic-transfer menus

  const recipients = await payableRecipients(allStudents);
  const optsHtml = recipients.length
    ? recipients.map(r => `<option value="${escapeHtml(r.username)}">${escapeHtml(r.label)}</option>`).join("")
    : `<option value="">No one to pay yet</option>`;
  // Start on a blank "Choose who to pay" so nobody is picked by default —
  // it was too easy to send money to whoever happened to be first in the
  // list. Whatever was already picked survives a re-render (e.g. after a
  // failed payment); a successful one clears it again below.
  const choose = recipients.length ? `<option value="" disabled selected>Choose who to pay…</option>` : "";
  const keepPick = (id, html) => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = html;
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  };
  // Teachers get one extra option in both lists: everyone in the class at
  // once — the same amount to each student, as a one-off ("Send to") or
  // on a schedule (automatic payments).
  ALL_STUDENTS = allStudents;
  const allOptsHtml = (IS_TEACHER && allStudents.length)
    ? `<option value="${AUTOPAY_ALL_STUDENTS}">All students (${allStudents.length})</option>${optsHtml}`
    : optsHtml;
  keepPick("toStudent", choose + allOptsHtml);
  keepPick("autoTo", choose + allOptsHtml);
  autoSyncCardRow();

  // automations
  // Same list getStudentAutomations() returns, taken from the class doc
  // already loaded at the top of render() instead of reading it again.
  const autos = me.classCode === CURRENT.classCode
    ? (cls.automations || []).filter(a => a.studentUser === me.username)
    : await getStudentAutomations(me.classCode, me.username);
  document.getElementById("autoCount").textContent = autos.filter(a => a.active).length;
  const listBox = document.getElementById("autoList");
  document.getElementById("noAuto").classList.toggle("hidden", autos.length > 0);
  listBox.innerHTML = "";
  for (const a of autos) {
    const row = document.createElement("div");
    row.className = "auto-row";
    const accName = id => id === "cash" || id === "cashacct" ? (acctDefaultClosed(me, "cash") ? "" : "Cash balance") : acctNameOf(cls, me, id);
    if (a.type === "savings-transfer") {
      const e = autoEnds(a), fromN = accName(e.from), toN = accName(e.to);
      row.innerHTML = `
        <div class="auto-details"><strong>${fmtMoney(a.amount)}</strong> ${escapeHtml(fromN || "Closed account")} → ${escapeHtml(toN || "Closed account")}
          ${!fromN || !toN ? `<span class="badge coral">Account closed</span>` : ""}
          &middot; ${DAY_LABEL[a.dayOfWeek] || a.dayOfWeek}, ${FREQ_LABEL[a.frequency] || a.frequency}
          ${a.note ? `<div class="muted-small">${escapeHtml(a.note)}</div>` : ""}
          ${!fromN || !toN ? `<div class="muted-small">This can't run any more. Edit it to use another account, or remove it.</div>` : ""}
          ${a.lastRun ? `<div class="muted-small">Last ran: ${a.lastRun}</div>` : `<div class="muted-small">Not run yet</div>`}
        </div>
        <button class="btn small secondary" onclick='startEditSavAuto(${JSON.stringify(a).replace(/'/g, "&#39;")})'>Edit</button>
        <button class="btn small coral" onclick="removeAuto('${a.id}')">Remove</button>
      `;
      listBox.appendChild(row);
      continue;
    }
    let toLabel;
    if (a.toUser === AUTOPAY_ALL_STUDENTS) {
      toLabel = `All students (${allStudents.length})`;
    } else {
      const toUser = await getUserCached(a.toUser);
      toLabel = escapeHtml(toUser ? toUser.name : a.toUser);
    }
    row.innerHTML = `
      <div class="auto-details"><strong>${fmtMoney(a.amount)}</strong> to <strong>${toLabel}</strong>${autoSrcBadge(a, accName)}
        &middot; ${DAY_LABEL[a.dayOfWeek] || a.dayOfWeek}, ${FREQ_LABEL[a.frequency] || a.frequency}
        ${a.note ? `<div class="muted-small">${escapeHtml(a.note)}</div>` : ""}
        ${a.lastRun ? `<div class="muted-small">Last paid: ${a.lastRun}</div>` : `<div class="muted-small">Not run yet</div>`}
      </div>
      <button class="btn small secondary" onclick='startEditAuto(${JSON.stringify(a).replace(/'/g, "&#39;")})'>Edit</button>
      <button class="btn small coral" onclick="removeAuto('${a.id}')">Remove</button>
    `;
    listBox.appendChild(row);
  }

  // txns — students see the last 3 days only; the teacher's own bank
  // activity (rare, since their balance is unlimited) keeps full history.
  const activityCutoff = Date.now() - 3 * 24 * 3600 * 1000;
  const my = cls.txns
    .filter(t => txnBelongsTo(t, me.username))
    .filter(t => IS_TEACHER || t.ts === undefined || t.ts >= activityCutoff)
    .slice(0, IS_TEACHER ? 30 : 200);
  document.getElementById("noTxns").classList.toggle("hidden", IS_TEACHER || my.length > 0);
  const tbody = document.getElementById("txnTable");
  tbody.innerHTML = "";
  const nameCache = {};
  allStudents.forEach(s => { nameCache[s.username] = s.name; });
  const teacher = await getUserCached(cls.teacher);
  if (teacher) nameCache[teacher.username] = teacher.name;
  const nameOf = u => nameCache[u] || u;
  const badgeType = type => {
    const map = {
      welcome: ["navy", "star", "Welcome"], wage: ["mint", "briefcase", "Wage"],
      interest: ["gold", "piggy", "Savings interest"], "cash-interest": ["gold", "coin", "Cash interest"], bonus: ["mint", "star", "Bonus"],
      fine: ["coral", "coin", "Fine"], transfer: ["navy", "send", "Transfer"],
      automation: ["navy", "repeat", "Auto-pay"], "stock-buy": ["gold", "chart", "Stock buy"],
      "stock-sell": ["gold", "chart", "Stock sell"], "stock-close": ["gold", "building", "Delisted"],
      "insurance-buy": ["lilac", "shield", "Insurance"], "store-buy": ["mint", "cart", "Store"], "store-sell": ["gold", "cart", "Store sale"],
      "property-buy": ["navy", "house", "Property"], "property-sell": ["gold", "house", "Property sold"],
      "mortgage": ["coral", "house", "Mortgage"], "mortgage-extra": ["coral", "house", "Extra mortgage payment"], "event": ["lilac", "dice", "Random event"],
      "vehicle-buy": ["navy", "car", "Vehicle"], "vehicle-sell": ["gold", "car", "Vehicle sold"],
      "transport-expense": ["coral", "car", "Transport expenses"],
      "term-deposit-open": ["lilac", "vault", "Term deposit"], "term-deposit-early": ["coral", "vault", "Early withdrawal"],
      "term-deposit-mature": ["mint", "vault", "Deposit matured"],
      "gambling": ["gold", "dice", "Gambling"], "big-event": ["coral", "star", "Big event"],
      "insurance-claim": ["mint", "shield", "Insurance claim"], "insurance-premium": ["coral", "shield", "Premium"],
      "insurance-signup-fee": ["lilac", "shield", "Insurance sign-up"],
      "account-close": ["gold", "piggy", "Account closed"], "savings-deposit": ["mint", "piggy", "Savings deposit"], "savings-withdraw": ["gold", "piggy", "Savings withdrawal"],
      "loan-taken": ["navy", "vault", "Loan"], "loan-repayment": ["mint", "vault", "Loan repayment"],
      "card-purchase": ["navy", "cards", "Card purchase"], "card-payment": ["mint", "cards", "Card payment"],
    "card-interest": ["coral", "cards", "Card interest"], "card-fee": ["coral", "cards", "Card fee"], "account-fee": ["coral", "coin", "Account fee"],
    "card-cashback": ["mint", "cards", "Cashback"], "card-statement": ["gold", "cards", "Statement"],
    "loan-interest": ["coral", "loan", "Loan interest"], "side-hustle": ["mint", "briefcase", "Side hustle"],
      "truck-drive": ["mint", "car", "Truck drive"], "truck-licence-buy": ["navy", "car", "Truck licence"],
      "property-rent": ["mint", "house", "Rent received"],
      "property-rent-pay": ["coral", "house", "Rent paid"], "property-rent-receive": ["mint", "house", "Rent received"],
      "property-occupancy": ["navy", "house", "Occupancy change"],
      "store-gift": ["mint", "cart", "Free item"], "quiz-reward": ["mint", "idcard", "Quiz passed"],
      "gambling-buyin": ["gold", "dice", "Gambling buy-in"], "gambling-cashout": ["mint", "dice", "Gambling cash-out"],
      "life-grant": ["gold", "trophy", "Life event"], "life-revoke": ["coral", "trophy", "Life event removed"],
      "life-allowance": ["mint", "trophy", "Life allowance"],
      "p2p-buy": ["navy", "users", "Bought from a classmate"], "p2p-sell": ["gold", "users", "Sold to a classmate"],
      "kiwisaver-in": ["navy", "kiwi", "KiwiSaver"], "kiwisaver-out": ["mint", "kiwi", "KiwiSaver withdrawal"],
      "kiwisaver-refund": ["gold", "kiwi", "KiwiSaver refund"]
    };
    const [c, ic, label] = map[type] || ["navy", "coin", type];
    return `<span class="badge ${c}">${ic === "cards" ? "" : icon(ic, 12)}${label}</span>`;
  };
  my.forEach(t => {
    let detail = escapeHtml(t.note || "");
    if (t.type === "transfer" || t.type === "automation") {
      if (t.from === me.username) detail = "To " + escapeHtml(nameOf(t.to)) + (t.note ? " — " + escapeHtml(t.note) : (t.type === "automation" ? " — automatic payment" : ""));
      else detail = "From " + escapeHtml(nameOf(t.from)) + (t.note ? " — " + escapeHtml(t.note) : (t.type === "automation" ? " — automatic payment" : ""));
    }
    // Which way the money went — one shared answer for every page (see
    // txnDirection in data-money.js): green "+" in, red "−" out, plain when
    // it only moved between the student's own pockets.
    const { sign, amount } = txnDirection(t, me.username);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted-small">${t.date}</td><td>${badgeType(t.type)}</td><td>${detail}</td>
      <td class="${moneyClass(sign)}">${fmtSignedMoney(sign, amount)}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---------------- Teacher: savings & interest settings ----------------
   These used to sit under "Class settings" on the teacher dashboard. They live next to the savings accounts
   they control now. One Save button writes everything through saveInterestSettings() (data-money.js), which
   also tells students about rate / schedule changes. The accounts.js "recommended accounts" are sized from
   this schedule (see acPeriod). While there are unsaved edits, render() leaves the form alone so a
   background refresh can't wipe what the teacher is typing. */
const BS_FREQS = [["daily", "Every day", 1, "Daily"], ["weekly", "Every week", 7, "Weekly"], ["fortnightly", "Every 2 weeks", 14, "Fortnightly"], ["monthly", "Every 4 weeks", 28, "Every 4 weeks"]];
let BS_DIRTY = false;
const bsFreq = f => BS_FREQS.find(x => x[0] === f) || BS_FREQS[1];

function renderSavingsSettings(cls) {
  const el = document.getElementById("savingsSettingsCard");
  if (!el) return;
  el.classList.toggle("hidden", !IS_TEACHER);
  if (!IS_TEACHER || (BS_DIRTY && el.firstElementChild)) return;
  if (typeof acInjectCss === "function") acInjectCss();
  const auto = !!cls.interestAuto, freq = bsFreq(cls.interestFrequency)[0], day = cls.interestDay || "Fri";
  const rate = Number(cls.interestRate) || 0, cash = Number(cls.cashInterestRate) || 0;
  const num = (id, v) => `<div class="cc-num"><input id="${id}" type="number" min="0" max="20" step="0.1" inputmode="decimal" value="${v}" oninput="bsChanged()"></div>`;
  el.innerHTML = `
    <div class="flex-between cc-head"><h2 id="hSavingsSet">Savings &amp; interest</h2></div>
    <p class="cc-intro">Set what students earn on their <strong>Savings Account</strong> and how often interest is paid. Rates are a percentage applied <strong>each time interest runs</strong>, so a 1% rate paid every week is far more generous than 1% paid every 4 weeks. The recommended accounts below are sized to match.</p>
    <div class="cc-tstats bs-stats">
      <div class="cc-tstat"><span>Savings rate</span><strong>${rate}%</strong></div>
      <div class="cc-tstat"><span>Cash balance rate</span><strong>${cash}%</strong></div>
      <div class="cc-tstat"><span>Interest paid</span><strong>${auto ? bsFreq(freq)[3] : "By hand"}</strong></div>
    </div>
    <section class="cc-panel">
      <div class="cc-panel-head"><h3>${icon("percent", 16)} Interest rates</h3><span class="muted-small">Each time interest runs</span></div>
      <div class="cc-settings bs-set2">
        <div class="cc-set"><label for="bsRate">Savings interest rate (%)</label><p>Paid on every student's Savings Account.</p>
          ${num("bsRate", rate)}<div class="muted-small bs-hint" id="bsRateHint"></div></div>
        <div class="cc-set"><label for="bsCash">Cash balance interest rate (%)</label><p>Leave at 0 so only money moved into Savings earns interest.</p>
          ${num("bsCash", cash)}<div class="muted-small bs-hint" id="bsCashHint"></div></div>
      </div>
    </section>
    <section class="cc-panel">
      <div class="cc-panel-head"><h3>${icon("hourglass", 16)} Payout schedule</h3>
        <label class="cc-switch"><input type="checkbox" id="bsAuto" ${auto ? "checked" : ""} onchange="bsChanged()"><span class="cc-switch-track"></span><span id="bsAutoText">${auto ? "Paid automatically" : "Applied by you"}</span></label></div>
      <div class="cc-settings bs-set2 ${auto ? "" : "bs-off"}" id="bsSched">
        <div class="cc-set"><label for="bsFreq">How often</label><p>How long between interest payments.</p>
          <select id="bsFreq" onchange="bsChanged()" ${auto ? "" : "disabled"}>${BS_FREQS.map(f => `<option value="${f[0]}" ${f[0] === freq ? "selected" : ""}>${f[1]}</option>`).join("")}</select></div>
        <div class="cc-set ${freq === "daily" ? "hidden" : ""}" id="bsDayWrap"><label for="bsDay">On which day</label><p>The day of the week interest is paid.</p>
          <select id="bsDay" onchange="bsChanged()" ${auto ? "" : "disabled"}>${Object.keys(DAY_LABEL).map(d => `<option value="${d}" ${d === day ? "selected" : ""}>${DAY_LABEL[d]}</option>`).join("")}</select></div>
      </div>
      <p class="muted-small bs-tune">${icon("sparkle", 14)}<span>Accounts you add from the recommended list are personalised to this schedule: fees and withdrawal limits scale with how often interest is paid.</span></p>
    </section>
    <div class="bs-save"><button class="btn gold" id="bsSaveBtn" onclick="bsSave()">${icon("save", 15)} Save interest settings</button>
      <span class="muted-small">These settings are for the <strong>Default everyday</strong> and <strong>savings</strong> accounts. Students are told when rates or the schedule change.</span></div>
    <div id="bsMsg"></div>`;
  bsHints();
}
function bsHints() {
  const g = id => document.getElementById(id);
  if (!g("bsFreq")) return;
  const days = bsFreq(g("bsFreq").value)[2], auto = g("bsAuto").checked;
  // What the rate works out to per week, so rates are easy to compare between schedules
  const hint = id => {
    const v = Number(g(id === "bsRateHint" ? "bsRate" : "bsCash").value);
    g(id).textContent = auto && days !== 7 && v > 0 ? `About ${Math.round(v * 7 / days * 100) / 100}% a week.` : "";
  };
  hint("bsRateHint"); hint("bsCashHint");
}
function bsChanged() {
  BS_DIRTY = true;
  const g = id => document.getElementById(id);
  const auto = g("bsAuto").checked;
  g("bsAutoText").textContent = auto ? "Paid automatically" : "Applied by you";
  g("bsFreq").disabled = g("bsDay").disabled = !auto;
  g("bsSched").classList.toggle("bs-off", !auto);
  g("bsDayWrap").classList.toggle("hidden", g("bsFreq").value === "daily");
  bsHints();
}
async function bsSave() {
  const g = id => document.getElementById(id);
  const btn = g("bsSaveBtn");
  if (!btn || btn.disabled) return;
  const rateRaw = g("bsRate").value.trim(), cashRaw = g("bsCash").value.trim();
  const rate = Number(rateRaw), cashRate = Number(cashRaw);
  const bad = v => !isFinite(v) || v < 0 || v > 20;
  if (rateRaw === "" || cashRaw === "" || bad(rate) || bad(cashRate)) { acMsg("bsMsg", `<div class="error-msg">Enter rates between 0% and 20% (0 is fine).</div>`); return; }
  const next = { rate, cashRate, auto: g("bsAuto").checked, frequency: g("bsFreq").value, day: g("bsDay").value };
  btn.disabled = true;
  try {
    const old = (await getClass(CURRENT.classCode)) || {};
    await saveInterestSettings(CURRENT.classCode, next);
    BS_DIRTY = false;
    // Plans the teacher already added keep the fees they were created with — say so if the schedule changed
    const rescale = acPeriod(old).key !== acPeriod({ interestAuto: next.auto, interestFrequency: next.frequency }).key
      && (old.accountPlans || []).some(p => !p.archived && (p.fee > 0 || p.maxWithdrawals > 0));
    await render();
    acMsg("bsMsg", `<div class="success-msg">Saved.${rescale ? " Accounts you've already added keep their current fees and withdrawal limits — edit them below if they should change with the new schedule." : ""}</div>`);
  } catch (e) {
    acMsg("bsMsg", `<div class="error-msg">Couldn't save that — please try again.</div>`);
  } finally {
    btn.disabled = false;
  }
}

async function sendMoney(e) {
  e.preventDefault();
  // Same guard as addAuto below — arguably the single most important
  // place in the app for it: an unguarded double-tap here (a slow
  // connection plus an eager double-click, with nothing visibly changing
  // until the await resolves) sends the money twice.
  const btn = document.getElementById("sendBtn");
  if (btn.disabled) return false;
  btn.disabled = true;
  try {
    const to = document.getElementById("toStudent").value;
    const amount = Number(document.getElementById("amount").value);
    const note = document.getElementById("note").value.trim();
    const box = document.getElementById("sendMsg");
    if (!to) { box.innerHTML = `<div class="error-msg">Choose who to send the money to.</div>`; return false; }
    if (Number.isNaN(amount) || amount === 0) { box.innerHTML = `<div class="error-msg">Enter an amount.</div>`; return false; }
    if (!IS_TEACHER && amount < 0) { box.innerHTML = `<div class="error-msg">Enter an amount greater than zero.</div>`; return false; }

    // A teacher entering a negative amount is deducting from the student,
    // not "sending" them money — there's no one to credit it to on the
    // teacher's side (their balance is unlimited), so this goes through the
    // same balance-adjustment path as the "Give a bonus or fine" tool
    // instead of the peer-to-peer transfer path.
    // Students choose which account the money comes out of (cash, Savings Account, an extra account, or
    // their credit card for payments to the teacher). A teacher's balance is unlimited, so they always send from it.
    const src = IS_TEACHER ? "cash" : ((document.getElementById("sendFrom") || {}).value || "cash");
    const sendOne = (username, silent) => (IS_TEACHER && amount < 0)
      ? teacherAdjust(CURRENT.username, username, amount, note)
      : IS_TEACHER
        ? transferMoney(CURRENT.username, username, amount, note, silent ? { silent: true } : undefined)
        : sendMoneyFrom(CURRENT.username, username, amount, note, src);

    if (IS_TEACHER && to === AUTOPAY_ALL_STUDENTS) {
      const targets = ALL_STUDENTS.slice();
      if (!targets.length) { box.innerHTML = `<div class="error-msg">There are no students in this class yet.</div>`; return false; }
      if (!await t29Confirm(`${amount >= 0 ? "Send" : "Take"} ${fmtMoney(Math.abs(amount))} ${amount >= 0 ? "to" : "from"} each of your ${targets.length} students?`)) return false;
      // One at a time on purpose (same as Quick Transactions on the
      // Dashboard): every payment also writes to the class's activity log,
      // and firing them all at once risks one write clobbering another.
      let okCount = 0;
      const failedNames = [], paidUsers = [];
      for (const s of targets) {
        const r = await sendOne(s.username, true);
        if (r.ok) { okCount++; paidUsers.push(s.username); } else failedNames.push(s.name || s.username);
      }
      // One notice for everyone who was paid (not one class write per student). Deductions already pop up via teacherAdjust.
      if (amount > 0 && paidUsers.length) {
        await t29NotifyStudents(CURRENT.classCode, { to: paidUsers, icon: "coin", tone: "mint",
          title: `Your teacher sent you ${fmtMoney(amount)}`, body: note ? `Note: ${note}` : "It was added to your balance.", href: "bank.html" });
      }
      const verb = amount >= 0 ? "Sent" : "Deducted";
      if (okCount === targets.length) {
        box.innerHTML = `<div class="success-msg">${verb} ${fmtMoney(Math.abs(amount))} ${amount >= 0 ? "to" : "from"} all ${okCount} students!</div>`;
        document.getElementById("amount").value = "";
        document.getElementById("note").value = "";
        document.getElementById("toStudent").value = "";
      } else if (okCount > 0) {
        box.innerHTML = `<div class="error-msg">${verb} ${fmtMoney(Math.abs(amount))} for ${okCount} of ${targets.length} students. It didn't go through for: ${failedNames.map(escapeHtml).join(", ")}.</div>`;
      } else {
        box.innerHTML = `<div class="error-msg">That didn't go through for any students — please try again.</div>`;
      }
      await render();
      return false;
    }

    const res = await sendOne(to);

    if (res.ok) {
      box.innerHTML = amount < 0
        ? `<div class="success-msg">Deducted ${fmtMoney(Math.abs(amount))}.</div>`
        : `<div class="success-msg">Sent ${fmtMoney(amount)}!${res.fee > 0 ? ` ${escapeHtml(res.fromName)} charged a ${fmtMoney(res.fee)} withdrawal fee.` : ""}</div>`;
      document.getElementById("amount").value = "";
      document.getElementById("note").value = "";
      document.getElementById("toStudent").value = "";
    } else {
      box.innerHTML = `<div class="error-msg">${res.error}</div>`;
    }
    await render();
    return false;
  } finally {
    btn.disabled = false;
  }
}

async function addAuto(e) {
  e.preventDefault();
  // Disable the button for the duration of the request — without this, a
  // slow connection plus an eager double-tap (nothing visibly happens
  // until the await resolves) can fire this handler twice, creating two
  // near-identical automations that each later fire on their own and look
  // like the same auto-pay running more than once in a day.
  const btn = document.getElementById("addAutoBtn");
  if (btn.disabled) return false;
  btn.disabled = true;
  try {
    const day = document.getElementById("autoDay").value;
    const freq = document.getElementById("autoFreq").value;
    const amount = document.getElementById("autoAmount").value;
    const to = document.getElementById("autoTo").value;
    const note = document.getElementById("autoNote").value.trim();
    // Which account pays: "cash", "savings", an extra account's id, or "card" (credit cards only ever pay the teacher).
    const from = IS_TEACHER ? "cash" : ((document.getElementById("autoFrom") || {}).value || "cash");
    const useCard = from === "card";
    const box = document.getElementById("autoMsg");
    if (!to) { box.innerHTML = `<div class="error-msg">Choose who to pay.</div>`; return false; }
    if (useCard && !(AUTO_CARD_CTX && to === AUTO_CARD_CTX.cls.teacher)) { box.innerHTML = `<div class="error-msg">A credit card can only pay your teacher. Pick one of your accounts to pay your classmate.</div>`; return false; }
    let res = EDITING_AUTO_ID
      ? await editAutomation(CURRENT.classCode, EDITING_AUTO_ID, CURRENT.username, day, freq, amount, to, note, false, useCard, from)
      : await addAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, to, note, false, useCard, from);
    if (!res.ok && res.needsConfirm) {
      // Same amount/recipient/day/frequency already exists, but with a
      // different reference note — not a hard block, just a "are you sure"
      // in case they've forgotten about the one they already have.
      const already = res.existingNote
        ? ` It's labelled "${res.existingNote}".`
        : " It doesn't have a reference message.";
      const goAhead = await t29Confirm(`You already have an automatic payment set up for the same amount, recipient and day.${already}\n\nSet up this one too?`);
      if (goAhead) {
        res = EDITING_AUTO_ID
          ? await editAutomation(CURRENT.classCode, EDITING_AUTO_ID, CURRENT.username, day, freq, amount, to, note, true, useCard, from)
          : await addAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, to, note, true, useCard, from);
      } else {
        box.innerHTML = "";
        await render();
        return false;
      }
    }
    if (res.ok) {
      box.innerHTML = `<div class="success-msg">${EDITING_AUTO_ID ? "Automatic payment updated!" : "Automatic payment created!"}</div>`;
      cancelEditAuto();
    } else {
      box.innerHTML = `<div class="error-msg">${res.error}</div>`;
    }
    await render();
    return false;
  } finally {
    btn.disabled = false;
  }
}

function startEditAuto(a) {
  EDITING_AUTO_ID = a.id;
  document.getElementById("autoDay").value = a.dayOfWeek;
  document.getElementById("autoFreq").value = a.frequency;
  document.getElementById("autoAmount").value = a.amount;
  document.getElementById("autoTo").value = a.toUser;
  document.getElementById("autoNote").value = a.note || "";
  autoSyncCardRow();
  { const f = document.getElementById("autoFrom"); if (f) { f.value = autoSource(a); payWithChanged("autoFrom"); } }
  document.getElementById("hNewAuto").innerHTML = "Edit automatic payment";
  document.getElementById("addAutoBtn").innerHTML = "Save changes";
  document.getElementById("cancelAutoEditBtn").classList.remove("hidden");
  document.getElementById("autoMsg").innerHTML = "";
  document.getElementById("hNewAuto").scrollIntoView({ behavior: "smooth" });
}

function cancelEditAuto() {
  EDITING_AUTO_ID = null;
  document.getElementById("autoAmount").value = "";
  document.getElementById("autoNote").value = "";
  document.getElementById("autoTo").value = "";
  { const f = document.getElementById("autoFrom"); if (f) { f.value = "cash"; if (!f.value) f.selectedIndex = 0; } }
  autoSyncCardRow();
  document.getElementById("hNewAuto").innerHTML = "Set up an automatic payment";
  document.getElementById("addAutoBtn").innerHTML = "Create automatic payment";
  document.getElementById("cancelAutoEditBtn").classList.add("hidden");
}

async function removeAuto(id) {
  if (await t29Confirm("Remove this automatic payment?")) {
    await removeAutomation(CURRENT.classCode, id);
    if (EDITING_AUTO_ID === id) cancelEditAuto();
    if (EDITING_SAV_AUTO_ID === id) cancelEditSavAuto();
    await render();
  }
}

async function addSavingsAuto(e) {
  e.preventDefault();
  // Same double-submit guard as addAuto() above.
  const btn = document.getElementById("addSavAutoBtn");
  if (btn.disabled) return false;
  btn.disabled = true;
  try {
    const direction = { from: document.getElementById("xferFrom").value, to: document.getElementById("xferTo").value };
    const day = document.getElementById("savAutoDay").value;
    const freq = document.getElementById("savAutoFreq").value;
    const amount = document.getElementById("savAutoAmount").value;
    const note = document.getElementById("savAutoNote").value.trim();
    const box = document.getElementById("savAutoMsg");
    if (!direction.from || !direction.to || direction.from === direction.to) { box.innerHTML = `<div class="error-msg">Pick two different accounts.</div>`; return false; }
    let res = EDITING_SAV_AUTO_ID
      ? await editSavingsAutomation(CURRENT.classCode, EDITING_SAV_AUTO_ID, CURRENT.username, day, freq, amount, direction, note)
      : await addSavingsAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, direction, note);
    if (!res.ok && res.needsConfirm) {
      // Same "are you sure" step as addAuto() above — same amount,
      // direction and day already exists, but with a different note.
      const already = res.existingNote
        ? ` It's labelled "${res.existingNote}".`
        : " It doesn't have a note.";
      const goAhead = await t29Confirm(`You already have an automatic transfer set up for the same amount, accounts and day.${already}\n\nSet up this one too?`);
      if (goAhead) {
        res = EDITING_SAV_AUTO_ID
          ? await editSavingsAutomation(CURRENT.classCode, EDITING_SAV_AUTO_ID, CURRENT.username, day, freq, amount, direction, note, true)
          : await addSavingsAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, direction, note, true);
      } else {
        box.innerHTML = "";
        await render();
        return false;
      }
    }
    if (res.ok) {
      box.innerHTML = `<div class="success-msg">${EDITING_SAV_AUTO_ID ? "Automatic transfer updated!" : "Automatic transfer created!"}</div>`;
      cancelEditSavAuto();
    } else {
      box.innerHTML = `<div class="error-msg">${res.error}</div>`;
    }
    await render();
    return false;
  } finally {
    btn.disabled = false;
  }
}

function startEditSavAuto(a) {
  EDITING_SAV_AUTO_ID = a.id;
  { const e = autoEnds(a), f = document.getElementById("xferFrom"), t = document.getElementById("xferTo");
    f.value = e.from; t.value = e.to;
    if (!f.value) f.selectedIndex = 0; // an account that has since been closed
    if (!t.value || t.value === f.value) { const alt = [...t.options].find(o => o.value !== f.value); if (alt) t.value = alt.value; }
    xferHint(); }
  document.getElementById("savAutoDay").value = a.dayOfWeek;
  document.getElementById("savAutoFreq").value = a.frequency;
  document.getElementById("savAutoAmount").value = a.amount;
  document.getElementById("savAutoNote").value = a.note || "";
  document.getElementById("hSavingsAuto").innerHTML = "Edit automatic transfer";
  document.getElementById("addSavAutoBtn").innerHTML = "Save changes";
  document.getElementById("cancelSavAutoEditBtn").classList.remove("hidden");
  document.getElementById("savAutoMsg").innerHTML = "";
  document.getElementById("hSavingsAuto").scrollIntoView({ behavior: "smooth" });
}

function cancelEditSavAuto() {
  EDITING_SAV_AUTO_ID = null;
  document.getElementById("savAutoAmount").value = "";
  document.getElementById("savAutoNote").value = "";
  document.getElementById("hSavingsAuto").innerHTML = "Automatic transfer";
  document.getElementById("addSavAutoBtn").innerHTML = "Create automatic transfer";
  document.getElementById("cancelSavAutoEditBtn").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", init);

var AUTO_CARD_CTX = null;

/* ---------------- "Pay with" menus (Send money + automatic payments) ----------------
   Grouped into Everyday / Savings / Credit card. A credit card only ever pays the teacher, so that option is
   greyed out (with the reason) whenever someone else is picked, and the menu falls back to cash. */
function payWithOptionsHtml(me, cls, toUser) {
  // Payment sources: "cash" is the student's MAIN account (the default), "cashacct" the real Cash account when another is main.
  const ch = acctPaySources(me, cls);
  const opt = c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}${c.isMain && ch.length > 1 ? " (main)" : ""} — ${fmtMoney(c.bal)}</option>`;
  const group = (label, items) => items.length ? `<optgroup label="${label}">${items.map(opt).join("")}</optgroup>` : "";
  let html = group("Everyday", ch.filter(c => c.kind === "everyday")) + group("Savings", ch.filter(c => c.kind === "savings"));
  if (cardIsActive(me)) {
    const plan = cardPlanById(cls, me.creditCard.planId);
    if (plan) {
      const ok = toUser === cls.teacher;
      html += `<optgroup label="Credit card"><option value="card" ${ok ? "" : "disabled"}>Credit card — ${fmtMoney(cardAvailable(me.creditCard, plan))} available${ok ? "" : " (teacher payments only)"}</option></optgroup>`;
    }
  }
  return html;
}
function renderPayWith() {
  const ctx = AUTO_CARD_CTX;
  [["sendFrom", "toStudent"], ["autoFrom", "autoTo"]].forEach(([id, toId]) => {
    const row = document.getElementById(id + "Row"), sel = document.getElementById(id), toSel = document.getElementById(toId);
    if (!row || !sel) return;
    row.classList.toggle("hidden", IS_TEACHER || !ctx);
    if (IS_TEACHER || !ctx) return;
    const prev = sel.value || "cash";
    sel.innerHTML = payWithOptionsHtml(ctx.me, ctx.cls, toSel ? toSel.value : "");
    const keep = [...sel.options].find(o => o.value === prev && !o.disabled);
    // Back to cash when it's open, otherwise the first account that can pay (cash may be closed).
    const fallback = [...sel.options].find(o => o.value === "cash") || [...sel.options].find(o => !o.disabled);
    sel.value = keep ? prev : (fallback ? fallback.value : "");
    payWithChanged(id);
  });
}
function payWithChanged(id) {
  const hint = document.getElementById(id + "Hint"), sel = document.getElementById(id);
  if (!hint || !sel || !AUTO_CARD_CTX) return;
  const notes = typeof acSourceNotes === "function" ? acSourceNotes(AUTO_CARD_CTX.me, AUTO_CARD_CTX.cls, sel.value) : [];
  hint.innerHTML = notes.join(" ");
}
// Kept under its old name: the recipient menus call this when someone different is picked.
function autoSyncCardRow() { renderPayWith(); }

// A small badge on an automatic payment saying which account it comes out of (nothing for plain cash).
function autoSrcBadge(a, accName) {
  if (a.useCard) return ` <span class="badge lilac">Credit card</span>`;
  const src = autoSource(a);
  if (src === "cash") return "";
  const n = accName(src);
  return n ? ` <span class="badge navy">From ${escapeHtml(n)}</span>` : ` <span class="badge coral">Account closed</span>`;
}

/* ---------------- Automatic transfer menus (From / To) ---------------- */
function renderXfer(me, cls) {
  const f = document.getElementById("xferFrom"), t = document.getElementById("xferTo");
  if (!f || !t || IS_TEACHER) return;
  const ch = acChoicesWithKind(me, cls);
  const opts = ch.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)} — ${fmtMoney(c.bal)}</option>`).join("");
  const prevF = f.value || "cash", prevT = t.value || "savings", has = id => ch.some(c => c.id === id);
  f.innerHTML = opts; t.innerHTML = opts;
  f.value = has(prevF) ? prevF : (has("cash") ? "cash" : (ch[0] || {}).id);
  t.value = has(prevT) && prevT !== f.value ? prevT : (ch.find(c => c.id !== f.value) || {}).id;
  xferHint();
}
function xferChanged(which) {
  const f = document.getElementById("xferFrom"), t = document.getElementById("xferTo");
  if (f.value === t.value) { // the same account on both sides makes no sense — nudge the other menu
    const moved = which === "from" ? t : f, kept = which === "from" ? f : t;
    const alt = [...moved.options].find(o => o.value !== kept.value);
    if (alt) moved.value = alt.value;
  }
  xferHint();
}
function xferHint() {
  const el = document.getElementById("xferHint"), f = document.getElementById("xferFrom"), t = document.getElementById("xferTo");
  if (!el || !f || !t || !AUTO_CARD_CTX || typeof acSourceNotes !== "function") return;
  const { me, cls } = AUTO_CARD_CTX, notes = acSourceNotes(me, cls, f.value);
  if (acChoicesWithKind(me, cls).length < 2) notes.push("You need two open accounts to set up an automatic transfer.");
  const dst = acctActiveOf(me).find(a => a.id === t.value), dp = dst && acctPlanById(cls, dst.planId);
  if (dp && dp.maxBalance > 0) notes.push(`${escapeHtml(dp.name)} can hold up to ${fmtMoney(dp.maxBalance)}.`);
  el.innerHTML = notes.map(n => `<span>${n}</span>`).join("");
}
