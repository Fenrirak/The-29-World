let CURRENT, CLASS_CODE, IS_TEACHER;
let realEnabled = false, realBusy = false, realRequest = 0;
let realListings = [];
const realEl = id => document.getElementById(id);
const realDate = key => realDateKeyValid(key) ? new Intl.DateTimeFormat("en-NZ", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC"
}).format(new Date(key + "T12:00:00Z")) : "Date unavailable";
const quotePrice = value => "$" + value.toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const closeLabel = date => Date.parse(nzDateKey()) - Date.parse(date) > 7 * 86400000 ? "Last available close" : "Market close";
function fundSummary(fund) {
  return fund.exposure + " Annual fund fee " + fund.annualFee + ".";
}

function realAlreadyListed(companies, spec) {
  return companies.some(co => co.realSymbol === spec.symbol || co.name?.toLowerCase() === spec.name.toLowerCase());
}

function renderRealPicker(cls) {
  realListings = cls.companies || [];
  realEnabled = cls.realStocksEnabled === true;
  if (!realBusy) realEl("realSwitch").checked = realEnabled;
  realEl("realSwitch").disabled = realBusy;
  realEl("realSwitchText").textContent = realEnabled ? "On" : "Off";
  realEl("realPicker").hidden = !realEnabled;
  if (!realEnabled && realEl("realDialog").open && !realBusy) realEl("realDialog").close();
  if (realEl("realDialog").open) updateRealSelection();
}

async function toggleRealStocks() {
  if (!IS_TEACHER || realBusy) return;
  const toggle = realEl("realSwitch");
  const msg = realEl("realMsg");
  realBusy = toggle.disabled = true;
  try {
    await classesCol().doc(CLASS_CODE).update({realStocksEnabled: toggle.checked});
    msg.textContent = "";
  } catch (err) {
    msg.textContent = realWriteError(err, "save this setting");
    toggle.checked = realEnabled;
  } finally {
    realBusy = toggle.disabled = false;
    await render();
  }
}

let realQuotes = new Map();
function realWriteError(err, action) {
  if (err.code === "permission-denied") return "Couldn't " + action + ". Check that the latest Firestore rules are deployed.";
  if (err.code === "aborted" || err.code === "failed-precondition") return "The market changed while saving. Refresh the listings and try again.";
  return err.code && err.code !== "quote-changed" ? "Couldn't " + action + ". Try again." : err.message;
}

async function openRealPicker(refreshAfterChange = false) {
  if (!IS_TEACHER || !realEnabled || (realBusy && !refreshAfterChange)) return;
  const request = ++realRequest;
  const dialog = realEl("realDialog");
  const checked = refreshAfterChange ? new Set([...realEl("realChoices").querySelectorAll("input:checked")].map(input => input.value)) : new Set();
  if (!dialog.open) {
    realEl("realSearch").value = "";
    dialog.showModal();
  }
  realQuotes = new Map();
  realEl("realDialogMsg").textContent = "Checking closing prices…";
  const groups = [
    ["NZX", false, "NZX companies · NZD"], ["NZX", true, "NZX funds · NZD"],
    ["Nasdaq", false, "US companies · USD"], ["NYSE Arca", true, "US funds · USD"]
  ];
  realEl("realChoices").innerHTML = groups.map(([exchange, fund, title]) => `
    <section><h3>${title}</h3>${REAL_STOCKS.filter(s => s.exchange === exchange && (s.kind === "etf") === fund).map(s => `
      <label class="real-choice"><input type="checkbox" value="${s.symbol}" disabled>
        <span><strong>${s.name} (${s.symbol})</strong>
          ${fund ? `<span class="muted-small">${fundSummary(s)}</span>` : ""}
          <span class="muted-small" id="realQuote-${s.symbol}">Checking closing price…</span>
        </span>
      </label>`).join("")}</section>`).join("");
  filterRealPicker();
  updateRealSelection();
  const results = await Promise.allSettled(REAL_STOCKS.map(s => fdb.collection("marketQuotes").doc(s.symbol).get()));
  if (request !== realRequest || !dialog.open) return;
  for (const [i, spec] of REAL_STOCKS.entries()) {
    const result = results[i];
    const q = result.status === "fulfilled" && listingQuote(spec.symbol, result.value.data());
    const note = realEl("realQuote-" + spec.symbol);
    delete note.dataset.listed;
    if (validRealQuote(q) && q.symbol === spec.symbol) {
      realQuotes.set(spec.symbol, q);
      if (checked.has(spec.symbol)) note.closest("label").querySelector("input").checked = true;
      note.textContent = quotePrice(q.price) + " " + spec.currency + " · " + closeLabel(q.date) + " " + realDate(q.date)
        + " · " + (q.reportedUnits ?? q.totalShares).toLocaleString("en-NZ", {maximumFractionDigits: 6})
        + (spec.kind === "etf" ? " units" : " shares") + " as of " + realDate(q.sharesDate)
        + (q === startingQuotes.get(spec.symbol) ? " · Saved quote from " + q.source : "");
    } else {
      note.textContent = result.status === "rejected" ? "Quote could not be loaded." : "Waiting for a verified price and share or unit count.";
    }
  }
  const denied = results.some(r => r.status === "rejected" && r.reason?.code === "permission-denied");
  realEl("realDialogMsg").textContent = denied
    ? "Quote access was denied. Check that the latest Firestore rules are deployed."
    : realQuotes.size ? "" : "No verified closing prices are available yet. Check the stock refresh workflow.";
  updateRealSelection();
}

