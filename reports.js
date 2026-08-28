/* ===================== The 29 World — Reports page =====================
   Teacher side: a live "current period" report for the whole class (net
   worth, savings rate, biggest expense category, loan history per
   student), plus a permanent list of previously saved report cards
   (see archiveClassReport() in data.js) that survive class resets.
   Student side: the same breakdown, but scoped to just their own numbers,
   with a simple net-worth trend built from their own past saved reports.
========================================================================== */

let CURRENT, IS_TEACHER, CLASS_CODE;
let ARCHIVES = [];
let CURRENT_REPORT = null;   // the live, unsaved report for "now"
let VIEWING = "current";     // "current" or an archive id
let VIEWED_REPORT = null;    // whichever report (current or archived) is on screen

const AVATAR_COLORS = ["c1", "c2", "c3", "c4", "c5"];
function avatarClass(username) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("idcard", 26) + " Reports";
  document.getElementById("hPeriod").innerHTML = icon("calendar", 18) + " Current period";
  document.getElementById("hPastReports").innerHTML = icon("vault", 18) + " Past reports";
  document.getElementById("hMyReport").innerHTML = icon("idcard", 18) + " My report card";
  document.getElementById("saveSnapshotBtn").innerHTML = icon("star", 15) + " Save a report card now";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  CLASS_CODE = u.classCode;
  document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = IS_TEACHER ? "Dashboard" : "My account";
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentView").classList.toggle("hidden", IS_TEACHER);
  if (!IS_TEACHER) document.getElementById("pageIntro").textContent =
    "Your report card: net worth, savings rate, biggest expenses and loan history for this period.";
  paintChrome();

  // Same background jobs every other page runs on load, so visiting
  // Reports keeps the class ticking along like any other page.
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
  // Don't block the report on the day's jobs — fetch the archives
  // alongside them and draw as soon as that one read lands, then redraw
  // once the jobs have finished in case they changed anything.
  ARCHIVES = await getReportArchives(CLASS_CODE);
  await t29FirstPaint(showCurrentPeriod);
  await T29_STARTUP_JOBS;
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  // ARCHIVES is deliberately NOT re-fetched here — archives only ever
  // change when a teacher explicitly archives a report, never as a result
  // of the background jobs above, so the copy fetched a moment ago is
  // still current. Only the live report is regenerated.
  await showCurrentPeriod();
}

async function showCurrentPeriod() {
  VIEWING = "current";
  CURRENT_REPORT = await generateClassReport(CLASS_CODE);
  VIEWED_REPORT = CURRENT_REPORT;
  render();
}

function showArchive(id) {
  const a = ARCHIVES.find(x => x.id === id);
  if (!a) return;
  VIEWING = id;
  VIEWED_REPORT = {
    classCode: CLASS_CODE, periodStart: a.periodStart, periodEnd: a.periodEnd,
    students: a.students, archivedDate: a.date
  };
  render();
}

async function saveSnapshot() {
  if (!confirm("Save a report card for right now? This locks in everyone's numbers so far as a permanent record — it never gets deleted by a class reset.")) return;
  await archiveClassReport(CLASS_CODE, CURRENT.username);
  ARCHIVES = await getReportArchives(CLASS_CODE);
  await showCurrentPeriod();
}

async function deleteArchiveClick(id, dateLabel) {
  if (!confirm(`Delete the report card saved on ${dateLabel}? This can't be undone.`)) return;
  await deleteReportArchive(CLASS_CODE, id);
  ARCHIVES = await getReportArchives(CLASS_CODE);
  if (VIEWING === id) await showCurrentPeriod();
  else renderArchiveList();
}

function fmtRange(start, end) {
  const s = start ? new Date(start).toLocaleDateString() : "class started";
  const e = end ? new Date(end).toLocaleDateString() : "now";
  return `${s} – ${e}`;
}

function render() {
  if (IS_TEACHER) renderTeacher();
  else renderStudent();
}

