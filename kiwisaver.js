/* ===================== KiwiSaver page =====================
   Students: their balance and where it came from, what each pay day puts
   in, how it's grown, their choices (rate, fund, pause, extra money, opt
   out), first-home use, and — once the class retires — taking it out.
   Teachers: the class's settings, everyone's KiwiSaver at a glance,
   hardship withdrawals, and "Retire the class".
   All the maths lives in data-money.js (the KiwiSaver section); this file
   only shows it and calls it. */
let CURRENT, IS_TEACHER;
let KS_HARDSHIP_FOR = null;

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("sprout", 26) + " KiwiSaver";
  const heads = { hPay: ["calendar", "Every pay day"], hGrowth: ["chart", "How it's grown"], hChoices: ["settings", "My choices"],
    hHome: ["house", "Buying my first home"], hSettings: ["settings", "KiwiSaver settings"], hClass: ["users", "Class KiwiSaver"],
    hRetire: ["star", "Retirement"] };
  Object.entries(heads).forEach(([id, [ic, text]]) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = icon(ic, 18) + " " + text;
  });
}

async function init() {
  const u = await requireLogin();
  if (!u) return;
  CURRENT = u;
  IS_TEACHER = u.role === "teacher";
  document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
  document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
  document.getElementById("navHomeLabel").textContent = IS_TEACHER ? "Dashboard" : "My account";
  document.getElementById("teacherView").classList.toggle("hidden", !IS_TEACHER);
  document.getElementById("studentView").classList.toggle("hidden", IS_TEACHER);
  paintChrome();
  await syncServerClock(u.classCode).catch(() => {});
  const T29_STARTUP_JOBS = Promise.all([
    IS_TEACHER
      ? safeBgJob(payDayForClassIfDue(u.classCode), "payDayForClassIfDue")
      : safeBgJob(payMyWageIfDue(u.username), "payMyWageIfDue"),
    IS_TEACHER
      ? safeBgJob(kiwiSaverReturnsForClassIfDue(u.classCode), "kiwiSaverReturnsForClassIfDue")
      : safeBgJob(applyMyKiwiSaverReturnsIfDue(u.username), "applyMyKiwiSaverReturnsIfDue"),
    safeBgJob(processAutomations(u.classCode), "processAutomations"),
    safeBgJob(processWeeklyEvents(u.classCode), "processWeeklyEvents"),
    safeBgJob(processWeeklyBigEvents(u.classCode), "processWeeklyBigEvents")
  ]);
  await t29FirstPaint(render);
  await T29_STARTUP_JOBS;
  await checkWeeklyEventPopup(u.username, u.classCode);
  await checkBigEventPopup(u.username, u.classCode);
  await render();
}

async function render() {
  const [me, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CURRENT.classCode)]);
  if (!cls) return;
  if (IS_TEACHER) await renderTeacher(cls);
  else renderStudent(Object.assign({ username: CURRENT.username }, me), cls);
}

/* ---------------- Small helpers ---------------- */
const ksPct = n => (Math.round(Number(n) * 100) / 100).toString().replace(/\.0+$/, "") + "%";
const ksSigned = n => (n > 0 ? "+" : n < 0 ? "−" : "") + fmtMoney(Math.abs(n));
const ksSignedPct = n => (n > 0 ? "+" : n < 0 ? "−" : "") + ksPct(Math.abs(n));
const ksMoveClass = n => n > 0 ? "money-in" : n < 0 ? "money-out" : "";
function ksWeekLabel(mondayKey) {
  return new Date(dateKeyToUTC(mondayKey) + 12 * 3600000).toLocaleDateString("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" });
}
function ksDateLabel(dateKey) {
  return new Date(dateKeyToUTC(dateKey) + 12 * 3600000).toLocaleDateString("en-NZ", { day: "numeric", month: "long", timeZone: "UTC" });
}
function ksMsg(id, html) { flashMsg(document.getElementById(id), html, 6000); }
function ksFundRange(f) { return `${ksSignedPct(Math.round((f.avg - f.swing) * 100) / 100)} to ${ksSignedPct(Math.round((f.avg + f.swing) * 100) / 100)}`; }

/* ================================ STUDENT ================================ */
function renderStudent(me, cls) {
  const s = kiwiSaverSettings(cls);
  const ks = kiwiSaverOf(me);
  const member = ks && ks.status === "member";
  const show = (id, on) => document.getElementById(id).classList.toggle("hidden", !on);

  renderJoinCard(me, cls, s, ks);
  show("ksRetiredCard", !!(s.retired && ks && (ks.balance > 0 || ks.withdrawn > 0)));
  if (s.retired && ks) renderRetired(ks);

  const hasMoney = !!ks && (ks.balance > 0 || ks.you > 0 || ks.history.length > 0);
  show("ksBalanceCard", member || hasMoney);
  if (member || hasMoney) renderBalance(me, cls, s, ks);
  show("ksPayCard", s.enabled && !s.retired && member);
  if (s.enabled && !s.retired && member) renderPay(me, cls, s, ks);
  show("ksGrowthCard", s.enabled && (member || hasMoney));
  if (s.enabled && (member || hasMoney)) renderGrowth(cls, s, ks);
  show("ksChoicesCard", s.enabled && !s.retired && member);
  if (s.enabled && !s.retired && member) renderChoices(me, cls, s, ks);
  // Once retired it's all unlocked anyway, so first-home rules don't matter.
  const homeCard = s.enabled && !s.retired && !!ks && ks.balance > 0;
  show("ksHomeCard", homeCard);
  if (homeCard) renderHome(me, cls, s, ks);
}