function filterRealPicker() {
  const query = realEl("realSearch").value.trim().toLowerCase();
  let matches = 0;
  for (const group of realEl("realChoices").children) {
    const choices = [...group.querySelectorAll(".real-choice")];
    for (const choice of choices) {
      choice.hidden = !choice.querySelector("strong").textContent.toLowerCase().includes(query);
      if (!choice.hidden) matches++;
    }
    group.hidden = choices.every(choice => choice.hidden);
  }
  realEl("realEmpty").hidden = matches > 0;
}

function updateRealSelection() {
  let count = 0;
  for (const input of realEl("realChoices").querySelectorAll("input")) {
    const spec = REAL_STOCKS.find(s => s.symbol === input.value);
    const listed = realAlreadyListed(realListings, spec);
    if (listed) input.checked = false;
    const note = realEl("realQuote-" + spec.symbol);
    if (listed && !note.dataset.listed) {
      note.dataset.listed = "yes";
      note.textContent = "Already listed · " + note.textContent;
    } else if (!listed && note.dataset.listed) {
      delete note.dataset.listed;
      note.textContent = note.textContent.replace(/^Already listed · /, "");
    }
    input.disabled = realBusy || listed || !realQuotes.has(spec.symbol);
    if (input.checked) count++;
  }
  realEl("realSelection").textContent = count ? count + " selected" : "Select the listings you want to add.";
  realEl("listReal").disabled = realBusy || !realEnabled || count === 0;
  realEl("closeReal").disabled = realBusy;
}

async function listRealStock() {
  if (!IS_TEACHER || !realEnabled || realBusy) return;
  const selected = [...realEl("realChoices").querySelectorAll("input:checked")].map(input => {
    const spec = REAL_STOCKS.find(s => s.symbol === input.value);
    return {spec, quote: realQuotes.get(spec.symbol), id: uid("co")};
  });
  if (!selected.length) return;
  const day = nzDateKey();
  const msg = realEl("realDialogMsg");
  realBusy = true;
  updateRealSelection();
  msg.textContent = "Adding listings…";
  try {
    const ref = classesCol().doc(CLASS_CODE);
    const count = await fdb.runTransaction(async tx => {
      const cls = (await tx.get(ref)).data();
      if (!cls?.realStocksEnabled || cls.archived) throw new Error("Real-world listings are paused for this class.");
      const companies = cls.companies || [];
      const pending = selected.filter(({spec}) => !realAlreadyListed(companies, spec));
      if (!pending.length) return 0;
      const quotes = await Promise.all(pending.map(({spec}) => tx.get(fdb.collection("marketQuotes").doc(spec.symbol))));
      const added = pending.map(({spec, quote, id}, i) => {
        const q = listingQuote(spec.symbol, quotes[i].data());
        if (!validRealQuote(q) || q.symbol !== spec.symbol || ["price", "totalShares", "date", "sharesDate", "reportedUnits"].some(key => q[key] !== quote[key])) {
          throw Object.assign(new Error(spec.symbol + " changed. Review the new figures before adding listings."), {code: "quote-changed"});
        }
        return {
          id, name: spec.name, realSymbol: spec.symbol, price: q.price, quoteDate: q.date,
          totalShares: q.totalShares, availableShares: q.totalShares, sharesDate: q.sharesDate,
          ...(q.reportedUnits !== undefined ? {reportedUnits: q.reportedUnits} : {}),
          holders: {}, history: [q.price], historyDates: [day], quoteSource: q.source || ""
        };
      });
      tx.update(ref, {companies: [...companies, ...added]});
      return added.length;
    });
    realEl("realDialog").close();
    realEl("realMsg").textContent = count ? count + (count === 1 ? " listing added." : " listings added.") : "Those listings are already in your class market.";
  } catch (err) {
    if (err.code === "quote-changed") await openRealPicker(true);
    msg.textContent = realWriteError(err, "add these listings");
  } finally {
    realBusy = false;
    await render();
  }
}