/* ---------------- Teacher view ---------------- */
function renderTeacher() {
  const isArchive = VIEWING !== "current";
  document.getElementById("hPeriod").innerHTML = icon("calendar", 18) + (isArchive ? " Saved report" : " Current period");
  document.getElementById("periodRange").textContent = isArchive
    ? `Saved ${VIEWED_REPORT.archivedDate} — covers ${fmtRange(VIEWED_REPORT.periodStart, VIEWED_REPORT.periodEnd)}`
    : `Covers ${fmtRange(VIEWED_REPORT.periodStart, VIEWED_REPORT.periodEnd)} — not yet saved`;
  document.getElementById("backToCurrentBtn").style.display = isArchive ? "" : "none";
  document.getElementById("saveSnapshotBtn").style.display = isArchive ? "none" : "";

  const rows = document.getElementById("classReportRows");
  const students = (VIEWED_REPORT.students || []).slice().sort((a, b) => b.netWorth - a.netWorth);
  document.getElementById("noStudentsMsg").style.display = students.length ? "none" : "";
  rows.innerHTML = students.map(s => `
    <tr>
      <td><span class="student-avatar ${avatarClass(s.username)}" style="width:26px;height:26px;font-size:.68rem;display:inline-flex;vertical-align:middle;margin-right:8px;">${initials(s.name)}</span>${s.name}</td>
      <td>${fmtMoney(s.netWorth)}</td>
      <td>${s.savingsRate === null ? "—" : s.savingsRate + "%"}</td>
      <td>${s.topExpenseCategory ? `${s.topExpenseCategory.category} (${fmtMoney(s.topExpenseCategory.amount)})` : "—"}</td>
      <td class="no-print"><button class="btn small secondary" onclick="openStudentReport('${s.username}')">View</button></td>
    </tr>
  `).join("");

  renderArchiveList();
}

function renderArchiveList() {
  const box = document.getElementById("archiveList");
  document.getElementById("noArchivesMsg").style.display = ARCHIVES.length ? "none" : "";
  const sorted = ARCHIVES.slice().reverse(); // newest first
  box.innerHTML = sorted.map(a => `
    <div class="auto-row">
      <div class="auto-details">
        <strong>${a.date}</strong>
        <div class="muted-small">Covers ${fmtRange(a.periodStart, a.periodEnd)} &middot; ${(a.students || []).length} student${(a.students || []).length === 1 ? "" : "s"}${a.generatedBy ? ` &middot; saved by ${a.generatedBy}` : ""}</div>
      </div>
      <button class="btn small ${VIEWING === a.id ? "gold" : "secondary"}" onclick="showArchive('${a.id}')">${VIEWING === a.id ? "Viewing" : "View"}</button>
      <button class="btn small secondary" onclick='exportArchiveCSV("${a.id}")'>${icon("chart", 13)} CSV</button>
      <button class="btn small coral" onclick="deleteArchiveClick('${a.id}', '${a.date}')">${icon("trash", 13)} Delete</button>
    </div>
  `).join("");
}

function openStudentReport(username) {
  const s = (VIEWED_REPORT.students || []).find(x => x.username === username);
  if (!s) return;
  document.getElementById("reportModalName").innerHTML =
    `<span class="student-avatar ${avatarClass(s.username)}">${initials(s.name)}</span> ${s.name}`;
  document.getElementById("reportModalSubtitle").textContent =
    `@${s.username} — ${VIEWING === "current" ? "current period" : "saved " + VIEWED_REPORT.archivedDate}, covers ${fmtRange(VIEWED_REPORT.periodStart, VIEWED_REPORT.periodEnd)}`;
  document.getElementById("reportModalBody").innerHTML = studentReportHTML(s);
  document.getElementById("reportModal").classList.remove("hidden");
}

function closeStudentReport() {
  document.getElementById("reportModal").classList.add("hidden");
}