// Everything that isn't "already a member": switched off, not signed up
// yet (with or without a job), or opted out.
function renderJoinCard(me, cls, s, ks) {
  const card = document.getElementById("ksJoinCard");
  let html = "";
  if (!s.enabled) {
    html = ks
      ? `<p class="ks-note-line">Your teacher has switched KiwiSaver off for now. Your money is still yours and still counts in your net worth, but nothing new goes in and it isn't growing.</p>`
      : `<h2>${icon("sprout", 18)} Not switched on yet</h2><p class="ks-note-line">Your teacher hasn't switched KiwiSaver on for your class yet.</p>`;
  } else if (s.retired) {
    html = ks ? "" : `<h2>${icon("star", 18)} Your class has retired</h2><p class="ks-note-line">You weren't in KiwiSaver, so there's nothing to take out.</p>`;
  } else if (!ks) {
    const job = me.jobId && (cls.jobs || []).some(j => j.id === me.jobId);
    html = `
      <h2>${icon("sprout", 18)} ${job ? "You're about to be signed up" : "Join KiwiSaver"}</h2>
      <p class="ks-note-line">${job
        ? `You have a job, so on your next pay day you'll be signed up automatically, like in real life. ${KS_DEFAULT_RATE}% of your pay will go in, and your employer and the government will add more. You'll start in the Balanced fund.`
        : `You'll be signed up automatically when you get a job. You can also join now and put in extra money yourself. The government adds 25c for every $1.`}</p>
      ${ksJoinChoicesHtml(job)}`;
  } else if (ks.status === "optedOut") {
    html = `
      <h2>${icon("sprout", 18)} You've opted out</h2>
      <p class="ks-note-line">You're not in KiwiSaver, so nothing comes out of your pay. You're also missing out on what your employer and the government would add. You can join again whenever you like.</p>
      ${ksJoinChoicesHtml(false, true)}`;
  }
  card.innerHTML = html + `<div id="ksJoinMsg" aria-live="polite"></div>`;
  card.classList.toggle("hidden", !html);
}
function ksJoinChoicesHtml(hasJob, rejoin) {
  return `
    <div class="ks-join-grid">
      <div>
        <label for="ksJoinRate">My contribution rate</label>
        <select id="ksJoinRate">${KS_RATES.map(r => `<option value="${r}"${r === KS_DEFAULT_RATE ? " selected" : ""}>${r}%${r === KS_DEFAULT_RATE ? " (default)" : r === 3 ? " (lower rate for a while)" : ""}</option>`).join("")}</select>
      </div>
      <div>
        <label for="ksJoinFund">My fund</label>
        <select id="ksJoinFund">${KS_FUND_ORDER.map(k => `<option value="${k}"${k === KS_DEFAULT_FUND ? " selected" : ""}>${KS_FUNDS[k].name}${k === KS_DEFAULT_FUND ? " (default)" : ""}</option>`).join("")}</select>
      </div>
    </div>
    <button class="btn gold" type="button" id="ksJoinBtn" onclick="ksJoin()">${rejoin ? "Join again" : hasJob ? "Save my choices now" : "Join KiwiSaver"}</button>`;
}
async function ksJoin() {
  const btn = document.getElementById("ksJoinBtn");
  btn.disabled = true;
  try {
    const res = await kiwiSaverSaveChoices(CURRENT.username, {
      rate: Number(document.getElementById("ksJoinRate").value), fund: document.getElementById("ksJoinFund").value });
    if (!res.ok) { ksMsg("ksJoinMsg", `<div class="error-msg">${escapeHtml(res.error)}</div>`); return; }
    await render();
    t29Toast("You're in KiwiSaver.", { type: "success" });
  } finally { btn.disabled = false; }
}

function renderRetired(ks) {
  const card = document.getElementById("ksRetiredCard");
  card.innerHTML = `
    <h2>${icon("star", 18)} You've retired</h2>
    <p class="ks-note-line">Your class has reached 65, so your KiwiSaver is unlocked. You can take out as much as you like, whenever you like. Whatever you leave in stays invested, so it can keep growing (or shrinking).</p>
    ${ks.balance > 0 ? `
      <form class="ks-inline-form" onsubmit="return ksWithdraw(event)">
        <div class="ks-money-field"><span class="ks-currency">$</span><input id="ksWithdrawAmt" type="number" min="0.01" step="0.01" max="${ks.balance}" inputmode="decimal" placeholder="0.00" aria-label="Amount to take out"></div>
        <button class="btn gold" type="submit" id="ksWithdrawBtn">Take it out</button>
        <button class="btn secondary" type="button" onclick="document.getElementById('ksWithdrawAmt').value='${ks.balance.toFixed(2)}'">All of it (${fmtMoney(ks.balance)})</button>
      </form>` : `<p class="muted-small">You've taken it all out (${fmtMoney(ks.withdrawn)}).</p>`}
    <div id="ksWithdrawMsg" aria-live="polite"></div>`;
}
async function ksWithdraw(e) {
  e.preventDefault();
  const btn = document.getElementById("ksWithdrawBtn");
  btn.disabled = true;
  try {
    const amt = Number(document.getElementById("ksWithdrawAmt").value);
    const res = await kiwiSaverWithdraw(CURRENT.username, amt);
    if (!res.ok) { ksMsg("ksWithdrawMsg", `<div class="error-msg">${escapeHtml(res.error)}</div>`); return false; }
    await render();
    t29Toast(`${fmtMoney(amt)} moved into your cash.`, { type: "success" });
  } finally { btn.disabled = false; }
  return false;
}

function renderBalance(me, cls, s, ks) {
  document.getElementById("ksBalance").textContent = fmtMoney(ks.balance);
  // Worked out from the running totals, so it stays right after money has
  // been taken out (balance alone can't say where it came from).
  const others = Math.round((ks.employer + ks.govt) * 100) / 100;
  const made = Math.round((ks.you + others + ks.growth) * 100) / 100;
  const lines = [];
  if (ks.you > 0) {
    lines.push(`You've put in ${fmtMoney(ks.you)}.`);
    if (others > 0) lines.push(`Your employer and the government added ${fmtMoney(others)}.`);
    if (ks.growth > 0.004) lines.push(`The fund has grown it by ${fmtMoney(ks.growth)}.`);
    else if (ks.growth < -0.004) lines.push(`The fund is down ${fmtMoney(-ks.growth)} overall.`);
    if (made > ks.you) lines.push(`That's ${fmtMoney(made / ks.you)} for every $1 you've put in.`);
    if (ks.withdrawn > 0) lines.push(`${fmtMoney(ks.withdrawn)} has been taken out.`);
  }
  document.getElementById("ksHeroSub").textContent = lines.length ? lines.join(" ")
    : me.jobId ? "Nothing has gone in yet. Your next pay day will start it off."
    : "Nothing has gone in yet. Put in extra money below, or get a job and it starts on pay day.";
  const pill = document.getElementById("ksStatusPill");
  const fund = KS_FUNDS[ks.fund].name;
  pill.innerHTML = s.retired ? `<span class="ks-pill">Retired, unlocked</span>`
    : ks.status !== "member" ? `<span class="ks-pill muted">Opted out</span>`
    : ks.paused ? `<span class="ks-pill warn">Paused</span><span class="ks-pill-sub">${fund} fund</span>`
    : `<span class="ks-pill">${ksPct(ks.rate)} of my pay</span><span class="ks-pill-sub">${fund} fund</span>`;

  // Where the money came from, as one bar. Growth only shows when it's up.
  const parts = [
    { k: "you", label: "Me", v: ks.you },
    { k: "emp", label: "My employer", v: ks.employer },
    { k: "gov", label: "Government", v: ks.govt },
    { k: "grow", label: "Growth", v: Math.max(0, ks.growth) }
  ].filter(p => p.v > 0);
  const total = parts.reduce((a, p) => a + p.v, 0);
  document.getElementById("ksMix").innerHTML = total > 0 ? `
    <div class="ks-mix-bar" role="img" aria-label="${parts.map(p => `${p.label} ${fmtMoney(p.v)}`).join(", ")}">
      ${parts.map(p => `<span class="ks-seg-${p.k}" style="width:${(p.v / total * 100).toFixed(2)}%"></span>`).join("")}
    </div>
    <div class="ks-mix-legend">${parts.map(p => `<span><i class="ks-dot ks-seg-${p.k}"></i>${p.label} ${fmtMoney(p.v)}</span>`).join("")}</div>` : "";

  const tile = (label, value, sub, cls2) => `<div class="ks-tile"><div class="ks-tile-label">${label}</div><div class="ks-tile-value ${cls2 || ""}">${value}</div>${sub ? `<div class="ks-tile-sub">${sub}</div>` : ""}</div>`;
  const tiles = [
    tile("I put in", fmtMoney(ks.you), "From my pay and any extra"),
    tile("My employer added", fmtMoney(ks.employer), "After ESCT tax"),
    tile("The government added", fmtMoney(ks.govt), "25c for every $1"),
    tile("Growth", ksSigned(ks.growth), ks.growth < 0 ? "The fund is down overall. It can come back." : "What the fund has earned", ksMoveClass(ks.growth))
  ];
  if (ks.withdrawn > 0) tiles.push(tile("Taken out", fmtMoney(ks.withdrawn), ks.firstHomeUsed ? "Including my first home" : ""));
  document.getElementById("ksTiles").innerHTML = tiles.join("");
}

