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
  document.getElementById("labPayDay").innerHTML = icon("calendar", 13) + " Pay day (which day wages are due)";
  document.getElementById("savePayDayBtn").innerHTML = icon("calendar", 14) + " Save pay day";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
}

function init() {
  const u = requireLogin();
  if (!u) return;
  if (u.role !== "teacher") { window.location.href = "student.html"; return; }
  CURRENT = u;
  CLASS_CODE = u.classCode;
  document.getElementById("whoami").textContent = "Ms/Mr " + u.name;
  paintChrome();
  enablePasswordToggles();
  autoPayDayIfDue(CLASS_CODE);
  processAutomations(CLASS_CODE);
  render();
}

function render() {
  const cls = getClass(CLASS_CODE);
  document.getElementById("className").textContent = cls.name;
  document.getElementById("classCode").textContent = cls.code;
  document.getElementById("rate").value = cls.interestRate;
  document.getElementById("payDaySelect").value = cls.payDay || "Fri";

  const students = getClassStudents(CLASS_CODE);
  document.getElementById("statStudents").textContent = students.length + " / 8";
  const total = students.reduce((sum, s) => sum + s.balance, 0);
  document.getElementById("statTotal").textContent = fmtMoney(total);
  document.getElementById("statCompanies").textContent = cls.companies.length;

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
    const db = loadDB();
    const student = db.users[a.studentUser];
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

  // adjustment select
  const sel = document.getElementById("adjStudent");
  sel.innerHTML = students.map(s => `<option value="${s.username}">${s.name}</option>`).join("");

  // txns
  const txbody = document.querySelector("#txnTable tbody");
  txbody.innerHTML = "";
  cls.txns.slice(0, 25).forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted-small">${t.date}</td><td>${badge(t.type)}</td><td>${describeTxn(t)}</td><td>${fmtMoney(t.amount)}</td>`;
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

function describeTxn(t) {
  const db = loadDB();
  const nameOf = u => (db.users[u] ? db.users[u].name : u);
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
    "stock-close": ["gold", "building", "Delisted"]
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

function addJobForm(e) {
  e.preventDefault();
  const title = document.getElementById("jobTitle").value.trim();
  const wage = document.getElementById("jobWage").value;
  const description = document.getElementById("jobDesc").value.trim();
  addJob(CLASS_CODE, title, wage, description);
  document.getElementById("jobTitle").value = "";
  document.getElementById("jobWage").value = "";
  document.getElementById("jobDesc").value = "";
  render();
  return false;
}

function deleteJob(id) {
  removeJob(CLASS_CODE, id);
  render();
}

function onAssignJob(username, jobId) {
  assignJob(username, jobId); // from data.js
  render();
}

function approveApp(appId) {
  approveApplication(CLASS_CODE, appId);
  render();
}
function declineApp(appId) {
  declineApplication(CLASS_CODE, appId);
  render();
}

function giveAdjustment(e) {
  e.preventDefault();
  const student = document.getElementById("adjStudent").value;
  const amount = Number(document.getElementById("adjAmount").value);
  const note = document.getElementById("adjNote").value.trim();
  const res = teacherAdjust(CURRENT.username, student, amount, note);
  const box = document.getElementById("adjMsg");
  if (res.ok) {
    box.innerHTML = `<div class="success-msg">Done — ${fmtMoney(Math.abs(amount))} ${amount >= 0 ? "given to" : "taken from"} ${student}.</div>`;
    document.getElementById("adjAmount").value = "";
    document.getElementById("adjNote").value = "";
  } else {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
  }
  render();
  return false;
}

function runPayDay() {
  const count = payDay(CLASS_CODE);
  alert(count > 0 ? `Pay day complete — ${count} student(s) paid.` : "No students have a job assigned yet.");
  render();
}
function runInterest() {
  const count = applyInterest(CLASS_CODE);
  alert(count > 0 ? `Interest applied to ${count} student(s).` : "No balances to apply interest to.");
  render();
}
function saveRate() {
  const db = loadDB();
  db.classes[CLASS_CODE].interestRate = Number(document.getElementById("rate").value);
  saveDB(db);
  render();
}
function savePayDay() {
  setPayDay(CLASS_CODE, document.getElementById("payDaySelect").value);
  alert("Pay day saved. Wages will now be paid automatically whenever that day comes around — or click Run Pay Day any time to pay early.");
  render();
}
function quickView(username) {
  const db = loadDB();
  const s = db.users[username];
  alert(`${s.name}\nUsername: ${s.username}\nBalance: ${fmtMoney(s.balance)}`);
}

function removeStudentClick(username, name) {
  if (confirm(`Remove ${name} from the class? Their account and balance will be permanently deleted. This cannot be undone.`)) {
    removeStudent(CLASS_CODE, username);
    render();
  }
}

function restartClass() {
  const cls = getClass(CLASS_CODE);
  const typed = prompt(
    `This will reset every student's balance to $0, remove job assignments, delist all companies, and clear the activity log for "${cls.name}".\n\nThis cannot be undone. Type the class name exactly to confirm:`
  );
  if (typed === null) return;
  if (typed.trim() !== cls.name) {
    alert("That didn't match the class name, so nothing was changed.");
    return;
  }
  resetClass(CLASS_CODE);
  alert("Class restarted — everyone is back to $0.");
  render();
}

document.addEventListener("DOMContentLoaded", init);
