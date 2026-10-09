let CURRENT, IS_TEACHER, EDITING_AUTO_ID = null, EDITING_SAV_AUTO_ID = null;
// Students in the class as of the last render() — what a teacher's "All
// students" payment goes to.
let ALL_STUDENTS = [];

const FREQ_LABEL = { weekly: "every week", fortnightly: "every 2 weeks", monthly: "every 4 weeks" };
const DAY_LABEL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("piggy", 26) + " Bank Account";
  document.getElementById("iconBalance").innerHTML = icon("piggy", 30);
  document.getElementById("iconAuto").innerHTML = icon("repeat", 30);
  document.getElementById("hSend").innerHTML = icon("send", 18) + " Send money";
  document.getElementById("hNewAuto").innerHTML = icon("calendar", 18) + " Set up an automatic payment";
  document.getElementById("hAutoList").innerHTML = icon("repeat", 18) + " My automatic payments";
  document.getElementById("hActivity").innerHTML = icon("bank", 18) + (IS_TEACHER ? " My recent activity" : " My recent activity (last 3 days)");
  document.getElementById("labTo").innerHTML = icon("users", 13) + " Send to";
  document.getElementById("labAmount").innerHTML = icon("coin", 13) + (IS_TEACHER ? " Amount (negative to deduct from a student)" : " Amount");
  document.getElementById("labNote").innerHTML = icon("star", 13) + " What's it for?";
  document.getElementById("sendBtn").innerHTML = icon("send", 15) + " Send";
  if (IS_TEACHER) {
    const amtInput = document.getElementById("amount");
    amtInput.removeAttribute("min");
    amtInput.step = "0.01";
  }
  document.getElementById("labAutoDay").innerHTML = icon("calendar", 13) + " Day of the week";
  document.getElementById("labAutoFreq").innerHTML = icon("repeat", 13) + " How often";
  document.getElementById("labAutoAmount").innerHTML = icon("coin", 13) + " Amount";
  document.getElementById("labAutoTo").innerHTML = icon("users", 13) + " Pay to";
  document.getElementById("labAutoNote").innerHTML = icon("star", 13) + " Reference / what's it for?";
  document.getElementById("addAutoBtn").innerHTML = icon("plus", 15) + " Create automatic payment";
  document.getElementById("hSavings").innerHTML = icon("piggy", 18) + " Savings account";
  document.getElementById("iconSavings").innerHTML = icon("piggy", 26);
  document.getElementById("iconSavingsRate").innerHTML = icon("percent", 26);
  document.getElementById("labDeposit").innerHTML = icon("piggy", 13) + " Deposit into savings";
  document.getElementById("labWithdraw").innerHTML = icon("send", 13) + " Withdraw back to cash";
  document.getElementById("depositBtn").innerHTML = icon("plus", 15) + " Deposit";
  document.getElementById("withdrawBtn").innerHTML = icon("send", 15) + " Withdraw";
  document.getElementById("labSavAutoDirection").innerHTML = icon("repeat", 13) + " Direction";
  document.getElementById("labSavAutoDay").innerHTML = icon("calendar", 13) + " Day of the week";
  document.getElementById("labSavAutoFreq").innerHTML = icon("repeat", 13) + " How often";
  document.getElementById("labSavAutoAmount").innerHTML = icon("coin", 13) + " Amount";
  document.getElementById("labSavAutoNote").innerHTML = icon("star", 13) + " Note (optional)";
  document.getElementById("addSavAutoBtn").innerHTML = icon("plus", 15) + " Create automatic transfer";
  document.getElementById("hBudget").innerHTML = icon("calendar", 18) + " My budget";
  document.getElementById("hBudPlan").innerHTML = icon("piggy", 15) + " My plan";
  document.getElementById("hBudTrack").innerHTML = icon("chart", 15) + " How this week is going";
  document.getElementById("hBudDays").innerHTML = icon("calendar", 15) + " Day by day";
  document.getElementById("labBudSave").innerHTML = icon("piggy", 13) + " How much will I save each week?";
  document.getElementById("hBudgetTeacher").innerHTML = icon("chart", 18) + " Students' budgets this week";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = IS_TEACHER ? "Dashboard" : "My account";
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
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    // Teacher sessions can write every student's doc, so they still run
    // the full class-wide sweep (and act as a safety net for anyone who
    // hasn't opened anything yet). A student session only ever pays
    // their OWN interest — see the big comment above these two functions
    // in data-core.js for why a student's login can't safely pay classmates.
    safeBgJob(IS_TEACHER ? applyInterestToClassIfDue(u.classCode) : applyMyInterestIfDue(u.username), "autoInterest"),
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

  document.getElementById("balance").textContent = IS_TEACHER ? "Unlimited ∞" : fmtMoney(me.balance);
  const cashRateNote = document.getElementById("cashRateNote");
  const cashRate = cls.cashInterestRate || 0;
  cashRateNote.classList.toggle("hidden", IS_TEACHER || cashRate <= 0);
  if (!IS_TEACHER && cashRate > 0) cashRateNote.textContent = `Earning ${cashRate}% interest. ${interestScheduleLabel(cls)}`;

  document.getElementById("savingsCard").classList.toggle("hidden", IS_TEACHER);
  document.getElementById("budgetCard").classList.toggle("hidden", IS_TEACHER);
  document.getElementById("goalsCard").classList.toggle("hidden", IS_TEACHER);
  document.getElementById("budgetTeacherCard").classList.toggle("hidden", !IS_TEACHER);
  if (!IS_TEACHER) {
    document.getElementById("savingsBalance").textContent = fmtMoney(me.savings || 0);
    document.getElementById("savingsRateValue").textContent = (cls.interestRate || 0) + "%";
    document.getElementById("savingsRateNote").textContent =
      "Money in here earns interest at the rate below — it doesn't earn anything sitting in your cash balance unless your teacher has set a cash rate too. " + interestScheduleLabel(cls);
    renderGoals(me); // see savings-goals.js
  }

  // Fetch the class roster once and reuse it for both the recipients
  // dropdown and the transaction-history name lookup below — these used
  // to each independently call getClassStudents(), which batches one
  // Firestore read PER STUDENT, so every render() (including after every
  // send/deposit/withdraw/automation action) read the whole class twice.
  const allStudents = await getClassStudents(me.classCode, cls);

  // The budgeting tool is pure arithmetic over `cls` and `me` (plus the
  // roster, for the teacher's overview) — all already in hand — so it
  // renders here without a single extra read.
  if (IS_TEACHER) renderBudgetTeacher(cls, allStudents);
  else renderBudgetStudent(me, cls);

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
    if (a.type === "savings-transfer") {
      const dirLabel = a.direction === "toSavings" ? "Cash → Savings" : "Savings → Cash";
      row.innerHTML = `
        <div class="auto-details">${icon("repeat", 14)} <strong>${fmtMoney(a.amount)}</strong> ${dirLabel}
          &middot; ${DAY_LABEL[a.dayOfWeek] || a.dayOfWeek}, ${FREQ_LABEL[a.frequency] || a.frequency}
          ${a.note ? `<div class="muted-small">${escapeHtml(a.note)}</div>` : ""}
          ${a.lastRun ? `<div class="muted-small">Last ran: ${a.lastRun}</div>` : `<div class="muted-small">Not run yet</div>`}
        </div>
        <button class="btn small secondary" onclick='startEditSavAuto(${JSON.stringify(a).replace(/'/g, "&#39;")})'>Edit</button>
        <button class="btn small coral" onclick="removeAuto('${a.id}')">${icon("trash", 13)} Remove</button>
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
      <div class="auto-details">${icon("repeat", 14)} <strong>${fmtMoney(a.amount)}</strong> to <strong>${toLabel}</strong>
        &middot; ${DAY_LABEL[a.dayOfWeek] || a.dayOfWeek}, ${FREQ_LABEL[a.frequency] || a.frequency}
        ${a.note ? `<div class="muted-small">${escapeHtml(a.note)}</div>` : ""}
        ${a.lastRun ? `<div class="muted-small">Last paid: ${a.lastRun}</div>` : `<div class="muted-small">Not run yet</div>`}
      </div>
      <button class="btn small secondary" onclick='startEditAuto(${JSON.stringify(a).replace(/'/g, "&#39;")})'>Edit</button>
      <button class="btn small coral" onclick="removeAuto('${a.id}')">${icon("trash", 13)} Remove</button>
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
      "mortgage": ["coral", "house", "Mortgage"], "event": ["lilac", "dice", "Random event"],
      "vehicle-buy": ["navy", "car", "Vehicle"], "vehicle-sell": ["gold", "car", "Vehicle sold"],
      "transport-expense": ["coral", "car", "Transport expenses"],
      "term-deposit-open": ["lilac", "vault", "Term deposit"], "term-deposit-early": ["coral", "vault", "Early withdrawal"],
      "term-deposit-mature": ["mint", "vault", "Deposit matured"],
      "gambling": ["gold", "dice", "Gambling"], "big-event": ["coral", "star", "Big event"],
      "insurance-claim": ["mint", "shield", "Insurance claim"], "insurance-premium": ["coral", "shield", "Premium"],
      "insurance-signup-fee": ["lilac", "shield", "Insurance sign-up"],
      "savings-deposit": ["mint", "piggy", "Savings deposit"], "savings-withdraw": ["gold", "piggy", "Savings withdrawal"],
      "loan-taken": ["navy", "vault", "Loan"], "loan-repayment": ["mint", "vault", "Loan repayment"],
      "loan-interest": ["coral", "handshake", "Loan interest"], "side-hustle": ["mint", "briefcase", "Side hustle"],
      "truck-drive": ["mint", "car", "Truck drive"], "truck-licence-buy": ["navy", "car", "Truck licence"],
      "property-rent": ["mint", "house", "Rent received"],
      "property-rent-pay": ["coral", "house", "Rent paid"], "property-rent-receive": ["mint", "house", "Rent received"],
      "property-occupancy": ["navy", "house", "Occupancy change"],
      "store-gift": ["mint", "cart", "Free item"], "quiz-reward": ["mint", "idcard", "Quiz passed"],
      "gambling-buyin": ["gold", "dice", "Gambling buy-in"], "gambling-cashout": ["mint", "dice", "Gambling cash-out"],
      "life-grant": ["gold", "trophy", "Life event"], "life-revoke": ["coral", "trophy", "Life event removed"],
      "life-allowance": ["mint", "trophy", "Life allowance"],
      "p2p-buy": ["navy", "users", "Bought from a classmate"], "p2p-sell": ["gold", "users", "Sold to a classmate"]
    };
    const [c, ic, label] = map[type] || ["navy", "coin", type];
    return `<span class="badge ${c}">${icon(ic, 12)}${label}</span>`;
  };
  my.forEach(t => {
    let detail = escapeHtml(t.note || "");
    let amt = t.amount;
    let sign = "";
    if (t.type === "transfer" || t.type === "automation") {
      if (t.from === me.username) { detail = "To " + escapeHtml(nameOf(t.to)) + (t.note ? " — " + escapeHtml(t.note) : (t.type === "automation" ? " — automatic payment" : "")); sign = "-"; }
      else { detail = "From " + escapeHtml(nameOf(t.from)) + (t.note ? " — " + escapeHtml(t.note) : (t.type === "automation" ? " — automatic payment" : "")); sign = "+"; }
    } else if (t.type === "stock-buy") { sign = "-"; }
    else if (["stock-sell", "stock-close", "wage", "interest", "cash-interest", "bonus", "welcome", "property-sell", "vehicle-sell", "store-sell", "term-deposit-mature", "term-deposit-early", "insurance-claim", "side-hustle", "truck-drive", "property-rent", "property-rent-receive", "store-gift", "quiz-reward", "p2p-sell", "gambling-cashout"].includes(t.type)) { sign = "+"; }
    else if (["fine", "insurance-buy", "store-buy", "mortgage", "property-rent-pay", "vehicle-buy", "transport-expense", "term-deposit-open", "insurance-premium", "insurance-signup-fee", "savings-deposit", "loan-repayment", "loan-interest", "p2p-buy", "truck-licence-buy", "gambling-buyin"].includes(t.type)) { sign = "-"; }
    else if (["savings-withdraw", "loan-taken"].includes(t.type)) { sign = "+"; }
    else if (t.type === "property-buy") { sign = "-"; }
    // Only the "moved in and paid a moving cost" entries of this type ever
    // carry a nonzero amount (see chargeMoveOrThrow) — the rest (renting a
    // property out, moving out, ending a lease) are just status notes with
    // nothing to sign.
    else if (t.type === "property-occupancy") { sign = amt > 0 ? (t.from === me.username ? "-" : "+") : ""; }
    else if (t.type === "life-grant") { sign = amt < 0 ? "-" : (amt > 0 ? "+" : ""); amt = Math.abs(amt); }
    else if (t.type === "life-allowance") { sign = "+"; }
    else if (t.type === "life-revoke") { sign = ""; }
    // A sale (or an insurance write-off) can go negative when the mortgage
    // left to pay off is more than the house fetched — that's money out.
    if (sign === "+" && amt < 0) { sign = "-"; amt = Math.abs(amt); }

    let amtDisplay;
    if (t.type === "event") {
      sign = t.amount < 0 ? "-" : "+";
      amtDisplay = fmtMoney(Math.abs(t.amount));
    } else if (t.type === "gambling") {
      sign = t.note.includes("WON") ? "+" : "-";
      amtDisplay = fmtMoney(t.amount);
    } else if (t.type === "big-event") {
      // BUGFIX: this used to read `sign = t.amount > 0 ? "-" : ""`, which
      // showed every big-event WINDFALL as a deduction. Unlike small
      // weekly events (which always log `to: student` and carry the
      // direction in the sign of `amount`), big events log a windfall as
      // `to: student` and a cost as `from: student`, both with a POSITIVE
      // amount — see processWeeklyBigEvents/resolveBigEvent in data-life.js.
      // So the direction has to come from to/from, exactly as
      // classifyTxnForReport already does for this type.
      sign = t.to === me.username ? "+" : (t.from === me.username ? "-" : "");
      amtDisplay = fmtMoney(Math.abs(t.amount));
    } else {
      amtDisplay = fmtMoney(amt);
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted-small">${t.date}</td><td>${badgeType(t.type)}</td><td>${detail}</td>
      <td class="${sign === '-' ? 'ticker-down' : 'ticker-up'}">${sign}${amtDisplay}</td>`;
    tbody.appendChild(tr);
  });
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
    const sendOne = username => (IS_TEACHER && amount < 0)
      ? teacherAdjust(CURRENT.username, username, amount, note)
      : transferMoney(CURRENT.username, username, amount, note);

    if (IS_TEACHER && to === AUTOPAY_ALL_STUDENTS) {
      const targets = ALL_STUDENTS.slice();
      if (!targets.length) { box.innerHTML = `<div class="error-msg">There are no students in this class yet.</div>`; return false; }
      if (!confirm(`${amount >= 0 ? "Send" : "Take"} ${fmtMoney(Math.abs(amount))} ${amount >= 0 ? "to" : "from"} each of your ${targets.length} students?`)) return false;
      // One at a time on purpose (same as Quick Transactions on the
      // Dashboard): every payment also writes to the class's activity log,
      // and firing them all at once risks one write clobbering another.
      let okCount = 0;
      const failedNames = [];
      for (const s of targets) {
        const r = await sendOne(s.username);
        if (r.ok) okCount++; else failedNames.push(s.name || s.username);
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
        : `<div class="success-msg">Sent ${fmtMoney(amount)}!</div>`;
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
    const box = document.getElementById("autoMsg");
    if (!to) { box.innerHTML = `<div class="error-msg">Choose who to pay.</div>`; return false; }
    let res = EDITING_AUTO_ID
      ? await editAutomation(CURRENT.classCode, EDITING_AUTO_ID, CURRENT.username, day, freq, amount, to, note)
      : await addAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, to, note);
    if (!res.ok && res.needsConfirm) {
      // Same amount/recipient/day/frequency already exists, but with a
      // different reference note — not a hard block, just a "are you sure"
      // in case they've forgotten about the one they already have.
      const already = res.existingNote
        ? ` It's labelled "${res.existingNote}".`
        : " It doesn't have a reference message.";
      const goAhead = confirm(`You already have an automatic payment set up for the same amount, recipient and day.${already}\n\nSet up this one too?`);
      if (goAhead) {
        res = EDITING_AUTO_ID
          ? await editAutomation(CURRENT.classCode, EDITING_AUTO_ID, CURRENT.username, day, freq, amount, to, note, true)
          : await addAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, to, note, true);
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
  document.getElementById("hNewAuto").innerHTML = icon("calendar", 18) + " Edit automatic payment";
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
  document.getElementById("hNewAuto").innerHTML = icon("calendar", 18) + " Set up an automatic payment";
  document.getElementById("addAutoBtn").innerHTML = icon("plus", 15) + " Create automatic payment";
  document.getElementById("cancelAutoEditBtn").classList.add("hidden");
}

async function removeAuto(id) {
  if (confirm("Remove this automatic payment?")) {
    await removeAutomation(CURRENT.classCode, id);
    if (EDITING_AUTO_ID === id) cancelEditAuto();
    if (EDITING_SAV_AUTO_ID === id) cancelEditSavAuto();
    await render();
  }
}

async function depositSavings(e) {
  e.preventDefault();
  // Same guard as sendMoney above.
  const btn = document.getElementById("depositBtn");
  if (btn.disabled) return false;
  btn.disabled = true;
  try {
    const amount = Number(document.getElementById("depositAmount").value);
    const box = document.getElementById("savingsMsg");
    const res = await depositToSavings(CURRENT.username, amount);
    box.innerHTML = res.ok ? `<div class="success-msg">Deposited ${fmtMoney(amount)} into savings!</div>` : `<div class="error-msg">${res.error}</div>`;
    if (res.ok) document.getElementById("depositAmount").value = "";
    await render();
    return false;
  } finally {
    btn.disabled = false;
  }
}

async function withdrawSavings(e) {
  e.preventDefault();
  // Same guard as sendMoney above.
  const btn = document.getElementById("withdrawBtn");
  if (btn.disabled) return false;
  btn.disabled = true;
  try {
    const amount = Number(document.getElementById("withdrawAmount").value);
    const box = document.getElementById("savingsMsg");
    const res = await withdrawFromSavings(CURRENT.username, amount);
    box.innerHTML = res.ok ? `<div class="success-msg">Withdrew ${fmtMoney(amount)} back to cash.</div>` : `<div class="error-msg">${res.error}</div>`;
    if (res.ok) document.getElementById("withdrawAmount").value = "";
    await render();
    return false;
  } finally {
    btn.disabled = false;
  }
}

async function addSavingsAuto(e) {
  e.preventDefault();
  // Same double-submit guard as addAuto() above.
  const btn = document.getElementById("addSavAutoBtn");
  if (btn.disabled) return false;
  btn.disabled = true;
  try {
    const direction = document.getElementById("savAutoDirection").value;
    const day = document.getElementById("savAutoDay").value;
    const freq = document.getElementById("savAutoFreq").value;
    const amount = document.getElementById("savAutoAmount").value;
    const note = document.getElementById("savAutoNote").value.trim();
    const box = document.getElementById("savAutoMsg");
    let res = EDITING_SAV_AUTO_ID
      ? await editSavingsAutomation(CURRENT.classCode, EDITING_SAV_AUTO_ID, CURRENT.username, day, freq, amount, direction, note)
      : await addSavingsAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, direction, note);
    if (!res.ok && res.needsConfirm) {
      // Same "are you sure" step as addAuto() above — same amount,
      // direction and day already exists, but with a different note.
      const already = res.existingNote
        ? ` It's labelled "${res.existingNote}".`
        : " It doesn't have a note.";
      const goAhead = confirm(`You already have an automatic transfer set up for the same amount, direction and day.${already}\n\nSet up this one too?`);
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
  document.getElementById("savAutoDirection").value = a.direction;
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
  document.getElementById("addSavAutoBtn").innerHTML = icon("plus", 15) + " Create automatic transfer";
  document.getElementById("cancelSavAutoEditBtn").classList.add("hidden");
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
  document.getElementById("budWeek").textContent = budWeekLabel(v.weekStartKey);

  /* ---- The three numbers ---- */
  const tile = (cls2, ic, label, value, sub) => `
    <div class="bud-tile ${cls2}">
      <div class="bud-tile-label">${icon(ic, 14)}<span>${label}</span></div>
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
        v.billsLeft > 0 ? `${fmtMoney(v.billsLeft)} still to pay this week` : "Every bill is paid — nice work")
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
        : savedOk ? "Goal reached for this week" : `${fmtMoney(v.saveTarget - v.actual.saved)} to go — move it into Savings below`));
  } else {
    rows.push(row("Spending", `<strong>${fmtMoney(v.spent)}</strong> so far`, null, "", spendSub));
    rows.push(row("Saved", `<strong>${fmtSigned(v.actual.saved)}</strong> so far`, null, "",
      v.actual.saved < 0 ? "You took more out of savings than you put in this week" : "Savings, term deposits and shares, minus anything taken back out"));
  }
  document.getElementById("budTrackRows").innerHTML = rows.join("");

  // How much can be spent right now without a bill bouncing — counting
  // savings as able to cover bills, once moved into cash.
  const keep = Math.round((v.cash - v.safeNow) * 100) / 100;
  const byDay = !v.lowestDay ? "" : v.lowestDay === v.todayKey ? " today" : ` by ${budDateLabel(v.lowestDay, { day: undefined, month: undefined })}`;
  const fromSav = v.safeFromSavings > 0.005 ? `move ${fmtMoney(v.safeFromSavings)} from savings into cash${byDay}` : "";
  let safeWhy;
  if (v.cash < 0) safeWhy = "Your cash is below $0, so there's nothing safe to spend.";
  else if (v.shortfall && !v.shortfall.covered) safeWhy = "This week's bills are more than your cash and savings put together, so there's nothing safe to spend.";
  else if (v.safeReason === "plan") safeWhy = "That's what's left of your plan's spending money this week." + (fromSav ? ` Your bills will still need you to ${fromSav}.` : "");
  else if (v.safeReason === "bills" && (keep > 0.005 || fromSav)) {
    safeWhy = keep > 0.005
      ? `Keep ${fmtMoney(keep)} in cash for bills later this week${fromSav ? `, and ${fromSav}` : byDay}.`
      : `Your bills later this week will need you to ${fromSav}.`;
  } else safeWhy = v.billsLeft > 0 ? "The money coming in covers the rest of this week's bills." : "No more bills this week.";
  document.getElementById("budSafe").innerHTML = `
    <div class="bud-safe-label">${icon("shield", 14)} Safe to spend right now</div>
    <div class="bud-safe-value">${fmtMoney(v.safeNow)}</div>
    <div class="bud-safe-why">${budEsc(safeWhy)}</div>
    <div class="bud-safe-have"><span>Cash <strong>${fmtSigned(v.cash)}</strong></span><span>Savings <strong>${fmtMoney(v.savings)}</strong></span></div>`;

  /* ---- Day by day ---- */
  const itemRow = i => {
    const sign = i.dir === "in" || i.dir === "unsave" ? "+" : "−";
    const amtCls = i.dir === "in" || i.dir === "unsave" ? "in" : i.dir === "save" ? "save" : "out";
    const crossed = i.status === "missed" || i.status === "free";
    return `
      <div class="bud-row ${amtCls}${crossed ? " crossed" : ""}">
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
    html = `<span class="bud-warn">That's ${fmtMoney(s - left)} more than you have left after bills — it would have to come from cash you already have, leaving nothing to spend.</span>`;
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
  const res = await saveBudget(CURRENT.username, document.getElementById("budSave").value);
  btn.disabled = false;
  if (res.ok) {
    flashMsg(box, `<div class="success-msg">Plan saved — it keeps going every week until you change it.</div>`);
    await render();
  } else {
    box.innerHTML = `<div class="error-msg">${budEsc(res.error)}</div>`;
  }
  return false;
}

async function budgetClear() {
  if (!confirm("Clear your budget plan?")) return;
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
  const needHelp = rows.filter(r => r.status === "bounce" || r.status === "move" || r.status === "short" || r.status === "over");
  const stat = (tone, ic, label, value, of) => `
    <div class="stat ${tone}"><span class="icon">${icon(ic, 26)}</span>
      <div class="label">${label}</div>
      <div class="value">${value}${of !== undefined ? `<span style="font-size:1rem;font-weight:700;"> / ${of}</span>` : ""}</div></div>`;
  document.getElementById("budTeacherStats").innerHTML =
    stat("sky", "idcard", "Have a savings plan", planned.length, rows.length) +
    stat("mint", "trophy", "On track", onTrack.length, rows.length) +
    stat(needHelp.length ? "gold" : "mint", "shield", "Might need a hand", needHelp.length, rows.length);

  const FLAG = {
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
      <td class="${r.left < 0 ? "ticker-down" : ""}">${fmtSigned(r.left)}</td>
      <td>${r.planned ? fmtMoney(r.saveTarget) + " a week" : "—"}</td>
      <td class="${r.saved < 0 ? "ticker-down" : ""}">${fmtSigned(r.saved)}</td>
      <td>${fmtMoney(r.spent)}${r.planned ? ` <span class="muted-small">of ${fmtMoney(r.spendAllowed)}</span>` : ""}</td>
      <td>${FLAG[r.status]}</td>
    </tr>`).join("");
}

document.addEventListener("DOMContentLoaded", init);