function renderPay(me, cls, s, ks) {
  const body = document.getElementById("ksPayBody");
  const job = me.jobId ? (cls.jobs || []).find(j => j.id === me.jobId) : null;
  const tier = job ? getStudentTier(job, me) : null;
  if (!tier) {
    body.innerHTML = `<p class="ks-note-line">You don't have a job right now, so nothing comes from your pay. You can still put in extra money below, and the government adds 25c for every $1.</p>`;
    return;
  }
  if (ks.paused) {
    body.innerHTML = `<p class="ks-note-line">Your contributions are paused, so your full pay goes into your cash. Your employer doesn't add anything while you're paused either. Turn it back on below whenever you're ready.</p>`;
    return;
  }
  const est = wageCreditEstimate(cls, me);
  const k = est.kiwi;
  if (!k) { body.innerHTML = ""; return; }
  const inTotal = Math.round((k.you + k.employerNet + k.govt) * 100) / 100;
  const perDollar = k.you > 0 ? inTotal / k.you : 0;
  const year = ksYearOf(nzDateKey());
  const usedGovt = ks.govtYear === year ? ks.govtThisYear : 0;
  const govtPct = Math.min(100, usedGovt / KS_GOVT_YEAR_MAX * 100);
  body.innerHTML = `
    <p class="ks-note-line">From your pay of ${fmtMoney(est.gross)} (before tax) as ${escapeHtml(est.tierLabel || "")}:</p>
    <div class="ks-pay-rows">
      <div class="ks-pay-row"><span>Me: ${ksPct(k.rate)} of my pay</span><strong>${fmtMoney(k.you)}</strong></div>
      <div class="ks-pay-row"><span>My employer: ${ksPct(k.employerRate)} of my pay</span><strong>${fmtMoney(k.employerGross)}</strong></div>
      <div class="ks-pay-row sub"><span>minus ESCT tax at ${ksPct(k.esctRate)} <button type="button" class="ks-why" onclick="this.parentElement.parentElement.nextElementSibling.classList.toggle('hidden')" aria-label="What is ESCT?">?</button></span><strong class="money-out">−${fmtMoney(k.esct)}</strong></div>
      <div class="ks-pay-explain hidden">Your employer's money is taxed before it goes in. The rate depends on what you'd earn in a year: your pay × 52, plus your employer's contributions, which comes to ${fmtMoney((est.gross + k.employerGross) * 52)}.</div>
      <div class="ks-pay-row"><span>The government: 25c for every $1 I put in</span><strong>${k.govt > 0 ? fmtMoney(k.govt) : "$0.00"}</strong></div>
      <div class="ks-pay-row total"><span>Into my KiwiSaver every pay day</span><strong>${fmtMoney(inTotal)}</strong></div>
    </div>
    ${k.you > 0 ? `<p class="ks-callout">It costs you ${fmtMoney(k.you)} a pay day, and ${fmtMoney(inTotal)} goes in. That's <strong>${fmtMoney(perDollar)} for every $1</strong> you put in, before any growth.</p>` : ""}
    ${s.govt ? `
      <div class="ks-govt">
        <div class="ks-govt-head"><span>Government contribution this KiwiSaver year</span><strong>${fmtMoney(usedGovt)} of ${fmtMoney(KS_GOVT_YEAR_MAX)}</strong></div>
        <div class="ks-progress"><span style="width:${govtPct.toFixed(1)}%"></span></div>
        <p class="muted-small ks-tight">${ksYearLabel(year)}. ${usedGovt >= KS_GOVT_YEAR_MAX - 0.005
          ? "You've had the most the government gives this year. It starts again on 1 July."
          : `You get the full ${fmtMoney(KS_GOVT_YEAR_MAX)} by putting in ${fmtMoney(KS_GOVT_FULL_AT)} during the year.`}${est.gross * 52 > KS_GOVT_INCOME_LIMIT ? " You earn over $180,000 a year, so the government doesn't add anything." : ""}</p>
      </div>` : `<p class="muted-small">Your teacher has switched the government contribution off.</p>`}`;
}

function renderGrowth(cls, s, ks) {
  // Balance after each week's fund result, newest last.
  const pts = ks.history.map(h => ({ w: h.w, v: h.v, pct: h.pct, fund: h.fund }));
  document.getElementById("ksChart").innerHTML = pts.length >= 2 ? ksLineChart(pts)
    : `<p class="muted-small">The chart fills in week by week. Each Monday, last week's fund result is added to your balance${pts.length === 1 ? ` (last week: ${ksSignedPct(pts[0].pct)})` : ""}.</p>`;

  // The last 8 finished weeks for all three funds.
  const thisMonday = budgetWeekStartKey();
  const weeks = [];
  for (let i = 8; i >= 1; i--) weeks.push(dateKeyPlusDays(thisMonday, -7 * i));
  const table = document.getElementById("ksFundTable");
  table.innerHTML = `
    <thead><tr><th>Fund</th>${weeks.map(w => `<th>${ksWeekLabel(w)}</th>`).join("")}<th>8 weeks</th></tr></thead>
    <tbody>${KS_FUND_ORDER.map(k => {
      const rs = weeks.map(w => kiwiSaverFundReturn(cls, k, w));
      const total = (rs.reduce((acc, r) => acc * (1 + r / 100), 1) - 1) * 100;
      const mine = ks.fund === k;
      return `<tr class="${mine ? "ks-mine" : ""}"><th scope="row">${KS_FUNDS[k].name}${mine ? ` <span class="ks-you-tag">mine</span>` : ""}</th>
        ${rs.map(r => `<td class="${ksMoveClass(r)}">${ksSignedPct(r)}</td>`).join("")}
        <td class="${ksMoveClass(total)}"><strong>${ksSignedPct(Math.round(total * 10) / 10)}</strong></td></tr>`;
    }).join("")}</tbody>`;
}

