let CURRENT, CLASS_CODE, IS_TEACHER;

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
    delete COMPANY_MSGS[id];
    const stillThere = document.getElementById("msg-" + id);
    if (stillThere) stillThere.innerHTML = "";
  }, entry.expiresAt - Date.now());
}

function paintChrome() {
  paintIconSlots();
  document.getElementById("pageTitle").innerHTML = icon("chart", 26) + " Stock Market";
  document.getElementById("hOpen").innerHTML = icon("plus", 18) + " Open a new company";
  document.getElementById("labName").innerHTML = icon("building", 13) + " Company name";
  document.getElementById("labPrice").innerHTML = icon("coin", 13) + " Starting share price";
  document.getElementById("labShares").innerHTML = icon("chart", 13) + " Total shares available";
  document.getElementById("openBtn").innerHTML = icon("plus", 15) + " Open company";
  document.getElementById("hVolatility").innerHTML = icon("chart", 18) + " Daily price movement";
  document.getElementById("labRangeMin").innerHTML = icon("chart", 13) + " Minimum % change";
  document.getElementById("labRangeMax").innerHTML = icon("chart", 13) + " Maximum % change";
  document.getElementById("saveRangeBtn").innerHTML = icon("bank", 14) + " Save range";
  document.getElementById("simDayBtn").innerHTML = icon("repeat", 15) + " Simulate a market day";
  document.getElementById("footerIcon").innerHTML = icon("coin", 14);
}

async function init() {
  try {
    const u = await requireLogin();
    if (!u) return;
    CURRENT = u;
    CLASS_CODE = u.classCode;
    IS_TEACHER = u.role === "teacher";
    document.getElementById("whoami").textContent = (IS_TEACHER ? "Ms/Mr " : "") + u.name;
    document.getElementById("navHome").href = IS_TEACHER ? "teacher.html" : "student.html";
    document.getElementById("navHomeLabel").textContent = IS_TEACHER ? "Dashboard" : "My account";
    document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);
    paintChrome();
    enablePasswordToggles();
    await autoPayDayIfDue(CLASS_CODE);
    await processAutomations(CLASS_CODE);
    await processMortgages(CLASS_CODE);
    await processTermDeposits(CLASS_CODE);
    await autoInterestIfDue(CLASS_CODE);
    await processInsurancePayments(CLASS_CODE);
    await processWeeklyEvents(CLASS_CODE);
    await processWeeklyBigEvents(CLASS_CODE);
    await checkWeeklyEventPopup(CURRENT.username, CLASS_CODE);
    await checkBigEventPopup(CURRENT.username, CLASS_CODE);
    await render();
    startAutoRefresh();
  } catch (err) {
    console.error("Stock Market failed to load:", err);
    const list = document.getElementById("companyList");
    if (list) {
      list.innerHTML = `<div class="card"><p class="error-msg" style="margin:0;">Something went wrong loading the Stock Market page: ${(err && err.message) || err}. Try refreshing — if it keeps happening, open the browser console (F12) and check for a red error, then share it so it can be fixed.</p></div>`;
    }
  }
}

// Companies are shared, live data — other students/teachers can buy, sell,
// open, close, or reprice a company at any moment. Firestore already saves
// every change instantly, but this page only reads it on load, so without
// polling you'd only ever see a snapshot from whenever you opened the tab.
// Poll every 5s so prices/holdings stay in sync across devices. Only one
// interval is ever running per page load.
let MARKET_REFRESH_TIMER = null;
function startAutoRefresh() {
  if (MARKET_REFRESH_TIMER) return;
  MARKET_REFRESH_TIMER = setInterval(() => {
    // Don't refresh out from under someone mid-edit (typing a new price,
    // a buy/sell quantity, etc) — only poll when nothing's focused inside
    // the company list.
    const active = document.activeElement;
    const list = document.getElementById("companyList");
    if (list && list.contains(active)) return;
    render();
  }, 5000);
}

