let CURRENT, CLASS_CODE, PROFILE_USER, EDITING_EVENT_ID = null;

// Teachers naturally type amounts like "$10" or "1,000" in a money app —
// plain Number() chokes on those and silently falls back to 0, which is
// why a whole multi-choice event could end up worth +$0 across the board.
// This strips currency symbols/commas/whitespace first so those work.
function parseMoneyInput(str) {
  if (str === undefined || str === null) return NaN;
  const cleaned = String(str).replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return NaN;
  return Number(cleaned);
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("codeIcon").innerHTML = icon("key", 15);
  document.getElementById("payDayBtn").innerHTML = icon("coin", 15) + " Run Pay Day";
  document.getElementById("interestBtn").innerHTML = icon("chart", 15) + " Apply Interest";
  document.getElementById("iconStudents").innerHTML = icon("users", 30);
  document.getElementById("iconSavings").innerHTML = icon("piggy", 30);
  document.getElementById("iconCompanies").innerHTML = icon("building", 30);
  document.getElementById("hStudents").innerHTML = icon("users", 18) + " Students";
  document.getElementById("hNetWorth").innerHTML = icon("medal", 18) + " Net worth ranking";
  document.getElementById("hAdjust").innerHTML = icon("star", 18) + " Give a bonus or fine";
  document.getElementById("hSettings").innerHTML = icon("bank", 18) + " Class settings";
  document.getElementById("hDanger").innerHTML = icon("coin", 18) + " Danger zone";
  document.getElementById("restartBtn").innerHTML = icon("chart", 15) + " Restart class";
  document.getElementById("hActivity").innerHTML = icon("chart", 18) + " Recent activity";
  document.getElementById("labAdjStudent").innerHTML = icon("users", 13) + " Student";
  document.getElementById("labAdjAmount").innerHTML = icon("coin", 13) + " Amount (negative for a fine)";
  document.getElementById("labAdjNote").innerHTML = icon("star", 13) + " Reason";
  document.getElementById("applyAdjBtn").innerHTML = icon("send", 15) + " Apply";
  document.getElementById("labRate").innerHTML = icon("piggy", 13) + " Savings interest rate (%)";
  document.getElementById("saveRateBtn").innerHTML = icon("bank", 14) + " Save rate";
  document.getElementById("labInterestFreq").innerHTML = icon("repeat", 13) + " How often";
  document.getElementById("labInterestDay").innerHTML = icon("calendar", 13) + " On which day";
  document.getElementById("saveInterestAutoBtn").innerHTML = icon("bank", 14) + " Save interest schedule";
  document.getElementById("labPayDay").innerHTML = icon("calendar", 13) + " Pay day (which day wages are due)";
  document.getElementById("savePayDayBtn").innerHTML = icon("calendar", 14) + " Save pay day";
  document.getElementById("saveGamblingEnabledBtn").innerHTML = icon("dice", 14) + " Save gambling setting";
  document.getElementById("hEvents").innerHTML = icon("dice", 18) + " Random weekly events";
  document.getElementById("runEventsNowBtn").innerHTML = icon("repeat", 14) + " Run this week's events now";
  document.getElementById("labEvType").innerHTML = icon("dice", 13) + " Event type";
  document.getElementById("labEvOptions").innerHTML = icon("star", 13) + " Choices — one per line, as \"Label | amount | what happened (optional)\"";
  document.getElementById("labEvName").innerHTML = icon("star", 13) + " Event name";
  document.getElementById("labEvAmount").innerHTML = icon("coin", 13) + " Amount (negative for a cost)";
  document.getElementById("labEvDesc").innerHTML = icon("idcard", 13) + " Description (shown in the activity feed)";
  document.getElementById("labEvSeverity").innerHTML = icon("star", 13) + " Severity";
  document.getElementById("addEventBtn").innerHTML = icon("plus", 15) + " Add event";
  document.getElementById("hLifestyle").innerHTML = icon("star", 18) + " Lifestyle rating settings";
  document.getElementById("saveLifestyleBtn").innerHTML = icon("bank", 14) + " Save lifestyle settings";
  document.getElementById("hThresholds").innerHTML = icon("star", 18) + " Lifestyle rating bands";
  document.getElementById("addThresholdBtn").innerHTML = icon("plus", 13) + " Add band";
  document.getElementById("saveThresholdsBtn").innerHTML = icon("bank", 14) + " Save bands";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  if (u.role !== "teacher") { window.location.href = "student.html"; return; }
  CURRENT = u;
  CLASS_CODE = u.classCode;
  document.getElementById("whoami").textContent = "Ms/Mr " + u.name;
  paintChrome();
  enablePasswordToggles();
  await autoPayDayIfDue(CLASS_CODE);
  await processAutomations(CLASS_CODE);
  await processMortgages(CLASS_CODE);
  await processTermDeposits(CLASS_CODE);
  await autoInterestIfDue(CLASS_CODE);
  await processInsurancePayments(CLASS_CODE);
  await processWeeklyEvents(CLASS_CODE);
  await processWeeklyBigEvents(CLASS_CODE);
  await checkWeeklyEventPopup(CURRENT.username, CLASS_CODE);
  await checkBigEventPopup(CURRENT.username, CLASS_CODE);
  await render();
}

