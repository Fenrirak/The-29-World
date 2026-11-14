/* ===================== The 29 World — Reports page =====================
   Teacher side: a live "this month" report for the whole class (net
   worth, savings rate, biggest expense category, loan history per
   student). Each student's report card carries a net-worth trend built from
   the figure noted every 3 days (see recordMyNetWorthIfDue() in
   data-money.js), so nobody has to save anything.
   Student side: the same breakdown, but scoped to just their own numbers,
   plus an "entire history" breakdown that only starts again when the
   class is restarted (see
   recordReportActivity()/reportLifetime in data-money.js).
========================================================================== */

let CURRENT, IS_TEACHER, CLASS_CODE;
let CURRENT_REPORT = null;   // the live report for "now"
let VIEWED_REPORT = null;    // the report on screen

const AVATAR_COLORS = ["c1", "c2", "c3", "c4", "c5"];
function avatarClass(username) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("idcard", 26) + " Reports";
  document.getElementById("pageIntro").textContent = IS_TEACHER
    ? "Report cards: net worth, savings rate, biggest expenses and loan history. Net worth is noted automatically every 3 days, so each student's trend builds up on its own."
    : "Your report card: net worth, savings rate, biggest expenses and loan history for this month, plus your entire history.";
  document.getElementById("hPeriod").innerHTML = icon("calendar", 18) + " This month";
  document.getElementById("hMyReport").innerHTML = icon("idcard", 18) + " My report card";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  CLASS_CODE = u.classCode;
  document.getElementById("whoami").textContent = t29DisplayName(u);
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = "Dashboard";
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentView").classList.toggle("hidden", IS_TEACHER);
  paintChrome();

  // Same background jobs every other page runs on load, so visiting
  // Reports keeps the class ticking along like any other page.
  const T29_STARTUP_JOBS = Promise.all([
    IS_TEACHER
      ? safeBgJob(payDayForClassIfDue(u.classCode), "payDayForClassIfDue")
      : safeBgJob(payMyWageIfDue(u.username), "payMyWageIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processLoanInterest(u.classCode), "processLoanInterest"),
    safeBgJob(processTermDeposits(u.classCode), "processTermDeposits"),
    IS_TEACHER
      ? safeBgJob(applyInterestToClassIfDue(u.classCode), "applyInterestToClassIfDue")
      : safeBgJob(applyMyInterestIfDue(u.username), "applyMyInterestIfDue"),
    safeBgJob(processInsurancePayments(u.classCode), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
  ]);
  // Don't block the report on the day's jobs — draw first, then redraw
  // once the jobs have finished in case they changed anything.
  await t29FirstPaint(showCurrentPeriod);
  await T29_STARTUP_JOBS;
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await showCurrentPeriod();
  // Keep family links' summaries up to date (quietly, and only when due).
  if (IS_TEACHER) {
    refreshParentViewsForClass(CLASS_CODE);
  } else {
    Promise.all([getUserCached(u.username), getClassCached(u.classCode)])
      .then(([me, cls]) => refreshParentViewIfStale(me, cls))
      .catch(() => {});
  }
}

async function showCurrentPeriod() {
  CURRENT_REPORT = await generateClassReport(CLASS_CODE);
  VIEWED_REPORT = CURRENT_REPORT;
  render();
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
  renderResetQueue();
  document.getElementById("hPeriod").innerHTML = icon("calendar", 18) + " This month";
  document.getElementById("periodRange").textContent = `Covers ${fmtRange(VIEWED_REPORT.periodStart, VIEWED_REPORT.periodEnd)}`;

  const rows = document.getElementById("classReportRows");
  const students = (VIEWED_REPORT.students || []).slice().sort((a, b) => b.netWorth - a.netWorth);
  document.getElementById("noStudentsMsg").style.display = students.length ? "none" : "";
  rows.innerHTML = students.map(s => `
    <tr>
      <td><div class="stack-val"><span class="student-avatar ${avatarClass(s.username)}" style="width:26px;height:26px;font-size:var(--fs-xs);display:inline-flex;vertical-align:middle;margin-right:8px;">${initials(s.name)}</span>${escapeHtml(s.name)}</div></td>
      <td><div class="stack-val">${fmtMoney(s.netWorth)}</div></td>
      <td><div class="stack-val">${s.savingsRate === null ? "—" : s.savingsRate + "%"}</div></td>
      <td><div class="stack-val">${s.topExpenseCategory ? `${escapeHtml(s.topExpenseCategory.category)} (${fmtMoney(s.topExpenseCategory.amount)})` : "—"}</div></td>
      <td class="no-print stack-actions"><button class="btn small secondary" onclick="openStudentReport('${escapeJsAttr(s.username)}')">View</button></td>
    </tr>
  `).join("");
}

let MODAL_STUDENT = null;   // whichever student's detail modal is open, for the PDF export

function openStudentReport(username) {
  const s = (VIEWED_REPORT.students || []).find(x => x.username === username);
  if (!s) return;
  MODAL_STUDENT = s;
  document.getElementById("reportModalName").innerHTML =
    `<span class="student-avatar ${avatarClass(s.username)}">${initials(s.name)}</span> ${escapeHtml(s.name)}`;
  document.getElementById("reportModalSubtitle").textContent =
    `@${s.username}. This month, covers ${fmtRange(VIEWED_REPORT.periodStart, VIEWED_REPORT.periodEnd)}`;
  // The modal's own heading isn't printed (it sits with the buttons), so
  // the printout gets the name and dates here instead.
  document.getElementById("reportModalBody").innerHTML =
    `<div class="print-only rpt-print-head"><h2>${escapeHtml(s.name)}</h2><p>${escapeHtml(document.getElementById("reportModalSubtitle").textContent)}</p></div>` +
    studentReportHTML(s);
  document.getElementById("reportModal").classList.remove("hidden");
}

function closeStudentReport() {
  document.getElementById("reportModal").classList.add("hidden");
  MODAL_STUDENT = null;
}

/* ---------------- Student view ---------------- */
function renderStudent() {
  const s = (VIEWED_REPORT.students || []).find(x => x.username === CURRENT.username);
  document.getElementById("myPeriodRange").textContent = `Covers ${fmtRange(VIEWED_REPORT.periodStart, VIEWED_REPORT.periodEnd)} (updates automatically)`;
  const body = document.getElementById("myReportBody");
  if (!s) {
    body.innerHTML = `<p class="muted-small">No data yet. Get started with a job, some savings, or a purchase and check back here.</p>`;
    return;
  }
  body.innerHTML = `
    <p class="print-only rpt-print-head"><strong>${escapeHtml(s.name)}</strong></p>
    ${studentReportHTML(s, { mine: true })}
  `;
}

// "26 Oct" (or "26 Oct 2025" when the year isn't this one) in NZ time.
function nwDay(t, withYear) {
  return new Date(t).toLocaleDateString("en-NZ", Object.assign({ day: "numeric", month: "short", timeZone: "Pacific/Auckland" }, withYear ? { year: "numeric" } : {}));
}
// $1.2k / $34k / $1.5m for the chart's tight axis labels.
function nwShort(v, span) {
  const a = Math.abs(v), sign = v < 0 ? "-" : "";
  if (span < 5000 && a < 1e6) return `${sign}$${Math.round(a).toLocaleString("en-NZ")}`; // tight range: whole dollars, so the labels stay distinct
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${Math.round(a)}`;
}

// Which range the net worth chart shows: "month" (the last 30 days, the
// default) or "all" (the whole history, averaged one week at a time).
let NW_RANGE = "month";
const NW_STUDENTS = {}; // username -> report data, so a click can redraw the chart

// Same pill buttons as the quick-bet amounts in Gambling (.bet-chip).
function nwRangeBar(range) {
  const chip = (r, label) => `<button type="button" class="nw-range-chip${range === r ? " active" : ""}" data-range="${r}" aria-pressed="${range === r}">${label}</button>`;
  return `<div class="nw-range" role="group" aria-label="Net worth time range">${chip("month", "Last month")}${chip("all", "All time")}</div>`;
}

// The student's net worth over time, on its own full-width row. Net worth is
// noted every 3 days. By default the chart shows the last month, one point
// per note, then now; "All time" shows the whole history with each point the
// average of one week. Green where it rose, red where it fell. Drawn by time,
// so a gap in the history is a gap on the chart rather than being squashed.
function netWorthChartHTML(s) {
  NW_STUDENTS[s.username] = s;
  const range = NW_RANGE === "all" ? "all" : "month";
  const allPts = netWorthSeries(s);
  const open = `<section class="nw-trend" data-user="${escapeHtml(s.username)}">`;
  const title = `<h3>${icon("medal", 16)} Net worth over time</h3>`;
  if (allPts.length < 2) {
    return `${open}<div class="nw-trend-head">${title}</div><p class="muted-small">Your trend starts building once your net worth has been noted. It's noted automatically every 3 days, so check back soon.</p></section>`;
  }
  const caption = range === "all"
    ? "Each point is the average of one week, from figures noted every 3 days"
    : "Noted automatically every 3 days, showing the last month";
  const head = `<div class="nw-trend-head">${title}${nwRangeBar(range)}</div><p class="muted-small nw-trend-note">${caption}</p>`;
  const pts = range === "all" ? netWorthWeeklyAverages(allPts) : netWorthMonthPoints(allPts);
  if (pts.length < 2) {
    return `${open}${head}<p class="muted-small">${range === "all"
      ? "All time needs at least two weeks of history. Switch to Last month to see each 3-day note."
      : "There aren't enough notes in the last month yet. Try All time to see the whole history."}</p></section>`;
  }
  const W = 640, H = 230, L = 64, R = 18, T = 16, B = 34, pw = W - L - R, ph = H - T - B;
  let max = Math.max(...pts.map(p => p.v)), min = Math.min(...pts.map(p => p.v));
  if (max === min) { max += 1; min -= 1; }
  const pad = (max - min) * 0.08; max += pad; min -= pad;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const X = t => L + (t1 === t0 ? pw / 2 : ((t - t0) / (t1 - t0)) * pw);
  const Y = v => T + ph - ((v - min) / (max - min)) * ph;
  const grid = [max, (max + min) / 2, min].map(v =>
    `<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${W - R}" y2="${Y(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".12"/>` +
    `<text x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="nw-axis">${nwShort(v, max - min)}</text>`).join("");
  const segs = pts.slice(1).map((p, i) => {
    const q = pts[i];
    return `<line x1="${X(q.t).toFixed(1)}" y1="${Y(q.v).toFixed(1)}" x2="${X(p.t).toFixed(1)}" y2="${Y(p.v).toFixed(1)}" stroke="${p.v >= q.v ? "#3fbf8f" : "#e8735f"}" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join("");
  const dotLabel = p => {
    if (range === "all") {
      const base = p.now ? "This week so far" : "Week of " + nwDay(dateKeyToUTC(p.week));
      return `${base} (average of ${p.n} ${p.n === 1 ? "note" : "notes"})`;
    }
    return p.now ? "Now" : (p.saved ? "Saved report, " : "Noted ") + nwDay(dateKeyToUTC(p.day));
  };
  const dots = pts.map(p => {
    const hollow = p.now;
    return `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${hollow ? 5 : 3.4}" fill="${hollow ? "var(--card, #fff)" : "currentColor"}" ${hollow ? 'stroke="currentColor" stroke-width="2.5"' : ""}><title>${dotLabel(p)}: ${fmtMoney(p.v)}</title></circle>`;
  }).join("");
  const yearDiffers = new Date(t0).getFullYear() !== new Date(t1).getFullYear();
  const xlabels = `<text x="${L}" y="${H - 8}" text-anchor="start" class="nw-axis">${nwDay(t0, yearDiffers)}</text>` +
    `<text x="${W - R}" y="${H - 8}" text-anchor="end" class="nw-axis">${nwDay(t1, yearDiffers)}</text>`;
  // The figures beside the chart use real notes, not the weekly averages.
  const now = allPts[allPts.length - 1];
  const first = range === "all" ? allPts[0] : pts[0];
  const diff = Math.round((now.v - first.v) * 100) / 100;
  const pct = first.v !== 0 ? ` (${diff >= 0 ? "+" : ""}${Math.round((diff / Math.abs(first.v)) * 1000) / 10}%)` : "";
  const span = range === "all"
    ? `<div class="label">Weeks tracked</div><div class="value">${Math.max(1, Math.round((now.t - first.t) / 604800000))}</div>`
    : `<div class="label">Days shown</div><div class="value">${Math.max(1, Math.round((now.t - first.t) / 86400000))}</div>`;
  return `${open}${head}
    <svg viewBox="0 0 ${W} ${H}" class="nw-chart" role="img" aria-label="Net worth over time (${range === "all" ? "all time, weekly averages" : "last month"}), from ${fmtMoney(first.v)} to ${fmtMoney(now.v)}" style="color:var(--ink);">${grid}${segs}${dots}${xlabels}</svg>
    <div class="profile-summary nw-trend-stats">
      <div class="profile-chip"><div class="label">${range === "all" ? "First noted" : "Earliest shown"}</div><div class="value">${fmtMoney(first.v)}</div><div class="muted-small">${nwDay(first.t, true)}</div></div>
      <div class="profile-chip"><div class="label">Now</div><div class="value">${fmtMoney(now.v)}</div></div>
      <div class="profile-chip"><div class="label">Change</div><div class="value ${diff >= 0 ? "ticker-up" : "ticker-down"}">${diff >= 0 ? "+" : "-"}${fmtMoney(Math.abs(diff))}</div><div class="muted-small">${pct.trim()}</div></div>
      <div class="profile-chip">${span}</div>
    </div>
  </section>`;
}