/* ---------------- Student view ---------------- */
function renderStudent() {
  const s = (VIEWED_REPORT.students || []).find(x => x.username === CURRENT.username);
  document.getElementById("myPeriodRange").textContent = `Covers ${fmtRange(VIEWED_REPORT.periodStart, VIEWED_REPORT.periodEnd)} (updates automatically until your teacher saves it)`;
  const body = document.getElementById("myReportBody");
  if (!s) {
    body.innerHTML = `<p class="muted-small">No data yet — get started with a job, some savings, or a purchase and check back here.</p>`;
    return;
  }
  const history = ARCHIVES.filter(a => (a.students || []).some(x => x.username === CURRENT.username))
    .map(a => (a.students.find(x => x.username === CURRENT.username) || {}).netWorth)
    .filter(v => typeof v === "number");
  history.push(s.netWorth);

  body.innerHTML = `
    <h3 style="margin-top:18px;">${icon("chart", 16)} Net worth over time</h3>
    ${netWorthSparkline(history)}
    ${studentReportHTML(s)}
  `;
}

function netWorthSparkline(history) {
  if (history.length < 2) {
    return `<p class="muted-small">Not enough saved reports yet to show a trend — ask your teacher to save a report card each week to start building one.</p>`;
  }
  const w = 320, h = 70;
  const max = Math.max(...history), min = Math.min(...history);
  const range = (max - min) || 1;
  const pts = history.map((v, i) => ({ x: (i / (history.length - 1 || 1)) * w, y: h - ((v - min) / range) * (h - 10) - 5 }));
  const segments = pts.slice(1).map((p, i) => {
    const prev = pts[i];
    const up = p.y <= prev.y; // y is inverted (smaller y = higher net worth)
    return `<line x1="${prev.x.toFixed(1)}" y1="${prev.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${up ? "#3fbf8f" : "#e8735f"}" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join("");
  const dots = pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.2" fill="#1f2b44"/>`).join("");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="max-width:100%;">${segments}${dots}</svg>`;
}

/* ---------------- Shared per-student breakdown ---------------- */
function renderBars(map, colorClass) {
  const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="muted-small">Nothing here this period.</p>`;
  const max = Math.max(...entries.map(e => e[1]));
  return entries.map(([label, amt]) => `
    <div class="rpt-bar-row">
      <div class="rpt-bar-label">${label}</div>
      <div class="rpt-bar-track"><div class="rpt-bar-fill ${colorClass}" style="width:${max ? Math.round((amt / max) * 100) : 0}%"></div></div>
      <div class="rpt-bar-amount">${fmtMoney(amt)}</div>
    </div>
  `).join("");
}

function renderLoanHistory(loans) {
  if (!loans || !loans.length) return `<p class="muted-small">No loans taken.</p>`;
  return `<div class="table-scroll"><table><thead><tr><th>Taken</th><th>Amount</th><th>Rate</th><th>Term</th><th>Due</th><th>Status</th></tr></thead><tbody>
    ${loans.map(l => `<tr>
      <td>${l.takenDate || "—"}</td><td>${fmtMoney(l.principal)}</td><td>${l.rate}%/wk</td><td>${l.termWeeks} wk</td><td>${l.dueDate || "—"}</td>
      <td>${l.status === "active"
        ? `Active — ${fmtMoney(l.owed)} owed`
        : (l.onTime === null ? "Paid off" : l.onTime ? "Paid off on time" : "Paid off late")}</td>
    </tr>`).join("")}
  </tbody></table></div>`;
}

function studentReportHTML(s) {
  return `
    <div class="profile-summary">
      <div class="profile-chip"><div class="label">Net worth</div><div class="value">${fmtMoney(s.netWorth)}</div></div>
      <div class="profile-chip"><div class="label">Savings rate</div><div class="value">${s.savingsRate === null ? "—" : s.savingsRate + "%"}</div></div>
      <div class="profile-chip"><div class="label">Income this period</div><div class="value">${fmtMoney(s.incomeTotal)}</div></div>
      <div class="profile-chip"><div class="label">Biggest expense</div><div class="value">${s.topExpenseCategory ? s.topExpenseCategory.category : "—"}</div>${s.topExpenseCategory ? `<div class="muted-small">${fmtMoney(s.topExpenseCategory.amount)}</div>` : ""}</div>
    </div>

    <h4>${icon("bank", 16)} Net worth breakdown</h4>
    <div class="table-scroll"><table><tbody>
      <tr><td>Cash balance</td><td>${fmtMoney(s.balance)}</td></tr>
      <tr><td>Savings account</td><td>${fmtMoney(s.savings)}</td></tr>
      <tr><td>Term deposits</td><td>${fmtMoney(s.termDeposits)}</td></tr>
      <tr><td>Stock portfolio</td><td>${fmtMoney(s.invested)}</td></tr>
      <tr><td>Property</td><td>${fmtMoney(s.propertyValue)}</td></tr>
      <tr><td>Vehicles</td><td>${fmtMoney(s.vehicleValue)}</td></tr>
      <tr><td>Store items</td><td>${fmtMoney(s.storeValue)}</td></tr>
      <tr><td>Owed (loans + mortgage)</td><td>-${fmtMoney(s.owed)}</td></tr>
    </tbody></table></div>

    <h4>${icon("piggy", 16)} Income this period ${fmtMoney(s.incomeTotal)}</h4>
    ${renderBars(s.income, "gold")}

    <h4>${icon("vault", 16)} Saved &amp; invested this period ${fmtMoney(s.savedTotal)}</h4>
    ${renderBars(s.saved, "mint")}
    ${s.borrowedTotal ? `<p class="muted-small">Also borrowed ${fmtMoney(s.borrowedTotal)} in new loans this period (not counted as income).</p>` : ""}

    <h4>${icon("cart", 16)} Spent this period ${fmtMoney(s.spentTotal)}</h4>
    ${renderBars(s.spent, "coral")}

    <h4>${icon("handshake", 16)} Loan history</h4>
    ${renderLoanHistory(s.loans)}
  `;
}

/* ---------------- Export / print ---------------- */
// When the per-student modal is open, only its content should print —
// not the class-wide table sitting behind it in the DOM. A body class
// (toggled around the print call) is simpler and more broadly supported
// than a CSS :has() selector for this.
function printReport() {
  const modalOpen = !document.getElementById("reportModal").classList.contains("hidden");
  if (modalOpen) document.body.classList.add("printing-modal-only");
  window.print();
  setTimeout(() => document.body.classList.remove("printing-modal-only"), 500);
}

function reportToRows(report) {
  const rows = [["Name", "Username", "Net worth", "Cash", "Savings", "Term deposits", "Invested", "Property", "Vehicles", "Store items",
    "Owed", "Income (period)", "Saved/invested (period)", "Spent (period)", "Borrowed (period)", "Savings rate %", "Top expense category", "Top expense amount"]];
  (report.students || []).forEach(s => rows.push([
    s.name, s.username, s.netWorth, s.balance, s.savings, s.termDeposits, s.invested, s.propertyValue, s.vehicleValue, s.storeValue,
    s.owed, s.incomeTotal, s.savedTotal, s.spentTotal, s.borrowedTotal, s.savingsRate === null ? "" : s.savingsRate,
    s.topExpenseCategory ? s.topExpenseCategory.category : "", s.topExpenseCategory ? s.topExpenseCategory.amount : ""
  ]));
  return rows;
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => `"${String(v === undefined || v === null ? "" : v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeFilenamePart(s) {
  return String(s || "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function exportCurrentCSV() {
  const label = VIEWING === "current" ? "current" : VIEWED_REPORT.archivedDate;
  downloadCSV(reportToRows(VIEWED_REPORT), `report-${safeFilenamePart(CLASS_CODE)}-${safeFilenamePart(label)}.csv`);
}

function exportArchiveCSV(id) {
  const a = ARCHIVES.find(x => x.id === id);
  if (!a) return;
  downloadCSV(reportToRows(a), `report-${safeFilenamePart(CLASS_CODE)}-${safeFilenamePart(a.date)}.csv`);
}

document.addEventListener("DOMContentLoaded", init);