// A small line chart of the balance, drawn as SVG. Points below the
// previous one (a down week) are marked.
function ksLineChart(pts) {
  const W = 640, H = 200, padL = 8, padR = 8, padT = 14, padB = 26;
  const vals = pts.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
  const span = hi - lo;
  lo -= span * 0.08; hi += span * 0.08;
  const x = i => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${(H - padB).toFixed(1)} L${x(0).toFixed(1)},${(H - padB).toFixed(1)} Z`;
  const labelEvery = Math.max(1, Math.ceil(pts.length / 6));
  return `
    <div class="ks-chart-wrap">
      <svg class="ks-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="KiwiSaver balance over the last ${pts.length} weeks, from ${fmtMoney(pts[0].v)} to ${fmtMoney(pts[pts.length - 1].v)}">
        <path class="ks-chart-area" d="${area}"/>
        <path class="ks-chart-line" d="${line}" vector-effect="non-scaling-stroke"/>
        ${pts.map((p, i) => `<circle class="${p.pct < 0 ? "ks-pt-down" : "ks-pt"}" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.2" vector-effect="non-scaling-stroke"><title>Week of ${ksWeekLabel(p.w)}: ${ksSignedPct(p.pct)} → ${fmtMoney(p.v)}</title></circle>`).join("")}
      </svg>
      <div class="ks-chart-x">${pts.map((p, i) => `<span style="left:${(x(i) / W * 100).toFixed(2)}%">${i % labelEvery === 0 || i === pts.length - 1 ? ksWeekLabel(p.w) : ""}</span>`).join("")}</div>
    </div>
    <p class="muted-small ks-tight">From ${fmtMoney(pts[0].v)} (week of ${ksWeekLabel(pts[0].w)}) to ${fmtMoney(pts[pts.length - 1].v)}. Red dots are weeks the fund went down.</p>`;
}

function renderChoices(me, cls, s, ks) {
  const seg = document.getElementById("ksRateSeg");
  seg.innerHTML = KS_RATES.map(r => `<button type="button" role="radio" aria-checked="${r === ks.rate}" class="ks-seg-btn${r === ks.rate ? " on" : ""}" onclick="ksSetRate(${r})">${r}%</button>`).join("");
  document.getElementById("ksRateNote").textContent = ks.rate === 3
    ? "3% is the lower rate for a while. Your employer drops to 3% too. In real life you apply to Inland Revenue for it, and it lasts 3 to 12 months."
    : `${KS_DEFAULT_RATE}% is the default. More goes in if you choose a higher rate, but the government's 25c per $1 stops at ${fmtMoney(KS_GOVT_YEAR_MAX)} a year, and your employer stays at ${KS_EMPLOYER_RATE}%.`;

  const thisMonday = budgetWeekStartKey();
  const lastWeek = dateKeyPlusDays(thisMonday, -7);
  document.getElementById("ksFundPick").innerHTML = KS_FUND_ORDER.map(k => {
    const f = s.funds[k];
    const last = kiwiSaverFundReturn(cls, k, lastWeek);
    const on = ks.fund === k;
    return `<button type="button" role="radio" aria-checked="${on}" class="ks-fund${on ? " on" : ""}" onclick="ksSetFund('${k}')">
      <span class="ks-fund-name">${KS_FUNDS[k].name}${on ? `<span class="ks-you-tag">mine</span>` : ""}</span>
      <span class="ks-fund-about">${KS_FUNDS[k].about}</span>
      <span class="ks-fund-stats"><span>Each week: ${ksFundRange(f)}</span><span>Average: ${ksSignedPct(f.avg)}</span><span>Last week: <b class="${ksMoveClass(last)}">${ksSignedPct(last)}</b></span></span>
    </button>`;
  }).join("");

  document.getElementById("ksPauseBlock").innerHTML = `
    <div class="ks-choice-label">${ks.paused ? "My contributions are paused" : "Take a break"}</div>
    <p class="muted-small ks-tight">${ks.paused
      ? "Nothing comes out of your pay, and your employer doesn't add anything. Your money stays invested."
      : "Pausing (a \"savings suspension\") stops money coming out of your pay. Your employer stops adding too. In real life you can do this after your first year, for 3 months to a year at a time."}</p>
    <button type="button" class="btn ${ks.paused ? "gold" : "secondary"}" id="ksPauseBtn" onclick="ksSetPaused(${!ks.paused})">${ks.paused ? "Start my contributions again" : "Pause my contributions"}</button>`;

  const yearly = ksYearlyPay(cls, me);
  const year = ksYearOf(nzDateKey());
  const usedGovt = ks.govtYear === year ? ks.govtThisYear : 0;
  const govtLeft = Math.max(0, KS_GOVT_YEAR_MAX - usedGovt);
  document.getElementById("ksExtraNote").textContent = !s.govt ? "Move some of your cash into KiwiSaver. It's locked away until you retire, or buy your first home."
    : yearly > KS_GOVT_INCOME_LIMIT ? "Move some of your cash into KiwiSaver. You earn over $180,000 a year, so the government doesn't add anything."
    : govtLeft > 0.005 ? `Move some of your cash into KiwiSaver. The government adds 25c for every $1, up to ${fmtMoney(govtLeft)} more this KiwiSaver year. It's locked away until you retire, or buy your first home.`
    : "Move some of your cash into KiwiSaver. You've already had the most the government gives this year.";

  const ob = document.getElementById("ksOptOutBlock");
  const today = nzDateKey();
  const canOptOut = ks.optOutUntil && today <= ks.optOutUntil;
  ob.classList.toggle("hidden", !canOptOut);
  if (canOptOut) {
    ob.innerHTML = `
      <div class="ks-choice-label">Opt out</div>
      <p class="muted-small ks-tight">You were signed up automatically, so you can leave until ${ksDateLabel(ks.optOutUntil)}. You'd get back the ${fmtMoney(Math.max(0, ks.you - ks.withdrawn))} you put in. What your employer and the government added goes back to them, and you'd miss out on it from now on.</p>
      <button type="button" class="btn secondary" id="ksOptOutBtn" onclick="ksOptOut()">Opt out of KiwiSaver</button>`;
  }
}
async function ksChoice(btnId, change, okText) {
  const btn = btnId ? document.getElementById(btnId) : null;
  if (btn) btn.disabled = true;
  try {
    const res = await kiwiSaverSaveChoices(CURRENT.username, change);
    if (!res.ok) { ksMsg("ksChoiceMsg", `<div class="error-msg">${escapeHtml(res.error)}</div>`); return; }
    await render();
    if (okText) t29Toast(okText, { type: "success" });
  } finally { if (btn) btn.disabled = false; }
}
function ksSetRate(r) { return ksChoice(null, { rate: r }, `From your next pay day, ${r}% of your pay goes into KiwiSaver.`); }
function ksSetFund(k) { return ksChoice(null, { fund: k }, `Your KiwiSaver is now in the ${KS_FUNDS[k].name} fund.`); }
function ksSetPaused(p) { return ksChoice("ksPauseBtn", { paused: p }, p ? "Contributions paused." : "Contributions back on from your next pay day."); }
async function ksContribute(e) {
  e.preventDefault();
  const btn = document.getElementById("ksExtraBtn");
  const input = document.getElementById("ksExtraAmt");
  btn.disabled = true;
  try {
    const amt = Number(input.value);
    const res = await kiwiSaverContribute(CURRENT.username, amt);
    if (!res.ok) { ksMsg("ksChoiceMsg", `<div class="error-msg">${escapeHtml(res.error)}</div>`); return false; }
    input.value = "";
    await render();
    const g = res.result && res.result.govt;
    t29Toast(`${fmtMoney(amt)} put into KiwiSaver${g > 0 ? `, and the government added ${fmtMoney(g)}` : ""}.`, { type: "success" });
  } finally { btn.disabled = false; }
  return false;
}
async function ksOptOut() {
  if (!confirm("Opt out of KiwiSaver? You'll get back what you put in, but lose what your employer and the government added.")) return;
  const btn = document.getElementById("ksOptOutBtn");
  btn.disabled = true;
  try {
    const res = await kiwiSaverOptOut(CURRENT.username);
    if (!res.ok) { ksMsg("ksChoiceMsg", `<div class="error-msg">${escapeHtml(res.error)}</div>`); return; }
    await render();
    t29Toast(`You've opted out. ${fmtMoney(res.result.refund)} is back in your cash.`, { type: "success" });
  } finally { btn.disabled = false; }
}

