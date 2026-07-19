let CURRENT, IS_TEACHER;

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
  await autoPayDayIfDue(u.classCode);
  await processAutomations(u.classCode);
  await processMortgages(u.classCode);
  await processTermDeposits(u.classCode);
  await autoInterestIfDue(u.classCode);
  await processInsurancePayments(u.classCode);
  await processWeeklyEvents(u.classCode);
  await processWeeklyBigEvents(u.classCode);
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

// Everyone else in the class you can send money to / pay automatically —
// classmates plus the teacher, labelled clearly.
async function payableRecipients() {
  const cls = await getClass(CURRENT.classCode);
  const options = [];
  const students = await getClassStudents(CURRENT.classCode);
  students.forEach(s => {
    if (s.username === CURRENT.username) return;
    options.push({ username: s.username, label: s.name });
  });
  if (CURRENT.role !== "teacher") {
    const t = await getUser(cls.teacher);
    if (t) options.push({ username: t.username, label: t.name + " (Teacher)" });
  }
  return options;
}

async function render() {
  const me = await getUser(CURRENT.username);
  const cls = await getClass(me.classCode);

  document.getElementById("balance").textContent = IS_TEACHER ? "Unlimited ∞" : fmtMoney(me.balance);

  document.getElementById("savingsCard").classList.toggle("hidden", IS_TEACHER);
  if (!IS_TEACHER) {
    document.getElementById("savingsBalance").textContent = fmtMoney(me.savings || 0);
    document.getElementById("savingsRateValue").textContent = (cls.interestRate || 0) + "%";
  }

  const recipients = await payableRecipients();
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
        <button class="btn small coral" onclick="removeAuto('${a.id}')">${icon("trash", 13)} Remove</button>
      `;
      listBox.appendChild(row);
      continue;
    }
    const toUser = await getUser(a.toUser);
    row.innerHTML = `
      <div class="auto-details">${icon("repeat", 14)} <strong>${fmtMoney(a.amount)}</strong> to <strong>${toUser ? toUser.name : a.toUser}</strong>
        &middot; ${DAY_LABEL[a.dayOfWeek] || a.dayOfWeek}, ${FREQ_LABEL[a.frequency] || a.frequency}
        ${a.note ? `<div class="muted-small">${a.note}</div>` : ""}
        ${a.lastRun ? `<div class="muted-small">Last paid: ${a.lastRun}</div>` : `<div class="muted-small">Not run yet</div>`}
      </div>
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
  const allStudents = await getClassStudents(me.classCode);
  const nameCache = {};
  allStudents.forEach(s => { nameCache[s.username] = s.name; });
  const teacher = await getUser(cls.teacher);
  if (teacher) nameCache[teacher.username] = teacher.name;
  const nameOf = u => nameCache[u] || u;
  const badgeType = type => {
    const map = {
      welcome: ["navy", "star", "Welcome"], wage: ["mint", "briefcase", "Wage"],
      interest: ["gold", "piggy", "Interest"], bonus: ["mint", "star", "Bonus"],
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
      "loan-taken": ["navy", "vault", "Loan"], "loan-repayment": ["mint", "vault", "Loan repayment"]
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
    else if (["stock-sell", "stock-close", "wage", "interest", "bonus", "welcome", "property-sell", "vehicle-sell", "store-sell", "term-deposit-mature", "term-deposit-early", "insurance-claim"].includes(t.type)) { sign = "+"; }
    else if (["fine", "insurance-buy", "store-buy", "mortgage", "vehicle-buy", "term-deposit-open", "insurance-premium", "savings-deposit", "loan-repayment"].includes(t.type)) { sign = "-"; }
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
  const res = await addAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, to, note);
  if (res.ok) {
    box.innerHTML = `<div class="success-msg">Automatic payment created!</div>`;
    document.getElementById("autoAmount").value = "";
    document.getElementById("autoNote").value = "";
  } else {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
  }
  await render();
  return false;
}

async function removeAuto(id) {
  if (confirm("Remove this automatic payment?")) {
    await removeAutomation(CURRENT.classCode, id);
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
  const res = await addSavingsAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, direction, note);
  if (res.ok) {
    box.innerHTML = `<div class="success-msg">Automatic transfer created!</div>`;
    document.getElementById("savAutoAmount").value = "";
    document.getElementById("savAutoNote").value = "";
  } else {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
  }
  await render();
  return false;
}

document.addEventListener("DOMContentLoaded", init);
