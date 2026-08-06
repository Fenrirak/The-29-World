let CURRENT, CLASS_CODE, PROFILE_USER, EDITING_EVENT_ID = null, EDITING_SIDE_HUSTLE_ID = null;

// "1am" / "12pm" -> 0-23, or null if unrecognized.
function parseHourLabel(str) {
  const m = String(str || "").trim().toLowerCase().match(/^(\d{1,2})\s*(am|pm)$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (h < 1 || h > 12) return null;
  if (m[2] === "am") h = (h === 12) ? 0 : h;
  else h = (h === 12) ? 12 : h + 12;
  return h;
}

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
  document.getElementById("labCashRate").innerHTML = icon("coin", 13) + " Cash balance interest rate (%)";
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
  // Same reasoning as the other pages: these are 8 independent jobs, so
  // running them together instead of one-at-a-time avoids 8 sequential
  // network round-trips on page load.
  await Promise.all([
    autoPayDayIfDue(CLASS_CODE),
    processAutomations(CLASS_CODE),
    processMortgages(CLASS_CODE),
    processTermDeposits(CLASS_CODE),
    autoInterestIfDue(CLASS_CODE),
    processInsurancePayments(CLASS_CODE),
    processWeeklyEvents(CLASS_CODE),
    processWeeklyBigEvents(CLASS_CODE)
  ]);
  await checkWeeklyEventPopup(CURRENT.username, CLASS_CODE);
  await checkBigEventPopup(CURRENT.username, CLASS_CODE);
  await checkAdjustmentPopup(CURRENT.username, CLASS_CODE);
  await render();
}

