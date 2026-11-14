let CURRENT, IS_TEACHER, EDITING_ID = null, EDITING_RANDOM_ID = null;
let ACTIVE_TAB = null, LAST_TABS = null;
let STUDENT_DATA = { hist: [], cat: [] };
const EV_FILTERS = { hist: { type: "all", dir: "all" }, all: { type: "all", dir: "all" } };
const EV_TAB_KEY = "t29-events-tab";
const EV_PANES = { random: "paneRandom", big: "paneBig", history: "paneHistory", all: "paneAll" };

const MODULE_LABEL = { income: "Income", property: "Property", transport: "Transport", general: "General" };
const STATUS_LABEL = { pending: "Awaiting response", paid: "Paid", lost: "Lost the asset", claimed: "Claimed on insurance", received: "Received" };
const STATUS_CLASS = { pending: "status-pending", paid: "status-approved", lost: "status-declined", claimed: "status-approved", received: "status-approved" };
// What a percentage cost/payout is a percentage of, for each thing an event can be about.
const PERCENT_BASE_TEXT = {
  income: "the student's weekly wage",
  property: "the present market price of the house it hits",
  transport: "the present price of the vehicle it hits"
};

// Teachers naturally type amounts like "$10" or "1,000" in a money app, so plain Number() would
// silently fall back to 0. This strips currency symbols/commas/whitespace first so those work.
function parseMoneyInput(str) {
  if (str === undefined || str === null) return NaN;
  const cleaned = String(str).replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return NaN;
  return Number(cleaned);
}

/* ---------------- Tabs ----------------
   Teachers get Random events | Big events. Students get My history, plus All possible events when
   their teacher has switched that on. The open tab is remembered for the visit and can be linked to
   (bigevents.html#big, #random, #history, #all). */