// buy()/sell() show a success/error message inside each company's card, but
// render() wipes and rebuilds the whole card list (including a fresh, empty
// message box) — including the render() call that happens right after we
// set the message. Without this, the message barely gets painted before
// being erased. Keeping it here means it survives across render() calls and
// the 5s auto-refresh poll, and clears itself after a few seconds.
const COMPANY_MSGS = {}; // id -> { html, expiresAt }
const MSG_DISPLAY_MS = 4000;

function setCompanyMsg(id, html) {
  COMPANY_MSGS[id] = { html, expiresAt: Date.now() + MSG_DISPLAY_MS };
  applyCompanyMsg(id);
}

function applyCompanyMsg(id) {
  const box = document.getElementById("msg-" + id);
  if (!box) return;
  const entry = COMPANY_MSGS[id];
  if (!entry || entry.expiresAt <= Date.now()) {
    delete COMPANY_MSGS[id];
    return;
  }
  box.innerHTML = entry.html;
  clearTimeout(box._clearTimer);
  box._clearTimer = setTimeout(() => {
    if (COMPANY_MSGS[id] !== entry) return;
    delete COMPANY_MSGS[id];
    const stillThere = document.getElementById("msg-" + id);
    if (stillThere) stillThere.innerHTML = "";
  }, entry.expiresAt - Date.now());
}

// Share splits live in split.js. The page keeps working if that file didn't load.
function splitTag(co) { return window.T29Split ? T29Split.tagHtml(co) : ""; }
function splitHistory(co) { return window.T29Split ? T29Split.historyHtml(co, { me: CURRENT.username, teacher: IS_TEACHER }) : ""; }
function splitRow(co) {
  if (!window.T29Split) return "";
  return `<div class="t29s-teacher-row">
          <div>
            <strong>${icon("split", 18)} Share split</strong>
            <p class="muted-small">Change how many shares exist without changing what anyone's shares are worth.</p>
          </div>
          <button class="btn small secondary" onclick="T29Split.open('${co.id}')">Split shares&hellip;</button>
        </div>`;
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("chart", 26) + " Stock Market";
  document.getElementById("pageIntro").textContent = IS_TEACHER
    ? "Open a classroom company, or choose a real-world stock or fund to follow."
    : "Buy and sell the stocks and funds your teacher has listed.";
  document.getElementById("hOpen").innerHTML = "Open a new company";
  document.getElementById("labName").innerHTML = "Company name";
  document.getElementById("labPrice").innerHTML = "Starting share price";
  document.getElementById("labShares").innerHTML = "Total shares available";
  document.getElementById("openBtn").innerHTML = "Open company";
  document.getElementById("hVolatility").innerHTML = "Daily price movement";
  document.getElementById("labRangeMin").innerHTML = "Minimum % change";
  document.getElementById("labRangeMax").innerHTML = "Maximum % change";
  document.getElementById("saveRangeBtn").innerHTML = "Save range";
  document.getElementById("hMarketDay").innerHTML = "Market day";
  document.getElementById("simDayBtn").innerHTML = "Simulate a market day";
}