function renderHome(me, cls, s, ks) {
  const info = kiwiSaverFirstHomeInfo(cls, me, CURRENT.username);
  const body = document.getElementById("ksHomeBody");
  if (info.eligible) {
    body.innerHTML = `
      <p class="ks-note-line">You can put up to <strong>${fmtMoney(info.available)}</strong> of your KiwiSaver towards buying your first home${s.retired ? "" : `. ${fmtMoney(s.firstHomeKeep)} has to stay in`}.</p>
      <p class="muted-small">On the Property page, tick "Use my KiwiSaver" when you buy. It pays as much of the price (or the deposit, with a mortgage) as it can, and your cash pays the rest.</p>
      <a class="btn gold" href="property.html">Go to Property</a>`;
  } else {
    body.innerHTML = `<p class="ks-note-line">${escapeHtml(info.reason || "You can't use your KiwiSaver for a home right now.")}</p>
      ${!ks.firstHomeUsed && !s.retired ? `<p class="muted-small">When you can, it pays part of the price of your first property. You'll need to have been in KiwiSaver for ${s.firstHomeWeeks} week${s.firstHomeWeeks === 1 ? "" : "s"}, and ${fmtMoney(s.firstHomeKeep)} has to stay in. In real life it's 3 years and $1,000.</p>` : ""}`;
  }
}