// Last month / All time buttons: redraw the charts on screen in place.
document.addEventListener("click", e => {
  const btn = e.target.closest && e.target.closest(".nw-range-chip");
  if (!btn) return;
  const sec = btn.closest(".nw-trend");
  const who = sec && sec.dataset.user;
  const next = btn.dataset.range === "all" ? "all" : "month";
  if (!who || !NW_STUDENTS[who] || next === NW_RANGE) return;
  NW_RANGE = next;
  document.querySelectorAll(".nw-trend[data-user]").forEach(el => {
    const st = NW_STUDENTS[el.dataset.user];
    if (st) el.outerHTML = netWorthChartHTML(st);
  });
  const again = [...document.querySelectorAll(".nw-trend[data-user]")].find(el => el.dataset.user === who);
  const nb = again && again.querySelector(`.nw-range-chip[data-range="${next}"]`);
  if (nb) nb.focus();
});

/* ---------------- Shared per-student breakdown ---------------- */
const REPORT_LIFETIME_NOTE = "Everything since the account was made, or since the class was last restarted. It doesn't reset when the month rolls over.";
// ctx (only on a student's own card): { scope, section } adds the "Reset" buttons.
function renderBars(map, colorClass, ctx) {
  const entries = Object.entries(map || {}).filter(([,v]) => Number.isFinite(v) && v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (!entries.length) return `<p class="muted-small">Nothing here yet.</p>`;
  const max = Math.max(...entries.map(e => Math.abs(e[1])));
  return entries.map(([label, amt]) => `
    <div class="rpt-bar-row">
      <div class="rpt-bar-label">${escapeHtml(label)}</div>
      <div class="rpt-bar-track"><div class="rpt-bar-fill ${amt < 0 ? "coral" : colorClass}" style="width:${max ? Math.round((Math.abs(amt) / max) * 100) : 0}%"></div></div>
      <div class="rpt-bar-amount">${fmtMoney(amt)}</div>
      ${ctx ? `<div class="rpt-reset-cell no-print">${rptResetControl(ctx.scope, ctx.section, label)}</div>` : ""}
    </div>
  `).join("");
}

/* ---------------- Asking to reset a number (student) ----------------
   A reset only changes what this card shows, and only once the teacher approves it. */
let RPT_MY_REQUESTS = [];
const RPT_SECTION_NAMES = { income: "Income", saved: "Saved & invested", spent: "Spent", returned: "Returned money & sale proceeds", borrowed: "Borrowed" };
const RPT_SCOPE_NAMES = { month: "this month", life: "all time" };
function rptInjectCss() {
  if (document.getElementById("rptResetCss")) return;
  const st = document.createElement("style");
  st.id = "rptResetCss";
  st.textContent = `.rpt-reset-cell{flex:0 0 auto;display:flex;align-items:center;gap:6px;min-width:84px;justify-content:flex-end}
.rpt-reset-cell .btn,.rpt-sec-btn{padding:2px 9px;font-size:var(--fs-xs,12px)}
.rpt-reset-tag{font-size:var(--fs-xs,12px);font-weight:700;color:#8a6414;white-space:nowrap}
.rpt-sec-btn{margin-left:10px;vertical-align:middle}
.rpt-reqbox{border:1px solid rgba(128,128,128,.3);border-radius:10px;padding:10px 14px;margin:12px 0}
.rpt-reqbox h4{margin:0 0 6px}
.rpt-reqrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:4px 0}`;
  document.head.appendChild(st);
}
function rptPendingFor(scope, section, cat) {
  return RPT_MY_REQUESTS.find(r => r.status === "pending" && r.scope === scope && r.section === section && (r.category === cat || r.category === "*"));
}
function rptResetControl(scope, section, cat) {
  const p = rptPendingFor(scope, section, cat);
  if (p) return `<span class="rpt-reset-tag">Reset requested</span><button type="button" class="btn small secondary" data-rid="${escapeHtml(p.id)}" onclick="rptWithdraw(this.dataset.rid)">Withdraw</button>`;
  return `<button type="button" class="btn small secondary" title="Ask your teacher to reset this to 0" data-scope="${scope}" data-section="${section}" data-cat="${escapeHtml(cat)}" onclick="rptRequest(this)">Reset</button>`;
}
// "Reset all" for a whole section (only when something is showing).
function rptSectionButton(mine, scope, section, map) {
  if (!mine) return "";
  const has = Object.values(map || {}).some(v => Number.isFinite(v) && v !== 0);
  if (!has && section !== "borrowed") return "";
  const p = rptPendingFor(scope, section, "*");
  if (p) return `<span class="rpt-reset-tag no-print" style="margin-left:10px;">Reset requested</span><button type="button" class="btn small secondary rpt-sec-btn no-print" data-rid="${escapeHtml(p.id)}" onclick="rptWithdraw(this.dataset.rid)">Withdraw</button>`;
  return `<button type="button" class="btn small secondary rpt-sec-btn no-print" title="Ask your teacher to reset all of this to 0" data-scope="${scope}" data-section="${section}" data-cat="*" onclick="rptRequest(this)">Reset all</button>`;
}
function rptRequestsBox() {
  const pend = RPT_MY_REQUESTS.filter(r => r.status === "pending");
  const done = RPT_MY_REQUESTS.filter(r => r.status === "approved" || r.status === "declined").sort((a, b) => b.ts - a.ts).slice(0, 5);
  if (!pend.length && !done.length) return `<div id="rptResetMsg" class="no-print"></div>`;
  const what = r => `${RPT_SECTION_NAMES[r.section] || r.section}: ${r.category === "*" ? "everything" : escapeHtml(r.category)} (${RPT_SCOPE_NAMES[r.scope] || r.scope})`;
  return `<div class="rpt-reqbox no-print"><h4>Your reset requests</h4>
    ${pend.map(r => `<div class="rpt-reqrow"><span>${what(r)} <span class="rpt-reset-tag">Waiting for your teacher</span></span><button type="button" class="btn small secondary" data-rid="${escapeHtml(r.id)}" onclick="rptWithdraw(this.dataset.rid)">Withdraw</button></div>`).join("")}
    ${done.map(r => `<div class="rpt-reqrow muted-small"><span>${what(r)}: ${r.status === "approved" ? "approved, now starts from 0" : "declined"}</span></div>`).join("")}
    <div class="muted-small">A reset only changes the numbers on this report card. Nothing else changes.</div>
  </div><div id="rptResetMsg" class="no-print"></div>`;
}
function rptMsg(html) { const el = document.getElementById("rptResetMsg"); if (el) el.innerHTML = html || ""; }
async function rptRequest(btn) {
  const scope = btn.dataset.scope, section = btn.dataset.section, cat = btn.dataset.cat;
  const target = cat === "*" ? `all of ${RPT_SECTION_NAMES[section]} (${RPT_SCOPE_NAMES[scope]})` : `${cat} (${RPT_SECTION_NAMES[section]}, ${RPT_SCOPE_NAMES[scope]})`;
  if (!await t29Confirm(`Ask your teacher to reset ${target} to 0? It only changes your report card, and only once your teacher approves. You can withdraw the request until then.`)) return;
  btn.disabled = true;
  const res = await requestReportReset(CURRENT.username, CLASS_CODE, scope, section, cat);
  await showCurrentPeriod();
  rptMsg(res.ok ? `<div class="success-msg">Request sent to your teacher. You can withdraw it until it's approved.</div>` : `<div class="error-msg">${escapeHtml(res.error)}</div>`);
}
async function rptWithdraw(id) {
  const res = await withdrawReportReset(CURRENT.username, CLASS_CODE, id);
  await showCurrentPeriod();
  rptMsg(res.ok ? `<div class="success-msg">Request withdrawn. Nothing was changed.</div>` : `<div class="error-msg">${escapeHtml(res.error)}</div>`);
}

/* ---------------- Teacher: reset requests waiting ---------------- */
function renderResetQueue() {
  const card = document.getElementById("resetRequestsCard"), body = document.getElementById("resetRequestsBody");
  if (!card || !body) return;
  card.classList.toggle("hidden", !IS_TEACHER);
  const rows = [];
  (VIEWED_REPORT.students || []).forEach(s => (s.resetRequests || []).filter(r => r.status === "pending").forEach(r => rows.push({ s, r })));
  rows.sort((a, b) => a.r.ts - b.r.ts);
  document.getElementById("resetRequestsCount").textContent = rows.length ? `${rows.length} waiting` : "";
  body.innerHTML = rows.length ? `<div class="table-scroll"><table class="stack-table"><thead><tr><th>Student</th><th>Wants reset</th><th>Asked</th><th></th></tr></thead><tbody>${rows.map(({ s, r }) => `
    <tr><td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(RPT_SECTION_NAMES[r.section] || r.section)}: ${r.category === "*" ? "everything" : escapeHtml(r.category)} <span class="muted-small">(${RPT_SCOPE_NAMES[r.scope] || r.scope})</span></td>
      <td>${r.ts ? new Date(r.ts).toLocaleDateString() : "—"}</td>
      <td class="no-print"><button class="btn small mint" data-user="${escapeHtml(s.username)}" data-rid="${escapeHtml(r.id)}" onclick="rptDecide(this,true)">Approve</button>
        <button class="btn small coral" data-user="${escapeHtml(s.username)}" data-rid="${escapeHtml(r.id)}" onclick="rptDecide(this,false)">Decline</button></td></tr>`).join("")}</tbody></table></div>
    <p class="muted-small">Approving only changes the numbers on that student's report card (including the PDF and family view). Balances, savings, net worth and history stay exactly as they are.</p>`
    : `<p class="muted-small">No reset requests waiting.</p>`;
}
async function rptDecide(btn, approve) {
  btn.disabled = true;
  const res = await decideReportReset(CLASS_CODE, btn.dataset.user, btn.dataset.rid, approve);
  const msg = document.getElementById("resetRequestsMsg");
  await showCurrentPeriod();
  if (msg) msg.innerHTML = res.ok ? `<div class="success-msg">${approve ? "Approved. That number now shows 0 on the student's report card." : "Declined."}</div>` : `<div class="error-msg">${escapeHtml(res.error)}</div>`;
}

