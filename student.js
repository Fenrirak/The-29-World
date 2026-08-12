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
  // getUserCached and getClassCached are independent reads — CURRENT.classCode
  // is already known without needing `me` first, so fetch both at once
  // instead of waiting on one before starting the other.
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);

  document.getElementById("greeting").textContent = "Hi, " + me.name + "!";
  document.getElementById("balance").textContent = fmtMoney(me.balance);
  document.getElementById("portfolio").textContent = fmtMoney(await portfolioValue(me.username, me.classCode));

  const job = cls.jobs.find(j => j.id === me.jobId);
  document.getElementById("jobLabel").textContent = job ? `${job.title} — ${fmtMoney(job.wage)}/payday` : "No job assigned";

  const lockedModules = await getLockedModulesForStudent(me.username, me.classCode);
  applyModuleLocks(lockedModules);

  await renderSideHustle(me, cls, lockedModules);

  // Fetch the class roster once and reuse it for both the leaderboard and
  // the classmates table below — these used to each independently call
  // getClassStudents(), which batches one Firestore read PER STUDENT, so
  // every render() was reading every student in the class twice over.
  const allStudents = await getClassStudents(me.classCode, cls);

  // net worth leaderboard
  const board = await classLeaderboard(me.classCode, me.username, allStudents);

  const cfg = cls.lifestyleConfig || {};
  const anyEnabled = ["property", "store", "insurance", "transport", "loan"].some(k => cfg[k] && cfg[k].enabled);
  document.getElementById("lifestyleCard").classList.toggle("hidden", !anyEnabled);
  if (anyEnabled) {
    const score = await lifestyleRating(me.username, me.classCode);
    // Pass the leaderboard we already built above instead of having
    // lifestyleBandForStudent() recompute it (another full-class re-read).
    const label = await lifestyleBandForStudent(me.username, me.classCode, board);
    const isOverride = me.lifestyleOverride !== undefined && me.lifestyleOverride !== null;
    document.getElementById("lifestyleValue").textContent =
      score + (label ? " — " + label : "") + (isOverride ? " (set by teacher)" : "");
  }
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
        <div class="leaderboard-sub">${fmtMoney(row.balance)} cash + ${fmtMoney(row.invested)} invested${row.storeValue ? ` + ${fmtMoney(row.storeValue)} items` : ""}${row.savings ? ` + ${fmtMoney(row.savings)} savings` : ""}${row.owed ? ` - ${fmtMoney(row.owed)} owed` : ""}</div>
      </div>
      <div class="leaderboard-net">${fmtMoney(row.net)}</div>
    `;
    lbBox.appendChild(div);
  });

  // classmates (reuses allStudents fetched above for the leaderboard)
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
  const teacher = await getUserCached(cls.teacher);
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
    else if (["stock-sell", "stock-close", "wage", "interest", "cash-interest", "bonus", "welcome", "property-sell", "vehicle-sell", "store-sell", "term-deposit-mature", "term-deposit-early", "insurance-claim", "side-hustle", "store-gift"].includes(t.type)) { sign = "+"; }
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

/* ---------------- Lifestyle-based module locks ---------------- */
function applyModuleLocks(locked) {
  applyNavModuleLocks(locked);
  const banner = document.getElementById("lifestyleLockBanner");
  const lockedLabels = [];
  document.querySelectorAll("nav a[data-module]").forEach(a => {
    if (locked.includes(a.dataset.module)) {
      const labelEl = a.querySelector(".nav-label");
      lockedLabels.push(labelEl ? labelEl.textContent : a.dataset.module);
    }
  });
  if (locked.includes("sidehustle")) lockedLabels.push("Side hustle");

  if (lockedLabels.length === 0) {
    banner.classList.add("hidden");
  } else {
    banner.classList.remove("hidden");
    banner.innerHTML = `<p style="margin:0;"><strong>Some modules are locked</strong><br>Your lifestyle rating is too low right now to use: ${lockedLabels.join(", ")}. Ask your teacher what's needed to unlock them.</p>`;
  }
}

/* ---------------- Side hustle ----------------
   Rewritten as a single explicit state machine so there's exactly one
   place that decides what's on screen, instead of several toggle() calls
   that can drift out of sync. States:
     "locked"   — lifestyle rating too low, module locked by teacher
     "empty"    — teacher hasn't added any side hustles yet
     "pick"     — student has no hustle yet (first-ever pick, no approval needed)
     "request"  — student has a hustle, is requesting a change (needs approval)
     "active"   — student has a hustle and isn't currently editing it
   sh() is a tiny helper that warns loudly in the console instead of
   silently failing if an expected element is missing from the page. */