/* ================================ TEACHER ================================ */
async function renderTeacher(cls) {
  const s = kiwiSaverSettings(cls);
  // Settings form — only filled in when it isn't being edited.
  const form = document.getElementById("ksOn").closest("form");
  if (!form.dataset.dirty) {
    document.getElementById("ksOn").checked = s.enabled;
    document.getElementById("ksGovt").checked = s.govt;
    document.getElementById("ksHomeWeeks").value = s.firstHomeWeeks;
    document.getElementById("ksHomeKeep").value = s.firstHomeKeep;
    document.getElementById("ksFundRows").innerHTML = KS_FUND_ORDER.map(k => `
      <tr>
        <th scope="row">${KS_FUNDS[k].name}</th>
        <td><input type="number" step="0.1" id="ksAvg-${k}" value="${s.funds[k].avg}" aria-label="${KS_FUNDS[k].name} average" oninput="ksPreviewRange('${k}')"></td>
        <td><input type="number" step="0.1" min="0" id="ksSwing-${k}" value="${s.funds[k].swing}" aria-label="${KS_FUNDS[k].name} ups and downs" oninput="ksPreviewRange('${k}')"></td>
        <td class="ks-range" id="ksRange-${k}">${ksFundRange(s.funds[k])}</td>
      </tr>`).join("");
    form.oninput = () => { form.dataset.dirty = "1"; };
  }
  document.getElementById("ksSavingsRate").textContent = ksPct(cls.interestRate || 0);

  const students = await getClassStudents(CURRENT.classCode, cls);
  const rows = students.map(st => ({ st, ks: kiwiSaverOf(st) })).sort((a, b) => (b.ks ? b.ks.balance : -1) - (a.ks ? a.ks.balance : -1));
  const members = rows.filter(r => r.ks && r.ks.status === "member");
  const total = rows.reduce((a, r) => a + (r.ks ? r.ks.balance : 0), 0);
  const sum = k => rows.reduce((a, r) => a + (r.ks ? r.ks[k] : 0), 0);
  document.getElementById("ksClassSum").innerHTML = `
    <div class="ks-tile"><div class="ks-tile-label">Members</div><div class="ks-tile-value">${members.length} of ${rows.length}</div><div class="ks-tile-sub">${rows.filter(r => r.ks && r.ks.paused && r.ks.status === "member").length} paused, ${rows.filter(r => r.ks && r.ks.status === "optedOut").length} opted out</div></div>
    <div class="ks-tile"><div class="ks-tile-label">Total in KiwiSaver</div><div class="ks-tile-value">${fmtMoney(total)}</div></div>
    <div class="ks-tile"><div class="ks-tile-label">From employers + government</div><div class="ks-tile-value">${fmtMoney(sum("employer") + sum("govt"))}</div></div>
    <div class="ks-tile"><div class="ks-tile-label">Growth</div><div class="ks-tile-value ${ksMoveClass(sum("growth"))}">${ksSigned(sum("growth"))}</div></div>`;
  const statusOf = r => {
    if (!r.ks) return r.st.jobId && s.enabled && !s.retired ? "Signs up next pay day" : "Not in";
    if (r.ks.status === "optedOut") return "Opted out";
    if (s.retired) return "Retired";
    return r.ks.paused ? "Paused" : "Member";
  };
  document.getElementById("ksClassRows").innerHTML = rows.map(r => {
    const k = r.ks;
    const canRelease = k && kiwiSaverHardshipMax(k) > 0;
    return `<tr>
      <td>${escapeHtml(r.st.name || r.st.username)}</td>
      <td>${statusOf(r)}</td>
      <td>${k && k.status === "member" ? ksPct(k.rate) : "—"}</td>
      <td>${k && k.status === "member" ? KS_FUNDS[k.fund].name : "—"}</td>
      <td><strong>${k ? fmtMoney(k.balance) : "—"}</strong></td>
      <td>${k ? fmtMoney(k.you) : "—"}</td>
      <td>${k ? fmtMoney(k.employer) : "—"}</td>
      <td>${k ? fmtMoney(k.govt) : "—"}</td>
      <td class="${k ? ksMoveClass(k.growth) : ""}">${k ? ksSigned(k.growth) : "—"}</td>
      <td>${canRelease ? `<button type="button" class="btn small secondary" onclick="ksOpenHardship('${escapeJsAttr(r.st.username)}')">Hardship</button>` : ""}</td>
    </tr>`;
  }).join("");
  document.getElementById("ksClassEmpty").textContent = !rows.length ? "No students in this class yet."
    : !s.enabled && !rows.some(r => r.ks) ? "Switch KiwiSaver on above and students with a job are signed up on their next pay day." : "";
  KS_TEACHER_ROWS = rows;
  renderRetireCard(s);
}
let KS_TEACHER_ROWS = [];

