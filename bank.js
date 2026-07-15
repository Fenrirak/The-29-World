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
  document.getElementById("hActivity").innerHTML = icon("bank", 18) + " My recent activity";
  document.getElementById("labTo").innerHTML = icon("users", 13) + " Send to";
  document.getElementById("labAmount").innerHTML = icon("coin", 13) + " Amount";
  document.getElementById("labNote").innerHTML = icon("star", 13) + " What's it for?";
  document.getElementById("sendBtn").innerHTML = icon("send", 15) + " Send";
  document.getElementById("labAutoDay").innerHTML = icon("calendar", 13) + " Day of the week";
  document.getElementById("labAutoFreq").innerHTML = icon("repeat", 13) + " How often";
  document.getElementById("labAutoAmount").innerHTML = icon("coin", 13) + " Amount";
  document.getElementById("labAutoTo").innerHTML = icon("users", 13) + " Pay to";
  document.getElementById("addAutoBtn").innerHTML = icon("plus", 15) + " Create automatic payment";
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
  await processWeeklyEvents(u.classCode);
  await checkWeeklyEventPopup(u.username, u.classCode);
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
    const toUser = await getUser(a.toUser);
    const row = document.createElement("div");
    row.className = "auto-row";
    row.innerHTML = `
      <div class="auto-details">${icon("repeat", 14)} <strong>${fmtMoney(a.amount)}</strong> to <strong>${toUser ? toUser.name : a.toUser}</strong>
        &middot; ${DAY_LABEL[a.dayOfWeek] || a.dayOfWeek}, ${FREQ_LABEL[a.frequency] || a.frequency}
        ${a.lastRun ? `<div class="muted-small">Last paid: ${a.lastRun}</div>` : `<div class="muted-small">Not run yet</div>`}
      </div>
      <button class="btn small coral" onclick="removeAuto('${a.id}')">${icon("trash", 13)} Remove</button>
    `;
    listBox.appendChild(row);
  }

  // txns
  const my = cls.txns.filter(t => t.to === me.username || t.from === me.username).slice(0, 30);
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
      "insurance-buy": ["lilac", "shield", "Insurance"], "store-buy": ["mint", "cart", "Store"],
      "property-buy": ["navy", "house", "Property"], "property-sell": ["gold", "house", "Property sold"],
      "mortgage": ["coral", "house", "Mortgage"], "event": ["lilac", "dice", "Random event"],
      "vehicle-buy": ["navy", "car", "Vehicle"], "vehicle-sell": ["gold", "car", "Vehicle sold"],
      "term-deposit-open": ["lilac", "vault", "Term deposit"], "term-deposit-early": ["coral", "vault", "Early withdrawal"],
      "term-deposit-mature": ["mint", "vault", "Deposit matured"]
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
    else if (["stock-sell", "stock-close", "wage", "interest", "bonus", "welcome", "property-sell", "vehicle-sell", "term-deposit-mature", "term-deposit-early"].includes(t.type)) { sign = "+"; }
    else if (["fine", "insurance-buy", "store-buy", "mortgage", "vehicle-buy", "term-deposit-open"].includes(t.type)) { sign = "-"; }
    else if (t.type === "property-buy") { sign = "-"; }

    let amtDisplay;
    if (t.type === "event") {
      sign = t.amount < 0 ? "-" : "+";
      amtDisplay = fmtMoney(Math.abs(t.amount));
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
  const res = await transferMoney(CURRENT.username, to, amount, note);
  if (res.ok) {
    box.innerHTML = `<div class="success-msg">Sent ${fmtMoney(amount)}!</div>`;
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
  const box = document.getElementById("autoMsg");
  if (!to) { box.innerHTML = `<div class="error-msg">There's no one to pay yet.</div>`; return false; }
  const res = await addAutomation(CURRENT.classCode, CURRENT.username, day, freq, amount, to);
  if (res.ok) {
    box.innerHTML = `<div class="success-msg">Automatic payment created!</div>`;
    document.getElementById("autoAmount").value = "";
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

document.addEventListener("DOMContentLoaded", init);