function sparkline(history) {
  const w = 140, h = 40;
  const max = Math.max(...history), min = Math.min(...history);
  const range = (max - min) || 1;
  const pts = history.map((v, i) => {
    const x = (i / (history.length - 1 || 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const up = history[history.length - 1] >= history[0];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts}" fill="none" stroke="${up ? '#3fbf8f' : '#e8735f'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

async function render() {
  try {
  // Re-derive IS_TEACHER from the live user doc every render (not just on
  // page load) so the teacher's management controls never get replaced by
  // the student buy/sell view after a role or session change.
  const freshMe = await getUser(CURRENT.username);
  if (freshMe) IS_TEACHER = freshMe.role === "teacher";
  document.getElementById("teacherPanel").classList.toggle("hidden", !IS_TEACHER);

  const cls = await getClass(CLASS_CODE);
  const range = cls.priceRange || { min: 1, max: 5 };
  document.getElementById("rangeMin").value = range.min;
  document.getElementById("rangeMax").value = range.max;

  const list = document.getElementById("companyList");
  list.innerHTML = "";

  if (cls.companies.length === 0) {
    list.innerHTML = `<div class="card"><p class="muted-small">No companies are listed yet. ${IS_TEACHER ? "Open one above to get started." : "Check back once your teacher opens one."}</p></div>`;
    return;
  }

  cls.companies.forEach(co => {
    const totalHeld = Object.values(co.holders).reduce((a, b) => a + b, 0);
    const pctSold = Math.round((totalHeld / co.totalShares) * 100);
    const myShares = co.holders[CURRENT.username] || 0;
    const first = co.history[0], last = co.history[co.history.length - 1];
    const change = last - first;
    const changePct = first ? ((change / first) * 100).toFixed(1) : "0.0";

    const div = document.createElement("div");
    div.className = "card company-card";
    div.innerHTML = `
      <div class="flex-between">
        <div>
          <h4>${icon("building", 20)}${co.name}</h4>
          <div class="${change >= 0 ? 'ticker-up' : 'ticker-down'}">${fmtMoney(co.price)} <span class="muted-small">(${change >= 0 ? '+' : ''}${changePct}% today)</span></div>
        </div>
        ${sparkline(co.history)}
      </div>
      <div class="progress-bar"><div style="width:${pctSold}%"></div></div>
      <p class="muted-small">${co.availableShares} of ${co.totalShares} shares still available &middot; You own ${myShares} share${myShares === 1 ? "" : "s"}</p>

      ${IS_TEACHER ? `
        <div class="grid grid-2" style="margin-top:10px;">
          <div>
            <label>Set new price</label>
            <div class="row-flex" style="gap:8px;">
              <input type="number" min="0.01" step="0.01" id="price-${co.id}" value="${co.price}">
              <button class="btn small" onclick="setPrice('${co.id}')">${icon("chart",13)} Update</button>
            </div>
          </div>
          <div style="text-align:right;">
            <label>&nbsp;</label>
            <button class="btn small coral" onclick="closeCo('${co.id}')">${icon("coin",13)} Delist &amp; cash out holders</button>
          </div>
        </div>
        <div class="grid grid-3" style="margin-top:10px;">
          <div>
            <label>Min % change (this company)</label>
            <input type="number" min="0" step="0.5" id="rmin-${co.id}" value="${(co.priceRange || cls.priceRange || {min:1}).min}">
          </div>
          <div>
            <label>Max % change (this company)</label>
            <input type="number" min="0" step="0.5" id="rmax-${co.id}" value="${(co.priceRange || cls.priceRange || {max:5}).max}">
          </div>
          <div style="display:flex;align-items:flex-end;">
            <button class="btn small secondary" style="width:100%;" onclick="setCoRange('${co.id}')">${icon("chart",13)} Save range</button>
          </div>
        </div>
      ` : `
        <div class="grid grid-2" style="margin-top:10px;">
          <div>
            <label>Buy shares</label>
            <div class="row-flex" style="gap:8px;">
              <input type="number" min="1" step="1" id="buy-${co.id}" placeholder="qty">
              <button class="btn small gold" onclick="buy('${co.id}')">${icon("plus",13)} Buy</button>
            </div>
          </div>
          <div>
            <label>Sell shares</label>
            <div class="row-flex" style="gap:8px;">
              <input type="number" min="1" step="1" id="sell-${co.id}" placeholder="qty">
              <button class="btn small secondary" onclick="sell('${co.id}')">${icon("send",13)} Sell</button>
            </div>
          </div>
        </div>
      `}
      <div id="msg-${co.id}"></div>
    `;
    list.appendChild(div);
    applyCompanyMsg(co.id);
  });
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
  await updateCompanyPrice(CLASS_CODE, id, val);
  await render();
}
async function setCoRange(id) {
  const min = document.getElementById("rmin-" + id).value;
  const max = document.getElementById("rmax-" + id).value;
  await setCompanyPriceRange(CLASS_CODE, id, min, max);
  await render();
}
async function closeCo(id) {
  if (confirm("Delist this company? All shareholders will be cashed out at the current price.")) {
    await closeCompany(CLASS_CODE, id);
    await render();
  }
}
async function buy(id) {
  const qty = document.getElementById("buy-" + id).value;
  const res = await buyShares(CURRENT.username, CLASS_CODE, id, qty);
  setCompanyMsg(id, res.ok ? `<div class="success-msg">Purchased!</div>` : `<div class="error-msg">${res.error}</div>`);
  await render();
}
async function sell(id) {
  const qty = document.getElementById("sell-" + id).value;
  const res = await sellShares(CURRENT.username, CLASS_CODE, id, qty);
  setCompanyMsg(id, res.ok ? `<div class="success-msg">Sold!</div>` : `<div class="error-msg">${res.error}</div>`);
  await render();
}

async function saveRange() {
  const min = document.getElementById("rangeMin").value;
  const max = document.getElementById("rangeMax").value;
  await setPriceRange(CLASS_CODE, min, max);
  document.getElementById("rangeMsg").innerHTML = `<div class="success-msg">Saved — companies will move between ${min}% and ${max}% per simulated day.</div>`;
  await render();
}

async function runMarketDay() {
  const results = await simulateMarketDay(CLASS_CODE);
  if (results.length === 0) {
    alert("There are no companies listed yet.");
    return;
  }
  const summary = results.map(r => `${r.name}: ${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(1)}%`).join("\n");
  alert("Market day complete!\n\n" + summary);
  await render();
}

document.addEventListener("DOMContentLoaded", init);