async function init() {
  try {
    const u = await requireLogin();
    if (!u) return;
    CURRENT = u;
    CLASS_CODE = u.classCode;
    IS_TEACHER = u.role === "teacher";
    document.getElementById("whoami").textContent = t29DisplayName(u);
    document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
    document.getElementById("navHomeLabel").textContent = "Dashboard";
    document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
    paintChrome();
    enablePasswordToggles();
    // These 8 jobs are all independent of each other (each is its own
    // guarded, self-contained check-and-maybe-write), so running them one
    // at a time — 8 separate sequential network round-trips — was a big
    // chunk of load time, especially on a slow mobile connection. Running
    // them together cuts that to roughly the time of the single slowest one.
    // Same split as every other page: the class-wide sweeps are teacher
    // jobs, and a student's visit only pays their own wage/allowance/interest.
    const T29_STARTUP_JOBS = Promise.all([
      IS_TEACHER
        ? safeBgJob(payDayForClassIfDue(CLASS_CODE), "payDayForClassIfDue")
        : safeBgJob(payMyWageIfDue(u.username), "payMyWageIfDue"),
      IS_TEACHER
        ? safeBgJob(dailyLifeAllowanceForClassIfDue(CLASS_CODE), "dailyLifeAllowanceForClassIfDue")
        : safeBgJob(payMyDailyLifeAllowanceIfDue(u.username), "payMyDailyLifeAllowanceIfDue"),
      safeBgJob(processAutomations(CLASS_CODE), "processAutomations"),
      safeBgJob(processLoanInterest(CLASS_CODE), "processLoanInterest"),
      safeBgJob(processTermDeposits(CLASS_CODE), "processTermDeposits"),
      IS_TEACHER
        ? safeBgJob(applyInterestToClassIfDue(CLASS_CODE), "applyInterestToClassIfDue")
        : safeBgJob(applyMyInterestIfDue(u.username), "applyMyInterestIfDue"),
      safeBgJob(processInsurancePayments(CLASS_CODE), "processInsurancePayments"),
      safeBgJob(processWeeklyEvents(CLASS_CODE), "processWeeklyEvents"),
      safeBgJob(processWeeklyBigEvents(CLASS_CODE), "processWeeklyBigEvents")
    ]);
    // Kick the day's jobs off but DON'T block the page on them: paint what
    // we already have first, then wait. On the first load of the day pay day
    // alone can take seconds (it writes per student), and blocking here is
    // what made a phone sit on a blank page. The popups and the final
    // render() below still run after the jobs, exactly as they did before.
    await t29FirstPaint(render);
    await T29_STARTUP_JOBS;
    await checkWeeklyEventPopup(CURRENT.username, CLASS_CODE);
    await checkBigEventPopup(CURRENT.username, CLASS_CODE);
    await render(true);
    startAutoRefresh();
  } catch (err) {
    console.error("Stock Market failed to load:", err);
    const list = document.getElementById("companyList");
    if (list) {
      list.innerHTML = `<div class="card"><p class="error-msg" style="margin:0;">Something went wrong loading the Stock Market page: ${(err && err.message) || err}. Try refreshing, if it keeps happening, open the browser console (F12) and check for a red error, then share it so it can be fixed.</p></div>`;
    }
  }
}

// Companies are shared, live data — other students/teachers can buy, sell, open, close, or reprice a
// company at any moment, and Firestore saves each change instantly, but a page only reads it on load.
// This used to re-read the user and the class document every 5 seconds per open tab. Now live
// listeners on those two documents redraw the page the moment something actually changes, so an idle
// tab costs nothing. (Every company lives in the one class document, so any trade by anyone in the
// class reaches every open Market tab — that is the point.) If a listener can't be used it falls back
// to the old 5-second redraw. Both pause while the tab is hidden and catch up with one redraw on return.
let MARKET_REFRESH_TIMER = null;
let MARKET_UNWATCH = [];
let MARKET_DEBOUNCE = null;
let MARKET_REDRAW_PENDING = false;