function sh(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[side hustle] expected #${id} in the page but it's missing`);
  return el;
}

let SH_MODE_REQUEST = false; // true once the student clicks "Request a change"
let SH_HUSTLES = []; // cached from the latest render, used by the pay preview

function populateSideHustleHourSelect() {
  const sel = sh("shHour");
  if (!sel || sel.options.length) return;
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

function shSetBlock(state) {
  const blocks = { locked: "shLockedBlock", empty: "shEmptyBlock", pick: "shPickBlock", request: "shPickBlock", active: "shActiveBlock" };
  ["shLockedBlock", "shEmptyBlock", "shPickBlock", "shActiveBlock"].forEach(id => {
    const el = sh(id);
    if (el) el.classList.toggle("hidden", blocks[state] !== id);
  });
}

async function renderSideHustle(me, cls, lockedModules) {
  populateSideHustleHourSelect();
  const hustles = cls.sideHustles || [];
  const isLocked = (lockedModules || []).includes("sidehustle");

  if (isLocked) { shSetBlock("locked"); return; }
  if (hustles.length === 0) { shSetBlock("empty"); return; }
  SH_HUSTLES = hustles;

  const sel = sh("shSelect");
  if (sel) {
    sel.innerHTML = "";
    hustles.forEach(h => {
      const opt = document.createElement("option");
      opt.value = h.id;
      opt.textContent = h.name;
      sel.appendChild(opt);
    });
  }

  const myHustle = me.sideHustle;
  const current = myHustle && hustles.find(h => h.id === myHustle.hustleId);
  const request = me.sideHustleRequest;
  const hasPendingRequest = !!(request && request.status === "pending");

  const state = !current ? "pick" : (SH_MODE_REQUEST ? "request" : "active");
  shSetBlock(state);

  if (state === "pick" || state === "request") {
    const intro = sh("shPickIntro");
    if (intro) intro.textContent = state === "pick"
      ? "Pick a side hustle and the hour you'll check in every day. You must check in within 15 minutes after your chosen hour to get paid."
      : "Request a new side hustle or check-in hour. Your teacher has to approve the change before it applies — your current hustle keeps working until they do.";
    const saveBtn = sh("shSaveBtn");
    if (saveBtn) saveBtn.textContent = state === "pick" ? "Save my side hustle" : "Request this change";
    const cancelBtn = sh("shCancelBtn");
    if (cancelBtn) cancelBtn.classList.toggle("hidden", state === "pick");
    if (sel && myHustle && myHustle.hustleId) sel.value = myHustle.hustleId;
    const hourSel = sh("shHour");
    if (hourSel && myHustle && myHustle.checkinHour !== undefined) hourSel.value = myHustle.checkinHour;
    shUpdatePayPreview();
    return;
  }

  // state === "active"
  const pendingNote = sh("shPendingNote");
  if (pendingNote) pendingNote.classList.toggle("hidden", !hasPendingRequest);
  if (hasPendingRequest) {
    const reqHustle = hustles.find(h => h.id === request.hustleId);
    const pendingText = sh("shPendingText");
    if (pendingText) pendingText.textContent =
      `Waiting on your teacher to approve your request to switch to ${reqHustle ? reqHustle.name : "a new hustle"} at ${hourLabel(request.checkinHour)}. Your current hustle still applies until then.`;
  }

  const denialEl = sh("shDenialNote");
  if (denialEl) {
    if (me.sideHustleDenialNote) {
      denialEl.classList.remove("hidden");
      denialEl.innerHTML = `<span class="badge coral">Change request denied</span> <span class="muted-small">${me.sideHustleDenialNote}</span>`;
    } else {
      denialEl.classList.add("hidden");
    }
  }

  const nameEl = sh("shName"); if (nameEl) nameEl.textContent = current.name;
  const windowEl = sh("shWindow"); if (windowEl) windowEl.textContent = sideHustleWindowLabel(myHustle.checkinHour);
  const pay = Number(current.payouts[myHustle.checkinHour]) || 0;
  const payEl = sh("shPay"); if (payEl) payEl.textContent = fmtMoney(pay);

  const { hour, minute } = nzHourMinute();
  const inWindow = hour === myHustle.checkinHour && minute <= 15;
  const already = myHustle.lastCheckin === nzDateKey();
  const checkinBtn = sh("shCheckinBtn");
  if (checkinBtn) checkinBtn.disabled = !inWindow || already;
  const statusEl = sh("shStatus");
  if (statusEl) {
    if (already) statusEl.textContent = `You've checked in today. Streak: ${myHustle.streak || 0} day${(myHustle.streak || 0) === 1 ? "" : "s"}.`;
    else if (inWindow) statusEl.textContent = "You're in your check-in window — go ahead!";
    else statusEl.textContent = `Come back at ${hourLabel(myHustle.checkinHour)} to check in.`;
  }
  const changeBtn = sh("shChangeBtn");
  if (changeBtn) changeBtn.classList.toggle("hidden", hasPendingRequest);
}

// Reads straight from the currently selected hustle's payouts — works
// automatically for hustles the teacher already created and any new ones
// added later, since it's not hardcoded to specific hustles or amounts.
function shUpdatePayPreview() {
  const preview = sh("shPayPreview");
  if (!preview) return;
  const selEl = sh("shSelect"), hourEl = sh("shHour");
  if (!selEl || !hourEl) return;
  const hustle = SH_HUSTLES.find(h => h.id === selEl.value);
  const hour = Number(hourEl.value);
  if (!hustle) { preview.textContent = ""; return; }
  const pay = Number(hustle.payouts[hour]) || 0;
  preview.textContent = `Checking in at ${hourLabel(hour)} for ${hustle.name} pays ${fmtMoney(pay)}.`;
}

function shStartChangeRequest() {
  SH_MODE_REQUEST = true;
  render();
}

function shCancelPick() {
  SH_MODE_REQUEST = false;
  const msg = sh("shPickMsg");
  if (msg) msg.textContent = "";
  render();
}

async function shSaveChoice() {
  const hustleId = sh("shSelect").value;
  const hour = sh("shHour").value;
  const msg = sh("shPickMsg");
  if (msg) msg.textContent = "Saving...";
  const res = await requestSideHustleChange(CURRENT.username, CURRENT.classCode, hustleId, hour);
  if (!res.ok) { if (msg) msg.textContent = res.error; return; }
  if (msg) msg.textContent = res.pending ? "Request sent — waiting on your teacher to approve it." : "";
  SH_MODE_REQUEST = false;
  await render();
}

async function shDoCheckin() {
  const btn = sh("shCheckinBtn");
  if (btn) btn.disabled = true;
  const res = await checkinSideHustle(CURRENT.username, CURRENT.classCode);
  const statusEl = sh("shStatus");
  if (statusEl) {
    statusEl.textContent = res.ok
      ? `Checked in! +${fmtMoney(res.amount)}. Streak: ${res.streak} day${res.streak === 1 ? "" : "s"}.`
      : res.error;
  }
  await render();
}

async function openLifestyleBreakdown() {
  const modal = document.getElementById("lifestyleModal");
  const body = document.getElementById("lifestyleModalBody");
  body.innerHTML = `<p class="muted-small">Loading...</p>`;
  modal.classList.remove("hidden");

  const [breakdown, label] = await Promise.all([
    lifestyleRatingBreakdown(CURRENT.username, CURRENT.classCode),
    lifestyleBandForStudent(CURRENT.username, CURRENT.classCode)
  ]);

  document.getElementById("lifestyleModalTitle").innerHTML =
    icon("star", 20) + ` Lifestyle rating: ${breakdown.total}${label ? " — " + label : ""}`;

  if (breakdown.overridden) {
    body.innerHTML = `<p class="muted-small">Your teacher has set this score manually, so it isn't calculated from what you own — it's fixed at <strong>${breakdown.total}</strong> until they change or clear it.</p>`;
    return;
  }

  if (breakdown.items.length === 0) {
    body.innerHTML = `<p class="muted-small">Nothing is affecting your score yet — property, a vehicle, store items, or insurance can raise it.</p>`;
    return;
  }

  const gains = breakdown.items.filter(i => i.type === "gain");
  const losses = breakdown.items.filter(i => i.type === "loss");
  const rows = arr => arr.length
    ? arr.map(i => `
        <div class="auto-row">
          <div class="auto-details">${i.label}<div class="muted-small">${i.detail}</div></div>
          <div class="${i.type === "gain" ? "status-approved" : "status-declined"}">${i.type === "gain" ? "+" : "-"}${i.points}</div>
        </div>
      `).join("")
    : `<p class="muted-small">None right now.</p>`;

  body.innerHTML = `
    <div class="grid grid-2" style="align-items:start;">
      <div>
        <h4>${icon("star", 14)} Adding to your score</h4>
        ${rows(gains)}
      </div>
      <div>
        <h4>${icon("coin", 14)} Taking away from your score</h4>
        ${rows(losses)}
      </div>
    </div>
  `;
}

function closeLifestyleBreakdown() {
  document.getElementById("lifestyleModal").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", init);
