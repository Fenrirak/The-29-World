let CURRENT, CLASS_CODE;

function paintChrome() {
  paintIconSlots();
  document.getElementById("codeIcon").innerHTML = icon("key", 15);
  document.getElementById("payDayBtn").innerHTML = icon("coin", 15) + " Run Pay Day";
  document.getElementById("interestBtn").innerHTML = icon("chart", 15) + " Apply Interest";
  document.getElementById("iconStudents").innerHTML = icon("users", 30);
  document.getElementById("iconSavings").innerHTML = icon("piggy", 30);
  document.getElementById("iconCompanies").innerHTML = icon("building", 30);
  document.getElementById("hStudents").innerHTML = icon("users", 18) + " Students";
  document.getElementById("hJobs").innerHTML = icon("briefcase", 18) + " Jobs board";
  document.getElementById("hApplications").innerHTML = icon("idcard", 18) + " Pending job applications";
  document.getElementById("hAdjust").innerHTML = icon("star", 18) + " Give a bonus or fine";
  document.getElementById("hSettings").innerHTML = icon("bank", 18) + " Class settings";
  document.getElementById("hDanger").innerHTML = icon("coin", 18) + " Danger zone";
  document.getElementById("restartBtn").innerHTML = icon("chart", 15) + " Restart class";
  document.getElementById("hActivity").innerHTML = icon("chart", 18) + " Recent activity";
  document.getElementById("labJobTitle").innerHTML = icon("briefcase", 13) + " New job title";
  document.getElementById("labJobWage").innerHTML = icon("coin", 13) + " Weekly wage";
  document.getElementById("labJobDesc").innerHTML = icon("idcard", 13) + " Job description (shown to students)";
  document.getElementById("addJobBtn").innerHTML = icon("plus", 15) + " Add job";
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
  document.getElementById("hEvents").innerHTML = icon("dice", 18) + " Random weekly events";
  document.getElementById("labEvName").innerHTML = icon("star", 13) + " Event name";
  document.getElementById("labEvAmount").innerHTML = icon("coin", 13) + " Amount (negative for a cost)";
  document.getElementById("labEvDesc").innerHTML = icon("idcard", 13) + " Description (shown in the activity feed)";
  document.getElementById("addEventBtn").innerHTML = icon("plus", 15) + " Add event";
  document.getElementById("hLifestyle").innerHTML = icon("star", 18) + " Lifestyle rating settings";
  document.getElementById("saveLifestyleBtn").innerHTML = icon("bank", 14) + " Save lifestyle settings";
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
  await processWeeklyEvents(CLASS_CODE);
  await checkWeeklyEventPopup(CURRENT.username, CLASS_CODE);
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

  // students table
  const tbody = document.querySelector("#studentTable tbody");
  tbody.innerHTML = "";
  document.getElementById("noStudents").classList.toggle("hidden", students.length > 0);
  students.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="student-avatar ${avatarClass(s.username)}">${initials(s.name)}</span>${s.name}<div class="muted-small">@${s.username}</div></td>
      <td>${jobSelectHtml(cls, s)}</td>
      <td><strong>${fmtMoney(s.balance)}</strong></td>
      <td>
        <button class="btn small secondary" onclick="quickView('${s.username}')">View</button>
        <button class="btn small coral" onclick="removeStudentClick('${s.username}', '${s.name.replace(/'/g, "\\'")}')">${icon("trash", 13)}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // jobs table
  const jbody = document.querySelector("#jobsTable tbody");
  jbody.innerHTML = "";
  cls.jobs.forEach(j => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><strong>${j.title}</strong>${j.description ? `<div class="muted-small">${j.description}</div>` : ""}</td><td>${fmtMoney(j.wage)}</td>
      <td><button class="btn small coral" onclick="deleteJob('${j.id}')">Remove</button></td>`;
    jbody.appendChild(tr);
  });

  // pending applications
  const apps = (cls.jobApplications || []).filter(a => a.status === "pending");
  const appBox = document.getElementById("applicationsList");
  document.getElementById("noApplications").classList.toggle("hidden", apps.length > 0);
  appBox.innerHTML = "";
  apps.forEach(a => {
    const student = students.find(s => s.username === a.studentUser);
    const job = cls.jobs.find(j => j.id === a.jobId);
    if (!student || !job) return;
    const row = document.createElement("div");
    row.className = "auto-row";
    row.innerHTML = `
      <div class="auto-details"><strong>${student.name}</strong> applied for <strong>${job.title}</strong> (${fmtMoney(job.wage)})</div>
      <div class="row-flex" style="gap:8px;">
        <button class="btn small mint" onclick="approveApp('${a.id}')">Approve</button>
        <button class="btn small coral" onclick="declineApp('${a.id}')">Decline</button>
      </div>
    `;
    appBox.appendChild(row);
  });

  // random events
  const evBox = document.getElementById("eventList");
  const evs = cls.eventDefs || [];
  document.getElementById("noEvents").classList.toggle("hidden", evs.length > 0);
  evBox.innerHTML = "";
  evs.forEach(ev => {
    const row = document.createElement("div");
    row.className = "auto-row";
    row.innerHTML = `
      <div class="auto-details">${icon("dice", 14)} <strong>${ev.name}</strong>
        &middot; ${ev.amount >= 0 ? "+" : ""}${fmtMoney(ev.amount)}
        &middot; ${ev.repeatable ? "Can repeat" : "Once per student"}
        ${ev.description ? `<div class="muted-small">${ev.description}</div>` : ""}
      </div>
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

  // adjustment select
  const sel = document.getElementById("adjStudent");
  sel.innerHTML = students.map(s => `<option value="${s.username}">${s.name}</option>`).join("");

  // txns
  const txbody = document.querySelector("#txnTable tbody");
  txbody.innerHTML = "";
  const nameOf = u => nameCache[u] || u;
  cls.txns.slice(0, 25).forEach(t => {
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
    case "property-buy": return `${nameOf(t.from)} — ${t.note}`;
    case "property-sell": return `${nameOf(t.to)} — ${t.note}`;
    case "mortgage": return `${nameOf(t.from)} — ${t.note}`;
    case "event": return `${nameOf(t.to)} — ${t.note}`;
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
    "property-buy": ["navy", "house", "Property"],
    "property-sell": ["gold", "house", "Property sold"],
    "mortgage": ["coral", "house", "Mortgage"],
    "event": ["lilac", "dice", "Random event"],
    "vehicle-buy": ["navy", "car", "Vehicle"], "vehicle-sell": ["gold", "car", "Vehicle sold"],
    "term-deposit-open": ["lilac", "vault", "Term deposit"], "term-deposit-early": ["coral", "vault", "Early withdrawal"],
    "term-deposit-mature": ["mint", "vault", "Deposit matured"]
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

async function addJobForm(e) {
  e.preventDefault();
  const title = document.getElementById("jobTitle").value.trim();
  const wage = document.getElementById("jobWage").value;
  const description = document.getElementById("jobDesc").value.trim();
  await addJob(CLASS_CODE, title, wage, description);
  document.getElementById("jobTitle").value = "";
  document.getElementById("jobWage").value = "";
  document.getElementById("jobDesc").value = "";
  await render();
  return false;
}

async function deleteJob(id) {
  await removeJob(CLASS_CODE, id);
  await render();
}

async function onAssignJob(username, jobId) {
  await assignJob(username, jobId);
  await render();
}

async function approveApp(appId) {
  await approveApplication(CLASS_CODE, appId);
  await render();
}
async function declineApp(appId) {
  await declineApplication(CLASS_CODE, appId);
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
  const ev = {
    name: document.getElementById("evName").value.trim(),
    amount: document.getElementById("evAmount").value,
    repeatable: document.getElementById("evRepeat").checked,
    description: document.getElementById("evDesc").value.trim()
  };
  await addEventDef(CLASS_CODE, ev);
  document.getElementById("evName").value = "";
  document.getElementById("evAmount").value = "";
  document.getElementById("evDesc").value = "";
  document.getElementById("evRepeat").checked = false;
  await render();
  return false;
}

async function removeEvent(id) {
  if (confirm("Remove this event? It will no longer be handed out.")) {
    await removeEventDef(CLASS_CODE, id);
    await render();
  }
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
async function quickView(username) {
  const s = await getUser(username);
  alert(`${s.name}\nUsername: ${s.username}\nBalance: ${fmtMoney(s.balance)}`);
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