async function render() {
  const cls = await getClassCached(CLASS_CODE);
  document.getElementById("className").textContent = cls.name;
  document.getElementById("classCode").textContent = cls.code;
  document.getElementById("rate").value = cls.interestRate;
  document.getElementById("cashRate").value = cls.cashInterestRate || 0;
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
  const teacher = await getUserCached(cls.teacher);
  if (teacher) nameCache[teacher.username] = teacher.name;

  // net worth ranking (also gives us each student's lifestyle rating for the table below)
  const board = await classLeaderboard(CLASS_CODE);
  const lifestyleByUser = {};
  const lifestyleBandByUser = {};
  await Promise.all(students.map(async s => {
    lifestyleByUser[s.username] = await lifestyleRating(s.username, CLASS_CODE);
  }));
  students.forEach(s => {
    const row = board.find(r => r.username === s.username);
    const property = (cls.properties || []).find(p => p.owner === s.username);
    const vehicle = (cls.vehicles || []).find(v => v.owner === s.username);
    const stats = {
      netWorth: row ? row.net : 0,
      propertyComfort: property ? (property.comfort || 0) : 0,
      transportComfort: vehicle ? (vehicle.comfort || 0) : 0
    };
    lifestyleBandByUser[s.username] = lifestyleLabelFor(lifestyleByUser[s.username], cls.lifestyleThresholds || [], stats);
  });

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
      <td>${jobSelectHtml(cls, s)}${s.jobId ? `<div class="muted-small">${isJobTaskApprovedThisWeek(s, cls) ? `${icon("star", 11)} Task approved this week` : `Task not yet approved`}</div>` : ""}</td>
      <td><strong>${fmtMoney(s.balance)}</strong></td>
      <td>${lifestyleByUser[s.username]}${lifestyleBandByUser[s.username] ? `<div class="muted-small">${lifestyleBandByUser[s.username]}</div>` : ""}</td>
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

  // side hustles
  const reqBox = document.getElementById("sideHustleRequests");
  const pending = students.filter(s => s.sideHustleRequest && s.sideHustleRequest.status === "pending");
  document.getElementById("noSideHustleRequests").classList.toggle("hidden", pending.length > 0);
  reqBox.innerHTML = "";
  pending.forEach(s => {
    const req = s.sideHustleRequest;
    const hustles = cls.sideHustles || [];
    const from = hustles.find(h => h.id === (s.sideHustle || {}).hustleId);
    const to = hustles.find(h => h.id === req.hustleId);
    const row = document.createElement("div");
    row.className = "auto-row";
    row.innerHTML = `
      <div class="auto-details"><strong>${s.name}</strong>
        wants to switch ${from ? `from ${from.name} (${hourLabel((s.sideHustle || {}).checkinHour)})` : "(no current hustle)"}
        to <strong>${to ? to.name : "—"}</strong> at ${hourLabel(req.checkinHour)}
      </div>
      <button class="btn small" onclick="approveSideHustleRequest('${s.username}')">Approve</button>
      <button class="btn small coral" onclick="denySideHustleRequest('${s.username}')">Deny</button>
    `;
    reqBox.appendChild(row);
  });

  const shBox = document.getElementById("sideHustleList");
  const hustles = cls.sideHustles || [];
  document.getElementById("noSideHustlesTeacher").classList.toggle("hidden", hustles.length > 0);
  shBox.innerHTML = "";
  hustles.forEach(h => {
    const row = document.createElement("div");
    row.className = "auto-row";
    const payoutSummary = Object.keys(h.payouts || {})
      .map(Number).sort((a, b) => a - b)
      .map(hr => `${hourLabel(hr)}: ${fmtMoney(h.payouts[hr])}`).join(", ") || "No payouts set";
    row.innerHTML = `
      <div class="auto-details">${icon("briefcase", 14)} <strong>${h.name}</strong>
        <div class="muted-small">${payoutSummary}</div>
        ${h.description ? `<div class="muted-small">${h.description}</div>` : ""}
      </div>
      <button class="btn small secondary" onclick="startEditSideHustle('${h.id}')">${icon("idcard", 13)} Edit</button>
      <button class="btn small coral" onclick="removeSideHustleClick('${h.id}')">${icon("trash", 13)} Remove</button>
    `;
    shBox.appendChild(row);
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

  // lifestyle-based module locks
  const lock = cls.lifestyleLock || { threshold: 0, modules: [] };
  document.getElementById("lifestyleLockThreshold").value = lock.threshold;
  document.getElementById("lifestyleLockModules").innerHTML = LIFESTYLE_LOCKABLE_MODULES.map(m => `
    <label style="display:flex;align-items:center;gap:8px;">
      <input type="checkbox" class="lifestyleLockModuleBox" value="${m.key}" ${lock.modules.includes(m.key) ? "checked" : ""} style="width:20px;height:20px;min-height:auto;flex-shrink:0;">
      ${m.label}
    </label>
  `).join("");

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
    case "automation": return `${nameOf(t.from)} → ${nameOf(t.to)} — ${t.note || "Automatic payment"}`;
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
    case "cash-interest": return `${nameOf(t.to)} — ${t.note}`;
    case "savings-deposit": return `${nameOf(t.from)} — ${t.note || "Deposited into Savings Account"}`;
    case "savings-withdraw": return `${nameOf(t.to)} — ${t.note || "Withdrew from Savings Account"}`;
    case "loan-taken": return `${nameOf(t.to)} — ${t.note}`;
    case "loan-repayment": return `${nameOf(t.from)} — ${t.note}`;
    case "side-hustle": return `${nameOf(t.to)} — ${t.note}`;
    case "store-gift": return `${nameOf(t.to)} — ${t.note}`;
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
    "insurance-claim": ["mint", "shield", "Insurance claim"], "insurance-premium": ["coral", "shield", "Premium"],
    "cash-interest": ["gold", "coin", "Cash interest"],
    "savings-deposit": ["mint", "piggy", "Savings deposit"], "savings-withdraw": ["gold", "piggy", "Savings withdrawal"],
    "loan-taken": ["navy", "handshake", "Loan"], "loan-repayment": ["mint", "handshake", "Loan repayment"],
    "side-hustle": ["mint", "briefcase", "Side hustle"],
    "store-gift": ["mint", "cart", "Free item"]
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
  getClassCached(CLASS_CODE).then(cls => {
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

async function approveSideHustleRequest(username) {
  const res = await approveSideHustleChange(username, CLASS_CODE);
  if (!res.ok) alert(res.error || "Couldn't approve that request.");
  await render();
}

async function denySideHustleRequest(username) {
  const reason = prompt("Optional reason to show the student (leave blank to skip):", "") || "";
  await denySideHustleChange(username, reason);
  await render();
}

async function addSideHustleForm(e) {
  e.preventDefault();
  const name = document.getElementById("shName").value.trim();
  const description = document.getElementById("shDesc").value.trim();
  const lines = document.getElementById("shPayoutsArea").value.split("\n").map(l => l.trim()).filter(Boolean);
  const payouts = {};
  for (const line of lines) {
    const [hourPart, amtPart] = line.split("|");
    const hour = parseHourLabel(hourPart);
    if (hour === null) {
      alert(`Couldn't read the hour "${(hourPart || "").trim()}" — use a plain hour like "1am" or "3pm".`);
      return false;
    }
    const amount = parseMoneyInput(amtPart);
    if (Number.isNaN(amount)) {
      alert(`Couldn't read the amount for "${(hourPart || "").trim()}" — enter a plain number like 20 (no currency symbols needed).`);
      return false;
    }
    payouts[hour] = amount;
  }
  if (Object.keys(payouts).length === 0) {
    alert('Add at least one payout, as "hour | amount" (e.g. "1am | 20").');
    return false;
  }

  if (EDITING_SIDE_HUSTLE_ID) {
    await editSideHustle(CLASS_CODE, EDITING_SIDE_HUSTLE_ID, { name, description, payouts });
  } else {
    await addSideHustle(CLASS_CODE, { name, description, payouts });
  }
  resetSideHustleForm();
  await render();
  return false;
}

function resetSideHustleForm() {
  EDITING_SIDE_HUSTLE_ID = null;
  document.getElementById("shName").value = "";
  document.getElementById("shDesc").value = "";
  document.getElementById("shPayoutsArea").value = "";
  document.getElementById("addSideHustleBtn").innerHTML = icon("plus", 15) + " Add side hustle";
  const cancelBtn = document.getElementById("cancelEditSideHustleBtn");
  if (cancelBtn) cancelBtn.remove();
}

function startEditSideHustle(id) {
  getClassCached(CLASS_CODE).then(cls => {
    const h = (cls.sideHustles || []).find(x => x.id === id);
    if (!h) return;
    EDITING_SIDE_HUSTLE_ID = id;
    document.getElementById("shName").value = h.name;
    document.getElementById("shDesc").value = h.description || "";
    document.getElementById("shPayoutsArea").value = Object.keys(h.payouts || {})
      .map(Number).sort((a, b) => a - b)
      .map(hr => `${hourLabel(hr)} | ${h.payouts[hr]}`).join("\n");
    document.getElementById("addSideHustleBtn").innerHTML = icon("plus", 15) + " Save changes";
    if (!document.getElementById("cancelEditSideHustleBtn")) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.id = "cancelEditSideHustleBtn";
      cancelBtn.className = "btn small secondary";
      cancelBtn.style.marginLeft = "8px";
      cancelBtn.textContent = "Cancel edit";
      cancelBtn.onclick = resetSideHustleForm;
      document.getElementById("addSideHustleBtn").insertAdjacentElement("afterend", cancelBtn);
    }
    document.getElementById("addSideHustleBtn").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function removeSideHustleClick(id) {
  if (confirm("Remove this side hustle? Students currently using it will lose their check-in until they pick a new one.")) {
    if (id === EDITING_SIDE_HUSTLE_ID) resetSideHustleForm();
    await removeSideHustle(CLASS_CODE, id);
    await render();
  }
}

function thresholdRowHtml(t) {
  t = t || {};
  return `
    <div class="threshold-head">
      <div><label>Label</label><input class="th-label" value="${(t.label || "").replace(/"/g, "&quot;")}"></div>
      <div style="width:130px;"><label>From (inclusive)</label><input class="th-min" type="number" min="0" step="1" value="${t.min ?? 0}"></div>
      <div style="width:130px;"><label>To (exclusive)</label><input class="th-max" type="number" min="0" step="1" value="${t.max ?? 10}"></div>
      <button class="btn small coral" type="button" onclick="this.closest('.threshold-row').remove()" style="flex-shrink:0;">${icon("trash", 13)} Remove</button>
    </div>
    <div class="threshold-reqs">
      <p class="muted-small threshold-reqs-label">Optional requirements — a student must also meet these to be shown this band, even if their score qualifies. Leave at 0 for no requirement.</p>
      <div class="grid grid-3">
        <div><label>Min net worth</label><input class="th-min-networth" type="number" min="0" step="1" value="${t.minNetWorth || 0}"></div>
        <div><label>Min property comfort (0-5 stars)</label><input class="th-min-property" type="number" min="0" max="5" step="1" value="${t.minPropertyComfort || 0}"></div>
        <div><label>Min transport comfort (0-5 stars)</label><input class="th-min-transport" type="number" min="0" max="5" step="1" value="${t.minTransportComfort || 0}"></div>
      </div>
    </div>
  `;
}

function renderThresholdRows(thresholds) {
  const box = document.getElementById("thresholdList");
  box.innerHTML = "";
  thresholds.forEach(t => {
    const row = document.createElement("div");
    row.className = "threshold-row";
    row.innerHTML = thresholdRowHtml(t);
    box.appendChild(row);
  });
}

function addThresholdRow() {
  const box = document.getElementById("thresholdList");
  const row = document.createElement("div");
  row.className = "threshold-row";
  row.innerHTML = thresholdRowHtml({ label: "New band", min: 0, max: 10 });
  box.appendChild(row);
}

async function saveThresholds() {
  const rows = document.querySelectorAll("#thresholdList > .threshold-row");
  const thresholds = Array.from(rows).map(row => ({
    label: row.querySelector(".th-label").value,
    min: row.querySelector(".th-min").value,
    max: row.querySelector(".th-max").value,
    minNetWorth: row.querySelector(".th-min-networth").value,
    minPropertyComfort: row.querySelector(".th-min-property").value,
    minTransportComfort: row.querySelector(".th-min-transport").value
  }));
  await saveLifestyleThresholds(CLASS_CODE, thresholds);
  document.getElementById("thresholdMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

async function saveLifestyleLockSettings() {
  const threshold = document.getElementById("lifestyleLockThreshold").value;
  const modules = Array.from(document.querySelectorAll(".lifestyleLockModuleBox:checked")).map(el => el.value);
  await saveLifestyleLock(CLASS_CODE, threshold, modules);
  document.getElementById("lifestyleLockMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
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
  const { newlyPaid, hasJobs, unapprovedCount } = await payDay(CLASS_CODE);
  if (!hasJobs) {
    alert("No students have a job assigned yet.");
  } else if (newlyPaid > 0 && unapprovedCount > 0) {
    alert(`Pay day complete — ${newlyPaid} student(s) paid. ${unapprovedCount} still aren't ticked as having done their job task, so they weren't paid.`);
  } else if (newlyPaid > 0) {
    alert(`Pay day complete — ${newlyPaid} student(s) paid.`);
  } else if (unapprovedCount > 0) {
    alert(`Nobody was paid — ${unapprovedCount} student(s) with a job aren't ticked as having done their job task yet. Tick their box on the student's profile, then run pay day again.`);
  } else {
    alert("Everyone with a job has already been paid for today.");
  }
  await render();
}
async function runInterest() {
  const count = await applyInterest(CLASS_CODE);
  alert(count > 0 ? `Interest applied to ${count} student(s).` : "No balances to apply interest to.");
  await render();
}
async function runWeeklyEventsNow() {
  const btn = document.getElementById("runEventsNowBtn");
  if (btn.disabled) return; // already running — ignore extra clicks
  btn.disabled = true;
  try {
    const count = await forceWeeklyEvents(CLASS_CODE);
    alert(count > 0 ? `Done — ${count} event(s) assigned across the class. They'll pop up gradually as students visit the site over the next while.` : "No active events are set up yet.");
    await render();
  } finally {
    btn.disabled = false;
  }
}
async function saveRate() {
  await classesColUpdateRate(Number(document.getElementById("rate").value), Number(document.getElementById("cashRate").value));
  await render();
}
async function saveInterestAuto() {
  await saveInterestSettings(CLASS_CODE, {
    rate: document.getElementById("rate").value,
    cashRate: document.getElementById("cashRate").value,
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

async function classesColUpdateRate(rate, cashRate) {
  await fdb.collection("classes").doc(CLASS_CODE).update({ interestRate: rate, cashInterestRate: cashRate });
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
  const s = await getUserCached(username);
  if (!s) return;
  PROFILE_USER = username;
  const rating = await lifestyleRating(username, CLASS_CODE);
  const band = await lifestyleBandForStudent(username, CLASS_CODE);
  const net = await portfolioValue(username, CLASS_CODE);
  const poss = await getStudentPossessions(username, CLASS_CODE);
  const cls = withNewModuleDefaults(await getClassCached(CLASS_CODE));

  const job = cls.jobs.find(j => j.id === s.jobId);
  const taskApproved = isJobTaskApprovedThisWeek(s, cls);

  document.getElementById("profileName").innerHTML = `<span class="student-avatar ${avatarClass(s.username)}">${initials(s.name)}</span> ${s.name}`;
  document.getElementById("profileSubtitle").textContent = `@${s.username}${job ? ` · ${job.title}` : " · No job assigned"}`;

  const rows = [];
  const isOverride = s.lifestyleOverride !== undefined && s.lifestyleOverride !== null;
  rows.push(`
    <div class="profile-summary">
      <div class="profile-chip"><div class="label">Cash balance</div><div class="value">${fmtMoney(s.balance)}</div></div>
      <div class="profile-chip"><div class="label">Savings</div><div class="value">${fmtMoney(s.savings || 0)}</div></div>
      <div class="profile-chip"><div class="label">Portfolio</div><div class="value">${fmtMoney(net)}</div></div>
      <div class="profile-chip"><div class="label">Lifestyle rating</div><div class="value">${rating}${isOverride ? ` <span class="muted-small">(overridden)</span>` : ""}</div>${band ? `<div class="muted-small">${band}</div>` : ""}</div>
    </div>
  `);

  rows.push(`<h4>${icon("briefcase", 16)} This week's job task</h4>`);
  if (!job) {
    rows.push(`<p class="muted-small">No job assigned — nothing to approve.</p>`);
  } else {
    rows.push(`
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="profileJobTaskCheck" ${taskApproved ? "checked" : ""} onchange="profileSetJobTaskApproval('${username}', this.checked)" style="width:20px;height:20px;min-height:auto;">
        <span>Completed this week's task for <strong>${job.title}</strong> — pay day will pay them once this is ticked</span>
      </label>
      <p class="muted-small">Resets automatically the moment pay day (${DAY_FULL[cls.payDay || "Fri"]}) begins — you'll need to tick it again for next cycle. If it's unticked on pay day, ${s.name.split(" ")[0]} won't be paid until you tick it and re-run pay day.</p>
    `);
  }

  rows.push(`<h4>${icon("star", 16)} Lifestyle rating override</h4>`);
  if (isOverride) {
    rows.push(`
      <p class="muted-small">This student's lifestyle rating is locked at <strong>${s.lifestyleOverride}</strong> — nothing they buy, sell, or do will change it until you remove the override.</p>
      <div class="auto-row">
        <div class="auto-details">Locked at ${s.lifestyleOverride}</div>
        <button class="btn small secondary" onclick="removeProfileLifestyleOverride('${username}')">Remove override</button>
      </div>
    `);
  } else {
    rows.push(`
      <p class="muted-small">Set a fixed lifestyle rating for this student. While set, it replaces their computed score and won't move no matter what they buy or sell.</p>
      <div style="display:flex;gap:8px;align-items:flex-end;">
        <div style="flex:1;">
          <label for="profileLifestyleOverrideInput" style="margin-top:0;">Override value (0 or more)</label>
          <input id="profileLifestyleOverrideInput" type="number" min="0" step="1" placeholder="e.g. 50">
        </div>
        <button class="btn small" onclick="applyProfileLifestyleOverride('${username}')">Set override</button>
      </div>
    `);
  }

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

  const giftableItems = (cls.storeItems || []).filter(it => !it.archived);
  if (giftableItems.length > 0) {
    rows.push(`
      <div style="display:flex;gap:8px;align-items:flex-end;margin-top:8px;">
        <div style="flex:1;">
          <label for="profileGiftItemSelect" style="margin-top:0;">Give a store item for free</label>
          <select id="profileGiftItemSelect">
            ${giftableItems.map(it => `<option value="${it.id}">${it.name} — ${fmtMoney(it.price)}${it.stock !== null && it.stock <= 0 ? " (out of stock)" : ""}</option>`).join("")}
          </select>
        </div>
        <button class="btn small" onclick="profileGiveStoreItem('${username}')">Give free</button>
      </div>
      <p class="muted-small">Doesn't cost the student anything and ignores stock — works even if the item shows 0 left.</p>
    `);
  }

  rows.push(`<h4>${icon("shield", 16)} Insurance</h4>`);
  rows.push(poss.insurance.length
    ? poss.insurance.map(p => `<div class="auto-row"><div class="auto-details">${p.name} — ${fmtMoney(p.price)}/week</div>
        <button class="btn small coral" onclick="profileRemoveInsurance('${username}','${p.id}')">Cancel</button></div>`).join("")
    : `<p class="muted-small">No insurance plans.</p>`);

  const activeLoans = (s.loans || []).filter(l => l.status === "active");
  const todayKey = nzDateKey();
  rows.push(`<h4>${icon("handshake", 16)} Loans</h4>`);
  rows.push(activeLoans.length
    ? activeLoans.map(l => {
        const overdue = l.dueDate < todayKey;
        return `<div class="auto-row">
          <div class="auto-details">
            <strong>${fmtMoney(l.principal)}</strong> borrowed &middot; ${l.rate}% over ${l.termWeeks} week${l.termWeeks === 1 ? "" : "s"}
            <div class="muted-small">Due ${l.dueDate}${overdue ? " — overdue" : ""}</div>
          </div>
          <div class="${overdue ? 'status-declined' : 'status-pending'}">${fmtMoney(l.owed)} owed</div>
        </div>`;
      }).join("")
    : `<p class="muted-small">No outstanding loans.</p>`);
  if (activeLoans.length > 1) {
    const totalOwed = Math.round(activeLoans.reduce((sum, l) => sum + l.owed, 0) * 100) / 100;
    rows.push(`<p class="muted-small">Total owed across ${activeLoans.length} loans: <strong>${fmtMoney(totalOwed)}</strong></p>`);
  }

  // Shares held: just the quantity per company, no value shown, per teacher request.
  const heldShares = (cls.companies || [])
    .map(co => ({ name: co.name, qty: co.holders ? (co.holders[username] || 0) : 0 }))
    .filter(h => h.qty > 0);
  rows.push(`<h4>${icon("chart", 16)} Stock Market shares</h4>`);
  rows.push(heldShares.length
    ? heldShares.map(h => `<div class="auto-row"><div class="auto-details"><strong>${h.name}</strong></div><div class="auto-details">${h.qty} share${h.qty === 1 ? "" : "s"}</div></div>`).join("")
    : `<p class="muted-small">No shares owned.</p>`);

  document.getElementById("profileBody").innerHTML = rows.join("");
}

async function profileSetJobTaskApproval(username, approved) {
  await setJobTaskApproval(CLASS_CODE, username, approved);
  await renderProfile(username);
}

async function applyProfileLifestyleOverride(username) {
  const val = document.getElementById("profileLifestyleOverrideInput").value;
  const res = await setLifestyleOverride(username, val);
  if (!res.ok) { alert(res.error); return; }
  await render();
  await renderProfile(username);
}
async function removeProfileLifestyleOverride(username) {
  if (!confirm("Remove the lifestyle override? The student's rating will go back to being calculated automatically.")) return;
  await clearLifestyleOverride(username);
  await render();
  await renderProfile(username);
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
async function profileGiveStoreItem(username) {
  const itemId = document.getElementById("profileGiftItemSelect").value;
  const res = await giveFreeStoreItem(CLASS_CODE, username, itemId);
  if (!res.ok) { alert(res.error); return; }
  await render();
  await renderProfile(username);
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
  const cls = await getClassCached(CLASS_CODE);
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