async function render() {
  const cls = await getClass(CLASS_CODE);
  document.getElementById("className").textContent = cls.name;
  document.getElementById("classCode").textContent = cls.code;
  document.getElementById("rate").value = cls.interestRate;
  document.getElementById("interestAuto").checked = !!cls.interestAuto;
  document.getElementById("interestFreq").value = cls.interestFrequency || "weekly";
  document.getElementById("interestDay").value = cls.interestDay || "Fri";
  document.getElementById("interestDayWrap").classList.toggle("hidden", (cls.interestFrequency || "weekly") === "daily");
  document.getElementById("payDaySelect").value = cls.payDay || "Fri";
  document.getElementById("gamblingEnabled").checked = cls.gambling ? cls.gambling.enabled !== false : true;

  const students = await getClassStudents(CLASS_CODE);
  document.getElementById("statStudents").textContent = students.length + " / 8";
  const total = students.reduce((sum, s) => sum + s.balance, 0);
  document.getElementById("statTotal").textContent = fmtMoney(total);
  document.getElementById("statCompanies").textContent = cls.companies.length;

  // name lookup cache for describeTxn / applications
  const nameCache = {};
  students.forEach(s => { nameCache[s.username] = s.name; });
  const teacher = await getUser(cls.teacher);
  if (teacher) nameCache[teacher.username] = teacher.name;

  // net worth ranking (also gives us each student's lifestyle rating for the table below)
  const board = await classLeaderboard(CLASS_CODE);
  const lifestyleByUser = {};
  await Promise.all(students.map(async s => { lifestyleByUser[s.username] = await lifestyleRating(s.username, CLASS_CODE); }));

  const nwBox = document.getElementById("netWorthList");
  nwBox.innerHTML = "";
  const medalClass = i => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "");
  board.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "leaderboard-row";
    div.innerHTML = `
      <span class="rank-pill ${medalClass(i)}">${i + 1}</span>
      <span class="student-avatar ${avatarClass(row.username)}">${initials(row.name)}</span>
      <div style="flex:1;">
        <div class="leaderboard-name">${row.name}</div>
        <div class="leaderboard-sub">${fmtMoney(row.balance)} cash + ${fmtMoney(row.invested)} invested${row.storeValue ? ` + ${fmtMoney(row.storeValue)} items` : ""}</div>
      </div>
      <div class="leaderboard-net">${fmtMoney(row.net)}</div>
    `;
    nwBox.appendChild(div);
  });

  // students table
  const netByUser = {};
  board.forEach(r => { netByUser[r.username] = r.net; });
  const tbody = document.querySelector("#studentTable tbody");
  tbody.innerHTML = "";
  document.getElementById("noStudents").classList.toggle("hidden", students.length > 0);
  students.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="student-avatar ${avatarClass(s.username)}">${initials(s.name)}</span>${s.name}<div class="muted-small">@${s.username}</div></td>
      <td>${jobSelectHtml(cls, s)}</td>
      <td><strong>${fmtMoney(s.balance)}</strong></td>
      <td>${lifestyleByUser[s.username]} / 100</td>
      <td>${fmtMoney(netByUser[s.username] || 0)}</td>
      <td>
        <button class="btn small secondary" onclick="quickView('${s.username}')">View</button>
        <button class="btn small coral" onclick="removeStudentClick('${s.username}', '${s.name.replace(/'/g, "\\'")}')">${icon("trash", 13)}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // random events
  const evBox = document.getElementById("eventList");
  const evs = cls.eventDefs || [];
  document.getElementById("noEvents").classList.toggle("hidden", evs.length > 0);
  evBox.innerHTML = "";
  evs.forEach(ev => {
    const row = document.createElement("div");
    row.className = "auto-row";
    const middle = ev.type === "choice"
      ? `&middot; <span class="badge lilac">Multiple choice</span> &middot; ${(ev.options || []).map(o => `${o.label} (${o.amount >= 0 ? "+" : ""}${fmtMoney(o.amount)})${o.outcome ? ` — ${o.outcome}` : ""}`).join(", ")}`
      : `&middot; ${ev.amount >= 0 ? "+" : ""}${fmtMoney(ev.amount)}`;
    row.innerHTML = `
      <div class="auto-details">${icon("dice", 14)} <strong>${ev.name}</strong>
        ${middle}
        &middot; ${ev.repeatable ? "Can repeat" : "Once per student"}
        &middot; <span class="badge ${ev.severity === 'bad' ? 'coral' : 'navy'}">${ev.severity === 'bad' ? 'Bad' : 'Neutral'}</span>
        ${ev.description ? `<div class="muted-small">${ev.description}</div>` : ""}
      </div>
      <button class="btn small secondary" onclick="startEditEvent('${ev.id}')">${icon("idcard", 13)} Edit</button>
      <button class="btn small coral" onclick="removeEvent('${ev.id}')">${icon("trash", 13)} Remove</button>
    `;
    evBox.appendChild(row);
  });

  // lifestyle settings
  const cfg = cls.lifestyleConfig || {
    property: { enabled: true, weight: 4 }, store: { enabled: true, weight: 2 },
    insurance: { enabled: true, weight: 2 }, transport: { enabled: true, weight: 3 }
  };
  const lsBox = document.getElementById("lifestyleSettings");
  lsBox.className = "grid grid-4";
  const lsSections = [
    { key: "property", label: "Property (house comfort)" },
    { key: "transport", label: "Transport (vehicle comfort)" },
    { key: "store", label: "Store items owned" },
    { key: "insurance", label: "Insurance plans owned" }
  ];
  lsBox.innerHTML = lsSections.map(s => `
    <div class="card" style="margin-bottom:0;box-shadow:none;border:1.5px solid var(--line);">
      <label style="display:flex;align-items:center;gap:8px;margin-top:0;">
        <input type="checkbox" id="ls-${s.key}-on" ${cfg[s.key] && cfg[s.key].enabled ? "checked" : ""} style="width:20px;height:20px;min-height:auto;">
        ${s.label}
      </label>
      <label for="ls-${s.key}-weight">Points per star</label>
      <input type="number" id="ls-${s.key}-weight" min="0" step="1" value="${cfg[s.key] ? cfg[s.key].weight : 0}">
    </div>
  `).join("");

  // lifestyle rating bands
  renderThresholdRows(cls.lifestyleThresholds || []);

  // adjustment select
  const sel = document.getElementById("adjStudent");
  sel.innerHTML = students.map(s => `<option value="${s.username}">${s.name}</option>`).join("");

  // txns
  const txbody = document.querySelector("#txnTable tbody");
  txbody.innerHTML = "";
  const nameOf = u => nameCache[u] || u;
  const recentTxns = getRecentTxns(cls, 10.5);
  document.getElementById("hActivity").innerHTML = icon("chart", 18) + ` Recent activity (last 1.5 weeks — ${recentTxns.length})`;
  recentTxns.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted-small">${t.date}</td><td>${badge(t.type)}</td><td>${describeTxn(t, nameOf)}</td><td>${fmtMoney(t.amount)}</td>`;
    txbody.appendChild(tr);
  });
}