function evTabList(cls, counts) {
  if (IS_TEACHER) {
    return [
      { key: "random", label: "Random events", icon: "dice", count: (cls.eventDefs || []).length },
      { key: "big", label: "Big events", icon: "bolt", count: (cls.bigEventDefs || []).length }
    ];
  }
  const list = [{ key: "history", label: "My history", icon: "history", count: counts.hist }];
  if (studentsSeeAllEvents(cls)) list.push({ key: "all", label: "All possible events", icon: "eye", count: counts.all });
  return list;
}
function evResolveTab(list) {
  const keys = list.map(t => t.key);
  if (ACTIVE_TAB && keys.includes(ACTIVE_TAB)) return ACTIVE_TAB;
  let want = (location.hash || "").replace(/^#/, "");
  if (!keys.includes(want)) { try { want = sessionStorage.getItem(EV_TAB_KEY) || ""; } catch (e) { want = ""; } }
  return keys.includes(want) ? want : keys[0];
}
function paintTabs(list) {
  LAST_TABS = list;
  ACTIVE_TAB = evResolveTab(list);
  const bar = document.getElementById("evTabs");
  if (list.length < 2) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    bar.dataset.sig = "";
  } else {
    const html = list.map(t => {
      const on = t.key === ACTIVE_TAB;
      const id = "tab" + t.key.charAt(0).toUpperCase() + t.key.slice(1);
      return `<button type="button" role="tab" id="${id}" class="${on ? "active" : ""}" aria-selected="${on}" aria-controls="${EV_PANES[t.key]}" onclick="showTab('${t.key}')">${icon(t.icon, 18)} ${t.label} <span class="ev-tab-count">${t.count}</span></button>`;
    }).join("");
    // Only rebuilt when something changed, so a background refresh never steals keyboard focus.
    if (bar.dataset.sig !== html) { bar.innerHTML = html; bar.dataset.sig = html; }
    bar.classList.remove("hidden");
  }
  Object.keys(EV_PANES).forEach(k => {
    const pane = document.getElementById(EV_PANES[k]);
    if (pane) pane.classList.toggle("hidden", !list.some(t => t.key === k) || k !== ACTIVE_TAB);
  });
}
function showTab(key) {
  ACTIVE_TAB = key;
  try { sessionStorage.setItem(EV_TAB_KEY, key); } catch (e) { /* ignore */ }
  try { window.history.replaceState(null, "", "#" + key); } catch (e) { /* ignore */ }
  if (LAST_TABS) paintTabs(LAST_TABS);
  const b = document.querySelector('#evTabs [aria-selected="true"]');
  if (b) b.focus({ preventScroll: true });
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("bolt", 26) + " Events";
  document.getElementById("pageIntro").textContent = IS_TEACHER
    ? "Everything unexpected that can happen to your students lives here. Random events are everyday surprises spread across the school week, and big events are rarer, high-stakes moments. Set both up, run them on demand, and choose whether students can see what could happen."
    : "Random events are everyday surprises that can land on any school day, and big events are rarer with higher stakes. Everything that has happened to you is listed below.";
  document.getElementById("hRandom").innerHTML = icon("dice", 18) + " Random events";
  document.getElementById("hBig").innerHTML = icon("bolt", 18) + " Big events";
  document.getElementById("runEventsNowBtn").innerHTML = icon("sparkle", 14) + " Run this week's events now";
  document.getElementById("runBigEventsBtn").innerHTML = icon("bolt", 14) + " Run this week's big events now";
  document.getElementById("addEventBtn").innerHTML = icon("plus", 15) + " Add event";
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add event";
  document.getElementById("hHistory").innerHTML = icon("history", 18) + " My event history";
  document.getElementById("hAll").innerHTML = icon("eye", 18) + " Every event that could happen";
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = t29DisplayName(u);
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = "Dashboard";
  if (IS_TEACHER) { updateCostLabel(); toggleEventType(); updateEventCoverBox(); }
  document.getElementById("visCard").classList.toggle("hidden", !IS_TEACHER);
  paintChrome();
  // These 8 jobs are all independent of each other (each is its own
  // guarded, self-contained check-and-maybe-write), so running them one
  // at a time — 8 separate sequential network round-trips — was a big
  // chunk of load time, especially on a slow mobile connection. Running
  // them together cuts that to roughly the time of the single slowest one.
  const T29_STARTUP_JOBS = Promise.all([
    IS_TEACHER
      ? safeBgJob(payDayForClassIfDue(u.classCode), "payDayForClassIfDue")
      : safeBgJob(payMyWageIfDue(u.username), "payMyWageIfDue"),
    IS_TEACHER
      ? safeBgJob(dailyLifeAllowanceForClassIfDue(u.classCode), "dailyLifeAllowanceForClassIfDue")
      : safeBgJob(payMyDailyLifeAllowanceIfDue(u.username), "payMyDailyLifeAllowanceIfDue"),
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
  // Kick the day's jobs off but DON'T block the page on them: paint what
  // we already have first, then wait. On the first load of the day pay day
  // alone can take seconds (it writes per student), and blocking here is
  // what made a phone sit on a blank page. The popups and the final
  // render() below still run after the jobs, exactly as they did before.
  await t29FirstPaint(render);
  await T29_STARTUP_JOBS;
  // These popups read the results of the jobs above (e.g. a weekly event
  // that just got generated), so they still need to run afterwards — but
  // they stay sequential since each checks "is another popup already
  // showing" before deciding to show its own.
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await checkAdjustmentPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const cls = await getClassCached(CURRENT.classCode);
  if (IS_TEACHER) {
    renderTeacher(cls);
    paintTabs(evTabList(cls, {}));
  } else {
    const counts = renderStudent(cls);
    paintTabs(evTabList(cls, counts));
  }
}

/* ---------------- Teacher ---------------- */
function renderTeacher(cls) {
  const on = studentsSeeAllEvents(cls);
  const box = document.getElementById("visBox");
  if (!box.disabled) box.checked = on;
  paintVisNote(on);
  renderRandomList(cls);
  renderBigList(cls);
}

function paintVisNote(on) {
  document.getElementById("visNote").textContent = on
    ? "On: students have an \"All possible events\" tab here listing every active random and big event, with amounts and who can get it. They don't see the \"what happened\" lines on multiple choice events. Switch off to hide it again."
    : "Off: students only see events that have already happened to them. Switch on to let them browse everything that could happen.";
}

async function toggleStudentsSeeAll(box) {
  const on = box.checked;
  box.disabled = true;
  try {
    await setStudentsSeeAllEvents(CURRENT.classCode, on);
    paintVisNote(on);
    t29Toast(on ? "Students can now see every possible event." : "Students can no longer see every possible event.");
  } catch (e) {
    box.checked = !on;
    paintVisNote(!on);
    t29Toast("Couldn't change that. Please try again.", { type: "error" });
  }
  box.disabled = false;
}

function randomDefRowHtml(ev) {
  const isChoice = ev.type === "choice";
  const bad = ev.severity === "bad";
  const money = isChoice
    ? `<div class="ev-desc"><strong>Choices:</strong> ${(ev.options || []).map(o => `${escapeHtml(o.label)} (${eventAmountText(o.amount, o.percent, ev.amountBase)})${o.outcome ? `: ${escapeHtml(o.outcome)}` : ""}`).join(", ")}</div>`
    : `<div class="ev-desc"><strong>${eventAmountText(ev.amount, ev.amountMode === "percent" ? ev.amountPercent : 0, ev.amountBase)}</strong></div>`;
  return `<div class="ev-row random">
    <span class="ev-ico">${icon("dice", 20)}</span>
    <div class="ev-main">
      <div class="ev-title"><span>${escapeHtml(ev.name)}</span>
        ${isChoice ? `<span class="badge lilac">Multiple choice</span>` : ""}
        <span class="badge ${bad ? "coral" : "navy"}">${bad ? "Bad" : "Neutral"}</span>
        <span class="badge ${ev.repeatable ? "mint" : "navy"}">${ev.repeatable ? "Can repeat" : "Once per student"}</span>
      </div>
      ${ev.description ? `<div class="ev-desc">${escapeHtml(ev.description)}</div>` : ""}
      ${money}
      ${bad ? `<div class="muted-small ev-when">${icon("shield", 12)} ${weeklyEventInsuranceText(ev)}</div>` : ""}
    </div>
    <div class="ev-side ev-side-btns">
      <button class="btn small secondary" onclick="startEditRandomEvent('${ev.id}')">${icon("edit", 13)} Edit</button>
      <button class="btn small coral" onclick="removeRandomEvent('${ev.id}')">${icon("trash", 13)} Remove</button>
    </div>
  </div>`;
}

function renderRandomList(cls) {
  const evs = cls.eventDefs || [];
  document.getElementById("noEvents").classList.toggle("hidden", evs.length > 0);
  document.getElementById("eventListFold").classList.toggle("hidden", evs.length === 0);
  document.getElementById("eventListTitle").textContent = `Your random events (${evs.length})`;
  document.getElementById("eventList").innerHTML = evs.map(randomDefRowHtml).join("");
  paintEventReco(cls);
}

function bigDefRowHtml(d) {
  const isGood = d.kind === "good";
  const isGeneral = d.module === "general";
  const takesAsset = d.takesAsset !== false;
  const coverage = MODULE_TO_COVERAGE[d.module];
  const happened = !isGood ? incidentLabels(coverage, d.incident, "label").join(" + ") : "";
  const insLine = !isGood && INSURANCE_TYPES[coverage]
    ? (happened ? `What happened: ${escapeHtml(happened)} &middot; ` : "")
      + ((d.insuranceCover || []).length
        ? `Insurance: ${escapeHtml(insuranceCoverSummary(coverage, d.insuranceCover, d.incident))} (plus the plan's excess)`
        : `Insurance: any ${coverage} plan that covers this pays the full cost (the student pays the excess)`)
    : "";
  const costLine = d.costMode === "percent"
    ? `<strong>${isGood ? "+" : ""}${Number(d.costPercent)}%</strong> of ${PERCENT_BASE_TEXT[d.module] || "the item's present cost"}, ${isGood ? "paid to the student" : "to pay"}`
    : `<strong>${isGood ? "+" : ""}${fmtMoney(d.cost)}</strong> ${isGood ? "paid to the student" : "to pay"}`;
  return `<div class="ev-row big">
    <span class="ev-ico">${icon("bolt", 20)}</span>
    <div class="ev-main">
      <div class="ev-title"><span>${escapeHtml(d.name)}</span>
        <span class="badge navy">${MODULE_LABEL[d.module] || escapeHtml(d.module)}</span>
        <span class="badge ${isGood ? "gold" : "coral"}">${isGood ? "Good" : "Bad"}</span>
      </div>
      <div class="ev-desc">${escapeHtml(d.description) || "No description provided."}</div>
      <div class="ev-desc">${costLine}</div>
      ${insLine ? `<div class="muted-small ev-when">${insLine}</div>` : ""}
      ${!isGood ? `<div class="muted-small ev-when">${takesAsset ? "Not paying costs the student the related job/property/vehicle." : "Cost only. The student can't lose the asset over this."}</div>` : ""}
      ${isGood && isGeneral ? `<div class="muted-small ev-when">Open to everyone, not tied to any job, property, or vehicle.</div>` : ""}
    </div>
    <div class="ev-side ev-side-btns">
      <button class="btn small secondary" onclick="startEditEvent('${d.id}')">${icon("edit", 13)} Edit</button>
      <button class="btn small coral" onclick="deleteEvent('${d.id}')">${icon("trash", 13)} Remove</button>
    </div>
  </div>`;
}

function renderBigList(cls) {
  const defs = cls.bigEventDefs || [];
  paintBigReco(cls);
  document.getElementById("noDefs").classList.toggle("hidden", defs.length > 0);
  document.getElementById("bigListFold").classList.toggle("hidden", defs.length === 0);
  document.getElementById("bigListTitle").textContent = `Your big events (${defs.length})`;
  document.getElementById("defList").innerHTML = defs.map(bigDefRowHtml).join("");
}

async function runWeeklyEventsNow() {
  const btn = document.getElementById("runEventsNowBtn");
  if (btn.disabled) return; // already running, ignore extra clicks
  btn.disabled = true;
  try {
    const count = await forceWeeklyEvents(CURRENT.classCode);
    document.getElementById("runEventsMsg").innerHTML = count > 0
      ? `<div class="success-msg">Done: ${count} event(s) assigned across the class. They'll pop up within the next 20 minutes as students use the site.</div>`
      : `<div class="error-msg">No active random events are set up yet.</div>`;
    await render();
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- Student ---------------- */
const EV_BASE_ME = {
  income: "your weekly wage",
  property: "the market price of one of your properties",
  transport: "the price of one of your vehicles"
};
const EV_COVER_NAME = { general: "General", property: "Property", transport: "Transport", jobs: "Jobs / Income" };
const EV_ASSET_NAME = { income: "job", property: "property", transport: "vehicle" };

// Log dates are saved as en-NZ text ("14/11/2026, 3:04:05 pm"), so turn them back into a time for sorting.
function evParseNz(str) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])/i.exec(String(str || ""));
  if (!m) return 0;
  let h = Number(m[4]) % 12;
  if (m[7].toLowerCase() === "p") h += 12;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h, Number(m[5]), Number(m[6] || 0));
}
// The moments only need to sort against each other, so the missing time zone doesn't matter. revealAt (a real
// timestamp) is only a fallback, so the two are never mixed for one entry.
function evWhen(e) {
  const t = evParseNz(e.date);
  if (t) return t;
  return Number.isFinite(Number(e.revealAt)) ? Number(e.revealAt) : 0;
}