function ksPreviewRange(k) {
  const avg = Number(document.getElementById("ksAvg-" + k).value), swing = Number(document.getElementById("ksSwing-" + k).value);
  document.getElementById("ksRange-" + k).textContent = Number.isFinite(avg) && Number.isFinite(swing) && swing >= 0 ? ksFundRange({ avg, swing }) : "—";
}
async function ksSaveSettings(e) {
  e.preventDefault();
  const btn = document.getElementById("ksSaveBtn");
  btn.disabled = true;
  try {
    const funds = {};
    KS_FUND_ORDER.forEach(k => { funds[k] = { avg: document.getElementById("ksAvg-" + k).value, swing: document.getElementById("ksSwing-" + k).value }; });
    const res = await saveKiwiSaverSettings(CURRENT.classCode, {
      enabled: document.getElementById("ksOn").checked, govt: document.getElementById("ksGovt").checked, funds,
      firstHomeWeeks: document.getElementById("ksHomeWeeks").value, firstHomeKeep: document.getElementById("ksHomeKeep").value
    });
    if (!res.ok) { ksMsg("ksSaveMsg", `<div class="error-msg">${escapeHtml(res.error)}</div>`); return false; }
    delete document.getElementById("ksOn").closest("form").dataset.dirty;
    await render();
    ksMsg("ksSaveMsg", `<div class="success-msg">Saved.</div>`);
  } finally { btn.disabled = false; }
  return false;
}

