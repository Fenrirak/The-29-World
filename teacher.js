let CURRENT, CLASS_CODE, PROFILE_USER, EDITING_EVENT_ID = null;
let PRESENCE = {}, PRESENCE_LOADED = false, PRESENCE_AT = 0, PRESENCE_INFLIGHT = null, PRESENCE_TIMER = null, PRESENCE_STUDENTS = [];
let LAST_STUDENTS = []; // roster snapshot from the last render(), reused by "pay all" so it doesn't need its own fetch

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
  document.getElementById("payDayBtn").innerHTML = icon("briefcase", 15) + " Run Pay Day";
  document.getElementById("interestBtn").innerHTML = icon("percent", 15) + " Apply Interest";
  document.getElementById("studentViewBtn").innerHTML = icon("eye", 15) + " View as student";
  document.getElementById("iconStudents").innerHTML = icon("users", 30);
  document.getElementById("iconNetWorth").innerHTML = icon("wallet", 30);
  document.getElementById("classArchivedIcon").innerHTML = icon("lock", 15);
  // Same icon as the Stock Market page and menu.
  document.getElementById("iconCompanies").innerHTML = icon("chart", 30);
  document.getElementById("hStudents").innerHTML = icon("users", 18) + " Students" + '<span id="onlineCount" class="online-pill" hidden aria-live="polite"></span>';
  document.getElementById("hNetWorth").innerHTML = icon("medal", 18) + " Net worth ranking";
  document.getElementById("hAdjust").innerHTML = icon("coin", 18) + " Quick transactions";
  document.getElementById("hSettings").innerHTML = icon("settings", 18) + " Class settings";
  document.getElementById("hWelcome").innerHTML = icon("sparkle", 18) + " Welcome grant";
  document.getElementById("hTimeLimit").innerHTML = icon("hourglass", 18) + " Daily time limit";
  document.getElementById("hExport").innerHTML = icon("download", 18) + " Export this class";
  document.getElementById("hDanger").innerHTML = icon("repeat", 18) + " Restart class";
  document.getElementById("saveWelcomeBtn").innerHTML = icon("save", 14) + " Save welcome grant";
  document.getElementById("saveDailyTimeLimitBtn").innerHTML = icon("save", 14) + " Save time limit";
  document.getElementById("exportPdfBtn").innerHTML = icon("download", 15) + " Download as PDF";
  document.getElementById("exportMdBtn").innerHTML = icon("download", 15) + " Download as Markdown";
  document.getElementById("restartBtn").innerHTML = icon("repeat", 15) + " Restart class";
  document.getElementById("hActivity").innerHTML = icon("history", 18) + " Recent activity";
  document.getElementById("labAdjStudent").innerHTML = icon("users", 13) + " Student";
  document.getElementById("labAdjAmount").innerHTML = icon("coin", 13) + " Amount (negative for a fine)";
  document.getElementById("labAdjNote").innerHTML = icon("note", 13) + " Reason";
  document.getElementById("applyAdjBtn").innerHTML = icon("send", 15) + " Apply";
  document.getElementById("hEvents").innerHTML = icon("sparkle", 18) + " Random weekly events";
  document.getElementById("runEventsNowBtn").innerHTML = icon("sparkle", 14) + " Run this week's events now";
  // The "Add event" form's labels are plain text (set in teacher.html) — no icons.
  document.getElementById("addEventBtn").innerHTML = icon("plus", 15) + " Add event";
  document.getElementById("hLifestyle").innerHTML = icon("star", 18) + " Lifestyle rating settings";
  document.getElementById("saveLifestyleBtn").innerHTML = icon("save", 14) + " Save lifestyle settings";
  document.getElementById("hThresholds").innerHTML = icon("star", 18) + " Lifestyle rating bands";
  document.getElementById("addThresholdBtn").innerHTML = icon("plus", 13) + " Add band";
  document.getElementById("saveThresholdsBtn").innerHTML = icon("save", 14) + " Save bands";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  if (u.role !== "teacher") { window.location.href = "student.html"; return; }
  CURRENT = u;
  CLASS_CODE = u.classCode;
  await t29SvRecoverStale(u); // clears what a student view left behind if its tab was closed without exiting
  // A teacher with no active class (e.g. they just deleted it, or their
  // account somehow has no classCode set) should land on Home to pick or
  // create one, instead of this page crashing on a null class doc.
  if (!CLASS_CODE) { window.location.href = "teacher-home.html"; return; }
  const clsCheck = await getClassCached(CLASS_CODE);
  if (!clsCheck) { window.location.href = "teacher-home.html"; return; }
  document.getElementById("whoami").textContent = t29DisplayName(u);
  paintChrome();
  enablePasswordToggles();
  // BUGFIX: get a server-trustworthy "now" before any of the day-gated
  // jobs below decide "has this already run today?" — see
  // syncServerClock in data-core.js for why a device's own clock isn't good
  // enough for that check (a teacher's dashboard reload triggers these
  // same class-wide jobs, same as a student's page does). Started here,
  // in parallel with the first paint below, so it doesn't add to the time
  // before the page first paints; only the jobs themselves wait for it.
  const T29_CLOCK_SYNC = syncServerClock(CLASS_CODE);
  // Kick the day's jobs off but DON'T block the page on them: paint what
  // we already have first, then wait. On the first load of the day pay day
  // alone can take seconds (it writes per student), and blocking here is
  // what made a phone sit on a blank page. The popups and the final
  // render() below still run after the jobs, exactly as they did before.
  // PERF: the first paint and the day's jobs now run side by side instead of
  // one after the other (the jobs only wait for the clock sync, not for the
  // paint), and reads they share are fetched once. The paint is tracked so a
  // failed one still gets redrawn below.
  let firstPaintOk = true;
  const T29_FIRST_PAINT = t29FirstPaint(async () => {
    try { await render(); } catch (e) { firstPaintOk = false; throw e; }
  });
  await T29_CLOCK_SYNC;
  // Writes are counted (see _anwOnWriteSettled in data-core.js) so the final
  // redraw below only happens when a job actually changed something.
  const T29_WRITES_BEFORE = window._t29WriteSeq || 0;
  // Same reasoning as the other pages: these are 8 independent jobs, so
  // running them together instead of one-at-a-time avoids 8 sequential
  // network round-trips on page load.
  const T29_STARTUP_JOBS = Promise.all([
    safeBgJob(payDayForClassIfDue(CLASS_CODE), "payDayForClassIfDue"),
    safeBgJob(dailyLifeAllowanceForClassIfDue(CLASS_CODE), "dailyLifeAllowanceForClassIfDue"),
    safeBgJob(processAutomations(CLASS_CODE), "processAutomations"),
    safeBgJob(processTermDeposits(CLASS_CODE), "processTermDeposits"),
    safeBgJob(applyInterestToClassIfDue(CLASS_CODE), "applyInterestToClassIfDue"),
    safeBgJob(kiwiSaverReturnsForClassIfDue(CLASS_CODE), "kiwiSaverReturnsForClassIfDue"),
    safeBgJob(processInsurancePayments(CLASS_CODE), "processInsurancePayments"),
    safeBgJob(processWeeklyEvents(CLASS_CODE), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(CLASS_CODE), "processWeeklyBigEvents"),
    safeBgJob(processLoanInterest(CLASS_CODE), "processLoanInterest"),
    safeBgJob(processCreditCards(CLASS_CODE), "processCreditCards"),
    safeBgJob(processJobPromotions(CLASS_CODE), "processJobPromotions")
  ]);
  await Promise.all([T29_FIRST_PAINT, T29_STARTUP_JOBS]);
  await checkWeeklyEventPopup(CURRENT.username, CLASS_CODE);
  await checkBigEventPopup(CURRENT.username, CLASS_CODE);
  await checkAdjustmentPopup(CURRENT.username, CLASS_CODE);
  // PERF: this second full render re-reads every student, so skip it on the
  // common day when no job or popup wrote anything (what's on screen is
  // already current). Still runs if anything was written or the paint failed.
  if (!firstPaintOk || (window._t29WriteSeq || 0) !== T29_WRITES_BEFORE) await render();
  startPresencePolling();
  if (typeof t29MaybeStartTour === "function") t29MaybeStartTour("teacher", CURRENT);
}