function evDirOf(amount, percent) {
  const v = Number(percent) || Number(amount) || 0; // a percentage, when set, decides the direction
  return v > 0 ? "gain" : v < 0 ? "cost" : "none";
}
function evAmtClass(dir) { return dir === "gain" ? "up" : dir === "cost" ? "down" : "flat"; }
function evMoneyText(amount, percent, base) {
  const p = Number(percent) || 0;
  if (p) return `${p > 0 ? "+" : "-"}${Math.abs(p)}% of ${EV_BASE_ME[base] || "an item's price"}`;
  const a = Number(amount) || 0;
  if (a === 0) return "No change";
  return a > 0 ? `+${fmtMoney(a)}` : fmtMoney(a);
}
function evChancePct() {
  return typeof BIG_EVENT_WEEKLY_CHANCE === "number" ? Math.round(BIG_EVENT_WEEKLY_CHANCE * 100) : 30;
}
function evWeeklyRange() {
  return typeof WEEKLY_EVENTS_MIN === "number" && typeof WEEKLY_EVENTS_MAX === "number"
    ? `${WEEKLY_EVENTS_MIN} to ${WEEKLY_EVENTS_MAX}` : "2 to 5";
}

function randomHistoryItem(e, order) {
  const pending = e.status === "pending";
  const choice = e.type === "choice";
  const amt = pending || e.amount === null || e.amount === undefined ? null : Number(e.amount);
  const dir = amt === null || !Number.isFinite(amt) ? "none" : evDirOf(amt, 0);
  const chosen = choice && e.chosenOptionId ? (e.options || []).find(o => o.id === e.chosenOptionId) : null;
  const lines = [];
  if (chosen) lines.push(`You chose "${escapeHtml(chosen.label)}"` + (e.outcome ? `: ${escapeHtml(e.outcome)}` : ""));
  else if (e.description) lines.push(escapeHtml(e.description));
  if (e.basisNote) lines.push(escapeHtml(e.basisNote));
  if (e.claimed) lines.push("Insurance paid some of this back.");
  let amountHtml;
  if (amt === null || !Number.isFinite(amt)) amountHtml = `<span class="ev-amt flat">Waiting</span>`;
  else if (amt === 0) amountHtml = `<span class="ev-amt flat">No change</span>`;
  else amountHtml = `<span class="ev-amt ${evAmtClass(dir)}">${amt > 0 ? "+" : ""}${fmtMoney(amt)}</span>`;
  const statusHtml = pending ? `<span class="status-pending">Awaiting your choice</span>`
    : e.claimed ? `<span class="status-approved">Claimed on insurance</span>`
    : `<span class="ev-quiet">${choice ? "Answered" : "Happened"}</span>`;
  return { kind: "random", name: e.name, dirs: [dir], assetName: e.assetName || "", lines, date: e.date || "", amountHtml, statusHtml, t: evWhen(e), order };
}