function renderRetireCard(s) {
  const body = document.getElementById("ksRetireBody");
  if (s.retired) {
    const when = s.retiredAt ? new Date(s.retiredAt).toLocaleDateString("en-NZ", { day: "numeric", month: "long" }) : "";
    body.innerHTML = `
      <p class="ks-note-line">Your class retired${when ? " on " + when : ""}. Everyone's job was taken away and their KiwiSaver is unlocked, so they can take out as much as they like. Nothing more goes into KiwiSaver.</p>
      <p class="muted-small">Undo gives everyone back the job they had, unless they've been given a new one since. Money already taken out stays out.</p>
      <button type="button" class="btn secondary" id="ksUndoBtn" onclick="ksUndoRetire()">Undo retirement</button>`;
  } else {
    body.innerHTML = `
      <p class="ks-note-line">Retiring the class is like everyone reaching 65. It:</p>
      <ul class="ks-list">
        <li>takes away every student's job (no more pay)</li>
        <li>stops all KiwiSaver contributions</li>
        <li>unlocks everyone's KiwiSaver, so they can take out as much as they like.</li>
      </ul>
      <p class="muted-small">A good way to finish a term: students see what their KiwiSaver grew to, and decide what to do with it. You can undo it afterwards.</p>
      <button type="button" class="btn coral" id="ksRetireBtn" onclick="ksRetire()"${s.enabled ? "" : " disabled title=\"Switch KiwiSaver on first\""}>Retire the class</button>`;
  }
}
async function ksRetire() {
  if (!confirm("Retire the whole class? Everyone loses their job and their KiwiSaver unlocks. You can undo this afterwards.")) return;
  const btn = document.getElementById("ksRetireBtn");
  btn.disabled = true;
  try {
    const res = await retireClass(CURRENT.classCode);
    if (!res.ok) { ksMsg("ksRetireMsg", `<div class="error-msg">${escapeHtml(res.error)}</div>`); return; }
    await render();
    ksMsg("ksRetireMsg", res.failed.length
      ? `<div class="error-msg">Retired, but these students' jobs couldn't be removed: ${escapeHtml(res.failed.join(", "))}. Try again.</div>`
      : `<div class="success-msg">Your class has retired.</div>`);
  } finally { btn.disabled = false; }
}
async function ksUndoRetire() {
  if (!confirm("Undo retirement? Students get their jobs back and KiwiSaver locks again.")) return;
  const btn = document.getElementById("ksUndoBtn");
  btn.disabled = true;
  try {
    const res = await undoRetireClass(CURRENT.classCode);
    if (!res.ok) { ksMsg("ksRetireMsg", `<div class="error-msg">${escapeHtml(res.error)}</div>`); return; }
    await render();
    ksMsg("ksRetireMsg", res.failed.length
      ? `<div class="error-msg">Undone, but these students' jobs couldn't be given back: ${escapeHtml(res.failed.join(", "))}.</div>`
      : `<div class="success-msg">Retirement undone. Everyone has their job back.</div>`);
  } finally { btn.disabled = false; }
}

function ksOpenHardship(username) {
  const row = KS_TEACHER_ROWS.find(r => r.st.username === username);
  if (!row || !row.ks) return;
  KS_HARDSHIP_FOR = username;
  const max = kiwiSaverHardshipMax(row.ks);
  document.getElementById("ksHardshipTitle").textContent = "Hardship withdrawal: " + (row.st.name || username);
  document.getElementById("ksHardshipInfo").textContent = `In real life, people facing significant financial hardship can take money out early. The government's contributions (${fmtMoney(row.ks.govt)}) have to stay in, so up to ${fmtMoney(max)} can be released. It goes into ${row.st.name || username}'s cash.`;
  const amt = document.getElementById("ksHardshipAmt");
  amt.value = ""; amt.max = max;
  document.getElementById("ksHardshipWhy").value = "";
  document.getElementById("ksHardshipMsg").innerHTML = "";
  document.getElementById("ksHardshipModal").classList.remove("hidden");
  amt.focus();
}
function ksCloseHardship() {
  document.getElementById("ksHardshipModal").classList.add("hidden");
  KS_HARDSHIP_FOR = null;
}
async function ksDoHardship() {
  const btn = document.getElementById("ksHardshipBtn");
  btn.disabled = true;
  try {
    const res = await kiwiSaverHardshipRelease(CURRENT.classCode, KS_HARDSHIP_FOR,
      document.getElementById("ksHardshipAmt").value, document.getElementById("ksHardshipWhy").value);
    if (!res.ok) { document.getElementById("ksHardshipMsg").innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`; return; }
    ksCloseHardship();
    await render();
    t29Toast("Money released into their cash.", { type: "success" });
  } finally { btn.disabled = false; }
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && KS_HARDSHIP_FOR) ksCloseHardship(); });

document.addEventListener("DOMContentLoaded", init);