function renderLoanHistory(loans) {
  if (!loans || !loans.length) return `<p class="muted-small">No loans taken.</p>`;
  return `<div class="table-scroll"><table class="stack-table"><thead><tr><th>Taken</th><th>Amount</th><th>Rate</th><th>Term</th><th>Due</th><th>Status</th></tr></thead><tbody>
    ${loans.map(l => `<tr>
      <td>${l.takenDate || "—"}</td><td>${fmtMoney(l.principal)}</td><td>${l.rate}%/wk</td><td>${l.termWeeks} wk</td><td>${l.dueDate || "—"}</td>
      <td>${l.status === "active"
        ? `Active: ${fmtMoney(l.owed)} owed`
        : (l.onTime === null ? "Paid off" : l.onTime ? "Paid off on time" : "Paid off late")}</td>
    </tr>`).join("")}
  </tbody></table></div>`;
}

function studentReportHTML(s, opts) {
  const mine = !!(opts && opts.mine);
  RPT_MY_REQUESTS = mine ? (s.resetRequests || []) : [];
  if (mine) rptInjectCss();
  const rc = (scope, section) => mine ? { scope, section } : null;
  const savedLabel = s.accountingVersion === 2 ? "Net saved &amp; invested" : "Deposited &amp; invested (legacy)";
  return `
    <p class="muted-small">${escapeHtml(reportAccountingNote(s))}</p>
    ${mine ? rptRequestsBox() : ""}
    <div class="profile-summary">
      <div class="profile-chip"><div class="label">Net worth</div><div class="value">${fmtMoney(s.netWorth)}</div></div>
      <div class="profile-chip"><div class="label">Savings rate</div><div class="value">${s.savingsRate === null ? "—" : s.savingsRate + "%"}</div></div>
      <div class="profile-chip"><div class="label">Income this month</div><div class="value">${fmtMoney(s.incomeTotal)}</div></div>
      <div class="profile-chip"><div class="label">Biggest expense</div><div class="value">${s.topExpenseCategory ? escapeHtml(s.topExpenseCategory.category) : "—"}</div>${s.topExpenseCategory ? `<div class="muted-small">${fmtMoney(s.topExpenseCategory.amount)}</div>` : ""}</div>
    </div>

    ${netWorthChartHTML(s)}

    <h4>${icon("medal", 16)} Net worth breakdown</h4>
    <div class="table-scroll"><table><tbody>
      <tr><td>Cash balance</td><td>${fmtMoney(s.balance)}</td></tr>
      <tr><td>Savings account</td><td>${fmtMoney(s.savings)}</td></tr>
      <tr><td>Term deposits</td><td>${fmtMoney(s.termDeposits)}</td></tr>
      ${s.kiwiSaver ? `<tr><td>KiwiSaver</td><td>${fmtMoney(s.kiwiSaver)}</td></tr>` : ""}
      ${s.gamblingBalance ? `<tr><td>Gambling account</td><td>${fmtMoney(s.gamblingBalance)}</td></tr>` : ""}
      <tr><td>Stock portfolio</td><td>${fmtMoney(s.invested)}</td></tr>
      <tr><td>Property</td><td>${fmtMoney(s.propertyValue)}</td></tr>
      <tr><td>Vehicles</td><td>${fmtMoney(s.vehicleValue)}</td></tr>
      <tr><td>Store items</td><td>${fmtMoney(s.storeValue)}</td></tr>
      <tr><td>Owed (loans, mortgage and credit card)</td><td>${s.owed > 0 ? "-" : ""}${fmtMoney(s.owed)}</td></tr>
    </tbody></table></div>

    <h4>${icon("download", 16)} Income this month ${fmtMoney(s.incomeTotal)}${rptSectionButton(mine, "month", "income", s.income)}</h4>
    ${renderBars(s.income, "gold", rc("month", "income"))}

    <h4>${icon("piggy", 16)} ${savedLabel} this month ${fmtMoney(s.savedTotal)}${rptSectionButton(mine, "month", "saved", s.saved)}</h4>
    ${renderBars(s.saved, "mint", rc("month", "saved"))}
    ${s.borrowedTotal ? `<p class="muted-small">Also borrowed ${fmtMoney(s.borrowedTotal)} in new loans this month (not counted as income).${rptSectionButton(mine, "month", "borrowed", null)}</p>` : ""}

    <h4>${icon("send", 16)} Spent this month ${fmtMoney(s.spentTotal)}${rptSectionButton(mine, "month", "spent", s.spent)}</h4>
    ${renderBars(s.spent, "coral", rc("month", "spent"))}

    <h3 style="margin-top:26px;">${icon("history", 17)} Entire history</h3>
    <p class="muted-small">${REPORT_LIFETIME_NOTE}</p>

    <h4>${icon("download", 16)} All-time income ${fmtMoney(s.lifetimeIncomeTotal)}${rptSectionButton(mine, "life", "income", s.lifetimeIncome)}</h4>
    ${renderBars(s.lifetimeIncome, "gold", rc("life", "income"))}

    <h4>${icon("piggy", 16)} All-time ${savedLabel.toLowerCase()} ${fmtMoney(s.lifetimeSavedTotal)}${rptSectionButton(mine, "life", "saved", s.lifetimeSaved)}</h4>
    ${renderBars(s.lifetimeSaved, "mint", rc("life", "saved"))}
    ${s.lifetimeBorrowedTotal ? `<p class="muted-small">Also borrowed ${fmtMoney(s.lifetimeBorrowedTotal)} in loans in total (not counted as income).${rptSectionButton(mine, "life", "borrowed", null)}</p>` : ""}

    <h4>${icon("send", 16)} All-time spent ${fmtMoney(s.lifetimeSpentTotal)}${rptSectionButton(mine, "life", "spent", s.lifetimeSpent)}</h4>
    ${renderBars(s.lifetimeSpent, "coral", rc("life", "spent"))}

    ${s.returnedTotal ? `<h4>Returned money &amp; sale proceeds this month ${fmtMoney(s.returnedTotal)}${rptSectionButton(mine, "month", "returned", s.returned)}</h4>${renderBars(s.returned, "gold", rc("month", "returned"))}` : ""}

    <h4>${icon("loan", 16)} Loan history</h4>
    ${renderLoanHistory(s.loans)}
  `;
}