function marketRedraw() {
  // Don't refresh out from under someone mid-edit (typing a new price, a buy/sell quantity, etc) —
  // wait until focus leaves the company list, then redraw once.
  const active = document.activeElement;
  const list = document.getElementById("companyList");
  if (list && list.contains(active)) { MARKET_REDRAW_PENDING = true; return; }
  MARKET_REDRAW_PENDING = false;
  render(true);
}
function marketStopLive() {
  MARKET_UNWATCH.forEach(stop => { try { stop(); } catch (e) { /* already stopped */ } });
  MARKET_UNWATCH = [];
  clearTimeout(MARKET_DEBOUNCE);
}
function marketStopAll() {
  marketStopLive();
  if (MARKET_REFRESH_TIMER) { clearInterval(MARKET_REFRESH_TIMER); MARKET_REFRESH_TIMER = null; }
}
function marketStartFallback() {
  marketStopLive();
  if (!MARKET_REFRESH_TIMER) MARKET_REFRESH_TIMER = setInterval(marketRedraw, 5000);
}
function marketStartLive() {
  if (MARKET_REFRESH_TIMER || MARKET_UNWATCH.length) return;
  if (typeof t29WatchDoc !== "function" || !CURRENT || !CLASS_CODE) { marketStartFallback(); return; }
  // A student with a daily time limit has their own document rewritten every ~10s by the time
  // tracker, which would bill a read each time, so only the class document is listened to for them
  // and their own document is re-read on each redraw.
  const timeTracked = CURRENT.dailyLimitMinutes > 0;
  const schedule = () => {
    clearTimeout(MARKET_DEBOUNCE);
    MARKET_DEBOUNCE = setTimeout(marketRedraw, 300);
  };
  let firstClass = true, firstUser = true, userSig = null;
  MARKET_UNWATCH.push(t29WatchDoc("classes", CLASS_CODE, (doc, info) => {
    if (info && info.error) { marketStartFallback(); return; }
    if (firstClass) { firstClass = false; return; } // the opening snapshot is what the page just drew
    schedule();
  }));
  if (!timeTracked) {
    MARKET_UNWATCH.push(t29WatchDoc("users", CURRENT.username, (doc, info) => {
      if (info && info.error) { marketStartFallback(); return; }
      if (!doc) return;
      const sig = JSON.stringify(doc, (k, v) => (k === "timeSpentTodaySec" || k === "timeSpentDate" ? undefined : v));
      if (firstUser) { firstUser = false; userSig = sig; return; }
      if (sig === userSig) return;
      userSig = sig;
      schedule();
    }));
  }
}
function startAutoRefresh() {
  marketStartLive();
  // Redraw once focus leaves the list if a change arrived while someone was typing in it.
  document.addEventListener("focusout", () => {
    if (MARKET_REDRAW_PENDING) setTimeout(marketRedraw, 250);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { marketStopAll(); return; }
    render(true);
    marketStartLive();
  });
}