function bigHistoryItem(e, order) {
  const good = e.kind === "good";
  const money = e.autoClaimed ? e.insurancePaid : e.cost;
  const lines = [];
  if (e.description) lines.push(escapeHtml(e.description));
  if (e.basisNote) lines.push(escapeHtml(e.basisNote));
  if (e.autoClaimed) lines.push(`Cost ${fmtMoney(e.originalCost != null ? e.originalCost : e.cost)}` + (e.insuranceNote ? ": " + escapeHtml(e.insuranceNote) : ""));
  if (e.writtenOff) lines.push("The insurer took the property.");
  let amountHtml;
  if (good) amountHtml = `<span class="ev-amt up">+${fmtMoney(money)}</span>`;
  else if (e.status === "lost") amountHtml = `<span class="ev-amt flat">Not paid</span>`;
  // Only a straight payment takes the full cost. A claim costs just the plan's excess and a pending one
  // hasn't been paid yet, so the event's cost is shown as information rather than as money taken.
  else if (e.status === "paid") amountHtml = `<span class="ev-amt down">-${fmtMoney(money)}</span>`;
  else amountHtml = `<span class="ev-amt flat">Cost ${fmtMoney(money)}</span>`;
  const statusHtml = `<span class="${e.lostVehicle ? "status-declined" : (STATUS_CLASS[e.status] || "")}">${STATUS_LABEL[e.status] || ""}${e.lostVehicle ? ", lost the vehicle" : ""}</span>`;
  return { kind: "big", name: e.name, dirs: [good ? "gain" : "cost"], assetName: e.assetName || "", module: e.module, lines, date: e.date || "", amountHtml, statusHtml, t: evWhen(e), order };
}

// Only things that have actually happened: not ones still waiting for their day, or dropped.
function buildHistory(cls, username) {
  const out = [];
  (cls.eventLog || []).forEach((e, i) => {
    if (e.studentUser !== username || ["planned", "scheduled", "skipped"].includes(e.status)) return;
    out.push(randomHistoryItem(e, i));
  });
  (cls.bigEventLog || []).forEach((e, i) => {
    if (e.studentUser !== username || e.status === "scheduled" || e.status === "skipped") return;
    out.push(bigHistoryItem(e, 100000 + i));
  });
  return out.sort((a, b) => b.t - a.t || b.order - a.order);
}

function randomWho(ev) {
  const base = weeklyEventBase(ev);
  if (base === "income") return "Needs a job";
  if (base === "property") return "Needs a property";
  if (base === "transport") return "Needs a vehicle";
  if (ev.severity === "bad" && ev.coverage === "property") return "Needs a home";
  if (ev.severity === "bad" && ev.coverage === "transport") return "Needs a vehicle";
  return "";
}
function bigWho(d) {
  const need = { income: "Needs a job", property: "Needs a property", transport: "Needs a vehicle" }[d.module];
  if (d.kind === "good") return need && bigEventIsPercent(d) ? need : "Open to everyone";
  return need || "";
}
const evTag = (ic, text) => `<span class="ev-tag">${icon(ic, 12)} ${escapeHtml(text)}</span>`;

function randomCatalogItem(ev) {
  const choice = ev.type === "choice";
  const bad = ev.severity === "bad";
  let dirs, body;
  if (choice) {
    const opts = ev.options || [];
    dirs = [...new Set(opts.map(o => evDirOf(o.amount, o.percent)).filter(d => d !== "none"))];
    body = `<ul class="ev-opts">${opts.map(o => `<li><span>${escapeHtml(o.label)}</span><span class="ev-amt ${evAmtClass(evDirOf(o.amount, o.percent))}">${escapeHtml(evMoneyText(o.amount, o.percent, ev.amountBase))}</span></li>`).join("")}</ul>`;
  } else {
    const pct = ev.amountMode === "percent" ? ev.amountPercent : 0;
    const d = evDirOf(ev.amount, pct);
    dirs = d === "none" ? [] : [d];
    body = `<div class="ev-money"><span class="ev-amt ${evAmtClass(d)}">${escapeHtml(evMoneyText(ev.amount, pct, ev.amountBase))}</span></div>`;
  }
  const tags = [];
  const who = randomWho(ev);
  if (who) tags.push(evTag("users", who));
  tags.push(evTag("repeat", ev.repeatable ? "Can repeat" : "Once only"));
  if (bad) tags.push(evTag("shield", `Insurance can help (${EV_COVER_NAME[ev.coverage] || "General"})`));
  return {
    kind: "random", name: ev.name, desc: ev.description || "", dirs: dirs.length ? dirs : ["none"], body, tags,
    badges: choice ? `<span class="badge lilac">You choose</span>` : ""
  };
}