/* ---------------- Family links ----------------
   A read-only link to one student's report card for their family — see
   "Parent view" in data-money.js. A student can share their own; a teacher
   can make one for any student in the class, or for everyone at once. */
function openFamilyModal(title, bodyHtml) {
  document.getElementById("familyModalTitle").innerHTML = icon("users", 20) + " " + escapeHtml(title);
  document.getElementById("familyModalBody").innerHTML = bodyHtml;
  document.getElementById("familyModal").classList.remove("hidden");
}

function closeFamilyModal() {
  document.getElementById("familyModal").classList.add("hidden");
}

const FAMILY_LINK_EXPLAINER = `<p class="muted-small">Anyone with this link can see this report card. No login needed, and they can't change anything. It updates whenever the student or their teacher uses the site. Only share it with family.</p>`;

function familyLinkBoxHtml(url, username) {
  return `
    ${FAMILY_LINK_EXPLAINER}
    <label for="familyLinkInput">Family link</label>
    <input id="familyLinkInput" readonly value="${escapeHtml(url)}" onclick="this.select()">
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn gold" onclick="copyFamilyLink(this, document.getElementById('familyLinkInput').value)">${icon("send", 15)} Copy link</button>
      <a class="btn secondary" href="${escapeHtml(url)}" target="_blank" rel="noopener">Preview</a>
      <button class="btn coral" onclick="turnOffFamilyLinkClick('${escapeJsAttr(username)}')">Turn link off</button>
    </div>
    <div id="familyLinkMsg"></div>`;
}

