/* ===================== The 29 World — Family view (parent.html) =====================
   A read-only report card for a student's family, opened from a link the
   student or their teacher made (see "Parent view" in data-money.js, and
   the Family links buttons on the Reports page).

   Deliberately loads none of the data-*.js files: nobody logs in here, and
   the only thing this page can read is the one /parentViews/{token}
   summary its link points at (see firestore.rules). The few helpers it
   needs are copied below rather than pulling in the whole data layer.
================================================================================ */

function pvEscape(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Same format as fmtMoney() in data-core.js.
function pvMoney(n) {
  const v = Number(n) || 0;
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pvIcon(name, size) {
  return typeof icon === "function" ? icon(name, size) : "";
}

function pvTimeAgo(ts) {
  ts = Number(ts);
  if (!ts) return "a while ago";
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return "on " + new Date(ts).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });
}

// One horizontal bar per category, biggest first, each scaled against the
// biggest — the same chart the student sees on their Reports page.
function pvBars(map, colorClass, emptyText) {
  const entries = Object.entries(map && typeof map === "object" ? map : {})
    .map(([label, amt]) => [label, Number(amt) || 0]).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="pv-empty">${emptyText}</p>`;
  const max = Math.max(...entries.map(e => e[1]));
  return `<div class="pv-bars">${entries.map(([label, amt]) => `
    <div class="pv-bar">
      <div class="pv-bar-label">${pvEscape(label)}</div>
      <div class="pv-bar-track"><div class="pv-bar-fill ${colorClass}" style="width:${max ? Math.max(2, Math.round((amt / max) * 100)) : 0}%"></div></div>
      <div class="pv-bar-amount">${pvMoney(amt)}</div>
    </div>`).join("")}</div>`;
}

function pvShowError(title, text) {
  document.getElementById("parentLoading").classList.add("hidden");
  if (title) document.getElementById("parentErrorTitle").textContent = title;
  if (text) document.getElementById("parentErrorText").textContent = text;
  document.getElementById("parentError").classList.remove("hidden");
}

function pvRender(doc) {
  const v = doc.view || {};
  const first = String(v.name || "Your child").trim().split(/\s+/)[0];
  document.title = `${v.name || "Report card"} — Family View — The 29 World`;

  // Everything in the summary was written by a browser, so text is always
  // escaped and numbers are always forced to be numbers before display.
  const goals = Array.isArray(v.goals) ? v.goals : [];
  const loanCount = Math.max(0, Math.floor(Number(v.activeLoanCount) || 0));
  const goalsHtml = goals.length
    ? goals.map(g => {
        const target = Number(g.target) || 0, saved = Number(g.saved) || 0;
        const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((saved / target) * 100))) : 0;
        return `
          <div class="pv-goal">
            <div class="pv-goal-head">
              <strong class="pv-goal-name">${pvEscape(g.name)}</strong>
              ${g.reached ? `<span class="badge mint">${pvIcon("star", 12)} Reached!</span>` : ""}
              <span class="pv-goal-amounts">${pvMoney(saved)} <span>of ${pvMoney(target)}</span></span>
            </div>
            <div class="pv-bar-track pv-goal-track"><div class="pv-bar-fill ${g.reached ? "mint" : "gold"}" style="width:${pct}%"></div></div>
            <div class="pv-goal-pct">${pct}% of the way there</div>
          </div>`;
      }).join("")
    : `<p class="pv-empty">${pvEscape(first)} hasn't set any savings goals yet.</p>`;

  const owns = [
    ["Cash", v.balance], ["Savings account", v.savings], ["Term deposits", v.termDeposits], ["KiwiSaver", v.kiwiSaver],
    ["Shares", v.invested], ["Property", v.propertyValue], ["Vehicles", v.vehicleValue], ["Store items", v.storeValue]
  ].filter(([, amt]) => Number(amt));
  const rate = Number.isFinite(Number(v.savingsRate)) && v.savingsRate !== null ? Number(v.savingsRate) + "%" : "—";
  const meta = [
    v.className ? `${pvIcon("users", 13)} ${pvEscape(v.className)}` : "",
    v.teacherName ? `${pvIcon("idcard", 13)} Teacher: ${pvEscape(v.teacherName)}` : "",
    v.job ? `${pvIcon("briefcase", 13)} Job: ${pvEscape(v.job)}` : ""
  ].filter(Boolean);
  const tile = (tone, ic, label, value, sub) => `
    <div class="pv-tile ${tone}">
      <div class="pv-tile-label">${pvIcon(ic, 16)}<span>${label}</span></div>
      <div class="pv-tile-value">${value}</div>
      ${sub ? `<div class="pv-tile-sub">${sub}</div>` : ""}
    </div>`;
  const tableRow = (label, amt, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td>${label}</td><td>${amt}</td></tr>`;

  document.getElementById("parentReport").innerHTML = `
    <section class="card pv-hero">
      <div class="pv-hero-top">
        <div class="pv-hero-text">
          <div class="pv-eyebrow">Report card</div>
          <h1>${pvEscape(v.name)}</h1>
          ${meta.length ? `<div class="pv-meta">${meta.map(m => `<span>${m}</span>`).join("")}</div>` : ""}
          <p class="pv-updated">Last updated ${pvTimeAgo(doc.updatedAt)}</p>
        </div>
        <button class="btn secondary no-print pv-print" onclick="window.print()">Print</button>
      </div>
      <div class="pv-explainer">
        <span class="pv-explainer-icon">${pvIcon("star", 18)}</span>
        <p><strong>What is this?</strong> The 29 World is a classroom money game. Students earn, save, spend and invest
        <em>pretend</em> money to practise real money skills. None of the amounts here are real money.</p>
      </div>
    </section>

    <section class="pv-tiles">
      ${tile("navy", "medal", "Net worth", pvMoney(v.netWorth), "Everything they have, minus what they owe")}
      ${tile("mint", "piggy", "Savings account", pvMoney(v.savings), "")}
      ${tile("gold", "coin", "Cash", pvMoney(v.balance), "Ready to spend")}
      ${tile("sky", "percent", "Savings rate", rate, "Of this month's income")}
    </section>

    <section class="card pv-card">
      <h2>${pvIcon("trophy", 20)} Savings goals</h2>
      <div class="pv-goals">${goalsHtml}</div>
    </section>

    <section class="card pv-card">
      <h2>${pvIcon("calendar", 20)} ${pvEscape(v.monthLabel || "This month")}</h2>
      <div class="pv-month-sum">
        <div class="pv-sum gold"><div class="pv-sum-label">Earned</div><div class="pv-sum-value">${pvMoney(v.incomeTotal)}</div></div>
        <div class="pv-sum mint"><div class="pv-sum-label">Saved &amp; invested</div><div class="pv-sum-value">${pvMoney(v.savedTotal)}</div></div>
        <div class="pv-sum coral"><div class="pv-sum-label">Spent</div><div class="pv-sum-value">${pvMoney(v.spentTotal)}</div></div>
      </div>
      <div class="pv-section">
        <h3>${pvIcon("coin", 16)} Where the money came from</h3>
        ${pvBars(v.income, "gold", "Nothing earned yet this month.")}
      </div>
      <div class="pv-section">
        <h3>${pvIcon("piggy", 16)} Saved &amp; invested</h3>
        ${pvBars(v.saved, "mint", "Nothing set aside yet this month.")}
      </div>
      <div class="pv-section">
        <h3>${pvIcon("cart", 16)} Spent on</h3>
        ${pvBars(v.spent, "coral", "Nothing spent yet this month.")}
      </div>
    </section>

    <div class="pv-two">
      <section class="card pv-card">
        <h2>${pvIcon("bank", 20)} What ${pvEscape(first)} has</h2>
        ${owns.length || Number(v.owed) ? `<table class="pv-table"><tbody>
          ${owns.map(([label, amt]) => tableRow(label, pvMoney(amt))).join("")}
          ${Number(v.owed) ? tableRow("Owes (loans and mortgage)", "-" + pvMoney(v.owed), "pv-owed") : ""}
          ${tableRow("Net worth", pvMoney(v.netWorth), "pv-total")}
        </tbody></table>` : `<p class="pv-empty">Nothing yet.</p>`}
        ${loanCount ? `<p class="pv-note">${loanCount} loan${loanCount === 1 ? "" : "s"} still being paid off.</p>` : ""}
      </section>
      <section class="card pv-card">
        <h2>${pvIcon("star", 20)} Since joining</h2>
        <table class="pv-table"><tbody>
          ${tableRow("Earned in total", pvMoney(v.lifetimeIncomeTotal))}
          ${tableRow("Saved &amp; invested in total", pvMoney(v.lifetimeSavedTotal))}
          ${tableRow("Spent in total", pvMoney(v.lifetimeSpentTotal))}
        </tbody></table>
      </section>
    </div>

    <section class="card pv-card no-print">
      <h2>${pvIcon("users", 20)} Things to talk about</h2>
      <ul class="pv-tips">
        <li>What are you saving up for, and how long will it take to get there?</li>
        <li>What did you spend the most on this month? Was it worth it?</li>
        <li>Have you tried the bank's savings account or the stock market yet? What happened?</li>
      </ul>
    </section>
  `;
  document.getElementById("parentLoading").classList.add("hidden");
  document.getElementById("parentReport").classList.remove("hidden");
}

async function pvInit() {
  const token = new URLSearchParams(window.location.search).get("t") || "";
  if (!/^[A-Za-z0-9]{10,64}$/.test(token)) { pvShowError(); return; }
  if (typeof fdb === "undefined") {
    pvShowError("Can't connect right now", "Check your internet connection, then reload this page.");
    return;
  }
  try {
    const snap = await fdb.collection("parentViews").doc(token).get();
    if (!snap.exists) { pvShowError(); return; }
    pvRender(snap.data());
  } catch (e) {
    console.error(e);
    if (navigator.onLine === false || (e && (e.code === "unavailable" || /offline/i.test(e.message || "")))) {
      pvShowError("Can't connect right now", "Check your internet connection, then reload this page.");
    } else {
      pvShowError();
    }
  }
}

document.addEventListener("DOMContentLoaded", pvInit);