function bigCatalogItem(d) {
  const good = d.kind === "good";
  const pct = d.costMode === "percent";
  const amt = pct
    ? `${good ? "+" : "-"}${Number(d.costPercent)}% of ${EV_BASE_ME[d.module] || "an item's price"}`
    : `${good ? "+" : "-"}${fmtMoney(d.cost)}`;
  const tags = [];
  const who = bigWho(d);
  if (who) tags.push(evTag("users", who));
  if (!good) {
    const thing = EV_ASSET_NAME[d.module] || "asset";
    tags.push(evTag("lock", d.takesAsset === false ? "Cost only, you can't lose the " + thing : "Not paying loses your " + thing));
    tags.push(evTag("shield", `Insurance can help (${EV_COVER_NAME[MODULE_TO_COVERAGE[d.module]] || "General"})`));
  }
  return {
    kind: "big", name: d.name, desc: d.description || "", dirs: [good ? "gain" : "cost"],
    body: `<div class="ev-money"><span class="ev-amt ${good ? "up" : "down"}">${escapeHtml(amt)}</span> <span class="muted-small">${good ? "paid to you" : "to pay"}</span></div>`,
    tags,
    badges: `<span class="badge navy">${MODULE_LABEL[d.module] || escapeHtml(d.module)}</span> <span class="badge ${good ? "gold" : "coral"}">${good ? "Good" : "Bad"}</span>`
  };
}

function buildCatalogue(cls) {
  const out = [];
  (cls.eventDefs || []).filter(e => e.active).forEach(ev => out.push(randomCatalogItem(ev)));
  (cls.bigEventDefs || []).filter(e => e.active).forEach(d => out.push(bigCatalogItem(d)));
  return out;
}

function historyRowHtml(it) {
  const big = it.kind === "big";
  return `<div class="ev-row ${it.kind}">
    <span class="ev-ico">${icon(big ? "bolt" : "dice", 20)}</span>
    <div class="ev-main">
      <div class="ev-title"><span>${escapeHtml(it.name)}</span>
        <span class="badge ${big ? "gold" : "lilac"}">${big ? "Big" : "Random"}</span>
        ${it.assetName ? `<span class="ev-asset">${escapeHtml(it.assetName)}</span>` : ""}
      </div>
      ${it.lines.map(l => `<div class="ev-desc">${l}</div>`).join("")}
      <div class="muted-small ev-when">${escapeHtml(it.date)}</div>
    </div>
    <div class="ev-side">${it.amountHtml}${it.statusHtml}</div>
  </div>`;
}

function catalogCardHtml(it) {
  return `<div class="ev-card ${it.kind}">
    <div class="ev-card-head">
      <span class="ev-ico">${icon(it.kind === "big" ? "bolt" : "dice", 20)}</span>
      <div class="ev-main"><div class="ev-title"><span>${escapeHtml(it.name)}</span> ${it.badges}</div></div>
    </div>
    ${it.desc ? `<div class="ev-desc">${escapeHtml(it.desc)}</div>` : ""}
    ${it.body}
    ${it.tags.length ? `<div class="ev-tags">${it.tags.join("")}</div>` : ""}
  </div>`;
}

function paintSummary(hist) {
  const random = hist.filter(i => i.kind === "random").length;
  document.getElementById("evSummary").innerHTML = `
    <div class="stat"><span class="icon">${icon("history", 30)}</span><div class="label">All events</div><div class="value">${hist.length}</div></div>
    <div class="stat lilac"><span class="icon">${icon("dice", 30)}</span><div class="label">Random events</div><div class="value">${random}</div></div>
    <div class="stat gold"><span class="icon">${icon("bolt", 30)}</span><div class="label">Big events</div><div class="value">${hist.length - random}</div></div>`;
}

function paintFilters(pane, counts) {
  const box = document.getElementById(pane === "hist" ? "histFilters" : "allFilters");
  const f = EV_FILTERS[pane];
  const group = (label, key, opts) => `<div class="ev-filter-group" role="group" aria-label="${label}">
      <span class="ev-filter-label">${label}</span>
      ${opts.map(([v, text, n]) => `<button type="button" class="ev-chip" data-k="${key}" data-v="${v}" aria-pressed="${f[key] === v}" onclick="setEvFilter('${pane}','${key}','${v}')">${text}${n === undefined ? "" : ` <span class="ev-chip-n">${n}</span>`}</button>`).join("")}
    </div>`;
  box.innerHTML = group("Type", "type", [["all", "All", counts.all], ["random", "Random", counts.random], ["big", "Big", counts.big]])
    + group("Outcome", "dir", [["all", "Any"], ["gain", "Gains"], ["cost", "Costs"]]);
}

function setEvFilter(pane, key, value) {
  EV_FILTERS[pane][key] = value;
  paintStudentList(pane);
  // The chips are redrawn, so put keyboard focus back on the one that was pressed.
  const box = document.getElementById(pane === "hist" ? "histFilters" : "allFilters");
  const b = box.querySelector(`[data-k="${key}"][data-v="${value}"]`);
  if (b) b.focus({ preventScroll: true });
}
function clearEvFilters(pane) {
  EV_FILTERS[pane] = { type: "all", dir: "all" };
  paintStudentList(pane);
}

