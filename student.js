let CURRENT;

function badgeType(type) {
  const map = {
    welcome: ["navy", "star", "Welcome"],
    wage: ["mint", "briefcase", "Wage"],
    interest: ["gold", "piggy", "Savings interest"],
    "cash-interest": ["gold", "coin", "Cash interest"],
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
    "savings-deposit": ["mint", "piggy", "Savings deposit"], "savings-withdraw": ["gold", "piggy", "Savings withdrawal"],
    "loan-taken": ["navy", "vault", "Loan"], "loan-repayment": ["mint", "vault", "Loan repayment"],
    "side-hustle": ["mint", "briefcase", "Side hustle"]
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

function paintChrome() {
  paintIconSlots();
  document.getElementById("iconBalance").innerHTML = icon("piggy", 30);
  document.getElementById("iconPortfolio").innerHTML = icon("chart", 30);
  document.getElementById("iconJob").innerHTML = icon("briefcase", 30);
  document.getElementById("iconLifestyle").innerHTML = icon("star", 30);
  document.getElementById("hLeaderboard").innerHTML = icon("medal", 18) + " Net worth ranking";
  document.getElementById("hBank").innerHTML = icon("bank", 18) + " Bank account";
  document.getElementById("hClassmates").innerHTML = icon("users", 18) + " My classmates";
  document.getElementById("hMarket").innerHTML = icon("chart", 18) + " Market snapshot";
  document.getElementById("hActivity").innerHTML = icon("bank", 18) + " My recent activity (last 3 days)";
  document.getElementById("bankLink").innerHTML = icon("piggy", 14) + " Go to Bank";
  document.getElementById("marketLink").innerHTML = icon("chart", 14) + " Go to Stock Market";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  if (u.role !== "student") { window.location.href = "teacher.html"; return; }
  CURRENT = u;
  document.getElementById("whoami").textContent = u.name;
  paintChrome();
  // Fire any wages or automatic payments that have come due since last visit
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  await Promise.all([
    autoPayDayIfDue(u.classCode),
    processAutomations(u.classCode),
    processMortgages(u.classCode),
    processTermDeposits(u.classCode),
    autoInterestIfDue(u.classCode),
    processInsurancePayments(u.classCode),
    processWeeklyEvents(u.classCode),
    processWeeklyBigEvents(u.classCode)
  ]);
  // These popups read the results of the jobs above (e.g. a weekly event
  // that just got generated), so they still need to run afterwards — but
  // they stay sequential since each checks "is another popup already
  // showing" before deciding to show its own.
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await checkAdjustmentPopup(u.username, u.classCode);
  await render();
  // Keeps the side hustle check-in window (and everything else) in sync
  // with the clock even if the student just leaves the tab open.
  setInterval(render, 30000);
}

async function render() {
  const me = await getUser(CURRENT.username);
  const cls = await getClass(me.classCode);

  document.getElementById("greeting").textContent = "Hi, " + me.name + "!";
  document.getElementById("balance").textContent = fmtMoney(me.balance);
  document.getElementById("portfolio").textContent = fmtMoney(await portfolioValue(me.username, me.classCode));

  const job = cls.jobs.find(j => j.id === me.jobId);
  document.getElementById("jobLabel").textContent = job ? `${job.title} — ${fmtMoney(job.wage)}/payday` : "No job assigned";

  const cfg = cls.lifestyleConfig || {};
  const anyEnabled = ["property", "store", "insurance", "transport"].some(k => cfg[k] && cfg[k].enabled);
  document.getElementById("lifestyleCard").classList.toggle("hidden", !anyEnabled);
  if (anyEnabled) {
    const score = await lifestyleRating(me.username, me.classCode);
    const label = lifestyleLabelFor(score, cls.lifestyleThresholds);
    document.getElementById("lifestyleValue").textContent = score + " / 100" + (label ? " — " + label : "");
  }

  await renderSideHustle(me, cls);

  // net worth leaderboard
  const board = await classLeaderboard(me.classCode);
  const medalClass = i => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "");
  const lbBox = document.getElementById("leaderboardList");
  lbBox.innerHTML = "";
  board.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "leaderboard-row" + (row.username === me.username ? " me" : "");
    div.innerHTML = `
      <span class="rank-pill ${medalClass(i)}">${i + 1}</span>
      <span class="student-avatar ${avatarClass(row.username)}">${initials(row.name)}</span>
      <div style="flex:1;">
        <div class="leaderboard-name">${row.name}${row.username === me.username ? " (you)" : ""}</div>
        <div class="leaderboard-sub">${fmtMoney(row.balance)} cash + ${fmtMoney(row.invested)} invested${row.storeValue ? ` + ${fmtMoney(row.storeValue)} items` : ""}${row.savings ? ` + ${fmtMoney(row.savings)} savings` : ""}${row.owed ? ` − ${fmtMoney(row.owed)} owed` : ""}</div>
      </div>
      <div class="leaderboard-net">${fmtMoney(row.net)}</div>
    `;
    lbBox.appendChild(div);
  });

  // classmates
  const allStudents = await getClassStudents(me.classCode);
  const classmates = allStudents.filter(s => s.username !== me.username);
  const ctbl = document.getElementById("classmateTable");
  ctbl.innerHTML = "";
  classmates.forEach(s => {
    const j = cls.jobs.find(jj => jj.id === s.jobId);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><span class="student-avatar ${avatarClass(s.username)}">${initials(s.name)}</span>${s.name}</td><td>${j ? j.title : "—"}</td>`;
    ctbl.appendChild(tr);
  });

  // market snapshot
  const mbody = document.getElementById("marketSnapshot");
  mbody.innerHTML = "";
  document.getElementById("noCompanies").classList.toggle("hidden", cls.companies.length > 0);
  cls.companies.forEach(co => {
    const mine = co.holders[me.username] || 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${co.name}</td><td>${fmtMoney(co.price)}</td><td>${mine}</td>`;
    mbody.appendChild(tr);
  });

  // my transactions — last 3 days only (txns carry a raw "ts" epoch-ms
  // alongside the display "date" string; very old entries from before
  // "ts" existed don't have one, so those are kept rather than hidden).
  const activityCutoff = Date.now() - 3 * 24 * 3600 * 1000;
  const my = cls.txns
    .filter(t => (t.to === me.username || t.from === me.username) && (t.ts === undefined || t.ts >= activityCutoff))
    .slice(0, 200);
  document.getElementById("noTxns").classList.toggle("hidden", my.length > 0);
  const tbody = document.getElementById("txnTable");
  tbody.innerHTML = "";
  const nameCache = {};
  for (const s of allStudents) nameCache[s.username] = s.name;
  const teacher = await getUser(cls.teacher);
  if (teacher) nameCache[teacher.username] = teacher.name;
  const nameOf = u => nameCache[u] || u;
  my.forEach(t => {
    let detail = t.note || "";
    let amt = t.amount;
    let sign = "";
    if (t.type === "transfer" || t.type === "automation") {
      if (t.from === me.username) { detail = "To " + nameOf(t.to) + (t.note ? " — " + t.note : (t.type === "automation" ? " — automatic payment" : "")); sign = "-"; }
      else { detail = "From " + nameOf(t.from) + (t.note ? " — " + t.note : (t.type === "automation" ? " — automatic payment" : "")); sign = "+"; }
    } else if (t.type === "stock-buy") { sign = "-"; }
    else if (["stock-sell", "stock-close", "wage", "interest", "cash-interest", "bonus", "welcome", "property-sell", "vehicle-sell", "store-sell", "term-deposit-mature", "term-deposit-early", "insurance-claim", "side-hustle"].includes(t.type)) { sign = "+"; }
    else if (["fine", "insurance-buy", "store-buy", "mortgage", "property-buy", "vehicle-buy", "term-deposit-open", "insurance-premium", "savings-deposit", "loan-repayment"].includes(t.type)) { sign = "-"; }
    else if (["savings-withdraw", "loan-taken"].includes(t.type)) { sign = "+"; }
    else if (t.type === "event") { sign = amt < 0 ? "-" : "+"; amt = Math.abs(amt); }
    else if (t.type === "gambling") { sign = t.note.includes("WON") ? "+" : "-"; }
    else if (t.type === "big-event") { sign = amt > 0 ? "-" : ""; }

    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted-small">${t.date}</td><td>${badgeType(t.type)}</td><td>${detail}</td>
      <td class="${sign === '-' ? 'ticker-down' : 'ticker-up'}">${sign}${fmtMoney(amt)}</td>`;
    tbody.appendChild(tr);
  });
}

/* ---------------- Side hustle ---------------- */
let SH_EDITING = false;

function populateSideHustleHourSelect() {
  const sel = document.getElementById("shHour");
  if (sel.options.length) return;
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement("option");
    opt.value = h;
    opt.textContent = hourLabel(h);
    sel.appendChild(opt);
  }
}

// e.g. "4pm – 4:15pm"
function sideHustleWindowLabel(h) {
  const period = h < 12 ? "am" : "pm";
  let hh = h % 12; if (hh === 0) hh = 12;
  return `${hourLabel(h)} – ${hh}:15${period}`;
}

async function renderSideHustle(me, cls) {
  populateSideHustleHourSelect();
  const hustles = cls.sideHustles || [];
  document.getElementById("noSideHustles").classList.toggle("hidden", hustles.length > 0);
  const picker = document.getElementById("sideHustlePicker");
  const active = document.getElementById("sideHustleActive");
  if (hustles.length === 0) {
    picker.classList.add("hidden");
    active.classList.add("hidden");
    return;
  }

  const sel = document.getElementById("shSelect");
  sel.innerHTML = "";
  hustles.forEach(h => {
    const opt = document.createElement("option");
    opt.value = h.id;
    opt.textContent = h.name;
    sel.appendChild(opt);
  });

  const sh = me.sideHustle;
  const current = sh && hustles.find(h => h.id === sh.hustleId);

  if (current && !SH_EDITING) {
    picker.classList.add("hidden");
    active.classList.remove("hidden");
    document.getElementById("shName").textContent = current.name;
    document.getElementById("shWindow").textContent = sideHustleWindowLabel(sh.checkinHour);
    const pay = Number(current.payouts[sh.checkinHour]) || 0;
    document.getElementById("shPay").textContent = fmtMoney(pay);

    const { hour, minute } = nzHourMinute();
    const inWindow = hour === sh.checkinHour && minute <= 15;
    const already = sh.lastCheckin === nzDateKey();
    const btn = document.getElementById("shCheckinBtn");
    btn.disabled = !inWindow || already;
    const statusEl = document.getElementById("shStatus");
    if (already) statusEl.textContent = `You've checked in today. Streak: ${sh.streak || 0} day${(sh.streak || 0) === 1 ? "" : "s"}.`;
    else if (inWindow) statusEl.textContent = "You're in your check-in window — go ahead!";
    else statusEl.textContent = `Come back at ${hourLabel(sh.checkinHour)} to check in.`;
  } else {
    picker.classList.remove("hidden");
    active.classList.add("hidden");
    if (sh && sh.hustleId) sel.value = sh.hustleId;
    if (sh && sh.checkinHour !== undefined) document.getElementById("shHour").value = sh.checkinHour;
  }
}

function toggleSideHustleEdit() {
  SH_EDITING = true;
  render();
}

async function saveSideHustleChoice() {
  const hustleId = document.getElementById("shSelect").value;
  const hour = document.getElementById("shHour").value;
  const msg = document.getElementById("shPickerMsg");
  msg.textContent = "Saving...";
  const res = await setStudentSideHustle(CURRENT.username, CURRENT.classCode, hustleId, hour);
  if (!res.ok) { msg.textContent = res.error; return; }
  msg.textContent = "";
  SH_EDITING = false;
  await render();
}

async function doSideHustleCheckin() {
  document.getElementById("shCheckinBtn").disabled = true;
  const res = await checkinSideHustle(CURRENT.username, CURRENT.classCode);
  const statusEl = document.getElementById("shStatus");
  statusEl.textContent = res.ok
    ? `Checked in! +${fmtMoney(res.amount)}. Streak: ${res.streak} day${res.streak === 1 ? "" : "s"}.`
    : res.error;
  await render();
}

document.addEventListener("DOMContentLoaded", init);