function sparkline(history, splits) {
  const w = 140, h = 40;
  const max = Math.max(...history), min = Math.min(...history);
  const range = (max - min) || 1;
  const pts = history.map((v, i) => {
    const x = history.length === 1 ? w / 2 : (i / (history.length - 1)) * w;
    const y = max === min ? h / 2 : h - 3 - ((v - min) / range) * (h - 6);
    return { x, y };
  });
  const segments = pts.slice(1).map((p, i) => {
    const prev = pts[i];
    const up = p.y <= prev.y; // y is inverted (smaller y = higher price)
    return `<line x1="${prev.x.toFixed(1)}" y1="${prev.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${up ? '#3fbf8f' : '#e8735f'}" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join("");
  const marks = window.T29Split ? T29Split.marksSvg(history.length, splits, w, h) : "";
  const point = pts.length === 1 ? `<circle cx="${pts[0].x}" cy="${pts[0].y}" r="3" fill="currentColor"/>` : "";
  return `<svg class="stock-graph" role="img" aria-label="Price history, ${history.length} recorded ${history.length === 1 ? "price" : "prices"}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${segments}${point}${marks}</svg>`;
}

async function render(background = false) {
  try {
  // Re-derive IS_TEACHER from the live user doc every render (not just on
  // page load) so the teacher's management controls never get replaced by
  // the student buy/sell view after a role or session change. freshMe and
  // cls are independent reads — fetch both together instead of waiting on
  // one before starting the other (this page polls every 5s, so it's worth it).
  const [freshMe, cls] = await Promise.all([getUserCached(CURRENT.username), getClassCached(CLASS_CODE)]);
  if (freshMe) IS_TEACHER = t29EffRole(freshMe) === "teacher"; // (student view counts as a student)
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);

  const banner = document.getElementById("marketLockedBanner");
  const list = document.getElementById("companyList");
  if (!IS_TEACHER) {
    const lockReasons = await getModuleLockReasons(CURRENT.username, CLASS_CODE);
    const lockedModules = Object.keys(lockReasons);
    applyNavModuleLocks(lockReasons);
    if (lockedModules.includes("market")) {
      banner.classList.remove("hidden");
      banner.innerHTML = `<p style="margin:0;"><strong>The Stock Market is locked</strong><br>${MODULE_LOCK_MESSAGE[lockReasons.market] || MODULE_LOCK_MESSAGE.lifestyle}</p>`;
      list.innerHTML = "";
      return;
    }
  }
  banner.classList.add("hidden");
  // Focus can move into a card while the database reads are in flight.
  // Replacing that button between pointer-down and click drops the trade.
  if (background && list.contains(document.activeElement)) {
    MARKET_REDRAW_PENDING = true;
    return;
  }

  const range = cls.priceRange || { min: 1, max: 5 };
  if (IS_TEACHER) renderRealPicker(cls);
  t29FillSetting("rangeMin", range.min);
  t29FillSetting("rangeMax", range.max);
  const moveEl = document.getElementById("showShareMove");
  if (moveEl) moveEl.checked = !!cls.showShareMove;
  const upEl = document.getElementById("upChance");
  if (upEl && document.activeElement !== upEl) { upEl.value = t29UpChance(cls.marketUpChance); paintDownChance(); }

  // A class snapshot can arrive between typing a quantity and pressing Buy/Sell.
  const quantities = new Map([...list.querySelectorAll('input[id^="buy-"], input[id^="sell-"]')]
    .filter(input => input.value !== "").map(input => [input.id, input.value]));
  list.innerHTML = "";

  if (cls.companies.length === 0) {
    list.innerHTML = `<div class="card"><p class="muted-small">No companies are listed yet. ${IS_TEACHER ? "Open one above to get started." : "Check back once your teacher opens one."}</p></div>`;
    return;
  }

  cls.companies.forEach(co => {
    const holders = co.holders || {};
    const totalHeld = Object.values(holders).reduce((a, b) => a + b, 0);
    const pctSold = Math.round((totalHeld / co.totalShares) * 100);
    const myShares = holders[CURRENT.username] || 0;
    // "Today" is the last two points in the history — NOT oldest vs newest of the whole
    // 30-day window, which blurred a month of moves into one number that was labelled "today"
    // (and often looked like nothing had moved). Same rule the Property page uses.
    const hist = co.history?.length ? co.history.slice(-30) : [co.price];
    const listing = REAL_STOCKS.find(s => s.symbol === co.realSymbol);
    const isFund = listing?.kind === "etf";
    const unitLabel = isFund ? "units" : "shares";
    const last = hist[hist.length - 1];
    const prev = hist.length > 1 ? hist[hist.length - 2] : last;
    const change = last - prev;
    const changeNum = prev ? (change / prev) * 100 : 0;
    const changePct = (Math.round(changeNum * 10) === 0 ? 0 : changeNum).toFixed(1);

    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${escapeHtml(co.name)}${IS_TEACHER ? splitTag(co) : ""}</h4>
          ${isFund ? `<p class="muted-small real-quote-note">${fundSummary(listing)}</p>` : ""}
          ${listing ? `<p class="muted-small real-quote-note">${listing.exchange} · ${listing.symbol} · ${cls.realStocksEnabled ? closeLabel(co.quoteDate) : "Updates paused"} · ${realDate(co.quoteDate)}</p>` : ""}
          <div class="${change > 0 ? 'ticker-up' : change < 0 ? 'ticker-down' : ''}">${listing ? quotePrice(co.price) + " " + listing.currency : fmtMoney(co.price)} ${hist.length > 1 ? `<span class="muted-small">(${change > 0 ? '+' : ''}${changePct}% ${listing ? "since last recorded close" : "today"})</span>` : ""}</div>
          ${!listing && !IS_TEACHER && cls.showShareMove ? shareMoveHtml(co, cls) : ""}
        </div>
        ${sparkline(hist, co.splits)}
      </div>
      <div class="progress-bar"><div style="width:${pctSold}%"></div></div>
      <p class="muted-small">${co.availableShares.toLocaleString("en-NZ")} of ${co.totalShares.toLocaleString("en-NZ")} ${unitLabel} available &middot; You own ${myShares.toLocaleString("en-NZ")}</p>
      ${listing ? `<p class="muted-small">${isFund ? "Unit" : "Share"} count as of ${realDate(co.sharesDate)} · ${listing.issuer || (co.quoteSource === "Anthropic Investor Relations" ? co.quoteSource : listing.exchange === "NZX" ? "NZXplorer and issuer disclosures" : "Stock Market API")}</p>` : ""}
      ${splitHistory(co)}

      ${IS_TEACHER && listing ? `<button class="btn small coral" onclick="closeCo('${co.id}')">Delist &amp; cash out holders</button>` : IS_TEACHER ? `
        <div class="grid grid-2" style="margin-top:10px;">
          <div>
            <label for="price-${co.id}">Set new price</label>
            <div class="row-flex" style="gap:8px;">
              <input type="number" min="0.01" step="0.01" id="price-${co.id}" value="${co.price}">
              <button class="btn small" onclick="setPrice('${co.id}')">Update</button>
            </div>
          </div>
          <div style="text-align:right;">
            <label>&nbsp;</label>
            <button class="btn small coral" onclick="closeCo('${co.id}')">Delist &amp; cash out holders</button>
          </div>
        </div>
        <div class="grid grid-3" style="margin-top:10px;">
          <div>
            <label for="rmin-${co.id}">Min % change (this company)</label>
            <input type="number" min="0" step="0.5" id="rmin-${co.id}" value="${(co.priceRange || cls.priceRange || {min:1}).min}">
          </div>
          <div>
            <label for="rmax-${co.id}">Max % change (this company)</label>
            <input type="number" min="0" step="0.5" id="rmax-${co.id}" value="${(co.priceRange || cls.priceRange || {max:5}).max}">
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button class="btn small secondary" style="width:100%;" onclick="setCoRange('${co.id}')">Save range</button>
          </div>
        </div>
        ${splitRow(co)}
      ` : `
        <div class="grid grid-2" style="margin-top:10px;">
          <div>
            <label for="buy-${co.id}">Buy ${unitLabel}</label>
            <div class="row-flex" style="gap:8px;">
              <input type="number" min="1" step="1" id="buy-${co.id}" placeholder="qty">
              <button class="btn small gold" id="buyBtn-${co.id}" onclick="buy('${co.id}')">Buy</button>
            </div>
          </div>
          <div>
            <label for="sell-${co.id}">Sell ${unitLabel}</label>
            <div class="row-flex" style="gap:8px;">
              <input type="number" min="1" step="1" id="sell-${co.id}" placeholder="qty">
              <button class="btn small secondary" id="sellBtn-${co.id}" onclick="sell('${co.id}')">Sell</button>
            </div>
          </div>
        </div>
      `}
      <div id="msg-${co.id}"></div>
    `;
    list.appendChild(div);
    for (const input of div.querySelectorAll('input[id^="buy-"], input[id^="sell-"]')) {
      if (quantities.has(input.id)) input.value = quantities.get(input.id);
    }
    applyCompanyMsg(co.id);
  });
  // A student who held shares through a split is told once, with a before-and-after (see split.js).
  if (!IS_TEACHER && window.T29Split) T29Split.celebrate(cls, CURRENT);
  } catch (err) {
    console.error("Stock Market render failed:", err);
    const list = document.getElementById("companyList");
    if (list) list.innerHTML = `<div class="card"><p class="error-msg" style="margin:0;">Something went wrong showing the companies: ${(err && err.message) || err}. Try refreshing the page.</p></div>`;
  }
}

async function openCo(e) {
  e.preventDefault();
  const name = document.getElementById("coName").value.trim();
  const price = document.getElementById("coPrice").value;
  const shares = document.getElementById("coShares").value;
  const res = await openCompany(CLASS_CODE, name, price, shares);
  const box = document.getElementById("coMsg");
  if (res.ok) {
    box.innerHTML = `<div class="success-msg">${name} is now listed!</div>`;
    document.getElementById("coName").value = "";
    document.getElementById("coPrice").value = "";
    document.getElementById("coShares").value = "";
  } else {
    box.innerHTML = `<div class="error-msg">${res.error}</div>`;
  }
  await render();
  return false;
}

async function setPrice(id) {
  const val = document.getElementById("price-" + id).value;
  const res = await updateCompanyPrice(CLASS_CODE, id, val);
  if (res && !res.ok) setCompanyMsg(id, `<div class="error-msg">${res.error}</div>`);
  await render();
}
async function setCoRange(id) {
  const min = document.getElementById("rmin-" + id).value;
  const max = document.getElementById("rmax-" + id).value;
  const res = await setCompanyPriceRange(CLASS_CODE, id, min, max);
  if (res && !res.ok) setCompanyMsg(id, `<div class="error-msg">${res.error}</div>`);
  await render();
}
async function closeCo(id) {
  if (await t29Confirm("Remove this listing? Everyone who owns it will be paid at the current price.")) {
    await closeCompany(CLASS_CODE, id);
    await render();
  }
}
async function buy(id) {
  // Same fix, same reasoning as addAuto in bank.js: without this, a slow
  // connection plus an eager double-tap on Buy fires two purchases before
  // the first one's result is even visible. render() below rebuilds this
  // button from scratch (it's redrawn fresh on every render, including
  // the 5s auto-refresh), so re-enabling it here in `finally` only
  // matters on the rare path where something throws before that rebuild
  // happens — otherwise it's just disabling a node that's about to be
  // thrown away anyway.
  const btn = document.getElementById("buyBtn-" + id);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const qty = document.getElementById("buy-" + id).value;
    const res = await buyShares(CURRENT.username, CLASS_CODE, id, qty);
    if (res.ok) { const input = document.getElementById("buy-" + id); if (input && input.value === qty) input.value = ""; }
    setCompanyMsg(id, res.ok ? `<div class="success-msg">Purchased!</div>` : `<div class="error-msg">${res.error}</div>`);
    await render();
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function sell(id) {
  // Same double-tap guard as buy() above.
  const btn = document.getElementById("sellBtn-" + id);
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const qty = document.getElementById("sell-" + id).value;
    const res = await sellShares(CURRENT.username, CLASS_CODE, id, qty);
    if (res.ok) { const input = document.getElementById("sell-" + id); if (input && input.value === qty) input.value = ""; }
    setCompanyMsg(id, res.ok ? `<div class="success-msg">Sold!</div>` : `<div class="error-msg">${res.error}</div>`);
    await render();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Shows the down chance (100 minus the up chance) as the teacher types.
function paintDownChance() {
  const up = document.getElementById("upChance"), down = document.getElementById("downChance");
  if (!up || !down) return;
  const n = Number(up.value);
  down.value = up.value !== "" && Number.isFinite(n) && n >= 0 && n <= 100 ? String(Math.round((100 - n) * 10) / 10) : "";
}
async function saveUpChance() {
  const btn = document.getElementById("saveUpChanceBtn");
  const msg = document.getElementById("upChanceMsg");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const res = await setMarketUpChance(CLASS_CODE, document.getElementById("upChance").value);
    if (!res.ok) { msg.innerHTML = `<div class="error-msg">${escapeHtml(res.error)}</div>`; return; }
    msg.innerHTML = `<div class="success-msg">Saved. Each company now has a ${res.value}% chance of going up and a ${Math.round((100 - res.value) * 10) / 10}% chance of going down each simulated day.</div>`;
    await render();
  } catch (e) {
    msg.innerHTML = `<div class="error-msg">Couldn't save. Please try again.</div>`;
  } finally {
    btn.disabled = false;
  }
}

// Student-facing: how far this company's price can move on a simulated market day (teacher turns this on).
function shareMoveHtml(co, cls) {
  const r = co.priceRange || cls.priceRange || { min: 1, max: 5 };
  const lo = Math.max(0, Number(r.min) || 0), hi = Math.max(lo, Number(r.max) || 0);
  const d = pct => fmtMoney(Math.round(co.price * pct) / 100);
  if (hi <= 0) return `<div class="muted-small">On a market day this share doesn't move.</div>`;
  const pctText = lo === hi ? `${hi}%` : `${lo}%–${hi}%`;
  const dolText = lo === hi ? d(hi) : `${d(lo)}–${d(hi)}`;
  return `<div class="muted-small">On a market day it moves ${pctText}, up or down (about ${dolText} a share at today's price).</div>`;
}
async function saveShowShareMove() {
  const el = document.getElementById("showShareMove"), msg = document.getElementById("showMoveMsg");
  if (!el) return;
  el.disabled = true;
  try {
    const res = await setShowShareMove(CLASS_CODE, el.checked);
    msg.innerHTML = `<div class="success-msg">Saved. Students ${res.value ? "can now" : "can no longer"} see each company's daily price range.</div>`;
    await render();
  } catch (e) {
    el.checked = !el.checked;
    msg.innerHTML = `<div class="error-msg">Couldn't save. Please try again.</div>`;
  } finally {
    el.disabled = false;
  }
}

async function saveRange() {
  const min = document.getElementById("rangeMin").value;
  const max = document.getElementById("rangeMax").value;
  await setPriceRange(CLASS_CODE, min, max);
  document.getElementById("rangeMsg").innerHTML = `<div class="success-msg">Saved. Simulated companies will move between ${min}% and ${max}% per simulated day.</div>`;
  await render();
}

async function runMarketDay() {
  const results = await simulateMarketDay(CLASS_CODE);
  if (results.length === 0) {
    alert("List a simulated company to run a market day.");
    return;
  }
  const summary = results.map(r => `${r.name}: ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%`).join("\n");
  alert("Market day complete!\n\n" + summary);
  await render();
}

document.addEventListener("DOMContentLoaded", init);