async function copyFamilyLink(btn, text) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (e) {
    const input = document.getElementById("familyLinkInput");
    if (input) {
      input.select();
      try { copied = document.execCommand("copy"); } catch (e2) { copied = false; }
    }
  }
  t29Toast(copied ? "Link copied. Paste it into a message or email." : "Couldn't copy automatically. Select the link and copy it.", { type: copied ? "success" : "info" });
}

async function showFamilyLinkFor(username, name) {
  openFamilyModal(`Family link: ${name}`, `<p class="muted-small"><span class="t29-spinner"></span> Making the link…</p>`);
  const res = await createParentLink(username);
  if (!res.ok) {
    document.getElementById("familyModalBody").innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`;
    return;
  }
  document.getElementById("familyModalBody").innerHTML = familyLinkBoxHtml(res.url, username);
}

// Teacher: show exactly what a family would see for this student, built from the same
// summary and the same page code as a real family link (see parent.js) — but
// without making or saving anything, so it can be checked BEFORE sharing.
async function previewFamilyViewFor(username) {
  const modal = document.getElementById("familyPreviewModal");
  const body = document.getElementById("familyPreviewBody");
  document.getElementById("familyPreviewTitle").innerHTML = icon("users", 20) + " Family view preview";
  document.getElementById("familyPreviewActions").innerHTML = "";
  body.innerHTML = `<p class="muted-small"><span class="t29-spinner"></span> Building the preview…</p>`;
  modal.classList.remove("hidden");
  try {
    const [cls, students] = await Promise.all([getClass(CLASS_CODE), getClassStudents(CLASS_CODE)]);
    const student = students.find(s => s.username === username);
    if (!cls || !student) throw new Error("not found");
    const teacher = await getClassTeacherDisplay(cls).catch(() => null);
    const doc = { view: _buildParentView(student, cls, teacher ? teacher.name : ""), updatedAt: Date.now() };
    document.getElementById("familyPreviewTitle").innerHTML = icon("users", 20) + " Family view preview: " + escapeHtml(student.name || student.username);
    body.innerHTML = pvBuildReportHtml(doc, { preview: true });
    document.getElementById("familyPreviewActions").innerHTML = `
      <button class="btn small gold" onclick="closeFamilyPreview();showFamilyLinkFor('${escapeJsAttr(student.username)}', '${escapeJsAttr(student.name || student.username)}')">Looks good. Make the family link</button>`;
    modal.scrollTop = 0;
  } catch (e) {
    console.error(e);
    body.innerHTML = `<div class="error-msg">Couldn't build the preview. Please try again.</div>`;
  }
}