async function render() {
  const cls = await getClassCached(CLASS_CODE);
  t29SelfHealClassSummary(CLASS_CODE, cls); // best effort; never delays the page
  document.getElementById("className").textContent = cls.name;
  document.getElementById("classCode").textContent = cls.code;
  document.getElementById("classArchivedBanner").classList.toggle("hidden", !cls.archived);
  const welcomeEl = document.getElementById("welcomeGrant");
  if (document.activeElement !== welcomeEl) welcomeEl.value = t29WelcomeGrantOf(cls);
  document.getElementById("dailyTimeLimit").value = cls.dailyTimeLimitMinutes || "";
  document.getElementById("restartTile").classList.toggle("hidden", cls.teacher !== CURRENT.username);
  renderCoTeachers(cls).catch(e => console.warn("Co-teacher panel failed:", e));

  // PERF: the teacher's display name is fetched alongside the students, not after them.
  const teacherP = getClassTeacherDisplay(cls);
  teacherP.catch(() => {}); // surfaced where it's awaited below
  // Pass the class doc already in hand, so this doesn't read it again first.
  const students = await getClassStudents(CLASS_CODE, cls);
  document.getElementById("statStudents").textContent = students.length;
  document.getElementById("statCompanies").textContent = cls.companies.length;

  // Time exemption requests (students out of time asking for more — see
  // requestTimeExemption/decideTimeExemption in data-markets.js). Surfaced as a
  // banner right at the top of the dashboard rather than tucked into
  // settings, since it needs prompt attention.
  const timePending = students.filter(s => timeExemptionState(s) === "pending");
  const banner = document.getElementById("timeExemptionBanner");
  banner.classList.toggle("hidden", timePending.length === 0);
  const bannerList = document.getElementById("timeExemptionBannerList");
  bannerList.innerHTML = "";
  timePending.forEach(s => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;";
    row.innerHTML = `
      <div>${icon("bell", 15)} <strong>${escapeHtml(s.name)}</strong> has requested more time. They're out for today.</div>
      <div class="row-flex" style="gap:8px;">
        <button class="btn small gold" onclick="approveTimeExemptionRequest('${escapeJsAttr(s.username)}')">Accept</button>
        <button class="btn small coral" onclick="declineTimeExemptionRequest('${escapeJsAttr(s.username)}')">Decline</button>
      </div>
    `;
    bannerList.appendChild(row);
  });

  // name lookup cache for describeTxn / applications
  const nameCache = {};
  students.forEach(s => { nameCache[s.username] = s.name; });
  const teacher = await teacherP;
  if (teacher) nameCache[teacher.username] = teacher.name;

  // net worth ranking (also gives us each student's lifestyle rating for the table below)
  // Pass in `students` (already fetched above) so this doesn't re-run the
  // batched per-student Firestore read a second time.
  const board = await classLeaderboard(CLASS_CODE, undefined, students);
  // Total class net worth: every student's net worth (cash, savings, shares, property, vehicles,
  // KiwiSaver and more, minus what they owe) added together — the same figures as the ranking below.
  document.getElementById("statTotal").textContent = fmtMoney(board.reduce((sum, r) => sum + (Number(r.net) || 0), 0));
  const lifestyleByUser = {};
  const lifestyleBandByUser = {};
  // PERF: worked out from the class and students already in hand. lifestyleRating()
  // re-fetched each student, and on a slow connection its 2-second read cache had
  // expired by then, so it re-read the whole class a second time.
  const lsCls = withNewModuleDefaults(cls);
  students.forEach(s => { lifestyleByUser[s.username] = lifestyleRatingFromData(lsCls, s, s.username); });
  students.forEach(s => {
    const row = board.find(r => r.username === s.username);
    // Stacked total across every property the student owns, not just one,
    // plus its living-in bonus stars when they're actually living in it
    // (rather than renting it out) — matching lifestyleBandForStudent in
    // the data-*.js files, so this table's band agrees with what the student sees on
    // their own property page. This total can legitimately exceed 5.
    const ownedProperties = (cls.properties || []).filter(p => p.owner === s.username);
    const ownedVehicles = (cls.vehicles || []).filter(v => (v.owners || []).includes(s.username));
    const stats = {
      netWorth: row ? row.net : 0,
      propertyComfort: ownedProperties.reduce((sum, p) => sum + (p.comfort || 0) + (p.occupancy === "living" ? (Number(p.livingBonusStars) || 0) : 0), 0),
      // Best single vehicle, not a total — transport stars don't stack
      // (same as lifestyleBandForStudent, so both views show one band).
      transportComfort: ownedVehicles.reduce((best, v) => Math.max(best, v.comfort || 0), 0)
    };
    lifestyleBandByUser[s.username] = lifestyleLabelFor(lifestyleByUser[s.username], cls.lifestyleThresholds || [], stats);
  });

  const nwBox = document.getElementById("netWorthList");
  nwBox.innerHTML = "";
  const avById = {}; students.forEach(s => { avById[s.username] = s; });
  const medalClass = i => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "");
  board.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "leaderboard-row";
    div.innerHTML = leaderboardRowHtml(row, i, { avatarSource: avById[row.username] || row, medal: medalClass(i) });
    nwBox.appendChild(div);
  });
  leaderboardWireTaps(nwBox);

  // students table
  const netByUser = {};
  board.forEach(r => { netByUser[r.username] = r.net; });
  const tbody = document.querySelector("#studentTable tbody");
  tbody.innerHTML = "";
  document.getElementById("noStudents").classList.toggle("hidden", students.length > 0);
  students.forEach(s => {
    const tr = document.createElement("tr");
    tr.dataset.search = ((s.name || "") + " " + (s.username || "")).toLowerCase();
    tr.innerHTML = `
      <td><div class="stack-val student-id-cell">${avatarBadge(s)}<div class="student-id-text">${escapeHtml(s.name)}<span class="presence-dot" data-user="${escapeHtml(s.username)}" title="Offline"></span><div class="muted-small">@${escapeHtml(s.username)}</div></div></div></td>
      <td><div class="stack-val">${jobSelectHtml(cls, s)}${s.jobId ? (() => { const _j = (cls.jobs || []).find(jj => jj.id === s.jobId); const _t = _j ? getStudentTier(_j, s) : null; return `<div class="muted-small">${_t ? `<span class="tier-micro-badge">${escapeHtml(_t.name)}</span> ` : ""}${_j && jobLogType(_j) !== "tasks" ? (a => `Logged ${a.done}/${a.expected}`)(wageAttendance(cls, s)) : isJobTaskApprovedThisWeek(s, cls) ? `Task ✓` : `Task ✗`}</div>`; })() : ""}</div></td>
      <td><div class="stack-val"><strong>${fmtMoney(s.balance)}</strong></div></td>
      <td><div class="stack-val">${lifestyleByUser[s.username]}${lifestyleBandByUser[s.username] ? `<div class="muted-small">${lifestyleBandByUser[s.username]}</div>` : ""}</div></td>
      <td><div class="stack-val">${fmtMoney(netByUser[s.username] || 0)}</div></td>
      <td class="stack-actions">
        <button class="btn small secondary" onclick="quickView('${escapeJsAttr(s.username)}')">View</button>
        <button class="btn small coral" aria-label="Remove ${escapeHtml(s.name)}" title="Remove student" onclick="removeStudentClick('${escapeJsAttr(s.username)}', '${escapeJsAttr(s.name)}')">${icon("trash", 13)}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Online now / last opened: paint what we already have, then refresh from the one presence
  // doc (a no-op if it was read in the last 30s, so busy re-renders don't re-read it).
  PRESENCE_STUDENTS = students;
  paintPresence();
  refreshPresence(false).then(paintPresence);

  // Search box: only worth showing once the class is long enough to need scrolling.
  const stuFilter = document.getElementById("studentFilter");
  if (stuFilter) {
    stuFilter.classList.toggle("hidden", students.length <= 8);
    if (students.length <= 8) stuFilter.value = "";
    filterStudentRows();
  }

  // random events
  const evBox = document.getElementById("eventList");
  const evs = cls.eventDefs || [];
  document.getElementById("noEvents").classList.toggle("hidden", evs.length > 0);
  // The list sits in a fold (closed by default) so a class with lots of events doesn't make the page huge.
  document.getElementById("eventListFold").classList.toggle("hidden", evs.length === 0);
  document.getElementById("eventListTitle").textContent = `Your events (${evs.length})`;
  evBox.innerHTML = "";
  evs.forEach(ev => {
    const row = document.createElement("div");
    row.className = "auto-row";
    const middle = ev.type === "choice"
      ? `&middot; <span class="badge lilac">Multiple choice</span> &middot; ${(ev.options || []).map(o => `${escapeHtml(o.label)} (${eventAmountText(o.amount, o.percent, ev.amountBase)})${o.outcome ? `: ${escapeHtml(o.outcome)}` : ""}`).join(", ")}`
      : `&middot; ${eventAmountText(ev.amount, ev.amountMode === "percent" ? ev.amountPercent : 0, ev.amountBase)}`;
    row.innerHTML = `
      <div class="auto-details">${icon("sparkle", 14)} <strong>${escapeHtml(ev.name)}</strong>
        ${middle}
        &middot; ${ev.repeatable ? "Can repeat" : "Once per student"}
        &middot; <span class="badge ${ev.severity === 'bad' ? 'coral' : 'navy'}">${ev.severity === 'bad' ? 'Bad' : 'Neutral'}</span>
        ${ev.description ? `<div class="muted-small">${escapeHtml(ev.description)}</div>` : ""}
        ${ev.severity === 'bad' ? `<div class="muted-small">${icon("shield", 12)} ${weeklyEventInsuranceText(ev)}</div>` : ""}
      </div>
      <button class="btn small secondary" onclick="startEditEvent('${ev.id}')">${icon("edit", 13)} Edit</button>
      <button class="btn small coral" onclick="removeEvent('${ev.id}')">${icon("trash", 13)} Remove</button>
    `;
    evBox.appendChild(row);
  });
  paintEventReco(cls);

  // lifestyle settings
  const cfg = cls.lifestyleConfig || {
    property: { enabled: true, weight: 4 }, store: { enabled: true, weight: 2 },
    insurance: { enabled: true, weight: 2 }, transport: { enabled: true, weight: 3 }
  };
  const lsBox = document.getElementById("lifestyleSettings");
  lsBox.className = "grid grid-4";
  const lsSections = [
    { key: "property", label: "Property (house comfort)" },
    { key: "transport", label: "Transport (comfiest vehicle)" },
    { key: "store", label: "Store items owned" },
    { key: "insurance", label: "Insurance plans owned" }
  ];
  lsBox.innerHTML = lsSections.map(s => `
    <div class="card" style="margin-bottom:0;box-shadow:none;border:1.5px solid var(--line);">
      <label style="display:flex;align-items:center;gap:8px;margin-top:0;">
        <input type="checkbox" id="ls-${s.key}-on" ${cfg[s.key] && cfg[s.key].enabled ? "checked" : ""} style="width:20px;height:20px;min-height:auto;">
        ${escapeHtml(s.label)}
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
      ${escapeHtml(m.label)}
    </label>
  `).join("");

  // adjustment select
  LAST_STUDENTS = students;
  const sel = document.getElementById("adjStudent");
  const allOpt = students.length ? `<option value="__ALL__">All students (${students.length})</option>` : "";
  // Blank "Choose…" first so nobody (least of all "All students") is picked
  // by default; a pick already made survives a re-render.
  const prevPick = sel.value;
  const choose = students.length ? `<option value="" disabled selected>Choose a student…</option>` : "";
  sel.innerHTML = choose + allOpt + students.map(s => `<option value="${escapeHtml(s.username)}">${escapeHtml(s.name)}</option>`).join("");
  if (prevPick && [...sel.options].some(o => o.value === prevPick)) sel.value = prevPick;

  // txns — the teacher dashboard shows however many transactions are
  // currently stored (up to MAX_STORED_TXNS), independent of the student
  // dashboard's own 3-day window on the same underlying array. cls.txns is
  // stored newest-first (logTxn unshifts), so the first MAX_STORED_TXNS
  // matching entries already ARE "the most recent" — no extra sort needed.
  // Individual gambling bets ("gambling") are filtered out here — they now
  // have their own dedicated, class-wide list on the Gambling module's
  // Account tab (see renderTeacherGamblingRecent in gambling.js) — but
  // buy-ins/cash-outs still show up here like any other cash movement.
  const txbody = document.querySelector("#txnTable tbody");
  txbody.innerHTML = "";
  const nameOf = u => nameCache[u] || u;
  const recentTxns = (cls.txns || []).filter(t => t.type !== "gambling").slice(0, MAX_STORED_TXNS);
  document.getElementById("hActivity").innerHTML = icon("history", 18) + ` Recent activity (last ${MAX_STORED_TXNS} transactions)`;
  // Coloured from the student's side (green = money in to them, red =
  // out of them). Money passed between two students is left plain.
  const BETWEEN_STUDENTS = ["transfer", "automation", "p2p-buy", "p2p-sell", "property-rent-pay", "property-rent-receive"];
  recentTxns.forEach(t => {
    const who = t.to && t.to !== cls.teacher ? t.to : t.from;
    const dir = BETWEEN_STUDENTS.includes(t.type) ? { sign: "", amount: Math.abs(Number(t.amount) || 0) } : txnDirection(t, who);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="muted-small">${t.date}</td><td>${badge(t.type)}</td><td>${describeTxn(t, nameOf)}</td><td class="${moneyClass(dir.sign)}">${fmtSignedMoney(dir.sign, dir.amount)}</td>`;
    txbody.appendChild(tr);
  });
}

function jobSelectHtml(cls, student) {
  let opts = `<option value="">No job</option>`;
  (cls.jobs || []).forEach(j => {
    opts += `<option value="${j.id}" ${student.jobId === j.id ? "selected" : ""}>${escapeHtml(j.title)}</option>`;
  });
  return `<select onchange="onAssignJob('${escapeJsAttr(student.username)}', this.value)">${opts}</select>`;
}

