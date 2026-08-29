let CURRENT, IS_TEACHER, EDITING_AUTO_ID = null, EDITING_SAV_AUTO_ID = null;

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
  document.getElementById("hBudget").innerHTML = icon("calendar", 18) + " Your budget plan";
  document.getElementById("hBudFixed").innerHTML = icon("calendar", 15) + " Already committed";
  document.getElementById("hBudTrack").innerHTML = icon("repeat", 15) + " How this week is actually going";
  document.getElementById("labBudIncome").innerHTML = icon("coin", 13) + " What I expect to earn this week";
  document.getElementById("budSuggestBtn").innerHTML = icon("star", 14) + " Suggest a split";
  document.getElementById("hBudgetTeacher").innerHTML = icon("chart", 18) + " Who's budgeting this week";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
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
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  const T29_STARTUP_JOBS = Promise.all([
    safeBgJob(autoPayDayIfDue(u.classCode), "autoPayDayIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processLoanInterest(u.classCode), "processLoanInterest"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    safeBgJob(autoInterestIfDue(u.classCode), "autoInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
  ]);
  // Kick the day's jobs off but DON'T block the page on them: paint what
  // we already have first, then wait. On the first load of the day pay day
  // alone can take seconds (it writes per student), and blocking here is
  // what made a phone sit on a blank page. The popups and the final
  // render() below still run after the jobs, exactly as they did before.
  await t29FirstPaint(render);
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
  document.getElementById("budgetTeacherCard").classList.toggle("hidden", !IS_TEACHER);
  if (!IS_TEACHER) {
    document.getElementById("savingsBalance").textContent = fmtMoney(me.savings || 0);
    document.getElementById("savingsRateValue").textContent = (cls.interestRate || 0) + "%";
    document.getElementById("savingsRateNote").textContent =
      "Money in here earns interest at the rate below — it doesn't earn anything sitting in your cash balance unless your teacher has set a cash rate too. " + interestScheduleLabel(cls);
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
    ? recipients.map(r => `<option value="${r.username}">${r.label}</option>`).join("")
    : `<option value="">No one to pay yet</option>`;
  document.getElementById("toStudent").innerHTML = optsHtml;
  document.getElementById("autoTo").innerHTML = optsHtml;

  // automations
  const autos = await getStudentAutomations(me.classCode, me.username);
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
          ${a.note ? `<div class="muted-small">${a.note}</div>` : ""}
          ${a.lastRun ? `<div class="muted-small">Last ran: ${a.lastRun}</div>` : `<div class="muted-small">Not run yet</div>`}
        </div>
        <button class="btn small secondary" onclick='startEditSavAuto(${JSON.stringify(a).replace(/'/g, "&#39;")})'>Edit</button>
        <button class="btn small coral" onclick="removeAuto('${a.id}')">${icon("trash", 13)} Remove</button>
      `;
      listBox.appendChild(row);
      continue;
    }
    const toUser = await getUserCached(a.toUser);
    row.innerHTML = `
      <div class="auto-details">${icon("repeat", 14)} <strong>${fmtMoney(a.amount)}</strong> to <strong>${toUser ? toUser.name : a.toUser}</strong>
        &middot; ${DAY_LABEL[a.dayOfWeek] || a.dayOfWeek}, ${FREQ_LABEL[a.frequency] || a.frequency}
        ${a.note ? `<div class="muted-small">${a.note}</div>` : ""}
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
    .filter(t => t.to === me.username || t.from === me.username)
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
      "term-deposit-open": ["lilac", "vault", "Term deposit"], "term-deposit-early": ["coral", "vault", "Early withdrawal"],
      "term-deposit-mature": ["mint", "vault", "Deposit matured"],
      "gambling": ["gold", "dice", "Gambling"], "big-event": ["coral", "star", "Big event"],
      "insurance-claim": ["mint", "shield", "Insurance claim"], "insurance-premium": ["coral", "shield", "Premium"],
      "savings-deposit": ["mint", "piggy", "Savings deposit"], "savings-withdraw": ["gold", "piggy", "Savings withdrawal"],
      "loan-taken": ["navy", "vault", "Loan"], "loan-repayment": ["mint", "vault", "Loan repayment"],
      "loan-interest": ["coral", "handshake", "Loan interest"], "side-hustle": ["mint", "briefcase", "Side hustle"],
      "truck-drive": ["mint", "car", "Truck drive"], "property-rent": ["mint", "house", "Rent received"],
      "store-gift": ["mint", "cart", "Free item"], "quiz-reward": ["mint", "idcard", "Quiz passed"],
      "p2p-buy": ["navy", "users", "Bought from a classmate"], "p2p-sell": ["gold", "users", "Sold to a classmate"]
    };
    const [c, ic, label] = map[type] || ["navy", "coin", type];
    return `<span class="badge ${c}">${icon(ic, 12)}${label}</span>`;
  };
  my.forEach(t => {
    let detail = t.note || "";
    let sign = "";
    if (t.type === "transfer" || t.type === "automation") {
      if (t.from === me.username) { detail = "To " + nameOf(t.to) + (t.note ? " — " + t.note : (t.type === "automation" ? " — automatic payment" : "")); sign = "-"; }
      else { detail = "From " + nameOf(t.from) + (t.note ? " — " + t.note : (t.type === "automation" ? " — automatic payment" : "")); sign = "+"; }
    } else if (t.type === "stock-buy") { sign = "-"; }
    else if (["stock-sell", "stock-close", "wage", "interest", "cash-interest", "bonus", "welcome", "property-sell", "vehicle-sell", "store-sell", "term-deposit-mature", "term-deposit-early", "insurance-claim", "side-hustle", "truck-drive", "property-rent", "store-gift", "quiz-reward", "p2p-sell"].includes(t.type)) { sign = "+"; }
    else if (["fine", "insurance-buy", "store-buy", "mortgage", "vehicle-buy", "term-deposit-open", "insurance-premium", "savings-deposit", "loan-repayment", "loan-interest", "p2p-buy"].includes(t.type)) { sign = "-"; }
    else if (["savings-withdraw", "loan-taken"].includes(t.type)) { sign = "+"; }
    else if (t.type === "property-buy") { sign = "-"; }

    let amtDisplay;
    if (t.type === "event") {
      sign = t.amount < 0 ? "-" : "+";
      amtDisplay = fmtMoney(Math.abs(t.amount));
    } else if (t.type === "gambling") {
      sign = t.note.includes("WON") ? "+" : "-";
      amtDisplay = fmtMoney(t.amount);
    } else if (t.type === "big-event") {
      sign = t.amount > 0 ? "-" : "";
      amtDisplay = fmtMoney(t.amount);
    } else {
      amtDisplay = fmtMoney(t.amount);
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted-small">${t.date}</td><td>${badgeType(t.type)}</td><td>${detail}</td>
      <td class="${sign === '-' ? 'ticker-down' : 'ticker-up'}">${sign}${amtDisplay}</td>`;
    tbody.appendChild(tr);
  });
}

async function sendMoney(e) {
  e.preventDefault();
  const to = document.getElementById("toStudent").value;
  const amount = Number(document.getElementById("amount").value);
  const note = document.getElementById("note").value.trim();
  const box = document.getElementById("sendMsg");
  if (!to) { box.innerHTML = `<div class="error-msg">There's no one to send money to yet.</div>`; return false; }
  if (Number.isNaN(amount) || amount === 0) { box.innerHTML = `<div class="error-msg">Enter an amount.</div>`; return false; }
  if (!IS_TEACHER && amount < 0) { box.innerHTML = `<div class="error-msg">Enter an amount greater than zero.</div>`; return false; }

  // A teacher entering a negative amount is deducting from the student,
  // not "sending" them money — there's no one to credit it to on the
  // teacher's side (their balance is unlimited), so this goes through the
  // same balance-adjustment path as the "Give a bonus or fine" tool
  // instead of the peer-to-peer transfer path.
  const res = (IS_TEACHER && amount < 0)
    ? await teacherAdjust(CURRENT.username, to, amount, note)
    : await transferMoney(CURRENT.username, to, amount, note);

  if (res.ok) {
    box.innerHTML = amount < 0
      ? `<div class="success-msg">Deducted ${fmtMoney(Math.abs(amount))}.</div>`
      : `<div class="success-msg">Sent ${fmtMoney(amount)}!</div>`;
    document.getElementById("amount").value = "";
    document.getElementById("note").value = "";
  } else {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
  }
  await render();
  return false;
}

async function addAuto(e) {
  e.preventDefault();
  const day = document.getElementById("autoDay").value;
  const freq = document.getElementById("autoFreq").value;
  const amount = document.getElementById("autoAmount").value;
  const to = document.getElementById("autoTo").value;
  const note = document.getElementById("autoNote").value.trim();
  const box = document.getElementById("autoMsg");
  if (!to) { box.innerHTML = `<div class="error-msg">There's no one to pay yet.</div>`; return false; }
  const res = EDITING_AUTO_ID
    ? await editAutomation(CURRENT.classCode, EDITING_AUTO_ID, CURRENT.username, day, freq, amount, to, note)
    : await addAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, to, note);
  if (res.ok) {
    box.innerHTML = `<div class="success-msg">${EDITING_AUTO_ID ? "Automatic payment updated!" : "Automatic payment created!"}</div>`;
    cancelEditAuto();
  } else {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
  }
  await render();
  return false;
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
  const amount = Number(document.getElementById("depositAmount").value);
  const box = document.getElementById("savingsMsg");
  const res = await depositToSavings(CURRENT.username, amount);
  box.innerHTML = res.ok ? `<div class="success-msg">Deposited ${fmtMoney(amount)} into savings!</div>` : `<div class="error-msg">${res.error}</div>`;
  if (res.ok) document.getElementById("depositAmount").value = "";
  await render();
  return false;
}

async function withdrawSavings(e) {
  e.preventDefault();
  const amount = Number(document.getElementById("withdrawAmount").value);
  const box = document.getElementById("savingsMsg");
  const res = await withdrawFromSavings(CURRENT.username, amount);
  box.innerHTML = res.ok ? `<div class="success-msg">Withdrew ${fmtMoney(amount)} back to cash.</div>` : `<div class="error-msg">${res.error}</div>`;
  if (res.ok) document.getElementById("withdrawAmount").value = "";
  await render();
  return false;
}

async function addSavingsAuto(e) {
  e.preventDefault();
  const direction = document.getElementById("savAutoDirection").value;
  const day = document.getElementById("savAutoDay").value;
  const freq = document.getElementById("savAutoFreq").value;
  const amount = document.getElementById("savAutoAmount").value;
  const note = document.getElementById("savAutoNote").value.trim();
  const box = document.getElementById("savAutoMsg");
  const res = EDITING_SAV_AUTO_ID
    ? await editSavingsAutomation(CURRENT.classCode, EDITING_SAV_AUTO_ID, CURRENT.username, day, freq, amount, direction, note)
    : await addSavingsAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, direction, note);
  if (res.ok) {
    box.innerHTML = `<div class="success-msg">${EDITING_SAV_AUTO_ID ? "Automatic transfer updated!" : "Automatic transfer created!"}</div>`;
    cancelEditSavAuto();
  } else {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
  }
  await render();
  return false;
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

/* ---------------- Budgeting tool ----------------
   All the arithmetic lives in data.js (buildBudgetView and friends); this
   is only the rendering and the form handling. BUDGET_VIEW keeps the last
   built view around so the live "you've allocated X of Y" readout can
   recalculate as the student types, without touching the database or
   re-rendering the whole page under their cursor. */
let BUDGET_VIEW = null;

function budEsc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// "Week of 25 Aug – 31 Aug", from the Monday date key the week starts on.
function budWeekLabel(startKey) {
  const [y, m, d] = startKey.split("-").map(Number);
  const fmt = new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", day: "numeric", month: "short" });
  return "Week of " + fmt.format(new Date(Date.UTC(y, m - 1, d))) +
         " – " + fmt.format(new Date(Date.UTC(y, m - 1, d + 6)));
}

function budInputValue(key) {
  const el = document.getElementById("budAmt-" + key);
  const n = Number(el ? el.value : 0);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function budIncomeValue() {
  const n = Number(document.getElementById("budIncome").value);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

// $12.34 stays as-is; -$12.34 for a loss, rather than fmtMoney's bare "$-12.34".
function fmtSigned(n) {
  const v = Number(n) || 0;
  return (v < 0 ? "-" : "") + fmtMoney(Math.abs(v));
}

function renderBudgetStudent(me, cls) {
  const v = buildBudgetView(cls, me, CURRENT.username);
  BUDGET_VIEW = v;

  document.getElementById("budWeek").textContent = budWeekLabel(v.weekStartKey);

  /* ---- The one-line verdict ---- */
  const verdict = (tone, ic, text) =>
    `<div class="bud-verdict ${tone}">${icon(ic, 19)}<span>${text}</span></div>`;
  let verdictHtml;
  if (!v.plan.hasPlan) {
    verdictHtml = verdict("warn", "calendar",
      "You haven't set up a plan yet. Put in what you expect to earn, split it three ways, and save — it'll keep using those numbers every week until you change them.");
  } else if (!v.covered) {
    verdictHtml = verdict("bad", "shield",
      `Your plan doesn't cover what you already owe. Your fixed costs are ${fmtMoney(v.fixed.total)} this week but you've only set aside ${fmtMoney(v.plan.allocations.needs)} for them.`);
  } else {
    const over = v.rows.filter(r => r.over && r.planned > 0);
    if (over.length) {
      verdictHtml = verdict("warn", "chart",
        `You're over your plan on ${over.map(r => r.label).join(" and ")}. Nothing's broken — but the rest of the week has to come from somewhere.`);
    } else if (v.fixed.total > 0) {
      verdictHtml = verdict("good", "trophy",
        `Your plan covers the ${fmtMoney(v.fixed.total)} you owe this week, and you're inside it so far.`);
    } else {
      verdictHtml = verdict("good", "trophy",
        "Nothing is locked in this week, so it's all yours to allocate — and you're inside your plan so far.");
    }
  }
  document.getElementById("budVerdict").innerHTML = verdictHtml;

  /* ---- The detailed notes (loan interest, insurance, saving rate, stock
     moves, overspending) — one small card each, instead of burying all of
     this inside the single verdict line above. */
  document.getElementById("budNotes").innerHTML = v.notes.map(n =>
    `<div class="bud-note ${n.tone}">${icon(n.icon, 16)}<span>${n.text}</span></div>`).join("");

  /* ---- Expected income ---- */
  document.getElementById("budIncome").value = v.plan.hasPlan ? v.plan.plannedIncome : (Math.max(0, v.estimate.total) || "");
  const hint = document.getElementById("budIncomeHint");
  hint.innerHTML = v.estimate.items.length
    ? "Based on " + v.estimate.items.map(i => `${budEsc(i.label)} ${i.signed ? fmtSigned(i.amount) : fmtMoney(i.amount)}`).join(" + ") +
      ` = <strong>${fmtSigned(v.estimate.total)}</strong>. Change it if you think this week will be different.` +
      (v.plan.hasPlan ? ` <button type="button" class="bud-estimate-link" onclick="budgetUseEstimate()">Use this figure instead</button>` : "")
    : "You don't have a job or any regular income yet, so there's nothing to estimate from — put in what you think you'll make.";

  /* ---- The three category boxes ---- */
  document.getElementById("budRows").innerHTML = v.rows.map(r => `
    <div class="bud-cat ${r.key}">
      <div class="bud-cat-head">
        <span class="bud-cat-icon">${icon(r.icon, 17)}</span>
        <div class="bud-cat-text">
          <div class="bud-cat-name">${r.label}</div>
          <div class="bud-cat-blurb">${budEsc(r.blurb)}</div>
        </div>
      </div>
      <div class="bud-cat-input">
        <div class="bud-money-field">
          <span class="bud-currency">$</span>
          <input id="budAmt-${r.key}" type="number" min="0" step="0.01" inputmode="decimal"
                 value="${r.planned || ""}" oninput="budgetRecalc()" aria-label="${r.label} amount">
        </div>
        <span class="bud-cat-pct" id="budPct-${r.key}"></span>
      </div>
    </div>`).join("");

  document.getElementById("budClearBtn").classList.toggle("hidden", !v.plan.hasPlan);
  document.getElementById("budSaveBtn").innerHTML =
    icon(v.plan.hasPlan ? "repeat" : "plus", 15) + (v.plan.hasPlan ? " Update my plan" : " Save my plan");

  /* ---- What's already committed ---- */
  const fixedBox = document.getElementById("budFixedList");
  document.getElementById("noBudFixed").classList.toggle("hidden", v.fixed.items.length > 0);
  fixedBox.innerHTML = v.fixed.items.map(i => `
    <div class="bud-fix-row${i.settled ? " settled" : ""}${i.overdue ? " overdue" : ""}">
      <span class="bud-fix-icon">${icon(i.overdue ? "star" : i.settled ? "trophy" : i.icon, 14)}</span>
      <div class="bud-fix-text">
        <div class="bud-fix-label">${budEsc(i.label)}</div>
        <div class="bud-fix-note">${i.overdue ? "Overdue — " : ""}${budEsc(i.note)}${i.auto ? " · runs by itself" : ""}</div>
      </div>
      <div class="bud-fix-amt">${fmtMoney(i.amount)}</div>
    </div>`).join("");
  document.getElementById("budFixedTotal").innerHTML = v.fixed.items.length
    ? `<span>Still to pay this week</span><span>${fmtMoney(v.fixed.total)}</span>`
    : "";

  /* ---- Plan vs what actually happened ---- */
  const track = document.getElementById("budTrack");
  track.classList.toggle("hidden", !v.plan.hasPlan && v.actuals.total <= 0);
  document.getElementById("budTrackRows").innerHTML = v.rows.map(r => {
    // With no plan to measure against, the bar shows each category's share
    // of what's been spent so far instead of a meaningless 0% of $0.
    const denom = r.planned > 0 ? r.planned : Math.max(v.actuals.total, r.spent);
    const pct = denom > 0 ? Math.min(100, (r.spent / denom) * 100) : 0;
    return `
    <div class="bud-track-row">
      <div class="bud-track-head">
        <span class="bud-track-name">${r.label}</span>
        <span class="bud-track-nums${r.over ? " over" : ""}">
          <strong>${fmtMoney(r.spent)}</strong>${r.planned > 0 ? ` of ${fmtMoney(r.planned)}` : " so far"}
          ${r.planned > 0 ? (r.over ? ` · ${fmtMoney(Math.round((r.spent - r.planned) * 100) / 100)} over` : ` · ${fmtMoney(r.left)} left`) : ""}
        </span>
      </div>
      <div class="bud-track-bar"><div class="bud-track-fill ${r.over ? "over" : r.key}" style="width:${pct}%;"></div></div>
    </div>`;
  }).join("");
  document.getElementById("budTrackNote").textContent = v.actuals.count === 0
    ? "Nothing has moved yet this week — this fills in as you spend."
    : `From ${v.actuals.count} ${v.actuals.count === 1 ? "transaction" : "transactions"} since Monday. Money you've moved into savings counts as saved, not spent.`;

  budgetRecalc();
}

// Live readout under the three boxes. Runs on every keystroke, so it only
// ever reads the inputs — never the database, and never re-renders.
function budgetRecalc() {
  if (!BUDGET_VIEW) return;
  const income = budIncomeValue();
  let allocated = 0;
  BUDGET_CATEGORIES.forEach(c => {
    const v = budInputValue(c.key);
    allocated += v;
    const pctEl = document.getElementById("budPct-" + c.key);
    if (pctEl) pctEl.textContent = income > 0 ? Math.round((v / income) * 100) + "% of income" : "";
  });
  allocated = Math.round(allocated * 100) / 100;
  const left = Math.round((income - allocated) * 100) / 100;
  const box = document.getElementById("budTotals");
  box.classList.toggle("over", left < -0.005);
  box.classList.toggle("exact", Math.abs(left) <= 0.005 && income > 0);
  box.innerHTML = income <= 0
    ? `<span>Put in what you expect to earn to start splitting it up.</span>`
    : `<span class="bud-total-left">${fmtMoney(Math.abs(left))} ${left < -0.005 ? "over" : left <= 0.005 ? "— all allocated" : "left to allocate"}</span>
       <span>${fmtMoney(allocated)} of ${fmtMoney(income)} given a job</span>`;
}

// Pulls today's estimate (job + rent + side hustle + stock market moves)
// straight into the income field, for a student whose plan is carrying over
// from an earlier week but whose numbers — a share price move, a new side
// hustle — have since changed.
function budgetUseEstimate() {
  if (!BUDGET_VIEW) return;
  document.getElementById("budIncome").value = BUDGET_VIEW.estimate.total > 0 ? BUDGET_VIEW.estimate.total : "";
  budgetRecalc();
}

// Fills all three at once, but nudged: if fixed costs are bigger than the
// 50% Needs guide, Needs gets what it actually needs and the rest is split
// between Wants and Savings in their usual 30:20 ratio. A student whose
// mortgage eats 70% of their pay should be shown that, not handed a
// textbook split that doesn't fit their situation.
function budgetSuggest() {
  const income = budIncomeValue();
  if (income <= 0) {
    document.getElementById("budMsg").innerHTML = `<div class="error-msg">Put in what you expect to earn first, then I can suggest a split.</div>`;
    return;
  }
  const fixed = BUDGET_VIEW ? BUDGET_VIEW.fixed.total : 0;
  const needs = Math.min(income, Math.max(Math.round(income * 0.5 * 100) / 100, fixed));
  const rest = Math.round((income - needs) * 100) / 100;
  const wants = Math.round(rest * 0.6 * 100) / 100; // 30:20 of what's left
  const savings = Math.round((rest - wants) * 100) / 100;
  document.getElementById("budAmt-needs").value = needs.toFixed(2);
  document.getElementById("budAmt-wants").value = wants.toFixed(2);
  document.getElementById("budAmt-savings").value = savings.toFixed(2);
  budgetRecalc();
  document.getElementById("budMsg").innerHTML = `<div class="success-msg">${
    fixed > income * 0.5
      ? `Needs is set to ${fmtMoney(needs)} because that's what you actually owe this week — more than the 50% the guide suggests. The rest is split 30:20. Change any of it before you save.`
      : "Split 50/30/20. Change any of it before you save — it's your plan."
  }</div>`;
}

async function saveBudgetPlan(e) {
  e.preventDefault();
  const box = document.getElementById("budMsg");
  const allocations = {};
  BUDGET_CATEGORIES.forEach(c => { allocations[c.key] = budInputValue(c.key); });
  const btn = document.getElementById("budSaveBtn");
  btn.disabled = true;
  const res = await saveBudget(CURRENT.username, budIncomeValue(), allocations);
  btn.disabled = false;
  box.innerHTML = res.ok
    ? `<div class="success-msg">Plan saved for this week.</div>`
    : `<div class="error-msg">${res.error}</div>`;
  if (res.ok) await render();
  return false;
}

async function budgetClear() {
  if (!confirm("Clear this week's plan and start again?")) return;
  await clearBudget(CURRENT.username);
  document.getElementById("budMsg").innerHTML = "";
  await render();
}

/* ---------------- Teacher: who's budgeting ---------------- */
function renderBudgetTeacher(cls, students) {
  document.getElementById("budWeekTeacher").textContent = budWeekLabel(budgetWeekStartKey());
  const rows = classBudgetOverviewFromData(cls, students.filter(s => s.role !== "teacher"));
  document.getElementById("noBudTeacher").classList.toggle("hidden", rows.length > 0);

  const planned = rows.filter(r => r.planned);
  const covering = planned.filter(r => r.covered);
  const savingPcts = planned.map(r => r.savingsPct).filter(p => p !== null);
  const avgSaving = savingPcts.length
    ? Math.round((savingPcts.reduce((a, b) => a + b, 0) / savingPcts.length) * 10) / 10 : null;

  document.getElementById("budTeacherStats").innerHTML = `
    <div class="stat sky"><span class="icon">${icon("idcard", 26)}</span>
      <div class="label">Planned this week</div>
      <div class="value">${planned.length}<span style="font-size:1rem;font-weight:700;"> / ${rows.length}</span></div></div>
    <div class="stat ${planned.length && covering.length === planned.length ? "mint" : "gold"}"><span class="icon">${icon("shield", 26)}</span>
      <div class="label">Plans that cover their costs</div>
      <div class="value">${covering.length}<span style="font-size:1rem;font-weight:700;"> / ${planned.length}</span></div></div>
    <div class="stat mint"><span class="icon">${icon("piggy", 26)}</span>
      <div class="label">Average share saved</div>
      <div class="value">${avgSaving === null ? "—" : avgSaving + "%"}</div></div>`;

  document.getElementById("budTeacherTable").innerHTML = rows.map(r => {
    // A plan "covers" the week when the Needs slice alone is at least the
    // fixed costs — money parked in Wants doesn't pay a mortgage.
    const flag = !r.planned
      ? `<span class="bud-flag none">No plan</span>`
      : r.covered ? `<span class="bud-flag ok">Covered</span>`
                  : `<span class="bud-flag short">${fmtMoney(Math.round((r.fixedTotal - r.needs) * 100) / 100)} short</span>`;
    return `<tr>
      <td><strong>${budEsc(r.name)}</strong></td>
      <td>${r.planned ? fmtMoney(r.income) : "—"}</td>
      <td>${r.fixedTotal > 0 ? fmtMoney(r.fixedTotal) : "—"}</td>
      <td>${r.planned ? fmtMoney(r.needs) + " " : ""}${flag}</td>
      <td>${r.savingsPct === null ? "—" : fmtMoney(r.savings) + " (" + r.savingsPct + "%)"}</td>
      <td class="${r.overspent ? "ticker-down" : ""}">${fmtMoney(r.spent)}${r.overspent ? " — over plan" : ""}</td>
    </tr>`;
  }).join("");
}

document.addEventListener("DOMContentLoaded", init);