function paintStudentList(pane) {
  const isHist = pane === "hist";
  const items = isHist ? STUDENT_DATA.hist : STUDENT_DATA.cat;
  const f = EV_FILTERS[pane];
  const random = items.filter(i => i.kind === "random").length;
  const filtersBox = document.getElementById(isHist ? "histFilters" : "allFilters");
  const listBox = document.getElementById(isHist ? "historyList" : "allList");
  const empty = document.getElementById(isHist ? "noHistory" : "noAll");
  if (!items.length) {
    filtersBox.innerHTML = "";
    listBox.innerHTML = "";
    empty.textContent = isHist ? "Nothing has happened yet, hopefully it stays that way!" : "Your teacher hasn't set up any events yet.";
    empty.classList.remove("hidden");
    return;
  }
  paintFilters(pane, { all: items.length, random, big: items.length - random });
  const shown = items.filter(i => (f.type === "all" || i.kind === f.type) && (f.dir === "all" || i.dirs.includes(f.dir)));
  if (!shown.length) {
    listBox.innerHTML = "";
    empty.innerHTML = `No events match these filters.<br><button type="button" class="btn small secondary" onclick="clearEvFilters('${pane}')">Clear filters</button>`;
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  if (isHist) {
    listBox.innerHTML = shown.map(historyRowHtml).join("");
    return;
  }
  const groups = [
    ["random", "Random events", "dice", `Everyday surprises. Every student gets ${evWeeklyRange()} a week, each on a different school day.`],
    ["big", "Big events", "bolt", `Rarer and higher stakes. Each week there's about a ${evChancePct()}% chance of one.`]
  ];
  listBox.innerHTML = groups.map(([k, title, ic, sub]) => {
    const arr = shown.filter(i => i.kind === k);
    if (!arr.length) return "";
    return `<h3 class="ev-section-title">${icon(ic, 18)} ${title} <span class="badge navy">${arr.length}</span></h3>
      <p class="muted-small ev-section-sub">${sub}</p>
      <div class="ev-grid">${arr.map(catalogCardHtml).join("")}</div>`;
  }).join("");
}

// Builds both student views from the class doc and returns the tab counts.
function renderStudent(cls) {
  const seeAll = studentsSeeAllEvents(cls);
  const hist = buildHistory(cls, CURRENT.username);
  const cat = seeAll ? buildCatalogue(cls) : [];
  STUDENT_DATA = { hist, cat };
  paintSummary(hist);
  paintStudentList("hist");
  if (seeAll) paintStudentList("all");
  document.getElementById("pageIntro").textContent = seeAll
    ? "Random events are everyday surprises that can land on any school day, and big events are rarer with higher stakes. Your history is below, and your teacher has also let you see every event that could happen."
    : "Random events are everyday surprises that can land on any school day, and big events are rarer with higher stakes. Everything that has happened to you is listed below.";
  return { hist: hist.length, all: cat.length };
}

/* ---------------- Big event form ---------------- */
async function addEvent(e) {
  e.preventDefault();
  const picked = readInsuranceCoverPicker("beCoverBox");
  if (picked === null) return false;
  const costMode = document.getElementById("beCostMode").value === "percent" ? "percent" : "fixed";
  const costPercent = Number(document.getElementById("beCostPercent").value);
  if (costMode === "percent" && (!Number.isFinite(costPercent) || costPercent <= 0 || costPercent > 1000)) {
    alert("Enter a percentage between 0.01 and 1000.");
    return false;
  }
  const ev = {
    insuranceCover: picked.cover,
    incident: picked.incident,
    name: document.getElementById("beName").value.trim(),
    module: document.getElementById("beModule").value,
    kind: document.getElementById("beKind").value,
    costMode,
    costPercent: costMode === "percent" ? costPercent : null,
    cost: costMode === "percent" ? 0 : document.getElementById("beCost").value,
    description: document.getElementById("beDesc").value.trim(),
    takesAsset: document.getElementById("beTakesAsset").checked
  };
  const wasEditing = !!EDITING_ID;
  if (EDITING_ID) await updateBigEventDef(CURRENT.classCode, EDITING_ID, ev);
  else await addBigEventDef(CURRENT.classCode, ev);
  resetEventForm();
  await render();
  t29Toast(wasEditing ? "Big event updated." : "Big event added.");
  return false;
}

function resetEventForm() {
  EDITING_ID = null;
  ["beName","beCost","beCostPercent","beDesc"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("beTakesAsset").checked = true;
  document.getElementById("beCostMode").value = "fixed";
  document.getElementById("beKind").value = "bad";
  document.getElementById("beModule").value = "income";
  updateCostLabel();
  updateCoverBox([]);
  document.getElementById("addBtn").innerHTML = icon("plus", 15) + " Add event";
  document.getElementById("bigFoldTitle").textContent = "Add a big event";
  document.getElementById("bigFold").open = false;
  const cancelBtn = document.getElementById("cancelEditBtn");
  if (cancelBtn) cancelBtn.remove();
}

function startEditEvent(id) {
  getClassCached(CURRENT.classCode).then(cls => {
    const d = (cls.bigEventDefs || []).find(x => x.id === id);
    if (!d) return;
    EDITING_ID = id;
    document.getElementById("beName").value = d.name;
    document.getElementById("beModule").value = d.module;
    document.getElementById("beKind").value = d.kind || "bad";
    const isPct = d.costMode === "percent";
    document.getElementById("beCostMode").value = isPct ? "percent" : "fixed";
    document.getElementById("beCostPercent").value = isPct ? d.costPercent : "";
    document.getElementById("beCost").value = isPct ? "" : d.cost;
    document.getElementById("beDesc").value = d.description || "";
    document.getElementById("beTakesAsset").checked = d.takesAsset !== false;
    updateCostLabel();
    updateCoverBox(d.insuranceCover || [], d.incident || null);
    document.getElementById("addBtn").innerHTML = icon("save", 15) + " Save changes";
    document.getElementById("bigFoldTitle").textContent = "Edit big event";
    document.getElementById("bigFold").open = true;
    if (!document.getElementById("cancelEditBtn")) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.id = "cancelEditBtn";
      cancelBtn.className = "btn small secondary";
      cancelBtn.style.marginLeft = "8px";
      cancelBtn.textContent = "Cancel edit";
      cancelBtn.onclick = resetEventForm;
      document.getElementById("addBtn").insertAdjacentElement("afterend", cancelBtn);
    }
    document.getElementById("addBtn").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function updateCostLabel() {
  const kind = document.getElementById("beKind").value;
  const isGood = kind === "good";
  // Losing the asset is only ever a possibility for "bad" events — good
  // events are windfalls with nothing to forfeit.
  document.getElementById("takesAssetRow").classList.toggle("hidden", isGood);
  document.getElementById("takesAssetHint").classList.toggle("hidden", isGood);
  // "General" (not tied to any job/property/vehicle) only makes sense for
  // good events — a bad event needs a real asset to threaten or insure.
  const generalOpt = document.getElementById("beModuleGeneral");
  const moduleSelect = document.getElementById("beModule");
  generalOpt.classList.toggle("hidden", !isGood);
  generalOpt.disabled = !isGood;
  if (!isGood && moduleSelect.value === "general") moduleSelect.value = "income";
  // A percentage needs something to take it from, so "general" events can
  // only be a set amount.
  const module = moduleSelect.value;
  const canPercent = module !== "general";
  const modeSelect = document.getElementById("beCostMode");
  const percentOpt = document.getElementById("beCostModePercent");
  percentOpt.classList.toggle("hidden", !canPercent);
  percentOpt.disabled = !canPercent;
  if (!canPercent && modeSelect.value === "percent") modeSelect.value = "fixed";
  const percent = modeSelect.value === "percent";
  document.getElementById("beFixedWrap").classList.toggle("hidden", percent);
  document.getElementById("bePercentWrap").classList.toggle("hidden", !percent);
  // Only the visible box is required (a hidden required box would block saving).
  document.getElementById("beCost").required = !percent;
  document.getElementById("beCostPercent").required = percent;
  document.getElementById("labCost").textContent = isGood ? "Amount paid to the student" : "Cost to fix / avoid";
  document.getElementById("labCostPercent").textContent = isGood ? "Payout (% of the item's present cost)" : "Cost (% of the item's present cost)";
  const hint = document.getElementById("bePercentHint");
  hint.classList.toggle("hidden", !percent);
  if (percent) {
    hint.textContent = `A percentage of ${PERCENT_BASE_TEXT[module]}. It's worked out when the event happens, from what that is worth at that moment, so only students who have one can get this event.`;
  }
  updateCoverBox();
}

// Shows the insurance-types picker for bad property/transport events.
// Pass `cover` (and `incident`) to load an event's saved setup (when
// editing); without it the picker is only rebuilt when the coverage
// actually changes, so switching back and forth (e.g. to Good and back)
// doesn't wipe what the teacher has ticked. A hidden picker reads back as
// nothing ticked.
function updateCoverBox(cover, incident) {
  const bad = document.getElementById("beKind").value === "bad";
  const coverage = MODULE_TO_COVERAGE[document.getElementById("beModule").value] || "";
  const box = document.getElementById("beCoverBox");
  if (cover !== undefined || (box.dataset.coverage || "") !== (INSURANCE_TYPES[coverage] ? coverage : "")) {
    renderInsuranceCoverPicker("beCoverBox", coverage, cover || [], incident || null);
  }
  box.classList.toggle("hidden", !bad || !INSURANCE_TYPES[coverage]);
  // With a percentage cost the amounts each insurance type pays are still dollar caps — say so.
  const percent = document.getElementById("beCostMode").value === "percent";
  document.getElementById("bePercentInsNote").classList.toggle("hidden", !(bad && percent && INSURANCE_TYPES[coverage]));
}

/* ---------------- Random events (moved here from the teacher dashboard) ---------------- */
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

async function addRandomEventForm(e) {
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

  const wasEditing = !!EDITING_RANDOM_ID;
  if (EDITING_RANDOM_ID) {
    await updateEventDef(CURRENT.classCode, EDITING_RANDOM_ID, ev);
  } else {
    await addEventDef(CURRENT.classCode, ev);
  }
  resetRandomEventForm();
  await render();
  t29Toast(wasEditing ? "Random event updated." : "Random event added.");
  return false;
}

function resetRandomEventForm() {
  EDITING_RANDOM_ID = null;
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
  document.getElementById("eventFoldTitle").textContent = "Add a random event";
  document.getElementById("eventFold").open = false;
  const cancelBtn = document.getElementById("cancelEditEventBtn");
  if (cancelBtn) cancelBtn.remove();
}

function startEditRandomEvent(id) {
  getClassCached(CURRENT.classCode).then(cls => {
    const ev = (cls.eventDefs || []).find(e => e.id === id);
    if (!ev) return;
    EDITING_RANDOM_ID = id;
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
    document.getElementById("eventFoldTitle").textContent = "Edit random event";
    document.getElementById("eventFold").open = true;
    if (!document.getElementById("cancelEditEventBtn")) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.id = "cancelEditEventBtn";
      cancelBtn.className = "btn small secondary";
      cancelBtn.style.marginLeft = "8px";
      cancelBtn.textContent = "Cancel edit";
      cancelBtn.onclick = resetRandomEventForm;
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
const evRecoKey = () => "t29-ev-reco-dismissed:" + (CURRENT.classCode || "");
function evRecoDismissed() { try { return localStorage.getItem(evRecoKey()) === "1"; } catch (e) { return false; } }
function evDismissReco(on) {
  try { if (on) localStorage.setItem(evRecoKey(), "1"); else localStorage.removeItem(evRecoKey()); } catch (e) { /* ignore */ }
  getClassCached(CURRENT.classCode).then(paintEventReco);
}
function evSetRecoTerms(v) {
  EV_RECO_TERMS = [1, 2, 4].includes(Number(v)) ? Number(v) : 4;
  getClassCached(CURRENT.classCode).then(paintEventReco);
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
      <h2>${icon("sparkle", 18)} Recommended random events</h2>
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
  const cls = await getClassCached(CURRENT.classCode);
  const r = evRecoRemaining(cls).find(x => x.name === name);
  if (!r) return;
  await addEventDefs(CURRENT.classCode, [r]);
  await render();
  t29Toast(`Added ${r.name}.`);
}
async function evAddAllReco() {
  const cls = await getClassCached(CURRENT.classCode);
  const left = evRecoRemaining(cls);
  if (!left.length) return;
  if (!await t29Confirm(`Add ${left.length} events? You can edit or remove any of them afterwards.`)) return;
  await addEventDefs(CURRENT.classCode, left);
  await render();
  t29Toast(`Added ${left.length} events.`);
}

async function removeRandomEvent(id) {
  if (await t29Confirm("Remove this random event? It will no longer be handed out.")) {
    if (id === EDITING_RANDOM_ID) resetRandomEventForm();
    await removeEventDef(CURRENT.classCode, id);
    await render();
  }
}

/* ---------------- Recommended big events ----------------
   For a class built from scratch: the same big events the base template ships (losing a job, a home or
   a vehicle, and good surprises), with the insurance payouts already set. Sized for the term choice.
   Added ones are ordinary big events the teacher can edit or remove. The panel is gone once every one
   has been added; it can be dismissed (remembered on this device) and brought back. */
let BIG_RECO_TERMS = 4;
const bigRecoKey = () => "t29-big-reco-dismissed:" + ((CURRENT && CURRENT.classCode) || "");
function bigRecoDismissed() { try { return localStorage.getItem(bigRecoKey()) === "1"; } catch (e) { return false; } }
function bigDismissReco(on) {
  try { if (on) localStorage.setItem(bigRecoKey(), "1"); else localStorage.removeItem(bigRecoKey()); } catch (e) { /* ignore */ }
  getClassCached(CURRENT.classCode).then(paintBigReco);
}
function bigSetRecoTerms(v) {
  BIG_RECO_TERMS = [1, 2, 4].includes(Number(v)) ? Number(v) : 4;
  getClassCached(CURRENT.classCode).then(paintBigReco);
}
function bigRecoRemaining(cls) {
  const have = new Set((cls.bigEventDefs || []).map(e => String(e.name || "").trim().toLowerCase()));
  return t29BaseTemplateBigEventInputs(BIG_RECO_TERMS).filter(r => !have.has(r.name.toLowerCase()));
}
function bigRecoCostText(r) {
  const good = r.kind === "good";
  if (r.costMode === "percent") return `${good ? "+" : ""}${Number(r.costPercent)}% of weekly wage`;
  return `${good ? "+" : ""}${fmtMoney(r.cost)}`;
}
function paintBigReco(cls) {
  const wrap = document.getElementById("bigRecoWrap");
  if (!wrap) return;
  const left = bigRecoRemaining(cls);
  if (!left.length) { wrap.innerHTML = ""; return; }
  if (bigRecoDismissed()) {
    wrap.innerHTML = `<p class="muted-small"><a href="#" onclick="bigDismissReco(false);return false;">Show recommended big events</a></p>`;
    return;
  }
  wrap.innerHTML = `<div class="card qz-reco-panel">
    <div class="qz-reco-head">
      <h2>${icon("sparkle", 18)} Recommended big events</h2>
      <span class="qz-reco-actions">
        <select onchange="bigSetRecoTerms(this.value)" aria-label="Size the amounts for" style="width:auto;margin:0;">
          <option value="1" ${BIG_RECO_TERMS === 1 ? "selected" : ""}>Sized for 1 term</option>
          <option value="2" ${BIG_RECO_TERMS === 2 ? "selected" : ""}>Sized for 2 terms</option>
          <option value="4" ${BIG_RECO_TERMS === 4 ? "selected" : ""}>Sized for a full year</option>
        </select>
        <button class="btn small gold" type="button" onclick="bigAddAllReco()">+ Add all ${left.length} remaining</button>
        <button class="btn small secondary" type="button" onclick="bigDismissReco(true)">Dismiss</button>
      </span>
    </div>
    <p class="muted-small">Major life moments such as losing a job, a home or a vehicle, plus good surprises. Insurance payouts are already set up. Add the ones you like and edit anything afterwards.</p>
    <div class="qz-reco-grid" style="max-height:460px;overflow:auto;padding-right:4px;">${left.map(r => `
      <div class="qz-reco-item">
        <div><strong>${escapeHtml(r.name)}</strong><span class="muted-small">${escapeHtml(r.description)}</span></div>
        <div class="quiz-meta" style="margin:0;">
          <span class="badge navy">${MODULE_LABEL[r.module] || r.module}</span>
          <span class="badge ${r.kind === "good" ? "gold" : "coral"}">${r.kind === "good" ? "Good" : "Bad"}</span>
          <span class="muted-small">${escapeHtml(bigRecoCostText(r))}</span>
        </div>
        <button class="btn small gold" type="button" onclick="bigAddReco('${encodeURIComponent(r.name)}')">+ Add</button>
      </div>`).join("")}
    </div></div>`;
}
async function bigAddReco(nameEnc) {
  const name = decodeURIComponent(nameEnc);
  const cls = await getClassCached(CURRENT.classCode);
  const r = bigRecoRemaining(cls).find(x => x.name === name);
  if (!r) return;
  await addBigEventDefs(CURRENT.classCode, [r]);
  await render();
  t29Toast(`Added ${r.name}.`);
}
async function bigAddAllReco() {
  const cls = await getClassCached(CURRENT.classCode);
  const left = bigRecoRemaining(cls);
  if (!left.length) return;
  if (!await t29Confirm(`Add ${left.length} big events? You can edit or remove any of them afterwards.`)) return;
  await addBigEventDefs(CURRENT.classCode, left);
  await render();
  t29Toast(`Added ${left.length} big events.`);
}

async function deleteEvent(id) {
  if (await t29Confirm("Remove this big event? It won't be handed out anymore.")) {
    if (id === EDITING_ID) resetEventForm();
    await removeBigEventDef(CURRENT.classCode, id);
    await render();
  }
}

async function runBigEventsNow() {
  const btn = document.getElementById("runBigEventsBtn");
  if (btn.disabled) return; // already running — ignore extra clicks
  btn.disabled = true;
  try {
    const count = await forceWeeklyBigEvents(CURRENT.classCode);
    document.getElementById("runBigEventsMsg").innerHTML = count > 0
      ? `<div class="success-msg">Done: ${count} student(s) got a big event just now.</div>`
      : `<div class="error-msg">No eligible students right now, for "bad" events, make sure at least one active event has students with a matching job/property/vehicle. "Good" events are open to everyone. (Anyone who already has a big event queued for this week is skipped.)</div>`;
    await render();
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", init);