function describeTxn(t, nameOf) {
  switch (t.type) {
    case "welcome": return escapeHtml(`${nameOf(t.to)} joined the class`);
    case "wage": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "interest": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "bonus": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "fine": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "transfer": return escapeHtml(`${nameOf(t.from)} → ${nameOf(t.to)} ${t.note ? ": " + t.note : ""}`);
    case "automation": return escapeHtml(`${nameOf(t.from)} → ${nameOf(t.to)}: ${t.note || "Automatic payment"}`);
    case "stock-buy": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "stock-sell": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "stock-close": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "insurance-buy": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "store-buy": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "store-sell": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "property-buy": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "property-sell": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "mortgage": case "mortgage-extra": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "event": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "vehicle-buy": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "vehicle-sell": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "transport-expense": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "term-deposit-open": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "term-deposit-early": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "term-deposit-mature": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "gambling": return escapeHtml(`${nameOf(t.to || t.from)}: ${t.note}`);
    case "gambling-buyin": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "gambling-cashout": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "big-event": return escapeHtml(`${nameOf(t.to || t.from)}: ${t.note}`);
    case "insurance-claim": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "insurance-premium": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "cash-interest": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "savings-deposit": return escapeHtml(`${nameOf(t.from)}: ${t.note || "Deposited into Savings Account"}`);
    case "savings-withdraw": return escapeHtml(`${nameOf(t.to)}: ${t.note || "Withdrew from Savings Account"}`);
    case "account-close": return escapeHtml(`${nameOf(t.to)}: ${t.note || "Closed an account"}`);
    case "loan-taken": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "loan-repayment": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "loan-interest": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "card-purchase": case "card-payment": case "card-interest": case "card-fee": case "account-fee": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "card-cashback": case "card-statement": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "side-hustle": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "truck-drive": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "store-gift": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "quiz-reward": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "property-rent": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "property-rent-pay": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "property-rent-receive": return escapeHtml(`${nameOf(t.to)} ← ${nameOf(t.from)}: ${t.note}`);
    case "p2p-buy": return escapeHtml(`${nameOf(t.from)} → ${nameOf(t.to)}: ${t.note}`);
    case "p2p-sell": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "truck-licence-buy": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "insurance-signup-fee": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "property-occupancy": return escapeHtml(`${nameOf(t.to || t.from)}: ${t.note}`);
    case "life-grant": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "life-revoke": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "life-allowance": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    case "kiwisaver-in": return escapeHtml(`${nameOf(t.from)}: ${t.note}`);
    case "kiwisaver-out": case "kiwisaver-refund": return escapeHtml(`${nameOf(t.to)}: ${t.note}`);
    default: return escapeHtml(t.note || "");
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
    "mortgage": ["coral", "house", "Mortgage"], "mortgage-extra": ["coral", "house", "Extra mortgage payment"],
    "event": ["lilac", "dice", "Random event"],
    "vehicle-buy": ["navy", "car", "Vehicle"], "vehicle-sell": ["gold", "car", "Vehicle sold"],
    "transport-expense": ["coral", "car", "Transport expenses"],
    "term-deposit-open": ["lilac", "vault", "Term deposit"], "term-deposit-early": ["coral", "vault", "Early withdrawal"],
    "term-deposit-mature": ["mint", "vault", "Deposit matured"],
    "gambling": ["gold", "dice", "Gambling"],
    "gambling-buyin": ["gold", "dice", "Gambling buy-in"], "gambling-cashout": ["mint", "dice", "Gambling cash-out"],
    "big-event": ["coral", "star", "Big event"],
    "insurance-claim": ["mint", "shield", "Insurance claim"], "insurance-premium": ["coral", "shield", "Premium"],
    "cash-interest": ["gold", "coin", "Cash interest"],
    "account-close": ["gold", "piggy", "Account closed"], "savings-deposit": ["mint", "piggy", "Savings deposit"], "savings-withdraw": ["gold", "piggy", "Savings withdrawal"],
    "loan-taken": ["navy", "loan", "Loan"], "loan-repayment": ["mint", "loan", "Loan repayment"],
    "card-purchase": ["navy", "cards", "Card purchase"], "card-payment": ["mint", "cards", "Card payment"],
    "card-interest": ["coral", "cards", "Card interest"], "card-fee": ["coral", "cards", "Card fee"], "account-fee": ["coral", "coin", "Account fee"],
    "card-cashback": ["mint", "cards", "Cashback"], "card-statement": ["gold", "cards", "Statement"],
    "loan-interest": ["coral", "loan", "Loan interest"],
    "life-grant": ["gold", "trophy", "Life event"], "life-revoke": ["coral", "trophy", "Life event removed"],
    "life-allowance": ["mint", "trophy", "Life allowance"],
    "side-hustle": ["mint", "briefcase", "Side hustle"],
    "truck-drive": ["mint", "car", "Truck drive"],
    "store-gift": ["mint", "cart", "Free item"],
    "quiz-reward": ["mint", "idcard", "Quiz passed"],
    "property-rent": ["mint", "house", "Rent received"],
    "property-rent-pay": ["coral", "house", "Rent paid"],
    "property-rent-receive": ["mint", "house", "Rent received"],
    "p2p-buy": ["navy", "users", "Bought from a classmate"],
    "p2p-sell": ["gold", "users", "Sold to a classmate"],
    "truck-licence-buy": ["navy", "car", "Truck licence"],
    "insurance-signup-fee": ["lilac", "shield", "Insurance sign-up"],
    "property-occupancy": ["navy", "house", "Occupancy change"],
    "kiwisaver-in": ["navy", "kiwi", "KiwiSaver"], "kiwisaver-out": ["mint", "kiwi", "KiwiSaver withdrawal"],
    "kiwisaver-refund": ["gold", "kiwi", "KiwiSaver refund"]
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
  await assignJob(username, jobId, CLASS_CODE);
  await render();
}

async function giveAdjustment(e) {
  e.preventDefault();
  // Same double-submit guard used elsewhere for money-moving forms — matters
  // even more here since "pay all" fires off one write per student in a row.
  const btn = document.getElementById("applyAdjBtn");
  if (btn.disabled) return false;
  btn.disabled = true;
  try {
    const student = document.getElementById("adjStudent").value;
    const amount = parseMoneyInput(document.getElementById("adjAmount").value);
    const note = document.getElementById("adjNote").value.trim();
    const box = document.getElementById("adjMsg");
    if (!student) {
      box.innerHTML = `<div class="error-msg">Choose who this is for.</div>`;
      return false;
    }
    if (Number.isNaN(amount) || amount === 0) {
      box.innerHTML = `<div class="error-msg">Enter an amount.</div>`;
      return false;
    }

    if (student === "__ALL__") {
      const targets = LAST_STUDENTS;
      if (!targets.length) {
        box.innerHTML = `<div class="error-msg">There are no students in this class yet.</div>`;
        return false;
      }
      if (!await t29Confirm(`${amount >= 0 ? "Give" : "Take"} ${fmtMoney(Math.abs(amount))} ${amount >= 0 ? "to" : "from"} all ${targets.length} students?`)) {
        box.innerHTML = "";
        return false;
      }
      // Sequential on purpose: these all touch the same class document, so
      // firing them at once risks a lost update (one write clobbering
      // another's). One at a time is a little slower but never loses money.
      let okCount = 0;
      const failedNames = [];
      for (const s of targets) {
        const res = await teacherAdjust(CURRENT.username, s.username, amount, note);
        if (res.ok) okCount++; else failedNames.push(s.name);
      }
      if (okCount === targets.length) {
        box.innerHTML = `<div class="success-msg">Done: ${fmtMoney(Math.abs(amount))} ${amount >= 0 ? "given to" : "taken from"} all ${okCount} students.</div>`;
        document.getElementById("adjAmount").value = "";
        document.getElementById("adjNote").value = "";
        document.getElementById("adjStudent").value = "";
      } else if (okCount > 0) {
        box.innerHTML = `<div class="error-msg">${fmtMoney(Math.abs(amount))} ${amount >= 0 ? "given to" : "taken from"} ${okCount} of ${targets.length} students. Failed for: ${failedNames.map(escapeHtml).join(", ")}.</div>`;
      } else {
        box.innerHTML = `<div class="error-msg">Couldn't apply this to any students. Please try again.</div>`;
      }
    } else {
      const res = await teacherAdjust(CURRENT.username, student, amount, note);
      if (res.ok) {
        const who = (LAST_STUDENTS.find(x => x.username === student) || {}).name || student;
        box.innerHTML = `<div class="success-msg">Done: ${fmtMoney(Math.abs(amount))} ${amount >= 0 ? "given to" : "taken from"} ${escapeHtml(who)}.</div>`;
        document.getElementById("adjAmount").value = "";
        document.getElementById("adjNote").value = "";
        document.getElementById("adjStudent").value = "";
      } else {
        box.innerHTML = `<div class="error-msg">${res.error}</div>`;
      }
    }
    await render();
    return false;
  } finally {
    btn.disabled = false;
  }
}

// What a weekly event's percentage is of (matches EVENT_PERCENT_BASES in data-life.js).
const EVENT_BASE_TEXT = {
  income: "the student's weekly wage",
  property: "a property's present market price",
  transport: "a vehicle's present price"
};
// An event amount for the list: "+$5.00" / "-$10.00", or "-20% of a vehicle's present price".
function eventAmountText(amount, percent, base) {
  const p = Number(percent) || 0;
  if (!p) return `${amount >= 0 ? "+" : ""}${fmtMoney(amount)}`;
  return `${p > 0 ? "+" : "-"}${Math.abs(p)}% of ${EVENT_BASE_TEXT[base] || "the item's present cost"}`;
}

// Event list line saying which insurance can claim a bad weekly event.
function weeklyEventInsuranceText(ev) {
  const coverage = ["property", "transport"].includes(ev.coverage) ? ev.coverage : "general";
  if (coverage === "general") return "Claimable on General insurance";
  const label = coverage === "property" ? "Property" : "Transport";
  const happened = incidentLabels(coverage, ev.incident, "label").join(" + ");
  return (happened ? `${escapeHtml(happened)} &middot; ` : "")
    + ((ev.insuranceCover || []).length
      ? `${label} insurance: ${escapeHtml(insuranceCoverSummary(coverage, ev.insuranceCover, ev.incident))} (plus the plan's excess)`
      : `Any ${coverage} insurance plan that covers this pays the full cost (minus the excess)`);
}

// Shows "which insurance can claim it" only for bad events, plus the
// insurance-types picker when that's property or transport. Pass `cover`
// to load an event's saved types (when editing); without it the picker is
// only rebuilt when the coverage actually changes, so it keeps the ticks
// (including while it's hidden by switching to Neutral and back).
function updateEventCoverBox(cover, incident) {
  updateEventBaseBox();
  const bad = document.getElementById("evSeverity").value === "bad";
  document.getElementById("evCoverWrap").classList.toggle("hidden", !bad);
  const coverage = document.getElementById("evCoverage").value;
  const box = document.getElementById("evCoverBox");
  if (cover === undefined && (box.dataset.coverage || "") === (INSURANCE_TYPES[coverage] ? coverage : "")) return;
  renderInsuranceCoverPicker("evCoverBox", coverage, cover || [], incident || null);
}

async function addEventForm(e) {
  e.preventDefault();
  const type = document.getElementById("evType").value;
  const severity = document.getElementById("evSeverity").value;
  const picked = severity === "bad" ? readInsuranceCoverPicker("evCoverBox") : { incident: null, cover: [] };
  if (picked === null) return false;
  const ev = {
    name: document.getElementById("evName").value.trim(),
    type,
    repeatable: document.getElementById("evRepeat").checked,
    severity,
    coverage: severity === "bad" ? document.getElementById("evCoverage").value : "general",
    insuranceCover: picked.cover,
    incident: picked.incident,
    description: document.getElementById("evDesc").value.trim()
  };
  if (type === "choice") {
    const lines = document.getElementById("evOptionsArea").value.split("\n").map(l => l.trim()).filter(Boolean);
    const options = [];
    for (const line of lines) {
      const [label, amt, outcome] = line.split("|");
      if (!(label || "").trim()) continue;
      // "-20%" = a percentage of the item's present cost (worked out when the event happens).
      const amtText = String(amt === undefined ? "" : amt).trim().replace(/[\u2212\u2013]/g, "-");
      if (amtText.endsWith("%")) {
        const pct = parseMoneyInput(amtText.slice(0, -1));
        if (!Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 1000) {
          alert(`Couldn't read the percentage for "${(label || "").trim()}". Enter something like -20% or 15% (between -1000% and 1000%, not 0).`);
          return false;
        }
        options.push({ label: label.trim(), amount: 0, percent: pct, outcome: (outcome || "").trim() });
        continue;
      }
      const parsed = parseMoneyInput(amt);
      if (Number.isNaN(parsed)) {
        alert(`Couldn't read the amount for "${(label || "").trim()}". Enter a plain number like -10 or 5 (no currency symbols needed).`);
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
    if (options.some(o => o.percent)) ev.amountBase = document.getElementById("evBase").value;
  } else if (document.getElementById("evAmountMode").value === "percent") {
    const rawPct = document.getElementById("evPercent").value.trim();
    const pct = Number(rawPct);
    if (rawPct === "" || !Number.isFinite(pct) || pct === 0 || Math.abs(pct) > 1000) {
      alert("Enter a percentage between -1000 and 1000 (not 0). Negative for a cost, like -20.");
      return false;
    }
    ev.amountMode = "percent";
    ev.amountPercent = pct;
    ev.amountBase = document.getElementById("evBase").value;
    ev.amount = 0;
  } else {
    const rawAmt = document.getElementById("evAmount").value;
    if (rawAmt === "") {
      alert("Enter an amount for this event.");
      return false;
    }
    const parsed = parseMoneyInput(rawAmt);
    if (Number.isNaN(parsed)) {
      alert("Couldn't read that amount. Enter a plain number like -10 or 5 (no currency symbols needed).");
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
  document.getElementById("evPercent").value = "";
  document.getElementById("evAmountMode").value = "fixed";
  document.getElementById("evBase").selectedIndex = 0;
  document.getElementById("evOptionsArea").value = "";
  document.getElementById("evDesc").value = "";
  document.getElementById("evRepeat").checked = false;
  document.getElementById("evSeverity").value = "neutral";
  document.getElementById("evCoverage").value = "general";
  updateEventCoverBox([]);
  document.getElementById("evType").value = "fixed";
  toggleEventType();
  document.getElementById("addEventBtn").innerHTML = icon("plus", 15) + " Add event";
  document.getElementById("eventFoldTitle").textContent = "Add an event";
  document.getElementById("eventFold").open = false;
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
    document.getElementById("evCoverage").value = ["property", "transport"].includes(ev.coverage) ? ev.coverage : "general";
    updateEventCoverBox(ev.insuranceCover || [], ev.incident || null);
    document.getElementById("evRepeat").checked = !!ev.repeatable;
    document.getElementById("evDesc").value = ev.description || "";
    if (ev.type === "choice") {
      // BUGFIX: this used to run the label through escapeHtml() before
      // writing it into the textarea. A textarea's .value is plain text,
      // not HTML, so escaping there is both wrong to look at AND
      // destructive: submitEventForm() (above) reads this exact textarea
      // back and saves whatever is in it, so an option labelled
      // "Don't pay" came back as "Don&#39;t pay", got saved that way, and
      // was escaped AGAIN into "Don&amp;#39;t pay" the next time round —
      // corrupting a little further on every edit. Escaping belongs at
      // render time (where the label is dropped into innerHTML), never on
      // the way into a form field.
      document.getElementById("evOptionsArea").value = (ev.options || [])
        .map(o => `${o.label} | ${o.percent ? o.percent + "%" : o.amount}${o.outcome ? " | " + o.outcome : ""}`).join("\n");
    } else {
      document.getElementById("evAmount").value = ev.amountMode === "percent" ? "" : ev.amount;
    }
    document.getElementById("evAmountMode").value = ev.type !== "choice" && ev.amountMode === "percent" ? "percent" : "fixed";
    document.getElementById("evPercent").value = ev.amountMode === "percent" && ev.amountPercent ? ev.amountPercent : "";
    if (ev.amountBase) document.getElementById("evBase").value = ev.amountBase;
    toggleEventType();
    document.getElementById("addEventBtn").innerHTML = icon("save", 15) + " Save changes";
    document.getElementById("eventFoldTitle").textContent = "Edit event";
    document.getElementById("eventFold").open = true;
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
  const choice = document.getElementById("evType").value === "choice";
  const percent = !choice && document.getElementById("evAmountMode").value === "percent";
  document.getElementById("evAmountWrap").classList.toggle("hidden", choice);
  document.getElementById("evFixedWrap").classList.toggle("hidden", percent);
  document.getElementById("evPercentWrap").classList.toggle("hidden", !percent);
  document.getElementById("evOptionsWrap").classList.toggle("hidden", !choice);
  updateEventBaseBox();
}

// "The percentage is of…" — shown for a percentage amount, and for multiple
// choice events (whose choices can be written as percentages). An event tied
// to property or transport insurance always takes it from that same
// property/vehicle, so the picker is hidden then.
function updateEventBaseBox() {
  const choice = document.getElementById("evType").value === "choice";
  const percent = !choice && document.getElementById("evAmountMode").value === "percent";
  const bad = document.getElementById("evSeverity").value === "bad";
  const coverage = bad ? document.getElementById("evCoverage").value : "general";
  const linked = coverage === "property" || coverage === "transport";
  document.getElementById("evBaseBox").classList.toggle("hidden", !(choice || percent));
  document.getElementById("evBaseSelectWrap").classList.toggle("hidden", linked);
  document.getElementById("evBaseHint").textContent =
    (linked ? `It's taken from the present ${coverage === "property" ? "market price of the property" : "price of the vehicle"} the event hits (see the insurance choice below). ` : "")
    + (choice ? "Only used for choices written as a percentage, like -20%. " : "")
    + "It's worked out when the event happens, from what that is worth at that moment, so only students who have one can get this event.";
}

/* ---------------- Recommended random events ----------------
   For a class built from scratch: the same real-life events the base template ships, offered to add one
   at a time or all at once. Amounts are sized for the term choice (scaled like the base template).
   Added ones are ordinary events the teacher can edit, pause or remove. The panel is gone once every
   one has been added; it can be dismissed (remembered on this device) and brought back. */
let EV_RECO_TERMS = 4;
const evRecoKey = () => "t29-ev-reco-dismissed:" + (CLASS_CODE || "");
function evRecoDismissed() { try { return localStorage.getItem(evRecoKey()) === "1"; } catch (e) { return false; } }
function evDismissReco(on) {
  try { if (on) localStorage.setItem(evRecoKey(), "1"); else localStorage.removeItem(evRecoKey()); } catch (e) { /* ignore */ }
  getClassCached(CLASS_CODE).then(paintEventReco);
}
function evSetRecoTerms(v) {
  EV_RECO_TERMS = [1, 2, 4].includes(Number(v)) ? Number(v) : 4;
  getClassCached(CLASS_CODE).then(paintEventReco);
}
function evRecoRemaining(cls) {
  const have = new Set((cls.eventDefs || []).map(e => String(e.name || "").trim().toLowerCase()));
  return t29BaseTemplateEventInputs(EV_RECO_TERMS).filter(r => !have.has(r.name.toLowerCase()));
}
function evRecoWhoText(r) {
  if (r.severity !== "bad") return "";
  if (r.coverage === "transport") return "Vehicle owners only";
  if (r.coverage === "property") return "Home owners and renters only";
  return "";
}
function paintEventReco(cls) {
  const wrap = document.getElementById("eventRecoWrap");
  if (!wrap) return;
  const left = evRecoRemaining(cls);
  if (!left.length) { wrap.innerHTML = ""; return; }
  if (evRecoDismissed()) {
    wrap.innerHTML = `<p class="muted-small"><a href="#" onclick="evDismissReco(false);return false;">Show recommended events</a></p>`;
    return;
  }
  wrap.innerHTML = `<div class="card qz-reco-panel">
    <div class="qz-reco-head">
      <h2>${icon("sparkle", 18)} Recommended events</h2>
      <span class="qz-reco-actions">
        <select onchange="evSetRecoTerms(this.value)" aria-label="Size the amounts for" style="width:auto;margin:0;">
          <option value="1" ${EV_RECO_TERMS === 1 ? "selected" : ""}>Sized for 1 term</option>
          <option value="2" ${EV_RECO_TERMS === 2 ? "selected" : ""}>Sized for 2 terms</option>
          <option value="4" ${EV_RECO_TERMS === 4 ? "selected" : ""}>Sized for a full year</option>
        </select>
        <button class="btn small gold" type="button" onclick="evAddAllReco()">+ Add all ${left.length} remaining</button>
        <button class="btn small secondary" type="button" onclick="evDismissReco(true)">Dismiss</button>
      </span>
    </div>
    <p class="muted-small">Real-life events students can run into, from small wins to everyday costs, with insurance claims already set up. Add the ones you like and edit anything afterwards.</p>
    <div class="qz-reco-grid" style="max-height:460px;overflow:auto;padding-right:4px;">${left.map(r => `
      <div class="qz-reco-item">
        <div><strong>${escapeHtml(r.name)}</strong><span class="muted-small">${escapeHtml(r.description)}</span></div>
        <div class="quiz-meta" style="margin:0;">
          ${r.type === "choice"
            ? `<span class="badge lilac">Multiple choice</span>`
            : `<span class="badge ${r.severity === "bad" ? "coral" : "navy"}">${escapeHtml(eventAmountText(r.amount, 0, null))}</span>`}
          <span class="badge ${r.severity === "bad" ? "coral" : "navy"}">${r.severity === "bad" ? "Bad" : "Neutral"}</span>
          ${evRecoWhoText(r) ? `<span class="muted-small">${escapeHtml(evRecoWhoText(r))}</span>` : ""}
        </div>
        <button class="btn small gold" type="button" onclick="evAddReco('${encodeURIComponent(r.name)}')">+ Add</button>
      </div>`).join("")}
    </div></div>`;
}
async function evAddReco(nameEnc) {
  const name = decodeURIComponent(nameEnc);
  const cls = await getClassCached(CLASS_CODE);
  const r = evRecoRemaining(cls).find(x => x.name === name);
  if (!r) return;
  await addEventDefs(CLASS_CODE, [r]);
  await render();
  t29Toast(`Added ${r.name}.`);
}
async function evAddAllReco() {
  const cls = await getClassCached(CLASS_CODE);
  const left = evRecoRemaining(cls);
  if (!left.length) return;
  if (!await t29Confirm(`Add ${left.length} events? You can edit or remove any of them afterwards.`)) return;
  await addEventDefs(CLASS_CODE, left);
  await render();
  t29Toast(`Added ${left.length} events.`);
}

async function removeEvent(id) {
  if (await t29Confirm("Remove this event? It will no longer be handed out.")) {
    if (id === EDITING_EVENT_ID) resetEventForm();
    await removeEventDef(CLASS_CODE, id);
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
      <p class="muted-small threshold-reqs-label">Optional requirements. A student must also meet these to be shown this band, even if their score qualifies. Leave at 0 for no requirement.</p>
      <div class="grid grid-3">
        <div><label>Min net worth</label><input class="th-min-networth" type="number" min="0" step="1" value="${t.minNetWorth || 0}"></div>
        <div><label>Min property comfort (base comfort + living-in bonus stars)</label><input class="th-min-property" type="number" min="0" step="1" value="${t.minPropertyComfort || 0}"></div>
        <div><label>Min transport comfort (stars of their comfiest vehicle)</label><input class="th-min-transport" type="number" min="0" max="5" step="1" value="${t.minTransportComfort || 0}"></div>
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
  // loan config lives in this same lifestyleConfig object but is edited
  // from its own section (see setLoanLifestylePenalty in data-money.js), so it's
  // read back here and carried through untouched — otherwise saving this
  // form would wipe out whatever the teacher set there.
  const cls = await getClassCached(CLASS_CODE);
  const existingLoanCfg = (cls.lifestyleConfig && cls.lifestyleConfig.loan) || { enabled: false, perAmount: 0, points: 0 };
  // Same for the credit card penalty (edited in the Bank page's card section).
  const existingCardCfg = (cls.lifestyleConfig && cls.lifestyleConfig.creditCard) || { enabled: false, perAmount: 0, points: 1 };
  const config = {
    property: { enabled: document.getElementById("ls-property-on").checked, weight: Number(document.getElementById("ls-property-weight").value) || 0 },
    transport: { enabled: document.getElementById("ls-transport-on").checked, weight: Number(document.getElementById("ls-transport-weight").value) || 0 },
    store: { enabled: document.getElementById("ls-store-on").checked, weight: Number(document.getElementById("ls-store-weight").value) || 0 },
    insurance: { enabled: document.getElementById("ls-insurance-on").checked, weight: Number(document.getElementById("ls-insurance-weight").value) || 0 },
    loan: existingLoanCfg,
    creditCard: existingCardCfg
  };
  await saveLifestyleConfig(CLASS_CODE, config);
  document.getElementById("lifestyleMsg").innerHTML = `<div class="success-msg">Saved!</div>`;
  await render();
}

async function runPayDay() {
  const runStart = Date.now() - 1000;
  const { newlyPaid, hasJobs, unapprovedCount, noLogCount = 0 } = await payDay(CLASS_CODE);
  const noLogNote = noLogCount ? ` ${noLogCount} student(s) logged no days this pay cycle, so earned no pay.` : "";
  if (newlyPaid > 0) await t29NotifyRunPayments(CLASS_CODE, runStart, "payday");
  if (!hasJobs) {
    alert("No students have a job assigned yet.");
  } else if (newlyPaid > 0 && unapprovedCount > 0) {
    alert(`Pay day complete: ${newlyPaid} student(s) paid. ${unapprovedCount} still aren't ticked as having done their job task, so they weren't paid.`);
  } else if (newlyPaid > 0) {
    alert(`Pay day complete: ${newlyPaid} student(s) paid.${noLogNote}`);
  } else if (unapprovedCount > 0) {
    alert(`Nobody was paid: ${unapprovedCount} student(s) with a job aren't ticked as having done their job task yet. Tick their box on the student's profile, then run pay day again.`);
  } else {
    alert(noLogCount ? `Everyone who earned pay has been paid.${noLogNote}` : "Everyone with a job has already been paid for today.");
  }
  await render();
}
// Ticks "completed this week's job task" for every student who has a job,
// in one go (same flag as the per-student checkbox on their profile).
async function markAllJobTasksDone() {
  const btn = document.getElementById("markAllJobsBtn");
  if (btn.disabled) return;
  const cls = await getClassCached(CLASS_CODE);
  // Check-in and questionnaire jobs are paid automatically by days logged, so only task jobs get a tick.
  const isTaskJob = s => { const j = (cls.jobs || []).find(x => x.id === s.jobId); return !!j && jobLogType(j) === "tasks"; };
  const targets = LAST_STUDENTS.filter(s => isTaskJob(s) && !isJobTaskApprovedThisWeek(s, cls));
  const withJobs = LAST_STUDENTS.filter(isTaskJob).length;
  if (!withJobs) { alert("No students have a task-based job. Check-in and questionnaire jobs are paid automatically."); return; }
  if (!targets.length) { alert("Everyone with a job is already ticked as done for this pay cycle."); return; }
  if (!await t29Confirm(`Mark this week's job task as done for ${targets.length} student${targets.length === 1 ? "" : "s"}?`)) return;
  btn.disabled = true;
  try {
    // Each write hits a different student's own document, so it's safe to run together.
    const results = await Promise.allSettled(targets.map(s => setJobTaskApproval(CLASS_CODE, s.username, true, { silent: true })));
    const failed = results.filter(r => r.status === "rejected").length;
    // One notice for everyone that worked (not one class write per student).
    await t29NotifyStudents(CLASS_CODE, { to: targets.filter((s, i) => results[i].status === "fulfilled").map(s => s.username), icon: "briefcase", tone: "mint",
      title: "Your teacher ticked off your job task for this week", body: "Your wage for this pay cycle is approved.", href: "jobs.html" });
    if (failed) alert(`Marked ${targets.length - failed} of ${targets.length} as done. ${failed} failed. Please try again.`);
    await render();
  } finally {
    btn.disabled = false;
  }
}
// "View as student": use the whole app exactly as one of this class's students would (see data-core.js, "Student view").
async function startStudentView() {
  const btn = document.getElementById("studentViewBtn");
  if (btn && btn.disabled) return;
  const ok = await t29Confirm(
    "View this class as a student?\n\n" +
    "You'll see and use everything exactly as one of your students does. Money still comes from your own unlimited teacher bank, and you can send money to students as usual.\n\n" +
    "Nothing you do there is kept: when you leave student view, everything you changed is cleared. Anything that would change the real class (buying, selling, applying for jobs, trading, quizzes) is switched off.",
    { confirmText: "Start student view", cancelText: "Not now", danger: false });
  if (!ok) return;
  if (btn) btn.disabled = true;
  const res = await t29SvEnter();
  if (res && !res.ok) {
    if (btn) btn.disabled = false;
    t29Alert(res.error || "Couldn't start student view.");
  }
}
async function runInterest() {
  const runStart = Date.now() - 1000;
  const count = await applyInterest(CLASS_CODE);
  if (count > 0) await t29NotifyRunPayments(CLASS_CODE, runStart, "interest");
  // count only reflects students who HADN'T already been paid today —
  // anyone already covered (their own visit, or an earlier automatic
  // sweep today) is correctly skipped rather than paid twice.
  alert(count > 0 ? `Interest applied to ${count} student(s).` : "No one was due interest just now. Either balances/rates are zero, or everyone's already been paid today.");
  await render();
}
async function runWeeklyEventsNow() {
  const btn = document.getElementById("runEventsNowBtn");
  if (btn.disabled) return; // already running — ignore extra clicks
  btn.disabled = true;
  try {
    const count = await forceWeeklyEvents(CLASS_CODE);
    alert(count > 0 ? `Done: ${count} event(s) assigned across the class. They'll pop up within the next 20 minutes as students use the site.` : "No active events are set up yet.");
    await render();
  } finally {
    btn.disabled = false;
  }
}
/* ---------------- Co-teachers (see "Co-teachers" in data-core.js) ---------------- */
async function renderCoTeachers(cls) {
  const box = document.getElementById("coTeacherBody");
  if (!box) return;
  const isOwner = cls.teacher === CURRENT.username;
  const label = async (username) => {
    // A co-teacher's account can only be read here while it has this class open; otherwise show the username.
    const u = await getUserCached(username).catch(() => null);
    return u && u.name ? `${escapeHtml(u.name)} <span class="muted-small">(${escapeHtml(username)})</span>` : escapeHtml(username);
  };
  const co = cls.coTeachers || [];
  const rows = await Promise.all(co.map(async n => `
    <div class="auto-row">
      <div class="auto-details"><strong>${await label(n)}</strong><div class="muted-small">Co-teacher</div></div>
      ${isOwner ? `<button class="btn small coral" onclick="removeCoTeacherClick('${escapeJsAttr(n)}')">Remove</button>` : ""}
    </div>`));
  let html = `<div class="auto-row"><div class="auto-details"><strong>${await label(cls.teacher)}</strong><div class="muted-small">Owner</div></div></div>${rows.join("")}`;
  if (isOwner) {
    if (co.length >= T29_MAX_CO_TEACHERS) {
      html += `<p class="muted-small">This class has the maximum of ${T29_MAX_CO_TEACHERS} co-teachers. Remove one to invite someone else.</p>`;
    } else if (cls.coTeacherCode) {
      const code = `${cls.code}-${cls.coTeacherCode}`;
      html += `
        <label for="coTeacherCodeInput">Co-teacher code (works once)</label>
        <input id="coTeacherCodeInput" readonly value="${escapeHtml(code)}" onclick="this.select()">
        <p class="muted-small">Send this to the teacher. They choose <strong>Join a class as co-teacher</strong> on their Teacher Home page and enter it. You can still add ${T29_MAX_CO_TEACHERS - co.length} more.</p>
        <div class="set-controls">
          <button class="btn gold" onclick="copyCoTeacherCode()">Copy code</button>
          <button class="btn secondary" onclick="cancelCoTeacherCodeClick()">Cancel this code</button>
        </div>`;
    } else {
      html += `<div class="set-controls"><button class="btn gold" onclick="createCoTeacherCodeClick()">Invite a co-teacher</button></div>`;
    }
  } else {
    html += `<div class="set-controls"><button class="btn secondary" onclick="leaveCoTeachingClick()">Leave this class</button></div>`;
  }
  box.innerHTML = html;
}
async function createCoTeacherCodeClick() {
  const msg = document.getElementById("coTeacherMsg");
  msg.innerHTML = "";
  try {
    const res = await t29CreateCoTeacherCode(CLASS_CODE, CURRENT.username);
    if (!res.ok) { msg.innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`; return; }
    await render();
  } catch (e) { msg.innerHTML = `<div class="error-msg">Couldn't make a code. Please try again.</div>`; }
}
async function cancelCoTeacherCodeClick() {
  try { await t29CancelCoTeacherCode(CLASS_CODE, CURRENT.username); await render(); }
  catch (e) { document.getElementById("coTeacherMsg").innerHTML = `<div class="error-msg">Couldn't cancel that. Please try again.</div>`; }
}
async function copyCoTeacherCode() {
  const input = document.getElementById("coTeacherCodeInput");
  if (!input) return;
  let copied = false;
  try { await navigator.clipboard.writeText(input.value); copied = true; }
  catch (e) { input.select(); try { copied = document.execCommand("copy"); } catch (e2) { copied = false; } }
  t29Toast(copied ? "Code copied." : "Couldn't copy automatically. Select the code and copy it.", { type: copied ? "success" : "info" });
}
async function removeCoTeacherClick(username) {
  if (!await t29Confirm(`Remove ${username} as a co-teacher? They'll lose access to this class straight away.`)) return;
  try {
    const res = await t29RemoveCoTeacher(CLASS_CODE, CURRENT.username, username);
    if (!res.ok) { document.getElementById("coTeacherMsg").innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`; return; }
    await render();
  } catch (e) { document.getElementById("coTeacherMsg").innerHTML = `<div class="error-msg">Couldn't remove them. Please try again.</div>`; }
}
async function leaveCoTeachingClick() {
  if (!await t29Confirm("Leave this class? You'll stop being a co-teacher, and the owner would need to invite you again.")) return;
  try { await t29LeaveAsCoTeacher(CLASS_CODE, CURRENT.username); window.location.href = "teacher-home.html"; }
  catch (e) { document.getElementById("coTeacherMsg").innerHTML = `<div class="error-msg">Couldn't leave. Please try again.</div>`; }
}
async function saveWelcomeGrant() {
  const btn = document.getElementById("saveWelcomeBtn");
  const msg = document.getElementById("welcomeGrantMsg");
  if (btn.disabled) return;
  btn.disabled = true;
  msg.innerHTML = "";
  try {
    const res = await setClassWelcomeGrant(CLASS_CODE, document.getElementById("welcomeGrant").value);
    if (!res.ok) { msg.innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`; return; }
    await render();
    flashMsg(msg, `<div class="success-msg">Saved. New students will start with ${fmtMoney(res.amount)}.</div>`, 4000);
  } catch (e) {
    msg.innerHTML = `<div class="error-msg">Couldn't save that. Please try again.</div>`;
  } finally {
    btn.disabled = false;
  }
}
async function approveTimeExemptionRequest(username) {
  const raw = await t29Prompt("How many extra minutes should they get today?", "10", { type: "number", min: 1, step: 1, confirmText: "Approve" });
  if (raw === null) return; // cancelled
  const minutes = Math.round(Number(raw));
  if (!Number.isFinite(minutes) || minutes <= 0) { alert("Enter a whole number of minutes greater than 0."); return; }
  const res = await decideTimeExemption(username, true, minutes);
  if (!res.ok) alert(res.error || "Couldn't approve that request.");
  await render();
}
async function declineTimeExemptionRequest(username) {
  if (!await t29Confirm("Decline this request? They won't be able to ask again until tomorrow.")) return;
  const res = await decideTimeExemption(username, false);
  if (!res.ok) alert(res.error || "Couldn't decline that request.");
  await render();
}
async function saveDailyTimeLimit() {
  const btn = document.getElementById("saveDailyTimeLimitBtn");
  const raw = document.getElementById("dailyTimeLimit").value;
  const minutes = raw === "" ? 0 : Number(raw);
  if (btn.disabled) return; // fan-out to every student can take a moment on large classes — ignore double-clicks
  btn.disabled = true;
  try {
    await setStudentTimeLimit(CLASS_CODE, minutes);
    document.getElementById("dailyTimeLimitMsg").innerHTML = `<div class="success-msg">${minutes > 0 ? `Daily time limit set to ${minutes} minute${minutes === 1 ? "" : "s"} per student.` : "Daily time limit removed. Students have unlimited time on the site again."}</div>`;
    await render();
  } catch (e) {
    document.getElementById("dailyTimeLimitMsg").innerHTML = `<div class="error-msg">Couldn't save the time limit. Please try again.</div>`;
  } finally {
    btn.disabled = false;
  }
}
async function quickView(username) {
  await renderProfile(username);
  document.getElementById("profileModal").classList.remove("hidden");
}

function closeProfile() {
  document.getElementById("profileModal").classList.add("hidden");
}

async function applyProfileGender(username, e) {
  const sel = document.getElementById("profileGenderSelect");
  if (!sel || !window.T29Avatar) return;
  const btn = e && e.currentTarget;
  if (btn) btn.disabled = true;
  const res = await T29Avatar.setGender(username, sel.value);
  if (!res.ok) { alert(res.error || "Couldn't update the body type."); if (btn) btn.disabled = false; return; }
  // Keep the cached copy of the student in step so the profile and tables show the change straight away.
  const cached = await getUserCached(username);
  if (cached) {
    const av = Object.assign({}, cached.avatar || {});
    av.look = Object.assign({}, av.look || {}, { gender: sel.value });
    cached.avatar = av;
  }
  await render();
  await renderProfile(username);
}

async function applyProfileTierChange(username, e) {
  const sel = document.getElementById("profileTierSelect");
  if (!sel) return;
  const tierId = sel.value;
  const btn = e && e.currentTarget;
  if (btn) btn.disabled = true;
  const res = await setStudentJobTier(CLASS_CODE, username, tierId);
  if (!res.ok) { alert(res.error || "Couldn't update tier."); if (btn) btn.disabled = false; return; }
  await render();
  await renderProfile(username);
}

async function promoteProfileStudent(username, e) {
  const btn = e && e.currentTarget;
  if (btn) btn.disabled = true;
  const [cls, student] = await Promise.all([getClassCached(CLASS_CODE), getUserCached(username)]);
  if (!cls || !student || !student.jobId) { if (btn) btn.disabled = false; return; }
  const job = (cls.jobs || []).find(j => j.id === student.jobId);
  if (!job || !job.tiers) { if (btn) btn.disabled = false; return; }
  const tier = getStudentTier(job, student);
  const curIdx = tier ? job.tiers.indexOf(tier) : 0;
  const nextTier = job.tiers[curIdx + 1];
  if (!nextTier) { if (btn) btn.disabled = false; return; }
  const res = await setStudentJobTier(CLASS_CODE, username, nextTier.id);
  if (!res.ok) { alert(res.error || "Couldn't offer that promotion."); if (btn) btn.disabled = false; return; }
  await render();
  await renderProfile(username);
}

async function cancelPendingPromotionClick(username, e) {
  const btn = e && e.currentTarget;
  if (btn) btn.disabled = true;
  await cancelPendingPromotion(username);
  await render();
  await renderProfile(username);
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
  const tier = job ? getStudentTier(job, s) : null;
  const tierIdx = (job && tier && job.tiers) ? job.tiers.indexOf(tier) : -1;

  document.getElementById("profileName").innerHTML = `${avatarBadge(s)} ${escapeHtml(s.name)}`;
  // BUGFIX: this sets textContent, which does its own escaping — running
  // the value through escapeHtml() first meant a username or job title
  // containing an apostrophe rendered literally as "&#39;" on screen.
  // (profileName just above is innerHTML, so it correctly DOES escape.)
  document.getElementById("profileSubtitle").textContent = `@${s.username}${job ? ` · ${tier ? tier.name : job.title}` : " · No job assigned"}`;

  const rows = [];
  // At the very top of the profile: online now + when they last opened the site.
  rows.push(`<div class="profile-presence" id="profilePresence">${presenceProfileHtml(username)}</div>`);
  const isOverride = s.lifestyleOverride !== undefined && s.lifestyleOverride !== null;
  rows.push(`
    <div class="profile-summary">
      <div class="profile-chip"><div class="label">Cash balance</div><div class="value">${fmtMoney(s.balance)}</div></div>
      <div class="profile-chip"><div class="label">Savings</div><div class="value">${fmtMoney(s.savings || 0)}</div></div>
      <div class="profile-chip"><div class="label">Portfolio</div><div class="value">${fmtMoney(net)}</div></div>
      <div class="profile-chip"><div class="label">Lifestyle rating</div><div class="value">${rating}${isOverride ? ` <span class="muted-small">(overridden)</span>` : ""}</div>${band ? `<div class="muted-small">${band}</div>` : ""}</div>
    </div>
  `);

  /* ---- Job & tier management ---- */
  rows.push(`<h4>${icon("briefcase", 16)} Job & tier</h4>`);
  if (!job) {
    rows.push(`<p class="muted-small">No job assigned. Assign one using the job dropdown in the Students table.</p>`);
  } else {
    const tiers = job.tiers || [];
    const pendingPromo = s.pendingPromotion && s.pendingPromotion.jobId === job.id ? s.pendingPromotion : null;
    const tierOpts = tiers.map((t, i) =>
      `<option value="${t.id}" ${tier && t.id === tier.id ? "selected" : ""}>${i + 1}. ${escapeHtml(t.name)}: ${fmtMoney(t.wage)}/pay day</option>`
    ).join("");
    rows.push(`
      <div class="tier-ladder profile-tier-ladder">
        ${tiers.map((t, i) => {
          const isCurrent = tier && t.id === tier.id;
          const isPast = tierIdx > -1 && i < tierIdx;
          return `<div class="tier-rung${isCurrent ? " active" : isPast ? " completed" : ""}">
            <div class="tier-rung-badge">${i + 1}</div>
            <div class="tier-rung-body">
              <strong>${escapeHtml(t.name)}</strong>
              <span class="muted-small"> &middot; ${fmtMoney(t.wage)}/pay day</span>
              ${t.description ? `<div class="muted-small" style="margin-top:2px;">${escapeHtml(t.description)}</div>` : ""}
            </div>
            ${isCurrent ? `<span class="badge gold" style="flex-shrink:0;margin-left:auto;">Current</span>` : ""}
          </div>`;
        }).join("")}
      </div>
      ${pendingPromo ? `
        <div class="auto-row" style="margin-top:12px;">
          <div class="auto-details">
            <strong>Promotion offered:</strong> ${escapeHtml(pendingPromo.tierName)} (${fmtMoney(pendingPromo.wage)}/pay day)
            <div class="muted-small">Waiting on ${escapeHtml(s.name.split(" ")[0])} to accept or decline. Their tier won't change until they respond.</div>
          </div>
          <button class="btn small coral" onclick="cancelPendingPromotionClick('${escapeJsAttr(username)}', event)">Cancel offer</button>
        </div>
      ` : tiers.length > 1 ? `
        <div style="display:flex;gap:8px;align-items:flex-end;margin-top:14px;flex-wrap:wrap;">
          <div style="flex:1;min-width:180px;">
            <label for="profileTierSelect" style="margin-top:0;">Move to tier</label>
            <select id="profileTierSelect">${tierOpts}</select>
          </div>
          <button class="btn small" onclick="applyProfileTierChange('${escapeJsAttr(username)}', event)">Save</button>
          ${tierIdx >= 0 && tierIdx < tiers.length - 1
            ? `<button class="btn small mint" onclick="promoteProfileStudent('${escapeJsAttr(username)}', event)">⬆ Offer promotion to ${escapeHtml(tiers[tierIdx + 1].name)}</button>`
            : `<span class="badge mint" style="align-self:flex-end;">At top tier</span>`}
        </div>
        <p class="muted-small" style="margin-top:6px;">Moving up requires ${escapeHtml(s.name.split(" ")[0])} to accept the offer first; moving down applies right away.</p>
      ` : `<p class="muted-small" style="margin-top:8px;">This job has only one tier.</p>`}
    `);
  }

  /* ---- This week's job task ---- */
  rows.push(`<h4>${icon("briefcase", 16)} This week\'s job task</h4>`);
  if (!job) {
    rows.push(`<p class="muted-small">No job assigned. Nothing to approve.</p>`);
  } else if (jobLogType(job) !== "tasks") {
    const a = wageAttendance(cls, s);
    rows.push(`<p>Paid automatically on pay day by days logged: <strong>${a.done} of ${a.expected}</strong> so far (${a.expected ? Math.round(a.done / a.expected * 100) : 100}% of the wage). No tick needed.</p>`);
  } else {
    const tierName = tier ? tier.name : job.title;
    rows.push(`
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="profileJobTaskCheck" ${taskApproved ? "checked" : ""} onchange="profileSetJobTaskApproval(\'${escapeJsAttr(username)}\', this.checked)" style="width:20px;height:20px;min-height:auto;">
        <span>Completed this week\'s task for <strong>${escapeHtml(tierName)}</strong>, pay day will pay them once this is ticked</span>
      </label>
      <p class="muted-small">Resets automatically the moment pay day (${DAY_FULL[cls.payDay || "Fri"]}) begins, you\'ll need to tick it again for next cycle. If it\'s unticked on pay day, ${escapeHtml(s.name.split(" ")[0])} won\'t be paid until you tick it and re-run pay day.</p>
    `);
  }

  rows.push(`<h4>${icon("briefcase", 16)} Side hustle</h4>`);
  const sh = s.sideHustle;
  const shDef = sh && sh.hustleId ? (cls.sideHustles || []).find(h => h.id === sh.hustleId) : null;
  if (shDef) {
    const payout = Number(shDef.payouts[sh.checkinHour]) || 0;
    rows.push(`
      <div class="auto-row">
        <div class="auto-details">
          <strong>${escapeHtml(shDef.name)}</strong>
          <div class="muted-small">Checks in at ${hourLabel(sh.checkinHour)} &middot; ${fmtMoney(payout)} per check-in${sideHustleLiveStreak(sh, nzDateKey()) ? ` &middot; streak: ${sideHustleLiveStreak(sh, nzDateKey())}` : ""}</div>
          <div class="muted-small">Last checked in: ${sh.lastCheckin || "Never"}</div>
        </div>
      </div>
    `);
  } else if (sh && sh.hustleId) {
    rows.push(`<p class="muted-small">Has a side hustle set (at ${hourLabel(sh.checkinHour)}), but it no longer exists in this class's list.</p>`);
  } else {
    rows.push(`<p class="muted-small">No side hustle chosen yet.</p>`);
  }
  if (s.sideHustleRequest && s.sideHustleRequest.status === "pending") {
    const reqHustle = (cls.sideHustles || []).find(h => h.id === s.sideHustleRequest.hustleId);
    rows.push(`<p class="muted-small">Pending change request: ${reqHustle ? escapeHtml(reqHustle.name) : "Unknown"} at ${hourLabel(s.sideHustleRequest.checkinHour)}. Approve or deny it from the Side hustles section below.</p>`);
  }

  if (s.dailyLimitMinutes > 0) {
    rows.push(`<h4>${icon("history", 16)} Time on site</h4>`);
    const tStatus = timeLimitStatus(s);
    const usedMin = Math.floor((tStatus.spentSec || 0) / 60);
    const totalMin = s.dailyLimitMinutes + (tStatus.extraMin || 0);
    rows.push(`<p class="muted-small">${usedMin} of ${totalMin} minute${totalMin === 1 ? "" : "s"} used today${tStatus.extraMin ? ` (includes +${tStatus.extraMin} granted today)` : ""}.</p>`);
    const exState = timeExemptionState(s);
    if (exState === "pending") {
      rows.push(`<p class="muted-small">Has a pending request for more time. Approve or decline it from the banner at the top of the dashboard.</p>`);
    } else if (exState === "declined") {
      rows.push(`<p class="muted-small">Their last request for more time today was declined.</p>`);
    }
  }

  rows.push(`<h4>${icon("star", 16)} Lifestyle rating override</h4>`);
  if (isOverride) {
    rows.push(`
      <p class="muted-small">This student's lifestyle rating is locked at <strong>${s.lifestyleOverride}</strong>. Nothing they buy, sell, or do will change it until you remove the override.</p>
      <div class="auto-row">
        <div class="auto-details">Locked at ${s.lifestyleOverride}</div>
        <button class="btn small secondary" onclick="removeProfileLifestyleOverride('${escapeJsAttr(username)}')">Remove override</button>
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
        <button class="btn small" onclick="applyProfileLifestyleOverride('${escapeJsAttr(username)}')">Set override</button>
      </div>
    `);
  }

  rows.push(`<h4>${icon("house", 16)} Property</h4>`);
  const ownedProps = poss.properties || (poss.property ? [poss.property] : []);
  ownedProps.filter(p => isMortgagePaymentOverdue(p, cls)).forEach(p => {
    rows.push(`
      <div class="auto-row" style="background:var(--pastel-coral-bg,#fde2e2);border:1px solid var(--pastel-coral-border,#f3a6a6);border-radius:var(--r-2);">
        <div class="auto-details">
          <strong>${icon("house", 14)} Mortgage payment overdue: ${escapeHtml(p.name)}</strong>
          <div class="muted-small">This week's payment (due ${DAY_FULL[cls.mortgageDay || "Fri"]}) hasn't been paid yet.</div>
        </div>
        <div class="row-flex" style="gap:8px;align-items:center;">
          <div class="status-declined">Unpaid</div>
          <button class="btn small secondary" onclick="profileResolveMortgageOverdue('${p.id}')">Mark as resolved</button>
        </div>
      </div>`);
  });
  // A student can own more than one property — their lifestyle bonus
  // stacks across all of them (see lifestyleRatingFromData), so every
  // owned unit gets its own row here rather than just the first one.
  rows.push(ownedProps.length
    ? ownedProps.map(p => {
        const occupancyLine = p.occupancy === "living" ? "Living in it (lifestyle bonus applied)"
          : p.occupancy === "rented" ? `Rented out. Earning ${fmtMoney(p.rentPerWeek || 0)}/week, paid ${DAY_FULL[p.rentDay || "Fri"]}`
          : p.occupancy === "sublet" && p.sublet
            ? (p.sublet.status === "pending" ? `Waiting for approval to rent to a classmate at ${fmtMoney(p.sublet.price)}/week`
              : p.sublet.status === "rejected" ? `Rental listing declined${p.sublet.rejectReason ? `: ${p.sublet.rejectReason}` : ""}`
              : p.sublet.tenant ? `Rented to a classmate (@${escapeHtml(p.sublet.tenant)}) at ${fmtMoney(p.sublet.price)}/week`
              : `Listed for rent to classmates at ${fmtMoney(p.sublet.price)}/week. No tenant yet`)
            : "Hasn't chosen to live in it, rent it out, or rent it to a classmate yet";
        return `<div class="auto-row"><div class="auto-details"><strong>${escapeHtml(p.name)}</strong>: ${fmtMoney(p.price)}
          <div class="muted-small">${occupancyLine}</div>
          ${p.mortgage ? `<div class="muted-small">${isVariableMortgage(p.mortgage) ? "Variable" : "Fixed"} mortgage: ${fmtMoney(p.mortgage.weeklyPayment)}/week base${p.mortgage.interestRate > 0 ? ` + ${p.mortgage.interestRate}% interest on the balance owed` : ""}, ${p.mortgage.weeksLeft} week${p.mortgage.weeksLeft === 1 ? "" : "s"} left, due ${DAY_FULL[cls.mortgageDay || "Fri"]}. This week's payment is ${fmtMoney(mortgageWeekAmount(p.mortgage).total)}</div>` : ""}</div>
          <div class="row-flex" style="gap:8px;">
            ${p.occupancy === "rented" ? `<button class="btn small secondary" onclick="profileEndRental('${p.id}')">Stop renting / kick out tenants</button>` : ""}
            ${p.occupancy === "sublet" ? `<button class="btn small secondary" onclick="profileEndSublet('${p.id}')">End classmate rental</button>` : ""}
            <button class="btn small coral" onclick="profileRemoveProperty('${p.id}')">Repossess</button>
          </div></div>`;
      }).join("")
    : `<p class="muted-small">No property owned.</p>`);

  if (poss.rentedHome) {
    const rh = poss.rentedHome;
    const overdue = isSubletRentOverdue(rh, cls);
    rows.push(`
      <div class="auto-row"${overdue ? ' style="background:var(--pastel-coral-bg,#fde2e2);border:1px solid var(--pastel-coral-border,#f3a6a6);border-radius:var(--r-2);"' : ""}>
        <div class="auto-details">
          <strong>Renting from a classmate:</strong> ${escapeHtml(rh.name)}: ${fmtMoney(rh.sublet.price)}/week from @${escapeHtml(rh.owner)}
          <div class="muted-small">${overdue ? "This week's rent hasn't been paid yet. " : ""}Minimum lease: ${rh.sublet.minWeeks} week${rh.sublet.minWeeks === 1 ? "" : "s"}.</div>
        </div>
        <div class="row-flex" style="gap:8px;align-items:center;">
          ${overdue ? `<button class="btn small secondary" onclick="profileResolveSubletOverdue('${rh.id}')">Mark as resolved</button>` : ""}
          <button class="btn small coral" onclick="profileEndSublet('${rh.id}')">End rental</button>
        </div>
      </div>`);
  }
  if (poss.rentedNpcHome) {
    const rn = poss.rentedNpcHome;
    const overdue = isNpcRentOverdue(rn);
    rows.push(`
      <div class="auto-row"${overdue ? ' style="background:var(--pastel-coral-bg,#fde2e2);border:1px solid var(--pastel-coral-border,#f3a6a6);border-radius:var(--r-2);"' : ""}>
        <div class="auto-details">
          <strong>Renting a school property:</strong> ${escapeHtml(rn.name)}: ${fmtMoney(rn.rentPerWeek)}/week
          <div class="muted-small">${overdue ? "This week's rent hasn't been paid yet. " : ""}Minimum lease: ${rn.minWeeks} week${rn.minWeeks === 1 ? "" : "s"}.</div>
        </div>
        <div class="row-flex" style="gap:8px;align-items:center;">
          ${overdue ? `<button class="btn small secondary" onclick="profileResolveNpcOverdue('${rn.id}')">Mark as resolved</button>` : ""}
          <button class="btn small coral" onclick="profileEndNpcTenancy('${rn.id}')">End tenancy</button>
        </div>
      </div>`);
  }

  rows.push(`<h4>${icon("car", 16)} Transport</h4>`);
  if (isTransportPaymentOverdue(s, cls)) {
    rows.push(`
      <div class="auto-row" style="background:var(--pastel-coral-bg,#fde2e2);border:1px solid var(--pastel-coral-border,#f3a6a6);border-radius:var(--r-2);">
        <div class="auto-details">
          <strong>${icon("car", 14)} Transport payment overdue</strong>
          <div class="muted-small">A transport payment due on ${DAY_FULL[cls.transportDay || "Fri"]} was missed and hasn't been cleared.</div>
        </div>
        <div class="row-flex" style="gap:8px;align-items:center;">
          <div class="status-declined">Unpaid</div>
          <button class="btn small secondary" onclick="profileResolveTransportOverdue('${escapeJsAttr(username)}')">Mark as resolved</button>
        </div>
      </div>`);
  }
  const transportAmt = transportWeeklyAmount(cls, s);
  rows.push(`<p class="muted-small">Weekly transport expenses: ${fmtMoney(transportAmt.total)}
    (${transportAmt.vehicleExpense > 0 ? `${fmtMoney(transportAmt.vehicleExpense)} vehicle upkeep + ` : ""}${fmtMoney(transportAmt.publicFeeDue)} public transport${transportAmt.lifeFeeName ? `: ${escapeHtml(transportAmt.lifeFeeName)} rate` : ""}),
    due ${DAY_FULL[cls.transportDay || "Fri"]} &middot; ${(s.transportLastWeekPaid === isoWeekKey()) ? "paid this week" : "not yet paid this week"}</p>`);
  rows.push(poss.vehicles && poss.vehicles.length
    ? poss.vehicles.map(v => `<div class="auto-row"><div class="auto-details"><strong>${escapeHtml(v.name)}</strong>: ${fmtMoney(v.price)} <span class="muted-small">(${vehicleTypeLabel(v.type)})</span>
        ${(v.weeklyExpense > 0 || v.publicTransportOffsetPct > 0) ? `<div class="muted-small">${v.weeklyExpense > 0 ? `${fmtMoney(v.weeklyExpense)}/week upkeep` : ""}${v.weeklyExpense > 0 && v.publicTransportOffsetPct > 0 ? " &middot; " : ""}${v.publicTransportOffsetPct > 0 ? `knocks ${v.publicTransportOffsetPct}% off public transport` : ""}</div>` : ""}</div>
        <button class="btn small coral" onclick="profileRemoveVehicle('${v.id}','${escapeJsAttr(username)}')">Repossess</button></div>`).join("")
    : `<p class="muted-small">No vehicles owned.</p>`);
  rows.push(`<div class="auto-row"><div class="auto-details">Truck licence</div>${s.truckLicence
    ? `<button class="btn small coral" onclick="profileRevokeTruckLicence('${escapeJsAttr(username)}')">Revoke</button>`
    : `<span class="muted-small">Not held</span>`}</div>`);

  // Group owned store items by item id: poss.storeItems is a flat list
  // with one entry per unit owned, so a student who bought the same
  // item 5 times used to get 5 near-identical rows. Collapse those into
  // one row per distinct item with a ×qty badge instead.
  const storeGroups = [];
  const storeGroupIndex = {};
  poss.storeItems.forEach(it => {
    if (!storeGroupIndex[it.id]) {
      storeGroupIndex[it.id] = { item: it, qty: 0 };
      storeGroups.push(storeGroupIndex[it.id]);
    }
    storeGroupIndex[it.id].qty++;
  });
  rows.push(`<h4>${icon("cart", 16)} Store items</h4>`);
  rows.push(storeGroups.length
    ? storeGroups.map(g => `<div class="auto-row"><div class="auto-details">${escapeHtml(g.item.name)} <span class="badge mint">×${g.qty}</span>${g.item.countsNetWorth === false ? ' <span class="muted-small">(not counted)</span>' : ""}</div>
        <div class="row-flex" style="gap:8px;align-items:center;">
          <div class="qty-stepper">
            <button class="qty-btn" type="button" onclick="bulkRemoveQtyStep('${g.item.id}',-1,${g.qty})" aria-label="Decrease quantity">−</button>
            <input class="qty-input" type="number" inputmode="numeric" id="bulkRemoveQty_${g.item.id}" min="1" max="${g.qty}" step="1" value="1" onchange="bulkRemoveQtyClamp('${g.item.id}',${g.qty})">
            <button class="qty-btn" type="button" onclick="bulkRemoveQtyStep('${g.item.id}',1,${g.qty})" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn small coral" onclick="profileRemoveStoreItemBulk('${escapeJsAttr(username)}','${g.item.id}',${g.qty})">Remove</button>
        </div></div>`).join("")
    : `<p class="muted-small">No store items owned.</p>`);

  const giftableItems = (cls.storeItems || []).filter(it => !it.archived);
  if (giftableItems.length > 0) {
    rows.push(`
      <div style="display:flex;gap:8px;align-items:flex-end;margin-top:8px;">
        <div style="flex:1;">
          <label for="profileGiftItemSelect" style="margin-top:0;">Give a store item for free</label>
          <select id="profileGiftItemSelect">
            ${giftableItems.map(it => `<option value="${it.id}">${escapeHtml(it.name)}: ${fmtMoney(it.price)}${it.stock !== null && it.stock <= 0 ? " (out of stock)" : ""}</option>`).join("")}
          </select>
        </div>
        <button class="btn small" onclick="profileGiveStoreItem('${escapeJsAttr(username)}')">Give free</button>
      </div>
      <p class="muted-small">Doesn't cost the student anything and ignores stock. Works even if the item shows 0 left.</p>
    `);
  }

  rows.push(`<h4>${icon("shield", 16)} Insurance</h4>`);
  rows.push(poss.insurance.length
    ? poss.insurance.map(p => `<div class="auto-row"><div class="auto-details">${escapeHtml(insurancePlanName(p))}: ${fmtMoney(p.price)}/week</div>
        <button class="btn small coral" onclick="profileRemoveInsurance('${escapeJsAttr(username)}','${p.id}')">Cancel</button></div>`).join("")
    : `<p class="muted-small">No insurance plans.</p>`);

  const activeLoans = (s.loans || []).filter(l => l.status === "active");
  const todayKey = nzDateKey();
  rows.push(`<h4>${icon("loan", 16)} Loans</h4>`);
  rows.push(activeLoans.length
    ? activeLoans.map(l => {
        const overdue = l.dueDate < todayKey;
        return `<div class="auto-row">
          <div class="auto-details">
            <strong>${fmtMoney(l.principal)}</strong> borrowed &middot; ${l.rate}%/week over ${l.termWeeks} week${l.termWeeks === 1 ? "" : "s"}
            <div class="muted-small">Due ${l.dueDate}${overdue ? ". Overdue" : ""}</div>
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
    ? heldShares.map(h => `<div class="auto-row"><div class="auto-details"><strong>${escapeHtml(h.name)}</strong></div><div class="auto-details">${h.qty} share${h.qty === 1 ? "" : "s"}</div></div>`).join("")
    : `<p class="muted-small">No shares owned.</p>`);

  /* ---- Avatar body type (students choose their own; teacher can override) ---- */
  const curGender = (s.avatar && s.avatar.look && s.avatar.look.gender) || "neutral";
  rows.push(`<h4>Avatar body type</h4>
    <div class="auto-row gender-row">
      <div class="auto-details">Students pick this themselves in their avatar editor. You can change it here.</div>
      <div class="gender-controls">
        <select id="profileGenderSelect" aria-label="Avatar body type">
          ${[["neutral", "Neutral"], ["boy", "Boy"], ["girl", "Girl"]].map(g => `<option value="${g[0]}"${g[0] === curGender ? " selected" : ""}>${g[1]}</option>`).join("")}
        </select>
        <button class="btn small" onclick="applyProfileGender('${escapeJsAttr(username)}', event)">Save</button>
      </div>
    </div>`);

  // Read-only. Goals are the student's own (see "Savings goals" in data-money.js).
  const goals = savingsGoalProgress(s);
  rows.push(`<h4>${icon("target", 16)} Savings goals</h4>`);
  rows.push(goals.length
    ? goals.map(g => `<div class="auto-row"><div class="auto-details"><strong>${escapeHtml(g.name)}</strong>${g.reached ? ". Reached!" : ""}</div>
        <div class="auto-details">${fmtMoney(g.saved)} of ${fmtMoney(g.target)}</div></div>`).join("")
    : `<p class="muted-small">No savings goals set.</p>`);

  document.getElementById("profileBody").innerHTML = rows.join("");
  refreshPresence(false, 20000).then(paintProfilePresence); // fresh status when a profile opens (max one read per 20s)
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
  if (!await t29Confirm("Remove the lifestyle override? The student's rating will go back to being calculated automatically.")) return;
  await clearLifestyleOverride(username);
  await render();
  await renderProfile(username);
}

// Shared flow for any teacher-initiated removal that might warrant a
// refund: confirms the removal itself, then asks yes/no on a refund, and
// if yes, lets the teacher type the exact percentage. Returns a rate
// (0-1) to hand to the underlying sell/cancel function, or null if the
// teacher backed out at any point (removal should NOT proceed).
async function confirmRefundRate(removeQuestion, defaultPct) {
  if (!await t29Confirm(removeQuestion)) return null;
  const wantsRefund = await t29Confirm("Give the student a refund for this?", { confirmText: "Give a refund", cancelText: "No refund", danger: false });
  if (!wantsRefund) return 0;
  const input = await t29Prompt("What percentage of the price should be refunded? (0-100)", String(defaultPct), { type: "number", min: 0, max: 100, confirmText: "Refund" });
  if (input === null) return null;
  let pct = Number(input);
  if (isNaN(pct)) pct = defaultPct;
  pct = Math.max(0, Math.min(100, pct));
  return pct / 100;
}
// BUGFIX: this used to run confirmRefundRate() and pass the resulting
// percentage to sellProperty() as a third argument. sellProperty() takes
// only (classCode, propId) and always pays out the property's CURRENT
// market price, deliberately, since property prices move every market
// day, so a fixed percentage of a moving price would be meaningless (and
// would quietly under- or over-pay depending on which way the market had
// drifted since purchase). The percentage the teacher typed was silently
// discarded and the student was paid full market price regardless, so
// the prompt promised a refund rate that nothing honoured. Vehicles and
// store items DO take a rate (their prices are fixed), which is why
// profileRemoveVehicle/profileRemoveStoreItem below still use
// confirmRefundRate. This now asks a question that matches what actually
// happens, and reports the real numbers afterwards.
async function profileRemoveProperty(propId) {
  if (!await t29Confirm(
    "Repossess this property?\n\n" +
    "It goes back on the market and the student is paid its CURRENT market price " +
    "(property prices move on every market day, so this won't necessarily match what they paid). " +
    "Any mortgage still owing, plus the class's break fee, if one is set, comes out of that payout first, " +
    "so the student can end up receiving nothing, or going backwards, on a heavily mortgaged property."
  )) return;
  const propName = (((await getClassCached(CLASS_CODE)).properties || []).find(p => p.id === propId) || {}).name || "your property";
  const res = await sellProperty(CLASS_CODE, propId);
  if (!res.ok) { alert("That property couldn't be repossessed, it may have already been sold."); return; }
  await t29NotifyStudents(CLASS_CODE, { to: PROFILE_USER, icon: "house", tone: "coral",
    title: `Your teacher repossessed your property ${propName}`,
    body: `You were paid ${fmtMoney(res.payout)}: the market price of ${fmtMoney(res.marketPrice)}${res.mortgagePayoff > 0 ? `, less ${fmtMoney(res.mortgagePayoff)} mortgage payoff` : ""}${res.breakFee > 0 ? `, less ${fmtMoney(res.breakFee)} break fee` : ""}.`, href: "property.html" });
  const parts = [`Market price ${fmtMoney(res.marketPrice)}`];
  if (res.mortgagePayoff > 0) parts.push(`less ${fmtMoney(res.mortgagePayoff)} mortgage payoff`);
  if (res.breakFee > 0) parts.push(`less ${fmtMoney(res.breakFee)} break fee`);
  alert(`Repossessed.\n\n${parts.join("\n")}\n\nPaid to the student: ${fmtMoney(res.payout)}`);
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileEndRental(propId) {
  if (!await t29Confirm("Stop this rental and kick out the tenants? The student keeps the property, but stops earning rent immediately and will be asked to choose living-in-it or renting-out again next time they visit Property.")) return;
  const res = await teacherEndRental(CLASS_CODE, propId);
  if (!res.ok) { alert(res.error); return; }
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileEndSublet(propId) {
  if (!await t29Confirm("End this classmate rental? If someone's living there, they'll be kicked out immediately, and the minimum lease length is ignored.")) return;
  const res = await teacherEndSublet(CLASS_CODE, propId);
  if (!res.ok) { alert(res.error); return; }
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileResolveSubletOverdue(propId) {
  if (!await t29Confirm("Mark this week's rent as resolved? It'll count as paid, but no money will be taken from the tenant.")) return;
  const res = await resolveSubletRentOverdue(CLASS_CODE, propId);
  if (!res.ok) { alert(res.error); return; }
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileEndNpcTenancy(unitId) {
  if (!await t29Confirm("End this student's school rental tenancy right now? They'll be moved out immediately, regardless of their minimum lease.")) return;
  const res = await teacherEndNpcTenancy(CLASS_CODE, unitId);
  if (!res.ok) { alert(res.error); return; }
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileResolveNpcOverdue(unitId) {
  if (!await t29Confirm("Mark this week's rent as resolved? It'll count as paid, but no money will be taken from the tenant.")) return;
  const res = await resolveNpcRentOverdue(CLASS_CODE, unitId);
  if (!res.ok) { alert(res.error); return; }
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileResolveMortgageOverdue(propId) {
  if (!await t29Confirm("Mark this week's mortgage payment as resolved? It'll count as paid, the payment schedule moves on as normal, but no money will be taken from the student.")) return;
  const res = await resolveMortgageOverdue(CLASS_CODE, propId);
  if (!res.ok) { alert(res.error); return; }
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileResolveTransportOverdue(username) {
  if (!await t29Confirm("Mark this week's transport expenses as resolved? It'll count as paid, but no money will be taken from the student.")) return;
  const res = await resolveTransportOverdue(CLASS_CODE, username);
  if (!res.ok) { alert(res.error); return; }
  await render();
  await renderProfile(PROFILE_USER);
}
function vehicleTypeLabel(type) {
  return type === "truck" ? "Truck" : type === "bike" ? "Bike/Scooter" : "Car";
}
async function profileRemoveVehicle(vehId, username) {
  const rate = await confirmRefundRate("Repossess this vehicle?", 90);
  if (rate === null) return;
  const veh = ((await getClassCached(CLASS_CODE)).vehicles || []).find(v => v.id === vehId);
  await sellVehicle(CLASS_CODE, vehId, username, rate);
  if (veh) {
    await t29NotifyStudents(CLASS_CODE, { to: username, icon: "car", tone: "coral",
      title: `Your teacher took back your vehicle ${veh.name}`,
      body: rate > 0 ? `You were refunded ${Math.round(rate * 100)}% of its price (${fmtMoney(Math.round(veh.price * rate * 100) / 100)}).` : "No refund was given.", href: "transport.html" });
  }
  await render();
  await renderProfile(PROFILE_USER);
}
async function profileRevokeTruckLicence(username) {
  if (!await t29Confirm("Revoke this student's truck licence? They won't be refunded and will need to buy it again before purchasing a truck.")) return;
  await revokeTruckLicence(username);
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
  const rate = await confirmRefundRate("Remove this item from the student?", 80);
  if (rate === null) return;
  const item = ((await getClassCached(CLASS_CODE)).storeItems || []).find(i => i.id === itemId);
  const sold = await sellStoreItem(username, CLASS_CODE, itemId, rate);
  if (item && sold && sold.ok !== false) {
    await t29NotifyStudents(CLASS_CODE, { to: username, icon: "cart", tone: "coral",
      title: `Your teacher took ${item.name} from you`,
      body: rate > 0 ? `You were refunded ${Math.round(rate * 100)}% of its price (${fmtMoney(Math.round(item.price * rate * 100) / 100)}).` : "No refund was given.", href: "store.html" });
  }
  await render();
  await renderProfile(username);
}

// Quantity stepper for the bulk-remove control on each owned store item
// row: clamps to [1, owned qty] so a teacher can't type/step past what
// the student actually has.
function bulkRemoveQtyStep(itemId, delta, maxQty) {
  const input = document.getElementById(`bulkRemoveQty_${itemId}`);
  if (!input) return;
  let val = (parseInt(input.value, 10) || 1) + delta;
  val = Math.max(1, Math.min(maxQty, val));
  input.value = val;
}
function bulkRemoveQtyClamp(itemId, maxQty) {
  const input = document.getElementById(`bulkRemoveQty_${itemId}`);
  if (!input) return;
  let val = parseInt(input.value, 10);
  if (isNaN(val)) val = 1;
  val = Math.max(1, Math.min(maxQty, val));
  input.value = val;
}
async function profileRemoveStoreItemBulk(username, itemId, maxQty) {
  const input = document.getElementById(`bulkRemoveQty_${itemId}`);
  let qty = input ? parseInt(input.value, 10) : 1;
  if (isNaN(qty) || qty < 1) qty = 1;
  qty = Math.min(qty, maxQty);
  const rate = await confirmRefundRate(
    qty === 1 ? "Remove this item from the student?" : `Remove ${qty} of this item from the student?`,
    80
  );
  if (rate === null) return;
  const item = ((await getClassCached(CLASS_CODE)).storeItems || []).find(i => i.id === itemId);
  const res = await sellStoreItemBulk(username, CLASS_CODE, itemId, qty, rate);
  if (res && res.ok === false) { alert(res.error); return; }
  if (item) {
    await t29NotifyStudents(CLASS_CODE, { to: username, icon: "cart", tone: "coral",
      title: `Your teacher took ${qty === 1 ? "" : qty + " of your "}${item.name}${qty === 1 ? " from you" : ""}`,
      body: rate > 0 ? `You were refunded ${Math.round(rate * 100)}% of the price (${fmtMoney(Math.round(item.price * rate * qty * 100) / 100)}).` : "No refund was given.", href: "store.html" });
  }
  await render();
  await renderProfile(username);
}
async function profileRemoveInsurance(username, planId) {
  if (!await t29Confirm("Cancel this student's insurance plan?")) return;
  const plan = ((await getClassCached(CLASS_CODE)).insurancePlans || []).find(p => p.id === planId);
  await cancelInsurance(username, planId);
  await t29NotifyStudents(CLASS_CODE, { to: username, icon: "shield", tone: "coral",
    title: `Your teacher cancelled your insurance${plan ? ": " + plan.name : ""}`, body: "You are no longer covered by it. You can pick a plan again on the Insurance page.", href: "insurance.html" });
  await render();
  await renderProfile(username);
}

async function removeStudentClick(username, name) {
  if (await t29Confirm(`Remove ${name} from the class? Their account and balance will be permanently deleted. This cannot be undone.`)) {
    await removeStudent(CLASS_CODE, username);
    await render();
  }
}

async function reopenThisClass() {
  const btn = document.getElementById("reopenClassBtn");
  btn.disabled = true;
  await setClassArchived(CLASS_CODE, false);
  await render();
  btn.disabled = false;
}

async function restartClass() {
  const cls = await getClassCached(CLASS_CODE);
  const typed = await t29Prompt(
    `This will start "${cls.name}" again as if it were a brand-new class: every student goes back to the ${fmtMoney(t29WelcomeGrantOf(cls))} welcome grant, and everything they own or have done is wiped (jobs, houses, vehicles, shares, insurance, loans, savings, store items, events, activity and so on). Your settings, jobs, store, properties, companies, events, tax and everything else, stay exactly as they are.\n\nA report card snapshot of this term will be saved to the Reports page first, so nobody's progress is lost.\n\nThis cannot be undone. Type the class name exactly to confirm:`, "", { placeholder: "Class name", confirmText: "Restart class", danger: true }
  );
  if (typed === null) return;
  if (typed.trim() !== cls.name) {
    alert("That didn't match the class name, so nothing was changed.");
    return;
  }
  const res = await resetClass(CLASS_CODE, CURRENT.username);
  if (!res.ok) {
    alert("Something went wrong. The class couldn't be restarted. Please try again.");
  } else if (res.failed.length) {
    alert(`Class restarted, but these students' accounts couldn't be reset: ${res.failed.join(", ")}. Run Restart class again to finish them.`);
  } else {
    alert(`Class restarted. Everyone is back to the ${fmtMoney(t29WelcomeGrantOf(cls))} welcome grant, with all your settings kept. This term's report cards were saved to the Reports page.`);
  }
  await render();
}


document.addEventListener("DOMContentLoaded", init);

// Hides student rows that don't match the search box (name or username).
function filterStudentRows() {
  const box = document.getElementById("studentFilter");
  const q = box ? box.value.trim().toLowerCase() : "";
  let shown = 0;
  document.querySelectorAll("#studentTable tbody tr").forEach(tr => {
    const match = !q || (tr.dataset.search || "").includes(q);
    tr.classList.toggle("hidden", !match);
    if (match) shown++;
  });
  const none = document.getElementById("noStudentMatch");
  if (none) none.classList.toggle("hidden", !q || shown > 0);
}

/* ===================== Online now / last opened (see "Presence" in data-core.js) =====================
   All of this runs off ONE small document (presence/{classCode}) that holds every
   student's entry, so it costs a single read however big the class is: once with the
   dashboard, then about once a minute while this tab is visible (and at most every 20s
   when a profile is opened). The profile and the table dots both use that same loaded
   copy, so they add no reads of their own. */
function presenceWhen(ms) {
  if (!ms) return "";
  const d = new Date(ms), now = trustedNow();
  const tz = { timeZone: "Pacific/Auckland" };
  const time = d.toLocaleTimeString("en-NZ", Object.assign({ hour: "numeric", minute: "2-digit", hour12: true }, tz));
  const key = nzDateKey(d), today = nzDateKey(now);
  let day;
  if (key === today) day = "Today";
  else if (key === nzDateKey(new Date(now.getTime() - 86400000))) day = "Yesterday";
  else day = d.toLocaleDateString("en-NZ", Object.assign({ weekday: "short", day: "numeric", month: "short" }, key.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}, tz));
  const mins = Math.round((now.getTime() - ms) / 60000);
  const rel = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : "";
  return `${day}, ${time}${rel ? ` (${rel})` : ""}`;
}

function presenceProfileHtml(username) {
  if (!PRESENCE_LOADED) {
    return `<span class="presence-badge"><i></i>Status unavailable</span><span class="muted-small">Online status couldn't be loaded just now.</span>`;
  }
  const e = PRESENCE[username];
  const online = t29IsOnline(e);
  const badge = `<span class="presence-badge${online ? " on" : ""}"><i></i>${online ? "Online now" : "Offline"}</span>`;
  if (!e || (!e.opened && !e.active)) return `${badge}<span class="muted-small">No visits recorded yet</span>`;
  const opened = e.opened
    ? `<span class="muted-small">${online ? "Opened the site" : "Last opened the site"}: <strong>${escapeHtml(presenceWhen(e.opened))}</strong></span>` : "";
  const active = (!online && e.active && e.active !== e.opened)
    ? `<span class="muted-small">Last active: <strong>${escapeHtml(presenceWhen(e.active))}</strong></span>` : "";
  return badge + opened + active;
}

function paintProfilePresence() {
  const el = document.getElementById("profilePresence");
  if (el && PROFILE_USER) el.innerHTML = presenceProfileHtml(PROFILE_USER);
}

// Updates everything that shows presence from the copy already in memory (no reads).
function paintPresence() {
  const total = PRESENCE_STUDENTS.length;
  let online = 0;
  PRESENCE_STUDENTS.forEach(s => { if (t29IsOnline(PRESENCE[s.username])) online++; });
  const pill = document.getElementById("onlineCount");
  if (pill) {
    pill.hidden = total === 0;
    pill.textContent = `${PRESENCE_LOADED ? online : "–"}/${total} online`;
    pill.classList.toggle("has-online", PRESENCE_LOADED && online > 0);
    pill.title = PRESENCE_LOADED
      ? `${online} of ${total} student${total === 1 ? " is" : "s are"} on the site right now`
      : "Online status couldn't be loaded just now";
  }
  document.querySelectorAll("#studentTable .presence-dot").forEach(dot => {
    const on = t29IsOnline(PRESENCE[dot.dataset.user]);
    dot.classList.toggle("on", on);
    dot.title = on ? "Online now" : "Offline";
  });
  paintProfilePresence();
}

// One read of the presence doc. Skipped when the copy in memory is newer than maxAgeMs
// (so the many re-renders that follow teacher actions never re-read it), and two callers
// at once share one read.
function refreshPresence(force, maxAgeMs) {
  const maxAge = maxAgeMs === undefined ? 30000 : maxAgeMs;
  if (!force && PRESENCE_LOADED && Date.now() - PRESENCE_AT < maxAge) return Promise.resolve();
  if (!force && !PRESENCE_LOADED && T29_PRESENCE_READ_DENIED) return Promise.resolve();
  if (PRESENCE_INFLIGHT) return PRESENCE_INFLIGHT;
  PRESENCE_INFLIGHT = t29LoadPresence(CLASS_CODE).then(map => {
    if (map) { PRESENCE = map; PRESENCE_LOADED = true; PRESENCE_AT = Date.now(); }
  }).catch(() => {}).finally(() => { PRESENCE_INFLIGHT = null; });
  return PRESENCE_INFLIGHT;
}

// Keeps the count live: one read a minute, only while this tab is on screen, and not at
// all for an empty class or once the database has said the teacher can't read it.
function startPresencePolling() {
  if (PRESENCE_TIMER) return;
  const tick = () => {
    if (document.visibilityState !== "visible" || T29_PRESENCE_READ_DENIED || !PRESENCE_STUDENTS.length) return;
    refreshPresence(true).then(paintPresence);
  };
  PRESENCE_TIMER = setInterval(tick, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - PRESENCE_AT > 30000) tick();
  });
}