function jobSelectHtml(cls, student) {
  let opts = `<option value="">— no job —</option>`;
  cls.jobs.forEach(j => {
    opts += `<option value="${j.id}" ${student.jobId === j.id ? "selected" : ""}>${j.title} (${fmtMoney(j.wage)})</option>`;
  });
  return `<select onchange="onAssignJob('${student.username}', this.value)">${opts}</select>`;
}

function describeTxn(t, nameOf) {
  switch (t.type) {
    case "welcome": return `${nameOf(t.to)} joined the class`;
    case "wage": return `${nameOf(t.to)} — ${t.note}`;
    case "interest": return `${nameOf(t.to)} — ${t.note}`;
    case "bonus": return `${nameOf(t.to)} — ${t.note}`;
    case "fine": return `${nameOf(t.to)} — ${t.note}`;
    case "transfer": return `${nameOf(t.from)} → ${nameOf(t.to)} ${t.note ? "— " + t.note : ""}`;
    case "automation": return `${nameOf(t.from)} → ${nameOf(t.to)} — automatic payment`;
    case "stock-buy": return `${nameOf(t.from)} — ${t.note}`;
    case "stock-sell": return `${nameOf(t.to)} — ${t.note}`;
    case "stock-close": return `${nameOf(t.to)} — ${t.note}`;
    case "insurance-buy": return `${nameOf(t.from)} — ${t.note}`;
    case "store-buy": return `${nameOf(t.from)} — ${t.note}`;
    case "store-sell": return `${nameOf(t.to)} — ${t.note}`;
    case "property-buy": return `${nameOf(t.from)} — ${t.note}`;
    case "property-sell": return `${nameOf(t.to)} — ${t.note}`;
    case "mortgage": return `${nameOf(t.from)} — ${t.note}`;
    case "event": return `${nameOf(t.to)} — ${t.note}`;
    case "vehicle-buy": return `${nameOf(t.from)} — ${t.note}`;
    case "vehicle-sell": return `${nameOf(t.to)} — ${t.note}`;
    case "term-deposit-open": return `${nameOf(t.from)} — ${t.note}`;
    case "term-deposit-early": return `${nameOf(t.to)} — ${t.note}`;
    case "term-deposit-mature": return `${nameOf(t.to)} — ${t.note}`;
    case "gambling": return `${nameOf(t.to || t.from)} — ${t.note}`;
    case "big-event": return `${nameOf(t.to || t.from)} — ${t.note}`;
    case "insurance-claim": return `${nameOf(t.to)} — ${t.note}`;
    case "insurance-premium": return `${nameOf(t.from)} — ${t.note}`;
    default: return t.note || "";
  }
}