function closeFamilyPreview() {
  document.getElementById("familyPreviewModal").classList.add("hidden");
  document.getElementById("familyPreviewBody").innerHTML = "";
}

function previewModalStudentFamilyView() {
  if (!MODAL_STUDENT) return;
  previewFamilyViewFor(MODAL_STUDENT.username);
}

function showMyFamilyLink() {
  showFamilyLinkFor(CURRENT.username, "my report card");
}

function showModalStudentFamilyLink() {
  if (!MODAL_STUDENT) return;
  showFamilyLinkFor(MODAL_STUDENT.username, MODAL_STUDENT.name);
}

async function turnOffFamilyLinkClick(username) {
  if (!await t29Confirm("Turn this link off? Anyone who has it won't be able to open it any more. You can make a new link later.")) return;
  const res = await turnOffParentLink(username);
  if (!res.ok) {
    const msg = document.getElementById("familyLinkMsg");
    if (msg) msg.innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`;
    return;
  }
  t29Toast("Link turned off.", { type: "success" });
  if (IS_TEACHER && document.getElementById("familyClassList")) await openClassFamilyLinks();
  else closeFamilyModal();
}

// Teacher: every student's link in one place — handy before parent
// interviews or a newsletter.
async function openClassFamilyLinks() {
  openFamilyModal("Family links", `<p class="muted-small"><span class="t29-spinner"></span> Loading…</p>`);
  const students = (await getClassStudents(CLASS_CODE)).slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  if (!students.length) {
    document.getElementById("familyModalBody").innerHTML = `<p class="muted-small">No students in this class yet.</p>`;
    return;
  }
  const withLinks = students.filter(s => s.parentViewToken);
  document.getElementById("familyModalBody").innerHTML = `
    ${FAMILY_LINK_EXPLAINER}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      ${withLinks.length < students.length ? `<button class="btn small gold" onclick="makeAllFamilyLinks(this)">Make links for everyone</button>` : ""}
      ${withLinks.length ? `<button class="btn small secondary" onclick="copyAllFamilyLinks()">Copy all links</button>` : ""}
    </div>
    <div id="familyClassList">
      ${students.map(s => `
        <div class="auto-row">
          <div class="auto-details"><strong>${escapeHtml(s.name)}</strong>
            <div class="muted-small">${s.parentViewToken ? "Link is on" : "No link yet"}</div></div>
          <button class="btn small secondary" onclick="previewFamilyViewFor('${escapeJsAttr(s.username)}')">Preview</button>
          ${s.parentViewToken
            ? `<button class="btn small secondary" onclick="copyFamilyLink(this, '${escapeJsAttr(parentViewUrl(s.parentViewToken))}')">Copy</button>
               <button class="btn small coral" onclick="turnOffFamilyLinkClick('${escapeJsAttr(s.username)}')">Turn off</button>`
            : `<button class="btn small gold" onclick="makeOneFamilyLink(this, '${escapeJsAttr(s.username)}')">Make link</button>`}
        </div>`).join("")}
    </div>
    <div id="familyLinkMsg"></div>`;
}

async function makeOneFamilyLink(btn, username) {
  btn.disabled = true;
  const res = await createParentLink(username);
  if (!res.ok) { btn.disabled = false; alert(res.error); return; }
  await openClassFamilyLinks();
}

async function makeAllFamilyLinks(btn) {
  btn.disabled = true;
  btn.innerHTML = `<span class="t29-spinner"></span> Making links…`;
  const students = await getClassStudents(CLASS_CODE);
  let failed = 0;
  for (const s of students) {
    if (s.parentViewToken) continue;
    const res = await createParentLink(s.username);
    if (!res.ok) failed++;
  }
  await openClassFamilyLinks();
  if (failed) alert(`${failed} link${failed === 1 ? "" : "s"} couldn't be made. Please try again.`);
}

async function copyAllFamilyLinks() {
  const students = (await getClassStudents(CLASS_CODE)).filter(s => s.parentViewToken)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const text = students.map(s => `${s.name}: ${parentViewUrl(s.parentViewToken)}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    t29Toast(`Copied ${students.length} link${students.length === 1 ? "" : "s"}. One per line, with each student's name.`, { type: "success" });
  } catch (e) {
    alert(text);
  }
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

// Downloads the same report as an actual .pdf file rather than going
// through the browser's print dialog. Which report depends on what's on
// screen, exactly like printReport() above: the open student modal wins,
// then a teacher gets the whole class, and a student gets their own card.
// See pdf-report.js for the writer itself.
async function downloadReportPDF() {
  if (!VIEWED_REPORT) return;
  const modalOpen = !document.getElementById("reportModal").classList.contains("hidden");
  if (modalOpen && MODAL_STUDENT) {
    downloadStudentReportPDF(MODAL_STUDENT, VIEWED_REPORT);
    return;
  }
  if (IS_TEACHER) {
    const cls = await getClassCached(CLASS_CODE);
    downloadClassReportPDF(VIEWED_REPORT, (cls && cls.name) || "Class report");
    return;
  }
  const me = (VIEWED_REPORT.students || []).find(x => x.username === CURRENT.username);
  if (!me) { alert("There's no report data to download yet."); return; }
  downloadStudentReportPDF(me, VIEWED_REPORT);
}

function reportToRows(report) {
  const rows = [["Name", "Username", "Net worth", "Cash", "Savings", "Term deposits", "KiwiSaver", "Gambling account", "Invested", "Property", "Vehicles", "Store items",
    "Owed", "Income (this month)", "Saved/invested (see accounting version; net in v2)", "Spent (this month)", "Borrowed (this month)", "Savings rate %", "Top expense category", "Top expense amount",
    "Income (all-time)", "Saved/invested (all-time; net in v2)", "Spent (all-time)", "Borrowed (all-time)", "Returned money/sale proceeds (this month)", "Accounting version", "Earlier history complete"]];
  (report.students || []).forEach(s => rows.push([
    s.name, s.username, s.netWorth, s.balance, s.savings, s.termDeposits, s.kiwiSaver || 0, s.gamblingBalance || 0, s.invested, s.propertyValue, s.vehicleValue, s.storeValue,
    s.owed, s.incomeTotal, s.savedTotal, s.spentTotal, s.borrowedTotal, s.savingsRate === null ? "" : s.savingsRate,
    s.topExpenseCategory ? s.topExpenseCategory.category : "", s.topExpenseCategory ? s.topExpenseCategory.amount : "",
    s.lifetimeIncomeTotal, s.lifetimeSavedTotal, s.lifetimeSpentTotal, s.lifetimeBorrowedTotal,
    s.returnedTotal ?? "", s.accountingVersion || 1, s.historyComplete === false ? "No" : s.accountingVersion === 2 ? "Yes" : "Unknown"
  ]));
  return rows;
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(v => {
    let text = String(v === undefined || v === null ? "" : v);
    if (typeof v === "string" && /^\s*[=+\-@]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
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
  downloadCSV(reportToRows(VIEWED_REPORT), `report-${safeFilenamePart(CLASS_CODE)}-current.csv`);
}

document.addEventListener("DOMContentLoaded", init);
