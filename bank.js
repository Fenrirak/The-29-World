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
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
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

  document.getElementById("balance").textContent = IS_TEACHER ? "Unlimited ∞" : fmtMoney(me.balance);
  const cashRateNote = document.getElementById("cashRateNote");
  const cashRate = cls.cashInterestRate || 0;
  cashRateNote.classList.toggle("hidden", IS_TEACHER || cashRate <= 0);
  if (!IS_TEACHER && cashRate > 0) cashRateNote.textContent = `Earning ${cashRate}% interest. ${interestScheduleLabel(cls)}`;

  document.getElementById("savingsCard").classList.toggle("hidden", IS_TEACHER);
  document.getElementById("goalsCard").classList.toggle("hidden", IS_TEACHER);
  if (!IS_TEACHER) {
    document.getElementById("savingsBalance").textContent = fmtMoney(me.savings || 0);
    document.getElementById("savingsRateValue").textContent = (cls.interestRate || 0) + "%";
    document.getElementById("savingsRateNote").textContent =
      "Money in here earns interest at the rate below — it doesn't earn anything sitting in your cash balance unless your teacher has set a cash rate too. " + interestScheduleLabel(cls);
    const intTax = t29TaxRate(cls, "interest");
    document.getElementById("savingsTaxNote").innerHTML = t29TaxNoteHtml(intTax ? `Interest is taxed at <strong>${t29TaxPct(intTax)}</strong> before it is paid to you.` : "");
    renderGoals(me); // see savings-goals.js
  }

  // Fetch the class roster once and reuse it for both the recipients
  // dropdown and the transaction-history name lookup below — these used
  // to each independently call getClassStudents(), which batches one
  // Firestore read PER STUDENT, so every render() (including after every
  // send/deposit/withdraw/automation action) read the whole class twice.
  const allStudents = await getClassStudents(me.classCode, cls);

  // Credit card: the stat tile up top, and the card section (see creditcard.js).
  const showCardStat = !IS_TEACHER && cardIsActive(me);
  document.getElementById("cardStat").classList.toggle("hidden", !showCardStat);
  document.getElementById("topStats").classList.toggle("grid-3", showCardStat);
  document.getElementById("topStats").classList.toggle("grid-2", !showCardStat);
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
      <div class="auto-details">${icon("repeat", 14)} <strong>${fmtMoney(a.amount)}</strong> to <strong>${toLabel}</strong>${a.useCard ? ` <span class="badge lilac">Credit card</span>` : ""}
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
      "mortgage": ["coral", "house", "Mortgage"], "mortgage-extra": ["coral", "house", "Extra mortgage payment"], "event": ["lilac", "dice", "Random event"],
      "vehicle-buy": ["navy", "car", "Vehicle"], "vehicle-sell": ["gold", "car", "Vehicle sold"],
      "transport-expense": ["coral", "car", "Transport expenses"],
      "term-deposit-open": ["lilac", "vault", "Term deposit"], "term-deposit-early": ["coral", "vault", "Early withdrawal"],
      "term-deposit-mature": ["mint", "vault", "Deposit matured"],
      "gambling": ["gold", "dice", "Gambling"], "big-event": ["coral", "star", "Big event"],
      "insurance-claim": ["mint", "shield", "Insurance claim"], "insurance-premium": ["coral", "shield", "Premium"],
      "insurance-signup-fee": ["lilac", "shield", "Insurance sign-up"],
      "savings-deposit": ["mint", "piggy", "Savings deposit"], "savings-withdraw": ["gold", "piggy", "Savings withdrawal"],
      "loan-taken": ["navy", "vault", "Loan"], "loan-repayment": ["mint", "vault", "Loan repayment"],
      "card-purchase": ["navy", "cards", "Card purchase"], "card-payment": ["mint", "cards", "Card payment"],
    "card-interest": ["coral", "cards", "Card interest"], "card-fee": ["coral", "cards", "Card fee"],
    "card-cashback": ["mint", "cards", "Cashback"], "card-statement": ["gold", "cards", "Statement"],
    "loan-interest": ["coral", "handshake", "Loan interest"], "side-hustle": ["mint", "briefcase", "Side hustle"],
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
    const sendOne = (username, silent) => (IS_TEACHER && amount < 0)
      ? teacherAdjust(CURRENT.username, username, amount, note)
      : transferMoney(CURRENT.username, username, amount, note, silent ? { silent: true } : undefined);

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
    // A credit card can only pay the teacher, never another student.
    const useCard = !!(document.getElementById("autoUseCard") && document.getElementById("autoUseCard").checked) && !!AUTO_CARD_CTX && to === AUTO_CARD_CTX.cls.teacher;
    const box = document.getElementById("autoMsg");
    if (!to) { box.innerHTML = `<div class="error-msg">Choose who to pay.</div>`; return false; }
    let res = EDITING_AUTO_ID
      ? await editAutomation(CURRENT.classCode, EDITING_AUTO_ID, CURRENT.username, day, freq, amount, to, note, false, useCard)
      : await addAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, to, note, false, useCard);
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
          ? await editAutomation(CURRENT.classCode, EDITING_AUTO_ID, CURRENT.username, day, freq, amount, to, note, true, useCard)
          : await addAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, to, note, true, useCard);
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
  { const c = document.getElementById("autoUseCard"); if (c) c.checked = !!a.useCard; }
  autoSyncCardRow();
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
  { const c = document.getElementById("autoUseCard"); if (c) c.checked = false; }
  autoSyncCardRow();
  document.getElementById("hNewAuto").innerHTML = icon("calendar", 18) + " Set up an automatic payment";
  document.getElementById("addAutoBtn").innerHTML = icon("plus", 15) + " Create automatic payment";
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
      const goAhead = await t29Confirm(`You already have an automatic transfer set up for the same amount, direction and day.${already}\n\nSet up this one too?`);
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

document.addEventListener("DOMContentLoaded", init);

// The "pay with my credit card" box on the automatic payment form only shows for
// payments to the teacher; a card can never pay another student.
var AUTO_CARD_CTX = null;
function autoSyncCardRow() {
  const row = document.getElementById("autoCardRow"), sel = document.getElementById("autoTo");
  if (!row || !AUTO_CARD_CTX) return;
  const { me, cls } = AUTO_CARD_CTX;
  const ok = !IS_TEACHER && cardIsActive(me) && !!sel && sel.value === cls.teacher;
  row.classList.toggle("hidden", !ok);
  if (!ok) { const c = document.getElementById("autoUseCard"); if (c) c.checked = false; }
}