function badge(type) {
  const map = {
    welcome: ["navy", "star", "New student"],
    wage: ["mint", "briefcase", "Wage"],
    interest: ["gold", "piggy", "Interest"],
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
    "mortgage": ["coral", "house", "Mortgage"],
    "event": ["lilac", "dice", "Random event"],
    "vehicle-buy": ["navy", "car", "Vehicle"], "vehicle-sell": ["gold", "car", "Vehicle sold"],
    "term-deposit-open": ["lilac", "vault", "Term deposit"], "term-deposit-early": ["coral", "vault", "Early withdrawal"],
    "term-deposit-mature": ["mint", "vault", "Deposit matured"],
    "gambling": ["gold", "dice", "Gambling"], "big-event": ["coral", "star", "Big event"],
    "insurance-claim": ["mint", "shield", "Insurance claim"], "insurance-premium": ["coral", "shield", "Premium"]
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

async function onAssignJob(username, jobId) {
  await assignJob(username, jobId);
  await render();
}

async function giveAdjustment(e) {
  e.preventDefault();
  const student = document.getElementById("adjStudent").value;
  const amount = Number(document.getElementById("adjAmount").value);
  const note = document.getElementById("adjNote").value.trim();
  const res = await teacherAdjust(CURRENT.username, student, amount, note);
  const box = document.getElementById("adjMsg");
  if (res.ok) {
    box.innerHTML = `<div class="success-msg">Done — ${fmtMoney(Math.abs(amount))} ${amount >= 0 ? "given to" : "taken from"} ${student}.</div>`;
    document.getElementById("adjAmount").value = "";
    document.getElementById("adjNote").value = "";
  } else {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
  }
  await render();
  return false;
}

async function addEventForm(e) {
  e.preventDefault();
  const type = document.getElementById("evType").value;
  const ev = {
    name: document.getElementById("evName").value.trim(),
    type,
    repeatable: document.getElementById("evRepeat").checked,
    severity: document.getElementById("evSeverity").value,
    description: document.getElementById("evDesc").value.trim()
  };
  if (type === "choice") {
    const lines = document.getElementById("evOptionsArea").value.split("\n").map(l => l.trim()).filter(Boolean);
    const options = [];
    for (const line of lines) {
      const [label, amt, outcome] = line.split("|");
      if (!(label || "").trim()) continue;
      const parsed = parseMoneyInput(amt);
      if (Number.isNaN(parsed)) {
        alert(`Couldn't read the amount for "${(label || "").trim()}" — enter a plain number like -10 or 5 (no currency symbols needed).`);
        return false;
      }
      options.push({ label: label.trim(), amount: parsed, outcome: (outcome || "").trim() });
    }
    if (options.length < 2) {
      alert('Add at least 2 choices, one per line, as "Label | amount".');
      return false;
    }
    ev.options = options;
    ev.amount = 0;
  } else {
    const rawAmt = document.getElementById("evAmount").value;
    if (rawAmt === "") {
      alert("Enter an amount for this event.");
      return false;
    }
    const parsed = parseMoneyInput(rawAmt);
    if (Number.isNaN(parsed)) {
      alert("Couldn't read that amount — enter a plain number like -10 or 5 (no currency symbols needed).");
      return false;
    }
    ev.amount = parsed;
  }

  if (EDITING_EVENT_ID) {
    await updateEventDef(CLASS_CODE, EDITING_EVENT_ID, ev);
  } else {
    await addEventDef(CLASS_CODE, ev);
  }
  resetEventForm();
  await render();
  return false;
}

function resetEventForm() {
  EDITING_EVENT_ID = null;
  document.getElementById("evName").value = "";
  document.getElementById("evAmount").value = "";
  document.getElementById("evOptionsArea").value = "";
  document.getElementById("evDesc").value = "";
  document.getElementById("evRepeat").checked = false;
  document.getElementById("evSeverity").value = "neutral";
  document.getElementById("evType").value = "fixed";
  toggleEventType();
  document.getElementById("addEventBtn").innerHTML = icon("plus", 15) + " Add event";
  const cancelBtn = document.getElementById("cancelEditEventBtn");
  if (cancelBtn) cancelBtn.remove();
}

function startEditEvent(id) {
  getClass(CLASS_CODE).then(cls => {
    const ev = (cls.eventDefs || []).find(e => e.id === id);
    if (!ev) return;
    EDITING_EVENT_ID = id;
    document.getElementById("evType").value = ev.type;
    toggleEventType();
    document.getElementById("evName").value = ev.name;
    document.getElementById("evSeverity").value = ev.severity || "neutral";
    document.getElementById("evRepeat").checked = !!ev.repeatable;
    document.getElementById("evDesc").value = ev.description || "";
    if (ev.type === "choice") {
      document.getElementById("evOptionsArea").value = (ev.options || [])
        .map(o => `${o.label} | ${o.amount}${o.outcome ? " | " + o.outcome : ""}`).join("\n");
    } else {
      document.getElementById("evAmount").value = ev.amount;
    }
    document.getElementById("addEventBtn").innerHTML = icon("plus", 15) + " Save changes";
    if (!document.getElementById("cancelEditEventBtn")) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.id = "cancelEditEventBtn";
      cancelBtn.className = "btn small secondary";
      cancelBtn.style.marginLeft = "8px";
      cancelBtn.textContent = "Cancel edit";
      cancelBtn.onclick = resetEventForm;
      document.getElementById("addEventBtn").insertAdjacentElement("afterend", cancelBtn);
    }
    document.getElementById("addEventBtn").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function toggleEventType() {
  const type = document.getElementById("evType").value;
  document.getElementById("evAmountWrap").classList.toggle("hidden", type === "choice");
  document.getElementById("evOptionsWrap").classList.toggle("hidden", type !== "choice");
}

async function removeEvent(id) {
  if (confirm("Remove this event? It will no longer be handed out.")) {
    if (id === EDITING_EVENT_ID) resetEventForm();
    await removeEventDef(CLASS_CODE, id);
    await render();
  }
}

function renderThresholdRows(thresholds) {
  const box = document.getElementById("thresholdList");
  box.innerHTML = "";
  thresholds.forEach((t, i) => {
    const row = document.createElement("div");
    row.className = "grid grid-4";
    row.style.alignItems = "flex-end";
    row.innerHTML = `
      <div><label>Label</label><input class="th-label" value="${(t.label || "").replace(/"/g, "&quot;")}"></div>
      <div><label>From (inclusive)</label><input class="th-min" type="number" min="0" max="100" step="1" value="${t.min}"></div>
      <div><label>To (exclusive)</label><input class="th-max" type="number" min="0" max="100" step="1" value="${t.max}"></div>
      <div><button class="btn small coral" type="button" onclick="this.closest('.grid').remove()">${icon("trash", 13)} Remove</button></div>
    `;
    box.appendChild(row);
  });
}

function addThresholdRow() {
  const box = document.getElementById("thresholdList");
  const row = document.createElement("div");
  row.className = "grid grid-4";
  row.style.alignItems = "flex-end";
  row.innerHTML = `
    <div><label>Label</label><input class="th-label" value="New band"></div>
    <div><label>From (inclusive)</label><input class="th-min" type="number" min="0" max="100" step="1" value="0"></div>
    <div><label>To (exclusive)</label><input class="th-max" type="number" min="0" max="100" step="1" value="10"></div>
    <div><button class="btn small coral" type="button" onclick="this.closest('.grid').remove()">${icon("trash", 13)} Remove</button></div>
  `;
  box.appendChild(row);
}

async function saveThresholds() {
  const rows = document.querySelectorAll("#thresholdList > .grid");
  const thresholds = Array.from(rows).map(row => ({
    label: row.querySelector(".th-label").value,
    min: row.querySelector(".th-min").value,
    max: row.querySelector(".th-max").value
  }));
  await saveLifestyleThresholds(CLASS_CODE, thresholds);
  document.getElementById("thresholdMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

async function saveLifestyle() {
  const config = {
    property: { enabled: document.getElementById("ls-property-on").checked, weight: Number(document.getElementById("ls-property-weight").value) || 0 },
    transport: { enabled: document.getElementById("ls-transport-on").checked, weight: Number(document.getElementById("ls-transport-weight").value) || 0 },
    store: { enabled: document.getElementById("ls-store-on").checked, weight: Number(document.getElementById("ls-store-weight").value) || 0 },
    insurance: { enabled: document.getElementById("ls-insurance-on").checked, weight: Number(document.getElementById("ls-insurance-weight").value) || 0 }
  };
  await saveLifestyleConfig(CLASS_CODE, config);
  document.getElementById("lifestyleMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

async function runPayDay() {
  const count = await payDay(CLASS_CODE);
  alert(count > 0 ? `Pay day complete — ${count} student(s) paid.` : "No students have a job assigned yet.");
  await render();
}
async function runInterest() {
  const count = await applyInterest(CLASS_CODE);
  alert(count > 0 ? `Interest applied to ${count} student(s).` : "No balances to apply interest to.");
  await render();
}
async function runWeeklyEventsNow() {
  const count = await forceWeeklyEvents(CLASS_CODE);
  alert(count > 0 ? `Done — ${count} event(s) assigned across the class. They'll pop up gradually as students visit the site over the next while.` : "No active events are set up yet — add some below first.");
  await render();
}
async function saveRate() {
  await classesColUpdateRate(Number(document.getElementById("rate").value));
  await render();
}
async function saveInterestAuto() {
  await saveInterestSettings(CLASS_CODE, {
    rate: document.getElementById("rate").value,
    auto: document.getElementById("interestAuto").checked,
    frequency: document.getElementById("interestFreq").value,
    day: document.getElementById("interestDay").value
  });
  alert("Interest schedule saved.");
  await render();
}
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "interestFreq") {
    document.getElementById("interestDayWrap").classList.toggle("hidden", e.target.value === "daily");
  }
});

async function classesColUpdateRate(rate) {
  await fdb.collection("classes").doc(CLASS_CODE).update({ interestRate: rate });
}
async function savePayDay() {
  await setPayDay(CLASS_CODE, document.getElementById("payDaySelect").value);
  alert("Pay day saved. Wages will now be paid automatically whenever that day comes around — or click Run Pay Day any time to pay early.");
  await render();
}
async function saveGamblingEnabled() {
  const enabled = document.getElementById("gamblingEnabled").checked;
  await setGamblingEnabled(CLASS_CODE, enabled);
  document.getElementById("gamblingMsg").innerHTML = `<div class="success-msg">${enabled ? "Gambling is now allowed." : "Gambling is now turned off for your class."}</div>`;
  await render();
}
async function quickView(username) {
  await renderProfile(username);
  document.getElementById("profileModal").classList.remove("hidden");
}

function closeProfile() {
  document.getElementById("profileModal").classList.add("hidden");
}

async function renderProfile(username) {
  const s = await getUser(username);
  if (!s) return;
  PROFILE_USER = username;
  const rating = await lifestyleRating(username, CLASS_CODE);
  const net = await portfolioValue(username, CLASS_CODE);
  const poss = await getStudentPossessions(username, CLASS_CODE);

  document.getElementById("profileName").innerHTML = `<span class="student-avatar ${avatarClass(s.username)}">${initials(s.name)}</span> ${s.name}`;

  const rows = [];
  rows.push(`<p><strong>Balance:</strong> ${fmtMoney(s.balance)} &middot; <strong>Portfolio:</strong> ${fmtMoney(net)} &middot; <strong>Lifestyle rating:</strong> ${rating} / 100</p>`);

  rows.push(`<h4>${icon("house", 16)} Property</h4>`);
  rows.push(poss.property
    ? `<div class="auto-row"><div class="auto-details"><strong>${poss.property.name}</strong> — ${fmtMoney(poss.property.price)}</div>
        <button class="btn small coral" onclick="profileRemoveProperty('${poss.property.id}')">Repossess</button></div>`
    : `<p class="muted-small">No property owned.</p>`);

  rows.push(`<h4>${icon("car", 16)} Transport</h4>`);
  rows.push(poss.vehicle
    ? `<div class="auto-row"><div class="auto-details"><strong>${poss.vehicle.name}</strong> — ${fmtMoney(poss.vehicle.price)}</div>
        <button class="btn small coral" onclick="profileRemoveVehicle('${poss.vehicle.id}')">Repossess</button></div>`
    : `<p class="muted-small">No vehicle owned.</p>`);

  rows.push(`<h4>${icon("cart", 16)} Store items</h4>`);
  rows.push(poss.storeItems.length
    ? poss.storeItems.map(it => `<div class="auto-row"><div class="auto-details">${it.name} — ${fmtMoney(it.price)}${it.countsNetWorth === false ? ' <span class="muted-small">(not counted)</span>' : ""}</div>
        <button class="btn small coral" onclick="profileRemoveStoreItem('${username}','${it.id}')">Remove</button></div>`).join("")
    : `<p class="muted-small">No store items owned.</p>`);

  rows.push(`<h4>${icon("shield", 16)} Insurance</h4>`);
  rows.push(poss.insurance.length
    ? poss.insurance.map(p => `<div class="auto-row"><div class="auto-details">${p.name} — ${fmtMoney(p.price)}/week</div>
        <button class="btn small coral" onclick="profileRemoveInsurance('${username}','${p.id}')">Cancel</button></div>`).join("")
    : `<p class="muted-small">No insurance plans.</p>`);

  document.getElementById("profileBody").innerHTML = rows.join("");
}

async function profileRemoveProperty(propId) {
  if (!confirm("Repossess this property? The student will be refunded 90% of its price.")) return;
  await sellProperty(CLASS_CODE, propId);
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileRemoveVehicle(vehId) {
  if (!confirm("Repossess this vehicle? The student will be refunded 90% of its price.")) return;
  await sellVehicle(CLASS_CODE, vehId);
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileRemoveStoreItem(username, itemId) {
  if (!confirm("Remove this item from the student? They'll be refunded 80% of its price.")) return;
  await sellStoreItem(username, CLASS_CODE, itemId);
  await render();
  await renderProfile(username);
}
async function profileRemoveInsurance(username, planId) {
  if (!confirm("Cancel this student's insurance plan?")) return;
  await cancelInsurance(username, planId);
  await render();
  await renderProfile(username);
}

async function removeStudentClick(username, name) {
  if (confirm(`Remove ${name} from the class? Their account and balance will be permanently deleted. This cannot be undone.`)) {
    await removeStudent(CLASS_CODE, username);
    await render();
  }
}

async function restartClass() {
  const cls = await getClass(CLASS_CODE);
  const typed = prompt(
    `This will reset every student's balance to $0, remove job assignments, delist all companies, and clear the activity log for "${cls.name}".\n\nThis cannot be undone. Type the class name exactly to confirm:`
  );
  if (typed === null) return;
  if (typed.trim() !== cls.name) {
    alert("That didn't match the class name, so nothing was changed.");
    return;
  }
  await resetClass(CLASS_CODE);
  alert("Class restarted — everyone is back to $0.");
  await render();
}

document.addEventListener("DOMContentLoaded", init);
